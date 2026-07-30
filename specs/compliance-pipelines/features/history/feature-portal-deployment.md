---
title: "Feature: Portal Deployment"
description: "The compliance plugin ran only in local development mode (standalone Backstage app shell, SQLite, hot reload)"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Portal Deployment

**Status:** Shipped (2026-05-21, updated through 2026-05-27)
**Commits:** `bffe7ac` (PostgreSQL fix), `5edfec3` (dist-dynamic quality), `0519937` (v0.4.0)

## Problem

The compliance plugin ran only in local development mode (standalone Backstage app shell, SQLite, hot reload). For stakeholder demos and multi-user testing, it needed to deploy as a dynamic plugin on the Portal (RHDH) instance running on the netrunner lab, using PostgreSQL and real AAP OAuth.

## Design Approach

Package plugins using `@red-hat-developer-hub/cli` (rhdh-cli) matching the `ansible-rhdh-plugins` downstream patterns exactly. Deploy as dist-dynamic tarballs to Portal with integrity hash verification. Frontend uses Scalprum format, backend embeds compliance-common.

## Implementation Summary

- Export-dynamic packaging: `yarn workspace @aap-compliance/plugin-compliance-backend export-dynamic` and frontend equivalent
- Registration configs: `plugins/*/app-config.rhdh.yaml`
- PostgreSQL compatibility fixes: timestamp serialization, migration compatibility
- Multiple deployment iterations on netrunner (v0.1.0 through v0.4.0)
- Express body parser limit increased to 50MB for Direct POST payloads
- Portal reinstall gotcha documented: always bump version when redeploying (Portal cleanup removes same-version directories)
- Deployment guide: `docs/deployment-guide.md`

## Testing

- PostgreSQL compatibility confirmed (local dev uses SQLite)
- Dynamic plugin loading verified on netrunner Portal
- RBAC and OAuth tested with multiple user accounts
- 4 deployment rounds with progressive bug fixes

## Dependencies

- `@red-hat-developer-hub/cli` for export-dynamic
- Portal (RHDH) on netrunner lab (`dev-portal-netrunner.demoredhat.com`)
- PostgreSQL (Portal's database)
- `auth-backend-module-rhaap-provider` for AAP OAuth
