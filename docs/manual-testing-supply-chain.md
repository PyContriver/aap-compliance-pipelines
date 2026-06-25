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
| AAP Token | `OT15ZNf5NsQ7sGRM7qg3GKhOU00YVo` |
| Organization | `compliance-prototype` (ID 2) |
| Inventory | `compliance-rhel9-inventory` (ID 4) |
| Supply Chain EE | `ghcr.io/cross-logic/compliance-supply-chain:latest` |
| GHCR Credential | `GHCR-cross-logic` (ID 8) |

### Pre-flight: Verify CI deployment completed

```bash
# Check Portal is running with new plugins
curl -sk https://dev-portal-netrunner.demoredhat.com/api/compliance/health | jq .

# Check Controller has the compliance project synced
curl -sk "https://aap-netrunner.demoredhat.com/api/controller/v2/projects/32/" \
  -H "Authorization: Bearer OT15ZNf5NsQ7sGRM7qg3GKhOU00YVo" | jq '{name, status, scm_revision}'
```

- [ ] Health endpoint returns OK
- [ ] Project shows latest `scm_revision` matching commit `2707b30`

### Pre-flight: Register supply chain EE on Controller

```bash
curl -sk -X POST "https://aap-netrunner.demoredhat.com/api/controller/v2/execution_environments/" \
  -H "Authorization: Bearer OT15ZNf5NsQ7sGRM7qg3GKhOU00YVo" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Compliance Supply Chain",
    "image": "ghcr.io/cross-logic/compliance-supply-chain:latest",
    "organization": 2,
    "credential": 8
  }'
```

- [ ] EE created (201) or already exists (400 with name conflict)

### Pre-flight: Run install.yml for supply chain JTs

```bash
cd profiles/supply-chain
ansible-playbook install.yml \
  -e aap_host=https://aap-netrunner.demoredhat.com \
  -e aap_token=OT15ZNf5NsQ7sGRM7qg3GKhOU00YVo \
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

- [ ] Dashboard loads at `/compliance`
- [ ] 4 stat cards render (Hosts Scanned, Critical Findings, Pending Remediation, Active Profiles)
- [ ] Active Profiles shows **4** (was 3 — now includes Supply Chain)
- [ ] Per-profile gauges render — should see DISA STIG, CIS L1, PCI-DSS, **and Supply Chain (94%)**
- [ ] Recent scans list includes "Supply Chain Vulnerability Scan" entry
- [ ] Compliance Score Trend chart renders without errors
- [ ] Inventory breakdown section renders

---

## B. Dynamic Tab — Supply Chain

- [ ] Header tab bar shows: Overview | New Scan | Results | Remediations | Inventories | **Supply Chain** | Settings
- [ ] "Supply Chain" tab is inserted BEFORE Settings
- [ ] STIG and CIS profiles do NOT generate extra tabs (they have no `displayConfig.tab`)
- [ ] Click "Supply Chain" tab — navigates to `/compliance/profile-tab/supply-chain-vuln`
- [ ] Tab renders without errors
- [ ] **Summary card widget** shows "SBOM Coverage" with a percentage and progress bar
- [ ] **Severity breakdown widget** shows chips labeled "Critical / High", "Medium", "Low" (NOT "CAT I", "CAT II", "CAT III")
- [ ] **Findings table widget** shows columns: CVE | Package | Severity | Fix
- [ ] Findings table shows CVE-2026-28439 (openssl), CVE-2026-31852 (curl), etc.
- [ ] **Host breakdown widget** shows hosts sorted by vulnerability count
- [ ] Navigate away and back — tab state persists

---

## C. Display Config — Column Labels

- [ ] Navigate to Results for any mock scan (click a scan in Recent Scans or Scan History)
- [ ] For STIG scan: column headers show "Severity", "Title", "Rule ID" (default labels)
- [ ] Severity filter chips show "CAT I", "CAT II", "CAT III" (default labels)
- [ ] FindingRow severity chips show "CAT I", "CAT II", "CAT III"

> **Note:** The supply chain display config for ResultsViewer columns is only active when viewing a scan associated with the supply chain profile. In mock mode, scans are not profile-associated, so you'll see default STIG labels. Full verification of custom column labels requires live mode with a real supply chain scan.

---

## D. Profile Settings (Regression + New Frameworks)

- [ ] Navigate to Settings tab
- [ ] Existing profiles (DISA STIG, CIS L1, PCI-DSS, Supply Chain) render in the table
- [ ] Click "Add Profile" button
- [ ] Framework dropdown includes all options:
  - [ ] DISA STIG
  - [ ] CIS Benchmark
  - [ ] PCI-DSS
  - [ ] HIPAA
  - [ ] NIST 800-53
  - [ ] **Supply Chain (SBOM)** (new)
  - [ ] **PQC Readiness** (new)
  - [ ] **Custom** (new)
- [ ] Select "Supply Chain (SBOM)" — form renders normally
- [ ] Cancel dialog — no side effects
- [ ] Edit an existing profile — form populates with current values

---

## E. Profile Lifecycle Endpoints (API-level)

Open a second terminal. Backend must be running on port 7007.

### E.1 Disconnect a profile

```bash
curl -s -X POST http://localhost:7007/api/compliance/compliance-profiles/disconnect \
  -H 'Content-Type: application/json' \
  -d '{"framework": "SUPPLY_CHAIN"}' | jq .
```

- [ ] Returns 204 (or 404 if profile not in DB — expected in mock mode since mock profiles aren't in SQLite)

### E.2 Connect a profile

```bash
curl -s -X POST http://localhost:7007/api/compliance/compliance-profiles/connect \
  -H 'Content-Type: application/json' \
  -d '{"framework": "SUPPLY_CHAIN", "version": "1.0.0", "displayName": "Supply Chain Scan"}' | jq .
