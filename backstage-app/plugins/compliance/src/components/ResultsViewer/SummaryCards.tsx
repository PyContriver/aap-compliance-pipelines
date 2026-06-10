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
  baselineRate?: number;
  isBaselineView?: boolean;
}

const getColor = (rate: number) => rate >= 90 ? '#3E8635' : rate >= 70 ? '#F0AB00' : '#C9190B';

export const SummaryCards = ({
  overallPassRate,
  totalHosts,
  totalRules,
  rulesWithFailures,
  baselineRate,
  isBaselineView,
}: SummaryCardsProps) => {
  const classes = useStyles();

  const displayRate = isBaselineView && baselineRate !== undefined ? baselineRate : overallPassRate;

  return (
    <div className={classes.summarySection}>
      <InfoCard>
        <div className={classes.summaryCard}>
          <Typography className={classes.summaryValue} style={{ color: getColor(displayRate) }}>
            {displayRate}%
          </Typography>
          <Typography className={classes.summaryLabel}>
            {isBaselineView ? 'Baseline Compliance' : 'Overall Compliance'}
          </Typography>
          {baselineRate !== undefined && !isBaselineView && (
            <Typography variant="caption" style={{ display: 'block', marginTop: 4 }}>
              <span style={{ fontWeight: 600, color: getColor(overallPassRate) }}>Standard: {overallPassRate}%</span>
              {' / '}
              <span style={{ fontWeight: 600, color: getColor(baselineRate) }}>Baseline: {baselineRate}%</span>
            </Typography>
          )}
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
