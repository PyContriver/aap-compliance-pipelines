---
title: "Remediation Lifecycle Gap Analysis"
description: "Gap analysis between current remediation implementation and target lifecycle architecture"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Remediation Lifecycle Gap Analysis

**Date:** 2026-05-31
**Status:** Draft
**Author:** Competitive research + codebase audit

---

## 1. Competitive Landscape Summary

### 1.1 Red Hat Insights (Lightspeed Remediations)

The closest competitor -- also Ansible-based, also generates playbooks.

- **Creation:** Remediations are "plans" containing one or more issues/recommendations + target systems. Plans are created from any Insights advisor recommendation or compliance scan finding. A plan aggregates multiple issues into a single playbook.
- **Lifecycle states:** Plans have implicit states: `not executed` (N/A status), `running`, `succeeded`, `failed`. Plans can be `archived` (hidden from default view, viewable via filter) or `deleted` (permanent). No draft/expired states.
- **Staleness handling:** Connection status per system (`connected`, `disconnected`, `not configured`, `unknown`). Readiness checks gate execution -- if systems are disconnected or RHC client is inactive, the Execute button is disabled. No explicit "stale plan" concept, but plans referencing removed systems become non-executable.
- **Orphan handling:** No explicit orphan cleanup. Plans persist indefinitely until manually archived or deleted. Archive is one-way from UI.
- **Scan linkage:** Plans are linked to specific issue/recommendation IDs, not scan IDs. When the underlying issue is resolved (confirmed by next scan), the system disappears from the recommendation list. The plan itself remains but becomes effectively empty.
- **Dedup:** Unique plan names enforced per org. No duplicate names allowed. No content-level dedup.
- **Execution history:** Per-plan execution history tab shows timestamped runs with per-system status and logs.
- **Auto-verification:** Compliance scan task is automatically appended to remediation playbooks that include compliance issues.

### 1.2 Chef InSpec / Automate

- **Waivers as lifecycle:** Waivers are the primary exception mechanism. Each waiver has: `control` (ID), `expiration` (date or permanent), `justification` (text), `run_test` (boolean). Waivers auto-expire -- when the expiration date passes, the control is automatically re-enabled for scanning.
- **Remediation model:** Compliance Phase runs InSpec + Chef Infra together. Remediation is "desired state enforcement" -- Chef continuously converges to the declared state. No discrete remediation actions; instead, compliance and enforcement are a continuous loop.
- **Staleness:** Irrelevant in Chef's model -- every Chef run re-evaluates and re-enforces. Configuration drift is detected and corrected automatically on each run.
- **Orphan handling:** Waivers with expiration dates self-clean. Permanent waivers require manual review.
- **Tracking:** Chef Automate dashboard shows compliance trending over time, waiver status, and corrective changes (drift that was auto-fixed).

### 1.3 Puppet Comply

- **Exception management:** Exceptions to CIS Benchmark recommendations with business justification. When approved, exceptions adjust compliance scoring.
- **Remediation model:** Like Chef -- continuous desired-state enforcement via Puppet catalogs. "Corrective changes" are logged when drift is detected and auto-remediated.
- **Lifecycle:** Compliance Enforcement Modules enforce standards continuously. No discrete remediation lifecycle -- it's always on.
- **Staleness:** Configuration drift is detected and reported as corrective changes. The concept of "stale" doesn't apply since enforcement is continuous.
- **Tracking:** Console shows compliance trends, drift events, and which controls were auto-corrected.

### 1.4 Qualys Policy Compliance / VMDR

- **Remediation lifecycle:** Fully integrated with ITSM/change management. States: `Detection` -> `Ticket Created` -> `Approved` -> `Deployment Job Created` -> `Monitoring` -> `Closed` (after next scan confirms fix).
- **SLA tracking:** Severity-based SLAs (Critical: immediate, High: 15-30 days, etc.). Overdue items escalated automatically.
- **Staleness:** Patch reliability scoring (AI-based) to predict patch stability. Zero-day containment with isolation + rollback when no patch exists.
- **Dedup:** ITSM integration creates one ticket per vulnerability-asset pair. Duplicate detection via CMDB correlation.
- **Scan linkage:** Remediation tied to vulnerability detection events, not specific scan runs. Subsequent scans auto-close tickets when the vulnerability is no longer detected.
- **Orphan handling:** Policy-based recurring jobs keep systems patched. Expired/closed projects stop receiving updates.

### 1.5 Drata

