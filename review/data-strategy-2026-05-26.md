# Data Strategy Decision Record

**Date:** 2026-05-26
**Status:** Accepted
**Context:** Multi-inventory dashboard, scale to 20K hosts, EDA integration

## Decision

Define the boundary between local plugin database and AAP Controller API as the data source for each category of compliance data.

## Local Database (plugin's PostgreSQL)

| Table | Why Local |
|-------|-----------|
| `compliance_findings` | Normalized structured data — Controller stores only raw job events. Re-parsing 7.3M events per view is infeasible. |
| `compliance_posture_snapshots` | Plugin-computed aggregates. Controller retention is 120 days; trends need 12+ months. |
| `compliance_remediation_profiles` | User-created content (rule toggles, parameter overrides). No Controller analog. |
| `compliance_cartridge_registry` | Plugin config bridging profiles to Controller resources. |

## Controller API (on-demand)

| Data | Approach |
|------|----------|
| Scan status/errors | Derive from `GET /workflow_jobs/{id}/` with 30s TTL cache |
| Inventories/templates | Already fetched live |
| Job events/nodes | Pass-through for progress polling |

## Schema Migration 003

Batched changes:
1. Add `inventory_id` (integer, not null) to `compliance_posture_snapshots`
2. Add `inventory_name` (string, nullable) to `compliance_posture_snapshots`
3. Add `inventory_id` (integer, nullable) to `compliance_remediation_profiles`
4. Demote `status`/`completed_at` on `compliance_scans` to cache columns

## Scale Plan

At 20K hosts × 366 rules = 7.3M findings per scan:
- Tiered retention: full detail 14 days, rule-level aggregates 90+ days
- Posture snapshots stay small (1 row per scan)
- Batch inserts (100-row) sufficient for write throughput

## Consequences

- Multi-inventory dashboard unblocked (posture snapshots gain inventory context)
- Remediation-inventory binding unblocked (profiles gain inventory column)
- EDA integration has required schema (inventory_id on snapshots)
- Scan list view needs TTL cache to avoid N Controller API calls
