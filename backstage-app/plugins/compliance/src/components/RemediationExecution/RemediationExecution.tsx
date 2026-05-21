import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  InfoCard,
  Breadcrumbs,
  StatusOK,
  StatusError,
  StatusRunning,
  StatusPending,
  Progress,
} from '@backstage/core-components';
import {
  Grid,
  Typography,
  Button,
  Box,
  LinearProgress,
  Chip,
  Collapse,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Stepper,
  Step,
  StepLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  makeStyles,
} from '@material-ui/core';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import RefreshIcon from '@material-ui/icons/Refresh';
import { useApi } from '@backstage/core-plugin-api';
import { complianceApiRef } from '../../api';
import type { JobEvent, MultiHostFinding, RemediationSelection } from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  progressSection: {
    padding: theme.spacing(3),
    textAlign: 'center',
  },
  taskRow: {
    '&:last-child td': {
      borderBottom: 'none',
    },
  },
  elapsed: {
    fontFamily: 'monospace',
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(1),
  },
  ruleAccordion: {
    '&:before': {
      display: 'none',
    },
    boxShadow: 'none',
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  ruleAccordionSummary: {
    '& .MuiAccordionSummary-content': {
      alignItems: 'center',
      margin: `${theme.spacing(1)}px 0`,
    },
  },
  ruleHeader: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    gap: theme.spacing(2),
  },
  ruleTitle: {
    flex: 1,
    minWidth: 0,
  },
  ruleProgress: {
    width: 140,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  ruleProgressBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
  },
  ruleProgressLabel: {
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    minWidth: 36,
    textAlign: 'right',
  },
  taskTable: {
    '& td': {
      paddingTop: theme.spacing(0.5),
      paddingBottom: theme.spacing(0.5),
    },
  },
  pendingRule: {
    opacity: 0.6,
  },
  hostSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontSize: '0.85rem',
  },
  showAllLink: {
    color: theme.palette.primary.main,
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: '0.8rem',
    '&:hover': {
      textDecoration: 'underline',
    },
  },
}));

type ExecutionPhase = 'launching' | 'preparing' | 'running' | 'verifying' | 'complete' | 'failed';

const PHASES = ['Preparing', 'Remediating', 'Verifying', 'Complete'];

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface RemediationTask {
  name: string;
  stigId: string;
  /** The rule ID this task belongs to (e.g. 'sshd_set_idle_timeout'). Empty if unmatched. */
  ruleId: string;
  status: TaskStatus;
  hosts: Array<{ host: string; status: TaskStatus }>;
}

/** A group of tasks under a single compliance rule. */
interface RuleGroup {
  ruleId: string;
  stigId: string;
  title: string;
  tasks: RemediationTask[];
}

/** Terminal statuses where the workflow will not change further. */
const TERMINAL_STATUSES = ['successful', 'failed', 'error', 'canceled'];

/**
 * Compute overall progress percentage from workflow nodes.
 * Each node contributes equally to the total.
 */
function computeProgress(nodes: Array<{ status: string }>): number {
  if (nodes.length === 0) return 0;
  let pct = 0;
  const step = 100 / nodes.length;
  for (const n of nodes) {
    if (n.status === 'successful') pct += step;
    else if (n.status === 'running' || n.status === 'waiting') pct += step * 0.5;
    else if (n.status === 'failed' || n.status === 'error') pct += step;
  }
  return Math.round(pct);
}

/** Format seconds into human-readable elapsed time. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/**
 * Extract remediation tasks from Controller job events.
 *
 * Maps runner events (runner_on_ok, runner_on_failed, runner_on_start, etc.)
 * into task entries for the progress table. Tasks are matched to rule IDs
 * by checking for Ansible role names, task tags in event data, and
 * falling back to substring matching against known rule IDs.
 */
