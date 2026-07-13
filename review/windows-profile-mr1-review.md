---
title: "Architect Review: Windows Server Compliance Profile (MR #1)"
type: review
audience: [developer, architect]
product: "AAP Compliance Dashboard"
date: 2026-07-13
mr_url: https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines/-/merge_requests/1
upstream_repo: https://github.com/stevefulme1/compliance-windows
author: Steve Fulmer (sfulmer@redhat.com)
status: changes-requested
---

# Architect Review: Windows Server Compliance Profile (MR #1)

## Context

GitLab MR #1 adds `security.compliance_windows` v0.1.0 — a compliance profile wrapper collection for Windows Server DISA STIG, CIS Benchmarks, HIPAA, and PCI-DSS v4.0. The collection wraps `infra.windows_ops` (redhat-cop) as its content engine and adds CFF normalization, pipeline playbooks, regulatory crosswalks, and Track A pre-assessment.

**Commit:** `4aa3cab` (2026-05-21), branched 527 commits behind current main.

**Contribution target:** Fixes should be contributed back to `stevefulme1/compliance-windows` (upstream). The collection is consumed as an EE dependency — it does NOT live inside our `profiles/` directory.

---

## Verdict: 2.8 / 5 — Strong Architecture, Incomplete Execution

The collection demonstrates solid architectural understanding of the compliance profile model (scanner orchestrator pattern, CFF normalization, crosswalk mapping, Track A pre-assessment). However, it is missing critical artifacts required for dashboard integration, has no tests, ships only 10 of 300+ rules, and diverges from established patterns in several areas that will prevent it from working end-to-end.

---

## Section 1: What Must Change (Blockers)

These items MUST be resolved before this collection can be used with the dashboard or shipped as an EE.

### 1.1 Add `meta/compliance-profile.yml`

**Problem:** The collection has no `compliance-profile.yml`. This is the single file the dashboard uses for profile identity, display configuration, platform guards, and certification metadata. Without it, the profile cannot be registered.

**What to create:** `meta/compliance-profile.yml`

**Reference:** Read any RHEL profile's version at `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/meta/compliance-profile.yml` for the complete schema.

**Required fields:**

```yaml
profile:
  slug: "windows-server-stig"
  name: "DISA STIG Windows Server"
  framework: "DISA_STIG"
  version: "V2R7"
  platform: "Windows Server 2022"
  scanner: "ansible"    # or "powerstig"

  remediation_playbook: "playbooks/remediate-windows-stig.yml"
  remediate_jt_name: "compliance-remediate-stig-windows"

  certification:
    status: "uncertified"
    authority: "N/A"
    disclaimer: >
      infra.windows_ops provides community-maintained STIG content.
      Not DISA-validated. Scan results require independent verification.

  platform_spec:
    os_family: ["Windows"]
    os_version: ["2019", "2022", "2025"]

  display:
    gauge_label: "compliance rate"
    gauge_unit: "rules"
    remediation_verb: "Remediate"
    severity_map:
      CAT_I: "CAT I (High)"
      CAT_II: "CAT II (Medium)"
      CAT_III: "CAT III (Low)"
    columns:
      - field: stig_id
        label: "STIG ID"
      - field: title
        label: "Rule"
      - field: severity
        label: "Severity"
      - field: status
        label: "Status"
      - field: fix_text
        label: "Fix"
```

**If CIS is a separate profile** (see Section 3), create a second file for the CIS profile with `framework: "CIS"`, `gauge_label: "benchmark score"`, and CIS-appropriate columns.

### 1.2 Add `install.yml` and `uninstall.yml`

**Problem:** No install playbook exists. This is how profiles register their assessment and remediation Job Templates on Controller.

**What to create:** Top-level `install.yml` and `uninstall.yml` following the RHEL pattern.

**Reference:** `profiles/rhel9-stig/install.yml` and `profiles/supply-chain/install.yml`

