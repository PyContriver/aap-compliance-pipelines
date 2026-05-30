# Architect Assessment: AAP Compliance Pipelines Prototype

**Date:** 2026-05-20
**Reviewer:** Senior Software Architect, Red Hat
**Scope:** Full quality assessment -- architecture, AAP integration, content portability, shipping readiness
**Baseline:** Plan doc (Google Drive 1eVs4DXG...), Cartridge Architecture doc (1y8W9uPM...), previous review (2026-05-19)

---

## 1. Executive Summary

This prototype delivers a credible end-to-end compliance vertical for AAP -- scan, report, review, remediate -- in approximately 50 commits. The architecture is sound: the scanner orchestrator model with a Common Findings Format is the right abstraction, the remediation plan builder (grouping rules by host set for efficient execution) is genuinely clever, and the decision to use Controller workflows for scans but direct JT launch for remediation shows real understanding of AAP internals. The three-package Backstage plugin layout, Knex migration strategy, and per-user token pass-through pattern are all correct for downstream integration. The prototype is demonstrable today and could be shown to stakeholders with minor polish. Shipping as a tech preview requires work on RBAC integration, pagination, the dashboard aggregation pipeline, and collection completeness (20 of ~366 STIG rules). The content packaging model (compliance profile collection + EE profile + workflow) is well-documented and genuinely extensible to Windows/CIS/PCI-DSS without touching the dashboard.

---

## 2. Scorecard

| Category | Score (1-5) | Key Finding |
|----------|:-----------:|-------------|
| A. Architecture & Design | 4 | Scanner orchestrator model is correct; CFF contract is clean; remediation architecture (workflow for scans, direct JT for remediation) is the right AAP pattern |
| B. AAP Integration Quality | 4 | Gateway API paths correct; per-user token flow plumbed; ControllerClient follows upstream AAPClient patterns; EE profile is valid |
| C. Backstage Plugin Quality | 3.5 | Correct three-package structure; proper API factory pattern; SQLite for dev is fine; needs dist-dynamic packaging and pagination before shipping |
| D. Content & Collection Quality | 3 | Modules are production-quality code; only 20 of ~366 rules authored; EE profile builds; collection namespace needs Red Hat ownership discussion |
| E. Security | 3 | Sensitive file exclusion is correct; all auth routes marked unauthenticated (documented plan to close); local .env files have real tokens on disk (untracked -- acceptable for prototype) |
| F. Documentation Quality | 4 | Developer guide is thorough; AsciiDoc modules use correct Red Hat format; CFF JSON schema is fully specified; lab docs sufficient |
| G. Shipping Readiness | 3 | Phase 1+2 at ~70% delivery; demonstrable now; 5-8 items between here and tech preview |

---

## 3. Detailed Findings

### A. Architecture & Design

**A1. Spec fidelity: What is delivered vs. what is specified**

The plan doc defines a six-phase roadmap. Current delivery status:

| Phase | Specified | Delivered | Gap |
|-------|-----------|-----------|-----|
| Phase 1: Tier 1 OpenSCAP profile | CFF schema, normalizer, 3 modules, pipeline playbooks, EE definition, rules YAML | CFF schema (documented), normalize_xccdf module, compliance_gather, compliance_evaluate, 4 pipeline playbooks, EE profile, 20 rules | CFF JSON schema is documented but not enforced at runtime via validation; only 20 of ~366 STIG rules authored |
| Phase 2: Backstage plugin | 6 views, ComplianceClient, backend REST API | 7 views (added ScanHistory/RemediationsList beyond spec), ComplianceBackendClient, 25+ REST endpoints, database layer | Exceeds spec on views; missing scanner picker in ScanLauncher (not needed until Tier 2) |
| Phase 3: Backend integration + reporting | Scaffolder actions, Grafana, CKL export | Database persistence, dashboard stats aggregation, posture history | No scaffolder actions (used REST API instead -- better for this use case); no CKL/ARF export; no Grafana |
| Phase 4-6 | Tier 2 adapters, Windows, EDA | Not started | Expected -- these are future phases |

Percentage delivered: Phase 1 at ~75%, Phase 2 at ~85%, Phase 3 at ~40%. Overall Phase 1+2 combined: approximately 70%.

**A2. Three-tier scanner model abstraction**

The abstraction is properly documented and the code implements it correctly:

