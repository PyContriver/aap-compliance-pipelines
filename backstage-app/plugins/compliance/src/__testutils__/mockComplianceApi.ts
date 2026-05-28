/**
 * Shared mock for ComplianceApi used by all plugin tests.
 *
 * Usage:
 *   const mockApi = createMockComplianceApi();
 *   <TestApiProvider apis={[[complianceApiRef, mockApi]]}>
 */
import type { ComplianceApi } from '../api/complianceApiRef';
import type {
  ComplianceProfile,
  MultiHostFinding,
  DashboardStats,
  ComplianceCartridge,
  RemediationProfile,
  ComplianceScan,
  PostureSnapshot,
  LaunchScanResponse,
  LaunchRemediationResponse,
  WorkflowJobStatus,
  WorkflowNode,
  JobEvent,
} from '@aap-compliance/common';

// ---------------------------------------------------------------------------
// Sample mock data constants
// ---------------------------------------------------------------------------

export const MOCK_PROFILES: ComplianceProfile[] = [
  {
    id: 'rhel9-stig',
    name: 'DISA STIG for RHEL 9',
    framework: 'DISA_STIG',
    version: 'V2R8',
    description: 'Defense Information Systems Agency STIG for RHEL 9',
    applicableOs: ['RHEL 9'],
    ruleCount: 366,
    lastUpdated: '2026-01-15',
    source: 'DISA',
  },
  {
    id: 'rhel9-cis-l1',
    name: 'CIS Benchmark RHEL 9 — Level 1',
    framework: 'CIS',
    version: '1.0.0',
    description: 'CIS Benchmark Level 1 for RHEL 9',
    applicableOs: ['RHEL 9'],
    ruleCount: 189,
    lastUpdated: '2026-02-01',
    source: 'CIS',
  },
  {
    id: 'rhel9-pci-dss',
    name: 'PCI-DSS v4.0 for RHEL 9',
    framework: 'PCI_DSS',
    version: '4.0',
    description: 'PCI Data Security Standard v4.0',
    applicableOs: ['RHEL 9'],
    ruleCount: 142,
    lastUpdated: '2026-03-10',
    source: 'PCI SSC',
  },
];

export const MOCK_FINDINGS: MultiHostFinding[] = [
  {
    ruleId: 'sshd_set_idle_timeout',
    stigId: 'V-257844',
    title: 'Set SSH Client Alive Interval',
    description: 'The SSH idle timeout must be set to 600 seconds or less.',
    fixText: 'Set ClientAliveInterval to 600 in /etc/ssh/sshd_config',
    checkText: 'Verify the SSH daemon ClientAliveInterval setting.',
    severity: 'CAT_II',
    category: 'SSH',
    disruption: 'low',
    parameters: [
      {
        name: 'interval',
        label: 'Interval (seconds)',
        description: 'SSH client alive interval in seconds',
        type: 'number',
        default: 600,
        value: 600,
      },
    ],
    hosts: [
      { host: 'web-01.example.com', status: 'fail', actualValue: '900', expectedValue: '600' },
      { host: 'web-02.example.com', status: 'pass', actualValue: '600', expectedValue: '600' },
      { host: 'db-01.example.com', status: 'fail', actualValue: '0', expectedValue: '600' },
    ],
    passCount: 1,
    failCount: 2,
    totalCount: 3,
  },
  {
    ruleId: 'accounts_password_minlen',
    stigId: 'V-257856',
    title: 'Set Password Minimum Length',
    description: 'Passwords must be a minimum of 15 characters.',
    fixText: 'Set minlen = 15 in /etc/security/pwquality.conf',
    checkText: 'Verify the password minimum length in pwquality.conf.',
    severity: 'CAT_I',
    category: 'Accounts',
    disruption: 'low',
    parameters: [
      {
        name: 'minlen',
        label: 'Minimum Length',
        description: 'Minimum password length',
        type: 'number',
        default: 15,
        value: 15,
      },
    ],
    hosts: [
      { host: 'web-01.example.com', status: 'fail', actualValue: '8', expectedValue: '15' },
      { host: 'web-02.example.com', status: 'fail', actualValue: '8', expectedValue: '15' },
      { host: 'db-01.example.com', status: 'pass', actualValue: '15', expectedValue: '15' },
    ],
    passCount: 1,
    failCount: 2,
    totalCount: 3,
  },
  {
    ruleId: 'sshd_disable_root_login',
    stigId: 'V-257850',
    title: 'Disable SSH Root Login',
    description: 'SSH root login must be disabled.',
    fixText: 'Set PermitRootLogin to no in /etc/ssh/sshd_config',
    checkText: 'Verify PermitRootLogin is set to no.',
    severity: 'CAT_I',
    category: 'SSH',
    disruption: 'low',
    parameters: [],
    hosts: [
      { host: 'web-01.example.com', status: 'pass', actualValue: 'no', expectedValue: 'no' },
      { host: 'web-02.example.com', status: 'pass', actualValue: 'no', expectedValue: 'no' },
      { host: 'db-01.example.com', status: 'pass', actualValue: 'no', expectedValue: 'no' },
    ],
    passCount: 3,
    failCount: 0,
    totalCount: 3,
  },
];

