// tech-1.0 technical ratings generator. ARCADE-DERIVED, NOT CANON. See docs/TECH_RATINGS.md.
//
// Pure and deterministic: no Math.random, no Date, no transcendental Math functions. Every operation is
// integer arithmetic or an IEEE-754 basic operation (+ - * /, Math.round, Math.imul), so Node and every
// browser produce bit-identical output.
//
// Inputs used:  Player ID (seed only), position, Opening-day OVR, the nine LOCKED physical ratings.
// Inputs NOT used: height, mass, arm span, reach, physique, ancestry, age, salary (owner rule: no size bonuses).
// The canon OVR and physical ratings are read, never modified.
import type { PlayerData, PhysRatings, PosCode, TechRatings } from '../engine/types';

export const TECH_VERSION = 'tech-1.0';
export const TECH_LABEL = 'ARCADE-DERIVED, NOT CANON';
export const TECH_KEYS: (keyof TechRatings)[] = ['tackling', 'ballSecurity', 'catching', 'passAccuracy', 'passVision', 'shotAccuracy', 'carryPower', 'elusiveness', 'pursuit', 'coverage', 'screening', 'archeryAim', 'archeryDiscipline', 'keeperReaction', 'keeperPositioning', 'footwork', 'discipline', 'clutch', 'awareness'];

export type TechKey = keyof TechRatings;
export type Tier = 'primary' | 'secondary' | 'general' | 'off';
export interface RoleSkills { primary: TechKey[]; secondary: TechKey[] }

/** Role table: every position has exactly 3 primary and 4 secondary skills, so the composite has the same
 *  expected offset from OVR at every position (no position-mix bias in team strength). */
export const ROLE_SKILLS: Record<PosCode, RoleSkills> = {
  STR: { primary: ['shotAccuracy', 'elusiveness', 'catching'], secondary: ['ballSecurity', 'footwork', 'clutch', 'passAccuracy'] },
  SCT: { primary: ['catching', 'elusiveness', 'footwork'], secondary: ['ballSecurity', 'shotAccuracy', 'passAccuracy', 'awareness'] },
  SEN: { primary: ['screening', 'tackling', 'awareness'], secondary: ['carryPower', 'coverage', 'ballSecurity', 'discipline'] },
  TRK: { primary: ['pursuit', 'tackling', 'footwork'], secondary: ['coverage', 'awareness', 'catching', 'discipline'] },
  HNT: { primary: ['pursuit', 'coverage', 'catching'], secondary: ['tackling', 'awareness', 'elusiveness', 'footwork'] },
  TRP: { primary: ['coverage', 'catching', 'awareness'], secondary: ['pursuit', 'tackling', 'footwork', 'passAccuracy'] },
  GRD: { primary: ['tackling', 'coverage', 'discipline'], secondary: ['screening', 'pursuit', 'awareness', 'ballSecurity'] },
  PDR: { primary: ['passAccuracy', 'passVision', 'awareness'], secondary: ['ballSecurity', 'clutch', 'footwork', 'shotAccuracy'] },
  PFD: { primary: ['carryPower', 'ballSecurity', 'shotAccuracy'], secondary: ['catching', 'screening', 'elusiveness', 'clutch'] },
  KPR: { primary: ['keeperReaction', 'keeperPositioning', 'catching'], secondary: ['awareness', 'footwork', 'passAccuracy', 'discipline'] },
  ARC: { primary: ['archeryAim', 'archeryDiscipline', 'awareness'], secondary: ['discipline', 'clutch', 'footwork', 'passVision'] },
};

/** General skills: everyone has these near OVR unless the role table promotes them to primary/secondary. */
export const GENERAL_KEYS: TechKey[] = ['footwork', 'discipline', 'clutch', 'awareness'];

export const TECH_PARAMS = {
  MIN: 60, MAX: 99,
  PRIMARY_OFFSET: 3,       // primary skill centre   = OVR + 3
  SECONDARY_OFFSET: -2,    // secondary skill centre = OVR - 2
  GENERAL_OFFSET: -1,      // general skill centre   = OVR - 1
  OFF_FLOOR: 60,           // off-role centre = OFF_FLOOR + OFF_SLOPE * (OVR - OFF_FLOOR); result never above OVR
  OFF_SLOPE: 0.6,
  NOISE_SD: 4,             // rating points, before truncation
  NOISE_TRUNC: 2,          // truncated at +/- 2 SD (so |noise| <= 8)
  PHYS_CENTRE: 80,         // physical contribution = sum k * (rating - 80)
  PHYS_CAP: 3,             // total physical contribution clamped to +/- 3 rating points
  KNEE: 92, KNEE_SLOPE: 0.6, // soft ceiling: the part of a value above 92 is scaled by 0.6 (keeps elites off a wall of 99s)
  COMPOSITE_PRIMARY_WEIGHT: 2, COMPOSITE_SECONDARY_WEIGHT: 1,
} as const;

/** Every physical coefficient. Skills not listed here get NOTHING physical (pure skill). */
export const PHYS_COEF: Partial<Record<TechKey, Partial<Record<keyof PhysRatings, number>>>> = {
  tackling: { strength: 0.08, balance: 0.06 },
  carryPower: { strength: 0.09, balance: 0.06 },
  elusiveness: { agility: 0.08, acceleration: 0.06 },
  pursuit: { speed: 0.08, acceleration: 0.06 },
  keeperReaction: { agility: 0.08, jumping: 0.06 },
  screening: { strength: 0.1 },
  footwork: { agility: 0.07, balance: 0.07 },
};

