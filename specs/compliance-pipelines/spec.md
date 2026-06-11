# Feature Specification: Compliance Pipelines

**Feature Branch**: `compliance-pipelines`
**Created**: 2026-04-23
**Status**: Active — Production MVP (all P1 complete, remediation lifecycle shipped with baseline scoring + chain view, 467 tests, 23 ADRs, deployed to Netrunner)
**Input**: User description: "End-to-end compliance pipeline experience (scan, review, remediate, verify) for regulated infrastructure within the Ansible Automation Platform Portal"
**Related**: ANSTRAT-1670 (Evolve Ansible Content — Initiative 3: Strategic Domain Content), ANSTRAT-1285 (Pattern Loading Service), ANSTRAT-1534 (Content Discovery), ANSTRAT-2122 (Skill Content Type)
**Research**: Competitor Analysis, Content Delivery Strategy, Jira Feature Template Analysis <!-- Original links removed: prototypes/compliance-pipelines/context/ directory no longer exists -->

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin Adds a Compliance Profile (Priority: P1)

Before compliance scanning can begin, a platform administrator must add a compliance profile — a mapping between a compliance standard (e.g., RHEL 9 DISA STIG), the Execution Environment that contains the scanner tooling and remediation content, and the AAP assessment job template that orchestrates the scan-and-normalize pipeline. Without this registration, the portal has no knowledge of what compliance standards are available or how to invoke them.

**Why this priority**: This is the foundational configuration step. No compliance profile registered means no scan profiles available, no scan launches possible, and no compliance functionality of any kind. Every other user story depends on at least one compliance profile being registered.

**Independent Test**: Log in as a platform administrator, navigate to Compliance > Settings, add a new compliance profile by selecting an EE, mapping it to an assessment job template, and assigning a compliance profile name. Verify the compliance profile appears in the profile browser and is available for scan launches.

**Acceptance Scenarios**:

1. **Given** a portal with the compliance plugin installed but no compliance profiles registered, **When** an admin navigates to Compliance > Settings, **Then** they see an empty state with instructions to add a compliance profile and an "Add Compliance Profile" button
2. **Given** the compliance profile registration form (discovery-first layout), **When** the admin selects an assessment job template from a dropdown that fetches both JTs and WJTs via the AAP Gateway API, **Then** the system auto-populates the EE, display name, and standard ID from the selected template's metadata, presenting a confirmation dialog before saving. The form supports both Job Templates and Workflow Job Templates transparently
3. **Given** a registered compliance profile, **When** the admin views the compliance profile details, **Then** they see the EE name, assessment job template name, compliance standard, creation date, and a status indicator showing whether the EE and job template are still accessible via the AAP Gateway
4. **Given** one or more registered compliance profiles, **When** any user navigates to the compliance profile browser or compliance dashboard, **Then** all registered profiles appear with certification badges (certified/conformant/uncertified) on all surfaces including the scan launcher, regardless of whether they have been scanned

---

### User Story 2 - Admin Launches a Compliance Scan from the Portal (Priority: P1)

Platform administrators need to initiate compliance scans against target infrastructure directly from the portal without requiring AAP Controller expertise or CLI access. The scan must invoke the correct AAP assessment job template using the EE and content specified by the selected compliance profile, targeting hosts specified by the administrator.

**Why this priority**: Scanning is the entry point for the entire compliance pipeline. Without the ability to launch scans from the portal, users must fall back to the Controller UI or CLI, eliminating the value of the portal integration entirely.

**Independent Test**: Select a registered compliance profile, choose target hosts from an inventory, launch a scan, and verify that the corresponding AAP job is created and executes against the selected hosts.

**Acceptance Scenarios**:

