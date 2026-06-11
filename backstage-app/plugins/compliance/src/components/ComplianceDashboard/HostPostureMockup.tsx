import React, { useState, useMemo, useCallback } from 'react';
import {
  Typography,
  Chip,
  Card,
  CardContent,
  Drawer,
  IconButton,
  Divider,
  makeStyles,
  Tooltip,
} from '@material-ui/core';
import CloseIcon from '@material-ui/icons/Close';
import WarningIcon from '@material-ui/icons/Warning';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ReferenceArea,
  Customized,
} from 'recharts';

const CHIP_THRESHOLD = 50;

const useStyles = makeStyles(theme => ({
  profileSection: { marginBottom: theme.spacing(3) },
  chipGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  hostChip: {
    minWidth: 120, height: 48, borderRadius: 6, borderWidth: 2, cursor: 'pointer',
    transition: 'box-shadow 0.15s ease, transform 0.1s ease',
    '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.15)', transform: 'translateY(-1px)' },
  },
  chipLabel: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    lineHeight: 1.3, padding: '2px 4px',
  },
  chipHostname: { fontSize: '0.75rem', fontWeight: 600 },
  chipScore: { fontSize: '0.7rem', fontWeight: 400 },
  legend: {
    display: 'flex', gap: theme.spacing(2), marginBottom: theme.spacing(1.5), flexWrap: 'wrap' as const,
  },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem',
    color: theme.palette.text.secondary,
  },
  legendDot: { width: 12, height: 12, borderRadius: 3, border: '2px solid' },
  summaryRow: {
    display: 'flex', gap: theme.spacing(2), marginBottom: theme.spacing(2), flexWrap: 'wrap' as const,
  },
  summaryCard: {
    padding: theme.spacing(1.5, 2), textAlign: 'center' as const, minWidth: 90, flex: '1 1 90px',
  },
  summaryValue: { fontSize: '1.5rem', fontWeight: 700 },
  summaryLabel: { fontSize: '0.75rem', color: theme.palette.text.secondary },
  osChip: {
    cursor: 'pointer',
    marginTop: 4,
    transition: 'box-shadow 0.15s ease',
    '&:hover': { boxShadow: '0 1px 4px rgba(0,0,0,0.15)' },
  },
  osChipActive: {
    backgroundColor: theme.palette.primary.main,
    color: '#fff',
    '&:hover': { backgroundColor: theme.palette.primary.dark },
  },
  drawer: { width: 420, padding: theme.spacing(3) },
  drawerHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: theme.spacing(2),
  },
  findingRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: theme.spacing(1, 0),
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:last-child': { borderBottom: 'none' },
  },
  findingTitle: { fontSize: '0.8rem', maxWidth: 280 },
  severityChip: { fontSize: '0.65rem', height: 20 },
  breadcrumb: {
    display: 'inline-flex', alignItems: 'center', gap: theme.spacing(1),
    marginBottom: theme.spacing(2), cursor: 'pointer',
    color: theme.palette.primary.main, fontSize: '0.85rem',
    '&:hover': { textDecoration: 'underline' },
  },
  clusterHint: {
    textAlign: 'center' as const, marginTop: theme.spacing(1),
    fontSize: '0.75rem', color: theme.palette.text.secondary, fontStyle: 'italic',
  },
  chipSection: { marginBottom: theme.spacing(2) },
  chipSectionLabel: {
    display: 'flex', alignItems: 'center', gap: theme.spacing(1), marginBottom: theme.spacing(1),
  },
}));

interface MockHost {
  hostname: string;
  compliancePct: number;
  passCount: number;
  failCount: number;
  catIFail: number;
  catIIFail: number;
  catIIIFail: number;
  os: string;
}

interface Cluster {
  id: string;
  min: number;
  max: number;
  hosts: MockHost[];
  isOutlier: boolean;
}

