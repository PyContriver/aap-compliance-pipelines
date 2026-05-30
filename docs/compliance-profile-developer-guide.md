# How to Build a Compliance Profile

A practical, checklist-style guide for contributors who want to create a new compliance profile collection -- for a new platform (Windows, network devices), a new compliance framework (PCI-DSS, CIS Benchmark), or a new scanner integration (Qualys, Tenable).

---

## 1. What Is a Compliance Profile?

A compliance profile is an Ansible collection that packages everything needed for a specific compliance standard + scanner combination. It follows the `security.compliance_<platform>_<framework>` naming convention and provides the complete pipeline: fact gathering, scanning, normalization, remediation, and reporting.

**Key concept: The compliance profile is a scanner orchestrator, not a scanner.** Our value is the UX, orchestration, and remediation builder. The portal plugin never knows which scanner produced the findings -- it consumes a Common Findings Format (CFF) JSON document regardless of the underlying scanner.

### Three Tiers

| Tier | Model | What We Ship | What the Customer Provides |
|------|-------|-------------|---------------------------|
| **Tier 1: Fully Shippable** | We own the scanner | Scanner, content, normalizer, remediation, pipeline, EE | Nothing (optional: credentials for air-gap repos) |
| **Tier 2: BYOS** | Customer provides the scanner | Adapter (API connector), normalizer, remediation, pipeline | Scanner deployment, credentials, licenses |
| **Tier 3: Hybrid** | One scanner, many platforms | Multi-domain adapters + per-platform normalizers | Same as Tier 2, plus multi-domain scanner config |

**Tier 1 examples:** OpenSCAP (RHEL/Linux), PowerSTIG (Windows), network CLI evaluation (Cisco IOS, NX-OS, Junos).

**Tier 2 examples:** Qualys Policy Compliance, Tenable/Nessus, Red Hat Insights Compliance, Rapid7 InsightVM, CIS-CAT Pro.

**Tier 3 examples:** A single Qualys or Tenable deployment covering RHEL, Windows, and network devices simultaneously.

### Decision Flow

```
Does the customer already have a compliance scanner?
  |
  +-- No --> Tier 1 (we ship OpenSCAP / PowerSTIG / network eval)
  |
  +-- Yes --> Does the scanner cover one platform or multiple?
                |
                +-- One platform --> Tier 2 (BYOS adapter for that scanner)
                |
                +-- Multiple platforms --> Tier 3 (Hybrid multi-domain adapter)
```

---

## 2. Collection Structure (Required Files)

### Tier 1 Structure

A Tier 1 compliance profile ships the scanner itself. This is the reference structure based on the existing `security.compliance_rhel9_stig` collection, which uses OpenSCAP as the scanner.

```
security.compliance_<platform>_<framework>/
  galaxy.yml                            # Collection metadata, dependencies, version
  meta/runtime.yml                      # Ansible version requirements
  meta/execution-environment.yml        # EE deps for ansible-builder auto-discovery
  meta/compliance-profile.yml           # Profile identity, certification, and capabilities

  plugins/modules/                      # Custom Ansible modules
    normalize_<scanner>.py              # Scanner output --> Common Findings Format

  playbooks/                            # Pipeline-stage playbooks
    run_oscap.yml                       # Scan targets + normalize in one JT (2 plays)
    normalize.yml                       # Standalone normalize utility (debugging, Tier 2 reuse)
    remediate.yml                       # Apply selective remediation (standalone JT)

  docs/                                 # Collection documentation
    architecture.md                     # Pipeline diagram and data flow
    playbook-reference.md               # Playbook variables and usage
    module-reference.md                 # Module parameters and return values

  ee/
    execution-environment.yml           # EE Builder definition (ansible-builder v3)

  extensions/patterns/                  # AAP Pattern metadata
    metadata.yml                        # Discovery metadata
    aap_config/                         # infra.aap_configuration YAML
      workflow.yml                      # Workflow definition
      job_templates.yml                 # Job template definitions
      surveys.yml                       # Survey definitions
    portal/                             # Backstage discovery
      metadata.yml                      # Portal metadata
      backstage_template.yml            # Software Template for one-click setup

  tests/
    unit/                               # Unit tests for custom modules
    integration/                        # Integration test targets
    sanity/                             # Ansible sanity test ignores
```

> **Note:** The reference implementation previously included `compliance_gather.py` and `compliance_evaluate.py` modules with hand-written checks for 20 rules. These have been removed and replaced by OpenSCAP-based scanning (`oscap xccdf eval`) which provides 366+ rules with metadata from the XCCDF datastream.

### Tier 2 Structure

A Tier 2 compliance profile connects to an existing scanner the customer already operates. Replace scanner-specific modules with adapter modules.

```
security.compliance_<platform>_<scanner>/
  galaxy.yml
  meta/runtime.yml

  plugins/modules/
    <scanner>_adapter.py                # API connector module
    normalize_<scanner>.py              # Scanner output normalizer --> CFF

  playbooks/
    fetch_<scanner>.yml                 # Pull results from scanner API (replaces scan.yml)
    normalize.yml                       # Transform results to CFF
    remediate.yml                       # Apply selective remediation (same roles as Tier 1)
    report.yml                          # Generate reports
    verify.yml                          # Re-scan after remediation

  ee/
    execution-environment.yml           # Standard EE (no scanner binaries needed)

  extensions/patterns/
    metadata.yml
    aap_config/
      workflow.yml
      job_templates.yml
      surveys.yml
      credentials.yml                   # Scanner credential type definition
    portal/
      metadata.yml
      backstage_template.yml

  files/
    mappings/
      <scanner>_control_to_stig.yml     # Scanner control ID --> STIG rule ID
    profiles/
      <framework>_<version>.yml
```

**Key difference from Tier 1:** The `plugins/modules/` directory replaces the scanner-execution and normalizer modules with an API adapter module. The `playbooks/scan.yml` is replaced by `playbooks/fetch_<scanner>.yml`. Remediation roles are identical -- the same role fixes the finding whether OpenSCAP or Qualys discovered it.

### Tier 3 Structure

A Tier 3 compliance profile is a meta-collection that wraps multiple Tier 2 adapters under one scanner.

```
security.compliance_enterprise_<scanner>/
  galaxy.yml
  meta/runtime.yml

  adapters/
    <platform_a>/                       # e.g., rhel/
      fetch_results.yml
      normalize_<scanner>_<platform>.py
    <platform_b>/                       # e.g., windows/
      fetch_results.yml
      normalize_<scanner>_<platform>.py
    common/
      connect.yml                       # Shared API connection setup
      trigger_scan.yml                  # Shared scan trigger

  playbooks/
    fetch_all.yml                       # Orchestrate multi-platform fetch
    normalize.yml                       # Fan out to per-platform normalizers
    remediate.yml
    report.yml
    verify.yml

  ee/
    execution-environment.yml

  extensions/patterns/
    metadata.yml
    aap_config/
      workflow.yml                      # Multi-branch workflow
      job_templates.yml
    portal/
      metadata.yml

  files/
    mappings/
      <scanner>_<platform_a>_control_to_stig.yml
      <scanner>_<platform_b>_control_to_stig.yml
```

---

## 3. Common Findings Format (CFF) v1.0.0

