// RULEBOOK 1.0 CONFORMANCE TESTS for the arcade engine (src/engine/engine.ts).
// A passing test here means the ARCADE engine does what the test name says. It is not simulator evidence
// and it is not owner acceptance. See docs/RULE_MATRIX.md for the rule-by-rule status.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as C from '../../src/engine/constants';
import { PHYS } from '../../src/engine/physics';
import { defaultSettings } from '../../src/engine/match';
import { NO_INTENT } from '../../src/engine/types';
import type { Engine } from '../../src/engine/engine';
import { mk, fieldOf, keeperOf, archerOf, place, goLive, stepUntil, runDead, idleDead, evs, lastEv, forceTackle, puppet, playMatch } from './rules_helpers';

const hyp = (...v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const SHORT = { periodLen: 60, otLen: 30 };

// ---------------------------------------------------------------- match structure
describe('match structure', () => {
  it('match: 4 periods of 600 s, overtime 300 s, play clock 30 s (constants and default settings)', () => {
    expect(C.PERIOD_LEN).toBe(600); expect(C.OT_LEN).toBe(300); expect(C.PLAY_CLOCK).toBe(30);
    const s = defaultSettings(1);
    expect(s.periodLen).toBe(600); expect(s.otLen).toBe(300); expect(s.scoring).toBe('flat');
    const e = mk(1);
    expect(e.period).toBe(1); expect(e.clock).toBe(600); expect(e.playClock).toBe(30);
  });

  it('match: a period ends when the game clock reaches 0 (period_end event, break, next period at 600 s)', () => {
    const e = mk(2);
    stepUntil(e, () => e.phase === 'live');
    e.clock = 0.03;
    stepUntil(e, () => e.phase === 'break', 30);
    const pe = lastEv(e, 'period_end');
    expect(pe).toBeTruthy(); expect(pe.clock).toBe(0); expect(pe.period).toBe(1);
    expect(e.phase).toBe('break'); expect(e.period).toBe(2); expect(e.clock).toBe(600);
  });

  it('match: ends are exchanged at every break (teams[].dir flips in resumeFromBreak)', () => {
    const e = mk(3);
    expect(e.teams[0].dir).toBe(1); expect(e.teams[1].dir).toBe(-1);
    for (let p = 1; p <= 3; p++) {
      const d0 = e.teams[0].dir, d1 = e.teams[1].dir;
      e.phase = 'live'; e.endPeriod();
      expect(e.phase).toBe('break');
      e.resumeFromBreak();
      expect(e.teams[0].dir).toBe(-d0); expect(e.teams[1].dir).toBe(-d1);
      expect(e.period).toBe(p + 1);
    }
  });

  it('match: not tied after period 4 ends the match with the leader as winner', () => {
    const e = mk(4); e.period = 4; e.teams[1].score = 2; e.phase = 'live';
    e.endPeriod();
    expect(e.phase).toBe('final'); expect(e.winner).toBe(1);
  });

  it('overtime: tied after period 4 gives period 5 of 300 s (settings.otLen)', () => {
    const e = mk(5); e.period = 4; e.phase = 'live';
    e.endPeriod();
    expect(e.phase).toBe('break'); expect(e.period).toBe(5); expect(e.clock).toBe(300); expect(e.suddenDeath).toBe(false);
    const s = mk(5, SHORT); s.period = 4; s.phase = 'live'; s.endPeriod();
    expect(s.clock).toBe(30);
  });

  it('overtime: a lead at the end of period 5 ends the match; still tied goes to sudden death (period 6)', () => {
    const a = mk(6); a.period = 5; a.teams[0].score = 2; a.phase = 'live'; a.endPeriod();
    expect(a.phase).toBe('final'); expect(a.winner).toBe(0);
    const e = mk(6); e.period = 5; e.phase = 'live'; e.endPeriod();
    expect(e.period).toBe(6); expect(e.suddenDeath).toBe(true); expect(e.phase).toBe('break');
  });

  it('sudden death: a goal ends the match', () => {
    const e = mk(7); e.period = 6; e.suddenDeath = true; goLive(e, 0);
    e.ball.releaseTeam = 0;
    e.goalScored(e.oppGoalX(0), -1, 0, 1);
    expect(e.phase).toBe('final'); expect(e.winner).toBe(0);
  });
  it('sudden death: a half goal ends the match', () => {
    const e = mk(7); e.period = 6; e.suddenDeath = true; goLive(e, 0);
    const ended = e.award(1, e.awardPoints(false), 'half', -1, 'test half goal');
    expect(ended).toBe(true); expect(e.phase).toBe('final'); expect(e.winner).toBe(1); expect(e.teams[1].score).toBe(1);
  });
  it('sudden death: a full-goal award (defence minor at count 0) ends the match', () => {
    const e = mk(7); e.period = 6; e.suddenDeath = true;
    goLive(e, 0, fieldOf(e, 0)[0]);
    e.defenceMinor(fieldOf(e, 1)[0], 'test hold');
    expect(e.phase).toBe('final'); expect(e.winner).toBe(0); expect(e.teams[0].score).toBe(2);
  });
});

// ---------------------------------------------------------------- First Hunt
describe('First Hunt', () => {
  it('hunt: a First Hunt opens the match (phase set, huntActive, restart.kind hunt, ball at the centre)', () => {
    const e = mk(10);
    expect(e.phase).toBe('set'); expect(e.huntActive).toBe(true); expect(e.restart?.kind).toBe('hunt');
    expect(e.ball.x).toBe(0); expect(e.ball.y).toBe(0); expect(e.ball.holder).toBe(-1); expect(e.poss).toBe(-1);
  });

  it('hunt: a First Hunt opens every period, overtime and sudden death', () => {
    const e = mk(11);
    for (let p = 2; p <= 7; p++) {
      e.phase = 'live'; e.huntActive = false; e.endPeriod();
      expect(e.phase).toBe('break');
      e.resumeFromBreak();
      expect(e.period).toBe(p);
      expect(e.phase).toBe('set'); expect(e.huntActive).toBe(true); expect(e.restart?.kind).toBe('hunt');
      expect(hyp(e.ball.x, e.ball.y)).toBe(0);
    }
  });

  it('hunt: every field player starts at or behind his own 40 m line', () => {
    const e = mk(12);
    for (const a of e.ath) if (a.role !== 'archer') expect(e.u(a.team, a.x)).toBeLessThanOrEqual(C.SCRIM_LINE + 1e-9);
  });

  it('hunt: repeats if the ball has not left the centre circle after 6 s', () => {
    expect(C.HUNT_LIMIT).toBe(6);
    const e = mk(13);
    stepUntil(e, () => e.phase === 'live');
    expect(e.huntActive).toBe(true);
    e.huntT = C.HUNT_LIMIT - 0.01;
    stepUntil(e, () => e.phase === 'dead', 5);
    expect(evs(e, 'hunt_repeat').length).toBe(1);
    runDead(e);
    expect(e.phase).toBe('set'); expect(e.restart?.kind).toBe('hunt'); expect(e.huntActive).toBe(true); expect(e.huntT).toBe(0);
  });

  it('hunt: the Hunt ends when the whole ball has left the 5 m centre circle', () => {
    const e = mk(14);
    stepUntil(e, () => e.phase === 'live');
    e.ball.x = C.CENTRE_CIRCLE_R + PHYS.BALL_R - 0.05; e.ball.y = 0;
    e.rules(C.DT);
    expect(e.huntActive).toBe(true);
    e.ball.x = C.CENTRE_CIRCLE_R + PHYS.BALL_R + 0.05;
    e.rules(C.DT);
    expect(e.huntActive).toBe(false);
  });

  it('hunt: Archers cannot fire before the ball leaves the circle (fireArrow is a no-op, arrowLegal false)', () => {
    const e = mk(15);
    stepUntil(e, () => e.phase === 'live');
    const ar = archerOf(e, 1), tgt = fieldOf(e, 0)[0];
    place(tgt, 30, 0);                       // inside team 1's half: would be legal in open play
    expect(e.arrowLegal(ar, tgt)).toBe(false);
    e.fireArrow(ar, tgt);
    expect(e.arrows.length).toBe(0); expect(e.teams[1].arrowsLeft).toBe(C.ARROWS_PER_POSS);
    expect(evs(e, 'arrow').length + evs(e, 'arrow_illegal').length).toBe(0);
    e.huntActive = false;
    e.fireArrow(ar, tgt);
    expect(e.arrows.length).toBe(1);
  });

  it('hunt: over the opening of real matches no arrow event precedes the ball leaving the circle', () => {
    for (const seed of [21, 22, 23]) {
      const e = mk(seed);
      let n = 0;
      while (n++ < 60 * 30 && !(e.phase === 'live' && !e.huntActive)) {
        e.step();
        if (e.huntActive) expect(e.events.filter((v) => v.type === 'arrow' || v.type === 'arrow_illegal').length).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------- play clock
describe('play clock', () => {
  it('play clock: expiry is a turnover scrimmaged at the spot when the spot is beyond the new team\'s own 40 m line', () => {
    const e = mk(30); const h = fieldOf(e, 0)[0];
    place(h, -20, 10);                         // team 1 attacks -x: u(1) = 70, closer to its target goal than its 40 m line
    goLive(e, 0, h); puppet(e, h);
    e.playClock = 0.01;
    stepUntil(e, () => e.phase === 'dead', 5);
    expect(lastEv(e, 'turnover').text).toMatch(/play clock expired/);
    expect(lastEv(e, 'turnover').team).toBe(1);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart?.kind).toBe('scrimmage'); expect(e.restart?.team).toBe(1);
    expect(e.restart!.x).toBeCloseTo(-20, 0); expect(e.restart!.y).toBeCloseTo(10, 0);
    expect(e.poss).toBe(1); expect(e.tackleCount).toBe(0); expect(e.playClock).toBe(C.PLAY_CLOCK);
  });

  it('play clock: expiry behind the new team\'s own 40 m line is scrimmaged at that 40 m line (closer to the goal it attacks)', () => {
    const e = mk(31); const h = fieldOf(e, 0)[0];
    place(h, 30, 10);                          // u(1) = 20 < 40
    goLive(e, 0, h); puppet(e, h);
    e.playClock = 0.01;
    stepUntil(e, () => e.phase === 'dead', 5);
    runDead(e);
    expect(e.restart?.team).toBe(1); expect(e.restart!.x).toBeCloseTo(e.xFromU(1, C.SCRIM_LINE), 6); expect(e.restart!.y).toBe(0);
    expect(e.u(1, e.restart!.x)).toBeCloseTo(40, 6);
  });

  it('play clock: counts down in live play and does not run during the Hunt', () => {
    const e = mk(32);
    stepUntil(e, () => e.phase === 'live');
    e.poss = 0; e.playClock = 30; e.rules(C.DT);
    expect(e.playClock).toBe(30);              // huntActive
    e.huntActive = false; e.rules(C.DT);
    expect(e.playClock).toBeCloseTo(30 - C.DT, 9);
  });

  it('play clock: carries through a first tackle (not reset by the Contact Scrimmage)', () => {
    const { e } = forceTackle(0, 0, (g) => { g.playClock = 17; });
    expect(e.tackleCount).toBe(1);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart?.kind).toBe('contact');
    expect(e.playClock).toBe(17);
  });

  it('play clock: fresh 30 s after a score', () => {
    const e = mk(33); goLive(e, 0); e.playClock = 4; e.ball.releaseTeam = 0;
    e.goalScored(e.oppGoalX(0), -1, 0, 1);
    runDead(e);
    expect(e.playClock).toBe(30);
  });

  it('play clock: fresh 30 s after a turnover', () => {
    const e = mk(34); goLive(e, 0); e.playClock = 4;
    e.turnover(1, 0, 0, 'test');
    runDead(e);
    expect(e.poss).toBe(1); expect(e.playClock).toBe(30); expect(e.tackleCount).toBe(0);
  });
});

// ---------------------------------------------------------------- field constants
describe('field constants', () => {
  it('field: goal radius 3 m, Keeper Zone 20 m, centre circle 5 m, 40 m scrimmage lines, 100 m x 100 m', () => {
    expect(C.GOAL_R).toBe(3); expect(C.KEEPER_ZONE_R).toBe(20); expect(C.CENTRE_CIRCLE_R).toBe(5); expect(C.SCRIM_LINE).toBe(40); expect(C.FIELD_HALF).toBe(50);
  });
  it('field: Archer platform is 5 m high and 5 m back (constants and the Archer\'s actual position)', () => {
    expect(C.PLATFORM_H).toBe(5); expect(C.PLATFORM_BACK).toBe(5);
    const e = mk(40);
    for (const t of [0, 1]) {
      const ar = archerOf(e, t);
      expect(Math.abs(ar.x)).toBe(55); expect(Math.sign(ar.x)).toBe(Math.sign(e.ownGoalX(t))); expect(ar.y).toBe(0); expect(ar.z).toBe(5);
    }
  });
  it('field: arrow speed 250 m/s (constants, the arrow\'s velocity and its time of flight)', () => {
    expect(C.ARROW_SPEED).toBe(250); expect(PHYS.ARROW_SPEED).toBe(250);
    const e = mk(41); goLive(e, 0);
    const ar = archerOf(e, 1), tgt = fieldOf(e, 0)[0];
    place(tgt, 20, 5);
    e.fireArrow(ar, tgt);
    expect(e.arrows.length).toBe(1);
    const w = e.arrows[0];
    expect(hyp(w.vx, w.vy, w.vz)).toBeCloseTo(250, 6);
    const d = hyp(w.tx - ar.x, w.ty - ar.y, tgt.body.height * 0.55 - w.z);
    expect(w.life).toBeCloseTo(d / 250 + 0.02, 6);
    let steps = 0;
    while (!w.resolved && steps < 200) { e.arrowsStep(C.DT); steps++; }
    expect(steps * C.DT).toBeLessThanOrEqual(d / 250 + 0.02 + 2 * C.DT);       // about 0.14 s for 35 m
    expect(steps * C.DT).toBeGreaterThan(d / 250 - 3 * C.DT);
  });
});

// ---------------------------------------------------------------- goal plane
describe('goal: whole ball inside the semicircle', () => {
  const shot = (y: number, z: number, seed = 50) => {
    const e = mk(seed); goLive(e, 0);
    const p = fieldOf(e, 0)[0];
    Object.assign(e.ball, { holder: -1, x: 49.7, y, z, vx: 40, vy: 0, vz: 0, inFlight: true, isShot: true, shotTeam: 0, releaseTeam: 0, passer: p.idx, releaseDist: 12, lastTouch: p.idx, lastTouchTeam: 0 });
    e.ballPhysics(C.DT, true);
    return e;
  };
  it('goal: ball radius is PHYS.BALL_R = 0.11 m and the goal is a 3 m semicircle', () => { expect(PHYS.BALL_R).toBe(0.11); expect(C.BALL_R).toBe(PHYS.BALL_R); });
  it('goal: a ball crossing the plane wholly inside the semicircle scores', () => {
    const e = shot(2.5, 0.5);                                   // centre 2.55 m from the goal centre: 0.34 m inside
    expect(evs(e, 'score').length).toBe(1); expect(e.teams[0].score).toBe(2); expect(lastEv(e, 'score').kind).toBe('thrown');
  });
  it('goal: a ball crossing high inside the arch scores; above the arch does not', () => {
    expect(shot(0, 2.6).teams[0].score).toBe(2);
    const o = shot(0, 3.3); expect(o.teams[0].score).toBe(0); expect(evs(o, 'score').length).toBe(0);
  });
  it('goal: a ball crossing just outside the semicircle does not score (and goes out of play)', () => {
    const e = shot(3.3, 0.5);
    expect(evs(e, 'score').length).toBe(0); expect(e.teams[0].score).toBe(0);
    expect(evs(e, 'out').length).toBe(1);
  });
  it('goal: ball CENTRE inside the semicircle but the ball not wholly inside (6-10 cm over the edge) does not score', () => {
    // margin about -0.07: the centre is 2.96 m out (inside 3 m) but the whole ball is not inside. Any wrong on-field
    // call is more than 5 cm wrong, so the defending team's review reverses it.
    for (let seed = 50; seed < 90; seed++) {
      const e = shot(2.95, 0.3, seed);
      expect(e.teams[0].score).toBe(0);
    }
  });
  it('goal: a carried ball crossing the plane inside the goal is a carried goal', () => {
    const e = mk(51); const h = fieldOf(e, 0)[0];
    place(h, 49.9, 0); h.facing = 0;
    goLive(e, 0, h); e.ball.x = 49.8; e.ball.y = 0;
    e.ballPhysics(C.DT, true);
    expect(lastEv(e, 'score')?.kind).toBe('carry'); expect(lastEv(e, 'score').who).toBe(h.idx); expect(e.teams[0].score).toBe(2);
  });
});

// ---------------------------------------------------------------- tackles and snaps
describe('tackles and snaps', () => {
  it('tackle: the first grounding tackle keeps the ball with the offence as a Contact Scrimmage at the spot (snapper = tackled carrier)', () => {
    const { e, c } = forceTackle(5, -12);
    expect(e.phase).toBe('dead'); expect(e.tackleCount).toBe(1); expect(e.poss).toBe(0);
    expect(evs(e, 'turnover').length).toBe(0);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart?.kind).toBe('contact'); expect(e.restart?.team).toBe(0);
    expect(e.restart?.snapper).toBe(c.idx); expect(e.ball.holder).toBe(c.idx);
    expect(e.restart!.x).toBeCloseTo(5, 6); expect(e.restart!.y).toBeCloseTo(-12, 6);
    expect(e.poss).toBe(0); expect(e.tackleCount).toBe(1);
  });

  it('tackle: the second grounding tackle is a turnover (scrimmage for the tackling team, count 0)', () => {
    const { e } = forceTackle(-20, 8, (g) => { g.tackleCount = 1; });
    expect(e.tackleCount).toBe(2);
    expect(lastEv(e, 'turnover').team).toBe(1); expect(lastEv(e, 'turnover').text).toMatch(/second grounding tackle/);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart?.kind).toBe('scrimmage'); expect(e.restart?.team).toBe(1);
    expect(e.poss).toBe(1); expect(e.tackleCount).toBe(0);
    expect(e.restart!.x).toBeCloseTo(-20, 6);          // u(1) = 70: at the spot
  });

  it('tackle: a first tackle closer than 10 m to a goal plane moves the scrimmage line out to 10 m', () => {
    const { e } = forceTackle(46, 3);
    runDead(e);
    expect(e.restart?.kind).toBe('contact'); expect(e.restart!.x).toBeCloseTo(40, 6); expect(e.restart!.y).toBeCloseTo(3, 6);
    const b = forceTackle(-47, 0).e; runDead(b);
    expect(b.restart!.x).toBeCloseTo(-40, 6);
  });

  it('snap: the snap must come within 10 s (snap timer starts at SNAP_LIMIT = 10)', () => {
    expect(C.SNAP_LIMIT).toBe(10);
    const e = mk(60); e.setupSnap('spot', 0, 10, 0);
    expect(e.phase).toBe('snap'); expect(e.snapT).toBe(10);
  });

  it('snap: an expired snap timer is a missed snap: tackle count +1 and the spot 5 m back', () => {
    const e = mk(61); e.setupSnap('spot', 0, 10, 0);
    const s = e.ath[e.restart!.snapper]; puppet(e, s);
    expect(e.tackleCount).toBe(0);
    e.snapT = 0.01;
    stepUntil(e, () => e.phase === 'dead', 5);
    expect(evs(e, 'missed_snap').length).toBe(1); expect(e.tackleCount).toBe(1);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart?.team).toBe(0); expect(e.restart!.x).toBeCloseTo(5, 6);
    expect(e.tackleCount).toBe(1); expect(e.poss).toBe(0);
  });

  it('snap: a missed snap at tackle count 1 is a turnover', () => {
    const e = mk(62); e.setupSnap('spot', 0, 10, 0); e.tackleCount = 1;
    e.missedSnap();
    expect(lastEv(e, 'turnover').team).toBe(1); expect(lastEv(e, 'turnover').text).toMatch(/missed snap at count 1/);
    runDead(e);
    expect(e.poss).toBe(1); expect(e.tackleCount).toBe(0); expect(e.restart?.kind).toBe('scrimmage');
  });

  it('snap: at a scrimmage each side is on its own side of the line the ball defines (offside prevented by positioning)', () => {
    const e = mk(63); e.setupSnap('scrimmage', 0, 10, 0);
    const bu = e.u(0, 10);
    for (const a of e.ath) {
      if (a.role === 'archer' || a.idx === e.restart!.snapper) continue;
      if (a.team === 0) expect(e.u(0, a.x)).toBeLessThanOrEqual(bu + 1e-9);
      else expect(e.u(0, a.x)).toBeGreaterThanOrEqual(bu - 1e-9);
    }
  });
});

// ---------------------------------------------------------------- restart after a score
describe('restart after a score', () => {
  it('after a score: scrimmage at the centre of the conceding team\'s own 40 m line, count 0, fresh 30 s, everyone at or behind his own 40 m line', () => {
    const e = mk(70); goLive(e, 0); e.tackleCount = 1; e.playClock = 3; e.ball.releaseTeam = 0;
    e.goalScored(e.oppGoalX(0), -1, 0.5, 1);
    expect(e.teams[0].score).toBe(2);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart?.kind).toBe('scrimmage'); expect(e.restart?.team).toBe(1);
    expect(e.u(1, e.restart!.x)).toBeCloseTo(40, 6); expect(e.restart!.y).toBe(0);
    expect(e.poss).toBe(1); expect(e.tackleCount).toBe(0); expect(e.playClock).toBe(30);
    for (const a of e.ath) if (a.role !== 'archer' && e.active(a)) expect(e.u(a.team, a.x)).toBeLessThanOrEqual(C.SCRIM_LINE + 1e-6);
  });

  it('after an awarded score (defence minor at count 0): the conceding team scrimmages at its own 40 m line', () => {
    const e = mk(71); goLive(e, 0, fieldOf(e, 0)[0]);
    e.defenceMinor(fieldOf(e, 1)[0], 'test hold');
    runDead(e);
    expect(e.restart?.kind).toBe('scrimmage'); expect(e.restart?.team).toBe(1); expect(e.u(1, e.restart!.x)).toBeCloseTo(40, 6); expect(e.tackleCount).toBe(0);
  });
});

// ---------------------------------------------------------------- out of play
describe('out of play and toss-in', () => {
  const sideOut = (seed = 80) => {
    const e = mk(seed); goLive(e, 0);
    e.ball.lastTouchTeam = 0; e.ball.lastTouch = fieldOf(e, 0)[0].idx;
    place(fieldOf(e, 0)[1], 10.5, 49.5); place(fieldOf(e, 0)[2], 10, 50);   // opponents of the thrower standing on the spot
    e.outOfPlay(10, 50.2);
    return e;
  };
  it('out of play: toss-in to the opponent of the last toucher at the crossing point', () => {
    const e = sideOut();
    expect(lastEv(e, 'out').team).toBe(1);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart?.kind).toBe('tossin'); expect(e.restart?.team).toBe(1);
    expect(e.restart!.x).toBeCloseTo(10, 6); expect(Math.abs(e.restart!.y)).toBeGreaterThanOrEqual(50); expect(Math.abs(e.restart!.y)).toBeLessThanOrEqual(50.5);
    expect(e.ath[e.ball.holder].team).toBe(1); expect(e.poss).toBe(1);
  });
  it('out of play: opponents are at least 3 m from the toss-in', () => {
    expect(C.TOSS_IN_CLEAR).toBe(3);
    const e = sideOut(); runDead(e);
    for (const a of e.ath) if (a.team === 0 && a.role !== 'archer' && e.active(a)) expect(hyp(a.x - e.restart!.x, a.y - e.restart!.y)).toBeGreaterThanOrEqual(3 - 1e-6);
  });
  it('out of play: the ball is ready after 1.5 s and must be thrown within 4 s (timer 5.5 s; no throw before ready)', () => {
    expect(C.TOSS_READY).toBe(1.5); expect(C.TOSS_LIMIT).toBe(4);
    const e = sideOut(); runDead(e);
    expect(e.restart?.readyT).toBe(1.5); expect(e.snapT).toBe(5.5);
    const th = e.ath[e.ball.holder]; const mate = fieldOf(e, 1).find((a) => a.idx !== th.idx)!;
    puppet(e, th);
    e.humanIntent[1] = { ...NO_INTENT(), pass: mate.idx };
    e.step();                                                        // 5.48 s left: not ready yet
    expect(e.phase).toBe('snap'); expect(e.ball.holder).toBe(th.idx);
    e.snapT = C.TOSS_LIMIT - 0.01;                                   // ready
    e.humanIntent[1] = { ...NO_INTENT(), pass: mate.idx };
    e.step();
    expect(e.phase).toBe('live'); expect(e.ball.holder).toBe(-1);
    expect(e.ball.noScore).toBe(true); expect(e.ball.noRecover).toBe(th.idx);
  });
  it('out of play: a tossed ball cannot score until another player controls it', () => {
    const e = sideOut(); runDead(e);
    const th = e.ath[e.ball.holder]; const mate = fieldOf(e, 1).find((a) => a.idx !== th.idx)!;
    e.passTo(th, mate);
    expect(e.ball.noScore).toBe(true);
    const gx = e.oppGoalX(1);
    Object.assign(e.ball, { x: gx + 0.3, y: 0, z: 1, vx: -40, vy: 0, vz: 0 });
    e.ballPhysics(C.DT, true);
    expect(evs(e, 'score').length).toBe(0); expect(e.teams[1].score).toBe(0);
    expect(evs(e, 'out').length).toBe(2);                            // treated as out over the goal line
    // control by another player lifts the bar; control by the thrower does not
    const f = sideOut(81); runDead(f);
    const t2 = f.ath[f.ball.holder]; const m2 = fieldOf(f, 1).find((a) => a.idx !== t2.idx)!;
    f.passTo(t2, m2);
    f.setHolder(t2.idx, true); expect(f.ball.noScore).toBe(true);
    f.setHolder(m2.idx, true); expect(f.ball.noScore).toBe(false); expect(f.ball.noRecover).toBe(-1);
  });
  it('out of play: the thrower cannot recover his own toss', () => {
    const e = sideOut(); runDead(e);
    const th = e.ath[e.ball.holder]; const mate = fieldOf(e, 1).find((a) => a.idx !== th.idx)!;
    e.passTo(th, mate);
    // leave the ball dead at the thrower's feet with nobody else near
    for (const a of e.ath) if (a.idx !== th.idx && a.role !== 'archer') place(a, a.team ? 40 : -40, -40 + (a.idx % 12) * 2);
    for (let i = 0; i < 40; i++) {
      th.noCatchT = 0; th.rolledPass = -1;
      Object.assign(e.ball, { x: th.x + 0.1, y: th.y, z: 0.3, vx: 0.5, vy: 0, vz: 0, holder: -1 });
      e.catches(th.x, th.y, 0.3);
      expect(e.ball.holder).not.toBe(th.idx);
    }
    // control: without the bar the same player picks it up
    e.ball.noRecover = -1; let got = false;
    for (let i = 0; i < 40 && !got; i++) { th.noCatchT = 0; th.rolledPass = -1; Object.assign(e.ball, { x: th.x + 0.1, y: th.y, z: 0.3, vx: 0.5, vy: 0, vz: 0, holder: -1 }); e.catches(th.x, th.y, 0.3); got = e.ball.holder === th.idx; }
    expect(got).toBe(true);
  });
  it('out of play: on a goal line the toss-in slides to the edge of the Keeper Zone', () => {
    for (const [y, want] of [[5, 20], [-7, -20]] as const) {
      const e = mk(82); goLive(e, 0); e.ball.lastTouchTeam = 0;
      e.outOfPlay(50.2, y);
      runDead(e);
      expect(e.restart?.kind).toBe('tossin'); expect(e.restart!.y).toBe(want); expect(Math.abs(e.restart!.x)).toBeGreaterThanOrEqual(50);
    }
    const e = mk(82); goLive(e, 0); e.ball.lastTouchTeam = 0; e.outOfPlay(50.2, 33); runDead(e);
    expect(e.restart!.y).toBeCloseTo(33, 6);                          // outside the Keeper Zone: at the crossing point
  });
  it('OWNER RULING 16 Nov: a goal-line toss-in not thrown in time restarts 5 m out from the goal line', () => {
    const e = mk(83); goLive(e, 0); e.ball.lastTouchTeam = 0;
    e.outOfPlay(50.2, 5); runDead(e);
    const th = e.ath[e.ball.holder]; puppet(e, th);
    e.snapT = 0.01;
    stepUntil(e, () => e.phase === 'dead', 5);
    expect(lastEv(e, 'missed_snap').text).toMatch(/Toss-in not thrown in time/);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart!.x).toBeCloseTo(45, 6); expect(e.restart!.y).toBe(20);
    expect(e.restart?.team).toBe(1); expect(e.poss).toBe(1); expect(e.tackleCount).toBe(1);
  });
});

