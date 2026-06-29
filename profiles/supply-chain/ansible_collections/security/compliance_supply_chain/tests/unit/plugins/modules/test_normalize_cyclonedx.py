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
    count_sbom_packages,
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
        'post_body_format': 'ndjson',
        'sbom_file': '',
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
        assert result['total_vulnerable_packages'] == 1
        assert result['total_scanned_packages'] == 0
        assert result['total_vulnerabilities'] == 1


class TestComposePostBody:
    """Tests for compose_post_body=True with post_body_format='json'."""

    def test_post_file_created(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-host1.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'post_body_format': 'json',
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
            'post_body_format': 'json',
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
            'post_body_format': 'json',
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
        assert not os.path.exists(output_file + '.ndjson')
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
        assert not os.path.exists(output_file + '.ndjson')
        assert 'post_file' not in module._exit_kwargs

    def test_check_mode_no_files_written(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'post_body_format': 'json',
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
            'post_body_format': 'json',
            'scan_id': 'scan-empty',
            'ingest_token': 'tok',
            'finalize': True,
        })
        run_normalize(module)

        with open(output_file + '.post.json') as f:
            body = json.load(f)
        assert body['findings'] == []
        assert body['finalize'] is True


class TestComposeNdjson:
    """Tests for compose_post_body=True with post_body_format='ndjson' (default)."""

    def test_ndjson_file_created(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-host1.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-ndj',
            'ingest_token': 'tok',
            'finalize': False,
        })
        run_normalize(module)

        ndjson_file = output_file + '.ndjson'
        assert os.path.exists(ndjson_file)
        assert module._exit_kwargs['post_file'] == ndjson_file

    def test_ndjson_preamble_structure(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-host1.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-pre',
            'ingest_token': 'tok-pre',
            'finalize': True,
        })
        run_normalize(module)

        with open(output_file + '.ndjson') as f:
            lines = f.readlines()

        preamble = json.loads(lines[0])
        assert preamble['_meta'] is True
        assert preamble['scanId'] == 'scan-pre'
        assert preamble['ingestToken'] == 'tok-pre'
        assert preamble['finalize'] is True
        assert preamble['host'] == 'webserver01'
        assert 'totalScannedPackages' in preamble
        assert 'totalVulnerablePackages' in preamble
        assert 'totalVulnerabilities' in preamble
        assert isinstance(preamble['totalScannedPackages'], int)
        assert isinstance(preamble['totalVulnerablePackages'], int)
        assert isinstance(preamble['totalVulnerabilities'], int)

    def test_ndjson_one_finding_per_line(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-host1.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-lines',
            'ingest_token': 'tok',
            'finalize': False,
        })
        run_normalize(module)

        with open(output_file + '.ndjson') as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]

        assert len(lines) == 2  # 1 preamble + 1 finding
        finding = json.loads(lines[1])
        assert finding['rule_id'] == 'CVE-2026-12345'
        assert finding['status'] == 'fail'

    def test_ndjson_compact_json(self):
        filepath = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-compact',
            'ingest_token': 'tok',
        })
        run_normalize(module)

        with open(output_file + '.ndjson') as f:
            line = f.readlines()[1]
        assert '": "' not in line  # compact separators use ":" not ": "

    def test_ndjson_empty_findings(self):
        data = {'matches': [], 'descriptor': {}}
        filepath = _write_grype_file(data, 'clean')
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings-clean.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-empty-ndj',
            'ingest_token': 'tok',
            'finalize': True,
        })
        run_normalize(module)

        with open(output_file + '.ndjson') as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]
        assert len(lines) == 1  # preamble only
        preamble = json.loads(lines[0])
        assert preamble['finalize'] is True

    def test_ndjson_line_count_matches_findings(self):
        match2 = dict(SAMPLE_GRYPE_MATCH)
        match2 = {**match2, 'vulnerability': {**match2['vulnerability'], 'id': 'CVE-2026-99999'}}
        match2 = {**match2, 'artifact': {**match2['artifact'], 'name': 'curl', 'version': '7.76.1'}}
        data = {'matches': [SAMPLE_GRYPE_MATCH, match2], 'descriptor': {}}
        filepath = _write_grype_file(data)
        tmpdir = os.path.dirname(filepath)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [filepath],
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-count',
            'ingest_token': 'tok',
        })
        run_normalize(module)

        with open(output_file + '.ndjson') as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]
        assert len(lines) == 3  # 1 preamble + 2 findings
        assert module._exit_kwargs['total_findings'] == 2


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

    def test_post_body_format_param(self):
        assert ARGUMENT_SPEC['post_body_format']['type'] == 'str'
        assert ARGUMENT_SPEC['post_body_format']['default'] == 'ndjson'
        assert 'json' in ARGUMENT_SPEC['post_body_format']['choices']
        assert 'ndjson' in ARGUMENT_SPEC['post_body_format']['choices']

    def test_sbom_file_param(self):
        assert ARGUMENT_SPEC['sbom_file']['type'] == 'str'
        assert ARGUMENT_SPEC['sbom_file']['default'] == ''
        assert ARGUMENT_SPEC['sbom_file']['required'] is False