This is THE contract. Every normalizer must produce output conforming to this schema. The Backstage plugin consumes ONLY this format. Scanners are opaque to the UI -- the CFF is the single integration surface.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://ansible.com/schemas/compliance/findings/v1",
  "title": "Compliance Findings Format v1",
  "description": "Common format for compliance scan findings across all scanner tiers",
  "type": "object",
  "required": ["version", "scan_metadata", "findings", "summary"],
  "properties": {
    "version": {
      "type": "string",
      "const": "1.0.0",
      "description": "Schema version"
    },
    "scan_metadata": {
      "type": "object",
      "required": ["scan_id", "profile_id", "profile_name", "scanner", "timestamp", "host"],
      "properties": {
        "scan_id": {
          "type": "string",
          "description": "Unique identifier for this scan run (UUID)"
        },
        "profile_id": {
          "type": "string",
          "description": "Compliance profile identifier (e.g., stig_rhel9_v2r8, cis_rhel9_l1)"
        },
        "profile_name": {
          "type": "string",
          "description": "Human-readable profile name (e.g., DISA STIG for RHEL 9 V2R8)"
        },
        "framework": {
          "type": "string",
          "enum": ["DISA_STIG", "CIS_BENCHMARK", "NIST_800_53", "HIPAA", "PCI_DSS", "CUSTOM"],
          "description": "Compliance framework"
        },
        "scanner": {
          "type": "object",
          "required": ["name", "tier"],
          "properties": {
            "name": {
              "type": "string",
              "enum": ["openscap", "powerstig", "insights", "qualys", "tenable", "rapid7", "ciscat", "scap_workbench", "custom"],
              "description": "Scanner identifier"
            },
            "version": {
              "type": "string",
              "description": "Scanner software version"
            },
            "tier": {
              "type": "integer",
              "enum": [1, 2, 3],
              "description": "Scanner tier (1=shipped, 2=BYOS, 3=hybrid)"
            }
          }
        },
        "timestamp": {
          "type": "string",
          "format": "date-time",
          "description": "ISO 8601 timestamp of scan completion"
        },
        "host": {
          "type": "string",
          "description": "FQDN or hostname this scan result is for"
        },
        "host_ip": {
          "type": "string",
          "description": "IP address of the scanned host"
        },
        "host_os": {
          "type": "string",
          "description": "Operating system of the scanned host"
        },
        "certification": {
          "type": "object",
          "description": "Scanner certification status for this framework",
          "properties": {
            "status": {
              "type": "string",
              "enum": ["certified", "conformant", "uncertified"],
              "description": "Whether the scanner is formally validated by the framework authority"
            },
            "authority": {
              "type": "string",
              "description": "Certifying body or validation program (e.g., NIST SCAP 1.2, CIS)"
            }
          }
        }
      }
    },
    "findings": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/finding"
      }
    },
    "summary": {
      "type": "object",
      "required": ["total", "pass", "fail", "error", "not_applicable", "not_checked"],
      "properties": {
        "total": { "type": "integer" },
        "pass": { "type": "integer" },
        "fail": { "type": "integer" },
        "error": { "type": "integer" },
        "not_applicable": { "type": "integer" },
        "not_checked": { "type": "integer" },
        "compliance_score": {
          "type": "number",
          "minimum": 0,
          "maximum": 100,
          "description": "Percentage of applicable rules that passed"
        }
      }
    }
  },
  "definitions": {
    "finding": {
      "type": "object",
      "required": ["rule_id", "title", "status", "severity", "description", "check_text", "fix_text", "category"],
      "properties": {
        "rule_id": {
          "type": "string",
          "description": "Primary rule identifier — MUST match CaC remediation playbook tag name (e.g., sshd_set_keepalive_0)"
        },
        "stig_id": {
          "type": "string",
          "description": "DISA STIG Vulnerability ID (e.g., V-257844). Empty if not STIG.",
          "pattern": "^(V-[0-9]+)?$"
        },
        "cis_id": {
          "type": "string",
          "description": "CIS Benchmark recommendation ID (e.g., 1.1.1.1). Empty if not CIS."
        },
        "cce_id": {
          "type": "string",
          "description": "Common Configuration Enumeration ID (e.g., CCE-83600-3). Empty if not available.",
          "pattern": "^(CCE-[0-9]+-[0-9]+)?$"
        },
        "cci_id": {
          "type": "string",
          "description": "Control Correlation Identifier (e.g., CCI-001133). Links to NIST 800-53."
        },
        "title": {
          "type": "string",
          "description": "Human-readable rule title"
        },
        "description": {
          "type": "string",
          "description": "Detailed description of the compliance requirement"
        },
        "check_text": {
          "type": "string",
          "description": "Instructions for manually verifying compliance"
        },
        "fix_text": {
          "type": "string",
          "description": "Instructions for manually fixing non-compliance"
        },
        "status": {
          "type": "string",
          "enum": ["pass", "fail", "error", "not_applicable", "not_checked"],
          "description": "Compliance status for this rule"
        },
        "severity": {
          "type": "string",
          "enum": ["high", "medium", "low"],
          "description": "Normalized severity. Maps to CAT_I/CAT_II/CAT_III for STIG, Level 1/2 for CIS."
        },
        "category": {
          "type": "string",
          "description": "Rule category (e.g., Access Control, Audit and Accountability)"
        },
        "evidence": {
          "type": "object",
          "properties": {
            "actual_value": {
              "type": "string",
              "description": "What was found on the system"
            },
            "expected_value": {
              "type": "string",
              "description": "What was expected per the compliance rule"
            },
            "message": {
              "type": "string",
              "description": "Human-readable evidence summary"
            },
            "scanner_rule_id": {
              "type": "string",
              "description": "Original rule ID from the scanner (before normalization)"
            },
            "raw_output": {
              "type": "string",
              "description": "Raw scanner output snippet (for debugging)"
            }
          }
        },
        "parameters": {
          "type": "array",
          "description": "Tunable parameters for this rule's remediation",
          "items": {
            "type": "object",
            "required": ["name", "label", "type", "default", "value"],
            "properties": {
              "name": {
                "type": "string",
                "description": "Variable name (e.g., var_sshd_set_keepalive)"
              },
              "label": {
                "type": "string",
                "description": "Human-readable label"
              },
              "description": {
                "type": "string",
                "description": "What this parameter controls"
              },
              "type": {
                "type": "string",
                "enum": ["string", "number", "boolean", "select"]
              },
              "default": {
                "description": "Default value from the compliance profile"
              },
              "value": {
                "description": "Current value (may differ from default if user customized)"
              },
              "options": {
                "type": "array",
                "description": "For select type: available choices",
                "items": {
                  "type": "object",
                  "properties": {
                    "label": { "type": "string" },
                    "value": {}
                  }
                }
              }
            }
          }
        },
        "remediation": {
          "type": "object",
          "properties": {
            "role": {
              "type": "string",
              "description": "Collection role name for automated remediation"
            },
            "available": {
              "type": "boolean",
              "description": "Whether automated remediation is available for this rule"
            },
            "disruption": {
              "type": "string",
              "enum": ["low", "medium", "high"],
              "description": "Expected disruption level if remediation is applied"
            }
          }
        }
      }
    }
  }
}
```

### Severity Mapping Table

All normalizers must map scanner-specific severity to the common format:

| Scanner | Scanner Value | Common `severity` | STIG Category |
|---------|-------------|-------------------|---------------|
| OpenSCAP | `high` | `high` | CAT I |
| OpenSCAP | `medium` | `medium` | CAT II |
| OpenSCAP | `low` | `low` | CAT III |
| PowerSTIG | (from STIG metadata) | Inherit from STIG | CAT I/II/III |
| Qualys | `CRITICALITY=1` (Urgent) | `high` | CAT I |
| Qualys | `CRITICALITY=2` (Critical) | `high` | CAT I |
| Qualys | `CRITICALITY=3` (Serious) | `medium` | CAT II |
| Qualys | `CRITICALITY=4` (Medium) | `medium` | CAT II |
| Qualys | `CRITICALITY=5` (Minimal) | `low` | CAT III |
| Tenable | `critical` / `high` | `high` | CAT I |
| Tenable | `medium` | `medium` | CAT II |
| Tenable | `low` / `info` | `low` | CAT III |
| Rapid7 | 8-10 | `high` | CAT I |
| Rapid7 | 4-7 | `medium` | CAT II |
| Rapid7 | 1-3 | `low` | CAT III |
| CIS-CAT | Level 1 | `medium` | CAT II |
| CIS-CAT | Level 2 | `low` | CAT III |
| Insights | `high` | `high` | CAT I |
| Insights | `medium` | `medium` | CAT II |
| Insights | `low` | `low` | CAT III |
### Status Mapping Table

| Scanner | Scanner Value | Common `status` |
|---------|-------------|----------------|
| OpenSCAP | `pass` | `pass` |
| OpenSCAP | `fail` | `fail` |
| OpenSCAP | `error` | `error` |
| OpenSCAP | `notapplicable` | `not_applicable` |
| OpenSCAP | `notchecked` | `not_checked` |
| OpenSCAP | `fixed` | `pass` |
| OpenSCAP | `informational` | `pass` |
| PowerSTIG | `InDesiredState=true` | `pass` |
| PowerSTIG | `InDesiredState=false` | `fail` |
| Qualys | `PASS` / `FAIL` / `ERROR` | `pass` / `fail` / `error` |
| Tenable | `PASSED` | `pass` |
| Tenable | `FAILED` / `WARNING` | `fail` |
| Tenable | `ERROR` | `error` |
| Rapid7 | `Pass` / `Fail` / `Error` | `pass` / `fail` / `error` |
| Rapid7 | `Unknown` | `not_checked` |
| CIS-CAT | `Pass` / `Fail` / `Error` | `pass` / `fail` / `error` |
| CIS-CAT | `Unknown` | `not_checked` |
| CIS-CAT | `Not Applicable` | `not_applicable` |
| Insights | `pass` / `fail` | `pass` / `fail` |
### Example: Complete Finding Object

```json
{
  "rule_id": "sshd_set_keepalive_0",
  "stig_id": "V-257844",
  "cis_id": "",
  "cce_id": "CCE-90270-6",
  "cci_id": "CCI-001133",
  "title": "Set SSH Client Alive Interval",
  "description": "RHEL 9 must be configured so that all network connections associated with SSH traffic are terminated at the end of the session or after 10 minutes of inactivity.",
  "check_text": "Verify the SSH daemon is configured to terminate idle sessions after 600 seconds.",
  "fix_text": "Configure the SSH daemon to terminate idle sessions. Set 'ClientAliveInterval 600' in /etc/ssh/sshd_config and restart sshd.",
  "status": "fail",
  "severity": "high",
  "category": "Access Control",
  "evidence": {
    "actual_value": "0",
    "expected_value": "600",
    "message": "ClientAliveInterval is set to 0. Expected 600.",
    "scanner_rule_id": "xccdf_org.ssgproject.content_rule_sshd_set_keepalive_0",
    "raw_output": ""
  },
  "parameters": [
    {
      "name": "var_sshd_set_keepalive",
      "label": "Client Alive Interval (seconds)",
      "description": "Number of seconds before SSH session idle timeout",
      "type": "number",
      "default": 600,
      "value": 600,
      "options": []
    }
  ],
  "remediation": {
    "role": "remediate_sshd_idle_timeout",
    "available": true,
    "disruption": "low"
  }
}
```

---

## 4. Normalizer Requirements

Every compliance profile MUST include a normalizer module. The normalizer is the only scanner-specific code in the pipeline. Everything upstream (the scanner) and downstream (the Backstage plugin, remediation roles) is decoupled from the scanner.

### What the Normalizer Must Do

1. **Accept scanner-specific output** -- XCCDF XML, PowerSTIG JSON, Qualys XML, Tenable JSON, CIS-CAT JSON, etc.
2. **Produce Common Findings Format JSON** conforming to the CFF v1.0.0 schema above
3. **Map scanner severity** to normalized severity (`high` / `medium` / `low`)
4. **Map scanner status** to normalized status (`pass` / `fail` / `error` / `not_applicable` / `not_checked`)
5. **Preserve the original scanner rule ID** in `evidence.scanner_rule_id`
6. **Populate `actual_value` and `expected_value`** in the evidence object
7. **Support `check_mode`** (parse without writing output, for dry-run validation)
8. **Include full rule metadata** in every finding: `title`, `description`, `check_text`, `fix_text`, `category`, `severity`, and `parameters` (if the rule supports parameter overrides)

> **IMPORTANT: The plugin does not enrich findings.** It displays exactly what it receives via the CFF pipeline. All metadata — descriptions, check/fix text, parameter definitions — must be populated by the findings source:
>
> - **Tier 1 (OpenSCAP + normalizer)**: The `normalize_xccdf` module extracts all rule metadata (title, description, fix_text, severity, stig_id) directly from the XCCDF datastream. No external rules YAML is needed -- the SCAP Security Guide datastream contains complete metadata for all 366 STIG rules.
> - **Tier 2 (external scanner + normalizer)**: The normalizer must map scanner output to CFF AND populate all metadata fields. External scanners often provide their own descriptions (e.g., Tenable findings include rich descriptions); the normalizer maps these to CFF fields. For metadata the scanner doesn't provide, the normalizer can read from a supplementary rules YAML or mapping file included in the collection.
>
> This design keeps compliance profiles self-contained: adding a new profile to Controller (Git project + workflow + JTs) makes it work end-to-end without repackaging or redeploying the plugin.

### Implementation Pattern

The normalizer is a custom Ansible module in `plugins/modules/`. It receives scanner output file paths as input and writes CFF JSON as output.

```python
#!/usr/bin/python
# plugins/modules/normalize_<scanner>.py

