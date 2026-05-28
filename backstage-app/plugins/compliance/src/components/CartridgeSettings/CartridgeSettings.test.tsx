import React from 'react';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { complianceApiRef } from '../../api/complianceApiRef';
import { CartridgeSettings } from './CartridgeSettings';

// Mock permission module — default to admin allowed
jest.mock('@backstage/plugin-permission-react', () => ({
  usePermission: () => ({ allowed: true, loading: false }),
  RequirePermission: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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
      <CartridgeSettings />
    </TestApiProvider>,
  );
}

describe('CartridgeSettings', () => {
  it('renders the "Compliance Profiles" title', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(screen.getByText('Compliance Profiles')).toBeInTheDocument();
    });
  });

  it('shows empty state when no cartridges are configured', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(
        screen.getByText('No compliance profiles configured'),
      ).toBeInTheDocument();
    });
  });

  it('shows "Add Profile" button in the header', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(screen.getByText('Add Profile')).toBeInTheDocument();
    });
  });

  it('shows "Add Compliance Profile" button in the empty state', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(
        screen.getByText('Add Compliance Profile'),
      ).toBeInTheDocument();
    });
  });

  it('shows cartridge rows when cartridges exist', async () => {
    const mockApi = createMockApi({
      getCartridges: jest.fn().mockResolvedValue([
        {
          id: 'cart-1',
          displayName: 'STIG for RHEL 9',
          description: 'DoD STIG profile',
          framework: 'DISA_STIG',
          version: 'V2R8',
          platform: 'RHEL 9',
          platformSpec: null,
          workflowTemplateId: null,
          eeId: null,
          remediationPlaybookPath: '',
          scanTags: '',
          createdAt: '2025-01-01',
          updatedAt: '2025-01-01',
        },
      ]),
    });

    await renderWithApi(mockApi);

    await waitFor(() => {
      expect(screen.getByText('STIG for RHEL 9')).toBeInTheDocument();
      expect(screen.getByText('DISA STIG')).toBeInTheDocument();
      expect(screen.getByText('V2R8')).toBeInTheDocument();
      expect(screen.getByText('RHEL 9')).toBeInTheDocument();
    });
  });

  it('shows "Access Denied" when user is not admin', async () => {
    // Override the permission mock to deny access
    const permissionMock = jest.requireMock(
      '@backstage/plugin-permission-react',
    );
    permissionMock.usePermission = () => ({ allowed: false, loading: false });

    await renderWithApi();

    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
      expect(
        screen.getByText(
          'You do not have permission to manage compliance profiles. Contact your administrator if you need access.',
        ),
      ).toBeInTheDocument();
    });

    // Restore the default
    permissionMock.usePermission = () => ({ allowed: true, loading: false });
  });
});