1. **Given** at least one registered compliance profile, **When** the admin clicks "Launch Scan" from the compliance dashboard, **Then** they see a scan configuration form with fields for: compliance profile (dropdown of registered compliance profiles), target inventory or host pattern, and optional scan parameters
2. **Given** a completed scan configuration form, **When** the admin clicks "Start Scan", **Then** the portal invokes the mapped AAP assessment job template via the Gateway API with the appropriate inventory and extra variables, and displays a progress indicator linking to the active job
3. **Given** a scan is in progress, **When** the admin views the compliance dashboard, **Then** they see the active scan with real-time status (pending, running, completed, failed) pulled from the AAP Gateway API job status endpoint
4. **Given** a scan completes successfully, **When** the admin views the scan results, **Then** parsed findings are stored in the compliance database with per-host, per-rule detail and the scan appears in the scan history list

---

### User Story 3 - Security Officer Reviews Scan Findings with Host-Level Detail (Priority: P1)

Security officers and compliance auditors need to review scan findings at both the rule level and the host level. A single STIG rule may pass on most hosts but fail on a few — the officer needs to see exactly which hosts failed, what the actual non-compliant values are, and how those values compare to the expected baseline. This granularity is essential for making informed remediation decisions.

**Why this priority**: Compliance review is the critical decision-making step between scanning and remediation. Without host-level detail, administrators cannot distinguish between a rule that failed on all 500 hosts versus one that failed on 2 outlier hosts — leading to either over-remediation (unnecessary risk) or under-remediation (compliance gaps).

**Independent Test**: After a completed scan against 5+ hosts, navigate to the findings view, verify that each finding shows per-host pass/fail counts, expand a failing finding to see individual host results with actual values, and confirm that severity categorization (CAT I/II/III) is correctly displayed.

**Acceptance Scenarios**:

1. **Given** a completed scan with findings, **When** a security officer navigates to the scan results page, **Then** they see findings organized by severity (CAT I / CAT II / CAT III) with summary counts showing total rules checked, passed, failed, and not applicable
2. **Given** the findings list, **When** the officer views a specific finding, **Then** they see the rule ID, title, description, severity category, pass/fail counts per host (e.g., "18/20 pass, 2/20 fail"), and the expected baseline value
3. **Given** a finding with mixed host results, **When** the officer expands the host detail view, **Then** they see each host listed with its compliance status (pass/fail/error/not-applicable) and the actual observed value on that host (e.g., "host-2: TMOUT=300, expected: 600")
4. **Given** the findings view, **When** the officer filters by severity category or compliance status (pass/fail), **Then** the findings list updates to show only matching results and the summary counts reflect the filtered set
5. **Given** a finding that failed on a small subset of hosts, **When** the officer views the host detail, **Then** the portal displays a homogeneity advisory suggesting the outlier hosts may belong to a different inventory or require a separate remediation

---

### User Story 4 - Admin Builds a Remediation with Selective Rule Toggles (Priority: P1)

After reviewing scan findings, platform administrators need to build a remediation that specifies exactly which failing rules to remediate, which hosts to target, and what parameter values to apply. Not all failing rules should be remediated — some may have business justifications for non-compliance, and some parameter values may need to differ from the benchmark default. The remediation captures these institutional decisions.

**Why this priority**: This is the core differentiator of the compliance pipeline. Competitors (Puppet SCE, Chef Compliance) offer all-or-nothing remediation. The ability to selectively toggle individual rules, override parameter values, and choose between "remediate failed only" versus "standardize all hosts" is the key UX innovation that justifies building this as a portal feature rather than using raw Ansible playbooks.

**Independent Test**: From scan findings, toggle individual rules on/off for remediation, override a parameter value on one rule, select "remediate failed hosts only" for another, and verify the resulting remediation accurately reflects these selections when previewed.

**Acceptance Scenarios**:

1. **Given** a completed scan with findings, **When** the admin clicks "Build Remediation", **Then** they see the remediation builder showing all failing rules with toggles to include/exclude each rule from remediation, defaulting to all rules included
2. **Given** the remediation builder, **When** the admin toggles a rule off, **Then** that rule is excluded from the remediation plan and visually marked as skipped with an optional text field for the justification
3. **Given** a rule included in remediation, **When** the admin clicks the rule detail, **Then** they see options for: remediation scope ("Failed hosts only" or "All hosts — standardize"), parameter value override (pre-filled with the benchmark default, editable), and a preview of which hosts will be affected
4. **Given** a remediation with mixed selections (some rules on, some off, some with parameter overrides), **When** the admin clicks "Preview Plan", **Then** they see a summary showing the total number of rules to remediate, total hosts affected, and a matrix of rule-by-host actions that will be taken
5. **Given** a completed remediation, **When** the admin reviews the execution plan, **Then** the plan uses dynamic host grouping (hosts grouped by remediation need) rather than individual per-host-per-rule jobs, demonstrating scalable execution architecture

