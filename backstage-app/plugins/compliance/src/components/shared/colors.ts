export const SEVERITY_COLORS = {
  CAT_I: '#C9190B',
  CAT_II: '#F0AB00',
  CAT_III: '#0066CC',
};

export const STATUS_COLORS = {
  success: '#3E8635',
  warning: '#F0AB00',
  error: '#C9190B',
  info: '#0066CC',
  neutral: '#6A6E73',
};

export const THRESHOLDS = {
  excellent: 90,
  good: 70,
};

export function scoreColor(rate: number): string {
  if (rate >= THRESHOLDS.excellent) return STATUS_COLORS.success;
  if (rate >= THRESHOLDS.good) return STATUS_COLORS.warning;
  return STATUS_COLORS.error;
}