function extractTasksFromEvents(
  events: JobEvent[],
  knownRuleIds: string[],
): RemediationTask[] {
  const taskMap = new Map<string, RemediationTask>();

  for (const event of events) {
    const taskName = (event.event_data?.task as string) || '';
    if (!taskName) continue;
    if (taskName.toLowerCase() === 'gathering facts') continue;
    if (taskName.toLowerCase() === 'gather the package facts') continue;

    const stigMatch = taskName.match(/V-\d+/);
    const stigId = stigMatch ? stigMatch[0] : '';
    const hostName = event.host_name || (event.event_data?.host as string) || '';

    // Try to match this task to a known rule ID:
    // 1. Check event_data.role (CaC roles are named after rule IDs)
    // 2. Check task tags in event_data
    // 3. Check if the task name contains a known rule ID substring
    let ruleId = '';
    const role = (event.event_data?.role as string) || '';
    if (role && knownRuleIds.includes(role)) {
      ruleId = role;
    }
    if (!ruleId) {
      const taskTags = event.event_data?.task_tags as string | undefined;
      if (taskTags) {
        const tags = taskTags.split(',').map(t => t.trim());
        for (const tag of tags) {
          if (knownRuleIds.includes(tag)) {
            ruleId = tag;
            break;
          }
        }
      }
    }
    if (!ruleId) {
      const nameLower = taskName.toLowerCase().replace(/[\s-]/g, '_');
      for (const candidate of knownRuleIds) {
        if (nameLower.includes(candidate.toLowerCase())) {
          ruleId = candidate;
          break;
        }
      }
    }

    let hostStatus: TaskStatus = 'pending';
    if (event.event === 'runner_on_ok' || event.event === 'runner_on_skipped') {
      hostStatus = 'completed';
    } else if (event.event === 'runner_on_failed' || event.event === 'runner_on_unreachable') {
      hostStatus = 'failed';
    } else if (event.event === 'runner_on_start') {
      hostStatus = 'running';
    }

    const existing = taskMap.get(taskName);
    if (!existing) {
      taskMap.set(taskName, {
        name: taskName,
        stigId,
        ruleId,
        status: hostStatus,
        hosts: hostName ? [{ host: hostName, status: hostStatus }] : [],
      });
    } else {
      // Update ruleId if we found a better match
      if (!existing.ruleId && ruleId) {
        existing.ruleId = ruleId;
      }
      if (hostName) {
        const existingHost = existing.hosts.find(h => h.host === hostName);
        if (existingHost) {
          if (existingHost.status !== 'completed' && existingHost.status !== 'failed') {
            existingHost.status = hostStatus;
          }
        } else {
          existing.hosts.push({ host: hostName, status: hostStatus });
        }
      }
      const hasFailure = existing.hosts.some(h => h.status === 'failed');
      const allDone = existing.hosts.every(h => h.status === 'completed' || h.status === 'failed');
      if (hasFailure) existing.status = 'failed';
      else if (allDone && existing.hosts.length > 0) existing.status = 'completed';
      else if (existing.hosts.some(h => h.status === 'running')) existing.status = 'running';
    }
  }

  return Array.from(taskMap.values());
}

/**
 * Group tasks by rule using sequential assignment.
 *
 * CaC playbooks run tasks grouped by rule: all tasks for rule A, then
 * all tasks for rule B, etc. We identify "anchor" tasks that clearly
 * belong to a rule (their name starts with the rule title), then assign
 * all tasks between anchors to the same rule. Tasks before the first
 * anchor are pre-requisites (Gathering Facts, etc.).
 */
