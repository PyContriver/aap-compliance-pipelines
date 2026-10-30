#!/usr/bin/env python3
"""Build and push compliance Execution Environment images to a container registry.

Discovers all profiles under profiles/, prepares the build context for each
(collection, scripts, EE definition), builds the image with ansible-builder,
optionally verifies it, and pushes to the target registry.

Usage:
    # Build all EEs and push to GHCR
    python scripts/build_push_ee.py --registry ghcr.io/pycontriver --push

    # Build only STIG, don't push
    python scripts/build_push_ee.py --profiles rhel9-stig

    # Build and push with a specific tag
    python scripts/build_push_ee.py --registry ghcr.io/pycontriver --tag v1.0.0 --push

    # Dry-run: show what would be built
    python scripts/build_push_ee.py --dry-run

    # Build for linux/amd64 on Apple Silicon
    python scripts/build_push_ee.py --platform linux/amd64 --push

    # Skip verification step
    python scripts/build_push_ee.py --push --no-verify

Environment variables:
    CONTAINER_RUNTIME   podman or docker (default: auto-detect)
    EE_REGISTRY         Default registry (overridden by --registry)
"""

import argparse
import glob
import os
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILES_DIR = os.path.join(REPO_ROOT, 'profiles')

# Profile metadata: maps profile dir name to build details.
# scanner_type determines which verification checks to run and
# whether extract_rule_metadata.py is needed in the build context.
PROFILE_META = {
    'rhel9-stig': {
        'collection': 'compliance_rhel9_stig',
        'image_suffix': 'stig-rhel9',
        'scanner_type': 'xccdf',
        'verify_files': [
            '/usr/share/scap-security-guide/ansible/rhel9-playbook-stig.yml',
            '/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml',
        ],
        'verify_rpms': ['scap-security-guide', 'openscap-scanner'],
    },
    'rhel9-cis-l1': {
        'collection': 'compliance_rhel9_cis_l1',
        'image_suffix': 'cis-l1-rhel9',
        'scanner_type': 'xccdf',
        'verify_files': [
            '/usr/share/scap-security-guide/ansible/rhel9-playbook-cis_server_l1.yml',
            '/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml',
        ],
        'verify_rpms': ['scap-security-guide', 'openscap-scanner'],
    },
    'rhel9-cis-l2': {
        'collection': 'compliance_rhel9_cis_l2',
        'image_suffix': 'cis-l2-rhel9',
        'scanner_type': 'xccdf',
        'verify_files': [
            '/usr/share/scap-security-guide/ansible/rhel9-playbook-cis.yml',
            '/usr/share/xml/scap/ssg/content/ssg-rhel9-ds.xml',
        ],
        'verify_rpms': ['scap-security-guide', 'openscap-scanner'],
    },
    'supply-chain': {
        'collection': 'compliance_supply_chain',
        'image_suffix': 'supply-chain',
        'scanner_type': 'cyclonedx',
        'verify_cmds': ['syft version', 'grype version', 'jq --version', 'oras version'],
    },
}


def detect_runtime():
    """Auto-detect container runtime (podman or docker)."""
    env_runtime = os.environ.get('CONTAINER_RUNTIME', '')
    if env_runtime:
        return env_runtime

    for rt in ['podman', 'docker']:
        if shutil.which(rt):
            return rt

    print('ERROR: No container runtime found. Install podman or docker.', file=sys.stderr)
    sys.exit(1)


def detect_platform():
    """Auto-detect if cross-build is needed.

    AAP Controllers run on x86_64. If we're building on ARM (Apple Silicon),
    we must cross-build for linux/amd64.
    """
    import platform
    machine = platform.machine().lower()
    if machine in ('arm64', 'aarch64'):
        return 'linux/amd64'
    return None


def find_profiles(selected=None):
    """Discover profile directories, optionally filtering."""
    dirs = sorted(glob.glob(os.path.join(PROFILES_DIR, '*')))
    profiles = [
        d for d in dirs
        if os.path.isdir(d)
        and not os.path.basename(d).startswith('_')
        and os.path.basename(d) in PROFILE_META
    ]
    if selected:
        sel = set(selected)
        profiles = [d for d in profiles if os.path.basename(d) in sel]
        found = {os.path.basename(d) for d in profiles}
        missing = sel - found
        if missing:
            print(f'WARNING: profiles not found: {", ".join(sorted(missing))}', file=sys.stderr)
    return profiles


def image_name(registry, profile_name, tag):
    """Build the full image reference."""
    meta = PROFILE_META[profile_name]
    return f'{registry}/compliance-{meta["image_suffix"]}:{tag}'


