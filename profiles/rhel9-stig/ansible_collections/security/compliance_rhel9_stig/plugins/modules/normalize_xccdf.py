#!/usr/bin/python
# -*- coding: utf-8 -*-

# GNU General Public License v3.0+

DOCUMENTATION = r'''
---
module: normalize_xccdf
short_description: Normalize OpenSCAP XCCDF results to common compliance findings format
description:
  - Parses XCCDF result XML files produced by OpenSCAP.
  - Transforms each rule-result into the common findings JSON format.
  - Aggregates results across multiple hosts.
  - Output is the scanner-agnostic format consumed by the Backstage plugin.
  - Shared logic lives in module_utils/normalize_common.py.
version_added: "0.1.0"
options:
  results_files:
    description: List of XCCDF result XML file paths to process
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
    version_added: "0.1.0"
  framework:
    description: Compliance framework hint (auto, DISA_STIG, CIS).
    type: str
    required: false
    default: auto
    choices: [auto, DISA_STIG, CIS]
    version_added: "0.1.0"
  certification_status:
    description: Scanner certification level (certified, conformant, uncertified).
    type: str
    required: false
    default: uncertified
    choices: [certified, conformant, uncertified]
    version_added: "0.1.0"
  certification_authority:
    description: Certifying body (e.g. "NIST SCAP 1.2", "CIS").
    type: str
    required: false
    default: ""
    version_added: "0.1.0"
  rules_metadata_file:
    description: Path to rules YAML with aap_impact metadata.
    type: str
    required: false
    default: ""
    version_added: "0.1.0"
author:
  - Ansible Security Team (@ansible)
'''

EXAMPLES = r'''
- name: Normalize XCCDF results
  security.compliance_rhel9_stig.normalize_xccdf:
    results_files:
      - /tmp/scan-results/xccdf-results-webserver01.xml
    output_file: /tmp/compliance-report.json
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
summary:
  description: Aggregate pass/fail/error counts
  returned: always
  type: dict
output_file:
  description: Path to the written output file
  returned: always
  type: str
findings:
  description: Slim findings list for Controller job events
  returned: always
  type: list
'''

from ansible.module_utils.basic import AnsibleModule
from ansible_collections.security.compliance_rhel9_stig.plugins.module_utils.normalize_common import (
    run_normalize,
    ARGUMENT_SPEC,
)


def main():
    module = AnsibleModule(
        argument_spec=ARGUMENT_SPEC,
        supports_check_mode=True,
    )
    run_normalize(module)


if __name__ == '__main__':
    main()
