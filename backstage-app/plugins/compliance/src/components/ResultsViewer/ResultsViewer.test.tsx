import React from 'react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import { ResultsViewer } from './ResultsViewer';
import { complianceApiRef } from '../../api';
import {
  createMockComplianceApi,
  MOCK_FINDINGS,
} from '../../__testutils__/mockComplianceApi';
import type { ComplianceApi } from '../../api';

// Mock useParams to provide a jobId
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ jobId: '42' }),
}));

describe('ResultsViewer', () => {
  let mockApi: jest.Mocked<ComplianceApi>;

  beforeEach(() => {
    mockApi = createMockComplianceApi();
  });

  const renderResults = () =>
    renderInTestApp(
      <TestApiProvider apis={[[complianceApiRef, mockApi]]}>
        <ResultsViewer />
      </TestApiProvider>,
    );

  it('renders findings table after loading', async () => {
    await renderResults();
    await waitFor(() => {
      expect(screen.getByText('Findings by Rule')).toBeInTheDocument();
    });
  });

  it('displays summary cards with computed values', async () => {
    await renderResults();
    await waitFor(() => {
      expect(screen.getByText('Overall Compliance')).toBeInTheDocument();
    });
    expect(screen.getByText('Hosts Scanned')).toBeInTheDocument();
    expect(screen.getByText('Rules Evaluated')).toBeInTheDocument();
    expect(screen.getByText('Rules with Failures')).toBeInTheDocument();
  });

  it('displays the build remediation button', async () => {
    await renderResults();
    await waitFor(() => {
      expect(screen.getByText(/Build Remediation/)).toBeInTheDocument();
    });
  });

  it('displays finding table headers', async () => {
    await renderResults();
    await waitFor(() => {
      expect(screen.getByText('Rule ID')).toBeInTheDocument();
    });
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Hosts')).toBeInTheDocument();
    expect(screen.getByText('Pass Rate')).toBeInTheDocument();
    expect(screen.getByText('Severity')).toBeInTheDocument();
  });

  it('displays scan results title', async () => {
    await renderResults();
    await waitFor(() => {
      expect(screen.getByText('Assessment Results')).toBeInTheDocument();
    });
  });

  it('displays findings from mock data', async () => {
    await renderResults();
    await waitFor(() => {
      expect(screen.getByText('Set SSH Client Alive Interval')).toBeInTheDocument();
    });
    expect(screen.getByText('V-257844')).toBeInTheDocument();
    expect(screen.getByText('Set Password Minimum Length')).toBeInTheDocument();
    expect(screen.getByText('V-257856')).toBeInTheDocument();
  });

  it('calls getFindings with the jobId from route params', async () => {
    await renderResults();
    await waitFor(() => {
      expect(mockApi.getFindings).toHaveBeenCalledWith('42');
    });
  });

  it('shows empty state when there are no findings', async () => {
    jest.useFakeTimers();
    mockApi.getFindings.mockResolvedValue([]);
    await renderResults();
    // Advance past the polling retries
    for (let i = 0; i < 31; i++) {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    }
    await waitFor(() => {
      expect(screen.getByText('No scan results yet')).toBeInTheDocument();
    });
    jest.useRealTimers();
  });

  it('shows error state when API fails', async () => {
    mockApi.getFindings.mockRejectedValue(new Error('Connection refused'));
    await renderResults();
    await waitFor(() => {
      expect(screen.getByText(/Connection refused/)).toBeInTheDocument();
    });
  });
});
