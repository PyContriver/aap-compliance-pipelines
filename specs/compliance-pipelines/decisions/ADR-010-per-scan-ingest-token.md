# ADR-010: Per-Scan Ingest Token for Findings Submission Security

**Status:** Accepted (implemented in PR #19)
**Date:** 2026-05-27
**Deciders:** M. Ferrari

## Context

ADR-007 introduces direct POST of findings from the playbook to the plugin's `/findings/ingest` endpoint. This creates a new auth surface: any entity with network access to the Backstage backend could submit fabricated findings if the endpoint is unprotected.

Options considered:
1. **No auth** -- rely on network segmentation only. Rejected: insufficient for shared clusters.
2. **Static API key** -- single shared secret. Rejected: key rotation burden, no per-scan scoping.
3. **Per-scan ingest token** -- backend generates a unique token at scan launch, passes it as extra_var, validates on ingest. Accepted.
4. **AAP OAuth2 token pass-through** -- reuse the user's AAP token. Rejected: the playbook runs as a service account, not the launching user.

## Decision

Generate a unique, single-use ingest token per scan. The token is:

1. Created by the backend when a scan is launched
2. Passed to the assessment JT as the `ingest_token` extra_var
3. Validated by the `/findings/ingest` endpoint before accepting findings
4. Scoped to the `scan_id` -- a token for scan A cannot submit findings for scan B

## Consequences

- **Positive:** Each scan has a unique credential -- compromising one token does not affect other scans.
- **Positive:** Token is scoped to a specific scan_id, preventing cross-scan injection.
- **Positive:** No additional credential management burden on administrators.
- **Positive:** Works naturally with the extra_vars pattern already used for `scan_id` and `backstage_api_url`.
- **Negative:** Token is visible in Controller extra_vars (mitigated: extra_vars are only visible to users with JT read access).
- **Negative:** If the playbook retries the POST after a transient failure, the single-use constraint may need relaxation (current implementation allows multiple POSTs with the same token for the same scan_id).

## Related

- ADR-007 -- direct POST findings architecture
- PR #19 -- implementation
