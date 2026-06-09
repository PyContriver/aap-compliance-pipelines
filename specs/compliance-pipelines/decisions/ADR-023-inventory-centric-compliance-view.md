# ADR-023: Inventory-Centric Compliance View

**Status:** Proposed (design phase)  
**Date:** 2026-06-09  
**Deciders:** Massimo Ferrari  

## Context

The plugin's navigation is profile-centric: everything flows from "which compliance standard are you checking?" (Overview → Profiles → Scan → Results → Remediations → Settings). User testing on 2026-06-09 revealed that operational users think inventory-first: "what's the compliance status of this set of hosts?"

Current inventory representation:
- Dashboard `InventoryPostureView` shows per-inventory gauges grouped by profile (clickable)
- Scan history groups by `(profile × inventory)` (ADR-016)
- Filters exist for inventory on scan history and results pages
- Inventory is a parameter, not an entity — no dedicated view

Competitive reference:
- Puppet Comply: "node-centric" and "control-centric" toggle views
- Drata/Vanta: Resource-level drill-down from dashboard (not a top-level tab)
- CIS-CAT Pro: Host-level assessment summaries

## Decision

### §1 — Drill-Down Route, Not a New Tab

Add an inventory detail page at `/compliance/inventory/:inventoryId`. This is a drill-down from the dashboard's `InventoryPostureView` cards, not a new top-level tab. Rationale:
- Keeps tab count at 5 for cognitive simplicity
- Consistent with competitive pattern (drill-down views)
- Lower risk than restructuring primary navigation
- Can be elevated to a tab later if validated by usage

### §2 — Inventory Detail Page Content

| Section | Content | Data Source |
|---------|---------|-------------|
| **Header** | Inventory name, host count, last scanned date | Controller API (live fetch) + local scan records |
| **Compliance Posture** | Per-profile gauges (STIG score, CIS score, etc.) | `compliance_scans` + `scan_stats` aggregated by `inventory_id` |
| **Scan History** | Scan list filtered to this inventory | Reuse `ScanHistory` component with `inventoryId` prop |
| **Active Remediations** | Running/recent executions targeting this inventory | `remediation_executions` filtered by `inventory_id` |
| **Baseline Targets** | Pinned baselines for this inventory | `compliance_baseline_targets` filtered by `inventory_id` |
| **Host List** | Per-host compliance scores (pass/fail/N/A counts) | Findings data aggregated by host |

### §3 — No Composite Cross-Framework Score

When multiple compliance profiles have been scanned against the same inventory (e.g., STIG + CIS), the inventory detail page shows **per-framework gauges side by side**. No composite aggregate score.

Rationale:
- No industry standard for combining STIG and CIS scores
- A composite number creates false confidence ("82% compliant" means nothing when mixing frameworks with different rule counts and severity distributions)
- Side-by-side gauges let users compare framework-specific posture

### §4 — Controller as Source of Truth for Inventory Metadata

The inventory entity (name, host list, description, variables) lives in the AAP Controller. The plugin stores only `inventory_id` as a foreign key reference. The inventory detail page fetches live metadata from Controller on load via the platform gateway (`/api/controller/v2/inventories/:id/`).

This avoids stale data and is consistent with the existing pattern where the plugin never caches Controller entity metadata (ADR-001 §2).

### §5 — Implementation Approach

**Phase 1 (MVP):**
- New route `/compliance/inventory/:inventoryId` with `InventoryDetail` component
- Header + compliance posture gauges + scan history (reuse existing)
- Click-through from dashboard `InventoryPostureView` cards

**Phase 2 (Enhancement):**
- Active remediations section
- Baseline targets management inline
- Host list with per-host drill-down

**Phase 3 (Future — requires further design):**
- Inventory-first navigation toggle on dashboard
- Inventory comparison view (side-by-side posture for multiple inventories)

### §6 — Boundary: Plugin ≠ Inventory Management

The inventory detail page shows compliance posture per inventory using data the plugin already has. It does not:
- Manage inventory membership (add/remove hosts) — that's Controller's domain
- Show non-compliance host metadata (OS version, packages, etc.) — that's CMDB
- Aggregate across inventories into a fleet score — that's an Insights-level feature

This boundary prevents scope creep into asset management territory.

## Consequences

- New route and component (`InventoryDetail`)
- Controller API call for inventory metadata on page load
- Reuses existing components (ScanHistory, posture gauges) with filter props
- No new database tables or backend endpoints (all data already queryable)
- Dashboard `InventoryPostureView` cards become clickable (navigate to detail)
- Future path to inventory-first navigation if user testing validates the pattern
