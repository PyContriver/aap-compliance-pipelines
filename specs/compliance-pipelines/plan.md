# Implementation Plan: Compliance Pipelines

**Branch**: `compliance-pipelines` | **Date**: 2026-04-23 (updated 2026-06-18) | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/compliance-pipelines/spec.md`
**Research**: [Competitor Analysis](../../prototypes/compliance-pipelines/context/competitor-analysis.md), [Content Delivery Strategy](../../prototypes/compliance-pipelines/context/content-delivery-strategy.md), [Ansible Content Ecosystem](../../prototypes/compliance-pipelines/context/ansible-content-ecosystem.md)

## Summary

Regulated enterprises managing DISA STIG and CIS compliance with Ansible Automation Platform today must manually source ComplianceAsCode content, build scan/remediate workflows, parse XCCDF results, and manage remediation decisions — with no integrated portal experience. This feature delivers an end-to-end compliance pipeline within the Ansible Portal that enables administrators to add compliance profiles (EE + workflow mappings), launch scans, review host-level findings, build selective remediations, execute remediation, and verify results — all without leaving the portal or requiring Controller expertise.

**Technical Approach**: The compliance plugin operates as a scanner orchestrator, not a scanner. It invokes AAP job templates via the Gateway API, receives normalized findings, and stores them in Backstage PostgreSQL. A remediation builder translates user decisions into `--limit`, `--tags`, and `--extra-vars` parameters for the remediation job template. ComplianceAsCode's `rhel9-playbook-stig.yml` (55K+ lines, 4400+ tasks) from the `scap-security-guide` RPM IS the remediation engine -- we consume it, not author it.

**Key Architecture Decisions**:

1. Scanner orchestrator, not scanner — our value is UX, orchestration, and the remediation builder
2. Compliance profile model — pluggable scanner registration (Tier 1: OpenSCAP/PowerSTIG, Tier 2: BYOS Qualys/Tenable, Tier 3: hybrid)
3. CaC content consumption — selective remediation via Ansible `--tags` + `--extra-vars` + `--limit`
4. Single assessment JT (run_oscap.yml with 2 plays: scan + normalize in one container), direct remediation JT with job_tags — changed from multi-node workflow because AAP workflow nodes run in separate containers (see ADR-003, ADR-009)
5. All API calls through Gateway — no direct Controller access (aligns with AAP 2.7+ architecture)
6. JT/WJT transparent handling — scan launch, status polling, progress tracking, and event parsing all work with both Job Templates and Workflow Job Templates. The system detects the template type and adapts API calls accordingly (JT fallback pattern)

## Technical Context

**Language/Version**: TypeScript 5.8, Node.js 20/22
**Primary Dependencies**: Backstage 0.33.1, Knex.js (migrations/queries), @backstage/backend-plugin-api, Material-UI v4 / PatternFly 6
**Storage**: PostgreSQL (production), SQLite (local dev) for compliance tables (compliance profiles, scans, findings, remediations, posture)
**Testing**: Jest (unit), Playwright (E2E), supertest (API contract)
**Target Platform**: Ansible Portal (RHDH) on RHEL 9+ or OpenShift 4.14+, local dev (yarn start)
**Project Type**: Backstage plugin suite (1 frontend plugin, 1 backend plugin, 1 common package)
**Performance Goals**: Scan launch <5 seconds, findings parse <10 seconds per scan, profile builder renders 300 rules <3 seconds, dashboard loads <2 seconds for 1000 scan records
**Constraints**: All AAP API calls via Gateway URL, per-user tokens via `x-aap-token`, no direct Controller access, no custom Backstage permissions (reuse catalog entity permissions)
**Scale/Scope**: Supports 20,000+ hosts per scan via dynamic host grouping, 300+ rules per profile, 1000+ historical scans

## High-Level Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (plugins/compliance)                                      │
│  ├─ ComplianceDashboard/ - Posture overview, scan history           │
│  ├─ ProfileBrowser/ - Browse registered compliance profiles           │
│  ├─ ScanLauncher/ - Configure and launch scans                      │
│  ├─ FindingsViewer/ - Host-level findings with severity grouping    │
│  ├─ ProfileBuilder/ - Selective rule toggles, parameter overrides   │
│  ├─ ProfileManager/ - Save, load, apply remediations                │
│  ├─ ComplianceSettings/ - Admin compliance profile registration     │
│  └─ ExportDialog/ - CSV/JSON export configuration                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTPS (via Backstage discoveryApi)
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (plugins/compliance-backend)                                │
│  ├─ REST API Router - Express routes                                │
│  │   ├─ POST /compliance-profiles - Add compliance profile                   │
│  │   ├─ GET  /compliance-profiles - List compliance profiles                 │
│  │   ├─ POST /scans - Launch scan                                   │
│  │   ├─ GET  /scans/:id/findings - Get findings                     │
│  │   ├─ POST /profiles - Save remediation                           │
│  │   ├─ POST /remediate - Execute remediation                       │
│  │   └─ GET  /posture - Dashboard data                              │
│  ├─ ComplianceProfileService - Compliance profile CRUD + validation │
│  ├─ ScanService - Workflow invocation + result parsing              │
│  ├─ FindingsService - Finding storage + query                       │
│  ├─ ProfileService - Profile CRUD + application logic               │
│  ├─ RemediationService - Remediation → workflow params translation  │
│  ├─ PostureService - Compliance trend aggregation                   │
│  ├─ ExportService - CSV/JSON generation                             │
│  └─ AapGatewayClient - AAP Gateway API wrapper                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────┐
│  AAP Gateway API                              │
│  ├─ /api/controller/v2/workflow_job_templates/│
│  ├─ /api/controller/v2/workflow_jobs/         │
│  ├─ /api/controller/v2/execution_environments/│
│  ├─ /api/controller/v2/inventories/           │
│  └─ /api/controller/v2/job_templates/         │
└──────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────┐
│  AAP Controller + Execution Nodes             │
│  ├─ Assessment JT: compliance-run-oscap       │
│  │   ├─ Play 1: OpenSCAP scan (targets)       │
│  │   └─ Play 2: Normalize (localhost)         │
│  ├─ Remediation JT: compliance-remediate      │
│  │   └─ CaC playbook (job_tags scoped)        │
│  └─ EE: compliance-stig-rhel9 (OpenSCAP +    │
│          scap-security-guide RPM)             │
└──────────────────────────────────────────────┘
```