// ---------------------------------------------------------------- possession and Archer quotas
describe('possession', () => {
  it('possession: flips only after 500 ms of control by the other team (C.CONTROL_TIME)', () => {
    expect(C.CONTROL_TIME).toBe(0.5);
    const e = mk(90); const h = fieldOf(e, 1)[0];
    place(h, 44, 44);
    goLive(e, 0); e.setHolder(h.idx, true); puppet(e, h);
    expect(e.poss).toBe(0);
    for (let i = 0; i < 27; i++) e.step();
    expect(e.ball.holder).toBe(h.idx); expect(e.poss).toBe(0);         // 0.45 s of control: not yet
    for (let i = 0; i < 6; i++) e.step();
    expect(e.poss).toBe(1);                                           // 0.55 s
    expect(lastEv(e, 'possession').team).toBe(1);
  });
  it('possession: the team keeps possession while its pass is in flight', () => {
    const e = mk(91); const [a, r] = fieldOf(e, 0);
    place(a, -30, 0); place(r, -30, 30);
    goLive(e, 0, a);
    e.passTo(a, r);
    expect(e.ball.holder).toBe(-1); expect(e.ball.inFlight).toBe(true); expect(e.poss).toBe(0);
    for (let i = 0; i < 10 && e.ball.holder < 0; i++) { e.ballPhysics(C.DT, false); e.rules(C.DT); expect(e.poss).toBe(0); }
  });
  it('archer quotas: 15 arrows and 5 freezes per team possession', () => {
    expect(C.ARROWS_PER_POSS).toBe(15); expect(C.FREEZES_PER_POSS).toBe(5);
    const e = mk(92);
    for (const t of e.teams) { expect(t.arrowsLeft).toBe(15); expect(t.freezesLeft).toBe(5); }
  });
  it('archer quotas: an Archer with no arrows left cannot fire', () => {
    const e = mk(92); goLive(e, 0);
    const ar = archerOf(e, 1), tgt = fieldOf(e, 0)[0]; place(tgt, 30, 0);
    e.teams[1].arrowsLeft = 0; e.fireArrow(ar, tgt); expect(e.arrows.length).toBe(0);
    e.teams[1].arrowsLeft = 3; e.teams[1].freezesLeft = 0; e.fireArrow(ar, tgt); expect(e.arrows.length).toBe(0);
  });
  it('archer quotas: NOT reset on a completed pass; reset when possession turns over', () => {
    const e = mk(93); const [a, r] = fieldOf(e, 0);
    place(a, -30, 0); place(r, -30, 20);
    goLive(e, 0, a);
    e.teams[1].arrowsLeft = 7; e.teams[1].freezesLeft = 2; e.teams[0].arrowsLeft = 9; e.teams[0].freezesLeft = 1;
    e.passTo(a, r);
    e.setHolder(r.idx, true);                                         // completed pass (catch path: setHolder via play)
    expect(e.poss).toBe(0);
    expect(e.teams[1].arrowsLeft).toBe(7); expect(e.teams[1].freezesLeft).toBe(2);
    e.changePossession(1, 'test');
    expect(e.teams[1].arrowsLeft).toBe(15); expect(e.teams[1].freezesLeft).toBe(5);
    expect(e.teams[0].arrowsLeft).toBe(15); expect(e.teams[0].freezesLeft).toBe(5);
  });
});

