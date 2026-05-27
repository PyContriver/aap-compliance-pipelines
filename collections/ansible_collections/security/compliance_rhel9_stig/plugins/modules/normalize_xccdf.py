#!/usr/bin/python
# -*- coding: utf-8 -*-

# GNU General Public License v3.0+

DOCUMENTATION = r'''
---
module: normalize_xccdf
short_description: Normalize OpenSCAP XCCDF results to common compliance findings format
description:
  - Parses XCCDF result XML files produced by OpenSCAP.
  - Transforms each rule-result into the common findings JSON format.
  - Aggregates results across multiple hosts.
  - Output is the scanner-agnostic format consumed by the Backstage plugin.
version_added: "0.1.0"
options:
  results_files:
    description: List of XCCDF result XML file paths to process
    type: list
    elements: str
    required: true
  output_file:
    description: Path to write the normalized JSON output
    type: str
    required: true
author:
  - Red Hat Ansible Automation Platform
'''

EXAMPLES = r'''
- name: Normalize XCCDF results from a single host
  security.compliance_rhel9_stig.normalize_xccdf:
    results_files:
      - /tmp/scan-results/xccdf-results-webserver01.xml
    output_file: /tmp/compliance-report.json
  register: normalized

- name: Normalize results from multiple hosts
  security.compliance_rhel9_stig.normalize_xccdf:
    results_files:
      - /tmp/scan-results/xccdf-results-webserver01.xml
      - /tmp/scan-results/xccdf-results-dbserver01.xml
      - /tmp/scan-results/xccdf-results-appserver01.xml
    output_file: /var/lib/compliance/combined-report.json
  register: normalized

- name: Check mode - parse without writing output
  security.compliance_rhel9_stig.normalize_xccdf:
    results_files:
      - /tmp/scan-results/xccdf-results-webserver01.xml
    output_file: /tmp/compliance-report.json
  check_mode: true
  register: normalized

- name: Display summary after normalization
  ansible.builtin.debug:
    msg: >
      Processed {{ normalized.hosts_processed }} hosts,
      {{ normalized.total_findings }} findings
      ({{ normalized.summary.pass }} pass, {{ normalized.summary.fail }} fail)
'''

RETURN = r'''
hosts_processed:
  description: Number of hosts whose results were normalized
  returned: always
  type: int
total_findings:
  description: Total number of individual findings across all hosts
  returned: always
  type: int
summary:
  description: Aggregate pass/fail/error counts
  returned: always
  type: dict
output_file:
  description: Path to the written output file
  returned: always
  type: str
'''

import json
import os
import re
import xml.etree.ElementTree as ET

from ansible.module_utils.basic import AnsibleModule

XCCDF_NS = {
    'xccdf': 'http://checklists.nist.gov/xccdf/1.2',
    'xccdf11': 'http://checklists.nist.gov/xccdf/1.1',
}

SEVERITY_MAP = {
    'high': 'CAT_I',
    'medium': 'CAT_II',
    'low': 'CAT_III',
    'unknown': 'CAT_II',
}

STATUS_MAP = {
    'pass': 'pass',
    'fail': 'fail',
    'error': 'error',
    'unknown': 'error',
    'notapplicable': 'not_applicable',
    'notchecked': 'not_checked',
    'notselected': 'not_applicable',
    'informational': 'pass',
    'fixed': 'pass',
}


def extract_host_from_filename(filepath):
    """Extract hostname from XCCDF result filename convention."""
    basename = os.path.basename(filepath)
    match = re.search(r'xccdf-results-(.+)\.xml', basename)
    return match.group(1) if match else basename


def find_ns(root):
    """Detect XCCDF namespace version from the root element tag."""
    tag = root.tag
    if '{http://checklists.nist.gov/xccdf/1.2}' in tag:
        return 'http://checklists.nist.gov/xccdf/1.2'
    if '{http://checklists.nist.gov/xccdf/1.1}' in tag:
        return 'http://checklists.nist.gov/xccdf/1.1'
    return ''


