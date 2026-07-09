---
title: "Feature: Agentless OpenSCAP Pattern"
description: "OpenSCAP requires the `openscap-scanner` binary and the SCAP Security Guide datastream on target hosts"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Agentless OpenSCAP Pattern

**Status:** Shipped (2026-05-26, PRs #4-#7)
**Commits:** `31fb54d` (PR #4), `98a4813` (PR #7)
**ADR:** ADR-008

## Problem

OpenSCAP requires the `openscap-scanner` binary and the SCAP Security Guide datastream on target hosts. Pre-installing oscap on all targets adds a persistent dependency that contradicts AAP's agentless automation model. Customers may not accept permanent scanner software on production hosts.

## Design Approach

Use an agentless install/scan/remove pattern in `run_oscap.yml` Play 1:
1. Install `openscap-scanner` from RHEL base repos on targets
2. Copy `ssg-rhel9-ds.xml` from EE to target (`/tmp/`)
3. Run `oscap xccdf eval`, producing XCCDF results XML
4. Fetch results XML back to execution node
5. Remove `openscap-scanner` and datastream from target

The `scap-security-guide` RPM (~80MB, all platforms) stays in the EE -- only the relevant datastream file (~6MB) is copied to each target.

## Implementation Summary

- `run_oscap.yml` Play 1: 5-step agentless sequence (install, copy, scan, fetch, remove)
- Uses `ansible.builtin.yum` for install/remove (RHEL base repos)
- Datastream source: `/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml` in EE
- XCCDF results fetched to execution node for Play 2 (normalize) processing
- ~10-15 seconds overhead per host for install/remove

## Testing

- End-to-end on netrunner lab hosts (RHEL 9.7)
- Verified zero persistent footprint after scan completion
- Confirmed oscap binary removed and temp files cleaned up

## Dependencies

- ADR-004 (oscap migration) -- the broader migration this pattern is part of
- ADR-003 (single assessment JT) -- Play 1 and Play 2 run in same container
- EE must include `scap-security-guide` RPM
- Targets must have access to RHEL base repos (or local mirror)