def _write_sbom_file(num_components, hostname='webserver01'):
    """Write a minimal CycloneDX SBOM with N components."""
    tmpdir = tempfile.mkdtemp()
    filepath = os.path.join(tmpdir, f'sbom-{hostname}.json')
    components = [
        {'type': 'library', 'name': f'pkg-{i}', 'version': f'1.0.{i}'}
        for i in range(num_components)
    ]
    sbom = {'bomFormat': 'CycloneDX', 'specVersion': '1.5', 'components': components}
    with open(filepath, 'w') as f:
        json.dump(sbom, f)
    return filepath


class TestCountSbomPackages:
    def test_counts_components(self):
        path = _write_sbom_file(500)
        assert count_sbom_packages(path) == 500

    def test_empty_sbom(self):
        path = _write_sbom_file(0)
        assert count_sbom_packages(path) == 0

    def test_missing_file(self):
        assert count_sbom_packages('/nonexistent/path.json') == 0

    def test_empty_string(self):
        assert count_sbom_packages('') == 0

    def test_invalid_json(self):
        tmpdir = tempfile.mkdtemp()
        path = os.path.join(tmpdir, 'bad.json')
        with open(path, 'w') as f:
            f.write('not json')
        assert count_sbom_packages(path) == 0

    def test_no_components_key(self):
        tmpdir = tempfile.mkdtemp()
        path = os.path.join(tmpdir, 'minimal.json')
        with open(path, 'w') as f:
            json.dump({'bomFormat': 'CycloneDX'}, f)
        assert count_sbom_packages(path) == 0


class TestSbomFileIntegration:
    """Test sbom_file parameter in full normalize pipeline."""

    def test_sbom_file_populates_scanned_packages(self):
        grype_path = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        sbom_path = _write_sbom_file(500)
        tmpdir = os.path.dirname(grype_path)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [grype_path],
            'sbom_file': sbom_path,
            'output_file': output_file,
        })
        run_normalize(module)

        result = module._exit_kwargs
        assert result['total_scanned_packages'] == 500
        assert result['total_vulnerable_packages'] == 1

    def test_ndjson_preamble_with_sbom(self):
        grype_path = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        sbom_path = _write_sbom_file(300)
        tmpdir = os.path.dirname(grype_path)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [grype_path],
            'sbom_file': sbom_path,
            'output_file': output_file,
            'compose_post_body': True,
            'scan_id': 'scan-sbom',
            'ingest_token': 'tok',
        })
        run_normalize(module)

        with open(output_file + '.ndjson') as f:
            preamble = json.loads(f.readline())
        assert preamble['totalScannedPackages'] == 300
        assert preamble['totalVulnerablePackages'] == 1
        assert preamble['totalVulnerabilities'] == 1

    def test_report_json_has_correct_fields(self):
        grype_path = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        sbom_path = _write_sbom_file(200)
        tmpdir = os.path.dirname(grype_path)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [grype_path],
            'sbom_file': sbom_path,
            'output_file': output_file,
        })
        run_normalize(module)

        with open(output_file) as f:
            report = json.load(f)
        assert report['total_scanned_packages'] == 200
        assert report['total_vulnerable_packages'] == 1
        assert report['total_vulnerabilities'] == 1

    def test_vulnerability_free_rate_is_correct(self):
        """With 500 total packages and 1 vulnerable, rate = (500-1)/500 = 99.8%."""
        grype_path = _write_grype_file(SAMPLE_GRYPE_OUTPUT)
        sbom_path = _write_sbom_file(500)
        tmpdir = os.path.dirname(grype_path)
        output_file = os.path.join(tmpdir, 'findings.json')

        module = _make_mock_module({
            'grype_files': [grype_path],
            'sbom_file': sbom_path,
            'output_file': output_file,
        })
        run_normalize(module)

        result = module._exit_kwargs
        scanned = result['total_scanned_packages']
        vulnerable = result['total_vulnerable_packages']
        rate = round(((scanned - vulnerable) / scanned) * 100, 1)
        assert rate == 99.8