**install.yml must:**
1. Create assessment JT on Controller (pointing to scan playbook, with `ask_variables_on_launch: true`, `ask_inventory_on_launch: true`, `use_fact_cache: true`)
2. Create remediation JT on Controller (with `ask_tags_on_launch: true`, `ask_limit_on_launch: true`)
3. Embed profile metadata as JT `extra_vars` (including `profile_slug`, `remediate_jt_name`, `remediation_playbook`)
4. (Future-ready) POST to `/api/compliance/profiles/connect` with `failed_when: false`

**uninstall.yml must:**
- Disconnect the profile (never delete historical data)
- Mark profile as disconnected in dashboard backend

### 1.3 Fix the Results Push Pattern (ADR-033/034)

**Problem:** `playbooks/tasks/push_results.yml` uses `body_format: json` with the full findings array in the request body. This will OOM on large scans and doesn't match the dashboard's ingest endpoint expectations.

**Current (broken):**
```yaml
- name: Push results to Backstage API
  ansible.builtin.uri:
    url: "{{ compliance_backstage_url }}/api/compliance/scans/{{ compliance_scan_id }}/findings"
    body: "{{ push_results_cff_output | to_json }}"
    body_format: json
```

**Required pattern (NDJSON streaming):**
1. Normalizer writes NDJSON files via `compose_post_body` (preamble line + one finding per line)
2. Playbook POSTs each file using `uri` with `src` parameter (streams from disk, never loads into Jinja2)
3. Content-Type: `application/x-ndjson`
4. Endpoint: `/api/compliance/findings/ingest` (not `/scans/:id/findings`)
5. Per-host looping (ADR-030) — normalize one host at a time to prevent OOM

**Reference:** `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/run_oscap.yml` Play 2, tasks starting at "Find composed NDJSON files".

**Extra vars expected by the ingest endpoint:** `scan_id`, `ingest_token` (per-scan security token, ADR-010), `backstage_api_url`.

### 1.4 Fix `normalize_powerstig` — Scan Must Not Modify Targets

**Problem:** The `normalize_powerstig` role runs `Start-DscConfiguration -Path ... -Wait -Force` which **applies the DSC configuration** before testing it. A scan/audit operation must never modify the target host.

**Current (dangerous):**
```powershell
Start-DscConfiguration -Path "$env:TEMP\StigDsc" -Wait -Force
$testResult = Test-DscConfiguration -Detailed
```

**Fix:** Remove `Start-DscConfiguration`. Use `Test-DscConfiguration` directly with the generated MOF:
```powershell
$null = & { WindowsServer -OsVersion $osTag -StigVersion $stigVersion -OutputPath "$env:TEMP\StigDsc" }
$testResult = Test-DscConfiguration -Path "$env:TEMP\StigDsc" -Detailed
```

Or if PowerSTIG requires the configuration to be applied first for testing, this scanner option should be clearly documented as **remediation-first** and not offered as a scan-only option.

### 1.5 Add Unit Tests

**Problem:** Zero tests exist. Our RHEL profiles have 127 collection-level tests (19 per XCCDF profile + 44 CycloneDX + 60 cross-profile structure tests).

**Minimum required:**
1. `tests/unit/plugins/modules/test_compliance_evaluate.py` — Test the evaluation module:
   - Registry check (pass/fail/not-found)
   - Secpol check (pass/fail)
   - Auditpol check (pass/fail)
   - Service check (pass/fail)
   - All 8 operators (eq, ne, ge, le, gt, lt, contains, not_contains)
   - Severity mapping (high→CAT_I, medium→CAT_II, low→CAT_III)
   - Error handling (unknown operator, evaluation exception)
   - CFF output schema compliance

2. `tests/unit/plugins/filter/test_cff_filters.py` — Test the CFF transformation filters:
   - `to_cff_stig` (status mapping, severity mapping, dual camelCase/snake_case, empty input)
   - `to_cff_cis` (CIS-specific field mapping)
   - `to_cff_powerstig` (DSC result mapping, InDesiredState boolean handling)

3. `tests/unit/plugins/filter/test_crosswalk_filters.py` — Test the crosswalk filters:
   - `map_controls` (rule→control mapping, empty findings, unmapped rules)
   - `crosswalk_summary` (pass/fail/partial/gap/unmapped status computation)