DOCUMENTATION = r'''
---
module: normalize_<scanner>
short_description: Normalize <Scanner> results to Common Findings Format
description:
  - Parses <Scanner> output files.
  - Transforms each result into CFF v1.0.0 JSON.
options:
  results_files:
    description: List of result file paths to process
    type: list
    elements: str
    required: true
  output_file:
    description: Path to write the normalized JSON output
    type: str
    required: true
'''

from ansible.module_utils.basic import AnsibleModule

# Scanner-specific severity and status maps
SEVERITY_MAP = {
    # scanner_value: cff_value
}

STATUS_MAP = {
    # scanner_value: cff_value
}

def parse_results(filepath):
    """Parse a single scanner result file. Returns (hostname, findings_list)."""
    # Scanner-specific parsing logic here
    pass

def main():
    module = AnsibleModule(
        argument_spec=dict(
            results_files=dict(type='list', elements='str', required=True),
            output_file=dict(type='str', required=True),
        ),
        supports_check_mode=True,
    )
    # Parse, normalize, write output
    # ...

if __name__ == '__main__':
    main()
```

### Reference Implementation

See the OpenSCAP normalizer at:
`profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/plugins/modules/normalize_xccdf.py`

This module parses XCCDF 1.1 and 1.2 Results XML, extracts rule metadata (title, description, fix_text, severity, stig_id) from the `<Benchmark>` element in the datastream, maps severity and status to CFF values, strips XCCDF prefixes from rule IDs so they match CaC remediation tags, and writes CFF JSON output. It processes 366 STIG rules per host.

For detailed module documentation, see `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/docs/module-reference.md`.

### Tier 2 Adapter Considerations

For Tier 2 compliance profiles, the normalizer may also need to:

- **Map scanner-specific control IDs to STIG/CIS rule IDs** using a mapping file under `files/mappings/`. Qualys control IDs, for example, do not match STIG vulnerability IDs and require a lookup table.
- **Handle API pagination** when fetching results in bulk from the scanner API.
- **Convert between character encodings** (Qualys XML may use different encodings than XCCDF).

---

## 5. EE Profile Requirements

Every compliance profile must include an Execution Environment definition at `ee/execution-environment.yml`. This file is consumed by `ansible-builder` to construct a container image with all required dependencies.

### Base Image

All compliance profile EEs must use the AAP 2.6 minimal base image:

```yaml
images:
  base_image:
    name: registry.redhat.io/ansible-automation-platform-26/ee-minimal-rhel9:latest
```

### Required Dependencies

The EE definition must declare three categories of dependencies:

```yaml
version: 3

build_arg_defaults:
  ANSIBLE_GALAXY_CLI_COLLECTION_OPTS: '--pre'

