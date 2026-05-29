# Automation Controller Setup for Compliance Pipeline

> **IMPORTANT (2026-05-26):** This guide was written for the original 3-JT workflow architecture (gather-facts, evaluate, remediate). The current architecture uses a **single assessment JT** (`compliance-run-oscap` running `run_oscap.yml` with 2 plays) and a **separate remediation JT** (`compliance-remediate` launched directly with `job_tags`). The manual setup steps 6a, 6b, and step 7 below describe the legacy pattern. For the current architecture, see:
> - [Deployment Guide](../../../docs/deployment-guide.md) -- current AAP resource requirements
> - [ADR-003](../../../specs/compliance-pipelines/decisions/ADR-003-single-assessment-jt.md) -- why single JT instead of workflow
> - [ADR-004](../../../specs/compliance-pipelines/decisions/ADR-004-oscap-replaces-custom-evaluate.md) -- why oscap replaces custom evaluate

This guide covers how to configure the automation controller in Ansible
Automation Platform (AAP) with the resources required to run the RHEL 9 STIG
compliance pipeline. You can provision these resources automatically with the
setup playbook or create them manually through the automation controller web UI.

## Prerequisites

Before you begin, confirm that you have the following:

| Requirement | Details |
|---|---|
| **AAP version** | 2.5, 2.6, or 2.7 (automation controller included) |
| **Admin access** | An account with Organization Admin or Superuser privileges on the automation controller |
| **Target host** | A RHEL 9 system reachable via SSH from the automation controller execution environment |
| **SSH credentials** | Username and password (or SSH key) with sudo privileges on the target host |
| **Network access** | The automation controller must be able to reach the Git host to sync the project repository (GitHub or GitLab) |

### Required Ansible Collections (for automated setup only)

If you plan to use the automated setup playbook, install these collections on
the machine where you will run the playbook:

```bash
ansible-galaxy collection install infra.aap_configuration
ansible-galaxy collection install ansible.controller
ansible-galaxy collection install ansible.platform
```

These collections are pre-installed in the AAP bundled execution environments.

---

## Resources Created

The compliance pipeline requires the following resources in the automation controller:

| Resource | Name | Purpose |
|---|---|---|
| Organization | `compliance-prototype` | Isolates all compliance resources |
| Inventory | `compliance-rhel9-inventory` | Contains target RHEL 9 hosts |
| Host | User-provided (e.g., `192.168.128.128`) | The RHEL 9 system to scan |
| Machine Credential | `compliance-lab-ssh` | SSH authentication with sudo |
| Project | `compliance-content` | Git project pointing to the compliance repo |
| Job Template | `compliance-run-oscap` | OpenSCAP assessment: scan targets (Play 1) + normalize on localhost (Play 2) |
| Job Template | `compliance-remediate` | Applies CaC STIG remediation (standalone, launched with job_tags) |

> **Note:** The legacy JTs (`compliance-gather-facts`, `compliance-evaluate`) and workflow (`compliance-pipeline-rhel9-stig`) are deprecated. The current architecture uses a single assessment JT with 2 plays instead of a multi-node workflow. See [ADR-003](../../../specs/compliance-pipelines/decisions/ADR-003-single-assessment-jt.md) and [ADR-004](../../../specs/compliance-pipelines/decisions/ADR-004-oscap-replaces-custom-evaluate.md).

---

## Option A: Automated Setup

The setup playbook uses `infra.aap_configuration` roles to create all resources
in a single run.

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `controller_host` | Platform gateway / automation controller URL | `https://aap.example.com` |
| `controller_username` | Admin username | `admin` |
| `controller_password` | Admin password | (your password) |
| `target_host` | RHEL 9 host IP or FQDN | `192.168.128.128` |
| `target_ssh_user` | SSH username on the target | `root` |
| `target_ssh_password` | SSH password for the target | (your password) |

### Running the Playbook

From the repository root:

