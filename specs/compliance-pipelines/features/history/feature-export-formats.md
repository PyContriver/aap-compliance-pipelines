---
title: "Feature: Export Formats (CSV, JSON, CKL)"
description: "Compliance teams need to export scan results for audit evidence, offline review, and submission to external compliance s"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Export Formats (CSV, JSON, CKL)

**Status:** Shipped (2026-04-29)
**Commits:** `c366929` (P3 items batch)

## Problem

Compliance teams need to export scan results for audit evidence, offline review, and submission to external compliance systems. DISA requires CKL (STIG Viewer Checklist) format for STIG audits. CSV and JSON cover general reporting and integration needs.

## Design Approach

Three export formats available from the Results view:
- **CSV:** Tabular export for spreadsheets and reporting tools
- **JSON:** Machine-readable CFF format for integration with external systems
- **CKL:** DISA STIG Viewer Checklist format for audit submission

All exports are client-side (no backend endpoint) -- the frontend formats findings data that is already loaded.

## Implementation Summary

- Export buttons in ResultsViewer toolbar
- CSV generator: columns for rule_id, title, status, severity, stig_id, category
- JSON generator: full CFF JSON output
- CKL generator: XML format matching DISA STIG Viewer schema
- Exports scoped to current filter state (if CAT filter is active, export only visible findings)

## Testing

- Export functionality validated in unit tests
- CKL format verified against STIG Viewer import requirements
- CSV and JSON exports confirmed correct structure

## Dependencies

- ResultsViewer component (findings data source)
- CFF schema (JSON export format)
