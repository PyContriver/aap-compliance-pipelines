#!/usr/bin/python
# -*- coding: utf-8 -*-

# GNU General Public License v3.0+

DOCUMENTATION = r'''
---
module: normalize_cyclonedx
short_description: Normalize Grype vulnerability scan results to common compliance findings format
description:
  - Parses Grype JSON output (CycloneDX vulnerability match results).
  - Transforms each CVE match into the common findings JSON format (CFF).
  - Maps CVEs to CFF rules, CVSS scores to severity categories, package
    metadata to the evidence field.
  - Output is the scanner-agnostic format consumed by the Backstage compliance plugin.
  - When C(compose_post_body) is true, writes a second file containing the
    complete POST body for the findings ingest API. The playbook can then
    use C(ansible.builtin.uri) with C(src) to stream the file directly
    without loading findings into Ansible variable space (ADR-033).
version_added: "0.1.0"
options:
  grype_files:
    description: List of Grype JSON result file paths to process (one per host)
    type: list
    elements: str
    required: true
  sbom_file:
    description:
      - Path to the Syft CycloneDX SBOM JSON file for this host. Used to
        count the total number of scanned packages (components) for the
        vulnerability-free rate formula. Without this, the formula can only
        count vulnerable packages from Grype matches, which produces wrong
        results. The SBOM is loaded, components counted, then discarded to
        stay within the ADR-030 per-host memory envelope.
    type: str
    required: false
    default: ""
  output_file:
    description: Path to write the normalized JSON output
    type: str
    required: true
  profile_name:
    description: Human-readable profile name for the output report.
    type: str
    required: false
    default: "Supply Chain Vulnerability Scan"
  framework:
    description: Compliance framework identifier.
    type: str
    required: false
    default: "SUPPLY_CHAIN"
  compose_post_body:
    description:
      - When true, write a second file (C(output_file) with C(.post.json)
        suffix) containing the complete POST body for the findings ingest
        API endpoint, including scanId, ingestToken, findings, and finalize.
      - This allows the playbook to POST via C(uri) with C(src) parameter,
        streaming the file without loading findings into Jinja2 variable
        space. Prevents OOM on large finding sets.
    type: bool
    required: false
    default: false
  scan_id:
    description: Scan identifier for the POST body. Required when C(compose_post_body) is true.
    type: str
    required: false
    default: ""
  ingest_token:
    description: Per-scan ingest token for API authentication (ADR-010).
    type: str
    required: false
    default: ""
  finalize:
    description:
      - Whether this is the last per-host POST for the scan. When true,
        the backend transitions the scan to completed status and computes
        posture scores. Only the last host in the loop should set this.
    type: bool
    required: false
    default: false
author:
  - Ansible Security Team (@ansible)
'''

EXAMPLES = r'''
- name: Normalize Grype results (basic)
  security.compliance_supply_chain.normalize_cyclonedx:
    grype_files:
      - /tmp/scan-results/grype-webserver01.json
    output_file: /tmp/findings-webserver01.json
  register: normalized

- name: Normalize and compose POST body for API ingest
  security.compliance_supply_chain.normalize_cyclonedx:
    grype_files:
      - "{{ item.path }}"
    sbom_file: "/tmp/sbom-{{ hostname }}.json"
    output_file: "/tmp/findings-{{ hostname }}.json"
    compose_post_body: true
    scan_id: "{{ scan_id }}"
    ingest_token: "{{ ingest_token }}"
    finalize: "{{ ansible_loop.last }}"
  loop: "{{ grype_files.files }}"
  loop_control:
    extended: true

- name: Stream POST body to API (no Jinja2 file lookup)
  ansible.builtin.uri:
    url: "{{ api_url }}/api/compliance/findings/ingest"
    method: POST
    src: "/tmp/findings-{{ hostname }}.json.post.json"
    headers:
      Content-Type: application/json
    status_code: [201]
  no_log: true
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
total_scanned_packages:
  description: Total packages from Syft SBOM (all packages, including clean ones)
  returned: always
  type: int
total_vulnerable_packages:
  description: Total unique packages with at least one CVE (from Grype matches)
  returned: always
  type: int
total_vulnerabilities:
  description: Total unique CVEs found across all hosts
  returned: always
  type: int
summary:
  description: Aggregate pass/fail counts
  returned: always
  type: dict
output_file:
  description: Path to the written findings file
  returned: always
  type: str
post_file:
  description: Path to the composed POST body file (only when compose_post_body is true)
  returned: when compose_post_body is true
  type: str
'''

import json
import os
from ansible.module_utils.basic import AnsibleModule


CVSS_SEVERITY_MAP = {
    'Critical': 'CAT_I',
    'High': 'CAT_I',
    'Medium': 'CAT_II',
    'Low': 'CAT_III',
    'Negligible': 'CAT_III',
    'Unknown': 'CAT_II',
}


