# Contributing to AAP Compliance Pipelines

## Project Overview

This repository contains a compliance vertical for Ansible Automation Platform, delivered as a Backstage/RHDH plugin. It can run standalone (local development) or as a dynamic plugin inside the Ansible Portal (RHDH).

**Jira Feature:** [ANSTRAT-2216](https://redhat.atlassian.net/browse/ANSTRAT-2216)
**GitLab:** [gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines](https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines)

## Architecture

```
aap-compliance-pipelines/
  backstage-app/                 # Standalone dev shell + plugins
    packages/app/                # Dev-only frontend app shell
    packages/backend/            # Dev-only backend app shell
    plugins/
      compliance/                # Frontend plugin (7 views, React/MUI)
      compliance-backend/        # Backend plugin (REST API, DB, Controller client)
      compliance-common/         # Shared TypeScript types
    bin/start.sh                 # Dev launcher (mock/live modes)
  collections/                   # Ansible collection (modules, rules, playbooks)
  docs/                          # AsciiDoc + deployment guide
  .github/workflows/             # CI (EE build, plugin packaging)
```

**Plugins are the shipping artifact.** The `packages/` directory is the dev shell only.

## Development Setup

### Prerequisites

- Node.js 20+
- Yarn 4 (Berry)
- Git

### Quick Start

```bash
git clone https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines.git
cd aap-compliance-pipelines/backstage-app
yarn install

# Mock mode (no AAP connection needed)
./bin/start.sh mock

# Live mode (connects to AAP lab)
./bin/start.sh live .env.netrunner
```

- Frontend: http://localhost:3000
- Backend: http://localhost:7007

### Running Tests

```bash
cd backstage-app
yarn test                    # All tests
yarn test --coverage         # With coverage report
```

Target: all tests passing. Current: 201 tests across 11 suites.

## Branching and Workflow

### Current (prototype phase)

Direct pushes to `main` are acceptable for the primary developer. This will change when more contributors join.

### Future (multi-developer)

```
main ←── feature branches (PRs only)
  │
  ├── CI runs tests + builds dist-dynamic on every merge
  ├── Auto-deploys to dev Portal (if configured)
  │
  └── Tags (v0.1.0, v0.2.0) for production Portal deployment
```

- **No direct pushes to `main`** — PRs only
- **Every PR must pass tests** — CI enforces this
- **Feature branches**: `feature/description` or `claude/description`
- **Commit messages**: imperative mood, describe what changed and why
- **Co-authored commits**: include `Co-Authored-By:` for AI-assisted work

## Deployment Models

### 1. Standalone (Local Development)

The dev shell at `backstage-app/packages/` provides:
- Guest authentication (no AAP Gateway needed)
- SQLite database (auto-created)
- Mock mode with sample data
- Live mode connecting to AAP lab

```bash
./bin/start.sh mock          # No AAP connection
./bin/start.sh live .env.netrunner  # Netrunner lab
./bin/start.sh live .env     # Home lab
```

### 2. Portal / RHDH (Production)

Plugins are exported as dynamic plugins using `rhdh-cli`:

```bash
# Build dynamic plugin packages
yarn workspace @aap-compliance/plugin-compliance-backend export-dynamic
yarn workspace @aap-compliance/plugin-compliance export-dynamic
```

Install in RHDH via `dynamic-plugins.yaml`. See `docs/deployment-guide.md` for full instructions.

### Key differences

| Aspect | Standalone | Portal/RHDH |
|--------|-----------|-------------|
| Auth | Guest (no login) | AAP Gateway OAuth2 |
| Database | SQLite (local file) | PostgreSQL (shared) |
| RBAC | All actions allowed | Admin/Operator tiers |
| AAP tokens | Service token only | Per-user OAuth2 tokens |
| Plugin loading | Direct import | Dynamic (Scalprum/dist-dynamic) |

## Auth Mode

The `compliance.authMode` setting in `app-config.yaml` controls authentication:

- **`development`** (default): All routes unauthenticated. For local dev with guest auth.
- **`production`**: Only `/health` is unauthenticated. All other routes require Backstage identity. Mutating endpoints require `catalogEntityCreatePermission` (admin tier).

```yaml
compliance:
  dataSource: mock           # or 'live'
  authMode: development      # or 'production'
  retentionDays: 90
```

## RBAC Model (Option A+C)

### Backstage layer (Option A)

Two-tier, matching the self-service plugin pattern:

| Role | Can View | Can Scan | Can Remediate | Can Configure |
|------|----------|----------|---------------|---------------|
| **Operator** (authenticated) | Yes | No | No | No |
| **Admin** (catalogEntityCreatePermission) | Yes | Yes | Yes | Yes |

Admin maps to AAP superusers via `aap-admins` Backstage group.

### AAP layer (Option C)

Per-user AAP OAuth2 tokens are passed to every Controller API call. AAP's native RBAC enforces:
- Which inventories the user can scan
- Which job templates the user can launch
- Which credentials the user can use

This provides implicit organization/team scoping without Backstage-level org policies.

## Plugin Structure

### Frontend (`plugins/compliance/`)

- **Components**: `src/components/` — React components using Material UI
- **API client**: `src/api/ComplianceBackendClient.ts` — calls backend REST API
- **API ref**: `src/api/complianceApiRef.ts` — Backstage API factory pattern
- **Plugin**: `src/plugin.ts` — registration, routes, API factories

### Backend (`plugins/compliance-backend/`)

- **Router**: `src/router.ts` — Express REST endpoints
- **Service**: `src/service/ComplianceService.ts` — business logic, mock/live toggle
- **Database**: `src/database/ComplianceDatabase.ts` — Knex data access layer
- **Controller client**: `src/service/ControllerClient.ts` — AAP Controller HTTP client
- **Plugin**: `src/plugin.ts` — registration, migrations, auth policies

### Common (`plugins/compliance-common/`)

- **Types**: `src/types/` — shared TypeScript interfaces

## Adding New Features

### New API endpoint

1. Add the route in `router.ts`
2. Add the service method in `ComplianceService.ts` (with mock path)
3. Add the mock data in `MockDataProvider.ts`
4. Add the type in `compliance-common/src/types/`
5. Add the frontend API method in `ComplianceBackendClient.ts` and `complianceApiRef.ts`
6. Add auth policy in `plugin.ts` (both development and production sections)
7. Add test in `router.test.ts`

### New UI view

1. Create component in `plugins/compliance/src/components/`
2. Add route in `ComplianceRouter.tsx`
3. Add tab in `TABS` array if it's a top-level view
4. Add tests in `ComponentName.test.tsx`

### New compliance rule

1. Add to `collections/.../rules/stig_rhel9_v2r8.yml`
2. Title MUST match the CaC task name prefix (see `CONTRIBUTING.md` section below)
3. The compliance_evaluate module will pick it up automatically

### CaC Title Matching Convention

Rule titles in the YAML must match ComplianceAsCode playbook task name prefixes exactly.

Example: CaC task `"Set SSH Client Alive Interval - Check if..."` → rule title must be `"Set SSH Client Alive Interval"`.

This enables the remediation execution view to group tasks under their parent rule.

## Code Quality Standards

- **Zero `as any` casts** in production code
- **All catch blocks** must log errors (no silent swallowing)
- **All useEffect hooks** must clean up intervals/timeouts
- **All new endpoints** must have auth policies in both dev and production modes
- **Mock mode** must work for every feature (MockDataProvider returns all fields)
- **Tests** must pass — target 200+ tests

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Scanner orchestrator, not scanner | We orchestrate pluggable scanners via Common Findings Format |
| Workflow for scans, direct JT for remediation | Workflow-level job_tags don't propagate to child JTs in AAP |
| CaC title matching | Sequential title-prefix matching groups remediation tasks by rule |
| Two-tier RBAC + AAP pass-through | Matches downstream, AAP RBAC provides implicit org scoping |
| SQLite for dev, PostgreSQL for production | Knex migrations handle both |
| Auto-save (Insights pattern) | Remediations named upfront, every change auto-saves |

## Resources

- [Feature Proposal](https://docs.google.com/document/d/1Z7_EnqSzf6kq1FJqJujifRrj-yk4nkhzfcjF-eJq9wo)
- [Downstream reference](https://github.com/ansible/ansible-rhdh-plugins)
- [Architect Assessment](review/architect-assessment-2026-05-20.md)
- [RBAC Deep Dive](review/rbac-deep-dive.md)
- [Deployment Guide](docs/deployment-guide.md)
