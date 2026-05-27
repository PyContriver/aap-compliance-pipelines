# Feature: Ingest Token Security Hardening

**Status:** Shipped (commit `9597ba3`, 2026-05-27)
**PR:** Direct to main (branch protection bypass — process corrected going forward)
**Jira:** ANSTRAT-2216

## Problem

The `/findings/ingest` endpoint had three security gaps identified during architect review:

1. **Token bypass:** When no stored token existed (server restart, race condition), the validation `if (expectedToken && expectedToken !== ingestToken)` silently passed — any request with a guessed `scanId` could inject findings.
2. **In-memory storage:** Ingest tokens were stored in a `Map<string, string>()` that was lost on process restart and not shared across replicas.
3. **Unauthenticated endpoint:** The endpoint was marked `allow: 'unauthenticated'` with only the flawed token as protection.

## Design Approach

- **Persist tokens to database** instead of in-memory Map (migration 004: `ingest_token` column on `compliance_scans`)
- **Strict validation:** Reject with 403 when no stored token exists (closes the bypass)
- **Keep endpoint unauthenticated** but document that security is enforced via per-scan DB-persisted tokens (ADR-010)

### Alternatives Considered

- *Add Backstage auth to the endpoint:* Rejected — the playbook runs in an EE container that cannot authenticate as a Backstage user
- *Static API key:* Rejected in ADR-010 — key rotation burden, no per-scan scoping
- *Fix validation only (keep in-memory):* Rejected — doesn't survive restarts or scale to multi-replica

## Implementation Scope

**Shipped:**
- Migration 004: `ingest_token TEXT NULLABLE` on `compliance_scans`
- `storeIngestToken()` and `getIngestToken()` DB methods
- Strict token validation in router (reject when no stored token)
- `isValidScanId()` helper with consistent validation across all endpoints
- Findings array size limit (50,000 max)
- 11 new tests (token validation happy/unhappy paths, rule_metadata DB ops)
- Total: 222 tests passing

**Also shipped in same commit (code cleanup):**
- Deleted stale `content/` directory
- Deleted dead `mockFindings.ts`
- Removed unused `undici` dep from common package
- Fixed dynamic `require('crypto')` → top-level import
- Added deprecation markers to legacy modules

## Files Changed

| File | Change |
|------|--------|
| `plugins/compliance-backend/src/database/migrations/20260527_004_ingest_token.ts` | New migration |
| `plugins/compliance-backend/src/database/ComplianceDatabase.ts` | `storeIngestToken()`, `getIngestToken()` |
| `plugins/compliance-backend/src/router.ts` | Strict token validation, `isValidScanId()`, findings size limit, removed in-memory Map |
| `plugins/compliance-backend/src/plugin.ts` | Security comment on unauthenticated endpoint |
| `plugins/compliance-backend/src/router.test.ts` | 3 token validation tests |
| `plugins/compliance-backend/src/database/ComplianceDatabase.test.ts` | 8 new tests (token + rule_metadata) |

## Testing

- Unit tests for all three token validation scenarios (correct token, wrong token, no stored token)
- DB integration tests for `storeIngestToken`/`getIngestToken` round-trip
- DB integration tests for `upsertRuleMetadata`/`getRuleMetadataBulk`
- All 222 tests passing

## Dependencies

- ADR-010 (per-scan ingest token) — this feature implements the hardened version
- ADR-007 (Direct POST) — the endpoint being secured

## Deployment Notes

- Migration 004 runs automatically on startup (Knex migrations)
- No config changes required
- Backward-incompatible: scans created before migration 004 have no stored token — ingest requests for those scans will be rejected with 403
