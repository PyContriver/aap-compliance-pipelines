# Remediation Guide: CIS Benchmark Level 1 - Server (RHEL 9)

## Overview

Remediation uses the ComplianceAsCode (CaC) playbook shipped with
`scap-security-guide` inside the Execution Environment. The playbook
contains per-rule tagged tasks for all CIS Level 1 rules.

The remediation playbook is:

```
/usr/share/scap-security-guide/ansible/rhel9-playbook-cis_server_l1.yml
```

## Running Remediation

### Via Automation Controller

The compliance plugin backend launches remediation as a direct job template
(not as part of a workflow). The job template must have:

- `ask_tags_on_launch: true` -- The plugin passes selected rule IDs as `job_tags`
- `ask_variables_on_launch: true` -- For CaC parameter overrides
- `ask_inventory_on_launch: true` -- To scope remediation to specific hosts

```
Job Template: compliance-remediate-cis-l1
  Playbook: playbooks/remediate.yml
  EE: compliance-cis-l1-rhel9
  Tags: (prompt on launch)
  Extra Variables: (prompt on launch)
  Inventory: (prompt on launch)
```

### Via CLI

```bash
# Remediate all CIS L1 rules
ansible-playbook security.compliance_rhel9_cis_l1.remediate \
  -i inventory.yml --become

# Remediate specific rules using tags
ansible-playbook security.compliance_rhel9_cis_l1.remediate \
  -i inventory.yml --become \
  --tags sshd_set_keepalive_0,firewalld_loopback_traffic_restricted

# Remediate with parameter overrides
ansible-playbook security.compliance_rhel9_cis_l1.remediate \
  -i inventory.yml --become \
  --tags accounts_tmout \
  -e var_accounts_tmout=900
```

## Scoping Remediation with job_tags

Each CaC task in the remediation playbook is tagged with the rule ID (the short
form without the XCCDF prefix). The `normalize_xccdf` module strips the
`xccdf_org.ssgproject.content_rule_` prefix from rule IDs so they match
the CaC tags exactly.

For example:

| XCCDF rule ID | CaC tag | job_tags value |
|---------------|---------|----------------|
| `xccdf_org.ssgproject.content_rule_sshd_set_keepalive_0` | `sshd_set_keepalive_0` | `sshd_set_keepalive_0` |

Pass one or more tags as a comma-separated list:

```
job_tags: "sshd_set_keepalive_0,firewalld_loopback_traffic_restricted"
```

## Parameter Overrides

Many CaC rules accept variables to customize thresholds and values. These are
passed as extra vars through the job template's `ask_variables_on_launch`
setting.

Common CIS parameter overrides:

| Variable | Default | Description |
|----------|---------|-------------|
| `var_accounts_tmout` | 600 | Shell timeout in seconds |
| `var_password_pam_minlen` | 14 | Minimum password length |
| `var_password_pam_retry` | 3 | Password retry attempts |
| `var_accounts_maximum_age_login_defs` | 365 | Maximum password age in days |
| `var_accounts_minimum_age_login_defs` | 1 | Minimum password age in days |
| `var_authselect_profile` | sssd | Authselect profile to use |

These variables are defined in the CaC playbook. Refer to the
`scap-security-guide` documentation for the full list.

## Content Lifecycle

The CaC remediation playbook is maintained by Red Hat as part of the
`scap-security-guide` RPM. When CIS publishes benchmark updates:

1. Red Hat updates the `scap-security-guide` RPM
2. Rebuild the EE to pick up new remediation content
3. New rules and updated fix tasks are available immediately

No collection update or plugin redeploy is needed.

## Assessment and Remediation Separation

Assessment and remediation are intentionally separate:

- **Assessment** (`run_oscap.yml`) is read-only. It never modifies targets.
- **Remediation** (`remediate.yml`) is a standalone job template launched
  directly by the user or the compliance plugin.

## Verifying Remediation

After remediation, re-run the assessment to verify that remediated rules now pass:

```bash
ansible-playbook security.compliance_rhel9_cis_l1.run_oscap \
  -i inventory.yml --become
```

Compare the before and after findings to confirm that targeted rules changed
from `fail` to `pass`.