images:
  base_image:
    name: registry.redhat.io/ansible-automation-platform-26/ee-minimal-rhel9:latest

dependencies:
  # 1. Galaxy dependencies: the compliance profile collection itself + platform collections
  galaxy:
    collections:
      - name: security.compliance_<platform>_<framework>  # This collection
      - name: ansible.posix                               # Common POSIX utilities
      # Platform-specific:
      # - name: ansible.windows          # For Windows compliance profiles
      # - name: cisco.ios               # For Cisco IOS network compliance profiles
      # - name: redhat.rhel_system_roles # For RHEL compliance profiles

  # 2. Python dependencies: scanner-specific libraries
  python:
    # - pywinrm             # Required for Windows compliance profiles
    # - lxml                # Required for XCCDF XML parsing
    # - requests            # Required for Tier 2 scanner API adapters

  # 3. System dependencies: scanner binaries (Tier 1 only)
  system:
    # - openscap-scanner    # Tier 1 RHEL: ~5 MB installed
    # - openscap-utils      # Tier 1 RHEL: ~200 KB installed
    # - scap-security-guide # Tier 1 RHEL: ~80 MB installed (all platforms)
```

### Tier-Specific EE Patterns

**Tier 1 (RHEL/OpenSCAP):**
```yaml
dependencies:
  galaxy:
    collections:
      - name: ansible.posix
      - name: redhat.rhel_system_roles
  python: []
  system:
    - openscap-scanner
    - openscap-utils
    - scap-security-guide
```

**Tier 1 (Windows/PowerSTIG):**
```yaml
dependencies:
  galaxy:
    collections:
      - name: ansible.windows
      - name: community.windows
  python:
    - pywinrm
  system: []
```

**Tier 2 (Qualys/Tenable/Insights):**
```yaml
dependencies:
  galaxy:
    collections:
      - name: ansible.posix
  python:
    - lxml       # For Qualys XML parsing
    - requests   # For scanner API calls
  system: []
```

### Build and Verify

Build the EE and verify critical dependencies are present:

```yaml
additional_build_steps:
  append_final:
    - RUN echo "=== Compliance EE Build Info ==="
    # Tier 1 verification:
    - RUN rpm -q openscap-scanner || echo "openscap-scanner: NOT INSTALLED"
    - RUN rpm -q scap-security-guide || echo "scap-security-guide: NOT INSTALLED"
    # Verify SCAP content is present:
    - RUN ls /usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml && echo "SCAP data stream: present" || echo "SCAP data stream: MISSING"
    # Verify CaC remediation playbook is present:
    - RUN ls /usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml && echo "CaC remediation playbook: present" || echo "CaC remediation playbook: MISSING"
```

Build command:

```bash
cd ee/
ansible-builder build -f execution-environment.yml -t compliance-<platform>-<framework>:latest -v3
```

---

## 6. Pipeline Workflow

The compliance profile must define a Controller workflow with these stages. Each stage maps to a job template. The workflow uses `infra.aap_configuration` YAML format for declarative setup.

> **Note:** The full pipeline defines 7 stages for maximum flexibility. The reference implementation (`security.compliance_rhel9_stig`) uses a **single JT** (`run_oscap.yml`) with two plays: Play 1 scans targets, Play 2 normalizes on localhost (same container). Remediation is launched as a separate, standalone job template (not part of the assessment) with `job_tags` for scoped rule selection. This separation ensures assessments never modify hosts. Verification is triggered as a separate assessment scan from the UI. New profiles can implement any subset of stages -- the plugin requires only that the JT produces CFF-format findings.

### Pipeline Stages

The reference implementation uses a **single assessment JT** with OpenSCAP:

```
  +-----------------------------------+
  | compliance-run-oscap (single JT)  |
  |                                   |
  |  Play 1: OpenSCAP scan (targets)  |
  |  Play 2: Normalize (localhost)    |
  +-----------------------------------+
                    |
             CFF JSON findings
                    |
                    v
             +------------+
             | Remediate  |     (separate standalone JT)
             | (targets)  |
             +------------+
```

| Stage | Purpose | Runs On | Playbook |
|-------|---------|---------|----------|
| **Assessment (Play 1)** | Install oscap, copy datastream, scan, fetch XCCDF XML | Target hosts | `playbooks/run_oscap.yml` (Play 1) |
| **Assessment (Play 2)** | Parse XCCDF XML, extract metadata, produce CFF JSON, POST to `/findings/ingest` | localhost (same container) | `playbooks/run_oscap.yml` (Play 2) |
| **Remediate** | Apply CaC remediation scoped by `job_tags` (standalone JT) | Target hosts | `playbooks/remediate.yml` |

For profiles using different scanners, the full pipeline supports up to 7 stages:

| Stage | Purpose | Runs On | Playbook |
|-------|---------|---------|----------|
| **1. Scan** | Execute scanner on targets or fetch from API | Targets (Tier 1) or localhost (Tier 2) | `playbooks/run_oscap.yml` or `playbooks/fetch_<scanner>.yml` |
| **2. Normalize** | Transform scanner output to CFF JSON | localhost | `playbooks/normalize.yml` |
| **3. Report** | POST results to Backstage `/findings/ingest` endpoint (or write to Controller artifacts for fallback) | localhost | `playbooks/report.yml` |
| **4. Remediate** | Execute approved remediations (behind approval gate) | Target hosts | `playbooks/remediate.yml` |
| **5. Verify** | Re-scan to confirm remediation effectiveness | Target hosts | (re-run scan playbook) |

### Assessment JT (Tier 1 Pattern)

For Tier 1 scanners (OpenSCAP), the assessment is a **single job template** running `run_oscap.yml`. This playbook contains two plays: Play 1 scans targets via SSH, Play 2 normalizes results on localhost. Both plays run in the same container, so fetched XCCDF XML files are available to the normalize step without cross-container file sharing.

No workflow is needed for Tier 1 assessment. Remediation is always a separate, standalone job template -- never combined with assessment. This ensures assessments are read-only and the gap between assess and remediate is available for human review, EDA policy evaluation, or future AI-driven decision-making.

> **Why a single JT instead of a multi-node workflow?** AAP workflow nodes run in separate containers. The scan play fetches XCCDF result files from targets to the execution node, but a second workflow node cannot access those files because it runs in a different container. Combining scan and normalize into one JT (two plays) solves this. Tier 2 scanners (API-based) do not have this problem because they fetch results via API on localhost, so multi-node workflows remain valid for Tier 2/3 profiles.

### Job Template Naming

Two JT naming conventions are valid:

- **Generic name** (`compliance-run-oscap`): A single shared JT used on simple or single-profile deployments (e.g., a home lab). All profiles use the same JT name, and the XCCDF profile is selected via extra_vars.
- **Per-profile names** (`compliance-scan-stig-rhel9`, `compliance-scan-cis-l1-rhel9`): One JT per compliance profile, used on multi-profile deployments (e.g., netrunner demo lab). Each JT has its own default extra_vars and EE configuration.

Both are valid. The plugin resolves the assessment JT by ID (from the Settings registration) or by name search, so the naming convention does not affect functionality.

### Job Template Definitions

Job templates go in `extensions/patterns/aap_config/job_templates.yml`:

```yaml
---
controller_templates:
  - name: compliance-scan-<platform>-<framework>
    organization: compliance
    description: "Scan <Platform> hosts against <Framework>"
    job_type: check
    inventory: compliance-<platform>-inventory
    project: compliance-content
    playbook: playbooks/run_oscap.yml
    ask_inventory_on_launch: true
    ask_limit_on_launch: true
    survey_enabled: true
    extra_vars:
      profile_name: "{{ profile_name }}"
      framework: "{{ framework }}"
      remediate_jt_name: "compliance-remediate-<platform>-<framework>"
      remediation_playbook: "playbooks/remediate.yml"

  - name: compliance-remediate-<platform>-<framework>
    organization: compliance
    description: "Remediate selected <Framework> findings on <Platform>"
    job_type: run
    inventory: compliance-<platform>-inventory
    project: compliance-content
    playbook: playbooks/remediate.yml
    ask_inventory_on_launch: true
    ask_limit_on_launch: true
    ask_tags_on_launch: true
    ask_variables_on_launch: true
    survey_enabled: false

  - name: compliance-verify-<platform>-<framework>
    organization: compliance
    description: "Verification re-scan after remediation"
    job_type: check
    inventory: compliance-<platform>-inventory
    project: compliance-content
    playbook: playbooks/run_oscap.yml
    ask_inventory_on_launch: true
