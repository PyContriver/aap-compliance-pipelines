# Deployment Guide

The compliance plugins can run in two modes: as part of a standalone Backstage dev app for local development, or as dynamic plugins installed in Portal (RHDH).

## Local Development

The standalone dev workflow uses the `packages/app` and `packages/backend` shells to host the plugins locally with hot reloading.

### Prerequisites

- Node.js 20 or 22
- Corepack enabled (`corepack enable`)
- Yarn 4.x (installed via Corepack)

### Quick Start

```bash
cd backstage-app

# Install dependencies
./install-deps

# Start in mock mode (no AAP connection needed)
./bin/start.sh mock

# Start in live mode (requires AAP Controller)
./bin/start.sh live .env.netrunner
```

The frontend is available at `http://localhost:3000` and the backend at `http://localhost:7007`.

### Mock Mode

Uses built-in sample data. No AAP instance required. Ideal for UI development, demos, and UX reviews.

### Live Mode

Connects to a real AAP Controller instance. Requires a `.env` file with connection details:

```bash
cp .env.example .env
# Edit .env with your AAP_HOST, AAP_API_TOKEN, and OAuth credentials
```

See the root [README.md](../README.md) for full configuration reference.

## Portal / RHDH Installation

The plugins are packaged as dynamic plugins for installation in Red Hat Developer Hub (RHDH) or Ansible Portal.

### Building Dynamic Plugins

```bash
cd backstage-app

# Install dependencies
yarn install

# Build all packages
yarn build

# Export backend plugin (embeds compliance-common)
yarn workspace @aap-compliance/plugin-compliance-backend export-dynamic

# Export frontend plugin
yarn workspace @aap-compliance/plugin-compliance export-dynamic
```

This produces:
- `plugins/compliance-backend/dist-dynamic/` -- backend dynamic plugin
- `plugins/compliance/dist-scalprum/` -- frontend dynamic plugin (Scalprum format)

### Installing in RHDH

1. Copy the exported plugin directories to your RHDH dynamic plugins directory
2. Merge the `app-config.janus-idp.yaml` from each plugin into your RHDH app-config

**Frontend registration** (`plugins/compliance/app-config.janus-idp.yaml`):

```yaml
dynamicPlugins:
  frontend:
    aap-compliance.plugin-compliance:
      dynamicRoutes:
        - importName: CompliancePage
          path: /compliance
          menuItem:
            icon: security
            text: Compliance
```

**Backend registration** (`plugins/compliance-backend/app-config.janus-idp.yaml`):

```yaml
dynamicPlugins:
  backend:
    aap-compliance.plugin-compliance-backend: {}
```

### Required RHDH Configuration

Add the compliance plugin settings to your RHDH app-config:

```yaml
compliance:
  dataSource: live
  retentionDays: 90

ansible:
  rhaap:
    baseUrl: https://your-aap-gateway.example.com
    checkSSL: true
    token: ${AAP_API_TOKEN}
```

## Configuration

### App Config Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `compliance.dataSource` | `mock` | Data source: `mock` for sample data, `live` for real AAP |
| `compliance.retentionDays` | `90` | Days to retain scan findings before cleanup |
| `ansible.rhaap.baseUrl` | -- | AAP Platform Gateway URL |
| `ansible.rhaap.checkSSL` | `false` | Verify SSL certificates |
| `ansible.rhaap.token` | -- | AAP API token for backend calls |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AAP_HOST` | Live mode | AAP Controller/Gateway base URL |
| `AAP_API_TOKEN` | Live mode | AAP API token for backend API calls |
| `AAP_AUTH_CLIENT_ID` | Portal auth | OAuth2 client ID for AAP authentication |
| `AAP_AUTH_CLIENT_SECRET` | Portal auth | OAuth2 client secret |
| `BACKEND_SECRET` | No | Backend auth secret (auto-generated if empty) |

## Authentication

### Development (Standalone)

Guest authentication is enabled by default for local development:

```yaml
auth:
  providers:
    guest:
      dangerouslyAllowOutsideDevelopment: true
```

All API routes are marked `unauthenticated` in the backend. This is intentional for the prototype phase.

### Production (Portal/RHDH)

In Portal, authentication is handled by the existing `auth-backend-module-rhaap-provider` plugin, which provides AAP Gateway OAuth2 login. The compliance plugin does not bundle its own auth -- it relies on the Portal auth stack.

For AAP API authorization, each user's AAP token is passed via the `x-aap-token` header. AAP's native RBAC determines what inventories, workflow templates, and credentials the user can access.

RBAC enforcement in Backstage uses the two-tier model:
- **Backstage layer**: `@backstage-community/plugin-rbac-backend` gates access based on user groups (`aap-admins` vs authenticated users)
- **AAP layer**: per-request token pass-through for Controller API calls

## Plugin Architecture

```
@aap-compliance/common          Shared types (embedded in backend, not deployed separately)
@aap-compliance/plugin-compliance        Frontend plugin (dashboard, scan, results, remediation)
@aap-compliance/plugin-compliance-backend  Backend plugin (REST API, database, Controller client)
```

The common library is embedded into the backend plugin during `export-dynamic` via `--embed-package`. It is not deployed as a standalone dynamic plugin.
