import React from 'react';
import {
  Typography,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  makeStyles,
} from '@material-ui/core';
import type { HostRiskEntry, TabWidget } from '@aap-compliance/common';
import { TABLE_STYLES } from '../shared/chipStyles';
import { STATUS_COLORS } from '../shared/colors';

const useStyles = makeStyles(theme => ({
  container: {
    marginBottom: theme.spacing(2),
  },
  riskScore: {
    fontWeight: 700,
    fontFamily: 'monospace',
    fontSize: '0.875rem',
  },
  barCell: {
    minWidth: 160,
  },
  barTrack: {
    display: 'flex',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: STATUS_COLORS.success,
  },
  segCritical: { backgroundColor: STATUS_COLORS.error },
  segMedium: { backgroundColor: STATUS_COLORS.warning },
  segLow: { backgroundColor: '#F4C145' },
}));

interface Props {
  config: TabWidget;
  tabData: { hostRisk: HostRiskEntry[]; summary: { totalPackages: number } } | null;
}

export const HostRiskHeatmapWidget = ({ config, tabData }: Props) => {
  const classes = useStyles();
  if (!tabData || tabData.hostRisk.length === 0) return null;

  const hosts = tabData.hostRisk;
  const colLabel = config.labels?.findings ?? 'Findings';
  const critLabel = config.labels?.critical ?? 'Critical';
  const medLabel = config.labels?.medium ?? 'Medium';
  const lowLabel = config.labels?.low ?? 'Low';
  const cleanLabel = config.labels?.clean ?? 'Clean';

  return (
    <Box className={classes.container}>
      {config.title && (
        <Typography variant="subtitle2" color="textSecondary" gutterBottom>
          {config.title}
        </Typography>
      )}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell style={TABLE_STYLES.header}>Host</TableCell>
              <TableCell style={TABLE_STYLES.header} align="right">Risk Score</TableCell>
              <TableCell style={TABLE_STYLES.header} align="right">{colLabel}</TableCell>
              <TableCell style={TABLE_STYLES.header} className={classes.barCell}>
                Vulnerable / Clean
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {hosts.map(h => {
              const denominator = h.scannedPackages > 0
                ? h.scannedPackages
                : Math.max(h.total, 1);
              const critPct = (h.critical / denominator) * 100;
              const medPct = (h.medium / denominator) * 100;
              const lowPct = (h.low / denominator) * 100;
              const cleanPct = Math.max(0, 100 - critPct - medPct - lowPct);
              const tooltipText = `${critLabel}: ${h.critical} · ${medLabel}: ${h.medium} · ${lowLabel}: ${h.low} · ${cleanLabel}: ${denominator - h.total}`;

              return (
                <TableRow key={h.hostname}>
                  <TableCell>{h.hostname}</TableCell>
                  <TableCell align="right">
                    <Typography
                      className={classes.riskScore}
                      style={{ color: h.score >= 50 ? STATUS_COLORS.error : h.score >= 20 ? STATUS_COLORS.warning : STATUS_COLORS.success }}
                    >
                      {h.score}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{h.total}</TableCell>
                  <TableCell className={classes.barCell}>
                    <Tooltip title={tooltipText} arrow>
                      <div className={classes.barTrack}>
                        {critPct > 0 && <div className={classes.segCritical} style={{ width: `${critPct}%` }} />}
                        {medPct > 0 && <div className={classes.segMedium} style={{ width: `${medPct}%` }} />}
                        {lowPct > 0 && <div className={classes.segLow} style={{ width: `${lowPct}%` }} />}
                      </div>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};
