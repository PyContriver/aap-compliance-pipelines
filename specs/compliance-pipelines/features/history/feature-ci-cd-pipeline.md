# Feature: CI/CD Pipeline

**Status:** Shipped (2026-05-26, PRs #2-#3)
**Commits:** `6c7c10e` (PR #2), `2fd5a5c` (PR #2), `1b4640a` (PR #3)

## Problem

The project had no automated testing or build pipeline. Code was committed directly to main with no branch protection, no CI validation, and no automated artifact generation. This made it impossible to catch regressions before merging or to produce dist-dynamic tarballs for Portal deployment.

## Design Approach

GitHub Actions CI pipeline matching downstream patterns:
- Test + build on every PR
- Export-dynamic + tarball artifacts on main merge
- Concurrency groups to prevent parallel runs on same branch
- Branch protection enforced on GitHub and GitLab mirror

## Implementation Summary

- `.github/workflows/ci.yml`: test, build, export-dynamic, upload artifacts
- Concurrency groups documented and configured
- Branch protection rules enabled on `main`
- PR #3: Fixed Yarn 4 activation via Corepack (CI used Yarn 1 by default)
- Artifacts: frontend and backend dist-dynamic tarballs for Portal deployment

## Testing

- CI pipeline validated on PRs #4+ (all subsequent work goes through CI)
- Yarn 4 Corepack activation confirmed working in GitHub Actions environment

## Dependencies

- Yarn 4 (Berry) with PnP or node-modules linker
- `@red-hat-developer-hub/cli` for export-dynamic packaging
- GitHub branch protection settings
