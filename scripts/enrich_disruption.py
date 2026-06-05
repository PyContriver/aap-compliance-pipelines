#!/usr/bin/env python3
"""Enrich rules YAML with disruption level and reboot_required from SSG fix text tags.

Parses the fix_text field of each rule for SSG-standard tags:
  low_disruption, medium_disruption, high_disruption
  reboot_needed, no_reboot_needed

Usage:
    python3 scripts/enrich_disruption.py profiles/rhel9-stig/.../rules/stig_rhel9.yml
    python3 scripts/enrich_disruption.py --all   # process all 3 profiles

The script modifies rules YAML in-place, adding disruption and reboot_required
fields. Safe to re-run — idempotent.
"""

import argparse
import glob
import os
import re
import sys

try:
    import yaml
except ImportError:
    print('ERROR: PyYAML required. Install with: pip install pyyaml', file=sys.stderr)
    sys.exit(1)


def extract_disruption(fix_text: str) -> str:
    if not fix_text:
        return 'medium'
    if 'high_disruption' in fix_text:
        return 'high'
    if 'medium_disruption' in fix_text:
        return 'medium'
    if 'low_disruption' in fix_text:
        return 'low'
    return 'medium'


def extract_reboot(fix_text: str) -> bool:
    if not fix_text:
        return False
    if 'no_reboot_needed' in fix_text:
        return False
    return 'reboot_needed' in fix_text


def enrich_file(path: str, dry_run: bool = False) -> dict:
    with open(path) as f:
        data = yaml.safe_load(f)

    if not data or 'rules' not in data:
        print(f'  SKIP: no rules found in {path}', file=sys.stderr)
        return {}

    stats = {'low': 0, 'medium': 0, 'high': 0, 'reboot': 0, 'total': 0}

    for rule in data['rules']:
        fix_text = rule.get('fix_text', '') or ''
        disruption = extract_disruption(fix_text)
        reboot = extract_reboot(fix_text)

        rule['disruption'] = disruption
        rule['reboot_required'] = reboot

        stats[disruption] += 1
        if reboot:
            stats['reboot'] += 1
        stats['total'] += 1

    if not dry_run:
        with open(path, 'w') as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False, width=200, allow_unicode=True)

    return stats


def find_all_rules_files(repo_root: str) -> list:
    pattern = os.path.join(repo_root, 'profiles', '*', 'ansible_collections', '*', '*', 'rules', '*.yml')
    return sorted(glob.glob(pattern))


def main():
    parser = argparse.ArgumentParser(description='Enrich rules YAML with disruption metadata')
    parser.add_argument('files', nargs='*', help='Rules YAML files to enrich')
    parser.add_argument('--all', action='store_true', help='Process all profile rules files')
    parser.add_argument('--dry-run', action='store_true', help='Show what would change without writing')
    args = parser.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    if args.all:
        files = find_all_rules_files(repo_root)
    elif args.files:
        files = args.files
    else:
        parser.print_help()
        sys.exit(1)

    if not files:
        print('No rules files found.', file=sys.stderr)
        sys.exit(1)

    for path in files:
        name = os.path.basename(path)
        print(f'\n{name}:')
        stats = enrich_file(path, dry_run=args.dry_run)
        if stats:
            total = stats['total']
            print(f'  {total} rules: low={stats["low"]} medium={stats["medium"]} high={stats["high"]} reboot={stats["reboot"]}')
            if args.dry_run:
                print('  (dry run — no changes written)')
            else:
                print(f'  Updated: {path}')


if __name__ == '__main__':
    main()
