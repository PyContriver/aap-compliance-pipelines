import React from 'react';
import {
  Typography,
  Chip,
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  LinearProgress,
  IconButton,
  Collapse,
  Tooltip,
  makeStyles,
} from '@material-ui/core';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import ErrorIcon from '@material-ui/icons/Error';
import type { FindingSeverity, FindingState, MultiHostFinding } from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  severityChip: {
    fontWeight: 600,
    minWidth: 60,
  },
  catI: { backgroundColor: '#C9190B', color: '#fff' },
  catII: { backgroundColor: '#F0AB00', color: '#fff' },
  catIII: { backgroundColor: '#0066CC', color: '#fff' },
  passBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e0e0e0',
  },
  findingRow: {
    cursor: 'pointer',
    '&:hover': { backgroundColor: theme.palette.action.hover },
  },
  hostDetailRow: {
    backgroundColor: theme.palette.background.default,
  },
  hostStatusPass: {
    color: '#3E8635',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  hostStatusFail: {
    color: '#C9190B',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  hostCountChip: {
    fontWeight: 600,
    fontSize: '0.8rem',
  },
  expandedSection: {
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  ruleDescription: {
    padding: theme.spacing(1.5, 2),
    backgroundColor: theme.palette.background.default,
    borderTop: `1px solid ${theme.palette.divider}`,
  },
}));

const severityLabel: Record<FindingSeverity, string> = {
  CAT_I: 'CAT I',
  CAT_II: 'CAT II',
  CAT_III: 'CAT III',
};

const stateConfig: Record<FindingState, { label: string; tooltip: string; color: string; bgColor: string; variant: 'default' | 'outlined' }> = {
  new: { label: 'New', tooltip: 'First time this rule is failing on this host', color: '#0066CC', bgColor: 'transparent', variant: 'outlined' },
  active: { label: 'Active', tooltip: 'Still failing from a previous scan', color: '#6A6E73', bgColor: 'transparent', variant: 'outlined' },
  fixed: { label: 'Fixed', tooltip: 'Was failing, now passing after remediation', color: '#fff', bgColor: '#3E8635', variant: 'default' },
  resurfaced: { label: 'Resurfaced', tooltip: 'Regression after remediation — was fixed, now failing again', color: '#C9190B', bgColor: 'transparent', variant: 'outlined' },
};

interface FindingRowProps {
  finding: MultiHostFinding;
  expanded: boolean;
  onToggle: () => void;
}