### Data Flow: Scan → Findings → Remediation

```
Admin clicks           Portal backend          AAP Gateway          Execution Nodes
"Launch Scan"          invokes assessment JT   dispatches job       run OpenSCAP
     │                      │                       │                     │
     ├──── POST /scans ────►│                       │                     │
     │                      ├── POST JT launch ────►│                     │
     │                      │                       ├── Play 1: scan ────►│
     │                      │                       │   Play 2: normalize │
     │                      │◄── poll job status ───┤                     │
     │                      │                       │                     │
     │                      │  Receive CFF findings │                     │
     │                      │  Store findings in DB  │                     │
     │◄── findings ready ──┤                       │                     │
     │                      │                       │                     │
Admin builds            Portal translates       AAP dispatches       Hosts remediated
remediation             remediation → params    remediate JT         via CaC playbook
     │                      │                       │                     │
     ├── POST /remediate ──►│                       │                     │
     │                      ├── POST JT launch ────►│                     │
     │                      │   --limit=host-2,3    ├── remediate JT ───►│
     │                      │   --tags=rule_1,2     │                     │
     │                      │   --extra-vars={...}  │                     │
     │                      │                       │                     │
     │                      │  Auto re-scan         │                     │
     │                      ├── POST JT launch ────►│                     │
     │◄── before/after ────┤                       │                     │
```

### Two-Track Scanning Architecture

```
Track A: Fast Pre-Assessment (~17 min for 20K hosts)
┌──────────────────────────────────────────────┐
│ Custom Ansible modules for quick checks       │
│ - File content checks (grep-based)            │
│ - Service state checks (systemctl)            │
│ - Configuration value extraction              │
│ Purpose: Rapid triage, identify likely fails  │
│ NOT audit-grade, NOT sufficient for auditors  │
└──────────────────────────────────────────────┘

Track B: Audit-Grade Scanning (full OpenSCAP)
┌──────────────────────────────────────────────┐
│ OpenSCAP + scap-security-guide on each host   │
│ - Full XCCDF evaluation                       │
│ - Machine-readable results (XML/JSON)         │
│ - Auditor-accepted output                     │
│ Purpose: Compliance evidence for auditors     │
└──────────────────────────────────────────────┘
```

### Compliance Profile Model

```
┌─────────────────────────────────────┐
│ Compliance Profile                   │
│                                     │
│ display_name: "RHEL 9 DISA STIG"   │
│ standard_id:  "rhel9-stig-v2r8"    │
│                                     │
│ ┌─────────────┐  ┌───────────────┐ │
│ │ EE Reference │  │ Workflow Ref  │ │
│ │ id: 4        │  │ id: 20        │ │
│ │ name: ...    │  │ name: ...     │ │
│ └─────────────┘  └───────────────┘ │
│                                     │
│ Scanner Tier: 1 (built-in)         │
│ Status: active                      │
└─────────────────────────────────────┘

Tier 1: Built-in (OpenSCAP, PowerSTIG)
  → EE includes scanner + content
  → Fully supported, ships with compliance profile collection

Tier 2: BYOS (Qualys, Tenable, Rapid7)
  → Customer provides scanner license + credentials
  → Compliance profile provides workflow orchestration + result parsing

Tier 3: Hybrid (one tool, many domains)
  → Single scanner covers multiple compliance standards
  → Compliance profile maps scanner outputs to domain-specific findings
```

## Project Structure

### Documentation (this feature)

```text
specs/compliance-pipelines/
├── spec.md                  # Feature specification
├── plan.md                  # This file (implementation plan)
├── checklists/
│   └── requirements.md      # Spec quality validation checklist
```

### Source Code (Backstage plugins)

