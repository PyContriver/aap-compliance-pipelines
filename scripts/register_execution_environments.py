#!/usr/bin/env python3
"""Register compliance Execution Environments on AAP Controller.

Discovers all profiles under profiles/, reads their EE definitions and
compliance-profile.yml metadata, and registers (or updates) each EE on
the AAP Controller via the REST API.

The script supports two workflows:
  1. Register pre-built images already pushed to a registry (default).
  2. Build images locally with ansible-builder, push to a registry,
     then register on Controller (--build flag).

Usage:
    # Register pre-built images (images must already exist in the registry)
    python scripts/register_execution_environments.py

    # Build + push + register
    python scripts/register_execution_environments.py --build --push

    # Dry-run: show what would be registered without calling Controller
    python scripts/register_execution_environments.py --dry-run

    # Override the registry prefix
    python scripts/register_execution_environments.py --registry quay.io/myorg

    # Register only specific profiles
    python scripts/register_execution_environments.py --profiles rhel9-stig supply-chain

Environment variables:
    AAP_HOST          AAP Controller base URL (required)
    AAP_API_TOKEN     Bearer token for Controller API (required)
    EE_REGISTRY       Default registry prefix (default: from --registry or built-in)
    AAP_ORGANIZATION  Organization name (default: Default)
"""

import argparse
import glob
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
import ssl

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILES_DIR = os.path.join(REPO_ROOT, 'profiles')

DEFAULT_REGISTRY = 'aap-netrunner.demoredhat.com'

# Maps profile directory name → EE image name and metadata.
# Auto-discovered from profiles/*/ee/execution-environment.yml and
# profiles/*/ansible_collections/*/compliance-profile.yml at runtime.


def find_profiles():
    """Discover all profile directories (excluding _shared)."""
    dirs = sorted(glob.glob(os.path.join(PROFILES_DIR, '*')))
    return [
        d for d in dirs
        if os.path.isdir(d) and not os.path.basename(d).startswith('_')
    ]


def load_yaml_file(path):
    """Load a YAML file, returning None on failure."""
    if not HAS_YAML:
        print('ERROR: PyYAML required. Install with: pip install pyyaml', file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return yaml.safe_load(f)


def find_compliance_profile_yml(profile_dir):
    """Find meta/compliance-profile.yml inside a profile's collection."""
    pattern = os.path.join(
        profile_dir, 'ansible_collections', '*', '*', 'meta', 'compliance-profile.yml',
    )
    matches = glob.glob(pattern)
    return matches[0] if matches else None


def find_ee_definition(profile_dir):
    """Find the EE definition file for a profile."""
    ee_path = os.path.join(profile_dir, 'ee', 'execution-environment.yml')
    if os.path.exists(ee_path):
        return ee_path
    meta_pattern = os.path.join(
        profile_dir, 'ansible_collections', '*', '*', 'meta', 'execution-environment.yml',
    )
    matches = glob.glob(meta_pattern)
    return matches[0] if matches else None


def derive_image_tag(profile_name):
    """Derive a container image tag from the profile directory name.

    profiles/rhel9-stig      → compliance-stig-rhel9
    profiles/rhel9-cis-l1    → compliance-cis-l1-rhel9
    profiles/rhel9-cis-l2    → compliance-cis-l2-rhel9
    profiles/supply-chain    → compliance-supply-chain
    """
    name = os.path.basename(profile_name)
    if name.startswith('rhel9-'):
        suffix = name[len('rhel9-'):]
        return f'compliance-{suffix}-rhel9'
    return f'compliance-{name}'


def gather_ee_info(profile_dirs, registry):
    """Build a list of EE registration payloads from discovered profiles."""
    ee_list = []

    for profile_dir in profile_dirs:
        profile_name = os.path.basename(profile_dir)
        ee_def_path = find_ee_definition(profile_dir)
        if not ee_def_path:
            print(f'  SKIP {profile_name}: no execution-environment.yml found')
            continue

        compliance_yml_path = find_compliance_profile_yml(profile_dir)
        compliance_meta = {}
        if compliance_yml_path:
            data = load_yaml_file(compliance_yml_path)
            if data and 'profile' in data:
                compliance_meta = data['profile']

        image_tag = derive_image_tag(profile_dir)
        image_full = f'{registry}/{image_tag}:latest'

        display_name = compliance_meta.get('name', profile_name)
        scanner = compliance_meta.get('scanner', 'unknown')
        framework = compliance_meta.get('framework', 'unknown')
        platform = compliance_meta.get('platform', 'unknown')

        description = (
            f'{display_name} — Execution Environment for {framework} '
            f'compliance scanning ({scanner}) on {platform}.'
        )

        ee_list.append({
            'profile_name': profile_name,
            'display_name': display_name,
            'image_tag': image_tag,
            'image': image_full,
            'description': description,
            'framework': framework,
            'scanner': scanner,
            'platform': platform,
            'ee_def_path': ee_def_path,
            'profile_dir': profile_dir,
        })

    return ee_list


def controller_api(method, endpoint, aap_host, token, body=None, check_ssl=False):
    """Make an HTTP request to the AAP Controller API."""
    url = f'{aap_host.rstrip("/")}/{endpoint.lstrip("/")}'
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    }

    data = json.dumps(body).encode('utf-8') if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    ctx = ssl.create_default_context()
    if not check_ssl:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            resp_body = resp.read().decode('utf-8')
            return resp.status, json.loads(resp_body) if resp_body else {}
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode('utf-8') if e.fp else ''
        try:
            return e.code, json.loads(resp_body)
        except (json.JSONDecodeError, ValueError):
            return e.code, {'error': resp_body}
    except urllib.error.URLError as e:
        print(f'  ERROR: Cannot reach {url}: {e.reason}', file=sys.stderr)
        return 0, {'error': str(e.reason)}


