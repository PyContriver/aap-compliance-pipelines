"""
Shared XCCDF normalization logic for all compliance profile collections.

This is the single source of truth. Each collection copies this file to
plugins/module_utils/normalize_common.py via the sync script. The
collection's normalize_xccdf.py module is a thin wrapper that imports
from here.

Do NOT edit the copies in individual collections — edit this file and
run: python scripts/sync_shared_modules.py
"""

import json
import os
import re
import xml.etree.ElementTree as ET

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


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
    'informational': 'pass',
    'fixed': 'pass',
}

# notapplicable is now passed through as 'not_applicable' for UI reporting.
# notselected (rules outside the profile) and notchecked are still dropped.
SKIP_STATUSES = {'notselected', 'notchecked'}


def load_rules_metadata_map(filepath):
    """Load rule metadata from a rules YAML file, keyed by rule id.

    Returns aap_impact, aap_impact_reason, and fix_text (CaC task YAML)
    when available. The fix_text from the rules YAML contains Ansible task
    content which replaces the XCCDF prose fix description.
    """
    if not filepath or not HAS_YAML or not os.path.exists(filepath):
        return {}
    try:
        with open(filepath, 'r') as f:
            content = yaml.safe_load(f)
        if not content:
            return {}
        result = {}
        for rule in content.get('rules', []):
            rule_id = rule.get('id', '')
            if not rule_id:
                continue
            entry = {}
            if rule.get('aap_impact'):
                entry['aap_impact'] = rule['aap_impact']
                entry['aap_impact_reason'] = rule.get('aap_impact_reason', '')
            if rule.get('fix_text'):
                entry['fix_text'] = rule['fix_text']
            if entry:
                result[rule_id] = entry
        return result
    except Exception:
        return {}


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

    rule_meta = {}
    benchmark = root if 'Benchmark' in root.tag else root.find('.//x:Benchmark', nsmap)
    if benchmark is not None:
        for rule in benchmark.iter(f'{{{ns}}}Rule' if ns else 'Rule'):
            rule_id = rule.get('id', '')
            severity = rule.get('severity', 'medium')
            title_el = rule.find(f'{{{ns}}}title' if ns else 'title')
            desc_el = rule.find(f'{{{ns}}}description' if ns else 'description')
            fix_text = ''
            for fix_el in rule.findall(f'{{{ns}}}fix' if ns else 'fix'):
                sys_attr = fix_el.get('system', '')
                el_text = ''.join(fix_el.itertext()).strip()
                if 'ansible' in sys_attr and el_text:
                    fix_text = el_text
                    break
            if not fix_text:
                for fix_el in rule.findall(f'{{{ns}}}fix' if ns else 'fix'):
                    el_text = ''.join(fix_el.itertext()).strip()
                    if el_text:
                        fix_text = el_text
                        break
            if not fix_text:
                fixtext_el = rule.find(f'{{{ns}}}fixtext' if ns else 'fixtext')
                if fixtext_el is not None:
                    fix_text = ''.join(fixtext_el.itertext()).strip()

            rationale_el = rule.find(f'{{{ns}}}rationale' if ns else 'rationale')
            check_text = ''.join(rationale_el.itertext()).strip() if rationale_el is not None else ''

            title = title_el.text if title_el is not None and title_el.text else ''
            description = ''.join(desc_el.itertext()).strip() if desc_el is not None else ''

            stig_id = ''
            cis_id = ''
            cce_id = ''
            for ident in rule.iter(f'{{{ns}}}ident' if ns else 'ident'):
                text = ident.text or ''
                if text.startswith('V-') or text.startswith('SV-'):
                    stig_id = stig_id or text
                elif text.startswith('SRG-'):
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
                if 'cisecurity' in href_lower:
                    if not cis_id or ('.' in text and '.' not in cis_id):
                        cis_id = text

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

    for rule_result in test_result.iter(f'{{{ns}}}rule-result' if ns else 'rule-result'):
        rule_id = rule_result.get('idref', '')
        severity_attr = rule_result.get('severity', 'medium')

        result_el = rule_result.find(f'{{{ns}}}result' if ns else 'result')
        status_text = result_el.text.lower() if result_el is not None and result_el.text else 'unknown'

        if status_text in SKIP_STATUSES:
            continue

        meta = rule_meta.get(rule_id, {})

        short_rule_id = re.sub(
            r'^xccdf_org\.ssgproject\.content_rule_', '', rule_id,
        )

        rule_title = meta.get('title', short_rule_id)
        fix_text = meta.get('fix_text', '')
        disruption = 'medium'
        if 'high_disruption' in fix_text:
            disruption = 'high'
        elif 'low_disruption' in fix_text:
            disruption = 'low'
        elif 'medium_disruption' in fix_text:
            disruption = 'medium'
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
            'fix_text': fix_text,
            'check_text': meta.get('check_text', ''),
            'category': '',
            'disruption': disruption,
            'aap_impact': 'safe',
            'aap_impact_reason': '',
            'parameters': [],
        }
        findings.append(finding)

    return host, findings


