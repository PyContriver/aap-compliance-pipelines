# ADR-014: Remediation Lifecycle Architecture

**Status:** Proposed  
**Date:** 2026-05-31  
**Deciders:** Massimo Ferrari  

## Context

Remediations are stateless. The `compliance_remediation_profiles` table stores rule selections but has no execution history, no lifecycle states, and no verification linkage. Five concrete failures drove this work:

1. **Wrong findings scoping.** A STIG remediation launched against CIS findings because CIS scanned more recently, sending the job to localhost instead of the compliance inventory.
2. **Ghost scan records.** Every remediation creates a `compliance_scans` row with `scanner='remediation'`, polluting scan history and losing multi-group `allJobIds`.
3. **No execution history.** Users cannot answer "when was this last run?" or "what happened?"
4. **Orphan profiles.** Auto-save creates a new profile on every browser session with no uniqueness constraint or cleanup.
5. **No verification linkage.** The "Run Verification Scan" button launches a scan with zero linkage back to the remediation.

Competitive analysis across 8 platforms (Red Hat Insights, Rapid7 InsightVM, Qualys, Drata, Vanta, Chef Automate, Puppet Comply, CIS-CAT Pro) shows every platform with discrete remediation actions provides execution history, lifecycle states, and verification linkage.

### Architectural principle: Controller is the source of truth

Every remediation executes via AAP Controller — that is the product's value proposition. The plugin stores lightweight pointers (job IDs, timestamps, rule/host counts) for UX purposes, but Controller is the authority for execution state, task events, host results, and job logs. The plugin never duplicates what Controller already tracks. Drill-down always fetches live from Controller.

This applies to scans as well — scan execution is outsourced to Controller/OpenSCAP. The plugin stores normalized findings for local querying, but the raw scan data lives in Controller.

## Decision

### 1. Add an execution history table

A new `compliance_remediation_executions` table stores one row per remediation launch. Each row captures:

- Which profile was applied (`remediation_profile_id`)
- Which assessment scan informed the host targeting (`informing_scan_id`)
- All Controller job IDs (`primary_job_id` + `all_job_ids` JSON array)
- Outcome summary (`status`, `rules_applied`, `hosts_targeted`, `elapsed_seconds`)
- Verification linkage (`verification_scan_id`)
- The remediation plan that was executed (`plan_summary` JSON)

This follows the "summary + link to Controller" pattern used by Chef Automate (convergence summaries + link to detailed run report). No per-host findings are duplicated — drill-down fetches task events live from Controller via `GET /jobs/{id}/job_events/`.

### 2. States live on executions, not on profiles

Profile states: `draft | saved | archived`. User-controlled lifecycle stages.

Execution states: `pending | running | succeeded | failed | cancelled`. System-derived from Controller job status.

The profile's "latest execution status" is computed at query time by joining to the most recent execution record. This avoids dual-write synchronization where the profile state could diverge from the actual execution outcome.

### 3. Deprecate remediation-as-scan records

Stop creating `compliance_scans` rows with `scanner='remediation'`. The execution table replaces this. Transition: dual-write during Phase 1, migrate consumers in Phase 2, stop scan record creation in Phase 3.

### 4. Verification linkage is explicit

When the user clicks "Run Verification Scan" after a remediation, the execution ID is passed through the scan launch flow. The backend updates `verification_scan_id` on the execution record. This is the InsightVM pattern (validation scans transition solution status).

### 5. Auto-save produces drafts with upsert semantics

Auto-save creates/updates a profile with `status='draft'`. Explicit "Save" transitions to `saved`. Name uniqueness enforced per `(name, compliance_profile_id)`. Auto-save uses upsert: if a draft exists for the same `(compliance_profile_id, name)`, update it instead of creating a new row.

## Known Limitations

1. **No SLA tracking.** Severity-based due dates deferred to Phase 4.
2. **No auto-close on scan.** Automatic status transition when a subsequent scan shows findings resolved is deferred — requires careful design around partial remediation.
3. **Execution summary is static.** Counts are written at completion and do not update if a subsequent scan shows regression.
4. **No ITSM integration.** Bidirectional ticket sync with Jira/ServiceNow is out of scope.

## Alternatives Considered

1. **States on the profile (Qualys ticket model).** Rejected: dual-write synchronization, profiles are reusable templates not one-shot tickets.
2. **Infer verification from scan history.** Rejected: ambiguous with multiple scans, InsightVM uses explicit linkage.
3. **Store per-host execution findings.** Rejected: Controller is the source of truth for task events, no duplication needed, team preferred summary + link approach.
4. **Keep remediation-as-scan records permanently.** Rejected: scan table lacks remediation-specific fields, requires filtering everywhere.

## Consequences

- Remediations gain a complete audit trail with Controller as source of truth for details
- Multi-group job IDs (ADR-013) are fully persisted and queryable
- Dashboard and scan history no longer polluted by remediation scan records
- Auto-save orphans eliminated by draft status + name uniqueness + cleanup
- Database growth is negligible: ~555 KB/year at 10 profiles × 2 runs/week

## Related

- ADR-009: CaC remediation via direct JT
- ADR-013: Multi-group remediation with per-host scoping (Known Limitation #1 resolved)
- Feature spec: `specs/compliance-pipelines/features/feature-remediation-lifecycle.md`
- Gap analysis: `specs/compliance-pipelines/features/remediation-lifecycle-gap-analysis.md`
