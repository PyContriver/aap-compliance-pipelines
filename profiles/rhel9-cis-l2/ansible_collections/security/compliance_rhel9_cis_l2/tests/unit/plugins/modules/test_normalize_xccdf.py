# GNU General Public License v3.0+

"""Unit tests for normalize_xccdf module."""

from __future__ import absolute_import, division, print_function
__metaclass__ = type

import json
import os
import tempfile
import pytest
from unittest.mock import patch

from ansible.module_utils import basic
from ansible.module_utils.common.text.converters import to_bytes


def set_module_args(args):
    """Prepare module args for AnsibleModule instantiation."""
    args = json.dumps({'ANSIBLE_MODULE_ARGS': args})
    basic._ANSIBLE_ARGS = to_bytes(args)
    # ansible-core >= 2.20 requires a serialization profile
    if hasattr(basic, '_ANSIBLE_PROFILE'):
        basic._ANSIBLE_PROFILE = 'json'


class AnsibleExitJson(Exception):
    """Exception class for capturing module.exit_json calls."""
    pass


class AnsibleFailJson(Exception):
    """Exception class for capturing module.fail_json calls."""
    pass


def exit_json(*args, **kwargs):
    """Replacement for AnsibleModule.exit_json that raises an exception."""
    if 'changed' not in kwargs:
        kwargs['changed'] = False
    raise AnsibleExitJson(kwargs)


def fail_json(*args, **kwargs):
    """Replacement for AnsibleModule.fail_json that raises an exception."""
    kwargs['failed'] = True
    raise AnsibleFailJson(kwargs)


@pytest.fixture(autouse=True)
def patch_module():
    """Patch AnsibleModule exit/fail methods for all tests."""
    with patch.object(basic.AnsibleModule, 'exit_json', exit_json):
        with patch.object(basic.AnsibleModule, 'fail_json', fail_json):
            yield


# ---------------------------------------------------------------------------
# XCCDF XML fixtures
# ---------------------------------------------------------------------------

XCCDF_12_MINIMAL = '''\
<?xml version="1.0" encoding="UTF-8"?>
<Benchmark xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_test_benchmark">
  <title>Test Benchmark</title>
  <Rule id="xccdf_rule_sshd_permit_root" severity="high">
    <title>Disable SSH Root Login</title>
    <description>Root login must be disabled</description>
    <fixtext>Set PermitRootLogin no</fixtext>
    <ident system="http://example.com">V-257846</ident>
  </Rule>
  <Rule id="xccdf_rule_fips_mode" severity="high">
    <title>Enable FIPS Mode</title>
    <description>FIPS 140-3 must be enabled</description>
    <fixtext>Run fips-mode-setup --enable</fixtext>
    <ident system="http://example.com">V-257777</ident>
  </Rule>
  <TestResult id="xccdf_test_result">
    <rule-result idref="xccdf_rule_sshd_permit_root" severity="high">
      <result>pass</result>
    </rule-result>
    <rule-result idref="xccdf_rule_fips_mode" severity="high">
      <result>fail</result>
    </rule-result>
  </TestResult>
</Benchmark>
'''

XCCDF_11_MINIMAL = '''\
<?xml version="1.0" encoding="UTF-8"?>
<Benchmark xmlns="http://checklists.nist.gov/xccdf/1.1" id="xccdf_test_benchmark_11">
  <title>Test Benchmark 1.1</title>
  <Rule id="xccdf_rule_test_11" severity="medium">
    <title>Test Rule 1.1</title>
    <description>A test rule for XCCDF 1.1</description>
  </Rule>
  <TestResult id="xccdf_test_result_11">
    <rule-result idref="xccdf_rule_test_11" severity="medium">
      <result>pass</result>
    </rule-result>
  </TestResult>
</Benchmark>
'''

