# DISA STIG RHEL 9 Compliance Profile

## Overview

The `security.compliance_rhel9_stig` collection provides agentless compliance
scanning and remediation for RHEL 9 hosts against the DISA STIG V2R8 benchmark.

| Attribute | Value |
|-----------|-------|
| Framework | DISA STIG V2R8 |
| Platform | Red Hat Enterprise Linux 9 |
| Scanner | OpenSCAP (`oscap xccdf eval`) |
| Profile ID | `xccdf_org.ssgproject.content_profile_stig` |
| Rule count | 366 |
| Datastream | `ssg-rhel9-ds.xml` |
| Remediation source | ComplianceAsCode (CaC) via `scap-security-guide` |

## How It Works

The collection uses a two-phase pipeline:

1. **Assessment** -- A single job template runs `run_oscap.yml`, which contains
   two plays. Play 1 runs OpenSCAP on target hosts, fetches XCCDF results back
   to the execution node, and cleans up. Play 2 normalizes the fetched XML into
   Common Findings Format (CFF) JSON on localhost.

2. **Remediation** -- A separate job template runs `remediate.yml`, which imports
   the CaC playbook from `scap-security-guide`. Remediation is scoped to
   selected rules via native AAP `job_tags`.

Assessment never modifies target hosts. Remediation is always a deliberate,
user-initiated action.

## Execution Environment

The collection requires an Execution Environment (EE) built with
`scap-security-guide` and `openscap-scanner`. The EE provides:

- `/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml` -- SCAP datastream
  (copied to targets at scan time, removed afterward)
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml` -- CaC
  remediation playbook with per-rule Ansible tags

Build the EE using the definition at `meta/execution-environment.yml`:

```bash
ansible-builder build -f meta/execution-environment.yml \
  -t compliance-stig-rhel9:latest -v3
```

## Content Lifecycle

DISA publishes quarterly STIG updates. Red Hat packages updated content in the
`scap-security-guide` RPM. Rebuilding the EE picks up new rules and remediation
content automatically. No plugin redeploy or collection update is needed.

## Collection Dependencies

- `ansible.posix` >= 1.5.0
- `redhat.rhel_system_roles` >= 1.0.0

## Included Content

### Playbooks

| Playbook | Purpose |
|----------|---------|
| `playbooks/run_oscap.yml` | Run OpenSCAP STIG scan and normalize results (assessment) |
| `playbooks/normalize.yml` | Standalone XCCDF normalization utility |
| `playbooks/remediate.yml` | Apply CaC STIG remediation via `job_tags` |

### Modules

| Module | Purpose |
|--------|---------|
| `normalize_xccdf` | Parse XCCDF XML and produce CFF JSON findings |

## Links

- [Scanning Guide](scanning.md)
- [Remediation Guide](remediation.md)
- [Architecture](architecture.md)
- [Module Reference](module-reference.md)
- [Playbook Reference](playbook-reference.md)
