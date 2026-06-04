import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  InfoCard,
  Breadcrumbs,
  Progress,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { ScanProgress } from '../ScanProgress';
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
  Menu,
  TextField,
  InputAdornment,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  makeStyles,
} from '@material-ui/core';
import SearchIcon from '@material-ui/icons/Search';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import BuildIcon from '@material-ui/icons/Build';
import AssessmentIcon from '@material-ui/icons/Assessment';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import WarningIcon from '@material-ui/icons/Warning';
import type { FindingSeverity, FindingState, MultiHostFinding, ScanCertification, BaselineTarget, AuthoritativeScanResponse, RemediationProfile } from '@aap-compliance/common';
import { complianceApiRef } from '../../api';
import { CertificationBadge } from '../shared/CertificationBadge';
import { ExportButton } from './ExportButton';
import { ScanFailedView } from './ScanFailedView';
import { SummaryCards } from './SummaryCards';
import { VerificationComparison } from './VerificationComparison';
import { FindingRow } from './FindingRow';

const useStyles = makeStyles(theme => ({
  filterRow: {
    display: 'flex',
    gap: theme.spacing(2),
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: theme.spacing(2),
  },
  emptyState: {
    textAlign: 'center',
    padding: theme.spacing(8, 4),
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
  const stateFilter = (searchParams.get('state') || 'all') as FindingState | 'all';
  const searchQuery = searchParams.get('q') || '';

  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [findings, setFindings] = useState<MultiHostFinding[]>([]);
  const [previousFindings, setPreviousFindings] = useState<MultiHostFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanType, setScanType] = useState<'assessment' | 'verification'>('assessment');
  const [findingsExpanded, setFindingsExpanded] = useState(true);
  const [profileName, setProfileName] = useState<string>('');
  const [frameworkLabel, setFrameworkLabel] = useState<string>('');
  const [profileCert, setProfileCert] = useState<ScanCertification | null>(null);
  const [scanComplianceProfileId, setScanComplianceProfileId] = useState<string>('');
  const [scanInventoryId, setScanInventoryId] = useState<number | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState<string>('');
  const [compareProfileMismatch, setCompareProfileMismatch] = useState(false);
  const [compareSwapped, setCompareSwapped] = useState(false);
  const [baselineForScan, setBaselineForScan] = useState<BaselineTarget | null>(null);
  const [remMenuAnchor, setRemMenuAnchor] = useState<null | HTMLElement>(null);
  const [baselineLaunchOpen, setBaselineLaunchOpen] = useState(false);
  const [baselineProfile, setBaselineProfile] = useState<RemediationProfile | null>(null);
  const [baselineScanCheck, setBaselineScanCheck] = useState<AuthoritativeScanResponse | null>(null);
  const [baselineScanChecking, setBaselineScanChecking] = useState(false);
  const [baselineScanMissing, setBaselineScanMissing] = useState(false);
  const compareToScanId = searchParams.get('compareTo');

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    api.getScans().then(scans => {
      if (cancelled) return;
      const match = scans.find(
        s => s.id === jobId || String(s.workflowJobId) === jobId,
      );
      if (match?.scanType) {
        setScanType(match.scanType);
      }
      if (match) {
        setScanComplianceProfileId(match.profileId);
        setScanInventoryId(match.inventoryId);
        setScanStartedAt(match.startedAt);
        api.getRegisteredProfiles().then(profiles => {
          if (cancelled) return;
          const cart = profiles.find(c => c.id === match.profileId);
          if (cart) {
            setProfileName(cart.displayName);
            setFrameworkLabel(cart.framework);
            setProfileCert(cart.certification);
          }
        }).catch(() => {});
      }
    }).catch(err => {
      console.error('Failed to load scan metadata for scan type:', err);
    });
    return () => { cancelled = true; };
  }, [api, jobId]);

  useEffect(() => {
    if (!scanComplianceProfileId || !scanInventoryId) return;
    api.getBaselineTargets(scanComplianceProfileId)
      .then(targets => {
        const match = targets.find(t => t.inventoryId === scanInventoryId);
        setBaselineForScan(match ?? null);
      })
      .catch(() => setBaselineForScan(null));
  }, [api, scanComplianceProfileId, scanInventoryId]);

  useEffect(() => {
    if (!baselineLaunchOpen || !baselineForScan || !scanInventoryId || !scanComplianceProfileId) return;
    let cancelled = false;
    setBaselineScanChecking(true);
    setBaselineScanCheck(null);
    setBaselineScanMissing(false);
    setBaselineProfile(null);

    Promise.all([
      api.getRemediationProfile(baselineForScan.remediationProfileId),
      api.getAuthoritativeScan(scanComplianceProfileId, scanInventoryId),
    ]).then(([profile, scanResult]) => {
      if (cancelled) return;
      setBaselineProfile(profile);
      if (scanResult) {
        setBaselineScanCheck(scanResult);
      } else {
        setBaselineScanMissing(true);
      }
    }).catch(() => {
      if (!cancelled) setBaselineScanMissing(true);
    }).finally(() => {
      if (!cancelled) setBaselineScanChecking(false);
    });

    return () => { cancelled = true; };
  }, [api, baselineLaunchOpen, baselineForScan, scanComplianceProfileId, scanInventoryId]);

  useEffect(() => {
    let cancelled = false;
    if (compareToScanId) {
      setCompareProfileMismatch(false);
      setCompareSwapped(false);
      Promise.all([
        api.getFindings(compareToScanId),
        api.getScans().then(scans =>
          scans.find(s => s.id === compareToScanId || String(s.workflowJobId) === compareToScanId),
        ),
      ]).then(([data, compareScan]) => {
        if (cancelled) return;
        if (compareScan && scanComplianceProfileId && compareScan.profileId !== scanComplianceProfileId) {
          setCompareProfileMismatch(true);
        }
        if (compareScan && scanStartedAt && new Date(compareScan.startedAt) > new Date(scanStartedAt)) {
          setCompareSwapped(true);
        }
        setPreviousFindings(data);
        if (data.length > 0) setFindingsExpanded(false);
      }).catch(err => {
        console.error('Failed to load comparison findings:', err);
      });
    } else if (scanType === 'verification' && jobId) {
      api.getPreviousFindings(jobId).then(data => {
        if (cancelled) return;
        setPreviousFindings(data);
        if (data.length > 0) setFindingsExpanded(false);
      }).catch(err => {
        console.error('Failed to load previous findings for comparison:', err);
      });
    }
    return () => { cancelled = true; };
  }, [api, jobId, scanType, compareToScanId, scanComplianceProfileId, scanStartedAt]);

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
            if (jobId && !isWorkflowPoll) {
              api.getScan(jobId).then(scan => {
                if (!cancelled && scan?.status === 'failed') {
                  setScanFailed(scan.errorDetails || 'failed');
                }
              }).catch(() => { /* ignore */ });
            }
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
  }, [api, jobId, isWorkflowPoll]);

  // ─── Computed metrics ──────────────────────────────────────────────

  const totalHosts = useMemo(() => {
    const hostSet = new Set<string>();
    findings.forEach(f => f.hosts.forEach(h => hostSet.add(h.host)));
    return hostSet.size;
  }, [findings]);
  const rulesWithFailures = findings.filter(f => f.failCount > 0).length;
  const totalRules = findings.length;
  const totalChecks = findings.reduce((sum, f) => sum + f.totalCount, 0);
  const overallPassRate = totalChecks > 0
    ? Math.round((findings.reduce((sum, f) => sum + f.passCount, 0) / totalChecks) * 1000) / 10
    : 0;

  const isVerification = scanType === 'verification';
  const isComparison = !!compareToScanId || isVerification;
  const previousPassRate = useMemo(() => {
    if (previousFindings.length === 0) return 0;
    const prevTotalChecks = previousFindings.reduce((sum, f) => sum + f.totalCount, 0);
    return prevTotalChecks > 0
      ? Math.round((previousFindings.reduce((sum, f) => sum + f.passCount, 0) / prevTotalChecks) * 1000) / 10
      : 0;
  }, [previousFindings]);

  const comparisonStats = useMemo(() => {
    if (!isComparison || previousFindings.length === 0) {
      return { improved: 0, regressed: 0, unchanged: 0 };
    }
    const prevMap = new Map<string, MultiHostFinding>();
    for (const f of previousFindings) prevMap.set(f.ruleId, f);

    let improved = 0, regressed = 0, unchanged = 0;
    for (const current of findings) {
      const prev = prevMap.get(current.ruleId);
      if (!prev) { unchanged++; continue; }
      const prevFailing = prev.failCount > 0;
      const currentFailing = current.failCount > 0;
      if (prevFailing && !currentFailing) improved++;
      else if (!prevFailing && currentFailing) regressed++;
      else unchanged++;
    }
    return { improved, regressed, unchanged };
  }, [isComparison, findings, previousFindings]);

  const filtered = useMemo(() =>
    findings
      .filter(f => severityFilter === 'all' || f.severity === severityFilter)
      .filter(f => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'fail') return f.failCount > 0;
        if (statusFilter === 'pass') return f.failCount === 0;
        return true;
      })
      .filter(f => {
        if (stateFilter === 'all') return true;
        if (!f.stateSummary) return false;
        return (f.stateSummary[stateFilter] ?? 0) > 0;
      })
      .filter(f =>
        searchQuery === '' ||
        f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.stigId.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]),
    [findings, severityFilter, statusFilter, stateFilter, searchQuery],
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

  // ─── Scan progress callbacks ──────────────────────────────────────

  const [showProgress, setShowProgress] = useState(false);
  useEffect(() => {
    if (!loading || !isWorkflowPoll) return;
    const t = setTimeout(() => setShowProgress(true), 1500);
    return () => clearTimeout(t);
  }, [loading, isWorkflowPoll]);

  const [scanFailed, setScanFailed] = useState<string | null>(null);

  const triggerFetch = useCallback(() => {
    api.getFindings(jobId).then(data => {
      if (data.length > 0) setFindings(data);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to fetch findings after scan completion:', err);
      setLoading(false);
    });
  }, [api, jobId]);

  const handleScanFailed = useCallback((status: string) => {
    api.getFindings(jobId).then(data => {
      if (data.length > 0) {
        setFindings(data);
      } else {
        if (jobId) {
          api.getScan(jobId).then(scan => {
            setScanFailed(scan?.errorDetails || status);
          }).catch(() => setScanFailed(status));
        } else {
          setScanFailed(status);
        }
      }
      setLoading(false);
    }).catch(() => {
      if (jobId) {
        api.getScan(jobId).then(scan => {
          setScanFailed(scan?.errorDetails || status);
        }).catch(() => setScanFailed(status));
      } else {
        setScanFailed(status);
      }
      setLoading(false);
    });
  }, [api, jobId]);

  // ─── Render states ────────────────────────────────────────────────

  if (loading) {
    if (showProgress && isWorkflowPoll && jobId) {
      return (
        <Box p={4}>
          <ScanProgress workflowJobId={Number(jobId)} onComplete={triggerFetch} onFailed={handleScanFailed} scanType={scanType} />
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

  if (scanFailed) {
    return (
      <ScanFailedView
        scanFailed={scanFailed}
        isWorkflowPoll={isWorkflowPoll}
        jobId={jobId}
        scanType={scanType}
        onComplete={triggerFetch}
        onFailed={handleScanFailed}
      />
    );
  }

  if (findings.length === 0 && !error) {
    return (
      <>
        <Breadcrumbs>
          <Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance')}>
            Compliance
          </Typography>
          <Typography>{compareToScanId ? 'Scan Comparison' : isVerification ? 'Verification Results' : 'Assessment Results'}</Typography>
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
            <Button variant="contained" color="primary" onClick={() => navigate('/compliance/scan')}>
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
          <Typography>{compareToScanId ? 'Scan Comparison' : isVerification ? 'Verification Results' : 'Assessment Results'}</Typography>
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

  // ─── Main results view ────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs>
        <Typography color="primary" style={{ cursor: 'pointer' }} onClick={() => navigate('/compliance')}>
          Compliance
        </Typography>
        <Typography>{compareToScanId ? 'Scan Comparison' : isVerification ? 'Verification Results' : 'Assessment Results'}</Typography>
      </Breadcrumbs>

      <Box mt={2} />

      {profileCert && (
        <Box mb={2} display="flex" alignItems="center" style={{ gap: 8 }}>
          <Typography variant="subtitle2">{profileName}</Typography>
          <Chip label={frameworkLabel} size="small" variant="outlined" />
          <CertificationBadge certification={profileCert} />
        </Box>
      )}

      {compareProfileMismatch && (
        <Box mb={2} p={2} style={{ backgroundColor: '#FFF3E0', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography variant="body2" style={{ color: '#E65100' }}>
            Warning: These scans are from different compliance profiles. The comparison may not be meaningful.
          </Typography>
        </Box>
      )}

      {isComparison && previousFindings.length > 0 ? (
        <VerificationComparison
          title={compareToScanId ? 'Scan Comparison' : undefined}
          previousPassRate={compareSwapped ? overallPassRate : previousPassRate}
          overallPassRate={compareSwapped ? previousPassRate : overallPassRate}
          totalHosts={totalHosts}
          totalRules={totalRules}
          comparisonStats={compareSwapped
            ? { improved: comparisonStats.regressed, regressed: comparisonStats.improved, unchanged: comparisonStats.unchanged }
            : comparisonStats}
        />
      ) : (
        <SummaryCards
          overallPassRate={overallPassRate}
          totalHosts={totalHosts}
          totalRules={totalRules}
          rulesWithFailures={rulesWithFailures}
        />
      )}

      <Box mt={2} />

      {/* Action Buttons */}
      <Box display="flex" justifyContent="flex-end" mb={2} style={{ gap: 8 }}>
        <ExportButton findings={filtered} profileName={jobId} />
        <Button variant="outlined" onClick={() => navigate('/compliance')}>
          Back to Overview
        </Button>
        {baselineForScan ? (
          <>
            <Button
              variant="contained"
              color="primary"
              onClick={() => setBaselineLaunchOpen(true)}
              endIcon={<ArrowDropDownIcon onClick={e => { e.stopPropagation(); setRemMenuAnchor(e.currentTarget); }} />}
            >
              Use Baseline Remediation
            </Button>
            <Menu
              anchorEl={remMenuAnchor}
              open={Boolean(remMenuAnchor)}
              onClose={() => setRemMenuAnchor(null)}
            >
              <MenuItem onClick={() => {
                setRemMenuAnchor(null);
                const filter = scanComplianceProfileId
                  ? `?complianceProfileId=${encodeURIComponent(scanComplianceProfileId)}`
                  : '';
                navigate(`/compliance/remediations${filter}`);
              }}>
                Use Other Remediation...
              </MenuItem>
            </Menu>
          </>
        ) : (
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              const filter = scanComplianceProfileId
                ? `?complianceProfileId=${encodeURIComponent(scanComplianceProfileId)}`
                : '';
              navigate(`/compliance/remediations${filter}`);
            }}
          >
            Use Existing Remediation
          </Button>
        )}
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

      {/* Findings collapse trigger for comparison views */}
      {isComparison && (
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
        <div className={classes.filterRow}>
          <TextField
            placeholder="Search by title or rule ID..."
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
          <FormControl variant="outlined" size="small" style={{ minWidth: 140 }}>
            <InputLabel>State</InputLabel>
            <Select value={stateFilter} onChange={e => updateFilter('state', e.target.value as string)} label="State">
              <MenuItem value="all">All States</MenuItem>
              <MenuItem value="new">New</MenuItem>
              <MenuItem value="fixed">Fixed</MenuItem>
              <MenuItem value="resurfaced">Resurfaced</MenuItem>
              <MenuItem value="active">Active</MenuItem>
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
                <TableCell>Title</TableCell>
                <TableCell>Rule ID</TableCell>
                <TableCell align="center">Hosts</TableCell>
                <TableCell width={200}>Pass Rate</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map(finding => (
                <FindingRow
                  key={finding.ruleId}
                  finding={finding}
                  expanded={expandedRule === finding.ruleId}
                  onToggle={() => setExpandedRule(expandedRule === finding.ruleId ? null : finding.ruleId)}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </InfoCard>
      </Collapse>

      {/* Baseline launch dialog */}
      <Dialog
        open={baselineLaunchOpen}
        onClose={() => setBaselineLaunchOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Launch Baseline Remediation</DialogTitle>
        <DialogContent>
          {baselineProfile ? (
            <Box mb={2}>
              <Typography variant="body2" color="textSecondary">
                Profile: <strong>{baselineProfile.name}</strong>
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Rules: {baselineProfile.selections.filter(s => s.enabled).length} selected
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Inventory: <strong>{profileName ? `${frameworkLabel} scan target` : `ID ${scanInventoryId}`}</strong>
              </Typography>
            </Box>
          ) : baselineScanChecking ? (
            <Box display="flex" alignItems="center" py={2} style={{ gap: 8 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="textSecondary">Loading profile...</Typography>
            </Box>
          ) : null}

          {baselineScanChecking && baselineProfile && (
            <Box display="flex" alignItems="center" style={{ gap: 8 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="textSecondary">Checking for assessment scan...</Typography>
            </Box>
          )}

          {baselineScanCheck && (
            <Box display="flex" alignItems="center" style={{ gap: 8, color: '#3E8635' }}>
              <CheckCircleIcon fontSize="small" />
              <Typography variant="body2">
                Last scan: {baselineScanCheck.passRate}% pass rate ({baselineScanCheck.passCount} pass, {baselineScanCheck.failCount} fail)
                {baselineScanCheck.scan.completedAt && (
                  <span style={{ color: '#6A6E73' }}>
                    {' '}— {new Date(baselineScanCheck.scan.completedAt).toLocaleDateString()}
                  </span>
                )}
              </Typography>
            </Box>
          )}

          {baselineScanMissing && (
            <Box>
              <Box display="flex" alignItems="center" style={{ gap: 8, color: '#C9190B', marginBottom: 8 }}>
                <WarningIcon fontSize="small" />
                <Typography variant="body2">No completed assessment scan found for this inventory.</Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  setBaselineLaunchOpen(false);
                  const params = new URLSearchParams();
                  if (scanComplianceProfileId) params.set('profile', scanComplianceProfileId);
                  if (scanInventoryId) params.set('inventory', String(scanInventoryId));
                  navigate(`/compliance/scan?${params.toString()}`);
                }}
              >
                Run a Scan First
              </Button>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBaselineLaunchOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!baselineScanCheck || baselineScanChecking}
            startIcon={<PlayArrowIcon />}
            onClick={() => {
              if (!baselineForScan || !baselineScanCheck || !scanInventoryId) return;
              const params = new URLSearchParams();
              params.set('profileId', baselineForScan.remediationProfileId);
              params.set('inventoryId', String(scanInventoryId));
              params.set('scanId', baselineScanCheck.scan.id);
              setBaselineLaunchOpen(false);
              navigate(`/compliance/execute/launch?${params.toString()}`);
            }}
          >
            Launch Remediation
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
