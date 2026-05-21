import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InfoCard,
  StatusOK,
  StatusError,
  StatusWarning,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import {
  Card,
  CardContent,
  CardActionArea,
  Typography,
  LinearProgress,
  Chip,
  Box,
  Tooltip,
  makeStyles,
} from '@material-ui/core';
import PlayCircleFilledIcon from '@material-ui/icons/PlayCircleFilled';
import SecurityIcon from '@material-ui/icons/Security';
import HistoryIcon from '@material-ui/icons/History';
import SettingsIcon from '@material-ui/icons/Settings';
import AssessmentIcon from '@material-ui/icons/Assessment';
import BuildIcon from '@material-ui/icons/Build';
import TrendingUpIcon from '@material-ui/icons/TrendingUp';
import { ComplianceGauge } from './ComplianceGauge';
import { complianceApiRef } from '../../api';
import type { DashboardStats, PostureSnapshot } from '@aap-compliance/common';

const useStyles = makeStyles(theme => ({
  section: {
    marginBottom: theme.spacing(2),
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
  },
  gaugeItem: {
    flex: '1 1 120px',
    minWidth: 120,
    maxWidth: 200,
  },
  statItem: {
    flex: '1 1 140px',
    minWidth: 140,
  },
  actionsColumn: {
    flex: '1 1 280px',
    maxWidth: 400,
  },
  scansColumn: {
    flex: '2 1 400px',
  },
  frameworkItem: {
    flex: '1 1 250px',
  },
  statCard: {
    textAlign: 'center',
    padding: theme.spacing(1.5),
  },
  statValue: {
    fontSize: '1.75rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  statLabel: {
    color: theme.palette.text.secondary,
    fontSize: '0.8rem',
    marginTop: theme.spacing(0.5),
  },
  critical: { color: '#C9190B' },
  warning: { color: '#F0AB00' },
  success: { color: '#3E8635' },
  quickAction: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
  },
  actionIcon: {
    fontSize: '2rem',
    color: theme.palette.primary.main,
  },
  complianceBar: {
    height: 6,
    borderRadius: 3,
  },
  scanRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(1.5, 1),
    borderBottom: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    '&:last-child': { borderBottom: 'none' },
    '&:hover': { backgroundColor: theme.palette.action.hover },
    transition: 'background-color 0.15s ease',
  },
  frameworkCard: {
    height: '100%',
  },
  welcomeCard: {
    textAlign: 'center',
    padding: theme.spacing(6, 4),
  },
  welcomeStep: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(2),
    padding: theme.spacing(1.5, 0),
    textAlign: 'left',
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    backgroundColor: theme.palette.primary.main,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    flexShrink: 0,
  },
  trendContainer: {
    position: 'relative' as const,
    width: '100%',
    height: 200,
  },
  trendEmpty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    color: theme.palette.text.secondary,
  },
}));

// ─── Posture Trend Chart (inline SVG) ─────────────────────────────────

const TREND_COLORS = {
  line: '#0066CC',
  fill: 'rgba(0, 102, 204, 0.08)',
  dot: '#0066CC',
  grid: '#e0e0e0',
  axis: '#6a6e73',
};

interface PostureTrendChartProps {
  data: PostureSnapshot[];
}

