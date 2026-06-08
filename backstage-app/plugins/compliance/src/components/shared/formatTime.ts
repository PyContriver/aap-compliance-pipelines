export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  return formatElapsed(seconds);
}
