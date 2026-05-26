# Module Reference: normalize_xccdf

Normalize OpenSCAP XCCDF results to Common Findings Format (CFF) JSON.

## Synopsis

Parses XCCDF result XML files produced by `oscap xccdf eval`, transforms each rule-result into CFF JSON, and aggregates results across multiple hosts. The output is consumed by the Backstage compliance plugin via Controller job events.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `results_files` | list(str) | Yes | List of XCCDF result XML file paths to process |
| `output_file` | str | Yes | Path to write the normalized JSON output |

## Return Values

| Key | Type | Description |
|-----|------|-------------|
| `hosts_processed` | int | Number of hosts whose results were normalized |
| `total_findings` | int | Total number of individual findings across all hosts |
| `summary` | dict | Aggregate pass/fail/error counts |
| `output_file` | str | Path to the written output file |
| `findings` | list | Full list of CFF finding objects (also set as `ansible_facts.compliance_report`) |

### Summary Dict

| Key | Type | Description |
|-----|------|-------------|
| `pass` | int | Rules that passed evaluation |
| `fail` | int | Rules that failed evaluation |
| `error` | int | Rules that encountered an error during evaluation |
| `not_applicable` | int | Rules not applicable to this system |
| `not_checked` | int | Rules that were not evaluated |

## Examples

```yaml
- name: Normalize XCCDF results from a single host
  security.compliance_rhel9_stig.normalize_xccdf:
    results_files:
      - /tmp/compliance-results/xccdf-results-webserver01.xml
    output_file: /tmp/compliance-report.json
  register: normalized
...
```

```yaml
- name: Normalize results from multiple hosts
  security.compliance_rhel9_stig.normalize_xccdf:
    results_files:
      - /tmp/compliance-results/xccdf-results-webserver01.xml
      - /tmp/compliance-results/xccdf-results-dbserver01.xml
      - /tmp/compliance-results/xccdf-results-appserver01.xml
    output_file: /var/lib/compliance/combined-report.json
  register: normalized
...
```

```yaml
- name: Check mode - parse without writing output
  security.compliance_rhel9_stig.normalize_xccdf:
    results_files:
      - /tmp/compliance-results/xccdf-results-webserver01.xml
    output_file: /tmp/compliance-report.json
  check_mode: true
  register: normalized
...
```

```yaml
- name: Display summary after normalization
  ansible.builtin.debug:
    msg: >-
      Processed {{ normalized.hosts_processed }} hosts,
      {{ normalized.total_findings }} findings
      ({{ normalized.summary.pass }} pass, {{ normalized.summary.fail }} fail)
...
```

## CFF Output Schema

The module produces a JSON document conforming to CFF v1.0.0:

```json
{
  "schema_version": "1.0.0",
  "scanner": "openscap",
  "profile": "DISA STIG RHEL 9",
  "timestamp": "",
  "hosts_processed": 3,
  "total_findings": 1098,
  "findings": [
    {
      "rule_id": "sshd_set_keepalive_0",
      "stig_id": "V-257844",
      "title": "Set SSH Client Alive Interval",
      "description": "RHEL 9 must be configured so that...",
      "severity": "CAT_I",
      "status": "fail",
      "host": "webserver01",
      "scanner": "openscap",
      "evidence": {
        "actual": "fail",
        "expected": "pass",
        "message": "OpenSCAP evaluation result: fail"
      },
      "fix_text": "Configure the SSH daemon to...",
      "check_text": "",
      "category": "",
      "disruption": "medium",
      "parameters": []
    }
  ],
  "summary": {
    "pass": 280,
    "fail": 72,
    "error": 0,
    "not_applicable": 14,
    "not_checked": 0
  }
}
```

## Status Mapping

| XCCDF Status | CFF Status |
|-------------|-----------|
| `pass` | `pass` |
| `fail` | `fail` |
| `error` | `error` |
| `unknown` | `error` |
| `notapplicable` | `not_applicable` |
| `notchecked` | `not_checked` |
| `notselected` | `not_applicable` |
| `informational` | `pass` |
| `fixed` | `pass` |

## Severity Mapping

| XCCDF Severity | CFF Severity |
|---------------|-------------|
| `high` | `CAT_I` |
| `medium` | `CAT_II` |
| `low` | `CAT_III` |
| `unknown` | `CAT_II` |

## XCCDF Namespace Support

The module supports both XCCDF 1.1 and 1.2 namespaces:

- `http://checklists.nist.gov/xccdf/1.2` (default for SCAP Security Guide)
- `http://checklists.nist.gov/xccdf/1.1` (legacy)

## Hostname Extraction

Hostnames are extracted from the result filename convention: `xccdf-results-<hostname>.xml`. This convention is established by the `run_oscap.yml` playbook's `fetch` task, which names files as `xccdf-results-{{ inventory_hostname }}.xml`.

## Check Mode

When run with `check_mode: true`, the module parses the XML and computes findings but does not write the output file. This is useful for dry-run validation.
