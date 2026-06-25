import React, { useState, useEffect } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { Progress } from '@backstage/core-components';
import { Typography, Box } from '@material-ui/core';
import { complianceApiRef } from '../../api';
import type { ComplianceProfile, MultiHostFinding, TabConfig } from '@aap-compliance/common';
import { useDisplayConfig } from '../ResultsViewer/hooks/useDisplayConfig';
import {
  SummaryCardWidget,
  SeverityBreakdownWidget,
  FindingsTableWidget,
  TrendChartWidget,
  HostBreakdownWidget,
  GaugeWidget,
} from './widgets';

interface DynamicProfileTabProps {
  profile: ComplianceProfile;
  tabConfig: TabConfig;
}

export const DynamicProfileTab = ({ profile, tabConfig }: DynamicProfileTabProps) => {
  const api = useApi(complianceApiRef);
  const displayConfig = useDisplayConfig(profile.displayConfig);
  const [findings, setFindings] = useState<MultiHostFinding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api.getScans().then(scans => {
      if (cancelled) return;
      const profileScans = scans
        .filter(s => s.profileId === profile.id && s.status === 'completed')
        .sort((a, b) => new Date(b.completedAt ?? b.startedAt).getTime() - new Date(a.completedAt ?? a.startedAt).getTime());

      if (profileScans.length === 0) {
        setLoading(false);
        return;
      }

      const latestScan = profileScans[0];
      const jobId = String(latestScan.workflowJobId ?? latestScan.id);

      api.getFindings(jobId).then(f => {
        if (!cancelled) {
          setFindings(f);
          setLoading(false);
        }
      }).catch(() => {
        if (!cancelled) setLoading(false);
      });
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [api, profile.id]);

  if (loading) return <Progress />;

  if (findings.length === 0) {
    return (
      <Box p={4} textAlign="center">
        <Typography variant="h6" color="textSecondary">
          No scan data available for {profile.displayName}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Run a scan to populate this tab.
        </Typography>
      </Box>
    );
  }

  const layout = tabConfig.layout ?? [];

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        {tabConfig.label}
      </Typography>
      {layout.map((widgetConfig, index) => {
        const key = `${widgetConfig.widget}-${index}`;
        const props = {
          config: widgetConfig,
          findings,
          severityLabel: displayConfig.severityLabel,
        };

        switch (widgetConfig.widget) {
          case 'summary_card':
            return <SummaryCardWidget key={key} {...props} />;
          case 'severity_breakdown':
            return <SeverityBreakdownWidget key={key} {...props} />;
          case 'findings_table':
            return <FindingsTableWidget key={key} {...props} />;
          case 'trend_chart':
            return <TrendChartWidget key={key} {...props} />;
          case 'host_breakdown':
            return <HostBreakdownWidget key={key} {...props} />;
          case 'gauge':
            return <GaugeWidget key={key} {...props} />;
          default:
            return null;
        }
      })}
    </Box>
  );
};
