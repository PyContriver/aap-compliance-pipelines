# Jira Feature Assessment: AAP Compliance Pipelines

**Date:** 2026-05-21
**Assessed by:** Feature readiness review
**Purpose:** Determine whether sufficient material exists to create an ANSTRAT Feature ticket for In-Platform Compliance Pipelines

---

## 1. Do We Already Have a Jira Ticket?

**No.** There is no existing ANSTRAT Feature ticket for compliance pipelines.

### What exists

| Ticket | Type | Status | Relevance |
|--------|------|--------|-----------|
| **ANSTRAT-2178** | Outcome | New | "WIP: Establishing Mission-Critical Governance, Security, and Compliance" -- this is the **parent Outcome** where a compliance pipelines Feature should live. Created 2026-05-18 by Tim Appnel. Contains Initiative 2: Policy-Driven Workflows & Compliance Automation. Currently has 12 child Features, all focused on zero trust / identity / PKI / secrets -- **no compliance pipelines Feature yet**. |
| **ANSTRAT-1670** | Outcome | In Progress | "Evolve Ansible Content in support of Agentic Orchestration" -- Initiative 3 mentions "security & compliance" as a domain content category. The spec references this as a related Outcome. Compliance pipelines could alternatively live here as strategic domain content, but ANSTRAT-2178 is the better fit. |
| **ANSTRAT-1077/1076/1061** | Features | New | "Automated Policy-as-Code" Phases 2/2b/3 -- these are children of ANSTRAT-2178 but focus on OPA-style policy enforcement within workflows, not compliance scanning/remediation pipelines. Distinct scope. |
| **AAP-74255** | Story | New | "Create licensing compliance skill" -- different scope (licensing, not STIG/CIS). |
| **AAP-74240** | Epic | Release Pending | "Hide out of compliance banner for non-admins" -- subscription compliance, not infrastructure compliance. |

### Conclusion

No ticket exists. The Google Drive Feature Proposal document (id: `1Z7_EnqSzf6kq1FJqJujifRrj-yk4nkhzfcjF-eJq9wo`) is fully written and references ANSTRAT-2178 as the parent Outcome, but the corresponding Jira Feature has not been created.

---

## 2. Do We Have Enough Material?

**Yes -- substantially more than enough.** This is one of the most thoroughly documented feature proposals I have seen.

### Material inventory

| Artifact | Location | Completeness |
|----------|----------|--------------|
| **Feature Proposal** (Google Drive) | Doc ID `1Z7_EnqSzf6kq1FJqJujifRrj-yk4nkhzfcjF-eJq9wo` | Complete -- Goals, Background, Problem, Assumptions, Phased Delivery, Architecture, Competitive positioning |
| **Feature Spec** (repo) | `specs/compliance-pipelines/spec.md` | Complete -- 8 user stories with acceptance scenarios, 32 functional requirements, 10 success criteria, 5 key entities, edge cases |
| **Implementation Plan** (repo) | `specs/compliance-pipelines/plan.md` | Complete -- 6 phases, full API design (25+ endpoints), database schema (5 tables), architecture diagrams, risk mitigation |
| **Plan Doc** (Google Drive) | Doc ID `1eVs4DXGT6S7PHKqf0aD_uRACIhQ4eCGyEiFjJidwwwk` | Complete -- Three-tier scanner model, two-track scanning, phased delivery, scanner integration details for 7+ vendors |
| **Working Prototype** | `aap-compliance-pipelines` repo | 50+ commits, 198 tests (11 suites), 7 UI views, backend REST API, database layer, live AAP 2.6 integration validated |
| **Architect Assessment** | `review/architect-assessment-2026-05-20.md` | Complete -- Scorecard (3-4/5 across 7 categories), detailed findings, shipping punch list, prioritized recommendations |
| **Competitive Analysis** | Referenced in spec, summarized in Google Drive proposal | Puppet SCE, Chef Compliance, Drata, Vanta -- positioning and differentiation documented |
| **Content Packaging Model** | `docs/compliance-profile-developer-guide.md` | ~1150 lines, covers Tier 1/2/3 collection structures, CFF JSON schema, normalizer patterns, 30-item readiness checklist |
| **Submission Guide** | `SUBMISSION.md` | Complete -- file mapping, step-by-step downstream submission process, downstream speckit workflow |
| **AsciiDoc Documentation** | `docs/modules/` (5 files) | Red Hat documentation standard format, ready for aap-docs submission |

