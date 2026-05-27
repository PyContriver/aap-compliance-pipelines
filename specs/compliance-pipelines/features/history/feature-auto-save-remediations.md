# Feature: Auto-Save Remediations (Insights Pattern)

**Status:** Shipped (2026-04-29)
**Commits:** `ed81191` (P2 items), `c366929` (P3 items)

## Problem

Traditional save-dialog patterns (explicit Save button, unsaved changes warnings) add friction to the remediation workflow. Users building remediations toggle many individual rules on/off and adjust parameters -- requiring a manual save after each session risks losing work. Red Hat Insights uses an auto-save pattern where user selections are persisted immediately.

## Design Approach

Follow the Insights pattern: no save dialog. Every toggle, parameter change, and scope selection is persisted immediately to the database. The RemediationProfileBuilder auto-saves on every user action. Users can return to a remediation at any time and find their selections intact.

## Implementation Summary

- RemediationProfileBuilder: debounced auto-save on toggle/parameter changes
- Backend: `PUT /remediations/:id` updates remediation profile in database
- `compliance_remediation_profiles` table: stores rule selections, parameter overrides, scope
- No "Save" button in the UI -- all changes are persisted automatically
- "Use Existing Remediation" allows returning to previously saved remediations

## Testing

- Auto-save validated through remediation builder workflow
- Persistence confirmed across page navigation and browser refresh
- Multiple remediation profiles can coexist

## Dependencies

- `compliance_remediation_profiles` table (Knex migration)
- ADR-009 (CaC remediation) -- remediation profiles define `job_tags` and `extra_vars`