---

### User Story 5 - Admin Executes Remediation Against Selected Hosts (Priority: P2)

After building and reviewing a remediation, the administrator needs to execute the remediation against the targeted hosts. Execution must use the AAP workflow engine with appropriate job parameters derived from the remediation, including `--limit` for host targeting, `--tags` for selective rule application, and `--extra-vars` for parameter overrides.

**Why this priority**: Execution is essential for completing the compliance loop, but it is logically dependent on the remediation builder (P1). The remediation execution workflow already exists in AAP — the portal's job is to translate remediation decisions into the correct workflow invocation parameters.

**Independent Test**: Build a remediation with selective rules and parameter overrides, execute it, verify the correct AAP workflow job is launched with the appropriate limit, tags, and extra variables, and confirm a verification re-scan is triggered after remediation completes.

**Acceptance Scenarios**:

1. **Given** a completed remediation, **When** the admin clicks "Execute Remediation", **Then** the portal displays a confirmation dialog showing the number of rules, number of hosts, estimated execution time, and a warning that this will modify target host configurations
2. **Given** the admin confirms execution, **When** the portal launches the remediation, **Then** it invokes the mapped AAP workflow remediate node via the Gateway API with `--limit` set to the target hosts, `--tags` matching the selected rules, and `--extra-vars` containing any parameter overrides
3. **Given** remediation is in progress, **When** the admin views the compliance dashboard, **Then** they see real-time progress of the remediation job with per-host status updates
4. **Given** remediation completes successfully, **When** the workflow finishes, **Then** the portal automatically triggers a verification re-scan against the remediated hosts using the same compliance profile, and the new scan results are compared against the pre-remediation baseline
5. **Given** the verification re-scan completes, **When** the admin views the results, **Then** they see a before/after comparison showing which findings were resolved, which persist, and the overall compliance posture improvement

---

### User Story 6 - Admin Saves and Reuses Remediations (Priority: P2)

Remediations encode institutional knowledge — which rules to enforce, which to skip, and what parameter values to use. Administrators need to save remediations as named, reusable artifacts so that remediation decisions made during one scan cycle carry forward to future scans without repeating the triage process.

**Why this priority**: Remediation reuse is critical for operational efficiency in environments with regular compliance scan cycles (monthly, quarterly). Without persistence, administrators waste time re-making the same decisions every cycle and risk inconsistent remediation across scan periods.

**Independent Test**: Build a remediation, save it with a name and description, run a new scan, apply the saved remediation to the new findings, and verify the same rule selections and parameter overrides are applied without manual re-entry.

**Acceptance Scenarios**:

1. **Given** a completed remediation, **When** the admin clicks "Save Remediation", **Then** they are prompted for a name, description, and optional tags, and the remediation is persisted to the compliance database
2. **Given** saved remediations exist, **When** the admin navigates to Compliance > Remediations, **Then** they see a list of saved remediations with name, compliance standard, creation date, last used date, and number of rules configured
3. **Given** a new scan has completed with findings, **When** the admin clicks "Apply Remediation" and selects a saved remediation, **Then** the remediation builder pre-populates with the saved selections (rule toggles, parameter overrides, scope settings) and highlights any new findings not covered by the saved remediation
4. **Given** a saved remediation applied to new findings, **When** new rules appear that were not in the original remediation, **Then** those new rules are flagged as "Unreviewed" and default to included, requiring explicit admin decision

---

### User Story 7 - Admin Exports Findings for Auditors (Priority: P2)

Security officers and compliance auditors need to export scan findings and remediation status in standard formats (CSV, JSON) for integration with external audit workflows, GRC platforms, and compliance reporting tools. Exports must include sufficient detail to satisfy auditor evidence requirements.