def find_existing_ee(aap_host, token, image, check_ssl=False):
    """Check if an EE with the given image already exists on Controller."""
    endpoint = f'api/controller/v2/execution_environments/?image={image}&page_size=1'
    status, data = controller_api('GET', endpoint, aap_host, token, check_ssl=check_ssl)
    if status == 200 and data.get('count', 0) > 0:
        return data['results'][0]
    return None


def find_organization_id(aap_host, token, org_name, check_ssl=False):
    """Resolve an organization name to its ID."""
    endpoint = f'api/controller/v2/organizations/?name={org_name}&page_size=1'
    status, data = controller_api('GET', endpoint, aap_host, token, check_ssl=check_ssl)
    if status == 200 and data.get('count', 0) > 0:
        return data['results'][0]['id']
    return None


def register_ee(aap_host, token, ee_info, org_id=None, check_ssl=False):
    """Register or update an EE on Controller.

    Returns (action, ee_id) where action is 'created', 'updated', or 'exists'.
    """
    existing = find_existing_ee(aap_host, token, ee_info['image'], check_ssl=check_ssl)

    payload = {
        'name': ee_info['image_tag'],
        'image': ee_info['image'],
        'description': ee_info['description'],
        'pull': 'missing',
    }
    if org_id:
        payload['organization'] = org_id

    if existing:
        ee_id = existing['id']
        needs_update = (
            existing.get('description', '') != payload['description']
            or existing.get('name', '') != payload['name']
        )
        if needs_update:
            status, data = controller_api(
                'PATCH',
                f'api/controller/v2/execution_environments/{ee_id}/',
                aap_host, token, body=payload, check_ssl=check_ssl,
            )
            if status in (200, 204):
                return 'updated', ee_id
            print(f'  WARN: Update failed (HTTP {status}): {data}')
            return 'exists', ee_id
        return 'exists', ee_id

    status, data = controller_api(
        'POST',
        'api/controller/v2/execution_environments/',
        aap_host, token, body=payload, check_ssl=check_ssl,
    )
    if status in (200, 201):
        return 'created', data.get('id', '?')
    if status == 400 and 'already exists' in str(data):
        return 'exists', '?'
    print(f'  ERROR: Create failed (HTTP {status}): {data}')
    return 'failed', None


def build_ee(ee_info, tag_override=None):
    """Build an EE image locally using ansible-builder."""
    ee_def = ee_info['ee_def_path']
    tag = tag_override or ee_info['image']
    print(f'  Building {tag} from {os.path.relpath(ee_def, REPO_ROOT)} ...')

    cmd = [
        'ansible-builder', 'build',
        '-f', ee_def,
        '-t', tag,
        '-v3',
        '--container-runtime', os.environ.get('CONTAINER_RUNTIME', 'podman'),
    ]
    result = subprocess.run(cmd, cwd=ee_info['profile_dir'], capture_output=True, text=True)
    if result.returncode != 0:
        print(f'  BUILD FAILED:\n{result.stderr}', file=sys.stderr)
        return False
    print(f'  Build succeeded: {tag}')
    return True


def push_ee(image):
    """Push an EE image to the registry."""
    runtime = os.environ.get('CONTAINER_RUNTIME', 'podman')
    print(f'  Pushing {image} ...')
    result = subprocess.run([runtime, 'push', image], capture_output=True, text=True)
    if result.returncode != 0:
        print(f'  PUSH FAILED:\n{result.stderr}', file=sys.stderr)
        return False
    print(f'  Push succeeded: {image}')
    return True


