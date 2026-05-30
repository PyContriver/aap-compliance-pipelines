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
  profile_name:
    description: >
      Human-readable profile name for the output report.
      If not provided, extracted from the XCCDF Benchmark title.
    type: str
    required: false
    version_added: "0.1.0"
  framework:
    description: >
      Compliance framework hint for ID extraction priority.
      auto (default) extracts all available IDs.
      DISA_STIG prioritizes V-/SV- IDs. CIS prioritizes CIS reference IDs.
    type: str
    required: false
    default: auto
    choices: [auto, DISA_STIG, CIS]
    version_added: "0.1.0"
  certification_status:
    description: >
      Scanner certification level for this profile.
      certified = scanner validated by framework authority.
      conformant = uses official content but not the certified tool.
      uncertified = custom or homegrown checks.
    type: str
    required: false
    default: uncertified
    choices: [certified, conformant, uncertified]
    version_added: "0.1.0"
  certification_authority:
    description: Certifying body (e.g. "NIST SCAP 1.2", "CIS").
    type: str
    required: false
    default: ""
    version_added: "0.1.0"
author:
  - Ansible Security Team (@ansible)
'''

EXAMPLES = r'''
- name: Normalize XCCDF results from a single host
  security.compliance_rhel9_cis_l2.normalize_xccdf:
    results_files:
      - /tmp/scan-results/xccdf-results-webserver01.xml
    output_file: /tmp/compliance-report.json
  register: normalized

- name: Normalize results from multiple hosts
  security.compliance_rhel9_cis_l2.normalize_xccdf:
    results_files:
      - /tmp/scan-results/xccdf-results-webserver01.xml
      - /tmp/scan-results/xccdf-results-dbserver01.xml
      - /tmp/scan-results/xccdf-results-appserver01.xml
    output_file: /var/lib/compliance/combined-report.json
  register: normalized

- name: Check mode - parse without writing output
  security.compliance_rhel9_cis_l2.normalize_xccdf:
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
findings:
  description: Slim findings list for Controller job events (stripped of heavy metadata)
  returned: always
  type: list
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


def parse_xccdf_results(filepath, framework='auto'):
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
            # SSG datastreams have <fix system="urn:xccdf:fix:script:ansible">
            # but no <fixtext>. Prefer Ansible fix script over Bash.
            fix_text = ''
            for fix_el in rule.findall(f'{{{ns}}}fix' if ns else 'fix'):
                sys_attr = fix_el.get('system', '')
                if 'ansible' in sys_attr and fix_el.text:
                    fix_text = fix_el.text
                    break
            if not fix_text:
                for fix_el in rule.findall(f'{{{ns}}}fix' if ns else 'fix'):
                    if fix_el.text:
                        fix_text = fix_el.text
                        break
            # Fall back to <fixtext> if present (non-SSG XCCDF)
            if not fix_text:
                fixtext_el = rule.find(f'{{{ns}}}fixtext' if ns else 'fixtext')
                if fixtext_el is not None and fixtext_el.text:
                    fix_text = fixtext_el.text

            # SSG uses <rationale> instead of inline <check-content>
            rationale_el = rule.find(f'{{{ns}}}rationale' if ns else 'rationale')
            check_text = rationale_el.text if rationale_el is not None and rationale_el.text else ''

            title = title_el.text if title_el is not None and title_el.text else ''
            description = desc_el.text if desc_el is not None and desc_el.text else ''

            # Extract control IDs from <ident> and <reference> elements.
            # All available IDs are collected; the primary ID used in the
            # output depends on the framework parameter.
            stig_id = ''
            cis_id = ''
            cce_id = ''
            for ident in rule.iter(f'{{{ns}}}ident' if ns else 'ident'):
                text = ident.text or ''
                if text.startswith('V-') or text.startswith('SV-'):
                    stig_id = stig_id or text
                elif text.startswith('CCE-'):
                    cce_id = text
            for ref in rule.iter(f'{{{ns}}}reference' if ns else 'reference'):
                href = ref.get('href', '')
                text = ref.text or ''
                href_lower = href.lower()
                if not stig_id and ('disa' in href_lower or 'stig' in href_lower):
                    if re.match(r'[SV]+-?\d+', text) or text.startswith('SRG-'):
                        stig_id = text
                if not cis_id and 'cisecurity' in href_lower:
                    cis_id = text

            # Select primary control ID based on framework
            if framework == 'CIS':
                control_id = cis_id or cce_id or stig_id
            elif framework == 'DISA_STIG':
                control_id = stig_id or cce_id
            else:
                control_id = stig_id or cis_id or cce_id

            rule_meta[rule_id] = {
                'title': title,
                'description': description[:500],
                'severity': severity,
                'fix_text': fix_text[:500],
                'check_text': check_text[:500],
                'stig_id': control_id,
                'cce_id': cce_id,
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
            profile_name=dict(type='str', required=False, default=None),
            framework=dict(type='str', required=False, default='auto',
                           choices=['auto', 'DISA_STIG', 'CIS']),
            certification_status=dict(type='str', required=False, default='uncertified',
                                      choices=['certified', 'conformant', 'uncertified']),
            certification_authority=dict(type='str', required=False, default=''),
        ),
        supports_check_mode=True,
    )

    results_files = module.params['results_files']
    output_file = module.params['output_file']
    profile_name = module.params['profile_name']
    cert_status = module.params['certification_status']
    cert_authority = module.params['certification_authority']
    framework = module.params['framework']

    all_findings = []
    hosts_processed = 0
    summary = {'pass': 0, 'fail': 0, 'error': 0, 'not_applicable': 0, 'not_checked': 0}

    for filepath in results_files:
        if not os.path.exists(filepath):
            module.warn(f'Results file not found: {filepath}')
            continue

        try:
            host, findings = parse_xccdf_results(filepath, framework)
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

    certification = {
        'status': cert_status,
        'authority': cert_authority,
    }

    report = {
        'schema_version': '1.0.0',
        'scanner': 'openscap',
        'profile': profile_name or 'OpenSCAP Compliance Scan',
        'certification': certification,
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
            'evidence': f['evidence'],
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