**Why this priority**: External audit integration is a common enterprise requirement but does not block the core scan-review-remediate workflow. Auditors can initially review findings in the portal UI, with export capability added to streamline recurring audit cycles.

**Independent Test**: Complete a scan, navigate to findings, click "Export", select CSV format, and verify the downloaded file contains all findings with rule ID, title, severity, host-level pass/fail status, actual values, and timestamps.

**Acceptance Scenarios**:

1. **Given** a completed scan with findings, **When** the admin clicks "Export Findings", **Then** they see format options (CSV, JSON) and scope options (all findings, filtered findings, selected findings only)
2. **Given** CSV export selected, **When** the admin clicks "Download", **Then** a CSV file is generated containing columns for: scan ID, scan date, rule ID, rule title, severity (CAT I/II/III), host, compliance status, actual value, expected value, and remediation status
3. **Given** JSON export selected, **When** the admin clicks "Download", **Then** a JSON file is generated with a structured schema including scan metadata, finding details, host-level results, and remediation associations
4. **Given** an export in either format, **When** the exported data is reviewed, **Then** it contains no secrets, tokens, or internal infrastructure details beyond hostname and compliance status

---

### User Story 8 - Event-Driven Compliance Scan Triggered by Infrastructure Change (Priority: P3)

Automation architects need infrastructure changes (new host provisioned, configuration drift detected, patch applied) to automatically trigger compliance scans via Event-Driven Ansible (EDA). When a relevant event occurs, an EDA rulebook should trigger the compliance scan workflow using a predefined compliance profile, with results flowing into the same findings database and dashboard as manually launched scans.

**Why this priority**: Event-driven compliance is a strategic differentiator over competitors (neither Puppet SCE nor Chef Compliance offer event-triggered scanning), but it depends on EDA integration maturity and is not required for the core manual workflow. This extends the compliance pipeline from periodic to continuous.

**Independent Test**: Configure an EDA rulebook that triggers on a webhook event, fire the webhook to simulate an infrastructure change, and verify that a compliance scan is automatically launched against the affected hosts with findings appearing in the compliance dashboard.

**Acceptance Scenarios**:

1. **Given** a registered compliance profile and a configured EDA rulebook, **When** an infrastructure change event is received by EDA (e.g., new host added to inventory, configuration drift webhook), **Then** EDA triggers the compliance scan workflow via the AAP Gateway API using the mapped compliance profile
2. **Given** an event-driven scan is triggered, **When** the scan completes, **Then** the findings are stored in the same compliance database and appear in the same dashboard as manually launched scans, with the trigger source marked as "event-driven" rather than "manual"
3. **Given** continuous event-driven scanning is active, **When** multiple events arrive within a configurable cooldown window (e.g., 5 minutes), **Then** they are batched into a single scan rather than triggering redundant concurrent scans
4. **Given** event-driven scanning, **When** a scan finds CAT I (critical) failures, **Then** the portal can optionally trigger an automatic remediation using a saved remediation if the compliance profile is configured for auto-remediation mode

---

### Edge Cases

- **Compliance profile with deleted EE**: What happens when the EE referenced by a registered compliance profile is deleted from AAP? The compliance profile status indicator shows "EE unavailable," scan launches using that compliance profile are blocked with a clear error message, and the admin is directed to update the compliance profile mapping
- **Scan against empty inventory**: What happens when a scan is launched against an inventory with zero reachable hosts? The AAP workflow completes with zero findings, the portal displays "No hosts reachable" with the inventory name, and the scan is recorded in history with a "no results" status
- **Partial host failures**: What happens when a scan succeeds on 18 of 20 hosts but 2 hosts are unreachable? Findings are stored for the 18 successful hosts, the 2 unreachable hosts are listed with "unreachable" status, and the scan is marked "completed with warnings"
- **Concurrent scans same hosts**: What happens when two scans target overlapping hosts simultaneously? Both scans proceed independently (AAP handles job isolation), but the portal shows a warning on the second scan launch and stores findings from both scans with distinct scan IDs and timestamps
- **Profile applied to different standard**: What happens when a saved STIG remediation is applied to CIS scan findings? The portal warns that the remediation was built for a different compliance standard, shows unmatched rules as "Not applicable", and allows the admin to proceed with only the matching rules
- **Remediation with no failing hosts**: What happens when an admin tries to execute a remediation but all hosts now pass? The portal shows "No remediation needed — all targeted hosts are compliant" and logs the no-op execution for audit purposes
- **Export of large result sets**: What happens when exporting findings from a scan of 10,000+ hosts? Export is processed asynchronously with a download link provided when complete, with a maximum export size of 100MB
- **EDA event flood**: What happens when EDA receives hundreds of events per minute? The cooldown window batches events, a maximum concurrent scan limit prevents resource exhaustion, and events exceeding the limit are queued with FIFO ordering

