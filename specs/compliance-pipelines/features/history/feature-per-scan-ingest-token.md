---
title: "Feature: Per-Scan Ingest Token"
description: "Direct POST findings (ADR-007) creates a new auth surface: any entity with network access to the Backstage backend could"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Per-Scan Ingest Token

**Status:** Shipped (2026-05-27, PR #19)
**Commits:** `ebc87c4` (PR #19), `9597ba3` (hardening)
**ADR:** ADR-010

## Problem

Direct POST findings (ADR-007) creates a new auth surface: any entity with network access to the Backstage backend could submit fabricated findings if the endpoint is unprotected. Static API keys have rotation burden and no per-scan scoping. AAP OAuth2 token pass-through does not work because the playbook runs as a service account, not the launching user.

## Design Approach

Generate a unique, single-use ingest token per scan:
1. Backend creates token at scan launch time
2. Token passed to assessment JT as `ingest_token` extra_var
3. `/findings/ingest` endpoint validates token before accepting findings
4. Token is scoped to `scan_id` -- a token for scan A cannot submit findings for scan B

Hardened in a follow-up commit: token persisted to database (migration 004) instead of in-memory Map, strict validation rejects requests when no stored token exists.

## Implementation Summary

- Migration 004: `ingest_token TEXT NULLABLE` on `compliance_scans`
- `storeIngestToken()` / `getIngestToken()` database methods
- Strict token validation in router (reject when no stored token -- closes bypass gap)
- `isValidScanId()` helper with consistent validation across all endpoints
- Findings array size limit (50,000 max)
- Token visible in Controller extra_vars (mitigated: only visible to users with JT read access)

## Testing

- 11 new tests: token validation happy/unhappy paths, rule_metadata DB ops
- Unit tests for correct token, wrong token, and no stored token scenarios
- DB integration tests for `storeIngestToken`/`getIngestToken` round-trip
- Total: 222 tests passing after hardening

## Dependencies

- ADR-007 (Direct POST) -- the endpoint being secured
- Feature: Ingest Token Security Hardening (follow-up, `9597ba3`)
