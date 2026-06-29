# Manual Testing Suite — Supply Chain & Portable Profiles

This document is a step-by-step verification checklist for all features added in the supply chain / portable profiles work. Walk through each section in order. Mark items as you go.

Two modes: **Netrunner Live** (primary, production-like) and **Local Mock** (offline dev).

---

## Netrunner Live Prerequisites

| Resource | Value |
|----------|-------|
| Portal | `https://dev-portal-netrunner.demoredhat.com/compliance` |
| Controller API | `https://aap-netrunner.demoredhat.com/api/controller/v2/` |
| Backend API | `https://dev-portal-netrunner.demoredhat.com/api/compliance/` |
| AAP Token | `<AAP_TOKEN>` |
| Organization | `compliance-prototype` (ID 2) |
| Inventory | `compliance-rhel9-inventory` (ID 4) |
| Supply Chain EE | `aap-netrunner.demoredhat.com/compliance-supply-chain:latest` (PAH) |

### Pre-flight: Verify CI deployment completed

```bash
# Check Portal is running with new plugins
curl -sk https://dev-portal-netrunner.demoredhat.com/api/compliance/health | jq .

# Check Controller has the compliance project synced
curl -sk "https://aap-netrunner.demoredhat.com/api/controller/v2/projects/32/" \
  -H "Authorization: Bearer <AAP_TOKEN>" | jq '{name, status, scm_revision}'
```

- [ ] Health endpoint returns OK
- [ ] Project shows latest `scm_revision` matching commit `2707b30`

### Pre-flight: Register supply chain EE on Controller

```bash
curl -sk -X POST "https://aap-netrunner.demoredhat.com/api/controller/v2/execution_environments/" \
  -H "Authorization: Bearer <AAP_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Compliance Supply Chain",
    "image": "aap-netrunner.demoredhat.com/compliance-supply-chain:latest",
    "organization": 2
  }'
```

- [ ] EE created (201) or already exists (400 with name conflict)

### Pre-flight: Run install.yml for supply chain JTs

```bash
cd profiles/supply-chain
ansible-playbook install.yml \
  -e aap_host=https://aap-netrunner.demoredhat.com \
  -e aap_token=<AAP_TOKEN> \
  -e organization=compliance-prototype \
  -e inventory=compliance-rhel9-inventory
```

- [ ] Assessment JT `compliance-scan-supply-chain` created
- [ ] Remediation JT `compliance-remediate-supply-chain` created

---

## Local Mock Prerequisites (Alternative)

```bash
cd backstage-app
./bin/start.sh mock      # Start in mock mode
# Frontend: http://localhost:3000
# Backend:  http://localhost:7007
```

Wait for both services to be ready (backend health check passes, frontend loads).

---

## A. Dashboard Overview (Regression)

Open `https://dev-portal-netrunner.demoredhat.com/compliance`

- [ ] Dashboard loads at `/compliance`
- [ ] Stat cards render (Hosts Scanned, Critical Findings, Pending Remediation, Active Profiles)
- [ ] Per-profile gauges render for existing profiles (DISA STIG, CIS, etc.)
- [ ] Compliance Score Trend chart renders without errors
- [ ] Inventory breakdown section renders

---

## B. Add Supply Chain Profile via Settings

1. Navigate to **Settings** tab
2. Click **Add Profile**
3. In the Scan Job Template dropdown, select `compliance-scan-supply-chain`
4. Verify auto-populate fills in:
   - [ ] Display Name: "Supply Chain Vulnerability Scan"
   - [ ] Framework: "SUPPLY_CHAIN"
   - [ ] Version: "1.0.0"
   - [ ] Certification: "uncertified" / "N/A"
   - [ ] Remediate JT: auto-resolves to `compliance-remediate-supply-chain`
   - [ ] Platform: "Linux (multi-distro)"
5. **Save the profile**
6. Verify the profile appears in the Settings table

---

## C. Dynamic Tab — Supply Chain

After saving the profile in step B:

- [ ] Header tab bar shows a **Supply Chain** tab (inserted BEFORE Settings)
- [ ] STIG and CIS profiles do NOT generate extra tabs (they have no `displayConfig.tab`)
- [ ] Click "Supply Chain" tab — navigates to the profile tab route
- [ ] Tab renders (may show empty state if no scan has run yet)

---

## D. Profile Settings (Framework Dropdown)

