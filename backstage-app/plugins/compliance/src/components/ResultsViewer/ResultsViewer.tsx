import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  InfoCard,
  Breadcrumbs,
  Progress,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { ScanProgress } from '../ScanProgress';
import { ComplianceGauge } from '../ComplianceDashboard/ComplianceGauge';
import {
  Typography,
  Button,
  Chip,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  InputAdornment,
  LinearProgress,
  IconButton,
  Collapse,
  makeStyles,
} from '@material-ui/core';
import SearchIcon from '@material-ui/icons/Search';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import BuildIcon from '@material-ui/icons/Build';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import ErrorIcon from '@material-ui/icons/Error';
import AssessmentIcon from '@material-ui/icons/Assessment';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';
import TrendingUpIcon from '@material-ui/icons/TrendingUp';
import TrendingDownIcon from '@material-ui/icons/TrendingDown';
import RemoveIcon from '@material-ui/icons/Remove';
import type { FindingSeverity, MultiHostFinding, ComplianceScan } from '@aap-compliance/common';
import { complianceApiRef } from '../../api';
import { ExportButton } from './ExportButton';

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
  filterRow: {
    display: 'flex',
    gap: theme.spacing(2),
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: theme.spacing(2),
  },
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
  hostDetail: {
    padding: theme.spacing(1, 2, 1, 6),
  },
  expandedSection: {
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  ruleDescription: {
    padding: theme.spacing(1.5, 2),
    backgroundColor: theme.palette.background.default,
    borderTop: `1px solid ${theme.palette.divider}`,
  },
  emptyState: {
    textAlign: 'center',
    padding: theme.spacing(8, 4),
  },
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
  findingsCollapseTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: theme.spacing(1.5),
    '&:hover': { backgroundColor: theme.palette.action.hover },
    borderRadius: theme.shape.borderRadius,
  },
}));

const severityLabel: Record<FindingSeverity, string> = {
  CAT_I: 'CAT I',
  CAT_II: 'CAT II',
  CAT_III: 'CAT III',
};

const severityOrder: Record<FindingSeverity, number> = {
  CAT_I: 0,
  CAT_II: 1,
  CAT_III: 2,
};