```text
# Frontend plugin
plugins/compliance/
├── package.json              # role: "frontend-plugin", pluginId: "compliance"
├── src/
│   ├── index.ts              # Public exports
│   ├── plugin.ts             # createPlugin('compliance')
│   ├── routes.ts             # Route references
│   ├── components/
│   │   ├── ComplianceDashboard/
│   │   │   ├── ComplianceDashboard.tsx    # Main dashboard page
│   │   │   ├── PostureSummary.tsx         # Pass/fail/trend cards
│   │   │   ├── ScanHistory.tsx            # Recent scan list
│   │   │   └── ActiveScans.tsx            # In-progress scans
│   │   ├── ProfileBrowser/
│   │   │   ├── ProfileBrowser.tsx         # Compliance profile selection grid
│   │   │   └── CartridgeCard.tsx          # Individual compliance profile card
│   │   ├── ScanLauncher/
│   │   │   ├── ScanLauncher.tsx           # Scan configuration form (compliance profile selection, inventory, launch)
│   │   │   └── ScanProgress.tsx           # Real-time progress view
│   │   ├── FindingsViewer/
│   │   │   ├── FindingsViewer.tsx         # Main findings page
│   │   │   ├── FindingsSummary.tsx        # Severity category counts
│   │   │   ├── FindingsTable.tsx          # Rule list with host counts
│   │   │   ├── HostDetailPanel.tsx        # Per-host actual values
│   │   │   └── HomogeneityAdvisory.tsx    # Outlier host warning
│   │   ├── ProfileBuilder/
│   │   │   ├── ProfileBuilder.tsx         # Main profile builder page
│   │   │   ├── RuleToggleList.tsx         # Rule include/exclude toggles
│   │   │   ├── RuleDetail.tsx             # Scope + parameter override
│   │   │   ├── ExecutionPreview.tsx        # Rule x host matrix preview
│   │   │   └── SaveProfileDialog.tsx      # Name/description/tags form
│   │   ├── ProfileManager/
│   │   │   ├── ProfileManager.tsx         # Saved profiles list
│   │   │   └── ApplyProfileDialog.tsx     # Apply to new findings
│   │   ├── ComplianceSettings/
│   │   │   ├── ProfileSettings.tsx      # Admin compliance profile list
│   │   │   └── ProfileForm.tsx          # Add/edit compliance profile form
│   │   └── ExportDialog/
│   │       └── ExportDialog.tsx           # Format + scope selection
│   ├── hooks/
│   │   ├── useComplianceApi.ts            # Backend API client hook
│   │   ├── useScanProgress.ts             # Polling hook for scan status
│   │   └── usePostureData.ts              # Dashboard data hook
│   └── api/
│       └── ComplianceClient.ts            # REST API client

# Backend plugin
plugins/compliance-backend/
├── package.json              # role: "backend-plugin", pluginId: "compliance"
├── src/
│   ├── index.ts              # Public exports
│   ├── plugin.ts             # createBackendPlugin('compliance')
│   ├── router.ts             # Slim orchestrator (~80 lines), delegates to routes/
│   ├── routes/               # Decomposed route modules (ADR-021)
│   │   ├── types.ts          # RouterDependencies, SharedState interfaces
│   │   ├── validation.ts     # Input validation predicates
│   │   ├── permissions.ts    # Auth helpers (getUserAapToken, requirePermission, extractUserIdentity)
│   │   ├── helpers.ts        # Shared helpers (resolveScanId, savePostureFromFindings, fetchLiveFindings)
│   │   ├── health.ts         # Health, settings, cleanup
│   │   ├── scans.ts          # Scan history, launch, stats, N/A, backfill
│   │   ├── findings.ts       # Get findings, previous findings, ingest (rate-limited)
│   │   ├── remediation.ts    # Launch, executions, profiles, reconciliation
│   │   ├── baseline.ts       # Baseline targets and scores
│   │   ├── dashboard.ts      # Dashboard stats, posture history
│   │   ├── controller.ts     # Controller proxy (status, events, nodes, resource lookups)
│   │   └── profiles.ts       # Compliance profile CRUD
│   ├── database/
│   │   ├── DatabaseHandler.ts             # CRUD operations
│   │   └── migrations/
│   │       └── 20260423_001_init.ts       # All compliance tables
│   ├── service/
│   │   ├── ComplianceService.ts            # Compliance profile CRUD + validation
│   │   ├── ScanService.ts                 # Workflow invocation + parsing
│   │   ├── FindingsService.ts             # Finding storage + query
│   │   ├── ProfileService.ts              # Profile CRUD + application
│   │   ├── RemediationService.ts          # Remediation → workflow params
│   │   ├── PostureService.ts              # Trend aggregation
│   │   └── ExportService.ts               # CSV/JSON generation
│   ├── gateway/
│   │   └── AapGatewayClient.ts            # AAP Gateway API wrapper
│   └── parsers/
│       ├── xccdf.ts                       # XCCDF XML → findings
│       └── json.ts                        # JSON results → findings
└── tests/

# Common package
plugins/compliance-common/
├── package.json              # role: "common-library"
├── src/
│   ├── index.ts              # Public exports
│   └── types.ts              # Shared types (Cartridge, Scan, Finding, etc.)
```

