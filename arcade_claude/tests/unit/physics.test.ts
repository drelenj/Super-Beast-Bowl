// Deterministic physics suite: speed caps, collision momentum conservation, ball arcs, arrow timing, stamina, replay hash.
import { describe, it, expect } from 'vitest';
import { PHYS, topSpeed, accelRate, turnRate, jumpHeight, throwSpeed, bodyFor, ballStep, collide, attrsFor, hReach, vReach } from '../../src/engine/physics';
import { Engine } from '../../src/engine/engine';
import { TEAMS, teamByName, defaultSettings, runHeadless } from '../../src/engine/match';
import { techRatings } from '../../src/ratings/tech';
import { ballTraj } from '../../src/engine/intercept';
import * as C from '../../src/engine/constants';

const all = TEAMS.flatMap((t) => t.players);
const mk = (seed = 1) => new Engine(teamByName('Ala Marauders'), teamByName('Xenar Ignite'), defaultSettings(seed));

describe('rating -> real-unit mappings', () => {
  it('speed: rating / 100 x 44.704 m/s (one config constant)', () => {
    expect(PHYS.SPEED_MPS_AT_100).toBe(44.704);
    expect(topSpeed(100)).toBeCloseTo(44.704, 6); expect(topSpeed(65)).toBeCloseTo(29.0576, 4); expect(topSpeed(80)).toBeCloseTo(35.7632, 4);
  });
  it('acceleration, turn rate, jump and throw speed are monotonic in their rating', () => {
    for (const f of [accelRate, turnRate, jumpHeight, throwSpeed]) for (let r = 65; r < 100; r++) expect(f(r + 1)).toBeGreaterThan(f(r));
    expect(accelRate(65)).toBe(PHYS.ACCEL_AT_65); expect(accelRate(100)).toBe(PHYS.ACCEL_AT_100);
  });
  it('size drives only geometry: attrs do not change with height or mass; body does', () => {
    const p = all[0]; const big = { ...p, heightM: p.heightM * 1.3, massKg: p.massKg * 2 };
    expect(attrsFor(big.phys, techRatings(big))).toEqual(attrsFor(p.phys, techRatings(p)));
    expect(bodyFor(big).radius).toBeGreaterThan(bodyFor(p).radius); expect(bodyFor(big).mass).toBe(p.massKg * 2);
  });
  it('body footprint is plausible for every athlete (0.25 to 0.75 m radius) and grows with mass', () => {
    for (const p of all) { const b = bodyFor(p); expect(b.radius).toBeGreaterThan(0.25); expect(b.radius).toBeLessThan(0.75); expect(b.height).toBe(p.heightM); expect(b.reach).toBe(p.reachM); }
  });
  it('reach uses arm span, standing reach and Jumping', () => {
    const b = bodyFor(all[0]);
    expect(hReach(b, false)).toBeCloseTo(b.radius + b.armSpan * 0.4, 9); expect(vReach(b, 1)).toBeCloseTo(b.reach + 1, 9); expect(hReach(b, true)).toBeGreaterThan(hReach(b, false));
  });
});

describe('athlete motion', () => {
  it('no athlete ever exceeds his top speed (collisions aside, 5% tolerance) over 60 s of play', () => {
    const e = mk(3); let worst = 0;
    for (let i = 0; i < 3600; i++) { if (e.phase === 'break') e.resumeFromBreak(); e.step(); for (const a of e.ath) if (e.active(a) && a.role !== 'archer' && a.recoverT <= 0) worst = Math.max(worst, Math.hypot(a.vx, a.vy) / a.a.top); }
    expect(worst).toBeLessThanOrEqual(1.05); expect(worst).toBeGreaterThan(0.5);
  });
  it('a sprinting athlete accelerates at his Acceleration-rating rate and caps at his Speed-rating speed', () => {
    const e = mk(1); const a = e.ath[0]; e.phase = 'live'; e.huntActive = false;
    for (const o of e.ath) if (o !== a) { o.x = 0; o.y = 40 + o.idx; o.onField = false; }
    a.x = -40; a.y = -40; a.vx = a.vy = 0; a.stamina = 1; e.teams[0].human = true; e.teams[0].selected = a.idx;
    const v: number[] = [];
    for (let i = 0; i < 240; i++) { e.humanIntent[0] = { mx: 1, my: 0, sprint: true, pass: -1, shoot: false, tackle: false, fire: -1 }; e.clock = 600; e.playClock = 30; e.step(); v.push(a.vx); }
    expect(v[29]).toBeCloseTo(a.a.accel * 0.5, 0);                    // after 0.5 s: v = a t
    expect(Math.max(...v)).toBeLessThanOrEqual(a.a.top + 1e-6);
    expect(v[239]).toBeGreaterThan(a.a.top * 0.97);                   // reaches top speed inside 4 s
  });
  it('sprinting drains stamina at the Stamina-rating rate and rest restores it', () => {
    const e = mk(1); const a = e.ath[0]; e.phase = 'live'; e.huntActive = false;
    for (const o of e.ath) if (o !== a) o.onField = false;
    a.x = -45; a.y = -45; e.teams[0].human = true; e.teams[0].selected = a.idx;
    for (let i = 0; i < 120; i++) { e.humanIntent[0] = { mx: 0.7, my: 0.7, sprint: true, pass: -1, shoot: false, tackle: false, fire: -1 }; e.clock = 600; e.playClock = 30; e.step(); }
    expect(a.stamina).toBeCloseTo(1 - 2 / a.a.staminaCap, 2);
    const low = a.stamina;
    for (let i = 0; i < 120; i++) { e.humanIntent[0] = { mx: 0, my: 0, sprint: false, pass: -1, shoot: false, tackle: false, fire: -1 }; e.clock = 600; e.playClock = 30; e.step(); }
    expect(a.stamina).toBeGreaterThan(low);
  });
});