**Target:** 40+ tests minimum. Use pytest, matching our RHEL profile test structure.

### 1.6 Add Proper EE Definition for Profile Delivery

**Problem:** The EE definitions under `extensions/patterns/` reference `ee-minimal-rhel9` with Python deps but don't follow the build pattern our CI uses. There is no `ee/execution-environment.yml` at the profile root level.

**What to create:** A proper EE definition that can be built by `ansible-builder` and added to the GitHub Actions build matrix.

**Required structure:**
```yaml
version: 3

build_arg_defaults:
  ANSIBLE_GALAXY_CLI_COLLECTION_OPTS: '--pre'

options:
  package_manager_path: /usr/bin/microdnf

images:
  base_image:
    name: registry.redhat.io/ansible-automation-platform-26/ee-minimal-rhel9:latest

dependencies:
  galaxy:
    collections:
      - name: ansible.windows
      - name: community.windows
      - name: infra.windows_ops
  python:
    - pywinrm>=0.4.3
    - requests-credssp
    - requests-ntlm

additional_build_steps:
  prepend_galaxy:
    - COPY _build/collections/ /usr/share/ansible/collections/
  append_final:
    - RUN ansible-galaxy collection list security.compliance_windows
    - RUN ansible-galaxy collection list infra.windows_ops
    - RUN ansible-galaxy collection list ansible.windows
    - RUN python3 -c "import winrm; print('pywinrm OK')"
```

**Key difference from RHEL:** No system packages (no OpenSCAP). The content engine (`infra.windows_ops`) is a collection, not an RPM. WinRM Python packages replace the OpenSCAP scanner packages.

### 1.7 Fix License Mismatch

**Problem:** `galaxy.yml` declares `license_file: LICENSE` which contains Apache-2.0, but `COPYING` contains GPL-3.0. The upstream `infra.windows_ops` dependency is GPL-3.0.

**Fix:** A wrapper collection with GPL-3.0 dependencies should use GPL-3.0 or GPL-compatible license. Either:
- Change `LICENSE` to GPL-3.0 and update `galaxy.yml`, OR
- Remove `COPYING` and ensure `LICENSE` is authoritative

---

## Section 2: What Should Change (Quality)

These items are important for correctness and maintainability but are not strict blockers.

### 2.1 Consolidate Duplicate Evaluation Logic

**Problem:** Rule evaluation is implemented twice:
1. `plugins/modules/compliance_evaluate.py` — Ansible module (267 lines)
2. `plugins/filter/cff_filters.py` → `evaluate_rule()` function (100+ lines)

Both implement the same operators, check types, and error handling with slight differences.

**Fix:** Keep the module (`compliance_evaluate.py`) as the authoritative implementation. Remove `evaluate_rule()` from `cff_filters.py`. Update the `compliance_evaluate` role to use the module instead of the filter.

### 2.2 Eliminate Rule Schema Duplication

**Problem:** Each rule in `rules/stig_windows_server_2022.yml` has redundant fields:

| Top-level | Nested equivalent |
|-----------|-------------------|
| `path` | `check.params.key` or `check.params.path` |
| `expected` | `check.params.value` |
| `check_type` | `check.type` |
| `property` | `check.params.property` |
| `operator` | `check.params.operator` |

**Fix:** Pick one schema — either flat top-level fields OR nested `check.params`. The module should read from one location. Recommend the nested `check` structure since it groups all evaluation parameters together.

### 2.3 Expand Rule Coverage

**Problem:** Only 10 rules in `stig_windows_server_2022.yml`. The `infra.windows_ops` collection has 248+ automated rules for Windows Server 2022 V2R7. Crosswalk profiles reference V-IDs (V-254243, V-254247, etc.) that don't exist in the rules file.

**Fix:** Either:
- **Option A:** Generate the full rules YAML from `infra.windows_ops` control matrices (similar to how our `extract_rule_metadata.py` generates from XCCDF datastreams)
- **Option B:** Reference upstream rule definitions at runtime instead of maintaining a separate copy

Option A is preferred — it keeps the collection self-contained and enables the Track A pre-assessment model.