```bash
ansible-playbook \
  profiles/rhel9-stig/install.yml \
  -e controller_host=https://aap.example.com \
  -e controller_username=admin \
  -e controller_password='changeme' \
  -e target_host=192.168.128.128 \
  -e target_ssh_user=root \
  -e target_ssh_password='changeme'
```

You can also set these values as environment variables:

```bash
export CONTROLLER_HOST=https://aap.example.com
export CONTROLLER_USERNAME=admin
export CONTROLLER_PASSWORD=changeme
export TARGET_HOST=192.168.128.128
export TARGET_SSH_USER=root
export TARGET_SSH_PASSWORD=changeme

ansible-playbook \
  profiles/rhel9-stig/install.yml
```

### Expected Output

The playbook runs seven steps in sequence:

1. Creates the `compliance-prototype` organization
2. Creates the `compliance-lab-ssh` machine credential
3. Creates the `compliance-content` project and waits for the initial Git sync
4. Creates the `compliance-rhel9-inventory` inventory
5. Adds the target host to the inventory
6. Creates the assessment JT (`compliance-run-oscap`) and remediation JT (`compliance-remediate`)

> **Note:** The setup playbook may also create legacy JTs (`compliance-gather-facts`, `compliance-evaluate`) and the workflow (`compliance-pipeline-rhel9-stig`) for backward compatibility. These are no longer used by the plugin -- the current architecture uses a single assessment JT with 2 plays.

A summary message is displayed on completion listing all created resources.

### AAP Version Compatibility Notes

- **AAP 2.5+**: The playbook uses the `gateway_organizations` role for
  organization creation (platform-level resource). If the platform gateway role
  is unavailable, it falls back to `controller_organizations`.
- **AAP 2.7**: Fully compatible. The `infra.aap_configuration` collection
  handles API differences between versions transparently.
- **Self-signed certificates**: The playbook sets `aap_validate_certs: false`
  by default. For production, configure a trusted certificate and set this
  to `true`.

---

## Option B: Manual Setup

Follow these steps to create all resources through the automation controller web UI.

### Step 1: Create the Organization

1. Log in to the automation controller web UI as an admin user.
2. Navigate to **Access** > **Organizations** in the left sidebar.
3. Click the **Add** button.
4. Enter the following values:
   - **Name**: `compliance-prototype`
   - **Description**: `Compliance pipeline prototype organization`
5. Click **Save**.

**Expected result**: The organization appears in the Organizations list with a
green status indicator.

### Step 2: Create the Inventory

1. Navigate to **Resources** > **Inventories**.
2. Click **Add** > **Add inventory**.
3. Enter the following values:
   - **Name**: `compliance-rhel9-inventory`
   - **Description**: `RHEL 9 hosts for compliance scanning and remediation`
   - **Organization**: Select `compliance-prototype`
4. Click **Save**.

**Expected result**: The inventory detail page opens showing the Details tab.

### Step 3: Add a Host to the Inventory

1. From the inventory detail page, click the **Hosts** tab.
2. Click the **Add** button.
3. Enter the following values:
   - **Name**: Your target host IP address or FQDN (e.g., `192.168.128.128`)
   - **Variables** (YAML):
     ```yaml
     ansible_host: 192.168.128.128
     ansible_connection: ssh
     ```
4. Click **Save**.

**Expected result**: The host appears in the Hosts tab of the inventory.

### Step 4: Create the Machine Credential

1. Navigate to **Resources** > **Credentials**.
2. Click **Add**.
3. Enter the following values:
   - **Name**: `compliance-lab-ssh`
   - **Description**: `SSH credential for compliance target hosts`
   - **Organization**: Select `compliance-prototype`
   - **Credential Type**: Select **Machine**
4. In the **Type Details** section:
   - **Username**: Your SSH username (e.g., `root`)
   - **Password**: Your SSH password
   - **Privilege Escalation Method**: Select **sudo**
5. Click **Save**.

**Expected result**: The credential appears in the Credentials list. The
password field shows `Encrypted` after saving.

### Step 5: Create the Project

