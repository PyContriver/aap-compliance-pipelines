# Supply Chain Vulnerability Scan Profile

Supply chain vulnerability scanning for the AAP Compliance Dashboard using
[Syft](https://github.com/anchore/syft) (SBOM generation) and
[Grype](https://github.com/anchore/grype) (vulnerability matching).

## What It Does

1. **Scan**: Generates an SBOM on each target host using Syft, then matches
   packages against known CVEs using Grype
2. **Normalize**: Converts CycloneDX + Grype JSON output to Common Findings
   Format (CFF) for ingestion by the compliance dashboard
3. **Remediate**: Applies package updates (`dnf update` / `apt upgrade`) for
   vulnerable packages

## Supported Platforms

| Platform | Package Coverage | CVE Matching |
|----------|-----------------|--------------|
| RHEL 7, 8, 9 | Full | Full |
| CentOS 7, Stream 8/9 | Full | Full |
| Ubuntu (LTS) | Full | Full |
| Debian | Full | Full |
| Alpine Linux | Full | Full |
| Amazon Linux 1, 2, 2023 | Full | Full |
| SUSE / SLES | Full | Full |
| Oracle Linux | Full | Full |
| Container images (OCI) | Full | Full |
| Windows Server | App-level only | App-level only |

## Directory Structure

```
supply-chain/
  ansible_collections/security/compliance_supply_chain/
    meta/compliance-profile.yml   # Profile metadata + display config
    playbooks/
      run_scan.yml                # Syft + Grype scan → normalize → POST
      remediate.yml               # dnf/apt update for vulnerable packages
    plugins/
      modules/normalize_cyclonedx.py   # CycloneDX+Grype → CFF normalizer
      module_utils/normalize_common.py # Shared normalizer utilities
    tests/                        # Unit tests
  ee/execution-environment.yml    # EE with Syft + Grype
  backstage/                      # Optional: custom dashboard tab (Tier 2)
  install.yml                     # Register profile on Controller + backend
  uninstall.yml                   # Disconnect profile (preserves history)
```

## Installation

```bash
ansible-playbook install.yml \
  -e aap_host=https://controller.example.com \
  -e aap_token=<token>
```

## Uninstallation

```bash
ansible-playbook uninstall.yml \
  -e aap_host=https://controller.example.com \
  -e aap_token=<token>
```

Historical findings and scan data are preserved for audit. Run `install.yml`
again to reconnect the profile with all its history intact.
