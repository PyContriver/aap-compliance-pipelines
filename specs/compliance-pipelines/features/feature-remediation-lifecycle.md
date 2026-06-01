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
| Waiver/exception expiry | Chef InSpec | Deferred — drafts persist indefinitely (upsert prevents orphan proliferation, Q4) |
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
3. Drafts persist indefinitely until explicitly deleted by user (upsert prevents orphan proliferation — see Q4)

---

## 4. Data Model

### Modified: `compliance_remediation_profiles`

Renamed column (migration 011): `scan_id` → `creation_scan_id` (disambiguates from execution table's `informing_scan_id` and `verification_scan_id`).

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
| `inventory_id` | INTEGER NOT NULL | Controller inventory ID (for concurrent execution guard §6) |
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

Indexes: `(remediation_profile_id)`, `(inventory_id, status)` (for concurrent execution guard), `(started_at)`

No per-host or per-rule results stored — Controller is the source of truth. Detailed results fetched live via `GET /api/controller/v2/jobs/{id}/job_events/`.

### New: `compliance_baseline_targets`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `remediation_profile_id` | TEXT NOT NULL | FK to profiles — the golden standard rule set |
| `inventory_id` | INTEGER NOT NULL | Controller inventory ID |
| `pinned_at` | TEXT NOT NULL | ISO timestamp |
| `pinned_by` | TEXT | Backstage user ref who pinned it |

Uniqueness: `(remediation_profile_id, inventory_id)` — one golden standard per profile × inventory pair.

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

The execution table adds **0.5%** of the findings table's growth rate. With default "Indefinite" retention, no storage concern for years. Configurable retention (Settings > Data Management) available for deployments with strict storage budgets — see Q3 resolution and ADR-014 §8.

---

## 7. Migration Strategy

### Migration 011: `20260601_011_remediation_lifecycle.ts`

1. Rename `compliance_remediation_profiles.scan_id` → `creation_scan_id` (Q7 — disambiguates from execution table's `informing_scan_id` and `verification_scan_id`)
2. Add `status`, `created_by`, `execution_count`, `last_executed_at` to `compliance_remediation_profiles`
3. Create `compliance_remediation_executions` table (with `inventory_id` for concurrent execution guard)
4. Create `compliance_baseline_targets` table (golden standard bindings — §7)
5. Backfill: derive execution records from existing `scanner='remediation'` scan records

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
| **1: Foundation** | Migration 011 (incl. `scan_id` rename, `compliance_baseline_targets`), execution CRUD, create on launch, update on completion, concurrent execution guard, list/detail endpoints, RemediationsList with MUI table | 3-4 days |
| **2: Verification** | Pass executionId to verification scan, verification linkage, RemediationDetail component | 1-2 days |
| **3: Cleanup** | Stop creating remediation scan records, auto-save drafts + upsert, name uniqueness, "Save" button | 1-2 days |
| **4: Data Management** | Settings > Data Management UI (two retention dropdowns + help popover), background purge job, cascade-safe deletes | P2b |
| **5: Audit Export** | Export compliance report (date range, profile/inventory filters, local + Controller data sources, CSV/JSON bundle) | P3 |
| **6: Future** | SLA, auto-close, ITSM integration, execution comparison | Deferred |

---

## 10. Open Questions

1. ~~**Concurrent execution guard:**~~ **RESOLVED (2026-06-01).** Hard reject, not queue. Block launch when any execution with `status='running'` exists for the same inventory, regardless of profile. Covers both same-profile and cross-profile cases because Controller has no cross-JT inventory mutex — concurrent remediation playbooks cause package-manager locks, config file races, and service restart conflicts. Industry precedent: Chef uses node-level `flock()` (blocks until complete), Puppet uses PID lockfile (hard reject). We follow Puppet's pattern — reject with a clear message naming the running remediation. See ADR-014 §6.
2. ~~**Re-run button / remediation profile reuse:**~~ **RESOLVED (2026-06-01).** Remediation profiles are inventory-independent policy templates, not tied to a specific inventory. The inventory is selected at launch time. Re-run is natural — the profile persists, the user launches it against any inventory. A separate "pin as golden standard" action binds a profile to an inventory for dual-layer dashboard reporting (standard posture vs baseline posture). This achieves the same effect as Drata/Vanta's "out of scope" pattern through AAP's execution model. See ADR-014 §7.
3. ~~**Execution retention:**~~ **RESOLVED (2026-06-01).** Indefinite by default, configurable via Settings > Data Management. Two retention groups to avoid cascade conflicts:

   - **Assessment data** (scans + findings + posture snapshots): cascade together. Purging a scan deletes its findings and snapshots.
   - **Remediation data** (execution history): independent. If `verification_scan_id` references a purged scan, UI shows "Assessment data no longer available locally — view in Automation Controller."

   Both default to "Indefinite." Options: 30d / 60d / 90d / 6mo / 1yr / Indefinite. No conflict possible between groups — assessment and remediation data are independently purgeable.

   **Competitive basis:** Platforms storing metadata + pointers (Insights, Qualys, Drata, Vanta, InsightVM) keep execution records indefinitely — audit trails are the value proposition. Platforms storing full execution payloads (Chef Automate, Puppet Enterprise) use configurable TTLs (14-60 days default) due to storage costs. Our model follows the metadata + pointers camp (~555 KB/year for executions). Controller retains all job history, task events, and logs as the source of truth regardless of local retention settings.

   **Help text pattern:** Data Management section includes a contextual help popover (MUI `IconButton` + `Popover`, matching downstream `HelpButton` pattern from ansible-hub-ui) explaining: (1) this manages the local database only, (2) Automation Controller remains the source of truth for all execution data, (3) historical data beyond the retention window can be retrieved via Audit Export.

   **Implementation:** P2b — two dropdowns in Settings, background purge job, cascade-safe delete queries. See §8 in ADR-014.
4. ~~**Draft cleanup frequency:**~~ **RESOLVED (2026-06-01).** No automatic cleanup. Drafts persist until explicitly deleted by the user. The orphan proliferation problem is solved by upsert semantics (§5) — auto-save updates an existing draft for the same `(name, compliance_profile_id)` instead of creating new rows. Drafts are lightweight rows with negligible storage. Automatic cleanup risks deleting in-progress work on profiles that may become golden standards (§7).
5. ~~**Status column / RemediationsList at scale:**~~ **RESOLVED (2026-06-01).** Two chips per row: profile status (`Draft`, `Saved`, `Archived`) + latest execution outcome with inventory name. Design follows Drata/Vanta list management patterns adapted to MUI (Backstage uses Material UI, not PatternFly):

   **List management pattern:**
   - Flat paginated table (MUI Table), server-side pagination, 20 per page
   - Free-text search on profile name (MUI TextField)
   - Multi-axis filter bar: status (draft/saved/archived), compliance profile, inventory
   - Bulk selection via checkbox column with toolbar bulk actions (archive, delete drafts)
   - Golden standard indicator (star/badge) on profiles pinned as baselines (§7)
   - Expandable rows for execution history across inventories

   **Competitive basis:** Drata uses flat paginated tables with 50+ server-side filter params, free-text search, bulk owner assign and bulk scope marking. Vanta uses sidebar category grouping, urgency-based sort, checkbox bulk-assign. Both use server-side pagination (20-50/page), compact status icons, no nested grouping. Neither exposes column-header sorting.

   **Why two chips:** Profile status and execution status are independent concepts (a `Saved` profile can have a `Failed` execution). With inventory-independent profiles (§7), the execution chip must name which inventory it ran against. Profiles with no executions show the profile status chip alone.

6. ~~**Archive vs Delete:**~~ **RESOLVED (2026-06-01).** Archive for saved profiles, delete for drafts only. A saved profile that was once a golden standard is part of the audit trail and must not be permanently deletable. Archived profiles are hidden from the default RemediationsList view but recoverable via a status filter (`Archived`). Drafts are work-in-progress with no execution history and can be freely deleted. Profiles currently pinned as a golden standard (§7) cannot be archived until unpinned — the UI disables the archive action and explains why.

   **Scope:**
   - `Draft` → delete (permanent) or save (transitions to `Saved`)
   - `Saved` → archive (transitions to `Archived`, hidden from default view)
   - `Saved` + pinned as golden standard → archive blocked until unpinned
   - `Archived` → restore (transitions back to `Saved`) or stays hidden
   - No permanent delete for `Saved` or `Archived` profiles

7. ~~**`scanId` rename:**~~ **RESOLVED (2026-06-01).** Rename `compliance_remediation_profiles.scan_id` → `creation_scan_id` in migration 011. With the new execution table introducing `informing_scan_id` (assessment scan at launch time) and `verification_scan_id` (post-remediation verification), the profile's `scan_id` is ambiguous — it records which scan was active when the profile was originally created, a distinct third concept. Renaming in the same migration avoids shipping ambiguous naming and a second migration later. Blast radius is small: migration, DB class, and remediation creation flow.
