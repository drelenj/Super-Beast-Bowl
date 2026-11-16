import { PlayerData, PosCode, TeamData } from './types';

/** ARCADE PLACEHOLDER: position -> behaviour line preference (0 back .. 1 forward). */
export const LINE_PREF: Record<string, number> = { GRD: 0, TRP: 0.2, SEN: 0.35, TRK: 0.5, PDR: 0.6, HNT: 0.7, PFD: 0.8, SCT: 0.9, STR: 1 };
export const POS_LABEL: Record<string, string> = {
  STR: 'Striker (finisher)', SCT: 'Scout (wide receiver)', SEN: 'Sentinel (screen)', TRK: 'Tracker (pursuer)',
  HNT: 'Hunter (ball hawk)', TRP: 'Trapper (interceptor)', GRD: 'Guard (goal-side)', PDR: 'Playdriver (passer)',
  PFD: 'Power forward (carrier)', KPR: 'Keeper', ARC: 'Archer',
};

export function parseFormation(f: string): [number, number, number] {
  const p = f.split(/[–\-]/).map((s) => parseInt(s, 10));
  if (p.length === 3 && p.every((n) => n > 0) && p[0] + p[1] + p[2] === 10) return [p[0], p[1], p[2]];
  return [3, 4, 3];
}

export interface Lineup { field: { p: PlayerData; line: number; slotY: number }[]; keeper: PlayerData; archer: PlayerData; bench: PlayerData[] }

export function buildLineup(t: TeamData): Lineup {
  const starters = t.players.filter((p) => p.role === 'Projected starter');
  const keeper = starters.find((p) => p.pos === 'KPR') ?? t.players.find((p) => p.pos === 'KPR')!;
  const archer = starters.find((p) => p.pos === 'ARC') ?? t.players.find((p) => p.pos === 'ARC')!;
  let fieldP = starters.filter((p) => p.pos !== 'KPR' && p.pos !== 'ARC');
  if (fieldP.length < 10) {
    const extra = t.players.filter((p) => !starters.includes(p) && p.pos !== 'KPR' && p.pos !== 'ARC').sort((a, b) => b.ovr - a.ovr);
    fieldP = fieldP.concat(extra.slice(0, 10 - fieldP.length));
  }
  fieldP = fieldP.slice(0, 10).sort((a, b) => (LINE_PREF[a.pos] ?? 0.5) - (LINE_PREF[b.pos] ?? 0.5) || a.id.localeCompare(b.id));
  const [nb, nm, nf] = parseFormation(t.formation || starters[0]?.formation || '3–4–3');
  const counts = [nb, nm, nf];
  const field: Lineup['field'] = [];
  let k = 0;
  for (let line = 0; line < 3; line++) {
    const n = counts[line];
    for (let i = 0; i < n; i++) {
      const slotY = n === 1 ? 0 : -1 + (2 * i) / (n - 1);
      field.push({ p: fieldP[k++], line, slotY });
    }
  }
  // gameday 22: the 12 starters plus 10 reserves, which must include a reserve Keeper and a reserve Archer
  const used = new Set([keeper.id, archer.id, ...fieldP.map((p) => p.id)]);
  const rest = t.players.filter((p) => !used.has(p.id)).sort((a, b) => (a.role === 'Outside projected 25' ? 1 : 0) - (b.role === 'Outside projected 25' ? 1 : 0) || b.ovr - a.ovr || a.id.localeCompare(b.id));
  const rk = rest.find((p) => p.pos === 'KPR'), ra = rest.find((p) => p.pos === 'ARC');
  const bench: PlayerData[] = [];
  if (rk) bench.push(rk); if (ra) bench.push(ra);
  for (const p of rest) { if (bench.length >= 10) break; if (p.pos !== 'KPR' && p.pos !== 'ARC') bench.push(p); }
  return { field, keeper, archer, bench };
}

/** Deterministic, varied appearance from Player ID (skin tone, hair, build, height, face). */
export function lookFor(id: string, pos: PosCode) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = (n: number) => { h = Math.imul(h ^ (h >>> 13), 1597334677); return ((h >>> 0) % n); };
  const buildBias = pos === 'GRD' || pos === 'PFD' || pos === 'KPR' ? 2 : pos === 'SCT' || pos === 'STR' || pos === 'ARC' ? 0 : 1;
  const build = Math.max(0, Math.min(2, buildBias + (r(3) - 1) * (r(2))));
  return { skin: r(4), hair: r(4), build, height: 0.92 + r(17) / 100, face: r(4) };
}