function seededRand(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

function generateHosts(count: number): MockHost[] {
  const rand = seededRand(42);
  const hosts: MockHost[] = [];
  for (let i = 0; i < count; i++) {
    let pct: number;
    let os: string;
    const r = rand();
    if (r < 0.06) {
      pct = 20 + rand() * 35;
      os = rand() < 0.5 ? 'RHEL 8.9' : 'RHEL 9.4';
    } else if (r < 0.18) {
      pct = 72 + rand() * 13;
      os = 'RHEL 9.4';
    } else {
      pct = 89 + rand() * 9;
      os = rand() < 0.85 ? 'RHEL 9.4' : rand() < 0.5 ? 'RHEL 8.9' : 'RHEL 9.2';
    }
    pct = Math.round(pct * 10) / 10;
    const totalRules = 366;
    const passCount = Math.round(totalRules * pct / 100);
    const failCount = totalRules - passCount;
    const catIFail = pct < 60 ? Math.floor(rand() * 8) + 2 : (rand() < 0.15 ? 1 : 0);
    const catIIShare = 0.65;
    hosts.push({
      hostname: `prod-rhel-${String(i + 1).padStart(3, '0')}`,
      compliancePct: pct, passCount, failCount, catIFail,
      catIIFail: Math.round(failCount * catIIShare),
      catIIIFail: failCount - Math.round(failCount * catIIShare) - catIFail,
      os,
    });
  }
  return hosts;
}

const MOCK_250_HOSTS = generateHosts(250);

function computeClusters(hosts: MockHost[]): Cluster[] {
  const sorted = [...hosts].sort((a, b) => a.compliancePct - b.compliancePct);
  const clusters: Cluster[] = [];
  let current: MockHost[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].compliancePct - sorted[i - 1].compliancePct > 5) {
      clusters.push(buildCluster(current, clusters.length));
      current = [];
    }
    current.push(sorted[i]);
  }
  if (current.length > 0) clusters.push(buildCluster(current, clusters.length));
  const mainCluster = clusters.reduce((a, b) => a.hosts.length > b.hosts.length ? a : b);
  for (const c of clusters) {
    if (c !== mainCluster && c.hosts.length < mainCluster.hosts.length * 0.15) c.isOutlier = true;
  }
  return clusters;
}

function buildCluster(hosts: MockHost[], idx: number): Cluster {
  return {
    id: `cluster-${idx}`,
    min: Math.min(...hosts.map(h => h.compliancePct)),
    max: Math.max(...hosts.map(h => h.compliancePct)),
    hosts, isOutlier: false,
  };
}

function isOutlier(host: MockHost, allHosts: MockHost[]): boolean {
  const scores = allHosts.map(h => h.compliancePct);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const stdDev = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  return host.compliancePct < mean - 1.5 * stdDev;
}

function hostColor(host: MockHost, allHosts: MockHost[]): string {
  if (isOutlier(host, allHosts)) return '#C9190B';
  if (host.catIFail > 0) return '#F0AB00';
  return '#3E8635';
}

function getChipStyle(host: MockHost, allHosts: MockHost[]) {
  const c = hostColor(host, allHosts);
  return {
    borderColor: c, color: c,
    backgroundColor: c === '#C9190B' ? 'rgba(201,25,11,0.04)' : c === '#F0AB00' ? 'rgba(240,171,0,0.04)' : 'rgba(62,134,53,0.04)',
  };
}

