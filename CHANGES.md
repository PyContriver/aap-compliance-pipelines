# What we had to change

Changes required to align the AAP Compliance Dashboard plugin with the
Portal Plugin Factory ADR requirements and RHDH dynamic plugin conventions.

Branch: `deployable-plugin` (2 commits, 26 files changed excluding lockfile)

---

## 1. CLI tooling migration

| Before | After |
|--------|-------|
| `@janus-idp/cli` (devDependency) | `@red-hat-developer-hub/cli` (rhdh-cli) |
| `npx janus-cli package export-dynamic-plugin` | `npx rhdh-cli plugin export` |

**Files changed:**
- `backstage-app/package.json` — swapped devDependency
- `backstage-app/plugins/compliance/package.json` — updated `export-dynamic` script
- `backstage-app/plugins/compliance-backend/package.json` — updated `export-dynamic` script, added `--no-install` (workspace dep `@aap-compliance/common` not on npm), added `configSchema` field

## 2. Plugin manifest rename

| Before | After |
|--------|-------|
| `app-config.janus-idp.yaml` | `app-config.rhdh.yaml` |

Both the frontend and backend plugin directories had their manifest files renamed.
Content updated to use dot-separated Scalprum package names (see below).

## 3. Scalprum package naming (dot-separated)

`rhdh-cli plugin export` generates dot-separated names in `plugin-manifest.json`
(e.g. `aap-compliance.plugin-compliance`). The `dynamicPlugins.frontend` and
`dynamicPlugins.backend` keys in config must match these generated names.

This reverses a fix from the May 2026 architect review which switched to
hyphen-separated names. That fix was correct for `@janus-idp/cli`, but the
migration to `rhdh-cli` (section 1) changed the generated format. Dot-separated
is the correct format for `rhdh-cli` v1.10+.

| Before (hyphenated, @janus-idp/cli) | After (dot-separated, rhdh-cli) |
|--------------------------------------|---------------------------------|
| `aap-compliance-plugin-compliance` | `aap-compliance.plugin-compliance` |
| `aap-compliance-plugin-compliance-backend` | `aap-compliance.plugin-compliance-backend` |

Updated in both `app-config.rhdh.yaml` files and `docs/deployment-guide.md`.
Migration notes added for existing deployments.

## 4. Config namespace migration (Plugin Factory requirement)

All plugin configuration moved from a top-level `compliance.*` namespace to
`ansible.compliance.*`, following the Portal Plugin Factory convention that
every Ansible portal plugin lives under `ansible.<pluginId>.*`.

| Before | After |
|--------|-------|
| `compliance.dataSource` | `ansible.compliance.dataSource` |
| `compliance.authMode` | `ansible.compliance.authMode` |
| `compliance.retentionDays` | `ansible.compliance.retentionDays` |
| *(none)* | `ansible.compliance.enabled` (new, required) |

**Backend code:**
- `plugins/compliance-backend/src/plugin.ts` — all `config.getOptional*()` calls updated
- `plugins/compliance-backend/src/service/ComplianceService.ts` — dataSource config key updated
- `plugins/compliance-backend/src/service/ComplianceService.test.ts` — mock config updated

**App config:**
- `backstage-app/app-config.yaml` — `compliance:` block moved under `ansible:`

**Plugin manifests:**
- `plugins/compliance-backend/app-config.rhdh.yaml` — pluginConfig uses `ansible.compliance.*`
- `plugins/compliance/app-config.rhdh.yaml` — pluginConfig added with `ansible.compliance.enabled: true`

## 5. Enabled flag and zero-footprint guard (Plugin Factory requirement)

Added `ansible.compliance.enabled` boolean (defaults to `false` when absent).

**Backend** (`plugins/compliance-backend/src/plugin.ts`):
- Checks `ansible.compliance.enabled` at the start of `init()`
- When disabled: logs a message and returns early without registering any routes
- No database migrations, no service instantiation, no auth policies — true zero footprint
- Backstage's default 404 handles requests to unregistered plugin paths

**Frontend** (`plugins/compliance/src/hooks/useComplianceEnabled.ts`):
- New `useComplianceEnabled()` hook reads `ansible.compliance.enabled` via `configApiRef`
- Exported from `plugins/compliance/src/index.ts` for external consumers

**Frontend guard** (`plugins/compliance/src/components/ComplianceRouter.tsx`):
- `ComplianceRouter` calls `useComplianceEnabled()` and returns `null` when disabled

## 6. Config schema with frontend visibility

Created `plugins/compliance-backend/config.d.ts` declaring:

| Key | Visibility | Type |
|-----|-----------|------|
| `ansible.compliance.enabled` | **frontend** | boolean |
| `ansible.compliance.dataSource` | backend | string |
| `ansible.compliance.authMode` | backend | string |
| `ansible.compliance.retentionDays` | backend | number |

Without this schema, RHDH's config filtering hides all keys from the frontend
by default. The `enabled` flag must be `visibility: frontend` so the
`useComplianceEnabled()` hook can read it via `configApiRef`.

Registered in `package.json` via `"configSchema": "config.d.ts"`.

## 7. Preview chip (Plugin Factory requirement)

Added a "Preview" chip to the Compliance page header, visible on the subtitle
line next to "Scan, review, and remediate infrastructure compliance".

Per Plugin Factory requirements, factory plugins that are not yet product-supported display a
Preview label on primary surfaces. The chip is rendered as a Material UI
`<Chip>` component and should be removed when the plugin graduates to GA.

**File:** `plugins/compliance/src/components/ComplianceRouter.tsx`

## 8. Documentation updates

Every file referencing the old `compliance.*` config keys or `janus-idp` CLI
was updated to reflect the new conventions:

- `README.md` — config table, YAML examples, troubleshooting
- `CONTRIBUTING.md` — auth mode section and YAML example
- `CLAUDE.md` — CLI and manifest references
- `docs/deployment-guide.md` — config table, auth mode section, YAML examples, Scalprum names
- `docs/handover-guide.md` — auth mode reference
- `docs/netrunner-portal-deployment.md` — YAML config example
- `docs/modules/ref-compliance-pipeline-configuration.adoc` — AsciiDoc config table
- `specs/compliance-pipelines/decisions/ADR-002-two-tier-rbac.md` — config references
- `specs/compliance-pipelines/features/history/feature-two-tier-rbac.md` — config reference
- `specs/compliance-pipelines/features/history/feature-portal-deployment.md` — manifest filename
- `specs/compliance-pipelines/plan.md` — CLI reference
- `.github/workflows/ci.yml` — comment updated

Historical review files (`review/*.md`) were left untouched.

---

## Verification

| Check | Result |
|-------|--------|
| `yarn tsc --noEmit` | Pass |
| Backend tests (366) | All pass |
| Frontend tests (626) | 625 pass, 1 pre-existing flake (ProfileSettings) |
| RHDH 1.10 deployment (rhdh-local) | Backend health OK, frontend renders, Preview chip visible |
| `enabled: true` → plugin renders | Verified |
| `enabled: false` / absent → 404 + blank | Verified (zero footprint) |
| Scalprum chunk loading | `aap-compliance.plugin-compliance` chunks served (304) |

## Not changed

- **Common library subpath imports**: `@aap-compliance/common` only exports types
  and one const — no backend-only modules. Barrel imports are safe for Rspack.
  Subpath migration would touch ~50 imports for no functional benefit.
- **Historical review files**: `review/architect-review-*.md` left as-is since
  they are point-in-time records.
