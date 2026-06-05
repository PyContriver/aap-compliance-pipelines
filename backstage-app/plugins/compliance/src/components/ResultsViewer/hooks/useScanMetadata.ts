import { useState, useEffect } from 'react';
import type { ScanCertification } from '@aap-compliance/common';
import type { ComplianceApi } from '../../../api';

export interface ScanMetadata {
  scanType: 'assessment' | 'verification';
  profileName: string;
  frameworkLabel: string;
  profileCert: ScanCertification | null;
  scanComplianceProfileId: string;
  scanInventoryId: number | null;
  scanStartedAt: string;
}

export function useScanMetadata(
  api: ComplianceApi,
  jobId: string | undefined,
): ScanMetadata {
  const [scanType, setScanType] = useState<'assessment' | 'verification'>('assessment');
  const [profileName, setProfileName] = useState('');
  const [frameworkLabel, setFrameworkLabel] = useState('');
  const [profileCert, setProfileCert] = useState<ScanCertification | null>(null);
  const [scanComplianceProfileId, setScanComplianceProfileId] = useState('');
  const [scanInventoryId, setScanInventoryId] = useState<number | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState('');

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    api.getScans().then(scans => {
      if (cancelled) return;
      const match = scans.find(
        s => s.id === jobId || String(s.workflowJobId) === jobId,
      );
      if (match?.scanType) {
        setScanType(match.scanType);
      }
      if (match) {
        setScanComplianceProfileId(match.profileId);
        setScanInventoryId(match.inventoryId);
        setScanStartedAt(match.startedAt);
        api.getRegisteredProfiles().then(profiles => {
          if (cancelled) return;
          const cart = profiles.find(c => c.id === match.profileId);
          if (cart) {
            setProfileName(cart.displayName);
            setFrameworkLabel(cart.framework);
            setProfileCert(cart.certification);
          }
        }).catch(() => {});
      }
    }).catch(err => {
      console.error('Failed to load scan metadata for scan type:', err);
    });
    return () => { cancelled = true; };
  }, [api, jobId]);

  return {
    scanType,
    profileName,
    frameworkLabel,
    profileCert,
    scanComplianceProfileId,
    scanInventoryId,
    scanStartedAt,
  };
}