- **Task management:** Control failures auto-generate remediation tasks assigned to control owners. Tasks have owner, status, SLA deadline.
- **SLA model:** Severity-based defaults (Critical: 24h, High: 15-30d, Medium: 60d, Low: 90d). Priority changes reset or maintain SLAs based on direction (upgrade resets, downgrade maintains).
- **Lifecycle states:** Issues flow through: `Detected` -> `Assigned` -> `In Progress` -> `Resolved` -> `Validated` -> `Closed`.
- **Staleness:** Continuous monitoring re-evaluates controls. If a previously-fixed control fails again, a new task is created.
- **Dedup:** One task per control failure. Re-occurrence creates a new task (not a duplicate).
- **Compliance-as-Code:** IaC scanning generates PR-level remediation guidance before deployment.

### 1.6 Vanta

- **Issue management:** Failing controls generate issues with owner assignment and notification (email/Slack).
- **Remediation workflow:** Issues sync bidirectionally with Jira/Asana/Linear/GitHub. Status in external tracker syncs back to Vanta.
- **AI guidance:** AI-generated code snippets for remediation, personalized to infrastructure.
- **Lifecycle:** Issues are `Open` -> `Assigned` -> `In Progress` -> `Resolved`. Evidence collection is automated throughout.
- **Staleness:** Continuous monitoring. Resolved issues are re-opened if the control fails again.
- **Dedup:** One issue per control failure per integration. External ticket sync prevents duplicate work.

### 1.7 CIS-CAT Pro

- **Assessment-only:** CIS-CAT Pro is a scanner, not a remediation engine. It produces conformance reports (0-100 score) with written remediation guidance per failed control.
- **Dashboard tracking:** CIS-CAT Pro Dashboard aggregates results over time for trend analysis. Shows compliance by benchmark, system, and control.
- **Exceptions:** Dashboard supports exception creation with business justification. Approved exceptions improve compliance scoring.
- **Lifecycle:** Assess -> Remediate (external) -> Re-assess. No built-in remediation execution.
- **Staleness:** Not handled -- assessments are point-in-time. No continuous monitoring.

### 1.8 Rapid7 InsightVM (Bonus -- strong lifecycle model)

- **Remediation projects:** Discrete projects containing solutions for vulnerabilities on specific assets within a timeframe.
- **Solution states:** `Open` -> `Awaiting Verification` -> `Closed` or `Reopened`. Also `Will Not Fix`.
- **Project types:** Static (fixed scope) vs Dynamic (auto-update as conditions change -- solutions added but not removed as you remediate).
- **Validation scanning:** Built-in verification scans that transition solutions from `Awaiting Verification` to `Closed` or `Reopened`.
- **Staleness:** Expired projects stop receiving updates. Dynamic projects auto-add new solutions but never auto-remove existing ones.
- **Ticketing:** Bidirectional sync with JIRA/ServiceNow. Status changes in ticketing system flow back to solution status.

---

## 2. Our Current State

### What we have

| Aspect | Implementation | File |
|--------|---------------|------|
| **Data model** | `RemediationProfile`: id, name, description, complianceProfileId, scanId, selections (JSON blob), createdAt, updatedAt | `profiles.ts`, `ComplianceDatabase.ts` |
| **Storage** | Single `compliance_remediation_profiles` table. No status column. No execution history. | `ComplianceDatabase.ts` L392-473 |
| **Creation** | Auto-save on 2s debounce timer in RemediationProfileBuilder. Saves on any selection change. | `RemediationProfileBuilder.tsx` L194-214 |
| **Listing** | Flat list ordered by created_at desc. Shows name, profile, rule count, dates. | `RemediationsList.tsx` |
| **Execution** | "Apply" button navigates to `/compliance/execute/:id` with scanId in query params. Launches JT directly with job_tags. | `RemediationExecution.tsx` L622-694 |
| **Dedup** | In-memory 60-second window dedup on launch (`recentRemediations` Map) + frontend URL replacement (after launch, URL switches from `/execute/` to `/remediation-result/` so refresh enters view mode). No persistent dedup. | `router.ts` L846-854, `RemediationExecution.tsx` |
| **Scan linkage** | `scanId` stored at profile creation time. Used to load findings for display but execution always uses latest findings. | `router.ts` L878-882 |
| **Cleanup** | Manual delete only. No auto-cleanup, no archival, no expiration. | `RemediationsList.tsx` L86-98 |
| **History** | None. No execution log, no status tracking, no run count. | -- |
| **Staleness** | None. Profiles with stale scanIds silently work (or silently break). | -- |

### Identified Problems

1. **Orphaned profiles:** Auto-save creates profiles on every browser session where the user types a name. Page reloads, navigating away and back, or opening the page in a second tab all create new profiles. No uniqueness constraint, no merge logic.

2. **Duplicate profiles:** No name uniqueness enforcement. Multiple profiles with identical names and selections accumulate silently.