1. Navigate to **Resources** > **Projects**.
2. Click **Add**.
3. Enter the following values:
   - **Name**: `compliance-content`
   - **Description**: `Compliance pipeline collection and playbooks`
   - **Organization**: Select `compliance-prototype`
   - **Source Control Type**: Select **Git**
   - **Source Control URL**: `https://github.com/cross-logic/aap-compliance-pipelines.git` (public) or `https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines.git` (Red Hat internal)
   - **Source Control Branch/Tag/Commit**: `main`
4. Under **Options**:
   - Check **Clean** (removes local modifications before updating)
   - Check **Update Revision on Launch** (syncs before each job run)
5. Click **Save**.
6. Wait for the initial project sync to complete. The status icon next to the
   project name changes from a spinning icon to a green checkmark.

**Expected result**: The project shows a **Successful** sync status. Clicking
into the project and selecting the **Job Templates** tab shows no templates yet
(you will create them next).

> **If the sync fails**: See the Troubleshooting section at the end of this
> guide.

### Step 6: Create Job Templates

Create each of the three job templates described below. For each template:
navigate to **Resources** > **Templates**, click **Add** > **Add job template**,
fill in the fields, and click **Save**.

#### 6a. compliance-gather-facts

| Field | Value |
|---|---|
| **Name** | `compliance-gather-facts` |
| **Description** | `Gather compliance-relevant facts from target hosts` |
| **Job Type** | Run |
| **Inventory** | `compliance-rhel9-inventory` |
| **Project** | `compliance-content` |
| **Playbook** | `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/gather_facts.yml` |
| **Credentials** | `compliance-lab-ssh` |
| **Options** | Check **Privilege Escalation** (Enable become) |
| **Options** | Check **Use Fact Storage** (Enable fact cache) |

#### 6b. compliance-evaluate

| Field | Value |
|---|---|
| **Name** | `compliance-evaluate` |
| **Description** | `Evaluate gathered facts against STIG rules` |
| **Job Type** | Run |
| **Inventory** | `compliance-rhel9-inventory` |
| **Project** | `compliance-content` |
| **Playbook** | `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/evaluate.yml` |
| **Credentials** | (none required -- runs on localhost) |
| **Options** | Check **Use Fact Storage** (Enable fact cache) |

> **Note**: The evaluate playbook runs on `localhost` and reads facts from the
> automation controller fact cache. It does not need a machine credential because it does
> not SSH to any remote hosts.

#### 6c. compliance-remediate

| Field | Value |
|---|---|
| **Name** | `compliance-remediate` |
| **Description** | `Apply CaC STIG remediation to target hosts` |
| **Job Type** | Run |
| **Inventory** | `compliance-rhel9-inventory` |
| **Project** | `compliance-content` |
| **Playbook** | `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/remediate.yml` |
| **Credentials** | `compliance-lab-ssh` |
| **Options** | Check **Privilege Escalation** (Enable become) |

**Expected result**: After creating all three templates, the Templates list
shows `compliance-gather-facts`, `compliance-evaluate`, and
`compliance-remediate` with green status indicators.

### Step 7: Create the Workflow Job Template

1. Navigate to **Resources** > **Templates**.
2. Click **Add** > **Add workflow job template**.
3. Enter the following values:
   - **Name**: `compliance-pipeline-rhel9-stig`
   - **Description**: `RHEL 9 STIG compliance pipeline: Gather Facts -> Evaluate -> Remediate`
   - **Organization**: Select `compliance-prototype`
4. Click **Save**.
5. The workflow visualizer opens automatically (or click the **Visualizer** tab).

#### Adding Workflow Nodes

Build the following three-node pipeline:

```
[Gather Facts] --on success--> [Evaluate] --on success--> [Remediate]
```

1. Click the **Start** button in the visualizer.
2. In the dialog that appears:
   - **Node Type**: Job Template
   - Select `compliance-gather-facts`
   - **Convergence**: Any
   - Click **Save**
3. Hover over the **Gather Facts** node and click the green **+** button
   (On Success).
4. In the dialog:
   - **Node Type**: Job Template
   - Select `compliance-evaluate`
   - Click **Save**
