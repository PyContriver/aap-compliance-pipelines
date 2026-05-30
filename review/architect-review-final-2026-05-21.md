# Final Architect Review - 2026-05-21

**Reviewer:** Senior Software Architect (Claude Opus 4.6)
**Scope:** All changes since previous architect review (commit 702c55f)
**Verdict:** PASS -- ship-ready for prototype/demo phase

## Changes Reviewed

12 files changed (+325 lines) across 4 commits since last review:
- Data retention settings UI (ProfileSettings)
- CSV/JSON export (ExportButton)
- Backend settings/cleanup endpoints (router, plugin.ts)
- Database cleanup method (ComplianceDatabase)
- job_tags resolution for remediation results (RemediationExecution, ControllerClient)
- Common types (WorkflowJobStatus.job_tags, api.ts)

## Issues Found and Fixed

### Code Quality (3 fixes)

1. **Raw fetch() bypass in DataRetentionSettings** -- The settings/cleanup features used browser `fetch('/api/compliance/...')` directly instead of the Backstage API client. This bypasses `discoveryApi` URL resolution and `fetchApi` identity token injection. Both would fail in production where the backend runs on a different host.
   - **Fix:** Added `updateSettings()` and `runCleanup()` methods to `ComplianceApi` interface and `ComplianceBackendClient`. Updated `DataRetentionSettings` to use `api.updateSettings()` and `api.runCleanup()`.

2. **Unsafe type casts in health response** -- `(h as Record<string, unknown>).retentionDays` casts the health response to bypass TypeScript. The correct fix is to extend the return type.
   - **Fix:** Updated `getHealth()` return type to `{ status: string; dataSource: string; retentionDays?: number }` across the API ref, client, and mock.

3. **Missing mock methods in router test** -- `getJobStatus`, `cleanupOldFindings`, `getLatestFindings`, and `updateScanStatus` were missing from the router test mock factories. These would cause test failures if new test cases exercised those paths.
   - **Fix:** Added all four to `createMockService()` and `createMockDatabase()`.

### Auth Policy Review (PASS)

All 23 router endpoints have corresponding `addAuthPolicy` entries in `plugin.ts`:
- Read-only: health, profiles, scans, findings, cartridges, inventories, dashboard, posture, workflow-templates, workflow-status, workflow-nodes, job-events, job-status, controller, previous-findings (15)
- Mutating: scan, remediate, remediation-profiles, remediation-profiles/:id, settings, cleanup (6 + 1 parameterized = 8 total counting methods)

No missing policies found.

### Mock Mode Review (PASS)

All new features work in mock mode:
- `POST /settings` -- works (in-memory retentionDays, no DB needed)
- `POST /cleanup` -- works (calls database.cleanupOldFindings, returns 0)
- `GET /previous-findings` -- works (returns [] in mock, DB has no scan history)
- job_tags -- mock getJobStatus returns undefined job_tags, remediation view enables all rules as fallback

### Type Safety (PASS)

- Zero `as any` casts in production code (excluding test files)
- No type mismatches found between API interface, client, and backend
- Common types correctly exported through barrel files

### Memory Leaks / Race Conditions (PASS)

- All polling intervals use proper cleanup return in `useEffect`
- `cancelled` flag pattern used correctly in RemediationExecution polling
- No event listener leaks (no `addEventListener` without cleanup)
- `useRef` properly used for values that shouldn't trigger re-renders

### Dead Code (PASS)

- No unused imports found
- All exported functions/types are consumed
- `isArray`, `isBoolean`, `isNonEmptyString`, `isPositiveInteger` validators are all used

## Documentation Updates

1. **AsciiDoc modules** -- Updated `con-about-compliance-pipelines.adoc` with CSV export, data retention, verification comparison, dual view, insights pattern features. Updated `proc-run-compliance-scan.adoc` with verification scan flow and export. Updated `ref-compliance-pipeline-configuration.adoc` with `compliance.retentionDays` setting.

2. **Developer guide** -- Added CaC title matching convention section explaining how the portal groups Ansible tasks by compliance rule using role names, task tags, and title prefix matching.

3. **Lab docs** -- `lab-netrunner-environment.md` exists and is current.

## Test Results

```
Test Suites: 11 passed, 11 total
Tests:       201 passed, 201 total
```

## Remaining Items (Not Blockers for Prototype)

- RBAC integration (auth-backend-module-rhaap-provider)
- Dynamic plugin packaging (dist-dynamic for RHDH)
- Expanded rule coverage (20 -> 366 STIG rules)
- Posture trending chart
- CKL export format
- Tier 2 adapter proof-of-concept
