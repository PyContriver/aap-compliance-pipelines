---
title: "Netrunner Portal Deployment"
description: "Internal reference for the Netrunner demo lab deployment at dev-portal-netrunner.demoredhat.com"
type: reference
audience: [developer]
product: "AAP Compliance Dashboard"
product_version: "2.6"
status: current
last_verified: 2026-07-09
related:
  - deployment-guide.md
---

# Netrunner Portal Deployment

Step-by-step record of deploying the compliance plugins on the Netrunner demo lab Portal (QCOW-based RHDH appliance). This documents the exact friction points, workarounds, and final working configuration.

> **Note:** Replace `<VERSION>` in all commands below with the actual plugin version being deployed (e.g., `0.4.0` for backend, `0.2.0` for frontend). Check the `version` field in each plugin's `package.json` for the current version.

## Environment

| Component | Detail |
|-----------|--------|
| Portal host | `ec2-18-134-232-9.eu-west-2.compute.amazonaws.com` |
| RHDH version | 1.9 (rhdh-hub-rhel9) |
| Container runtime | podman (systemd quadlet) |
| AAP Gateway | `nm-aap-dev-2026.demoredhat.com` |
| SSH user | `cloud-user` (sudo, key-based) |
| Portal user | `massimo` (RHAAP OAuth, superUser role) |

### Key paths

```
/etc/portal/configs/
  app-config/app-config.production.yaml   # Backstage app config overrides
  dynamic-plugins/dynamic-plugins.override.yaml  # Plugin install manifest

/var/lib/portal/
  dynamic-plugins-root/    # Mounted into container at /opt/app-root/src/dynamic-plugins-root/
  compliance-plugins/      # Custom dir for our tarballs (not scanned by backend)

/usr/share/portal/plugins/ # Pre-bundled Ansible plugins (read-only, mounted at /opt/app-root/src/ansible-plugins/)
```

### Service management

```bash
sudo systemctl restart portal.service   # Recreates container from quadlet
sudo systemctl stop portal.service
sudo journalctl -u portal.service -f    # Live logs
sudo podman logs portal                 # Container logs (only while running)
```

## Step 1: Build tarballs locally

```bash
cd backstage-app

# Build all packages
yarn build

# Export dynamic plugins
yarn workspace @aap-compliance/plugin-compliance-backend export-dynamic
yarn workspace @aap-compliance/plugin-compliance export-dynamic

# Create tarballs
cd plugins/compliance-backend/dist-dynamic && npm pack
cd ../../compliance/dist-dynamic && npm pack
```

This produces:
- `plugins/compliance-backend/dist-dynamic/aap-compliance-plugin-compliance-backend-dynamic-<VERSION>.tgz`
- `plugins/compliance/dist-dynamic/aap-compliance-plugin-compliance-dynamic-<VERSION>.tgz`

## Step 2: Compute integrity hashes

Portal's `install-dynamic-plugins.py` requires SHA-512 integrity hashes for tarball packages. Without them, the install script throws `InstallException: No integrity hash provided`.

```bash
# For each tarball:
openssl dgst -sha512 -binary < file.tgz | base64
# Prefix with sha512-
```

Example output:
```
sha512-ZKo7SycT/BXki4E+FJ6o1nj8WsafdbH9JXqh3AUTUihxjDQVUj2YS29zmHbQeYK794ZHbY8qBQfT+o9Sb1vx0w==
```

## Step 3: Upload to Portal

```bash
scp -i portal-key.pem \
  aap-compliance-plugin-compliance-backend-dynamic-<VERSION>.tgz \
  aap-compliance-plugin-compliance-dynamic-<VERSION>.tgz \
  cloud-user@<portal-host>:/tmp/

ssh cloud-user@<portal-host>
sudo mkdir -p /var/lib/portal/compliance-plugins
sudo cp /tmp/aap-compliance-*.tgz /var/lib/portal/compliance-plugins/

# Copy to stable filenames so config references don't change between versions
sudo cp /tmp/aap-compliance-plugin-compliance-backend-dynamic-<VERSION>.tgz /var/lib/portal/compliance-plugins/backend.tgz
sudo cp /tmp/aap-compliance-plugin-compliance-dynamic-<VERSION>.tgz /var/lib/portal/compliance-plugins/frontend.tgz
```

**Important:** Do NOT place plugin source directories or tarballs inside `/var/lib/portal/dynamic-plugins-root/`. The backend plugin scanner scans that entire directory tree — if both source and extracted copies exist, you get `Plugin 'compliance' is already registered`.

## Step 4: Add to dynamic-plugins.override.yaml

Append to `/etc/portal/configs/dynamic-plugins/dynamic-plugins.override.yaml`:

```yaml
  # AAP Compliance Plugins (using stable tarball names — no path changes on version bumps)
  - package: /var/lib/portal/compliance-plugins/backend.tgz
    disabled: false
    integrity: sha512-<hash-from-step-2>
    pluginConfig:
      dynamicPlugins:
        backend:
          aap-compliance.plugin-compliance-backend: {}

  - package: /var/lib/portal/compliance-plugins/frontend.tgz
    disabled: false
    integrity: sha512-<hash-from-step-2>
    pluginConfig:
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

## Step 5: Add compliance config to app-config.production.yaml

Append to `/etc/portal/configs/app-config/app-config.production.yaml`:

```yaml
compliance:
  dataSource: live
  authMode: production
  retentionDays: 90