## Database Schema

```sql
-- Compliance profile registry
CREATE TABLE compliance_cartridges (
  id TEXT PRIMARY KEY,                    -- UUID
  display_name TEXT NOT NULL,
  standard_id TEXT NOT NULL,             -- e.g., 'rhel9-stig-v2r8'
  ee_id INTEGER NOT NULL,               -- AAP EE ID
  ee_name TEXT NOT NULL,
  workflow_template_id INTEGER NOT NULL, -- AAP workflow template ID
  workflow_template_name TEXT NOT NULL,
  scanner_tier INTEGER NOT NULL DEFAULT 1,  -- 1=built-in, 2=BYOS, 3=hybrid
  status TEXT NOT NULL DEFAULT 'active', -- active, ee-unavailable, workflow-unavailable
  config_json TEXT,                      -- Additional scanner-specific config
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Compliance scan records
CREATE TABLE compliance_scans (
  id TEXT PRIMARY KEY,                    -- UUID
  cartridge_id TEXT NOT NULL REFERENCES compliance_cartridges(id),
  target_inventory TEXT NOT NULL,         -- Inventory name or host pattern
  trigger_source TEXT NOT NULL DEFAULT 'manual', -- manual, event-driven
  aap_workflow_job_id INTEGER,           -- AAP workflow job ID
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, completed-with-warnings
  scan_params_json TEXT,                 -- Extra variables passed to workflow
  host_count INTEGER,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_scans_cartridge ON compliance_scans(cartridge_id);
CREATE INDEX idx_scans_status ON compliance_scans(status);

-- Per-host, per-rule findings
CREATE TABLE compliance_findings (
  id TEXT PRIMARY KEY,                    -- UUID
  scan_id TEXT NOT NULL REFERENCES compliance_scans(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,                 -- STIG rule ID (e.g., 'xccdf_org.ssgproject...')
  rule_title TEXT NOT NULL,
  rule_description TEXT,
  severity TEXT NOT NULL,                -- CAT_I, CAT_II, CAT_III
  hostname TEXT NOT NULL,
  compliance_status TEXT NOT NULL,       -- pass, fail, error, not-applicable, unreachable
  actual_value TEXT,                     -- Observed value on host
  expected_value TEXT,                   -- Benchmark expected value
  check_type TEXT,                       -- openscap, custom, byos
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_findings_scan ON compliance_findings(scan_id);
CREATE INDEX idx_findings_rule ON compliance_findings(rule_id);
CREATE INDEX idx_findings_host ON compliance_findings(hostname);
CREATE INDEX idx_findings_severity ON compliance_findings(severity);

-- Saved remediations
CREATE TABLE compliance_profiles (
  id TEXT PRIMARY KEY,                    -- UUID
  profile_name TEXT NOT NULL,
  description TEXT,
  tags TEXT,                             -- Comma-separated tags
  standard_id TEXT NOT NULL,             -- Compliance standard this profile targets
  rules_json TEXT NOT NULL,              -- JSON: per-rule selections, overrides, justifications
  created_by TEXT,                       -- User identity
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Compliance posture snapshots for dashboard/trends
CREATE TABLE compliance_posture (
  id TEXT PRIMARY KEY,                    -- UUID
  scan_id TEXT NOT NULL REFERENCES compliance_scans(id) ON DELETE CASCADE,
  cartridge_id TEXT NOT NULL REFERENCES compliance_cartridges(id),
  total_rules INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  not_applicable INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  host_count INTEGER NOT NULL,
  compliance_pct REAL NOT NULL,          -- (passed / (passed + failed)) * 100
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_posture_cartridge ON compliance_posture(cartridge_id);
CREATE INDEX idx_posture_created ON compliance_posture(created_at);
```

## API Design

### Compliance Profile Management

```
POST /api/compliance/compliance-profiles          # Add compliance profile
  { displayName, standardId, eeId, workflowTemplateId, scannerTier?, config? }
  → { id, displayName, standardId, eeId, eeName, workflowTemplateId, workflowTemplateName, status }

GET  /api/compliance/compliance-profiles          # List compliance profiles
  → [{ id, displayName, standardId, eeName, workflowTemplateName, status, createdAt }]

GET  /api/compliance/compliance-profiles/:id      # Get compliance profile details
  → { id, displayName, standardId, eeId, eeName, workflowTemplateId, workflowTemplateName, scannerTier, status, config, createdAt, updatedAt }

PUT  /api/compliance/compliance-profiles/:id      # Update compliance profile
  { displayName?, eeId?, workflowTemplateId?, config? }
  → { id, ...updated fields }

DELETE /api/compliance/compliance-profiles/:id    # Delete compliance profile
  → { success: true }
```

### Scan Operations

