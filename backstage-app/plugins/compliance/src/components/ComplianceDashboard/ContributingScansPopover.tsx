import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Popover, Typography, List, ListItem, ListItemText, Divider, makeStyles,
} from '@material-ui/core';
import type { ContributingScan } from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  content: {
    padding: theme.spacing(1, 0),
    minWidth: 320,
    maxWidth: 420,
  },
  header: {
    padding: theme.spacing(1, 2),
    fontWeight: 600,
  },
  listItem: {
    cursor: 'pointer',
    '&:hover': { backgroundColor: theme.palette.action.hover },
  },
  passRate: {
    fontWeight: 600,
  },
}));

const getColor = (rate: number): string => {
  if (rate >= 90) return '#3E8635';
  if (rate >= 75) return '#F0AB00';
  if (rate >= 50) return '#EC7A08';
  return '#C9190B';
};

interface ContributingScansPopoverProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  profileName: string;
  scans: ContributingScan[];
}

export const ContributingScansPopover: React.FC<ContributingScansPopoverProps> = ({
  anchorEl,
  onClose,
  profileName,
  scans,
}) => {
  const classes = useStyles();
  const navigate = useNavigate();

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <div className={classes.content}>
        <Typography className={classes.header}>
          {profileName} — Contributing Scans
        </Typography>
        <Divider />
        <List dense disablePadding>
          {scans.map(scan => (
            <ListItem
              key={scan.scanId}
              className={classes.listItem}
              onClick={() => { onClose(); navigate(`/compliance/results/${scan.scanId}`); }}
            >
              <ListItemText
                primary={scan.inventoryName}
                secondary={`${scan.passCount}/${scan.passCount + scan.failCount} rules · ${new Date(scan.timestamp).toLocaleDateString()}`}
              />
              <Typography
                className={classes.passRate}
                style={{ color: getColor(scan.passRate) }}
              >
                {scan.passRate}%
              </Typography>
            </ListItem>
          ))}
          {scans.length === 0 && (
            <ListItem>
              <ListItemText primary="No scans found" secondary="Run a scan with this profile to see results here." />
            </ListItem>
          )}
        </List>
      </div>
    </Popover>
  );
};