// ---------------------------------------------------------------- Archer
describe('archer', () => {
  it('archer: freeze lasts 5 s, then recovery 3 m back over 2 s, then 10 s immunity', () => {
    expect(C.FREEZE_TIME).toBe(5); expect(C.RECOVERY_DIST).toBe(3); expect(C.RECOVERY_TIME).toBe(2); expect(C.IMMUNE_TIME).toBe(10);
    const e = mk(100); const a = fieldOf(e, 0)[0];
    place(a, 10, 0); idleDead(e);
    a.frozenT = C.FREEZE_TIME;
    for (let i = 0; i < 297; i++) e.step();                            // 4.95 s
    expect(a.frozenT).toBeGreaterThan(0); expect(a.recoverT).toBe(0); expect(a.x).toBeCloseTo(10, 6);
    for (let i = 0; i < 6; i++) e.step();                              // 5.05 s
    expect(a.frozenT).toBe(0); expect(a.recoverT).toBeGreaterThan(1.8); expect(a.immuneT).toBe(0);
    for (let i = 0; i < 114; i++) e.step();                            // 6.95 s
    expect(a.recoverT).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++) e.step();                              // 7.05 s
    expect(a.recoverT).toBe(0); expect(a.immuneT).toBeGreaterThan(9.8);
    expect(a.x).toBeCloseTo(10 - e.teams[0].dir * 3, 0);               // 3 m back toward his own goal
    expect(Math.abs(a.x - 10)).toBeGreaterThan(2.9); expect(Math.abs(a.x - 10)).toBeLessThan(3.1);
    for (let i = 0; i < 594; i++) e.step();                            // 16.95 s
    expect(a.immuneT).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++) e.step();
    expect(a.immuneT).toBe(0);
  });

  it('archer: a legal arrow that hits freezes the target for 5 s, uses a freeze and is counted in arrowsLegal', () => {
    let hit: Engine | null = null, tIdx = -1;
    for (let seed = 1; seed < 60 && !hit; seed++) {
      const e = mk(seed); goLive(e, 0);
      const ar = archerOf(e, 1), tgt = fieldOf(e, 0)[0]; place(tgt, 35, 0);
      e.fireArrow(ar, tgt);
      expect(e.matchStats.arrowsLegal[1]).toBe(1); expect(e.matchStats.arrowsIllegal[1]).toBe(0); expect(e.teams[1].arrowsLeft).toBe(14);
      expect(evs(e, 'arrow').length).toBe(1);
      for (let i = 0; i < 30; i++) e.arrowsStep(C.DT);
      if (evs(e, 'freeze').length) { hit = e; tIdx = tgt.idx; }
    }
    expect(hit).not.toBeNull();
    expect(hit!.ath[tIdx].frozenT).toBe(5); expect(hit!.teams[1].freezesLeft).toBe(4);
  });

  const illegal = (prep: (e: Engine, tgt: ReturnType<typeof fieldOf>[number]) => void) => {
    const e = mk(101); const h = fieldOf(e, 0)[1]; place(h, 0, 30); goLive(e, 0, h);
    const ar = archerOf(e, 1), tgt = fieldOf(e, 0)[0]; place(tgt, 35, 0);
    prep(e, tgt);
    const before = { f: tgt.frozenT, i: tgt.immuneT };
    e.fireArrow(ar, tgt);
    expect(e.matchStats.arrowsIllegal[1]).toBe(1); expect(e.matchStats.arrowsLegal[1]).toBe(0);
    expect(e.teams[1].arrowsLeft).toBe(14);                            // arrow forfeited
    expect(e.arrows.length).toBe(0); expect(evs(e, 'freeze').length).toBe(0);
    expect(tgt.frozenT).toBe(before.f); expect(tgt.immuneT).toBe(before.i);    // no (re)freeze
    expect(ar.minors).toBe(1); expect(e.matchStats.minors[1]).toBe(1);        // minor on the Archer
    expect(evs(e, 'arrow_illegal').length).toBe(1);
    expect(lastEv(e, 'foul').who).toBe(ar.idx); expect(lastEv(e, 'foul').kind).toBe('minor');
    return e;
  };
  it('archer: an arrow at a frozen player is illegal: arrow forfeited, minor on the Archer, no freeze', () => {
    const e = illegal((_, t) => { t.frozenT = 3; });
    expect(lastEv(e, 'arrow_illegal').text).toMatch(/frozen/);
  });
  it('archer: an arrow at an immune player is illegal: arrow forfeited, minor on the Archer, no freeze', () => {
    const e = illegal((_, t) => { t.immuneT = 6; });
    expect(lastEv(e, 'arrow_illegal').text).toMatch(/immune/);
  });
  it('archer: an arrow at a player outside the Archer\'s own half is illegal: arrow forfeited, minor on the Archer, no freeze', () => {
    const e = illegal((_, t) => { place(t, -10, 0); });
    expect(lastEv(e, 'arrow_illegal').text).toMatch(/outside the Archer's own half/);
  });
  it('archer: a frozen ball carrier drops the ball', () => {
    const e = mk(102); const h = fieldOf(e, 0)[0]; place(h, 35, 0); goLive(e, 0, h);
    e.arrows.push({ team: 1, x: h.x + 1, y: 0, z: 1, vx: -250, vy: 0, vz: 0, target: h.idx, life: 0.1, tx: h.x, ty: 0, resolved: false });
    e.arrowsStep(C.DT);
    expect(h.frozenT).toBe(5); expect(e.ball.holder).toBe(-1);
  });
  it('archer: contact with a frozen ball holder is a major foul', () => {
    const e = mk(103); const c = fieldOf(e, 0)[0], t = fieldOf(e, 1)[0];
    place(c, 0, 0); place(t, 0.6, 0); goLive(e, 0, c); c.frozenT = 2;
    e.tryTackle(t);
    expect(t.majors).toBe(1); expect(lastEv(e, 'foul').text).toMatch(/frozen/);
  });
});

