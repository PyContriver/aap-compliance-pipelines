export type ComplianceFramework = 'DISA_STIG' | 'CIS' | 'PCI_DSS' | 'HIPAA' | 'NIST_800_53';

/**
 * @deprecated Use `ComplianceProfile` from `./api` instead.
 * Retained only for backward compatibility with legacy mock/display code.
 */
export interface LegacyComplianceProfile {
  id: string;
  name: string;
  framework: ComplianceFramework;
  version: string;
  description: string;
  applicableOs: string[];
  ruleCount: number;
  lastUpdated: string;
  source: string;
}

export interface RemediationSelection {
  ruleId: string;
  enabled: boolean;
  parameters: Record<string, string | number | boolean>;
  /** Scope of remediation: 'failed_only' (default) or 'standardize_all'. */
  scope?: 'failed_only' | 'standardize_all';
}

export interface RemediationProfile {
  id: string;
  name: string;
  description: string;
  complianceProfileId: string;
  /** The scan active when this profile was originally created (renamed from scanId — ADR-014 Q7). */
  creationScanId?: string;
  targetInventory: string;
  /** Profile lifecycle status (ADR-014 §2). */
  status: import('./api').RemediationProfileStatus;
  createdBy?: string;
  selections: RemediationSelection[];
  createdAt: string;
  updatedAt: string;
  /** Computed from executions table — not stored on the profile (ADR-014 architect review). */
  executionCount?: number;
  /** Computed from executions table — not stored on the profile. */
  lastExecutedAt?: string | null;
  /** Latest execution record, joined at query time. */
  latestExecution?: import('./api').RemediationExecution | null;
}