function groupTasksByRule(
  tasks: RemediationTask[],
  selections: RemediationSelection[],
  findingsMap: Map<string, MultiHostFinding>,
): RuleGroup[] {
  // Build a map of rule title prefixes for anchor detection
  const enabledRules = selections.filter(s => s.enabled);
  const ruleTitleMap = new Map<string, { ruleId: string; stigId: string; title: string }>();
  for (const sel of enabledRules) {
    const finding = findingsMap.get(sel.ruleId);
    const title = finding?.title || sel.ruleId;
    ruleTitleMap.set(sel.ruleId, {
      ruleId: sel.ruleId,
      stigId: finding?.stigId || '',
      title,
    });
  }

  // Sequential assignment: walk tasks in order, detect rule boundaries
  const prereqTasks: RemediationTask[] = [];
  const ruleTaskMap = new Map<string, RemediationTask[]>();
  let currentRuleId: string | null = null;

  for (const task of tasks) {
    const taskLower = task.name.toLowerCase();

    // Check if this task anchors to a new rule (title prefix match)
    let anchoredRule: string | null = null;
    for (const [ruleId, meta] of ruleTitleMap) {
      const prefix = meta.title.toLowerCase();
      if (prefix.length > 5 && taskLower.startsWith(prefix)) {
        anchoredRule = ruleId;
        break;
      }
    }

    if (anchoredRule) {
      currentRuleId = anchoredRule;
    }

    if (currentRuleId) {
      const existing = ruleTaskMap.get(currentRuleId) || [];
      existing.push(task);
      ruleTaskMap.set(currentRuleId, existing);
    } else {
      prereqTasks.push(task);
    }
  }

  // Build groups in selection order
  const groups: RuleGroup[] = [];

  if (prereqTasks.length > 0) {
    groups.push({
      ruleId: 'pre-requisite',
      stigId: '',
      title: 'Pre-Requisite Tasks',
      tasks: prereqTasks,
    });
  }

  for (const sel of enabledRules) {
    const meta = ruleTitleMap.get(sel.ruleId)!;
    groups.push({
      ruleId: sel.ruleId,
      stigId: meta.stigId,
      title: meta.title,
      tasks: ruleTaskMap.get(sel.ruleId) || [],
    });
  }

  return groups;
}

/** Compute per-rule progress as percentage of completed/failed tasks. */
function computeRuleProgress(group: RuleGroup, jobComplete: boolean = false): number {
  if (group.tasks.length === 0) return jobComplete ? 100 : 0;
  const done = group.tasks.filter(
    t => t.status === 'completed' || t.status === 'failed',
  ).length;
  return Math.round((done / group.tasks.length) * 100);
}

/** Compute overall status for a rule group. */
function computeRuleStatus(group: RuleGroup, jobComplete: boolean): TaskStatus {
  if (group.tasks.length === 0) return jobComplete ? 'completed' : 'pending';
  if (group.tasks.some(t => t.status === 'failed')) return 'failed';
  if (group.tasks.every(t => t.status === 'completed')) return 'completed';
  if (group.tasks.some(t => t.status === 'running')) return 'running';
  if (group.tasks.some(t => t.status === 'completed')) return 'running';
  return 'pending';
}

const HOST_CHIP_THRESHOLD = 10;

/**
 * Renders host chips for a task. For small host counts (<= 10), renders
 * individual Chip components. For large host counts (> 10), renders a
 * summary line with "Show all" toggle.
 */
