#!/usr/bin/env python3
"""Extract rule metadata from an SSG XCCDF datastream into YAML.

Parses ssg-rhel9-ds.xml (or any SCAP 1.2/1.3 datastream) and outputs
a comprehensive rules YAML with title, description, check_text, fix_text,
severity, and control identifiers for every rule in the benchmark.

Usage:
    # From a local SSG install:
    python3 extract_rule_metadata.py \
        /usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml \
        --profile cis_server_l1 \
        --framework CIS \
        -o rules/cis_l1_rhel9.yml

    # During EE build (appended to execution-environment.yml):
    RUN python3 /tmp/extract_rule_metadata.py \
        /usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml \
        --profile stig --framework DISA_STIG \
        -o /usr/share/ansible/collections/ansible_collections/security/.../rules/rules.yml

The output YAML is loaded by the Backstage backend as a fallback when
the normalize_xccdf module doesn't provide metadata for a rule (e.g.,
when the XCCDF lacks <description>, <rationale>, or <fix> elements).

Freshness: The output is tied to the SSG version installed in the EE.
Rebuilding the EE with a newer scap-security-guide automatically
regenerates this file with updated metadata.
"""

import argparse
import sys
import xml.etree.ElementTree as ET


def itertext(el):
    """Extract all text from an element including nested children."""
    return ''.join(el.itertext()).strip() if el is not None else ''


def detect_namespace(root):
    tag = root.tag
    if '{' in tag:
        return tag.split('}')[0] + '}'
    return ''


def find_benchmark(root):
    """Find the XCCDF Benchmark element in a datastream or standalone XCCDF."""
    if 'Benchmark' in root.tag:
        return root

    # DataStream collection — search inside ds:component elements
    for el in root.iter():
        if 'Benchmark' in el.tag:
            return el
    return None


def extract_rules(datastream_path, xccdf_profile=None):
    """Parse the datastream and extract all rule metadata."""
    tree = ET.parse(datastream_path)
    root = tree.getroot()

    benchmark = find_benchmark(root)
    if benchmark is None:
        print(f'ERROR: No Benchmark element found in {datastream_path}', file=sys.stderr)
        sys.exit(1)

    ns = detect_namespace(benchmark)

    # If a profile is specified, collect which rules are selected
    selected_rules = None
    if xccdf_profile:
        selected_rules = set()
        for profile_el in benchmark.iter(f'{ns}Profile' if ns else 'Profile'):
            pid = profile_el.get('id', '')
            if xccdf_profile in pid:
                for sel in profile_el.iter(f'{ns}select' if ns else 'select'):
                    if sel.get('selected', 'true').lower() == 'true':
                        selected_rules.add(sel.get('idref', ''))
                break

    rules = []
    for rule_el in benchmark.iter(f'{ns}Rule' if ns else 'Rule'):
        rule_id_full = rule_el.get('id', '')
        # Strip the XCCDF prefix to get the short CaC rule ID
        rule_id = rule_id_full.replace('xccdf_org.ssgproject.content_rule_', '')

        if selected_rules is not None and rule_id_full not in selected_rules:
            continue

        severity = rule_el.get('severity', 'medium')

        title_el = rule_el.find(f'{ns}title' if ns else 'title')
        title = title_el.text.strip() if title_el is not None and title_el.text else ''

        desc_el = rule_el.find(f'{ns}description' if ns else 'description')
        description = itertext(desc_el)

        # Check text: try <rationale> (SSG), then <check>/<check-content> (standard XCCDF)
        rationale_el = rule_el.find(f'{ns}rationale' if ns else 'rationale')
        check_text = itertext(rationale_el)
        if not check_text:
            for check_el in rule_el.iter(f'{ns}check-content' if ns else 'check-content'):
                check_text = itertext(check_el)
                if check_text:
                    break

        # Fix text: try <fix> (SSG, prefer Ansible), then <fixtext> (standard XCCDF)
        fix_text = ''
        for fix_el in rule_el.findall(f'{ns}fix' if ns else 'fix'):
            sys_attr = fix_el.get('system', '')
            text = itertext(fix_el)
            if 'ansible' in sys_attr and text:
                fix_text = text
                break
        if not fix_text:
            for fix_el in rule_el.findall(f'{ns}fix' if ns else 'fix'):
                text = itertext(fix_el)
                if text:
                    fix_text = text
                    break
        if not fix_text:
            fixtext_el = rule_el.find(f'{ns}fixtext' if ns else 'fixtext')
            fix_text = itertext(fixtext_el)

        # Extract control identifiers
        stig_id = ''
        cis_id = ''
        cce_id = ''
        for ident in rule_el.iter(f'{ns}ident' if ns else 'ident'):
            sys_attr = ident.get('system', '')
            text = (ident.text or '').strip()
            if 'cce' in sys_attr.lower():
                cce_id = text
            elif text.startswith('V-'):
                stig_id = text
            elif text.startswith('SV-'):
                stig_id = text

        for ref in rule_el.iter(f'{ns}reference' if ns else 'reference'):
            href = ref.get('href', '')
            text = (ref.text or '').strip()
            if 'cisecurity' in href and text:
                cis_id = text

        # Extract disruption and reboot from SSG fix text tags (before truncation)
        disruption = 'medium'
        if 'high_disruption' in fix_text:
            disruption = 'high'
        elif 'low_disruption' in fix_text:
            disruption = 'low'
        elif 'medium_disruption' in fix_text:
            disruption = 'medium'
        reboot_required = 'reboot_needed' in fix_text and 'no_reboot_needed' not in fix_text

        rules.append({
            'id': rule_id,
            'title': title,
            'description': description[:500] if description else '',
            'severity': severity,
            'disruption': disruption,
            'reboot_required': reboot_required,
            'check_text': check_text[:500] if check_text else '',
            'fix_text': fix_text[:500] if fix_text else '',
            'stig_id': stig_id,
            'cis_id': cis_id,
            'cce_id': cce_id,
        })

    return rules


