# Manual Automation Controller Setup for Compliance Pipeline

> **DEPRECATED (2026-05-26):** This guide describes the original multi-JT workflow architecture (install-scanner, run-scan, fetch-normalize, uninstall-scanner, remediate). The current architecture uses a **single assessment JT** (`compliance-run-oscap` running `run_oscap.yml` with 2 plays) and a **separate remediation JT** (`compliance-remediate` launched directly with `job_tags`). For the current setup instructions, see:
> - [Controller Setup](controller-setup.md) -- current guide with automated and manual options
> - [Deployment Guide](../../../docs/deployment-guide.md) -- current AAP resource requirements
> - [ADR-003](../../../specs/compliance-pipelines/decisions/ADR-003-single-assessment-jt.md) -- single assessment JT rationale
> - [ADR-004](../../../specs/compliance-pipelines/decisions/ADR-004-oscap-replaces-custom-evaluate.md) -- OpenSCAP migration rationale

Step-by-step instructions for manually configuring the automation controller
resources required by the compliance pipeline. Use this guide if you cannot run
the automated `setup_controller.yml` playbook.

## Prerequisites

- Red Hat Ansible Automation Platform 2.6 with admin access
- A container registry accessible from the automation controller (for the compliance EE)
- SSH access to target RHEL 9 hosts
- The compliance pipeline repository cloned or available as a Git URL

## Step 1: Create Organization

1. Navigate to **Access > Organizations**
2. Click **Add**
3. Name: `compliance-prototype`
4. Save

## Step 2: Create Inventory

1. Navigate to **Resources > Inventories**
2. Click **Add > Add inventory**
3. Name: `compliance-rhel9-inventory`
4. Organization: `compliance-prototype`
5. Save
6. Go to the **Hosts** tab
7. Click **Add** and enter each target host (e.g., `web-prod-01`)

## Step 3: Create Machine Credential

1. Navigate to **Resources > Credentials**
2. Click **Add**
3. Name: `compliance-machine-credential`
4. Organization: `compliance-prototype`
5. Credential Type: **Machine**
6. Username: your SSH user
7. SSH Private Key or Password: enter the authentication material
8. Save

## Step 4: Create Project

1. Navigate to **Resources > Projects**
2. Click **Add**
3. Name: `compliance-content`
4. Organization: `compliance-prototype`
5. Source Control Type: **Git**
6. Source Control URL: `https://github.com/cross-logic/aap-compliance-pipelines.git` (public) or `https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines.git` (Red Hat internal)
7. Source Control Branch: `main`
8. Check **Update Revision on Launch**
9. Save
10. Wait for the project sync to complete (green checkmark)

## Step 5: Register the execution environment

1. Navigate to **Administration > Execution Environments**
2. Click **Add**
3. Name: `compliance-ee-rhel9`
4. Image: your compliance EE image (e.g., `registry.example.com/compliance-ee-rhel9:latest`)
5. Organization: `compliance-prototype`
6. Save

> **Building the EE**: Use the `meta/ee_profile.yml` from this collection
> with `ansible-builder build` to create the compliance EE image. The EE
> includes `scap-security-guide` and `openscap-scanner` RPMs.

## Step 6: Create Job Templates

Create each of the following job templates:

### 6a. compliance-install-scanner

- Name: `compliance-install-scanner`
- Organization: `compliance-prototype`
- Inventory: `compliance-rhel9-inventory`
- Project: `compliance-content`
- Playbook: `collections/ansible_collections/security/compliance_rhel9_stig/playbooks/scanner/install_scanner.yml`
- Execution Environment: `compliance-ee-rhel9`
- Credentials: `compliance-machine-credential`
- Check **Prompt on launch** for Limit

### 6b. compliance-run-scan

- Name: `compliance-run-scan`
- Organization: `compliance-prototype`
- Inventory: `compliance-rhel9-inventory`
- Project: `compliance-content`
- Playbook: `collections/ansible_collections/security/compliance_rhel9_stig/playbooks/scanner/run_scan.yml`
- Execution Environment: `compliance-ee-rhel9`
- Credentials: `compliance-machine-credential`
- Check **Prompt on launch** for Limit and Variables

### 6c. compliance-fetch-normalize

- Name: `compliance-fetch-normalize`
- Organization: `compliance-prototype`
- Inventory: `compliance-rhel9-inventory`
- Project: `compliance-content`
- Playbook: `collections/ansible_collections/security/compliance_rhel9_stig/playbooks/scanner/fetch_results.yml`
- Execution Environment: `compliance-ee-rhel9`
- Credentials: `compliance-machine-credential`
- Check **Prompt on launch** for Limit

### 6d. compliance-uninstall-scanner

- Name: `compliance-uninstall-scanner`
- Organization: `compliance-prototype`
- Inventory: `compliance-rhel9-inventory`
- Project: `compliance-content`
- Playbook: `collections/ansible_collections/security/compliance_rhel9_stig/playbooks/scanner/uninstall_scanner.yml`
- Execution Environment: `compliance-ee-rhel9`
- Credentials: `compliance-machine-credential`
- Check **Prompt on launch** for Limit

### 6e. compliance-remediate

- Name: `compliance-remediate`
- Organization: `compliance-prototype`
- Inventory: `compliance-rhel9-inventory`
- Project: `compliance-content`
- Playbook: `collections/ansible_collections/security/compliance_rhel9_stig/playbooks/remediate.yml`
- Execution Environment: `compliance-ee-rhel9`
- Credentials: `compliance-machine-credential`
- Check **Prompt on launch** for Limit, Variables, and Tags