## Requirements _(mandatory)_

### Functional Requirements

#### Compliance Profile Registration

- **FR-001**: System MUST provide a compliance profile registration interface where administrators map a compliance standard name, an Execution Environment, and an AAP assessment job template into a reusable scanning configuration
- **FR-002**: System MUST validate that the referenced EE and assessment job template are accessible via the AAP Gateway API before accepting a compliance profile registration
- **FR-003**: System MUST display registered compliance profiles with status indicators reflecting the current accessibility of the mapped EE and assessment job template
- **FR-004**: System MUST allow administrators to update or delete compliance profile registrations

#### Scan Execution

- **FR-005**: System MUST allow administrators to launch compliance scans by selecting a registered compliance profile, specifying target hosts or inventory, and providing optional scan parameters
- **FR-006**: System MUST invoke the AAP assessment job template mapped by the selected compliance profile via the AAP Gateway API, passing the target inventory and extra variables (single JT with 2 plays: scan targets + normalize on localhost). The system MUST handle both Job Templates (JTs) and Workflow Job Templates (WJTs) transparently — scan launch, status polling, progress tracking, and event parsing all adapt to the template type automatically (JT fallback pattern)
- **FR-007**: System MUST track scan progress by polling the AAP Gateway API for job status and display real-time status updates in the portal. For WJTs, the system polls workflow job nodes; for JTs, the system polls the job directly. Double-click prevention on the scan launch button MUST prevent duplicate submissions
- **FR-008**: System MUST receive scan findings (via Direct POST from the assessment JT or by parsing Controller job events as a fallback) into structured per-host, per-rule format and persist them to the compliance database. A `parseInProgress` guard MUST prevent duplicate findings from parallel event parsing

#### Findings Review

- **FR-009**: System MUST display scan findings organized by severity category (CAT I, CAT II, CAT III) with summary pass/fail counts
- **FR-010**: System MUST display per-host compliance status for each finding, including the actual observed value on each host
- **FR-011**: System MUST support filtering findings by severity, compliance status, and rule ID. Findings tables MUST use the column header "Rule ID" (not "STIG ID") for framework-neutral display across STIG, CIS, and other compliance frameworks
- **FR-012**: System MUST display homogeneity advisories when a small subset of hosts fails a rule that passes on the majority

#### Remediation Builder

- **FR-013**: System MUST provide a remediation builder that allows administrators to toggle individual rules on/off for remediation
- **FR-014**: System MUST support per-rule remediation scope selection: "Failed hosts only" or "All hosts (standardize)"
- **FR-015**: System MUST support per-rule parameter value overrides, pre-populated with the benchmark default value
- **FR-016**: System MUST generate an execution plan preview showing the matrix of rules, hosts, and parameter values before remediation
- **FR-017**: System MUST use dynamic host grouping for execution (hosts grouped by remediation need) rather than individual per-host-per-rule jobs

#### Remediation Execution

