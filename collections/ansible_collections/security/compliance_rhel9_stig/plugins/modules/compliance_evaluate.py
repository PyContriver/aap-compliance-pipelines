#!/usr/bin/python
# -*- coding: utf-8 -*-

# GNU General Public License v3.0+

DOCUMENTATION = r'''
---
module: compliance_evaluate
short_description: Evaluate gathered facts against STIG/CIS compliance rules centrally
description:
  - Runs on localhost (inside the EE), NOT on target hosts.
  - Receives gathered compliance facts and evaluates them against rules.
  - Rules are defined as data (YAML) in the cartridge collection.
  - Produces structured findings with pass/fail status, severity, and evidence.
  - Scanner-agnostic — evaluation logic is decoupled from fact gathering.
version_added: "0.1.0"
options:
  facts:
    description: Compliance facts gathered by compliance_gather module
    type: dict
    required: true
  rules:
    description: List of compliance rules to evaluate. Each rule has an id, check expression, and metadata.
    type: list
    elements: dict
    required: true
  profile:
    description: Compliance profile name (e.g., stig, cis_l1)
    type: str
    default: stig
  host:
    description: Hostname these facts belong to (for reporting)
    type: str
    required: true
deprecated:
  removed_in: "2.0.0"
  why: Replaced by OpenSCAP-based scanning (run_oscap.yml). See ADR-004.
  alternative: Use the run_oscap.yml playbook with scap-security-guide datastreams.
author:
  - Red Hat Ansible Automation Platform
'''

EXAMPLES = r'''
- name: Evaluate compliance facts against STIG rules
  security.compliance_rhel9_stig.compliance_evaluate:
    facts: "{{ gathered.compliance_facts }}"
    rules: "{{ stig_rules }}"
    host: "{{ inventory_hostname }}"
    profile: stig
  register: evaluation
  delegate_to: localhost

- name: Evaluate with rules loaded from file
  block:
    - name: Load STIG rules
      ansible.builtin.include_vars:
        file: rules/stig_rhel9_v2r8.yml
        name: stig_content

    - name: Run evaluation
      security.compliance_rhel9_stig.compliance_evaluate:
        facts: "{{ gathered.compliance_facts }}"
        rules: "{{ stig_content.rules }}"
        host: webserver01.example.com
      register: evaluation

- name: Display failing findings
  ansible.builtin.debug:
    msg: "FAIL: {{ item.title }} ({{ item.severity }})"
  loop: "{{ evaluation.findings | selectattr('status', 'eq', 'fail') }}"
'''

RETURN = r'''
findings:
  description: List of compliance findings with pass/fail status
  returned: always
  type: list
  elements: dict
summary:
  description: Summary counts of pass, fail, error, not_applicable
  returned: always
  type: dict
host:
  description: Hostname these findings belong to
  returned: always
  type: str
profile:
  description: Compliance profile name used for evaluation
  returned: always
  type: str
'''

import re

from ansible.module_utils.basic import AnsibleModule