const PostureTrendChart: React.FC<PostureTrendChartProps> = ({ data }) => {
  // Take up to 20 most recent data points
  const points = data.slice(-20);
  if (points.length < 2) return null;

  const width = 800;
  const height = 180;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 32;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Y axis: compliance percentage (dynamic range with padding)
  const pcts = points.map(p => p.compliancePct);
  const minPct = Math.max(0, Math.floor(Math.min(...pcts) / 5) * 5 - 5);
  const maxPct = Math.min(100, Math.ceil(Math.max(...pcts) / 5) * 5 + 5);
  const range = maxPct - minPct || 1;

  // X positions evenly spaced
  const xStep = chartW / (points.length - 1);

  const toX = (i: number) => padLeft + i * xStep;
  const toY = (pct: number) => padTop + chartH - ((pct - minPct) / range) * chartH;

  // Build polyline points string
  const polylinePoints = points
    .map((p, i) => `${toX(i)},${toY(p.compliancePct)}`)
    .join(' ');

  // Build fill polygon (area under the line)
  const areaPoints = [
    `${toX(0)},${toY(minPct)}`,
    ...points.map((p, i) => `${toX(i)},${toY(p.compliancePct)}`),
    `${toX(points.length - 1)},${toY(minPct)}`,
  ].join(' ');

  // Y axis grid lines (every 10%)
  const yTicks: number[] = [];
  for (let v = Math.ceil(minPct / 10) * 10; v <= maxPct; v += 10) {
    yTicks.push(v);
  }

  // X axis labels (show first, middle, last dates)
  const formatDate = (ts: string) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const xLabels: Array<{ i: number; label: string }> = [];
  if (points.length <= 6) {
    points.forEach((p, i) => xLabels.push({ i, label: formatDate(p.timestamp) }));
  } else {
    xLabels.push({ i: 0, label: formatDate(points[0].timestamp) });
    const mid = Math.floor(points.length / 2);
    xLabels.push({ i: mid, label: formatDate(points[mid].timestamp) });
    xLabels.push({ i: points.length - 1, label: formatDate(points[points.length - 1].timestamp) });
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', maxHeight: 220 }}
      role="img"
      aria-label="Compliance score trend chart"
    >
      {/* Y axis grid lines */}
      {yTicks.map(v => (
        <g key={`y-${v}`}>
          <line
            x1={padLeft}
            y1={toY(v)}
            x2={width - padRight}
            y2={toY(v)}
            stroke={TREND_COLORS.grid}
            strokeWidth={0.5}
            strokeDasharray="4,3"
          />
          <text
            x={padLeft - 6}
            y={toY(v)}
            textAnchor="end"
            dominantBaseline="central"
            fill={TREND_COLORS.axis}
            fontSize="11"
            fontFamily='"Red Hat Text", sans-serif'
          >
            {v}%
          </text>
        </g>
      ))}

      {/* Area fill */}
      <polygon points={areaPoints} fill={TREND_COLORS.fill} />

      {/* Trend line */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={TREND_COLORS.line}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points */}
      {points.map((p, i) => (
        <Tooltip
          key={p.id}
          title={`${new Date(p.timestamp).toLocaleDateString()} - ${p.compliancePct}% (${p.passCount} pass / ${p.failCount} fail)`}
          arrow
          placement="top"
        >
          <circle
            cx={toX(i)}
            cy={toY(p.compliancePct)}
            r={4}
            fill="#fff"
            stroke={TREND_COLORS.dot}
            strokeWidth={2}
            style={{ cursor: 'pointer' }}
          />
        </Tooltip>
      ))}

      {/* X axis labels */}
      {xLabels.map(({ i, label }) => (
        <text
          key={`x-${i}`}
          x={toX(i)}
          y={height - 6}
          textAnchor="middle"
          fill={TREND_COLORS.axis}
          fontSize="11"
          fontFamily='"Red Hat Text", sans-serif'
        >
          {label}
        </text>
      ))}
    </svg>
  );
};