export const FindingRow = ({ finding, expanded, onToggle }: FindingRowProps) => {
  const classes = useStyles();

  const getSeverityClass = (severity: FindingSeverity) => {
    switch (severity) {
      case 'CAT_I': return classes.catI;
      case 'CAT_II': return classes.catII;
      case 'CAT_III': return classes.catIII;
      default: return '';
    }
  };

  const passRate = finding.totalCount > 0
    ? Math.round((finding.passCount / finding.totalCount) * 100)
    : 0;

  // Determine dominant state for the rule (priority: resurfaced > new > fixed > active)
  const dominantState: FindingState | null = finding.stateSummary
    ? finding.stateSummary.resurfaced > 0 ? 'resurfaced'
      : finding.stateSummary.new > 0 ? 'new'
      : finding.stateSummary.fixed > 0 ? 'fixed'
      : finding.stateSummary.active > 0 ? 'active'
      : null
    : null;

  return (
    <React.Fragment>
      <TableRow className={classes.findingRow} onClick={onToggle}>
        <TableCell>
          <IconButton
            size="small"
            aria-label={expanded ? `Collapse rule details for ${finding.stigId}` : `Expand rule details for ${finding.stigId}`}
          >
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Box display="flex" alignItems="center" style={{ gap: 4 }}>
            <Chip
              label={severityLabel[finding.severity]}
              size="small"
              className={`${classes.severityChip} ${getSeverityClass(finding.severity)}`}
            />
            {dominantState && dominantState !== 'active' && (
              <Tooltip title={stateConfig[dominantState].tooltip} arrow>
                <Chip
                  label={stateConfig[dominantState].label}
                  size="small"
                  variant={stateConfig[dominantState].variant}
                  style={{
                    color: stateConfig[dominantState].color,
                    backgroundColor: stateConfig[dominantState].bgColor,
                    borderColor: stateConfig[dominantState].variant === 'outlined' ? stateConfig[dominantState].color : undefined,
                    fontWeight: 600,
                    fontSize: '0.7rem',
                  }}
                />
              </Tooltip>
            )}
          </Box>
        </TableCell>
        <TableCell>
          <Typography variant="body2">{finding.title}</Typography>
          {finding.disruption === 'high' && (
            <Chip label="High disruption" size="small" color="secondary" style={{ marginTop: 4 }} />
          )}
        </TableCell>
        <TableCell>
          <Typography variant="body2" style={{ fontFamily: 'monospace' }}>
            {finding.stigId || finding.ruleId}
          </Typography>
        </TableCell>
        <TableCell align="center">
          {finding.failCount === 0 && finding.passCount > 0 ? (
            <Chip
              label={`${finding.passCount}/${finding.totalCount}`}
              size="small"
              style={{ backgroundColor: '#3E8635', color: '#fff' }}
              className={classes.hostCountChip}
            />
          ) : finding.failCount === 0 && finding.passCount === 0 ? (
            <Chip
              label={`${finding.totalCount} N/A`}
              size="small"
              variant="outlined"
              className={classes.hostCountChip}
            />
          ) : (
            <Box display="flex" justifyContent="center" style={{ gap: 4 }}>
              {finding.passCount > 0 && (
                <Chip
                  label={`${finding.passCount} pass`}
                  size="small"
                  style={{ backgroundColor: '#3E8635', color: '#fff', fontSize: '0.7rem' }}
                />
              )}
              <Chip
                label={`${finding.failCount} fail`}
                size="small"
                style={{ backgroundColor: '#C9190B', color: '#fff', fontSize: '0.7rem' }}
              />
            </Box>
          )}
        </TableCell>
        <TableCell>
          <Box display="flex" alignItems="center" style={{ gap: 8 }}>
            <LinearProgress
              variant="determinate"
              value={passRate}
              className={classes.passBar}
              style={{ flex: 1 }}
              color={finding.passCount === finding.totalCount ? 'primary' : 'secondary'}
            />
            <Typography variant="caption" style={{ minWidth: 36 }}>
              {passRate}%
            </Typography>
          </Box>
        </TableCell>
      </TableRow>

      <TableRow>
        <TableCell colSpan={6} style={{ padding: 0, border: 'none' }}>
          <Collapse in={expanded}>
            <div className={classes.ruleDescription}>
              <Typography variant="body2" gutterBottom>{finding.description}</Typography>
              <Box display="flex" style={{ gap: 24 }}>
                <div>
                  <Typography variant="caption" color="textSecondary">Check</Typography>
                  <Typography variant="body2">{finding.checkText}</Typography>
                </div>
                <div>
                  <Typography variant="caption" color="textSecondary">Fix</Typography>
                  <Typography variant="body2">{finding.fixText}</Typography>
                </div>
              </Box>
            </div>

            <div className={classes.expandedSection}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Host</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Actual Value</TableCell>
                    <TableCell>Expected Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {finding.hosts
                    .sort((a, b) => (a.status === 'fail' ? -1 : 1) - (b.status === 'fail' ? -1 : 1))
                    .map(hostFinding => (
                      <TableRow key={hostFinding.host} className={classes.hostDetailRow}>
                        <TableCell>
                          <Typography variant="body2" style={{ fontFamily: 'monospace' }}>
                            {hostFinding.host}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <div className={hostFinding.status === 'pass' ? classes.hostStatusPass : classes.hostStatusFail}>
                            {hostFinding.status === 'pass'
                              ? <><CheckCircleIcon fontSize="small" /> Pass</>
                              : <><ErrorIcon fontSize="small" /> Fail</>
                            }
                          </div>
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            style={{
                              fontFamily: 'monospace',
                              color: hostFinding.status === 'fail' ? '#C9190B' : 'inherit',
                              fontWeight: hostFinding.status === 'fail' ? 600 : 400,
                            }}
                          >
                            {hostFinding.actualValue}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" style={{ fontFamily: 'monospace' }}>
                            {hostFinding.expectedValue}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </Collapse>
        </TableCell>
      </TableRow>
    </React.Fragment>
  );
};
