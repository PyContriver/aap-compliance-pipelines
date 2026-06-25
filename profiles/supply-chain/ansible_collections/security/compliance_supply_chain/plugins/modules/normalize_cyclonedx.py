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
version_added: "0.1.0"
options:
  grype_files:
    description: List of Grype JSON result file paths to process (one per host)
    type: list
    elements: str
    required: true
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
author:
  - Ansible Security Team (@ansible)
'''

EXAMPLES = r'''
- name: Normalize Grype results
  security.compliance_supply_chain.normalize_cyclonedx:
    grype_files:
      - /tmp/scan-results/grype-webserver01.json
      - /tmp/scan-results/grype-dbserver01.json
    output_file: /tmp/supply-chain-report.json
  register: normalized
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
total_packages:
  description: Total unique packages scanned across all hosts
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
  description: Path to the written output file
  returned: always
  type: str
findings:
  description: Findings list for ingest
  returned: always
  type: list
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

    all_findings = []
    hosts_processed = 0
    total_packages = 0
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
            total_packages += pkg_count
            host_list.append(hostname)
            for f in findings:
                unique_cves.add(f['rule_id'])
        except (json.JSONDecodeError, KeyError) as e:
            module.warn(f"Failed to parse {filepath}: {e}")
            continue

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
        'total_packages': total_packages,
        'total_vulnerabilities': len(unique_cves),
        'findings': all_findings,
        'summary': summary,
    }

    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    with open(output_file, 'w') as f:
        json.dump(report, f, indent=2)

    module.exit_json(
        changed=not module.check_mode,
        hosts_processed=hosts_processed,
        total_findings=len(all_findings),
        total_packages=total_packages,
        total_vulnerabilities=len(unique_cves),
        summary=summary,
        output_file=output_file,
        findings=all_findings,
    )


ARGUMENT_SPEC = {
    'grype_files': {'type': 'list', 'elements': 'str', 'required': True},
    'output_file': {'type': 'str', 'required': True},
    'profile_name': {'type': 'str', 'required': False, 'default': 'Supply Chain Vulnerability Scan'},
    'framework': {'type': 'str', 'required': False, 'default': 'SUPPLY_CHAIN'},
}


def main():
    module = AnsibleModule(
        argument_spec=ARGUMENT_SPEC,
        supports_check_mode=True,
    )
    run_normalize(module)


if __name__ == '__main__':
    main()
