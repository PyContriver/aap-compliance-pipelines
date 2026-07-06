# Documentation Map

Guide to all project documentation. Start here if you're new to the project.

## Quick Start

| Doc | Purpose |
|-----|---------|
| [README.md](../README.md) | Project overview, structure, dev commands |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, branching, CI/CD, coding standards, adding features |
| [CLAUDE.md](../CLAUDE.md) | AI assistant context (component architecture, key paths, terminology) |

## Architecture Decisions (ADRs)

All ADRs are in [`specs/compliance-pipelines/decisions/`](../specs/compliance-pipelines/decisions/).

| ADR | Title | Status | Scope |
|-----|-------|--------|-------|
| [001](../specs/compliance-pipelines/decisions/ADR-001-scanner-orchestrator-architecture.md) | Scanner Orchestrator Architecture (CFF) | Accepted | Dashboard |
| [002](../specs/compliance-pipelines/decisions/ADR-002-two-tier-rbac.md) | Two-Tier RBAC (Backstage + AAP) | Accepted | Dashboard |
| [003](../specs/compliance-pipelines/decisions/ADR-003-single-assessment-jt.md) | Single Assessment JT with 2 Plays | Accepted | Dashboard |
| [004](../specs/compliance-pipelines/decisions/ADR-004-oscap-replaces-custom-evaluate.md) | OpenSCAP Replaces Custom Evaluate | Accepted | STIG/CIS |
| [005](../specs/compliance-pipelines/decisions/ADR-005-slim-findings-for-event-storage.md) | Slim Findings for Event Storage | Accepted | Dashboard |
| [006](../specs/compliance-pipelines/decisions/ADR-006-self-contained-compliance-profiles.md) | Self-Contained Compliance Profiles | Accepted | Dashboard |
| [007](../specs/compliance-pipelines/decisions/ADR-007-direct-post-findings.md) | Direct POST Findings | Accepted | Dashboard |
| [008](../specs/compliance-pipelines/decisions/ADR-008-oscap-agentless-pattern.md) | Agentless OpenSCAP Pattern | Accepted | STIG/CIS |
| [009](../specs/compliance-pipelines/decisions/ADR-009-cac-remediation-via-direct-jt.md) | CaC Remediation via Direct JT | Accepted | STIG/CIS |
| [010](../specs/compliance-pipelines/decisions/ADR-010-per-scan-ingest-token.md) | Per-Scan Ingest Token | Accepted | Dashboard |
| [011](../specs/compliance-pipelines/decisions/ADR-011-profile-driven-platform-guards.md) | Profile-Driven Platform Guards | Accepted | Dashboard |
| [012](../specs/compliance-pipelines/decisions/ADR-012-dashboard-ux-competitive-alignment.md) | Dashboard UX Competitive Alignment | Accepted | Dashboard |
| [013](../specs/compliance-pipelines/decisions/ADR-013-multi-group-remediation-host-scoping.md) | Multi-Group Remediation Host Scoping | Accepted | Dashboard |
| [014](../specs/compliance-pipelines/decisions/ADR-014-remediation-lifecycle.md) | Remediation Lifecycle Architecture | Accepted | Dashboard |
| [015](../specs/compliance-pipelines/decisions/ADR-015-authoritative-scan-and-host-scoping.md) | Authoritative Scan and Host Scoping | Accepted | Dashboard |
| [016](../specs/compliance-pipelines/decisions/ADR-016-lifecycle-visualization-and-scan-grouping.md) | Lifecycle Visualization and Scan Grouping | Accepted | Dashboard |
| [017](../specs/compliance-pipelines/decisions/ADR-017-architect-review-hardening.md) | Architect Review Hardening | Accepted | Dashboard |
| [018](../specs/compliance-pipelines/decisions/ADR-018-findings-deduplication.md) | Findings Deduplication | Accepted | Dashboard |
| [019](../specs/compliance-pipelines/decisions/ADR-019-service-decomposition.md) | Service Decomposition | Accepted | Dashboard |
| [020](../specs/compliance-pipelines/decisions/ADR-020-shared-normalizer-module.md) | Shared Normalizer Module (module_utils Pattern) | Accepted | STIG/CIS |
| [021](../specs/compliance-pipelines/decisions/ADR-021-p3-hardening-sprint.md) | P3 Hardening Sprint | Accepted | Dashboard |
| [022](../specs/compliance-pipelines/decisions/ADR-022-baseline-triggered-auto-remediation.md) | Baseline-Triggered Auto-Remediation | Proposed | Dashboard |
| [023](../specs/compliance-pipelines/decisions/ADR-023-inventory-centric-compliance-view.md) | Inventory-Centric Compliance View | Accepted | Dashboard |
| [024](../specs/compliance-pipelines/decisions/ADR-024-compliance-score-trend-redesign.md) | Compliance Score Trend Redesign | Accepted | Dashboard |
| [025](../specs/compliance-pipelines/decisions/ADR-025-visual-consistency-and-handoff-readiness.md) | Visual Consistency and Handoff Readiness | Accepted | Dashboard |
| [026](../specs/compliance-pipelines/decisions/ADR-026-portable-display-configuration.md) | Portable Display Configuration | Accepted | Dashboard |
| [027](../specs/compliance-pipelines/decisions/ADR-027-dynamic-tab-system.md) | Dynamic Tab System | Accepted | Dashboard |
| [028](../specs/compliance-pipelines/decisions/ADR-028-profile-lifecycle.md) | Profile Lifecycle (Connect/Disconnect) | Accepted | Dashboard |
| [029](../specs/compliance-pipelines/decisions/ADR-029-cyclonedx-normalizer.md) | CycloneDX Normalizer Pattern | Accepted | Supply Chain |
| [030](../specs/compliance-pipelines/decisions/ADR-030-per-host-normalization.md) | Per-Host Normalization | Accepted | All Profiles |
| [031](../specs/compliance-pipelines/decisions/ADR-031-pah-for-execution-environments.md) | PAH for Execution Environments | Accepted | Infrastructure |
| [032](../specs/compliance-pipelines/decisions/ADR-032-pluggable-export-formats.md) | Pluggable Export Formats + OCI Artifact Storage | Accepted | Dashboard + Supply Chain |
| [033](../specs/compliance-pipelines/decisions/ADR-033-file-streamed-api-ingestion.md) | File-Streamed API Ingestion | Accepted | Supply Chain (XCCDF planned) |
| [034](../specs/compliance-pipelines/decisions/ADR-034-ndjson-content-type-negotiation.md) | NDJSON Content-Type Negotiation | Accepted | All Profiles |