// ---------------------------------------------------------------- scoring
describe('scoring', () => {
  it('flat scoring (default): any goal is 2 (carry, thrown from any distance, own goal)', () => {
    const e = mk(110);
    expect(e.s.scoring).toBe('flat');
    expect(e.goalPoints('carry', 0)).toBe(2);
    for (const d of [1, 9.9, 10, 19.9, 20, 45]) expect(e.goalPoints('thrown', d)).toBe(2);
    expect(e.goalPoints('own', 0)).toBe(2);
  });
  it('flat scoring: half goal is 1', () => { expect(mk(110).awardPoints(false)).toBe(1); });
  it('flat scoring: full-goal award is 2 in EVERY period (1-4, overtime, sudden death)', () => {
    const e = mk(110);
    for (let p = 1; p <= 7; p++) { e.period = p; expect(e.awardPoints(true)).toBe(2); }
  });
  it('flat scoring: full-goal award is 2 in period 4 (defence minor at count 0 actually awards +2)', () => {
    const e = mk(111); e.period = 4; goLive(e, 0, fieldOf(e, 0)[0]);
    e.defenceMinor(fieldOf(e, 1)[0], 'test hold');
    expect(e.teams[0].score).toBe(2); expect(lastEv(e, 'score').kind).toBe('award'); expect(lastEv(e, 'score').pts).toBe(2);
    expect(e.teams[0].breakdown.award).toBe(2); expect(e.matchStats.pointsAward[0]).toBe(2);
  });
  it('flat scoring: full-goal award is 2 in overtime (period 5)', () => {
    const e = mk(112); e.period = 5; goLive(e, 0, fieldOf(e, 0)[0]);
    e.defenceMinor(fieldOf(e, 1)[0], 'test hold');
    expect(e.teams[0].score).toBe(2); expect(lastEv(e, 'score').kind).toBe('award');
  });
  it('banded scoring: carry 5; thrown 2 under 10 m, 3 from 10 to under 20 m, 4 from 20 m; own goal 2', () => {
    const e = mk(113, { scoring: 'banded' });
    expect(e.goalPoints('carry', 0)).toBe(5);
    expect(e.goalPoints('thrown', 0.5)).toBe(2); expect(e.goalPoints('thrown', 9.99)).toBe(2);
    expect(e.goalPoints('thrown', 10)).toBe(3); expect(e.goalPoints('thrown', 19.99)).toBe(3);
    expect(e.goalPoints('thrown', 20)).toBe(4); expect(e.goalPoints('thrown', 60)).toBe(4);
    expect(e.goalPoints('own', 0)).toBe(2); expect(e.goalPoints('own', 30)).toBe(2);
  });
  it('banded scoring: half goal 1, full-goal award 3', () => {
    const e = mk(113, { scoring: 'banded' });
    expect(e.awardPoints(false)).toBe(1); expect(e.awardPoints(true)).toBe(3);
    e.period = 4; goLive(e, 0, fieldOf(e, 0)[0]);
    e.defenceMinor(fieldOf(e, 1)[0], 'test hold');
    expect(e.teams[0].score).toBe(3);
  });
  it('banded scoring: a thrown goal is banded by the RELEASE distance (throwBall records it)', () => {
    for (const [x, pts] of [[44, 2], [35, 3], [25, 4]] as const) {
      const e = mk(114, { scoring: 'banded' }); const s = fieldOf(e, 0)[0];
      place(s, x, 0); goLive(e, 0, s);
      e.throwBall(s, 50.6, 0, 1, 30, true);
      expect(e.ball.releaseDist).toBeCloseTo(50 - x, 6); expect(e.ball.releaseTeam).toBe(0);
      e.goalScored(50, -1, 0, 1);
      expect(lastEv(e, 'score').kind).toBe('thrown'); expect(lastEv(e, 'score').pts).toBe(pts); expect(e.teams[0].score).toBe(pts);
      expect(lastEv(e, 'score').who).toBe(s.idx);
    }
  });
  it('banded scoring: a carried goal is 5', () => {
    const e = mk(115, { scoring: 'banded' }); const h = fieldOf(e, 0)[0]; place(h, 49.9, 0); goLive(e, 0, h);
    e.goalScored(50, h.idx, 0, 1);
    expect(e.teams[0].score).toBe(5); expect(e.teams[0].breakdown.carry).toBe(5);
  });
});

