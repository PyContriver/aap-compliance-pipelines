# Feature: OpenSCAP Migration

**Status:** Shipped (2026-05-26, PRs #4-#13)
**Commits:** `31fb54d` through `ad93d9e` (PRs #4-#13)
**ADR:** ADR-004

## Problem

The original scanning pipeline used custom `compliance_gather` and `compliance_evaluate` modules with 20 hand-written STIG rules. This had three critical problems: (1) only 20 rules vs 366 in the SCAP Security Guide, (2) custom checks evaluated different conditions than CaC remediation tasks (wrong paths, missed drop-in dirs), (3) every new rule required writing both evaluation logic and metadata by hand.

## Design Approach

Replace custom modules with an OpenSCAP-based pipeline using `oscap xccdf eval` and the SCAP Security Guide STIG datastream (`ssg-rhel9-ds.xml`). Write a `normalize_xccdf` module that parses XCCDF results XML and extracts all metadata directly from the datastream. Rule IDs are stripped of the XCCDF prefix (`xccdf_org.ssgproject.content_rule_`) so they match CaC remediation tag names.

DISA quarterly updates flow through Red Hat RPM updates to customer EE rebuilds -- zero rule maintenance.

## Implementation Summary

- **PR #4:** Core oscap pipeline -- `run_oscap.yml`, `normalize.yml`, `normalize_xccdf.py` module, backend + frontend updates, EE definition, config-as-code, collection docs and changelog
- **PR #5:** Added `execution_environment` to all JTs in config-as-code
- **PR #6:** Fixed `oscap_profile` var name collision with backend `compliance_profile` extra_var
- **PR #7:** Merged normalize into `run_oscap.yml` (single JT, 2 plays) after discovering cross-container file sharing issue
- **PR #8:** Per-host normalization to fit Controller event storage limits
- **PR #9:** Updated all 14 docs for 1-node architecture
- **PR #10:** Slim findings (~120 bytes each) for event storage
- **PR #11:** Fetch `runner_item_on_ok` events from loops
- **PR #12:** Fixed payload limit, skip N/A findings
- **PR #13:** Animated scan progress spinner

Deprecated modules and `rules/stig_rhel9_v2r8.yml` retained for backward compatibility.

## Testing

- End-to-end scan on netrunner: 366 STIG rules per host
- Collection testing infrastructure added (PR #4)
- Deployment iterations discovered and fixed 4 blocking issues (credentials, var collision, container isolation, event truncation)

## Dependencies

- ADR-003 (single assessment JT) -- discovered during this migration
- ADR-005 (slim findings) -- required to fit oscap output in Controller events
- ADR-008 (agentless pattern) -- the install/scan/remove approach for oscap binary
- `scap-security-guide` RPM in EE (`ssg-rhel9-ds.xml` datastream)
