// Ball-flight prediction and intercept solving, shared by the AI (from its remembered ball state),
// the human catch-assist (from the true ball the human can see) and the engine.
import { ballStep } from './physics';

export const REACH = { field: 1.3, keeper: 1.8, intendedBonus: 0.35, z: 2.6, zKeeper: 3.2 };
export const TRAJ_DT = 1 / 30;
const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);

export interface BallState { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface TrajPt { x: number; y: number; z: number; t: number }

/** Flight prediction with the engine's own ball integrator (gravity, drag, bounce), sampled every TRAJ_DT. */
export function ballTraj(b: BallState, T = 2.2): TrajPt[] {
  const out: TrajPt[] = [{ x: b.x, y: b.y, z: b.z, t: 0 }];
  const p = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz };
  const n = Math.round(T / TRAJ_DT);
  for (let i = 1; i <= n; i++) { ballStep(p, TRAJ_DT / 2); ballStep(p, TRAJ_DT / 2); out.push({ x: p.x, y: p.y, z: p.z, t: i * TRAJ_DT }); }
  return out;
}

export interface Intercept { x: number; y: number; t: number; ok: boolean }

/**
 * Earliest point on the flight an athlete at (ax, ay) can reach (within `reach` metres, ball below
 * catching height) running at `speed`. `k0` skips samples already flown. Falls back to the point
 * where the athlete gets closest to being in time.
 */
export function interceptAt(traj: TrajPt[], k0: number, ax: number, ay: number, speed: number, reach: number, zMax = REACH.z): Intercept {
  let best: Intercept | null = null, bestGap = 1e9;
  const t0 = traj[Math.min(k0, traj.length - 1)].t;
  for (let i = Math.max(0, k0); i < traj.length; i++) {
    const p = traj[i];
    if (p.z > zMax) continue;
    const need = Math.max(0, hyp(p.x - ax, p.y - ay) - reach) / Math.max(0.1, speed);
    const have = p.t - t0;
    if (need <= have) return { x: p.x, y: p.y, t: have, ok: true };
    if (need - have < bestGap) { bestGap = need - have; best = { x: p.x, y: p.y, t: have + (need - have), ok: false }; }
  }
  if (best) return best;
  const last = traj[traj.length - 1];
  return { x: last.x, y: last.y, t: last.t - t0, ok: false };
}