const MOCK_FAILING_RULES = [
  { id: 'RHEL-09-211010', title: 'RHEL 9 must use a separate file system for /tmp', severity: 'CAT II' },
  { id: 'RHEL-09-212015', title: 'RHEL 9 must prevent files with set-user-ID from being on NFS', severity: 'CAT I' },
  { id: 'RHEL-09-231190', title: 'RHEL 9 must set default permissions for new files to 077', severity: 'CAT II' },
  { id: 'RHEL-09-252070', title: 'RHEL 9 must implement address space layout randomization', severity: 'CAT II' },
  { id: 'RHEL-09-271040', title: 'RHEL 9 must configure pam_faillock.so in system-auth', severity: 'CAT II' },
  { id: 'RHEL-09-411010', title: 'RHEL 9 must enable FIPS mode', severity: 'CAT I' },
  { id: 'RHEL-09-431010', title: 'RHEL 9 must display the Standard Mandatory DoD Notice', severity: 'CAT II' },
  { id: 'RHEL-09-672010', title: 'RHEL 9 must use SSH to protect transmitted information', severity: 'CAT III' },
];

interface ZoomEntry {
  level: 'distribution' | 'zoomed-strip' | 'chips';
  hosts: MockHost[];
  label: string;
}


// ─── Clickable cluster labels (positioned above each cluster region) ─

