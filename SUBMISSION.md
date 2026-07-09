---
title: "Downstream Submission Guide"
description: "How to submit the AAP Compliance Dashboard from this standalone repo to the downstream Ansible Portal repo"
type: guide
audience: [developer]
product: "AAP Compliance Dashboard"
product_version: "2.6"
status: current
last_verified: 2026-07-09
---

# AAP Compliance Dashboard: Downstream Submission Guide

This document describes how to submit the AAP Compliance Dashboard from this standalone repo (`aap-compliance-pipelines`) to the downstream Ansible Portal repo (`ansible/ansible-rhdh-plugins`).

## Current Status (2026-07-09)

- **Backend version**: v0.13.115
- **Frontend version**: v0.10.105
- **Test count**: 626 backend/frontend tests across 24 suites + 127 collection unit tests
- **ADRs**: 37 formal decision records in `specs/compliance-pipelines/decisions/`
- **Profiles**: 4 compliance profiles (RHEL 9 STIG, CIS L1, CIS L2, Supply Chain)
- **Migrations**: 23 database migrations
- **Implementation**: P1 complete, P2a complete. Remediation lifecycle, baseline scoring, chain view, finding-level states, inventory view, supply chain SBOM, dynamic tabs, profile identity all shipped. P2b (data management, rich evidence) and P3 (audit export, UX gaps) remain.

## Prerequisites

Before submitting to the downstream repo, ensure the following are complete:

1. **Jira ticket created**: An ANSTRAT feature ticket must exist for the compliance pipelines feature, linked to the appropriate parent Outcome (recommended: ANSTRAT-2178, Initiative 2: Policy-Driven Workflows & Compliance Automation)
2. **Spec review passed**: The spec at `specs/compliance-pipelines/spec.md` must be reviewed and approved by the Portal team. Run the quality checklist at `specs/compliance-pipelines/checklists/requirements.md` before submitting
3. **Architecture approval**: The compliance profile model, Gateway-only API routing, and Portal PostgreSQL persistence approach must be approved via an ADR in the downstream repo
4. **MVP validation**: Core workflows (compliance profile registration, scan launch, findings review, profile builder) must be demonstrated end-to-end
5. **Downstream branch created**: A feature branch in `ansible/ansible-rhdh-plugins` following the naming convention (e.g., `NNN-compliance-pipelines`)

## File Mapping

### Spec artifacts (this repo to downstream)

| This Repo | Downstream Location | Notes |
|---|---|---|
| `specs/compliance-pipelines/spec.md` | `specs/NNN-compliance-pipelines/spec.md` | Update NNN to the assigned feature number |
| `specs/compliance-pipelines/plan.md` | `specs/NNN-compliance-pipelines/plan.md` | Update research paths to downstream relative paths |
| `specs/compliance-pipelines/checklists/requirements.md` | `specs/NNN-compliance-pipelines/checklists/requirements.md` | No changes needed |

### Plugin code (this repo to upstream submodule)

| This Repo | Downstream Location | Notes |
|---|---|---|
| `backstage-app/plugins/compliance/` | `ansible-backstage-plugins/plugins/compliance/` | Frontend plugin — copy `src/`, `package.json` |
| `backstage-app/plugins/compliance-backend/` | `ansible-backstage-plugins/plugins/compliance-backend/` | Backend plugin — copy `src/`, `package.json`, migrations |
| `backstage-app/plugins/compliance-common/` | `ansible-backstage-plugins/plugins/compliance-common/` | Common types — copy `src/`, `package.json` |

### Documentation (this repo to downstream)

| This Repo | Downstream Location | Notes |
|---|---|---|
| Architecture decision records (37 ADRs) | `docs/adrs/NNN-compliance-*.md` | Adapt from `specs/compliance-pipelines/decisions/ADR-001` through `ADR-037` |
| Research documents | `docs/research/NNN-compliance-*.md` | Adapt research for downstream audience |

### Files that stay in this repo only

| File | Reason |
|---|---|
| `profiles/` | Self-contained compliance profiles (collections, EE definitions, install playbooks) |
| `scripts/` | Dev helper scripts specific to the development environment |
| `review/` | Internal review materials |
| `SUBMISSION.md` | This file -- submission process documentation |
| `README.md` | Standalone repo README |

## Step-by-Step Submission Process

### Step 1: Prepare the downstream branch

```bash
cd ansible-rhdh-plugins
git checkout main && git pull
git checkout -b NNN-compliance-pipelines
```

### Step 2: Create spec directory and copy artifacts

```bash
# Create the spec directory structure
mkdir -p specs/NNN-compliance-pipelines/checklists

# Copy spec artifacts (update paths and feature numbers in the files)
cp <path-to-this-repo>/specs/compliance-pipelines/spec.md \
   specs/NNN-compliance-pipelines/spec.md

cp <path-to-this-repo>/specs/compliance-pipelines/plan.md \
   specs/NNN-compliance-pipelines/plan.md

cp <path-to-this-repo>/specs/compliance-pipelines/checklists/requirements.md \
   specs/NNN-compliance-pipelines/checklists/requirements.md
```

