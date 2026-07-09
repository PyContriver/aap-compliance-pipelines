---
title: "AAP Compliance Pipelines"
description: "Project overview -- deployment options, quick start, configuration, repository structure"
type: project
audience: [developer, operator]
product: "AAP Compliance Dashboard"
product_version: "2.6"
status: current
last_verified: 2026-07-09
---

# AAP Compliance Pipelines

The AAP Compliance Dashboard — a compliance management solution for Ansible Automation Platform, delivered as a plugin for Ansible Portal (RHDH). Provides self-service compliance scanning, results analysis, and selective remediation for RHEL infrastructure.

> **Source repositories:** This project is maintained on [GitHub](https://github.com/cross-logic/aap-compliance-pipelines) (public, primary) and mirrored to [GitLab CEE](https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines) (Red Hat internal, CI/CD and deploy). Both repos are kept in sync. GitHub Actions builds EE images; GitLab CEE runs plugin tests and deploys to Netrunner.
>
> **Jira:** [ANSTRAT-2216](https://redhat.atlassian.net/browse/ANSTRAT-2216) | **Live demo:** [dev-portal-netrunner.demoredhat.com/compliance](https://dev-portal-netrunner.demoredhat.com/compliance) | **Docs:** [Google Drive](https://drive.google.com/drive/folders/1OkjXfIgxsxeYsKfzYFJGS7i4FQ7B0LC9)

## Deployment Options

The compliance plugins support two deployment modes:

| Mode | Use Case | How |
|------|----------|-----|
| **Standalone** | Internal testing, demos, UX reviews | `cd backstage-app && ./bin/start.sh mock` |
| **Portal / RHDH** | Production deployment as dynamic plugins | Build with `export-dynamic`, install in RHDH |

For standalone deployment on a remote server, see [docs/standalone-deployment.md](docs/standalone-deployment.md).
For Portal/RHDH installation instructions, see [docs/deployment-guide.md](docs/deployment-guide.md).

## Documentation

All documentation lives in `docs/` and `specs/`, and is mirrored to [Google Drive](https://drive.google.com/drive/folders/1OkjXfIgxsxeYsKfzYFJGS7i4FQ7B0LC9) for non-developer access. Start at [docs/README.md](docs/README.md) for the full index.

### What are you trying to do?

| Goal | Start here |
|------|-----------|
| **Build a demo** for a customer or stakeholder | [Standalone Deployment Guide](docs/standalone-deployment.md) — mock mode, single server, 5-minute setup |
| **Install into an existing Ansible Portal** (OpenShift or RHEL) | [Deployment Guide](docs/deployment-guide.md) — dynamic plugin packaging, Portal config, auth setup |
| **Use the dashboard** (run scans, review findings, remediate) | [Managing compliance with Red Hat AAP](https://docs.google.com/document/d/1xnDGjum7vF0Bu5aX3QW8hGtZ4XLffCbD-RnsJBPdW7Y/edit) — Red Hat-style user guide |
| **Build a new compliance profile** (new scanner/framework) | [Compliance Profile Developer Guide](docs/compliance-profile-developer-guide.md) — CFF, normalizers, EEs, custom tabs |
| **Understand the architecture** | [Architecture Diagram](docs/architecture-diagram.md) — system components, data flow, auth model |
| **Debug the Netrunner demo lab** | [Netrunner Portal Deployment](docs/netrunner-portal-deployment.md) — internal reference for our lab |
| **Hand over the project** to another team | [Handover Guide](docs/handover-guide.md) — patterns, alignment, gaps |
| **Review a design decision** | [Architecture Decisions](specs/compliance-pipelines/decisions/) — 37 ADRs |
| **Understand the UX design** | [UX Design Brief](https://docs.google.com/document/d/1CWPfbsxKO58gYxfwlhvyEnyH3fKJ1etzEM6l7XDSsHU/edit) — personas, user stories, visual specs |

### Documentation structure

```
docs/
  README.md                          Documentation index — start here
  standalone-deployment.md           Single-server demo setup (mock or live)
  deployment-guide.md                Install into Ansible Portal (OpenShift/RHEL)
  netrunner-portal-deployment.md     Internal: Netrunner lab reference
  compliance-profile-developer-guide.md  Building new compliance profiles
  architecture-diagram.md            System architecture diagram
  handover-guide.md                  Project handover for receiving team
  manual-testing-supply-chain.md     69-step manual testing checklist
  ux-handoff.md                      UX Design Brief (source for Google Doc)
  windows-compliance-profile-assessment.md  Windows STIG feasibility study
  modules/                           Red Hat product documentation (AsciiDoc)
    con-about-compliance-pipelines.adoc
    proc-configure-compliance-pipeline.adoc
    proc-run-compliance-scan.adoc
    ref-compliance-pipeline-configuration.adoc
    ref-compliance-pipeline-resources.adoc
    ref-oscap-requirements.adoc

specs/compliance-pipelines/
  spec.md                            Feature specification
  plan.md                            Implementation plan
  decisions/                         37 Architecture Decision Records (ADR-001 through ADR-037)
  features/                          Feature specs (active + history/)
```

## Prerequisites

- Node.js 20 or 22
- Corepack enabled (`corepack enable`)
- Yarn 4.x (installed via Corepack)
- For live mode: access to an AAP 2.6+ Controller instance

## Quick Start

```bash
# Clone the repository
# GitHub (public, primary):
git clone https://github.com/cross-logic/aap-compliance-pipelines.git
# GitLab CEE (Red Hat internal, CI/CD and deploy — requires VPN):
git clone https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines.git

cd aap-compliance-pipelines/backstage-app

# Install dependencies and set up hooks
./install-deps

# Start the dev server (mock mode — no AAP needed)
yarn start
```

The frontend will be available at `http://localhost:3000` and the backend at `http://localhost:7007`.

By default the plugin runs in **mock mode** with sample compliance data — no AAP connection required. This is ideal for demos and UI development.

## Data Modes: Mock vs Live

The plugin supports two data modes controlled by `compliance.dataSource` in `app-config.yaml`:

### Mock Mode (default)

Mock mode uses built-in sample data. No AAP instance needed.

```yaml
# app-config.yaml
compliance:
  dataSource: mock
```

This is the default. The plugin shows:
- 20 hosts across 3 groups (web-prod, db-prod, app-prod)
- 12 STIG rules with realistic pass/fail distributions
- Interactive remediation profile builder with host-level detail
- All UI features fully functional with sample data

**Use mock mode for:** demos, UI development, UX reviews, sharing with stakeholders.

### Live Mode (connected to AAP)

Live mode connects to a real AAP Controller instance and runs actual compliance scans.

#### Step 1: Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` with your AAP connection details:

```bash
# Required — AAP Controller connection
AAP_HOST=https://your-aap-controller.example.com
AAP_API_TOKEN=your-api-token-here

# Required for OAuth login (if using AAP authentication)
AAP_AUTH_CLIENT_ID=your-oauth-client-id
AAP_AUTH_CLIENT_SECRET=your-oauth-client-secret

# Optional — auto-generated if empty
BACKEND_SECRET=
AUTH_SIGNING_KEY=

# Optional — GitHub integration for catalog
GITHUB_INTEGRATION_TOKEN=
```

> **How to get an AAP API token:** Log into your AAP Controller → Administration → Applications → Create a Personal Access Token. Give it `write` scope.

> **How to get OAuth credentials:** Log into your AAP Controller → Administration → Applications → Create a new OAuth2 Application. Set the redirect URI to `http://localhost:3000/api/auth/rhaap/handler/frame`. Note the client ID and secret.

#### Step 2: Switch to live mode

Edit `app-config.yaml` and change the data source:

```yaml
compliance:
  dataSource: live    # Change from 'mock' to 'live'
```

#### Step 3: Handle self-signed certificates (if needed)

If your AAP instance uses self-signed certificates, ensure this is set in `app-config.yaml`:

```yaml
ansible:
  rhaap:
    baseUrl: ${AAP_HOST}
    checkSSL: false     # Set to true in production with valid certs
```

#### Step 4: Restart the server

```bash
# Kill any running instance
lsof -ti:3000 | xargs kill -9

# Start with live connection
yarn start
```

The plugin will now:
- Launch real compliance scan workflows on your AAP Controller
- Display findings from actual OpenSCAP scans
- Execute remediation playbooks against real targets
- Store results in the Portal PostgreSQL database

### Switching Back to Mock Mode

To return to mock mode (e.g., for a demo), simply change `app-config.yaml`:

```yaml
compliance:
  dataSource: mock    # Change back to 'mock'
```

Restart the server. No `.env` changes needed — mock mode ignores AAP credentials.

## Configuration Reference

### Environment Variables (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `AAP_HOST` | For live mode | AAP Controller base URL (e.g., `https://aap.example.com`) |
| `AAP_AUTH_CLIENT_ID` | For live mode | OAuth2 client ID for AAP authentication |
| `AAP_AUTH_CLIENT_SECRET` | For live mode | OAuth2 client secret |
| `AAP_API_TOKEN` | For live mode | AAP API token for backend API calls |
| `BACKEND_SECRET` | For standalone | Portal service-to-service auth secret. Auto-generated in local dev but **must be set** for standalone/remote deployment. Generate with `openssl rand -hex 32`. See [standalone deployment guide](docs/standalone-deployment.md). |
| `AUTH_SIGNING_KEY` | No | JWT signing key (auto-generated if empty) |
| `GITHUB_INTEGRATION_TOKEN` | No | GitHub PAT for catalog integration |

### App Config (`app-config.yaml`)

| Setting | Default | Description |
|---------|---------|-------------|
| `compliance.dataSource` | `mock` | Data source: `mock` for sample data, `live` for real AAP |
| `ansible.rhaap.baseUrl` | `${AAP_HOST}` | AAP Controller URL (from .env) |
| `ansible.rhaap.checkSSL` | `false` | Verify SSL certificates (set `true` in production) |

## Repository Structure

```
aap-compliance-pipelines/
  backstage-app/                 Ansible Portal application
    packages/
      app/                       Frontend shell (React)
      backend/                   Backend server (Node.js)
    plugins/
      compliance/                Frontend plugin — dashboard, scan, results, remediation
      compliance-backend/        Backend plugin — API routes, database, Controller client
      compliance-common/         Shared types and API client
    api/                         OpenAPI specification (draft)
    docs/                        Plugin and feature documentation
    examples/                    Sample catalog entities and templates
    .husky/                      Git hooks (pre-commit)
  profiles/                      Self-contained compliance profiles (one per framework)
    _shared/                     Shared normalizer logic and AAP-impact dictionaries
    rhel9-stig/                  DISA STIG V2R8 for RHEL 9
      ansible_collections/security/compliance_rhel9_stig/
      ee/                        Standalone EE definition
      install.yml                Controller registration playbook
    rhel9-cis-l1/                CIS Benchmark Level 1 Server for RHEL 9
      ansible_collections/security/compliance_rhel9_cis_l1/
      ee/                        Standalone EE definition
      install.yml                Controller registration playbook
    rhel9-cis-l2/                CIS Benchmark Level 2 Server for RHEL 9
      ansible_collections/security/compliance_rhel9_cis_l2/
      ee/                        Standalone EE definition
      install.yml                Controller registration playbook
  review/                        UI screenshots and review materials
```

## Development

### Running Tests

```bash
cd backstage-app

# Run all tests (no watch)
yarn test

# Run tests in watch mode
yarn test:watch

# Run tests with coverage
yarn test:all

# Run tests for a specific plugin
yarn workspace @aap-compliance/plugin-compliance test
```

### Ansible Collection Tests

```bash
cd profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig

# Run unit tests (requires pytest)
python -m pytest tests/unit/ -v

# Run ansible-test sanity (requires ansible-test)
ansible-test sanity --python default
```

### Building

```bash
# Type-check and build all packages
yarn build

# Build all packages including optional ones
yarn build:all

# Type-check only
yarn tsc
```

### Linting and Formatting

```bash
# Lint changed files (since origin/main)
yarn lint

# Lint all files
yarn lint:all

# Auto-fix lint issues
yarn fix

# Check formatting
yarn prettier:check
```

### Pre-commit Hooks

Husky runs `lint-staged` on every commit, which applies ESLint and Prettier to staged `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, and `.cjs` files.

## AAP Lab Setup (for contributors)

If you have access to an AAP lab environment and want to set up the compliance workflow:

### 1. Create compliance resources in Controller

The collection includes playbooks to seed AAP with compliance resources:

- Organization: `compliance-prototype`
- Inventory with target RHEL 9 hosts
- Machine credential for SSH access
- Project pointing to this repo
- Job templates: `compliance-run-oscap` (assessment: scan + normalize in 2 plays), `compliance-remediate` (standalone, launched with job_tags)
- Legacy JTs (`gather-facts`, `evaluate`) and workflow (`Gather -> Evaluate -> Remediate`) are deprecated

### 2. Required Controller resources

| Resource | Purpose |
|----------|---------|
| Organization | Isolates compliance resources |
| Inventory | Target hosts for scanning |
| Machine Credential | SSH access to targets |
| Project (git) | Points to this repo for playbooks |
| Job Templates (2) | Assessment (`compliance-run-oscap`: scan + normalize), Remediation (`compliance-remediate`: CaC with job_tags) |

### 3. Verified on lab

The pipeline has been validated end-to-end on AAP 2.6:
- OpenSCAP assessment: `run_oscap.yml` scans targets with 366 STIG rules from scap-security-guide, normalizes XCCDF to CFF JSON
- Remediation: `remediate.yml` applies CaC playbook scoped by `job_tags` for selective rule application
- Architecture: single assessment JT (2 plays in one container), separate remediation JT launched directly

## Troubleshooting

### Plugin shows mock data even after switching to live mode

Make sure you:
1. Created `.env` with valid `AAP_HOST` and `AAP_API_TOKEN`
2. Changed `compliance.dataSource` to `live` in `app-config.yaml`
3. Killed the old server (`lsof -ti:3000 | xargs kill -9`) and restarted with `yarn start`

### AAP connection errors in live mode

- Verify `AAP_HOST` is reachable: `curl -sk https://your-aap-host/api/v2/ping/`
- Check the API token is valid: `curl -sk -H "Authorization: Bearer YOUR_TOKEN" https://your-aap-host/api/v2/me/`
- If using self-signed certs, ensure `checkSSL: false` in app-config.yaml

### `yarn start` fails with module errors

Make sure you are using Node.js 20 or 22 (`node --version`). Run `./install-deps` to reinstall.

### `corepack` not found

Corepack ships with Node.js 16.10+. Run `corepack enable` to activate it.

### Pre-commit hook not running

Run `yarn prepare` to reinstall Husky hooks, or run `./install-deps`.
