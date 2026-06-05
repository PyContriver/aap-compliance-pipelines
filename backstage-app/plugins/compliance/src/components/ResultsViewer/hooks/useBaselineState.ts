import { useState, useEffect } from 'react';
import type {
  BaselineTarget,
  RemediationProfile,
  AuthoritativeScanResponse,
} from '@aap-compliance/common';
import type { ComplianceApi } from '../../../api';

export interface BaselineState {
  baselineForScan: BaselineTarget | null;
  baselineLaunchOpen: boolean;
  setBaselineLaunchOpen: (open: boolean) => void;
  baselineProfile: RemediationProfile | null;
  baselineScanCheck: AuthoritativeScanResponse | null;
  baselineScanChecking: boolean;
  baselineScanMissing: boolean;
}

export function useBaselineState(
  api: ComplianceApi,
  scanComplianceProfileId: string,
  scanInventoryId: number | null,
): BaselineState {
  const [baselineForScan, setBaselineForScan] = useState<BaselineTarget | null>(null);
  const [baselineLaunchOpen, setBaselineLaunchOpen] = useState(false);
  const [baselineProfile, setBaselineProfile] = useState<RemediationProfile | null>(null);
  const [baselineScanCheck, setBaselineScanCheck] = useState<AuthoritativeScanResponse | null>(null);
  const [baselineScanChecking, setBaselineScanChecking] = useState(false);
  const [baselineScanMissing, setBaselineScanMissing] = useState(false);

  // Fetch baseline target for this scan's profile + inventory
  useEffect(() => {
    if (!scanComplianceProfileId || !scanInventoryId) return;
    api.getBaselineTargets(scanComplianceProfileId)
      .then(targets => {
        const match = targets.find(t => t.inventoryId === scanInventoryId);
        setBaselineForScan(match ?? null);
      })
      .catch(() => setBaselineForScan(null));
  }, [api, scanComplianceProfileId, scanInventoryId]);

  // Fetch baseline profile and authoritative scan when launch dialog opens
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

  return {
    baselineForScan,
    baselineLaunchOpen,
    setBaselineLaunchOpen,
    baselineProfile,
    baselineScanCheck,
    baselineScanChecking,
    baselineScanMissing,
  };
}
