/**
 * Frontend API client that talks to the compliance backend REST API.
 *
 * Implements the ComplianceApi interface so it can be registered as a
 * Backstage API factory and consumed via useApi(complianceApiRef).
 *
 * All data flows through the backend -- the frontend never decides
 * mock vs live. The backend's ComplianceService handles the toggle.
 *
 * Follows the upstream RHDH pattern (e.g., AnsibleApiClient in
 * @ansible/plugin-backstage-self-service): discoveryApi + fetchApi
 * are injected via constructor, discoveryApi resolves the backend
 * URL from app-config.yaml, and fetchApi auto-attaches Backstage
 * identity tokens.
 */
import type { ComplianceProfile, MultiHostFinding, DashboardStats, LaunchScanRequest, LaunchScanResponse, LaunchRemediationRequest, LaunchRemediationResponse, PostureSnapshot, ComplianceScan, RemediationProfile, SaveRemediationProfileRequest, WorkflowJobStatus, WorkflowNode, JobEvent, SaveProfileRequest, PlatformValidationResult } from '@aap-compliance/common';
import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import type { ComplianceApi } from './complianceApiRef';
/** @public */
export interface AapAuthApi {
    getAccessToken(): Promise<string>;
}
/**
 * Default implementation of ComplianceApi.
 *
 * Uses Backstage's discoveryApi to resolve the backend URL and
 * fetchApi to make requests with automatic identity token injection.
 *
 * AAP token flow (Option C):
 *   - When running inside the Ansible Portal (RHDH), the aapAuthApi
 *     is injected via constructor and provides the user's AAP OAuth2
 *     access token. This token is passed to every mutating request
 *     via the x-aap-token header, enabling per-user AAP RBAC.
 *   - When running standalone (dev mode), aapAuthApi is undefined
 *     and the backend falls back to the service token from app-config.
 */
export declare class ComplianceBackendClient implements ComplianceApi {
    private readonly discoveryApi;
    private readonly fetchApi;
    private readonly aapAuthApi?;
    constructor(options: {
        discoveryApi: DiscoveryApi;
        fetchApi: FetchApi;
        aapAuthApi?: AapAuthApi;
    });
    /**
     * Obtain the user's AAP OAuth2 access token.
     *
     * When aapAuthApi is provided (Portal context), delegates to it.
     * When not provided (standalone dev), returns undefined and the
     * backend falls back to the service token from app-config.yaml.
     */
    private getAapToken;
    private request;
    getHealth(): Promise<{
        status: string;
        dataSource: string;
        retentionDays?: number;
    }>;
    updateSettings(settings: {
        retentionDays: number;
    }): Promise<{
        retentionDays: number;
    }>;
    runCleanup(): Promise<{
        deleted: number;
        retentionDays: number;
    }>;
    getProfiles(): Promise<ComplianceProfile[]>;
    getScans(): Promise<ComplianceScan[]>;
    getScan(scanId: string): Promise<ComplianceScan | null>;
    getInventories(): Promise<{
        id: number;
        name: string;
        hostCount: number;
    }[]>;
    getWorkflowTemplates(nameFilter?: string): Promise<{
        id: number;
        name: string;
        description: string;
    }[]>;
    launchScan(body: LaunchScanRequest): Promise<LaunchScanResponse>;
    getFindings(scanId?: string): Promise<MultiHostFinding[]>;
    getPreviousFindings(scanId: string): Promise<MultiHostFinding[]>;
    getWorkflowStatus(jobId: number): Promise<WorkflowJobStatus>;
    getJobStatus(jobId: number): Promise<WorkflowJobStatus>;
    getWorkflowNodes(jobId: number): Promise<WorkflowNode[]>;
    getJobEvents(jobId: number): Promise<JobEvent[]>;
    launchRemediation(body: LaunchRemediationRequest): Promise<LaunchRemediationResponse>;
    getDashboardStats(): Promise<DashboardStats>;
    getPostureHistory(profileId?: string, days?: number): Promise<PostureSnapshot[]>;
    getRemediationProfiles(): Promise<RemediationProfile[]>;
    getRemediationProfile(id: string): Promise<RemediationProfile | null>;
    saveRemediationProfile(body: SaveRemediationProfileRequest): Promise<RemediationProfile>;
    deleteRemediationProfile(id: string): Promise<void>;
    validateScan(body: {
        profileId: string;
        inventoryId: number;
    }): Promise<PlatformValidationResult>;
    getRegisteredProfiles(): Promise<ComplianceProfile[]>;
    getRegisteredProfile(id: string): Promise<ComplianceProfile | null>;
    saveRegisteredProfile(body: SaveProfileRequest): Promise<ComplianceProfile>;
    deleteRegisteredProfile(id: string): Promise<void>;
    getJobTemplateDetail(id: number): Promise<{
        id: number;
        name: string;
        description: string;
        extra_vars: string;
    }>;
    getControllerJobTemplates(): Promise<{
        id: number;
        name: string;
        description: string;
    }[]>;
    getControllerWorkflowTemplates(): Promise<{
        id: number;
        name: string;
        description: string;
    }[]>;
    getControllerExecutionEnvironments(): Promise<{
        id: number;
        name: string;
        image: string;
    }[]>;
}
//# sourceMappingURL=ComplianceBackendClient.d.ts.map