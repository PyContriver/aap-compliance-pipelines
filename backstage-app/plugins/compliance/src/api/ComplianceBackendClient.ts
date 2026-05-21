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
import type {
  ComplianceProfile,
  MultiHostFinding,
  DashboardStats,
  LaunchScanRequest,
  LaunchScanResponse,
  LaunchRemediationRequest,
  LaunchRemediationResponse,
  PostureSnapshot,
  ComplianceScan,
  RemediationProfile,
  SaveRemediationProfileRequest,
  WorkflowJobStatus,
  WorkflowNode,
  JobEvent,
  ComplianceCartridge,
  SaveCartridgeRequest,
} from '@aap-compliance/common';

import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import type { ComplianceApi } from './complianceApiRef';

// ─── ComplianceBackendClient ─────────────────────────────────────────

/**
 * Default implementation of ComplianceApi.
 *
 * Uses Backstage's discoveryApi to resolve the backend URL and
 * fetchApi to make requests with automatic identity token injection.
 *
 * AAP token flow:
 * When the auth-backend-module-rhaap-provider is integrated, the
 * user's AAP OAuth2 token would be obtained via rhAapAuthApiRef
 * and passed to every mutating request (scan, remediate, etc.).
 * For now, getAapToken() returns undefined and the backend falls
 * back to the service token from app-config.yaml.
 */
export class ComplianceBackendClient implements ComplianceApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  /**
   * Obtain the user's AAP OAuth2 access token.
   *
   * When the auth-backend-module-rhaap-provider is integrated, this
   * would call rhAapAuthApiRef.getAccessToken() — exactly as the
   * upstream self-service plugin does in Home.tsx and AAPTokenField.
   *
   * Returns undefined until the auth module is wired up, which
   * causes the backend to fall back to the service token.
   */
  private async getAapToken(): Promise<string | undefined> {
    try {
      // TODO: When auth module is integrated, replace with:
      //   const rhAapAuthApi = ... // injected via constructor
      //   return await rhAapAuthApi.getAccessToken();
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async request<T>(
    path: string,
    options?: { method?: string; body?: unknown; aapToken?: string },
  ): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl('compliance');
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // When an AAP token is available, pass it to the backend so that
    // Controller API calls are made as the logged-in user (AAP RBAC).
    // The backend reads this from the x-aap-token header.
    if (options?.aapToken) {
      headers['x-aap-token'] = options.aapToken;
    }

    const resp = await this.fetchApi.fetch(url, {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`${resp.status} ${resp.statusText}: ${errBody}`);
    }

    // 204 No Content -- return undefined (cast to T for void responses)
    if (resp.status === 204) {
      return undefined as T;
    }

    return (await resp.json()) as T;
  }

  getHealth() {
    return this.request<{ status: string; dataSource: string; retentionDays?: number }>('/health');
  }

  updateSettings(settings: { retentionDays: number }) {
    return this.request<{ retentionDays: number }>('/settings', {
      method: 'POST',
      body: settings,
    });
  }

  runCleanup() {
    return this.request<{ deleted: number; retentionDays: number }>('/cleanup', {
      method: 'POST',
    });
  }

  getProfiles() {
    return this.request<ComplianceProfile[]>('/profiles');
  }

  getScans() {
    return this.request<ComplianceScan[]>('/scans');
  }

  getInventories() {
    return this.request<Array<{ id: number; name: string; hostCount: number }>>('/inventories');
  }

  getWorkflowTemplates(nameFilter?: string) {
    const q = nameFilter ? `?name=${encodeURIComponent(nameFilter)}` : '';
    return this.request<Array<{ id: number; name: string; description: string }>>(
      `/workflow-templates${q}`,
    );
  }

  async launchScan(body: LaunchScanRequest) {
    const aapToken = await this.getAapToken();
    return this.request<LaunchScanResponse>('/scan', { method: 'POST', body, aapToken });
  }

  getFindings(scanId?: string) {
    const q = scanId ? `?scanId=${encodeURIComponent(scanId)}` : '';
    return this.request<MultiHostFinding[]>(`/findings${q}`);
  }

  getPreviousFindings(scanId: string) {
    return this.request<MultiHostFinding[]>(
      `/previous-findings?scanId=${encodeURIComponent(scanId)}`,
    );
  }

  getWorkflowStatus(jobId: number) {
    return this.request<WorkflowJobStatus>(`/workflow-status/${jobId}`);
  }

  getJobStatus(jobId: number) {
    return this.request<WorkflowJobStatus>(`/job-status/${jobId}`);
  }

  getWorkflowNodes(jobId: number) {
    return this.request<WorkflowNode[]>(`/workflow-nodes/${jobId}`);
  }

  getJobEvents(jobId: number) {
    return this.request<JobEvent[]>(`/job-events/${jobId}`);
  }

  async launchRemediation(body: LaunchRemediationRequest) {
    const aapToken = await this.getAapToken();
    return this.request<LaunchRemediationResponse>('/remediate', { method: 'POST', body, aapToken });
  }

  getDashboardStats() {
    return this.request<DashboardStats>('/dashboard');
  }

  getPostureHistory(profileId?: string, days?: number) {
    const params = new URLSearchParams();
    if (profileId) params.set('profileId', profileId);
    if (days) params.set('days', String(days));
    const q = params.toString() ? `?${params}` : '';
    return this.request<PostureSnapshot[]>(`/posture${q}`);
  }

  getRemediationProfiles() {
    return this.request<RemediationProfile[]>('/remediation-profiles');
  }

  async getRemediationProfile(id: string) {
    try {
      return await this.request<RemediationProfile>(
        `/remediation-profiles/${encodeURIComponent(id)}`,
      );
    } catch (err) {
      console.error(`Failed to load remediation profile ${id}:`, err);
      return null;
    }
  }

  saveRemediationProfile(body: SaveRemediationProfileRequest) {
    return this.request<RemediationProfile>('/remediation-profiles', {
      method: 'POST',
      body,
    });
  }

  deleteRemediationProfile(id: string) {
    return this.request<void>(`/remediation-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  getCartridges() {
    return this.request<ComplianceCartridge[]>('/cartridges');
  }

  async saveCartridge(body: SaveCartridgeRequest) {
    const aapToken = await this.getAapToken();
    return this.request<ComplianceCartridge>('/cartridges', { method: 'POST', body, aapToken });
  }

  async deleteCartridge(id: string) {
    const aapToken = await this.getAapToken();
    return this.request<void>(`/cartridges/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      aapToken,
    });
  }

  getControllerWorkflowTemplates() {
    return this.request<Array<{ id: number; name: string; description: string }>>(
      '/controller/workflow-job-templates',
    );
  }

  getControllerExecutionEnvironments() {
    return this.request<Array<{ id: number; name: string; image: string }>>(
      '/controller/execution-environments',
    );
  }
}
