import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Typography,
  ButtonGroup,
  Button,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  makeStyles,
  Box,
} from '@material-ui/core';
import TrendingUpIcon from '@material-ui/icons/TrendingUp';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import type { ComplianceApi } from '../../api';
import type { DashboardStats, PostureSnapshot, RemediationEvent } from '@aap-compliance/common';
import {
  detectEvents,
  buildMultiProfileSeries,
  formatTrendDate,
  formatTrendDateFull,
  TREND_COLORS,
  PROFILE_PALETTE,
  type TrendDataPoint,
  type MultiProfileRow,
} from './trendUtils';

type TrendScope = 'all-profiles' | 'per-profile' | 'per-inventory';

interface PostureTrendChartProps {
  initialData: PostureSnapshot[];
  stats: DashboardStats;
  api: ComplianceApi;
  onPointClick?: (snapshot: PostureSnapshot) => void;
}

const useStyles = makeStyles(theme => ({
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
    flexWrap: 'wrap',
  },
  dropdowns: {
    display: 'flex',
    gap: theme.spacing(1.5),
  },
  select: {
    minWidth: 180,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    color: theme.palette.text.secondary,
  },
  tooltipBox: {
    background: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: 4,
    padding: theme.spacing(1, 1.5),
    fontSize: '0.8rem',
    lineHeight: 1.5,
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  },
  tooltipLabel: {
    fontWeight: 600,
    marginBottom: 2,
  },
  regressionLabel: {
    color: TREND_COLORS.regression,
    fontWeight: 600,
    fontSize: '0.75rem',
  },
  improvementLabel: {
    color: TREND_COLORS.improvement,
    fontWeight: 600,
    fontSize: '0.75rem',
  },
}));

const CustomDot: React.FC<any> = (props) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;

  if (payload.eventType === 'regression') {
    return (
      <polygon
        points={`${cx},${cy + 7} ${cx - 5.5},${cy - 3} ${cx + 5.5},${cy - 3}`}
        fill={TREND_COLORS.regression}
        stroke="#fff"
        strokeWidth={1}
      />
    );
  }
  if (payload.eventType === 'improvement') {
    return (
      <polygon
        points={`${cx},${cy - 7} ${cx - 5.5},${cy + 3} ${cx + 5.5},${cy + 3}`}
        fill={TREND_COLORS.improvement}
        stroke="#fff"
        strokeWidth={1}
      />
    );
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill="#fff"
      stroke={TREND_COLORS.dot}
      strokeWidth={2}
    />
  );
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TrendDataPoint; value: number; dataKey: string }>;
  classes: ReturnType<typeof useStyles>;
}

function CustomTooltipContent({ active, payload, classes }: CustomTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  const dateStr = typeof point.timestamp === 'number' && isFinite(point.timestamp)
    ? formatTrendDateFull(point.timestamp)
    : 'Unknown date';
  const deltaStr = typeof point.delta === 'number' && isFinite(point.delta)
    ? point.delta.toFixed(1)
    : '0.0';
  return (
    <div className={classes.tooltipBox}>
      <div className={classes.tooltipLabel}>{dateStr}</div>
      <div>Compliance: {point.compliancePct ?? 0}%</div>
      <div>
        {point.passCount ?? 0} pass / {point.failCount ?? 0} fail
      </div>
      {point.eventType === 'regression' && (
        <div className={classes.regressionLabel}>
          Regression: {Number(deltaStr) > 0 ? '+' : ''}{deltaStr}pp
        </div>
      )}
      {point.eventType === 'improvement' && (
        <div className={classes.improvementLabel}>
          Improvement: +{deltaStr}pp
        </div>
      )}
    </div>
  );
}

function computeYDomain(data: Array<Record<string, any>>, profileIds?: string[]): [number, number] {
  let values: number[];
  if (profileIds) {
    values = data.flatMap(row =>
      profileIds.map(pid => (row as any)[pid]).filter((v): v is number => v !== undefined),
    );
  } else {
    values = data.map(d => d.compliancePct!).filter((v): v is number => v !== undefined);
  }
  if (values.length === 0) return [0, 100];
  const min = Math.max(0, Math.floor(Math.min(...values) / 5) * 5 - 5);
  const max = Math.min(100, Math.ceil(Math.max(...values) / 5) * 5 + 5);
  return [min, max];
}

