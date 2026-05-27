# AAP Compliance Pipelines

A Backstage-based compliance management application for Ansible Automation Platform.

## Overview

AAP Compliance Pipelines provides a self-service compliance vertical for AAP, enabling platform teams to scan, review, and remediate infrastructure compliance from a unified Backstage interface.

The application integrates with AAP Controller to execute compliance scans and remediation workflows using OpenSCAP-based Ansible content.

## Architecture

```
backstage-app/
  packages/
    app/          Frontend application shell
    backend/      Backend application server
  plugins/
    compliance/          Frontend plugin (dashboard, scan, results, remediation)
    compliance-backend/  Backend plugin (REST API, database, Controller client)
    compliance-common/   Shared types and API client
```

## Key Capabilities

- **Compliance Dashboard** -- Posture overview across multiple frameworks (DISA STIG, CIS, PCI-DSS)
- **Profile Browser** -- Browse and inspect compliance profiles and their rule categories
- **Scan Launcher** -- Launch compliance scans against AAP inventories
- **Results Viewer** -- Multi-host findings table with severity filtering and host-level breakdown
- **Remediation Builder** -- Selectively enable/disable rules, configure parameters, choose scope
- **Remediation Execution** -- Apply remediation with progress tracking and before/after comparison

## Getting Started

See the root [README.md](../README.md) for setup instructions.

## Plugin Documentation

- [Compliance Plugin](plugins/compliance.md) -- Frontend plugin architecture and components
- [Compliance Dashboard](features/compliance-dashboard.md) -- Dashboard feature details
- [Remediation](features/remediation-profile.md) -- Remediation builder feature

## Setup Guides

- [Controller Setup](features/controller-setup.md) -- Automated and manual setup of AAP Controller resources for the compliance pipeline
- [Manual Setup (legacy)](features/manual-setup.md) -- Previous manual setup instructions
