---
title: "Standalone Deployment Guide"
description: "Deploy the AAP Compliance Dashboard as a standalone application for demos and testing"
type: guide
audience: [operator]
product: "AAP Compliance Dashboard"
product_version: "2.6"
status: current
last_verified: 2026-07-09
prerequisites:
  - Node.js 20+
  - Corepack enabled
related:
  - deployment-guide.md
  - architecture-diagram.md
---

# Standalone Deployment Guide

Deploy the AAP Compliance Dashboard as a standalone application on a server for internal testing and demos. This guide covers both mock mode (no AAP required) and live mode (connected to an AAP Controller).

> **Audience:** Internal teams evaluating or demo-ing the compliance dashboard without access to a full Portal/RHDH deployment.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20 or 22 LTS | `node --version` |
| Corepack | Built into Node 20+ | `corepack enable` |
| Yarn | 4.x (managed by Corepack) | Auto-installed on first `yarn install` |
| Git | Any recent | Clone the repository |

## Quick Start (Mock Mode)

Mock mode seeds the database with realistic demo data on startup. No AAP Controller needed.

```bash
# 1. Clone and install
git clone <repo-url> aap-compliance-pipelines
cd aap-compliance-pipelines/backstage-app
yarn install

# 2. Generate a backend secret
export BACKEND_SECRET=$(openssl rand -hex 32)

# 3. Start in mock mode
./bin/start.sh mock
```

Open `http://localhost:3000/compliance` in your browser.

## Network Configuration (Remote Access)

If other machines need to reach the dashboard, update `app-config.yaml`:

```yaml
app:
  baseUrl: http://<your-server-ip>:3000

backend:
  baseUrl: http://<your-server-ip>:7007
  listen:
    port: 7007
    host: 0.0.0.0          # Accept connections from all interfaces
  cors:
    origin:
      - http://<your-server-ip>:3000
      - http://localhost:3000
    methods: [GET, HEAD, PATCH, POST, PUT, DELETE]
    credentials: true
```

**Firewall:** Open ports 3000 (frontend) and 7007 (backend API).

## BACKEND_SECRET

The Portal backend uses `BACKEND_SECRET` for service-to-service authentication between the frontend and backend. Without it, API calls from the frontend will fail with auth errors.

**How it works:**
- Referenced in `app-config.yaml` at `backend.auth.keys[0].secret`
- Value comes from the `BACKEND_SECRET` environment variable
- In local dev (`yarn dev`), the backend auto-generates a secret per startup
- For standalone deployment, set a fixed value so it persists across restarts

**Set it via environment variable:**
```bash
export BACKEND_SECRET=$(openssl rand -hex 32)
./bin/start.sh mock
```

**Or via `.env` file:**
```bash
cp .env.example .env
# Edit .env and set BACKEND_SECRET=<your-generated-secret>
./bin/start.sh mock .env
```

**Symptoms of missing BACKEND_SECRET:**
- Error on startup: `Backend secret is not configured`
- Blank dashboard with network errors in browser console
- API calls return 401 Unauthorized

## Mock Mode

Mock mode (`./bin/start.sh mock`) starts the dashboard with a fully seeded local SQLite database. The seeder populates:

- **4 compliance profiles** — DISA STIG, CIS L1, PCI-DSS, Supply Chain
- **8 scans** across profiles and inventories with finding-level state transitions
- **~1,700 findings** with new/active/fixed/resurfaced states and N/A entries
- **14 posture snapshots** for 30-day trend history
- **3 remediation profiles** with saved rule selections
- **3 remediation executions** (succeeded, running, failed) with chain view data
- **1 baseline target** pinned for dual-layer scoring
- **2 SBOM artifacts** for supply chain download buttons

All features are exercisable: scan history with grouping and diff, chain view, baseline toggle, inventory tab, dynamic tabs with widgets, trend chart with scope selector, and severity heatmap.

**What mock mode does NOT do:**
- Launch real scans or remediations (returns simulated job IDs)
- Connect to an AAP Controller
- Download real SBOM artifacts from PAH (download buttons render but 404 on click)

**Data persistence:** Mock data is stored in `./sqlite-data/`. Delete this directory to reset.

## Live Mode

Connect to a real AAP Controller for live scanning and remediation.

```bash
# Generate a backend secret and create .env with AAP credentials
BACKEND_SECRET=$(openssl rand -hex 32)
cat > .env << EOF
AAP_HOST=https://your-aap-controller.example.com
AAP_API_TOKEN=your-api-token-here
BACKEND_SECRET=${BACKEND_SECRET}
EOF

# Start in live mode
./bin/start.sh live .env
```

See [Controller Setup](../backstage-app/docs/features/controller-setup.md) for AAP resource configuration.

## Systemd Service (Optional)

For persistent deployment on a Linux server:

```ini
# /etc/systemd/system/compliance-dashboard.service
[Unit]
Description=AAP Compliance Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/aap-compliance-pipelines/backstage-app
Environment=BACKEND_SECRET=<your-secret-here>
ExecStart=/usr/bin/bash bin/start.sh mock
ExecStop=/usr/bin/bash bin/stop.sh
Restart=on-failure
User=dashboard

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now compliance-dashboard
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Blank dashboard, no data | Missing seed data | Delete `sqlite-data/` and restart |
| `Backend secret is not configured` | BACKEND_SECRET not set | Set via env var or `.env` file |
| CORS errors in browser console | `baseUrl` mismatch | Update `app.baseUrl`, `backend.baseUrl`, and `backend.cors.origin` to match server IP |
| `Cannot reach Controller` | Live mode without AAP | Switch to mock mode or configure AAP credentials |
| Port already in use | Previous instance running | Run `./bin/stop.sh` first |
| Dashboard loads but pages are empty | Old database schema | Delete `sqlite-data/` directory and restart |
| `EACCES: permission denied` on sqlite-data | File permissions | Ensure the `sqlite-data/` directory is writable by the running user |

## See Also

- [Deployment Guide](deployment-guide.md) — Portal/RHDH dynamic plugin deployment
- [Controller Setup](../backstage-app/docs/features/controller-setup.md) — AAP resource configuration
- [Architecture Diagram](architecture-diagram.md) — System components and data flow
