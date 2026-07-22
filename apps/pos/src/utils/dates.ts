/** Date helpers shared by history/report screens. */

export type DatePreset = 'today' | 'yesterday' | 'week' | 'all' | 'custom';

export const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'week' },
  { label: 'All', value: 'all' },
  { label: 'Custom', value: 'custom' },
];

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function presetDates(p: DatePreset): { from: string | null; to: string | null } {
  const now = new Date();
  if (p === 'today') { const s = isoDate(now); return { from: s, to: s }; }
  if (p === 'yesterday') {
    const d = new Date(now); d.setDate(d.getDate() - 1); const s = isoDate(d); return { from: s, to: s };
  }
  if (p === 'week') {
    const start = new Date(now); start.setDate(start.getDate() - start.getDay());
    return { from: isoDate(start), to: isoDate(now) };
  }
  return { from: null, to: null };
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
