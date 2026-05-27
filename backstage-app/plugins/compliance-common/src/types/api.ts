/**
 * Types for the compliance backend REST API and Controller integration.
 */

import type { Finding, ScanResult, FindingParameter } from './findings';
import type { ComplianceProfile, RemediationProfile, RemediationSelection } from './profiles';

/** Request to launch a compliance scan via the backend. */
export interface LaunchScanRequest {
  profileId: string;
  inventoryId: number;
  evaluateOnly: boolean;
  scanType?: 'assessment' | 'verification';
  limit?: string;
  workflowTemplateId?: number;
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
  /** Scan ID to load findings from, used to build the remediation plan. */
  scanId?: string;
}

/** Response from launching remediation. */
export interface LaunchRemediationResponse {
  remediationId: string;
  workflowJobId: number;
  status: string;
}

/** Posture snapshot for historical trend tracking. */
export interface PostureSnapshot {
  id: string;
  profileId: string;
  timestamp: string;
  totalHosts: number;
  totalRules: number;
  passCount: number;
  failCount: number;
  compliancePct: number;
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
  /** The scan ID (workflow job ID) whose findings were used to build this remediation. */
  scanId?: string;
  selections: RemediationSelection[];
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

/** Dashboard stats summary. */
export interface DashboardStats {
  hostsScanned: number;
  criticalFindings: number;
  pendingRemediation: number;
  activeProfiles: number;
  recentScans: RecentScan[];
  frameworkScores: Array<{
    profileId: string;
    name: string;
    target: string;
    rules: number;
    rate: number;
    lastScan: string;
  }>;
}

/** A compliance profile maps a standard (e.g., DISA STIG) to Controller resources. */
export interface ComplianceCartridge {
  id: string;
  displayName: string;
  description: string;
  framework: string;
  version: string;
  platform: string;
  platformSpec: PlatformSpec | null;
  workflowTemplateId: number | null;
  eeId: number | null;
  remediationPlaybookPath: string;
  scanTags: string;
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
export interface SaveCartridgeRequest {
  id?: string;
  displayName: string;
  description: string;
  framework: string;
  version: string;
  platform: string;
  platformSpec?: PlatformSpec | null;
  workflowTemplateId: number | null;
  eeId: number | null;
  remediationPlaybookPath: string;
  scanTags: string;
}

/** Platform requirements for a compliance profile (ADR-011). */
export interface PlatformSpec {
  os_family?: string[];
  os_version?: string[];
  device_type?: string[];
  scanner_validates?: boolean;
}
