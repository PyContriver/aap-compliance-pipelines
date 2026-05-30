import React from 'react';
import { InfoCard } from '@backstage/core-components';
import { Typography, makeStyles } from '@material-ui/core';

const useStyles = makeStyles(theme => ({
  summarySection: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  summaryCard: {
    flex: '1 1 200px',
    textAlign: 'center',
    padding: theme.spacing(2),
  },
  summaryValue: {
    fontSize: '2rem',
    fontWeight: 700,
  },
  summaryLabel: {
    color: theme.palette.text.secondary,
    fontSize: '0.8rem',
  },
}));

interface SummaryCardsProps {
  overallPassRate: number;
  totalHosts: number;
  totalRules: number;
  rulesWithFailures: number;
}

export const SummaryCards = ({
  overallPassRate,
  totalHosts,
  totalRules,
  rulesWithFailures,
}: SummaryCardsProps) => {
  const classes = useStyles();

  return (
    <div className={classes.summarySection}>
      <InfoCard>
        <div className={classes.summaryCard}>
          <Typography className={classes.summaryValue} style={{ color: overallPassRate >= 80 ? '#3E8635' : '#C9190B' }}>
            {overallPassRate}%
          </Typography>
          <Typography className={classes.summaryLabel}>Overall Compliance</Typography>
        </div>
      </InfoCard>
      <InfoCard>
        <div className={classes.summaryCard}>
          <Typography className={classes.summaryValue}>{totalHosts}</Typography>
          <Typography className={classes.summaryLabel}>Hosts Scanned</Typography>
        </div>
      </InfoCard>
      <InfoCard>
        <div className={classes.summaryCard}>
          <Typography className={classes.summaryValue}>{totalRules}</Typography>
          <Typography className={classes.summaryLabel}>Rules Evaluated</Typography>
        </div>
      </InfoCard>
      <InfoCard>
        <div className={classes.summaryCard}>
          <Typography className={classes.summaryValue} style={{ color: '#C9190B' }}>
            {rulesWithFailures}
          </Typography>
          <Typography className={classes.summaryLabel}>Rules with Failures</Typography>
        </div>
      </InfoCard>
    </div>
  );
};
