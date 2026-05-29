# AAP Compliance Pipelines Prototype

Self-contained MVP for an AAP compliance vertical — Backstage plugin + RHEL STIG content.

## Structure

- `backstage-app/` — Backstage application with compliance plugins
  - `plugins/compliance/` — Frontend plugin (6 tabs, 12 routes: overview, profiles, scan, results, remediations, settings)
  - `plugins/compliance-backend/` — Backend plugin (REST API, Controller client, DB)
  - `plugins/compliance-common/` — Shared types
- `profiles/` — Self-contained compliance profiles (one per framework), each containing an Ansible collection, EE definition, and install playbook
- `content/` — Compliance content packaged as Ansible Pattern (SDP-0005/0009)
- `scripts/` — Lab seed/clean playbooks
- `docs/` — Design docs, AsciiDoc modules, developer guide

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
yarn test             # Run tests across 11+ suites
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

- "Compliance profile" = registered standard mapped to an assessment JT + EE (Settings tab)
- "Remediation" = saved rule selections + parameter overrides (Remediations tab)
- "Assessment JT" = single job template running `run_oscap.yml` (scan targets + normalize on localhost in one JT), read-only, never modifies hosts
- "Remediation JT" = standalone job template launched directly (not via workflow) with job_tags
- "CFF" = Common Findings Format, the JSON schema all scanners normalize to
- AAP 2.6 terms: "automation controller" (lowercase), "workflow job template", "platform gateway"

## Scanner Architecture

Uses OpenSCAP (`oscap xccdf eval`) with scap-security-guide. Three profiles ship under `profiles/`:

| Profile | Framework | XCCDF Profile | Certification |
|---------|-----------|---------------|---------------|
| `rhel9-stig` | DISA STIG V2R8 | `stig` | certified (NIST SCAP 1.2) |
| `rhel9-cis-l1` | CIS L1 Server | `cis_server_l1` | conformant |
| `rhel9-cis-l2` | CIS L2 Server | `cis` | conformant |

Each profile has the same pipeline structure:
1. `run_oscap.yml` (single JT, 2 plays): Play 1 runs on targets -- installs oscap ephemerally, copies datastream from EE, scans, fetches XCCDF XML back, cleans up. Play 2 runs on localhost (same container) -- `normalize_xccdf` module parses XML, outputs CFF JSON with certification metadata. Play 2 then POSTs findings directly to the plugin's `/findings/ingest` endpoint via `uri` module (ADR-007).
2. `normalize.yml` (standalone utility): same normalization logic, available for debugging and Tier 2 reuse
3. `remediate.yml` (standalone JT): imports CaC playbook from scap-security-guide, scoped by `job_tags`

Extra vars for assessment JT: `scan_id`, `backstage_api_url`, `ingest_token` (per-scan security token, ADR-010).

Key files in the EE (same for all profiles — `scap-security-guide` ships all datastreams):
- `/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml` — SCAP datastream (all profiles)
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml` — STIG CaC remediation
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-cis_server_l1.yml` — CIS L1 CaC remediation
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-cis.yml` — CIS L2 CaC remediation

## Engineering Standards

- Material UI themed to PatternFly 6 (Backstage exemption from direct PatternFly)
- All API calls through platform gateway (`/api/controller/v2/`)
- Per-user AAP tokens via `x-aap-token` header
- RHDH dynamic plugin packaging
- Match Ansible Portal look and feel (ansible-backstage-plugins reference)
- 200+ tests across 11+ suites (frontend + backend + database)
- 10 formal ADRs in `specs/compliance-pipelines/decisions/`