```
POST /api/compliance/scans
  { cartridgeId, targetInventory, scanParams? }    # cartridgeId = compliance profile ID
  → { id, cartridgeId, targetInventory, aapWorkflowJobId, status: "pending" }

GET  /api/compliance/scans
  ?status=completed&cartridgeId=<id>&limit=20&offset=0    # cartridgeId = compliance profile ID
  → { items: [{ id, cartridgeId, targetInventory, triggerSource, status, hostCount, startedAt, completedAt }], total }

GET  /api/compliance/scans/:id
  → { id, cartridgeId, targetInventory, triggerSource, aapWorkflowJobId, status, scanParams, hostCount, startedAt, completedAt }

GET  /api/compliance/scans/:id/status
  → { status, progress?, aapJobStatus?, message? }
```

### Findings

```
GET  /api/compliance/scans/:id/findings
  ?severity=CAT_I&status=fail&ruleId=<id>&hostname=<host>&limit=50&offset=0
  → { items: [{ id, ruleId, ruleTitle, severity, hostname, complianceStatus, actualValue, expectedValue }], total, summary: { passed, failed, error, notApplicable } }

GET  /api/compliance/scans/:id/findings/summary
  → { bySeverity: { CAT_I: { passed, failed }, CAT_II: {...}, CAT_III: {...} }, byHost: [{ hostname, passed, failed }], totalRules, totalHosts }

GET  /api/compliance/scans/:id/findings/export
  ?format=csv|json&scope=all|filtered&severity=CAT_I,CAT_II
  → Binary file download (CSV or JSON)
```

### Remediations

```
POST /api/compliance/profiles
  { profileName, description?, tags?, standardId, rules: [{ ruleId, included, scope, parameterOverride?, justification? }] }
  → { id, profileName, standardId, createdAt }

GET  /api/compliance/profiles
  ?standardId=<id>&limit=20&offset=0
  → { items: [{ id, profileName, standardId, description, tags, lastUsedAt, createdAt }], total }

GET  /api/compliance/profiles/:id
  → { id, profileName, description, tags, standardId, rules, createdBy, lastUsedAt, createdAt }

PUT  /api/compliance/profiles/:id
  { profileName?, description?, tags?, rules? }
  → { id, ...updated fields }

DELETE /api/compliance/profiles/:id
  → { success: true }

POST /api/compliance/profiles/:id/apply
  { scanId }
  → { rules: [{ ruleId, included, scope, parameterOverride, justification, status: "matched"|"unreviewed"|"not-applicable" }] }
```

### Remediation Execution

```
POST /api/compliance/remediate
  { scanId, profileId?, rules: [{ ruleId, scope, parameterOverride?, targetHosts? }] }
  → { remediationId, aapWorkflowJobId, status: "pending", hostCount, ruleCount }

GET  /api/compliance/remediate/:id/status
  → { status, progress?, aapJobStatus?, verificationScanId? }

GET  /api/compliance/remediate/:id/comparison
  → { before: { passed, failed, compliance_pct }, after: { passed, failed, compliance_pct }, resolvedFindings: [...], persistingFindings: [...] }
```

### Dashboard / Posture

```
GET  /api/compliance/posture
  ?cartridgeId=<id>&from=<date>&to=<date>    # cartridgeId = compliance profile ID
  → { current: { compliancePct, passed, failed, lastScanAt }, trend: [{ date, compliancePct, hostCount }], recentScans: [...] }
```

**API Characteristics**:

- All endpoints require authentication via Backstage identity + `x-aap-token` header for AAP operations
- Pagination via `limit` + `offset` query parameters
- Findings export is streamed for large result sets
- Secrets (AAP tokens) are never stored in the compliance database — they are passed per-request via headers
- Error responses follow standard Backstage error format: `{ error: { name, message, statusCode } }`

## Dependencies

### Hard Dependencies

| Dependency | What It Provides | Status |
|---|---|---|
| **AAP Controller 2.6+** | Workflow templates, job execution, EE management, inventory | Available (lab validated) |
| **AAP Gateway** | Unified API entry point, OAuth2 authentication | Available in AAP 2.6+ |
| **Backstage / RHDH** | Frontend hosting, backend plugin framework, PostgreSQL, auth | Available |
| **scap-security-guide RPM** | ComplianceAsCode content (STIG/CIS profiles, remediation playbooks) | Available in RHEL repos |
| **OpenSCAP** | Tier 1 scanner for XCCDF evaluation | Available in RHEL repos |

### Soft Dependencies (enhance but don't block)

| Dependency | What It Provides | Status |
|---|---|---|
| **EE Builder / Pattern Loading Service** (ANSTRAT-1285) | Automated EE construction from collection EE profiles | Planned — manual EE build works today |
| **EDA Server** | Event-driven scan triggers | Available but integration is P3 |
| **Content Discovery** (ANSTRAT-1534) | Auto-discovery of compliance profiles via Hub API | Planned — manual registration works today |

## Security Model

### Authentication Flow

```
Browser → Portal Frontend → Portal Backend → AAP Gateway
           (Backstage auth)   (x-aap-token)    (OAuth2)
```

