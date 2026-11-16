// Shared setup for tests/unit/rules.test.ts (Rulebook 1.0 conformance tests of the ARCADE engine).
import { Engine } from '../../src/engine/engine';
import { teamByName, defaultSettings } from '../../src/engine/match';
import type { Athlete, Settings } from '../../src/engine/types';
import { NO_INTENT } from '../../src/engine/types';

export const HOME = 'Ala Marauders';
export const AWAY = 'Xenar Ignite';

export function mk(seed = 1, over: Partial<Settings> = {}): Engine {
  return new Engine(teamByName(HOME), teamByName(AWAY), { ...defaultSettings(seed), ...over }, [false, false]);
}

export const fieldOf = (e: Engine, team: number): Athlete[] => e.ath.filter((a) => a.team === team && a.role === 'field');
export const keeperOf = (e: Engine, team: number): Athlete => e.ath.find((a) => a.team === team && a.role === 'keeper')!;
export const archerOf = (e: Engine, team: number): Athlete => e.ath.find((a) => a.team === team && a.role === 'archer')!;

export function place(a: Athlete, x: number, y: number) { a.x = x; a.y = y; a.px = x; a.py = y; a.vx = 0; a.vy = 0; }

/** Put the engine in live play (Hunt over) with `team` in possession; optionally give the ball to `holder`. */
export function goLive(e: Engine, team: number, holder?: Athlete) {
  e.phase = 'live'; e.huntActive = false; e.restart = null; e.pending = null;
  e.changePossession(team, 'test');
  if (holder) { e.setHolder(holder.idx, true); e.ball.x = holder.x; e.ball.y = holder.y; e.ball.z = 1; }
}

/** Step until pred() is true; returns the number of steps taken (max if never). Breaks are NOT skipped. */
export function stepUntil(e: Engine, pred: () => boolean, max = 60 * 20): number {
  let n = 0;
  while (!pred() && n < max) { e.step(); n++; }
  return n;
}
/** Run the scheduled dead ball to its restart. */
export function runDead(e: Engine, max = 60 * 20): number { return stepUntil(e, () => e.phase !== 'dead', max); }

/** Parks the engine in an idle dead ball so that e.step() only runs timers and movement (no AI, no rules). */
export function idleDead(e: Engine) { e.phase = 'dead'; e.phaseT = 1e9; e.pending = null; }

export const evs = (e: Engine, type: string) => e.events.filter((v) => v.type === type);
export const lastEv = (e: Engine, type: string) => evs(e, type).slice(-1)[0];

/**
 * Tackle success is probabilistic: build engines over seeds until `tryTackle` grounds the carrier (and he is not injured).
 * Team 0 carries at (x, y); a team-1 field player tackles. `prep` runs before the tackle (e.g. to set the tackle count).
 */
export function forceTackle(x: number, y: number, prep: (e: Engine) => void = () => {}, over: Partial<Settings> = {}) {
  for (let seed = 1; seed < 400; seed++) {
    const e = mk(seed, over);
    const c = fieldOf(e, 0)[0], t = fieldOf(e, 1)[0];
    place(c, x, y); place(t, x + 0.6, y); t.vx = -6;
    goLive(e, 0, c);
    prep(e);
    const before = e.events.length;
    e.tryTackle(t);
    if (e.events.slice(before).some((v) => v.type === 'tackle') && !c.injured) return { e, c, t, seed };
  }
  throw new Error('no successful tackle in 400 seeds');
}

/** Take over a team's selected player so the AI does not act for him (he stands still unless given an intent). */
export function puppet(e: Engine, a: Athlete) { e.teams[a.team].human = true; e.teams[a.team].selected = a.idx; e.humanIntent[a.team] = NO_INTENT(); }

/** Full headless match stepping, with a per-step hook (phase before the step, events added by the step). */
export function playMatch(seed: number, over: Partial<Settings>, onStep?: (e: Engine, phaseBefore: string, from: number) => void, maxSteps = 60 * 60 * 60) {
  const e = mk(seed, over);
  let steps = 0;
  while (e.phase !== 'final' && steps < maxSteps) {
    if (e.phase === 'break') e.resumeFromBreak();
    const ph = e.phase, n = e.events.length;
    e.step(); steps++;
    if (onStep) onStep(e, ph, n);
  }
  return e;
}