def prepare_build_context(profile_dir, profile_name):
    """Prepare ansible-builder build context in a temp directory.

    Returns the path to the build directory. The caller is responsible
    for cleanup.
    """
    meta = PROFILE_META[profile_name]
    collection = meta['collection']
    scanner_type = meta['scanner_type']

    build_dir = tempfile.mkdtemp(prefix=f'ee-{profile_name}-')
    ee_src = os.path.join(profile_dir, 'ee', 'execution-environment.yml')

    if not os.path.exists(ee_src):
        print(f'  ERROR: {ee_src} not found', file=sys.stderr)
        return None

    # Copy EE definition
    shutil.copy2(ee_src, os.path.join(build_dir, 'execution-environment.yml'))

    # Run ansible-builder create to generate the Containerfile
    result = subprocess.run(
        ['ansible-builder', 'create', '-f', 'execution-environment.yml', '-v', '3'],
        cwd=build_dir, capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f'  ERROR: ansible-builder create failed:\n{result.stderr}', file=sys.stderr)
        return None

    # Copy collection into the build context
    context_dir = os.path.join(build_dir, 'context')
    collections_dest = os.path.join(
        context_dir, '_build', 'collections', 'ansible_collections', 'security', collection,
    )
    collection_src = os.path.join(
        profile_dir, 'ansible_collections', 'security', collection,
    )

    if os.path.exists(collection_src):
        shutil.copytree(collection_src, collections_dest)
    else:
        print(f'  WARNING: Collection not found at {collection_src}', file=sys.stderr)

    # Copy extract_rule_metadata.py for XCCDF profiles
    if scanner_type == 'xccdf':
        script_src = os.path.join(REPO_ROOT, 'scripts', 'extract_rule_metadata.py')
        if os.path.exists(script_src):
            shutil.copy2(script_src, os.path.join(context_dir, '_build', 'extract_rule_metadata.py'))

    return build_dir


def build_image(build_dir, image_ref, runtime, platform=None):
    """Build the EE image using the container runtime."""
    context_dir = os.path.join(build_dir, 'context')
    containerfile = os.path.join(context_dir, 'Containerfile')

    cmd = [runtime, 'build', '-f', containerfile, '-t', image_ref]

    if platform:
        cmd.extend(['--platform', platform])

    cmd.append(context_dir)

    print(f'  Building {image_ref} ...')
    result = subprocess.run(cmd, capture_output=False)

    if result.returncode != 0:
        return False

    print(f'  Build succeeded: {image_ref}')
    return True


