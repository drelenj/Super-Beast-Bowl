// PHYSICS CONFIG + MAPPINGS (real units: metres, seconds, kilograms).
// Every rating -> real-unit mapping lives here. They are ARCADE PLACEHOLDERS unless marked CANON.
// Rules for the data (owner, 16 Nov): the nine physical ratings are LOCKED; no extra size bonuses or
// penalties are applied on top of them. Size (height, mass, span, reach) drives ONLY body geometry,
// collision mass and reach.
import type { Attr, Body, Difficulty, PhysRatings, PlayerData, TechRatings } from './types';

export const PHYS = {
  /** CANON scale point: a speed rating of 100 is 44.704 m/s. The linear mapping below it is a PLACEHOLDER. */
  SPEED_MPS_AT_100: 44.704,
  JOG_FRACTION: 0.6,                 // non-sprint speed as a fraction of top speed
  CARRY_FRACTION: 0.95,              // ball carrier top-speed factor
  /** PLACEHOLDER: acceleration (m/s^2) is linear in the Acceleration rating between these two points. */
  ACCEL_AT_65: 9, ACCEL_AT_100: 18,
  BRAKE_MULT: 1.6,                   // deceleration is quicker than acceleration
  /** PLACEHOLDER: turn rate (rad/s at full speed) is linear in Agility between these points. */
  TURN_AT_65: 2.2, TURN_AT_100: 5.5,
  /** PLACEHOLDER: vertical jump (m) linear in Jumping. Jump reach = standing reach + this. */
  JUMP_AT_65: 0.45, JUMP_AT_100: 1.25,
  /** PLACEHOLDER: throw speed (m/s) = Throw Power / 100 x this. */
  THROW_MPS_AT_100: 72,
  /** PLACEHOLDER stamina: seconds of continuous sprint from full, linear in Stamina; regen seconds when not sprinting. */
  SPRINT_SECONDS_AT_65: 14, SPRINT_SECONDS_AT_100: 34, STAMINA_REGEN_SECONDS: 22, STAMINA_FLOOR: 0.12, TIRED_SPEED: 0.72,
  /** PLACEHOLDER durability: chance of injury on a hard knock-down, linear in Durability. */
  INJURY_P_AT_65: 0.004, INJURY_P_AT_100: 0.0007,
  /** Body footprint radius = K x sqrt(mass / (pi x height x 1000 kg/m^3)) (cylinder of water, K fits an 80 kg / 1.8 m man to 0.28 m). */
  BODY_RADIUS_K: 2.35,
  /** Ball (PROPOSED in the Rulebook: "engine standard"). */
  BALL_R: 0.11, BALL_MASS: 0.45, BALL_DRAG: 0.004, BALL_BOUNCE: 0.45, BALL_GROUND_FRICTION: 2.2,
  G: 9.81,
  /** CANON review margin: a call stands unless wrong by more than 5 cm. */
  REVIEW_MARGIN: 0.05,
  ARROW_SPEED: 250,
} as const;

const lerp65 = (r: number, a: number, b: number) => a + ((Math.max(65, Math.min(100, r)) - 65) / 35) * (b - a);
/** Skill rating (60-99) to a 0..1 engine parameter. Compressed (0.3..1) so a weaker roster is outplayed, not helpless. BEHAVIORAL. */
const unit = (r: number) => 0.3 + 0.7 * (Math.max(60, Math.min(99, r)) - 60) / 39;

/** PLACEHOLDER mapping, isolated: Speed (m/s) = Speed rating / 100 x 44.704. */
export function topSpeed(speedRating: number): number { return (speedRating / 100) * PHYS.SPEED_MPS_AT_100; }
/** The one documented acceleration function: m/s^2 from the Acceleration rating. */
export function accelRate(accelRating: number): number { return lerp65(accelRating, PHYS.ACCEL_AT_65, PHYS.ACCEL_AT_100); }
export function turnRate(agility: number): number { return lerp65(agility, PHYS.TURN_AT_65, PHYS.TURN_AT_100); }
export function jumpHeight(jumping: number): number { return lerp65(jumping, PHYS.JUMP_AT_65, PHYS.JUMP_AT_100); }
export function throwSpeed(throwPower: number): number { return (throwPower / 100) * PHYS.THROW_MPS_AT_100; }
export function sprintSeconds(stamina: number): number { return lerp65(stamina, PHYS.SPRINT_SECONDS_AT_65, PHYS.SPRINT_SECONDS_AT_100); }
export function injuryChance(durability: number): number { return lerp65(durability, PHYS.INJURY_P_AT_65, PHYS.INJURY_P_AT_100); }