```

### AAP Controller Resource Configuration (Critical)

The compliance plugin depends on specific AAP Controller resource settings to function correctly. Misconfiguring these settings is the most common cause of "scan runs against wrong hosts" or "remediation applies to all rules instead of selected ones."

#### Inventory Propagation

The plugin passes the user-selected inventory to the assessment JT at launch time via `POST /api/controller/v2/job_templates/{id}/launch/` with `{"inventory": <id>}`. The JT must have `ask_inventory_on_launch: true` to accept this override.

```
Plugin selects inventory "prod-rhel9"
  |
  v
Assessment JT: compliance-run-oscap (ask_inventory_on_launch: true)
  receives inventory override = "prod-rhel9"
  Play 1: scans targets in "prod-rhel9"
  Play 2: normalizes on localhost (same container)

Remediation is a separate direct JT call with the same
inventory override (see below).
```

#### Remediation: Direct JT Launch with job_tags

The plugin launches the remediation JT **directly** (not through the assessment JT). The assessment JT runs `run_oscap.yml` (scan + normalize) and never modifies hosts. This separation is the correct architecture for all operating modes:

- **Human-supervised**: assessment JT -> human reviews findings -> human launches remediate JT with selected rules as job_tags
- **EDA-automated**: assessment JT -> EDA rulebook evaluates findings -> conditionally launches remediate JT based on policy
- **Future autonomous**: same pattern -- the decision point between assess and remediate is where intelligence lives

The remediation JT must have:

- `ask_tags_on_launch: true` -- allows the plugin to pass selected rule IDs as `job_tags`
- `ask_variables_on_launch: true` -- allows parameter overrides via `extra_vars`
- `ask_inventory_on_launch: true` -- allows inventory override (same as workflow nodes)

> **CRITICAL: Rule IDs must match CaC tag names exactly.** The rule `id` field in the rules YAML is passed directly as `job_tags` to the remediation JT. The CaC playbook filters tasks by these tags. If a rule ID doesn't match a CaC tag, no remediation tasks will run for that rule. CaC tag names are the directory names under `ComplianceAsCode/content/linux_os/guide/` (e.g., `mount_option_tmp_noexec`, not `mount_tmp_noexec`). Always verify rule IDs against the CaC source before shipping a profile.

The plugin launches remediation via `POST /api/controller/v2/job_templates/{id}/launch/` with:

```json
{
  "inventory": 42,
  "job_tags": "sshd_set_keepalive_0,accounts_tmout,sshd_disable_root_login",
  "extra_vars": {
    "var_sshd_set_keepalive": 600,
    "var_accounts_tmout": 900
  }
}
```

#### Assessment JT Resolution

The plugin resolves the assessment job template in two ways:

1. **Compliance profile registration** -- The admin maps a job template ID in the Settings page. The plugin uses this ID directly.
2. **Name search fallback** -- If the ID is not set, the plugin searches for job templates matching the compliance profile's naming convention (e.g., `compliance-run-oscap`).

#### Remediation JT Resolution

The plugin resolves the remediation job template per compliance profile:

1. **Compliance profile registration** -- The Remediate Job Template ID stored in the profile registry. This is auto-populated from the `remediate_jt_name` extra_var when registering the profile, or set manually. **This is the recommended path for multi-profile deployments.**
2. **Name search fallback** -- If not set, the plugin searches for JTs matching `compliance-remediate`. This works for single-profile deployments but will pick the wrong JT when multiple remediation JTs exist (e.g., `compliance-remediate-stig-rhel9` and `compliance-remediate-cis-l1-rhel9`).

#### Configuration Checklist

| Resource | Setting | Value | Why |
|----------|---------|-------|-----|
| Assessment JT | `ask_inventory_on_launch` | `true` | Plugin passes user-selected inventory |
| Remediation JT | `ask_tags_on_launch` | `true` | Plugin passes selected rules as job_tags |
| Remediation JT | `ask_variables_on_launch` | `true` | Plugin passes parameter overrides |
| Remediation JT | `ask_inventory_on_launch` | `true` | Plugin passes inventory for direct launch |

### Remediation Playbook Pattern

The remediation playbook is always launched as a **standalone job template** -- never as a workflow node. It must support selective execution via `--tags`, `--extra-vars`, and `--limit`. This is how the portal translates user decisions from the Remediation Builder into Controller job parameters.

For Tier 1 RHEL STIG, the remediation playbook imports the ComplianceAsCode (CaC) playbook from `scap-security-guide`:

```yaml
---
# playbooks/remediate.yml
#
# Selective remediation via Controller:
#   --tags:       comma-separated rule IDs from the Remediation Builder
#   --extra-vars: parameter overrides (e.g., var_accounts_tmout: 900)
#   --limit:      target hosts from the remediation scope selection
#
- name: "Compliance: Apply remediation"
  ansible.builtin.import_playbook: /usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml
```

### CaC Title Matching Convention

The portal's remediation execution view groups Ansible tasks by compliance rule using a title-matching algorithm. For CaC playbooks (scap-security-guide), each task's name starts with the rule title (e.g., "Set SSH Client Alive Interval - Configure sshd_config"). The portal detects these "anchor" tasks by comparing the task name against known rule titles, then assigns all subsequent tasks to that rule until a new anchor is found.

**Requirements for proper task-to-rule grouping:**
1. Ansible role names should match rule IDs (e.g., role `sshd_set_idle_timeout` for rule `sshd_set_idle_timeout`). The portal checks `event_data.role` first.
2. Tasks should be tagged with the rule ID. The portal checks `event_data.task_tags` second.
3. As a fallback, task names should start with the rule title. This is the CaC convention and requires that rule titles in the compliance profile YAML match the CaC task name prefixes exactly.

If none of these match, tasks appear in an "unassigned" group. For custom (non-CaC) playbooks, use tags on every task to ensure correct grouping.

For compliance profiles that cannot use CaC playbooks (Windows, network devices, custom frameworks), provide per-rule roles:

```yaml
---
# playbooks/remediate.yml (custom remediation)
- name: "Compliance: Apply selective remediation"
  hosts: "{{ target_hosts | default('all') }}"
  become: true
  roles:
    - role: remediate_sshd_idle_timeout
      tags: [sshd_set_idle_timeout]
    - role: remediate_accounts_tmout
      tags: [accounts_tmout]
    # ... one role per remediatable rule
```

---

## 7. Portal/Backstage Metadata

The compliance profile must include discovery metadata so the Backstage plugin can identify and present it.

### Pattern Metadata

The `extensions/patterns/metadata.yml` file provides high-level discovery information. The `platform:` block in this file is read by `install.yml` and set as part of the JT's default extra_vars, enabling auto-populate of platform requirements in the Settings form:

```yaml
name: compliance-<platform>-<framework>
display_name: <Human Name> Compliance Pipeline
version: <collection version, e.g., 0.1.0>
description: >
  End-to-end compliance pipeline for <Platform> systems against <Framework>.
  Includes scan, report, remediation profile customization, and verification workflows.
domain: security
tags:
  - compliance
  - <framework>      # e.g., stig, cis, pci-dss
  - <platform>       # e.g., rhel9, windows2022, cisco-ios
  - security
applicable_os:
  - <OS list>         # e.g., RHEL 9, Windows Server 2022, Cisco IOS 15.x
