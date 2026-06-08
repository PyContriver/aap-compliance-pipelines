import React from 'react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import { RemediationExecution } from './RemediationExecution';
import { complianceApiRef } from '../../api';
import { createMockComplianceApi } from '../../__testutils__/mockComplianceApi';
import type { ComplianceApi } from '../../api';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ jobId: '99' }),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));

jest.mock('@backstage/plugin-permission-react', () => ({
  usePermission: () => ({ allowed: true, loading: false }),
}));

describe('RemediationExecution (view mode)', () => {
  let mockApi: jest.Mocked<ComplianceApi>;

  beforeEach(() => {
    mockApi = createMockComplianceApi();
  });

  const renderView = () =>
    renderInTestApp(
      <TestApiProvider apis={[[complianceApiRef, mockApi]]}>
        <RemediationExecution viewMode />
      </TestApiProvider>,
    );

  const baseExecution = {
    remediationProfileId: 'rp-1',
    inventoryId: 1,
    informingScanId: null,
    allJobIds: [99],
    elapsedSeconds: 600,
    rulesFailed: 0,
    hostsSucceeded: 3,
    hostsFailed: 0,
    verificationScanId: null,
    createdBy: null,
  };

  const makeExecution = (extra: object) => ({
    ...baseExecution,
    primaryJobId: 99,
    status: 'succeeded' as const,
    rulesApplied: 2,
    hostsTargeted: 3,
    startedAt: '2026-06-01T00:00:00Z',
    completedAt: '2026-06-01T00:10:00Z',
    ...extra,
  });

  it('shows "Plan snapshot" chip when execution has planSummary', async () => {
    // window.location.search is empty in JSDOM so the fallback (getAllRecentExecutions) runs.
    // Return the execution with primaryJobId matching the mocked jobId (99).
    mockApi.getAllRecentExecutions.mockResolvedValue([
      makeExecution({
        id: 'exec-snap-1',
        planSummary: {
          totalRules: 2,
          totalHosts: 3,
          groups: [{ tags: ['rule_a', 'rule_b'], limit: '', extraVars: {}, hostCount: 3, ruleCount: 2 }],
        },
      }),
    ]);

    await renderView();
    await waitFor(() => {
      expect(screen.getByText('Plan snapshot')).toBeInTheDocument();
    });
  });

  it('does not show "Plan snapshot" chip when execution has no planSummary', async () => {
    mockApi.getAllRecentExecutions.mockResolvedValue([
      makeExecution({ id: 'exec-legacy-1', planSummary: null }),
    ]);

    await renderView();
    await waitFor(() => {
      expect(mockApi.getAllRecentExecutions).toHaveBeenCalled();
    });
    expect(screen.queryByText('Plan snapshot')).not.toBeInTheDocument();
  });
});
