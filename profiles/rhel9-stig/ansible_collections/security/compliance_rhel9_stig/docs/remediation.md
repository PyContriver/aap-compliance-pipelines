# Remediation Guide: DISA STIG RHEL 9

## Overview

Remediation uses the ComplianceAsCode (CaC) playbook shipped with
`scap-security-guide` inside the Execution Environment. The playbook
contains per-rule tagged tasks for all 366 STIG rules.

The remediation playbook is:

```
/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml
```

## Running Remediation

### Via Automation Controller

The compliance plugin backend launches remediation as a direct job template
(not as part of a workflow). The job template must have:

- `ask_tags_on_launch: true` -- The plugin passes selected rule IDs as `job_tags`
- `ask_variables_on_launch: true` -- For CaC parameter overrides
- `ask_inventory_on_launch: true` -- To scope remediation to specific hosts

```
Job Template: compliance-remediate
  Playbook: playbooks/remediate.yml
  EE: compliance-stig-rhel9
  Tags: (prompt on launch)
  Extra Variables: (prompt on launch)
  Inventory: (prompt on launch)
```

### Via CLI

```bash
# Remediate all STIG rules
ansible-playbook security.compliance_rhel9_stig.remediate \
  -i inventory.yml --become

# Remediate specific rules using tags
ansible-playbook security.compliance_rhel9_stig.remediate \
  -i inventory.yml --become \
  --tags sshd_set_keepalive_0,sshd_disable_root_login

# Remediate with parameter overrides
ansible-playbook security.compliance_rhel9_stig.remediate \
  -i inventory.yml --become \
  --tags accounts_tmout \
  -e var_accounts_tmout=900
```

## Scoping Remediation with job_tags

Each CaC task in the remediation playbook is tagged with the rule ID (the short
form without the XCCDF prefix). The `normalize_xccdf` module strips the
`xccdf_org.ssgproject.content_rule_` prefix from rule IDs so they match
the CaC tags exactly.

For example, to remediate just the SSH keepalive rule:

| XCCDF rule ID | CaC tag | job_tags value |
|---------------|---------|----------------|
| `xccdf_org.ssgproject.content_rule_sshd_set_keepalive_0` | `sshd_set_keepalive_0` | `sshd_set_keepalive_0` |

Pass one or more tags as a comma-separated list:

```
job_tags: "sshd_set_keepalive_0,sshd_disable_root_login,accounts_tmout"
```

## Parameter Overrides

Many CaC rules accept variables to customize thresholds and values. These are
passed as extra vars through the job template's `ask_variables_on_launch`
setting.

Common STIG parameter overrides:

| Variable | Default | Description |
|----------|---------|-------------|
| `var_accounts_tmout` | 600 | Shell timeout in seconds |
| `var_password_pam_minlen` | 15 | Minimum password length |
| `var_password_pam_ocredit` | -1 | Minimum special characters |
| `var_password_pam_dcredit` | -1 | Minimum digit characters |
| `var_password_pam_ucredit` | -1 | Minimum uppercase characters |
| `var_password_pam_lcredit` | -1 | Minimum lowercase characters |
| `var_sshd_set_keepalive` | 0 | SSH client alive count max |
| `var_accounts_maximum_age_login_defs` | 60 | Maximum password age in days |

These variables are defined in the CaC playbook. Refer to the
`scap-security-guide` documentation for the full list.

## Content Lifecycle

The CaC remediation playbook is maintained by Red Hat as part of the
`scap-security-guide` RPM. When DISA publishes quarterly STIG updates:

1. Red Hat updates the `scap-security-guide` RPM
2. Rebuild the EE to pick up new remediation content
3. New rules and updated fix tasks are available immediately

No collection update or plugin redeploy is needed.

## Assessment and Remediation Separation

Assessment and remediation are intentionally separate:

- **Assessment** (`run_oscap.yml`) is read-only. It never modifies targets.
- **Remediation** (`remediate.yml`) is a standalone job template launched
  directly by the user or the compliance plugin.

The gap between assessment and remediation is where intelligence lives:

- **Human-supervised**: Operator reviews findings, selects rules, launches remediation
- **EDA-automated**: Rulebook evaluates findings, conditionally triggers remediation
- **Future autonomous**: AI agent decides remediation scope

## Verifying Remediation

After remediation, re-run the assessment to verify that remediated rules now pass:

```bash
ansible-playbook security.compliance_rhel9_stig.run_oscap \
  -i inventory.yml --become
```

Compare the before and after findings to confirm that targeted rules changed
from `fail` to `pass`.