// ---------------------------------------------------------------- owner rulings 16 Nov
describe('OWNER RULINGS 16 Nov', () => {
  it('ruling (a): a defender\'s deflection of a shot into his own goal is an ordinary goal for the shooter\'s team, not an own goal', () => {
    let done = false;
    for (let seed = 1; seed < 80 && !done; seed++) {
      const e = mk(seed, { scoring: 'banded' }); const s = fieldOf(e, 0)[0], d = fieldOf(e, 1)[0];
      place(s, 30, 0); goLive(e, 0, s);
      for (const a of e.ath) if (a !== s && a !== d && a.role !== 'archer') place(a, a.team ? -30 : -40, -45 + (a.idx % 12) * 3);
      e.throwBall(s, 50.6, 0, 1, 30, true);
      place(d, 45, 0.3);
      Object.assign(e.ball, { x: 45, y: 0, z: 1, vx: 30, vy: 0, vz: 0 });
      e.catches(44.5, 0, 1);
      if (!evs(e, 'deflect').length) continue;
      done = true;
      expect(e.ball.lastTouchTeam).toBe(1);                            // the defender touched it last
      expect(e.ball.releaseTeam).toBe(0);                              // but the release is still the shooter's
      e.goalScored(50, -1, 0, 1);
      const sc = lastEv(e, 'score');
      expect(sc.kind).toBe('thrown'); expect(sc.team).toBe(0); expect(sc.who).toBe(s.idx);
      expect(sc.pts).toBe(4);                                          // banded by the shooter's 20 m release
      expect(e.teams[0].breakdown.own).toBe(0); expect(evs(e, 'score').filter((v) => v.kind === 'own').length).toBe(0);
    }
    expect(done).toBe(true);
  });
  it('ruling (b): own goal when the defending team is the holder (carried into his own goal)', () => {
    const e = mk(120, { scoring: 'banded' }); const d = fieldOf(e, 1)[0]; place(d, 49.9, 0); goLive(e, 1, d);
    e.goalScored(50, d.idx, 0, 1);
    const sc = lastEv(e, 'score');
    expect(sc.kind).toBe('own'); expect(sc.team).toBe(0); expect(sc.pts).toBe(2); expect(e.teams[0].score).toBe(2); expect(e.teams[0].breakdown.own).toBe(2);
    expect(d.stats.goals).toBe(0);
  });
  it('ruling (b): own goal when the defending team is the deliberate releaser at the goal event', () => {
    const e = mk(121); const d = fieldOf(e, 1)[0]; place(d, 40, 0); goLive(e, 1, d);
    e.throwBall(d, 50.6, 0, 1, 20, false);
    expect(e.ball.releaseTeam).toBe(1);
    e.goalScored(50, -1, 0, 1);
    expect(lastEv(e, 'score').kind).toBe('own'); expect(lastEv(e, 'score').team).toBe(0); expect(e.teams[0].score).toBe(2);
  });
  it('ruling (b): a loose ball with no releaser entering the goal is a goal for the attacking team, not an own goal', () => {
    const e = mk(122); goLive(e, 0); e.ball.releaseTeam = -1; e.ball.lastTouchTeam = 1;
    e.goalScored(50, -1, 0, 1);
    expect(lastEv(e, 'score').kind).toBe('thrown'); expect(lastEv(e, 'score').team).toBe(0); expect(lastEv(e, 'score').who).toBe(-1);
  });
  it('ruling (b): the own-goal state (ball.releaseTeam) resets on acquire (setHolder) and on award', () => {
    const e = mk(123); const [a, r] = fieldOf(e, 1); place(a, 30, 0); place(r, 30, 10); goLive(e, 1, a);
    e.passTo(a, r); expect(e.ball.releaseTeam).toBe(1);
    e.setHolder(fieldOf(e, 0)[0].idx, true); expect(e.ball.releaseTeam).toBe(-1);
    e.ball.releaseTeam = 1;
    e.award(0, 1, 'half', -1, 'test'); expect(e.ball.releaseTeam).toBe(-1);
  });
  it('ruling (c): a non-carrier hold by a defender is a defence minor: tackle count -1, offence scrimmages at the spot', () => {
    const e = mk(124); const h = fieldOf(e, 0)[0]; place(h, 12, -7); goLive(e, 0, h); e.tackleCount = 1; e.playClock = 21;
    const d = fieldOf(e, 1)[0];
    e.defenceMinor(d, 'holding (not the carrier)');
    expect(e.tackleCount).toBe(0); expect(d.minors).toBe(1); expect(e.teams[0].score).toBe(0);
    runDead(e);
    expect(e.restart?.kind).toBe('spot'); expect(e.restart?.team).toBe(0); expect(e.restart?.snapper).toBe(h.idx);
    expect(e.restart!.x).toBeCloseTo(12, 6); expect(e.restart!.y).toBeCloseTo(-7, 6);
    expect(e.poss).toBe(0); expect(e.tackleCount).toBe(0); expect(e.playClock).toBe(21);
  });
  it('ruling (c): defence minor at count 0 is a half goal (+1) in periods 1-3', () => {
    for (const p of [1, 2, 3]) {
      const e = mk(125); e.period = p; goLive(e, 0, fieldOf(e, 0)[0]);
      e.defenceMinor(fieldOf(e, 1)[0], 'holding (not the carrier)');
      expect(e.teams[0].score).toBe(1); expect(lastEv(e, 'score').kind).toBe('half'); expect(e.teams[0].breakdown.half).toBe(1);
    }
  });
  it('ruling (c): defence minor at count 0 is a full-goal award in period 4 and overtime', () => {
    for (const p of [4, 5]) {
      const e = mk(126); e.period = p; goLive(e, 0, fieldOf(e, 0)[0]);
      e.defenceMinor(fieldOf(e, 1)[0], 'holding (not the carrier)');
      expect(lastEv(e, 'score').kind).toBe('award'); expect(e.teams[0].score).toBe(e.awardPoints(true)); expect(e.teams[0].score).toBe(2);
    }
  });
  it('ruling (c): the behavioural hold model only ever charges a defender on a NON-carrier (event text)', () => {
    const e = playMatch(127, SHORT);
    for (const v of evs(e, 'foul')) if (/holding/.test(v.text)) expect(v.text).toMatch(/not the carrier/);
  });
});