- Frontend authenticates via Backstage identity (AAP OAuth2 PKCE flow)
- Backend receives per-user AAP token via `x-aap-token` request header
- Backend forwards AAP token to Gateway API calls
- No AAP credentials stored in the compliance database
- Gateway handles token validation and RBAC enforcement

### Authorization

- Compliance profile registration: requires admin role (Backstage RBAC)
- Scan launch: requires authenticated user with AAP inventory access
- Findings view: requires authenticated user
- Remediation execution: requires authenticated user with AAP job template execute permission
- Export: requires authenticated user with findings view access

### Data Security

- No secrets stored in compliance tables
- Findings contain hostnames and configuration values — classified as internal data
- Exports strip any accidentally captured sensitive data
- All AAP API calls over HTTPS via Gateway
- Knex parameterized queries — zero raw SQL interpolation

## Implementation Phases

### Phase 1: Content Packaging and Backend Foundation (2 weeks) -- COMPLETE

- [x] Create `compliance-backend` plugin scaffold with Backstage plugin API
- [x] Create `compliance-common` package with shared TypeScript types
- [x] Write Knex database migrations for all compliance tables (5 migrations, including multi-inventory support)
- [x] Implement `DatabaseHandler` with CRUD operations for all entities
- [x] Implement `AapGatewayClient` for AAP Gateway API communication
- [x] Implement `ComplianceService` for compliance profile CRUD with EE/workflow validation via Gateway API
- [x] Implement compliance profile REST API endpoints (`/compliance-profiles`)
- [x] Package compliance Ansible collection with EE profile definition (3 profiles: STIG, CIS L1, CIS L2)
- [x] Unit tests for all services (271 tests across 12 suites)

### Phase 2: Scan and Findings Pipeline (2 weeks) -- COMPLETE

- [x] Implement `ScanService` — JT/WJT transparent invocation via Gateway, job status polling with JT fallback
- [x] Implement XCCDF and JSON result parsers with duplicate finding prevention (`parseInProgress` guard)
- [x] Implement `FindingsService` — per-host, per-rule finding storage and query
- [x] Implement `PostureService` — compliance trend aggregation from findings
- [x] Implement scan and findings REST API endpoints, including Direct POST `/findings/ingest` with per-scan ingest tokens (ADR-010)
- [x] Build frontend `ComplianceDashboard` component (posture summary, scan history, shows all registered profiles with certification badges)
- [x] Build frontend `ScanLauncher` component (compliance profile selection with certification badges, inventory, launch with double-click prevention)
- [x] Build frontend `FindingsViewer` component (severity groups, host detail panels, Rule ID column for framework-neutral display)
- [x] Build `HomogeneityAdvisory` component for outlier host detection
- [x] Integration tests (scan launch → findings storage → dashboard display)
- [x] Error detail stdout fallback for failed scan diagnostics

### Phase 3: Remediation Builder (2 weeks) -- COMPLETE

- [x] Implement `ProfileService` — CRUD for saved remediations
- [x] Implement `RemediationService` — translate remediation decisions to `--limit`, `--tags`, `--extra-vars`
- [x] Implement remediation application logic (match saved remediation to new findings, flag unreviewed rules)
- [x] Build frontend `ProfileBuilder` component (rule toggles, scope selection, parameter overrides)
- [x] Build frontend `ExecutionPreview` component (rule x host matrix)
- [x] Build frontend `ProfileManager` component (save, load, apply remediations)
- [x] Build frontend `ProfileSettings` admin page — redesigned with discovery-first layout, auto-populate with confirmation dialog, fetches both JTs and WJTs
- [x] Implement remediation REST API endpoints
- [x] Implement automatic verification re-scan trigger after remediation
- [x] Build before/after comparison view
- [x] Component tests for all profile builder interactions
- [x] `CertificationBadge` shared component on all surfaces (dashboard, profile browser, scan launcher, findings viewer)

### Phase 4: Export and Polish (1 week) -- COMPLETE

- [x] Implement `ExportService` — CSV and JSON generation with streaming for large datasets
- [x] Build frontend `ExportDialog` component
- [x] Implement export REST API endpoint
- [x] Add scan history pagination and filtering
- [x] Performance optimization for large finding sets (database query tuning, frontend virtualization)
- [x] E2E tests (full workflow: add compliance profile → scan → review → remediate → verify → export)

**Current versions**: Backend v0.13.61, Frontend v0.10.60, 584 tests across 21 suites, 25 ADRs

**P3 Hardening Sprint (2026-06-08)**: Router decomposition (1,599→12 modules), rate limiting on ingest (30 req/min), user identity tracking on executions, N/A type safety + denominator adjustment, dashboard N+1 batch fix, execution reconciliation throttle, inventory chip on results page, clickable comparison stats. See ADR-021.

**Post-hardening completions (2026-06-08 through 2026-06-10)**: Phase 3a cleanup (remediation scan dual-write removed, draft upsert with migration 017, Active/All/Drafts/Archived filter), chain view (ADR-016 Layer 3 — ChainView component, `/chain/:executionId` endpoint, delta calculation, "Verified" badge), baseline feature (API endpoints, pin/unpin dialogs, dual-layer dashboard with standard/baseline toggle), ADR-015 prerequisites (mandatory scan check, authoritative scan resolution, inventory selector with reactive scan validation, cross-profile filtering), test coverage sprint (318→467 tests), P2 quick wins (baseline toggle, verification labels, builder context, scan ID consistency).