export const PostureTrendChart: React.FC<PostureTrendChartProps> = ({
  initialData,
  stats,
  api,
  onPointClick,
}) => {
  const classes = useStyles();
  const [scope, setScope] = useState<TrendScope>('all-profiles');
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>('');
  const [data, setData] = useState<PostureSnapshot[]>(initialData);
  const [remediationEvents, setRemediationEvents] = useState<RemediationEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const profileOptions = useMemo(
    () => stats.frameworkScores.map(fw => ({ value: fw.profileId, label: fw.name })),
    [stats.frameworkScores],
  );

  const inventoryOptions = useMemo(() => {
    if (!selectedProfileId) return [];
    return stats.byInventory
      .filter(inv => inv.profileScores.some(ps => ps.profileId === selectedProfileId))
      .map(inv => ({ value: String(inv.inventoryId), label: inv.inventoryName }));
  }, [stats.byInventory, selectedProfileId]);

  useEffect(() => {
    if (scope === 'all-profiles') {
      setData(initialData);
      api.getRemediationEventsForTrend(90).then(setRemediationEvents).catch(() => {});
      return;
    }

    if (scope === 'per-profile' && selectedProfileId) {
      setLoading(true);
      Promise.all([
        api.getPostureHistory(selectedProfileId, 90),
        api.getRemediationEventsForTrend(90),
      ]).then(([history, events]) => {
        setData(history);
        setRemediationEvents(events);
      }).catch(() => {}).finally(() => setLoading(false));
      return;
    }

    if (scope === 'per-inventory' && selectedProfileId && selectedInventoryId) {
      setLoading(true);
      const invId = Number(selectedInventoryId);
      Promise.all([
        api.getPostureHistory(selectedProfileId, 90, invId),
        api.getRemediationEventsForTrend(90, invId),
      ]).then(([history, events]) => {
        setData(history);
        setRemediationEvents(events);
      }).catch(() => {}).finally(() => setLoading(false));
      return;
    }
  }, [scope, selectedProfileId, selectedInventoryId, api, initialData]);

  const handleScopeChange = useCallback((newScope: TrendScope) => {
    setScope(newScope);
    if (newScope === 'all-profiles') {
      setSelectedProfileId('');
      setSelectedInventoryId('');
    } else if (newScope === 'per-profile') {
      setSelectedInventoryId('');
      if (!selectedProfileId && profileOptions.length > 0) {
        setSelectedProfileId(profileOptions[0].value);
      }
    } else if (newScope === 'per-inventory') {
      if (!selectedProfileId && profileOptions.length > 0) {
        setSelectedProfileId(profileOptions[0].value);
      }
    }
  }, [selectedProfileId, profileOptions]);

  const profileMap = useMemo(
    () => new Map(stats.frameworkScores.map(fw => [fw.profileId, fw.name])),
    [stats.frameworkScores],
  );

  const multiProfile = useMemo(() => {
    if (scope !== 'all-profiles') return null;
    return buildMultiProfileSeries(data, profileMap);
  }, [scope, data, profileMap]);

  const singleLineData = useMemo(() => {
    if (scope === 'all-profiles') return [];
    return detectEvents(data);
  }, [scope, data]);

  const handleDotClick = useCallback(
    (point: TrendDataPoint) => {
      if (!onPointClick || !point.scanId) return;
      const snap = data.find(s => s.scanId === point.scanId);
      if (snap) onPointClick(snap);
    },
    [data, onPointClick],
  );

  const hasData = scope === 'all-profiles'
    ? (multiProfile?.data.length ?? 0) >= 2
    : singleLineData.length >= 2;

  return (
    <div>
      {/* Scope selector */}
      <div className={classes.controls}>
        <ButtonGroup size="small" variant="outlined">
          <Tooltip title="One line per compliance profile">
            <Button
              color={scope === 'all-profiles' ? 'primary' : 'default'}
              onClick={() => handleScopeChange('all-profiles')}
            >
              All Profiles
            </Button>
          </Tooltip>
          <Tooltip title="Single profile trend across all inventories">
            <Button
              color={scope === 'per-profile' ? 'primary' : 'default'}
              onClick={() => handleScopeChange('per-profile')}
            >
              Per Profile
            </Button>
          </Tooltip>
          <Tooltip title="Single profile × inventory trend">
            <Button
              color={scope === 'per-inventory' ? 'primary' : 'default'}
              onClick={() => handleScopeChange('per-inventory')}
            >
              Per Inventory
            </Button>
          </Tooltip>
        </ButtonGroup>

        <div className={classes.dropdowns}>
          {(scope === 'per-profile' || scope === 'per-inventory') && (
            <FormControl variant="outlined" size="small" className={classes.select}>
              <InputLabel id="trend-profile-label">Profile</InputLabel>
              <Select
                labelId="trend-profile-label"
                value={selectedProfileId}
                onChange={e => {
                  setSelectedProfileId(e.target.value as string);
                  setSelectedInventoryId('');
                }}
                label="Profile"
              >
                {profileOptions.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {scope === 'per-inventory' && (
            <FormControl variant="outlined" size="small" className={classes.select}>
              <InputLabel id="trend-inventory-label">Inventory</InputLabel>
              <Select
                labelId="trend-inventory-label"
                value={selectedInventoryId}
                onChange={e => setSelectedInventoryId(e.target.value as string)}
                label="Inventory"
              >
                {inventoryOptions.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </div>
      </div>

      {/* Chart or empty state */}
      {!hasData ? (
        <div className={classes.empty}>
          <TrendingUpIcon style={{ fontSize: 48, opacity: 0.3, marginBottom: 8 }} />
          <Typography variant="body2">
            {loading ? 'Loading trend data...' : 'Run more scans to see compliance trends'}
          </Typography>
          <Typography variant="caption" color="textSecondary">
            At least two completed scans are needed to display a trend line
          </Typography>
        </div>
      ) : scope === 'all-profiles' && multiProfile ? (
        <MultiLineChart
          data={multiProfile.data}
          profileIds={multiProfile.profileIds}
          profileMap={profileMap}
        />
      ) : (
        <SingleLineChart
          data={singleLineData}
          remediationEvents={remediationEvents}
          onDotClick={handleDotClick}
          classes={classes}
        />
      )}
    </div>
  );
};

const MultiLineChart = React.memo(({
  data,
  profileIds,
  profileMap,
}: {
  data: MultiProfileRow[];
  profileIds: string[];
  profileMap: Map<string, string>;
}) => {
  const [min, max] = React.useMemo(() => computeYDomain(data, profileIds), [data, profileIds]);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 40 }}>
        <CartesianGrid strokeDasharray="4 3" stroke={TREND_COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTrendDate}
          stroke={TREND_COLORS.axis}
          fontSize={11}
          fontFamily='"Red Hat Text", sans-serif'
        />
        <YAxis
          domain={[min, max]}
          tickFormatter={(v: number) => `${v}%`}
          stroke={TREND_COLORS.axis}
          fontSize={11}
          fontFamily='"Red Hat Text", sans-serif'
        />
        <RechartsTooltip
          labelFormatter={(ts: number) => formatTrendDateFull(ts)}
          formatter={(value: number, name: string) => [`${value}%`, profileMap.get(name) ?? name]}
        />
        <Legend
          formatter={(value: string) => profileMap.get(value) ?? value}
          iconType="plainline"
        />
        {profileIds.map((pid, i) => (
          <Line
            key={pid}
            type="monotone"
            dataKey={pid}
            stroke={PROFILE_PALETTE[i % PROFILE_PALETTE.length]}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});
MultiLineChart.displayName = 'MultiLineChart';

function SingleLineChart({
  data,
  remediationEvents,
  onDotClick,
  classes,
}: {
  data: TrendDataPoint[];
  remediationEvents: RemediationEvent[];
  onDotClick: (point: TrendDataPoint) => void;
  classes: any;
}) {
  const [min, max] = computeYDomain(data);
  const chartDomain = data.length >= 2
    ? [data[0].timestamp, data[data.length - 1].timestamp]
    : ['dataMin', 'dataMax'];

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 40 }}>
        <CartesianGrid strokeDasharray="4 3" stroke={TREND_COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={chartDomain as any}
          tickFormatter={formatTrendDate}
          stroke={TREND_COLORS.axis}
          fontSize={11}
          fontFamily='"Red Hat Text", sans-serif'
        />
        <YAxis
          domain={[min, max]}
          tickFormatter={(v: number) => `${v}%`}
          stroke={TREND_COLORS.axis}
          fontSize={11}
          fontFamily='"Red Hat Text", sans-serif'
        />
        <RechartsTooltip content={<CustomTooltipContent classes={classes} />} />

        {remediationEvents.map(evt => (
          <ReferenceLine
            key={evt.id}
            x={new Date(evt.completedAt).getTime()}
            stroke={TREND_COLORS.remediationLine}
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{
              value: `${evt.rulesApplied ?? '?'} rules`,
              position: 'insideTopRight',
              fontSize: 10,
              fill: TREND_COLORS.remediationLine,
            }}
          />
        ))}

        <Line
          type="monotone"
          dataKey="compliancePct"
          stroke={TREND_COLORS.line}
          strokeWidth={2.5}
          dot={<CustomDot />}
          activeDot={{
            r: 6,
            stroke: TREND_COLORS.line,
            strokeWidth: 2,
            fill: '#fff',
            cursor: 'pointer',
            onClick: (_: any, entry: any) => {
              if (entry?.payload) onDotClick(entry.payload);
            },
          }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
