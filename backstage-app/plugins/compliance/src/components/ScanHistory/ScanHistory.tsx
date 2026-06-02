import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  InfoCard,
  Progress,
  StatusOK,
  StatusError,
  StatusWarning,
  StatusPending,
  StatusRunning,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import {
  Typography,
  Button,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tooltip,
  makeStyles,
} from '@material-ui/core';
import PlayCircleFilledIcon from '@material-ui/icons/PlayCircleFilled';
import BuildIcon from '@material-ui/icons/Build';
import SearchIcon from '@material-ui/icons/Search';
import AssessmentIcon from '@material-ui/icons/Assessment';
import VerifiedUserIcon from '@material-ui/icons/VerifiedUser';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ListIcon from '@material-ui/icons/List';
import ViewModuleIcon from '@material-ui/icons/ViewModule';
import CompareArrowsIcon from '@material-ui/icons/CompareArrows';
import StarIcon from '@material-ui/icons/Star';
import { complianceApiRef } from '../../api';
import { CertificationBadge } from '../shared/CertificationBadge';
import type {
  ComplianceScan,
  ScanCertification,
  RemediationExecution,
} from '@aap-compliance/common';
import { ScanProgress } from '../ScanProgress';

const useStyles = makeStyles(theme => ({
  emptyState: {
    textAlign: 'center',
    padding: theme.spacing(6),
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
  clickableRow: {
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  statusChip: {
    fontWeight: 600,
    minWidth: 90,
  },
  groupAccordion: {
    '&:before': { display: 'none' },
    boxShadow: 'none',
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    gap: theme.spacing(2),
  },
  groupTitle: {
    flex: 1,
  },
  groupStats: {
    display: 'flex',
    gap: theme.spacing(2),
    alignItems: 'center',
  },
  executionRow: {
    backgroundColor: theme.palette.type === 'dark' ? 'rgba(62, 134, 53, 0.08)' : 'rgba(62, 134, 53, 0.04)',
    '&:hover': {
      backgroundColor: theme.palette.type === 'dark' ? 'rgba(62, 134, 53, 0.15)' : 'rgba(62, 134, 53, 0.08)',
    },
  },
  authoritative: {
    fontWeight: 600,
  },
  viewToggle: {
    display: 'flex',
    gap: theme.spacing(0.5),
  },
  compareBtn: {
    opacity: 0,
    transition: 'opacity 0.2s',
    '$clickableRow:hover &': {
      opacity: 1,
    },
  },
}));

const statusColor: Record<string, 'primary' | 'secondary' | 'default'> = {
  completed: 'primary',
  failed: 'secondary',
  running: 'default',
  pending: 'default',
  cancelled: 'default',
};

const execStatusColor: Record<string, string> = {
  succeeded: '#3E8635',
  failed: '#C9190B',
  running: '#0066CC',
  pending: '#6A6E73',
  cancelled: '#6A6E73',
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': case 'succeeded': return <StatusOK />;
    case 'failed': return <StatusError />;
    case 'running': return <StatusRunning />;
    case 'pending': return <StatusPending />;
    case 'cancelled': return <StatusWarning />;
    default: return <StatusPending />;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

interface ScanGroup {
  profileId: string;
  inventoryId: number;
  profileName: string;
  inventoryName: string;
  certification: ScanCertification | null;
  items: Array<
    | { type: 'scan'; scan: ComplianceScan; stats?: { pass: number; fail: number; rules: number; hosts: number } }
    | { type: 'execution'; execution: RemediationExecution }
  >;
}

export const ScanHistory = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);
  const [searchParams] = useSearchParams();
  const filterByProfile = searchParams.get('complianceProfileId');

  const [scans, setScans] = useState<ComplianceScan[]>([]);
  const [executions, setExecutions] = useState<RemediationExecution[]>([]);
  const [scanStats, setScanStats] = useState<Record<string, { pass: number; fail: number; rules: number; hosts: number }>>({});
  const [profileMap, setProfileMap] = useState<Map<string, { name: string; certification: ScanCertification | null }>>(new Map());
  const [inventoryMap, setInventoryMap] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [compareSelection, setCompareSelection] = useState<{ groupKey: string; scanId: string } | null>(null);

  const refreshScans = useCallback(() => api.getScans().then(data => setScans(data)).catch(err => {
    console.error('Failed to refresh scans:', err);
  }), [api]);

  useEffect(() => {
    Promise.all([
      refreshScans(),
      api.getRegisteredProfiles().then(cs => {
        setProfileMap(new Map(cs.map(c => [c.id, { name: c.displayName, certification: c.certification }])));
      }).catch(() => {}),
      api.getInventories().then(invs => {
        setInventoryMap(new Map(invs.map(inv => [inv.id, inv.name])));
      }).catch(() => {}),
      api.getAllRecentExecutions(50).then(execs => setExecutions(execs)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [api]);

  // Fetch stats for completed scans
  useEffect(() => {
    const completedIds = scans.filter(s => s.status === 'completed').map(s => s.id);
    if (completedIds.length === 0) return;
    api.getBatchScanStats(completedIds).then(stats => setScanStats(stats)).catch(() => {});
  }, [api, scans]);

  // Auto-expand first group on initial load
  useEffect(() => {
    if (expandedGroups.size === 0 && scans.length > 0) {
      const firstScan = scans[0];
      if (firstScan) {
        setExpandedGroups(new Set([`${firstScan.profileId}::${firstScan.inventoryId}`]));
      }
    }
  }, [scans]);

  // Compute authoritative scan IDs (latest completed assessment per profile×inventory)
  const authoritativeScanIds = useMemo(() => {
    const ids = new Set<string>();
    const seen = new Set<string>();
    const sorted = [...scans]
      .filter(s => s.status === 'completed' && s.scanner === 'oscap' && s.scanType === 'assessment')
      .sort((a, b) => new Date(b.completedAt || b.startedAt).getTime() - new Date(a.completedAt || a.startedAt).getTime());
    for (const s of sorted) {
      const key = `${s.profileId}::${s.inventoryId}`;
      if (!seen.has(key)) {
        seen.add(key);
        ids.add(s.id);
      }
    }
    return ids;
  }, [scans]);

  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const activeScans = scans.filter(
    s => (s.status === 'pending' || s.status === 'running') && s.startedAt > oneHourAgo,
  );

  useEffect(() => {
    if (activeScans.length === 0) return;
    const interval = setInterval(refreshScans, 10_000);
    return () => clearInterval(interval);
  }, [activeScans.length, refreshScans]);

  // Build grouped view
  const groups = useMemo<ScanGroup[]>(() => {
    const groupMap = new Map<string, ScanGroup>();

    // Add scans to groups
    for (const scan of scans) {
      if (scan.scanner === 'remediation') continue;
      const key = `${scan.profileId}::${scan.inventoryId}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          profileId: scan.profileId,
          inventoryId: scan.inventoryId,
          profileName: profileMap.get(scan.profileId)?.name || scan.profileId,
          inventoryName: inventoryMap.get(scan.inventoryId) || `Inventory #${scan.inventoryId}`,
          certification: profileMap.get(scan.profileId)?.certification || null,
          items: [],
        });
      }
      groupMap.get(key)!.items.push({
        type: 'scan',
        scan,
        stats: scanStats[scan.id],
      });
    }

    // Add executions to groups
    for (const exec of executions) {
      // Find the group by inventory — executions have inventoryId but not profileId directly
      // Match by checking which group has this inventoryId
      for (const [, group] of groupMap) {
        if (group.inventoryId === exec.inventoryId) {
          group.items.push({ type: 'execution', execution: exec });
        }
      }
    }

    // Sort items within each group by date descending
    for (const group of groupMap.values()) {
      group.items.sort((a, b) => {
        const dateA = a.type === 'scan' ? a.scan.startedAt : a.execution.startedAt;
        const dateB = b.type === 'scan' ? b.scan.startedAt : b.execution.startedAt;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
    }

    // Sort groups: most recently active first
    let sorted = Array.from(groupMap.values()).sort((a, b) => {
      const latestA = a.items[0];
      const latestB = b.items[0];
      const dateA = latestA?.type === 'scan' ? latestA.scan.startedAt : latestA?.execution.startedAt || '';
      const dateB = latestB?.type === 'scan' ? latestB.scan.startedAt : latestB?.execution.startedAt || '';
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    if (filterByProfile) {
      sorted = sorted.filter(g => g.profileId === filterByProfile);
    }

    return sorted;
  }, [scans, executions, scanStats, profileMap, inventoryMap, filterByProfile]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleScanClick = (scan: ComplianceScan) => {
    const jobId = scan.workflowJobId ?? scan.id;
    navigate(`/compliance/results/${jobId}`);
  };

  const handleCompareClick = (groupKey: string, scanId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (compareSelection?.groupKey === groupKey && compareSelection.scanId !== scanId) {
      // Second scan selected — navigate to diff view
      navigate(`/compliance/results/${compareSelection.scanId}?compareTo=${scanId}`);
      setCompareSelection(null);
    } else {
      setCompareSelection({ groupKey, scanId });
    }
  };

  if (loading) return <Progress />;

  return (
    <InfoCard title="Scan History">
      <div className={classes.headerRow}>
        <Typography variant="body2" color="textSecondary">
          {viewMode === 'grouped'
            ? 'Scans grouped by compliance profile and inventory. Click to view findings.'
            : 'All scans and remediations in chronological order. Click to view details.'}
        </Typography>
        <Box display="flex" style={{ gap: 8 }}>
          <div className={classes.viewToggle}>
            <Tooltip title="Grouped view">
              <IconButton
                size="small"
                color={viewMode === 'grouped' ? 'primary' : 'default'}
                onClick={() => setViewMode('grouped')}
              >
                <ViewModuleIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Timeline">
              <IconButton
                size="small"
                color={viewMode === 'flat' ? 'primary' : 'default'}
                onClick={() => setViewMode('flat')}
              >
                <ListIcon />
              </IconButton>
            </Tooltip>
          </div>
          <Button
            variant="contained"
            color="primary"
            startIcon={<PlayCircleFilledIcon />}
            onClick={() => navigate('/compliance/scan')}
          >
            New Scan
          </Button>
        </Box>
      </div>

      {activeScans.map(scan => scan.workflowJobId && (
        <ScanProgress
          key={scan.id}
          workflowJobId={scan.workflowJobId}
          profileName={profileMap.get(scan.profileId)?.name || scan.profileId}
          onComplete={() => {
            setTimeout(refreshScans, 2000);
          }}
        />
      ))}

      {compareSelection && (
        <Box mb={1}>
          <Chip
            label="Select another scan to compare"
            onDelete={() => setCompareSelection(null)}
            color="primary"
            variant="outlined"
            size="small"
            icon={<CompareArrowsIcon />}
          />
        </Box>
      )}

      {scans.length === 0 ? (
        <div className={classes.emptyState}>
          <SearchIcon style={{ fontSize: 64, color: '#6A6E73', marginBottom: 16 }} />
          <Typography variant="h6" color="textSecondary" gutterBottom>
            No scans yet
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            Launch a compliance scan to see results here. Each scan evaluates
            your infrastructure against a compliance profile and produces
            per-host findings.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            onClick={() => navigate('/compliance/scan')}
          >
            Launch a Scan
          </Button>
        </div>
      ) : viewMode === 'grouped' ? (
        /* ─── Grouped View ──────────────────────────────────────────── */
        groups.length === 0 ? (
          <Typography variant="body2" color="textSecondary" style={{ padding: 24, textAlign: 'center' }}>
            No scans match the current filter.
          </Typography>
        ) : (
          groups.map(group => {
            const key = `${group.profileId}::${group.inventoryId}`;
            const isExpanded = expandedGroups.has(key);
            const latestScan = group.items.find(i => i.type === 'scan' && i.scan.status === 'completed') as
              | { type: 'scan'; scan: ComplianceScan; stats?: { pass: number; fail: number; rules: number; hosts: number } }
              | undefined;
            const scanCount = group.items.filter(i => i.type === 'scan').length;
            const execCount = group.items.filter(i => i.type === 'execution').length;

            return (
              <Accordion
                key={key}
                className={classes.groupAccordion}
                expanded={isExpanded}
                onChange={() => toggleGroup(key)}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <div className={classes.groupHeader}>
                    <div className={classes.groupTitle}>
                      <Typography variant="body1" style={{ fontWeight: 600 }}>
                        {group.profileName}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        {group.inventoryName}
                        {group.certification && (
                          <CertificationBadge certification={group.certification} style={{ marginLeft: 8 }} />
                        )}
                      </Typography>
                    </div>
                    <div className={classes.groupStats}>
                      {latestScan?.stats && (
                        <Chip
                          label={`${Math.round((latestScan.stats.pass / (latestScan.stats.pass + latestScan.stats.fail || 1)) * 100)}% pass`}
                          size="small"
                          variant="outlined"
                          style={{
                            borderColor: latestScan.stats.pass / (latestScan.stats.pass + latestScan.stats.fail || 1) >= 0.8 ? '#3E8635' : '#C9190B',
                            color: latestScan.stats.pass / (latestScan.stats.pass + latestScan.stats.fail || 1) >= 0.8 ? '#3E8635' : '#C9190B',
                          }}
                        />
                      )}
                      <Typography variant="caption" color="textSecondary">
                        {scanCount} scan{scanCount !== 1 ? 's' : ''}
                        {execCount > 0 && `, ${execCount} remediation${execCount !== 1 ? 's' : ''}`}
                      </Typography>
                    </div>
                  </div>
                </AccordionSummary>
                <AccordionDetails style={{ padding: 0 }}>
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        {group.items.map((item, idx) => {
                          if (item.type === 'scan') {
                            const { scan, stats } = item;
                            const isAuthoritative = latestScan?.scan.id === scan.id;
                            const isCompareSelected = compareSelection?.groupKey === key && compareSelection.scanId === scan.id;

                            return (
                              <TableRow
                                key={scan.id}
                                className={classes.clickableRow}
                                onClick={() => handleScanClick(scan)}
                                selected={isCompareSelected}
                              >
                                <TableCell width={40} style={{ paddingLeft: 24 }}>
                                  <StatusIcon status={scan.status} />
                                </TableCell>
                                <TableCell width={120}>
                                  <Chip
                                    icon={scan.scanType === 'verification' ? <VerifiedUserIcon /> : <AssessmentIcon />}
                                    label={scan.scanType === 'verification' ? 'Verification' : 'Assessment'}
                                    size="small"
                                    variant="outlined"
                                    style={scan.scanType === 'verification' ? { borderColor: '#0066CC', color: '#0066CC' } : undefined}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Box display="flex" alignItems="center" style={{ gap: 4 }}>
                                    {isAuthoritative && (
                                      <Tooltip title="Authoritative scan (latest completed)">
                                        <StarIcon style={{ fontSize: 16, color: '#F0AB00' }} />
                                      </Tooltip>
                                    )}
                                    <Typography
                                      variant="body2"
                                      className={isAuthoritative ? classes.authoritative : undefined}
                                    >
                                      #{scan.workflowJobId || scan.id.slice(0, 8)}
                                    </Typography>
                                  </Box>
                                </TableCell>
                                <TableCell>
                                  {stats ? (
                                    <Typography variant="body2">
                                      {stats.rules} rules · {stats.pass} pass · {stats.fail} fail · {stats.hosts} hosts
                                    </Typography>
                                  ) : scan.status === 'completed' ? (
                                    <Typography variant="caption" color="textSecondary">Loading stats...</Typography>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  <Typography variant="caption" color="textSecondary">
                                    {formatRelativeDate(scan.startedAt)}
                                  </Typography>
                                </TableCell>
                                <TableCell width={40}>
                                  {scan.status === 'completed' && (
                                    <Tooltip title={compareSelection?.groupKey === key ? 'Compare with selected scan' : 'Compare scans'}>
                                      <IconButton
                                        size="small"
                                        className={compareSelection?.groupKey === key ? undefined : classes.compareBtn}
                                        color={isCompareSelected ? 'primary' : 'default'}
                                        onClick={e => handleCompareClick(key, scan.id, e)}
                                      >
                                        <CompareArrowsIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          }

                          // Execution row
                          const { execution } = item;
                          return (
                            <TableRow
                              key={execution.id}
                              className={`${classes.clickableRow} ${classes.executionRow}`}
                              onClick={() => {
                                if (execution.primaryJobId) {
                                  navigate(`/compliance/remediation-result/${execution.primaryJobId}`);
                                }
                              }}
                            >
                              <TableCell width={40} style={{ paddingLeft: 24 }}>
                                <StatusIcon status={execution.status} />
                              </TableCell>
                              <TableCell width={120}>
                                <Chip
                                  icon={<BuildIcon />}
                                  label="Remediation"
                                  size="small"
                                  variant="outlined"
                                  style={{ borderColor: execStatusColor[execution.status] || '#6A6E73', color: execStatusColor[execution.status] || '#6A6E73' }}
                                />
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">
                                  #{execution.primaryJobId || execution.id.slice(0, 8)}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">
                                  {execution.rulesApplied ?? '?'} rules · {execution.hostsTargeted ?? '?'} hosts
                                  {execution.elapsedSeconds ? ` · ${Math.round(execution.elapsedSeconds)}s` : ''}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="caption" color="textSecondary">
                                  {formatRelativeDate(execution.startedAt)}
                                </Typography>
                              </TableCell>
                              <TableCell width={40} />
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>
            );
          })
        )
      ) : (
        /* ─── Flat View (original) ──────────────────────────────────── */
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Profile</TableCell>
                <TableCell>Scanner</TableCell>
                <TableCell>Workflow Job</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Completed</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {scans.map(scan => (
                <TableRow
                  key={scan.id}
                  className={classes.clickableRow}
                  onClick={() => {
                    const jobId = scan.workflowJobId ?? scan.id;
                    if (scan.scanner === 'remediation') {
                      navigate(`/compliance/remediation-result/${scan.workflowJobId ?? scan.id}`);
                    } else {
                      navigate(`/compliance/results/${jobId}`);
                    }
                  }}
                >
                  <TableCell>
                    <Box display="flex" alignItems="center" style={{ gap: 8 }}>
                      <StatusIcon status={scan.status} />
                      <Chip
                        label={scan.status.charAt(0).toUpperCase() + scan.status.slice(1)}
                        size="small"
                        color={statusColor[scan.status] ?? 'default'}
                        variant="outlined"
                        className={classes.statusChip}
                      />
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={scan.scanner === 'remediation' ? <BuildIcon /> : scan.scanType === 'verification' ? <VerifiedUserIcon /> : <AssessmentIcon />}
                      label={scan.scanner === 'remediation' ? 'Remediation' : scan.scanType === 'verification' ? 'Verification' : 'Assessment'}
                      size="small"
                      variant="outlined"
                      style={{
                        borderColor: scan.scanner === 'remediation' ? '#3E8635' : scan.scanType === 'verification' ? '#0066CC' : undefined,
                        color: scan.scanner === 'remediation' ? '#3E8635' : scan.scanType === 'verification' ? '#0066CC' : undefined,
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" style={{ fontWeight: 500 }}>
                      {profileMap.get(scan.profileId)?.name || scan.profileId}
                    </Typography>
                    {profileMap.get(scan.profileId)?.certification && (
                      <CertificationBadge certification={profileMap.get(scan.profileId)!.certification} style={{ marginTop: 4 }} />
                    )}
                  </TableCell>
                  <TableCell>{scan.scanner}</TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center" style={{ gap: 4 }}>
                      {authoritativeScanIds.has(scan.id) && (
                        <Tooltip title="Authoritative scan (latest completed assessment)">
                          <StarIcon style={{ fontSize: 16, color: '#F0AB00' }} />
                        </Tooltip>
                      )}
                      {scan.workflowJobId ? `#${scan.workflowJobId}` : '--'}
                    </Box>
                  </TableCell>
                  <TableCell>{formatDate(scan.startedAt)}</TableCell>
                  <TableCell>
                    {scan.completedAt ? formatDate(scan.completedAt) : '--'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </InfoCard>
  );
};