frameworks:
  - <framework with version>  # e.g., DISA STIG V2R8, CIS Benchmark Level 1
source: <collection namespace.name>  # e.g., security.compliance_rhel9_stig
platform:                             # ADR-011: platform guards
  os_family: ["RedHat"]               # or ["Windows"], or device_type: ["cisco_ios"]
  os_version: ["9"]                   # optional: major version filter
```

### Portal Metadata

The `extensions/patterns/portal/metadata.yml` file is consumed by the Backstage plugin for UI rendering:

```yaml
name: compliance-<platform>-<framework>
display_name: <Human Name> Compliance Pipeline
version: <collection version>
domain: security
tags:
  - compliance
  - <framework>
  - <platform>
  - security
applicable_os:
  - <OS list>
frameworks:
  - <framework with version>
source: <collection namespace.name>
```

### Backstage Software Template (Optional)

For one-click provisioning, include `extensions/patterns/portal/backstage_template.yml`:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: compliance-<platform>-<framework>
  title: <Human Name> Compliance Pipeline
  description: Set up a compliance pipeline for <Platform> against <Framework>
spec:
  type: compliance-pipeline
  parameters:
    - title: Pipeline Configuration
      properties:
        inventory:
          type: string
          title: Target Inventory
          description: AAP inventory containing the hosts to scan
        scanner:
          type: string
          title: Compliance Scanner
          enum:
            - openscap
            # Add Tier 2 options if applicable
          default: openscap
  steps:
    - id: provision-pipeline
      name: Provision Compliance Pipeline
      action: aap:run-job-template
      input:
        jobTemplate: compliance-setup
        extraVars:
          scanner: ${{ parameters.scanner }}
          inventory: ${{ parameters.inventory }}
```

---

## 8. Compliance Profile Registration

When a compliance profile collection is installed, an administrator registers it in the Backstage compliance plugin Settings page. This creates the mapping between the portal and the AAP resources.

### Registration Fields

When an admin selects a scan JT that was provisioned via `install.yml`, fields marked "Auto-populated" below are filled in automatically from the JT's default extra_vars. All auto-populated fields remain editable. If the JT lacks extra_vars, all fields must be entered manually -- refer to the profile's `meta/compliance-profile.yml` or README for the correct values.

| Field | Source | Description |
|-------|--------|-------------|
| **Display name** | Auto-populated or manual entry | Human-readable name (e.g., "RHEL 9 DISA STIG") |
| **Compliance standard identifier** | Auto-populated or manual entry | Machine identifier (e.g., `rhel9-stig-v2r8`) |
| **Execution Environment** | AAP Gateway API dropdown | The EE built from the compliance profile's `ee/execution-environment.yml` |
| **Assessment job template** | AAP Gateway API dropdown | The JT running `run_oscap.yml` (scan + normalize). Selecting a JT triggers auto-populate. |
| **Remediate job template** | Auto-populated or AAP Gateway API dropdown | The standalone JT running `remediate.yml`. Auto-populated from `remediate_jt_name` in the assessment JT's extra_vars. If not set, the plugin falls back to name search for JTs matching `compliance-remediate`. |
| **Remediation playbook path** | Auto-populated or manual entry | Path to the remediation playbook inside the EE |
| **Scanner tier** | Auto-populated or manual selection | 1 (built-in), 2 (BYOS), or 3 (hybrid) |
| **Platform requirements** | Auto-populated or from collection metadata | Platform spec declaring supported OS/device types (see below). Optional but recommended for auto-populate. If omitted, users must configure this manually in the Settings form. |
| **Certification status** | Auto-populated or manual selection | `certified`, `conformant`, or `uncertified` (see section 10) |
| **Scan tags** | Optional | Tags for organizing compliance profiles in the UI |

### Platform Requirements (ADR-011)

Every compliance profile must declare which platforms it supports. The plugin uses this to validate inventories before launching scans and to set playbook-side guards. This prevents silent failures when a profile is run against incompatible hosts.

The platform spec is stored as JSON in the compliance profile registry and declared in the collection's `extensions/patterns/metadata.yml`. When included in the JT's default extra_vars (via `install.yml`), the platform spec auto-populates in the Settings form. If omitted, users must configure platform requirements manually in the Settings form -- document the supported platforms in the collection README.

```yaml
# Tier 1 — OS-based profiles
platform:
  os_family: ["RedHat"]           # ansible_os_family values
  os_version: ["9"]               # major version match

# Windows example
platform:
  os_family: ["Windows"]
  os_version: ["2019", "2022"]

# Network device example
platform:
  device_type: ["cisco_ios", "cisco_nxos"]

# Tier 2/3 — External scanner handles targeting
platform:
  scanner_validates: true         # skip host-side checks
```

**Validation layers:**

1. **Pre-launch (plugin backend):** Before launching the assessment JT, the plugin queries inventory hosts from the Controller API and checks cached `ansible_facts` against the profile's platform spec. Mismatched hosts trigger a warning dialog listing the affected hosts. The user can cancel or proceed anyway.

2. **Playbook-side (safety net):** The assessment playbook uses the platform spec to set `when:` conditions. Mismatched hosts get `not_applicable` finding status instead of failing silently.

3. **External scanners:** Profiles with `scanner_validates: true` skip both layers — the scanner handles its own targeting.

**Controller requirements for platform validation:**

- The assessment job template **must** have **"Use Fact Storage"** (`use_fact_cache: true`) enabled. Without this, Controller does not persist gathered facts and the plugin cannot validate host platforms.
- The assessment playbook **must** have `gather_facts: true` on the play that runs against target hosts. This populates the Controller fact cache with `ansible_os_family`, `ansible_distribution_major_version`, and other host facts used for validation.
- Facts are populated after the first scan runs. Platform validation is only effective from the second scan onward (the first scan against a new inventory always passes validation since no facts are cached yet).
- When hosts are recreated (e.g., EC2 snapshot restore), the next scan refreshes the fact cache automatically.

See `specs/compliance-pipelines/decisions/ADR-011-profile-driven-platform-guards.md` for the full decision record.

### Registration Flow

1. Admin installs the collection to Automation Hub (or a local repo)
2. Admin builds the EE from `ee/execution-environment.yml` using `ansible-builder` or the EE Builder Service
3. Admin runs the `install.yml` playbook to provision Controller resources (JTs with default extra_vars from `meta/compliance-profile.yml`)
4. Admin navigates to Compliance > Settings in the portal
5. Admin clicks "Add Compliance Profile" and selects the assessment JT -- form fields auto-populate from the JT's default extra_vars
6. Admin reviews auto-populated values, adjusts if needed, and saves
7. The compliance profile appears in the profile browser and is available for scan launches

> **If step 3 was skipped** (JT created manually without `install.yml`), step 5 will not auto-populate. The admin must fill in all fields manually using values from the collection's `meta/compliance-profile.yml` or README.

### Validation

The portal validates that the referenced EE and assessment job template are accessible via the AAP Gateway API before accepting a registration. If either resource becomes unavailable later, the compliance profile status indicator shows the issue (e.g., "EE unavailable").

---

## 9. Scanner Swap Compatibility

A well-built compliance profile must ensure that scanners are swappable without affecting the user experience. The CFF is the contract that makes this possible.

### Compatibility Requirements

1. **The Backstage plugin renders identically regardless of scanner.** The UI consumes CFF JSON -- it never inspects the scanner name for rendering decisions.

2. **Remediation roles work regardless of which scanner discovered the finding.** The same `remediate_sshd_idle_timeout` role fixes the finding whether OpenSCAP or Qualys found it.

3. **Multiple scanners can coexist for the same framework/platform.** A customer can run OpenSCAP daily for fast pre-assessment and Tenable monthly for audit-grade evidence. Both produce CFF JSON consumed by the same dashboard.

4. **Switching scanners requires approximately 1 hour, no code changes.** The steps are:
   - Install the new compliance profile collection
   - Build the new EE (if scanner binaries differ)
   - Add scanner credentials in Controller
   - Run the setup playbook to provision the new workflow
   - Update the compliance profile registration in the portal Settings page