def extract_hostname(filepath):
    """Extract hostname from grype result filename: grype-<hostname>.json"""
    basename = os.path.basename(filepath)
    if basename.startswith('grype-') and basename.endswith('.json'):
        return basename[6:-5]
    return basename.replace('.json', '')


def map_severity(grype_severity):
    """Map Grype severity string to CFF severity category."""
    return CVSS_SEVERITY_MAP.get(grype_severity, 'CAT_II')


def build_fix_text(match):
    """Generate remediation instruction from Grype match data."""
    artifact = match.get('artifact', {})
    pkg_name = artifact.get('name', 'unknown')
    pkg_type = artifact.get('type', '')

    fixed_versions = []
    for ver in match.get('vulnerability', {}).get('fix', {}).get('versions', []):
        fixed_versions.append(ver)

    if not fixed_versions:
        return f"No fix available for {pkg_name}. Monitor for vendor updates."

    fix_ver = fixed_versions[0]

    if pkg_type in ('rpm', 'RPM'):
        return f"Update to {pkg_name}-{fix_ver} via `dnf update {pkg_name}`"
    elif pkg_type in ('deb', 'dpkg'):
        return f"Update to {pkg_name} {fix_ver} via `apt upgrade {pkg_name}`"
    elif pkg_type in ('apk',):
        return f"Update to {pkg_name}-{fix_ver} via `apk upgrade {pkg_name}`"
    elif pkg_type in ('python', 'pip', 'wheel', 'egg'):
        return f"Update {pkg_name} to {fix_ver} via `pip install {pkg_name}>={fix_ver}`"
    elif pkg_type in ('npm', 'javascript'):
        return f"Update {pkg_name} to {fix_ver} via `npm update {pkg_name}`"
    elif pkg_type in ('gem', 'ruby'):
        return f"Update {pkg_name} to {fix_ver} via `gem update {pkg_name}`"
    elif pkg_type in ('go-module', 'go'):
        return f"Update {pkg_name} to {fix_ver} via `go get {pkg_name}@v{fix_ver}`"
    else:
        return f"Update {pkg_name} to {fix_ver}"


def build_evidence(match):
    """Build evidence dict with package metadata for the CFF evidence field."""
    vuln = match.get('vulnerability', {})
    artifact = match.get('artifact', {})
    cvss_entries = vuln.get('cvss', [])

    cvss_score = None
    cvss_vector = None
    if cvss_entries:
        best = max(cvss_entries, key=lambda c: c.get('metrics', {}).get('baseScore', 0))
        cvss_score = best.get('metrics', {}).get('baseScore')
        cvss_vector = best.get('vector')

    purl = artifact.get('purl', '')
    fix_state = vuln.get('fix', {}).get('state', 'unknown')
    fix_versions = vuln.get('fix', {}).get('versions', [])

    evidence = {
        'sbom_tool': 'syft-grype',
        'purl': purl,
        'package_type': artifact.get('type', ''),
        'installed_version': artifact.get('version', ''),
        'fix_state': fix_state,
        'fix_versions': fix_versions,
        'datasource': vuln.get('dataSource', ''),
    }

    if cvss_score is not None:
        evidence['cvss_score'] = cvss_score
    if cvss_vector:
        evidence['cvss_vector'] = cvss_vector

    related_vulns = match.get('relatedVulnerabilities', [])
    if related_vulns:
        evidence['related_cves'] = [rv.get('id', '') for rv in related_vulns[:5]]

    return evidence


def count_sbom_packages(sbom_path):
    """Count total components in a Syft CycloneDX SBOM. Load, count, discard."""
    if not sbom_path or not os.path.exists(sbom_path):
        return 0
    try:
        with open(sbom_path, 'r') as f:
            data = json.load(f)
        count = len(data.get('components', []))
        del data
        return count
    except (json.JSONDecodeError, OSError):
        return 0


def normalize_grype_file(filepath):
    """Parse a single Grype JSON result file into CFF findings."""
    with open(filepath, 'r') as f:
        data = json.load(f)

    hostname = extract_hostname(filepath)
    matches = data.get('matches', [])
    all_packages = set()
    findings = []

    for match in matches:
        vuln = match.get('vulnerability', {})
        artifact = match.get('artifact', {})

        cve_id = vuln.get('id', '')
        pkg_name = artifact.get('name', 'unknown')
        pkg_version = artifact.get('version', '')
        severity = vuln.get('severity', 'Unknown')

        pkg_key = f"{pkg_name}-{pkg_version}"
        all_packages.add(pkg_key)

        finding = {
            'rule_id': cve_id,
            'stig_id': pkg_name,
            'title': f"{pkg_name} {pkg_version} — {cve_id}",
            'severity': map_severity(severity),
            'status': 'fail',
            'host': hostname,
            'description': vuln.get('description', f"Vulnerability {cve_id} in {pkg_name} {pkg_version}"),
            'check_text': f"CVSS: {severity}",
            'fix_text': build_fix_text(match),
            'evidence': build_evidence(match),
            'category': '',
            'disruption': 'low',
            'aap_impact': 'safe',
            'aap_impact_reason': '',
            'parameters': [],
            'scanner': 'syft-grype',
        }
        findings.append(finding)

    scanned_pkg_count = len(all_packages)
    descriptor = data.get('descriptor', {})

    return hostname, findings, scanned_pkg_count, descriptor