const HostChips: React.FC<{
  hosts: Array<{ host: string; status: TaskStatus }>;
  classes: ReturnType<typeof useStyles>;
}> = ({ hosts, classes }) => {
  const [expanded, setExpanded] = useState(false);

  if (hosts.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        —
      </Typography>
    );
  }

  if (hosts.length <= HOST_CHIP_THRESHOLD) {
    return (
      <Box display="flex" flexWrap="wrap" style={{ gap: 4 }}>
        {hosts.map(h => (
          <Chip
            key={h.host}
            size="small"
            label={h.host}
            variant="outlined"
            style={{
              borderColor: h.status === 'failed' ? '#C9190B'
                : h.status === 'completed' ? '#3E8635'
                : undefined,
              color: h.status === 'failed' ? '#C9190B'
                : h.status === 'completed' ? '#3E8635'
                : undefined,
            }}
          />
        ))}
      </Box>
    );
  }

  // Large host count: summary view
  const completedHosts = hosts.filter(h => h.status === 'completed').length;
  const failedHosts = hosts.filter(h => h.status === 'failed').length;

  return (
    <div>
      <div className={classes.hostSummary}>
        <Typography variant="body2">
          {completedHosts}/{hosts.length} hosts completed
          {failedHosts > 0 && (
            <span style={{ color: '#C9190B' }}> ({failedHosts} failed)</span>
          )}
        </Typography>
        <span
          className={classes.showAllLink}
          onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setExpanded(!expanded); } }}
        >
          {expanded ? 'Hide hosts' : 'Show all'}
        </span>
      </div>
      <Collapse in={expanded}>
        <Box display="flex" flexWrap="wrap" style={{ gap: 4, marginTop: 4 }}>
          {hosts.map(h => (
            <Chip
              key={h.host}
              size="small"
              label={h.host}
              variant="outlined"
              style={{
                borderColor: h.status === 'failed' ? '#C9190B'
                  : h.status === 'completed' ? '#3E8635'
                  : undefined,
                color: h.status === 'failed' ? '#C9190B'
                  : h.status === 'completed' ? '#3E8635'
                  : undefined,
              }}
            />
          ))}
        </Box>
      </Collapse>
    </div>
  );
};

