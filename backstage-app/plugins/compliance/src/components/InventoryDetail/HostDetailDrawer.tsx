import React from 'react';
import {
  Typography,
  Chip,
  Card,
  Drawer,
  IconButton,
  Divider,
  makeStyles,
} from '@material-ui/core';
import CloseIcon from '@material-ui/icons/Close';
import WarningIcon from '@material-ui/icons/Warning';
import type { HostPosture } from '@aap-compliance/common';
import { isOutlier } from './hostUtils';
import { scoreColor, SEVERITY_COLORS, STATUS_COLORS } from '../shared/colors';

const useStyles = makeStyles(theme => ({
  drawer: { width: 420, padding: theme.spacing(3) },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
  findingRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: theme.spacing(1, 0),
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:last-child': { borderBottom: 'none' },
  },
  findingTitle: { fontSize: '0.8rem', maxWidth: 280 },
  severityChip: { fontSize: '0.65rem', height: 20 },
}));

interface HostDetailDrawerProps {
  host: HostPosture;
  allHosts: HostPosture[];
  onClose: () => void;
}

export const HostDetailDrawer: React.FC<HostDetailDrawerProps> = ({ host, allHosts, onClose }) => {
  const classes = useStyles();
  const mean = allHosts.reduce((a, h) => a + h.compliancePct, 0) / allHosts.length;

  return (
    <Drawer anchor="right" open onClose={onClose}>
      <div className={classes.drawer}>
        <div className={classes.header}>
          <div>
            <Typography variant="h6" style={{ fontFamily: 'monospace' }}>{host.hostname}</Typography>
            {host.os && <Typography variant="body2" color="textSecondary">{host.os}</Typography>}
          </div>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <Card variant="outlined" style={{ flex: 1, padding: 12, textAlign: 'center' }}>
            <Typography variant="h5" style={{ fontWeight: 700, color: scoreColor(host.compliancePct) }}>
              {host.compliancePct}%
            </Typography>
            <Typography variant="caption" color="textSecondary">Compliance</Typography>
          </Card>
          <Card variant="outlined" style={{ flex: 1, padding: 12, textAlign: 'center' }}>
            <Typography variant="h5" style={{ fontWeight: 700 }}>{host.failCount}</Typography>
            <Typography variant="caption" color="textSecondary">Failing Rules</Typography>
          </Card>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {host.catIFail > 0 && (
            <Chip size="small" label={`${host.catIFail} CAT I`}
              style={{ backgroundColor: SEVERITY_COLORS.CAT_I, color: '#fff', fontWeight: 600, fontSize: '0.75rem' }} />
          )}
          <Chip size="small" label={`${host.catIIFail} CAT II`}
            style={{ backgroundColor: SEVERITY_COLORS.CAT_II, color: '#fff', fontWeight: 600, fontSize: '0.75rem' }} />
          <Chip size="small" label={`${host.catIIIFail} CAT III`}
            style={{ backgroundColor: SEVERITY_COLORS.CAT_III, color: '#fff', fontWeight: 600, fontSize: '0.75rem' }} />
        </div>

        {host.naCount > 0 && (
          <Typography variant="caption" color="textSecondary" style={{ display: 'block', marginBottom: 12 }}>
            {host.naCount} rules not applicable
          </Typography>
        )}

        {isOutlier(host, allHosts) && (
          <Card variant="outlined" style={{ padding: 12, marginBottom: 16, borderColor: STATUS_COLORS.error, backgroundColor: 'rgba(201,25,11,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarningIcon style={{ color: STATUS_COLORS.error, fontSize: 20 }} />
              <div>
                <Typography variant="body2" style={{ fontWeight: 600, color: STATUS_COLORS.error }}>Outlier Host</Typography>
                <Typography variant="caption" color="textSecondary">
                  Deviates significantly from the inventory average ({mean.toFixed(1)}%).
                </Typography>
              </div>
            </div>
          </Card>
        )}

        <Divider style={{ margin: '8px 0 16px' }} />

        <Typography variant="subtitle2" gutterBottom>
          Summary
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {host.passCount} rules passing · {host.failCount} rules failing
          {host.naCount > 0 ? ` · ${host.naCount} not applicable` : ''}
        </Typography>
        <Typography variant="body2" color="primary" style={{ marginTop: 12, cursor: 'pointer' }}>
          View detailed findings for {host.hostname} →
        </Typography>
      </div>
    </Drawer>
  );
};