- The `ControllerClient` does not know about scanners -- it only knows about workflow/JT IDs, job events, and status polling.
- The `ComplianceService.parseJobEvents()` method accepts findings from any source (Track A `compliance_evaluate` or Track B `normalize_xccdf`) via four different event_data paths.
- The `storedFindingsToMultiHost()` aggregation is scanner-agnostic -- it groups by ruleId regardless of origin.
- The developer guide (`docs/compliance-profile-developer-guide.md`) provides complete Tier 1/2/3 collection structures with checklists.

**Can a new scanner be added without touching the dashboard?** Yes. A new scanner would require: (1) a new normalizer module, (2) pipeline playbooks, (3) an EE definition. The dashboard, results viewer, remediation builder, and all frontend components consume `MultiHostFinding[]` and never inspect scanner identity. This is correct by design.

**A3. Common Findings Format pipeline**

The normalize -> store -> display pipeline works end-to-end:

1. **Normalize:** The `normalize_xccdf.py` module parses XCCDF 1.1/1.2 XML and produces CFF-shaped findings. The `compliance_evaluate.py` module produces the same shape directly from rule evaluation.
2. **Store:** `ComplianceService.fetchAndParseResults()` extracts findings from Controller job events, maps them via `mapRawFinding()`, and persists via `ComplianceDatabase.saveFindingsForScan()` with batch inserts (100-row batches).
3. **Display:** `storedFindingsToMultiHost()` aggregates per-host rows into `MultiHostFinding[]` with pass/fail counts, enriches from rules metadata YAML, and serves to the frontend.

**Gap:** The CFF JSON schema v1.0.0 is fully specified in the developer guide but there is no runtime validation -- no JSON Schema validator checks that normalizer output conforms before ingestion. For a tech preview this is acceptable; for GA, a validation step in the normalize playbook would catch malformed scanner output early.

**A4. Remediation architecture**

This is one of the strongest parts of the prototype.

- **Assessment scans** launch the workflow (gather -> evaluate), which is correct because sequencing matters.
- **Scoped remediation** launches the remediate JT directly with native `job_tags` and `--limit`, which is the proper AAP pattern. The code comment at ComplianceService.ts line 415 correctly explains why: "workflow-level job_tags don't propagate to child JTs in AAP."
- The `buildRemediationPlan()` method groups rules by their target host set so that rules targeting the same hosts are batched into a single Ansible run. This avoids O(rules x hosts) job launches.
- `ask_tags_on_launch: true` and `ask_variables_on_launch: true` are documented as requirements for the remediate JT.

**AAP gotcha identified and handled:** The code correctly uses `launchJobTemplate()` (not `launchWorkflow()`) for remediation. This is important because workflow-level job_tags are a known limitation in AAP Controller.

**A5. Compliance profile (cartridge) extensibility**

The model is extensible:

- `ComplianceFramework` type already includes `'DISA_STIG' | 'CIS' | 'PCI_DSS' | 'HIPAA' | 'NIST_800_53'`.
- The `ComplianceProfile` DB schema stores `framework`, `version`, and `platform` as independent fields.
- The developer guide provides explicit Tier 2 and Tier 3 collection structures for Windows, network devices, and commercial scanner adapters.
- The CFF JSON schema includes `cis_id`, `cce_id`, and `cci_id` fields alongside `stig_id`, so cross-framework correlation is designed in.

**Gap for Windows:** The developer guide mentions PowerSTIG as the Tier 1 Windows scanner and outlines the collection structure, but no `compliance_gather` equivalent for Windows facts exists yet. The `gather_files`, `gather_services`, etc. functions in `compliance_gather.py` are Linux-specific. A Windows compliance profile would need a separate `compliance_gather_windows.py` module using WinRM-gathered facts.

---

### B. AAP Integration Quality

**B1. Gateway API patterns**

All API calls use the correct Gateway path prefix: `api/controller/v2/`. The `ControllerClient` normalizes the base URL (`replace(/\/+$/, '')`) and endpoint (`replace(/^\/+/, '')`). This matches the upstream `AAPClient` pattern in `@ansible/backstage-rhaap-common`.

**B2. Credential handling**

Two-tier token model is correctly implemented:

1. **Service token** from `app-config.yaml` (`ansible.rhaap.token`) -- used as fallback when no per-user token is present.
2. **Per-user token** via `x-aap-token` HTTP header -- the frontend's `ComplianceBackendClient` passes this on mutating operations (scan, remediate, cartridge CRUD). The backend's `getUserAapToken()` extracts it.
3. **TODO path documented:** `getAapToken()` in `ComplianceBackendClient.ts` has a clear TODO to integrate `rhAapAuthApiRef.getAccessToken()` when the auth module is wired up.

