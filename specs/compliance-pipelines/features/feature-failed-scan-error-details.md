# Feature: Failed Scan Real Error Details

**Status:** In progress (2026-05-27)
**Branch:** `claude/failed-scan-error-details`
**Jira:** ANSTRAT-2216 (P1 #5)
**Roadmap:** Promoted from P2 to P1 during Round 3 testing

## Problem

When a scan fails, the frontend shows a hardcoded generic message:

> "The workflow ended with status: failed. This is typically caused by unreachable hosts, missing credentials, or misconfigured inventory. Check the AAP Controller job log for details."

The real error (e.g., "all 10 hosts unreachable: SSH connection timed out") is available from the Controller API but never fetched. Telling users to leave the plugin and check Controller defeats the integrated experience.

## Design Approach

- Fetch `result_traceback` from the Controller job object (lightweight field, ~200 bytes) — NOT full stdout (can be megabytes)
- Cache error details in `compliance_scans.error_details` column (migration 005) to avoid repeated Controller API calls
- Handle both workflow jobs and single JTs per ADR-003 (try workflow nodes first, fall back to direct job)
- On-demand fetch: when `GET /scans/:scanId` returns a failed scan with null `errorDetails`, fetch from Controller and cache
- Best-effort: never fail the scan flow if error fetch fails

### Alternatives Considered

- *Fetch full job stdout:* Rejected — can be megabytes for 10-host scans, too large to cache or display
- *Store error at scan creation time only:* Insufficient — most failures happen during execution, not at launch
- *Add a separate endpoint:* Unnecessary — enriching `GET /scans/:scanId` is simpler and follows the existing pattern

## Implementation Scope

**In scope:**
- Migration 005: `error_details TEXT NULLABLE` on `compliance_scans`
- `ControllerClient.getJobStatus()` extended to return `result_traceback`
- `ComplianceService.fetchScanErrorDetails()` — workflow nodes → failed node → traceback
- Router: on-demand fetch in `GET /scans/:scanId`, error caching in `POST /scan` catch block
- Frontend: scrollable monospace error panel replacing hardcoded message
- Tests for all new code paths

**Deferred:**
- Fetching structured per-host error breakdown (which specific hosts failed)
- Deep stdout parsing (extracting specific task failures from Ansible output)

## Files Changed

| File | Change |
|------|--------|
| `plugins/compliance-backend/src/database/migrations/20260527_005_scan_error_details.ts` | New migration |
| `plugins/compliance-common/src/types/api.ts` | `errorDetails` on `ComplianceScan` |
| `plugins/compliance-backend/src/service/ControllerClient.ts` | `result_traceback` in job status |
| `plugins/compliance-backend/src/service/ComplianceService.ts` | `fetchScanErrorDetails()` |
| `plugins/compliance-backend/src/database/ComplianceDatabase.ts` | `updateScanErrorDetails()`, `mapScanRow()` |
| `plugins/compliance-backend/src/router.ts` | On-demand fetch + caching |
| `plugins/compliance/src/components/ResultsViewer/ResultsViewer.tsx` | Real error panel |

## Testing

- Service: mock ControllerClient, test workflow job and single JT paths
- Database: `updateScanErrorDetails` round-trip
- Router: `GET /scans/:scanId` returns `errorDetails` for failed scans
- Frontend: error panel renders traceback text vs fallback message

## Dependencies

- ADR-003 (single assessment JT) — must handle both workflow and direct job IDs
- ADR-007 (Direct POST) — error caching follows the same DB-first pattern

## Deployment Notes

- Migration 005 runs automatically
- No config changes
- Error details are populated lazily (on first `GET /scans/:scanId` for a failed scan) — no backfill needed