1. Click **Add Profile** again (don't save — just check the dropdown)
2. Framework dropdown includes all options:
   - [ ] DISA STIG
   - [ ] CIS Benchmark
   - [ ] PCI-DSS
   - [ ] HIPAA
   - [ ] NIST 800-53
   - [ ] **Supply Chain (SBOM)** (new)
   - [ ] **PQC Readiness** (new)
   - [ ] **Custom** (new)
3. Cancel dialog

---

## E. Display Config — Column Labels (after scan)

After a supply chain scan completes (Section H):

- [ ] Navigate to Results, click the completed supply chain scan
- [ ] Column headers show "CVE", "Package", "CVSS Severity" (NOT "Rule ID", "STIG ID")
- [ ] Severity filter chips show "Critical / High", "Medium", "Low" (NOT "CAT I", "CAT II", "CAT III")
- [ ] Navigate to a STIG scan result — verify default labels ("Rule ID", "STIG ID", "CAT I") still render

---

## F. Dynamic Tab with Live Data (after scan)

After a supply chain scan completes (Section H):

- [ ] Click the **Supply Chain** tab

### F.1 Score Grid

- [ ] **Score grid** renders 5 metric cards in a horizontal row
- [ ] "Total Packages" card shows package count from scan metadata (blue)
- [ ] "Active CVEs" card shows count of failing findings (red)
- [ ] "Critical / High" card shows CAT_I fail count (dark red)
- [ ] "Fixable" card shows findings with `fix_state=fixed` and fix versions available (green)
- [ ] "Hosts Affected" card shows unique hosts with at least one failing finding (grey)

### F.2 Remediate vs Mitigate Split

- [ ] **"Fix Available"** section shows CVEs where a vendor fix exists
- [ ] Fix Available table has columns: checkbox | CVE | Package | Installed | Fix Version | Severity | Patch button
- [ ] Clicking **Patch** on a single row launches a quick remediation (no saved profile)
- [ ] Selecting 2+ checkboxes shows a **"Build Remediation (N)"** toolbar button
- [ ] Clicking "Build Remediation" navigates to the RemediationProfileBuilder with pre-selected CVEs
- [ ] Expanding a row shows: description, fix text, CVSS score, affected hosts
- [ ] **"No Fix / Monitor"** section shows CVEs without a vendor fix (visually de-emphasized)
- [ ] No Fix table has columns: CVE | Package | Severity | Status chip
- [ ] Status chips show "No Fix" (grey) or "Won't Fix" (red) based on `fix_state`

### F.3 Host Risk Heatmap

- [ ] **Host risk table** shows hosts sorted by weighted risk score (Critical×10 + High×5 + Medium×1)
- [ ] Each row shows: hostname | risk score (color-coded) | CVE count | progress bar (red=vulnerable, green=clean)
- [ ] Risk scores ≥50 show in red, 20-49 in orange, <20 in green

---

## G. Bundle CRUD Endpoints (API-level)

### F.1 Create a profile first (needed for bundle ops)

```bash
PROFILE_ID=$(curl -s -X POST https://dev-portal-netrunner.demoredhat.com/api/compliance/compliance-profiles \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"Test Bundle Profile","framework":"CUSTOM","version":"1.0","platform":"Test"}' | jq -r .id)
echo "Created profile: $PROFILE_ID"
```

- [ ] Profile created, ID returned

### F.2 Upload a bundle

```bash
curl -s -X PUT "https://dev-portal-netrunner.demoredhat.com/api/compliance/compliance-profiles/$PROFILE_ID/bundle" \
  -H 'Content-Type: application/json' \
  -d '"export default function TestTab() { return \"hello\"; }"' | jq .
```

- [ ] Returns 201 with `{size, uploadedAt}`

### F.3 Retrieve the bundle

```bash
curl -s -D - "https://dev-portal-netrunner.demoredhat.com/api/compliance/compliance-profiles/$PROFILE_ID/bundle" 2>&1 | head -10
```

- [ ] Returns the JS content
- [ ] `Content-Type: application/javascript`
- [ ] `X-Content-Type-Options: nosniff` header present
- [ ] `Cache-Control: public, max-age=3600` header present

### F.4 Upload too-large bundle (413 test)

```bash
# Generate >5MB payload
LARGE=$(python3 -c "print('x' * 6000000)")
curl -s -X PUT "https://dev-portal-netrunner.demoredhat.com/api/compliance/compliance-profiles/$PROFILE_ID/bundle" \
  -H 'Content-Type: application/json' \
  -d "\"$LARGE\"" | jq .
```

- [ ] Returns 413 with error about exceeding 5MB limit

### F.5 Delete the bundle

```bash
curl -s -X DELETE "https://dev-portal-netrunner.demoredhat.com/api/compliance/compliance-profiles/$PROFILE_ID/bundle" -w "\n%{http_code}\n"
```

- [ ] Returns 204

### F.6 Verify bundle gone

```bash
curl -s "https://dev-portal-netrunner.demoredhat.com/api/compliance/compliance-profiles/$PROFILE_ID/bundle" | jq .
```

- [ ] Returns 404

### F.7 Cleanup

```bash
curl -s -X DELETE "https://dev-portal-netrunner.demoredhat.com/api/compliance/compliance-profiles/$PROFILE_ID" -w "\n%{http_code}\n"
```

- [ ] Returns 204

---

## H. Existing Features Regression

### G.1 Scan Launcher

- [ ] Navigate to "New Scan" tab
- [ ] Profile dropdown lists all 4 profiles
- [ ] Inventory dropdown lists all inventories
- [ ] "Launch Scan" button renders (disabled without selection or enabled depending on mock wiring)

### G.2 Scan History

- [ ] Navigate to "Results" tab
- [ ] Scan history renders (may be empty in fresh mock mode)
- [ ] If scans exist: grouped by profile x inventory

### G.3 Remediations

- [ ] Navigate to "Remediations" tab
- [ ] Tab renders without errors (may show empty state)

### G.4 Inventories

- [ ] Navigate to "Inventories" tab
- [ ] Inventory list renders with 4 inventories
- [ ] Click an inventory — detail view renders with host posture strip plot

### G.5 Results Viewer (if accessible)

- [ ] Click any scan result — ResultsViewer renders
- [ ] Summary cards show (Overall Compliance, Hosts Scanned, Rules Evaluated, Rules with Failures)
- [ ] Findings table renders with expandable rows
- [ ] Severity filter chips work
- [ ] Status filter chips work
- [ ] Export button (CSV/JSON) present

### G.6 Profile Browser

- [ ] Navigate to a profile detail view (via dashboard gauge click or URL)
- [ ] Profile browser renders framework chip with correct color
- [ ] Supply Chain profile shows "primary" chip color

---

## I. Netrunner Live Scan (Layer 3)

Requires Portal deployed and Controller provisioned (pre-flight steps above).

### H.1 Add supply chain profile in Portal UI

1. Open `https://dev-portal-netrunner.demoredhat.com/compliance`
2. Navigate to **Settings** tab
3. Click **Add Profile**
4. Select the `compliance-scan-supply-chain` assessment JT
5. Verify auto-populate fills in:
   - [ ] Display Name: "Supply Chain Vulnerability Scan"
   - [ ] Framework: "SUPPLY_CHAIN"
   - [ ] Version: "1.0.0"
   - [ ] Certification: "uncertified"
6. Save the profile

### H.2 Verify dynamic tab appears

- [ ] "Supply Chain" tab appears in the header tab bar (between Inventories and Settings)
- [ ] Click the tab — loads without errors

### H.3 Launch a supply chain scan

1. Navigate to **New Scan** tab
2. Select the Supply Chain profile
3. Select `compliance-rhel9-inventory`
4. Click **Launch Scan**
5. Wait for the scan to complete (may take 5-15 minutes — Syft scans the full filesystem)

- [ ] Scan status shows "Running" then "Completed"
- [ ] No errors in scan status

### H.4 Verify scan results

1. Navigate to **Results** tab
2. Click the completed supply chain scan

- [ ] Column headers show "CVE", "Package", "CVSS Severity" (not "Rule ID", "STIG ID")
- [ ] Severity chips show "Critical / High", "Medium", "Low"
- [ ] Findings are real CVEs from the scanned hosts
- [ ] Overall Compliance shows a non-zero vulnerability-free rate (not 0%)

### H.5 Verify dynamic tab with live data

1. Click the **Supply Chain** tab

- [ ] Score grid shows 5 metric cards with real data (Total Packages, Active CVEs, Critical/High, Fixable, Hosts Affected)
- [ ] "Fix Available" section lists CVEs with known fixes and Patch buttons
- [ ] "No Fix / Monitor" section lists CVEs without vendor fixes
- [ ] Host risk table shows hosts sorted by weighted risk score with progress bars

### H.6 Profile disconnect removes tab

1. Navigate to **Settings** tab
2. Click the disconnect/remove action on the Supply Chain profile
3. Verify:

- [ ] Supply Chain tab disappears from the header tab bar immediately
- [ ] Dashboard overview no longer shows the Supply Chain gauge
- [ ] Navigate to **Results** tab — historical supply chain scans are still visible
- [ ] Click a historical scan — findings still render correctly (soft delete preserves data)

4. Re-add the Supply Chain profile (repeat Section B)

- [ ] Supply Chain tab reappears with the new 3-section layout
- [ ] Previous scan data is accessible from the tab

### H.7 Regression: existing scans still work

1. Navigate to **New Scan** and select the STIG profile
2. Launch a STIG scan against the compliance inventory

- [ ] STIG scan completes successfully
- [ ] Results show standard STIG columns ("Rule ID", "STIG ID", "Severity")
- [ ] No dynamic tab appears for STIG profile
- [ ] Dashboard overview still renders all profiles correctly

---

## J. EE Build Verification (Layer 2)

Requires Docker or Podman.

```bash
cd profiles/supply-chain/ee
ansible-builder build -f execution-environment.yml -t compliance-supply-chain:latest -v3
```

- [ ] Build completes without errors
- [ ] Syft installed at pinned version:
  ```bash
  podman run --rm compliance-supply-chain:latest syft version
  ```
  - [ ] Shows v1.20.0
- [ ] Grype installed at pinned version:
  ```bash
  podman run --rm compliance-supply-chain:latest grype version
  ```
  - [ ] Shows v0.90.0
- [ ] jq installed:
  ```bash
  podman run --rm compliance-supply-chain:latest jq --version
  ```
  - [ ] Shows version output
- [ ] Syft can scan:
  ```bash
  podman run --rm compliance-supply-chain:latest syft / --scope squashed -o cyclonedx-json 2>/dev/null | head -5
  ```
  - [ ] Produces valid CycloneDX JSON output

---

## K. Collection Structure Validation

```bash
cd /path/to/aap-compliance-pipelines
python3 -m pytest profiles/_shared/test_profile_structure.py -v
```

- [ ] All 60 tests pass
- [ ] Every profile has: install.yml, uninstall.yml, backstage/, ee/, ansible_collections/, compliance-profile.yml with display block

---

## L. Normalizer Unit Tests

```bash
cd profiles/supply-chain/ansible_collections/security/compliance_supply_chain
python3 -m pytest tests/ -v
```

- [ ] All 44 tests pass (37 original + 7 NDJSON)
- [ ] CVE matches always produce `status: fail`
- [ ] All CFF fields present (category, disruption, aap_impact, parameters, scanner)
- [ ] NDJSON output format: preamble line + one finding per line

---

## M. Full Automated Test Suite

```bash
cd backstage-app
yarn test --watchAll=false
```

- [ ] 609 tests pass
- [ ] 22 suites pass
- [ ] Zero failures

```bash
cd /path/to/aap-compliance-pipelines
python3 -m pytest profiles/_shared/test_profile_structure.py profiles/supply-chain/ansible_collections/security/compliance_supply_chain/tests/ -v
```

- [ ] 104 Python tests pass (44 CycloneDX + 60 cross-profile)

---

## Summary

| Section | Tests | What it verifies |
|---------|-------|-----------------|
| A | 5 | Dashboard renders, regression check |
| B | 7 | Add supply chain profile via Settings, auto-populate |
| C | 4 | Dynamic tab appears after profile creation |
| D | 8 | Framework dropdown includes all new options |
| E | 4 | Display config column/severity labels (after scan) |
| F | 18 | Dynamic tab: score grid, remediate/mitigate split, host risk heatmap |
| G | 6 | Bundle API: upload/serve/size-limit/delete |
| H | 20 | Live scan: launch, verify results, disconnect/reconnect, regression |
| I | 6 | Existing features regression |
| J | 5 | EE build verification |
| K | 1 | Cross-profile structure validation (60 sub-tests) |
| L | 1 | Normalizer correctness (44 sub-tests) |
| M | 2 | Full automated suite (713 sub-tests) |
| **Total** | **81** | |
