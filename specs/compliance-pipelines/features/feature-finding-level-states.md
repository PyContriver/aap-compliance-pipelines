# Feature: Finding-Level State Tracking

**Status:** Shipped (2026-06-03)  
**ADR:** ADR-016 Layer 2  
**Branch:** `claude/finding-level-states`  

## Problem

Scan results showed point-in-time snapshots with no history at the individual finding level. A rule failing for the first time looked identical to one that had been failing for months, and a freshly remediated fix was indistinguishable from something that always passed. This made it impossible to answer "what changed?" or "did the remediation regress?" without manually comparing scans.

## Design Approach

Adopted the **Tenable pattern** (identified in ADR-016 competitive research) — four lifecycle states computed per `(rule_id, host)` pair across consecutive scans:

| State | Meaning | Visual |
|-------|---------|--------|
| `new` | First-time failure on this host | Blue outlined chip |
| `active` | Still failing from a previous scan | Grey outlined chip |
| `fixed` | Was failing, now passing after remediation | Green filled chip |
| `resurfaced` | Regression after remediation — was fixed, now failing again | Red outlined chip |

The `resurfaced` state is the key differentiator vs Drata/Vanta (which just reopen issues without distinguishing new failures from regressions).

### State Transition Table

| Previous status | Previous state | Current status | Current state |
|---|---|---|---|
| *(none)* | — | fail | `new` |
| *(none)* | — | pass | *(null)* |
| fail | any | fail | `active` |
| fail | any | pass | `fixed` |
| pass | fixed | fail | `resurfaced` |
| pass | null | fail | `new` |
| pass | any | pass | *(null)* |

## Implementation

### Database (migration 013)
- `finding_state` TEXT nullable column on `compliance_findings` with index
- `computeFindingStates(scanId, profileId, inventoryId)` — compares against previous completed oscap scan for same profile+inventory, applies state transitions via bulk UPDATE grouped by state
- `getPreviousScanForInventory` — includes both assessment and verification scans (both run full XCCDF evaluation)
- `getBatchScanStatsAggregated` — returns stateNew/stateFixed/stateResurfaced counts alongside pass/fail

### API
- `POST /findings/ingest` — state computation runs after ingest (non-fatal, wrapped in try/catch)
- `GET /findings?state=new,fixed` — server-side state filter (comma-separated)
- `GET /scans/stats` — includes state counts per scan

### Frontend
- **FindingRow** — state chip with tooltip at rule level (dominant state) and per-host in expanded detail table
- **ResultsViewer** — state filter dropdown alongside severity/status filters, stored in URL search params
- **ScanHistory** — state delta chips on scan rows (e.g. "18 fixed", "3 resurfaced") with count-clarifying tooltips
- **RemediationProfileBuilder** — state filter buttons (hidden in edit mode where no scan context exists)
- **VerificationComparison** — labels clarified to "Rules Improved/Regressed/Unchanged" with tooltips explaining rule-level vs host-level counting

### Types (compliance-common)
- `FindingState = 'new' | 'active' | 'fixed' | 'resurfaced'`
- `FindingStateSummary = { new, active, fixed, resurfaced }`
- `StoredFinding.findingState: FindingState | null`
- `MultiHostFinding.hosts[].findingState: FindingState | null`
- `MultiHostFinding.stateSummary: FindingStateSummary`

## Alternatives Considered

- **Compute on read (no stored state)**: Would require joining N previous scans on every findings query. Rejected for performance — state computation is O(findings) at ingest time, not at query time.
- **Separate state history table**: Track every transition with timestamps. Deferred — the current single-column approach covers the Tenable pattern. A history table would support audit trails but adds complexity without immediate UX value.

## Testing

- 8 database tests covering all 7 state transitions + cross-inventory isolation
- `getBatchScanStatsAggregated` test verifying state counts
- `FindingsParser.mapRawFinding` test updated for `findingState: null` (method moved from ComplianceService to FindingsParser in ADR-019)
- 304/304 tests pass across 12 suites
- Manual testing on Netrunner Portal: full fail→fix→resurfaced cycle verified

## Deployment Notes

- Migration 013 must be in **both** `migrations/` and `dist/database/migrations/` in the dist-dynamic package (plugin checks `dist/database/migrations/` first)
- Existing findings get `findingState: null` — states only computed for new scans going forward
- First scan after deployment marks all failures as `new`; `resurfaced` requires a full fail→fix→fail cycle

## Files Changed

| File | Change |
|------|--------|
| `migrations/20260603_013_finding_state.js` | New column + index |
| `compliance-common/src/types/api.ts` | FindingState, FindingStateSummary, updated interfaces |
| `compliance-backend/src/database/ComplianceDatabase.ts` | State computation, query updates |
| `compliance-backend/src/router.ts` | Ingest hook, state filter |
| `compliance-backend/src/service/FindingsParser.ts` | State passthrough in aggregation (extracted from ComplianceService, ADR-019) |
| `compliance-backend/src/service/MockDataProvider.ts` | Mock state data |
| `compliance/src/components/ResultsViewer/FindingRow.tsx` | State chips + per-host chips |
| `compliance/src/components/ResultsViewer/ResultsViewer.tsx` | State filter |
| `compliance/src/components/ResultsViewer/VerificationComparison.tsx` | Count tooltips |
| `compliance/src/components/ScanHistory/ScanHistory.tsx` | State delta chips |
| `compliance/src/components/RemediationProfileBuilder/RemediationProfileBuilder.tsx` | State filter (build mode only) |

## Dependencies

- ADR-016 Layer 1 (grouped scan history) — shipped 2026-06-02
- ADR-014 (remediation lifecycle) — Phase 1 shipped 2026-06-01
