import React from 'react';
import { Chip, ChipProps } from '@material-ui/core';
import type { ScanCertification, CertificationStatus } from '@aap-compliance/common';

const COLORS: Record<CertificationStatus, string> = {
  certified: '#3E8635',
  conformant: '#0066CC',
  uncertified: '#6A6E73',
};

const LABELS: Record<CertificationStatus, string> = {
  certified: 'Certified',
  conformant: 'Conformant',
  uncertified: 'Uncertified',
};

interface CertificationBadgeProps extends Omit<ChipProps, 'label'> {
  certification: ScanCertification | null | undefined;
}

export const CertificationBadge = ({ certification, style, ...chipProps }: CertificationBadgeProps) => {
  const status = certification?.status ?? 'uncertified';
  return (
    <Chip
      label={LABELS[status]}
      size="small"
      style={{
        fontWeight: 600,
        backgroundColor: COLORS[status],
        color: '#fff',
        ...style,
      }}
      {...chipProps}
    />
  );
};