**Finding:** The `getAapToken()` method currently always returns `undefined`, so ALL Controller API calls use the service token. This means AAP RBAC is not enforced per-user. This is documented and acceptable for the prototype, but the TODO comment correctly identifies the integration path.

**B3. Workflow/JT configuration**

The 3-tier template resolution (explicit request -> DB profile registry -> name-based search) is well-designed. The code at `ComplianceService.resolveWorkflowTemplateId()` handles all three cases with clear logging.

For remediation, `resolveRemediateJobTemplateId()` correctly walks the workflow template nodes to find the remediate JT by identifier or name, then falls back to a name-based search.

**B4. EE build pipeline**

The EE definition at `meta/ee_profile.yml` is valid `ansible-builder` v3 format:

- Base image: `ee-minimal-rhel9:latest` (correct for AAP 2.6)
- Uses CentOS 9 AppStream mirror as a temporary repo for `scap-security-guide` and `openscap-scanner` installation (with cleanup after install)
- Verification steps: `rpm -q` checks and `test -f` assertions for SCAP content and CaC playbook
- Galaxy dependencies: `ansible.posix` and `community.general`

**Finding:** The EE profile is at `meta/ee_profile.yml` instead of `ee/execution-environment.yml` as specified in the developer guide. The file works, but the path inconsistency should be resolved before publishing the collection.

**B5. MCP server integration**

The prototype does not integrate with AAP's MCP server, but the architecture does not preclude it. The `ControllerClient` is a thin HTTP layer over the Controller API -- the same API that the MCP server proxies. If the MCP server exposed compliance-specific tools (e.g., `launch_compliance_scan`, `get_compliance_findings`), they could call the same backend REST API. No architectural changes needed.

---

### C. Backstage Plugin Quality

**C1. Alignment with ansible-rhdh-plugins patterns**

| Pattern | Reference (ansible-rhdh-plugins) | Compliance Plugin | Match? |
|---------|----------------------------------|-------------------|--------|
| Plugin registration | `createPlugin` + `createRoutableExtension` | Same | Yes |
| API factory | `createApiFactory` with `discoveryApiRef` + `fetchApiRef` | Same | Yes |
| API ref interface | `createApiRef<T>` with typed interface | `complianceApiRef` with `ComplianceApi` | Yes |
| Backend HTTP client | `undici.fetch` + `Agent` for SSL | `ControllerClient` uses same pattern | Yes |
| Backend plugin | `createBackendPlugin` with `coreServices` | Same | Yes |
| Auth policies | `httpRouter.addAuthPolicy()` | All routes listed explicitly | Yes |
| Config reading | `config.getOptionalString()` | Same | Yes |
| Common types package | `backstage-rhaap-common` | `compliance-common` | Yes |

The compliance plugin follows downstream patterns correctly. The three-package split (frontend, backend, common) matches the reference architecture.

**C2. Dynamic plugin packaging (dist-dynamic)**

The plugin is NOT yet packaged for dynamic plugin loading. The `package.json` files do not include `dist-dynamic` targets, and there is no `dynamic-plugins/` configuration. The reference `ansible-rhdh-plugins` repo has a `dynamic-plugins/` directory with wrappers and a `build.sh` script.

**What needs to happen:** Add a `dist-dynamic/` output target, a dynamic plugin wrapper, and integrate with the RHDH dynamic plugin loading mechanism. This is a packaging task, not an architecture change.

**C3. React patterns**

The frontend code is well-structured:

- **Hooks:** All data fetching uses `useEffect` with proper cleanup (`cancelled` flags) and dependency arrays. The `onComplete` ref pattern in ScanProgress avoids re-render loops.
- **Error handling:** `ComplianceErrorBoundary` wraps all routes. Each component has `catch` blocks with `console.error` logging (fixed in previous review).
- **Permissions:** `usePermission(catalogEntityCreatePermission)` gates the Apply Remediation button -- following the upstream RHDH pattern.
- **Accessibility:** ARIA labels on interactive elements (toggle switches, expand buttons, keyboard handlers on scan rows).

**Findings:**