### Key content elements for a Feature ticket

| Element | Available? | Detail |
|---------|-----------|--------|
| Problem statement | Yes | 7 distinct problems documented (no integrated experience, no remediation profiles, no reporting, competitive gap, content packaging gap, diverse scanners with no unified UX, no scanner-to-remediation bridge) |
| Business case | Yes | Puppet/Chef revenue model attack, market share data (Ansible 31.7% vs Puppet 12.3% vs Chef 6.7%), competitive positioning against premium add-ons |
| Architecture | Yes | Scanner orchestrator model, Common Findings Format v1.0.0, three-tier scanner model, two-track scanning, compliance profile packaging model |
| Phased delivery | Yes | 6 phases documented (Phase 1: Content + Backend, Phase 2: Scan + Findings, Phase 3: Remediation Builder, Phase 4: Export + Polish, Phase 5: EDA Integration, Phase 6: Docs + Hardening) |
| Working prototype | Yes | 198 tests, 7 UI views, validated on live AAP 2.6 lab, 20 STIG rules evaluated (8 pass, 12 fail), end-to-end scan-to-findings-to-remediation flow demonstrated |
| Architect assessment | Yes | 4/5 on Architecture & Design, 4/5 on AAP Integration, 3.5/5 on Backstage Plugin Quality, overall ~70% of Phase 1+2 delivered |
| Parent Outcome linkage | Yes | ANSTRAT-2178, Initiative 2: Policy-Driven Workflows & Compliance Automation |
| Related Features | Yes | ANSTRAT-1670 (content strategy), ANSTRAT-1285 (Pattern Loading Service), ANSTRAT-1534 (Content Discovery), ANSTRAT-2122 (Skill Content Type) |
| Success criteria | Yes | 10 measurable outcomes (SC-001 through SC-010) with specific thresholds |
| Assumptions | Yes | 12 documented assumptions covering AAP version, Portal availability, content packaging, scanner availability, authentication |

---

## 3. What Jira Project Should It Go In?

**ANSTRAT** (Ansible Strategy).

Rationale:
- The parent Outcome ANSTRAT-2178 already exists and explicitly includes "Initiative 2: Policy-Driven Workflows & Compliance Automation"
- All peer Features under this Outcome are in ANSTRAT (ANSTRAT-2215, 2213, 2212, 2207, 2205, 2204, etc.)
- The Google Drive Feature Proposal document explicitly states: "Issue Type: Feature, Project: ANSTRAT, Parent Outcome: Mission-Critical Governance, Security, and Compliance"
- The spec.md references ANSTRAT tickets throughout (ANSTRAT-1670, ANSTRAT-1285, ANSTRAT-1534)
- AAP project is for engineering Stories/Epics, not strategy Features

---

## 4. What Type of Ticket?

**Feature** (child of Outcome ANSTRAT-2178).

Rationale:
- The ANSTRAT project hierarchy is: Outcome > Feature > (Stories/Tasks)
- ANSTRAT-2178 is an Outcome with 12 existing child Features
- All sibling tickets (ANSTRAT-2215, 2213, 2212, 2207, 2205, 2204) are type "Feature"
- The Google Drive proposal explicitly states "Issue Type: Feature"
- This is too large for a Story, too specific for an Outcome, and not an organizational container (Initiative)

---

## 5. Draft Jira Ticket Content

### Summary

In-Platform Compliance Pipelines

### Description

*(Formatted for Jira markdown)*

## Feature Overview

Deliver an end-to-end compliance pipeline experience within Ansible Automation Platform -- scan, report, review, remediate, verify -- targeting DISA STIG and CIS Benchmark frameworks. The pipeline operates as a scanner orchestration layer, not a scanner itself, using a three-tier model that supports built-in scanners (OpenSCAP, PowerSTIG), customer-provided scanners (Tenable, Qualys, Insights), and hybrid multi-domain configurations.

## Parent Outcome

This Feature belongs to Initiative 2 (Policy-Driven Workflows & Compliance Automation) under ANSTRAT-2178 (Mission-Critical Governance, Security, and Compliance).

## Problem

1. **No integrated compliance experience.** Customers using AAP for STIG/CIS compliance must manually source content from ComplianceAsCode, create projects/workflows/surveys in Controller by hand, and wire up scan-remediate-verify loops without platform guidance. There is no "compliance pipeline" concept in AAP.

