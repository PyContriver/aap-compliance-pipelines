# CIS Benchmark Level 1 - Server: RHEL 9 Compliance Profile

## Overview

The `security.compliance_rhel9_cis_l1` collection provides agentless compliance
scanning and remediation for RHEL 9 hosts against the CIS Benchmark v1.0.0,
Level 1 - Server profile.

| Attribute | Value |
|-----------|-------|
| Framework | CIS Benchmark v1.0.0, Level 1 - Server |
| Platform | Red Hat Enterprise Linux 9 |
| Scanner | OpenSCAP (`oscap xccdf eval`) |
| Profile ID | `xccdf_org.ssgproject.content_profile_cis_server_l1` |
| Datastream | `ssg-rhel9-ds.xml` |
| Rule count | ~195 (varies by `scap-security-guide` version) |
| Remediation source | ComplianceAsCode (CaC) via `scap-security-guide` |

## CIS Level 1 vs Level 2

CIS Level 1 provides a baseline security configuration that is practical for
most environments. It focuses on essential security hardening that should not
significantly impact system usability or performance.

For environments requiring stronger security controls, see the
`security.compliance_rhel9_cis_l2` collection (Level 2 - Server), which
includes all Level 1 controls plus additional hardening that may affect
system functionality.

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
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-cis_server_l1.yml` --
  CaC remediation playbook with per-rule Ansible tags

Build the EE using the definition at `meta/execution-environment.yml`:

```bash
ansible-builder build -f meta/execution-environment.yml \
  -t compliance-cis-l1-rhel9:latest -v3
```

## Content Lifecycle

CIS publishes benchmark updates periodically. Red Hat packages updated content
in the `scap-security-guide` RPM. Rebuilding the EE picks up new rules and
remediation content automatically. No plugin redeploy or collection update is
needed.

## Collection Dependencies

- `ansible.posix` >= 1.5.0
- `redhat.rhel_system_roles` >= 1.0.0

## Included Content

### Playbooks

| Playbook | Purpose |
|----------|---------|
| `playbooks/run_oscap.yml` | Run OpenSCAP CIS L1 scan and normalize results (assessment) |
| `playbooks/normalize.yml` | Standalone XCCDF normalization utility |
| `playbooks/remediate.yml` | Apply CaC CIS L1 remediation via `job_tags` |

### Modules

| Module | Purpose |
|--------|---------|
| `normalize_xccdf` | Parse XCCDF XML and produce CFF JSON findings |

## Links

- [Scanning Guide](scanning.md)
- [Remediation Guide](remediation.md)