> **Note**: The remediate playbook now imports the CaC playbook from
> `/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml` inside the
> EE. Selective remediation is achieved via `--tags` (rule IDs) and
> `--extra-vars` (parameter overrides) passed at launch time.

## Step 7: Create Workflow Job Template

1. Navigate to **Resources > Templates**
2. Click **Add > Add workflow job template**
3. Name: `compliance-scan-rhel9-stig`
4. Organization: `compliance-prototype`
5. Check **Prompt on launch** for Inventory, Limit, and Variables
6. Save
7. Click **Visualizer** to open the workflow editor

### Workflow node layout

```
Install Scanner -> Run Scan -> Fetch/Normalize -> Uninstall Scanner -> Remediate
                                       |                    ^
                                       |--- (on failure) ---+
```

1. Click **Start** and add `compliance-install-scanner`
   - Convergence: Any
   - Save
2. Hover over Install Scanner, click **+** (On Success)
   - Select `compliance-run-scan`
   - Save
3. Hover over Run Scan, click **+** (On Success)
   - Select `compliance-fetch-normalize`
   - Save
4. Hover over Fetch/Normalize, click **+** (On Success)
   - Select `compliance-uninstall-scanner`
   - Save
5. Hover over Fetch/Normalize, click **+** (On Failure)
   - Select `compliance-uninstall-scanner` (same node -- ensures cleanup)
   - Save
6. Hover over Uninstall Scanner, click **+** (On Success)
   - Select `compliance-remediate`
   - Save
7. Click **Save** on the visualizer

## Step 8: Add a Compliance Profile in Backstage

Once the platform resources are set up, register a compliance profile in the
Backstage compliance plugin so the UI knows which standard to scan against and
which platform resources to invoke.

1. Open the Compliance plugin in Backstage
2. Go to the **Settings** tab
3. Click **Add Profile**
4. Fill in the fields as described below:

| Field | Value | Description |
|-------|-------|-------------|
| Profile Name | `DISA STIG for RHEL 9` | A descriptive name for this profile shown in the plugin UI |
| Description | `DISA STIG V2R8 compliance scanning and remediation for RHEL 9` | Optional context shown alongside the profile name |
| Compliance Standard | `DISA_STIG` | The compliance standard. Options: `DISA_STIG`, `CIS`, `PCI_DSS`, `HIPAA`, `NIST_800_53` |
| Standard Version | `V2R8` | The release version of the standard (matches the DISA STIG release) |
| Target Platform | `RHEL 9` | The operating system or platform this profile applies to |
| Workflow Job Template | `compliance-pipeline-rhel9-stig` | Select from the dropdown — this is the workflow job template that orchestrates the scan-evaluate-remediate pipeline |
| Execution Environment | `Compliance STIG RHEL 9` | Select from the dropdown — the execution environment containing scap-security-guide and OpenSCAP |
| Remediation Playbook Path | `/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml` | Filesystem path inside the execution environment where the ComplianceAsCode remediation playbook lives. Installed by the `scap-security-guide` RPM. Used with `--tags` for selective remediation. |
| Scan Tags | *(leave empty)* | Optional comma-separated rule IDs to limit which rules are included. Leave empty to scan all rules in the standard. Example: `sshd_set_idle_timeout,accounts_tmout` |

5. Click **Save**

### Field Reference

**Remediation Playbook Path** — This is the filesystem path inside the
execution environment where the CaC remediation playbook is located.
The `scap-security-guide` RPM installs pre-rendered Ansible playbooks at
`/usr/share/scap-security-guide/ansible/`. Each profile has its own playbook:

| Profile | Playbook Path |
|---------|---------------|
| DISA STIG | `/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml` |
| CIS Level 1 Server | `/usr/share/scap-security-guide/ansible/rhel9-playbook-cis_server_l1.yml` |
| PCI-DSS | `/usr/share/scap-security-guide/ansible/rhel9-playbook-pci-dss.yml` |
| HIPAA | `/usr/share/scap-security-guide/ansible/rhel9-playbook-hipaa.yml` |

**Scan Tags** — When the remediation step runs, automation controller passes these
tags to Ansible's `--tags` parameter. This restricts which tasks in the CaC
playbook are executed. Each task in the CaC playbook is tagged with its STIG
rule ID (e.g., `sshd_set_idle_timeout`, `DISA-STIG-RHEL-09-255040`).

- **Leave empty**: All rules in the profile are scanned and available for remediation
- **Comma-separated list**: Only the listed rules are included (e.g., `sshd_set_idle_timeout,accounts_tmout,enable_fips_mode`)

## Verification

1. Go to the **New Scan** tab
2. You should see the registered profile in the profile list
3. Select it, choose an inventory, and launch a scan
4. The scan should use the mapped workflow job template from the profile

## Automated Setup

For automated provisioning, run the setup playbook instead:

```bash
ansible-playbook collections/ansible_collections/security/compliance_rhel9_stig/playbooks/setup_controller.yml \
  -e controller_hostname=https://aap.example.com \
  -e controller_username=admin \
  -e controller_password=<changeme> \
  -e target_hosts="host1,host2,host3" \
  -e machine_credential_user=ec2-user \
  -e machine_credential_ssh_key_data=@~/.ssh/id_rsa \
  -e compliance_ee_image=registry.example.com/compliance-ee-rhel9:latest
```
