# GitLab CI/CD Setup — Netrunner Portal Deploy

Pipeline file: `.gitlab-ci.yml` (already in repo)  
GitLab project: `https://gitlab.cee.redhat.com/mferrari/aap-compliance-pipelines`

## Pipeline Stages

```
test → build → deploy-netrunner
```

- **test**: `yarn tsc --noEmit` + `yarn test` — runs on MRs and main
- **build**: version bump, export-dynamic, pack tarballs — runs on main only
- **deploy-netrunner**: SSH to Portal VM, upload, update config, restart — runs on main (auto) or manual on branches

## Required CI/CD Variables

Set these in **GitLab → Settings → CI/CD → Variables** (masked + protected):

### `PORTAL_SSH_KEY`

- **Type:** File or Variable (paste PEM content)
- **Mask:** Yes
- **Protect:** Yes (main branch only)
- **Value:** Contents of the Portal SSH private key

The local copy is at:
```
~/.claude/keys/portal-netrunner.pem
```

To get the value:
```bash
cat ~/.claude/keys/portal-netrunner.pem
```

### `PORTAL_HOST`

- **Type:** Variable
- **Mask:** Yes
- **Protect:** Yes
- **Value:**
```
cloud-user@ec2-18-134-232-9.eu-west-2.compute.amazonaws.com
```

## Portal Target Details

| Setting | Value |
|---------|-------|
| SSH user | `cloud-user` |
| SSH host | `ec2-18-134-232-9.eu-west-2.compute.amazonaws.com` |
| SSH key | `~/.claude/keys/portal-netrunner.pem` |
| Plugin dir | `/var/lib/portal/compliance-plugins` |
| Config YAML | `/etc/portal/configs/dynamic-plugins/dynamic-plugins.override.yaml` |
| Service | `portal.service` (podman container named `portal`) |
| Portal URL | `https://dev-portal-netrunner.demoredhat.com/` |
| Plugin route | `/compliance` |

## What the Deploy Does

1. Uploads backend + frontend `.tgz` tarballs to `/tmp/` on Portal VM
2. Copies them to `/var/lib/portal/compliance-plugins/`
3. Runs a Python script over SSH that:
   - Reads `dynamic-plugins.override.yaml`
   - Updates `package` paths to the new tarballs
   - Computes `sha512` integrity hashes via `openssl dgst`
   - Writes the updated YAML
4. Restarts `portal.service`
5. Waits 120s, checks `systemctl is-active`, tails logs for compliance plugin load

## Manual Deploy Fallback

If GitLab CI is down, use the local deploy script:
```bash
./scripts/deploy-netrunner.sh              # both plugins
./scripts/deploy-netrunner.sh backend      # backend only
./scripts/deploy-netrunner.sh frontend     # frontend only
./scripts/deploy-netrunner.sh --no-bump    # skip version bump
```

Requires `~/.claude/keys/portal-netrunner.pem` on the local machine.

## Version Bump Strategy

Both CI and the deploy script auto-bump the patch version before building. This avoids a Portal bug where same-version tarballs get cleaned up during restart. The version bump happens in-pipeline (CI) or in-place (local script) — package.json changes are NOT committed back.

## Verifying a Deploy

```bash
# Check Portal service
ssh -i ~/.claude/keys/portal-netrunner.pem cloud-user@ec2-18-134-232-9.eu-west-2.compute.amazonaws.com \
  "sudo systemctl is-active portal.service"

# Check plugin loaded
ssh -i ~/.claude/keys/portal-netrunner.pem cloud-user@ec2-18-134-232-9.eu-west-2.compute.amazonaws.com \
  "sudo podman logs portal 2>&1 | grep -E 'compliance.*info|loaded.*compliance' | tail -10"

# Check in browser
open https://dev-portal-netrunner.demoredhat.com/compliance
```