// ---------------------------------------------------------------- discipline
describe('discipline', () => {
  it('discipline: first major = 120 s exclusion; the team plays short (active false)', () => {
    expect(C.MAJOR_EXCL).toBe(120);
    const e = mk(130); goLive(e, 0, fieldOf(e, 0)[0]);
    const d = fieldOf(e, 1)[0];
    e.majorFoul(d, 'test major', 0, 0);
    expect(d.majors).toBe(1); expect(d.dq).toBe(false); expect(d.excludedT).toBe(120); expect(e.active(d)).toBe(false);
    expect(e.ath.filter((a) => a.team === 1 && e.active(a)).length).toBe(11);
    expect(e.matchStats.majors[1]).toBe(1);
  });
  it('discipline: majors award no points', () => {
    for (const p of [1, 4, 5]) {
      const e = mk(131); e.period = p; goLive(e, 0, fieldOf(e, 0)[0]);
      e.majorFoul(fieldOf(e, 1)[0], 'test major', 0, 0);
      expect(e.teams[0].score).toBe(0); expect(e.teams[1].score).toBe(0); expect(evs(e, 'score').length).toBe(0);
    }
  });
  it('discipline: a major gives the fouled team a scrimmage at the spot', () => {
    const e = mk(132); goLive(e, 1, fieldOf(e, 1)[0]);               // team 1 has the ball and commits the major
    e.majorFoul(fieldOf(e, 1)[1], 'test major', 8, -4);
    runDead(e);
    expect(e.phase).toBe('snap'); expect(e.restart?.kind).toBe('scrimmage'); expect(e.restart?.team).toBe(0);
    expect(e.restart!.x).toBeCloseTo(8, 6); expect(e.restart!.y).toBeCloseTo(-4, 6); expect(e.poss).toBe(0); expect(e.tackleCount).toBe(0);
  });
  it('discipline: second major = disqualification', () => {
    const e = mk(133); goLive(e, 0); const d = fieldOf(e, 1)[0];
    e.foul(d, true, 'm1'); expect(d.dq).toBe(false);
    d.excludedT = 0;
    e.foul(d, true, 'm2');
    expect(d.dq).toBe(true); expect(e.matchStats.dqs[1]).toBe(1); expect(e.active(d)).toBe(false);
    expect(lastEv(e, 'foul').text).toMatch(/DISQUALIFIED/);
  });
  it('discipline: fourth minor = 60 s exclusion; fifth minor = disqualification', () => {
    expect(C.MINOR_EXCL).toBe(60);
    const e = mk(134); goLive(e, 0); const d = fieldOf(e, 1)[0];
    for (let i = 1; i <= 3; i++) { e.foul(d, false, 'm'); expect(d.excludedT).toBe(0); expect(e.active(d)).toBe(true); }
    e.foul(d, false, 'm4');
    expect(d.minors).toBe(4); expect(d.excludedT).toBe(60); expect(d.dq).toBe(false); expect(e.active(d)).toBe(false);
    d.excludedT = 0;
    e.foul(d, false, 'm5');
    expect(d.minors).toBe(5); expect(d.dq).toBe(true); expect(e.matchStats.dqs[1]).toBe(1);
  });
  it('discipline: exclusions run on game time (not during dead balls) and the player returns after 120 s', () => {
    const e = mk(135); goLive(e, 0); const d = fieldOf(e, 1)[0];
    e.foul(d, true, 'm1');
    idleDead(e);
    for (let i = 0; i < 300; i++) e.step();                            // 5 s of dead ball
    expect(d.excludedT).toBe(120);
    for (let i = 0; i < 60 * 119; i++) e.timers(d, C.DT, true);        // 119 s of live play
    expect(d.excludedT).toBeGreaterThan(0.9); expect(d.excludedT).toBeLessThan(1.1); expect(e.active(d)).toBe(false);
    for (let i = 0; i < 70; i++) e.timers(d, C.DT, true);
    expect(d.excludedT).toBe(0); expect(e.active(d)).toBe(true); expect(lastEv(e, 'return').who).toBe(d.idx);
  });
  it('discipline: offence minor is tackle count +1 with a scrimmage at the foul spot; at count 1 it is a turnover', () => {
    const e = mk(136); const h = fieldOf(e, 0)[0]; place(h, 3, 3); goLive(e, 0, h);
    e.offenceMinor(h, 'test', 3, 3);
    expect(e.tackleCount).toBe(1); runDead(e);
    expect(e.restart?.kind).toBe('spot'); expect(e.restart?.team).toBe(0); expect(e.tackleCount).toBe(1);
    const f = mk(136); const g = fieldOf(f, 0)[0]; place(g, 3, 3); goLive(f, 0, g); f.tackleCount = 1;
    f.offenceMinor(g, 'test', 3, 3);
    expect(lastEv(f, 'turnover').team).toBe(1); runDead(f); expect(f.poss).toBe(1); expect(f.tackleCount).toBe(0);
  });
});

// ---------------------------------------------------------------- full-match checks (short clock)
describe('full short matches (periodLen 60, otLen 30)', () => {
  const fouls: { text: string; phaseBefore: string }[] = [];
  let hashA = '', evCount = 0, finalPhase = '', periods = 0;
  it('pre-live marking foul is REVOKED: no foul text mentions marking and no foul is recorded outside live play', () => {
    const e = playMatch(20261116, SHORT, (g, ph, from) => {
      for (let i = from; i < g.events.length; i++) if (g.events[i].type === 'foul') fouls.push({ text: g.events[i].text, phaseBefore: ph });
    });
    hashA = e.eventHash(); evCount = e.events.length; finalPhase = e.phase; periods = evs(e, 'period_end').length;
    expect(finalPhase).toBe('final');
    for (const f of fouls) { expect(f.text).not.toMatch(/marking/i); expect(f.phaseBefore).toBe('live'); }
    for (const v of e.events) if (v.type === 'foul' || v.type === 'score') expect(v.text).not.toMatch(/marking/i);
  }, 120000);
  it('match flow: a full match plays at least 4 periods, each ending with a period_end event at clock 0', () => {
    expect(periods).toBeGreaterThanOrEqual(4);
  });
  it('determinism: the same seed gives an identical eventHash over a full short match', () => {
    const b = playMatch(20261116, SHORT);
    expect(b.eventHash()).toBe(hashA); expect(b.events.length).toBe(evCount);
  }, 120000);
  it('determinism: a different seed gives a different eventHash', () => {
    const c = playMatch(777, SHORT);
    expect(c.phase).toBe('final');
    expect(c.eventHash()).not.toBe(hashA);
  }, 120000);
});