## Feature Specs

All feature specs are in [`specs/compliance-pipelines/features/`](../specs/compliance-pipelines/features/).

| Spec | Feature |
|------|---------|
| [feature-supply-chain-vulnerability-scanning.md](../specs/compliance-pipelines/features/feature-supply-chain-vulnerability-scanning.md) | Supply Chain: Syft/Grype SBOM scanning |
| [feature-remediation-lifecycle.md](../specs/compliance-pipelines/features/feature-remediation-lifecycle.md) | Remediation execution tracking and chain view |
| [feature-platform-guards.md](../specs/compliance-pipelines/features/feature-platform-guards.md) | Pre-launch inventory validation |
| [feature-failed-scan-error-details.md](../specs/compliance-pipelines/features/feature-failed-scan-error-details.md) | Real error details for failed scans |
| [feature-finding-level-states.md](../specs/compliance-pipelines/features/feature-finding-level-states.md) | Finding lifecycle states (new/active/fixed/resurfaced) |
| [feature-ingest-token-hardening.md](../specs/compliance-pipelines/features/feature-ingest-token-hardening.md) | Per-scan ingest token security |
| [feature-edit-compliance-profile.md](../specs/compliance-pipelines/features/feature-edit-compliance-profile.md) | Edit registered compliance profiles |

## Developer Guides

| Guide | Audience |
|-------|----------|
| [compliance-profile-developer-guide.md](compliance-profile-developer-guide.md) | Building new compliance profiles (1-3 tiers, CFF, normalizers, EEs, custom tabs) |
| [standalone-deployment.md](standalone-deployment.md) | Standalone deployment for internal testing and demos |
| [deployment-guide.md](deployment-guide.md) | Deploying plugins to Portal/RHDH |
| [manual-testing-supply-chain.md](manual-testing-supply-chain.md) | Manual testing checklist (69 steps, Netrunner live + mock) |
| [handover-guide.md](handover-guide.md) | Project handover documentation |
| [windows-compliance-profile-assessment.md](windows-compliance-profile-assessment.md) | Windows Server STIG assessment feasibility |

## Profile Documentation

| Profile | Framework | README |
|---------|-----------|--------|
| rhel9-stig | DISA STIG V2R8 | [profiles/rhel9-stig/README.md](../profiles/rhel9-stig/README.md) |
| rhel9-cis-l1 | CIS Benchmark L1 | [profiles/rhel9-cis-l1/README.md](../profiles/rhel9-cis-l1/README.md) |
| rhel9-cis-l2 | CIS Benchmark L2 | [profiles/rhel9-cis-l2/README.md](../profiles/rhel9-cis-l2/README.md) |
| supply-chain | Supply Chain (SBOM) | [profiles/supply-chain/README.md](../profiles/supply-chain/README.md) |

## Formal Documentation (AsciiDoc)

Product documentation modules in [`docs/modules/`](modules/):

| Module | Type | Topic |
|--------|------|-------|
| [con-about-compliance-pipelines.adoc](modules/con-about-compliance-pipelines.adoc) | Concept | What compliance pipelines are |
| [proc-configure-compliance-pipeline.adoc](modules/proc-configure-compliance-pipeline.adoc) | Procedure | Configuration steps |
| [proc-oscap-scan-architecture.adoc](modules/proc-oscap-scan-architecture.adoc) | Procedure | Scanner architecture |
| [proc-run-compliance-scan.adoc](modules/proc-run-compliance-scan.adoc) | Procedure | Running a scan |
| [ref-compliance-pipeline-configuration.adoc](modules/ref-compliance-pipeline-configuration.adoc) | Reference | Configuration options |
| [ref-compliance-pipeline-resources.adoc](modules/ref-compliance-pipeline-resources.adoc) | Reference | Controller resources |
| [ref-oscap-requirements.adoc](modules/ref-oscap-requirements.adoc) | Reference | OpenSCAP requirements |