function ClusterLabels({ clusters, xAxisMap, yAxisMap, onClusterClick }: any) {
  const xAxis = xAxisMap?.[0] ?? xAxisMap?.xAxis_0;
  const yAxis = yAxisMap?.[0] ?? yAxisMap?.yAxis_0;
  if (!xAxis || !yAxis) return null;

  return (
    <g>
      {clusters.map((c: Cluster) => {
        const x1 = xAxis.scale(Math.max(xAxis.domain[0], c.min - 1.5));
        const x2 = xAxis.scale(Math.min(xAxis.domain[1], c.max + 1.5));
        const yTop = yAxis.scale(1);
        if (x1 == null || x2 == null || yTop == null) return null;
        const cx = (x1 + x2) / 2;
        const labelY = Math.min(yTop, 10) + 2;
        const color = c.isOutlier ? '#C9190B' : '#3E8635';
        const label = `${c.hosts.length} hosts · ${c.min.toFixed(0)}–${c.max.toFixed(0)}%`;
        return (
          <g key={c.id} onClick={() => onClusterClick(c)} style={{ cursor: 'pointer' }}>
            <rect
              x={cx - 60} y={labelY - 9}
              width={120} height={16} rx={3}
              fill={c.isOutlier ? 'rgba(201,25,11,0.08)' : 'rgba(62,134,53,0.08)'}
              stroke={color} strokeWidth={1} strokeOpacity={0.4}
            />
            <text
              x={cx} y={labelY + 2}
              textAnchor="middle" fontSize={9}
              fontFamily='"Red Hat Text", sans-serif'
              fontWeight={600} fill={color}
              style={{ cursor: 'pointer' }}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ─── Strip Plot ──────────────────────────────────────────────────────

function StripPlot({ hosts, allHosts, clusters, onClusterClick, onDotClick, height }: {
  hosts: MockHost[];
  allHosts: MockHost[];
  clusters: Cluster[];
  onClusterClick: (cluster: Cluster) => void;
  onDotClick: (host: MockHost) => void;
  height?: number;
}) {
  const classes = useStyles();
  const rand = seededRand(99);
  const scatterData = hosts.map(h => ({
    x: h.compliancePct,
    y: 0.15 + rand() * 0.7,
    host: h,
  }));
  const mean = hosts.reduce((a, h) => a + h.compliancePct, 0) / hosts.length;
  const xMin = Math.max(0, Math.floor(Math.min(...hosts.map(h => h.compliancePct)) / 5) * 5 - 5);
  const xMax = Math.min(100, Math.ceil(Math.max(...hosts.map(h => h.compliancePct)) / 5) * 5 + 5);

  const handleDotClick = useCallback((data: any) => {
    if (data?.host) onDotClick(data.host);
  }, [onDotClick]);

  const dotShape: any = (props: any) => {
    const { cx, cy, payload } = props;
    const color = hostColor(payload.host, allHosts);
    return <circle cx={cx || 0} cy={cy || 0} r={5} fill={color} stroke="#fff" strokeWidth={1.5} style={{ cursor: 'pointer' }} />;
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={height || 180}>
        <ScatterChart margin={{ top: 24, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="4 3" stroke="#e0e0e0" horizontal={false} />
          <XAxis
            dataKey="x" type="number" domain={[xMin, xMax]}
            tickFormatter={(v: number) => `${v}%`}
            stroke="#6a6e73" fontSize={11} fontFamily='"Red Hat Text", sans-serif'
          />
          <YAxis dataKey="y" type="number" domain={[0, 1]} hide />
          <RechartsTooltip
            content={({ payload }: any) => {
              if (!payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4, padding: '6px 10px', fontSize: '0.8rem', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
                  <div style={{ fontWeight: 600 }}>{d.host.hostname}</div>
                  <div>{d.host.compliancePct}% · {d.host.failCount} failing</div>
                  {d.host.catIFail > 0 && <div style={{ color: '#C9190B' }}>{d.host.catIFail} CAT I</div>}
                  <div style={{ color: '#6a6e73', fontSize: '0.7rem', marginTop: 2 }}>Click dot for details · Click shaded area to zoom cluster</div>
                </div>
              );
            }}
          />
          <ReferenceLine x={mean} stroke="#0066CC" strokeDasharray="6 3" strokeWidth={1.5} />
          {clusters.map(c => (
            <ReferenceArea key={c.id}
              x1={Math.max(xMin, c.min - 1.5)} x2={Math.min(xMax, c.max + 1.5)} y1={0} y2={1}
              fill={c.isOutlier ? 'rgba(201,25,11,0.06)' : 'rgba(62,134,53,0.04)'}
              stroke={c.isOutlier ? '#C9190B' : '#3E8635'} strokeDasharray="4 2" strokeOpacity={0.3}
            />
          ))}
          <Scatter data={scatterData} isAnimationActive={false} cursor="pointer" onClick={handleDotClick} shape={dotShape} />
          <Customized component={(props: any) => (
            <ClusterLabels {...props} clusters={clusters} onClusterClick={onClusterClick} />
          )} />
        </ScatterChart>
      </ResponsiveContainer>
      <div className={classes.clusterHint}>
        <span style={{ color: '#0066CC', fontWeight: 600 }}>Mean: {mean.toFixed(1)}%</span>
        {' · '}Click a dot for host details · Click a cluster label to zoom in · {clusters.length} cluster{clusters.length !== 1 ? 's' : ''} detected
      </div>
    </div>
  );
}

// ─── Chip Matrix (red → yellow → green) ──────────────────────────────

function ChipMatrix({ hosts, allHosts, onHostClick }: {
  hosts: MockHost[];
  allHosts: MockHost[];
  onHostClick: (host: MockHost) => void;
}) {
  const classes = useStyles();
  const red = hosts.filter(h => isOutlier(h, allHosts)).sort((a, b) => a.compliancePct - b.compliancePct);
  const yellow = hosts.filter(h => !isOutlier(h, allHosts) && h.catIFail > 0).sort((a, b) => a.compliancePct - b.compliancePct);
  const green = hosts.filter(h => !isOutlier(h, allHosts) && h.catIFail === 0).sort((a, b) => a.compliancePct - b.compliancePct);

  const renderSection = (label: string, color: string, sectionHosts: MockHost[]) => {
    if (sectionHosts.length === 0) return null;
    return (
      <div className={classes.chipSection}>
        <div className={classes.chipSectionLabel}>
          <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
          <Typography variant="caption" style={{ fontWeight: 600, color }}>
            {label} ({sectionHosts.length})
          </Typography>
        </div>
        <div className={classes.chipGrid}>
          {sectionHosts.map(host => {
            const style = getChipStyle(host, allHosts);
            return (
              <Chip key={host.hostname} className={classes.hostChip} variant="outlined"
                onClick={() => onHostClick(host)}
                style={{ borderColor: style.borderColor, backgroundColor: style.backgroundColor }}
                label={
                  <div className={classes.chipLabel}>
                    <span className={classes.chipHostname} style={{ color: style.color }}>{host.hostname}</span>
                    <span className={classes.chipScore} style={{ color: style.color }}>
                      {host.compliancePct}% · {host.failCount} fail
                    </span>
                  </div>
                }
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={classes.profileSection}>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        {hosts.length} hosts · {red.length} outlier{red.length !== 1 ? 's' : ''}
        {yellow.length > 0 ? ` · ${yellow.length} with CAT I` : ''}
        {` · ${green.length} compliant`}
      </Typography>
      {renderSection('Outliers', '#C9190B', red)}
      {renderSection('CAT I Findings', '#F0AB00', yellow)}
      {renderSection('Compliant', '#3E8635', green)}
    </div>
  );
}

// ─── Host Detail Drawer ──────────────────────────────────────────────

function HostDrawer({ host, allHosts, onClose }: {
  host: MockHost; allHosts: MockHost[]; onClose: () => void;
}) {
  const classes = useStyles();
  const mean = allHosts.reduce((a, h) => a + h.compliancePct, 0) / allHosts.length;
  return (
    <Drawer anchor="right" open onClose={onClose}>
      <div className={classes.drawer}>
        <div className={classes.drawerHeader}>
          <div>
            <Typography variant="h6">{host.hostname}</Typography>
            <Typography variant="body2" color="textSecondary">{host.os}</Typography>
          </div>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <Card variant="outlined" style={{ flex: 1, padding: 12, textAlign: 'center' }}>
            <Typography variant="h5" style={{ fontWeight: 700, color: host.compliancePct < 80 ? '#C9190B' : '#3E8635' }}>
              {host.compliancePct}%
            </Typography>
            <Typography variant="caption" color="textSecondary">Compliance</Typography>
          </Card>
          <Card variant="outlined" style={{ flex: 1, padding: 12, textAlign: 'center' }}>
            <Typography variant="h5" style={{ fontWeight: 700 }}>{host.failCount}</Typography>
            <Typography variant="caption" color="textSecondary">Failing Rules</Typography>
          </Card>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {host.catIFail > 0 && (
            <Chip size="small" label={`${host.catIFail} CAT I`} style={{ backgroundColor: '#FAEAE5', color: '#C9190B', fontWeight: 600, fontSize: '0.75rem' }} />
          )}
          <Chip size="small" label={`${host.catIIFail} CAT II`} style={{ backgroundColor: '#FFF3CD', color: '#795600', fontWeight: 600, fontSize: '0.75rem' }} />
          <Chip size="small" label={`${host.catIIIFail} CAT III`} style={{ backgroundColor: '#E7F1FA', color: '#0066CC', fontWeight: 600, fontSize: '0.75rem' }} />
        </div>
        {isOutlier(host, allHosts) && (
          <Card variant="outlined" style={{ padding: 12, marginBottom: 16, borderColor: '#C9190B', backgroundColor: 'rgba(201,25,11,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarningIcon style={{ color: '#C9190B', fontSize: 20 }} />
              <div>
                <Typography variant="body2" style={{ fontWeight: 600, color: '#C9190B' }}>Outlier Host</Typography>
                <Typography variant="caption" color="textSecondary">
                  Deviates significantly from the inventory average ({mean.toFixed(1)}%).
                </Typography>
              </div>
            </div>
          </Card>
        )}
        <Divider style={{ margin: '8px 0 16px' }} />
        <Typography variant="subtitle2" gutterBottom>Failing Rules ({host.failCount})</Typography>
        {MOCK_FAILING_RULES.slice(0, Math.min(8, host.failCount)).map(rule => (
          <div key={rule.id} className={classes.findingRow}>
            <div>
              <Typography className={classes.findingTitle}>{rule.title}</Typography>
              <Typography variant="caption" color="textSecondary">{rule.id}</Typography>
            </div>
            <Chip size="small" className={classes.severityChip} label={rule.severity} style={{
              backgroundColor: rule.severity === 'CAT I' ? '#FAEAE5' : rule.severity === 'CAT II' ? '#FFF3CD' : '#E7F1FA',
              color: rule.severity === 'CAT I' ? '#C9190B' : rule.severity === 'CAT II' ? '#795600' : '#0066CC',
            }} />
          </div>
        ))}
        {host.failCount > 8 && (
          <Typography variant="body2" color="primary" style={{ marginTop: 8, cursor: 'pointer' }}>
            View all {host.failCount} failing rules →
          </Typography>
        )}
      </div>
    </Drawer>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export const HostPostureMockup: React.FC = () => {
  const classes = useStyles();
  const [drawerHost, setDrawerHost] = useState<MockHost | null>(null);
  const [zoomStack, setZoomStack] = useState<ZoomEntry[]>([]);
  const [osFilter, setOsFilter] = useState<string | null>(null);

  const allHosts = MOCK_250_HOSTS;
  const filteredHosts = useMemo(
    () => osFilter ? allHosts.filter(h => h.os === osFilter) : allHosts,
    [allHosts, osFilter],
  );
  const topClusters = useMemo(() => computeClusters(filteredHosts), [filteredHosts]);

  const totalHosts = allHosts.length;
  const displayedHosts = filteredHosts.length;
  const outlierCount = filteredHosts.filter(h => isOutlier(h, filteredHosts)).length;
  const totalPass = filteredHosts.reduce((a, h) => a + h.passCount, 0);
  const totalApplicable = filteredHosts.reduce((a, h) => a + h.passCount + h.failCount, 0);
  const overallCompliance = totalApplicable > 0 ? Math.round(totalPass / totalApplicable * 1000) / 10 : 0;

  const osCounts = new Map<string, number>();
  for (const h of allHosts) osCounts.set(h.os, (osCounts.get(h.os) || 0) + 1);
  const osEntries = [...osCounts.entries()].sort((a, b) => b[1] - a[1]);

  const currentZoom = zoomStack.length > 0 ? zoomStack[zoomStack.length - 1] : null;

  const pushZoom = useCallback((cluster: Cluster) => {
    const label = `${cluster.hosts.length} hosts · ${cluster.min.toFixed(0)}–${cluster.max.toFixed(0)}%`;
    if (cluster.hosts.length <= CHIP_THRESHOLD) {
      setZoomStack(prev => [...prev, { level: 'chips', hosts: cluster.hosts, label }]);
      return;
    }
    const subClusters = computeClusters(cluster.hosts);
    if (subClusters.length <= 1) {
      setZoomStack(prev => [...prev, { level: 'chips', hosts: cluster.hosts, label }]);
    } else {
      setZoomStack(prev => [...prev, { level: 'zoomed-strip', hosts: cluster.hosts, label }]);
    }
  }, []);

  const goBack = useCallback(() => {
    setZoomStack(prev => prev.slice(0, -1));
  }, []);

  const goHome = useCallback(() => {
    setZoomStack([]);
  }, []);

  const toggleOsFilter = useCallback((os: string) => {
    setOsFilter(prev => prev === os ? null : os);
    setZoomStack([]);
  }, []);

  return (
    <>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>production-rhel-fleet</Typography>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            Last scanned 2 hours ago
            {osFilter && ` · Filtered: ${osFilter}`}
          </Typography>

          <div className={classes.summaryRow}>
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryValue}>
                {osFilter ? `${displayedHosts}/${totalHosts}` : totalHosts}
              </Typography>
              <Typography className={classes.summaryLabel}>
                {osFilter ? 'Filtered / Total' : 'Total Hosts'}
              </Typography>
            </Card>
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryLabel} style={{ marginBottom: 4 }}>Operating Systems</Typography>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                {osEntries.map(([os, count]) => (
                  <Tooltip key={os} title={osFilter === os ? 'Click to clear filter' : `Filter to ${os} only`} arrow>
                    <Chip
                      size="small"
                      label={`${os} (${count})`}
                      className={`${classes.osChip} ${osFilter === os ? classes.osChipActive : ''}`}
                      variant={osFilter === os ? 'default' : 'outlined'}
                      onClick={() => toggleOsFilter(os)}
                    />
                  </Tooltip>
                ))}
              </div>
            </Card>
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryValue} style={{ color: '#3E8635' }}>
                {displayedHosts - outlierCount}
              </Typography>
              <Typography className={classes.summaryLabel}>Compliant</Typography>
            </Card>
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryValue} style={{ color: '#C9190B' }}>
                {outlierCount}
              </Typography>
              <Typography className={classes.summaryLabel}>Outliers</Typography>
            </Card>
            <Card variant="outlined" className={classes.summaryCard}>
              <Typography className={classes.summaryValue}>{overallCompliance}%</Typography>
              <Typography className={classes.summaryLabel}>Overall Compliance</Typography>
            </Card>
          </div>

          <div className={classes.legend}>
            <div className={classes.legendItem}>
              <div className={classes.legendDot} style={{ borderColor: '#3E8635', backgroundColor: 'rgba(62,134,53,0.08)' }} />
              Compliant
            </div>
            <div className={classes.legendItem}>
              <div className={classes.legendDot} style={{ borderColor: '#F0AB00', backgroundColor: 'rgba(240,171,0,0.08)' }} />
              CAT I findings
            </div>
            <div className={classes.legendItem}>
              <div className={classes.legendDot} style={{ borderColor: '#C9190B', backgroundColor: 'rgba(201,25,11,0.08)' }} />
              Outlier
            </div>
          </div>

          <Divider style={{ margin: '12px 0 16px' }} />

          <Typography variant="subtitle1" style={{ fontWeight: 600, marginBottom: 12 }}>
            DISA STIG V2R8 — Host Compliance
          </Typography>

          {/* Breadcrumb trail */}
          {zoomStack.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className={classes.breadcrumb} onClick={goHome} style={{ marginBottom: 0 }}>
                All hosts ({filteredHosts.length})
              </span>
              {zoomStack.map((entry, i) => (
                <React.Fragment key={i}>
                  <Typography variant="body2" color="textSecondary" style={{ margin: '0 2px' }}>›</Typography>
                  {i < zoomStack.length - 1 ? (
                    <span className={classes.breadcrumb} onClick={() => setZoomStack(prev => prev.slice(0, i + 1))} style={{ marginBottom: 0 }}>
                      {entry.label}
                    </span>
                  ) : (
                    <Typography variant="body2" style={{ fontWeight: 600 }}>{entry.label}</Typography>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {!currentZoom && (
            <StripPlot
              hosts={filteredHosts}
              allHosts={filteredHosts}
              clusters={topClusters}
              onClusterClick={pushZoom}
              onDotClick={setDrawerHost}
              height={180}
            />
          )}

          {currentZoom?.level === 'zoomed-strip' && (
            <StripPlot
              hosts={currentZoom.hosts}
              allHosts={filteredHosts}
              clusters={computeClusters(currentZoom.hosts)}
              onClusterClick={pushZoom}
              onDotClick={setDrawerHost}
              height={160}
            />
          )}

          {currentZoom?.level === 'chips' && (
            <ChipMatrix
              hosts={currentZoom.hosts}
              allHosts={filteredHosts}
              onHostClick={setDrawerHost}
            />
          )}
        </CardContent>
      </Card>

      {drawerHost && (
        <HostDrawer host={drawerHost} allHosts={filteredHosts} onClose={() => setDrawerHost(null)} />
      )}
    </>
  );
};
