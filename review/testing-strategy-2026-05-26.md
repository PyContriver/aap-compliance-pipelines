# Testing & Deployment Strategy Decision Record

**Date:** 2026-05-26
**Status:** Accepted
**Context:** Moving from prototype (direct push to main) to multi-developer workflow with branch protection

## Decision

- **Local = development + testing** (feature branches, hot reload, SQLite, guest auth)
- **Netrunner Portal = staging + demo** (main only, dist-dynamic, PostgreSQL, RHAAP OAuth)
- Feature branches are never deployed to Portal
- Branch protection enforced on `main` for both GitHub and GitLab

## Environment Comparison

| Aspect | Local | Netrunner Portal |
|---|---|---|
| Code version | Feature branch | `main` only |
| Database | SQLite (auto-created) | PostgreSQL (shared) |
| Auth | Guest (no login) | RHAAP OAuth2 |
| RBAC | All actions allowed | Admin/Operator tiers |
| Plugin loading | Direct source import | Dynamic (Scalprum/dist-dynamic) |
| AAP connection | Mock or home lab | Netrunner AAP (live) |
| Reload | Hot reload (instant) | Restart service (~35s) |
| Users | Single developer | massimo, craig, ganesh |

## Branch Workflow

1. Create feature branch (`feature/description`)
2. Develop and test locally (mock + live modes)
3. Run `yarn test` (206+ tests must pass)
4. Create PR → CI runs tests + build
5. Review and merge to `main`
6. Deploy to netrunner (CI or manual)

## Pre-merge Checklist

1. `yarn test` passes
2. `yarn build` succeeds
3. Mock mode works
4. If backend: `export-dynamic` produces valid tarball
5. If Controller resources: tested against live AAP
6. If DB schema: migration tested on SQLite AND PostgreSQL

## Consequences

- No simultaneous dual-version testing — local is always ahead of netrunner
- PostgreSQL-specific bugs only caught after merge (on netrunner)
- Dynamic plugin loading issues only caught after merge (on netrunner)
- Mitigation: pre-merge checklist includes export-dynamic validation
- Future: CI pipeline will automate tarball build and optionally deploy to netrunner