1. Some components (ComplianceDashboard, RemediationProfileBuilder) are large (400-800 lines). These could benefit from extraction into sub-components, but this is a readability concern, not a correctness issue.
2. The `mockFindings.ts` file exists in the ResultsViewer directory but is not used in production code -- it should be moved to `__testutils__` or removed.

**C4. Database layer**

The Knex-based schema is clean:

- 5 tables with proper foreign keys (`compliance_findings.scan_id` references `compliance_scans.id` with `CASCADE` delete).
- Appropriate indexes on query columns (profile_id, status, started_at, rule_id, host, severity).
- Batch inserts (100-row batches) for findings to avoid query size limits.
- Down migrations provided for clean removal.

**SQLite vs PostgreSQL:** The schema uses only standard SQL types (string, integer, float, text, timestamp). No SQLite-specific features are used. The column types and indexes are all Knex dialect-neutral. Migration to PostgreSQL requires only changing the `backend.database.client` config value from `better-sqlite3` to `pg` -- the migrations will run unmodified. This is a deliberate and correct choice.

**Gap:** No data retention policy. Findings accumulate indefinitely. A cleanup migration or scheduled task to age out old scan data (e.g., retain 90 days) should be added before tech preview.

**C5. Test coverage assessment**

191 tests across 11 suites:

| Suite | Tests | What It Tests | Assessment |
|-------|-------|---------------|------------|
| router.test.ts (52) | All 25+ REST endpoints, validation errors, mock/live branching | Strong -- covers happy path and error cases for every route |
| ComplianceService.test.ts (45) | parseJobEvents, buildRemediationPlan, mapRawFinding, aggregation, severity mapping | Strong -- covers the core business logic thoroughly |
| ComplianceDatabase.test.ts (30) | CRUD for all 5 tables, batch inserts, cascading deletes | Strong -- uses in-memory SQLite for fast tests |
| ComplianceDashboard.test.tsx (7) | Loading state, empty/welcome state, populated state rendering | Adequate |
| ProfileBrowser.test.tsx (17) | Profile listing, empty state, registered badge | Good |
| ScanLauncher.test.tsx (17) | Form validation, inventory/template loading, scan launch | Good |
| ScanHistory.test.tsx (6) | Scan listing, status display | Adequate |
| ResultsViewer.test.tsx (6) | Findings display, severity filtering | Adequate |
| RemediationProfileBuilder.test.tsx (7) | Rule selection, scope, parameter editing | Adequate for prototype |
| RemediationsList.test.tsx (2) | Basic rendering | Minimal |
| ProfileSettings.test.tsx (2) | Basic rendering | Minimal |

**Overall assessment:** The backend (router, service, database) is well-tested with 127 tests covering business logic and edge cases. The frontend tests are adequate for prototype stage but would need deeper interaction testing (e.g., full remediation flow, scan launch -> poll -> results display) before shipping.

**Missing:** No integration tests that exercise the full scan lifecycle (launch -> poll -> parse -> display). No E2E tests. No test coverage measurement configured.

---

### D. Content & Collection Quality

**D1. Collection structure**

The collection follows standard Ansible conventions:

- `galaxy.yml` with proper namespace (`security`), dependencies (`ansible.posix >= 1.5.0`, `redhat.rhel_system_roles >= 1.0.0`), and tags.
- `meta/runtime.yml` present.
- `plugins/modules/` with three documented modules (DOCUMENTATION, EXAMPLES, RETURN).
- `tests/unit/`, `tests/integration/`, `tests/sanity/` directories populated.
- `playbooks/` with pipeline stage playbooks.

**Finding:** The collection namespace `security` is a placeholder. For official Red Hat distribution, this would need to be `redhat.compliance_rhel9_stig` or `ansible.compliance_rhel9_stig`, requiring a namespace ownership discussion with the Ansible community team.

**D2. Module quality**

`compliance_gather.py`:

- Gathers 15 fact categories in a single SSH round-trip (no external tools installed on target).
- Properly handles OSError/IOError exceptions per category without failing the entire gather.
- Correctly excludes `/etc/shadow` and `/etc/gshadow` from content reads (metadata only).
- `supports_check_mode=True`.
- File content reading is capped at 64KB to avoid memory issues.

**Findings:**

1. The SSH config parser reads `/etc/ssh/sshd_config.d/*.conf` drop-in files -- good, this is required for RHEL 9.
2. No timeout on individual category gathers. A stuck `systemctl` call would hang the entire gather. Not critical for prototype, but worth adding for production.

`compliance_evaluate.py`:

