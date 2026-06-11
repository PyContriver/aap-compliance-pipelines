import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { InfoCard } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import {
  Typography,
  LinearProgress,
  Card,
  Chip,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tooltip,
  makeStyles,
} from '@material-ui/core';
import AssessmentIcon from '@material-ui/icons/Assessment';
import type { DashboardStats, HostPostureResponse } from '@aap-compliance/common';
import { complianceApiRef } from '../../api';
import { HostPostureView } from './HostPostureView';
import { isOutlier } from './hostUtils';
import { STATUS_COLORS } from '../shared/colors';

const useStyles = makeStyles(theme => ({
  summaryRow: {
    display: 'flex', gap: theme.spacing(2), marginBottom: theme.spacing(2), flexWrap: 'wrap' as const,
  },
  summaryCard: {
    padding: theme.spacing(1.5, 2), textAlign: 'center' as const, minWidth: 90, flex: '1 1 90px',
  },
  summaryValue: { fontSize: '1.5rem', fontWeight: 700 },
  summaryLabel: { fontSize: '0.75rem', color: theme.palette.text.secondary },
  osChip: {
    cursor: 'pointer', marginTop: 4,
    transition: 'box-shadow 0.15s ease',
    '&:hover': { boxShadow: '0 1px 4px rgba(0,0,0,0.15)' },
  },
  osChipActive: {
    backgroundColor: `${theme.palette.primary.main} !important`,
    color: '#fff !important',
  },
  legend: {
    display: 'flex', gap: theme.spacing(2), marginBottom: theme.spacing(1.5), flexWrap: 'wrap' as const,
  },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: theme.palette.text.secondary,
  },
  legendDot: { width: 12, height: 12, borderRadius: '50%', border: '2px solid' },
  controls: {
    display: 'flex', alignItems: 'center', gap: theme.spacing(2), marginBottom: theme.spacing(1),
  },
  profileSelect: { minWidth: 200 },
  empty: {
    textAlign: 'center' as const, padding: theme.spacing(6), color: theme.palette.text.secondary,
  },
}));