```

- [ ] Returns 200 with profile JSON (if previously created) or 404 (if no profile with that framework exists in DB)

### E.3 Permission check

```bash
# These should require auth in production mode but succeed in dev mode
curl -s -X POST http://localhost:7007/api/compliance/compliance-profiles/connect \
  -H 'Content-Type: application/json' \
  -d '{"framework": "NONEXISTENT"}' | jq .
```

- [ ] Returns 404 with error message "No profile with framework 'NONEXISTENT' found to reconnect"

---

## F. Bundle CRUD Endpoints (API-level)

### F.1 Create a profile first (needed for bundle ops)

```bash
PROFILE_ID=$(curl -s -X POST http://localhost:7007/api/compliance/compliance-profiles \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"Test Bundle Profile","framework":"CUSTOM","version":"1.0","platform":"Test"}' | jq -r .id)
echo "Created profile: $PROFILE_ID"
```

- [ ] Profile created, ID returned

### F.2 Upload a bundle

```bash
curl -s -X PUT "http://localhost:7007/api/compliance/compliance-profiles/$PROFILE_ID/bundle" \
  -H 'Content-Type: application/json' \
  -d '"export default function TestTab() { return \"hello\"; }"' | jq .
```

- [ ] Returns 201 with `{size, uploadedAt}`

### F.3 Retrieve the bundle

```bash
curl -s -D - "http://localhost:7007/api/compliance/compliance-profiles/$PROFILE_ID/bundle" 2>&1 | head -10
```

- [ ] Returns the JS content
- [ ] `Content-Type: application/javascript`
- [ ] `X-Content-Type-Options: nosniff` header present
- [ ] `Cache-Control: public, max-age=3600` header present

### F.4 Upload too-large bundle (413 test)

```bash
# Generate >5MB payload
LARGE=$(python3 -c "print('x' * 6000000)")
curl -s -X PUT "http://localhost:7007/api/compliance/compliance-profiles/$PROFILE_ID/bundle" \
  -H 'Content-Type: application/json' \
  -d "\"$LARGE\"" | jq .
```

- [ ] Returns 413 with error about exceeding 5MB limit

### F.5 Delete the bundle

```bash
curl -s -X DELETE "http://localhost:7007/api/compliance/compliance-profiles/$PROFILE_ID/bundle" -w "\n%{http_code}\n"
```

- [ ] Returns 204

### F.6 Verify bundle gone

```bash
curl -s "http://localhost:7007/api/compliance/compliance-profiles/$PROFILE_ID/bundle" | jq .
```

- [ ] Returns 404

### F.7 Cleanup

```bash
curl -s -X DELETE "http://localhost:7007/api/compliance/compliance-profiles/$PROFILE_ID" -w "\n%{http_code}\n"
```

- [ ] Returns 204

---

## G. Existing Features Regression

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

## H. Netrunner Live Scan (Layer 3)

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
- [ ] Fix text shows `dnf update <package>` instructions

### H.5 Verify dynamic tab with live data

1. Click the **Supply Chain** tab

- [ ] Summary card shows vulnerability-free rate with real data
- [ ] Severity breakdown shows actual CVE counts
- [ ] Findings table shows real CVEs
- [ ] Host breakdown shows hosts sorted by vulnerability count

### H.6 Regression: existing scans still work

1. Navigate to **New Scan** and select the STIG profile
2. Launch a STIG scan against the compliance inventory

- [ ] STIG scan completes successfully
- [ ] Results show standard STIG columns ("Rule ID", "STIG ID", "Severity")
- [ ] No dynamic tab appears for STIG profile
- [ ] Dashboard overview still renders all profiles correctly

---

## I. EE Build Verification (Layer 2)

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

## J. Collection Structure Validation

```bash
cd /path/to/aap-compliance-pipelines
python3 -m pytest profiles/_shared/test_profile_structure.py -v
```

- [ ] All 60 tests pass
- [ ] Every profile has: install.yml, uninstall.yml, backstage/, ee/, ansible_collections/, compliance-profile.yml with display block

---

## K. Normalizer Unit Tests

```bash
cd profiles/supply-chain/ansible_collections/security/compliance_supply_chain
python3 -m pytest tests/ -v
```

- [ ] All 23 tests pass
- [ ] CVE matches always produce `status: fail`
- [ ] All CFF fields present (category, disruption, aap_impact, parameters, scanner)

---

## L. Full Automated Test Suite

```bash
cd backstage-app
yarn test --watchAll=false
```

- [ ] 597 tests pass
- [ ] 22 suites pass
- [ ] Zero failures

```bash
cd /path/to/aap-compliance-pipelines
python3 -m pytest profiles/_shared/test_profile_structure.py profiles/supply-chain/ansible_collections/security/compliance_supply_chain/tests/ -v
```

- [ ] 83 Python tests pass

---

## Summary

| Section | Tests | What it verifies |
|---------|-------|-----------------|
| A | 7 | Dashboard renders with 4 profiles, no regression |
| B | 11 | Dynamic tab appears, widgets render, correct labels |
| C | 4 | Display config drives column/severity labels |
| D | 10 | Settings shows new framework options |
| E | 3 | Lifecycle API: connect/disconnect/validation |
| F | 7 | Bundle API: upload/serve/size-limit/delete |
| G | 6 | Existing features: scan, history, remediation, inventories, results, browser |
| H | 14 | Netrunner live: add profile, scan, verify results, regression |
| I | 5 | EE builds, tools at pinned versions, scanning works |
| J | 1 | Cross-profile structure validation (60 sub-tests) |
| K | 1 | Normalizer correctness (23 sub-tests) |
| L | 2 | Full automated suite (680 sub-tests) |
| **Total** | **71** | |