**Normalizer fix_text merge (2026-06-16)**: `load_aap_impact_map()` in `profiles/_shared/normalize_common.py` renamed to `load_rules_metadata_map()`. Now reads `fix_text` from rules YAML files (which contain CaC Ansible task YAML) in addition to `aap_impact` fields. The fix_text is merged into findings at scan time, replacing the XCCDF prose fix description with actual Ansible remediation task YAML. This fixes `automationAvailable` detection in `FindingsParser.ts` (the `- name:` heuristic). Root cause: the hardening commit (f05d559) removed `loadRulesMetadata()` from `ComplianceService.ts`, and the DB-only approach lost the Ansible task YAML because the normalizer only extracted XCCDF prose. The fix shifts the merge to scan time in the normalizer. CFF `remediation.available` field should be populated by normalizers for Tier 2 readiness (tracked as P3).

**Inventory view improvements (2026-06-16)**: 5 features added — short profile links (scanTags), chip cluster blocks, view toggle, host findings endpoint, enhanced host drawer with baseline scores/findings list/clickable severity filters. Host filter in ResultsViewer: `?host=X` URL param filters findings, blue pill indicator, host highlighting in expanded rows.

**CI migration (2026-06-16)**: Backstage CI disabled on GitHub Actions. GitLab CEE now owns backstage pipeline (backstage-test → backstage-export → deploy-netrunner). Collection tests also on GitLab (sanity, units, lint, build).

**EE build pipeline + ingest fix (2026-06-18)**: Per-collection EE build pipeline added to GitHub Actions (`build-ee.yml` matrix: STIG, CIS L1, CIS L2, `fail-fast: false`). GitHub Actions retained for EE builds because they require container tooling (docker) which GitLab CEE runners lack. Images pushed to `ghcr.io/cross-logic/compliance-{stig,cis-l1,cis-l2}-rhel9:latest`. Controller EE mappings corrected (CIS L1/L2 were pointing to STIG image). GHCR Container Registry credential created for private package pull. Ingest body limit restored to 50MB (P3 hardening had reduced to 10MB, but fix_text enrichment from ADR-020 made payloads exceed 10MB with 18+ hosts). Metadata upsert guard added to prevent slim Controller event fallback from overwriting full metadata. Pass-rate color thresholds aligned across all views — `hostColor()`, ScanHistory, and ComplianceDashboard now all use `scoreColor()` / `THRESHOLDS` (90/70) instead of ad-hoc inline values.

**Terminology alignment (2026-05-30)**: Renamed all internal "cartridge" references to "compliance profile" — types (`ComplianceProfile`, `SaveProfileRequest`), DB table (`compliance_profile_registry` via migration 008), API routes (`/compliance-profiles`), component directory (`ProfileSettings/`), and 35+ source files. API methods for registered profiles use `getRegisteredProfiles`/`saveRegisteredProfile` to disambiguate from the display profile endpoint (`getProfiles`). Old migrations preserved with historical table name. No external API contract existed — clean rename with zero backwards-compatibility concerns.

### Phase 5: EDA Integration (1 week — stretch goal)

- Design EDA rulebook for infrastructure change events → compliance scan triggers
- Implement event-driven scan launch endpoint (accepts EDA webhook payload)
- Implement cooldown window and event batching logic
- Mark event-driven scans with `trigger_source: 'event-driven'` in scan records
- Test EDA → compliance scan → findings flow end-to-end
- Document EDA rulebook configuration for administrators (compliance profile mapping)

### Phase 6: Documentation and Hardening (3-5 days)

- API documentation (endpoint reference with request/response examples)
- Administrator guide (compliance profile registration, remediation management, EDA setup)
- Dynamic plugin packaging and configuration documentation
- Security review of all AAP token handling paths
- Load testing with simulated 20K host scan results
- Accessibility review of all frontend components

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| **XCCDF parsing complexity**: ComplianceAsCode output format varies between scanner versions | Abstract parser behind interface, version-detect in XCCDF header, maintain parser test fixtures from known scanner versions |
| **AAP Gateway API stability**: Gateway API may change between AAP releases | Isolate all Gateway calls in `AapGatewayClient`, version-detect API paths, maintain integration test suite against Gateway |
| **Large finding sets**: 300 rules x 20K hosts = 6M findings per scan | Database pagination, indexed queries, frontend virtualization via `react-window` `VariableSizeList` (implemented in `VirtualizedFindingsList.tsx` with `ResizeObserver` height caching and memoized `FindingCard` component), async export for large datasets |
| **Workflow parameter translation**: Mapping remediation decisions to `--tags`/`--limit`/`--extra-vars` is complex | Extensive unit tests for `RemediationService`, validate generated parameters against known CaC playbook tag names |
| **EE availability**: Referenced EE may be deleted or unavailable after compliance profile registration | Compliance profile status check on scan launch, clear error messaging, admin notification for unavailable compliance profiles |
| **Concurrent scan conflicts**: Multiple scans targeting same hosts may interfere | AAP handles job isolation natively; portal displays warnings and tracks scans independently |
| **Lab resource constraints**: Prototype lab VM may not support full OpenSCAP scans alongside AAP | Two-track scanning: Track A (fast custom modules) for development, Track B (OpenSCAP) for validation |

