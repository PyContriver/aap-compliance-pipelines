import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { InfoCard } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { Typography, LinearProgress } from '@material-ui/core';
import { complianceApiRef } from '../../api';
import type { DashboardStats, HostPostureResponse } from '@aap-compliance/common';

export const InventoryDetail: React.FC = () => {
  const { inventoryId } = useParams<{ inventoryId: string }>();
  const api = useApi(complianceApiRef);
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [hostData, setHostData] = useState<HostPostureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');

  const invId = Number(inventoryId);

  const inventory = useMemo(
    () => stats?.byInventory.find(inv => inv.inventoryId === invId),
    [stats, invId],
  );

  const profileOptions = useMemo(
    () => inventory?.profileScores.map(ps => ({ value: ps.profileId, label: ps.name })) ?? [],
    [inventory],
  );

  useEffect(() => {
    api.getDashboardStats().then(s => {
      setStats(s);
      const inv = s.byInventory.find(i => i.inventoryId === invId);
      if (inv?.profileScores.length) {
        setSelectedProfileId(inv.profileScores[0].profileId);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [api, invId]);

  useEffect(() => {
    if (!selectedProfileId || !invId) return;
    setLoading(true);
    api.getHostPosture(invId, selectedProfileId)
      .then(setHostData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api, invId, selectedProfileId]);

  if (loading && !stats) return <LinearProgress />;

  return (
    <InfoCard title={inventory?.inventoryName ?? `Inventory ${inventoryId}`}>
      {loading ? (
        <LinearProgress />
      ) : hostData && hostData.hosts.length > 0 ? (
        <Typography variant="body2">
          {hostData.hosts.length} hosts loaded for profile {selectedProfileId}.
          Full visualization coming in Phase 4 — the HostPostureView, StripPlot, ChipMatrix, and HostDetailDrawer
          components will be built here using the patterns from the mockup.
        </Typography>
      ) : (
        <Typography variant="body2" color="textSecondary">
          No host posture data available. Run a scan for this inventory first.
        </Typography>
      )}
    </InfoCard>
  );
};
