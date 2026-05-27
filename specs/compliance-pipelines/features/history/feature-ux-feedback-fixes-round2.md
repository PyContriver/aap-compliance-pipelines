# Feature: UX Feedback Fixes (Round 2)

**Status:** Shipped (2026-05-27)
**Commits:** `b8a460e`, `c070cd1` (PR #15), `fe663cb` (PR #16)

## Problem

After the oscap migration and initial deployment, stakeholder review identified 10 UX issues: column ordering was wrong (STIG ID before title), CAT buttons acted as selection actions instead of filters, search did not work in By Category view, failed scans showed "no results yet" instead of error details, and several other usability gaps compared to Drata/Vanta-class compliance tools.

## Design Approach

Address 9 of 10 feedback items (Fix 9 deferred -- remediation task grouping needs CaC event inspection). Prioritize correctness and discoverability over cosmetic polish.

## Implementation Summary

- **Fix 1:** Normalized `compliance_rule_metadata` table for DB-first metadata lookup (migration 003)
- **Fix 2:** Title/STIG ID column order swapped in ResultsViewer (title first, matching user reading patterns)
- **Fix 3:** CAT buttons changed from selection actions to view filters. `severityFilter` state: all/CAT_I/CAT_II/CAT_III
- **Fix 4:** Select Displayed / Deselect Displayed always visible (not search-only)
- **Fix 5:** Search works in By Category view (`groupedBySeverity` uses `displayFindings`)
- **Fix 6:** Failed scan click shows failure details (new `GET /scans/:scanId` endpoint)
- **Fix 7:** Scan progress shows "Processing results..." during normalization (detects localhost events)
- **Fix 8:** "Edit Remediations" renamed to "Use Existing Remediation" with equal visual prominence
- **Fix 10:** `normalize_xccdf.py` extracts check_text from XCCDF, includes rule title in evidence
- **PR #15:** Fixed empty STIG ID chips, added inline severity badges, improved bulk select
- **PR #16:** Added page limit to event fetching (prevented 17K-event fetches)

## Testing

- Round 3 testing on netrunner confirmed all 9 fixes working
- Column ordering, CAT filters, search, failed scan panel, scan progress all validated
- Event pagination limit prevented performance degradation

## Dependencies

- Feature: XCCDF Metadata Extraction -- Fix 1 and Fix 10 depend on metadata being available
- Feature: Direct POST Findings -- metadata transmitted via POST channel
