# Ansible Collection: security.compliance_rhel9_stig

DISA STIG V2R8 compliance profile for RHEL 9.

OpenSCAP-based scanning with 366 STIG rules, centralized normalization to Common Findings Format (CFF), and selective remediation using ComplianceAsCode (CaC) playbooks.

## Architecture

The collection uses a 2-node assessment workflow that separates scanning from normalization:

```
Target hosts (RHEL 9)              Execution node (EE)
+--------------------------+       +---------------------------+
| 1. Install oscap         |       |                           |
|    (if missing)          |       |                           |
| 2. Receive datastream    |<-copy-| scap-security-guide       |
|    (ssg-rhel9-ds.xml)    |       | (ssg-rhel9-ds.xml, ~15MB) |
| 3. oscap xccdf eval      |       |                           |
|    --profile stig        |       |                           |
| 4. Return XCCDF XML     |-fetch->| 5. normalize_xccdf        |
| 5. Cleanup               |       |    (XML -> CFF JSON)      |
| 6. Remove oscap          |       | 6. compliance_report.json |
|    (if we installed it)  |       |                           |
+--------------------------+       +---------------------------+
```

**Node 1** (`run_oscap.yml`): Runs on target hosts via SSH. Installs `openscap-scanner` ephemerally if not present, copies the SCAP datastream from the EE, runs `oscap xccdf eval`, fetches results back, and cleans up.

**Node 2** (`normalize.yml`): Runs on the execution node (localhost). Parses XCCDF result XML, extracts all rule metadata (title, description, fix_text, severity, stig_id) directly from the datastream, strips XCCDF prefixes so rule IDs match CaC remediation tags, and outputs CFF JSON.

**Remediation** (`remediate.yml`): Launched as a separate job template (not part of the workflow). Imports the CaC playbook from `scap-security-guide` and uses AAP `job_tags` for selective rule execution.

## Requirements

- Ansible >= 2.15.0
- RHEL 9 target hosts (SSH access with become)
- Execution Environment with `scap-security-guide` and `openscap-scanner` installed
- `openscap-scanner` on targets is installed at runtime if missing (and removed after scan)

## Dependencies

- `ansible.posix` >= 1.5.0
- `redhat.rhel_system_roles` >= 1.0.0

## Installation

```bash
ansible-galaxy collection install security.compliance_rhel9_stig
```

## Quick Start

### 1. Run OpenSCAP scan on targets

```yaml
ansible-playbook security.compliance_rhel9_stig.run_oscap -i inventory
```

### 2. Normalize results to CFF JSON

```yaml
ansible-playbook security.compliance_rhel9_stig.normalize
```

### 3. Remediate selected findings

```yaml
ansible-playbook security.compliance_rhel9_stig.remediate -i inventory \
    --tags "sshd_set_keepalive_0,accounts_tmout" \
    -e '{"var_accounts_tmout": 900}'
```

### In AAP Controller

The 2-node workflow is configured as:

1. **JT `compliance-run-oscap`** -- runs `run_oscap.yml` on targets with SSH creds + become
2. **JT `compliance-normalize`** -- runs `normalize.yml` on execution node (localhost)

Remediation is launched as a standalone JT with `ask_tags_on_launch: true` and `ask_variables_on_launch: true`. The Backstage plugin passes selected rule IDs as `job_tags`.

## Playbooks

| Playbook | Runs On | Description |
|----------|---------|-------------|
| `run_oscap.yml` | Target hosts | Install oscap, copy datastream, scan, fetch results, cleanup |
| `normalize.yml` | Execution node | Parse XCCDF XML, produce CFF JSON, set `compliance_report` fact |
| `remediate.yml` | Target hosts | Import CaC STIG playbook, scoped by `job_tags` |

## Modules

| Module | Status | Description |
|--------|--------|-------------|
| `normalize_xccdf` | **Active** | Normalize OpenSCAP XCCDF results to CFF JSON (366 rules) |
| `compliance_gather` | Deprecated | Agentless fact collection (replaced by `run_oscap.yml`) |
| `compliance_evaluate` | Deprecated | Rule evaluation against 20 hand-written checks (replaced by `oscap xccdf eval`) |

## Execution Environment

The compliance EE must include `scap-security-guide` (provides the XCCDF datastream and CaC remediation playbooks) and `openscap-scanner` (for the `oscap` CLI). These are system-level RPM dependencies.

Key EE contents:

| Path | Purpose |
|------|---------|
| `/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml` | SCAP datastream (copied to targets at scan time) |
| `/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml` | CaC remediation playbook (imported by `remediate.yml`) |

Build the EE:

```bash
cd ee/
ansible-builder build -f execution-environment.yml -t compliance-stig-rhel9:latest -v3
```

## How Rule ID Matching Works

OpenSCAP rule IDs use the XCCDF prefix format:

```
xccdf_org.ssgproject.content_rule_sshd_set_keepalive_0
```

The `normalize_xccdf` module strips this prefix to produce the short rule ID:

```
sshd_set_keepalive_0
```

This short ID matches the CaC remediation tag exactly, so when the Backstage plugin passes `job_tags=sshd_set_keepalive_0` to the remediation JT, the correct CaC tasks execute. No mapping file is needed.

## License

GPL-3.0-or-later

## Author

Red Hat Ansible Automation Platform