XCCDF_MULTIPLE_RESULTS = '''\
<?xml version="1.0" encoding="UTF-8"?>
<Benchmark xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_test_benchmark">
  <Rule id="rule_pass" severity="low">
    <title>Pass Rule</title>
  </Rule>
  <Rule id="rule_fail" severity="high">
    <title>Fail Rule</title>
  </Rule>
  <Rule id="rule_error" severity="medium">
    <title>Error Rule</title>
  </Rule>
  <Rule id="rule_na" severity="low">
    <title>N/A Rule</title>
  </Rule>
  <Rule id="rule_fixed" severity="medium">
    <title>Fixed Rule</title>
  </Rule>
  <TestResult id="test_result">
    <rule-result idref="rule_pass" severity="low">
      <result>pass</result>
    </rule-result>
    <rule-result idref="rule_fail" severity="high">
      <result>fail</result>
    </rule-result>
    <rule-result idref="rule_error" severity="medium">
      <result>error</result>
    </rule-result>
    <rule-result idref="rule_na" severity="low">
      <result>notapplicable</result>
    </rule-result>
    <rule-result idref="rule_fixed" severity="medium">
      <result>fixed</result>
    </rule-result>
  </TestResult>
</Benchmark>
'''

XCCDF_EMPTY_TEST_RESULT = '''\
<?xml version="1.0" encoding="UTF-8"?>
<Benchmark xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_empty">
  <TestResult id="test_empty">
  </TestResult>
</Benchmark>
'''

XCCDF_NO_TEST_RESULT = '''\
<?xml version="1.0" encoding="UTF-8"?>
<Benchmark xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_no_results">
  <Rule id="rule_orphan" severity="low">
    <title>Orphan Rule</title>
  </Rule>
</Benchmark>
'''


@pytest.fixture
def tmpdir():
    """Create a temporary directory for test output files."""
    with tempfile.TemporaryDirectory() as d:
        yield d


def write_xccdf_fixture(tmpdir, content, filename='xccdf-results-testhost.xml'):
    """Write XCCDF XML content to a temporary file and return the path."""
    filepath = os.path.join(tmpdir, filename)
    with open(filepath, 'w') as f:
        f.write(content)
    return filepath


class TestParseXCCDF12:
    """Tests for parsing XCCDF 1.2 results."""

    def test_basic_parsing(self, tmpdir):
        """XCCDF 1.2 results are parsed with correct statuses."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_12_MINIMAL)
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 1
        assert result['total_findings'] == 2
        assert result['summary']['pass'] == 1
        assert result['summary']['fail'] == 1

        # Verify output file was written
        with open(output_file) as f:
            report = json.load(f)
        assert report['schema_version'] == '1.0.0'
        assert len(report['findings']) == 2

    def test_severity_mapping(self, tmpdir):
        """XCCDF severity values are mapped to CAT_I/II/III."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_12_MINIMAL)
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        with open(output_file) as f:
            report = json.load(f)

        for finding in report['findings']:
            assert finding['severity'] == 'CAT_I'  # all are severity="high"

    def test_rule_metadata_extracted(self, tmpdir):
        """Rule titles, descriptions, and STIG IDs are extracted."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_12_MINIMAL)
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        with open(output_file) as f:
            report = json.load(f)

        ssh_finding = [f for f in report['findings']
                       if f['rule_id'] == 'xccdf_rule_sshd_permit_root'][0]
        assert ssh_finding['title'] == 'Disable SSH Root Login'
        assert ssh_finding['stig_id'] == 'V-257846'
        assert ssh_finding['fix_text'] == 'Set PermitRootLogin no'


class TestParseXCCDF11:
    """Tests for parsing XCCDF 1.1 results."""

    def test_xccdf_11_parsing(self, tmpdir):
        """XCCDF 1.1 namespace is detected and parsed."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_11_MINIMAL,
                                         'xccdf-results-host11.xml')
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 1
        assert result['total_findings'] == 1
        assert result['summary']['pass'] == 1


