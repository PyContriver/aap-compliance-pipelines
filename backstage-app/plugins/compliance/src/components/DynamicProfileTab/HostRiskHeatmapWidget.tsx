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
  LinearProgress,
  makeStyles,
} from '@material-ui/core';
import type { TabWidget } from '@aap-compliance/common';
import { TABLE_STYLES } from '../shared/chipStyles';

const useStyles = makeStyles(theme => ({
  container: {
    marginBottom: theme.spacing(2),
  },
  riskScore: {
    fontWeight: 700,
    fontFamily: 'monospace',
    fontSize: '0.875rem',
  },
  progressCell: {
    minWidth: 120,
  },
  progressBar: {
    height: 10,
    borderRadius: 5,
  },
  barRed: {
    backgroundColor: '#C9190B',
  },
  barTrack: {
    backgroundColor: '#3E8635',
    borderRadius: 5,
  },
}));

interface HostRiskEntry {
  hostname: string;
  critical: number;
  medium: number;
  low: number;
  total: number;
  score: number;
}

interface Props {
  config: TabWidget;
  tabData: { hostRisk: HostRiskEntry[]; summary: { totalPackages: number } } | null;
}

export const HostRiskHeatmapWidget = ({ config, tabData }: Props) => {
  const classes = useStyles();
  if (!tabData || tabData.hostRisk.length === 0) return null;

  const hosts = tabData.hostRisk;
  const totalPkgs = tabData.summary.totalPackages;
  const colLabel = config.labels?.findings ?? 'Findings';

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
              <TableCell style={TABLE_STYLES.header} className={classes.progressCell}>
                Vulnerable / Clean
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {hosts.map(h => {
              const denominator = totalPkgs > 0 ? totalPkgs : Math.max(h.total, 1);
              const vulnPct = Math.min((h.total / denominator) * 100, 100);
              return (
                <TableRow key={h.hostname}>
                  <TableCell>{h.hostname}</TableCell>
                  <TableCell align="right">
                    <Typography
                      className={classes.riskScore}
                      style={{ color: h.score >= 50 ? '#C9190B' : h.score >= 20 ? '#F0AB00' : '#3E8635' }}
                    >
                      {h.score}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{h.total}</TableCell>
                  <TableCell className={classes.progressCell}>
                    <LinearProgress
                      variant="determinate"
                      value={vulnPct}
                      className={classes.progressBar}
                      classes={{
                        barColorPrimary: classes.barRed,
                        colorPrimary: classes.barTrack,
                      }}
                    />
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