3. **No lifecycle states:** A remediation profile has no concept of `draft`, `ready`, `executing`, `completed`, `archived`. It is always just "saved."

4. **Stale scanId:** The `scanId` captured at creation time becomes stale after subsequent scans. The code works around this by always using latest findings for execution (router.ts L878), but the UI shows stale scan context.

5. **No execution history:** When you run a remediation, there is no record linking the profile to the execution job. You cannot answer "when was this last applied?" or "what was the result?"

6. **No verification linkage:** After remediation executes, the user can manually launch a verification scan, but there is no link back from the verification to the remediation that triggered it.

7. **No SLA or deadline tracking:** No concept of "this remediation should be applied by X date" or "these findings are overdue."

8. **No ownership model:** Remediation profiles have no owner/assignee. Anyone can create, anyone with admin can delete.

---

## 3. Gap Analysis Matrix

| Capability | Insights | Chef | Qualys | Drata | Vanta | InsightVM | **Us** | Gap |
|-----------|---------|------|--------|-------|-------|-----------|--------|-----|
| Lifecycle states | Partial (implicit) | N/A (continuous) | Full (5+ states) | Full | Full | Full (5 states) | **None** | Critical |
| Execution history | Yes (per-plan) | N/A (continuous) | Yes (ITSM) | Yes | Yes (ticket sync) | Yes | **None** | Critical |
| Stale plan handling | Readiness checks | N/A | Auto-close on scan | Re-detect | Re-detect | Dynamic projects | **None** | High |
| Dedup / uniqueness | Name uniqueness | N/A | CMDB correlation | One per control | One per control | Per-solution | **60s timer + URL guard** | High |
| Archive / soft-delete | Archive + delete | Waiver expiry | Project close | Resolve + close | Resolve | Project expire | **Hard delete only** | Medium |
| Verification linkage | Auto-appended scan | Continuous | Next scan auto-closes | Continuous monitoring | Continuous | Validation scans | **Manual, no link** | High |
| SLA / deadline | N/A | Waiver expiry dates | Severity-based SLAs | Severity-based SLAs | N/A | Project deadlines | **None** | Low (P3) |
| Ownership / assignment | Org-level | N/A | ITSM assignee | Control owner | Issue owner | Project assignee | **None** | Low (P3) |
| Auto-save race conditions | N/A | N/A | N/A | N/A | N/A | N/A | **Yes (bug)** | Critical |

---

## 4. Prioritized Recommendations

### P0 -- Fix broken auto-save (immediate)

**Problem:** The auto-save fires on a 2-second debounce. If the user navigates to the RemediationProfileBuilder, types a name, and the browser reloads (or they open it in another tab), a new profile is created with no way to detect it was unintentional. The `savedProfileId` state is local to the React component -- it is lost on unmount.

**Recommendation:**
- Add idempotency key based on `(complianceProfileId, scanId)` or `(complianceProfileId, userId, sessionId)`. If a draft already exists for this combination, update it instead of creating a new one.
- Add `status: 'draft' | 'saved'` column. Auto-saved profiles start as `draft`. Explicit "Save" button transitions to `saved`. Draft profiles older than 24h are eligible for cleanup.
- Add name uniqueness constraint per compliance profile.

**Schema change:**
```sql
ALTER TABLE compliance_remediation_profiles
  ADD COLUMN status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN created_by TEXT,
  ADD COLUMN last_executed_at TEXT,
  ADD COLUMN execution_count INTEGER NOT NULL DEFAULT 0;
```

### P1 -- Lifecycle states and execution history

**Problem:** No way to know if a remediation was ever applied, when, or what happened.

**Recommendation:** Add a `compliance_remediation_executions` table:

```sql
CREATE TABLE compliance_remediation_executions (
  id TEXT PRIMARY KEY,
  remediation_profile_id TEXT NOT NULL,
  scan_id TEXT,                        -- assessment scan that informed this run
  workflow_job_id INTEGER,             -- Controller job ID
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | running | succeeded | failed | cancelled
  started_at TEXT NOT NULL,
  completed_at TEXT,
  rules_applied INTEGER,
  rules_failed INTEGER,
  hosts_targeted INTEGER,
  verification_scan_id TEXT,           -- link to follow-up verification scan
  created_by TEXT
);
```

Update the remediation profile status based on execution results:
- `draft` -- auto-saved, not explicitly committed
- `saved` -- explicitly saved by user
- `pending` -- saved and awaiting execution
- `applied` -- at least one successful execution
- `archived` -- user-archived (soft delete, hidden from default list)

This matches the Insights pattern (plan -> execute -> history) and InsightVM pattern (Open -> Awaiting Verification -> Closed).

