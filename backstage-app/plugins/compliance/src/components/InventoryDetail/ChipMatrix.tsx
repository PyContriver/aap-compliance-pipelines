import React from 'react';
import { Typography, Chip, makeStyles } from '@material-ui/core';
import type { HostPosture } from '@aap-compliance/common';
import { isOutlier, getChipStyle } from './hostUtils';
import { STATUS_COLORS } from '../shared/colors';

const useStyles = makeStyles(theme => ({
  section: { marginBottom: theme.spacing(2) },
  sectionLabel: {
    display: 'flex', alignItems: 'center', gap: theme.spacing(1), marginBottom: theme.spacing(1),
  },
  grid: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  chip: {
    minWidth: 120, height: 48, borderRadius: 6, borderWidth: 2, cursor: 'pointer',
    transition: 'box-shadow 0.15s ease, transform 0.1s ease',
    '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.15)', transform: 'translateY(-1px)' },
  },
  chipLabel: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    lineHeight: 1.3, padding: '2px 4px',
  },
  hostname: { fontSize: '0.75rem', fontWeight: 600 },
  score: { fontSize: '0.7rem', fontWeight: 400 },
}));

interface ChipMatrixProps {
  hosts: HostPosture[];
  allHosts: HostPosture[];
  onHostClick: (host: HostPosture) => void;
}

export const ChipMatrix: React.FC<ChipMatrixProps> = ({ hosts, allHosts, onHostClick }) => {
  const classes = useStyles();
  const red = hosts.filter(h => isOutlier(h, allHosts)).sort((a, b) => a.compliancePct - b.compliancePct);
  const yellow = hosts.filter(h => !isOutlier(h, allHosts) && h.catIFail > 0).sort((a, b) => a.compliancePct - b.compliancePct);
  const green = hosts.filter(h => !isOutlier(h, allHosts) && h.catIFail === 0).sort((a, b) => a.compliancePct - b.compliancePct);

  const renderSection = (label: string, color: string, sectionHosts: HostPosture[]) => {
    if (sectionHosts.length === 0) return null;
    return (
      <div className={classes.section}>
        <div className={classes.sectionLabel}>
          <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
          <Typography variant="caption" style={{ fontWeight: 600, color }}>
            {label} ({sectionHosts.length})
          </Typography>
        </div>
        <div className={classes.grid}>
          {sectionHosts.map(host => {
            const style = getChipStyle(host, allHosts);
            return (
              <Chip key={host.hostname} className={classes.chip} variant="outlined"
                onClick={() => onHostClick(host)}
                style={{ borderColor: style.borderColor, backgroundColor: style.backgroundColor }}
                label={
                  <div className={classes.chipLabel}>
                    <span className={classes.hostname} style={{ color: style.color }}>{host.hostname}</span>
                    <span className={classes.score} style={{ color: style.color }}>
                      {host.compliancePct}% · {host.failCount} fail
                    </span>
                  </div>
                }
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        {hosts.length} hosts · {red.length} outlier{red.length !== 1 ? 's' : ''}
        {yellow.length > 0 ? ` · ${yellow.length} with CAT I` : ''}
        {` · ${green.length} compliant`}
      </Typography>
      {renderSection('Outliers', STATUS_COLORS.error, red)}
      {renderSection('CAT I Findings', STATUS_COLORS.warning, yellow)}
      {renderSection('Compliant', STATUS_COLORS.success, green)}
    </div>
  );
};
