#!/usr/bin/env python3
"""Classify rules by their impact on AAP connectivity.

Uses a platform-specific dictionary to match rule fix_text against
patterns that could affect AAP's ability to reach managed hosts.

Usage:
    python3 scripts/classify_aap_impact.py \
        profiles/rhel9-stig/.../rules/stig_rhel9.yml \
        --platform-dict profiles/_shared/aap_impact/rhel.yml

    python3 scripts/classify_aap_impact.py --all

Output: Updates rules YAML in-place with aap_impact and aap_impact_reason.
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


def load_platform_dict(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def classify_rule(rule: dict, platform: dict) -> tuple:
    """Classify a single rule against the platform dictionary.

    Returns (impact, reason, requirement_key) where impact is one of:
        'safe', 'caution', 'breaks-connectivity'

    Matching strategy: file_patterns and module_patterns match against the
    rule ID and title (the rule's identity), NOT the fix_text blob which
    can contain cross-contaminated SSG tag text. breaks_if content_regex
    patterns DO match against fix_text for detailed content inspection.
    """
    fix_text = (rule.get('fix_text', '') or '').lower()
    rule_id = (rule.get('id', '') or '').lower()
    title = (rule.get('title', '') or '').lower()

    if not fix_text and not title:
        return 'safe', '', ''

    identity = f'{rule_id} {title}'

    best_impact = 'safe'
    best_reason = ''
    best_req = ''

    for req_key, req in platform.get('requirements', {}).items():
        matched = False

        # Match rule ID against id_patterns (primary, most reliable)
        for pat in req.get('id_patterns', []):
            if pat.lower() in rule_id:
                matched = True
                break

        # Fall back to module patterns in fix_text
        if not matched:
            for mod in req.get('module_patterns', []):
                if mod.lower() in fix_text:
                    matched = True
                    break

        # Fall back to file patterns in fix_text
        if not matched:
            for pat in req.get('file_patterns', []):
                pat_lower = pat.lower().rstrip('/')
                short = pat_lower.rsplit('/', 1)[-1] if '/' in pat_lower else pat_lower
                if short in fix_text:
                    matched = True
                    break

        if not matched:
            continue

        # Check breaks_if patterns against fix_text (detailed content matching)
        for brk in req.get('breaks_if', []):
            regex = brk.get('content_regex', brk.get('setting_regex', ''))
            if regex and re.search(regex, f'{identity} {fix_text}', re.IGNORECASE):
                return 'breaks-connectivity', brk['reason'], req_key

        # Matched a requirement but no breaks_if — use default impact
        default_impact = req.get('impact_default', 'caution')
        if _impact_rank(default_impact) > _impact_rank(best_impact):
            best_impact = default_impact
            best_reason = req['description']
            best_req = req_key

    return best_impact, best_reason, best_req


def _impact_rank(impact: str) -> int:
    return {'safe': 0, 'caution': 1, 'breaks-connectivity': 2}.get(impact, 0)


def classify_file(rules_path: str, platform_path: str, dry_run: bool = False) -> dict:
    with open(rules_path) as f:
        data = yaml.safe_load(f)

    if not data or 'rules' not in data:
        print(f'  SKIP: no rules in {rules_path}', file=sys.stderr)
        return {}

    platform = load_platform_dict(platform_path)

    # Load overrides if present
    overrides = {}
    for ov in data.get('aap_impact_overrides', []):
        overrides[ov['id']] = (ov['aap_impact'], ov.get('reason', ''))

    stats = {'safe': 0, 'caution': 0, 'breaks-connectivity': 0, 'total': 0}
    breaks_list = []
    caution_list = []

    for rule in data['rules']:
        rule_id = rule.get('id', '')

        if rule_id in overrides:
            impact, reason = overrides[rule_id]
            reason = f'[override] {reason}'
        else:
            impact, reason, _ = classify_rule(rule, platform)

        rule['aap_impact'] = impact
        if reason:
            rule['aap_impact_reason'] = reason

        stats[impact] += 1
        stats['total'] += 1

        if impact == 'breaks-connectivity':
            breaks_list.append((rule_id, reason))
        elif impact == 'caution':
            caution_list.append((rule_id, reason))

    if not dry_run:
        with open(rules_path, 'w') as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False,
                      width=200, allow_unicode=True)

    return {
        'stats': stats,
        'breaks': breaks_list,
        'caution': caution_list,
    }


def find_all_rules_files(repo_root: str) -> list:
    pattern = os.path.join(repo_root, 'profiles', '*', 'ansible_collections',
                           '*', '*', 'rules', '*.yml')
    return sorted(glob.glob(pattern))


def auto_detect_platform(rules_path: str, repo_root: str) -> str:
    """Detect platform from compliance-profile.yml in the same collection."""
    parts = rules_path.split(os.sep)
    try:
        idx = parts.index('rules')
        collection_dir = os.sep.join(parts[:idx])
        meta_path = os.path.join(collection_dir, 'meta', 'compliance-profile.yml')
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = yaml.safe_load(f)
            os_family = meta.get('profile', {}).get('platform_spec', {}).get('os_family', [])
            if 'RedHat' in os_family or 'Debian' in os_family:
                return os.path.join(repo_root, 'profiles', '_shared', 'aap_impact', 'rhel.yml')
    except (ValueError, KeyError):
        pass
    return os.path.join(repo_root, 'profiles', '_shared', 'aap_impact', 'rhel.yml')


def main():
    parser = argparse.ArgumentParser(
        description='Classify rules by AAP connectivity impact')
    parser.add_argument('files', nargs='*', help='Rules YAML files')
    parser.add_argument('--platform-dict', help='Platform dictionary YAML')
    parser.add_argument('--all', action='store_true',
                        help='Process all profile rules files')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show classifications without writing')
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
        platform_path = args.platform_dict or auto_detect_platform(path, repo_root)
        print(f'\n{name} (dict: {os.path.basename(platform_path)}):')

        result = classify_file(path, platform_path, dry_run=args.dry_run)
        if not result:
            continue

        s = result['stats']
        total = s['total']
        print(f'  {total} rules: safe={s["safe"]} caution={s["caution"]} '
              f'breaks-connectivity={s["breaks-connectivity"]}')

        if result['breaks']:
            print(f'\n  BREAKS-CONNECTIVITY ({len(result["breaks"])}):')
            for rid, reason in sorted(result['breaks']):
                print(f'    {rid:45s} {reason}')

        if result['caution']:
            print(f'\n  CAUTION ({len(result["caution"])}):')
            for rid, reason in sorted(result['caution']):
                print(f'    {rid:45s} {reason}')

        if args.dry_run:
            print('\n  (dry run — no changes written)')
        else:
            print(f'\n  Updated: {path}')


if __name__ == '__main__':
    main()