export const ResultsViewer = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const severityFilter = searchParams.get('severity') || 'all';
  const statusFilter = searchParams.get('status') || 'all';
  const searchQuery = searchParams.get('q') || '';

  const [expandedRule, setExpandedRule] = useState<string | null>(null);

  // Fetch findings from the backend -- no frontend mock fallback (S2)
  const [findings, setFindings] = useState<MultiHostFinding[]>([]);
  const [previousFindings, setPreviousFindings] = useState<MultiHostFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanType, setScanType] = useState<'assessment' | 'verification'>('assessment');
  const [findingsExpanded, setFindingsExpanded] = useState(true);

  // Determine scan type from scan history
  useEffect(() => {
    if (!jobId) return;
    api.getScans().then(scans => {
      const match = scans.find(
        s => s.id === jobId || String(s.workflowJobId) === jobId,
      );
      if (match?.scanType) {
        setScanType(match.scanType);
      }
    }).catch(err => {
      console.error('Failed to load scan metadata for scan type:', err);
    });
  }, [api, jobId]);

  // Fetch previous scan findings for verification scans
  useEffect(() => {
    if (scanType !== 'verification' || !jobId) return;
    api.getPreviousFindings(jobId).then(data => {
      setPreviousFindings(data);
      if (data.length > 0) {
        setFindingsExpanded(false);
      }
    }).catch(err => {
      console.error('Failed to load previous findings for comparison:', err);
    });
  }, [api, jobId, scanType]);

  const isWorkflowPoll = jobId ? /^\d+$/.test(jobId) : false;

  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    let timeoutId: ReturnType<typeof setTimeout>;
    const maxRetries = 30;
    const pollInterval = 10_000;

    const fetchFindings = () => {
      api.getFindings(jobId)
        .then(data => {
          if (cancelled) return;
          if (data.length > 0) {
            setFindings(data);
            setLoading(false);
          } else if (isWorkflowPoll && retries < maxRetries) {
            retries++;
            timeoutId = setTimeout(fetchFindings, pollInterval);
          } else {
            setLoading(false);
          }
        })
        .catch(err => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
          }
        });
    };

    fetchFindings();

    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [api, jobId]);

  const totalHosts = findings[0]?.totalCount || 0;
  const rulesWithFailures = findings.filter(f => f.failCount > 0).length;
  const totalRules = findings.length;
  const totalChecks = findings.reduce((sum, f) => sum + f.totalCount, 0);
  const overallPassRate = totalChecks > 0
    ? Math.round(
        (findings.reduce((sum, f) => sum + f.passCount, 0) / totalChecks) * 100,
      )
    : 0;

  // Comparison metrics for verification scans
  const isVerification = scanType === 'verification';
  const previousPassRate = useMemo(() => {
    if (previousFindings.length === 0) return 0;
    const prevTotalChecks = previousFindings.reduce((sum, f) => sum + f.totalCount, 0);
    return prevTotalChecks > 0
      ? Math.round(
          (previousFindings.reduce((sum, f) => sum + f.passCount, 0) / prevTotalChecks) * 100,
        )
      : 0;
  }, [previousFindings]);

  const comparisonStats = useMemo(() => {
    if (!isVerification || previousFindings.length === 0) {
      return { improved: 0, regressed: 0, unchanged: 0 };
    }

    // Build a map of previous findings by ruleId
    const prevMap = new Map<string, MultiHostFinding>();
    for (const f of previousFindings) {
      prevMap.set(f.ruleId, f);
    }

    let improved = 0;
    let regressed = 0;
    let unchanged = 0;

    for (const current of findings) {
      const prev = prevMap.get(current.ruleId);
      if (!prev) {
        // New rule not in previous scan — treat as unchanged
        unchanged++;
        continue;
      }
      const prevFailing = prev.failCount > 0;
      const currentFailing = current.failCount > 0;
      if (prevFailing && !currentFailing) {
        improved++;
      } else if (!prevFailing && currentFailing) {
        regressed++;
      } else {
        unchanged++;
      }
    }

    return { improved, regressed, unchanged };
  }, [isVerification, findings, previousFindings]);

  const filtered = useMemo(() =>
    findings
      .filter(f => severityFilter === 'all' || f.severity === severityFilter)
      .filter(f => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'fail') return f.failCount > 0;
        if (statusFilter === 'pass') return f.failCount === 0;
        return true;
      })
      .filter(f =>
        searchQuery === '' ||
        f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.stigId.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]),
    [findings, severityFilter, statusFilter, searchQuery],
  );

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === 'all' || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  };

  const getSeverityClass = (severity: FindingSeverity) => {
    switch (severity) {
      case 'CAT_I': return classes.catI;
      case 'CAT_II': return classes.catII;
      case 'CAT_III': return classes.catIII;
      default: return '';
    }
  };

  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    if (!loading || !isWorkflowPoll) return;
    const t = setTimeout(() => setShowProgress(true), 1500);
    return () => clearTimeout(t);
  }, [loading, isWorkflowPoll]);

  const triggerFetch = useCallback(() => {
    api.getFindings(jobId).then(data => {
      if (data.length > 0) {
        setFindings(data);
        setLoading(false);
      }
    }).catch(err => {
      console.error('Failed to fetch findings after scan completion:', err);
    });
  }, [api, jobId]);

  if (loading) {
    if (showProgress && isWorkflowPoll && jobId) {
      return (
        <Box p={4}>
          <ScanProgress
            workflowJobId={Number(jobId)}
            onComplete={triggerFetch}
          />
          <Typography variant="body2" align="center" color="textSecondary">
            Scan is running — results will appear automatically when complete.
          </Typography>
        </Box>
      );
    }
    return (
      <Box p={4}>
        <Progress />
        <Typography variant="body2" align="center" style={{ marginTop: 16 }}>
          Loading scan results...
        </Typography>
      </Box>
    );
  }

  // P3-3: Empty state when no findings are available
  if (findings.length === 0 && !error) {
    return (
      <>
        <Breadcrumbs>
          <Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance')}>
            Compliance
          </Typography>
          <Typography>{scanType === 'verification' ? 'Verification Results' : 'Assessment Results'}</Typography>
        </Breadcrumbs>

        <Box mt={2} />

        <InfoCard title="Scan Results">
          <div className={classes.emptyState}>
            <AssessmentIcon style={{ fontSize: 64, color: '#6A6E73', marginBottom: 16 }} />
            <Typography variant="h6" color="textSecondary" gutterBottom>
              No scan results yet
            </Typography>
            <Typography variant="body2" color="textSecondary" paragraph>
              Launch a compliance scan to see findings and per-host results here.
            </Typography>
            <Button
              variant="contained"
              color="primary"
              onClick={() => navigate('/compliance/scan')}
            >
              Launch a Scan
            </Button>
          </div>
        </InfoCard>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Breadcrumbs>
          <Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance')}>
            Compliance
          </Typography>
          <Typography>{scanType === 'verification' ? 'Verification Results' : 'Assessment Results'}</Typography>
        </Breadcrumbs>

        <Box mt={2} />

        <InfoCard title="Error Loading Results">
          <Box p={3} textAlign="center">
            <Typography variant="body1" color="error" gutterBottom>
              Failed to load scan results: {error}
            </Typography>
            <Button variant="outlined" onClick={() => navigate('/compliance')}>
              Back to Dashboard
            </Button>
          </Box>
        </InfoCard>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs>
        <Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance')}>
          Compliance
        </Typography>
        <Typography>{scanType === 'verification' ? 'Verification Results' : 'Assessment Results'}</Typography>
      </Breadcrumbs>

      <Box mt={2} />

      {/* Verification Comparison Header */}
      {isVerification && previousFindings.length > 0 ? (
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
      ) : (
        <>
          {/* Summary Cards (assessment or verification without previous data) */}
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
        </>
      )}

      <Box mt={2} />

      {/* Action Buttons: Remediate + Export (P3-2) */}
      <Box display="flex" justifyContent="flex-end" mb={2} style={{ gap: 8 }}>
        <ExportButton findings={filtered} profileName={jobId} />
        <Button
          variant="outlined"
          onClick={() => navigate('/compliance')}
        >
          Back to Overview
        </Button>
        <Button
          variant="outlined"
          color="primary"
          onClick={() => navigate('/compliance/remediations')}
        >
          Edit Remediations
        </Button>
        <Button
          variant="contained"
          color="primary"
          size="large"
          startIcon={<BuildIcon />}
          onClick={() => navigate(`/compliance/remediation/${jobId}`)}
        >
          {isVerification ? 'Build New Remediation' : 'Build Remediation'} ({rulesWithFailures} rules with failures)
        </Button>
      </Box>

      {/* Findings Table — collapsed by default for verification scans with comparison data */}
      {isVerification && (
        <div
          className={classes.findingsCollapseTrigger}
          onClick={() => setFindingsExpanded(!findingsExpanded)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setFindingsExpanded(!findingsExpanded); }}
        >
          {findingsExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          <Typography variant="body2" style={{ fontWeight: 500, marginLeft: 4 }}>
            {findingsExpanded ? 'Collapse Findings' : `Expand Findings (${filtered.length} rules)`}
          </Typography>
        </div>
      )}
      <Collapse in={findingsExpanded}>
      <InfoCard title="Findings by Rule">
        {/* Filters */}
        <div className={classes.filterRow}>
          <TextField
            placeholder="Search by title or STIG ID..."
            variant="outlined"
            size="small"
            style={{ minWidth: 280 }}
            value={searchQuery}
            onChange={e => updateFilter('q', e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon /></InputAdornment>
              ),
            }}
          />
          <FormControl variant="outlined" size="small" style={{ minWidth: 130 }}>
            <InputLabel>Severity</InputLabel>
            <Select value={severityFilter} onChange={e => updateFilter('severity', e.target.value as string)} label="Severity">
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="CAT_I">CAT I</MenuItem>
              <MenuItem value="CAT_II">CAT II</MenuItem>
              <MenuItem value="CAT_III">CAT III</MenuItem>
            </Select>
          </FormControl>
          <FormControl variant="outlined" size="small" style={{ minWidth: 130 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} onChange={e => updateFilter('status', e.target.value as string)} label="Status">
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="pass">All Pass</MenuItem>
              <MenuItem value="fail">Has Failures</MenuItem>
            </Select>
          </FormControl>
          <Chip label={`${filtered.length} rules`} variant="outlined" />
        </div>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={40} />
                <TableCell>Severity</TableCell>
                <TableCell>STIG ID</TableCell>
                <TableCell>Title</TableCell>
                <TableCell align="center">Hosts</TableCell>
                <TableCell width={200}>Pass Rate</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map(finding => (
                <React.Fragment key={finding.ruleId}>
                  {/* Rule row */}
                  <TableRow
                    className={classes.findingRow}
                    onClick={() => setExpandedRule(expandedRule === finding.ruleId ? null : finding.ruleId)}
                  >
                    <TableCell>
                      <IconButton
                        size="small"
                        aria-label={expandedRule === finding.ruleId ? `Collapse rule details for ${finding.stigId}` : `Expand rule details for ${finding.stigId}`}
                      >
                        {expandedRule === finding.ruleId ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={severityLabel[finding.severity]}
                        size="small"
                        className={`${classes.severityChip} ${getSeverityClass(finding.severity)}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" style={{ fontFamily: 'monospace' }}>
                        {finding.stigId}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{finding.title}</Typography>
                      {finding.disruption === 'high' && (
                        <Chip label="High disruption" size="small" color="secondary" style={{ marginTop: 4 }} />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {finding.failCount === 0 ? (
                        <Chip
                          label={`${finding.passCount}/${finding.totalCount}`}
                          size="small"
                          style={{ backgroundColor: '#3E8635', color: '#fff' }}
                          className={classes.hostCountChip}
                        />
                      ) : (
                        <Box display="flex" justifyContent="center" style={{ gap: 4 }}>
                          <Chip
                            label={`${finding.passCount} pass`}
                            size="small"
                            style={{ backgroundColor: '#3E8635', color: '#fff', fontSize: '0.7rem' }}
                          />
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
                          value={finding.totalCount > 0 ? Math.round((finding.passCount / finding.totalCount) * 100) : 0}
                          className={classes.passBar}
                          style={{ flex: 1 }}
                          color={finding.passCount === finding.totalCount ? 'primary' : 'secondary'}
                        />
                        <Typography variant="caption" style={{ minWidth: 36 }}>
                          {finding.totalCount > 0 ? Math.round((finding.passCount / finding.totalCount) * 100) : 0}%
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>

                  {/* Expanded detail: description + host-level breakdown */}
                  <TableRow>
                    <TableCell colSpan={6} style={{ padding: 0, border: 'none' }}>
                      <Collapse in={expandedRule === finding.ruleId}>
                        {/* Rule description */}
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

                        {/* Host-level breakdown */}
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
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </InfoCard>
      </Collapse>
    </>
  );
};
