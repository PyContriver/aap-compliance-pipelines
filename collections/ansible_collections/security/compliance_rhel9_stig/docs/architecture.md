# Architecture: OpenSCAP Scan Pipeline

This document describes how the `security.compliance_rhel9_stig` collection scans targets, normalizes results, and connects to the Backstage compliance plugin.

## Pipeline Overview

```
Target hosts (RHEL 9)              Execution node (EE)
+--------------------------+       +---------------------------+
| 1. Install oscap         |       |                           |
|    (if missing)          |       |                           |
| 2. Receive datastream    |<-copy-| scap-security-guide       |
|    (ssg-rhel9-ds.xml)    |       | (ssg-rhel9-ds.xml, ~15MB) |
| 3. oscap xccdf eval      |       |                           |
|    --profile stig        |       |                           |
| 4. Return XCCDF XML     |-fetch->| 5. normalize_xccdf        |
| 5. Cleanup               |       |    (XML -> CFF JSON)      |
| 6. Remove oscap          |       | 6. compliance_report.json |
|    (if we installed it)  |       |                           |
+--------------------------+       +---------------------------+
                                            |
                                            v
                                   +-----------------+
                                   | Backstage plugin|
                                   | (reads CFF JSON |
                                   |  from job events)|
                                   +-----------------+
```

## Single-JT Assessment

The assessment uses a single job template (`compliance-run-oscap`) running `run_oscap.yml`, which contains two plays in one JT:

| Play | Runs On | Purpose |
|------|---------|---------|
| Play 1 | Target hosts | Scan with oscap, fetch XCCDF XML back to execution node |
| Play 2 | localhost (same container) | Parse XML, output CFF JSON |

Remediation is **not** part of the assessment. It is a separate JT launched directly by the Backstage plugin with `job_tags` for scoped rule selection.

### Why a Single JT with 2 Plays?

1. **oscap must run on the target** -- it inspects local system state (file permissions, service configs, kernel parameters).
2. **Normalization runs on localhost** -- it parses XML with Python's `xml.etree.ElementTree`, needs the datastream for rule metadata lookup, and writes findings as an Ansible fact for the backend to consume.
3. **Same container** -- both plays run in the same container, so Play 1's fetched XCCDF XML files are available to Play 2 on the local filesystem. A multi-node workflow would fail because each workflow node runs in a separate container and fetched files are not shared.
4. **Separation preserves data** -- if oscap runs on 50 hosts but normalization fails, the fetched XML files are preserved for debugging.

### Why Remediation Is Separate

The gap between assessment and remediation is where intelligence lives:

- **Human-supervised**: Operator reviews findings, selects rules, launches remediation
- **EDA-automated**: Rulebook evaluates findings, conditionally triggers remediation
- **Future autonomous**: AI agent decides remediation scope

A 3-node workflow would eliminate this decision point.

## Data Flow Detail

### Play 1: OpenSCAP on Targets (`run_oscap.yml`, Play 1)

The playbook runs on each target host:

1. **Check for oscap** -- `rpm -q openscap-scanner`
2. **Install if missing** -- `dnf install openscap-scanner`; set `_oscap_was_missing` flag
3. **Copy datastream** -- The EE has `ssg-rhel9-ds.xml` at `/usr/share/xml/scap/ssg/content/`. The `copy` module sends it to `/tmp/ssg-rhel9-ds.xml` on the target.
4. **Run evaluation** -- `oscap xccdf eval --profile xccdf_org.ssgproject.content_profile_stig --results /tmp/compliance-scan/xccdf-results.xml /tmp/ssg-rhel9-ds.xml`
   - Exit code 0 = all rules pass
   - Exit code 2 = some rules fail (expected for most hosts)
   - Exit code 1 = error (fails the task)
5. **Fetch results** -- `fetch` module copies results XML to `/tmp/compliance-results/xccdf-results-<hostname>.xml` on the EE
6. **Cleanup** -- Remove datastream and results from target; remove `openscap-scanner` if we installed it

### Play 2: Normalize on localhost (`run_oscap.yml`, Play 2)

Play 2 runs on `localhost` in the same container as Play 1:

1. **Find result files** -- Glob for `xccdf-results-*.xml` in the results directory
2. **Call `normalize_xccdf` module** -- Parses each XML file:
   - Builds a rule metadata lookup from the `<Benchmark>` element in the XCCDF
   - Iterates `<rule-result>` elements in the `<TestResult>`
   - Strips `xccdf_org.ssgproject.content_rule_` prefix from rule IDs
   - Maps severity (high/medium/low) to CAT_I/CAT_II/CAT_III
   - Maps status (pass/fail/error/notapplicable/notchecked) to CFF values
   - Extracts title, description, fix_text, stig_id from rule metadata
3. **Set `compliance_report` fact** -- The backend reads this from job events
4. **Write JSON artifact** -- `/tmp/compliance_report.json`

### Plugin Consumption

The Backstage backend polls Controller for job events from the assessment job. It reads the `compliance_report` Ansible fact from Play 2's normalize task, which contains CFF-compliant findings. The frontend renders these findings with no knowledge of the underlying scanner.

## OpenSCAP Integration Details

### SCAP Security Guide

The `scap-security-guide` RPM (installed in the EE) provides:

- **Datastream**: `ssg-rhel9-ds.xml` -- the XCCDF benchmark with 366 STIG rules, check definitions, and fix text
- **CaC playbook**: `rhel9-playbook-stig.yml` -- Ansible remediation for every STIG rule, tagged with rule IDs

### Rule ID Prefix Stripping

XCCDF rule IDs are fully qualified:

```
xccdf_org.ssgproject.content_rule_sshd_set_keepalive_0
```

The normalizer strips the prefix to produce:

```
sshd_set_keepalive_0
```

This short ID matches:
- The CaC playbook tag (for remediation)
- The `evidence.scanner_rule_id` field (for traceability)
- The Backstage findings display

### Metadata Extraction

All rule metadata comes directly from the XCCDF datastream. No external rules YAML is needed:

| CFF Field | XCCDF Source |
|-----------|-------------|
| `title` | `<Rule><title>` |
| `description` | `<Rule><description>` (truncated to 500 chars) |
| `fix_text` | `<Rule><fixtext>` (truncated to 500 chars) |
| `severity` | `<Rule severity="...">` attribute |
| `stig_id` | `<Rule><ident>` where text starts with `V-` |

## CFF Connection to Backstage Plugin

The Common Findings Format (CFF) is the integration contract. The plugin consumes CFF JSON regardless of which scanner produced it. Key CFF fields used by the plugin:

| CFF Field | Plugin Usage |
|-----------|-------------|
| `rule_id` | Findings table, remediation tag matching |
| `status` | Pass/fail gauges, compliance score |
| `severity` | Severity breakdown charts, CAT I/II/III counts |
| `title` | Findings list display |
| `description` | Finding detail panel |
| `fix_text` | Remediation guidance display |
| `stig_id` | STIG reference column |
| `host` | Multi-host result grouping |

For the full CFF schema, see the [Compliance Profile Developer Guide](../../../../docs/compliance-profile-developer-guide.md).