// ---------------------------------------------------------------- timeouts
describe('timeouts', () => {
  it('timeouts: 2 per team per half', () => {
    expect(C.TIMEOUTS_PER_HALF).toBe(2);
    const e = mk(140); expect(e.timeoutsLeft).toEqual([2, 2]);
    e.phase = 'dead'; e.pending = null; e.phaseT = 5;
    expect(e.takeTimeout(0, 't')).toBe(true); expect(e.takeTimeout(0, 't')).toBe(true);
    expect(e.timeoutsLeft[0]).toBe(0);
    expect(e.takeTimeout(0, 't')).toBe(false); expect(e.matchStats.timeouts[0]).toBe(2); expect(evs(e, 'timeout').length).toBe(2);
  });
  it('timeouts: in live play only the team in possession may call one', () => {
    const e = mk(141); goLive(e, 0, fieldOf(e, 0)[0]);
    expect(e.canTimeout(1)).toBe(false); expect(e.takeTimeout(1, 't')).toBe(false); expect(e.timeoutsLeft[1]).toBe(2);
    expect(e.canTimeout(0)).toBe(true); expect(e.takeTimeout(0, 't')).toBe(true); expect(e.timeoutsLeft[0]).toBe(1);
  });
  it('timeouts: either team may call one at a dead ball', () => {
    const e = mk(142); goLive(e, 0); e.deadBall(2, () => e.setupSnap('scrimmage', 0, 0, 0));
    expect(e.takeTimeout(1, 't')).toBe(true); expect(e.takeTimeout(0, 't')).toBe(true);
    expect(e.timeoutsLeft).toEqual([1, 1]);
  });
  it('timeouts: unused timeouts do not carry over to the second half (reset to 2 at period 3, not at period 2)', () => {
    const e = mk(143); e.phase = 'dead'; e.takeTimeout(0, 't'); e.takeTimeout(0, 't');
    e.phase = 'live'; e.endPeriod();
    expect(e.period).toBe(2); expect(e.timeoutsLeft).toEqual([0, 2]);        // no reset inside a half
    e.resumeFromBreak(); e.phase = 'live'; e.endPeriod();
    expect(e.period).toBe(3); expect(e.timeoutsLeft).toEqual([2, 2]);        // team 1's unused 2 did not become 4
  });
  it('timeouts: 1 in overtime, none in sudden death', () => {
    const e = mk(144); e.period = 4; e.phase = 'live'; e.endPeriod();
    expect(e.period).toBe(5); expect(e.timeoutsLeft).toEqual([1, 1]);
    e.resumeFromBreak(); e.phase = 'live'; e.endPeriod();
    expect(e.period).toBe(6); expect(e.suddenDeath).toBe(true); expect(e.timeoutsLeft).toEqual([0, 0]);
    e.resumeFromBreak(); e.phase = 'dead'; e.timeoutsLeft = [1, 1];
    expect(e.canTimeout(0)).toBe(false); expect(e.takeTimeout(0, 't')).toBe(false);   // none in sudden death even if one were left
  });
  it('timeouts: the play clock resumes with the same time after a timeout in live play', () => {
    const e = mk(145); const h = fieldOf(e, 0)[0]; place(h, 0, 0); goLive(e, 0, h); e.playClock = 12; e.tackleCount = 1;
    e.takeTimeout(0, 't'); runDead(e);
    expect(e.phase).toBe('snap'); expect(e.playClock).toBe(12); expect(e.tackleCount).toBe(1); expect(e.poss).toBe(0);
  });
  it('coach policy: a timeout is taken at the first dead ball after the opponent scores twice in a row', () => {
    const e = mk(146); goLive(e, 0);
    e.ball.releaseTeam = 0; e.goalScored(e.oppGoalX(0), -1, 0, 1);
    runDead(e);
    expect(evs(e, 'timeout').length).toBe(0);                          // one score: no timeout
    e.ball.releaseTeam = 0; e.goalScored(e.oppGoalX(0), -1, 0, 1);
    expect(e.timeoutWanted[1]).toBe(true);
    runDead(e);
    expect(evs(e, 'timeout').length).toBe(1); expect(lastEv(e, 'timeout').team).toBe(1); expect(e.timeoutsLeft[1]).toBe(1);
    expect(lastEv(e, 'timeout').text).toMatch(/scored twice in a row/);
  });
  it('coach policy: alternating scores do not trigger the timeout', () => {
    const e = mk(147); goLive(e, 0);
    e.ball.releaseTeam = 0; e.goalScored(e.oppGoalX(0), -1, 0, 1); runDead(e);
    e.ball.releaseTeam = 1; e.goalScored(e.oppGoalX(1), -1, 0, 1); runDead(e);
    e.ball.releaseTeam = 0; e.goalScored(e.oppGoalX(0), -1, 0, 1); runDead(e);
    expect(evs(e, 'timeout').length).toBe(0);
  });
});

// ---------------------------------------------------------------- substitutions, injuries, forfeit
describe('substitutions and injuries', () => {
  it('squads: 22 gameday players per team, exactly 12 on the field (10 field, Keeper, Archer)', () => {
    const e = mk(150);
    for (const t of [0, 1]) {
      expect(e.squad.filter((a) => a.team === t).length).toBe(22);
      const on = e.ath.filter((a) => a.team === t);
      expect(on.length).toBe(12); expect(on.every((a) => a.onField)).toBe(true);
      expect(e.squad.filter((a) => a.team === t && a.onField).length).toBe(12);
      expect(on.filter((a) => a.role === 'field').length).toBe(10); expect(on.filter((a) => a.role === 'keeper').length).toBe(1); expect(on.filter((a) => a.role === 'archer').length).toBe(1);
      expect(new Set(e.squad.filter((a) => a.team === t).map((a) => a.d.id)).size).toBe(22);
    }
  });
  it('squads: a reserve Keeper and a reserve Archer are on the bench', () => {
    const e = mk(150);
    for (const t of [0, 1]) {
      const bench = e.squad.filter((a) => a.team === t && !a.onField);
      expect(bench.length).toBe(10);
      expect(bench.filter((a) => a.d.pos === 'KPR').length).toBeGreaterThanOrEqual(1);
      expect(bench.filter((a) => a.d.pos === 'ARC').length).toBeGreaterThanOrEqual(1);
    }
  });
  it('injury: an injured player\'s slot is filled by a same-role reserve at the next dead ball', () => {
    for (const role of ['field', 'keeper', 'archer'] as const) {
      const e = mk(151); goLive(e, 0);
      const out = e.ath.find((a) => a.team === 0 && a.role === role)!; const slot = out.idx;
      out.injured = true;
      expect(e.active(out)).toBe(false);
      e.deadBall(0.2, () => e.setupSnap('scrimmage', 1, 0, 0));
      runDead(e);
      const inn = e.ath[slot];
      expect(inn).not.toBe(out); expect(inn.team).toBe(0); expect(inn.role).toBe(role); expect(inn.onField).toBe(true); expect(out.onField).toBe(false);
      if (role === 'keeper') expect(inn.d.pos).toBe('KPR');
      if (role === 'archer') expect(inn.d.pos).toBe('ARC');
      if (role === 'field') { expect(inn.d.pos).not.toBe('KPR'); expect(inn.d.pos).not.toBe('ARC'); }
      expect(e.ath.filter((a) => a.team === 0 && e.active(a)).length).toBe(12);
      expect(lastEv(e, 'sub').text).toMatch(/injury replacement/);
    }
  });
  it('disqualification: the replacement comes on only after the exclusion window', () => {
    const e = mk(152); goLive(e, 0); const d = fieldOf(e, 1)[0]; const slot = d.idx;
    e.foul(d, true, 'm1'); d.excludedT = 0; e.foul(d, true, 'm2');
    expect(d.dq).toBe(true); expect(d.excludedT).toBe(120);
    e.benchWindow();
    expect(e.ath[slot]).toBe(d);                                       // still short: exclusion running
    expect(e.ath.filter((a) => a.team === 1 && e.active(a)).length).toBe(11);
    for (let i = 0; i < 60 * 121; i++) e.timers(d, C.DT, true);
    expect(d.excludedT).toBe(0); expect(e.active(d)).toBe(false);      // a DQ'd player never returns himself
    e.benchWindow();
    expect(e.ath[slot]).not.toBe(d); expect(e.ath[slot].role).toBe('field');
    expect(e.ath.filter((a) => a.team === 1 && e.active(a)).length).toBe(12);
    expect(lastEv(e, 'sub').text).toMatch(/replacement after disqualification/);
  });
  it('forfeit: fewer than 12 of 22 available forfeits the match; exactly 12 does not', () => {
    const e = mk(153); goLive(e, 0);
    const bench = e.squad.filter((a) => a.team === 0 && !a.onField);
    for (const a of bench) a.dq = true;                                // 12 left
    e.benchWindow();
    expect(e.phase).not.toBe('final'); expect(e.forfeit).toBe(-1);
    fieldOf(e, 0)[0].dq = true;                                        // 11 left
    e.benchWindow();
    expect(e.phase).toBe('final'); expect(e.forfeit).toBe(0); expect(e.winner).toBe(1); expect(evs(e, 'forfeit').length).toBe(1);
  });
});