5. Hover over the **Evaluate** node and click the green **+** button
   (On Success).
6. In the dialog:
   - **Node Type**: Job Template
   - Select `compliance-remediate`
   - Click **Save**
7. Click **Save** in the visualizer toolbar to persist the workflow.

**Expected result**: The visualizer shows three nodes connected in a linear
chain from left to right: Gather Facts, Evaluate, Remediate.

### Step 8: Add a Compliance Profile in the Plugin (Optional)

If you are using the Backstage compliance plugin, add a compliance profile so the
UI can launch scans:

1. Open the Compliance plugin in Backstage.
2. Navigate to the **Settings** tab.
3. Click **Add Profile**.
4. Fill in:
   - **Profile Name**: `DISA STIG for RHEL 9`
   - **Compliance Standard**: `DISA STIG`
   - **Standard Version**: `V2R8`
   - **Target Platform**: `RHEL 9`
   - **Assessment Job Template**: Select `compliance-run-oscap`
5. Click **Save**.

---

## Verification

After completing either automated or manual setup, verify that everything works:

### 1. Confirm the Project Sync

1. Navigate to **Resources** > **Projects**.
2. The `compliance-content` project should show a green checkmark indicating
   a successful sync.
3. Click into the project and verify the **Last Updated** timestamp is recent.

### 2. Launch a Test Assessment

1. Navigate to **Resources** > **Templates**.
2. Find `compliance-run-oscap` and click the rocket icon to launch it.
3. Select the `compliance-rhel9-inventory` inventory and click **Launch**.
4. Monitor the job progress:
   - **Play 1** (scan): OpenSCAP installs, scans targets, fetches XCCDF XML results.
   - **Play 2** (normalize): Parses XCCDF XML on localhost, produces CFF JSON findings.

### 3. Review Job Output

1. Click on the completed job to view its output.
2. **Play 1 (scan)**: Should show oscap installing, scanning, and fetching results from each target host.
3. **Play 2 (normalize)**: Should show the `normalize_xccdf` module processing XCCDF files and producing findings with 366 STIG rules per host.

### 4. Verify from the Backstage Plugin (if configured)

1. Open the Compliance plugin dashboard.
2. The compliance posture data should reflect the latest scan results.
3. Navigate to the **Scan Results** section to see per-host findings.

---

## Troubleshooting

### Project sync fails with "authentication required"

**Symptom**: The `compliance-content` project shows a red failure status after
sync, with an error about authentication.

**Resolution**: The GitHub repository at
`https://github.com/cross-logic/aap-compliance-pipelines.git` is public and does
not require authentication. The GitLab mirror at
`https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines.git` is internal
and requires Red Hat network access. If your automation controller is behind a proxy, configure the
proxy settings in **Settings** > **Jobs** > **Extra Environment Variables**:

```json
{
  "HTTP_PROXY": "http://proxy.example.com:8080",
  "HTTPS_PROXY": "http://proxy.example.com:8080",
  "NO_PROXY": "localhost,127.0.0.1"
}
```

### Project sync fails with "fatal: unsafe repository"

**Symptom**: Git reports `fatal: detected dubious ownership in repository` or
`fatal: unsafe repository`.

**Resolution**: This is a Git `safe.directory` issue. Add the following to
the automation controller job settings. Navigate to **Settings** > **Jobs** >
**Extra Environment Variables** and add:

```json
{
  "GIT_CONFIG_COUNT": "1",
  "GIT_CONFIG_KEY_0": "safe.directory",
  "GIT_CONFIG_VALUE_0": "*"
}
```

Alternatively, on the execution node, run:

```bash
git config --global --add safe.directory '*'
```

### SSH connection refused or timeout

**Symptom**: The `compliance-run-oscap` or `compliance-remediate` job fails
with `Connection refused` or `Connection timed out`.

**Resolution**:

1. Verify that the target host is reachable from the automation controller execution node:
   ```bash
   ssh <target_ssh_user>@<target_host>
   ```
2. Confirm that the SSH service is running on the target:
   ```bash
   systemctl status sshd
   ```