```

## Step 6: Create Knex migration files

`janus-cli export-dynamic` does not package Knex migration TypeScript files into the dist output. The backend plugin crashes on startup with `ENOENT: no such file or directory, scandir '.../dist/database/migrations'`.

After the first `systemctl restart` (which extracts the tarballs), create the migration JS files manually:

```bash
sudo mkdir -p /var/lib/portal/dynamic-plugins-root/aap-compliance-plugin-compliance-backend-dynamic-<VERSION>/dist/database/migrations
```

Then create `20260429_001_initial.js` and `20260429_002_cartridge_registry.js` with the compiled migration code (remove TypeScript type annotations from the source `.ts` files). Note: the "cartridge" naming is an internal implementation detail; the user-facing term is "compliance profile."

### First-run: clean database

If the database already has compliance tables from a previous attempt (without migration tracking), drop them first:

```bash
sudo podman exec portal-postgres psql -U portal_user -d backstage_plugin_compliance -c "
DROP TABLE IF EXISTS compliance_posture_snapshots CASCADE;
DROP TABLE IF EXISTS compliance_remediation_profiles CASCADE;
DROP TABLE IF EXISTS compliance_findings CASCADE;
DROP TABLE IF EXISTS compliance_scans CASCADE;
DROP TABLE IF EXISTS compliance_cartridge_registry CASCADE;  -- "compliance profile" in the UI; table name is an implementation detail
DROP TABLE IF EXISTS compliance_knex_migrations CASCADE;
DROP TABLE IF EXISTS compliance_knex_migrations_lock CASCADE;
"
```

## Step 7: Restart and verify

```bash
sudo systemctl restart portal.service

# Wait ~35 seconds for startup, then check:
sudo podman logs portal 2>&1 | grep -i compliance
```

Expected log lines (success):
```
loaded dynamic backend plugin '@aap-compliance/plugin-compliance-backend-dynamic'
Loaded dynamic frontend plugin '@aap-compliance/plugin-compliance-dynamic'
Compliance auth mode: production
Compliance database migrations applied
ComplianceService initialized with dataSource=live
Compliance service ready (dataSource=live)
Plugin initialization complete
```

Verify endpoints:
```bash
# Health (unauthenticated)
curl -sk https://localhost:443/api/compliance/health
# → {"status":"ok","dataSource":"live","retentionDays":90}

# Frontend route
curl -sk -o /dev/null -w '%{http_code}' https://localhost:443/compliance
# → 200

# Authenticated endpoint — compliance profiles (should 401 without token)
curl -sk https://localhost:443/api/compliance/compliance-profiles
# → {"error":{"name":"AuthenticationError","message":"Missing credentials"}}
```

## RBAC setup

Add the compliance user as a superUser in `app-config.production.yaml`:

```yaml
permission:
  enabled: true
  rbac:
    superUsers:
      - name: user:default/massimo
```

## Friction points encountered

These are documented for future reference — Portal is designed to resist third-party plugin installation (it's an upsell route to full RHDH).

| Issue | Symptom | Fix |
|-------|---------|-----|
| Missing plugin-manifest.json | `Could not find 'dist-scalprum/plugin-manifest.json'` | `janus-cli` generates this correctly in dist-scalprum; earlier manual deployment missed it |
| No integrity hash | `InstallException: No integrity hash provided` | Compute SHA-512 hash and add `integrity:` field to override YAML |
| Duplicate plugin registration | `Plugin 'compliance' is already registered` | Keep plugin sources OUTSIDE `dynamic-plugins-root/`; use a separate directory |
| Missing migrations directory | `ENOENT: scandir '.../dist/database/migrations'` | Manually create JS migration files in extracted plugin |
| Stale DB tables | `relation already exists` during migration | Drop compliance tables in PostgreSQL before first run |
| Override config overwritten | Edits to `app-config.dynamic-plugins.yaml` lost on restart | Use `dynamic-plugins.override.yaml` (the persistent config); the generated file is rebuilt each startup |

## Updating the plugin

To deploy a new version:

1. Rebuild, re-export, re-pack locally
2. Recompute integrity hashes
3. Upload new tarballs to `/var/lib/portal/compliance-plugins/` using stable names (`backend.tgz` and `frontend.tgz`). The deploy script (`scripts/deploy-netrunner.sh`) copies versioned tarballs to these stable filenames so the `dynamic-plugins.override.yaml` config does not need path updates on each deploy.
4. Update `integrity:` values in `dynamic-plugins.override.yaml` (the deploy script does this automatically via Python/YAML on the remote host)
5. Clear stale extracted plugin directories before restart: `sudo rm -rf /opt/app-root/src/dynamic-plugins-root/aap-compliance-plugin-compliance-*`. This forces Portal to re-extract the new tarballs on startup rather than using cached extractions from the previous version.
6. Create migration files again if schema changed
7. `sudo systemctl restart portal.service`

The automated deploy script handles steps 1--7 in a single invocation:

```bash
./scripts/deploy-netrunner.sh              # bump patch, deploy both plugins
./scripts/deploy-netrunner.sh backend      # backend only
./scripts/deploy-netrunner.sh frontend     # frontend only
./scripts/deploy-netrunner.sh --no-bump    # skip version bump
```