def run_normalize(module):
    """Main entry point called by the collection wrapper module."""
    results_files = module.params['results_files']
    output_file = module.params['output_file']
    profile_name = module.params['profile_name']
    cert_status = module.params['certification_status']
    cert_authority = module.params['certification_authority']
    framework = module.params['framework']
    rules_metadata_file = module.params['rules_metadata_file']

    rules_metadata_map = load_rules_metadata_map(rules_metadata_file)

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

    if rules_metadata_map:
        for f in all_findings:
            meta = rules_metadata_map.get(f['rule_id'])
            if meta:
                if meta.get('aap_impact'):
                    f['aap_impact'] = meta['aap_impact']
                    f['aap_impact_reason'] = meta.get('aap_impact_reason', '')
                if meta.get('fix_text'):
                    f['fix_text'] = meta['fix_text']

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

    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    if not module.check_mode:
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)

    compose_post_body = module.params.get('compose_post_body', False)
    scan_id = module.params.get('scan_id', '')
    ingest_token = module.params.get('ingest_token', '')
    finalize = module.params.get('finalize', False)
    post_body_format = module.params.get('post_body_format', 'ndjson')

    post_file = ''
    if compose_post_body and not scan_id:
        module.warn("compose_post_body is true but scan_id is empty — skipping POST body composition")
    if compose_post_body and scan_id and not module.check_mode:
        if post_body_format == 'ndjson':
            post_file = output_file + '.ndjson'
            with open(post_file, 'w') as f:
                preamble = {'_meta': True, 'scanId': scan_id, 'ingestToken': ingest_token, 'finalize': finalize}
                f.write(json.dumps(preamble, separators=(',', ':')) + '\n')
                for finding in all_findings:
                    f.write(json.dumps(finding, separators=(',', ':')) + '\n')
        else:
            post_file = output_file + '.post.json'
            post_body = {
                'scanId': scan_id,
                'ingestToken': ingest_token,
                'findings': all_findings,
                'finalize': finalize,
            }
            with open(post_file, 'w') as f:
                json.dump(post_body, f)

    result = dict(
        changed=not module.check_mode,
        hosts_processed=hosts_processed,
        total_findings=len(all_findings),
        summary=summary,
        output_file=output_file,
    )
    if post_file:
        result['post_file'] = post_file

    module.exit_json(**result)


ARGUMENT_SPEC = dict(
    results_files=dict(type='list', elements='str', required=True),
    output_file=dict(type='str', required=True),
    profile_name=dict(type='str', required=False, default=None),
    framework=dict(type='str', required=False, default='auto',
                   choices=['auto', 'DISA_STIG', 'CIS']),
    certification_status=dict(type='str', required=False, default='uncertified',
                              choices=['certified', 'conformant', 'uncertified']),
    certification_authority=dict(type='str', required=False, default=''),
    rules_metadata_file=dict(type='str', required=False, default=''),
    compose_post_body=dict(type='bool', required=False, default=False),
    scan_id=dict(type='str', required=False, default=''),
    ingest_token=dict(type='str', required=False, default='', no_log=True),
    finalize=dict(type='bool', required=False, default=False),
    post_body_format=dict(type='str', required=False, default='ndjson',
                          choices=['json', 'ndjson']),
)
