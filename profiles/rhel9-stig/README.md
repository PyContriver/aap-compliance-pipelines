# DISA STIG RHEL 9 Compliance Profile

Self-contained compliance profile for DISA STIG V2R8 on Red Hat Enterprise Linux 9.

## Contents

| Directory | Purpose |
|-----------|---------|
| `ansible_collections/security/compliance_rhel9_stig/` | Ansible collection `security.compliance_rhel9_stig` |
| `ee/` | Execution Environment definition (ansible-builder v3) |
| `install.yml` | Controller registration playbook |

## Quick Start

### 1. Build the Execution Environment

```bash
cd ee/
ansible-builder build -f execution-environment.yml -t compliance-stig-rhel9:latest -v3
```

### 2. Register on Controller

```bash
ansible-playbook install.yml \
  -e aap_host=https://controller.example.com \
  -e aap_token=<your-token>
```

### 3. Register in Compliance Plugin

In the Backstage compliance plugin Settings tab, create a new profile:
- **Framework:** DISA STIG
- **Version:** V2R8
- **Platform:** RHEL 9
- **Assessment JT:** compliance-scan-stig-rhel9
- **Remediation JT:** compliance-remediate-stig-rhel9

## Scanner Details

- **Scanner:** OpenSCAP (`oscap xccdf eval`)
- **Datastream:** `ssg-rhel9-ds.xml` from scap-security-guide
- **Profile ID:** `xccdf_org.ssgproject.content_profile_stig`
- **Rule Count:** 366
- **Remediation:** ComplianceAsCode playbook from scap-security-guide
- **Certification:** Certified (NIST SCAP 1.2)

## Collection Structure

```
ansible_collections/security/compliance_rhel9_stig/
  plugins/modules/normalize_xccdf.py   # XCCDF -> CFF normalizer
  playbooks/run_oscap.yml              # Assessment (scan + normalize + POST)
  playbooks/remediate.yml              # CaC remediation (tag-scoped)
  playbooks/normalize.yml              # Standalone normalize utility
  meta/execution-environment.yml       # EE definition (also used by collection)
  meta/compliance-profile.yml          # Profile identity and certification metadata
```