## Success Metrics

- Compliance profile registration to first scan: <5 minutes (spec SC-001)
- Host-level finding detail with actual values: verified in all scan results (spec SC-002)
- Remediation builder supports rule toggles + parameter overrides + scope selection (spec SC-003)
- Dynamic host grouping scales to 20K+ hosts (spec SC-004)
- Remediation save/load/apply with unreviewed rule flagging (spec SC-005)
- CSV/JSON export with per-host detail (spec SC-006)
- Auto verification re-scan with before/after comparison (spec SC-007)
- Event-driven scans indistinguishable from manual in dashboard (spec SC-008)
- All API calls via Gateway, zero direct Controller calls (spec SC-009)
- Clean Knex migrations with up/down for all tables (spec SC-010)

## Handoff Readiness (updated 2026-06-16)

**Current score: 9/10.** Deployed on Netrunner (v0.13.57/v0.10.58). 578+ tests across 21 suites. All must-do items complete. CI migrated from GitHub Actions to GitLab CEE (backstage-test → backstage-export → deploy-netrunner).

### Completed (2026-06-12)

| # | Action | Status |
|---|--------|--------|
| 1 | Tests for `ChainView.tsx` (21 tests) | Done |
| 2 | Tests for `InventoriesList.tsx` (16 tests) | Done |
| 3 | Tests for `FindingsParser.ts` (43 tests) | Done |
| 4 | CLI aligned: `rhdh-cli` → `janus-cli` (`@janus-idp/cli`) | Done |
| 5 | Inventory table redesign (sub-rows, 5 columns, baseline rate) | Done |
| 6 | Inventory detail: Scan Now button + LaunchScanDialog | Done |
| 7 | Clickable score cards → authoritative scan results | Done |
| 8 | Inventory chips link to detail with profile context (ResultsViewer + RemediationsList) | Done |
| 9 | `?baselineView=true` URL param auto-activates baseline filter | Done |
| 10 | Architect review: all HIGH/MEDIUM findings fixed (memoization, catch comments) | Done |

### Should-do (~8 hours)

| # | Action | Effort | Why |
|---|--------|--------|-----|
| 5 | Add memoization to `RemediationsList.tsx` and `ComplianceDashboard.tsx` | 1h | Low hook density for component size |
| 6 | Tests for `ScanProgress.tsx` and `RemediationPlanBuilder.ts` | 2h | Visible UI + core backend logic |
| 7 | Split `RemediationExecution.tsx` (1431 lines) into sub-components | 3h | Largest file, hard to review |
| 8 | Add `SURFACE_COLORS` to colors.ts for remaining structural grays | 2h | Complete the color centralization |

### Nice-to-have (~6 hours)

| # | Action | Effort | Why |
|---|--------|--------|-----|
| 9 | Fix 3 `any` types in chart components | 1h | Type safety |
| 10 | Add Zod validation on `/findings/ingest` body | 2h | Runtime schema validation |
| 11 | Pin Backstage package versions to match downstream | 1h | Version alignment |
| 12 | Migrate `console.error` to Backstage `errorApiRef` | 2h | Standard error reporting |

### Downstream alignment notes
- `backstage-rhaap-common` has NO shared colors/themes — our `colors.ts` is a clean extension
- `recharts` is an additional dependency (downstream has zero charting deps) — needs explicit approval
- Backstage package versions are slightly ahead of downstream (may need pinning)
- Our error boundary in `ComplianceRouter.tsx` is strictly additive (downstream has none)

## Open Questions

1. Should compliance profile registration validate EE contents (verify `scap-security-guide` RPM is installed) or only validate EE existence via Gateway API?
   - **Recommendation**: Validate existence only. EE content validation requires launching a test job, which is heavy for a registration step. Document EE content requirements in the admin guide.

2. Should the export endpoint support scheduled/automated exports (e.g., "email CSV every Monday") or only on-demand?
   - **Recommendation**: On-demand only for initial release. Scheduled exports add significant complexity (job scheduling, email integration) with limited value over API-driven automation.

3. How should findings from Track A (fast pre-assessment) and Track B (audit-grade) scans be distinguished in the UI?
   - **Recommendation**: Tag findings with `check_type` (custom vs openscap vs byos). Show a badge on scan results indicating the scan track. Allow filtering by check type.

4. Should the compliance plugin register its own Backstage catalog entities (e.g., compliance profiles as catalog items)?
   - **Recommendation**: Defer. Catalog entity integration adds value for discoverability but is not required for core functionality. Can be added as a follow-up once the entity model stabilizes.
