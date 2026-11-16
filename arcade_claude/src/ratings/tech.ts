// STUB (to be replaced by the tech-1.0 generator). ARCADE-DERIVED, NOT CANON.
import type { PlayerData, TechRatings } from '../engine/types';
export const TECH_VERSION = 'tech-1.0';
export const TECH_KEYS: (keyof TechRatings)[] = ['tackling', 'ballSecurity', 'catching', 'passAccuracy', 'passVision', 'shotAccuracy', 'carryPower', 'elusiveness', 'pursuit', 'coverage', 'screening', 'archeryAim', 'archeryDiscipline', 'keeperReaction', 'keeperPositioning', 'footwork', 'discipline', 'clutch', 'awareness'];
export function techRatings(p: PlayerData): TechRatings {
  const v = Math.max(60, Math.min(99, p.ovr));
  const o = {} as TechRatings; for (const k of TECH_KEYS) o[k] = v; return o;
}
