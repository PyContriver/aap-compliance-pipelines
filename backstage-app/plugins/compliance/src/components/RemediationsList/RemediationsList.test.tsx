import React from 'react';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { complianceApiRef } from '../../api/complianceApiRef';
import { RemediationsList } from './RemediationsList';

// Mock usePermission to allow admin actions by default
const permissionMock = jest.requireMock('@backstage/plugin-permission-react');
jest.mock('@backstage/plugin-permission-react', () => ({
  usePermission: () => ({ allowed: true, loading: false }),
}));

function createMockApi(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    getHealth: jest.fn().mockResolvedValue({ status: 'ok', dataSource: 'mock' }),
    getProfiles: jest.fn().mockResolvedValue([]),
    getScans: jest.fn().mockResolvedValue([]),
    getCartridges: jest.fn().mockResolvedValue([]),
    getCartridge: jest.fn().mockResolvedValue(null),
    getInventories: jest.fn().mockResolvedValue([]),
    getFindings: jest.fn().mockResolvedValue([]),
    getWorkflowTemplates: jest.fn().mockResolvedValue([]),
    launchScan: jest.fn().mockResolvedValue({ scanId: 'scan-1', workflowJobId: 1, status: 'pending' }),
    getWorkflowStatus: jest.fn().mockResolvedValue({ id: 1, status: 'successful', finished: null, failed: false, elapsed: 0, name: '' }),
    getWorkflowNodes: jest.fn().mockResolvedValue([]),
    getJobEvents: jest.fn().mockResolvedValue([]),
    launchRemediation: jest.fn().mockResolvedValue({ remediationId: 'r1', workflowJobId: 2, status: 'pending' }),
    getDashboardStats: jest.fn().mockResolvedValue({ hostsScanned: 0, criticalFindings: 0, pendingRemediation: 0, activeProfiles: 0, recentScans: [], frameworkScores: [] }),
    getPostureHistory: jest.fn().mockResolvedValue([]),
    getRemediationProfiles: jest.fn().mockResolvedValue([]),
    getRemediationProfile: jest.fn().mockResolvedValue(null),
    saveRemediationProfile: jest.fn().mockResolvedValue({ id: '1', name: 'test', description: '', complianceProfileId: '', targetInventory: '', selections: [], createdAt: '', updatedAt: '' }),
    deleteRemediationProfile: jest.fn().mockResolvedValue(undefined),
    saveCartridge: jest.fn().mockResolvedValue({}),
    deleteCartridge: jest.fn().mockResolvedValue(undefined),
    getControllerWorkflowTemplates: jest.fn().mockResolvedValue([]),
    getControllerExecutionEnvironments: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function renderWithApi(
  mockApi: ReturnType<typeof createMockApi> = createMockApi(),
) {
  return renderInTestApp(
    <TestApiProvider apis={[[complianceApiRef, mockApi]]}>
      <RemediationsList />
    </TestApiProvider>,
  );
}

describe('RemediationsList', () => {
  it('renders the "Remediations" title', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(screen.getByText('Remediations')).toBeInTheDocument();
    });
  });

  it('shows empty state when no remediations exist', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(
        screen.getByText('No saved remediations'),
      ).toBeInTheDocument();
      expect(screen.getByText('Launch a Scan')).toBeInTheDocument();
    });
  });

  it('shows the "New Scan" button', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(screen.getByText('New Scan')).toBeInTheDocument();
    });
  });

  it('shows remediation rows when data exists', async () => {
    const mockApi = createMockApi({
      getRemediationProfiles: jest.fn().mockResolvedValue([
        {
          id: 'rem-1',
          name: 'STIG SSH Hardening',
          description: 'Fix SSH-related STIG findings',
          complianceProfileId: 'rhel9-stig',
          targetInventory: 'prod-hosts',
          selections: [
            { ruleId: 'sshd_set_idle_timeout', enabled: true },
            { ruleId: 'accounts_tmout', enabled: true },
            { ruleId: 'sshd_disable_root_login', enabled: false },
          ],
          createdAt: '2025-10-01T10:00:00Z',
          updatedAt: '2025-10-02T08:00:00Z',
        },
        {
          id: 'rem-2',
          name: 'Audit Rules Baseline',
          description: '',
          complianceProfileId: 'rhel9-stig',
          targetInventory: 'dev-hosts',
          selections: [
            { ruleId: 'audit_rules_privileged_commands', enabled: true },
          ],
          createdAt: '2025-10-03T12:00:00Z',
          updatedAt: '2025-10-03T12:00:00Z',
        },
      ]),
    });

    await renderWithApi(mockApi);

    await waitFor(() => {
      expect(screen.getByText('STIG SSH Hardening')).toBeInTheDocument();
      expect(screen.getByText('Audit Rules Baseline')).toBeInTheDocument();
    });
  });

  it('shows the number of selected rules', async () => {
    const mockApi = createMockApi({
      getRemediationProfiles: jest.fn().mockResolvedValue([
        {
          id: 'rem-1',
          name: 'STIG SSH Hardening',
          description: '',
          complianceProfileId: 'rhel9-stig',
          targetInventory: 'prod-hosts',
          selections: [
            { ruleId: 'sshd_set_idle_timeout', enabled: true },
            { ruleId: 'accounts_tmout', enabled: true },
            { ruleId: 'sshd_disable_root_login', enabled: false },
          ],
          createdAt: '2025-10-01T10:00:00Z',
          updatedAt: '2025-10-02T08:00:00Z',
        },
      ]),
    });

    await renderWithApi(mockApi);

    await waitFor(() => {
      // 2 of the 3 selections are enabled
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });
  });

  it('shows the compliance profile chip', async () => {
    const mockApi = createMockApi({
      getRemediationProfiles: jest.fn().mockResolvedValue([
        {
          id: 'rem-1',
          name: 'STIG SSH Hardening',
          description: '',
          complianceProfileId: 'rhel9-stig',
          targetInventory: 'prod-hosts',
          selections: [],
          createdAt: '2025-10-01T10:00:00Z',
          updatedAt: '2025-10-02T08:00:00Z',
        },
      ]),
    });

    await renderWithApi(mockApi);

    await waitFor(() => {
      expect(screen.getByText('rhel9-stig')).toBeInTheDocument();
    });
  });
});
