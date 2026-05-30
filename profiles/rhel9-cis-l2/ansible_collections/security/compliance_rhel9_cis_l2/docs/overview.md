# CIS Benchmark Level 2 - Server: RHEL 9 Compliance Profile

## Overview

The `security.compliance_rhel9_cis_l2` collection provides agentless compliance
scanning and remediation for RHEL 9 hosts against the CIS Benchmark v1.0.0,
Level 2 - Server profile.

| Attribute | Value |
|-----------|-------|
| Framework | CIS Benchmark v1.0.0, Level 2 - Server |
| Platform | Red Hat Enterprise Linux 9 |
| Scanner | OpenSCAP (`oscap xccdf eval`) |
| Profile ID | `xccdf_org.ssgproject.content_profile_cis` |
| Datastream | `ssg-rhel9-ds.xml` |
| Rule count | ~262 (includes all L1 rules plus additional hardening; varies by `scap-security-guide` version) |
| Remediation source | ComplianceAsCode (CaC) via `scap-security-guide` |

## CIS Level 2 vs Level 1

CIS Level 2 extends Level 1 with additional security controls intended for
environments where security is paramount. Level 2 controls may reduce system
functionality or performance and are best suited for high-security environments.

All Level 1 controls are included in Level 2. For baseline hardening that
minimizes operational impact, see the `security.compliance_rhel9_cis_l1`
collection (Level 1 - Server).

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
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-cis.yml` -- CaC
  remediation playbook with per-rule Ansible tags

Build the EE using the definition at `meta/execution-environment.yml`:

```bash
ansible-builder build -f meta/execution-environment.yml \
  -t compliance-cis-l2-rhel9:latest -v3
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
| `playbooks/run_oscap.yml` | Run OpenSCAP CIS L2 scan and normalize results (assessment) |
| `playbooks/normalize.yml` | Standalone XCCDF normalization utility |
| `playbooks/remediate.yml` | Apply CaC CIS L2 remediation via `job_tags` |

### Modules

| Module | Purpose |
|--------|---------|
| `normalize_xccdf` | Parse XCCDF XML and produce CFF JSON findings |

## Links

- [Scanning Guide](scanning.md)
- [Remediation Guide](remediation.md)
