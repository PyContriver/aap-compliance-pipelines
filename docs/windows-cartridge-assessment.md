# Assessment: infra.windows_ops Integration with Compliance Profile Model

**Date:** 2026-05-13
**Repo:** [redhat-cop/infra.windows_ops](https://github.com/redhat-cop/infra.windows_ops)
**Collection:** `infra.windows_ops` v2.0.1 (GPL-3.0-or-later)
**Author:** Red Hat Ansible Content Team (redhat-cop community of practice)

## Summary

`infra.windows_ops` contains two compliance roles (`windows_manage_stig`, `windows_manage_cis`) covering DISA STIG and CIS Benchmarks for Windows Server 2019/2022/2025. The content is production-quality with data-driven control matrices, rule-level filtering, check-mode audit support, and JSON+HTML reporting. This assessment evaluates what's needed to integrate it into the compliance profile model prototyped in `aap-compliance-pipelines`.

## Collection Scope

| Area | Roles | Purpose |
|------|-------|---------|
| Security compliance | `windows_manage_stig`, `windows_manage_cis` | DISA STIG + CIS Benchmark hardening and audit |
| Infrastructure ops | `windows_manage_iis`, `windows_manage_service`, `windows_manage_updates` | Windows Server management |

Only the compliance roles are relevant to compliance profile integration.

### Benchmark Coverage

**DISA STIG (`windows_manage_stig`):**

| Platform | STIG Version | Automated | Manual | Total |
|----------|-------------|-----------|--------|-------|
| Windows Server 2019 | V3R7 | 248 | 36 | 284 (100%) |
| Windows Server 2022 | V2R7 | 274 | 9 | 283 (100%) |
| Windows Server 2025 | V1R0-1 | 248 | 33 | 281 (100%) |

**CIS Benchmarks (`windows_manage_cis`):**

| Platform | CIS Version | Level 1 | Level 2 | Total |
|----------|------------|---------|---------|-------|
| Windows Server 2019 | v3.0.0 | 165 | 45 | 210 |
| Windows Server 2022 | v3.0.0 | 165 | 45 | 210 |
| Windows Server 2025 | v1.0.0 | 165 | 45 | 210 |

## What Already Aligns

### Data-Driven Control Matrix Pattern

The roles define controls as structured dictionaries — the same pattern the compliance profile model expects:

```yaml
windows_manage_stig_registry_settings:
  - stig_id: V-254351
    title: "Windows Server 2022 Application Compatibility..."
    path: HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppCompat
    name: DisableInventory
    data: 1
    type: dword
    category: autoplay_media
    severity: CAT III
```

Each control carries its V-ID, severity, expected value, and category. Results are tracked in `windows_manage_stig_results` with PASS/FAIL/MANUAL status, current vs expected values, and change tracking.

### Configurable Selective Execution

- `windows_manage_stig_skip_rules: []` — skip specific V-IDs
- `windows_manage_stig_only_rules: []` — whitelist mode
- `windows_manage_stig_categories` — category-level filtering
- Tag-based execution: `--tags cat_i`, `--tags stig_V-254238`, `--tags audit`
- Policy value overrides via defaults variables (password length, lockout threshold, etc.)
- `windows_manage_stig_compliance_threshold: 95` — configurable pass/fail threshold

This maps directly to the compliance profile model's selective remediation via `--tags` + `--extra-vars` + `--limit`.

### Check Mode (Audit-Only) Support

Full check-mode support enables scan-only assessment distinct from remediation. The `compliance_drift_detection.yml` playbook demonstrates continuous compliance monitoring — equivalent to the "daily drift detection" use case.

### Multi-Version Auto-Detection

Single role handles 2019/2022/2025 with automatic OS detection and version-isolated task directories. Feature flags cleanly separate version-specific behavior (DNS-over-HTTPS, SMB QUIC, TLS 1.3, Hotpatching, Credential Guard).

### Existing Backstage/RHDH Patterns

The `extensions/patterns/` directory already has Backstage scaffolder templates, AWX survey definitions, and EE configs — but only for the ops roles (IIS, service, updates), not for the compliance roles.

## The Fundamental Tension

The RHEL compliance profile architecture makes a deliberate decision: **"We don't write remediation playbooks."** For RHEL, `scap-security-guide` RPM IS the remediation engine (55K lines, 4474 tasks, maintained by Red Hat, updated quarterly by DISA). The compliance profile just orchestrates it.

`infra.windows_ops` **is** hand-written remediation content. It's the Windows equivalent of `scap-security-guide`, not a wrapper around it. This isn't a problem — it's the right approach for Windows since there's no ComplianceAsCode-equivalent RPM for Windows Server STIGs. But the integration pattern differs from RHEL:

- **RHEL:** Compliance profile wraps `scap-security-guide` RPM content → selective execution via `--tags`
- **Windows:** Compliance profile wraps `infra.windows_ops` collection → selective execution via `skip_rules`/`only_rules`/`--tags`

The content engine is a collection dependency rather than a system package, but the orchestration model is the same.

## What Needs to Be Done

### Tier 1: Structural Alignment (Low effort, high impact)

#### 1.1 Add Compliance Patterns

Create `extensions/patterns/compliance-windows-stig/` and `extensions/patterns/compliance-windows-cis/` matching the RHEL pattern structure:

```
extensions/patterns/compliance-windows-stig/
  metadata.yml              # Compliance profile discovery metadata
  ee/
    execution-environment.yml  # EE Builder definition
  playbooks/
    scan-windows-stig.yml      # Audit-only pipeline playbook
    remediate-windows-stig.yml # Remediation pipeline playbook
  template_rhdh/
    compliance_windows_stig.yml  # Backstage scaffolder template
  template_surveys/
    scan_survey.json           # AWX survey for scan parameters
    remediation_survey.json    # AWX survey for remediation parameters
```

#### 1.2 Create EE Profile

`ee/execution-environment.yml` for the compliance use case:

```yaml
version: 3
build_arg_defaults:
  ANSIBLE_GALAXY_CLI_COLLECTION_OPTS: '--pre'
dependencies:
  galaxy: requirements.yml   # infra.windows_ops, ansible.windows, community.windows
  python:
    - pywinrm>=0.4.3
    - requests-credssp
    - requests-ntlm
  system: []
images:
  base_image:
    name: registry.redhat.io/ansible-automation-platform-26/ee-minimal-rhel9:latest
```

#### 1.3 Add Pattern Metadata

`metadata.yml` for compliance profile discovery:

```yaml
name: compliance-windows-stig
display_name: Windows Server STIG Compliance Pipeline
version: 2.0.1
domain: security
tags: [compliance, stig, windows, disa, security]
applicable_os: [Windows Server 2019, Windows Server 2022, Windows Server 2025]
frameworks: [DISA STIG V3R7 (2019), DISA STIG V2R7 (2022), DISA STIG V1R0-1 (2025)]
source: redhat-cop/infra.windows_ops
content_collection: infra.windows_ops
content_role: windows_manage_stig
```

#### 1.4 Add Portal Discovery Metadata

`portal/` directory with Backstage template for auto-discovery when the collection is installed in Hub.

#### 1.5 Add `argument_specs.yml`

Both `windows_manage_stig` and `windows_manage_cis` lack `meta/argument_specs.yml`. Adding these enables AAP variable validation in job template surveys and improves documentation.

#### 1.6 Refactor Playbooks for Pipeline Model

The existing playbooks (`compliance_hardening.yml`, `compliance_drift_detection.yml`, `compliance_audit_report.yml`) are monolithic. The pipeline model expects discrete workflow nodes:

| Pipeline Stage | Existing | Needed |
|---------------|----------|--------|
| Gather | Inline in role | Separate `gather-windows-facts.yml` (optional, for Track A) |
| Scan/Evaluate | `compliance_audit_report.yml` (check mode) | `scan-windows-stig.yml` — audit-only playbook |
| Normalize | N/A | `normalize-findings.yml` — transform results to CFF |
| Report | Inline `generate_report.yml` | Keep as-is, add CFF output |
| Remediate | `compliance_hardening.yml` | `remediate-windows-stig.yml` — selective execution |
| Verify | N/A | `verify-windows-stig.yml` — re-scan after remediation |

### Tier 2: Output Normalization (Medium effort, critical for dashboard)

#### 2.1 Common Findings Format Normalizer

The role's `windows_manage_stig_results` output needs transformation to the Common Findings Format (CFF) JSON schema v1.0.0. The field mapping is straightforward:

| Role Output | CFF Field | Transformation |
|------------|-----------|----------------|
| `stig_id` | `stig_id` | Direct |
| `stig_id` | `rule_id` | Direct (or derive from V-ID) |
| `title` | `title` | Direct |
| `status` (PASS/FAIL/MANUAL) | `status` (pass/fail/not_checked) | Lowercase, MANUAL → not_checked |
| `severity` (CAT I/II/III) | `severity` (CAT_I/CAT_II/CAT_III) | Replace space with underscore |
| `current_value` | `hosts[].actualValue` | Direct |
| `expected_value` | `hosts[].expectedValue` | Direct |
| `description` | `description` | Direct |
| `category` | `category` | Direct |
| (not present) | `disruption` | Derive from category or default to 'medium' |
| (not present) | `parameters` | Extract from defaults vars |

Implementation options:
- **Option A:** A `normalize_findings` role/task included in the pipeline playbook that reads `windows_manage_stig_results` fact and writes CFF JSON
- **Option B:** A `normalize_windows_findings` module (Python) analogous to `normalize_xccdf`
- **Option C:** A callback plugin that intercepts role results and emits CFF

Option A is simplest and consistent with the collection's existing patterns.

#### 2.2 Results Push to Backend

Currently, reports are written as flat files on the managed node. The pipeline model needs results pushed to the Backstage compliance backend API (`POST /api/compliance/scans/:id/findings`) or written to Controller job artifacts for workflow-level retrieval.

A final play in the pipeline playbook can POST the CFF JSON to the backend, keyed by the workflow job ID passed as an extra var.

### Tier 3: Track A Pre-Assessment (Higher effort, deferrable)

#### 3.1 `compliance_gather` for Windows

A Windows-specific module that collects registry values, security policies, services, audit policies, and user rights in a single WinRM round-trip. This enables the "17 min for 20K hosts" fast-scan model.

Not required for initial integration — Track B (full role execution in check mode) works today.

#### 3.2 `compliance_evaluate` for Windows

A module that takes gathered Windows facts + rule definitions and evaluates them on localhost. Enables centralized evaluation without per-host WinRM round-trips.

#### 3.3 Track A Rule Definitions

Extract the control matrices from task YAML into standalone `files/rules/` YAML that `compliance_evaluate` can consume. Significant refactor — defer until Track A value is validated.

## What Does NOT Need to Change

- **The remediation content itself** — task files, control matrices, enforcement logic are production-quality
- **The configurable defaults** — `skip_rules`, `only_rules`, `categories`, policy overrides all align
- **Multi-version detection** — automatic 2019/2022/2025 routing is a feature
- **Existing HTML/JSON reports** — keep for standalone use; CFF is additive
- **IIS/service/updates roles** — ops roles, not compliance, no compliance profile alignment needed

## Recommended Approach

**Option A: Compliance Profile Wrapper Collection (Preferred)**

Create `security.compliance_windows_stig` as a thin wrapper that:
1. Depends on `infra.windows_ops` (in `galaxy.yml` requirements)
2. Provides pattern metadata, EE profile, and pipeline playbooks
3. Includes a `normalize_findings` role that transforms results → CFF
4. Ships compliance profile registry metadata for Backstage discovery

This avoids forking or restructuring `infra.windows_ops` (community repo under `redhat-cop`) while fitting cleanly into the compliance profile model.

**Option B: Direct Integration**

Add the patterns, normalizer, and metadata directly to `infra.windows_ops`. The `extensions/patterns/` directory already exists. This is simpler but requires buy-in from the redhat-cop maintainers and couples the collection to the compliance profile model.

## Effort Estimate

| Tier | Work | Estimate |
|------|------|----------|
| 1 - Structural alignment | Patterns, EE, metadata, argument_specs | 2-3 days |
| 2 - Output normalization | CFF normalizer, results push, pipeline playbooks | 3-5 days |
| 3 - Track A pre-assessment | gather/evaluate modules, rule extraction | 2-3 weeks |
| **Total (Tier 1+2)** | **Minimum viable compliance profile** | **~1 week** |

## PowerSTIG Consideration

The compliance profile model designates PowerSTIG as the Tier 1 Windows scanner. `infra.windows_ops` doesn't use PowerSTIG — it has its own scanning/remediation logic. Two paths:

1. **infra.windows_ops as content engine (like scap-security-guide):** The collection IS the scanner+remediator. PowerSTIG becomes a Tier 2 alternative for customers who want DSC-native compliance.
2. **PowerSTIG as scanner, infra.windows_ops as remediator:** PowerSTIG handles audit-grade scanning (produces XCCDF/CKL), `infra.windows_ops` handles remediation. Requires a `normalize_powerstig` module.

Option 1 is simpler and leverages the existing content. PowerSTIG integration can be added later as a Tier 2 scanner option.
