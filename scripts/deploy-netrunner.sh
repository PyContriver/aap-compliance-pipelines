#!/usr/bin/env bash
#
# Deploy compliance plugins to Netrunner Portal.
# Handles: version bump, export-dynamic, migrations, pack, upload, config, restart.
#
# Usage:
#   ./scripts/deploy-netrunner.sh              # bump patch, deploy both
#   ./scripts/deploy-netrunner.sh backend      # backend only
#   ./scripts/deploy-netrunner.sh frontend     # frontend only
#   ./scripts/deploy-netrunner.sh --no-bump    # skip version bump
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKSTAGE="$REPO_ROOT/backstage-app"
PORTAL_HOST="cloud-user@ec2-18-134-232-9.eu-west-2.compute.amazonaws.com"
PORTAL_KEY="$HOME/.claude/keys/portal-netrunner.pem"
REMOTE_PLUGIN_DIR="/var/lib/portal/compliance-plugins"
OVERRIDE_YAML="/etc/portal/configs/dynamic-plugins/dynamic-plugins.override.yaml"

SSH_OPTS="-i $PORTAL_KEY -o StrictHostKeyChecking=no -o LogLevel=ERROR"

BE_PKG="$BACKSTAGE/plugins/compliance-backend"
FE_PKG="$BACKSTAGE/plugins/compliance"

DEPLOY_BE=true
DEPLOY_FE=true
DO_BUMP=true

for arg in "$@"; do
  case "$arg" in
    backend)  DEPLOY_FE=false ;;
    frontend) DEPLOY_BE=false ;;
    --no-bump) DO_BUMP=false ;;
  esac
done

