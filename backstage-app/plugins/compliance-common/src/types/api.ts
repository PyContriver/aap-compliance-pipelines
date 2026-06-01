/**
 * Types for the compliance backend REST API and Controller integration.
 */

import type { FindingParameter } from './findings';
import type { RemediationProfile, RemediationSelection } from './profiles';

/**
 * Scanner certification status for a compliance profile.
 *
 * - certified: Scanner is validated by the framework authority
 *   (e.g. OpenSCAP is NIST SCAP 1.2 validated for DISA STIG assessments)
 * - conformant: Scanner uses official benchmark content but is not the
 *   authority-certified tool (e.g. OpenSCAP with CIS content — accurate
 *   results but CIS-CAT Pro is the CIS-certified scanner)
 * - uncertified: Custom scanner or homegrown checks with no formal validation
 */
export type CertificationStatus = 'certified' | 'conformant' | 'uncertified';

export interface ScanCertification {
  status: CertificationStatus;
  authority: string;
  validationId: string;
  disclaimer: string;
}

/** Request to launch a compliance scan via the backend. */
export interface LaunchScanRequest {
  profileId: string;
  inventoryId: number;
  evaluateOnly: boolean;
  scanType?: 'assessment' | 'verification';
  limit?: string;
  workflowTemplateId?: number;
  gatherFacts?: boolean;
}

/** Response from launching a scan. */
export interface LaunchScanResponse {
  scanId: string;
  workflowJobId: number;
  status: string;
}

/** Request to launch remediation via the backend. */
export interface LaunchRemediationRequest {
  profileId: string;
  inventoryId: number;
  selections: RemediationSelection[];
  limit?: string;
  /** Scan ID for display context and tracking only. Host scoping always uses latest findings. */
  scanId?: string;
  /** Remediation profile UUID for execution tracking (ADR-014). */
  remediationProfileId?: string;
}

/** Response from launching remediation. */
export interface LaunchRemediationResponse {
  remediationId: string;
  workflowJobId: number;
  status: string;
  /** All job IDs when remediation splits into multiple groups (per host-set). */
  allJobIds?: number[];
  /** Execution record ID for tracking this launch (ADR-014). */
  executionId: string;
}

/** Remediation profile lifecycle status (ADR-014 §2). */
export type RemediationProfileStatus = 'draft' | 'saved' | 'archived';

/** Remediation execution status — system-derived from Controller job state (ADR-014 §2). */
export type RemediationExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** A remediation execution record — one row per launch (ADR-014 §1). */
export interface RemediationExecution {
  id: string;
  remediationProfileId: string;
  inventoryId: number;
  informingScanId: string | null;
  primaryJobId: number | null;
  allJobIds: number[];
  status: RemediationExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  elapsedSeconds: number | null;
  rulesApplied: number | null;
  rulesFailed: number | null;
  hostsTargeted: number | null;
  hostsSucceeded: number | null;
  hostsFailed: number | null;
  planSummary: RemediationPlan | null;
  verificationScanId: string | null;
  createdBy: string | null;
}

/** Golden standard binding — pins a remediation profile as the baseline for an inventory (ADR-014 §7). */
export interface BaselineTarget {
  id: string;
  remediationProfileId: string;
  complianceProfileId: string;
  inventoryId: number;
  pinnedAt: string;
  pinnedBy: string | null;
}

/** Posture snapshot for historical trend tracking. */
export interface PostureSnapshot {
  id: string;
  profileId: string;
  inventoryId?: number;
  scanId?: string;
  timestamp: string;
  totalHosts: number;
  totalRules: number;
  passCount: number;
  failCount: number;
  compliancePct: number;
}

/** A scan that contributes to a profile's posture score. */
export interface ContributingScan {
  scanId: string;
  inventoryId: number;
  inventoryName: string;
  passRate: number;
  passCount: number;
  failCount: number;
  ruleCount: number;
  timestamp: string;
}

/** Scan record stored in the database. */
export interface ComplianceScan {
  id: string;
  profileId: string;
  inventoryId: number;
  scanner: string;
  scanType: 'assessment' | 'verification';
  workflowJobId: number | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  errorDetails: string | null;
}

/** Stored finding row (flattened per-host). */
export interface StoredFinding {
  id: string;
  scanId: string;
  ruleId: string;
  stigId: string;
  host: string;
  status: string;
  severity: string;
  actualValue: string;
  expectedValue: string;
  evidence: string | null;
}

/** Normalized rule metadata stored once per rule_id. */
export interface RuleMetadataRecord {
  ruleId: string;
  stigId: string;
  title: string;
  description: string;
  checkText: string;
  fixText: string;
  category: string;
  disruption: 'low' | 'medium' | 'high';
  scanner: string;
  updatedAt: string;
}

/** Multi-host aggregated finding used by the frontend. */
export interface MultiHostFinding {
  ruleId: string;
  stigId: string;
  title: string;
  description: string;
  fixText: string;
  checkText: string;
  severity: 'CAT_I' | 'CAT_II' | 'CAT_III';
  category: string;
  disruption: 'low' | 'medium' | 'high';
  parameters: FindingParameter[];
  hosts: Array<{
    host: string;
    status: 'pass' | 'fail' | 'error';
    actualValue: string;
    expectedValue: string;
  }>;
  passCount: number;
  failCount: number;
  totalCount: number;
}

