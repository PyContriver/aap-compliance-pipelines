import React, { useState, useMemo, useCallback } from 'react';
import { Typography, makeStyles } from '@material-ui/core';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import type { HostPosture } from '@aap-compliance/common';
import { computeClusters, CHIP_THRESHOLD, type Cluster } from './hostUtils';
import { StripPlot } from './StripPlot';
import { ChipMatrix } from './ChipMatrix';
import { HostDetailDrawer } from './HostDetailDrawer';

const useStyles = makeStyles(theme => ({
  breadcrumb: {
    display: 'inline-flex', alignItems: 'center', gap: theme.spacing(1),
    cursor: 'pointer', color: theme.palette.primary.main, fontSize: '0.85rem',
    '&:hover': { textDecoration: 'underline' },
  },
  breadcrumbTrail: {
    display: 'flex', alignItems: 'center', gap: 4, marginBottom: theme.spacing(1.5), flexWrap: 'wrap' as const,
  },
}));

interface ZoomEntry {
  level: 'zoomed-strip' | 'chips';
  hosts: HostPosture[];
  label: string;
}

interface HostPostureViewProps {
  hosts: HostPosture[];
  osFilter: string | null;
  profileLabel: string;
}

export const HostPostureView: React.FC<HostPostureViewProps> = ({ hosts, osFilter, profileLabel }) => {
  const classes = useStyles();
  const [zoomStack, setZoomStack] = useState<ZoomEntry[]>([]);
  const [drawerHost, setDrawerHost] = useState<HostPosture | null>(null);

  const filteredHosts = useMemo(
    () => osFilter ? hosts.filter(h => h.os === osFilter) : hosts,
    [hosts, osFilter],
  );

  const topClusters = useMemo(() => computeClusters(filteredHosts), [filteredHosts]);
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

  const goHome = useCallback(() => setZoomStack([]), []);

  // Reset zoom when OS filter changes
  React.useEffect(() => { setZoomStack([]); }, [osFilter]);

  return (
    <div>
      <Typography variant="subtitle1" style={{ fontWeight: 600, marginBottom: 12 }}>
        {profileLabel} — Host Compliance
      </Typography>

      {zoomStack.length > 0 && (
        <div className={classes.breadcrumbTrail}>
          <span className={classes.breadcrumb} onClick={goHome}>
            All hosts ({filteredHosts.length})
          </span>
          {zoomStack.map((entry, i) => (
            <React.Fragment key={i}>
              <Typography variant="body2" color="textSecondary" style={{ margin: '0 2px' }}>›</Typography>
              {i < zoomStack.length - 1 ? (
                <span className={classes.breadcrumb} onClick={() => setZoomStack(prev => prev.slice(0, i + 1))}>
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
        <StripPlot hosts={filteredHosts} allHosts={filteredHosts} clusters={topClusters}
          onClusterClick={pushZoom} onDotClick={setDrawerHost} height={180} />
      )}

      {currentZoom?.level === 'zoomed-strip' && (
        <StripPlot hosts={currentZoom.hosts} allHosts={filteredHosts}
          clusters={computeClusters(currentZoom.hosts)}
          onClusterClick={pushZoom} onDotClick={setDrawerHost} height={160} />
      )}

      {currentZoom?.level === 'chips' && (
        <ChipMatrix hosts={currentZoom.hosts} allHosts={filteredHosts} onHostClick={setDrawerHost} />
      )}

      {drawerHost && (
        <HostDetailDrawer host={drawerHost} allHosts={filteredHosts} onClose={() => setDrawerHost(null)} />
      )}
    </div>
  );
};
