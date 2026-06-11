export const SEVERITY_COLORS = {
  CAT_I: '#C9190B',
  CAT_II: '#F0AB00',
  CAT_III: '#0066CC',
} as const;

export const STATUS_COLORS = {
  success: '#3E8635',
  warning: '#F0AB00',
  error: '#C9190B',
  info: '#0066CC',
  neutral: '#6A6E73',
} as const;

export const EXECUTION_COLORS = {
  pending:   { bg: '#FFF3E0', fg: '#E65100' },
  running:   { bg: '#E3F2FD', fg: '#1565C0' },
  succeeded: { bg: '#E8F5E9', fg: STATUS_COLORS.success },
  failed:    { bg: '#FFEBEE', fg: STATUS_COLORS.error },
  cancelled: { bg: '#ECEFF1', fg: '#546E7A' },
} as const;

export const PROFILE_STATUS_COLORS = {
  draft:    { bg: '#FFF3E0', fg: '#E65100' },
  saved:    { bg: '#E8F5E9', fg: STATUS_COLORS.success },
  archived: { bg: '#ECEFF1', fg: '#546E7A' },
} as const;

export const FINDING_STATE_COLORS = {
  new:        { color: STATUS_COLORS.info, bgColor: 'transparent', variant: 'outlined' as const },
  active:     { color: STATUS_COLORS.neutral, bgColor: 'transparent', variant: 'outlined' as const },
  fixed:      { color: '#fff', bgColor: STATUS_COLORS.success, variant: 'default' as const },
  resurfaced: { color: STATUS_COLORS.error, bgColor: 'transparent', variant: 'outlined' as const },
} as const;

export const THRESHOLDS = {
  excellent: 90,
  good: 70,
} as const;

export function scoreColor(rate: number): string {
  if (rate >= THRESHOLDS.excellent) return STATUS_COLORS.success;
  if (rate >= THRESHOLDS.good) return STATUS_COLORS.warning;
  return STATUS_COLORS.error;
}