def verify_image(image_ref, profile_name, runtime):
    """Run post-build verification checks on the image."""
    meta = PROFILE_META[profile_name]
    scanner_type = meta['scanner_type']
    errors = []

    print(f'  Verifying {image_ref} ...')

    if scanner_type == 'xccdf':
        # Check RPMs
        for rpm in meta.get('verify_rpms', []):
            result = subprocess.run(
                [runtime, 'run', '--rm', image_ref, 'rpm', '-q', rpm],
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                errors.append(f'RPM not found: {rpm}')
            else:
                print(f'    RPM ok: {result.stdout.strip()}')

        # Check files
        for fpath in meta.get('verify_files', []):
            result = subprocess.run(
                [runtime, 'run', '--rm', image_ref, 'test', '-f', fpath],
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                errors.append(f'File not found: {fpath}')
            else:
                print(f'    File ok: {fpath}')

    elif scanner_type == 'cyclonedx':
        for cmd_str in meta.get('verify_cmds', []):
            cmd_parts = cmd_str.split()
            result = subprocess.run(
                [runtime, 'run', '--rm', image_ref] + cmd_parts,
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                errors.append(f'Command failed: {cmd_str}')
            else:
                output = result.stdout.strip().split('\n')[0]
                print(f'    {cmd_str}: {output}')

    # Check collection is installed
    collection_fqcn = f'security.{meta["collection"]}'
    result = subprocess.run(
        [runtime, 'run', '--rm', image_ref, 'ansible-galaxy', 'collection', 'list', collection_fqcn],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or collection_fqcn not in result.stdout:
        errors.append(f'Collection not found: {collection_fqcn}')
    else:
        print(f'    Collection ok: {collection_fqcn}')

    if errors:
        print(f'  VERIFY FAILED:')
        for e in errors:
            print(f'    - {e}')
        return False

    print(f'  Verification passed')
    return True


def push_image(image_ref, runtime):
    """Push an image to the registry."""
    print(f'  Pushing {image_ref} ...')
    result = subprocess.run([runtime, 'push', image_ref], capture_output=False)
    if result.returncode != 0:
        return False
    print(f'  Push succeeded: {image_ref}')
    return True


def main():
    parser = argparse.ArgumentParser(
        description='Build and push compliance EE images.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        '--registry',
        default=os.environ.get('EE_REGISTRY', 'ghcr.io/pycontriver'),
        help='Container registry prefix (default: ghcr.io/pycontriver)',
    )
    parser.add_argument(
        '--tag', default='latest',
        help='Image tag (default: latest)',
    )
    parser.add_argument(
        '--profiles', nargs='*', default=None,
        help='Specific profile names to build (default: all)',
    )
    parser.add_argument(
        '--push', action='store_true',
        help='Push images to the registry after building',
    )
    parser.add_argument(
        '--platform', default='auto',
        help='Target platform (default: auto-detect; linux/amd64 on Apple Silicon, native otherwise)',
    )
    parser.add_argument(
        '--no-verify', action='store_true',
        help='Skip post-build verification',
    )
    parser.add_argument(
        '--keep-context', action='store_true',
        help='Keep temporary build context directories (for debugging)',
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Show what would be built without building',
    )
    args = parser.parse_args()

    runtime = detect_runtime()
    print(f'Container runtime: {runtime}')

    # Resolve platform
    if args.platform == 'auto':
        args.platform = detect_platform()
    elif args.platform == 'native':
        args.platform = None
    if args.platform:
        print(f'Target platform:   {args.platform} (cross-build)')

    # Check ansible-builder is available
    if not args.dry_run and not shutil.which('ansible-builder'):
        print('ERROR: ansible-builder not found. Install with: pip install ansible-builder',
              file=sys.stderr)
        sys.exit(1)

    profile_dirs = find_profiles(args.profiles)
    if not profile_dirs:
        print('No matching profiles found.')
        sys.exit(1)

    print(f'Profiles to build: {len(profile_dirs)}')
    for d in profile_dirs:
        name = os.path.basename(d)
        ref = image_name(args.registry, name, args.tag)
        print(f'  {name:<20} → {ref}')

    if args.dry_run:
        print('\nDry run — nothing built.')
        if args.platform:
            print(f'Would cross-build for platform: {args.platform}')
        if args.push:
            print('Would push after building.')
        return

    print()
    results = {'built': [], 'verified': [], 'pushed': [], 'failed': []}
    build_dirs = []

    for profile_dir in profile_dirs:
        profile_name = os.path.basename(profile_dir)
        ref = image_name(args.registry, profile_name, args.tag)
        meta = PROFILE_META[profile_name]

        print(f'=== [{profile_name}] {ref} ===\n')

        # Prepare build context
        print(f'  Preparing build context ...')
        build_dir = prepare_build_context(profile_dir, profile_name)
        if not build_dir:
            results['failed'].append(profile_name)
            print()
            continue
        build_dirs.append(build_dir)

        # Build
        success = build_image(build_dir, ref, runtime, platform=args.platform)
        if not success:
            print(f'  BUILD FAILED for {profile_name}\n')
            results['failed'].append(profile_name)
            continue
        results['built'].append(profile_name)

        # Also tag as latest if using a custom tag
        if args.tag != 'latest':
            latest_ref = image_name(args.registry, profile_name, 'latest')
            subprocess.run([runtime, 'tag', ref, latest_ref], capture_output=True)

        # Verify
        if not args.no_verify:
            verified = verify_image(ref, profile_name, runtime)
            if verified:
                results['verified'].append(profile_name)
            else:
                print(f'  Verification failed — skipping push for {profile_name}\n')
                results['failed'].append(profile_name)
                continue

        # Push
        if args.push:
            pushed = push_image(ref, runtime)
            if pushed:
                results['pushed'].append(profile_name)
                if args.tag != 'latest':
                    push_image(latest_ref, runtime)
            else:
                print(f'  PUSH FAILED for {profile_name}')
                results['failed'].append(profile_name)

        print()

    # Cleanup temp dirs
    if not args.keep_context:
        for d in build_dirs:
            shutil.rmtree(d, ignore_errors=True)

    # Summary
    print('=== Summary ===')
    print(f'  Built:    {len(results["built"])} — {", ".join(results["built"]) or "none"}')
    if not args.no_verify:
        print(f'  Verified: {len(results["verified"])} — {", ".join(results["verified"]) or "none"}')
    if args.push:
        print(f'  Pushed:   {len(results["pushed"])} — {", ".join(results["pushed"]) or "none"}')
    if results['failed']:
        print(f'  Failed:   {len(results["failed"])} — {", ".join(results["failed"])}')

    if results['pushed']:
        print(f'\nImages available at:')
        for p in results['pushed']:
            print(f'  {image_name(args.registry, p, args.tag)}')

    if results['failed']:
        sys.exit(1)

    print('\nDone.')


if __name__ == '__main__':
    main()