### 2.4 Fix Terminology

**In these files, replace:**
- "Backstage" → "Ansible Portal" (in `portal/catalog-info.yml`, `playbooks/tasks/push_results.yml`, any comments)
- "compliance cartridge" → "compliance profile" (commit message, any docs)

### 2.5 Fix `push_results.yml` Variable Names

**Problem:** Extra var names don't match the dashboard convention.

| MR uses | Dashboard expects |
|---------|-------------------|
| `compliance_backstage_url` | `backstage_api_url` |
| `compliance_backstage_token` | `ingest_token` |
| `compliance_scan_id` | `scan_id` |
| `compliance_results_backend` | (not needed — always POST to API) |

**Fix:** Align variable names with the RHEL profile convention so the dashboard's scan launcher can pass them without translation.

### 2.6 Add `aap_impact` Classification to Rules

**Problem:** Rules don't have `aap_impact` or `aap_impact_reason` fields. These are used by the dashboard to show remediation warnings (e.g., "this rule may break SSH connectivity").

**Fix:** Add to each rule:
```yaml
aap_impact: safe          # safe | breaks-connectivity | breaks-idempotency | high-risk
aap_impact_reason: ""     # explanation when not 'safe'
```

For Windows, `breaks-connectivity` would apply to rules that affect WinRM (firewall rules, TLS settings, service accounts).

---

## Section 3: Split Recommendation

### Current State: One Collection, Five Frameworks

The MR bundles DISA STIG, CIS, HIPAA crosswalk, PCI-DSS crosswalk, and PowerSTIG into a single `security.compliance_windows` collection.

### Recommendation: Keep One Collection, Register as Multiple Profiles

**Don't split the collection** — the shared infrastructure (CFF filters, compliance_gather, crosswalk engine) would be duplicated. Instead:

**Register each framework as a separate compliance profile** in the dashboard:

| Profile Slug | Framework | Scanner | compliance-profile.yml |
|-------------|-----------|---------|------------------------|
| `windows-server-stig` | DISA_STIG | ansible (infra.windows_ops) | Primary profile |
| `windows-server-cis-l1` | CIS | ansible (infra.windows_ops) | Separate profile |
| `windows-server-cis-l2` | CIS | ansible (infra.windows_ops) | Separate profile |

**HIPAA and PCI-DSS are NOT separate profiles** — they're crosswalk views on top of CIS/STIG scan results. The crosswalk feature could become a Tier 2 tab widget in the dashboard's dynamic tab system, showing regulatory control coverage alongside the base compliance results.

**PowerSTIG is NOT a separate profile** — it's an alternative scanner option for the same STIG framework. Handle via a `compliance_scanner` variable on the assessment JT, not a separate profile registration.

**Action items:**
1. Create `meta/compliance-profile.yml` for the STIG profile (primary)
2. Create `meta/compliance-profile-cis-l1.yml` and `meta/compliance-profile-cis-l2.yml` (or use a single `meta/compliance-profiles/` directory)
3. Create separate `install.yml` sections (or a `--profile` parameter) that register each as a distinct JT pair on Controller
4. Each profile gets its own EE (or one shared EE with all deps)

---

## Section 4: EE Delivery Checklist

For this collection to ship as an EE that works with the dashboard, verify:

### Build Artifacts
- [ ] `ee/execution-environment.yml` — ansible-builder v3 format, `ee-minimal-rhel9` base
- [ ] `ee/requirements.yml` — Galaxy collection requirements (infra.windows_ops, ansible.windows, community.windows)
- [ ] `ee/requirements.txt` — Python requirements (pywinrm, requests-credssp, requests-ntlm)
- [ ] Collection source copied into `_build/collections/` during CI build
- [ ] Verification steps in `append_final` (collection list, python import check)

### CI/CD Integration
- [ ] Added to `.github/workflows/build-ee.yml` matrix with `image_suffix: stig-windows`
- [ ] GHCR image: `ghcr.io/cross-logic/compliance-stig-windows:latest`
- [ ] Skopeo mirror command documented for PAH deployment
- [ ] EE registered on Controller with correct image pull spec