def parse_xccdf_results(filepath):
    """Parse an XCCDF result XML file and return normalized findings."""
    tree = ET.parse(filepath)
    root = tree.getroot()
    ns = find_ns(root)
    nsmap = {'x': ns} if ns else {}

    host = extract_host_from_filename(filepath)
    findings = []

    test_result = root.find('.//x:TestResult', nsmap) if ns else root.find('.//TestResult')
    if test_result is None:
        return host, []

    # Build a rule metadata lookup from the Benchmark
    rule_meta = {}
    benchmark = root if 'Benchmark' in root.tag else root.find('.//x:Benchmark', nsmap)
    if benchmark is not None:
        for rule in benchmark.iter(f'{{{ns}}}Rule' if ns else 'Rule'):
            rule_id = rule.get('id', '')
            severity = rule.get('severity', 'medium')
            title_el = rule.find(f'{{{ns}}}title' if ns else 'title')
            desc_el = rule.find(f'{{{ns}}}description' if ns else 'description')
            fix_el = rule.find(f'{{{ns}}}fixtext' if ns else 'fixtext')
            # check-content lives inside <check><check-content>
            check_text = ''
            check_el = rule.find(f'{{{ns}}}check/{{{ns}}}check-content' if ns else 'check/check-content')
            if check_el is None:
                check_el = rule.find(f'{{{ns}}}check-content' if ns else 'check-content')
            if check_el is not None and check_el.text:
                check_text = check_el.text

            title = title_el.text if title_el is not None and title_el.text else ''
            description = desc_el.text if desc_el is not None and desc_el.text else ''
            fix_text = fix_el.text if fix_el is not None and fix_el.text else ''

            # Extract STIG ID — check <ident> elements first (V- prefix),
            # then <reference> elements with DISA href (scap-security-guide
            # stores STIG IDs in references, not idents)
            stig_id = ''
            cce_id = ''
            for ident in rule.iter(f'{{{ns}}}ident' if ns else 'ident'):
                text = ident.text or ''
                if text.startswith('V-'):
                    stig_id = text
                elif text.startswith('CCE-'):
                    cce_id = text
            if not stig_id:
                for ref in rule.iter(f'{{{ns}}}reference' if ns else 'reference'):
                    href = ref.get('href', '')
                    text = ref.text or ''
                    if 'disa' in href.lower() or 'stig' in href.lower():
                        if text.startswith('V-') or re.match(r'V-\d+', text):
                            stig_id = text
                            break
                    if text.startswith('SRG-') or text.startswith('SV-'):
                        if not stig_id:
                            stig_id = text

            rule_meta[rule_id] = {
                'title': title,
                'description': description[:500],
                'severity': severity,
                'fix_text': fix_text[:500],
                'check_text': check_text[:500],
                'stig_id': stig_id,
            }

    # Process rule-results — skip not_applicable and notselected rules
    # as they don't contribute to compliance scores and bloat the DB
    SKIP_STATUSES = {'notapplicable', 'notselected', 'notchecked'}

    for rule_result in test_result.iter(f'{{{ns}}}rule-result' if ns else 'rule-result'):
        rule_id = rule_result.get('idref', '')
        severity_attr = rule_result.get('severity', 'medium')

        result_el = rule_result.find(f'{{{ns}}}result' if ns else 'result')
        status_text = result_el.text.lower() if result_el is not None and result_el.text else 'unknown'

        if status_text in SKIP_STATUSES:
            continue

        meta = rule_meta.get(rule_id, {})

        # Strip XCCDF prefix to get CaC-compatible rule ID
        short_rule_id = re.sub(
            r'^xccdf_org\.ssgproject\.content_rule_', '', rule_id,
        )

        rule_title = meta.get('title', short_rule_id)
        finding = {
            'rule_id': short_rule_id,
            'stig_id': meta.get('stig_id', ''),
            'title': rule_title,
            'description': meta.get('description', ''),
            'severity': SEVERITY_MAP.get(severity_attr, 'CAT_II'),
            'status': STATUS_MAP.get(status_text, 'error'),
            'host': host,
            'scanner': 'openscap',
            'evidence': {
                'actual': status_text,
                'expected': 'pass',
                'message': f'{rule_title}: {status_text}',
            },
            'fix_text': meta.get('fix_text', ''),
            'check_text': meta.get('check_text', ''),
            'category': '',
            'disruption': 'medium',
            'parameters': [],
        }
        findings.append(finding)

    return host, findings


def main():
    module = AnsibleModule(
        argument_spec=dict(
            results_files=dict(type='list', elements='str', required=True),
            output_file=dict(type='str', required=True),
        ),
        supports_check_mode=True,
    )

    results_files = module.params['results_files']
    output_file = module.params['output_file']

    all_findings = []
    hosts_processed = 0
    summary = {'pass': 0, 'fail': 0, 'error': 0, 'not_applicable': 0, 'not_checked': 0}

    for filepath in results_files:
        if not os.path.exists(filepath):
            module.warn(f'Results file not found: {filepath}')
            continue

        try:
            host, findings = parse_xccdf_results(filepath)
            hosts_processed += 1
            all_findings.extend(findings)

            for f in findings:
                status = f['status']
                if status in summary:
                    summary[status] += 1
        except ET.ParseError as e:
            module.warn(f'Failed to parse {filepath}: {e}')
        except (OSError, IOError) as e:
            module.warn(f'Error reading {filepath}: {e}')
        except (KeyError, ValueError) as e:
            module.warn(f'Error processing {filepath}: {e}')

    report = {
        'schema_version': '1.0.0',
        'scanner': 'openscap',
        'profile': 'DISA STIG RHEL 9',
        'timestamp': '',
        'hosts_processed': hosts_processed,
        'total_findings': len(all_findings),
        'findings': all_findings,
        'summary': summary,
    }

    if not module.check_mode:
        output_dir = os.path.dirname(output_file)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir)
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)

    # Return slim findings for Controller job events (stripped of heavy
    # metadata fields like description/fix_text that bloat the payload).
    # The full findings are in the output file for direct consumption.
    # Controller truncates event data when module output exceeds ~200KB.
    slim_findings = [
        {
            'rule_id': f['rule_id'],
            'stig_id': f.get('stig_id', ''),
            'title': f.get('title', f['rule_id']),
            'severity': f['severity'],
            'status': f['status'],
            'host': f['host'],
            'evidence': f'OpenSCAP: {f["status"]}',
        }
        for f in all_findings
    ]

    module.exit_json(
        changed=not module.check_mode,
        hosts_processed=hosts_processed,
        total_findings=len(all_findings),
        summary=summary,
        output_file=output_file,
        findings=slim_findings,
    )


if __name__ == '__main__':
    main()
