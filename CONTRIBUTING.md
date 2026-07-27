---
title: "Contributing to AAP Compliance Dashboard"
description: "Contributing guide -- setup, branching, CI/CD, coding standards, adding features"
type: project
audience: [developer]
product: "AAP Compliance Dashboard"
product_version: "2.6"
status: current
last_verified: 2026-07-09
---

# Contributing to AAP Compliance Dashboard

## Project Overview

This repository contains a compliance vertical for Ansible Automation Platform, delivered as the AAP Compliance Dashboard plugin for Ansible Portal (RHDH). It can run standalone (local development or demo server) or as a dynamic plugin inside Ansible Portal.

**Jira Feature:** [ANSTRAT-2216](https://redhat.atlassian.net/browse/ANSTRAT-2216) (Red Hat internal)
**GitLab:** [gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines](https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines) (Red Hat internal)

## Architecture

```
aap-compliance-pipelines/
  backstage-app/                 # Standalone dev shell + plugins
    packages/app/                # Dev-only frontend app shell
    packages/backend/            # Dev-only backend app shell
    plugins/
      compliance/                # Frontend plugin (6 tabs, 12 routes, React/MUI)
      compliance-backend/        # Backend plugin (REST API, DB, Controller client)
      compliance-common/         # Shared TypeScript types
    bin/start.sh                 # Dev launcher (mock/live modes)
  profiles/                      # Self-contained compliance profiles
    rhel9-stig/                  # DISA STIG V2R8 (certified, NIST SCAP 1.2)
    rhel9-cis-l1/                # CIS Benchmark L1 Server (conformant)
    rhel9-cis-l2/                # CIS Benchmark L2 Server (conformant)
  docs/                          # AsciiDoc + deployment guide + developer guide
  .github/workflows/             # CI (plugin tests, collection tests, EE build)
```

**Plugins are the shipping artifact.** The `packages/` directory is the dev shell only.

## Development Setup

### Prerequisites

- Node.js 20+
- Yarn 4 (Berry)
- Git

### Quick Start

```bash
git clone https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines.git  # Red Hat internal
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

Target: all tests passing. Collection unit tests: 19 per XCCDF profile (57 across 3) + 44 CycloneDX + 60 cross-profile = 161 total.

## CI/CD Pipelines

CI is split across **GitHub Actions** (EE builds) and **GitLab CEE** (everything else):

**GitLab CEE** (`.gitlab-ci.yml`) — primary CI:

| Job | Trigger | What it does |
|-----|---------|-------------|
| `backstage-test` | Push to `main` (backstage-app paths) | `yarn install` → `yarn build` → `yarn test` |
| `backstage-export` | Push to `main` (backstage-app paths) | Exports dynamic plugins via `@red-hat-developer-hub/cli`, packs tarballs with integrity hashes |
| `collection-sanity` | Push to `main` (profiles paths) | `ansible-test sanity` per collection × ansible-core 2.17/2.18 |
| `collection-units` | Push to `main` (profiles paths) | `pytest tests/unit/` per collection × ansible-core 2.17/2.18 |
| `collection-lint` | Push to `main` (profiles paths) | `ansible-lint` per collection (allow_failure) |
| `collection-build` | After sanity+units | `ansible-galaxy collection build` per collection |
| `deploy-netrunner` | Push to `main` (backstage-app paths) | Uploads tarballs to Portal host, updates integrity hashes, restarts |

**GitHub Actions** (`.github/workflows/`) — EE builds only:

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **`build-ee.yml`** | Push to `main` (profiles paths) / `workflow_dispatch` | Per-collection EE image builds (STIG, CIS L1, CIS L2, Supply Chain matrix). Pushes to GHCR, then mirrored to PAH via skopeo (ADR-031). Requires `REDHAT_REGISTRY_USER`/`TOKEN` secrets |
| **`ci.yml`** | Disabled | Placeholder — backstage CI moved to GitLab |
| **`collection-tests.yml`** | Disabled | Collection tests moved to GitLab |

### EE build workflow (`build-ee.yml`)

Builds per-collection EE images from `ee-minimal-rhel9` base. Matrix: STIG, CIS L1, CIS L2 (XCCDF, with `scap-security-guide` + `openscap-scanner`), Supply Chain (CycloneDX, with Syft + Grype + pre-cached CVE DB). Each profile's collection is copied into the build context. XCCDF profiles run `extract_rule_metadata.py` to generate rules YAML from the datastream at build time. Images pushed to `ghcr.io/cross-logic/compliance-*`, then mirrored to PAH (ADR-031).

To trigger manually: `gh workflow run build-ee.yml -f profiles=all`

To mirror to PAH after build:
```bash
skopeo copy --src-creds <ghcr-user>:<token> \
  --dest-creds <pah-user>:<password> --dest-tls-verify=false \
  docker://ghcr.io/cross-logic/compliance-<profile>:latest \
  docker://aap-netrunner.demoredhat.com/compliance-<profile>:latest
```

## Branching and Workflow

Branch protection is enabled on `main` for both GitHub and GitLab.

```
main ←── feature branches (PRs only)
  │
  ├── CI runs tests + builds dist-dynamic on every merge
  ├── Auto-deploys to dev Portal (if configured)
  │
  └── Tags (v0.1.0, v0.2.0) for production Portal deployment
```

- **No direct pushes to `main`** — PRs only, branch protection enforced
- **Every PR must pass tests** — CI enforces this
- **Feature branches**: `feature/description` or `claude/description`
- **Commit messages**: imperative mood, describe what changed and why
- **Co-authored commits**: include `Co-Authored-By:` for AI-assisted work

### Active Feature Branches

| Branch | Purpose | Status |
|--------|---------|--------|
| `main` | Primary development branch | Active |

Feature branches use `feature/description` or `claude/description` naming.

### Testing Environments

| Environment | Role | URL |
|---|---|---|
| **Local** | Development + testing | `http://localhost:3000` (frontend), `:7007` (backend) |
| **Netrunner Portal** | Staging + demo (Red Hat internal) | `https://dev-portal-netrunner.demoredhat.com/` |

- **Local** always runs the feature branch code (source, hot reload, SQLite, guest auth)
- **Netrunner** always runs the latest `main` (dist-dynamic tarballs, PostgreSQL, RHAAP OAuth)
- Feature branches are tested locally before merging to main
- After merge to main, deploy to netrunner (CI or manual)

### Pre-merge Checklist

Before creating a PR, verify:

1. `yarn test` passes (all tests)
2. `yarn build` succeeds
3. Mock mode works (`./bin/start.sh mock`)
4. If touching backend: `export-dynamic` produces valid tarball
5. If touching Controller resources: tested against live AAP (home lab or netrunner)
6. If touching DB schema: migration up + down tested on both SQLite and PostgreSQL. Migrations are TypeScript files in `plugins/compliance-backend/src/database/migrations/`; they are compiled to JS during `export-dynamic`. The deploy script runs a parity check to verify all TS migrations have corresponding compiled JS.

### What Gets Tested Where

| Test Type | Local | Netrunner |
|---|---|---|
| Unit tests (`yarn test`) | Every commit | Via CI on PR |
| Mock mode UI | Yes | No |
| Live scan end-to-end | Yes (home lab) | Yes (netrunner AAP) |
| PostgreSQL compatibility | No (SQLite) | Yes |
| Dynamic plugin loading (Scalprum) | No | Yes |
| RBAC / OAuth | No (guest auth) | Yes |
| Multi-user testing | No | Yes (massimo, craig, ganesh) |

### Post-merge Deploy to Netrunner

Use the deploy script which automates the full pipeline:

```bash
./scripts/deploy-netrunner.sh             # deploy both plugins (default)
./scripts/deploy-netrunner.sh backend     # backend only
./scripts/deploy-netrunner.sh --no-bump   # skip version bump
./scripts/deploy-netrunner.sh --host=user@host  # custom portal host
```

The script handles: version bump, `export-dynamic`, migration parity check (verifies compiled JS migrations match the TS source count), `npm pack` with stable tarball names, `scp` upload (keeping previous tarballs for rollback), config update, service restart, and a health-check poll (replaces the old blind sleep). To rollback, the script prints a one-liner that restores the previous tarballs.

**Manual steps** (if not using the script):

1. Build dist-dynamic: `export-dynamic` for both plugins
2. Pack tarballs: `npm pack` in each `dist-dynamic/` directory
3. Compute integrity hashes: `openssl dgst -sha512 -binary < file.tgz | base64`
4. Upload tarballs to Portal: `scp` to `/var/lib/portal/compliance-plugins/`
5. Update `dynamic-plugins.override.yaml` with new integrity hashes
6. Remove old extracted dirs and restart: `sudo systemctl restart portal.service`
7. Verify: health endpoint + smoke test UI

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

The `ansible.compliance.authMode` setting in `app-config.yaml` controls authentication (ADR-011 namespace):

- **`development`**: All routes unauthenticated. For local dev with guest auth. Must be set explicitly in `app-config.local.yaml`.
- **`production`** (default): Only `/health` is unauthenticated. All other routes require Portal identity. Mutating endpoints require `catalogEntityCreatePermission` (admin tier).

```yaml
ansible:
  compliance:
    enabled: true
    dataSource: mock           # or 'live'
    authMode: development      # or 'production'
    retentionDays: 90
```

## RBAC Model (Option A+C)

### Portal layer (Option A)

Two-tier, matching the self-service plugin pattern:

| Role | Can View | Can Scan | Can Remediate | Can Configure |
|------|----------|----------|---------------|---------------|
| **Operator** (authenticated) | Yes | No | No | No |
| **Admin** (catalogEntityCreatePermission) | Yes | Yes | Yes | Yes |

Admin maps to AAP superusers via `aap-admins` Portal group.

### AAP layer (Option C)

Per-user AAP OAuth2 tokens are passed to every Controller API call. AAP's native RBAC enforces:
- Which inventories the user can scan
- Which job templates the user can launch
- Which credentials the user can use

This provides implicit organization/team scoping without Portal-level org policies.

## Plugin Structure

### Frontend (`plugins/compliance/`)

- **Components**: `src/components/` — React components using Material UI
- **API client**: `src/api/ComplianceBackendClient.ts` — calls backend REST API
- **API ref**: `src/api/complianceApiRef.ts` — Portal API factory pattern
- **Plugin**: `src/plugin.ts` — registration, routes, API factories

### Backend (`plugins/compliance-backend/`)

- **Router**: `src/router.ts` — slim orchestrator, delegates to `src/routes/` modules
- **Routes**: `src/routes/` — decomposed route modules (health, scans, findings, remediation, baseline, dashboard, controller, profiles) with shared types, validation, and permission helpers
- **Service**: `src/service/ComplianceService.ts` — orchestration and mock/live toggle (~1040 lines)
- **FindingsParser**: `src/service/FindingsParser.ts` — finding extraction, severity/status mapping, multi-host grouping, and aggregation (extracted from ComplianceService)
- **RemediationPlanBuilder**: `src/service/RemediationPlanBuilder.ts` — builds optimized remediation plans by grouping rules that target the same host set into batched runs (extracted from ComplianceService)
- **DashboardAggregator**: `src/service/DashboardAggregator.ts` — computes dashboard statistics and posture history snapshots (extracted from ComplianceService)
- **Database**: `src/database/ComplianceDatabase.ts` — Knex data access layer
- **Controller client**: `src/service/ControllerClient.ts` — AAP Controller HTTP client
- **Plugin**: `src/plugin.ts` — registration, migrations, auth policies

### Common (`plugins/compliance-common/`)

- **Types**: `src/types/` — shared TypeScript interfaces

## Profile Structure

Each profile under `profiles/` is self-contained:

```
profiles/rhel9-stig/
  ansible_collections/security/compliance_rhel9_stig/
    galaxy.yml                 # Collection metadata
    meta/execution-environment.yml  # EE deps for Hub auto-discovery
    meta/compliance-profile.yml     # Profile identity, display config, certification
    plugins/modules/           # normalize_xccdf module (thin wrapper)
    plugins/module_utils/      # normalize_common.py (synced from _shared)
    playbooks/                 # run_oscap, remediate, normalize
    tests/                     # ansible-test units + integration
    docs/                      # Automation Hub + community docs
  ee/execution-environment.yml # Standalone EE build definition
  install.yml                  # Controller registration playbook
  uninstall.yml                # Controller deregistration (disconnect semantics)
  backstage/                   # Portal-specific assets (may be empty with .gitkeep)
  README.md                    # Profile documentation
profiles/_shared/              # Shared code synced into all collections
  normalize_common.py          # Single source of truth for XCCDF parsing
  aap_impact/                  # Platform-specific AAP-impact dictionaries
```

Profiles follow the standard `ansible_collections/{namespace}/{name}/` convention. They can be extracted to standalone repos via `git subtree split`.

**Shared module pattern:** Normalization logic lives in `profiles/_shared/normalize_common.py`. Each collection's `plugins/modules/normalize_xccdf.py` is a thin wrapper that imports from `plugins/module_utils/normalize_common.py`. After editing the shared source, run `python scripts/sync_shared_modules.py` to copy it into all collections. Never edit the `module_utils/` copies directly.

## Adding New Features

### New API endpoint

1. Add the route in the appropriate `src/routes/` module (e.g., `scans.ts` for scan endpoints, `findings.ts` for finding endpoints). If the endpoint doesn't fit an existing module, create a new one and register it in `router.ts`.
2. Add the service method in the appropriate class:
   - `ComplianceService.ts` for orchestration and general endpoints (with mock path)
   - `FindingsParser.ts` for finding extraction, mapping, or aggregation logic
   - `RemediationPlanBuilder.ts` for remediation plan construction
   - `DashboardAggregator.ts` for dashboard statistics or posture history
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

### New compliance profile

Each compliance profile is self-contained under `profiles/`. To add a new one:

1. Copy an existing profile directory (e.g., `profiles/rhel9-stig/`)
2. Update the collection namespace in `galaxy.yml`
3. Set the XCCDF profile ID in `run_oscap.yml` (e.g., `cis_server_l1`)
4. Set the remediation playbook path in `remediate.yml`
5. Set certification parameters (`certification_status`, `certification_authority`)
6. Set `remediate_jt_name` in `install.yml` (the scan JT's `extra_vars` must include this so the Settings form can auto-populate the Remediate Job Template). Without it, multi-profile deployments will launch the wrong remediation JT.
7. Update the framework in `meta/compliance-profile.yml` (supported: `DISA_STIG`, `CIS_BENCHMARK`, `SUPPLY_CHAIN`, `PQC_READINESS`, `CUSTOM`)
8. Configure the `display:` block in `meta/compliance-profile.yml` (gauge labels, column mappings, optional custom tab)
9. Create `uninstall.yml` playbook with disconnect semantics (never delete resources, only deregister from Controller)
10. Create `backstage/` directory (may be empty with `.gitkeep` if no Portal-specific assets)
11. Update the EE definition if different scanner packages are needed
12. Run `ansible-test sanity` and `ansible-test units` to verify
13. See `docs/compliance-profile-developer-guide.md` for the full guide

The normalizer (`normalize_xccdf.py`) is a thin wrapper around shared logic in `module_utils/normalize_common.py`. It is framework-aware and handles STIG, CIS, SUPPLY_CHAIN, PQC_READINESS, and custom profiles via the `framework` parameter. After creating a new profile, run `python scripts/sync_shared_modules.py` to populate the new collection's `plugins/module_utils/` directory and add the collection path to the `COLLECTIONS` list in the sync script.

### New or modified AAP Controller resources

When adding or modifying job templates:

1. The assessment JT (`compliance-run-oscap`) must have `ask_inventory_on_launch: true` -- the plugin passes the user-selected inventory at launch time
2. The assessment JT's default `extra_vars` must include `remediate_jt_name` and `remediation_playbook` -- these are used by the Settings form auto-populate to link the profile to its remediation JT
3. The remediation JT must have `ask_tags_on_launch: true` and `ask_variables_on_launch: true` because it is launched directly (not via workflow) with `job_tags` for selective rule remediation
4. All JTs must specify `execution_environment` -- the compliance EE with oscap and scap-security-guide (JTs using the default EE will fail because it lacks oscap)
5. Use `oscap_xccdf_profile` (not `compliance_profile`) for the XCCDF profile variable to avoid collision with the backend's `compliance_profile` extra_var (UUID)
6. Use the profile's `install.yml` to register resources, or create them manually via the Controller API

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
- **Tests** must pass — target all tests passing (backend + collections)

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Scanner orchestrator, not scanner | We orchestrate pluggable scanners via Common Findings Format |
| Single assessment JT (run_oscap.yml with 2 plays: scan + normalize), direct JT for remediation | Assessment is read-only by design; both plays run in the same container so fetched files are available to normalize. The gap between assess and remediate is where intelligence lives (human review, EDA policy, future AI agent) |
| CaC title matching | Sequential title-prefix matching groups remediation tasks by rule |
| Two-tier RBAC + AAP pass-through | Matches downstream, AAP RBAC provides implicit org scoping |
| SQLite for dev, PostgreSQL for production | Knex migrations handle both |
| Auto-save (Insights pattern) | Remediations named upfront, every change auto-saves |
| Scanner certification model | Profiles declare `certified` / `conformant` / `uncertified` based on scanner + framework combination. OpenSCAP + STIG = certified (NIST SCAP 1.2). OpenSCAP + CIS = conformant (CIS-CAT Pro is the certified tool). |

## Resources

- [Feature Proposal](https://docs.google.com/document/d/1Z7_EnqSzf6kq1FJqJujifRrj-yk4nkhzfcjF-eJq9wo)
- [Downstream reference](https://github.com/ansible/ansible-rhdh-plugins)
- [Architect Assessment](review/architect-assessment-2026-05-20.md)
- [RBAC Deep Dive](review/rbac-deep-dive.md)
- [Deployment Guide](docs/deployment-guide.md)