### Install Playbook
- [ ] `install.yml` creates assessment JT with `execution_environment` reference
- [ ] `install.yml` creates remediation JT with `ask_tags_on_launch: true`
- [ ] Profile metadata embedded as JT `extra_vars`
- [ ] `remediate_jt_name` and `remediation_playbook` set for Settings tab auto-populate

### Profile Registration
- [ ] `meta/compliance-profile.yml` with `platform_spec.os_family: ["Windows"]`
- [ ] Display config with Windows-appropriate columns and labels
- [ ] Certification block with honest `uncertified` status

---

## Section 5: Contribution Strategy

### Upstream Target: `stevefulme1/compliance-windows`

All fixes should be contributed as PRs to Steve's repo. The collection is a dependency consumed via EE, not embedded in our repo.

### Recommended PR Sequence

**PR 1: Core Profile Artifacts** (blockers 1.1, 1.2, 1.7)
- Add `meta/compliance-profile.yml`
- Add `install.yml` and `uninstall.yml`
- Fix license to GPL-3.0
- Fix terminology (Backstage → Ansible Portal)

**PR 2: Fix Results Push + Normalizer Safety** (blockers 1.3, 1.4)
- Rewrite `push_results.yml` to use NDJSON streaming via `compose_post_body` + `uri src`
- Fix `normalize_powerstig` to not apply DSC configuration during scan
- Align extra var names with dashboard convention

**PR 3: EE Definition + CI** (blocker 1.6)
- Add proper `ee/execution-environment.yml`
- Add `ee/requirements.yml` and `ee/requirements.txt`
- Add verification build steps

**PR 4: Tests** (blocker 1.5)
- Add `tests/unit/plugins/modules/test_compliance_evaluate.py`
- Add `tests/unit/plugins/filter/test_cff_filters.py`
- Add `tests/unit/plugins/filter/test_crosswalk_filters.py`
- Target: 40+ tests

**PR 5: Quality Improvements** (section 2 items)
- Consolidate duplicate evaluation logic
- Eliminate rule schema duplication
- Add `aap_impact` to rules
- Expand rule coverage (10 → 248+)

### What We Do In Our Repo

1. Add `windows-server-stig` to the GitHub Actions EE build matrix
2. Add skopeo mirror command to deployment docs
3. Add Windows profile to `MockDataSeeder.ts` (mock mode)
4. Test platform guards with `os_family: "Windows"` in fact cache
5. Verify CFF ingest endpoint handles Windows findings correctly

---

## Section 6: What's Good (Keep As-Is)

These aspects are well-designed and should be preserved:

1. **CFF filter architecture** — Three distinct filters (`to_cff_stig`, `to_cff_cis`, `to_cff_powerstig`) with dual camelCase/snake_case output is the right pattern for multi-scanner support.

2. **Crosswalk engine** — HIPAA and PCI-DSS crosswalk profiles with pass/fail/partial/gap/unmapped status per control is bonus value that none of our RHEL profiles have. The `map_controls` and `crosswalk_summary` filters are clean and reusable.

3. **Track A pre-assessment** — `compliance_gather` with `Gather-ComplianceData.ps1` collecting registry, secpol, auditpol, and services in a single WinRM round-trip is the fast-scan model our assessment doc recommended. The `compliance_evaluate` module for offline evaluation on localhost is architecturally sound.

4. **Argument specs** — All 6 roles have `meta/argument_specs.yml` with typed parameters. Our RHEL profiles don't have these yet.

5. **PowerShell script quality** — `Gather-ComplianceData.ps1` is well-structured with proper error handling, temp file cleanup, and JSON output. The single-round-trip design minimizes WinRM overhead.

6. **Multi-scanner design** — Supporting both `infra.windows_ops` (Ansible-native) and PowerSTIG (DSC-native) via the `compliance_scanner` variable is forward-looking and matches the Tier 1/Tier 2 scanner architecture (ADR-001).

7. **Pattern metadata** — `extensions/patterns/compliance-windows-stig/metadata.yml` follows the SDP-0005 pattern structure with `source_collection`, `wrapper_collection`, `normalizer_role`, and `scanner_options`.

