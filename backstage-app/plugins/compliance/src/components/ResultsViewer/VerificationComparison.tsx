import React from 'react';
import { InfoCard } from '@backstage/core-components';
import { Typography, makeStyles } from '@material-ui/core';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';
import TrendingUpIcon from '@material-ui/icons/TrendingUp';
import TrendingDownIcon from '@material-ui/icons/TrendingDown';
import RemoveIcon from '@material-ui/icons/Remove';
import { ComplianceGauge } from '../ComplianceDashboard/ComplianceGauge';

const useStyles = makeStyles(theme => ({
  comparisonHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(4),
    padding: theme.spacing(3),
  },
  comparisonArrow: {
    display: 'flex',
    alignItems: 'center',
    color: theme.palette.text.secondary,
    fontSize: '2rem',
  },
  comparisonGauge: {
    textAlign: 'center' as const,
    minWidth: 140,
  },
  deltaStats: {
    display: 'flex',
    justifyContent: 'center',
    gap: theme.spacing(4),
    padding: theme.spacing(1, 3, 2, 3),
    flexWrap: 'wrap' as const,
  },
  deltaStat: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: '0.9rem',
  },
  deltaPositive: {
    color: '#3E8635',
    fontWeight: 600,
  },
  deltaNegative: {
    color: '#C9190B',
    fontWeight: 600,
  },
  deltaUnchanged: {
    color: theme.palette.text.secondary,
    fontWeight: 500,
  },
}));

interface VerificationComparisonProps {
  previousPassRate: number;
  overallPassRate: number;
  totalHosts: number;
  totalRules: number;
  comparisonStats: { improved: number; regressed: number; unchanged: number };
}

export const VerificationComparison = ({
  previousPassRate,
  overallPassRate,
  totalHosts,
  totalRules,
  comparisonStats,
}: VerificationComparisonProps) => {
  const classes = useStyles();

  return (
    <InfoCard title="Verification Results">
      <div className={classes.comparisonHeader}>
        <div className={classes.comparisonGauge}>
          <ComplianceGauge value={previousPassRate} label="Before" />
        </div>
        <div className={classes.comparisonArrow}>
          <ArrowForwardIcon fontSize="large" />
        </div>
        <div className={classes.comparisonGauge}>
          <ComplianceGauge value={overallPassRate} label="After" />
        </div>
      </div>
      <div className={classes.deltaStats}>
        <div className={classes.deltaStat}>
          <Typography variant="body2" color="textSecondary">Hosts Scanned:</Typography>
          <Typography variant="body2" style={{ fontWeight: 600 }}>{totalHosts}</Typography>
        </div>
        <div className={classes.deltaStat}>
          <Typography variant="body2" color="textSecondary">Rules:</Typography>
          <Typography variant="body2" style={{ fontWeight: 600 }}>{totalRules}</Typography>
        </div>
        <div className={classes.deltaStat}>
          <TrendingUpIcon fontSize="small" style={{ color: '#3E8635' }} />
          <Typography variant="body2" className={classes.deltaPositive}>
            {comparisonStats.improved} Improved
          </Typography>
        </div>
        {comparisonStats.regressed > 0 && (
          <div className={classes.deltaStat}>
            <TrendingDownIcon fontSize="small" style={{ color: '#C9190B' }} />
            <Typography variant="body2" className={classes.deltaNegative}>
              {comparisonStats.regressed} Regressed
            </Typography>
          </div>
        )}
        <div className={classes.deltaStat}>
          <RemoveIcon fontSize="small" style={{ color: '#6A6E73' }} />
          <Typography variant="body2" className={classes.deltaUnchanged}>
            {comparisonStats.unchanged} Unchanged
          </Typography>
        </div>
      </div>
    </InfoCard>
  );
};