- **FR-018**: System MUST execute remediation by launching the remediation job template directly (not through a workflow) with `--limit`, `--tags`, and `--extra-vars` derived from the remediation (see ADR-009)
- **FR-019**: System MUST trigger a verification re-scan after remediation completes and display before/after comparison
- **FR-020**: System MUST display real-time remediation progress with per-host status updates
- **FR-020a**: System MUST fetch error details live from Automation Controller for failed remediation executions. Error details MUST include Ansible task tracebacks, per-host per-task failures, and pre-start failures (project sync, inventory, credentials). The system MUST support fetching error details for up to 20 job IDs in a single request with parallel Controller API calls.

#### Profile Management

- **FR-021**: System MUST allow administrators to save remediations as named, reusable artifacts with description and tags
- **FR-022**: System MUST allow administrators to apply a saved remediation to new scan findings, pre-populating selections and highlighting unreviewed new rules
- **FR-023**: System MUST track profile usage history (last used, scan associations)

#### Export

- **FR-024**: System MUST support exporting scan findings in CSV and JSON formats
- **FR-025**: Exports MUST include scan metadata, rule details, severity, per-host compliance status, actual values, and timestamps
- **FR-026**: Exports MUST NOT contain secrets, tokens, or sensitive infrastructure details beyond hostname and compliance data

#### Event-Driven Integration

- **FR-027**: System MUST support EDA-triggered compliance scans using registered compliance profiles
- **FR-028**: System MUST batch rapid-fire events within a configurable cooldown window to prevent redundant concurrent scans
- **FR-029**: Event-driven scan findings MUST be stored in the same database and appear in the same dashboard as manual scan findings

#### UX and Display

- **FR-033**: Dashboard MUST display all registered compliance profiles with certification badges (certified/conformant/uncertified) regardless of whether scans have been run against them. The `CertificationBadge` is a shared component used on all surfaces: dashboard, profile browser, scan launcher, and findings viewer
- **FR-034**: Settings form MUST use a discovery-first layout where the admin selects a job template first, and the system auto-populates EE, display name, and standard ID from the template's metadata. A confirmation dialog presents the auto-populated values before saving
- **FR-035**: When fetching error details for failed scans, the system MUST fall back to parsing job stdout when structured event data is unavailable (catches Ansible parse errors and other non-structured failures)

#### Security and Access Control

- **FR-030**: System MUST authenticate all AAP Gateway API calls using per-user tokens passed via the `x-aap-token` header
- **FR-031**: System MUST use existing Backstage catalog entity permissions for access control rather than custom permission types
- **FR-032**: All API calls to AAP MUST route through the AAP Gateway URL, not directly to the Controller

### Key Entities _(include if feature involves data)_

- **Compliance Profile**: A registered mapping between a compliance standard, an Execution Environment, and an AAP assessment job template. Attributes: display name, compliance standard identifier (e.g., `rhel9-stig-v2r8`), EE reference (id, name), assessment job template reference (id, name), status (active, ee-unavailable, jt-unavailable), created/updated timestamps
- **Compliance Scan**: A single execution of a compliance assessment against target hosts. Attributes: scan ID, compliance profile reference, target inventory/host pattern, trigger source (manual, event-driven), AAP workflow job ID, status (pending, running, completed, failed, completed-with-warnings), start/end timestamps
- **Compliance Finding**: A single rule evaluation result for a specific host. Attributes: scan reference, rule ID, rule title, description, severity (CAT I/II/III), host, compliance status (pass, fail, error, not-applicable), actual value, expected value, check type
- **Remediation**: A saved set of remediation decisions. Attributes: name, description, tags, compliance standard, rule selections (per-rule: included/excluded, scope, parameter override, justification), creation date, last used date, associated scan IDs
- **Posture Record**: A point-in-time compliance summary for dashboard and trend reporting. Attributes: scan reference, total rules, passed, failed, not-applicable, error, host count, compliance percentage, timestamp

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Platform administrators can add a compliance profile (EE + workflow mapping) and launch a scan from the portal in under 5 minutes without AAP Controller UI access
- **SC-002**: Scan findings display per-host, per-rule detail including actual observed values — not just aggregate pass/fail percentages
- **SC-003**: Remediation builder supports selective rule toggling, parameter overrides, and scope selection (failed-only vs standardize-all) for individual rules
- **SC-004**: Remediation execution uses dynamic host grouping, generating no more than N jobs for N distinct remediation configurations regardless of host count (scales to 20,000+ hosts without creating per-host jobs)
- **SC-005**: Saved remediations can be applied to new scan results, pre-populating prior decisions and flagging new unreviewed rules
- **SC-006**: Scan findings are exportable in CSV and JSON formats with per-host detail suitable for auditor evidence packages
- **SC-007**: Verification re-scan runs automatically after remediation and provides before/after compliance posture comparison
- **SC-008**: Event-driven scans triggered via EDA produce findings indistinguishable from manual scans in the portal dashboard
- **SC-009**: All AAP API calls route through the Gateway URL using per-user tokens — zero direct Controller API calls from the portal
- **SC-010**: Compliance data (findings, profiles, posture history) persists in Backstage PostgreSQL and survives portal restarts with clean removal via down migrations

