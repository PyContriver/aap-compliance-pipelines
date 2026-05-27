# Feature: Posture Trending Dashboard

**Status:** Shipped (2026-04-26)
**Commits:** `c60a86e` (gauges + layout), `83e0ff9`, `98ff2e5` (gauge fixes)

## Problem

Compliance teams need an at-a-glance view of their security posture over time. Point-in-time scan results show current state but not trends. Without trending, users cannot tell if compliance is improving or degrading, and cannot demonstrate progress to auditors.

## Design Approach

Dashboard Overview tab with compliance gauges and a trend chart:
- **Gauges:** Overall compliance percentage, per-severity breakdown (CAT I/II/III), pass/fail/error counts
- **Trend chart:** Compliance percentage over time, plotted from posture snapshots

Posture snapshots are stored in `compliance_posture_snapshots` table (one row per scan with aggregate pass/fail counts). The trend chart reads from this table, providing historical data independent of findings retention.

## Implementation Summary

- `ComplianceGauge` component: SVG arc gauge with percentage display
- Dashboard layout: responsive CSS flexbox with gauges row and trend chart
- `compliance_posture_snapshots` table: `scan_id`, `profile_id`, `total_pass`, `total_fail`, `total_error`, `compliance_pct`, `scanned_at`
- Snapshot created automatically after each scan completes
- Trend chart renders snapshots over time
- Multiple responsive layout fixes during initial build (overflow, arc direction, MUI Grid issues)

## Testing

- Gauge rendering validated across viewport sizes
- Trend chart data confirmed from real scan snapshots
- Responsive layout fixes verified (10+ commits addressing overflow and flexbox issues)

## Dependencies

- Findings data from completed scans
- `compliance_posture_snapshots` table (populated automatically)
