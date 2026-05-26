# AAP Compliance Pipelines Prototype

Self-contained prototype for an AAP compliance vertical — Backstage plugin + RHEL STIG content.

## Structure

- `backstage-app/` — Backstage application with compliance plugins
  - `plugins/compliance/` — Frontend plugin (6 tabs, 12 routes: overview, profiles, scan, results, remediations, settings)
  - `plugins/compliance-backend/` — Backend plugin (REST API, Controller client, DB)
  - `plugins/compliance-common/` — Shared types
- `content/` — Compliance content packaged as Ansible Pattern (SDP-0005/0009)
- `scripts/` — Lab seed/clean playbooks
- `docs/` — Design docs and research

## Lab Connection

AAP 2.6 lab at `192.168.128.128`. Compliance resources isolated in `compliance-prototype` organization.
All AAP resources prefixed `compliance-*`.

## Development

```bash
cd backstage-app
yarn install
./bin/start.sh live   # Connect to lab AAP (needs VM running + aap-lab start)
./bin/start.sh mock   # Demo mode with hardcoded data
./bin/stop.sh         # Stop frontend + backend
yarn test             # Run 206 tests across 11 suites
yarn build            # Build all packages
```

## Dynamic Plugin Packaging

Plugins are packaged for Portal/RHDH via `@red-hat-developer-hub/cli` (`rhdh-cli`).
Matches the `ansible-rhdh-plugins` downstream patterns exactly.

```bash
# Export backend (embeds compliance-common)
yarn workspace @aap-compliance/plugin-compliance-backend export-dynamic

# Export frontend (Scalprum format)
yarn workspace @aap-compliance/plugin-compliance export-dynamic
```

Registration configs: `plugins/*/app-config.janus-idp.yaml`
Full guide: `docs/deployment-guide.md`

## Terminology

- "Compliance profile" = registered standard mapped to a 2-node assessment workflow + EE (Settings tab)
- "Remediation" = saved rule selections + parameter overrides (Remediations tab)
- "Assessment workflow" = 2-node workflow (gather -> evaluate), read-only, never modifies hosts
- "Remediation JT" = standalone job template launched directly (not via workflow) with job_tags
- AAP 2.6 terms: "automation controller" (lowercase), "workflow job template", "platform gateway"

## Engineering Standards

- Material UI themed to PatternFly 6 (Backstage exemption from direct PatternFly)
- All API calls through platform gateway (`/api/controller/v2/`)
- Per-user AAP tokens via `x-aap-token` header
- RHDH dynamic plugin packaging
- Match Ansible Portal look and feel (ansible-backstage-plugins reference)
- 206 tests across 11 suites (frontend + backend + database)
