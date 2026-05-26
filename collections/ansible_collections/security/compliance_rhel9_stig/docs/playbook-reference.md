# Playbook Reference

Detailed usage for each playbook in the `security.compliance_rhel9_stig` collection.

## run_oscap.yml

Run OpenSCAP XCCDF evaluation on target hosts.

**Runs on:** Target hosts (RHEL 9)
**Workflow node:** Node 1 of 2-node assessment workflow

### Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `target_hosts` | `all` | Host pattern for targeting |
| `compliance_profile` | `xccdf_org.ssgproject.content_profile_stig` | XCCDF profile ID |
| `ssg_datastream_ee_path` | `/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml` | Datastream path inside the EE |
| `ssg_datastream_target_path` | `/tmp/ssg-rhel9-ds.xml` | Temporary datastream path on targets |
| `target_results_dir` | `/tmp/compliance-scan` | Temp directory on targets for scan output |
| `fetch_dest_dir` | `/tmp/compliance-results` | Directory on EE for fetched results |

### Usage

```yaml
# Scan all hosts in inventory
ansible-playbook security.compliance_rhel9_stig.run_oscap -i inventory
...
```

```yaml
# Scan specific hosts
ansible-playbook security.compliance_rhel9_stig.run_oscap -i inventory \
    --limit webservers
...
```

```yaml
# Use a different XCCDF profile
ansible-playbook security.compliance_rhel9_stig.run_oscap -i inventory \
    -e 'compliance_profile=xccdf_org.ssgproject.content_profile_cis'
...
```

### What It Does

1. Checks if `openscap-scanner` is installed on each target
2. Installs it via `dnf` if missing (sets cleanup flag)
3. Copies `ssg-rhel9-ds.xml` from the EE to the target
4. Runs `oscap xccdf eval --profile <profile> --results <output> <datastream>`
5. Fetches the XCCDF results XML back to the EE
6. Removes datastream and results from the target
7. Removes `openscap-scanner` if it was installed by this run

### Exit Codes

The `oscap xccdf eval` command uses these exit codes:

| Code | Meaning | Playbook Behavior |
|------|---------|------------------|
| 0 | All rules pass | Success |
| 2 | Some rules fail | Success (expected for most hosts) |
| 1 | Error during evaluation | Task fails |

---

## normalize.yml

Normalize fetched XCCDF results to Common Findings Format JSON.

**Runs on:** Execution node (localhost)
**Workflow node:** Node 2 of 2-node assessment workflow

### Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `results_dir` | `/tmp/compliance-results` | Directory containing fetched XCCDF XML files |
| `output_file` | `/tmp/compliance_report.json` | Path to write the CFF JSON report |

### Usage

```yaml
# Normalize results from the default directory
ansible-playbook security.compliance_rhel9_stig.normalize
...
```

```yaml
# Custom results directory
ansible-playbook security.compliance_rhel9_stig.normalize \
    -e 'results_dir=/var/lib/compliance/results' \
    -e 'output_file=/var/lib/compliance/report.json'
...
```

### What It Does

1. Finds all `xccdf-results-*.xml` files in the results directory
2. Fails if no result files are found
3. Calls the `normalize_xccdf` module to parse each file
4. Sets `compliance_report` as an Ansible fact (consumed by the Backstage backend via job events)
5. Writes the CFF JSON to the output file
6. Displays a summary of pass/fail/error counts

### Output

The module sets these return values:

| Field | Type | Description |
|-------|------|-------------|
| `hosts_processed` | int | Number of hosts whose results were normalized |
| `total_findings` | int | Total findings across all hosts |
| `summary` | dict | Aggregate counts: `pass`, `fail`, `error`, `not_applicable`, `not_checked` |
| `output_file` | str | Path to the written JSON file |

---

## remediate.yml

Apply CaC STIG remediation to target hosts.

**Runs on:** Target hosts (RHEL 9)
**Launched as:** Standalone job template (not a workflow node)

### Variables

CaC variables are passed as `extra_vars` through the job template. Common parameters:

| Variable | Default | Description |
|----------|---------|-------------|
| `var_accounts_tmout` | 600 | Shell timeout in seconds |
| `var_sshd_set_keepalive` | 0 | SSH keepalive interval |
| `var_password_min_len` | 15 | Minimum password length |

See the [SCAP Security Guide variable reference](https://github.com/ComplianceAsCode/content) for the full list.

### Usage

```yaml
# Remediate specific rules (job_tags)
ansible-playbook security.compliance_rhel9_stig.remediate -i inventory \
    --tags "sshd_set_keepalive_0,accounts_tmout"
...
```

```yaml
# Remediate with parameter overrides
ansible-playbook security.compliance_rhel9_stig.remediate -i inventory \
    --tags "accounts_tmout" \
    -e '{"var_accounts_tmout": 900}'
...
```

```yaml
# Remediate all STIG rules (use with caution)
ansible-playbook security.compliance_rhel9_stig.remediate -i inventory
...
```

### How Selective Remediation Works

The remediation playbook imports the CaC playbook from `scap-security-guide`:

```yaml
- name: "Compliance: Apply CaC STIG remediation"
  ansible.builtin.import_playbook: /usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml
```

Each CaC task is tagged with its rule ID. When the Backstage plugin launches the remediation JT with `job_tags=sshd_set_keepalive_0,accounts_tmout`, only tasks tagged with those rule IDs execute.

### Controller Configuration

The remediation JT requires:

| Setting | Value | Why |
|---------|-------|-----|
| `ask_tags_on_launch` | `true` | Plugin passes selected rules as `job_tags` |
| `ask_variables_on_launch` | `true` | Plugin passes parameter overrides as `extra_vars` |
| `ask_inventory_on_launch` | `true` | Plugin passes user-selected inventory |
