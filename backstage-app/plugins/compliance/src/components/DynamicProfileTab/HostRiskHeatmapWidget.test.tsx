import React from 'react';
import { render, screen } from '@testing-library/react';
import { HostRiskHeatmapWidget } from './HostRiskHeatmapWidget';
import type { HostRiskEntry } from '@aap-compliance/common';

const host = (overrides: Partial<HostRiskEntry> = {}): HostRiskEntry => ({
  hostname: 'rhel01',
  critical: 5,
  medium: 10,
  low: 3,
  total: 18,
  score: 100,
  scannedPackages: 500,
  ...overrides,
});

describe('HostRiskHeatmapWidget', () => {
  it('renders nothing when hostRisk is empty', () => {
    const { container } = render(
      <HostRiskHeatmapWidget
        config={{ widget: 'host_risk_heatmap' }}
        tabData={{ hostRisk: [], summary: { totalPackages: 0 } }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders host rows with risk score', () => {
    render(
      <HostRiskHeatmapWidget
        config={{ widget: 'host_risk_heatmap', title: 'Host Risk' }}
        tabData={{ hostRisk: [host()], summary: { totalPackages: 500 } }}
      />,
    );
    expect(screen.getByText('rhel01')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('uses scannedPackages as denominator for bar widths', () => {
    const { container } = render(
      <HostRiskHeatmapWidget
        config={{ widget: 'host_risk_heatmap' }}
        tabData={{ hostRisk: [host({ scannedPackages: 1000, critical: 10, medium: 20, low: 5, total: 35 })], summary: { totalPackages: 1000 } }}
      />,
    );
    const segments = container.querySelectorAll('[class*="seg"]');
    expect(segments.length).toBe(3);
  });

  it('falls back to total when scannedPackages is 0', () => {
    render(
      <HostRiskHeatmapWidget
        config={{ widget: 'host_risk_heatmap' }}
        tabData={{ hostRisk: [host({ scannedPackages: 0, total: 20 })], summary: { totalPackages: 0 } }}
      />,
    );
    expect(screen.getByText('rhel01')).toBeInTheDocument();
  });

  it('uses custom labels from config', () => {
    render(
      <HostRiskHeatmapWidget
        config={{ widget: 'host_risk_heatmap', labels: { findings: 'Vulnerabilities' } }}
        tabData={{ hostRisk: [host()], summary: { totalPackages: 500 } }}
      />,
    );
    expect(screen.getByText('Vulnerabilities')).toBeInTheDocument();
  });
});
