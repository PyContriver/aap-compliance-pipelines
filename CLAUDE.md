---
title: "AAP Compliance Pipelines Prototype"
description: "AI assistant context -- component architecture, key paths, terminology, engineering standards"
type: project
audience: [developer]
product: "AAP Compliance Dashboard"
product_version: "2.6"
status: current
last_verified: 2026-07-09
---

# AAP Compliance Pipelines Prototype

Self-contained MVP for an AAP compliance vertical — Ansible Portal plugin + RHEL STIG content.

## Structure

- `backstage-app/` — Ansible Portal application with compliance plugins
  - `plugins/compliance/` — Frontend plugin (6 tabs, 12 routes: overview, profiles, scan, results, remediations, settings)
  - `plugins/compliance-backend/` — Backend plugin (REST API, Controller client, DB)
  - `plugins/compliance-common/` — Shared types
- `profiles/` — Self-contained compliance profiles (one per framework), each containing an Ansible collection, EE definition, and install playbook
- `content/` — Compliance content packaged as Ansible Pattern (SDP-0005/0009)
- `scripts/` — Lab seed/clean playbooks
- `docs/` — Design docs, AsciiDoc modules, developer guide

## Lab Connection

AAP 2.6 lab at `<aap-lab-host>` (local dev environment). Compliance resources isolated in `compliance-prototype` organization.
All AAP resources prefixed `compliance-*`.

## Development

```bash
cd backstage-app
yarn install
./bin/start.sh live   # Connect to lab AAP (needs VM running + aap-lab start)
./bin/start.sh mock   # Demo mode with hardcoded data
./bin/stop.sh         # Stop frontend + backend
yarn test             # Run tests across 24 suites (626 tests)
yarn build            # Build all packages
```

## Dynamic Plugin Packaging

Plugins are packaged for Portal/RHDH via `@janus-idp/cli` (`janus-cli`).
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

Four compliance profiles ship under `profiles/`, using two scanner backends.

**XCCDF profiles (STIG, CIS):** Use OpenSCAP (`oscap xccdf eval`) with scap-security-guide. All share a single `normalize_common.py` at `profiles/_shared/normalize_common.py`. Each collection's `plugins/modules/normalize_xccdf.py` is a thin wrapper that imports from `plugins/module_utils/normalize_common.py` (a synced copy). After editing the shared source, run `python scripts/sync_shared_modules.py` to propagate changes.

**Supply chain profile:** Uses Syft (SBOM generation) + Grype (CVE matching). `normalize_cyclonedx.py` is a standalone module (NOT shared from `_shared/`). Play 1 runs Syft on targets, fetches SBOMs back. Play 2 runs Grype on localhost against fetched SBOMs, normalizes per-host to CFF, composes POST body files via `compose_post_body` (ADR-033), streams to API via `uri src`. Exit_json returns only counts — no findings in return value.

| Profile | Framework | XCCDF Profile | Certification |
|---------|-----------|---------------|---------------|
| `rhel9-stig` | DISA STIG V2R8 | `stig` | certified (NIST SCAP 1.2) |
| `rhel9-cis-l1` | CIS L1 Server | `cis_server_l1` | conformant |
| `rhel9-cis-l2` | CIS L2 Server | `cis` | conformant |
| `supply-chain` | SUPPLY_CHAIN | Syft + Grype | uncertified |

Each XCCDF profile has the same pipeline structure:
1. `run_oscap.yml` (single JT, 2 plays): Play 1 runs on targets -- installs oscap ephemerally, copies datastream from EE, scans, fetches XCCDF XML back, cleans up. Play 2 runs on localhost (same container) -- `normalize_xccdf` module parses XML, outputs CFF JSON with certification metadata. Play 2 then POSTs findings directly to the plugin's `/findings/ingest` endpoint via `uri` module (ADR-007).
2. `normalize.yml` (standalone utility): same normalization logic, available for debugging and Tier 2 reuse
3. `remediate.yml` (standalone JT): imports CaC playbook from scap-security-guide, scoped by `job_tags`

Extra vars for assessment JT: `scan_id`, `backstage_api_url`, `ingest_token` (per-scan security token, ADR-010), `remediate_jt_name` (auto-populate for Settings form), `remediation_playbook` (auto-populate). The normalizer also accepts `rules_metadata_file` (path to the collection's `rules/*.yml`); it is resolved automatically from the collection's `rules/` directory at scan time. The `load_rules_metadata_map()` function reads both `aap_impact` classification metadata and `fix_text` (CaC Ansible task YAML) from this file, merging them into findings at scan time. The fix_text merge replaces XCCDF prose with actual Ansible task YAML, enabling `automationAvailable` detection in `FindingsParser.ts`.

Key files in the EE (same for all profiles — `scap-security-guide` ships all datastreams):
- `/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml` — SCAP datastream (all profiles)
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml` — STIG CaC remediation
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-cis_server_l1.yml` — CIS L1 CaC remediation
- `/usr/share/scap-security-guide/ansible/rhel9-playbook-cis.yml` — CIS L2 CaC remediation

## Engineering Standards

- Material UI themed to PatternFly 6 (Portal exemption from direct PatternFly)
- All API calls through platform gateway (`/api/controller/v2/`)
- Per-user AAP tokens via `x-aap-token` header
- RHDH dynamic plugin packaging
- Match Ansible Portal look and feel (ansible-backstage-plugins reference)
- 127 collection unit tests (19 per XCCDF profile + 44 CycloneDX + 60 cross-profile) + 626 backend/frontend tests across 24 suites
- 37 formal ADRs in `specs/compliance-pipelines/decisions/`
- 9 Tier 1 widget types for dynamic tabs: `summary_card`, `severity_breakdown`, `findings_table`, `trend_chart`, `gauge`, `host_breakdown`, `score_grid`, `action_table`, `host_risk_heatmap`
- `scan_metadata` JSON column on `compliance_scans` stores per-host package counts via idempotent `mergeScanMetadata` (hosts map + aggregate totals: `totalScannedPackages` from Syft SBOM, `totalVulnerablePackages` from Grype matches, `totalVulnerabilities` unique CVEs). Vulnerability-free rate = `(totalScannedPackages - totalVulnerablePackages) / totalScannedPackages`. Old scans without new fields fall back gracefully.
- EE images hosted in PAH (`aap-netrunner.demoredhat.com/compliance-*:latest`), built via GitHub Actions and mirrored with skopeo (ADR-031)
- Normalizer playbooks MUST loop per-host to prevent OOM on execution nodes (ADR-030)
- Normalizer modules SHOULD use `compose_post_body` + `uri src` to stream findings to the API without loading them into Jinja2 variable space (ADR-033). Default format is NDJSON (`post_body_format: 'ndjson'`) with content-type negotiation on the ingest endpoint (ADR-034)
