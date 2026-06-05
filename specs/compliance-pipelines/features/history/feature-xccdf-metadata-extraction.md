# Feature: XCCDF Metadata Extraction

**Status:** Shipped (2026-05-27, v0.4.0)
**Commits:** `0519937`, `b8a460e`, `232f7fb`

## Problem

After the oscap migration, the normalizer extracted rule_id, status, and severity from XCCDF results, but title, description, check_text, and fix_text were empty or incomplete in the UI. The SSG datastream (`ssg-rhel9-ds.xml`) has a non-obvious structure: `<fixtext>` elements are absent, `<check>` contains only OVAL references (no inline text), and the useful content lives in `<fix>`, `<rationale>`, and `<description>` elements.

## Design Approach

Extract metadata from the XCCDF datastream (not just the results XML) during normalization. Map SSG-specific element locations to CFF metadata fields:
- `title`: from `<title>` element (all 1479 rules)
- `description`: from `<description>` element (all 1479 rules)
- `fix_text`: from `<fix system="urn:xccdf:fix:script:ansible">` scripts (1284 of 1479 rules)
- `check_text`: from `<rationale>` element (all 1479 rules) -- best proxy since SSG lacks inline check content
- `evidence`: actual/expected value mapping from structured evidence objects

Store extracted metadata in `compliance_rule_metadata` table (migration 003) for DB-first lookup. ~~YAML fallback was the original secondary path but has been removed (2026-06-06, ADR-019) -- the DB is now the sole runtime cache.~~

## Implementation Summary

- `normalize_xccdf.py`: enhanced to parse datastream XML for metadata fields, not just results XML
- Migration 003: `compliance_rule_metadata` table (rule_id, title, description, fix_text, check_text)
- Backend: `upsertRuleMetadata()` with batch INSERT ON CONFLICT MERGE (replaced N+1 upsert of 732 queries with 4 queries). Now also writes `aap_impact` and `aap_impact_reason` fields (2026-06-06).
- Backend: `getRuleMetadataBulk()` for DB-first metadata lookup
- ~~Frontend: displays metadata from DB, falls back to YAML if not found~~ Frontend displays metadata from DB only (YAML fallback removed 2026-06-06, ADR-019)
- Evidence mapping: structured actual/expected values from XCCDF check results

## Testing

- 3 deployment rounds on netrunner to resolve metadata extraction issues
- Round 3 confirmed: titles, descriptions, check_text, fix_text all display correctly
- 8 new DB tests for `upsertRuleMetadata`/`getRuleMetadataBulk`
- Verification scan confirmed metadata persists across scans

## Dependencies

- ADR-004 (oscap migration) -- the normalizer being enhanced
- ADR-007 (Direct POST) -- full metadata transmitted via POST (not stripped for events)
- `scap-security-guide` datastream structure