2. **No remediation profile management.** When a compliance scan produces hundreds of findings, customers have no in-platform mechanism to review findings by severity, selectively approve or skip individual rules, customize remediation parameters, or save these institutional decisions as reusable profiles.

3. **No compliance reporting or posture visualization.** AAP provides no out-of-the-box compliance dashboard. Customers must build custom Grafana dashboards or export data to external tools.

4. **Competitive gap.** Puppet SCE and Chef Compliance sell compliance as premium add-ons generating significant revenue. AAP has no equivalent offering.

5. **Content packaging gap.** ComplianceAsCode generates Ansible remediation playbooks, but these are distributed as raw files -- not as structured Ansible collections consumable through AAP's content pipeline.

6. **No scanner-to-remediation bridge.** Even when customers have scanner results, translating those into targeted Ansible remediation requires manual mapping.

## Architecture

- **Scanner Orchestrator Model:** The compliance plugin orchestrates pluggable scanners, it does not scan. Value is in UX, orchestration, and the remediation builder.
- **Common Findings Format (CFF):** JSON schema v1.0.0 -- the contract between all scanner normalizers and the portal. The plugin renders findings identically regardless of which scanner produced them.
- **Three-Tier Scanner Model:** Tier 1 (Fully Shippable: OpenSCAP, PowerSTIG), Tier 2 (BYOS: Tenable, Qualys, Insights, CIS-CAT), Tier 3 (Hybrid multi-domain).
- **Two-Track Scanning (future):** Track A (fast pre-assessment for triage) is a future optimization; Track B (audit-grade, full OpenSCAP) is the current primary path for compliance evidence.
- **Compliance Profile Packaging:** Ansible collections containing scanner adapter, normalizer, evaluation rules, remediation roles, pipeline workflow definitions, and portal metadata. Each compliance profile is a self-contained pipeline for a specific profile and scanner combination.
- **Controller Job Templates as Pipeline Runtime:** Uses AAP's existing job template engine, not a new pipeline runtime. Assessment uses a single JT with 2 plays (scan + normalize in one container). Remediation uses a separate direct JT launch with native `job_tags` and `--limit` (not workflow-level, which do not propagate to child JTs).

## Phased Delivery

| Phase | Scope | Duration |
|-------|-------|----------|
| Phase 1 | Content Packaging + Backend Foundation (migrations, CRUD, Gateway client, compliance profile service) | 2 weeks |
| Phase 2 | Scan + Findings Pipeline (workflow invocation, XCCDF parser, findings storage, dashboard, findings viewer) | 2 weeks |
| Phase 3 | Remediation Builder (rule toggles, parameter overrides, scope selection, execution preview, verification re-scan) | 2 weeks |
| Phase 4 | Export + Polish (CSV/JSON export, pagination, performance optimization, E2E tests) | 1 week |
| Phase 5 | EDA Integration -- stretch goal (event-driven scan triggers, cooldown/batching) | 1 week |
| Phase 6 | Documentation + Hardening (API docs, admin guide, security review, load testing, accessibility) | 3-5 days |

## Prototype Status

A working prototype exists in the `aap-compliance-pipelines` repository (50+ commits):

- **198 tests** across 11 suites (backend: 127 tests covering router, service, database; frontend: 71 tests)
- **7 UI views:** Dashboard, Profiles, Scan Launcher, Results Viewer, Remediation Builder, Remediations List, Settings
- **Live AAP 2.6 integration validated:** End-to-end scan on lab infrastructure, 20 STIG rules evaluated (8 pass, 12 fail), findings parsed and displayed
- **Architect assessment:** 4/5 Architecture, 4/5 AAP Integration, 3.5/5 Plugin Quality, ~70% Phase 1+2 delivery
- **Content:** OpenSCAP-based scanning pipeline with `normalize_xccdf` module (366 STIG rules from scap-security-guide), CaC remediation playbook, EE profile definition, pipeline playbooks. Deprecated modules (`compliance_gather`, `compliance_evaluate`) retained for backward compatibility.

## Competitive Positioning

| Capability | AAP Compliance Pipelines | Puppet SCE | Chef Compliance |
|------------|--------------------------|------------|-----------------|
| Scanner model | Scanner-agnostic (3 tiers) | CIS-CAT Pro only | InSpec only |
| Architecture | Agentless | Agent-required | Agentless |
| Content format | YAML (Ansible) | Puppet DSL | Ruby DSL (InSpec) |
| Remediation granularity | Per-rule toggles, parameter overrides, scope selection | All-or-nothing | All-or-nothing |
| Event-driven compliance | EDA integration (P3) | No | No |
| AI-assisted remediation | Future (Orchestrator integration) | No | No |