### Step 3: Update spec file references

After copying, update the following in the spec and plan files:
- Feature branch name: update to `NNN-compliance-pipelines`
- Research links: update relative paths to match downstream `docs/research/` structure
- Remove any references to standalone-repo-specific paths or infrastructure

### Step 4: Copy plugin code to the upstream submodule

```bash
cd ansible-backstage-plugins

# Create a feature branch in the upstream submodule
git checkout -b feat/compliance-pipelines

# Copy the three plugin packages
cp -r <path-to-this-repo>/backstage-app/plugins/compliance plugins/compliance
cp -r <path-to-this-repo>/backstage-app/plugins/compliance-backend plugins/compliance-backend
cp -r <path-to-this-repo>/backstage-app/plugins/compliance-common plugins/compliance-common

# Verify package.json files have correct names and dependencies
# Frontend: @redhat/backstage-plugin-compliance
# Backend:  @redhat/backstage-plugin-compliance-backend
# Common:   @redhat/backstage-plugin-compliance-common
```

### Step 5: Adapt code for downstream conventions

The plugin code may need adjustments:
- **Package naming**: Ensure packages follow the `@redhat/backstage-plugin-*` naming convention
- **Import paths**: Update any standalone-repo import paths to match the upstream monorepo structure
- **Config schema**: Ensure `config.d.ts` follows the downstream pattern (see existing plugins)
- **Dynamic plugin exports**: Add `alpha.ts` or dynamic plugin entry point if required by the downstream packaging
- **Tests**: Ensure tests pass in the upstream CI environment (`yarn test`, `yarn tsc`, `yarn lint`)

### Step 6: Adapt ADRs for downstream format

37 ADRs exist in `specs/compliance-pipelines/decisions/`. All have YAML frontmatter with title, description, type, status, and date. Key ADRs for downstream review:
- ADR-001: Scanner orchestrator architecture (CFF as contract)
- ADR-002: Two-tier RBAC (Portal + AAP pass-through)
- ADR-003: Single assessment JT with 2 plays
- ADR-007: Direct POST findings
- ADR-010: Per-scan ingest token
- ADR-014: Remediation lifecycle architecture
- ADR-016: Finding-level state tracking
- ADR-026: Portable display configuration
- ADR-027: Dynamic tab system
- ADR-029: CycloneDX normalizer (supply chain)
- ADR-033: File-streamed API ingestion
- ADR-036: Profile identity (slug)

See `docs/README.md` for the full ADR index.

### Step 7: Create research documents

Adapt research for the downstream `docs/research/` directory:
- Competitor analysis (Puppet SCE, Chef Compliance positioning)
- ComplianceAsCode content packaging approach
- Two-track scanning architecture rationale

### Step 8: Submit PRs

Two PRs are needed:

1. **Upstream PR** (code): PR to `ansible/ansible-backstage-plugins` from the submodule feature branch
   ```bash
   cd ansible-backstage-plugins
   gh pr create --repo ansible/ansible-backstage-plugins \
     --title "feat: compliance pipelines plugin" \
     --body "Adds compliance scanning, findings review, and remediation builder plugins"
   ```

2. **Downstream PR** (specs + docs): PR to `ansible/ansible-rhdh-plugins` from the feature branch
   ```bash
   cd ansible-rhdh-plugins
   gh pr create --repo ansible/ansible-rhdh-plugins \
     --title "spec: compliance pipelines feature" \
     --body "Adds spec, plan, and checklists for compliance pipelines feature"
   ```

### Step 9: Review and iterate

- Spec PR goes through speckit review process (`/speckit.review`)
- Code PR goes through standard upstream code review
- After both PRs merge, update the submodule pointer in the downstream repo

## Content Guidelines Reminder

Before submitting, verify all files comply with these rules:
- No passwords, tokens, API keys, or certificates (use `<placeholder>` or `<changeme>`)
- No real hostnames, IP addresses, or internal URLs (use `https://aap.example.com`)
- No employee names (use role titles: "Platform engineer", "Security officer")
- No customer names or deployment details
- Jira ticket IDs are acceptable; verbatim proprietary descriptions are not

## Downstream Speckit Workflow

Once the spec is in the downstream repo, the full speckit workflow applies:

```bash
/speckit.clarify specs/NNN-compliance-pipelines    # Find gaps
/speckit.plan specs/NNN-compliance-pipelines        # Refine plan
/speckit.tasks specs/NNN-compliance-pipelines       # Generate task breakdown
/speckit.adr specs/NNN-compliance-pipelines         # Create ADRs
/speckit.implement specs/NNN-compliance-pipelines   # Write code to submodule
/speckit.review specs/NNN-compliance-pipelines      # Quality review
```
