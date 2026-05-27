# Feature: Profile-Driven Platform Guards

**Status:** In progress — prep phase (2026-05-27)
**Branch:** `claude/platform-guards-prep`
**Jira:** ANSTRAT-2216 (P1 #4)
**ADR:** ADR-011 (profile-driven platform guards)

## Problem

No mechanism prevents launching a RHEL 9 STIG scan against Windows or network device hosts. Incompatible hosts fail silently (appear as "unreachable" or produce no results) with no indication that the profile was wrong for those hosts.

Hardcoding `when: ansible_os_family == 'RedHat'` solves today but breaks when adding Windows STIG, Cisco IOS STIG, or external scanners (Tenable, Qualys).

## Design Approach

Per ADR-011: each compliance profile declares supported platforms in a structured `PlatformSpec`. The plugin validates the inventory against the spec at three layers:

1. **Pre-launch validation (plugin backend):** Check inventory host facts against profile's platform spec before launching the JT
2. **Playbook-side guards (safety net):** Dynamic `when:` conditions; mismatched hosts get `not_applicable` status
3. **External scanner bypass:** `scanner_validates: true` skips validation

### PlatformSpec Schema

```typescript
interface PlatformSpec {
  os_family?: string[];        // ["RedHat"], ["Windows"]
  os_version?: string[];       // ["9"], ["2019", "2022"]
  device_type?: string[];      // ["cisco_ios", "cisco_nxos"]
  scanner_validates?: boolean; // true for Tier 2+ scanners
}
```

### Alternatives Considered

- *Hardcoded OS checks per playbook:* Rejected — doesn't scale to multiple profiles/scanners
- *Post-scan filtering:* Rejected — wastes JT resources, confuses users with false failures
- *Migrate existing `platform` string column to JSON:* Rejected — added `platform_spec` alongside to avoid breaking existing display values

## Implementation Scope

### Prep Phase (this PR)

**In scope:**
- `PlatformSpec` TypeScript type in compliance-common
- Migration 006: `platform_spec TEXT NULLABLE` on `compliance_cartridge_registry`
- Database layer: JSON serialization/deserialization in `mapCartridgeRow`/`saveCartridge`
- Router: accept `platformSpec` object in `POST /cartridges`
- `PlatformValidator` utility: pure function validating hosts against spec
- Settings form: structured platform requirement inputs (OS Family, OS Version, Device Type, scanner toggle)
- Tests for all new code

**Deferred to follow-up:**
- Pre-launch validation in `POST /scan` (requires Controller API `GET /hosts/?inventory={id}` integration and fact-caching strategy)
- Playbook-side `when:` conditions (Ansible collection change)
- Warning vs block UX decision (should mismatch be a warning or hard block?)
- Host fact availability (may need gather_facts pre-check or cached facts from Controller)

## Files Changed

| File | Change |
|------|--------|
| `plugins/compliance-common/src/types/api.ts` | `PlatformSpec` type, fields on `ComplianceCartridge` and `SaveCartridgeRequest` |
| `plugins/compliance-backend/src/database/migrations/20260528_006_platform_spec.ts` | New migration |
| `plugins/compliance-backend/src/database/ComplianceDatabase.ts` | JSON parse/serialize in cartridge methods |
| `plugins/compliance-backend/src/router.ts` | Accept `platformSpec` in `POST /cartridges` |
| `plugins/compliance-backend/src/service/PlatformValidator.ts` | New utility (pure function) |
| `plugins/compliance/src/components/CartridgeSettings/CartridgeSettings.tsx` | Platform requirement form fields |

## Testing

- `PlatformValidator.test.ts`: RHEL match, Windows mismatch, network devices, scanner_validates, empty spec, mixed inventory
- Database: `saveCartridge`/`getCartridge` round-trip with `platformSpec` JSON
- Router: `POST /cartridges` accepts structured `platformSpec`

## Dependencies

- ADR-011 (profile-driven platform guards) — this feature implements the design
- ADR-006 (self-contained compliance profiles) — platform spec extends the profile definition
- Developer guide (`docs/compliance-profile-developer-guide.md`) — already updated with platform spec section

## Deployment Notes

- Migration 006 runs automatically
- No config changes
- Existing cartridges get `platform_spec: NULL` (permissive — no platform validation)
- The `platform` display string column is preserved for backward compatibility
- Admin must manually set platform requirements on existing profiles via Settings tab

## Follow-up Work

1. Wire `PlatformValidator` into `POST /scan` flow (pre-launch check)
2. Add Controller API call to fetch inventory host facts
3. UX: warning banner vs hard block for platform mismatches
4. Playbook-side `when:` conditions using platform spec from extra_vars
5. Fact caching strategy (avoid re-fetching host facts on every scan)