3. Check that the target host's firewall allows SSH (port 22):
   ```bash
   firewall-cmd --list-services
   ```
4. Verify the credential password is correct by editing the `compliance-lab-ssh`
   credential and re-entering the password.

### Permission denied during remediation (become)

**Symptom**: The `compliance-remediate` job fails with
`Missing sudo password` or `Permission denied`.

**Resolution**:

1. Edit the `compliance-lab-ssh` credential.
2. Confirm that the **Privilege Escalation Method** is set to **sudo**.
3. If the target user requires a sudo password, ensure the **Privilege
   Escalation Password** field is populated (it can be the same as the SSH
   password).
4. On the target host, verify the user has sudo access:
   ```bash
   sudo -l -U <target_ssh_user>
   ```

### Evaluate job fails with "compliance_facts not found" (Legacy)

> **Note:** This issue applies to the deprecated `compliance-evaluate` JT. The current architecture uses `compliance-run-oscap` which does not depend on the fact cache.

**Symptom**: The `compliance-evaluate` job fails because
`hostvars[host]['compliance_facts']` is undefined.

**Resolution**: This happens when `compliance-gather-facts` did not run
successfully, or when the fact cache has expired between runs. With the current architecture, use `compliance-run-oscap` instead -- it runs scan and normalize in the same JT without fact cache dependency.

### Workflow node shows "Error" without job output

**Symptom**: A workflow node turns red but there is no job output to inspect.

**Resolution**: This typically means the job template could not be launched.
Check:

1. The project sync is successful (the project must be in a "Successful" state).
2. The playbook path is correct and the file exists in the repository.
3. The credential and inventory still exist and have not been deleted.

### Automated setup playbook fails with "module not found"

**Symptom**: Running `setup_controller.yml` produces an error like
`couldn't resolve module/action 'ansible.controller.organization'`.

**Resolution**: Install the required collections:

```bash
ansible-galaxy collection install infra.aap_configuration ansible.controller ansible.platform
```

If running inside an execution environment, ensure it includes these
collections. The standard AAP EEs (`ee-supported-rhel9`) include them by
default.

---

## Appendix: Resource Reference

### Playbook Paths (Current Architecture)

These paths are relative to the project root
(`aap-compliance-pipelines/`):

| Job Template | Playbook Path | Notes |
|---|---|---|
| compliance-run-oscap | `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/run_oscap.yml` | Assessment: scan targets (Play 1) + normalize on localhost (Play 2) |
| compliance-remediate | `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/remediate.yml` | Standalone, launched with job_tags |
| compliance-normalize (utility) | `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/normalize.yml` | Debugging and Tier 2 reuse only |

### Current Architecture

```
+-----------------------------------+
| compliance-run-oscap (single JT)  |
|                                   |
|  Play 1: OpenSCAP scan (targets)  |
|  Play 2: Normalize (localhost)    |
+-----------------------------------+
                  |
           CFF JSON findings
                  |
                  v
           +------------+
           | Remediate  |     (separate standalone JT, launched with job_tags)
           | (targets)  |
           +------------+
```

### Legacy Playbook Paths (Deprecated)

| Job Template | Playbook Path |
|---|---|
| compliance-gather-facts | `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/gather_facts.yml` |
| compliance-evaluate | `profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig/playbooks/evaluate.yml` |

### Setup Playbook Variables Reference

| Variable | Default | Required | Description |
|---|---|---|---|
| `controller_host` | `$CONTROLLER_HOST` or `https://aap.example.com` | Yes | Platform gateway / automation controller URL |
| `controller_username` | `$CONTROLLER_USERNAME` or `admin` | Yes | Admin username |
| `controller_password` | `$CONTROLLER_PASSWORD` | Yes | Admin password |
| `target_host` | `$TARGET_HOST` or `192.168.128.128` | Yes | RHEL 9 target host |
| `target_ssh_user` | `$TARGET_SSH_USER` or `root` | Yes | SSH username |
| `target_ssh_password` | `$TARGET_SSH_PASSWORD` | Yes | SSH password |