def main():
    parser = argparse.ArgumentParser(
        description='Register compliance Execution Environments on AAP Controller.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        '--registry', default=os.environ.get('EE_REGISTRY', DEFAULT_REGISTRY),
        help=f'Container registry prefix (default: {DEFAULT_REGISTRY})',
    )
    parser.add_argument(
        '--profiles', nargs='*', default=None,
        help='Specific profile names to process (default: all)',
    )
    parser.add_argument(
        '--organization', default=os.environ.get('AAP_ORGANIZATION', 'Default'),
        help='AAP organization name (default: Default)',
    )
    parser.add_argument(
        '--build', action='store_true',
        help='Build EE images locally with ansible-builder before registering',
    )
    parser.add_argument(
        '--push', action='store_true',
        help='Push built images to the registry (requires --build or pre-built images)',
    )
    parser.add_argument(
        '--check-ssl', action='store_true',
        help='Verify SSL certificates when calling Controller API (default: skip)',
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Show what would be registered without making any API calls',
    )
    parser.add_argument(
        '--list', action='store_true', dest='list_only',
        help='List discovered EEs and exit (no API calls)',
    )
    args = parser.parse_args()

    aap_host = os.environ.get('AAP_HOST', '')
    aap_token = os.environ.get('AAP_API_TOKEN', '')

    if not args.dry_run and not args.list_only:
        if not aap_host:
            print('ERROR: AAP_HOST environment variable is required.', file=sys.stderr)
            sys.exit(1)
        if not aap_token:
            print('ERROR: AAP_API_TOKEN environment variable is required.', file=sys.stderr)
            sys.exit(1)

    profile_dirs = find_profiles()
    if args.profiles:
        selected = set(args.profiles)
        profile_dirs = [d for d in profile_dirs if os.path.basename(d) in selected]
        found = {os.path.basename(d) for d in profile_dirs}
        missing = selected - found
        if missing:
            print(f'WARNING: profiles not found: {", ".join(sorted(missing))}', file=sys.stderr)

    if not profile_dirs:
        print('No profiles found under profiles/.')
        sys.exit(1)

    print(f'Discovered {len(profile_dirs)} profiles under profiles/')
    ee_list = gather_ee_info(profile_dirs, args.registry)

    if not ee_list:
        print('No EE definitions found in any profile.')
        sys.exit(1)

    if args.list_only:
        print(f'\n{"Profile":<20} {"Image Tag":<30} {"Scanner":<15} {"Framework":<15}')
        print('-' * 80)
        for ee in ee_list:
            print(f'{ee["profile_name"]:<20} {ee["image_tag"]:<30} {ee["scanner"]:<15} {ee["framework"]:<15}')
        print(f'\nFull image paths (registry: {args.registry}):')
        for ee in ee_list:
            print(f'  {ee["image"]}')
        return

    if args.dry_run:
        print(f'\n=== Dry Run (registry: {args.registry}) ===\n')
        for ee in ee_list:
            print(f'  [{ee["profile_name"]}]')
            print(f'    Name:        {ee["image_tag"]}')
            print(f'    Image:       {ee["image"]}')
            print(f'    Description: {ee["description"]}')
            print(f'    EE def:      {os.path.relpath(ee["ee_def_path"], REPO_ROOT)}')
            print()
        print(f'Would register {len(ee_list)} EEs on {aap_host or "(AAP_HOST not set)"}')
        return

    if args.build:
        print('\n=== Building EE Images ===\n')
        for ee in ee_list:
            success = build_ee(ee)
            if not success:
                print(f'  Stopping — build failed for {ee["profile_name"]}')
                sys.exit(1)

    if args.push:
        print('\n=== Pushing EE Images ===\n')
        for ee in ee_list:
            success = push_ee(ee['image'])
            if not success:
                print(f'  Stopping — push failed for {ee["profile_name"]}')
                sys.exit(1)

    print(f'\n=== Registering EEs on {aap_host} ===\n')

    org_id = find_organization_id(aap_host, aap_token, args.organization, check_ssl=args.check_ssl)
    if org_id:
        print(f'  Organization "{args.organization}" → id={org_id}')
    else:
        print(f'  WARNING: Organization "{args.organization}" not found, registering without org.')

    results = {'created': [], 'updated': [], 'exists': [], 'failed': []}

    for ee in ee_list:
        action, ee_id = register_ee(
            aap_host, aap_token, ee,
            org_id=org_id, check_ssl=args.check_ssl,
        )
        results[action].append(ee)
        status_symbol = {'created': '+', 'updated': '~', 'exists': '=', 'failed': '!'}[action]
        print(f'  [{status_symbol}] {ee["image_tag"]:<30} {action:<10} (id={ee_id})')

    print(f'\n=== Summary ===')
    print(f'  Created:  {len(results["created"])}')
    print(f'  Updated:  {len(results["updated"])}')
    print(f'  Existing: {len(results["exists"])}')
    print(f'  Failed:   {len(results["failed"])}')

    if results['failed']:
        print('\nFailed EEs:')
        for ee in results['failed']:
            print(f'  - {ee["image_tag"]} ({ee["profile_name"]})')
        sys.exit(1)

    print('\nDone.')


if __name__ == '__main__':
    main()
