import React from 'react';
import { Card, Typography, makeStyles } from '@material-ui/core';
import type { InventoryPosture } from '@aap-compliance/common';
import { ComplianceGauge } from './ComplianceGauge';

const useStyles = makeStyles(theme => ({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 0),
  },
  card: {
    padding: theme.spacing(2),
  },
  inventoryName: {
    fontWeight: 600,
    marginBottom: theme.spacing(1),
  },
  gaugeRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    gap: theme.spacing(1),
  },
  gaugeSlot: {
    width: 100,
  },
}));

interface InventoryPostureViewProps {
  byInventory: InventoryPosture[];
}

export const InventoryPostureView: React.FC<InventoryPostureViewProps> = ({ byInventory }) => {
  const classes = useStyles();

  if (byInventory.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary" style={{ textAlign: 'center', padding: 24 }}>
        No inventory-level posture data available. Run scans to see per-inventory scores.
      </Typography>
    );
  }

  return (
    <div className={classes.grid}>
      {byInventory.map(inv => (
        <Card key={inv.inventoryId} variant="outlined" className={classes.card}>
          <Typography className={classes.inventoryName}>{inv.inventoryName}</Typography>
          <div className={classes.gaugeRow}>
            {inv.profileScores.map(ps => (
              <div key={ps.profileId} className={classes.gaugeSlot}>
                <ComplianceGauge
                  value={ps.rate}
                  label={ps.name}
                  subtitle={`${ps.passCount}/${ps.passCount + ps.failCount}`}
                />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
};