### What Changes vs. What Stays the Same

| Component | Changes on Scanner Swap? |
|-----------|--------------------------|
| Backstage plugin | NO |
| Common Findings JSON schema | NO (same schema) |
| Remediation roles | NO |
| Dashboard views and filters | NO |
| Assessment job template | YES -- different scan/normalize JT per scanner |
| Execution Environment | YES -- different dependencies |
| Credentials | YES -- different credential type |
| Remediate job template | NO |

### Coexistence Patterns

Multiple scanners for the same profile are useful for:

- **Pre-assessment + Audit:** Run OpenSCAP scans daily (fast, ephemeral oscap install) for continuous posture monitoring, and export XCCDF results for audit-grade evidence on demand.
- **Scanner comparison:** Run two scanners against the same hosts to identify scanner-specific gaps.
- **Migration:** Run both scanners in parallel during a transition until the new scanner is validated.

Each scanner produces findings with its own `scan_metadata.scanner.name`. The portal can filter, compare, or merge results by scanner.

---

## 10. Scanner Certification

Certification status tells users whether scan results are formally recognized by the framework authority. This is critical for regulated environments where audit evidence must come from validated tools.

### Certification Levels

| Status | Meaning | Example |
|--------|---------|---------|
| `certified` | Scanner is validated by the framework authority. Results are accepted for formal compliance audits. | OpenSCAP + DISA STIG (OpenSCAP has NIST SCAP 1.2 validation; SSG content is produced in collaboration with DISA FSO) |
| `conformant` | Scanner uses official benchmark content but is not the authority-certified tool. Results are technically accurate but may not be accepted for formal audits. | OpenSCAP + CIS Benchmark (CIS-CAT Pro is the CIS-certified scanner, not OpenSCAP) |
| `uncertified` | Custom scanner or homegrown checks with no formal validation. | Ansible facts gathering with custom rules |

### Known Certifications

| Scanner | Framework | Status | Authority | Notes |
|---------|-----------|--------|-----------|-------|
| OpenSCAP | DISA STIG | certified | NIST SCAP 1.2 | OpenSCAP Base validated April 2014. SSG content is DISA-endorsed. |
| OpenSCAP | CIS Benchmark | conformant | CIS | Uses SSG's CIS profiles but OpenSCAP is not CIS-certified. CIS-CAT Pro (NIST SCAP 1.2 #127) is the certified tool. |
| CIS-CAT Pro | CIS Benchmark | certified | CIS, NIST SCAP 1.2 #127 | Commercial tool from CIS. |
| Qualys | DISA STIG | certified | NIST SCAP validated | Enterprise vulnerability scanner. |
| Qualys | CIS Benchmark | certified | CIS-certified vendor | |
| Tenable | Both | certified | Both certifications | |
| Custom/Ansible facts | Any | uncertified | — | No formal validation |

### Declaring Certification in a Profile

The normalizer module accepts `certification_status` and `certification_authority` parameters. These are set in the profile's playbooks (`run_oscap.yml`, `normalize.yml`) and emitted in the CFF output. When these values are included in the JT's default extra_vars (via `install.yml` reading `meta/compliance-profile.yml`), they auto-populate the certification fields in the Settings form. If omitted, the Settings form defaults to `uncertified` -- document the correct certification status in the collection README so admins can set it manually.

```yaml
- name: Normalize results
  security.compliance_rhel9_stig.normalize_xccdf:
    results_files: ["{{ item.path }}"]
    output_file: "{{ output_file }}"
    profile_name: "DISA STIG RHEL 9"
    framework: "DISA_STIG"
    certification_status: "certified"
    certification_authority: "NIST SCAP 1.2"
```

The certification metadata flows through the CFF JSON output into the Backstage plugin, where it can be displayed as a badge on scan results.

### CFF Output

The `certification` object is included in the `scan_metadata` section of the CFF JSON:

```json
{
  "version": "1.0.0",
  "scan_metadata": {
    "scan_id": "a1b2c3d4-...",
    "profile_id": "stig_rhel9_v2r8",
    "profile_name": "DISA STIG RHEL 9",
    "scanner": {
      "name": "openscap",
      "version": "1.3.10",
      "tier": 1
    },
    "certification": {
      "status": "certified",
      "authority": "NIST SCAP 1.2"
    },
    "timestamp": "2026-05-29T12:00:00Z",
    "host": "nm-rhel01.example.com"
  },
  "findings": [],
  "summary": {}
}
```

### Tier 2 BYOS Adapters

For Tier 2 scanner adapters, the certification status depends on the customer's scanner:

- If the customer uses a NIST SCAP-validated scanner (Qualys, Tenable, SCC), the adapter should set `certified`
- If the customer uses an unvalidated scanner, the adapter should set `uncertified`
- The adapter should accept the certification parameters from the user's configuration, not hardcode them

### Custom Profiles

For custom profiles, default to `uncertified` unless the profile author can demonstrate formal validation.

---

## 11. Checklist

Use this checklist when building a new compliance profile. Every item must be satisfied before the compliance profile is considered shippable.

### Collection Basics

- [ ] Collection named `security.compliance_<platform>_<framework>` (or `security.compliance_<platform>_<scanner>` for Tier 2)
- [ ] `galaxy.yml` with proper namespace (`security`), name, version, description, authors, tags, and dependencies
- [ ] `meta/runtime.yml` with `requires_ansible: ">=2.18.0"`
- [ ] `LICENSE` file present
- [ ] `README.md` with overview, requirements, and usage instructions

### Normalizer and CFF Compliance

- [ ] Normalizer module at `plugins/modules/normalize_<scanner>.py`
- [ ] Normalizer produces CFF v1.0.0 JSON (schema version field is `"1.0.0"`)
- [ ] All findings include the four minimum required fields: `rule_id`, `title`, `status`, `severity`
- [ ] Severity mapped to `high` / `medium` / `low` (never raw scanner values)
- [ ] Status mapped to `pass` / `fail` / `error` / `not_applicable` / `not_checked`
- [ ] Evidence includes `actual_value` and `expected_value` for every finding
- [ ] Original scanner rule ID preserved in `evidence.scanner_rule_id`
- [ ] `supports_check_mode=True` in the module's `AnsibleModule()` call
- [ ] Unit tests for the normalizer covering pass, fail, error, not_applicable, and edge cases
- [ ] Certification status declared (`certified`, `conformant`, or `uncertified`) with authority (see section 10). Optional but recommended for auto-populate. If omitted, users must configure this manually in the Settings form.

### Execution Environment

- [ ] `ee/execution-environment.yml` defined with `version: 3`
- [ ] Base image is `registry.redhat.io/ansible-automation-platform-26/ee-minimal-rhel9:latest`
- [ ] Galaxy dependencies include the compliance profile collection itself
- [ ] Python dependencies for scanner-specific libraries (if any)
- [ ] System dependencies for scanner binaries (Tier 1 only)
- [ ] EE builds successfully with `ansible-builder build`

### Pipeline Playbooks

- [ ] Pipeline playbooks for each workflow stage present under `playbooks/`
- [ ] Assessment playbook uses `gather_facts: true` on the target play to populate Controller's fact cache for platform validation
- [ ] Scan playbook (Tier 1) or fetch playbook (Tier 2) retrieves scanner results
- [ ] Normalize playbook transforms scanner output to CFF JSON
- [ ] Remediate playbook supports `--tags`, `--extra-vars`, and `--limit` for selective execution
- [ ] Check mode (audit-only) supported for drift detection without changes
- [ ] Verification is supported by re-running the assessment JT from the UI with `scanType: 'verification'` (no separate verify playbook needed)

### Workflow and Controller Integration

