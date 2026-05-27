# Feature: Slim Findings for Controller Event Storage

**Status:** Shipped (2026-05-26, PRs #10-#11)
**Commits:** `14bcf08` (PR #10), `32100e9` (PR #11)
**ADR:** ADR-005

## Problem

The backend parses compliance findings from Controller job events. Controller truncates the `res` field when module output exceeds ~200KB. With oscap producing 366 findings per host (vs 20 with the old custom module), even per-host processing resulted in empty `res` in events. The slim findings approach was needed as an immediate fix while Direct POST (ADR-007) was planned.

## Design Approach

Strip findings to essential fields only (~120 bytes per finding, ~44KB per host with 366 rules):
- **Keep:** `rule_id`, `title`, `status`, `severity`, `stig_id`, `category`
- **Strip:** `description`, `check_text`, `fix_text`, `evidence.raw_output`, `parameters`, `remediation`

Additionally, fetch `runner_item_on_ok` events (from Ansible loops) instead of only `runner_on_ok`, since the normalize play processes hosts in a loop.

## Implementation Summary

- `normalize_xccdf.py`: strips findings to essential fields before returning module output
- Backend event parser: updated to also fetch `runner_item_on_ok` events
- Fits comfortably within Controller's ~200KB event limit (4 hosts x 44KB = 176KB)
- Retained as fallback when `backstage_api_url` is not configured (Direct POST is now primary)

## Testing

- Verified event payloads stay within Controller limits
- End-to-end scan with 366 rules per host confirmed findings appear in UI

## Dependencies

- ADR-004 (oscap migration) -- the 366-rule output triggered this need
- ADR-007 (Direct POST) -- the long-term replacement, now primary data channel
