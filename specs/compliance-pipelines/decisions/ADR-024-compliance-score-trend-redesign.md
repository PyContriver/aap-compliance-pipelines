# ADR-024: Compliance Score Trend Chart Redesign

**Status:** Accepted (Implemented 2026-06-11)  
**Date:** 2026-06-11  
**Deciders:** Massimo Ferrari  

## Context

The original compliance score trend chart was a hand-rolled SVG component (160 lines inline in `ComplianceDashboard.tsx`) that showed a single aggregate compliance line. It had no scope selector, no event highlighting, and only 3 date labels. Users couldn't distinguish per-profile or per-inventory trends, and couldn't see whether a score change was a regression or improvement.

### Competitive Research (2026-06-11)

Research across 11 platforms (Drata, Vanta, Qualys, Tenable, Wiz, Datadog, Grafana, SonarQube, Snyk, CIS-CAT Pro, Puppet Comply) found:
- **Every platform** scopes trends per-standard with a selector, not a single blended line
- **CIS-CAT Pro**: each selected benchmark gets its own line on the graph
- **Datadog/Grafana**: event annotations (vertical lines) mark deployments/incidents on the timeline
- **Drata**: 7-day change baseline with red dots for new failures
- **SonarQube**: event markers for quality gate changes, profile changes, version releases

## Decisions

### §1 — Recharts replaces hand-rolled SVG

Use Recharts library for the trend chart. Provides custom dots, reference lines, tooltips, responsive containers, and monotone curve interpolation out of the box.

### §2 — Three-level scope selector

Toggle buttons (All Profiles / Per Profile / Per Inventory):
1. **All Profiles**: one line per compliance profile, overlaid with legend. Multi-color palette.
2. **Per Profile**: single line for a selected profile, dropdown to pick which.
3. **Per Inventory**: single line for a selected (profile × inventory) pair, two dropdowns.

Dropdowns populated from existing `DashboardStats.frameworkScores` and `DashboardStats.byInventory` — no new API calls for scope metadata.

### §3 — Event highlighting with shape redundancy

- **Regression**: red downward triangle (`#C9190B`), triggered when score drops ≥3 percentage points
- **Improvement**: green upward triangle (`#3E8635`), triggered when score improves ≥5 percentage points
- **Normal**: small blue circle (`#0066CC`)
- **Remediation events**: gray dashed vertical reference lines (`#6A6E73`) at completion timestamps

Shape redundancy (triangles vs circles) ensures colorblind accessibility alongside red/green coloring.

### §4 — Event detection is client-side

Compare consecutive `PostureSnapshot` points to detect regressions/improvements. No new database columns. Remediation events fetched via new `GET /posture/events` endpoint (lightweight query on existing `compliance_remediation_executions` table).

### §5 — Backend additions

- `GET /posture` gains `inventoryId` query parameter (filters `compliance_posture_snapshots` by `inventory_id`)
- `GET /posture/events` returns `RemediationEvent[]` (completed executions in time range)
- Posture history LEFT JOINs `compliance_scans` to include `workflowJobId` for numeric scan navigation (not UUID)
- Input validation via `parseInventoryId()` in validation module

## Implementation Notes (2026-06-11)

Fully implemented and merged:
- `PostureTrendChart.tsx` (520 lines) — new Recharts component with scope selector
- `trendUtils.ts` — event detection (`detectEvents`), multi-profile series (`buildMultiProfileSeries`)
- `trendUtils.test.ts` — 16 unit tests for detection thresholds and multi-profile grouping
- Architect review completed: H1 (input validation), H2 (type safety), H3 (null guards) fixed
- `type="monotone"` for smooth curve interpolation
- Old inline SVG chart removed from `ComplianceDashboard.tsx` (160 lines deleted)

## Related

- ADR-012: Dashboard UX competitive alignment (original chart design)
- ADR-023: Inventory-centric view (uses the Per Inventory scope from this chart)