- [ ] `extensions/patterns/aap_config/job_templates.yml` with template definitions
- [ ] All job templates have `ask_inventory_on_launch: true`
- [ ] For Tier 2/3 profiles only: `extensions/patterns/aap_config/workflow.yml` with `infra.aap_configuration` YAML (Tier 1 uses a single JT, not a workflow)
- [ ] For Tier 2/3 profiles only: workflow template has `ask_inventory_on_launch: true` and child nodes have `inventory: null` (inherit from workflow)
- [ ] Remediation job template has `ask_tags_on_launch: true` (direct launch with job_tags)
- [ ] Remediation job template has `ask_variables_on_launch: true`
- [ ] Scan results POSTed to Backstage `/findings/ingest` endpoint (primary, ADR-007) with per-scan ingest token (ADR-010), or available via Controller events (fallback)
- [ ] Assessment JT default `extra_vars` include `remediate_jt_name` for Settings form auto-populate
- [ ] Assessment JT default `extra_vars` include `remediation_playbook` for auto-populate

### Portal / Backstage Integration

- [ ] `extensions/patterns/metadata.yml` with discovery metadata (name, display_name, version, domain, tags, applicable_os, frameworks, source)
- [ ] `extensions/patterns/metadata.yml` includes `platform:` spec declaring supported OS/device types (ADR-011). Optional but recommended for auto-populate. If omitted, users must configure this manually in the Settings form.
- [ ] `extensions/patterns/portal/metadata.yml` with portal-specific metadata
- [ ] `extensions/patterns/portal/backstage_template.yml` with Software Template (optional but recommended)

### Remediation

- [ ] Remediation uses `--tags` for rule selection, `--extra-vars` for parameter overrides, `--limit` for host targeting
- [ ] Remediation roles are scanner-agnostic (same role regardless of which scanner found the issue)
- [ ] Tunable parameters defined in rules YAML with `name`, `label`, `type`, `default` fields
- [ ] Disruption level documented for each remediatable rule (`low` / `medium` / `high`)

### Testing

- [ ] Unit tests for all custom modules (`plugins/modules/`)
- [ ] Integration test targets under `tests/integration/`
- [ ] Sanity test ignore file at `tests/sanity/ignore-2.15.txt` (or current Ansible version)
- [ ] Normalizer tested against real scanner output fixtures

---

## Appendix: Reference Implementation

The `security.compliance_rhel9_stig` collection in this repository is the reference Tier 1 compliance profile. It uses OpenSCAP with 366 STIG rules from `scap-security-guide`. Key files to study:

| File | Purpose |
|------|---------|
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/galaxy.yml` | Collection metadata |
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/meta/runtime.yml` | Ansible version requirements |
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/plugins/modules/normalize_xccdf.py` | XCCDF normalizer to CFF (366 rules) |
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/run_oscap.yml` | Assessment JT: scan targets (Play 1) + normalize on localhost (Play 2) |
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/normalize.yml` | Standalone normalize utility (debugging, Tier 2 reuse) |
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/remediate.yml` | Remediation: imports CaC playbook (standalone JT) |
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/docs/architecture.md` | Pipeline architecture and data flow |
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/docs/playbook-reference.md` | Playbook variables and usage examples |
| `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/docs/module-reference.md` | normalize_xccdf module documentation |
| `profiles/rhel9-stig/ee/execution-environment.yml` | EE definition (profile-level, used by ansible-builder) |

### Profile Metadata Convention (`meta/compliance-profile.yml`)

Each compliance collection MUST include a `meta/compliance-profile.yml` file declaring the profile's identity and capabilities. This file is the single source of truth for profile metadata and drives two critical behaviors:

1. **Settings form auto-populate** — the `install.yml` playbook reads this file and sets its fields as default `extra_vars` on the scan Job Template. When an admin selects that JT in the Backstage Settings form, the plugin fetches the JT's default extra_vars and auto-populates the form fields. This is the primary UX benefit of a well-configured profile.

2. **Self-documentation** — the file declares what scanner, framework, XCCDF profile, and certification status the collection provides. Even if auto-populate is not used, these values tell the admin exactly what to enter manually.

**Core principle: Every field in `compliance-profile.yml` maps to a Settings form field.** If the field is present in the JT's default extra_vars (via `install.yml`), the system auto-populates the form when the user selects that JT. If a field is missing, the user must fill it in manually -- so at minimum, the value should be documented in the collection's README so the user knows what to enter.

**Field reference:**

```yaml
profile:
  name: "Human-readable profile name"
  framework: "DISA_STIG | CIS | PCI_DSS | HIPAA | NIST_800_53"
  version: "V2R8 | v1.0.0 | etc."
  platform: "RHEL 9 | Windows Server 2022 | etc."
  scanner: "openscap | powerstig | custom"
  oscap_xccdf_profile: "xccdf_org.ssgproject.content_profile_stig"
  remediation_playbook: "playbooks/remediate.yml"
  remediate_jt_name: "compliance-remediate-<framework>-<platform>"
  certification:
    status: "certified | conformant | uncertified"
    authority: "NIST SCAP 1.2 | CIS | etc."
    disclaimer: "Human-readable explanation of certification scope"
  platform_spec:
    os_family: ["RedHat"]
    os_version: ["9"]
```

**Per-field auto-populate behavior:**

| Field | Settings Form Field | If Present in extra_vars | If Absent |
|-------|-------------------|------------------------|-----------|
| `name` | Display Name | Auto-populated | User must enter manually. Document in README. |
| `framework` | Compliance Framework | Auto-populated | User must select from dropdown. Document in README. |
| `version` | Framework Version | Auto-populated | User must enter manually. Document in README. |
| `scanner` | Scanner Type | Auto-populated | User must select from dropdown. |
| `oscap_xccdf_profile` | XCCDF Profile ID | Auto-populated (used by the scan playbook) | User must set in JT extra_vars. Document in README. |
| `remediation_playbook` | Remediation Playbook | Auto-populated | User must enter the playbook path manually. |
| `remediate_jt_name` | Remediate Job Template | Auto-populated; resolved by matching the JT name from Controller's JT list | Falls back to name search for `compliance-remediate`. For multi-profile deployments, always set this to avoid profile/JT mismatch. |
| `certification.status` | Certification Badge | Auto-populated; displayed as a badge on scan results | Defaults to `uncertified`. Document in README. |
| `certification.authority` | Certifying Authority | Auto-populated; displayed alongside the badge | Empty if not set. Document in README. |
| `certification.disclaimer` | Certification Disclaimer | Auto-populated; shown in tooltip | Not displayed. Optional but recommended for `conformant` profiles. |
| `platform_spec` | Platform Requirements | Auto-populated; used for pre-launch inventory validation | No platform validation performed. Optional but recommended for auto-populate. If omitted, users must configure this manually in the Settings form. |

**Auto-populate flow:**

When a user creates a new profile in the Backstage Settings tab and selects a scan Job Template, the plugin fetches the JT's default `extra_vars` via the Controller API (`GET /job-templates/:id`). If the extra_vars contain `profile_name`, `framework`, `certification_status`, `certification_authority`, `remediate_jt_name`, and `remediation_playbook` keys, the form fields auto-populate. For `remediate_jt_name`, the plugin resolves the name against the Controller's JT list to set the Remediate Job Template ID. All fields remain editable -- the auto-populate provides defaults, not constraints.

If the JT has no extra_vars (e.g., a manually created JT without `install.yml`), the user fills in the fields manually. After the first scan, the CFF output confirms the profile metadata via the self-healing path.

**install.yml and extra_vars:** The `install.yml` playbook in each profile reads `meta/compliance-profile.yml` and uses `infra.aap_configuration` to set the values as default `extra_vars` on the scan JT. This is the bridge between the collection metadata and the auto-populate behavior. If you skip `install.yml` and create the JT manually, ensure you set the same extra_vars keys -- in particular `remediate_jt_name` and `remediation_playbook` which link the assessment profile to its remediation JT. Without `remediate_jt_name`, the plugin falls back to a generic name search and may launch the wrong remediation JT in multi-profile deployments. Document all values in the profile README for manual entry.