- Runs on localhost (centralized evaluation) -- correct architecture.
- Implements 14 check types covering packages, services, sysctl, SSH, files, mounts, audit rules, crypto policy, SELinux, GRUB, and PAM.
- Rule evaluation is data-driven via the YAML rules file -- no hardcoded checks.
- Evidence strings include both actual and expected values, which the backend parses for display.

**Finding:** The `file_contains` check type uses `re.search()` with user-supplied patterns. In the current model, rules are authored YAML shipped with the collection, not user input, so this is safe. However, if user-authored rules were ever supported, this would be a ReDoS vector. Low risk for current scope.

`normalize_xccdf.py`:

- Handles both XCCDF 1.1 and 1.2 namespace detection.
- Extracts rule metadata (title, description, severity, fix_text, STIG ID) from the Benchmark element.
- Maps status and severity to CFF values via lookup tables.
- Writes JSON output with schema version `1.0.0`.
- `supports_check_mode=True`.

**Finding:** The module truncates `description` and `fix_text` to 500 characters when extracting from XCCDF. This may lose context for verbose STIG descriptions. Consider increasing or making configurable.

**D3. Rules YAML format**

The `stig_rhel9_v2r8.yml` file defines 20 rules with a clean, extensible structure:

```yaml
- id: sshd_set_idle_timeout
  stig_id: V-257844
  title: Set SSH Client Alive Interval
  severity: high
  category: Access Control
  disruption: low
  check_text: ...
  fix_text: ...
  check:
    category: ssh_config
    type: ssh_config
    params:
      key: clientaliveinterval
      value: "600"
  parameters:
    - name: var_sshd_set_keepalive
      label: Client Alive Interval (seconds)
      type: number
      default: 600
```

The format is clean and self-documenting. Adding new rules requires no code changes -- just YAML additions. The check types are a fixed vocabulary enforced by `compliance_evaluate.py`.

**Gap:** 20 rules out of ~366 in the DISA RHEL 9 STIG V2R8. The 20 rules provide good coverage of check type diversity (8 of 14 check types exercised), but a tech preview would need at least 50-100 rules to be credible for compliance buyers. The remaining rules are data authoring work, not code changes.

**D4. EE definition**

The `meta/ee_profile.yml` is correct `ansible-builder v3` format. It installs `scap-security-guide` and `openscap-scanner` from CentOS 9 AppStream (with repo cleanup after install). Build verification steps check for the presence of critical files.

**Finding:** Using CentOS 9 AppStream as a build-time repo is pragmatic for prototyping but would not pass Red Hat release engineering. The scap-security-guide RPM is available in RHEL 9 AppStream and should be sourced from there in a production build.

---

### E. Security

**E1. Credential handling**

- API tokens are loaded from environment variables via `app-config.yaml` substitution (`${AAP_API_TOKEN}`). The `.env` file is in `.gitignore` at the repo root (`.env` and `.env.*` patterns). Only `.env.example` is tracked.
- The backend logs request URLs but not authorization headers.
- `BACKEND_SECRET` and `AUTH_SIGNING_KEY` are environment variables, not hardcoded.

**Finding:** The local `.env` and `.env.netrunner` files contain real AAP API tokens on disk. They are not git-tracked (verified via `git ls-files`), but their existence on the developer machine is a credential hygiene concern. Consider documenting token rotation in the lab docs.

**E2. /etc/shadow fix**

The `compliance_gather.py` module correctly excludes `/etc/shadow` and `/etc/gshadow` from content reads:

```python
sensitive_files = {'/etc/shadow', '/etc/gshadow'}
if path not in sensitive_files and os.path.isfile(path) and stat.st_size < 65536:
    with open(path, 'r', errors='replace') as f:
        info['content'] = f.read()
```

Only metadata (mode, uid, gid, size) is collected for these files. The `shadow_permissions` rule in the rules YAML checks file permissions only, not content. This is correct and sufficient.

**E3. OWASP considerations**

| OWASP Category | Assessment |
|----------------|------------|
| Injection | SQL: Knex parameterized queries used throughout -- no raw SQL. XSS: React JSX auto-escapes. Command injection: Ansible modules use `module.run_command()` which does not use shell. |
| Broken Auth | All routes are unauthenticated (documented, with upgrade path). Per-user AAP token flow is plumbed but returns undefined. |
| Sensitive Data | Shadow file exclusion correct. No passwords in logs. API tokens in env vars. |
| Security Misconfiguration | CORS configured for localhost only. SSL check disabled for lab (`checkSSL: false`). |
| SSRF | The backend makes requests to the Controller API at a configured base URL. No user-controlled URLs in fetch calls. |

