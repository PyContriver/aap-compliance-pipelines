# Feature: Profile-Driven Platform Guards

**Status:** Shipped (commits `02268a2`–`4988627`, 2026-05-28)
**Jira:** ANSTRAT-2216 (P1 #4)
**ADR:** ADR-011 (profile-driven platform guards)

## Problem

No mechanism prevents launching a RHEL 9 STIG scan against Windows or network device hosts. Incompatible hosts fail silently (appear as "unreachable" or produce no results) with no indication that the profile was wrong for those hosts.

Hardcoding `when: ansible_os_family == 'RedHat'` solves today but breaks when adding Windows STIG, Cisco IOS STIG, or external scanners (Tenable, Qualys).

## Design Approach

Per ADR-011: each compliance profile declares supported platforms in a structured `PlatformSpec`. The plugin validates the inventory against the spec before launch:

1. **Pre-launch validation (plugin backend):** `POST /scan/validate` checks inventory host facts from Controller's fact cache against the profile's platform spec. Mismatched hosts trigger a warning dialog in the frontend — user can cancel or proceed.
2. **Fact cache population:** The assessment playbook runs with `gather_facts: true` and the JT has `use_fact_cache: true`, so Controller persists host facts after each scan. Validation is effective from the second scan onward.
3. **External scanner bypass:** `scanner_validates: true` skips validation entirely.

### PlatformSpec Schema

```typescript
interface PlatformSpec {
  os_family?: string[];        // ["RedHat"], ["Windows"]
  os_version?: string[];       // ["9"], ["2019", "2022"]
  device_type?: string[];      // ["cisco_ios", "cisco_nxos"]
  scanner_validates?: boolean; // true for Tier 2+ scanners
}
```

### Host Fact Handling

- Hosts with **no cached facts** (new inventory, never scanned) are treated as "unchecked" — they pass validation and the scan proceeds. The scan gathers facts for next time.
- Hosts with **cached facts that don't match** are flagged as mismatched with the specific reason (e.g., "OS family 'Windows' not in [RedHat]").
- Hosts with **cached facts that match** pass validation silently.

### Controller Requirements

- **`use_fact_cache: true`** on the assessment JT — without this, Controller discards gathered facts
- **`gather_facts: true`** on the scan playbook's target play — populates Controller's fact cache
- **`ask_variables_on_launch: true`** on the assessment JT — allows the plugin to pass `scan_id`, `ingest_token`, and other extra_vars

### Alternatives Considered

- *Hardcoded OS checks per playbook:* Rejected — doesn't scale to multiple profiles/scanners
- *Post-scan filtering:* Rejected — wastes JT resources, confuses users with false failures
- *Conditional fact gathering (setup module as pre_task):* Rejected — Controller only caches facts from play-level `gather_facts`, not from `setup` module calls within tasks
- *Ad-hoc fact gathering in validate endpoint:* Rejected — adds complexity and latency; `gather_facts: true` on every scan is simpler (~5s overhead on 5min scan)

## Implementation

### Prep Phase (shipped 2026-05-27, PR #22)

- `PlatformSpec` TypeScript type in compliance-common
- Migration 006: `platform_spec TEXT NULLABLE` on `compliance_cartridge_registry`
- Database layer: JSON serialization/deserialization
- Router: accept `platformSpec` in `POST /compliance-profiles`
- `PlatformValidator` utility: pure function validating hosts against spec
- Settings form: OS Family, OS Version, Device Type inputs + scanner toggle
- Comprehensive tests

### Completion Phase (shipped 2026-05-28)

- `POST /scan/validate` endpoint: fetches host facts from Controller, runs PlatformValidator, returns validation result with `factsAvailable` flag
- `ControllerClient.getInventoryHostFacts()`: fetches hosts + their ansible_facts in parallel
- `ComplianceService.getInventoryHostFacts()`: data source abstraction
- Frontend: `handleLaunch` calls validate before scan, shows warning dialog on mismatch with Cancel/Launch Anyway
- `PlatformValidationResult` type includes `factsAvailable` boolean
- Assessment playbook: `gather_facts: true` on target play
- Assessment JT: `use_fact_cache: true` via config-as-code
- Permission gate on validate endpoint (architect review fix)
- Error response sanitization (architect review fix)
- Type deduplication: single `PlatformValidationResult` source in common package

## Files Changed

| File | Change |
|------|--------|
| `plugins/compliance-common/src/types/api.ts` | `PlatformSpec`, `PlatformValidationResult`, `gatherFacts` on `LaunchScanRequest` |
| `plugins/compliance-backend/src/service/PlatformValidator.ts` | Validation logic, skip hosts without facts |
| `plugins/compliance-backend/src/service/ControllerClient.ts` | `getInventoryHostFacts()` |
| `plugins/compliance-backend/src/service/ComplianceService.ts` | `getInventoryHostFacts()` abstraction, `_gather_facts` in extra_vars |
| `plugins/compliance-backend/src/router.ts` | `POST /scan/validate` endpoint, `gatherFacts` in scan request |
| `plugins/compliance/src/api/*` | `validateScan()` method |
| `plugins/compliance/src/components/ScanLauncher/ScanLauncher.tsx` | Warning dialog, validate-before-launch flow |
| `profiles/rhel9-stig/.../playbooks/run_oscap.yml` | `gather_facts: true` |
| `profiles/rhel9-stig/install.yml` | `use_fact_cache: true` on assessment JT |
| `docs/compliance-profile-developer-guide.md` | Fact cache requirements |
| `docs/modules/proc-configure-compliance-pipeline.adoc` | Use Fact Storage setting |

## Testing

- `PlatformValidator.test.ts`: RHEL match, Windows mismatch, network devices, scanner_validates, empty spec, no-facts-skip, partial facts, mixed inventory
- Router: validate returns valid (no spec), mismatch, scanner_validates bypass, Controller failure (500), all-match, invalid inputs
- Frontend: validateScan mock, warning dialog render/cancel/launch-anyway
- 266 tests, 12 suites, all passing
- Architect review: all PASS after fixes

## Deployment Notes

- Migration 006 runs automatically
- **Must enable "Use Fact Storage" on the assessment JT** (done via config-as-code or manually in Controller UI)
- Existing profiles get `platform_spec: NULL` (permissive — no validation)
- Platform validation is effective from the second scan onward (first scan populates fact cache)
