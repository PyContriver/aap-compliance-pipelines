---
title: "Feature: Two-Tier RBAC"
description: "The compliance plugin needs access control for scan, remediate, configure, and view operations"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Two-Tier RBAC

**Status:** Shipped (2026-05-21)
**Commits:** `328ba8a`, `7026b97`, `d25092d`, `5edfec3`
**ADR:** ADR-002

## Problem

The compliance plugin needs access control for scan, remediate, configure, and view operations. Three options were evaluated: two-tier Backstage permissions (Option A), granular org/team mapping from AAP (Option B), and AAP token pass-through (Option C). No existing downstream plugin (self-service, EE build) had implemented granular org/team permission mapping.

## Design Approach

**Option A+C:** Two-tier Backstage permissions combined with AAP OAuth2 token pass-through.

- **Backstage layer:** Admins (users with `catalogEntityCreatePermission`) can scan, remediate, configure. Operators (all authenticated) get read-only access.
- **AAP layer:** Every Controller API call passes the user's AAP OAuth2 token via `x-aap-token` header. AAP's native RBAC decides what inventories, JTs, and credentials the user can access.
- **Auth modes:** `development` (unauthenticated for local dev) and `production` (full auth, only `/health` unauthenticated).

This matches downstream patterns exactly -- no custom permissions to maintain.

## Implementation Summary

- Backend: `getUserAapToken(req)` extracts `x-aap-token` header for Controller API calls
- Backend: `coreServices.httpAuth` + `coreServices.permissions` on mutating endpoints
- Frontend: `usePermission()` gates on mutating actions (scan, remediate, configure)
- Config: `compliance.authMode` setting for dev vs production mode
- RBAC deep dive report documenting downstream analysis (`docs/`)
- Permission dependencies and deployment docs for Portal integration

## Testing

- Auth policy validated in architect review
- Multi-user testing on netrunner Portal (massimo, craig, ganesh accounts)
- Development mode confirmed unauthenticated for local dev workflow

## Dependencies

- `rhAapAuthApiRef` from self-service plugin (shared, not duplicated)
- `@backstage-community/plugin-rbac-backend` for Portal deployment
- `auth-backend-module-rhaap-provider` for AAP OAuth in Portal