bump_patch() {
  local pkg="$1"
  local current
  current=$(grep '"version"' "$pkg/package.json" | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
  local major minor patch
  IFS='.' read -r major minor patch <<< "$current"
  patch=$((patch + 1))
  local new_version="$major.$minor.$patch"
  sed -i.bak "s/\"version\": \"$current\"/\"version\": \"$new_version\"/" "$pkg/package.json"
  rm -f "$pkg/package.json.bak"
  echo "$new_version"
}

get_version() {
  grep '"version"' "$1/package.json" | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/'
}

echo "=== Compliance Plugin Deploy to Netrunner ==="
echo ""

cd "$BACKSTAGE"

# Step 1: Version bump
if $DO_BUMP; then
  if $DEPLOY_BE; then
    BE_VER=$(bump_patch "$BE_PKG")
    echo "[1/7] Backend bumped to v$BE_VER"
  fi
  if $DEPLOY_FE; then
    FE_VER=$(bump_patch "$FE_PKG")
    echo "[1/7] Frontend bumped to v$FE_VER"
  fi
  yarn install --mode=update-lockfile 2>/dev/null || yarn install 2>/dev/null
else
  echo "[1/7] Skipping version bump"
fi

BE_VER=$(get_version "$BE_PKG")
FE_VER=$(get_version "$FE_PKG")

# Step 2: Export dynamic plugins
if $DEPLOY_BE; then
  echo "[2/7] Exporting backend dynamic plugin..."
  yarn workspace @aap-compliance/plugin-compliance-backend export-dynamic > /dev/null 2>&1
  cp "$BE_PKG/migrations/"*.js "$BE_PKG/dist-dynamic/migrations/"
  mkdir -p "$BE_PKG/dist-dynamic/dist/database/migrations"
  cp "$BE_PKG/migrations/"*.js "$BE_PKG/dist-dynamic/dist/database/migrations/"
  echo "       Migrations copied to both paths ($(ls "$BE_PKG/dist-dynamic/migrations/" | wc -l | tr -d ' ') files)"
fi

if $DEPLOY_FE; then
  echo "[2/7] Exporting frontend dynamic plugin..."
  yarn workspace @aap-compliance/plugin-compliance export-dynamic > /dev/null 2>&1
fi

# Step 3: Pack tarballs
TARBALLS=()
if $DEPLOY_BE; then
  cd "$BE_PKG/dist-dynamic"
  BE_TGZ="aap-compliance-plugin-compliance-backend-dynamic-${BE_VER}.tgz"
  npm pack --quiet > /dev/null 2>&1
  echo "[3/7] Packed backend: $BE_TGZ"
  TARBALLS+=("$BE_PKG/dist-dynamic/$BE_TGZ")
  cd "$BACKSTAGE"
fi

if $DEPLOY_FE; then
  cd "$FE_PKG/dist-dynamic"
  FE_TGZ="aap-compliance-plugin-compliance-dynamic-${FE_VER}.tgz"
  npm pack --quiet > /dev/null 2>&1
  echo "[3/7] Packed frontend: $FE_TGZ"
  TARBALLS+=("$FE_PKG/dist-dynamic/$FE_TGZ")
  cd "$BACKSTAGE"
fi

# Step 3.5: Copy to deploy-artifacts for CI
ARTIFACTS_DIR="$REPO_ROOT/deploy-artifacts"
mkdir -p "$ARTIFACTS_DIR"
if $DEPLOY_BE; then
  cp "$BE_PKG/dist-dynamic/$BE_TGZ" "$ARTIFACTS_DIR/backend.tgz"
fi
if $DEPLOY_FE; then
  cp "$FE_PKG/dist-dynamic/$FE_TGZ" "$ARTIFACTS_DIR/frontend.tgz"
fi
echo "[3.5/7] Tarballs copied to deploy-artifacts/ (commit to trigger CI deploy)"

# Step 3.6: Validate tarball format
for tgz in "${TARBALLS[@]}"; do
  FIRST_ENTRY=$(tar tzf "$tgz" | head -1)
  if [[ "$FIRST_ENTRY" != package/* ]]; then
    echo "ERROR: $tgz is not a valid npm-pack tarball."
    echo "  First entry: '$FIRST_ENTRY' (must start with 'package/')"
    exit 1
  fi
  SIZE_MB=$(du -m "$tgz" | cut -f1)
  if [ "$SIZE_MB" -gt 50 ]; then
    echo "ERROR: $tgz is ${SIZE_MB}MB — too large (>50MB)."
    exit 1
  fi
done
echo "[3.6/7] Tarball format validated (npm-pack, <50MB each)"

# Step 4: Upload
echo "[4/7] Uploading to Portal host..."
scp $SSH_OPTS "${TARBALLS[@]}" "$PORTAL_HOST:/tmp/"
ssh $SSH_OPTS "$PORTAL_HOST" "sudo cp /tmp/aap-compliance-plugin-compliance-*dynamic-*.tgz $REMOTE_PLUGIN_DIR/"
echo "       Uploaded ${#TARBALLS[@]} tarball(s)"

# Step 5: Update config with integrity hashes
echo "[5/7] Updating Portal config..."
PYTHON_SCRIPT="
import yaml, subprocess, base64, sys

with open('$OVERRIDE_YAML') as f:
    data = yaml.safe_load(f)

updated = []
for plugin in data['plugins']:
    pkg = plugin.get('package', '')
"

if $DEPLOY_BE; then
  PYTHON_SCRIPT+="
    if 'compliance-backend-dynamic' in pkg:
        new_pkg = '$REMOTE_PLUGIN_DIR/$BE_TGZ'
        h = subprocess.check_output(['openssl', 'dgst', '-sha512', '-binary', new_pkg])
        plugin['package'] = new_pkg
        plugin['integrity'] = 'sha512-' + base64.b64encode(h).decode()
        updated.append(f'backend v$BE_VER')
"
fi

if $DEPLOY_FE; then
  PYTHON_SCRIPT+="
    if 'compliance-dynamic' in pkg and 'backend' not in pkg:
        new_pkg = '$REMOTE_PLUGIN_DIR/$FE_TGZ'
        h = subprocess.check_output(['openssl', 'dgst', '-sha512', '-binary', new_pkg])
        plugin['package'] = new_pkg
        plugin['integrity'] = 'sha512-' + base64.b64encode(h).decode()
        updated.append(f'frontend v$FE_VER')
"
fi

PYTHON_SCRIPT+="
with open('$OVERRIDE_YAML', 'w') as f:
    yaml.dump(data, f, default_flow_style=False, sort_keys=False, width=200)
print(', '.join(updated))
"

RESULT=$(ssh $SSH_OPTS "$PORTAL_HOST" "sudo python3 -c $(printf '%q' "$PYTHON_SCRIPT")")
echo "       Updated: $RESULT"

# Step 6: Restart Portal
echo "[6/7] Restarting Portal service..."
ssh $SSH_OPTS "$PORTAL_HOST" "sudo systemctl restart portal.service"

# Step 7: Wait and verify
echo "[7/7] Waiting for startup (120s)..."
sleep 120

STATUS=$(ssh $SSH_OPTS "$PORTAL_HOST" "sudo systemctl is-active portal.service")
if [ "$STATUS" = "active" ]; then
  LOGS=$(ssh $SSH_OPTS "$PORTAL_HOST" "sudo podman logs portal 2>&1 | grep -E 'compliance.*info|loaded.*compliance' | tail -5")
  echo ""
  echo "=== Deploy successful ==="
  if $DEPLOY_BE; then echo "  Backend:  v$BE_VER"; fi
  if $DEPLOY_FE; then echo "  Frontend: v$FE_VER"; fi
  echo ""
  echo "$LOGS"
else
  echo ""
  echo "=== WARNING: Portal status is '$STATUS' ==="
  echo "Check logs: ssh $SSH_OPTS $PORTAL_HOST 'sudo podman logs portal 2>&1 | tail -30'"
  exit 1
fi
