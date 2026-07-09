---
title: "Feature: Direct POST Findings from Playbook to Plugin API"
description: "The original approach parsed compliance findings from Controller job events"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Direct POST Findings from Playbook to Plugin API

**Status:** Shipped (2026-05-27, PRs #17, #19)
**Commits:** `dceaa87` (PR #17), `ebc87c4` (PR #19)
**ADR:** ADR-007

## Problem

The original approach parsed compliance findings from Controller job events. This was fragile: Controller events have a ~200KB payload limit (requiring slim findings), the backend must poll and parse specific task names, and any change in task naming breaks the pipeline. The PM and architect both recommended decoupling the data channel from Controller's event system.

## Design Approach

Have the playbook POST findings directly to the plugin's REST API via the Ansible `uri` module, bypassing Controller events entirely. Full CFF metadata can be transmitted (no stripping needed). Event parsing retained as fallback when `backstage_api_url` is not set.

## Implementation Summary

- **PR #17:** New `POST /api/compliance/findings/ingest` endpoint accepting CFF JSON + `scan_id`. Added `uri` task in normalize play. `scan_id` and `backstage_api_url` passed as extra_vars.
- **PR #19:** Per-scan ingest token security (ADR-010). Scan lifecycle fix: scans marked `failed` on launch error (no orphaned "running" scans). Variable ordering fix for extra_vars. Jinja `default([])` hardening in normalize play.
- Express body parser limit increased to 50MB (10 hosts x 438 rules = ~8-10MB payload with metadata)
- Backend processes full CFF findings including metadata, storing rule metadata in `compliance_rule_metadata` table (migration 003)

## Testing

- 11 new tests for `/findings/ingest` endpoint (token validation happy/unhappy paths)
- End-to-end on netrunner: Direct POST succeeded after body parser limit fix
- 3 deployment rounds (v0.2.0 to v0.4.0) to resolve payload size and metadata extraction issues

## Dependencies

- ADR-010 (per-scan ingest token) -- secures the ingest endpoint
- ADR-005 (slim findings) -- retained as fallback data channel
- ADR-003 (single assessment JT) -- the normalize play that POSTs findings
