// Known constructor accent colors (visual only, not derived from data).
// Used purely to tint UI elements; the underlying team identity comes from the API.

const COLORS: Record<string, string> = {
  mercedes: '#27f4d2',
  red_bull: '#1e41ff',
  ferrari: '#e8002d',
  mclaren: '#ff8000',
  aston_martin: '#229971',
  alpine: '#ff87bc',
  williams: '#0e7fd6',
  rb: '#6692ff',
  sauber: '#52e252',
  audi: '#bb0a30',
  haas: '#b6babd',
  kick_sauber: '#52e252',
  cadillac: '#d4af37',
};

const FALLBACK_COLOR = '#6b7280';

export function teamColor(id?: string | null): string {
  if (!id) return FALLBACK_COLOR;
  const key = id.toLowerCase();
  return COLORS[key] ?? FALLBACK_COLOR;
}

// Normalize an OpenF1 team_colour (hex without #) into a CSS color.
export function openF1Color(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return '#' + v.toLowerCase();
  if (/^[0-9a-fA-F]{3}$/.test(v)) return '#' + v.toLowerCase();
  return undefined;
}

export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const hexBody = m?.[1];
  if (!hexBody) return `rgba(255,59,59,${alpha})`;
  const int = parseInt(hexBody, 16);
  if (!Number.isFinite(int)) return `rgba(255,59,59,${alpha})`;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
