import React, { useState, useEffect } from 'react';
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
import type { DashboardStats } from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  row: {
    cursor: 'pointer',
    '&:hover': { backgroundColor: theme.palette.action.hover },
  },
  profileChip: {
    fontSize: '0.7rem',
    height: 22,
    marginRight: 4,
  },
  baselineChip: {
    fontSize: '0.65rem',
    height: 18,
    backgroundColor: '#E7F1FA',
    color: '#0066CC',
  },
  scoreBar: {
    height: 6,
    borderRadius: 3,
    width: 80,
    display: 'inline-block',
    marginRight: 8,
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
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) return <LinearProgress />;

  const inventories = stats?.byInventory ?? [];

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
    <InfoCard title="Inventories" subheader={`${inventories.length} inventories with compliance data`}>
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
                  <Typography variant="body2" style={{ fontWeight: 600 }}>
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
                        style={{
                          backgroundColor: '#e0e0e0',
                        }}
                      />
                      <Typography variant="caption" style={{
                        fontWeight: 600,
                        color: ps.rate >= 90 ? '#3E8635' : ps.rate >= 70 ? '#F0AB00' : '#C9190B',
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
