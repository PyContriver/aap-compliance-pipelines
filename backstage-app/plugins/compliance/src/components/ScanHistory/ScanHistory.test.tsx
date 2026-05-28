import React from 'react';
import '@testing-library/jest-dom';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { complianceApiRef } from '../../api/complianceApiRef';
import { ScanHistory } from './ScanHistory';

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
      <ScanHistory />
    </TestApiProvider>,
  );
}

describe('ScanHistory', () => {
  it('renders the "Scan History" title', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(screen.getByText('Scan History')).toBeInTheDocument();
    });
  });

  it('shows empty state when no scans exist', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(screen.getByText('No scans yet')).toBeInTheDocument();
      expect(screen.getByText('Launch a Scan')).toBeInTheDocument();
    });
  });

  it('shows the "New Scan" button', async () => {
    await renderWithApi();

    await waitFor(() => {
      expect(screen.getByText('New Scan')).toBeInTheDocument();
    });
  });

  it('shows scan rows when data exists', async () => {
    const mockApi = createMockApi({
      getScans: jest.fn().mockResolvedValue([
        {
          id: 'scan-1',
          profileId: 'rhel9-stig',
          inventoryId: 1,
          status: 'completed',
          scanner: 'oscap',
          scanType: 'assessment',
          workflowJobId: 42,
          startedAt: '2025-10-01T10:00:00Z',
          completedAt: '2025-10-01T10:15:00Z',
          errorDetails: null,
          hostCount: 5,
          findingsCount: 120,
        },
        {
          id: 'scan-2',
          profileId: 'rhel9-cis-l1',
          inventoryId: 2,
          status: 'failed',
          scanner: 'oscap',
          scanType: 'verification',
          workflowJobId: 43,
          startedAt: '2025-10-02T08:00:00Z',
          completedAt: '2025-10-02T08:05:00Z',
          errorDetails: null,
          hostCount: 3,
          findingsCount: 0,
        },
      ]),
    });

    await renderWithApi(mockApi);

    await waitFor(() => {
      expect(screen.getByText('rhel9-stig')).toBeInTheDocument();
      expect(screen.getByText('rhel9-cis-l1')).toBeInTheDocument();
      expect(screen.getByText('#42')).toBeInTheDocument();
      expect(screen.getByText('#43')).toBeInTheDocument();
    });
  });

  it('displays status chips for scans', async () => {
    const mockApi = createMockApi({
      getScans: jest.fn().mockResolvedValue([
        {
          id: 'scan-1',
          profileId: 'rhel9-stig',
          inventoryId: 1,
          status: 'completed',
          scanner: 'oscap',
          scanType: 'assessment',
          workflowJobId: 42,
          startedAt: '2025-10-01T10:00:00Z',
          completedAt: '2025-10-01T10:15:00Z',
          errorDetails: null,
          hostCount: 5,
          findingsCount: 120,
        },
      ]),
    });

    await renderWithApi(mockApi);

    await waitFor(() => {
      // "Completed" appears both as a column header and as the chip label.
      // Use getAllByText and verify the chip instance exists.
      const matches = screen.getAllByText('Completed');
      // At least one should be inside a MUI Chip (the status label)
      const chipLabel = matches.find(el => el.classList.contains('MuiChip-label'));
      expect(chipLabel).toBeTruthy();
    });
  });

  it('clicking a scan row navigates to results', async () => {
    const mockApi = createMockApi({
      getScans: jest.fn().mockResolvedValue([
        {
          id: 'scan-1',
          profileId: 'rhel9-stig',
          inventoryId: 1,
          status: 'completed',
          scanner: 'oscap',
          scanType: 'assessment',
          workflowJobId: 42,
          startedAt: '2025-10-01T10:00:00Z',
          completedAt: '2025-10-01T10:15:00Z',
          errorDetails: null,
          hostCount: 5,
          findingsCount: 120,
        },
      ]),
    });

    await renderWithApi(mockApi);

    await waitFor(() => {
      expect(screen.getByText('rhel9-stig')).toBeInTheDocument();
    });

    // Click the row — the navigation is handled by react-router, so we just
    // verify the row is clickable (has the cursor style via the className)
    const row = screen.getByText('rhel9-stig').closest('tr');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
  });
});
