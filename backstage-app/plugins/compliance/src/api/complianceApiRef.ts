/**
 * Backstage API reference for the compliance plugin.
 *
 * Components consume this via `useApi(complianceApiRef)` instead of
 * importing the client directly. This follows the Backstage pattern
 * used by upstream RHDH plugins (e.g., ansibleApiRef in
 * @ansible/backstage-rhaap-common).
 */
import { createApiRef } from '@backstage/core-plugin-api';
import type {
  ComplianceProfile,
  ComplianceScan,
  MultiHostFinding,
  DashboardStats,
  LaunchScanRequest,
  LaunchScanResponse,
  LaunchRemediationRequest,
  LaunchRemediationResponse,
  PostureSnapshot,
  ContributingScan,
  RemediationProfile,
  RemediationExecution,
  RemediationProfileStatus,
  SaveRemediationProfileRequest,
  WorkflowJobStatus,
  WorkflowNode,
  JobEvent,
  SaveProfileRequest,
  PlatformValidationResult,
  AuthoritativeScanResponse,
  BaselineTarget,
} from '@aap-compliance/common';

/** Interface for the compliance backend API. */
export interface ComplianceApi {
  getHealth(): Promise<{ status: string; dataSource: string; retentionDays?: number }>;
  updateSettings(settings: { retentionDays: number }): Promise<{ retentionDays: number }>;
  runCleanup(): Promise<{ deleted: number; retentionDays: number }>;
  getProfiles(): Promise<ComplianceProfile[]>;
  getInventories(): Promise<Array<{ id: number; name: string; hostCount: number }>>;
  getWorkflowTemplates(nameFilter?: string): Promise<Array<{ id: number; name: string; description: string }>>;
  getScans(): Promise<ComplianceScan[]>;
  getScan(scanId: string): Promise<ComplianceScan | null>;
  launchScan(body: LaunchScanRequest): Promise<LaunchScanResponse>;
  getFindings(scanId?: string, profileId?: string): Promise<MultiHostFinding[]>;
  getPreviousFindings(scanId: string): Promise<MultiHostFinding[]>;
  getWorkflowStatus(jobId: number): Promise<WorkflowJobStatus>;
  getJobStatus(jobId: number): Promise<WorkflowJobStatus>;
  getWorkflowNodes(jobId: number): Promise<WorkflowNode[]>;
  getJobEvents(jobId: number): Promise<JobEvent[]>;
  launchRemediation(body: LaunchRemediationRequest): Promise<LaunchRemediationResponse>;
  getDashboardStats(): Promise<DashboardStats>;
  getContributingScans(profileId: string): Promise<ContributingScan[]>;
  getPostureHistory(profileId?: string, days?: number): Promise<PostureSnapshot[]>;
  getRemediationProfiles(statusFilter?: RemediationProfileStatus | 'all'): Promise<RemediationProfile[]>;
  getRemediationProfile(id: string): Promise<RemediationProfile | null>;
  saveRemediationProfile(body: SaveRemediationProfileRequest): Promise<RemediationProfile>;
  deleteRemediationProfile(id: string): Promise<void>;
  updateRemediationProfileStatus(id: string, status: RemediationProfileStatus): Promise<RemediationProfile>;
  getRemediationExecutions(profileId: string, limit?: number): Promise<RemediationExecution[]>;
  getBatchScanStats(scanIds: string[]): Promise<Record<string, { pass: number; fail: number; rules: number; hosts: number; naCount: number; stateNew?: number; stateFixed?: number; stateResurfaced?: number }>>;
  getNotApplicableRules(scanId: string): Promise<Array<{ ruleId: string; ruleTitle: string; severity: string }>>;
  getAllRecentExecutions(limit?: number): Promise<RemediationExecution[]>;
  getRemediationExecution(id: string): Promise<RemediationExecution | null>;
  updateRemediationExecution(id: string, update: Partial<RemediationExecution>): Promise<RemediationExecution>;
  getAuthoritativeScan(profileId: string, inventoryId: number): Promise<AuthoritativeScanResponse | null>;
  validateScan(body: { profileId: string; inventoryId: number }): Promise<PlatformValidationResult>;
  getRegisteredProfiles(): Promise<ComplianceProfile[]>;
  getRegisteredProfile(id: string): Promise<ComplianceProfile | null>;
  saveRegisteredProfile(body: SaveProfileRequest): Promise<ComplianceProfile>;
  deleteRegisteredProfile(id: string): Promise<void>;
  getJobTemplateDetail(id: number): Promise<{ id: number; name: string; description: string; extra_vars: string; execution_environment: number | null }>;
  getControllerJobTemplates(): Promise<Array<{ id: number; name: string; description: string }>>;
  getControllerWorkflowTemplates(): Promise<Array<{ id: number; name: string; description: string }>>;
  getControllerExecutionEnvironments(): Promise<Array<{ id: number; name: string; image: string }>>;
  getBaselineTargets(complianceProfileId?: string): Promise<BaselineTarget[]>;
  pinBaselineTarget(body: { remediationProfileId: string; complianceProfileId: string; inventoryId: number }): Promise<BaselineTarget>;
  unpinBaselineTarget(id: string): Promise<void>;
  getRemediationErrorDetails(jobIds: number[]): Promise<string | null>;
  getBaselineScores(remediationProfileId: string): Promise<Array<{ inventoryId: number; passRate: number; passCount: number; failCount: number }>>;
}

/** API ref for the compliance plugin, consumed via useApi(complianceApiRef). */
export const complianceApiRef = createApiRef<ComplianceApi>({
  id: 'plugin.compliance.api',
});
