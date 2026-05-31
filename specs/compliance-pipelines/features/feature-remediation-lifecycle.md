# Feature: Remediation Lifecycle

**Status:** Proposed  
**Date:** 2026-05-31  
**ADR:** ADR-014 (remediation lifecycle architecture)  
**Depends on:** ADR-009, ADR-013

---

## 1. Problem Statement

Remediations are stateless — every launch re-derives everything from scratch. This breaks when workflows aren't linear (scan A → remediate A → scan B for different profile → remediate A again uses B's findings). No execution history, no lifecycle states, no verification linkage.

### Architectural principle

AAP Controller is the source of truth for all execution data. The plugin stores lightweight pointers and summaries for UX. Drill-down always fetches live from Controller. Scans are outsourced to Controller/OpenSCAP — the plugin stores normalized findings, but raw data lives in Controller.

---

## 2. Competitive Patterns

### How competitors handle execution data

| Platform | Execution delegated to | Run history stored locally? | Detail fetching |
|----------|----------------------|---------------------------|-----------------|
| **Red Hat Insights** | RHC/yggdrasil agents | Metadata + per-system status; logs fetched on demand from executor | Playbook Dispatcher Kafka events |
| **Rapid7 InsightVM** | Scan engines | Solution states + scan results locally | On-demand validation scan |
| **Chef Automate** | Chef Client push | Full run report pushed to Automate (Elasticsearch) — resource-level before/after/delta | Nothing fetched on demand — all pushed |
| **Puppet Enterprise** | Puppet Agent | Full report in PuppetDB (per-resource events + `corrective_change` boolean) | PuppetDB is the store |
| **Qualys VMDR** | PM agent / ITSM | Ticket + job status in ITSM; scan results in Qualys | Bidirectional ITSM sync |

**Key insight**: Insights (closest to our architecture — Ansible-based, discrete actions) stores only metadata and per-system status, fetching logs on demand. Chef/Puppet push full run data because their agents run locally. Our model should follow Insights: AAP Controller is the execution engine, we store summary pointers.

### Adopted patterns

| Pattern | Source | Our Adoption |
|---------|--------|-------------|
| Execution history per plan, metadata only | Red Hat Insights | Yes — `compliance_remediation_executions` table with counts + job IDs |
| Summary + link to execution engine for details | Insights, Chef (push model adapted to pull) | Yes — store rule/host counts, fetch task events from Controller on demand |
| Explicit lifecycle states on executions | Rapid7 InsightVM (`Open > Awaiting Verification > Closed`) | Yes — `pending > running > succeeded > failed > cancelled` |
| Validation scans transition status | InsightVM | Yes — `verification_scan_id` on execution record |
| Plan name uniqueness per org | Red Hat Insights | Yes — unique `(name, compliance_profile_id)` |
| Waiver/exception expiry | Chef InSpec | Adopted as draft cleanup (7-day TTL for unexecuted drafts) |
| Corrective change tracking | Puppet (`corrective_change` boolean per resource) | Deferred — requires comparing pre/post scan results |
| Auto-close on next scan | Qualys (auto-close incident), Drata, Vanta | Deferred |
| SLA tracking | Qualys (severity-based), Drata (24h/15d/60d/90d) | Deferred |
| ITSM bidirectional sync | Qualys+ServiceNow, Vanta+Jira | Deferred |

### Insights-specific patterns to adopt

- **System readiness checks**: Insights gates execution on RHC client status (connected/disconnected/not configured). We should gate on Controller inventory host reachability.
- **Auto-reboot flag**: Per-plan setting. We don't need this (CaC playbooks handle reboots via handlers) but the concept of per-plan execution options is relevant.
- **Archive vs delete**: Archive hides from default view, viewable via filter. Delete is permanent. One-way archive from UI.

---

## 3. UX Flows

### Flow A: Create and save a remediation profile

1. User views scan results → clicks "Configure Remediation"
2. RemediationProfileBuilder loads findings for the scan
3. User enters name, toggles rules, adjusts parameters
4. Auto-save triggers (2s debounce): upserts as `status='draft'` keyed on `(complianceProfileId, name)`
5. User clicks explicit "Save" button → transitions to `status='saved'`

### Flow B: Launch from the list

1. User navigates to Remediations tab
2. Table shows: Name, Profile, Rules, **Status**, **Last Run**, **Runs**, Actions
3. Status column: profile chip (`Draft`/`Saved`/`Archived`) + latest execution chip (`Succeeded`/`Failed`/`Running`)
4. User clicks Play → system launches remediation → creates execution record → frontend polls Controller
5. On completion, execution record updated with summary counts from Controller

### Flow C: Verification scan with linkage

1. Remediation completes → user clicks "Run Verification Scan"
2. Button passes `executionId` as query parameter
3. Backend creates verification scan and updates `execution.verification_scan_id`
4. Remediations list shows "Verified" badge on the execution

### Flow D: View execution history

1. User clicks profile name or "View History" action
2. Profile detail view shows execution history table: Date, Status, Rules Applied/Failed, Hosts Targeted, Duration, Verification Status
3. Clicking an execution navigates to the remediation progress view (fetches task events live from Controller)
4. "View in Controller" opens the Controller job page

### Flow E: Archive and cleanup

1. User archives a profile → `status='archived'`, hidden from default list
2. Filter dropdown: "Active" (default), "All", "Drafts", "Archived"
3. Backend cleanup: delete draft profiles older than 7 days with `execution_count=0`

---

## 4. Data Model

### Modified: `compliance_remediation_profiles`

New columns (migration 011):

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `status` | TEXT NOT NULL | `'saved'` | `draft`, `saved`, `archived` |
| `created_by` | TEXT | NULL | Backstage user ref |
| `execution_count` | INTEGER NOT NULL | `0` | Denormalized, incremented on launch |
| `last_executed_at` | TEXT | NULL | ISO timestamp of most recent launch |

