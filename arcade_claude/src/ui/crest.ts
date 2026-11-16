// Original team crest glyph: a shield in the team's primary / secondary / accent colours with the
// three-letter abbreviation. Inline SVG data URL, no image files, no third-party marks.
import type { TeamColors } from '../engine/types';

const cache = new Map<string, string>();

function lum(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function crestSvg(c: TeamColors, size: number): string {
  const edge = lum(c.number || '#ffffff') > 0.5 ? '#000000' : '#ffffff';
  const fs = (c.abbr || '').length > 3 ? 14 : 17;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `<path d="M32 3 L57 10 V32 C57 46 46 56 32 61 C18 56 7 46 7 32 V10 Z" fill="${c.primary}" stroke="#0b0e16" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="M32 3 L57 10 V32 C57 46 46 56 32 61 C18 56 7 46 7 32 V10 Z" fill="${c.primary}" stroke="${c.accent}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="M9.5 12 L32 5.7 L54.5 12 V20 L32 24 L9.5 20 Z" fill="${c.secondary}"/>` +
    `<path d="M13 43 L32 50 L51 43 C47 50 40.5 55 32 58.2 C23.5 55 17 50 13 43 Z" fill="${c.secondary}"/>` +
    `<circle cx="32" cy="14.6" r="3.2" fill="${c.accent}"/>` +
    `<text x="32" y="41" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${fs}" letter-spacing="0.5" fill="${c.number}" stroke="${edge}" stroke-opacity="0.35" stroke-width="0.6" paint-order="stroke">${c.abbr}</text>` +
    `</svg>`;
}

/** Crest as an inline SVG data URL for any <img>. */
export function crestDataUrl(c: TeamColors, size: number): string {
  const k = c.abbr + '|' + c.primary + '|' + size;
  let u = cache.get(k);
  if (!u) { u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(crestSvg(c, size)); cache.set(k, u); }
  return u;
}

/** A readable version of a team colour for text on the dark UI. */
export function inkFor(c: TeamColors): string {
  if (lum(c.primary) >= 0.3) return c.primary;
  if (lum(c.secondary) >= 0.3) return c.secondary;
  return lum(c.accent) >= 0.3 ? c.accent : '#ffffff';
}