def to_yaml(rules, framework, profile_name, version):
    """Render rules as YAML without requiring PyYAML."""
    def esc(s):
        if not s:
            return '""'
        if any(c in s for c in ':\n#{}[]|>!&*?') or s.startswith('"') or s.startswith("'"):
            return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ') + '"'
        return s

    lines = [
        '---',
        '# Auto-generated rule metadata from scap-security-guide XCCDF datastream.',
        '# DO NOT EDIT — regenerate by rebuilding the Execution Environment or running:',
        '#   python3 scripts/extract_rule_metadata.py \\',
        '#       /usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml \\',
        f'#       --profile {profile_name} --framework {framework} -o <output>',
        '#',
        '# Freshness is tied to the SSG version in the EE. Rebuilding the EE',
        '# with an updated scap-security-guide regenerates this file.',
        '',
        'profile:',
        f'  framework: {framework}',
        f'  version: {esc(version)}',
        f'  rule_count: {len(rules)}',
        '',
        'rules:',
    ]

    for r in rules:
        lines.append(f'  - id: {r["id"]}')
        lines.append(f'    title: {esc(r["title"])}')
        lines.append(f'    severity: {r["severity"]}')
        lines.append(f'    disruption: {r["disruption"]}')
        if r['reboot_required']:
            lines.append(f'    reboot_required: true')
        if r['stig_id']:
            lines.append(f'    stig_id: {r["stig_id"]}')
        if r['cis_id']:
            lines.append(f'    cis_id: {r["cis_id"]}')
        if r['cce_id']:
            lines.append(f'    cce_id: {r["cce_id"]}')
        lines.append(f'    description: {esc(r["description"])}')
        lines.append(f'    check_text: {esc(r["check_text"])}')
        lines.append(f'    fix_text: {esc(r["fix_text"])}')

    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(
        description='Extract rule metadata from SCAP datastream to YAML')
    parser.add_argument('datastream', help='Path to ssg-rhel9-ds.xml')
    parser.add_argument('--profile', required=True,
                        help='XCCDF profile ID substring (e.g., stig, cis_server_l1, cis)')
    parser.add_argument('--framework', required=True,
                        help='Framework name (e.g., DISA_STIG, CIS)')
    parser.add_argument('--version', default='',
                        help='Profile version string')
    parser.add_argument('-o', '--output', required=True,
                        help='Output YAML file path')
    args = parser.parse_args()

    rules = extract_rules(args.datastream, args.profile)
    if not rules:
        print(f'WARNING: No rules extracted for profile "{args.profile}"', file=sys.stderr)

    output = to_yaml(rules, args.framework, args.profile, args.version)

    import os
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, 'w') as f:
        f.write(output)

    print(f'Extracted {len(rules)} rules to {args.output}')

    # Summary stats
    has_desc = sum(1 for r in rules if r['description'])
    has_check = sum(1 for r in rules if r['check_text'])
    has_fix = sum(1 for r in rules if r['fix_text'])
    print(f'  with description: {has_desc}/{len(rules)}')
    print(f'  with check_text:  {has_check}/{len(rules)}')
    print(f'  with fix_text:    {has_fix}/{len(rules)}')


if __name__ == '__main__':
    main()