## Assumptions

- AAP 2.6+ is deployed and accessible via the AAP Gateway URL with OAuth2 authentication configured
- The Ansible Portal (RHDH/Backstage) is the frontend hosting environment with the compliance plugin installed as a dynamic plugin
- ComplianceAsCode remediation content (`scap-security-guide` RPM) is available in the Execution Environment and provides the remediation playbooks — the compliance plugin does not author remediation content
- Compliance profiles use the collection + EE packaging model: an Ansible collection (e.g., `security.compliance_rhel9_stig`) ships an EE profile definition, and the EE Builder constructs the EE from it
- AAP job templates for compliance pipelines (assessment JT running `run_oscap.yml` with 2 plays, remediation JT running `remediate.yml`) are pre-created in the Controller before compliance profile registration (see ADR-003, ADR-009)
- The AAP Gateway is the sole API entry point — direct Controller API access is not used (aligns with AAP 2.7+ architecture)
- Backstage PostgreSQL is available for compliance data persistence (findings, remediations, posture history, compliance profile registry)
- Per-user AAP tokens are available via the `x-aap-token` header pattern established by the Portal authentication flow
- OpenSCAP is the Tier 1 scanner for RHEL STIG/CIS benchmarks; the architecture supports pluggable Tier 2 (BYOS: Qualys, Tenable) and Tier 3 (hybrid) scanners via additional compliance profile types
- EDA integration (User Story 8) depends on EDA Server being deployed and configured with appropriate rulebooks — this is a stretch goal
- The compliance plugin operates as a scanner orchestrator, not a scanner — it invokes existing scanning tools through AAP job templates rather than performing scans directly

## Architecture Decisions

Formal decision records are maintained in [`decisions/`](decisions/):

| ADR | Decision |
|-----|----------|
| [ADR-001](decisions/ADR-001-scanner-orchestrator-architecture.md) | Scanner orchestrator architecture (CFF as contract) |
| [ADR-002](decisions/ADR-002-two-tier-rbac.md) | Two-tier RBAC (Backstage + AAP pass-through) |
| [ADR-003](decisions/ADR-003-single-assessment-jt.md) | Single assessment JT with 2 plays (not 2-node workflow) |
| [ADR-004](decisions/ADR-004-oscap-replaces-custom-evaluate.md) | OpenSCAP replaces custom evaluate module |
| [ADR-005](decisions/ADR-005-slim-findings-for-event-storage.md) | Slim findings for Controller event storage |
| [ADR-006](decisions/ADR-006-self-contained-compliance-profiles.md) | Self-contained compliance profiles |
| [ADR-007](decisions/ADR-007-direct-post-findings.md) | Direct POST findings as future data channel |
| [ADR-008](decisions/ADR-008-oscap-agentless-pattern.md) | OpenSCAP agentless pattern (install/scan/remove) |
| [ADR-009](decisions/ADR-009-cac-remediation-via-direct-jt.md) | CaC remediation via direct JT with job_tags |
| [ADR-010](decisions/ADR-010-per-scan-ingest-token.md) | Per-scan ingest token for findings submission security |
| [ADR-011](decisions/ADR-011-profile-driven-platform-guards.md) | Profile-driven platform guards |
