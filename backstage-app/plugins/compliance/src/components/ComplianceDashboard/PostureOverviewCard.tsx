import React from 'react';
import { Typography, makeStyles } from '@material-ui/core';
import type { ProfilePostureStatus } from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: theme.spacing(2),
    width: '100%',
  },
  headline: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: theme.palette.text.primary,
    marginBottom: theme.spacing(1.5),
  },
  profileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0),
    width: '100%',
    maxWidth: 260,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  profileName: {
    flex: 1,
    fontSize: '0.8rem',
    color: theme.palette.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  profileRate: {
    fontSize: '0.8rem',
    fontWeight: 600,
    flexShrink: 0,
  },
}));

const getStatusColor = (rate: number): string => {
  if (rate >= 90) return '#3E8635';
  if (rate >= 75) return '#F0AB00';
  if (rate >= 50) return '#EC7A08';
  return '#C9190B';
};

interface PostureOverviewCardProps {
  postureStatus: ProfilePostureStatus[];
  targetThreshold?: number;
}

export const PostureOverviewCard: React.FC<PostureOverviewCardProps> = ({
  postureStatus,
  targetThreshold = 80,
}) => {
  const classes = useStyles();
  const aboveCount = postureStatus.filter(p => p.rate >= targetThreshold).length;

  return (
    <div className={classes.root}>
      <Typography className={classes.headline}>
        {aboveCount} of {postureStatus.length}
      </Typography>
      <Typography variant="caption" color="textSecondary" style={{ marginBottom: 12 }}>
        profiles above {targetThreshold}% target
      </Typography>
      {postureStatus.map(p => (
        <div key={p.profileId} className={classes.profileRow}>
          <div className={classes.dot} style={{ backgroundColor: getStatusColor(p.rate) }} />
          <Typography className={classes.profileName} title={p.name}>{p.name}</Typography>
          <Typography className={classes.profileRate} style={{ color: getStatusColor(p.rate) }}>
            {Math.round(p.rate * 10) / 10}%
          </Typography>
        </div>
      ))}
    </div>
  );
};