**Frontend changes:**
- Show last execution date and result on the RemediationsList table
- Add execution history tab/accordion on the profile detail view
- Show status chip (Draft, Saved, Applied, Archived) on each row

### P2 -- Stale scan and verification linkage

**Problem:** The `scanId` on a remediation profile becomes stale. Findings change between scans. The verification scan after remediation has no formal link back.

**Recommendation:**
- **Decouple profile from scan:** Remove `scanId` from the remediation profile. The profile defines *what* to fix (rule selections + parameters). The *which hosts* question is answered at execution time from the latest findings (we already do this in `router.ts` L878-882).
- **Link execution to scans:** The execution record captures `scan_id` (which scan informed the host targeting) and `verification_scan_id` (which scan verified the results).
- **Freshness indicator:** On the RemediationProfileBuilder, show a warning if the profile's rule selections reference rules that are no longer in the latest findings (e.g., "3 rules in this profile were not found in the latest scan -- they may have been resolved or the benchmark changed").

This matches the Insights model (plan references issues, not scans) and the Qualys model (tickets reference vulnerability detections, auto-close on resolution).

### P3 -- Cleanup and archival

**Problem:** Profiles accumulate indefinitely. No way to distinguish stale drafts from active remediations.

**Recommendation:**
- Add scheduled cleanup: delete `draft` profiles older than 7 days with `execution_count = 0`.
- Add archive action: moves profile to `archived` status, hidden from default list but viewable via filter.
- Add filter controls to RemediationsList: "All", "Active", "Archived", "Drafts".
- Match Insights pattern: archive is one-way from UI, delete is permanent.

### P4 -- Name uniqueness and dedup

**Problem:** Multiple profiles with identical names. In-memory dedup only prevents rapid double-clicks.

**Recommendation:**
- Enforce unique `(name, compliance_profile_id)` constraint in the database.
- On save, if a profile with the same name exists for this compliance profile, offer to update instead of create.
- Replace the in-memory dedup Map with a database check: "is there a running execution for this profile created within the last 60 seconds?"

### P5 (Future) -- SLA tracking and ownership

Low priority for MVP but important for enterprise readiness.

- Add `assignee` and `due_date` columns to remediation profiles.
- Show overdue remediations on the dashboard.
- Consider Jira/ServiceNow integration for bidirectional ticket sync (matches Qualys, Drata, Vanta patterns).

---

## 5. Key Design Patterns to Adopt

### From Red Hat Insights
- **Plan = reusable template.** A remediation plan is not bound to a single scan. It aggregates issues that persist across scans. Apply the same pattern: our remediation profile is a reusable set of rule selections that can be applied to any future scan.
- **Execution history per plan.** Every execution is logged with timestamp, status, and per-system results. Critical for audit trail.
- **Unique names per org.** Prevents the duplicate profile problem entirely.
- **Auto-verification.** Compliance scan appended to remediation playbook. We should link verification scans to the execution record.

### From Rapid7 InsightVM
- **Solution status model:** Open -> Awaiting Verification -> Closed/Reopened. This is the best discrete lifecycle model for our use case since we are not a continuous enforcement engine.
- **Validation scans.** Built-in verification that transitions status. We already have verification scans -- we just need to link them.
- **Dynamic vs static scope.** Dynamic projects auto-add new solutions. We should consider this for profiles that track a category (e.g., "all CAT I failures").

### From Drata/Vanta
- **One remediation per control failure.** Prevents orphans by design. Not directly applicable to our batch model, but the principle of "one active remediation per scope" is useful.
- **Continuous monitoring closes the loop.** When a subsequent scan shows the finding is resolved, the remediation status should auto-update.

### From Chef/Puppet
- **Waiver expiry.** Waivers with expiration dates auto-clean. We should apply this to archive: profiles not executed in 90 days auto-archive.
- **Continuous enforcement is the gold standard** but is architecturally different from our scan-remediate-verify model. Not applicable for MVP.

---

## 6. Implementation Sequence

| Phase | Items | Effort | Dependencies |
|-------|-------|--------|-------------|
| **Phase 1** (P0+P1) | Draft status, idempotent auto-save, execution history table, status tracking | 2-3 days | Migration 011, backend + frontend |
| **Phase 2** (P2) | Decouple scanId, verification linkage, freshness warnings | 1-2 days | Phase 1 |
| **Phase 3** (P3+P4) | Archive, cleanup job, name uniqueness, dedup improvements | 1-2 days | Phase 1 |
| **Phase 4** (P5) | SLA, ownership, ITSM integration | Future | Phase 1-3 |

Total for Phases 1-3: approximately 5-7 days of implementation work.
