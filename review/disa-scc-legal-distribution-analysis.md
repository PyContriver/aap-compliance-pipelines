---
title: "Legal Analysis: DISA SCC Distribution in Container Images"
type: reference
audience: [architect, legal, product]
product: "AAP Compliance Dashboard"
date: 2026-07-13
status: concluded
verdict: "Cannot embed in EE images; ephemeral download at scan time is legally clean"
---

# Legal Analysis: DISA SCC Distribution in Container Images

## Executive Summary

**DISA's SCAP Compliance Checker (SCC) cannot be safely redistributed inside a
pre-built container image shipped as part of a commercial product.** An ephemeral
download-at-scan-time model is the correct architecture. This analysis covers
copyright, trade secret, export control, and vendor precedent.

## 1. The Dual-Nature Problem

SCC occupies an unusual legal position where two apparently contradictory facts
are both true:

### Fact A: The compiled binary is public domain

The LICENSE.md files on both NIWC Atlantic GitHub repositories
([scap-scc](https://github.com/niwc-atlantic/scap-scc) and
[scap-content-library](https://github.com/niwc-atlantic/scap-content-library))
contain identical public domain dedications under 17 USC Section 105:

> "Pursuant to title 17 Section 105 of the United States Code this software is
> not subject to copyright protection and is in the public domain."

The license permits free redistribution and modification with only two conditions:
derivative works must note they are derived from it, and modified versions must
note they have been modified.

SCC release notes (e.g.,
[SCC 5.10 Release Notes](https://dl.dod.cyber.mil/wp-content/uploads/stigs/txt/SCC_5.10_ReleaseNotes.txt))
carry **Distribution Statement A: Approved for Public Release; distribution is
unlimited** (NIWCLANT SPR# 2021-52, approved 16 Feb 2021).

### Fact B: The source code is a trade secret

In June 2023,
[NIWC Atlantic signed a five-year licensing agreement with Ignyte Platform Inc.](https://www.niwcatlantic.navy.mil/Media/Article/3432729/naval-information-warfare-center-atlantic-signs-five-year-software-licensing-ag/)
for use of SCC's "trade secret software source code."

[Ignyte was granted the right to "commercially distribute compiled binaries"](https://executivebiz.com/2023/06/ignyte-platform-to-commercialize-navy-developed-security-compliance-checker-software/)
— implying that commercial distribution of binaries is a right NIWC explicitly
grants, not one that simply exists by default.

The Navy's
[technology transfer program](https://www.niwcpacific.navy.mil/Technology/Technology-Transfer/)
confirms the framework: "Naval developers and subject matter experts can explore
trade secret protection for their software solutions, to protect source code and
allow it to be shared with potential licensees."

### Why this matters

If the binary were truly unrestricted public domain with no strings attached,
NIWC would have had nothing to license to Ignyte. The existence of a formal
commercial licensing agreement for binary distribution rights is a strong signal
that NIWC Atlantic asserts some control over commercial redistribution of SCC
binaries, even though they carry Distribution Statement A and a public domain
LICENSE.md.

## 2. Redistribution Rights Analysis

| Factor | Assessment |
|--------|-----------|
| **Copyright** | Not copyrightable under 17 USC 105 (government work) |
| **Distribution Statement** | Statement A: Approved for public release, distribution unlimited |
| **GitHub LICENSE.md** | Public domain, free redistribution with derivative notice |
| **Trade Secret (source)** | Source code protected; binary distribution explicitly licensed to Ignyte |
| **Chocolatey package** | Downloads from official source at install time; does NOT embed binaries |
| **EULA** | SCC installer presents an "I accept" radio button — full text undisclosed outside installer |

The [Chocolatey package](https://community.chocolatey.org/packages/scap-compliance-checker)
pattern is instructive: even Chocolatey, which routinely embeds binaries from
permissive-license software, chose to **download SCC from the official DoD source
at install time** rather than embed it. The moderator notes state they "validate
embedded software against official distribution point (where distribution rights
allow redistribution)," implying they determined that redistribution rights for
SCC do NOT allow embedding.

## 3. Export Control (ITAR/EAR)

SCC is a **defensive security scanning tool** (configuration compliance checker),
not an offensive weapon or cryptographic tool.

- SCC carries **Distribution Statement A**, which means it "may be made available
  or sold to the public and foreign nationals, companies, and governments" per
  [DoD Instruction 5230.24](https://www.esd.whs.mil/portals/54/documents/dd/issuances/dodi/523024p.pdf).
- Distribution Statement A is the most permissive level — it explicitly includes
  foreign nationals and adversary governments.
- SCC is not on the
  [USML (United States Munitions List)](https://www.pmddtc.state.gov/ddtc_public?id=ddtc_kb_article_page&sys_id=24d528fddbfc930044f9ff621f961987)
  and does not appear to be EAR-controlled.
- The SCAP standard itself is a
  [NIST standard](https://csrc.nist.gov/projects/scap-validation-program/validated-products-and-modules)
  — publicly documented, openly specified.

**Risk Level: LOW.** SCC is not export-controlled.

## 4. SCAP Content vs Scanner — Different Terms

| Component | License | Redistribution |
|-----------|---------|---------------|
| **SCAP benchmarks (DISA STIGs)** | US Government work, public domain | Freely redistributable; publicly available at [public.cyber.mil](https://public.cyber.mil/stigs/) |
| **NIWC Enhanced SCAP Content** | Public domain per [GitHub LICENSE.md](https://github.com/niwc-atlantic/scap-content-library) | Freely redistributable with derivative notice |
| **SCC scanner binary** | Public domain (17 USC 105) BUT trade secret source, EULA at install, exclusive commercial license to Ignyte | Ambiguous — HIGH risk for embedding |
| **SCAP specification** | NIST standard, "not subject to copyright" | Freely redistributable |

**The content (benchmarks/STIGs) is clean. The scanner binary is the problem.**

## 5. Vendor Precedent

**No vendor has been found embedding SCC binaries in a commercial product:**

- The [Chocolatey package](https://community.chocolatey.org/packages/scap-compliance-checker)
  downloads SCC at install time — does not redistribute binaries
- [Ignyte Platform](https://www.ignyteplatform.com/) has an explicit licensing agreement
- [BMC BladeLogic](https://docs.bmc.com/docs/serverautomation/242/scanning-docker-containers-for-scap-compliance-1330197529.html)
  uses OpenSCAP for container scanning, not SCC
- No Linux distribution packages SCC in its repositories
- The [niwc-atlantic/scap-scc](https://github.com/niwc-atlantic/scap-scc) GitHub repo
  is described as an "archive of past publicly released versions" — sunset/legacy only

## 6. NIWC Atlantic GitHub Presence

[NIWC Atlantic on GitHub](https://github.com/niwc-atlantic) has two public repositories:

1. **[scap-content-library](https://github.com/niwc-atlantic/scap-content-library)** —
   SCAP benchmarks (SCAP 1.4 and archived 1.3). Licensed under public domain
   (17 USC 105). **Safe to redistribute** with derivative notice.

2. **[scap-scc](https://github.com/niwc-atlantic/scap-scc)** — Archive of past SCC
   releases (binary zip files via Git LFS). Licensed under public domain (17 USC 105).
   Contains sunset builds for discontinued platforms (RHEL 6, Solaris 10, Mac OS x86_64,
   Windows 32-bit, Raspberry Pi OS 11). Current release (5.14.1) is **NOT hosted here**.

There is **no open-source SCC scanner component**. SCC is a compiled binary with
trade-secret source code. OpenSCAP has
[discontinued Windows support](https://www.open-scap.org/tools/) (last build v1.3.4).

## 7. Risk Summary

| Option | Risk | Notes |
|--------|------|-------|
| Embed SCC binary in container image | **HIGH** | Trade secret source, unknown EULA terms, Ignyte exclusive license |
| Download SCC at scan time from cyber.mil | **LOW** | User obtains SCC; we automate, not distribute |
| Embed archived SCC from GitHub repo | **MEDIUM** | Public domain LICENSE, but legacy/sunset versions only |
| Pre-bake SCAP content (benchmarks) only | **LOW** | Public domain, freely redistributable |
| Use OpenSCAP instead of SCC | **LOW** (Linux only) | Open source, but Windows support discontinued |
| License SCC commercially from NIWC | **LOW** (if obtained) | Contact NIWC Pacific Office of IP, San Diego |

## 8. Recommended Architecture

**Ephemeral download at scan time** with cache fallback for air-gapped environments:

```
Scan triggered → EE starts → Ansible downloads SCC from dl.dod.cyber.mil
→ Caches on execution node → Copies to Windows targets via WinRM
→ Runs cscc -u (unattended scan) → Fetches XCCDF results back
→ Removes SCC from targets → Normalizes XCCDF on execution node
```

Download URL pattern:
`https://dl.dod.cyber.mil/wp-content/uploads/stigs/zip/scc-{version}_Windows_bundle.zip`

This URL does **not** require CAC authentication (PKI is for some STIG content, not SCC).

The cache fallback ensures air-gapped environments work after the first successful download:
1. Try download → cache to known path on execution node
2. If download fails AND cached copy exists → warn + continue with cached version
3. If download fails AND no cache → fail with clear error message

**SCAP benchmark content** from the GitHub repo **can** be pre-baked into the EE image
(freely redistributable, public domain).

## 9. If Zero Risk Is Required

If the product strategy requires pre-baking SCC into container images, pursue a
formal technology transfer / licensing agreement with:

**Office of Intellectual Property**
Naval Information Warfare Center Pacific
San Diego, CA 92152

This is the same path Ignyte took. Given Red Hat's scale and DoD customer base,
such an agreement may be achievable.

## Decision

Recorded in **ADR-038** (Decision 2): DISA SCC via ephemeral download with cache
fallback. SCC is downloaded at scan time on the execution node, pushed to Windows
targets via WinRM, and removed after scanning. SCAP benchmarks are pre-baked in
the EE. No redistribution of SCC binaries.
