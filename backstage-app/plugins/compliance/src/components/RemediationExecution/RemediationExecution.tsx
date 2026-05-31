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
): { groups: RuleGroup[]; approximateGrouping: boolean } {
  const PREREQ_TASKS = new Set([
    'gathering facts', 'gather the package facts', 'gather the service facts',
    'populate service facts',
  ]);

  const enabledRules = selections.filter(s => s.enabled);
  const enabledRuleIds = new Set(enabledRules.map(s => s.ruleId));
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

  /**
   * Extract significant words (>3 chars, lowercased) from a string,
   * filtering out common stop words that don't contribute to matching.
   */
  const extractWords = (text: string): string[] => {
    const stopWords = new Set(['with', 'from', 'that', 'this', 'have', 'been', 'will', 'should', 'must', 'shall', 'ensure', 'verify']);
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));
  };

  /**
   * Find which rule a task belongs to using multiple matching strategies:
   * 1. Prefix match: task name starts with the rule title (original STIG behavior)
   * 2. Substring match: rule title appears within the task name
   * 3. CIS section number: stigId (e.g. "1.4.1") appears in the task name
   * 4. Tokenized word overlap: 50%+ of title words appear in task name
   */
  const findAnchor = (taskLower: string): string | null => {
    // Strategy 1: Prefix match (works well for STIG)
    for (const [ruleId, meta] of ruleTitleMap) {
      const prefix = meta.title.toLowerCase();
      if (prefix.length > 5 && taskLower.startsWith(prefix)) return ruleId;
    }
    // Strategy 2: Substring match (rule title is contained in task name)
    for (const [ruleId, meta] of ruleTitleMap) {
      const title = meta.title.toLowerCase();
      if (title.length > 5 && taskLower.includes(title)) return ruleId;
    }
    // Strategy 3: CIS section number match (e.g. "1.4.1" in task name)
    for (const [ruleId, meta] of ruleTitleMap) {
      const sid = meta.stigId;
      if (sid && /^\d+\.\d+/.test(sid) && taskLower.includes(sid)) return ruleId;
    }
    // Strategy 4: Tokenized word overlap (>=50% of title words in task name)
    let bestMatch: string | null = null;
    let bestOverlap = 0;
    for (const [ruleId, meta] of ruleTitleMap) {
      const titleWords = extractWords(meta.title);
      if (titleWords.length < 2) continue;
      const taskWords = new Set(extractWords(taskLower));
      const overlap = titleWords.filter(w => taskWords.has(w)).length;
      const ratio = overlap / titleWords.length;
      if (ratio >= 0.5 && overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = ruleId;
      }
    }
    if (bestMatch) return bestMatch;
    return null;
  };

  // Phase 1: Identify prereq tasks — all tasks before the first rule-anchored
  // task are treated as prereqs. This handles both STIG and CIS playbooks
  // regardless of their specific prereq task naming conventions.
  const prereqTasks: RemediationTask[] = [];
  let firstRuleTaskIdx = tasks.length;
  for (let i = 0; i < tasks.length; i++) {
    // Check pre-computed ruleId from event_data.role first
    if (tasks[i].ruleId && enabledRuleIds.has(tasks[i].ruleId)) {
      firstRuleTaskIdx = i;
      break;
    }
    const taskLower = tasks[i].name.toLowerCase();
    if (findAnchor(taskLower) !== null) {
      firstRuleTaskIdx = i;
      break;
    }
    prereqTasks.push(tasks[i]);
  }

  // Phase 2: Try title-prefix matching for remaining tasks
  const ruleTaskMap = new Map<string, RemediationTask[]>();
  let currentRuleId: string | null = null;
  let titleMatchCount = 0;

  for (let i = firstRuleTaskIdx; i < tasks.length; i++) {
    const task = tasks[i];
    const anchoredRule = (task.ruleId && enabledRuleIds.has(task.ruleId))
      ? task.ruleId
      : findAnchor(task.name.toLowerCase());

    if (anchoredRule) {
      currentRuleId = anchoredRule;
      titleMatchCount++;
    }

    if (currentRuleId) {
      const existing = ruleTaskMap.get(currentRuleId) || [];
      existing.push(task);
      ruleTaskMap.set(currentRuleId, existing);
    }
  }

  // Phase 3: If title matching left unassigned tasks, fall back to
  // positional assignment. CaC playbooks run tasks in job_tags order,
  // so tasks between anchors belong to rules in selection order.
  const assignedCount = Array.from(ruleTaskMap.values()).reduce((s, t) => s + t.length, 0);
  const remainingTasks = tasks.length - firstRuleTaskIdx;
  let approximateGrouping = false;

  if (assignedCount < remainingTasks || titleMatchCount === 0) {
    ruleTaskMap.clear();
    const ruleOrder = enabledRules.map(s => s.ruleId);
    let ruleIdx = 0;
    currentRuleId = ruleOrder[0] ?? null;

    for (let i = firstRuleTaskIdx; i < tasks.length; i++) {
      const task = tasks[i];
      const anchoredRule = (task.ruleId && enabledRuleIds.has(task.ruleId))
        ? task.ruleId
        : findAnchor(task.name.toLowerCase());

      if (anchoredRule) {
        const idx = ruleOrder.indexOf(anchoredRule);
        if (idx >= 0) {
          ruleIdx = idx;
          currentRuleId = ruleOrder[ruleIdx];
        }
      }

      if (currentRuleId) {
        const existing = ruleTaskMap.get(currentRuleId) || [];
        existing.push(task);
        ruleTaskMap.set(currentRuleId, existing);
      }
    }

    approximateGrouping = titleMatchCount < enabledRules.length;
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

  return { groups, approximateGrouping };
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

export const RemediationExecution = ({ viewMode }: { viewMode?: boolean } = {}) => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const isViewMode = viewMode ?? false;
  const [phase, setPhase] = useState<ExecutionPhase>('launching');
  const [progress, setProgress] = useState(0);
  const [tasks, setTasks] = useState<RemediationTask[]>([]);
  const [workflowJobId, setWorkflowJobId] = useState<number | null>(null);
  const [allJobIds, setAllJobIds] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [overallStatus, setOverallStatus] = useState('pending');
  const launchFired = useRef(false);
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
      // Resolve profile to get workflowTemplateId for the scan
      const profiles = await api.getRegisteredProfiles().catch(() => []);
      const profile = profiles.find(c => c.id === complianceProfileIdRef.current);

      const result = await api.launchScan({
        profileId: complianceProfileIdRef.current,
        inventoryId: inventoryIdRef.current,
        evaluateOnly: true,
        scanType: 'verification',
        workflowTemplateId: profile?.workflowTemplateId ?? undefined,
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
    if (launchFired.current) return;
    launchFired.current = true;
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

      // Resolve inventory ID from scan history or profile
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
      setAllJobIds(result.allJobIds ?? [result.workflowJobId]);
      setPhase('preparing');
      // Replace URL so page refresh enters view mode instead of re-launching
      window.history.replaceState(null, '', `/compliance/remediation-result/${result.workflowJobId}`);
    } catch (err) {
      setPhase('failed');
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to launch remediation workflow',
      );
    }
  }, [api, remediationProfileId, scanId]);

  useEffect(() => {
    if (isViewMode && jobId) {
      // View mode: don't launch, just start polling the existing job
      const numericId = Number(jobId);
      if (!Number.isNaN(numericId)) {
        setWorkflowJobId(numericId);
        setPhase('running');
      } else {
        // Non-numeric jobId — look up from scan record
        api.getScans().then(scans => {
          const match = scans.find(s => s.id === jobId);
          if (match?.workflowJobId) {
            setWorkflowJobId(match.workflowJobId);
            setPhase('running');
          }
        }).catch(() => {});
      }
      // Load findings for rule grouping + resolve context for verification scan
      const loadContext = async () => {
        try {
          // Resolve numeric job ID — might be a UUID from the route
          const scans = await api.getScans().catch(() => []);
          let resolvedJobId = !Number.isNaN(Number(jobId)) ? Number(jobId) : null;
          if (!resolvedJobId) {
            const match = scans.find(s => s.id === jobId);
            if (match?.workflowJobId) resolvedJobId = match.workflowJobId;
          }

          // Find the assessment scan this remediation is based on
          const scanRecord = resolvedJobId
            ? scans.find(s => s.workflowJobId === resolvedJobId)
            : scans.find(s => s.id === jobId);
          let findingsScanId: string | undefined;
          if (scanRecord) {
            const assessmentScan = scans
              .filter(s => s.profileId === scanRecord.profileId && s.scanner !== 'remediation' && s.status === 'completed')
              .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
            findingsScanId = assessmentScan?.id;
          }

          const [findings, jobStatus] = await Promise.all([
            (findingsScanId ? api.getFindings(findingsScanId) : api.getFindings()).catch(() => []),
            resolvedJobId ? api.getJobStatus(resolvedJobId).catch(() => null) : Promise.resolve(null),
          ]);

          const fMap = new Map<MultiHostFinding['ruleId'], MultiHostFinding>();
          findings.forEach(f => fMap.set(f.ruleId, f));
          setFindingsMap(fMap);

          // Derive selections from findings, filtered by job_tags if available.
          // job_tags tells us exactly which rules the remediation applied.
          if (findings.length > 0) {
            const jobTags = jobStatus?.job_tags;
            if (jobTags) {
              const tagSet = new Set(jobTags.split(',').map(t => t.trim()).filter(Boolean));
              setSelections(findings.map(f => ({
                ruleId: f.ruleId,
                enabled: tagSet.has(f.ruleId),
                parameters: {},
              })));
            } else {
              // No job_tags (full run or unavailable) — enable all
              setSelections(findings.map(f => ({
                ruleId: f.ruleId,
                enabled: true,
                parameters: {},
              })));
            }
          }

          if (scanRecord) {
            inventoryIdRef.current = scanRecord.inventoryId;
            complianceProfileIdRef.current = scanRecord.profileId;
          }
        } catch {
          // Context loading is best-effort
        }
      };
      loadContext();
    } else {
      launchRemediation();
    }
  }, [launchRemediation, isViewMode, jobId, api]);

  // Derive known rule IDs from selections for task matching
  const knownRuleIds = useMemo(
    () => selections.filter(s => s.enabled).map(s => s.ruleId),
    [selections],
  );

  // Poll all remediation jobs. When remediation splits into multiple
  // groups (different host sets), each group is a separate JT launch.
  // We poll all of them in a single interval and merge task events.
  useEffect(() => {
    const jobIds = allJobIds.length > 0 ? allJobIds : (workflowJobId ? [workflowJobId] : []);
    if (jobIds.length === 0) return undefined;

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const statuses = await Promise.all(
          jobIds.map(id => api.getJobStatus(id).catch(() => null)),
        );
        if (cancelled) return;

        const validStatuses = statuses.filter(Boolean);
        if (validStatuses.length === 0) return;

        const maxElapsed = Math.max(...validStatuses.map(s => s!.elapsed ?? 0));
        setElapsed(maxElapsed);

        const allSuccessful = validStatuses.every(s => s!.status === 'successful');
        const anyInProgress = validStatuses.some(s => s!.status === 'running' || s!.status === 'waiting' || s!.status === 'pending' || s!.status === 'new');
        const allTerminal = validStatuses.every(s => TERMINAL_STATUSES.includes(s!.status));
        const anyFailed = validStatuses.some(s => TERMINAL_STATUSES.includes(s!.status) && s!.status !== 'successful');

        if (allSuccessful) {
          setOverallStatus('successful');
          setPhase('complete');
          setProgress(100);
        } else if (anyFailed && allTerminal) {
          const failedJob = validStatuses.find(s => s!.failed);
          setOverallStatus('failed');
          setPhase('failed');
          setErrorMessage(
            failedJob
              ? `Remediation failed after ${formatElapsed(failedJob.elapsed ?? 0)}`
              : 'Remediation failed',
          );
          setProgress(100);
        } else if (anyInProgress) {
          setOverallStatus('running');
          setPhase('running');
        }

        // Fetch and merge task events from all jobs
        try {
          const allEvents = await Promise.all(
            jobIds.map(id => api.getJobEvents(id).catch(() => [])),
          );
          if (!cancelled) {
            const mergedEvents = allEvents.flat();
            const extracted = extractTasksFromEvents(mergedEvents, knownRuleIds);
            if (extracted.length > 0) {
              setTasks(extracted);
              const done = extracted.filter(t => t.status === 'completed' || t.status === 'failed').length;
              if (anyInProgress) {
                setProgress(Math.round((done / extracted.length) * 100));
              }
            }
          }
        } catch {
          // Job events may not be available yet
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, workflowJobId, allJobIds.length, knownRuleIds]);

  // Group tasks by rule
  const { groups: ruleGroups, approximateGrouping } = useMemo(() => {
    return groupTasksByRule(tasks, selections, findingsMap);
  }, [tasks, selections, findingsMap]);

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
            Results
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
                {approximateGrouping && (
                  <Typography variant="caption" color="textSecondary" style={{ display: 'block', marginBottom: 8, fontStyle: 'italic' }}>
                    Task-to-rule grouping is approximate — some tasks may appear under the wrong rule heading.
                  </Typography>
                )}
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
                              {!hasTasks && ruleStatus === 'completed' ? 'Compliant' : `${pct}%`}
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