export const ComplianceDashboard = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const api = useApi(complianceApiRef);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [postureHistory, setPostureHistory] = useState<PostureSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getDashboardStats().catch(err => {
        console.error('Failed to load dashboard stats:', err);
        return null;
      }),
      api.getPostureHistory(undefined, 90).catch(err => {
        console.error('Failed to load posture history:', err);
        return [] as PostureSnapshot[];
      }),
    ]).then(([dashboardStats, history]) => {
      setStats(dashboardStats);
      setPostureHistory(history);
    }).finally(() => setLoading(false));
  }, [api]);

  // Determine if this is an "empty" state (no scan history)
  const isEmpty = !stats || (stats.recentScans.length === 0 && stats.hostsScanned === 0);

  if (loading) {
    return (
      <Box p={4}>
        <LinearProgress />
        <Typography variant="body2" align="center" style={{ marginTop: 16 }}>
          Loading dashboard...
        </Typography>
      </Box>
    );
  }

  // P3-3: Welcome / empty state when no scan history exists
  if (isEmpty) {
    return (
      <div>
        <div className={classes.section}>
          <InfoCard title="Welcome to AAP Compliance">
            <div className={classes.welcomeCard}>
              <SecurityIcon style={{ fontSize: 64, color: '#0066CC', marginBottom: 16 }} />
              <Typography variant="h5" gutterBottom>
                Get Started with Compliance Scanning
              </Typography>
              <Typography variant="body1" color="textSecondary" paragraph>
                Scan your infrastructure against industry compliance frameworks like DISA STIG,
                CIS Benchmarks, and PCI-DSS. Review findings, build remediations, and
                bring your systems into compliance.
              </Typography>

              <Box maxWidth={480} mx="auto" mt={4}>
                <div className={classes.welcomeStep}>
                  <div className={classes.stepNumber}>1</div>
                  <div>
                    <Typography variant="subtitle1">Add a Compliance Profile</Typography>
                    <Typography variant="body2" color="textSecondary">
                      Map a compliance standard to a workflow job template in Settings.
                    </Typography>
                  </div>
                </div>
                <div className={classes.welcomeStep}>
                  <div className={classes.stepNumber}>2</div>
                  <div>
                    <Typography variant="subtitle1">Launch a Scan</Typography>
                    <Typography variant="body2" color="textSecondary">
                      Select a profile, choose an inventory, and run a compliance scan.
                    </Typography>
                  </div>
                </div>
                <div className={classes.welcomeStep}>
                  <div className={classes.stepNumber}>3</div>
                  <div>
                    <Typography variant="subtitle1">Review Findings</Typography>
                    <Typography variant="body2" color="textSecondary">
                      Analyze per-host results, build remediations, and apply fixes.
                    </Typography>
                  </div>
                </div>
              </Box>

              <Box mt={4} display="flex" justifyContent="center" style={{ gap: 16 }}>
                <Card variant="outlined">
                  <CardActionArea onClick={() => navigate('settings')}>
                    <div className={classes.quickAction}>
                      <SettingsIcon className={classes.actionIcon} />
                      <Typography variant="subtitle2">Configure Settings</Typography>
                    </div>
                  </CardActionArea>
                </Card>
                <Card variant="outlined">
                  <CardActionArea onClick={() => navigate('scan')}>
                    <div className={classes.quickAction}>
                      <PlayCircleFilledIcon className={classes.actionIcon} />
                      <Typography variant="subtitle2">New Scan</Typography>
                    </div>
                  </CardActionArea>
                </Card>
              </Box>
            </div>
          </InfoCard>
        </div>
      </div>
    );
  }

  // Compute an overall gauge from framework scores
  const overallRate = stats.frameworkScores.length > 0
    ? Math.round(
        stats.frameworkScores.reduce((sum, fw) => sum + fw.rate, 0) /
          stats.frameworkScores.length,
      )
    : 0;

  return (
    <div>
      {/* Compliance Gauges */}
      <div className={classes.section}>
        <InfoCard title="Compliance Posture">
          <div className={classes.row} style={{ justifyContent: 'center' }}>
            <div className={classes.gaugeItem}>
              <ComplianceGauge value={overallRate} label="Overall" />
            </div>
            {stats.frameworkScores.map(fw => (
              <div className={classes.gaugeItem} key={fw.name}>
                <ComplianceGauge value={fw.rate} label={fw.name.split(' ')[0] + ' ' + (fw.name.split(' ')[1] || '')} />
              </div>
            ))}
          </div>
        </InfoCard>
      </div>

      {/* Key Metrics */}
      <div className={classes.section}>
        <div className={classes.row}>
          <div className={classes.statItem}>
            <InfoCard>
              <div className={classes.statCard}>
                <Typography className={classes.statValue}>{stats.hostsScanned}</Typography>
                <Typography className={classes.statLabel}>Hosts Scanned</Typography>
              </div>
            </InfoCard>
          </div>
          <div className={classes.statItem}>
            <InfoCard>
              <div className={classes.statCard}>
                <Typography className={`${classes.statValue} ${classes.critical}`}>{stats.criticalFindings}</Typography>
                <Typography className={classes.statLabel}>Critical (CAT I)</Typography>
              </div>
            </InfoCard>
          </div>
          <div className={classes.statItem}>
            <InfoCard>
              <div className={classes.statCard}>
                <Typography className={`${classes.statValue} ${classes.warning}`}>{stats.pendingRemediation}</Typography>
                <Typography className={classes.statLabel}>Pending Remediation</Typography>
              </div>
            </InfoCard>
          </div>
          <div className={classes.statItem}>
            <InfoCard>
              <div className={classes.statCard}>
                <Typography className={`${classes.statValue} ${classes.success}`}>{stats.activeProfiles}</Typography>
                <Typography className={classes.statLabel}>Active Profiles</Typography>
              </div>
            </InfoCard>
          </div>
        </div>
      </div>

      {/* Compliance Score Trend */}
      <div className={classes.section}>
        <InfoCard
          title="Compliance Score Trend"
          action={
            <Chip
              icon={<TrendingUpIcon />}
              label="Last 90 days"
              variant="outlined"
              size="small"
            />
          }
        >
          {postureHistory.length < 2 ? (
            <div className={classes.trendEmpty}>
              <TrendingUpIcon style={{ fontSize: 48, opacity: 0.3, marginBottom: 8 }} />
              <Typography variant="body2">
                Run more scans to see compliance trends
              </Typography>
              <Typography variant="caption" color="textSecondary">
                At least two completed scans are needed to display a trend line
              </Typography>
            </div>
          ) : (
            <PostureTrendChart data={postureHistory} />
          )}
        </InfoCard>
      </div>

      {/* Quick Actions + Recent Activity */}
      <div className={classes.section}>
        <div className={classes.row}>
          <div className={classes.actionsColumn}>
            <InfoCard title="Quick Actions">
              <Card variant="outlined">
                <CardActionArea onClick={() => navigate('scan')}>
                  <div className={classes.quickAction}>
                    <PlayCircleFilledIcon className={classes.actionIcon} />
                    <div>
                      <Typography variant="subtitle1">New Scan</Typography>
                      <Typography variant="body2" color="textSecondary">
                        Scan infrastructure against a compliance profile
                      </Typography>
                    </div>
                  </div>
                </CardActionArea>
              </Card>
              <Box mt={1} />
              <Card variant="outlined">
                <CardActionArea onClick={() => navigate('profiles/all')}>
                  <div className={classes.quickAction}>
                    <SecurityIcon className={classes.actionIcon} />
                    <div>
                      <Typography variant="subtitle1">Browse Profiles</Typography>
                      <Typography variant="body2" color="textSecondary">
                        View compliance frameworks and benchmarks
                      </Typography>
                    </div>
                  </div>
                </CardActionArea>
              </Card>
            </InfoCard>
          </div>
          <div className={classes.scansColumn}>
            <InfoCard
              title="Recent Activity"
              action={
                <Chip
                  icon={<HistoryIcon />}
                  label="View All"
                  variant="outlined"
                  size="small"
                  clickable
                  onClick={() => navigate('results')}
                />
              }
            >
              {stats.recentScans.map(scan => {
                const isRemediation = scan.scanner === 'remediation';
                const activityLabel = isRemediation
                  ? 'Remediation'
                  : scan.scanType === 'verification'
                    ? 'Verification'
                    : 'Assessment';
                const activityColor = isRemediation
                  ? 'primary'
                  : scan.scanType === 'verification'
                    ? 'secondary'
                    : 'default';

                return (
                  <div
                    key={scan.id}
                    className={classes.scanRow}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      if (scan.scanner === 'remediation') {
                        navigate(`remediation-result/${scan.id}`);
                      } else {
                        navigate(`results/${scan.id}`);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (scan.scanner === 'remediation') {
                          navigate(`remediation-result/${scan.id}`);
                        } else {
                          navigate(`results/${scan.id}`);
                        }
                      }
                    }}
                  >
                    <div>
                      <Box display="flex" alignItems="center" style={{ gap: 6 }}>
                        <Typography variant="subtitle2">{scan.profileName}</Typography>
                        <Chip
                          icon={isRemediation ? <BuildIcon style={{ fontSize: 12 }} /> : undefined}
                          label={activityLabel}
                          size="small"
                          variant="outlined"
                          color={activityColor as 'primary' | 'secondary' | 'default'}
                          style={isRemediation
                            ? { height: 18, fontSize: '0.65rem', borderColor: '#3E8635', color: '#3E8635' }
                            : { height: 18, fontSize: '0.65rem' }}
                        />
                      </Box>
                      <Typography variant="body2" color="textSecondary">
                        {scan.inventoryName} &middot; {new Date(scan.timestamp).toLocaleString()}
                      </Typography>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {scan.status === 'failed' ? (
                        <StatusError />
                      ) : isRemediation ? (
                        <StatusOK />
                      ) : scan.passRate >= 80 ? (
                        <StatusOK />
                      ) : scan.passRate >= 65 ? (
                        <StatusWarning />
                      ) : (
                        <StatusError />
                      )}
                      <Typography variant="subtitle2">
                        {scan.status === 'failed' ? 'Failed' : isRemediation ? scan.status : `${scan.passRate}%`}
                      </Typography>
                    </div>
                  </div>
                );
              })}
            </InfoCard>
          </div>
        </div>
      </div>

      {/* Active Compliance Profiles */}
      <div className={classes.section}>
        <InfoCard title="Active Compliance Profiles">
          <div className={classes.row}>
            {stats.frameworkScores.map(fw => (
              <div className={classes.frameworkItem} key={fw.name}>
                <Card variant="outlined" className={classes.frameworkCard}>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>{fw.name}</Typography>
                    <Typography variant="body2" color="textSecondary">
                      {fw.target} &middot; {fw.rules} rules
                    </Typography>
                    <Box mt={2}>
                      <Box display="flex" justifyContent="space-between" mb={0.5}>
                        <Typography variant="caption">Compliance</Typography>
                        <Typography variant="caption">{fw.rate}%</Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={fw.rate}
                        className={classes.complianceBar}
                        color={fw.rate >= 80 ? 'primary' : 'secondary'}
                      />
                    </Box>
                    <Box mt={1.5} display="flex" justifyContent="space-between" alignItems="center">
                      <Typography
                        variant="caption"
                        color="textSecondary"
                      >
                        Last scan: {fw.lastScan}
                      </Typography>
                      <Chip
                        icon={<AssessmentIcon style={{ fontSize: 14 }} />}
                        label="Scan"
                        size="small"
                        color="primary"
                        variant="outlined"
                        clickable
                        onClick={() => navigate(`scan?profile=${fw.profileId}`)}
                      />
                    </Box>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </InfoCard>
      </div>
    </div>
  );
};
