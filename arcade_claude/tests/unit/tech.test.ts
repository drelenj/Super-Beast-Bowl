// tech-1.0 technical ratings (ARCADE-DERIVED, NOT CANON): determinism, ranges, role weighting, bounded physical
// contribution, no size effect, OVR as best predictor, and team strength order.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlayerData, PhysRatings } from '../../src/engine/types';
import { buildTechExport, GENERAL_KEYS, PHYS_COEF, ROLE_SKILLS, TECH_KEYS, TECH_PARAMS, TECH_VERSION, techComposite, techNoise, techRatings, tierOf } from '../../src/ratings/tech';

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
interface Team { franchise: string; players: PlayerData[] }
const teams = read('../../data/rosters.json').teams as Team[];
const all = teams.flatMap((t) => t.players);
const PHYS: (keyof PhysRatings)[] = ['speed', 'strength', 'jumping', 'acceleration', 'agility', 'balance', 'throwPower', 'stamina', 'durability'];

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
function pearson(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
function ranks(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(a.length); let i = 0;
  while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const rk = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = rk; i = j + 1; }
  return r;
}
const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));
const clone = (p: PlayerData): PlayerData => ({ ...p, phys: { ...p.phys } });

describe('tech-1.0 technical ratings', () => {
  it('covers the whole roster and keeps the public contract', () => {
    expect(all.length).toBe(712);
    expect(TECH_VERSION).toBe('tech-1.0');
    expect(TECH_KEYS.length).toBe(19);
    expect(new Set(TECH_KEYS).size).toBe(19);
  });

  it('is deterministic: same input twice gives identical output', () => {
    for (const p of all) {
      expect(techRatings(p)).toEqual(techRatings(clone(p)));
      expect(techComposite(p)).toBe(techComposite(clone(p)));
    }
  });

  it('committed data/tech_ratings.json equals a fresh generation', () => {
    const committed = read('../../data/tech_ratings.json');
    const fresh = JSON.parse(JSON.stringify(buildTechExport(teams)));
    expect(committed.version).toBe('tech-1.0');
    expect(committed.label).toBe('ARCADE-DERIVED, NOT CANON');
    expect(Object.keys(committed.players).length).toBe(712);
    expect(committed).toEqual(fresh);
  });

  it('all 19 keys present, integers 60-99, for all 712 players', () => {
    for (const p of all) {
      const t = techRatings(p);
      expect(Object.keys(t).sort()).toEqual([...TECH_KEYS].sort());
      for (const k of TECH_KEYS) {
        expect(Number.isInteger(t[k])).toBe(true);
        expect(t[k]).toBeGreaterThanOrEqual(60);
        expect(t[k]).toBeLessThanOrEqual(99);
      }
    }
  });

  it('role table: 3 primary + 4 secondary per position, KPR and ARC specialities are primary', () => {
    for (const pos of Object.keys(ROLE_SKILLS) as PlayerData['pos'][]) {
      const r = ROLE_SKILLS[pos];
      expect(r.primary.length).toBe(3);
      expect(r.secondary.length).toBe(4);
      expect(new Set([...r.primary, ...r.secondary]).size).toBe(7);
      for (const k of GENERAL_KEYS) expect(tierOf(pos, k)).not.toBe('off');
    }
    expect(ROLE_SKILLS.KPR.primary).toEqual(expect.arrayContaining(['keeperReaction', 'keeperPositioning']));
    expect(ROLE_SKILLS.ARC.primary).toEqual(expect.arrayContaining(['archeryAim', 'archeryDiscipline']));
  });

  it('role weighting: primary > secondary > off-role on average; off-role never above OVR', () => {
    const d: Record<string, number[]> = { primary: [], secondary: [], general: [], off: [] };
    for (const p of all) {
      const t = techRatings(p);
      for (const k of TECH_KEYS) {
        const tier = tierOf(p.pos, k);
        d[tier].push(t[k] - p.ovr);
        if (tier === 'off') expect(t[k]).toBeLessThanOrEqual(p.ovr);
      }
    }
    const m = { primary: mean(d.primary), secondary: mean(d.secondary), general: mean(d.general), off: mean(d.off) };
    console.log(`[tech] mean (skill - OVR) by tier: primary ${m.primary.toFixed(2)}, secondary ${m.secondary.toFixed(2)}, general ${m.general.toFixed(2)}, off-role ${m.off.toFixed(2)}`);
    expect(m.primary).toBeGreaterThan(1.5);
    expect(m.primary).toBeLessThan(4);
    expect(m.secondary).toBeGreaterThan(-3);
    expect(m.secondary).toBeLessThan(-1);
    expect(m.off).toBeLessThan(-5);
    // a Striker has high shotAccuracy but modest keeperReaction
    const str = all.filter((p) => p.pos === 'STR').map((p) => techRatings(p));
    expect(mean(str.map((t) => t.shotAccuracy)) - mean(str.map((t) => t.keeperReaction))).toBeGreaterThan(6);
  });

  it('distinguishability: >= 90% of same-OVR same-position pairs differ in >= 3 skills', () => {
    const groups = new Map<string, PlayerData[]>();
    for (const p of all) { const g = `${p.pos}|${p.ovr}`; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(p); }
    let pairs = 0, ok = 0;
    for (const g of groups.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = techRatings(g[i]), b = techRatings(g[j]);
      let diff = 0; for (const k of TECH_KEYS) if (a[k] !== b[k]) diff++;
      pairs++; if (diff >= 3) ok++;
    }
    console.log(`[tech] distinguishability: ${ok}/${pairs} pairs (${((100 * ok) / pairs).toFixed(2)}%) differ in >= 3 skills`);
    expect(pairs).toBeGreaterThan(100);
    expect(ok / pairs).toBeGreaterThanOrEqual(0.9);
  });

  it('noise: mean near 0, SD in a sane band, truncated at +/- 2 SD', () => {
    const n = all.flatMap((p) => TECH_KEYS.map((k) => techNoise(p.id, k)));
    const lim = TECH_PARAMS.NOISE_SD * TECH_PARAMS.NOISE_TRUNC;
    console.log(`[tech] noise: mean ${mean(n).toFixed(3)}, SD ${sd(n).toFixed(3)}, min ${Math.min(...n).toFixed(2)}, max ${Math.max(...n).toFixed(2)}`);
    expect(Math.abs(mean(n))).toBeLessThan(0.15);
    expect(sd(n)).toBeGreaterThan(3.0);
    expect(sd(n)).toBeLessThan(4.2);
    expect(Math.max(...n.map(Math.abs))).toBeLessThanOrEqual(lim);
    // noise for different skills of the same player is not shared (no hidden "second OVR")
    const a = all.map((p) => techNoise(p.id, 'tackling')), b = all.map((p) => techNoise(p.id, 'catching'));
    expect(Math.abs(pearson(a, b))).toBeLessThan(0.12);
  });

  it('physical contribution is bounded: a 35-point swing in any one physical rating moves any skill by <= 4', () => {
    let worst = 0;
    for (const p of all) for (const ph of PHYS) {
      const lo = clone(p), hi = clone(p);
      lo.phys[ph] = 65; hi.phys[ph] = 100;
      const a = techRatings(lo), b = techRatings(hi);
      for (const k of TECH_KEYS) {
        const d = Math.abs(a[k] - b[k]);
        if (d > worst) worst = d;
        if (!PHYS_COEF[k] || PHYS_COEF[k]![ph] === undefined) expect(d).toBe(0); // undocumented pairs have zero effect
        else expect(b[k]).toBeGreaterThanOrEqual(a[k]);
      }
    }
    console.log(`[tech] largest move of any skill for a 65 -> 100 swing in one physical rating: ${worst}`);
    expect(worst).toBeLessThanOrEqual(4);
    expect(worst).toBeGreaterThan(0);
  });

  it('pure-skill keys get nothing physical; all nine physicals at extremes move a skill by <= 2 * PHYS_CAP', () => {
    const pure = ['passAccuracy', 'passVision', 'shotAccuracy', 'archeryAim', 'archeryDiscipline', 'discipline', 'clutch', 'awareness', 'ballSecurity', 'catching', 'coverage'] as const;
    for (const k of pure) expect(PHYS_COEF[k]).toBeUndefined();
    for (const p of all) {
      const lo = clone(p), hi = clone(p);
      for (const ph of PHYS) { lo.phys[ph] = 65; hi.phys[ph] = 100; }
      const a = techRatings(lo), b = techRatings(hi);
      for (const k of pure) expect(a[k]).toBe(b[k]);
      for (const k of TECH_KEYS) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(2 * TECH_PARAMS.PHYS_CAP + 1);
    }
  });

  it('size fields have no effect (height, mass, span, reach, physique)', () => {
    for (const p of all) {
      const q = clone(p);
      q.heightM = p.heightM * 1.5; q.heightIn = p.heightIn * 1.5; q.massKg = p.massKg * 2; q.massLb = p.massLb * 2;
      q.armSpanM = p.armSpanM * 0.5; q.armSpanIn = p.armSpanIn * 0.5; q.reachM = p.reachM * 3; q.reachIn = p.reachIn * 3;
      q.physique = p.physique === 'Hulking' ? 'Lean' : 'Hulking';
      expect(techRatings(q)).toEqual(techRatings(p));
      expect(techComposite(q)).toBe(techComposite(p));
    }
  });

  it('OVR is the best predictor: corr(composite, OVR) > 0.9 and above every physical rating', () => {
    const comp = all.map(techComposite), ovr = all.map((p) => p.ovr);
    const r = pearson(comp, ovr);
    const physR = PHYS.map((k) => [k, pearson(comp, all.map((p) => p.phys[k]))] as const);
    console.log(`[tech] corr(composite, OVR) = ${r.toFixed(4)}; physical: ${physR.map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ')}`);
    expect(r).toBeGreaterThan(0.9);
    for (const [, v] of physR) expect(r).toBeGreaterThan(Math.abs(v));
    for (const pos of Object.keys(ROLE_SKILLS)) {
      const ps = all.filter((p) => p.pos === pos);
      expect(pearson(ps.map(techComposite), ps.map((p) => p.ovr))).toBeGreaterThan(0.9);
    }
  });

  it('team strength order: Spearman(mean starter composite, mean starter OVR) >= 0.9 over 26 teams', () => {
    expect(teams.length).toBe(26);
    const st = teams.map((t) => t.players.filter((p) => p.role === 'Projected starter'));
    for (const s of st) expect(s.length).toBe(12);
    const rho = spearman(st.map((s) => mean(s.map(techComposite))), st.map((s) => mean(s.map((p) => p.ovr))));
    console.log(`[tech] team strength Spearman = ${rho.toFixed(4)}`);
    expect(rho).toBeGreaterThanOrEqual(0.9);
  });
});
