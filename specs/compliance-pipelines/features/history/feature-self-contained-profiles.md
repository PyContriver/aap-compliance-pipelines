# Feature: Self-Contained Compliance Profiles

**Status:** Shipped (2026-05-26)
**Commits:** `6c2d642`, `f89f0c9`, `602ae6b`
**ADR:** ADR-006

## Problem

When adding a new compliance profile (CIS Benchmark, PCI-DSS, etc.), should the plugin enrich findings with metadata from a local database, or should all metadata come from the scanner pipeline? Plugin enrichment would require redeployment for every new profile, coupling the plugin release cycle to the content release cycle.

## Design Approach

The plugin does not enrich findings. It displays exactly what it receives via the CFF pipeline. All metadata -- descriptions, check/fix text, parameter definitions -- must be populated by the findings source:

- **Tier 1 (OpenSCAP):** `normalize_xccdf` extracts all metadata from the XCCDF datastream
- **Tier 2 (external):** Normalizer must map scanner output to CFF and populate all metadata fields

Adding a new profile to Controller (Git project + JT) makes it work end-to-end without repackaging the plugin.

## Implementation Summary

- Documented the self-contained profile contract in `docs/`
- Removed bundled rules YAML from plugin dependency chain
- Fixed rules YAML path resolution in dist-dynamic packaging
- Included rules YAML in dist-dynamic package only as a fallback reference (not for enrichment)
- `normalize_xccdf.py` populates all CFF metadata fields from XCCDF datastream

## Testing

- Verified profiles work without plugin-side rules database
- End-to-end scan confirmed all metadata fields populated from datastream alone

## Dependencies

- ADR-001 (scanner orchestrator) -- the CFF contract that profiles must satisfy
- ADR-004 (oscap migration) -- the Tier 1 normalizer that extracts metadata from XCCDF
