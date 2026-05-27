# Feature: Remediation Builder

**Status:** Shipped (2026-04-28 initial, 2026-05-27 enhanced with PR #18)
**Commits:** `da73301` (host-level rewrite), `ed81191` (CaC mapping), `cb9c8e2` (PR #18)

## Problem

Users need to select which non-compliant findings to remediate, set parameter overrides where applicable, and scope remediation to specific hosts. The builder must produce the `job_tags`, `extra_vars`, and `limit` values needed to launch a remediation JT via AAP Controller.

## Design Approach

A multi-step builder interface:
1. **Finding selection:** Per-rule On/Off toggles showing status, severity, and host breakdown
2. **Parameter overrides:** For parameterized rules (SSH timeout, permission bits), allow custom values
3. **Scope selection:** Choose target hosts from the scan inventory
4. **Review and launch:** Summary of selections before launching the remediation JT

Enhanced in PR #18 with search bar and Select Visible / Deselect Visible controls for managing large rule sets (366+ rules).

## Implementation Summary

- `RemediationProfileBuilder` component: tabular view with per-finding toggles
- Host-level granularity rewrite (`da73301`): ResultsViewer and builder show per-host pass/fail
- CaC mapping (`ed81191`): rule IDs map to CaC tags for `job_tags` construction
- **PR #18:** Search bar filters rules by title/ID. "Select Displayed" and "Deselect Displayed" buttons scoped to current filter/search results. Fixed `this.config` bug.
- Backend builds `job_tags` string from selected rule IDs, `extra_vars` from parameter overrides
- Remediation profiles auto-saved (see Feature: Auto-Save Remediations)

## Testing

- Builder workflow validated end-to-end with real remediation launches
- Search and bulk select tested on 366-rule STIG dataset
- Architect review addressed (dependency arrays, input validation)

## Dependencies

- ADR-009 (CaC remediation) -- the `job_tags` pattern the builder produces
- Feature: Auto-Save Remediations -- selections persisted automatically
- Feature: CaC Remediation via Direct JT -- the launch target