export const MOCK_DASHBOARD_STATS: DashboardStats = {
  hostsScanned: 38,
  criticalFindings: 5,
  pendingRemediation: 12,
  activeProfiles: 3,
  recentScans: [
    {
      id: 'scan-1',
      profileName: 'RHEL 9 STIG V2R8',
      inventoryName: 'production-web-servers',
      passRate: 78,
      timestamp: '2026-04-28 14:30',
      status: 'completed',
      scanner: 'oscap',
    },
    {
      id: 'scan-2',
      profileName: 'CIS Benchmark L1',
      inventoryName: 'staging-db-servers',
      passRate: 92,
      timestamp: '2026-04-27 09:15',
      status: 'completed',
      scanner: 'oscap',
    },
    {
      id: 'scan-3',
      profileName: 'RHEL 9 STIG V2R8',
      inventoryName: 'production-web-servers',
      passRate: 0,
      timestamp: '2026-04-28 10:00',
      status: 'successful',
      scanner: 'remediation',
    },
  ],
  frameworkScores: [
    { profileId: 'rhel9-stig', name: 'DISA STIG V2R8', target: 'RHEL 9', rules: 366, rate: 78, lastScan: '2026-04-28' },
    { profileId: 'rhel9-cis-l1', name: 'CIS Benchmark L1', target: 'RHEL 9', rules: 189, rate: 92, lastScan: '2026-04-27' },
    { profileId: 'rhel9-pci-dss', name: 'PCI-DSS v4.0', target: 'RHEL 9', rules: 142, rate: 85, lastScan: '2026-04-25' },
  ],
};

export const MOCK_CARTRIDGES: ComplianceCartridge[] = [
  {
    id: 'rhel9-stig',
    displayName: 'DISA STIG for RHEL 9',
    description: 'Defense Information Systems Agency STIG for RHEL 9',
    framework: 'DISA_STIG',
    version: 'V2R8',
    platform: 'RHEL 9',
    platformSpec: null,
    workflowTemplateId: 10,
    eeId: 1,
    remediationPlaybookPath: 'playbooks/rhel9-stig-remediate.yml',
    scanTags: 'stig,rhel9',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  },
];

export const MOCK_INVENTORIES = [
  { id: 1, name: 'production-web-servers', hostCount: 24 },
  { id: 2, name: 'staging-db-servers', hostCount: 6 },
  { id: 3, name: 'dev-servers', hostCount: 8 },
];

export const MOCK_REMEDIATION_PROFILES: RemediationProfile[] = [
  {
    id: 'rp-1',
    name: 'prod-web-stig',
    description: 'Production web server STIG remediation',
    complianceProfileId: 'rhel9-stig',
    scanId: '42',
    targetInventory: 'production-web-servers',
    selections: [
      { ruleId: 'sshd_set_idle_timeout', enabled: true, parameters: { interval: 600 } },
    ],
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  },
];