**E4. Input validation**

The router implements validation helpers (`isNonEmptyString`, `isPositiveInteger`, `isBoolean`, `isArray`) and validates all required fields on POST endpoints. The `jobId` parameter is validated as a number before use. Query parameters (`scanId`, `days`, `profileId`) are type-coerced with defaults.

**Finding:** The `days` parameter on the `/posture` endpoint is clamped to 1-365 (`Math.max(1, Math.min(365, ...))`). The `nameFilter` query parameter on `/workflow-templates` is passed through to the Controller API URL-encoded but is not length-limited. Low risk since it goes to a trusted API.

---

### F. Documentation Quality

**F1. AsciiDoc modules**

The five AsciiDoc modules in `docs/modules/` follow Red Hat documentation standards:

- Correct content type markers (`:_mod-docs-content-type: CONCEPT`, `PROCEDURE`, `REFERENCE`)
- Proper use of anchors (`[id="con-about-compliance-pipelines_{context}"]`)
- AAP attribute substitutions (`{PlatformNameShort}`, `{ControllerName}`, `{ExecEnvShort}`, `{RHDH}`)
- Role abstracts present

These could be submitted to the `aap-docs` repo as-is with minimal editing.

**F2. Lab docs**

The lab environment files (`lab-homelab-environment.md`, `lab-netrunner-environment.md`) are gitignored but present locally. The `CLAUDE.md` provides a clear restart sequence. The `.env.example` documents all required configuration.

**Finding:** There is no step-by-step guide to recreate the lab from scratch (provision VM, install AAP, create compliance organization, import project, build EE, create workflow). The memory files capture decisions but not procedures. A new developer would need the memory files plus significant context to set up the lab.

**F3. Developer guide**

The `docs/compliance-profile-developer-guide.md` is the standout documentation artifact. At ~730 lines, it provides:

- Complete Tier 1/2/3 collection structures with file-by-file explanations
- Full CFF JSON schema with field descriptions, severity mapping tables, and status mapping tables
- Normalizer implementation pattern with code template
- EE profile requirements with tier-specific examples
- Pipeline workflow stages with `infra.aap_configuration` YAML
- Registration flow for the portal settings page
- Scanner swap compatibility matrix
- 30-item readiness checklist

This document alone would enable a third-party developer to build a Tier 2 compliance profile adapter without additional guidance.

---

### G. Shipping Readiness

**G1. Phase 1+2 delivery percentage**

Approximately 70% of the combined Phase 1 + Phase 2 specification is delivered. The breakdown:

| Area | Status |
|------|--------|
| Core plugin (7 views, REST API, database) | Complete |
| Controller integration (scan, remediation, polling) | Complete |
| Results parsing (Track A + Track B) | Complete |
| Remediation plan builder | Complete |
| Dashboard (aggregate real data) | Functional but depends on having scan data in DB |
| Rules YAML (20 of ~366) | Partial |
| CKL/ARF export | Not started |
| Scanner picker (multi-scanner) | Not needed until Tier 2 |
| Auth module integration | Documented, not wired |
| Dynamic plugin packaging | Not started |
| Posture history visualization | Backend complete, frontend shows data when available |

**G2. Top 5 gaps for stakeholder demonstration**

1. **Dashboard empty state in live mode** -- The dashboard shows the welcome state until scans have been run and results persisted. A stakeholder demo needs at least one completed scan with findings. Workaround: run a scan before the demo.
2. **"0 rules" label on compliance profiles** -- The cartridge list shows "0 rules" until a scan has been completed for that profile. The rule count enrichment depends on having findings in the DB.
3. **No screenshot/demo mode** -- There is no way to pre-populate the database with representative scan data for a demo. The `mock` mode shows hardcoded data that does not look like real STIG findings. Suggestion: create a `seed-demo-data.ts` script.
4. **Remediation list actions are placeholder** -- The "View" and "Re-Apply" buttons on saved remediations work (navigate to edit/apply mode), but the UX could be polished with confirmation dialogs.
5. **No visual branding** -- The plugin uses generic Backstage components. Adding the Red Hat / AAP logo treatment and PatternFly color tokens would improve the visual impact.

**G3. Top 5 gaps for tech preview**