export const InventoryDetail: React.FC = () => {
  const classes = useStyles();
  const { inventoryId } = useParams<{ inventoryId: string }>();
  const api = useApi(complianceApiRef);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [hostData, setHostData] = useState<HostPostureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [osFilter, setOsFilter] = useState<string | null>(null);

  const invId = Number(inventoryId);

  const inventory = useMemo(
    () => stats?.byInventory.find(inv => inv.inventoryId === invId),
    [stats, invId],
  );

  const profileOptions = useMemo(
    () => inventory?.profileScores.map(ps => ({ value: ps.profileId, label: ps.name })) ?? [],
    [inventory],
  );

  const selectedProfileName = useMemo(
    () => profileOptions.find(p => p.value === selectedProfileId)?.label ?? '',
    [profileOptions, selectedProfileId],
  );

  useEffect(() => {
    api.getDashboardStats().then(s => {
      setStats(s);
      const inv = s.byInventory.find(i => i.inventoryId === invId);
      if (inv?.profileScores.length) {
        setSelectedProfileId(inv.profileScores[0].profileId);
      }
    }).catch(err => { console.error('Failed to load dashboard stats:', err); }).finally(() => setLoading(false));
  }, [api, invId]);

  useEffect(() => {
    if (!selectedProfileId || !invId) return;
    setLoading(true);
    api.getHostPosture(invId, selectedProfileId)
      .then(setHostData)
      .catch(err => { console.error('Failed to load host posture:', err); setHostData(null); })
      .finally(() => setLoading(false));
  }, [api, invId, selectedProfileId]);

  const hosts = hostData?.hosts ?? [];
  const filteredHosts = useMemo(
    () => osFilter ? hosts.filter(h => h.os === osFilter) : hosts,
    [hosts, osFilter],
  );

  const outlierCount = filteredHosts.filter(h => isOutlier(h, filteredHosts)).length;
  const totalPass = filteredHosts.reduce((a, h) => a + h.passCount, 0);
  const totalApplicable = filteredHosts.reduce((a, h) => a + h.passCount + h.failCount, 0);
  const overallCompliance = totalApplicable > 0 ? Math.round(totalPass / totalApplicable * 1000) / 10 : 0;

  const osCounts = new Map<string, number>();
  for (const h of hosts) if (h.os) osCounts.set(h.os, (osCounts.get(h.os) || 0) + 1);
  const osEntries = [...osCounts.entries()].sort((a, b) => b[1] - a[1]);

  if (loading && !stats) return <LinearProgress />;

  return (
    <InfoCard
      title={inventory?.inventoryName ?? `Inventory ${inventoryId}`}
      subheader={
        hostData ? `Last scanned ${new Date(hostData.scanTimestamp).toLocaleString()}` : undefined
      }
    >
      {loading && <LinearProgress />}

      {hosts.length === 0 && !loading ? (
        <div className={classes.empty}>
          <AssessmentIcon style={{ fontSize: 64, color: STATUS_COLORS.neutral, marginBottom: 16 }} />
          <Typography variant="h6" color="textSecondary" gutterBottom>
            {hostData?.scanTimestamp ? 'Scan completed but no findings recorded' : 'No scan data for this profile'}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {hostData?.scanTimestamp
              ? 'The scan completed but produced no host-level findings. This may indicate a scanner configuration issue.'
              : `Run a compliance scan against this inventory with the "${selectedProfileName || 'selected'}" profile to see per-host results.`}
          </Typography>
        </div>
      ) : (
        <>
          {/* Profile selector */}
          {profileOptions.length > 1 && (
            <div className={classes.controls}>
              <FormControl variant="outlined" size="small" className={classes.profileSelect}>
                <InputLabel id="inv-profile-label">Compliance Profile</InputLabel>
                <Select labelId="inv-profile-label" value={selectedProfileId}
                  onChange={e => { setSelectedProfileId(e.target.value as string); setOsFilter(null); }}
                  label="Compliance Profile"
                >
                  {profileOptions.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>
          )}

          {/* Summary row */}
          <div className={classes.summaryRow}>
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryValue}>
                {osFilter ? `${filteredHosts.length}/${hosts.length}` : hosts.length}
              </Typography>
              <Typography className={classes.summaryLabel}>
                {osFilter ? 'Filtered / Total' : 'Total Hosts'}
              </Typography>
            </Card>
            {osEntries.length > 0 && (
              <Card variant="outlined" className={classes.summaryCard}>
                <Typography className={classes.summaryLabel} style={{ marginBottom: 4 }}>Operating Systems</Typography>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                  {osEntries.map(([os, count]) => (
                    <Tooltip key={os} title={osFilter === os ? 'Click to clear filter' : `Filter to ${os} only`} arrow>
                      <Chip size="small" label={`${os} (${count})`}
                        className={`${classes.osChip} ${osFilter === os ? classes.osChipActive : ''}`}
                        variant={osFilter === os ? 'default' : 'outlined'}
                        onClick={() => setOsFilter(prev => prev === os ? null : os)}
                      />
                    </Tooltip>
                  ))}
                </div>
              </Card>
            )}
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryValue} style={{ color: STATUS_COLORS.success }}>
                {filteredHosts.length - outlierCount}
              </Typography>
              <Typography className={classes.summaryLabel}>Compliant</Typography>
            </Card>
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryValue} style={{ color: STATUS_COLORS.error }}>
                {outlierCount}
              </Typography>
              <Typography className={classes.summaryLabel}>Outliers</Typography>
            </Card>
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryValue}>{overallCompliance}%</Typography>
              <Typography className={classes.summaryLabel}>Overall Compliance</Typography>
            </Card>
          </div>

          {/* Legend */}
          <div className={classes.legend}>
            <div className={classes.legendItem}>
              <div className={classes.legendDot} style={{ borderColor: STATUS_COLORS.success, backgroundColor: 'rgba(62,134,53,0.08)' }} />
              Compliant
            </div>
            <div className={classes.legendItem}>
              <div className={classes.legendDot} style={{ borderColor: STATUS_COLORS.warning, backgroundColor: 'rgba(240,171,0,0.08)' }} />
              CAT I findings
            </div>
            <div className={classes.legendItem}>
              <div className={classes.legendDot} style={{ borderColor: STATUS_COLORS.error, backgroundColor: 'rgba(201,25,11,0.08)' }} />
              Outlier
            </div>
          </div>

          <Divider style={{ margin: '12px 0 16px' }} />

          {/* Host posture visualization */}
          <HostPostureView
            hosts={hosts}
            osFilter={osFilter}
            profileLabel={selectedProfileName}
          />
        </>
      )}
    </InfoCard>
  );
};