export const MOCK_SCANS: ComplianceScan[] = [
  {
    id: 'scan-1',
    profileId: 'rhel9-stig',
    inventoryId: 1,
    scanner: 'oscap',
    scanType: 'assessment',
    workflowJobId: 42,
    status: 'completed',
    startedAt: '2026-04-28T14:30:00Z',
    completedAt: '2026-04-28T14:45:00Z',
    errorDetails: null,
  },
];

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Creates a mock ComplianceApi where every method is a jest.fn()
 * returning sensible defaults. Override individual mocks per test:
 *
 *   mockApi.getFindings.mockResolvedValue(customFindings);
 */
export function createMockComplianceApi(): jest.Mocked<ComplianceApi> {
  return {
    getHealth: jest.fn().mockResolvedValue({ status: 'ok', dataSource: 'mock', retentionDays: 90 }),
    updateSettings: jest.fn().mockResolvedValue({ retentionDays: 90 }),
    runCleanup: jest.fn().mockResolvedValue({ deleted: 0, retentionDays: 90 }),
    getProfiles: jest.fn().mockResolvedValue(MOCK_PROFILES),
    getInventories: jest.fn().mockResolvedValue(MOCK_INVENTORIES),
    getWorkflowTemplates: jest.fn().mockResolvedValue([
      { id: 10, name: 'compliance-stig-scan', description: 'STIG scan workflow' },
    ]),
    getScans: jest.fn().mockResolvedValue(MOCK_SCANS),
    getScan: jest.fn().mockResolvedValue(null),
    launchScan: jest.fn().mockResolvedValue({
      scanId: 'scan-new',
      workflowJobId: 100,
      status: 'pending',
    } as LaunchScanResponse),
    getFindings: jest.fn().mockResolvedValue(MOCK_FINDINGS),
    getPreviousFindings: jest.fn().mockResolvedValue([]),
    getWorkflowStatus: jest.fn().mockResolvedValue({
      id: 42,
      status: 'successful',
      finished: '2026-04-28T14:45:00Z',
      failed: false,
      elapsed: 900,
      name: 'compliance-stig-scan',
    } as WorkflowJobStatus),
    getJobStatus: jest.fn().mockResolvedValue({
      id: 42,
      status: 'successful',
      finished: '2026-04-28T14:45:00Z',
      failed: false,
      elapsed: 30,
      name: 'compliance-remediate',
    } as WorkflowJobStatus),
    getWorkflowNodes: jest.fn().mockResolvedValue([
      {
        id: 1,
        summary_fields: { job: { id: 100, name: 'scan', status: 'successful', type: 'job' } },
        identifier: 'scan',
      },
    ] as WorkflowNode[]),
    getJobEvents: jest.fn().mockResolvedValue([] as JobEvent[]),
    launchRemediation: jest.fn().mockResolvedValue({
      remediationId: 'rem-1',
      workflowJobId: 200,
      status: 'pending',
    } as LaunchRemediationResponse),
    getDashboardStats: jest.fn().mockResolvedValue(MOCK_DASHBOARD_STATS),
    getPostureHistory: jest.fn().mockResolvedValue([] as PostureSnapshot[]),
    getRemediationProfiles: jest.fn().mockResolvedValue(MOCK_REMEDIATION_PROFILES),
    getRemediationProfile: jest.fn().mockResolvedValue(MOCK_REMEDIATION_PROFILES[0]),
    saveRemediationProfile: jest.fn().mockResolvedValue(MOCK_REMEDIATION_PROFILES[0]),
    deleteRemediationProfile: jest.fn().mockResolvedValue(undefined),
    getCartridges: jest.fn().mockResolvedValue(MOCK_CARTRIDGES),
    getCartridge: jest.fn().mockResolvedValue(MOCK_CARTRIDGES[0]),
    saveCartridge: jest.fn().mockResolvedValue(MOCK_CARTRIDGES[0]),
    deleteCartridge: jest.fn().mockResolvedValue(undefined),
    getControllerWorkflowTemplates: jest.fn().mockResolvedValue([
      { id: 10, name: 'compliance-stig-scan', description: 'STIG scan workflow' },
    ]),
    getControllerExecutionEnvironments: jest.fn().mockResolvedValue([
      { id: 1, name: 'compliance-ee', image: 'registry.example.com/compliance-ee:latest' },
    ]),
  };
}
