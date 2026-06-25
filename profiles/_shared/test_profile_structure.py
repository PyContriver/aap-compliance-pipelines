"""
Validate that all compliance profile collections ship the required artifacts.

Runs across every profile directory under profiles/ (excluding _shared).
Ensures consistency: display config, install/uninstall, backstage/ dir, etc.
"""

import os
import glob
import pytest
import yaml


PROFILES_DIR = os.path.join(os.path.dirname(__file__), '..')
PROFILE_DIRS = [
    d for d in sorted(glob.glob(os.path.join(PROFILES_DIR, '*')))
    if os.path.isdir(d) and not os.path.basename(d).startswith('_')
]

REQUIRED_TOP_LEVEL = ['install.yml', 'uninstall.yml', 'backstage']
REQUIRED_DISPLAY_KEYS = ['gauge_label', 'gauge_unit', 'columns', 'severity_map', 'remediation_verb']


def _find_compliance_profile_yml(profile_dir):
    """Find the compliance-profile.yml in a profile's collection meta/."""
    pattern = os.path.join(profile_dir, 'ansible_collections', '*', '*', 'meta', 'compliance-profile.yml')
    matches = glob.glob(pattern)
    return matches[0] if matches else None


def _load_profile_yml(path):
    with open(path, 'r') as f:
        return yaml.safe_load(f)


class TestProfileDirectoryStructure:
    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_install_yml_exists(self, profile_dir):
        assert os.path.exists(os.path.join(profile_dir, 'install.yml')), \
            f"{os.path.basename(profile_dir)} missing install.yml"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_uninstall_yml_exists(self, profile_dir):
        assert os.path.exists(os.path.join(profile_dir, 'uninstall.yml')), \
            f"{os.path.basename(profile_dir)} missing uninstall.yml"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_backstage_dir_exists(self, profile_dir):
        assert os.path.isdir(os.path.join(profile_dir, 'backstage')), \
            f"{os.path.basename(profile_dir)} missing backstage/ directory"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_ee_dir_exists(self, profile_dir):
        assert os.path.isdir(os.path.join(profile_dir, 'ee')), \
            f"{os.path.basename(profile_dir)} missing ee/ directory"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_collection_dir_exists(self, profile_dir):
        assert os.path.isdir(os.path.join(profile_dir, 'ansible_collections')), \
            f"{os.path.basename(profile_dir)} missing ansible_collections/ directory"


class TestComplianceProfileYml:
    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_compliance_profile_yml_exists(self, profile_dir):
        path = _find_compliance_profile_yml(profile_dir)
        assert path is not None, \
            f"{os.path.basename(profile_dir)} missing meta/compliance-profile.yml"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_required_profile_fields(self, profile_dir):
        path = _find_compliance_profile_yml(profile_dir)
        if path is None:
            pytest.skip('No compliance-profile.yml')
        data = _load_profile_yml(path)
        profile = data.get('profile', {})
        for field in ['name', 'framework', 'version', 'platform', 'scanner']:
            assert field in profile, \
                f"{os.path.basename(profile_dir)} compliance-profile.yml missing '{field}'"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_display_config_present(self, profile_dir):
        path = _find_compliance_profile_yml(profile_dir)
        if path is None:
            pytest.skip('No compliance-profile.yml')
        data = _load_profile_yml(path)
        profile = data.get('profile', {})
        assert 'display' in profile, \
            f"{os.path.basename(profile_dir)} compliance-profile.yml missing 'display' block"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_display_config_keys(self, profile_dir):
        path = _find_compliance_profile_yml(profile_dir)
        if path is None:
            pytest.skip('No compliance-profile.yml')
        data = _load_profile_yml(path)
        display = data.get('profile', {}).get('display', {})
        if not display:
            pytest.skip('No display config')
        for key in REQUIRED_DISPLAY_KEYS:
            assert key in display, \
                f"{os.path.basename(profile_dir)} display config missing '{key}'"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_columns_have_field_and_label(self, profile_dir):
        path = _find_compliance_profile_yml(profile_dir)
        if path is None:
            pytest.skip('No compliance-profile.yml')
        data = _load_profile_yml(path)
        columns = data.get('profile', {}).get('display', {}).get('columns', [])
        if not columns:
            pytest.skip('No columns defined')
        for col in columns:
            assert 'field' in col, f"Column missing 'field': {col}"
            assert 'label' in col, f"Column missing 'label': {col}"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_certification_block_present(self, profile_dir):
        path = _find_compliance_profile_yml(profile_dir)
        if path is None:
            pytest.skip('No compliance-profile.yml')
        data = _load_profile_yml(path)
        profile = data.get('profile', {})
        assert 'certification' in profile, \
            f"{os.path.basename(profile_dir)} compliance-profile.yml missing 'certification' block"


class TestUninstallPlaybook:
    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_uninstall_has_disconnect_task(self, profile_dir):
        path = os.path.join(profile_dir, 'uninstall.yml')
        if not os.path.exists(path):
            pytest.skip('No uninstall.yml')
        with open(path, 'r') as f:
            content = f.read()
        assert 'disconnect' in content.lower(), \
            f"{os.path.basename(profile_dir)} uninstall.yml should use disconnect semantics"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_uninstall_preserves_history(self, profile_dir):
        path = os.path.join(profile_dir, 'uninstall.yml')
        if not os.path.exists(path):
            pytest.skip('No uninstall.yml')
        with open(path, 'r') as f:
            content = f.read()
        assert 'PRESERVED' in content or 'preserved' in content, \
            f"{os.path.basename(profile_dir)} uninstall.yml should state that history is preserved"


class TestEEDefinition:
    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_ee_yml_exists(self, profile_dir):
        ee_file = os.path.join(profile_dir, 'ee', 'execution-environment.yml')
        assert os.path.exists(ee_file), \
            f"{os.path.basename(profile_dir)} missing ee/execution-environment.yml"

    @pytest.mark.parametrize('profile_dir', PROFILE_DIRS, ids=[os.path.basename(d) for d in PROFILE_DIRS])
    def test_ee_has_base_image(self, profile_dir):
        ee_file = os.path.join(profile_dir, 'ee', 'execution-environment.yml')
        if not os.path.exists(ee_file):
            pytest.skip('No EE file')
        with open(ee_file, 'r') as f:
            data = yaml.safe_load(f)
        assert 'images' in data, f"{os.path.basename(profile_dir)} EE missing 'images' block"
        assert 'base_image' in data['images'], f"{os.path.basename(profile_dir)} EE missing 'base_image'"