/** Body geometry from Height and Mass only. */
export function bodyFor(p: PlayerData): Body {
  const radius = PHYS.BODY_RADIUS_K * Math.sqrt(p.massKg / (Math.PI * p.heightM * 1000));
  return { radius, height: p.heightM, mass: p.massKg, reach: p.reachM, armSpan: p.armSpanM };
}

export const DIFFICULTY: Record<Difficulty, { react: number; noise: number }> = {
  rookie: { react: 1.7, noise: 1.6 }, pro: { react: 1.0, noise: 1.0 }, legend: { react: 0.7, noise: 0.6 },
};

/** Engine motor/skill parameters. Physical: from LOCKED ratings via the mappings above. Skill (0..1): from ARCADE-DERIVED tech ratings. */
export function attrsFor(ph: PhysRatings, t: TechRatings): Attr {
  return {
    speedRating: ph.speed / 100, top: topSpeed(ph.speed), accel: accelRate(ph.acceleration), turnRate: turnRate(ph.agility),
    throwV: throwSpeed(ph.throwPower), jumpH: jumpHeight(ph.jumping),
    strength: (ph.strength - 65) / 35, balance: (ph.balance - 65) / 35,
    staminaCap: sprintSeconds(ph.stamina), durability: ph.durability,
    acc: unit(t.passAccuracy), shotAcc: unit(t.shotAccuracy), catchS: unit(t.catching), tackle: unit(t.tackling), security: unit(t.ballSecurity),
    view: 55 + 35 * unit(t.awareness), react: 0.3 - 0.16 * unit(t.awareness),
    archery: unit(t.archeryAim), archDiscipline: unit(t.archeryDiscipline), discipline: unit(t.discipline),
  };
}

// ---------- shared integrators (engine, AI prediction and tests all use these) ----------
export interface BallKin { x: number; y: number; z: number; vx: number; vy: number; vz: number }
/** One ball step: gravity, quadratic drag, bounce and rolling friction. Spin-free. Returns true on a bounce. */
export function ballStep(b: BallKin, dt: number): boolean {
  const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
  const k = PHYS.BALL_DRAG * sp * dt;                       // a = -k_d * |v| * v
  const f = k < 1 ? 1 - k : 0;
  b.vx *= f; b.vy *= f; b.vz = b.vz * f - PHYS.G * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.z < PHYS.BALL_R) {
    b.z = PHYS.BALL_R;
    if (Math.abs(b.vz) > 1.2) { b.vz = -b.vz * PHYS.BALL_BOUNCE; b.vx *= 0.75; b.vy *= 0.75; return true; }
    b.vz = 0; const g = Math.max(0, 1 - PHYS.BALL_GROUND_FRICTION * dt); b.vx *= g; b.vy *= g;
  }
  return false;
}
export interface Mover { m: number; vx: number; vy: number }
/** 1-D collision along the unit normal (nx, ny) from a to b, restitution e. Conserves momentum exactly. */
export function collide(a: Mover, b: Mover, nx: number, ny: number, e: number): { a: Mover; b: Mover } {
  const va = a.vx * nx + a.vy * ny, vb = b.vx * nx + b.vy * ny;
  const j = ((1 + e) * (va - vb)) / (1 / a.m + 1 / b.m);  // impulse magnitude
  return {
    a: { m: a.m, vx: a.vx - (j / a.m) * nx, vy: a.vy - (j / a.m) * ny },
    b: { m: b.m, vx: b.vx + (j / b.m) * nx, vy: b.vy + (j / b.m) * ny },
  };
}
/** Horizontal catching reach (m): body radius + part of the arm span; a Keeper may dive. PROVISIONAL: no cap (see canon question on Keeper reach). */
export function hReach(body: Body, keeper: boolean): number { return body.radius + body.armSpan * 0.4 + (keeper ? 0.7 : 0); }
/** Vertical reach (m): standing reach + vertical jump. */
export function vReach(body: Body, jumpH: number): number { return body.reach + jumpH; }