Uniqueness: `(profile_id, name)` where `status != 'archived'` (enforced in application code for SQLite compat).

### New: `compliance_remediation_executions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `remediation_profile_id` | TEXT NOT NULL | FK to profiles |
| `informing_scan_id` | TEXT | Assessment scan used for host scoping |
| `primary_job_id` | INTEGER | First Controller job ID |
| `all_job_ids` | TEXT | JSON array of all Controller job IDs |
| `status` | TEXT NOT NULL | `pending`, `running`, `succeeded`, `failed`, `cancelled` |
| `started_at` | TEXT NOT NULL | ISO timestamp |
| `completed_at` | TEXT | ISO timestamp |
| `elapsed_seconds` | REAL | Wall-clock duration |
| `rules_applied` | INTEGER | Rule count in plan |
| `rules_failed` | INTEGER | Rules with failed tasks |
| `hosts_targeted` | INTEGER | Unique hosts across all groups |
| `hosts_succeeded` | INTEGER | Hosts where all tasks succeeded |
| `hosts_failed` | INTEGER | Hosts with failures |
| `plan_summary` | TEXT | JSON serialized `RemediationPlan` |
| `verification_scan_id` | TEXT | FK to scans (filled after verification) |
| `created_by` | TEXT | Backstage user ref |

Indexes: `(remediation_profile_id)`, `(status)`, `(started_at)`

No per-host or per-rule results stored — Controller is the source of truth. Detailed results fetched live via `GET /api/controller/v2/jobs/{id}/job_events/`.

---

## 5. API Contracts

### Modified: `POST /remediate`

Response gains `executionId`:
```typescript
{ remediationId, workflowJobId, status, allJobIds?, executionId: string }
```

### Modified: `POST /scan`

Request gains optional `executionId` for verification linkage.

### New: `GET /remediation-executions?profileId=:id&limit=20`

Returns `RemediationExecution[]`.

### New: `GET /remediation-executions/:id`

Returns single `RemediationExecution`.

### New: `PATCH /remediation-executions/:id`

Update execution status on completion (called by polling flow).

### Modified: `POST /remediation-profiles`

Accepts `status` field (`draft`/`saved`). Upsert by `(complianceProfileId, name)` for drafts.

### New: `PATCH /remediation-profiles/:id`

Update profile status (archive/unarchive).

### Modified: `GET /remediation-profiles`

Response includes lifecycle fields + optional `latestExecution` (joined from executions table). Query param `?status=saved` for filtering.

---

## 6. DB Growth Analysis

### Execution table

- **Assumptions:** 10 profiles × 2 runs/week × 52 weeks = 1,040 rows/year
- **Row size:** ~534 bytes (UUIDs + counts + small JSON plan summary)
- **Annual growth:** ~555 KB/year

### Comparison

| Table | Current | Annual growth |
|-------|---------|--------------|
| `compliance_findings` | 57K rows | ~115 MB/year |
| `compliance_scans` | ~18 rows | ~15 KB/year |
| `compliance_remediation_profiles` | ~10-20 rows | Negligible |
| **`compliance_remediation_executions`** (new) | 0 | **~555 KB/year** |

The execution table adds **0.5%** of the findings table's growth rate. No retention policy needed for years.

---

## 7. Migration Strategy

### Migration 011: `20260601_011_remediation_lifecycle.ts`

1. Add `status`, `created_by`, `execution_count`, `last_executed_at` to `compliance_remediation_profiles`
2. Create `compliance_remediation_executions` table
3. Backfill: derive execution records from existing `scanner='remediation'` scan records

Existing profiles get `status='saved'` (all were explicitly saved). Backfill matches remediation scans to profiles by `profile_id` and creates lightweight execution records.

---

## 8. Frontend Changes

| Component | Changes |
|-----------|---------|
| `RemediationsList` | Status chip, latest execution status, last run date, execution count, archive action, status filter dropdown |
| `RemediationExecution` | Store `executionId` from launch, pass to verification scan, PATCH execution on completion, load `allJobIds` from execution in view mode |
| `RemediationProfileBuilder` | Auto-save as `status='draft'`, explicit "Save" button for `status='saved'`, upsert semantics |
| `RemediationDetail` (new) | Profile metadata + execution history table with expandable rows, "View in Controller" links |
| `ActiveJobsBanner` | Query execution table for running remediations instead of scan records |

---

## 9. Implementation Phases

| Phase | Scope | Effort |
|-------|-------|--------|
| **1: Foundation** | Migration, execution CRUD, create on launch, update on completion, list/detail endpoints, RemediationsList columns | 3-4 days |
| **2: Verification** | Pass executionId to verification scan, verification linkage, RemediationDetail component | 1-2 days |
| **3: Cleanup** | Stop creating remediation scan records, auto-save drafts + upsert, draft cleanup, name uniqueness, "Save" button | 1-2 days |
| **4: Future** | SLA, auto-close, ITSM integration, execution comparison | Deferred |

---

## 10. Open Questions

1. **Concurrent execution guard:** Prevent launching a profile that already has a running execution? (Leaning yes — check for `status='running'` before launch.)
2. **Execution retention:** Keep indefinitely or align with findings retention? (Leaning: keep indefinitely — rows are tiny, audit value is high.)
3. **Draft cleanup frequency:** Configurable via settings? (Leaning yes.)
4. **Re-run button:** Allow re-launching from a completed execution with same profile selections? (Leaning: add in Phase 2.)
5. **`scanId` rename:** Rename to `creation_scan_id` for clarity? (Defer to Phase 3.)
