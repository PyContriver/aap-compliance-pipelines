---
title: "Feature: CaC Remediation via Direct JT"
description: "The plugin needs selective remediation -- applying only specific STIG rules to specific hosts with optional parameter ov"
type: feature-spec
status: implemented
product: "AAP Compliance Dashboard"
last_verified: 2026-07-09
---

# Feature: CaC Remediation via Direct JT

**Status:** Shipped (2026-04-23, formalized 2026-05-26)
**Commits:** `ed81191` (initial), `3b5ae2b` (CaC tag alignment), `268a8ed` (formal ADR)
**ADR:** ADR-009

## Problem

The plugin needs selective remediation -- applying only specific STIG rules to specific hosts with optional parameter overrides. ComplianceAsCode provides `rhel9-playbook-stig.yml` (55K lines, 4474 tasks) where each task is tagged with a rule ID. The question was whether remediation should be a workflow node (triggered automatically after assessment) or a standalone JT launched independently.

## Design Approach

Remediation is a separate, standalone job template -- never combined with assessment. The remediation JT imports the CaC playbook and is launched directly with:
- `job_tags`: comma-separated rule IDs from the Remediation Builder (maps to `--tags`)
- `extra_vars`: parameter overrides (e.g., `var_accounts_tmout: 900`)
- `limit`: target hosts from scope selection (maps to `--limit`)

The gap between assess and remediate is the decision point: human-supervised (portal review), EDA-automated (rulebook policy), or future autonomous (AI agent). We do not author remediation playbooks -- CaC's playbook is the remediation engine.

## Implementation Summary

- `remediate.yml`: imports CaC playbook from `scap-security-guide` RPM
- Remediation JT: `ask_tags_on_launch: true`, `ask_variables_on_launch: true`, `ask_inventory_on_launch: true`
- Rule IDs aligned with CaC tag names: `normalize_xccdf` strips XCCDF prefix (`xccdf_org.ssgproject.content_rule_`)
- RemediationProfileBuilder: user selects findings, plugin builds `job_tags` string
- Backend: launches remediation JT directly via Controller API with tags, vars, and limit
- CaC title-prefix matching for remediation task grouping in results

## Testing

- End-to-end remediation on netrunner with selective rule application
- Verified `--tags` filtering produces correct task subset from 4474-task playbook
- Parameter overrides confirmed via extra_vars pass-through

## Dependencies

- ADR-003 (single assessment JT) -- assessment and remediation kept separate by design
- ADR-004 (oscap migration) -- rule ID alignment with CaC tags
- `scap-security-guide` RPM in EE for `rhel9-playbook-stig.yml`
