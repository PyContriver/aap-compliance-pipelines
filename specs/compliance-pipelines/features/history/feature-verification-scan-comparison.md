---
title: "Feature: Verification Scan Comparison"
description: "After remediating findings, users need to re-scan to verify effectiveness"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Verification Scan Comparison

**Status:** Shipped (2026-05-21)
**Commits:** `eaaa1f9` (UUID scan ID fix), `76cc982` (architect review)

## Problem

After remediating findings, users need to re-scan to verify effectiveness. Without a before/after comparison, there is no way to confirm which rules were fixed and which remain non-compliant. The verification scan uses the same assessment JT but the results need to be compared against the pre-remediation baseline.

## Design Approach

Verification scans use the same assessment JT as initial scans (read-only, never modifies hosts). The frontend compares the latest scan results against previous findings for the same inventory and profile, showing which rules changed status (e.g., fail to pass). Previous findings are looked up by matching scan parameters.

## Implementation Summary

- Same `compliance-run-oscap` JT used for both initial and verification scans
- Backend: previous-findings lookup by inventory + profile combination
- Frontend: before/after comparison in ResultsViewer showing status changes
- Fixed previous-findings lookup for UUID scan IDs (was using integer comparison)
- Metadata persists across scans (rule metadata table populated on first scan, available for comparison view)

## Testing

- End-to-end verified on netrunner: scan, remediate, re-scan, compare results
- Round 3 testing confirmed metadata persists across verification scans
- UUID scan ID lookup fix validated

## Dependencies

- ADR-003 (single assessment JT) -- same JT for initial and verification scans
- Feature: XCCDF Metadata Extraction -- metadata available for both scan results