1. **RBAC integration** -- All backend routes are marked `unauthenticated`. The upgrade path is documented in `plugin.ts` (5-step plan). The `auth-backend-module-rhaap-provider` must be integrated and per-user AAP tokens must flow from `rhAapAuthApiRef.getAccessToken()`.

2. **Pagination** -- `ControllerClient.getJobEvents()` and `getRunnerOkEvents()` now use `fetchAllPages()`, but `listInventories()` and `listExecutionEnvironments()` still use `page_size=200` and consume only the first page. For customers with 200+ inventories, results will be incomplete.

3. **Rule coverage** -- 20 rules is a proof of concept. A tech preview needs at least 80-100 rules covering the major STIG categories (Access Control, Audit, Configuration Management, System Protection). This is data authoring work -- the framework is ready.

4. **Dynamic plugin packaging** -- The plugin must be packaged as a dist-dynamic plugin to work with RHDH's dynamic plugin loading. This requires adding wrapper packages and build targets following the `ansible-rhdh-plugins/dynamic-plugins/` pattern.

5. **Data retention and cleanup** -- No mechanism to age out old scan data. A customer running daily scans on 1000 hosts would accumulate ~366,000 finding rows per scan. Without cleanup, the SQLite (or PostgreSQL) database would grow without bound.

**G4. Technical debt**

1. **`FALLBACK_INVENTORIES` dead code** in ScanLauncher.tsx (identified in previous review, not yet removed).
2. **Hardcoded `'rhel9-stig'` profile ID** in RemediationProfileBuilder.tsx line 700 -- should use the actual profile ID from context.
3. **No OpenAPI validation middleware** -- The `api/openapi.yaml` spec exists but is not enforced at runtime (no express-openapi-validator or similar).
4. **`loadRulesMetadata()` uses a fragile relative path** (5 levels of `..` from `__dirname`) to find the collections directory. This would break if the backend plugin's build output structure changes.
5. **MockDataProvider is stateful** -- `saveRemediationProfile()` and `deleteRemediationProfile()` mutate module-level arrays. This works because Backstage backend runs in a single process, but it would break in a serverless or multi-instance deployment.

---

## 4. Shipping Readiness Punch List

### Must-Have for Stakeholder Demo (1-2 days)

- [ ] Run a full scan on the lab and verify dashboard populates with real data
- [ ] Fix "0 rules" display on compliance profiles (pre-populate or change enrichment logic)
- [ ] Create a demo seed script that populates the database with representative STIG findings
- [ ] Remove `FALLBACK_INVENTORIES` dead code
- [ ] Fix hardcoded `'rhel9-stig'` in RemediationProfileBuilder

### Must-Have for Tech Preview (2-4 weeks)

- [ ] Integrate `auth-backend-module-rhaap-provider` and wire per-user AAP tokens
- [ ] Add dist-dynamic plugin packaging
- [ ] Author 80+ additional STIG rules in the rules YAML
- [ ] Add pagination for inventory and EE listings
- [ ] Add data retention policy (configurable scan data TTL)
- [ ] Move EE profile from `meta/ee_profile.yml` to `ee/execution-environment.yml` per developer guide
- [ ] Add `extensions/patterns/` metadata for collection auto-discovery
- [ ] Source scap-security-guide from RHEL AppStream (not CentOS mirror) in EE build
- [ ] Add test coverage measurement and establish 80% branch coverage target
- [ ] Resolve collection namespace ownership (`security` -> `redhat` or `ansible`)

### Nice-to-Have for Tech Preview

- [ ] CKL export for STIG Viewer
- [ ] ARF generation for XCCDF results
- [ ] OpenAPI validation middleware
- [ ] Demo/seed data mode for trade shows
- [ ] Grafana dashboard integration for compliance trending

---

## 5. Recommendations (Prioritized)

### P0 -- Critical (Do Before Any External Demonstration)

1. **Rotate the AAP API tokens** in the local `.env` files. While they are not git-tracked, they appear in Claude conversation history and should be considered compromised. Generate new tokens on both the homelab and netrunner environments.

### P1 -- High Priority (Do Before Tech Preview)

2. **Wire the auth module.** The `x-aap-token` header flow is already plumbed through the entire backend. The missing piece is `rhAapAuthApiRef.getAccessToken()` in the frontend. This is the single most important gap for production readiness.

