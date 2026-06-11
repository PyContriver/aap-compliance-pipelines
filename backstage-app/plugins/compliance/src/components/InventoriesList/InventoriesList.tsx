import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { InfoCard } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import {
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  LinearProgress,
  makeStyles,
} from '@material-ui/core';
import BookmarkIcon from '@material-ui/icons/Bookmark';

import { complianceApiRef } from '../../api';
import { scoreColor } from '../shared/colors';
import type { DashboardStats } from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  row: {
    cursor: 'pointer',
    '&:hover': { backgroundColor: theme.palette.action.hover },
  },
  profileChip: {
    fontSize: '0.75rem',
    height: 22,
    marginRight: 4,
  },
  baselineChip: {
    fontSize: '0.65rem',
    height: 18,
    backgroundColor: 'rgba(0, 102, 204, 0.08)',
    color: '#0066CC',
  },
  scoreBar: {
    height: 6,
    borderRadius: 3,
    width: 80,
    display: 'inline-block',
    marginRight: 8,
    backgroundColor: theme.palette.divider,
  },
  scoreCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  empty: {
    textAlign: 'center',
    padding: theme.spacing(6),
    color: theme.palette.text.secondary,
  },
}));

export const InventoriesList: React.FC = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardStats()
      .then(setStats)
      .catch(err => { console.error('Failed to load inventories:', err); })
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) return <LinearProgress />;

  const inventories = useMemo(() => stats?.byInventory ?? [], [stats]);

  if (inventories.length === 0) {
    return (
      <InfoCard title="Inventories">
        <div className={classes.empty}>
          <Typography variant="body1" gutterBottom>No inventories with scan data</Typography>
          <Typography variant="body2">
            Run a compliance scan against an inventory to see it here.
          </Typography>
        </div>
      </InfoCard>
    );
  }

  return (
    <InfoCard title="Inventories">
      <Typography variant="body2" color="textSecondary" style={{ marginBottom: 16 }}>
        {inventories.length} inventories with compliance data. Click an inventory to see per-host compliance.
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Inventory</TableCell>
            <TableCell>Scanned Against</TableCell>
            <TableCell>Baseline</TableCell>
            <TableCell>Compliance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {inventories.map(inv => {
            const worstScore = inv.profileScores.length > 0
              ? Math.min(...inv.profileScores.map(ps => ps.rate))
              : null;
            const hasBaseline = inv.profileScores.some(ps => ps.baseline);

            return (
              <TableRow
                key={inv.inventoryId}
                className={classes.row}
                onClick={() => navigate(`/compliance/inventories/${inv.inventoryId}`)}
              >
                <TableCell>
                  <Typography variant="body2" style={{ fontWeight: 500 }}>
                    {inv.inventoryName}
                  </Typography>
                </TableCell>
                <TableCell>
                  {inv.profileScores.map(ps => (
                    <Chip key={ps.profileId} label={ps.name} size="small" variant="outlined" className={classes.profileChip} />
                  ))}
                </TableCell>
                <TableCell>
                  {hasBaseline ? (
                    inv.profileScores
                      .filter(ps => ps.baseline)
                      .map(ps => (
                        <Chip
                          key={ps.profileId}
                          icon={<BookmarkIcon style={{ fontSize: 14 }} />}
                          label={ps.baseline!.remediationProfileName}
                          size="small"
                          className={classes.baselineChip}
                        />
                      ))
                  ) : (
                    <Typography variant="caption" color="textSecondary">—</Typography>
                  )}
                </TableCell>
                <TableCell>
                  {inv.profileScores.map(ps => (
                    <div key={ps.profileId} className={classes.scoreCell} style={{ marginBottom: 2 }}>
                      <LinearProgress
                        variant="determinate"
                        value={ps.rate}
                        className={classes.scoreBar}
                      />
                      <Typography variant="caption" style={{
                        fontWeight: 600,
                        color: scoreColor(ps.rate),
                      }}>
                        {ps.rate}%
                      </Typography>
                      <Typography variant="caption" color="textSecondary" style={{ fontSize: '0.65rem' }}>
                        {ps.name}
                      </Typography>
                    </div>
                  ))}
                  {inv.profileScores.length === 0 && (
                    <Typography variant="caption" color="textSecondary">No scans</Typography>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </InfoCard>
  );
};