## Key Dependencies

**Hard:** AAP Controller 2.6+, AAP Gateway, Backstage/RHDH, scap-security-guide RPM, OpenSCAP
**Soft:** Pattern Loading Service (ANSTRAT-1285), EDA Server (P3), Content Discovery (ANSTRAT-1534)

## Success Criteria

- SC-001: Admin can add a compliance profile and launch a scan from the portal in <5 minutes without Controller UI access
- SC-002: Scan findings display per-host, per-rule detail including actual observed values
- SC-003: Remediation builder supports selective rule toggling, parameter overrides, and scope selection
- SC-004: Remediation execution uses dynamic host grouping (scales to 20,000+ hosts)
- SC-005: Saved remediations can be applied to new scan results with unreviewed rule flagging
- SC-006: Findings exportable in CSV and JSON with per-host detail
- SC-007: Verification re-scan runs automatically after remediation with before/after comparison
- SC-008: Event-driven scans indistinguishable from manual scans in the dashboard
- SC-009: All API calls route through Gateway -- zero direct Controller calls
- SC-010: Clean Knex migrations with up/down for all tables

## Reference Materials

- Feature Proposal: [Google Doc](https://docs.google.com/document/d/1Z7_EnqSzf6kq1FJqJujifRrj-yk4nkhzfcjF-eJq9wo)
- Plan Doc: [Google Doc](https://docs.google.com/document/d/1eVs4DXGT6S7PHKqf0aD_uRACIhQ4eCGyEiFjJidwwwk)
- Prototype: [GitHub](https://github.com/cross-logic/aap-compliance-pipelines)
- Architect Assessment: In repo at `review/architect-assessment-2026-05-20.md`

### Ticket Metadata

| Field | Value |
|-------|-------|
| **Project** | ANSTRAT |
| **Issue Type** | Feature |
| **Parent** | ANSTRAT-2178 |
| **Summary** | In-Platform Compliance Pipelines |
| **Status** | New |
| **Labels** | `compliance`, `portal`, `backstage`, `stig`, `strategic-domain-content` |
| **Components** | (check available ANSTRAT components) |
| **Fix Version** | AAP.NEXT |
| **Related tickets** | ANSTRAT-1670 (content strategy), ANSTRAT-1285 (Pattern Loading Service), ANSTRAT-1534 (Content Discovery), ANSTRAT-2122 (Skill Content Type), ANSTRAT-1907 (network STIG content) |

---

## 6. Risks and Considerations

### Before creating the ticket

1. **WIP status of parent Outcome.** ANSTRAT-2178 is marked "WIP" in its summary. Confirm with Tim Appnel whether the Outcome is stable enough to accept new child Features, or whether it is still being restructured.

2. **Initiative placement.** The Google Drive proposal places this under Initiative 2 (Policy-Driven Workflows & Compliance Automation). Alternatively, it could sit under ANSTRAT-1670 Initiative 3 (Strategic Domain Content) since compliance is explicitly called out there as a domain. The feature touches both: it is compliance automation (ANSTRAT-2178 Initiative 2) AND strategic domain content (ANSTRAT-1670 Initiative 3). Recommend creating under ANSTRAT-2178 with a link to ANSTRAT-1670.

3. **Feature vs Initiative granularity.** The compliance pipelines work is large enough to be an Initiative (6 phases, multiple workstreams). However, the ANSTRAT hierarchy uses Feature as the child of Outcome, and all peer tickets are Features. Keep it as a single Feature with phases described in the body.

4. **Prototype repo visibility.** The `cross-logic/aap-compliance-pipelines` repo is public. Verify this is acceptable before linking it from a Red Hat Jira ticket.

---

## 7. Recommendation

**Create the ANSTRAT Feature ticket now.** The material is comprehensive -- arguably over-prepared for a Feature proposal. The Google Drive Feature Proposal document is already written in Jira-ready format, the spec and plan are complete, the prototype validates technical feasibility, and the architect assessment provides independent validation.

The only blocker is confirming that ANSTRAT-2178 is ready to accept new child Features (given its "WIP" status). If so, creating the ticket is a straightforward copy from the Google Drive Feature Proposal into Jira.