def run_normalize(module):
    """Main entry point called by the Ansible module wrapper."""
    grype_files = module.params['grype_files']
    output_file = module.params['output_file']
    profile_name = module.params.get('profile_name', 'Supply Chain Vulnerability Scan')
    framework = module.params.get('framework', 'SUPPLY_CHAIN')
    compose_post_body = module.params.get('compose_post_body', False)
    scan_id = module.params.get('scan_id', '')
    ingest_token = module.params.get('ingest_token', '')
    finalize = module.params.get('finalize', False)

    sbom_file = module.params.get('sbom_file', '')

    all_findings = []
    hosts_processed = 0
    total_vulnerable_packages = 0
    total_scanned_packages = 0
    unique_cves = set()
    host_list = []

    for filepath in grype_files:
        if not os.path.exists(filepath):
            module.warn(f"Grype result file not found, skipping: {filepath}")
            continue

        try:
            hostname, findings, pkg_count, _ = normalize_grype_file(filepath)
            all_findings.extend(findings)
            hosts_processed += 1
            total_vulnerable_packages += pkg_count
            host_list.append(hostname)
            for f in findings:
                unique_cves.add(f['rule_id'])
        except (json.JSONDecodeError, KeyError) as e:
            module.warn(f"Failed to parse {filepath}: {e}")
            continue

    total_scanned_packages = count_sbom_packages(sbom_file)
    if total_scanned_packages == 0 and total_vulnerable_packages > 0:
        module.warn("No SBOM file provided or empty — totalScannedPackages will be 0, score formula will show N/A")

    pass_count = sum(1 for f in all_findings if f['status'] == 'pass')
    fail_count = sum(1 for f in all_findings if f['status'] == 'fail')

    summary = {
        'total': len(all_findings),
        'pass': pass_count,
        'fail': fail_count,
        'error': 0,
        'notapplicable': 0,
        'notchecked': 0,
    }

    report = {
        'profile_name': profile_name,
        'framework': framework,
        'scanner': 'syft-grype',
        'hosts': host_list,
        'total_scanned_packages': total_scanned_packages,
        'total_vulnerable_packages': total_vulnerable_packages,
        'total_vulnerabilities': len(unique_cves),
        'findings': all_findings,
        'summary': summary,
    }

    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    if not module.check_mode:
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)

    post_body_format = module.params.get('post_body_format', 'ndjson')

    post_file = ''
    if compose_post_body and not scan_id:
        module.warn("compose_post_body is true but scan_id is empty — skipping POST body composition")
    if compose_post_body and scan_id and not module.check_mode:
        if post_body_format == 'ndjson':
            post_file = output_file + '.ndjson'
            with open(post_file, 'w') as f:
                preamble = {
                    '_meta': True,
                    'scanId': scan_id,
                    'ingestToken': ingest_token,
                    'finalize': finalize,
                    'host': host_list[0] if host_list else 'unknown',
                    'totalScannedPackages': total_scanned_packages,
                    'totalVulnerablePackages': total_vulnerable_packages,
                    'totalVulnerabilities': len(unique_cves),
                }
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
        total_scanned_packages=total_scanned_packages,
        total_vulnerable_packages=total_vulnerable_packages,
        total_vulnerabilities=len(unique_cves),
        summary=summary,
        output_file=output_file,
    )
    if post_file:
        result['post_file'] = post_file

    module.exit_json(**result)


ARGUMENT_SPEC = {
    'grype_files': {'type': 'list', 'elements': 'str', 'required': True},
    'sbom_file': {'type': 'str', 'required': False, 'default': ''},
    'output_file': {'type': 'str', 'required': True},
    'profile_name': {'type': 'str', 'required': False, 'default': 'Supply Chain Vulnerability Scan'},
    'framework': {'type': 'str', 'required': False, 'default': 'SUPPLY_CHAIN'},
    'compose_post_body': {'type': 'bool', 'required': False, 'default': False},
    'scan_id': {'type': 'str', 'required': False, 'default': ''},
    'ingest_token': {'type': 'str', 'required': False, 'default': '', 'no_log': True},
    'finalize': {'type': 'bool', 'required': False, 'default': False},
    'post_body_format': {'type': 'str', 'required': False, 'default': 'ndjson',
                         'choices': ['json', 'ndjson']},
}


def main():
    module = AnsibleModule(
        argument_spec=ARGUMENT_SPEC,
        supports_check_mode=True,
    )
    run_normalize(module)


if __name__ == '__main__':
    main()
