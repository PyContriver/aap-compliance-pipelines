#!/usr/bin/env python3
"""
Sync shared modules from profiles/_shared/ into each collection's
plugins/module_utils/ directory.

Run after editing any file in profiles/_shared/:
    python scripts/sync_shared_modules.py
"""
import shutil
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARED_DIR = os.path.join(REPO_ROOT, 'profiles', '_shared')

COLLECTIONS = [
    'profiles/rhel9-stig/ansible_collections/security/compliance_rhel9_stig',
    'profiles/rhel9-cis-l1/ansible_collections/security/compliance_rhel9_cis_l1',
    'profiles/rhel9-cis-l2/ansible_collections/security/compliance_rhel9_cis_l2',
]

SHARED_FILES = [
    'normalize_common.py',
]


def main():
    for shared_file in SHARED_FILES:
        src = os.path.join(SHARED_DIR, shared_file)
        if not os.path.exists(src):
            print(f'  SKIP {shared_file} (not found in _shared/)')
            continue

        for collection in COLLECTIONS:
            dest_dir = os.path.join(REPO_ROOT, collection, 'plugins', 'module_utils')
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, shared_file)
            shutil.copy2(src, dest)
            coll_name = collection.split('/')[-1]
            print(f'  {shared_file} -> {coll_name}/plugins/module_utils/')

    # Ensure __init__.py exists in module_utils (Ansible requirement)
    for collection in COLLECTIONS:
        init_path = os.path.join(
            REPO_ROOT, collection, 'plugins', 'module_utils', '__init__.py',
        )
        if not os.path.exists(init_path):
            with open(init_path, 'w') as f:
                pass

    print('Done.')


if __name__ == '__main__':
    main()
