"""Unit tests for normalize_cyclonedx module."""

import json
import os
import tempfile
import pytest

import sys
sys.path.insert(0, os.path.join(
    os.path.dirname(__file__), '..', '..', '..', '..',
    'plugins', 'modules',
))

from normalize_cyclonedx import (
    normalize_grype_file,
    extract_hostname,
    map_severity,
    build_fix_text,
    build_evidence,
    CVSS_SEVERITY_MAP,
)


SAMPLE_GRYPE_MATCH = {
    'vulnerability': {
        'id': 'CVE-2026-12345',
        'severity': 'High',
        'description': 'Buffer overflow in openssl',
        'fix': {
            'state': 'fixed',
            'versions': ['3.0.7-28.el9'],
        },
        'cvss': [
            {
                'metrics': {'baseScore': 8.1},
                'vector': 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
            }
        ],
        'dataSource': 'https://access.redhat.com/security/cve/CVE-2026-12345',
    },
    'artifact': {
        'name': 'openssl',
        'version': '3.0.7-27.el9',
        'type': 'rpm',
        'purl': 'pkg:rpm/redhat/openssl@3.0.7-27.el9?arch=x86_64',
    },
    'relatedVulnerabilities': [
        {'id': 'RHSA-2026:1234'},
    ],
}

SAMPLE_GRYPE_OUTPUT = {
    'matches': [SAMPLE_GRYPE_MATCH],
    'descriptor': {
        'name': 'grype',
        'version': '0.114.0',
    },
}


def _write_grype_file(data, hostname='webserver01'):
    """Write Grype JSON to a temp file and return the path."""
    tmpdir = tempfile.mkdtemp()
    filepath = os.path.join(tmpdir, f'grype-{hostname}.json')
    with open(filepath, 'w') as f:
        json.dump(data, f)
    return filepath


class TestExtractHostname:
    def test_standard_filename(self):
        assert extract_hostname('/tmp/grype-webserver01.json') == 'webserver01'

    def test_nested_path(self):
        assert extract_hostname('/var/scan-results/grype-db-primary.json') == 'db-primary'

    def test_non_standard_filename(self):
        assert extract_hostname('/tmp/results.json') == 'results'


class TestMapSeverity:
    def test_critical(self):
        assert map_severity('Critical') == 'CAT_I'

    def test_high(self):
        assert map_severity('High') == 'CAT_I'

    def test_medium(self):
        assert map_severity('Medium') == 'CAT_II'

    def test_low(self):
        assert map_severity('Low') == 'CAT_III'

    def test_negligible(self):
        assert map_severity('Negligible') == 'CAT_III'

    def test_unknown(self):
        assert map_severity('Unknown') == 'CAT_II'

    def test_unexpected(self):
        assert map_severity('SomethingElse') == 'CAT_II'


class TestBuildFixText:
    def test_rpm_package(self):
        result = build_fix_text(SAMPLE_GRYPE_MATCH)
        assert 'dnf update openssl' in result
        assert '3.0.7-28.el9' in result

    def test_no_fix_available(self):
        match = {
            'vulnerability': {'fix': {'state': 'not-fixed', 'versions': []}},
            'artifact': {'name': 'libxml2', 'type': 'rpm'},
        }
        result = build_fix_text(match)
        assert 'No fix available' in result

    def test_deb_package(self):
        match = {
            'vulnerability': {'fix': {'versions': ['2.9.14-1']}},
            'artifact': {'name': 'libxml2', 'type': 'deb'},
        }
        result = build_fix_text(match)
        assert 'apt upgrade' in result

    def test_pip_package(self):
        match = {
            'vulnerability': {'fix': {'versions': ['3.0.0']}},
            'artifact': {'name': 'requests', 'type': 'python'},
        }
        result = build_fix_text(match)
        assert 'pip install' in result

    def test_npm_package(self):
        match = {
            'vulnerability': {'fix': {'versions': ['1.2.3']}},
            'artifact': {'name': 'lodash', 'type': 'npm'},
        }
        result = build_fix_text(match)
        assert 'npm update' in result