/** Controller workflow job status response (subset of AWX API). */
export interface WorkflowJobStatus {
  id: number;
  status: string;
  finished: string | null;
  failed: boolean;
  elapsed: number;
  name: string;
  /** Comma-separated list of Ansible tags applied to this job (e.g. "sshd_set_idle_timeout,no_empty_passwords"). */
  job_tags?: string;
}

/** Controller workflow node (subset of AWX API). */
export interface WorkflowNode {
  id: number;
  summary_fields: {
    job?: {
      id: number;
      name: string;
      status: string;
      type: string;
    };
    unified_job_template?: {
      id: number;
      name: string;
      unified_job_type: string;
    };
  };
  identifier: string;
}

/** Controller job event (subset of AWX API). */
export interface JobEvent {
  id: number;
  event: string;
  event_data: Record<string, unknown>;
  stdout: string;
  host_name: string;
}

/** Saved remediation profile request body. */
export interface SaveRemediationProfileRequest {
  id?: string;
  name: string;
  description: string;
  complianceProfileId: string;
  /** The scan active when this profile was created (renamed from scanId — ADR-014 Q7). */
  creationScanId?: string;
  /** @deprecated Use creationScanId. Accepted for backward compatibility. */
  scanId?: string;
  selections: RemediationSelection[];
  status?: import('./api').RemediationProfileStatus;
}

/** Recent scan entry for dashboard display. */
export interface RecentScan {
  id: string;
  profileName: string;
  inventoryName: string;
  passRate: number;
  timestamp: string;
  status: string;
  scanType?: 'assessment' | 'verification';
  /** The scanner that produced this entry (e.g. 'oscap', 'remediation'). */
  scanner?: string;
}

/** Per-profile posture status for the overview card. */
export interface ProfilePostureStatus {
  profileId: string;
  name: string;
  rate: number;
  aboveTarget: boolean;
}

/** Per-inventory posture breakdown for dual-axis view. */
export interface InventoryPosture {
  inventoryId: number;
  inventoryName: string;
  profileScores: Array<{
    profileId: string;
    name: string;
    rate: number;
    passCount: number;
    failCount: number;
  }>;
}

/** Dashboard stats summary. */
export interface DashboardStats {
  hostsScanned: number;
  criticalFindings: number;
  criticalFindingsDelta?: number;
  pendingRemediation: number;
  pendingRemediationDelta?: number;
  activeProfiles: number;
  recentScans: RecentScan[];
  frameworkScores: Array<{
    profileId: string;
    name: string;
    target: string;
    rules: number;
    rate: number;
    passCount: number;
    failCount: number;
    lastScan: string;
    contributingScans: ContributingScan[];
  }>;
  postureStatus: ProfilePostureStatus[];
  byInventory: InventoryPosture[];
}

/** A compliance profile maps a standard (e.g., DISA STIG) to Controller resources. */
export interface ComplianceProfile {
  id: string;
  displayName: string;
  description: string;
  framework: string;
  version: string;
  platform: string;
  platformSpec: PlatformSpec | null;
  workflowTemplateId: number | null;
  remediateJtId: number | null;
  eeId: number | null;
  remediationPlaybookPath: string;
  scanTags: string;
  certification: ScanCertification | null;
  ruleCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** A group of rules targeting the same host set in a remediation plan. */
export interface RemediationPlanGroup {
  tags: string[];
  limit: string;
  extraVars: Record<string, unknown>;
  hostCount: number;
  ruleCount: number;
}

/** A compiled remediation plan — rules grouped by target host set for efficient execution. */
export interface RemediationPlan {
  groups: RemediationPlanGroup[];
  totalRules: number;
  totalHosts: number;
}

/** Request to create or update a compliance profile registration. */
export interface SaveProfileRequest {
  id?: string;
  displayName: string;
  description: string;
  framework: string;
  version: string;
  platform: string;
  platformSpec?: PlatformSpec | null;
  workflowTemplateId: number | null;
  remediateJtId?: number | null;
  eeId: number | null;
  remediationPlaybookPath: string;
  scanTags: string;
  certification?: ScanCertification | null;
}

/** Platform requirements for a compliance profile (ADR-011). */
export interface PlatformSpec {
  os_family?: string[];
  os_version?: string[];
  device_type?: string[];
  scanner_validates?: boolean;
}

/** Result of pre-launch platform validation (ADR-011). */
export interface PlatformValidationResult {
  valid: boolean;
  matchedHosts: string[];
  mismatchedHosts: Array<{ hostname: string; reason: string }>;
  factsAvailable: boolean;
}

/** Raw finding shape from playbook Direct POST to /findings/ingest (ADR-007). */
export interface IngestFinding {
  rule_id: string;
  stig_id?: string;
  title?: string;
  severity?: string;
  status?: string;
  host?: string;
  description?: string;
  check_text?: string;
  fix_text?: string;
  evidence?: Record<string, unknown>;
  [key: string]: unknown;
}