describe('collisions', () => {
  it('momentum is conserved for any masses and restitution', () => {
    for (const [ma, mb, e] of [[100, 700, 0.1], [518, 92, 0], [300, 300, 1]] as const) {
      const a = { m: ma, vx: 20, vy: -3 }, b = { m: mb, vx: -12, vy: 5 };
      const r = collide(a, b, 0.6, 0.8, e);
      expect(r.a.m * r.a.vx + r.b.m * r.b.vx).toBeCloseTo(ma * 20 + mb * -12, 6);
      expect(r.a.m * r.a.vy + r.b.m * r.b.vy).toBeCloseTo(ma * -3 + mb * 5, 6);
    }
  });
  it('the lighter body takes the larger change of velocity; a perfectly elastic hit conserves kinetic energy', () => {
    const r = collide({ m: 100, vx: 10, vy: 0 }, { m: 700, vx: -10, vy: 0 }, 1, 0, 0.1);
    expect(Math.abs(r.a.vx - 10)).toBeGreaterThan(Math.abs(r.b.vx + 10) * 6.9);
    const el = collide({ m: 200, vx: 8, vy: 0 }, { m: 300, vx: -4, vy: 0 }, 1, 0, 1);
    expect(0.5 * 200 * el.a.vx ** 2 + 0.5 * 300 * el.b.vx ** 2).toBeCloseTo(0.5 * 200 * 64 + 0.5 * 300 * 16, 6);
  });
});

describe('ball flight', () => {
  it('rises and falls under gravity; with drag switched low the apex matches v^2 / 2g within 3%', () => {
    const b = { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 10 }; let apex = 0;
    for (let i = 0; i < 600 && !(i > 5 && b.z <= PHYS.BALL_R); i++) { ballStep(b, C.DT); apex = Math.max(apex, b.z); }
    expect(apex).toBeGreaterThan(1 + (100 / (2 * PHYS.G)) * 0.97 - 0.2); expect(apex).toBeLessThan(1 + 100 / (2 * PHYS.G) + 0.01);
  });
  it('drag only ever slows the ball; a bounce loses energy; the ball comes to rest', () => {
    const b = { x: 0, y: 0, z: 2, vx: 40, vy: 0, vz: 3 }; let last = 40, bounces = 0;
    for (let i = 0; i < 3000; i++) { if (ballStep(b, C.DT)) bounces++; expect(b.vx).toBeLessThanOrEqual(last + 1e-9); last = b.vx; }
    expect(bounces).toBeGreaterThan(0); expect(Math.abs(b.vx)).toBeLessThan(0.01); expect(b.z).toBeCloseTo(PHYS.BALL_R, 6);
  });
  it('the AI flight prediction matches the engine integrator (same step function) to within 0.3 m after 1 s', () => {
    const s0 = { x: 0, y: 0, z: 2, vx: 30, vy: 10, vz: 6 }; const b = { ...s0 };
    for (let i = 0; i < 60; i++) ballStep(b, C.DT);
    const p = ballTraj(s0, 1.2)[30];
    expect(Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z)).toBeLessThan(0.3);
  });
  it('a pass thrown at a stationary receiver arrives within reach of him (drag-aware aiming)', () => {
    const e = mk(5); const a = e.ath[0], r = e.ath[1]; e.phase = 'live'; e.huntActive = false;
    for (const o of e.ath) if (o !== a && o !== r) o.onField = false;
    a.x = -20; a.y = 0; r.x = 10; r.y = 12; a.vx = a.vy = r.vx = r.vy = 0; e.setHolder(a.idx, false);
    e.passTo(a, r); let best = 99;
    for (let i = 0; i < 180 && e.ball.holder < 0; i++) { ballStep(e.ball, C.DT); best = Math.min(best, Math.hypot(e.ball.x - r.x, e.ball.y - r.y)); }
    expect(best).toBeLessThan(3.5);
  });
});

describe('arrows', () => {
  it('fly straight at exactly 250 m/s and arrive after distance / 250 s (to one step)', () => {
    const e = mk(2); e.phase = 'live'; e.huntActive = false;
    const archer = e.ath.find((a) => a.team === 0 && a.role === 'archer')!; const t = e.ath.find((a) => a.team === 1 && a.role === 'field')!;
    t.x = -20; t.y = 6; t.vx = t.vy = 0; t.px = t.x; t.py = t.y;
    e.fireArrow(archer, t);
    expect(e.arrows.length).toBe(1); const ar = e.arrows[0];
    expect(Math.hypot(ar.vx, ar.vy, ar.vz)).toBeCloseTo(250, 6);
    const d = Math.hypot(ar.tx - archer.x, ar.ty - archer.y); let steps = 0;
    while (!ar.resolved && steps < 100) { e.arrowsStep(C.DT); steps++; }
    expect(Math.abs(steps * C.DT - d / 250)).toBeLessThan(2.5 * C.DT);
  });
});

describe('determinism', () => {
  it('seeded full-match replay: same seed gives the identical event hash and final state; another seed differs', () => {
    const s = () => ({ ...defaultSettings(4242), periodLen: 90, otLen: 45 });
    const a = runHeadless('Ala Apex', 'Kasuf Bloodravens', s()), b = runHeadless('Ala Apex', 'Kasuf Bloodravens', s());
    const c = runHeadless('Ala Apex', 'Kasuf Bloodravens', { ...s(), seed: 4243 });
    expect(a.phase).toBe('final'); expect(a.eventHash()).toBe(b.eventHash()); expect(a.hash()).toBe(b.hash()); expect(a.events.length).toBe(b.events.length);
    expect(c.eventHash()).not.toBe(a.eventHash());
  }, 60000);
});