3. **Author more rules.** The 20-rule set proves the framework but is not credible for compliance buyers. Target the top 100 rules from the DISA RHEL 9 STIG V2R8 (prioritize CAT I and CAT II). Consider scripting the rule YAML generation from the scap-security-guide data stream.

4. **Package as dist-dynamic plugin.** Follow the `ansible-rhdh-plugins/dynamic-plugins/` pattern. This is required for RHDH deployment.

### P2 -- Medium Priority (Do Before GA)

5. **Add CFF runtime validation.** A JSON Schema validator in the normalize playbook stage would catch malformed scanner output before it enters the pipeline.

6. **Implement data retention.** Add a scheduled cleanup that removes scan findings older than a configurable TTL (default 90 days).

7. **Add E2E tests.** A Playwright or Cypress test that exercises the scan -> poll -> results -> remediation flow would catch regressions that unit tests miss.

8. **Stabilize the rules path.** Replace the fragile 5-level `..` relative path in `loadRulesMetadata()` with a configuration value or environment variable pointing to the collections directory.

### P3 -- Lower Priority (Future Improvement)

9. **Add CKL and ARF export** for auditor handoff. This is expected by compliance professionals.

10. **Build the Tier 2 adapter pattern.** A Tenable or Qualys adapter would validate the CFF abstraction with a real commercial scanner.

11. **Add Backstage Software Template** for one-click compliance profile setup (the developer guide specifies this but it is not implemented).

12. **Consider OpenAPI enforcement middleware** (`express-openapi-validator`) to guarantee the REST API matches the published spec.

---

## Appendix: Files Reviewed

### Plugin Source (examined in full)

- `plugins/compliance-backend/src/service/ControllerClient.ts` (376 lines)
- `plugins/compliance-backend/src/service/ComplianceService.ts` (1107 lines)
- `plugins/compliance-backend/src/router.ts` (570 lines)
- `plugins/compliance-backend/src/plugin.ts` (108 lines)
- `plugins/compliance-backend/src/database/ComplianceDatabase.ts` (384 lines)
- `plugins/compliance-backend/src/database/migrations/20260429_001_initial.ts` (88 lines)
- `plugins/compliance-backend/src/database/migrations/20260429_002_cartridge_registry.ts` (32 lines)
- `plugins/compliance-common/src/types/api.ts` (230 lines)
- `plugins/compliance-common/src/types/findings.ts` (44 lines)
- `plugins/compliance-common/src/types/profiles.ts` (33 lines)
- `plugins/compliance/src/plugin.ts` (35 lines)
- `plugins/compliance/src/api/complianceApiRef.ts` (59 lines)
- `plugins/compliance/src/api/ComplianceBackendClient.ts` (242 lines)
- `plugins/compliance/src/components/ComplianceRouter.tsx` (139 lines)
- `plugins/compliance/src/components/ComplianceDashboard/ComplianceDashboard.tsx` (418 lines)
- `plugins/compliance/src/components/RemediationProfileBuilder/RemediationProfileBuilder.tsx` (807 lines)

### Collection Source (examined in full)

- `collections/ansible_collections/security/compliance_rhel9_stig/galaxy.yml`
- `collections/ansible_collections/security/compliance_rhel9_stig/meta/ee_profile.yml`
- `collections/ansible_collections/security/compliance_rhel9_stig/plugins/modules/compliance_gather.py` (395 lines)
- `collections/ansible_collections/security/compliance_rhel9_stig/plugins/modules/compliance_evaluate.py` (349 lines)
- `collections/ansible_collections/security/compliance_rhel9_stig/plugins/modules/normalize_xccdf.py` (277 lines)
- `collections/ansible_collections/security/compliance_rhel9_stig/rules/stig_rhel9_v2r8.yml` (310 lines)

### Documentation (examined in full)

- `docs/compliance-profile-developer-guide.md` (~1150 lines)
- `docs/modules/con-about-compliance-pipelines.adoc`
- `docs/modules/proc-run-compliance-scan.adoc`
- `docs/modules/ref-compliance-pipeline-configuration.adoc`
- `docs/modules/proc-configure-compliance-pipeline.adoc`
- `docs/modules/ref-compliance-pipeline-resources.adoc`

### Reference Materials (examined)

- `ansible-rhdh-plugins/ansible-backstage-plugins/` (plugin structure and patterns)
- Google Drive: Plan doc, Cartridge Architecture doc
- Memory files: decisions, remediation architecture, host-level UX, pipelines overview
- Previous review: `review/architect-review-2026-05-19.md`
