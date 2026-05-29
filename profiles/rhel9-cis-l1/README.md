# CIS Benchmark RHEL 9 Level 1 - Server Compliance Profile

Self-contained compliance profile for CIS Benchmark Level 1 - Server on Red Hat Enterprise Linux 9.

## Contents

| Directory | Purpose |
|-----------|---------|
| `ansible_collections/security/compliance_rhel9_cis_l1/` | Ansible collection `security.compliance_rhel9_cis_l1` |
| `ee/` | Execution Environment definition (ansible-builder v3) |
| `install.yml` | Controller registration playbook |

## Quick Start

### 1. Build the Execution Environment

```bash
cd ee/
ansible-builder build -f execution-environment.yml -t compliance-cis-l1-rhel9:latest -v3
```

### 2. Register on Controller

```bash
ansible-playbook install.yml \
  -e aap_host=https://controller.example.com \
  -e aap_token=<your-token>
```

### 3. Register in Compliance Plugin

In the Backstage compliance plugin Settings tab, create a new profile:
- **Framework:** CIS Benchmark
- **Version:** v1.0.0
- **Platform:** RHEL 9
- **Assessment JT:** compliance-scan-cis-l1-rhel9
- **Remediation JT:** compliance-remediate-cis-l1-rhel9

## Scanner Details

- **Scanner:** OpenSCAP (`oscap xccdf eval`)
- **Datastream:** `ssg-rhel9-ds.xml` from scap-security-guide
- **Profile ID:** `xccdf_org.ssgproject.content_profile_cis_server_l1`
- **Level:** 1 - Server
- **Remediation:** ComplianceAsCode playbook from scap-security-guide
- **Certification:** Conformant (CIS-CAT Pro is the CIS-certified scanner)

## Collection Structure

```
ansible_collections/security/compliance_rhel9_cis_l1/
  plugins/modules/normalize_xccdf.py   # XCCDF -> CFF normalizer
  playbooks/run_oscap.yml              # Assessment (scan + normalize + POST)
  playbooks/remediate.yml              # CaC remediation (tag-scoped)
  playbooks/normalize.yml              # Standalone normalize utility
  meta/execution-environment.yml       # EE definition (also used by collection)
  meta/compliance-profile.yml          # Profile identity and certification metadata
```
