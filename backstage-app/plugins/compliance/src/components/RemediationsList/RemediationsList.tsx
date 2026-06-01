import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InfoCard,
  Progress,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
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
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Collapse,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  makeStyles,
  Tooltip,
} from '@material-ui/core';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import VisibilityIcon from '@material-ui/icons/Visibility';
import DeleteIcon from '@material-ui/icons/Delete';
import ArchiveIcon from '@material-ui/icons/Archive';
import UnarchiveIcon from '@material-ui/icons/Unarchive';
import SettingsIcon from '@material-ui/icons/Settings';
import AddIcon from '@material-ui/icons/Add';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import { complianceApiRef } from '../../api';
import type {
  RemediationProfile,
  RemediationExecution,
  RemediationProfileStatus,
  RemediationExecutionStatus,
} from '@aap-compliance/common';

type StatusFilter = 'active' | 'all' | 'draft' | 'archived';

const STATUS_CHIP_COLORS: Record<RemediationProfileStatus, { bg: string; fg: string }> = {
  draft: { bg: '#FFF3E0', fg: '#E65100' },
  saved: { bg: '#E8F5E9', fg: '#2E7D32' },
  archived: { bg: '#ECEFF1', fg: '#546E7A' },
};

const EXEC_CHIP_COLORS: Record<RemediationExecutionStatus, { bg: string; fg: string }> = {
  pending: { bg: '#FFF3E0', fg: '#E65100' },
  running: { bg: '#E3F2FD', fg: '#1565C0' },
  succeeded: { bg: '#E8F5E9', fg: '#2E7D32' },
  failed: { bg: '#FFEBEE', fg: '#C62828' },
  cancelled: { bg: '#ECEFF1', fg: '#546E7A' },
};

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
    gap: theme.spacing(2),
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(1),
  },
  statusFilter: {
    minWidth: 140,
  },
  nameCell: {
    fontWeight: 500,
  },
  actions: {
    display: 'flex',
    gap: theme.spacing(0.5),
  },
  statusChips: {
    display: 'flex',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap',
  },
  statusChip: {
    height: 22,
    fontSize: '0.75rem',
  },
  expandedRow: {
    backgroundColor: theme.palette.type === 'dark' ? '#1a1a1a' : '#FAFAFA',
  },
  executionTable: {
    '& th': {
      fontWeight: 600,
      fontSize: '0.75rem',
      padding: theme.spacing(0.5, 1),
    },
    '& td': {
      fontSize: '0.8rem',
      padding: theme.spacing(0.5, 1),
    },
  },
  muted: {
    color: theme.palette.text.secondary,
  },
}));

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function ExecutionHistoryRow({
  execution,
  inventoryNames,
}: {
  execution: RemediationExecution;
  inventoryNames: Map<number, string>;
}) {
  const classes = useStyles();
  const navigate = useNavigate();
  const execColor = EXEC_CHIP_COLORS[execution.status];

  return (
    <TableRow>
      <TableCell>{formatRelativeDate(execution.startedAt)}</TableCell>
      <TableCell>
        <Chip
          label={execution.status}
          size="small"
          className={classes.statusChip}
          style={{ backgroundColor: execColor.bg, color: execColor.fg }}
        />
      </TableCell>
      <TableCell>{inventoryNames.get(execution.inventoryId) || `Inventory #${execution.inventoryId}`}</TableCell>
      <TableCell>
        {execution.rulesApplied != null ? (
          <>
            {execution.rulesApplied}
            {execution.rulesFailed ? (
              <span style={{ color: '#C62828' }}> ({execution.rulesFailed} failed)</span>
            ) : null}
          </>
        ) : '—'}
      </TableCell>
      <TableCell>
        {execution.hostsTargeted != null ? (
          <>
            {execution.hostsTargeted}
            {execution.hostsFailed ? (
              <span style={{ color: '#C62828' }}> ({execution.hostsFailed} failed)</span>
            ) : null}
          </>
        ) : '—'}
      </TableCell>
      <TableCell>{formatDuration(execution.elapsedSeconds)}</TableCell>
      <TableCell>
        <div className={classes.actions}>
          {execution.verificationScanId && (
            <Chip label="Verified" size="small" className={classes.statusChip} style={{ backgroundColor: '#E8F5E9', color: '#2E7D32' }} />
          )}
          {execution.primaryJobId && (
            <Tooltip title="View execution details">
              <IconButton
                size="small"
                onClick={() => navigate(`/compliance/remediation-result/${execution.primaryJobId}`)}
              >
                <VisibilityIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export const RemediationsList = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);
  const [remediations, setRemediations] = useState<RemediationProfile[]>([]);
  const [profileNames, setProfileNames] = useState<Map<string, string>>(new Map());
  const [inventoryNames, setInventoryNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());
  const [executionHistory, setExecutionHistory] = useState<Map<string, RemediationExecution[]>>(new Map());
  const [deleteTarget, setDeleteTarget] = useState<RemediationProfile | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RemediationProfile | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  const { allowed: isAdmin } = usePermission({
    permission: catalogEntityCreatePermission,
  });

  const loadProfiles = useCallback(async () => {
    try {
      const backendFilter = statusFilter === 'active' ? undefined
        : statusFilter === 'all' ? undefined
        : statusFilter as RemediationProfileStatus;

      const [data, profiles, inventories] = await Promise.all([
        api.getRemediationProfiles(backendFilter),
        api.getRegisteredProfiles().catch(() => []),
        api.getInventories().catch(() => []),
      ]);

      let filtered = data;
      if (statusFilter === 'active') {
        filtered = data.filter(r => r.status !== 'archived');
      }

      setRemediations(filtered);
      setProfileNames(new Map(profiles.map(c => [c.id, c.displayName])));
      setInventoryNames(new Map(inventories.map(inv => [inv.id, inv.name])));
    } catch (err) {
      console.error('Failed to load remediation profiles:', err);
    } finally {
      setLoading(false);
    }
  }, [api, statusFilter]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const toggleExpanded = async (profileId: string) => {
    const next = new Set(expandedProfiles);
    if (next.has(profileId)) {
      next.delete(profileId);
    } else {
      next.add(profileId);
      if (!executionHistory.has(profileId)) {
        try {
          const execs = await api.getRemediationExecutions(profileId, 10);
          setExecutionHistory(prev => new Map(prev).set(profileId, execs));
        } catch (err) {
          console.error('Failed to load execution history:', err);
        }
      }
    }
    setExpandedProfiles(next);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionInProgress(true);
    try {
      await api.deleteRemediationProfile(deleteTarget.id);
      setRemediations(prev => prev.filter(r => r.id !== deleteTarget.id));
    } catch (err) {
      console.error('Failed to delete remediation profile:', err);
    } finally {
      setActionInProgress(false);
      setDeleteTarget(null);
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setActionInProgress(true);
    try {
      const newStatus = archiveTarget.status === 'archived' ? 'saved' : 'archived';
      await api.updateRemediationProfileStatus(archiveTarget.id, newStatus as RemediationProfileStatus);
      if (statusFilter === 'active' && newStatus === 'archived') {
        setRemediations(prev => prev.filter(r => r.id !== archiveTarget.id));
      } else {
        setRemediations(prev => prev.map(r => r.id === archiveTarget.id ? { ...r, status: newStatus as RemediationProfileStatus } : r));
      }
    } catch (err) {
      console.error('Failed to update profile status:', err);
    } finally {
      setActionInProgress(false);
      setArchiveTarget(null);
    }
  };

  if (loading) return <Progress />;

  return (
    <InfoCard title="Remediations">
      <div className={classes.headerRow}>
        <Typography variant="body2" color="textSecondary">
          Saved remediation profiles capture your rule selections. Launch them against any inventory.
        </Typography>
        <Button
          variant="outlined"
          color="primary"
          startIcon={<AddIcon />}
          onClick={() => navigate('/compliance/scan')}
        >
          New Scan
        </Button>
      </div>

      <div className={classes.filterRow}>
        <FormControl variant="outlined" size="small" className={classes.statusFilter}>
          <InputLabel id="status-filter-label">Filter</InputLabel>
          <Select
            labelId="status-filter-label"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            label="Filter"
          >
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="draft">Drafts</MenuItem>
            <MenuItem value="archived">Archived</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="caption" className={classes.muted}>
          {remediations.length} profile{remediations.length !== 1 ? 's' : ''}
        </Typography>
      </div>

      {remediations.length === 0 ? (
        <div className={classes.emptyState}>
          <SettingsIcon style={{ fontSize: 64, color: '#6A6E73', marginBottom: 16 }} />
          <Typography variant="h6" color="textSecondary" gutterBottom>
            {statusFilter === 'active' ? 'No active remediations' :
             statusFilter === 'draft' ? 'No drafts' :
             statusFilter === 'archived' ? 'No archived remediations' :
             'No remediations'}
          </Typography>
          <Typography variant="body2" color="textSecondary" paragraph>
            Run a compliance scan, review the findings, then save your rule selections
            as a remediation profile.
          </Typography>
          {statusFilter === 'active' && (
            <Button
              variant="contained"
              color="primary"
              onClick={() => navigate('/compliance/scan')}
            >
              Launch a Scan
            </Button>
          )}
        </div>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Name</TableCell>
                <TableCell>Profile</TableCell>
                <TableCell>Rules</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last Run</TableCell>
                <TableCell>Runs</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {remediations.map(r => {
                const isExpanded = expandedProfiles.has(r.id);
                const hasExecutions = (r.executionCount ?? 0) > 0;
                const profileColor = STATUS_CHIP_COLORS[r.status || 'saved'];
                const latestExec = r.latestExecution;
                const canDelete = r.status === 'draft' && !hasExecutions;
                const canArchive = r.status === 'saved' || r.status === 'archived';

                return (
                  <React.Fragment key={r.id}>
                    <TableRow hover>
                      <TableCell padding="checkbox">
                        {hasExecutions && (
                          <IconButton size="small" data-testid={`expand-${r.id}`} onClick={() => toggleExpanded(r.id)}>
                            {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                          </IconButton>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" className={classes.nameCell}>
                          {r.name}
                        </Typography>
                        {r.description && (
                          <Typography variant="caption" color="textSecondary">
                            {r.description}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={profileNames.get(r.complianceProfileId) || r.complianceProfileId}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        {r.selections.filter(s => s.enabled).length}
                      </TableCell>
                      <TableCell>
                        <div className={classes.statusChips}>
                          <Chip
                            label={r.status || 'saved'}
                            size="small"
                            className={classes.statusChip}
                            style={{ backgroundColor: profileColor.bg, color: profileColor.fg }}
                          />
                          {latestExec && (
                            <Chip
                              label={`${latestExec.status} · ${inventoryNames.get(latestExec.inventoryId) || `#${latestExec.inventoryId}`}`}
                              size="small"
                              className={classes.statusChip}
                              style={{
                                backgroundColor: EXEC_CHIP_COLORS[latestExec.status].bg,
                                color: EXEC_CHIP_COLORS[latestExec.status].fg,
                              }}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.lastExecutedAt ? formatRelativeDate(r.lastExecutedAt) : (
                          <span className={classes.muted}>Never</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.executionCount ?? 0}
                      </TableCell>
                      <TableCell>
                        <div className={classes.actions}>
                          <Tooltip title="Edit selections">
                            <IconButton
                              size="small"
                              onClick={() => navigate(`/compliance/remediation-edit/${r.id}`)}
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={r.status === 'archived' ? 'Archived — restore to launch' : 'Launch remediation'}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={r.status === 'archived'}
                                onClick={() => navigate(`/compliance/execute/${r.id}?profileId=${r.id}`)}
                              >
                                <PlayArrowIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          {canArchive && isAdmin && (
                            <Tooltip title={r.status === 'archived' ? 'Restore' : 'Archive'}>
                              <IconButton size="small" data-testid={`archive-${r.id}`} onClick={() => setArchiveTarget(r)}>
                                {r.status === 'archived' ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title={
                            !isAdmin ? 'Admin permission required' :
                            !canDelete && r.status !== 'draft' ? 'Only drafts can be deleted — archive instead' :
                            !canDelete ? 'Cannot delete profile with execution history' :
                            'Delete draft'
                          }>
                            <span>
                              <IconButton
                                size="small"
                                data-testid={`delete-${r.id}`}
                                disabled={!isAdmin || !canDelete}
                                onClick={() => setDeleteTarget(r)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                    {hasExecutions && (
                      <TableRow>
                        <TableCell style={{ padding: 0 }} colSpan={8}>
                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                            <Box px={2} py={1} className={classes.expandedRow}>
                              <Typography variant="subtitle2" gutterBottom>
                                Execution History
                              </Typography>
                              <Table size="small" className={classes.executionTable}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>When</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Inventory</TableCell>
                                    <TableCell>Rules</TableCell>
                                    <TableCell>Hosts</TableCell>
                                    <TableCell>Duration</TableCell>
                                    <TableCell />
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {(executionHistory.get(r.id) || []).map(exec => (
                                    <ExecutionHistoryRow
                                      key={exec.id}
                                      execution={exec}
                                      inventoryNames={inventoryNames}
                                    />
                                  ))}
                                  {!executionHistory.has(r.id) && (
                                    <TableRow>
                                      <TableCell colSpan={7}>
                                        <Typography variant="caption" className={classes.muted}>Loading...</Typography>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Draft</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={actionInProgress}>Cancel</Button>
          <Button variant="contained" color="secondary" onClick={handleDelete} disabled={actionInProgress}>
            {actionInProgress ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Archive/Restore confirmation dialog */}
      <Dialog open={!!archiveTarget} onClose={() => setArchiveTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{archiveTarget?.status === 'archived' ? 'Restore Profile' : 'Archive Profile'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {archiveTarget?.status === 'archived'
              ? <>Restore <strong>{archiveTarget?.name}</strong> to active remediations?</>
              : <>Archive <strong>{archiveTarget?.name}</strong>? It will be hidden from the default view but can be restored later.</>
            }
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveTarget(null)} disabled={actionInProgress}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleArchive} disabled={actionInProgress}>
            {actionInProgress ? 'Processing...' : archiveTarget?.status === 'archived' ? 'Restore' : 'Archive'}
          </Button>
        </DialogActions>
      </Dialog>
    </InfoCard>
  );
};
