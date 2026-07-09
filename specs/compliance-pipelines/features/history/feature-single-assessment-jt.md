---
title: "Feature: Single Assessment JT with 2 Plays"
description: "The original assessment architecture used a 2-node workflow: Node 1 ran the scan on targets, Node 2 processed results on"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Single Assessment JT with 2 Plays

**Status:** Shipped (2026-05-26, PRs #7-#9)
**Commits:** `98a4813` (PR #7), `3cb28ab` (PR #8), `49c43c3` (PR #9)
**ADR:** ADR-003

## Problem

The original assessment architecture used a 2-node workflow: Node 1 ran the scan on targets, Node 2 processed results on localhost. During the oscap migration, we discovered that AAP workflow nodes run in separate containers. The scan play fetches XCCDF XML files from targets to the execution node, but a second workflow node cannot access those files because it runs in a different container. This is a fundamental AAP architecture constraint.

## Design Approach

Use a single job template (`compliance-run-oscap`) running `run_oscap.yml` with two plays in the same container:

- **Play 1** (scan): Runs on target hosts -- installs oscap, copies datastream from EE, runs `oscap xccdf eval`, fetches XCCDF XML results, cleans up
- **Play 2** (normalize): Runs on localhost (same container) -- `normalize_xccdf` module parses XML, strips XCCDF prefix from rule IDs, extracts metadata, outputs CFF JSON

Remediation remains a separate, standalone JT -- never combined with assessment. The gap between assess and remediate is the decision point where intelligence lives (human review, EDA policy, AI agent).

## Implementation Summary

- `run_oscap.yml`: merged scan and normalize into one playbook with 2 plays
- `normalize.yml`: retained as standalone utility for debugging and Tier 2 reuse
- Config-as-code updated: JT `compliance-run-oscap` (id=49) replaces multi-node workflow for assessment
- Legacy workflow and old JTs retained but no longer used
- Backend updated to look for normalize task output in assessment job events
- All 14 docs updated for 1-node architecture (PR #9)

## Testing

- End-to-end scan on netrunner lab confirmed fetched files available to Play 2
- Per-host normalization validated (loop over XML files, one host at a time)

## Dependencies

- ADR-004 (oscap migration) -- the scan play depends on oscap
- ADR-008 (agentless pattern) -- the install/scan/remove sequence in Play 1
- ADR-005 (slim findings) -- per-host processing required for event size limits