export function tierOf(pos: PosCode, key: TechKey): Tier {
  const r = ROLE_SKILLS[pos];
  if (r.primary.indexOf(key) >= 0) return 'primary';
  if (r.secondary.indexOf(key) >= 0) return 'secondary';
  if (GENERAL_KEYS.indexOf(key) >= 0) return 'general';
  return 'off';
}

// ---- seeded noise -------------------------------------------------------------------------------------------

/** FNV-1a 32-bit over UTF-16 code units. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32: returns a generator of uniforms in [0, 1) with 32-bit resolution. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function techSeed(id: string, key: TechKey): number { return fnv1a(id + '|' + TECH_VERSION + '|' + key); }

/** Truncated near-normal noise in rating points for one (player, skill).
 *  Standard normal by Irwin-Hall (sum of 12 uniforms minus 6: mean 0, SD 1) because it needs only exact
 *  additions (no log/cos, whose last bit may differ between JS engines). Truncated at +/- NOISE_TRUNC SD by
 *  rejection (re-draw, up to 16 times, then clamp), then scaled by NOISE_SD. */
export function techNoise(id: string, key: TechKey): number {
  const rnd = mulberry32(techSeed(id, key));
  const lim = TECH_PARAMS.NOISE_TRUNC;
  let z = 0;
  for (let tries = 0; tries < 16; tries++) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += rnd();
    z = s - 6;
    if (z >= -lim && z <= lim) break;
  }
  if (z > lim) z = lim; else if (z < -lim) z = -lim;
  return z * TECH_PARAMS.NOISE_SD;
}

// ---- generator ----------------------------------------------------------------------------------------------

/** Centred physical contribution in rating points, clamped to +/- PHYS_CAP. Zero for pure-skill keys. */
export function physContribution(phys: PhysRatings, key: TechKey): number {
  const c = PHYS_COEF[key];
  if (!c) return 0;
  let v = 0;
  for (const k of Object.keys(c) as (keyof PhysRatings)[]) v += (c[k] as number) * (phys[k] - TECH_PARAMS.PHYS_CENTRE);
  const cap = TECH_PARAMS.PHYS_CAP;
  return v > cap ? cap : v < -cap ? -cap : v;
}

/** Role-weighted centre for a skill before noise and physical contribution. */
export function roleCentre(pos: PosCode, key: TechKey, ovr: number): number {
  const P = TECH_PARAMS;
  switch (tierOf(pos, key)) {
    case 'primary': return ovr + P.PRIMARY_OFFSET;
    case 'secondary': return ovr + P.SECONDARY_OFFSET;
    case 'general': return ovr + P.GENERAL_OFFSET;
    default: return P.OFF_FLOOR + P.OFF_SLOPE * (ovr - P.OFF_FLOOR);
  }
}

function techValue(p: PlayerData, key: TechKey): number {
  const P = TECH_PARAMS;
  let v = roleCentre(p.pos, key, p.ovr) + techNoise(p.id, key) + physContribution(p.phys, key);
  if (v > P.KNEE) v = P.KNEE + (v - P.KNEE) * P.KNEE_SLOPE;
  let r = Math.round(v);
  if (tierOf(p.pos, key) === 'off' && r > p.ovr) r = p.ovr; // off-role skills are never above OVR
  return r < P.MIN ? P.MIN : r > P.MAX ? P.MAX : r;
}

/** The 19 technical ratings (integers 60-99) for one player. Same input always gives the same output. */
export function techRatings(p: PlayerData): TechRatings {
  const o = {} as TechRatings;
  for (const k of TECH_KEYS) o[k] = techValue(p, k);
  return o;
}

/** Role-weighted mean of the position's primary (weight 2) and secondary (weight 1) skills, 2 decimals.
 *  Used for team-strength checks; expected value is about OVR + 1 at every position. */
export function techComposite(p: PlayerData): number {
  const t = techRatings(p);
  const r = ROLE_SKILLS[p.pos];
  const wp = TECH_PARAMS.COMPOSITE_PRIMARY_WEIGHT, ws = TECH_PARAMS.COMPOSITE_SECONDARY_WEIGHT;
  let sum = 0, w = 0;
  for (const k of r.primary) { sum += wp * t[k]; w += wp; }
  for (const k of r.secondary) { sum += ws * t[k]; w += ws; }
  return Math.round((sum / w) * 100) / 100;
}

// ---- export table (data/tech_ratings.json) ------------------------------------------------------------------

export interface TechExportRow { name: string; franchise: string; pos: PosCode; ovr: number; tech: TechRatings; composite: number }
export interface TechExport {
  version: string; label: string; generatedFrom: string; generator: string; note: string;
  keys: TechKey[]; count: number; players: Record<string, TechExportRow>;
}

/** Builds the exported table. Deterministic: no timestamps, players in roster order. */
export function buildTechExport(teams: { franchise: string; players: PlayerData[] }[]): TechExport {
  const players: Record<string, TechExportRow> = {};
  let count = 0;
  for (const t of teams) for (const p of t.players) {
    players[p.id] = { name: p.name, franchise: t.franchise, pos: p.pos, ovr: p.ovr, tech: techRatings(p), composite: techComposite(p) };
    count++;
  }
  return {
    version: TECH_VERSION, label: TECH_LABEL,
    generatedFrom: 'data/rosters.json (Player ID, position, Opening-day OVR, nine locked physical ratings)',
    generator: 'src/ratings/tech.ts via scripts/build_tech.ts (npm run build:tech)',
    note: 'Technical ratings are derived for the arcade game only. Canon OVR and physical ratings are never modified. Height, mass, span and reach are not used.',
    keys: TECH_KEYS.slice(), count, players,
  };
}