class TestBuildEvidence:
    def test_full_evidence(self):
        evidence = build_evidence(SAMPLE_GRYPE_MATCH)
        assert evidence['sbom_tool'] == 'syft-grype'
        assert evidence['purl'] == 'pkg:rpm/redhat/openssl@3.0.7-27.el9?arch=x86_64'
        assert evidence['cvss_score'] == 8.1
        assert 'CVSS:3.1' in evidence['cvss_vector']
        assert evidence['package_type'] == 'rpm'
        assert evidence['installed_version'] == '3.0.7-27.el9'
        assert evidence['fix_state'] == 'fixed'
        assert '3.0.7-28.el9' in evidence['fix_versions']
        assert 'RHSA-2026:1234' in evidence['related_cves']

    def test_no_cvss(self):
        match = {
            'vulnerability': {'fix': {'state': 'unknown'}, 'cvss': []},
            'artifact': {'name': 'test', 'version': '1.0', 'type': 'rpm'},
        }
        evidence = build_evidence(match)
        assert 'cvss_score' not in evidence
        assert 'cvss_vector' not in evidence


class TestNormalizeGrypeFile:
    def test_single_match(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        hostname, findings, pkg_count, descriptor = normalize_grype_file(filepath)

        assert hostname == 'webserver01'
        assert len(findings) == 1
        assert pkg_count == 1

        f = findings[0]
        assert f['rule_id'] == 'CVE-2026-12345'
        assert f['stig_id'] == 'openssl'
        assert f['severity'] == 'CAT_I'
        assert f['status'] == 'fail'
        assert f['host'] == 'webserver01'
        assert f['scanner'] == 'syft-grype'
        assert f['disruption'] == 'low'
        assert f['aap_impact'] == 'safe'
        assert f['parameters'] == []
        assert 'openssl 3.0.7-27.el9' in f['title']
        assert f['evidence']['cvss_score'] == 8.1

    def test_all_matches_are_fail(self):
        data = {'matches': [SAMPLE_GRYPE_MATCH], 'descriptor': {}}
        filepath = _write_grype_file(data, 'dbserver01')

        hostname, findings, _, _ = normalize_grype_file(filepath)
        assert all(f['status'] == 'fail' for f in findings)

    def test_empty_matches(self):
        data = {'matches': [], 'descriptor': {}}
        filepath = _write_grype_file(data, 'clean-host')

        hostname, findings, pkg_count, _ = normalize_grype_file(filepath)
        assert hostname == 'clean-host'
        assert len(findings) == 0
        assert pkg_count == 0

    def test_multiple_matches_same_package(self):
        match2 = dict(SAMPLE_GRYPE_MATCH)
        match2['vulnerability'] = dict(match2['vulnerability'])
        match2['vulnerability']['id'] = 'CVE-2026-99999'
        data = {'matches': [SAMPLE_GRYPE_MATCH, match2], 'descriptor': {}}
        filepath = _write_grype_file(data)

        _, findings, pkg_count, _ = normalize_grype_file(filepath)
        assert len(findings) == 2
        assert pkg_count == 1  # same package, two CVEs

    def test_multiple_packages(self):
        match2 = dict(SAMPLE_GRYPE_MATCH)
        match2['artifact'] = {
            'name': 'curl',
            'version': '7.76.1-26.el9',
            'type': 'rpm',
            'purl': 'pkg:rpm/redhat/curl@7.76.1-26.el9',
        }
        match2['vulnerability'] = dict(match2['vulnerability'])
        match2['vulnerability']['id'] = 'CVE-2026-54321'
        data = {'matches': [SAMPLE_GRYPE_MATCH, match2], 'descriptor': {}}
        filepath = _write_grype_file(data)

        _, findings, pkg_count, _ = normalize_grype_file(filepath)
        assert len(findings) == 2
        assert pkg_count == 2


class TestCvssSeverityMapCompleteness:
    def test_all_grype_severities_mapped(self):
        expected = ['Critical', 'High', 'Medium', 'Low', 'Negligible', 'Unknown']
        for sev in expected:
            assert sev in CVSS_SEVERITY_MAP
