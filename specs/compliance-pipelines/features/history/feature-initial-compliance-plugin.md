---
title: "Feature: Initial Compliance Plugin"
description: "Puppet SCE and Chef Compliance are the only remaining revenue drivers for those platforms, both selling premium complian"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Initial Compliance Plugin

**Status:** Shipped (2026-04-26 to 2026-04-29)
**Commits:** `488e60e` through `c366929` (pre-PR era, direct to main)
**ADR:** ADR-001 (scanner orchestrator), ADR-009 (CaC remediation)

## Problem

Puppet SCE and Chef Compliance are the only remaining revenue drivers for those platforms, both selling premium compliance add-ons. Red Hat had no in-platform compliance dashboard for AAP. The goal was a self-contained prototype proving AAP could deliver scan-remediate-verify workflows via a Backstage plugin matching the Ansible Portal look and feel.

## Design Approach

Built a full-stack Backstage plugin (frontend + backend + common types) with an Ansible collection for RHEL 9 STIG content. The plugin is a scanner orchestrator (ADR-001) -- it consumes a Common Findings Format (CFF) JSON contract, not scanner-specific data. Remediation uses ComplianceAsCode's 55K-line playbook via `--tags` (ADR-009).

Core UX: 6 tabs (Overview, Profiles, New Scan, Results, Remediations, Settings) with 12 sub-routes. Material UI themed to PatternFly 6. Live/mock toggle for development.

## Implementation Summary

- **Frontend plugin** (`plugins/compliance/`): Dashboard with compliance gauges, posture trending, scan launcher, ResultsViewer with host-level granularity, RemediationProfileBuilder with per-finding toggles, Settings for profile registration
- **Backend plugin** (`plugins/compliance-backend/`): REST API, Controller client (via platform gateway), Knex migrations for SQLite/PostgreSQL, job event parsing
- **Common types** (`plugins/compliance-common/`): CFF schema, shared interfaces
- **Ansible collection** (`collections/`): `compliance_gather` and `compliance_evaluate` custom modules (20 hand-written STIG rules), `gather_facts.yml` + `evaluate.yml` playbooks, `remediate.yml` importing CaC playbook
- **Content pattern** (`content/`): config-as-code for Controller resources (JTs, workflows, credentials, EE)
- **App shell** (`backstage-app/`): Standalone dev app with RHDH theme, dark sidebar, Red Hat branding

## Testing

- 206 tests across 11 suites (13.8s runtime)
- Architect review: all 12 findings fixed (ErrorBoundary, auth policy, div-by-zero, error handling, aria labels, dead code, query validation, tab sync)
- End-to-end validated: workflow job 86 produced 20 real STIG findings on lab host

## Dependencies

- AAP 2.6 lab (192.168.128.128) with `compliance-prototype` organization
- `scap-security-guide` RPM for CaC remediation playbook
- Backstage 1.x with RHDH theme packages
