import { PlatformSpec } from '@aap-compliance/common';

export interface HostFacts {
  hostname: string;
  ansible_os_family?: string;
  ansible_distribution_major_version?: string;
  device_type?: string;
}

export interface PlatformValidationResult {
  valid: boolean;
  matchedHosts: string[];
  mismatchedHosts: Array<{ hostname: string; reason: string }>;
}

export function validatePlatform(
  spec: PlatformSpec | null,
  hosts: HostFacts[],
): PlatformValidationResult {
  // If no spec or scanner_validates, all hosts match
  if (!spec || spec.scanner_validates) {
    return { valid: true, matchedHosts: hosts.map(h => h.hostname), mismatchedHosts: [] };
  }

  const matched: string[] = [];
  const mismatched: Array<{ hostname: string; reason: string }> = [];

  for (const host of hosts) {
    const reasons: string[] = [];

    if (spec.os_family?.length && (!host.ansible_os_family || !spec.os_family.includes(host.ansible_os_family))) {
      reasons.push(`OS family '${host.ansible_os_family || 'unknown'}' not in [${spec.os_family.join(', ')}]`);
    }

    if (spec.os_version?.length && (!host.ansible_distribution_major_version || !spec.os_version.includes(host.ansible_distribution_major_version))) {
      reasons.push(`OS version '${host.ansible_distribution_major_version || 'unknown'}' not in [${spec.os_version.join(', ')}]`);
    }

    if (spec.device_type?.length && (!host.device_type || !spec.device_type.includes(host.device_type))) {
      reasons.push(`Device type '${host.device_type || 'unknown'}' not in [${spec.device_type.join(', ')}]`);
    }

    if (reasons.length > 0) {
      mismatched.push({ hostname: host.hostname, reason: reasons.join('; ') });
    } else {
      matched.push(host.hostname);
    }
  }

  return {
    valid: mismatched.length === 0,
    matchedHosts: matched,
    mismatchedHosts: mismatched,
  };
}