export const RemediationExecution = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<ExecutionPhase>('launching');
  const [progress, setProgress] = useState(0);
  const [tasks, setTasks] = useState<RemediationTask[]>([]);
  const [workflowJobId, setWorkflowJobId] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [overallStatus, setOverallStatus] = useState('pending');
  const completeFired = useRef(false);
  const [verificationLaunching, setVerificationLaunching] = useState(false);

  // Selections and findings for rule grouping
  const [selections, setSelections] = useState<RemediationSelection[]>([]);
  const [findingsMap, setFindingsMap] = useState<Map<string, MultiHostFinding>>(new Map());
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

  // Extract the remediation profile ID and scan ID from query params
  // (set by the RemediationProfileBuilder when "Apply Remediation" is clicked)
  const remediationProfileId = searchParams.get('profileId');
  const scanId = searchParams.get('scanId') ?? jobId;

  // Track the compliance profile and inventory used by this remediation
  // so we can auto-launch a verification scan without the wizard.
  const complianceProfileIdRef = useRef<string>('');
  const inventoryIdRef = useRef<number>(0);

  // Launch a verification scan using the same profile/inventory as the remediation.
  const launchVerificationScan = useCallback(async () => {
    setVerificationLaunching(true);
    try {
      // Resolve cartridge to get workflowTemplateId for the scan
      const cartridges = await api.getCartridges().catch(() => []);
      const cartridge = cartridges.find(c => c.id === complianceProfileIdRef.current);

      const result = await api.launchScan({
        profileId: complianceProfileIdRef.current,
        inventoryId: inventoryIdRef.current,
        evaluateOnly: true,
        scanType: 'verification',
        workflowTemplateId: cartridge?.workflowTemplateId ?? undefined,
      });
      navigate(`/compliance/results/${result.workflowJobId}`);
    } catch (err) {
      setVerificationLaunching(false);
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to launch verification scan',
      );
    }
  }, [api, navigate]);

  // Launch the remediation via the backend
  const launchRemediation = useCallback(async () => {
    try {
      // Load selections from the saved remediation profile
      let loadedSelections: RemediationSelection[] = [];

      if (remediationProfileId) {
        const profile = await api.getRemediationProfile(remediationProfileId);
        if (profile && profile.selections.length > 0) {
          loadedSelections = profile.selections;
          if (profile.complianceProfileId) {
            complianceProfileIdRef.current = profile.complianceProfileId;
          }
        }
      }

      // Resolve inventory ID from scan history or cartridge
      if (inventoryIdRef.current === 0) {
        try {
          const scans = await api.getScans();
          const relevantScan = scans.find(s => s.scanner === 'oscap' && s.status === 'completed');
          if (relevantScan) {
            inventoryIdRef.current = relevantScan.inventoryId;
          }
        } catch {
          // Fall through — will fail with validation error
        }
      }

      if (loadedSelections.length === 0) {
        setPhase('failed');
        setErrorMessage(
          'No rule selections found. Go back to the Remediation Profile Builder and select rules before applying.',
        );
        return;
      }

      // Store selections for rule grouping
      setSelections(loadedSelections);

      // Load findings to get rule titles, STIG IDs, etc.
      // Try with scanId first; if empty, load latest.
      try {
        let findings = await api.getFindings(scanId).catch(() => []);
        if (findings.length === 0) {
          findings = await api.getFindings().catch(() => []);
        }
        const fMap = new Map<string, MultiHostFinding>();
        for (const f of findings) {
          fMap.set(f.ruleId, f);
        }
        setFindingsMap(fMap);
      } catch {
        // Findings may not be available; rule groups will use ruleId as title
      }

      const result = await api.launchRemediation({
        profileId: complianceProfileIdRef.current,
        inventoryId: inventoryIdRef.current,
        selections: loadedSelections,
        scanId,
      });
      setWorkflowJobId(result.workflowJobId);
      setPhase('preparing');
    } catch (err) {
      setPhase('failed');
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to launch remediation workflow',
      );
    }
  }, [api, remediationProfileId, scanId]);

  useEffect(() => {
    launchRemediation();
  }, [launchRemediation]);

  // Derive known rule IDs from selections for task matching
  const knownRuleIds = useMemo(
    () => selections.filter(s => s.enabled).map(s => s.ruleId),
    [selections],
  );

  // Poll the remediate job directly (not a workflow — remediation
  // launches the JT with native job_tags for proper scoping).
  useEffect(() => {
    if (!workflowJobId) return undefined;

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const jobStatus = await api.getJobStatus(workflowJobId).catch(() => null);
        if (cancelled || !jobStatus) return;

        setOverallStatus(jobStatus.status);
        setElapsed(jobStatus.elapsed ?? 0);

        if (jobStatus.status === 'successful') {
          setPhase('complete');
          setProgress(100);
        } else if (jobStatus.status === 'running' || jobStatus.status === 'waiting') {
          setPhase('running');
        } else if (TERMINAL_STATUSES.includes(jobStatus.status)) {
          setPhase('failed');
          setErrorMessage(
            jobStatus.failed
              ? `Remediation failed after ${formatElapsed(jobStatus.elapsed ?? 0)}`
              : `Remediation ${jobStatus.status}`,
          );
          setProgress(100);
        }

        // Fetch task-level events directly from the job
        try {
          const events = await api.getJobEvents(workflowJobId);
          if (!cancelled) {
            const extracted = extractTasksFromEvents(events, knownRuleIds);
            if (extracted.length > 0) {
              setTasks(extracted);
              const done = extracted.filter(t => t.status === 'completed' || t.status === 'failed').length;
              if (jobStatus.status === 'running') {
                setProgress(Math.round((done / extracted.length) * 100));
              }
            }
          }
        } catch {
          // Job events may not be available yet
        }

        if (TERMINAL_STATUSES.includes(jobStatus.status) && !completeFired.current) {
          completeFired.current = true;
        }
      } catch {
        // API not available yet
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 5_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, workflowJobId, knownRuleIds]);

  // Group tasks by rule
  const ruleGroups = useMemo(
    () => groupTasksByRule(tasks, selections, findingsMap),
    [tasks, selections, findingsMap],
  );

  // Auto-expand rules that are currently running
  useEffect(() => {
    const running = ruleGroups
      .filter(g => computeRuleStatus(g, TERMINAL_STATUSES.includes(overallStatus)) === 'running')
      .map(g => g.ruleId);
    if (running.length > 0) {
      setExpandedRules(prev => {
        const next = new Set(prev);
        for (const id of running) next.add(id);
        return next;
      });
    }
  }, [ruleGroups, overallStatus]);

  const toggleRule = (ruleId: string) => {
    setExpandedRules(prev => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  const activeStep =
    phase === 'launching' || phase === 'preparing'
      ? 0
      : phase === 'running'
        ? 1
        : phase === 'verifying'
          ? 2
          : phase === 'complete'
            ? 3
            : // failed -- stay at whichever step was active
              progress < 33 ? 0 : progress < 66 ? 1 : 2;

  const statusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'completed':
        return <StatusOK />;
      case 'failed':
        return <StatusError />;
      case 'running':
        return <StatusRunning />;
      case 'pending':
        return <StatusPending />;
    }
  };

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;

  // Count rules that have all tasks completed
  const rulesCompleted = ruleGroups.filter(
    g => g.ruleId !== 'pre-requisite' && computeRuleProgress(g) === 100,
  ).length;
  const totalRules = ruleGroups.filter(g => g.ruleId !== 'pre-requisite').length;

  return (
    <>
      <Breadcrumbs>
          <Typography
            color="primary"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/compliance')}
          >
            Compliance
          </Typography>
          <Typography
            color="primary"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/compliance/results/${jobId}`)}
          >
            Scan Results
          </Typography>
          <Typography>Remediation</Typography>
        </Breadcrumbs>

        <Box mt={3} />

        <Grid container spacing={3}>
          {/* Progress Stepper */}
          <Grid item xs={12}>
            <Stepper activeStep={activeStep} alternativeLabel>
              {PHASES.map((label, i) => (
                <Step key={label} completed={activeStep > i}>
                  <StepLabel
                    error={phase === 'failed' && activeStep === i}
                  >
                    {label}
                  </StepLabel>
                </Step>
              ))}
            </Stepper>
          </Grid>

          {/* Progress Bar */}
          {phase !== 'complete' && (
            <Grid item xs={12}>
              <InfoCard>
                <div className={classes.progressSection}>
                  {phase === 'launching' && (
                    <>
                      <Progress />
                      <Typography variant="body1" style={{ marginTop: 16 }}>
                        Launching remediation workflow...
                      </Typography>
                    </>
                  )}
                  {phase === 'preparing' && (
                    <>
                      <Progress />
                      <Typography variant="body1" style={{ marginTop: 16 }}>
                        Preparing remediation workflow...
                      </Typography>
                      {elapsed > 0 && (
                        <Typography variant="body2" className={classes.elapsed}>
                          Elapsed: {formatElapsed(elapsed)}
                        </Typography>
                      )}
                    </>
                  )}
                  {phase === 'running' && (
                    <>
                      <Typography variant="h6" gutterBottom>
                        Applying remediations — {progress}%
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={progress}
                        style={{ height: 10, borderRadius: 5 }}
                      />
                      <Typography
                        variant="body2"
                        color="textSecondary"
                        style={{ marginTop: 8 }}
                      >
                        {totalRules > 0
                          ? `${rulesCompleted}/${totalRules} rules complete, ${completedCount}/${tasks.length} tasks${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
                          : tasks.length > 0
                            ? `${completedCount}/${tasks.length} tasks complete${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
                            : `${progress}% complete`}
                      </Typography>
                      <Typography variant="body2" className={classes.elapsed}>
                        Elapsed: {formatElapsed(elapsed)}
                      </Typography>
                    </>
                  )}
                  {phase === 'failed' && (
                    <>
                      <Typography variant="h6" color="error" gutterBottom>
                        Remediation {overallStatus === 'canceled' ? 'Cancelled' : 'Failed'}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {errorMessage ||
                          (overallStatus === 'canceled'
                            ? `${completedCount} of ${tasks.length || '?'} tasks were applied before cancellation.`
                            : 'The remediation workflow encountered an error.')}
                      </Typography>
                      {elapsed > 0 && (
                        <Typography variant="body2" className={classes.elapsed}>
                          Elapsed: {formatElapsed(elapsed)}
                        </Typography>
                      )}
                      <Box mt={2} display="flex" style={{ gap: 16 }} justifyContent="center">
                        <Button
                          variant="outlined"
                          onClick={() => navigate(`/compliance/remediation/${jobId}`)}
                        >
                          Back to Profile Builder
                        </Button>
                        <Button
                          variant="contained"
                          color="primary"
                          disabled={verificationLaunching}
                          onClick={launchVerificationScan}
                        >
                          {verificationLaunching ? 'Launching...' : 'Run Verification Scan'}
                        </Button>
                      </Box>
                    </>
                  )}
                  {phase === 'verifying' && (
                    <>
                      <Progress />
                      <Typography variant="body1" style={{ marginTop: 16 }}>
                        Running verification scan to confirm remediation results...
                      </Typography>
                    </>
                  )}
                </div>
              </InfoCard>
            </Grid>
          )}

          {/* Completion Summary */}
          {phase === 'complete' && (
            <>
              <Grid item xs={12}>
                <InfoCard
                  title="Remediation Complete"
                  action={
                    <Chip
                      icon={<CheckCircleIcon />}
                      label={failedCount > 0 ? 'Completed with errors' : 'Successful'}
                      style={{
                        backgroundColor: failedCount > 0 ? '#ff9800' : '#4caf50',
                        color: '#fff',
                      }}
                    />
                  }
                >
                  <Box textAlign="center" py={2}>
                    <Typography variant="h6" gutterBottom>
                      {completedCount} of {tasks.length || '?'} tasks completed successfully
                      {failedCount > 0 && ` (${failedCount} failed)`}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Total elapsed time: {formatElapsed(elapsed)}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
                      Run a verification scan to confirm the remediation results and
                      see updated compliance scores.
                    </Typography>
                  </Box>
                </InfoCard>
              </Grid>

              <Grid item xs={12}>
                <Box display="flex" justifyContent="flex-end" style={{ gap: 16 }}>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    disabled={verificationLaunching}
                    onClick={launchVerificationScan}
                  >
                    {verificationLaunching ? 'Launching...' : 'Run Verification Scan'}
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => navigate('/compliance')}
                  >
                    Back to Dashboard
                  </Button>
                </Box>
              </Grid>
            </>
          )}

          {/* Rule-Grouped Task List */}
          {ruleGroups.length > 0 && (
            <Grid item xs={12}>
              <InfoCard title="Remediation Progress">
                {ruleGroups.map(group => {
                  const pct = computeRuleProgress(group, TERMINAL_STATUSES.includes(overallStatus));
                  const ruleStatus = computeRuleStatus(group, TERMINAL_STATUSES.includes(overallStatus));
                  const isExpanded = expandedRules.has(group.ruleId);
                  const hasTasks = group.tasks.length > 0;

                  return (
                    <Accordion
                      key={group.ruleId}
                      className={`${classes.ruleAccordion} ${!hasTasks && ruleStatus === 'pending' ? classes.pendingRule : ''}`}
                      expanded={isExpanded}
                      onChange={() => toggleRule(group.ruleId)}
                    >
                      <AccordionSummary
                        expandIcon={hasTasks ? <ExpandMoreIcon /> : undefined}
                        className={classes.ruleAccordionSummary}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${group.title}`}
                      >
                        <div className={classes.ruleHeader}>
                          <Box display="flex" alignItems="center" style={{ minWidth: 24 }}>
                            {statusIcon(ruleStatus)}
                          </Box>
                          <div className={classes.ruleTitle}>
                            <Typography variant="body2" style={{ fontWeight: 500 }}>
                              {group.ruleId !== 'pre-requisite' ? (
                                <>
                                  <span style={{ fontFamily: 'monospace' }}>{group.ruleId}</span>
                                  {group.stigId && (
                                    <span style={{ fontFamily: 'monospace', marginLeft: 8, opacity: 0.7 }}>
                                      ({group.stigId})
                                    </span>
                                  )}
                                </>
                              ) : (
                                group.title
                              )}
                            </Typography>
                            {group.ruleId !== 'pre-requisite' && (
                              <Typography variant="caption" color="textSecondary">
                                {group.title}
                              </Typography>
                            )}
                          </div>
                          <div className={classes.ruleProgress}>
                            <LinearProgress
                              variant="determinate"
                              value={pct}
                              className={classes.ruleProgressBar}
                              color={
                                ruleStatus === 'failed' ? 'secondary' : 'primary'
                              }
                            />
                            <Typography
                              variant="caption"
                              className={classes.ruleProgressLabel}
                            >
                              {!hasTasks && ruleStatus === 'completed' ? 'Already Compliant' : `${pct}%`}
                            </Typography>
                          </div>
                        </div>
                      </AccordionSummary>
                      {hasTasks && (
                        <AccordionDetails style={{ padding: 0 }}>
                          <Table size="small" className={classes.taskTable}>
                            <TableBody>
                              {group.tasks.map((task, idx) => (
                                <TableRow
                                  key={`${task.name}-${idx}`}
                                  className={classes.taskRow}
                                >
                                  <TableCell width={40} style={{ paddingLeft: 24 }}>
                                    {statusIcon(task.status)}
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="body2">
                                      {task.name}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <HostChips hosts={task.hosts} classes={classes} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </AccordionDetails>
                      )}
                    </Accordion>
                  );
                })}
              </InfoCard>
            </Grid>
          )}

          {/* Placeholder: rules loaded but no task events yet */}
          {ruleGroups.length === 0 && selections.length > 0 && (phase === 'preparing' || phase === 'running') && (
            <Grid item xs={12}>
              <InfoCard title="Remediation Progress">
                {selections.filter(s => s.enabled).map(sel => {
                  const finding = findingsMap.get(sel.ruleId);
                  return (
                    <Box
                      key={sel.ruleId}
                      className={classes.pendingRule}
                      display="flex"
                      alignItems="center"
                      px={2}
                      py={1}
                      style={{ gap: 16, borderBottom: '1px solid rgba(0,0,0,0.12)' }}
                    >
                      <StatusPending />
                      <div style={{ flex: 1 }}>
                        <Typography variant="body2" style={{ fontWeight: 500, fontFamily: 'monospace' }}>
                          {sel.ruleId}
                          {finding?.stigId && (
                            <span style={{ marginLeft: 8, opacity: 0.7 }}>
                              ({finding.stigId})
                            </span>
                          )}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {finding?.title || 'Waiting for tasks...'}
                        </Typography>
                      </div>
                      <div className={classes.ruleProgress}>
                        <LinearProgress
                          variant="determinate"
                          value={0}
                          className={classes.ruleProgressBar}
                        />
                        <Typography variant="caption" className={classes.ruleProgressLabel}>
                          0%
                        </Typography>
                      </div>
                    </Box>
                  );
                })}
              </InfoCard>
            </Grid>
          )}

          {/* Empty state: no selections loaded yet */}
          {ruleGroups.length === 0 && selections.length === 0 && (phase === 'preparing' || phase === 'launching') && (
            <Grid item xs={12}>
              <InfoCard title="Remediation Progress">
                <Box p={3} textAlign="center">
                  <Typography variant="body2" color="textSecondary">
                    Waiting for workflow to start...
                  </Typography>
                </Box>
              </InfoCard>
            </Grid>
          )}

          {ruleGroups.length === 0 && selections.length === 0 && phase === 'running' && (
            <Grid item xs={12}>
              <InfoCard title="Remediation Progress">
                <Box p={3} textAlign="center">
                  <Typography variant="body2" color="textSecondary">
                    Collecting task events from the automation controller...
                  </Typography>
                </Box>
              </InfoCard>
            </Grid>
          )}
        </Grid>
    </>
  );
};