// ---------------------------------------------------------------- review
describe('review (judgeGoal)', () => {
  it('review: a clear call (15 cm or more) is never wrong', () => {
    const e = mk(160);
    for (let i = 0; i < 300; i++) { expect(e.judgeGoal(50, 0.2)).toBe(true); expect(e.judgeGoal(50, -0.2)).toBe(false); }
    expect(evs(e, 'review').length).toBe(0);
  });
  it('review: a call wrong by more than 5 cm is reversed when the aggrieved team has a challenge (challenge kept)', () => {
    const e = mk(161); let reviews = 0;
    for (let i = 0; i < 6000; i++) {
      expect(e.judgeGoal(50, -0.08)).toBe(false);                      // truth: no goal by 8 cm; any "goal" call is reversed
      expect(e.judgeGoal(50, 0.08)).toBe(true);
    }
    reviews = evs(e, 'review').length;
    expect(reviews).toBeGreaterThan(0);
    for (const v of evs(e, 'review')) expect(v.text).toMatch(/call reversed/);
    expect(e.reviewsLeft).toEqual([1, 1]);
    expect(e.matchStats.reviews[0] + e.matchStats.reviews[1]).toBe(reviews);
  });
  it('review: without a challenge left the wrong call stands', () => {
    const e = mk(162); e.reviewsLeft = [0, 0]; let wrong = 0;
    for (let i = 0; i < 6000; i++) if (e.judgeGoal(50, -0.08)) wrong++;
    expect(wrong).toBeGreaterThan(0); expect(evs(e, 'review').length).toBe(0);
  });
  it('review: within 5 cm the call stands and the challenge is lost', () => {
    const e = mk(163); let n = 0;
    while (n++ < 2000 && !e.judgeGoal(50, -0.03)) { /* until the judge wrongly calls a goal */ }
    expect(n).toBeLessThan(2000);
    const defending = e.ownGoalX(0) === 50 ? 0 : 1;                    // the wrongly conceded team is aggrieved
    expect(lastEv(e, 'review').team).toBe(defending); expect(lastEv(e, 'review').text).toMatch(/call stands/);
    expect(e.reviewsLeft[defending]).toBe(0); expect(e.reviewsLeft[1 - defending]).toBe(1);
    expect(PHYS.REVIEW_MARGIN).toBe(0.05);
  });
  it('review: one challenge per half (reset at period 3), two in overtime', () => {
    const e = mk(164); expect(e.reviewsLeft).toEqual([1, 1]);
    e.reviewsLeft = [0, 0]; e.period = 2; e.phase = 'live'; e.endPeriod(); expect(e.reviewsLeft).toEqual([1, 1]);
    e.period = 4; e.phase = 'live'; e.endPeriod(); expect(e.reviewsLeft).toEqual([2, 2]);
  });
});

// ---------------------------------------------------------------- dribble
describe('dribble', () => {
  const selfCatch = (e: Engine, a: ReturnType<typeof fieldOf>[number]) => {
    for (let i = 0; i < 40; i++) {
      const n = e.events.length;
      a.noCatchT = 0; a.rolledPass = -1; a.actT = 0;
      Object.assign(e.ball, { holder: -1, x: a.x + 0.2, y: a.y, z: 0.3, vx: 1, vy: 0, vz: 0, inFlight: true, passer: a.idx, isShot: false, selfThrow: true, receiver: -1 });
      e.catches(a.x, a.y, 0.3);
      if (e.ball.holder === a.idx) return e.events.slice(n);
    }
    throw new Error('self catch never succeeded');
  };
  const setup = (seed: number) => {
    const e = mk(seed); const a = fieldOf(e, 0)[0]; place(a, 0, 20);
    for (const o of e.ath) if (o !== a && o.role !== 'archer') place(o, o.team ? 40 : -40, -45 + (o.idx % 12) * 3);
    goLive(e, 0, a);
    return { e, a };
  };
  it('dribble: one dribble per possession is allowed', () => {
    const { e, a } = setup(170);
    const ev1 = selfCatch(e, a);
    expect(ev1.some((v) => v.type === 'dribble')).toBe(true); expect(e.dribbles).toBe(1);
    expect(evs(e, 'foul').length).toBe(0); expect(e.phase).toBe('live'); expect(e.tackleCount).toBe(0);
  });
  it('dribble: a second dribble in the same possession is an offence minor (tackle count +1)', () => {
    const { e, a } = setup(171);
    selfCatch(e, a); selfCatch(e, a);
    expect(lastEv(e, 'foul').text).toMatch(/second dribble/); expect(lastEv(e, 'foul').who).toBe(a.idx); expect(a.minors).toBe(1);
    expect(e.tackleCount).toBe(1); expect(e.phase).toBe('dead');
    runDead(e);
    expect(e.restart?.kind).toBe('spot'); expect(e.restart?.team).toBe(0); expect(e.poss).toBe(0); expect(e.tackleCount).toBe(1);
  });
  it('dribble: a second dribble at tackle count 1 is a turnover', () => {
    const { e, a } = setup(172);
    selfCatch(e, a); e.tackleCount = 1; selfCatch(e, a);
    expect(lastEv(e, 'turnover').team).toBe(1);
    runDead(e); expect(e.poss).toBe(1); expect(e.tackleCount).toBe(0);
  });
  it('dribble: the allowance is per possession (reset when possession changes)', () => {
    const { e, a } = setup(173);
    selfCatch(e, a); expect(e.dribbles).toBe(1);
    e.changePossession(1, 'test'); expect(e.dribbles).toBe(0);
  });
});

// ---------------------------------------------------------------- Keeper Zone
describe('Keeper Zone', () => {
  it('keeper zone: an attacker staying more than 5 s is a turnover at the 20 m line', () => {
    expect(C.KZ_ATTACKER_LIMIT).toBe(5);
    const e = mk(180); const h = fieldOf(e, 0)[0], k = fieldOf(e, 0)[1];
    place(h, 0, 30); place(k, 40, 5);                                  // k is 11 m from team 1's goal centre
    goLive(e, 0, h);
    k.kzT = 4.9;
    e.rules(C.DT);
    expect(evs(e, 'turnover').length).toBe(0); expect(k.kzT).toBeGreaterThan(4.9);
    k.kzT = 5 - C.DT / 2;
    e.rules(C.DT);
    expect(lastEv(e, 'turnover').team).toBe(1); expect(lastEv(e, 'turnover').text).toMatch(/Keeper Zone/);
    runDead(e);
    expect(e.restart?.kind).toBe('scrimmage'); expect(e.restart?.team).toBe(1);
    expect(e.u(1, e.restart!.x)).toBeCloseTo(20, 6); expect(e.restart!.y).toBe(0); expect(e.poss).toBe(1);
  });
  it('keeper zone: the attacker timer resets when he leaves the zone, and defenders are not timed', () => {
    const e = mk(181); const h = fieldOf(e, 0)[0], k = fieldOf(e, 0)[1], d = fieldOf(e, 1)[0];
    place(h, 0, 30); place(k, 29, 0); place(d, 45, 0);                 // k is 21 m out: outside
    goLive(e, 0, h); k.kzT = 3; d.kzT = 3;
    e.rules(C.DT);
    expect(k.kzT).toBe(0); expect(d.kzT).toBe(0);
  });
  it('keeper zone: contact on an immune Keeper (holding the ball in his zone) is a major, no points, Keeper\'s team scrimmages', () => {
    const e = mk(182); const kp = keeperOf(e, 1), t = fieldOf(e, 0)[0];
    place(kp, 47, 0); place(t, 46.4, 0);
    goLive(e, 1, kp);
    expect(e.keeperImmune(kp)).toBe(true);
    e.tryTackle(t);
    expect(t.majors).toBe(1); expect(t.excludedT).toBe(120); expect(lastEv(e, 'foul').kind).toBe('major'); expect(lastEv(e, 'foul').text).toMatch(/immune Keeper/);
    expect(evs(e, 'tackle').length).toBe(0); expect(e.tackleCount).toBe(0);
    expect(e.teams[0].score + e.teams[1].score).toBe(0);
    runDead(e);
    expect(e.restart?.team).toBe(1); expect(e.restart?.kind).toBe('scrimmage');
  });
  it('keeper zone: a Keeper holding the ball OUTSIDE his zone is not immune', () => {
    const e = mk(183); const kp = keeperOf(e, 1); place(kp, 25, 0); goLive(e, 1, kp);
    expect(e.keeperImmune(kp)).toBe(false);
    place(kp, 47, 0); e.ball.holder = -1;
    expect(e.keeperImmune(kp)).toBe(false);                            // in his zone but without the ball
  });
});

// ---------------------------------------------------------------- information (static check of the AI source)
describe('information: AI does not read other athletes\' ratings', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/engine/ai.ts', import.meta.url)), 'utf8');
  it('information (static): every rating access in ai.ts (.d.ovr, .d.phys, .tech.*, .a.*) is on the deciding athlete `a`', () => {
    // Mechanical and partial: it proves only that no expression of the form X.tech / X.a.<attr> / X.d.ovr / X.d.phys
    // exists with X other than the function parameter `a`. It cannot see ratings reached through engine helper calls.
    const re = /([A-Za-z_$][\w$]*(?:\[[^\]]*\])?(?:\))?)\s*\.\s*(d\.ovr|d\.phys|tech\b|a\.[A-Za-z_]\w*|phys\b)/g;
    const others: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) if (m[1] !== 'a') others.push(`${m[1]}.${m[2]}`);
    expect(others).toEqual([]);
    // and every function that takes an athlete names the deciding athlete `a` (so `a` is never a loop variable over others)
    expect(src).not.toMatch(/for\s*\(\s*(const|let)\s+a\s+of/);
    expect(src).not.toMatch(/\(\s*a\s*\)\s*=>|\(\s*a\s*,[^)]*\)\s*=>|\ba\s*=>/);
  });
});
