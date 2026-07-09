---
title: "Feature: Scanner Orchestrator Architecture"
description: "Building scanner-specific rendering logic in the Backstage plugin would create tight coupling and require plugin redeplo"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: Scanner Orchestrator Architecture

**Status:** Shipped (2026-04-23, formalized 2026-05-26)
**Commits:** `488e60e` (initial scaffold), `268a8ed` (formal ADR)
**ADR:** ADR-001

## Problem

Building scanner-specific rendering logic in the Backstage plugin would create tight coupling and require plugin redeployment for every new scanner. Puppet SCE and Chef Compliance both embed their scanners directly, tying their offerings to a single scanning engine. We needed an architecture that supports multiple scanner backends (OpenSCAP, PowerSTIG, Qualys, Tenable, Insights, CIS-CAT) without plugin changes.

## Design Approach

The compliance plugin is a scanner orchestrator, not a scanner. All scanners normalize their output to a Common Findings Format (CFF) JSON document. The plugin never knows which scanner produced the findings.

Three scanner tiers:
- **Tier 1** (fully shippable): Scanner, content, normalizer, remediation, pipeline, EE -- we ship everything
- **Tier 2** (BYOS): We ship adapter + normalizer + pipeline; customer provides scanner deployment and licenses
- **Tier 3** (hybrid): Multi-domain adapters with per-platform normalizers

The CFF v1.0 schema is the single integration surface between the Ansible collection layer and the Backstage plugin layer. Adding a new scanner requires only a new collection with a normalizer module -- no plugin redeployment.

## Implementation Summary

- CFF schema defined in `plugins/compliance-common/` with fields: `rule_id`, `title`, `status`, `severity`, `stig_id`, `category`, `description`, `check_text`, `fix_text`, `evidence`, `parameters`
- Normalizer modules output CFF JSON (first `compliance_evaluate`, later `normalize_xccdf`)
- Plugin renders CFF data generically -- no scanner-specific UI code
- Remediation roles are scanner-agnostic -- same CaC playbook fixes findings regardless of scanner

## Testing

- CFF schema validated through end-to-end scan flows
- Normalizer module unit tests verify CFF output structure

## Dependencies

- ADR-006 (self-contained profiles) -- reinforces that the plugin does not enrich findings
- ADR-004 (oscap migration) -- first Tier 1 scanner implementation
