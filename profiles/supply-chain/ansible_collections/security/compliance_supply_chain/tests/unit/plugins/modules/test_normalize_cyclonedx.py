"""Unit tests for normalize_cyclonedx module."""

import json
import os
import tempfile
import pytest
from unittest.mock import MagicMock

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
    run_normalize,
    CVSS_SEVERITY_MAP,
    ARGUMENT_SPEC,
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


def _make_mock_module(params, check_mode=False):
    """Create a mock AnsibleModule for run_normalize tests."""
    module = MagicMock()
    defaults = {
        'profile_name': 'Supply Chain Vulnerability Scan',
        'framework': 'SUPPLY_CHAIN',
        'compose_post_body': False,
        'scan_id': '',
        'ingest_token': '',
        'finalize': False,
    }
    defaults.update(params)
    module.params = defaults
    module.check_mode = check_mode
    module.warn = MagicMock()
    exit_kwargs = {}

    def capture_exit(**kwargs):
        exit_kwargs.update(kwargs)

    module.exit_json = capture_exit
    module._exit_kwargs = exit_kwargs
    return module


class TestRunNormalizeSlimReturn:
    """Verify exit_json no longer returns full findings list."""

    def test_no_findings_in_return(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-webserver01.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
        })
        run_normalize(module)

        result = module._exit_kwargs
        assert 'findings' not in result
        assert result['total_findings'] == 1
        assert result['hosts_processed'] == 1
        assert result['output_file'] == output_file

    def test_findings_written_to_disk(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-webserver01.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
        })
        run_normalize(module)

        with open(output_file) as f:
            report = json.load(f)
        assert len(report['findings']) == 1
        assert report['findings'][0]['rule_id'] == 'CVE-2026-12345'

    def test_summary_still_returned(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'out.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
        })
        run_normalize(module)

        result = module._exit_kwargs
        assert result['summary']['total'] == 1
        assert result['summary']['fail'] == 1
        assert result['total_packages'] == 1
        assert result['total_vulnerabilities'] == 1


class TestComposePostBody:
    """Tests for compose_post_body=True file generation."""

    def test_post_file_created(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-host1.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-123',
            'ingest_token': 'tok-secret',
            'finalize': True,
        })
        run_normalize(module)

        post_file = output_file + '.post.json'
        assert os.path.exists(post_file)
        assert module._exit_kwargs['post_file'] == post_file

    def test_post_body_structure(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-host1.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-456',
            'ingest_token': 'tok-abc',
            'finalize': False,
        })
        run_normalize(module)

        with open(output_file + '.post.json') as f:
            body = json.load(f)

        assert body['scanId'] == 'scan-456'
        assert body['ingestToken'] == 'tok-abc'
        assert body['finalize'] is False
        assert len(body['findings']) == 1
        assert body['findings'][0]['rule_id'] == 'CVE-2026-12345'

    def test_finalize_true_on_last_host(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT, 'last-host')
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-last-host.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-fin',
            'ingest_token': 'tok',
            'finalize': True,
        })
        run_normalize(module)

        with open(output_file + '.post.json') as f:
            body = json.load(f)
        assert body['finalize'] is True

    def test_no_post_file_without_scan_id(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': '',
        })
        run_normalize(module)

        assert not os.path.exists(output_file + '.post.json')
        assert 'post_file' not in module._exit_kwargs

    def test_no_post_file_when_disabled(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': False,
            'scan_id': 'scan-123',
        })
        run_normalize(module)

        assert not os.path.exists(output_file + '.post.json')
        assert 'post_file' not in module._exit_kwargs

    def test_check_mode_no_files_written(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-chk',
            'ingest_token': 'tok',
            'finalize': False,
        }, check_mode=True)
        run_normalize(module)

        assert not os.path.exists(output_file)
        assert not os.path.exists(output_file + '.post.json')
        assert module._exit_kwargs['changed'] is False

    def test_empty_matches_produces_empty_findings(self):
        data = {'matches': [], 'descriptor': {}}
        filepath = _write_grype_file(data, 'clean-host')
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-clean.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-empty',
            'ingest_token': 'tok',
            'finalize': True,
        })
        run_normalize(module)

        with open(output_file + '.post.json') as f:
            body = json.load(f)
        assert body['findings'] == []
        assert body['finalize'] is True


class TestArgumentSpec:
    """Verify ARGUMENT_SPEC includes new parameters with correct types."""

    def test_compose_post_body_param(self):
        assert ARGUMENT_SPEC['compose_post_body']['type'] == 'bool'
        assert ARGUMENT_SPEC['compose_post_body']['default'] is False

    def test_scan_id_param(self):
        assert ARGUMENT_SPEC['scan_id']['type'] == 'str'
        assert ARGUMENT_SPEC['scan_id']['default'] == ''

    def test_ingest_token_no_log(self):
        assert ARGUMENT_SPEC['ingest_token']['no_log'] is True

    def test_finalize_param(self):
        assert ARGUMENT_SPEC['finalize']['type'] == 'bool'
        assert ARGUMENT_SPEC['finalize']['default'] is False