class TestStatusMapping:
    """Tests for XCCDF status-to-finding mapping."""

    def test_all_status_mappings(self, tmpdir):
        """All XCCDF result statuses are mapped correctly."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_MULTIPLE_RESULTS)
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['summary']['pass'] == 2      # pass + fixed
        assert result['summary']['fail'] == 1
        assert result['summary']['error'] == 1
        # not_applicable is skipped during parsing (SKIP_STATUSES) to reduce DB bloat
        assert result['summary']['not_applicable'] == 0


class TestHostExtraction:
    """Tests for host extraction from filenames."""

    def test_standard_filename(self):
        """Standard xccdf-results-<host>.xml filename extracts host."""
        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules.normalize_xccdf import (
            extract_host_from_filename,
        )
        assert extract_host_from_filename('/path/to/xccdf-results-webserver01.xml') == 'webserver01'

    def test_nonstandard_filename(self):
        """Non-standard filename returns the basename."""
        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules.normalize_xccdf import (
            extract_host_from_filename,
        )
        result = extract_host_from_filename('/path/to/scan-output.xml')
        assert result == 'scan-output.xml'


class TestMultipleFiles:
    """Tests for processing multiple XCCDF files."""

    def test_multiple_hosts(self, tmpdir):
        """Multiple XCCDF files are aggregated."""
        file1 = write_xccdf_fixture(tmpdir, XCCDF_12_MINIMAL,
                                    'xccdf-results-host1.xml')
        file2 = write_xccdf_fixture(tmpdir, XCCDF_12_MINIMAL,
                                    'xccdf-results-host2.xml')
        output_file = os.path.join(tmpdir, 'combined.json')

        set_module_args({
            'results_files': [file1, file2],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 2
        assert result['total_findings'] == 4  # 2 findings per host


class TestEdgeCases:
    """Tests for edge cases."""

    def test_missing_file_warns(self, tmpdir):
        """Missing input file is warned about, not fatal."""
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': ['/nonexistent/xccdf-results-ghost.xml'],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 0
        assert result['total_findings'] == 0

    def test_invalid_xml_warns(self, tmpdir):
        """Invalid XML file is warned about, not fatal."""
        bad_file = write_xccdf_fixture(tmpdir, '<invalid xml><unclosed',
                                       'xccdf-results-badhost.xml')
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [bad_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 0

    def test_no_test_result_element(self, tmpdir):
        """XCCDF with no TestResult element returns empty findings."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_NO_TEST_RESULT)
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 1
        assert result['total_findings'] == 0

    def test_empty_test_result(self, tmpdir):
        """XCCDF with empty TestResult returns empty findings."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_EMPTY_TEST_RESULT)
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 1
        assert result['total_findings'] == 0

    def test_empty_results_files_list(self, tmpdir):
        """Empty results_files list produces zero findings."""
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 0
        assert result['total_findings'] == 0


class TestCheckMode:
    """Tests for check mode behavior."""

    def test_check_mode_no_file_written(self, tmpdir):
        """Check mode does not write the output file."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_12_MINIMAL)
        output_file = os.path.join(tmpdir, 'should_not_exist.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
            '_ansible_check_mode': True,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['changed'] is False
        assert not os.path.exists(output_file)

    def test_check_mode_still_parses(self, tmpdir):
        """Check mode still parses and counts findings."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_12_MINIMAL)
        output_file = os.path.join(tmpdir, 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
            '_ansible_check_mode': True,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        result = exc.value.args[0]
        assert result['hosts_processed'] == 1
        assert result['total_findings'] == 2


class TestOutputDirectory:
    """Tests for output directory creation."""

    def test_creates_output_directory(self, tmpdir):
        """Output directory is created if it does not exist."""
        xccdf_file = write_xccdf_fixture(tmpdir, XCCDF_12_MINIMAL)
        output_file = os.path.join(tmpdir, 'subdir', 'output.json')

        set_module_args({
            'results_files': [xccdf_file],
            'output_file': output_file,
        })

        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules import normalize_xccdf

        with pytest.raises(AnsibleExitJson) as exc:
            normalize_xccdf.main()

        assert os.path.exists(output_file)


class TestNamespaceDetection:
    """Tests for the find_ns helper function."""

    def test_detect_12(self):
        """XCCDF 1.2 namespace is detected."""
        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules.normalize_xccdf import (
            find_ns,
        )
        import xml.etree.ElementTree as ET
        root = ET.fromstring(XCCDF_12_MINIMAL)
        assert find_ns(root) == 'http://checklists.nist.gov/xccdf/1.2'

    def test_detect_11(self):
        """XCCDF 1.1 namespace is detected."""
        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules.normalize_xccdf import (
            find_ns,
        )
        import xml.etree.ElementTree as ET
        root = ET.fromstring(XCCDF_11_MINIMAL)
        assert find_ns(root) == 'http://checklists.nist.gov/xccdf/1.1'

    def test_no_namespace(self):
        """Missing namespace returns empty string."""
        from ansible_collections.security.compliance_rhel9_cis_l2.plugins.modules.normalize_xccdf import (
            find_ns,
        )
        import xml.etree.ElementTree as ET
        root = ET.fromstring('<Benchmark id="plain"/>')
        assert find_ns(root) == ''