def evaluate_rule(rule, facts):
    """Evaluate a single compliance rule against gathered facts.

    Each rule has a 'check' dict that specifies what to evaluate:
      - category: which fact category to look in
      - type: the kind of check (package_installed, service_enabled, sysctl_value,
              file_permissions, ssh_config, file_contains, etc.)
      - params: check-specific parameters

    Returns a finding dict with status, evidence, etc.
    """
    check = rule.get('check', {})
    check_type = check.get('type', '')
    params = check.get('params', {})
    category = check.get('category', '')

    category_facts = facts.get(category)
    if category_facts is None:
        return {
            'status': 'error',
            'evidence': f'Category "{category}" not available in gathered facts',
        }

    try:
        if check_type == 'package_installed':
            pkg_name = params.get('name', '')
            installed = pkg_name in category_facts
            return {
                'status': 'pass' if installed else 'fail',
                'evidence': f'Package {pkg_name}: {"installed" if installed else "not installed"}',
            }

        elif check_type == 'package_not_installed':
            pkg_name = params.get('name', '')
            installed = pkg_name in category_facts
            return {
                'status': 'pass' if not installed else 'fail',
                'evidence': f'Package {pkg_name}: {"not installed" if not installed else "installed (should not be)"}',
            }

        elif check_type == 'service_enabled':
            svc_name = params.get('name', '')
            svc = category_facts.get(svc_name, {})
            enabled = svc.get('state') == 'enabled'
            return {
                'status': 'pass' if enabled else 'fail',
                'evidence': f'Service {svc_name}: {svc.get("state", "not found")}',
            }

        elif check_type == 'service_disabled':
            svc_name = params.get('name', '')
            svc = category_facts.get(svc_name, {})
            state = svc.get('state', 'not found')
            disabled = state in ('disabled', 'masked', 'not found')
            return {
                'status': 'pass' if disabled else 'fail',
                'evidence': f'Service {svc_name}: {state}',
            }

        elif check_type == 'sysctl_value':
            key = params.get('key', '')
            expected = str(params.get('value', ''))
            actual = str(category_facts.get(key, ''))
            match = actual == expected
            return {
                'status': 'pass' if match else 'fail',
                'evidence': f'sysctl {key}: {actual} (expected: {expected})',
            }

        elif check_type == 'ssh_config':
            key = params.get('key', '').lower()
            expected = str(params.get('value', '')).lower()
            actual = str(category_facts.get(key, '')).lower()
            match = actual == expected
            return {
                'status': 'pass' if match else 'fail',
                'evidence': f'sshd_config {key}: {actual} (expected: {expected})',
            }

        elif check_type == 'file_permissions':
            path = params.get('path', '')
            max_mode = params.get('max_mode', '0777')
            file_info = category_facts.get(path, {})
            if not file_info.get('exists'):
                return {
                    'status': 'fail',
                    'evidence': f'File {path}: does not exist',
                }
            actual_mode = file_info.get('mode', '0777')
            actual_int = int(actual_mode, 8)
            max_int = int(max_mode, 8)
            ok = actual_int <= max_int
            return {
                'status': 'pass' if ok else 'fail',
                'evidence': f'File {path}: mode {actual_mode} (max allowed: {max_mode})',
            }

        elif check_type == 'file_contains':
            path = params.get('path', '')
            pattern = params.get('pattern', '')
            file_info = category_facts.get(path, {})
            content = file_info.get('content', '')
            found = bool(re.search(pattern, content)) if content else False
            return {
                'status': 'pass' if found else 'fail',
                'evidence': f'File {path}: pattern "{pattern}" {"found" if found else "not found"}',
            }

        elif check_type == 'file_not_contains':
            path = params.get('path', '')
            pattern = params.get('pattern', '')
            file_info = category_facts.get(path, {})
            content = file_info.get('content', '')
            found = bool(re.search(pattern, content)) if content else False
            return {
                'status': 'pass' if not found else 'fail',
                'evidence': f'File {path}: pattern "{pattern}" {"not found (good)" if not found else "found (should not be)"}',
            }

        elif check_type == 'crypto_policy':
            expected = params.get('policy', 'FIPS')
            actual = category_facts.get('current', 'unknown')
            match = actual.upper() == expected.upper()
            return {
                'status': 'pass' if match else 'fail',
                'evidence': f'Crypto policy: {actual} (expected: {expected})',
            }

        elif check_type == 'selinux_enforcing':
            mode = category_facts.get('mode', 'unknown')
            enforcing = mode.lower() == 'enforcing'
            return {
                'status': 'pass' if enforcing else 'fail',
                'evidence': f'SELinux: {mode}',
            }

        elif check_type == 'grub_password':
            password_set = category_facts.get('password_set', False)
            return {
                'status': 'pass' if password_set else 'fail',
                'evidence': f'GRUB password: {"set" if password_set else "not set"}',
            }

        elif check_type == 'mount_option':
            mountpoint = params.get('mountpoint', '')
            option = params.get('option', '')
            mounts = category_facts if isinstance(category_facts, list) else []
            mount = None
            for m in mounts:
                if m.get('mountpoint') == mountpoint or m.get('target') == mountpoint:
                    mount = m
                    break
            if not mount:
                return {
                    'status': 'fail',
                    'evidence': f'Mount {mountpoint}: not found as separate mount',
                }
            options = mount.get('options', [])
            if isinstance(options, str):
                options = options.split(',')
            has_option = option in options
            return {
                'status': 'pass' if has_option else 'fail',
                'evidence': f'Mount {mountpoint}: option "{option}" {"present" if has_option else "missing"}',
            }

        elif check_type == 'audit_rule_exists':
            pattern = params.get('pattern', '')
            rules_list = category_facts if isinstance(category_facts, list) else []
            found = any(re.search(pattern, r) for r in rules_list)
            return {
                'status': 'pass' if found else 'fail',
                'evidence': f'Audit rule matching "{pattern}": {"found" if found else "not found"}',
            }

        elif check_type == 'no_empty_passwords':
            users = category_facts if isinstance(category_facts, list) else []
            pam_content = ''
            files_facts = facts.get('files', {})
            for pam_file in ['/etc/pam.d/system-auth', '/etc/pam.d/password-auth']:
                file_info = files_facts.get(pam_file, {})
                pam_content += file_info.get('content', '')
            has_nullok = 'nullok' in pam_content
            return {
                'status': 'pass' if not has_nullok else 'fail',
                'evidence': f'PAM nullok: {"not found (good)" if not has_nullok else "found in PAM config (allows empty passwords)"}',
            }

        else:
            return {
                'status': 'error',
                'evidence': f'Unknown check type: {check_type}',
            }

    except Exception as e:
        return {
            'status': 'error',
            'evidence': f'Evaluation error: {str(e)}',
        }


def main():
    module = AnsibleModule(
        argument_spec=dict(
            facts=dict(type='dict', required=True),
            rules=dict(type='list', elements='dict', required=True),
            profile=dict(type='str', default='stig'),
            host=dict(type='str', required=True),
        ),
        supports_check_mode=True,
    )

    facts = module.params['facts']
    rules = module.params['rules']
    profile = module.params['profile']
    host = module.params['host']

    findings = []
    summary = {'total': 0, 'pass': 0, 'fail': 0, 'error': 0, 'not_applicable': 0}

    for rule in rules:
        result = evaluate_rule(rule, facts)
        status = result['status']

        finding = {
            'rule_id': rule.get('id', 'unknown'),
            'stig_id': rule.get('stig_id', ''),
            'title': rule.get('title', ''),
            'severity': rule.get('severity', 'medium'),
            'category': rule.get('category', ''),
            'status': status,
            'evidence': result['evidence'],
            'host': host,
            'profile': profile,
            'fix_text': rule.get('fix_text', ''),
            'check_text': rule.get('check_text', ''),
            'disruption': rule.get('disruption', 'low'),
            'parameters': rule.get('parameters', []),
        }
        findings.append(finding)

        summary['total'] += 1
        if status in summary:
            summary[status] += 1

    module.exit_json(
        changed=False,
        findings=findings,
        summary=summary,
        host=host,
        profile=profile,
    )


if __name__ == '__main__':
    main()