---

## Appendix A: File-by-File Disposition

| File | Action | Notes |
|------|--------|-------|
| `galaxy.yml` | **Fix** | License to GPL-3.0, update repo URL |
| `meta/compliance-profile.yml` | **Create** | Missing — blocker |
| `meta/ee_profile.yml` | **Keep** | Good metadata |
| `meta/runtime.yml` | **Keep** | Standard |
| `playbooks/scan-windows-stig.yml` | **Fix** | Add NDJSON streaming |
| `playbooks/scan-windows-cis.yml` | **Fix** | Add NDJSON streaming |
| `playbooks/scan-windows-hipaa.yml` | **Fix** | Add NDJSON streaming |
| `playbooks/scan-windows-pci.yml` | **Fix** | Add NDJSON streaming |
| `playbooks/scan.yml` | **Fix** | Add NDJSON streaming |
| `playbooks/remediate.yml` | **Fix** | Remove inline PowerShell Jinja2 injection |
| `playbooks/remediate-windows-stig.yml` | **Keep** | Clean |
| `playbooks/remediate-windows-cis.yml` | **Keep** | Clean |
| `playbooks/verify-windows-stig.yml` | **Keep** | Clean |
| `playbooks/verify-windows-cis.yml` | **Keep** | Clean |
| `playbooks/gather_facts.yml` | **Keep** | Good Track A pattern |
| `playbooks/evaluate.yml` | **Keep** | Good Track A pattern |
| `playbooks/normalize.yml` | **Keep** | Utility playbook |
| `playbooks/tasks/push_results.yml` | **Rewrite** | Must use NDJSON + uri src |
| `plugins/modules/compliance_evaluate.py` | **Keep** | Authoritative evaluator |
| `plugins/filter/cff_filters.py` | **Fix** | Remove `evaluate_rule()` duplicate |
| `plugins/filter/crosswalk_filters.py` | **Keep** | Clean, reusable |
| `roles/compliance_gather/*` | **Keep** | Good architecture |
| `roles/compliance_evaluate/*` | **Fix** | Use module, not filter |
| `roles/normalize_stig_findings/*` | **Keep** | Clean |
| `roles/normalize_cis_findings/*` | **Keep** | Clean |
| `roles/normalize_powerstig/*` | **Fix** | Remove Start-DscConfiguration |
| `roles/compliance_crosswalk/*` | **Keep** | Clean, reusable |
| `rules/stig_windows_server_2022.yml` | **Expand** | 10 → 248+ rules |
| `compliance_profiles/hipaa.yml` | **Keep** | Good crosswalk |
| `compliance_profiles/pci_dss_v4.yml` | **Keep** | Good crosswalk |
| `extensions/patterns/*` | **Keep** | Good SDP metadata |
| `portal/catalog-info.yml` | **Fix** | Terminology |
| `ee/execution-environment.yml` | **Create** | Missing — blocker |
| `install.yml` | **Create** | Missing — blocker |
| `uninstall.yml` | **Create** | Missing — blocker |
| `tests/*` | **Create** | Missing — blocker |
| `LICENSE` | **Fix** | Must be GPL-3.0 |
| `COPYING` | **Keep** | Already GPL-3.0 |

## Appendix B: Dashboard Changes Required (Our Side)

| Item | Effort | Description |
|------|--------|-------------|
| Platform guards for Windows | 0.5 day | Verify `os_family: "Windows"` works in fact cache lookup. Windows hosts report `ansible_os_family: "Windows"` — confirm the scan validate endpoint handles this. |
| MockDataSeeder Windows profile | 0.5 day | Add a Windows STIG profile to mock seed data with Windows-appropriate findings. |
| Build matrix update | 0.5 day | Add `windows-server-stig` to `.github/workflows/build-ee.yml` matrix. |
| Crosswalk tab widget (future) | 2-3 days | New Tier 1 widget type `crosswalk_summary` for displaying HIPAA/PCI control coverage. Not a blocker — crosswalks can be consumed as exported JSON initially. |
