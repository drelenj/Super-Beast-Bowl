// Validates data/rosters.json (canon roster export; read-only here).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlayerData, PhysRatings } from '../../src/engine/types';

interface Team { franchise: string; formation: string; players: PlayerData[] }
const rosters = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/rosters.json', import.meta.url)), 'utf8')) as { teams: Team[] };
const teams = rosters.teams;
const all = teams.flatMap((t) => t.players);
const PHYS: (keyof PhysRatings)[] = ['speed', 'strength', 'jumping', 'acceleration', 'agility', 'balance', 'throwPower', 'stamina', 'durability'];
const POS = ['STR', 'SCT', 'SEN', 'TRK', 'HNT', 'TRP', 'GRD', 'PDR', 'PFD', 'KPR', 'ARC'];
const ROLES = ['Projected starter', 'Projected active', 'Outside projected 25'];

describe('data/rosters.json', () => {
  it('has 26 teams with unique franchise names and a formation', () => {
    expect(teams.length).toBe(26);
    expect(new Set(teams.map((t) => t.franchise)).size).toBe(26);
    for (const t of teams) {
      expect(typeof t.franchise).toBe('string');
      expect(t.franchise.length).toBeGreaterThan(0);
      expect(typeof t.formation).toBe('string');
      expect(t.players.length).toBeGreaterThanOrEqual(12);
    }
  });

  it('has 712 players with unique ids', () => {
    expect(all.length).toBe(712);
    expect(new Set(all.map((p) => p.id)).size).toBe(712);
    for (const p of all) {
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('every player has a known position and role, and an integer OVR', () => {
    for (const p of all) {
      expect(POS).toContain(p.pos);
      expect(ROLES).toContain(p.role);
      expect(Number.isInteger(p.ovr)).toBe(true);
      expect(p.ovr).toBeGreaterThanOrEqual(1);
      expect(p.ovr).toBeLessThanOrEqual(100);
    }
  });

  it('the nine physical ratings are integers 65-100 (and only those nine)', () => {
    for (const p of all) {
      expect(Object.keys(p.phys).sort()).toEqual([...PHYS].sort());
      for (const k of PHYS) {
        expect(Number.isInteger(p.phys[k])).toBe(true);
        expect(p.phys[k]).toBeGreaterThanOrEqual(65);
        expect(p.phys[k]).toBeLessThanOrEqual(100);
      }
    }
  });

  it('heightM, heightIn, massKg, armSpanM and reachM are present and positive', () => {
    for (const p of all) {
      for (const k of ['heightM', 'heightIn', 'massKg', 'armSpanM', 'reachM'] as const) {
        expect(typeof p[k]).toBe('number');
        expect(Number.isFinite(p[k])).toBe(true);
        expect(p[k]).toBeGreaterThan(0);
      }
    }
  });

  it("every team has exactly 12 'Projected starter' players with exactly one KPR and one ARC", () => {
    for (const t of teams) {
      const st = t.players.filter((p) => p.role === 'Projected starter');
      expect(st.length, t.franchise).toBe(12);
      expect(st.filter((p) => p.pos === 'KPR').length, `${t.franchise} KPR`).toBe(1);
      expect(st.filter((p) => p.pos === 'ARC').length, `${t.franchise} ARC`).toBe(1);
    }
  });
});
