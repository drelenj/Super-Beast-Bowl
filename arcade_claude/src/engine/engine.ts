// SUPER BEAST BOWL (Beastball arcade) authoritative engine. Fixed 60 Hz steps, seeded RNG only, no rendering.
// A separate TypeScript arcade implementation of Rulebook 1.0. NOT the Python simulator; arcade results
// are not simulator evidence. Real units throughout (metres, seconds, kilograms).
import * as C from './constants';
import { Rng } from './rng';
import { Arrow, Athlete, GameEvent, Intent, MatchStats, NO_INTENT, Phase, PlayerData, Settings, TeamData, Whistle, newStats } from './types';
import { buildLineup, lookFor } from './data';
import { PHYS, DIFFICULTY, attrsFor, bodyFor, ballStep, collide, injuryChance, hReach, vReach } from './physics';
import { techRatings } from '../ratings/tech';
import { aiThink, aiSteer } from './ai';

const hyp = (...v: number[]) => { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s); };
const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface TeamState {
  data: TeamData; dir: 1 | -1; score: number; arrowsLeft: number; freezesLeft: number;
  possTime: number; breakdown: { carry: number; thrown: number; half: number; award: number; own: number; points: number };
  human: boolean; selected: number;
}

export interface Ball {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  holder: number; lastTouch: number; lastTouchTeam: number;
  passer: number; isShot: boolean; shotTeam: number; releaseDist: number; inFlight: boolean;
  receiver: number; passId: number;   // intended receiver of the pass in flight; id of the current flight
  /** team that deliberately released the ball now in flight (-1 = none: reset on acquire and on award). Deflections do not change it. */
  releaseTeam: number;
  noScore: boolean;     // a tossed-in ball cannot score until another player controls it
  noRecover: number;    // toss-in thrower (may not recover his own toss) or -1
  selfThrow: boolean;   // true while only the thrower has touched the ball since release (dribble detection)
}

export class Engine {
  rng: Rng; s: Settings; tick = 0; time = 0;
  teams: [TeamState, TeamState];
  ath: Athlete[] = [];
  /** every gameday athlete (22 per team): the 24 slots on the field (`ath`) plus reserves */
  squad: Athlete[] = [];
  ball: Ball;
  arrows: Arrow[] = [];
  events: GameEvent[] = [];
  phase: Phase = 'pregame'; phaseT = 0;
  period = 1; clock: number; playClock = C.PLAY_CLOCK; suddenDeath = false;
  poss = -1; tackleCount = 0; huntActive = false; huntT = 0;
  restart: { kind: string; team: number; x: number; y: number; snapper: number; readyT: number } | null = null;
  snapT = 0; winner = -1; possChanges = 0; holderSince = 0; forfeit = -1;
  breakInfo: { from: number; to: number; len: number; label: string } | null = null;
  flash: { text: string; t: number; team: number } | null = null;
  humanIntent: [Intent | null, Intent | null] = [null, null];
  checkpoints: string[] = [];
  catchFx: { x: number; y: number; z: number; t: number; ok: boolean; team: number }[] = [];
  matchStats: MatchStats = { pointsPlay: [0, 0], pointsAward: [0, 0], arrowsLegal: [0, 0], arrowsIllegal: [0, 0], minors: [0, 0], majors: [0, 0], dqs: [0, 0], turnovers: [0, 0], timeouts: [0, 0], subs: [0, 0], injuries: [0, 0], reviews: [0, 0] };
  /** latest referee announcement (why / who / penalty); counts down; null when none */
  whistle: Whistle | null = null;
  timeoutsLeft: [number, number] = [C.TIMEOUTS_PER_HALF, C.TIMEOUTS_PER_HALF];
  reviewsLeft: [number, number] = [1, 1];
  dribbles = 0;                                  // dribbles used this possession (one allowed)
  ctrlT = 0;                                     // seconds of uncontested control by a team that does not yet have possession
  scoreStreak = { team: -1, n: 0 };
  timeoutWanted: [boolean, boolean] = [false, false];
  lateTrigger: [number, number] = [0, 0];        // period in which the "last 60 s" trigger was used
  pending: (() => void) | null = null;
  diff = DIFFICULTY.pro;

  constructor(home: TeamData, away: TeamData, settings: Settings, human: [boolean, boolean] = [false, false]) {
    this.s = settings;
    this.diff = DIFFICULTY[settings.difficulty ?? 'pro'];
    this.rng = new Rng(settings.seed);
    this.clock = settings.periodLen;
    const mk = (d: TeamData, dir: 1 | -1, h: boolean): TeamState => ({ data: d, dir, score: 0, arrowsLeft: C.ARROWS_PER_POSS, freezesLeft: C.FREEZES_PER_POSS, possTime: 0, breakdown: { carry: 0, thrown: 0, half: 0, award: 0, own: 0, points: 0 }, human: h, selected: -1 });
    this.teams = [mk(home, 1, human[0]), mk(away, -1, human[1])];
    this.ball = { x: 0, y: 0, z: PHYS.BALL_R, vx: 0, vy: 0, vz: 0, holder: -1, lastTouch: -1, lastTouchTeam: -1, passer: -1, isShot: false, shotTeam: -1, releaseDist: 0, inFlight: false, receiver: -1, passId: 0, releaseTeam: -1, noScore: false, noRecover: -1, selfThrow: false };
    const reserves: Athlete[] = [];
    [home, away].forEach((td, ti) => {
      const lu = buildLineup(td);
      lu.field.forEach((f) => this.ath.push(this.makeAthlete(f.p, ti as 0 | 1, 'field', f.line, f.slotY, this.ath.length)));
      this.ath.push(this.makeAthlete(lu.keeper, ti as 0 | 1, 'keeper', -1, 0, this.ath.length));
      this.ath.push(this.makeAthlete(lu.archer, ti as 0 | 1, 'archer', -1, 0, this.ath.length));
      for (const p of lu.bench) { const r = this.makeAthlete(p, ti as 0 | 1, p.pos === 'KPR' ? 'keeper' : p.pos === 'ARC' ? 'archer' : 'field', 1, 0, -1); r.onField = false; reserves.push(r); }
    });
    this.squad = this.ath.concat(reserves);
    this.setupHunt();
  }

  makeAthlete(p: PlayerData, team: 0 | 1, role: Athlete['role'], line: number, slotY: number, idx: number): Athlete {
    const tech = techRatings(p);
    return {
      idx, team, d: p, a: attrsFor(p.phys, tech), role, line, slotY, tech, body: bodyFor(p),
      x: 0, y: team ? 54 : -54, z: 0, px: 0, py: 0, vx: 0, vy: 0, facing: 0, intent: NO_INTENT(),
      stamina: 1, injured: false, onField: true, jumpT: 0,
      frozenT: 0, immuneT: 0, recoverT: 0, groundedT: 0, stumbleT: 0, actT: 0, act: '', celebrateT: 0, noCatchT: 0,
      excludedT: 0, dq: false, minors: 0, majors: 0, kzT: 0,
      mem: new Map(), ballMem: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: -99, holder: -1 }, rolledPass: -1,
      nextThink: 0, tx: 0, ty: 0, aiSprint: false, aiPassAt: 0, plan: NO_INTENT(), lastFire: -99,
      stats: newStats(), look: lookFor(p.id, p.pos),
    };
  }

  // ---------- geometry / helpers ----------
  ownGoalX(team: number) { return -C.FIELD_HALF * this.teams[team].dir; }
  oppGoalX(team: number) { return C.FIELD_HALF * this.teams[team].dir; }
  /** metres from own goal line along the attack axis (0..100) */
  u(team: number, x: number) { return (x - this.ownGoalX(team)) * this.teams[team].dir; }
  xFromU(team: number, u: number) { return this.ownGoalX(team) + u * this.teams[team].dir; }
  active(a: Athlete) { return a.onField && !a.dq && a.excludedT <= 0 && !a.injured; }
  canAct(a: Athlete) { return this.active(a) && a.frozenT <= 0 && a.groundedT <= 0 && a.recoverT <= 0 && a.role !== 'archer'; }
  inKZ(x: number, y: number, goalX: number) { return dist2(x, y, goalX, 0) < C.KEEPER_ZONE_R * C.KEEPER_ZONE_R; }
  keeperImmune(a: Athlete) { return a.role === 'keeper' && this.ball.holder === a.idx && this.inKZ(a.x, a.y, this.ownGoalX(a.team)); }
  archerOf(team: number) { return this.ath.find((a) => a.team === team && a.role === 'archer' && this.active(a)); }
  tackleReach(a: Athlete, c: Athlete) { return a.body.radius + c.body.radius + 0.45 + a.body.armSpan * 0.22; }
  ev(type: string, team: number, who: number, text: string, extra: Partial<GameEvent> = {}) {
    this.events.push({ t: this.time, period: this.period, clock: this.clock, type, team, who, text, ...extra });
  }
  say(text: string, team = -1, t = 1.6) { this.flash = { text, t, team }; }
  blow(kind: Whistle['kind'], title: string, detail: string, team = -1, who = -1, t = 3.2) { this.whistle = { t, kind, title, detail, team, who }; }
  nm(a: Athlete) { return `${a.d.name} (#${a.d.jersey})`; }
  tn(team: number) { return this.teams[team].data.franchise; }

  // ---------- restarts ----------
  placeFormation(team: number, ballU: number, attacking: boolean, minU = 0, maxU = 100) {
    for (const a of this.ath) {
      if (a.team !== team || !this.active(a)) continue;
      if (a.role === 'archer') { this.placeArcher(a); continue; }
      let u: number, y: number;
      if (a.role === 'keeper') { u = 3; y = 0; }
      else {
        const base = [18, 30, 42][a.line] + (attacking ? 6 : 0);
        u = clamp(base + (ballU - 50) * 0.45, minU, maxU);
        y = a.slotY * (a.line === 1 ? 34 : 28);
      }
      a.x = this.xFromU(team, u); a.y = y; a.vx = a.vy = 0; a.px = a.x; a.py = a.y;
      a.facing = this.teams[team].dir > 0 ? 0 : Math.PI;
    }
  }
  placeArcher(a: Athlete) {
    a.x = this.ownGoalX(a.team) - this.teams[a.team].dir * C.PLATFORM_BACK; a.y = 0; a.z = C.PLATFORM_H; a.px = a.x; a.py = a.y; a.vx = a.vy = 0;
    a.facing = this.teams[a.team].dir > 0 ? 0 : Math.PI;
  }
  resetTransient() {
    for (const a of this.ath) { a.groundedT = 0; a.stumbleT = 0; a.kzT = 0; a.celebrateT = 0; a.act = ''; a.actT = 0; a.noCatchT = 0; }
    this.arrows = [];
    this.dribbles = 0;   // the dribble allowance resets on any stoppage
  }
  resetBall(x: number, y: number) {
    Object.assign(this.ball, { x, y, z: PHYS.BALL_R, vx: 0, vy: 0, vz: 0, holder: -1, passer: -1, isShot: false, inFlight: false, receiver: -1, releaseTeam: -1, noScore: false, noRecover: -1, selfThrow: false });
    this.ball.passId++;
  }

  setupHunt() {
    this.resetTransient();
    for (const t of [0, 1]) this.placeFormation(t, 50, false, 0, 38);
    // each team picks a field player for the Hunt (ARCADE: its quickest starter off the mark); they line up on their own 40 m line
    for (const t of [0, 1]) {
      const c = this.ath.filter((a) => a.team === t && a.role === 'field' && this.active(a)).sort((a, b) => (b.a.accel * 2 + b.a.top) - (a.a.accel * 2 + a.a.top) || a.idx - b.idx)[0];
      if (c) { c.x = this.xFromU(t, 40); c.y = 0; c.px = c.x; c.py = c.y; }
    }
    this.resetBall(0, 0);
    this.ball.lastTouch = -1; this.ball.lastTouchTeam = -1;
    this.poss = -1; this.tackleCount = 0; this.playClock = C.PLAY_CLOCK; this.ctrlT = 0;
    this.restart = { kind: 'hunt', team: -1, x: 0, y: 0, snapper: -1, readyT: 0 };
    this.phase = 'set'; this.phaseT = 1.2; this.huntActive = true; this.huntT = 0;
    const label = this.period <= 4 ? `PERIOD ${this.period}` : this.period === 5 ? 'OVERTIME' : 'SUDDEN DEATH';
    this.say(`${label} — FIRST HUNT`);
    this.blow('hunt', 'First Hunt', `${label}: the ball rests at the centre; live when it leaves the circle. Archers hold fire until then.`, -1, -1, 2.4);
  }

  /** Scrimmage / toss-in for `team`. kind: scrimmage (after score or turnover: formations reset) | contact | spot | tossin */
  setupSnap(kind: string, team: number, x: number, y: number, snapperIdx = -1, tackler = -1, afterScore = false) {
    this.resetTransient();
    const out = kind === 'tossin' ? 0.4 : -1;
    x = clamp(x, -C.FIELD_HALF - out, C.FIELD_HALF + out);
    y = clamp(y, -C.FIELD_HALF - out, C.FIELD_HALF + out);
    const opp = 1 - team;
    const bu = this.u(team, x);
    if (kind === 'scrimmage') {
      // after a score everyone is at or behind their own 40 m line; otherwise each side stays on its side of the ball
      this.placeFormation(team, bu, true, 0, afterScore ? C.SCRIM_LINE : Math.max(2, bu - 2));
      this.placeFormation(opp, 100 - bu, false, 0, afterScore ? C.SCRIM_LINE : Math.max(2, 100 - bu - 5));
    }
    let snapper = snapperIdx >= 0 ? this.ath[snapperIdx] : undefined;
    if (!snapper || snapper.team !== team || !this.active(snapper) || snapper.role !== 'field') {
      snapper = this.ath.filter((a) => a.team === team && a.role === 'field' && this.active(a))
        .sort((a, b) => dist2(a.x, a.y, x, y) - dist2(b.x, b.y, x, y) || a.idx - b.idx)[0]
        ?? this.ath.find((a) => a.team === team && a.role === 'keeper' && this.active(a))!;
    }
    if (!snapper) { this.endByForfeit(team); return; }
    snapper.x = x; snapper.y = y; snapper.vx = snapper.vy = 0; snapper.px = x; snapper.py = y;
    snapper.frozenT = 0; snapper.recoverT = 0;
    // everyone else on their own side of the scrimmage line, which the ball defines (toss-in: opponents >= 3 m away)
    for (const a of this.ath) {
      if (a === snapper || a.role === 'archer' || !this.active(a)) continue;
      if (kind !== 'tossin') {
        const au = this.u(team, a.x);
        if (a.team === team && au > bu - 0.5) a.x = this.xFromU(team, bu - 0.5 - (a.idx % 4) * 0.4);
        if (a.team === opp && au < bu + 1) a.x = this.xFromU(team, bu + 1 + (a.idx % 4) * 0.4);
      }
      const clear = a.team === opp ? (kind === 'tossin' ? C.TOSS_IN_CLEAR : 2.5) : 0;
      const d = Math.sqrt(dist2(a.x, a.y, x, y));
      if (clear && d < clear) {
        const ang = d > 0.01 ? Math.atan2(a.y - y, a.x - x) : (this.teams[opp].dir > 0 ? Math.PI : 0);
        a.x = x + Math.cos(ang) * clear; a.y = y + Math.sin(ang) * clear;
      }
      a.x = clamp(a.x, -C.FIELD_HALF, C.FIELD_HALF); a.y = clamp(a.y, -C.FIELD_HALF, C.FIELD_HALF); a.px = a.x; a.py = a.y; a.vx = a.vy = 0;
    }
    if (tackler >= 0 && this.active(this.ath[tackler]) && this.ath[tackler].team === opp) {
      const t = this.ath[tackler]; t.x = clamp(x + this.teams[team].dir * 5, -C.FIELD_HALF, C.FIELD_HALF); t.y = y; t.px = t.x; t.py = t.y;
    }
    this.resetBall(x, y);
    this.setHolder(snapper.idx, false);
    if (this.poss !== team) this.changePossession(team, 'restart');
    const readyT = kind === 'tossin' ? C.TOSS_READY : 0;
    this.restart = { kind, team, x, y, snapper: snapper.idx, readyT };
    this.phase = 'snap'; this.snapT = kind === 'tossin' ? C.TOSS_READY + C.TOSS_LIMIT : C.SNAP_LIMIT; this.huntActive = false;
    snapper.aiPassAt = this.time + readyT + 0.5 + this.rng.next() * 1.0;
    snapper.facing = Math.atan2(-y, this.oppGoalX(team) * 0.3 - x);
  }

  // ---------- possession ----------
  setHolder(idx: number, viaPlay: boolean) {
    const a = this.ath[idx];
    const b = this.ball;
    b.holder = idx; b.receiver = -1; this.holderSince = this.time; b.lastTouch = idx; b.lastTouchTeam = a.team; b.inFlight = false; b.vx = b.vy = b.vz = 0;
    b.releaseTeam = -1;                                       // own-goal state resets on acquire
    if (b.noRecover !== idx) { b.noScore = false; b.noRecover = -1; }
    b.selfThrow = false;
    this.ctrlT = 0;
    if (!viaPlay && this.poss !== a.team) this.changePossession(a.team, 'restart');
  }
  changePossession(team: number, why: string) {
    if (this.poss >= 0 && team !== this.poss) {
      this.possChanges++;
      this.ev('possession', team, -1, `${this.tn(team)} gain possession (${why})`);
    }
    this.poss = team; this.tackleCount = 0; this.playClock = C.PLAY_CLOCK; this.dribbles = 0; this.ctrlT = 0;
    // a possession is the defending Archer's window: both quotas reset when the ball turns over
    for (const t of this.teams) { t.arrowsLeft = C.ARROWS_PER_POSS; t.freezesLeft = C.FREEZES_PER_POSS; }
  }

  // ---------- scoring ----------
  /** kind: carry | thrown | own (from play) | half | award (penalty awards) */
  award(team: number, pts: number, kind: string, who: number, text: string, dist = 0) {
    const t = this.teams[team];
    t.score += pts; t.breakdown.points += pts;
    if (kind === 'carry') t.breakdown.carry += pts; else if (kind === 'thrown') t.breakdown.thrown += pts;
    else if (kind === 'half') t.breakdown.half += pts; else if (kind === 'award') t.breakdown.award += pts; else if (kind === 'own') t.breakdown.own += pts;
    if (kind === 'half' || kind === 'award') this.matchStats.pointsAward[team] += pts; else this.matchStats.pointsPlay[team] += pts;
    if (who >= 0 && this.ath[who].team === team) { this.ath[who].stats.points += pts; if (kind === 'carry' || kind === 'thrown') this.ath[who].stats.goals++; }
    this.ev('score', team, who, text, { pts, kind, dist });
    this.ball.releaseTeam = -1;                                // own-goal state resets on award
    if (this.scoreStreak.team === team) this.scoreStreak.n++; else this.scoreStreak = { team, n: 1 };
    if (this.scoreStreak.n === 2) this.timeoutWanted[1 - team] = true;   // coach policy trigger 1 (once per streak)
    if (this.suddenDeath) { this.endMatch(); return true; }
    return false;
  }
  /** Flat (default): any goal 2. Banded (provisional): carry 5; thrown 2/3/4 by release distance; own goal 2. */
  goalPoints(kind: 'carry' | 'thrown' | 'own', releaseDist: number) {
    if (this.s.scoring === 'flat') return 2;
    if (kind === 'carry') return 5;
    if (kind === 'own') return 2;
    return releaseDist < 10 ? 2 : releaseDist < 20 ? 3 : 4;
  }
  /** Full-goal award: 2 in flat mode in EVERY period; 3 only in banded mode. Half goal 1. */
  awardPoints(full: boolean) { return full ? (this.s.scoring === 'flat' ? 2 : 3) : 1; }

  // ---------- fouls ----------
  /** Records the foul on the player: 4th minor 60 s exclusion, 5th minor DQ; 1st major 120 s, 2nd major DQ. */
  foul(a: Athlete, major: boolean, what: string) {
    const name = this.nm(a);
    let sanction = '';
    if (major) {
      a.majors++; a.stats.majors++; this.matchStats.majors[a.team]++;
      if (a.majors >= 2) { a.dq = true; a.excludedT = C.MAJOR_EXCL; this.matchStats.dqs[a.team]++; sanction = 'second major: DISQUALIFIED'; }
      else { a.excludedT = C.MAJOR_EXCL; sanction = '120 s exclusion'; }
    } else {
      a.minors++; a.stats.minors++; this.matchStats.minors[a.team]++;
      if (a.minors >= 5) { a.dq = true; a.excludedT = C.MINOR_EXCL; this.matchStats.dqs[a.team]++; sanction = 'fifth minor: DISQUALIFIED'; }
      else if (a.minors === 4) { a.excludedT = C.MINOR_EXCL; sanction = 'fourth minor: 60 s exclusion'; }
    }
    this.ev('foul', a.team, a.idx, `${major ? 'MAJOR' : 'Minor'}: ${what} — ${name}${sanction ? ' — ' + sanction : ''}`, { kind: major ? 'major' : 'minor' });
    if (!this.active(a)) { if (this.ball.holder === a.idx) this.dropBall(a); a.x = 0; a.y = a.team ? 54 : -54; a.vx = a.vy = 0; if (a.role === 'archer') a.z = 0; }
    this.say(major ? 'MAJOR FOUL' : 'FOUL', a.team);
    return sanction;
  }
  /** Minor by the team WITHOUT possession: tackle count -1, or at count 0 a half goal (periods 1-3) / full-goal award (period 4, overtime). */
  defenceMinor(a: Athlete, what: string) {
    const off = 1 - a.team;
    const h = this.ball.holder >= 0 ? this.ath[this.ball.holder] : null;
    const bx = h ? h.x : this.ball.x, by = h ? h.y : this.ball.y;
    const keepIdx = h && h.team === off ? h.idx : -1;
    const sanction = this.foul(a, false, what);
    if (this.phase === 'final') return;
    if (this.tackleCount > 0) {
      this.tackleCount--;
      this.blow('foul', `Defence minor — ${this.tn(a.team)}`, `${this.nm(a)}: ${what}. Tackle count back to ${this.tackleCount}; ${this.tn(off)} scrimmage at the spot.${sanction ? ' ' + sanction + '.' : ''}`, a.team, a.idx);
      this.deadBall(1.3, () => this.setupSnap('spot', off, bx, by, keepIdx));
      return;
    }
    const full = this.period >= 4;
    const pts = this.awardPoints(full);
    this.blow('foul', `Defence minor at count 0 — ${full ? 'GOAL AWARDED' : 'HALF GOAL'}`, `${this.nm(a)}: ${what}. ${this.tn(off)} +${pts}.${sanction ? ' ' + sanction + '.' : ''}`, a.team, a.idx);
    const ended = this.award(off, pts, full ? 'award' : 'half', -1, `${this.tn(off)}: ${full ? 'full-goal award' : 'half goal'} (defence minor at count 0: ${what}) +${pts}`);
    this.say(full ? 'GOAL AWARDED' : 'HALF GOAL', off);
    if (ended) return;
    // an awarded score restarts like any score: conceding team scrimmages at its own 40 m line
    this.deadBall(1.6, () => this.setupSnap('scrimmage', a.team, this.xFromU(a.team, C.SCRIM_LINE), 0, -1, -1, true));
  }
  /** Minor by the team in possession: tackle count +1, scrimmage at the foul spot; at count 1 it is a turnover. */
  offenceMinor(a: Athlete, what: string, x: number, y: number) {
    const sanction = this.foul(a, false, what);
    if (this.phase === 'final') return;
    this.tackleCount++;
    if (this.tackleCount >= 2) {
      this.blow('foul', `Offence minor — turnover`, `${this.nm(a)}: ${what} at tackle count 1.${sanction ? ' ' + sanction + '.' : ''}`, a.team, a.idx);
      this.turnover(1 - a.team, x, y, `offence minor (${what}) at count 1`, true);
    } else {
      this.blow('foul', `Offence minor — ${this.tn(a.team)}`, `${this.nm(a)}: ${what}. Tackle count +1 (now ${this.tackleCount}); scrimmage at the foul spot.${sanction ? ' ' + sanction + '.' : ''}`, a.team, a.idx);
      this.deadBall(1.3, () => this.setupSnap('spot', a.team, x, y, this.active(a) && a.role === 'field' ? a.idx : -1));
    }
  }
  /** Major: fouled team scrimmages at the spot (at the goal line if the foul came inside a Keeper Zone); offender excluded. No points. */
  majorFoul(a: Athlete, what: string, x: number, y: number) {
    const fouled = 1 - a.team;
    const sanction = this.foul(a, true, what);
    if (this.phase === 'final') return;
    for (const gx of [-C.FIELD_HALF, C.FIELD_HALF]) if (this.inKZ(x, y, gx)) x = gx - Math.sign(gx) * 1;
    this.blow('foul', `MAJOR FOUL — ${this.tn(a.team)}`, `${this.nm(a)}: ${what}. ${sanction}; ${this.tn(fouled)} scrimmage at the spot.`, a.team, a.idx, 4);
    this.deadBall(1.6, () => this.setupSnap('scrimmage', fouled, x, y));
  }

  // ---------- dead ball ----------
  deadBall(delay: number, then: () => void) {
    this.phase = 'dead'; this.phaseT = delay; this.pending = then;
    for (const a of this.ath) { a.vx *= 0.3; a.vy *= 0.3; }
  }
  dropBall(a: Athlete) {
    const b = this.ball;
    b.holder = -1; b.x = a.x; b.y = a.y; b.z = 1.0; b.vx = a.vx * 0.5 + this.rng.range(-1, 1); b.vy = a.vy * 0.5 + this.rng.range(-1, 1); b.vz = 1;
    b.inFlight = true; b.isShot = false; b.passer = -1; b.receiver = -1; b.passId++; b.releaseTeam = -1; b.selfThrow = false;
    a.noCatchT = 0.6;
  }
  /** Turnover: the other team scrimmages at the spot, or at its own 40 m line if that is closer to the goal it attacks. */
  turnover(toTeam: number, x: number, y: number, why: string, quiet = false, exactSpot = false) {
    const loser = 1 - toTeam;
    this.matchStats.turnovers[loser]++;
    const uSpot = this.u(toTeam, x);
    if (!exactSpot && uSpot < C.SCRIM_LINE) { x = this.xFromU(toTeam, C.SCRIM_LINE); y = 0; }
    this.ev('turnover', toTeam, -1, `Turnover to ${this.tn(toTeam)}: ${why}`);
    this.say('TURNOVER', toTeam);
    if (!quiet) this.blow('turnover', `Turnover — ${this.tn(toTeam)} ball`, why.charAt(0).toUpperCase() + why.slice(1) + '. Scrimmage, tackle count 0, fresh 30 s.', toTeam, -1);
    this.deadBall(1.2, () => this.setupSnap('scrimmage', toTeam, x, y));
  }

  /** Bench window at every dead ball: exclusion-ended replacements, injury replacements, tired substitutions, coach timeouts. */
  benchWindow() {
    for (const t of [0, 1] as const) {
      // replacements for disqualified (after the exclusion window) and injured players
      for (let i = 0; i < this.ath.length; i++) {
        const a = this.ath[i];
        if (a.team !== t || !a.onField) continue;
        if ((a.dq && a.excludedT <= 0) || a.injured) this.substitute(i, a.injured ? 'injury replacement' : 'replacement after disqualification');
      }
      if (!this.ath.some((a) => a.team === t && a.role === 'keeper' && this.active(a) ) && !this.ath.some((a) => a.team === t && a.role === 'keeper' && a.onField && a.excludedT > 0 && !a.dq)) {
        // no Keeper available: a field player takes the Keeper position at this dead ball
        const f = this.ath.filter((a) => a.team === t && a.role === 'field' && this.active(a)).sort((p, q) => q.tech.keeperReaction - p.tech.keeperReaction || p.idx - q.idx)[0];
        if (f) { f.role = 'keeper'; this.ev('sub', t, f.idx, `${f.d.name} takes the Keeper position`); }
      }
      // tired field players (rolling substitutions, unlimited, dead ball only)
      let n = 0;
      for (let i = 0; i < this.ath.length && n < 2; i++) {
        const a = this.ath[i];
        if (a.team !== t || a.role !== 'field' || !this.active(a) || a.stamina > 0.3) continue;
        if (this.substitute(i, 'fresh legs')) n++;
      }
      if (this.squad.filter((a) => a.team === t && !a.dq && !a.injured).length < 12) { this.endByForfeit(t); return; }
      // coach timeout policy (CANON default): opponent scored twice in a row; or last 60 s of period 4 / overtime while trailing or level
      if (!this.teams[t].human) {
        const late = (this.period === 4 || this.period === 5) && this.clock <= 60 && this.teams[t].score <= this.teams[1 - t].score && this.lateTrigger[t] !== this.period;
        if (late) { this.lateTrigger[t] = this.period; this.timeoutWanted[t] = true; }
        if (this.timeoutWanted[t]) { this.timeoutWanted[t] = false; this.takeTimeout(t, late ? 'late and not ahead' : 'opponent scored twice in a row'); }
      }
    }
  }
  /** Swap the athlete in field slot `i` for a reserve of the same role. Returns false when no reserve is available. */
  substitute(i: number, why: string): boolean {
    const out = this.ath[i];
    const pool = this.squad.filter((r) => r.team === out.team && !r.onField && !r.dq && !r.injured && r.excludedT <= 0 && r.d.id !== out.d.id &&
      (out.role === 'field' ? r.d.pos !== 'KPR' && r.d.pos !== 'ARC' : out.d.pos === 'KPR' || out.role === 'keeper' ? r.d.pos === 'KPR' : r.d.pos === 'ARC'));
    if (!pool.length) return false;
    const inn = pool.sort((p, q) => (q.stamina > 0.8 ? 1 : 0) - (p.stamina > 0.8 ? 1 : 0) || q.d.ovr - p.d.ovr || (p.d.id < q.d.id ? -1 : 1))[0];
    if (out.role === 'field' && !out.dq && !out.injured && inn.stamina < 0.8) return false;
    inn.idx = i; inn.onField = true; inn.role = out.role; inn.line = out.line; inn.slotY = out.slotY;
    inn.x = out.dq || out.injured ? 0 : out.x; inn.y = out.dq || out.injured ? (out.team ? 49 : -49) : out.y; inn.px = inn.x; inn.py = inn.y; inn.vx = inn.vy = 0; inn.z = 0;
    inn.frozenT = inn.recoverT = inn.immuneT = inn.groundedT = inn.stumbleT = 0; inn.mem = new Map(); inn.nextThink = 0;
    out.onField = false; out.idx = -1;
    this.ath[i] = inn;
    if (inn.role === 'archer') this.placeArcher(inn);
    this.matchStats.subs[out.team]++;
    this.ev('sub', out.team, i, `Substitution ${this.tn(out.team)}: ${inn.d.name} on for ${out.d.name} (${why})`);
    return true;
  }
  /** Timeout: 2 per half, 1 in overtime, none in sudden death; only the team in possession, or either team at a dead ball. */
  canTimeout(team: number) {
    if (this.suddenDeath || this.timeoutsLeft[team] <= 0 || this.phase === 'final' || this.phase === 'break' || this.phase === 'pregame') return false;
    return this.phase !== 'live' || this.poss === team;
  }
  callTimeout(team: number): boolean { return this.takeTimeout(team, 'called by the team'); }
  takeTimeout(team: number, why: string): boolean {
    if (!this.canTimeout(team)) return false;
    this.timeoutsLeft[team]--; this.matchStats.timeouts[team]++;
    this.ev('timeout', team, -1, `Timeout ${this.tn(team)} (${why}); ${this.timeoutsLeft[team]} left`);
    this.blow('timeout', `Timeout — ${this.tn(team)}`, `45 seconds (${why}). Both clocks stop; the play clock resumes with the same time. ${this.timeoutsLeft[team]} left this half.`, team, -1, 3);
    for (const a of this.squad) a.stamina = Math.min(1, a.stamina + C.TIMEOUT_LEN / PHYS.STAMINA_REGEN_SECONDS);
    if (this.phase === 'live') {
      // stopped in play by the team in possession: PROVISIONAL restart = scrimmage at the spot, count unchanged
      const h = this.ball.holder >= 0 ? this.ath[this.ball.holder] : null;
      const bx = h ? h.x : this.ball.x, by = h ? h.y : this.ball.y, keep = this.tackleCount, pc = this.playClock;
      this.deadBall(2, () => { this.setupSnap('spot', team, bx, by, h ? h.idx : -1); this.tackleCount = keep; this.playClock = pc; });
    } else if (this.phase === 'dead') this.phaseT += 1.5;
    else if (this.phase === 'snap') this.snapT = Math.max(this.snapT, this.restart?.kind === 'tossin' ? C.TOSS_LIMIT : C.SNAP_LIMIT);
    return true;
  }

  // ---------- actions ----------
  throwBall(a: Athlete, tx: number, ty: number, tz: number, speed: number, isShot: boolean, receiver = -1) {
    const b = this.ball;
    const skill = isShot ? a.a.shotAcc : a.a.acc;
    const tired = a.stamina < 0.25 ? 1.25 : 1;
    const err = (1.05 - skill) * (isShot ? 1.5 : 1.1) * (a.intent.sprint ? 1.3 : 1) * tired;
    const d0 = Math.sqrt(dist2(a.x, a.y, tx, ty));
    tx += this.rng.gauss() * err * (0.35 + d0 * 0.045); ty += this.rng.gauss() * err * (0.35 + d0 * 0.045); tz += this.rng.gauss() * err * 0.3;
    const sx = a.x + Math.cos(a.facing) * 0.4, sy = a.y + Math.sin(a.facing) * 0.4, sz = Math.min(a.body.reach * 0.75, a.body.height * 0.95);
    // aim with a drag-aware shooting method (3 corrections against the real integrator)
    let ax = tx, ay = ty, az = tz, vx = 0, vy = 0, vz = 0, T = 0.2;
    for (let it = 0; it < 4; it++) {
      const dx = ax - sx, dy = ay - sy, dh = Math.sqrt(dx * dx + dy * dy), dz = az - sz;
      T = Math.max(0.1, dh / speed);
      vx = dx / T; vy = dy / T; vz = dz / T + 0.5 * PHYS.G * T;
      if (it === 3) break;
      const p = { x: sx, y: sy, z: sz, vx, vy, vz };
      const n = Math.round(T / C.DT);
      for (let k = 0; k < n; k++) ballStep(p, C.DT);
      ax += tx - p.x; ay += ty - p.y; az += Math.max(-2, Math.min(2, tz - p.z));
    }
    Object.assign(b, { holder: -1, x: sx, y: sy, z: sz, vx, vy, vz, inFlight: true, passer: a.idx, isShot, shotTeam: a.team, lastTouch: a.idx, lastTouchTeam: a.team });
    b.receiver = receiver; b.passId++; b.releaseTeam = a.team; b.selfThrow = true;
    b.releaseDist = Math.sqrt(dist2(a.x, a.y, this.oppGoalX(a.team), 0));
    a.act = 'throw'; a.actT = 0.35; a.noCatchT = 0.3;
    if (this.phase === 'snap') {
      const toss = this.restart?.kind === 'tossin';
      if (toss) { b.noScore = true; b.noRecover = a.idx; }
      this.phase = 'live'; this.ev('snap', a.team, a.idx, toss ? `${a.d.name} tosses in` : `${a.d.name} snaps`);
    }
    if (isShot) a.stats.shots++; else a.stats.passAtt++;
    if (receiver >= 0) this.ath[receiver].aiPassAt = this.time;
  }
  passSpeed(a: Athlete, d: number) { return Math.max(18, Math.min(a.a.throwV, 16 + d * 1.15)); }
  passTo(a: Athlete, r: Athlete) {
    const d = Math.sqrt(dist2(a.x, a.y, r.x, r.y));
    const speed = this.passSpeed(a, d);
    const T = d / speed;
    const L = C.FIELD_HALF - 2;
    this.throwBall(a, clamp(r.x + r.vx * T * 0.85, -L, L), clamp(r.y + r.vy * T * 0.85, -L, L), Math.min(1.6, r.body.height * 0.6), speed, false, r.idx);
  }
  shoot(a: Athlete) {
    const gx = this.oppGoalX(a.team);
    const ty = this.rng.range(-1.9, 1.9), tz = this.rng.range(0.5, 1.9);
    const d = Math.sqrt(dist2(a.x, a.y, gx, 0));
    this.throwBall(a, gx + Math.sign(gx) * 0.6, ty, tz, a.a.throwV, true);
    this.ev('shot', a.team, a.idx, `${a.d.name} shoots from ${d.toFixed(1)} m`, { dist: d });
  }
  tryTackle(a: Athlete) {
    if (a.stumbleT > 0 || a.actT > 0) return;
    const b = this.ball;
    if (b.holder < 0) return;
    const c = this.ath[b.holder];
    if (c.team === a.team) return;
    const d = Math.sqrt(dist2(a.x, a.y, c.x, c.y));
    if (d > this.tackleReach(a, c)) return;
    a.act = 'tackle'; a.actT = 0.45;
    if (this.keeperImmune(c)) { this.majorFoul(a, 'contact on an immune Keeper', c.x, c.y); return; }
    if (c.frozenT > 0 || c.recoverT > 0) { this.majorFoul(a, 'contact with a frozen player', c.x, c.y); return; }
    if (this.poss !== c.team) this.changePossession(c.team, 'secured');
    // momentum along the line of contact: mass x closing speed (tackler) against the carrier's own momentum and Balance
    const nx = (c.x - a.x) / (d + 0.01), ny = (c.y - a.y) / (d + 0.01);
    const pT = a.body.mass * Math.max(0, a.vx * nx + a.vy * ny) + a.body.mass * 4 * (0.5 + a.a.strength);
    const pC = c.body.mass * hyp(c.vx, c.vy) * 0.35 + c.body.mass * 4 * (0.5 + 0.6 * c.a.balance + 0.4 * c.a.strength);
    const mom = (pT - pC) / (pT + pC);                       // -1..1
    const carry = (c.tech.carryPower - 60) / 39, elus = (c.tech.elusiveness - 60) / 39;
    const p = clamp(0.36 + (a.a.tackle - 0.5 * carry - 0.5 * elus) * 0.45 + mom * 0.4, 0.08, 0.9);
    if (this.rng.chance(p)) {
      a.stats.tackles++;
      c.groundedT = 1.4; c.act = 'tackled'; c.actT = 1.4; c.vx *= 0.2; c.vy *= 0.2; c.stats.knockdowns++;
      this.tackleCount++;
      this.ev('tackle', a.team, a.idx, `${a.d.name} grounds ${c.d.name} (tackle ${this.tackleCount})`, { kind: mom > 0.25 ? 'big' : 'normal' });
      // Durability sets the chance the tackled player cannot continue (injury stoppage: no timeout, no count penalty)
      if (this.rng.chance(injuryChance(c.a.durability) * (mom > 0.25 ? 2 : 1))) {
        c.injured = true; this.matchStats.injuries[c.team]++;
        this.ev('injury', c.team, c.idx, `${c.d.name} is injured and leaves the field`);
        this.blow('injury', `Injury stoppage — ${this.tn(c.team)}`, `${this.nm(c)} cannot continue and is replaced at once. No timeout charged, no tackle-count penalty.`, c.team, c.idx);
      }
      let cx = c.x; const cy = c.y;
      if (this.tackleCount >= 2) {
        c.stats.turnovers++;
        this.say(mom > 0.25 ? 'BIG HIT — TURNOVER' : 'TURNOVER', a.team);
        if (!c.injured) this.blow('turnover', `Second tackle — turnover`, `${this.nm(a)} grounds ${this.nm(c)}. ${this.tn(a.team)} scrimmage.`, a.team, a.idx);
        this.turnover(a.team, cx, cy, 'second grounding tackle', true);
      } else {
        this.say(mom > 0.25 ? 'BIG HIT!' : 'TACKLE!', a.team, 1.0);
        // a first tackle less than 10 m from a goal plane moves the scrimmage line out to 10 m
        if (Math.abs(cx) > C.FIELD_HALF - 10) cx = Math.sign(cx) * (C.FIELD_HALF - 10);
        if (!c.injured) this.blow('info', `Tackle 1 — Contact Scrimmage`, `${this.nm(a)} grounds ${this.nm(c)}. ${this.tn(c.team)} keep the ball; snap within 10 s. One more tackle is a turnover.`, c.team, a.idx, 2.2);
        this.deadBall(1.2, () => this.setupSnap('contact', c.team, cx, cy, c.idx, a.idx));
      }
    } else {
      // missed: the tackler may go down himself (Balance), the carrier is slowed
      if (this.rng.chance(0.85 - 0.4 * a.a.balance)) a.stumbleT = 1.1;
      a.vx *= 0.4; a.vy *= 0.4; c.vx *= 0.85; c.vy *= 0.85;
    }
  }
  /** Legal arrow: live play, ball has left the circle in a Hunt, an active opponent who is not frozen / recovering / immune, inside the Archer's own half. */
  arrowLegal(archer: Athlete, target: Athlete) {
    if (this.phase !== 'live' || this.huntActive) return false;
    if (target.team === archer.team || !this.active(target) || target.role === 'archer') return false;
    if (target.frozenT > 0 || target.immuneT > 0 || target.recoverT > 0) return false;
    return this.u(archer.team, target.x) < 50;
  }
  fireArrow(archer: Athlete, target: Athlete) {
    const t = this.teams[archer.team];
    if (this.phase !== 'live' || this.huntActive) return;            // may not draw or fire until the ball has left the circle
    if (t.arrowsLeft <= 0 || t.freezesLeft <= 0 || archer.actT > 0) return;
    if (target.team === archer.team || !this.active(target) || target.role === 'archer') return;
    t.arrowsLeft--; archer.stats.arrows++;
    archer.act = 'throw'; archer.actT = 0.9;
    if (!this.arrowLegal(archer, target)) {
      // illegal target: arrow forfeited and a minor on the Archer
      this.matchStats.arrowsIllegal[archer.team]++;
      const why = target.frozenT > 0 || target.recoverT > 0 ? 'arrow at a frozen player' : target.immuneT > 0 ? 'arrow at an immune player' : 'arrow at a player outside the Archer\'s own half';
      this.ev('arrow_illegal', archer.team, archer.idx, `${archer.d.name}: illegal ${why} (${target.d.name}); arrow forfeited`);
      if (this.poss === archer.team) this.offenceMinor(archer, why, this.ball.holder >= 0 ? this.ath[this.ball.holder].x : this.ball.x, this.ball.holder >= 0 ? this.ath[this.ball.holder].y : this.ball.y);
      else this.defenceMinor(archer, why);
      return;
    }
    this.matchStats.arrowsLegal[archer.team]++;
    const oz = C.PLATFORM_H + archer.body.height * 0.8, az = target.body.height * 0.55;
    const d = hyp(archer.x - target.x, archer.y - target.y, oz - az);
    const tof = d / PHYS.ARROW_SPEED;
    const sigma = (0.35 + (1 - archer.a.archery) * 1.2 + d * 0.012) * (0.75 + 0.25 * this.diffFor(archer.team).noise);
    const ax = target.x + target.vx * tof + this.rng.gauss() * sigma, ay = target.y + target.vy * tof + this.rng.gauss() * sigma;
    const dx = ax - archer.x, dy = ay - archer.y, dz = az - oz, n = hyp(dx, dy, dz);
    this.arrows.push({ team: archer.team, x: archer.x, y: archer.y, z: oz, vx: dx / n * PHYS.ARROW_SPEED, vy: dy / n * PHYS.ARROW_SPEED, vz: dz / n * PHYS.ARROW_SPEED, target: target.idx, life: n / PHYS.ARROW_SPEED + 0.02, tx: ax, ty: ay, resolved: false });
    this.ev('arrow', archer.team, archer.idx, `${archer.d.name} fires at ${target.d.name}`);
  }
  diffFor(team: number) { return this.teams[team].human ? DIFFICULTY.pro : this.diff; }

  // ---------- main step ----------
  step() {
    if (this.phase === 'final' || this.phase === 'break' || this.phase === 'pregame') return;
    const dt = C.DT;
    this.tick++; this.time += dt;
    if (this.tick % 3600 === 0) this.checkpoints.push(this.hash());
    if (this.catchFx.length) { for (const f of this.catchFx) f.t -= dt; this.catchFx = this.catchFx.filter((f) => f.t > 0); }
    if (this.flash) { this.flash.t -= dt; if (this.flash.t <= 0) this.flash = null; }
    if (this.whistle) { this.whistle.t -= dt; if (this.whistle.t <= 0) this.whistle = null; }
    for (const a of this.ath) { a.px = a.x; a.py = a.y; }

    if (this.phase === 'dead') {
      this.phaseT -= dt;
      for (const a of this.ath) this.timers(a, dt, false);
      this.moveAll(dt, true);
      this.ballPhysics(dt, false);
      if (this.phaseT <= 0 && this.pending) {
        this.benchWindow();
        if ((this.phase as Phase) === 'final') return;
        if (this.phaseT > 0) return;            // a timeout extended the stoppage
        const p = this.pending; this.pending = null; if (p) p();
      }
      return;
    }
    if (this.phase === 'set') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) { this.phase = 'live'; this.ev('whistle', -1, -1, 'First Hunt: whistle'); }
      return;
    }

    // intents (HumanController / AIController -> intent; the engine resolves intent -> motor command -> outcome)
    for (const a of this.ath) {
      if (!this.active(a)) { a.intent = NO_INTENT(); continue; }
      const t = this.teams[a.team];
      const hi = this.humanIntent[a.team];
      if (t.human && hi && a.idx === t.selected) a.intent = hi;
      else if (t.human && hi && a.role === 'archer') a.intent = { ...NO_INTENT(), fire: hi.fire };   // the human is his own Archer (aim assist picks legal targets)
      else {
        if (this.time >= a.nextThink) { aiThink(this, a); a.nextThink = this.time + a.a.react * this.diffFor(a.team).react * (0.8 + this.rng.next() * 0.4); }
        a.intent = aiSteer(this, a);
      }
    }
    for (const t of [0, 1]) if (this.humanIntent[t]) this.humanIntent[t] = { ...this.humanIntent[t]!, pass: -1, shoot: false, tackle: false, fire: -1 };

    // actions in a fixed order (deterministic)
    for (let i = 0; i < this.ath.length; i++) {
      if (this.phase !== 'live' && this.phase !== 'snap') break;
      const a = this.ath[i];
      if (!this.active(a)) continue;
      const it = a.intent;
      if (a.role === 'archer') { if (it.fire >= 0 && this.ath[it.fire]) this.fireArrow(a, this.ath[it.fire]); continue; }
      if (!this.canAct(a)) continue;
      if (this.ball.holder === a.idx && a.actT <= 0) {
        const ready = this.phase !== 'snap' || this.snapT <= (this.restart?.kind === 'tossin' ? C.TOSS_LIMIT : 99);
        if (!ready) continue;                                          // a toss-in ball is ready after 1.5 s
        if (it.shoot && this.phase === 'live') this.shoot(a);
        else if (it.pass >= 0 && this.ath[it.pass] && this.active(this.ath[it.pass])) this.passTo(a, this.ath[it.pass]);
      } else if (it.tackle && this.phase === 'live') this.tryTackle(a);
    }
    if (this.phase !== 'live' && this.phase !== 'snap') return;

    const live = this.phase === 'live';
    for (const a of this.ath) this.timers(a, dt, live);
    for (const a of this.squad) if (!a.onField) a.stamina = Math.min(1, a.stamina + dt / PHYS.STAMINA_REGEN_SECONDS);
    this.moveAll(dt, false);
    this.arrowsStep(dt);
    if (this.phase !== 'live' && this.phase !== 'snap') return;
    this.ballPhysics(dt, true);
    if (this.phase !== 'live' && this.phase !== 'snap') return;
    this.rules(dt);
  }

  timers(a: Athlete, dt: number, live: boolean) {
    if (a.excludedT > 0 && live) {                       // exclusions run on game time
      a.excludedT -= dt;
      if (a.excludedT <= 0) { a.excludedT = 0; if (!a.dq) { a.x = 0; a.y = a.team ? 49 : -49; a.px = a.x; a.py = a.y; if (a.role === 'archer') this.placeArcher(a); this.ev('return', a.team, a.idx, `${a.d.name} returns from exclusion`); } }
    }
    if (a.frozenT > 0) {
      a.frozenT -= dt;
      if (a.frozenT <= 0) { a.frozenT = 0; a.recoverT = C.RECOVERY_TIME; }
    } else if (a.recoverT > 0) {
      a.recoverT -= dt;                                   // recovery: 3 m back over 2 s
      const v = C.RECOVERY_DIST / C.RECOVERY_TIME;
      a.vx = -this.teams[a.team].dir * v; a.vy = 0;
      if (a.recoverT <= 0) { a.recoverT = 0; a.immuneT = C.IMMUNE_TIME; }
    } else if (a.immuneT > 0) a.immuneT = Math.max(0, a.immuneT - dt);
    if (a.groundedT > 0) a.groundedT = Math.max(0, a.groundedT - dt);
    if (a.stumbleT > 0) a.stumbleT = Math.max(0, a.stumbleT - dt);
    if (a.actT > 0) { a.actT -= dt; if (a.actT <= 0) { a.actT = 0; a.act = ''; } }
    if (a.noCatchT > 0) a.noCatchT -= dt;
    if (a.celebrateT > 0) a.celebrateT -= dt;
  }

  moveAll(dt: number, dead: boolean) {
    const snapPhase = this.phase === 'snap';
    const lineU = snapPhase && this.restart && this.restart.kind !== 'tossin' ? this.u(this.restart.team, this.restart.x) : -1;
    for (const a of this.ath) {
      if (!this.active(a) || a.role === 'archer') continue;
      if (a.frozenT > 0) { a.vx = a.vy = 0; continue; }
      if (a.recoverT > 0) { a.x += a.vx * dt; a.y += a.vy * dt; this.clampField(a); continue; }
      const snapper = snapPhase && this.ball.holder === a.idx;
      let tvx = 0, tvy = 0, sprinting = false;
      if (!dead && a.groundedT <= 0 && !snapper) {
        const it = a.intent; const m = hyp(it.mx, it.my);
        if (m > 0.05) {
          sprinting = it.sprint && a.stamina > PHYS.STAMINA_FLOOR;
          let sp = a.a.top * (sprinting ? 1 : PHYS.JOG_FRACTION) * (this.ball.holder === a.idx ? PHYS.CARRY_FRACTION : 1);
          if (a.stamina < 0.25) sp *= PHYS.TIRED_SPEED;
          if (a.stumbleT > 0) sp *= 0.3;
          tvx = it.mx / Math.max(1, m) * sp; tvy = it.my / Math.max(1, m) * sp;
        }
      }
      // stamina: drains while sprinting, regenerates otherwise
      if (!dead) a.stamina = sprinting ? Math.max(0, a.stamina - dt / a.a.staminaCap) : Math.min(1, a.stamina + dt / PHYS.STAMINA_REGEN_SECONDS);
      // turn-rate limit (Agility): at speed, the velocity direction can only swing so fast
      const v = hyp(a.vx, a.vy), tv = hyp(tvx, tvy);
      if (v > 4 && tv > 1) {
        const cur = Math.atan2(a.vy, a.vx), want = Math.atan2(tvy, tvx);
        let dA = want - cur; while (dA > Math.PI) dA -= 2 * Math.PI; while (dA < -Math.PI) dA += 2 * Math.PI;
        const maxTurn = a.a.turnRate * dt * (1 + 2.5 * (1 - Math.min(1, v / a.a.top)));
        if (Math.abs(dA) > maxTurn) {
          const na = cur + Math.sign(dA) * maxTurn; const keep = Math.abs(dA) > 1.6 ? Math.max(0, v - a.a.accel * PHYS.BRAKE_MULT * dt) : v;
          a.vx = Math.cos(na) * keep; a.vy = Math.sin(na) * keep;
          tvx = Math.cos(na) * Math.min(tv, keep + a.a.accel * dt); tvy = Math.sin(na) * Math.min(tv, keep + a.a.accel * dt);
        }
      }
      // acceleration limit (Acceleration rating); braking is quicker
      const dvx = tvx - a.vx, dvy = tvy - a.vy, dv = hyp(dvx, dvy);
      const braking = tv < v;
      const acc = (dead ? 14 : a.a.accel * (braking ? PHYS.BRAKE_MULT : 1)) * dt;
      if (dv > acc) { a.vx += dvx / dv * acc; a.vy += dvy / dv * acc; } else { a.vx = tvx; a.vy = tvy; }
      a.x += a.vx * dt; a.y += a.vy * dt;
      const sp = hyp(a.vx, a.vy);
      if (sp > 0.6) a.facing = Math.atan2(a.vy, a.vx);
      else if (this.ball.holder !== a.idx && a.ballMem.t > -50) a.facing = Math.atan2(a.ballMem.y - a.y, a.ballMem.x - a.x);
      if (this.ball.holder !== a.idx) this.clampField(a, 2.5);
      // at a scrimmage everyone but the snapper stays on his own side of the line the ball defines
      if (lineU >= 0 && !snapper && this.restart) {
        const au = this.u(this.restart.team, a.x);
        if (a.team === this.restart.team && au > lineU - 0.3) { a.x = this.xFromU(this.restart.team, lineU - 0.3); a.vx = 0; }
        if (a.team !== this.restart.team && au < lineU + 0.8) { a.x = this.xFromU(this.restart.team, lineU + 0.8); a.vx = 0; }
      }
    }
    // body collisions: circles from Height and Mass; opponents exchange momentum (mass and Strength), teammates just separate
    for (let i = 0; i < this.ath.length; i++) {
      const a = this.ath[i]; if (!this.active(a) || a.role === 'archer') continue;
      for (let j = i + 1; j < this.ath.length; j++) {
        const b = this.ath[j]; if (!this.active(b) || b.role === 'archer') continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = (a.body.radius + b.body.radius) * 0.85, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-9) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = rr - d;
        const ma = a.frozenT > 0 || a.groundedT > 0 ? a.body.mass * 6 : a.body.mass, mb = b.frozenT > 0 || b.groundedT > 0 ? b.body.mass * 6 : b.body.mass;
        const wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.x -= nx * overlap * wa; a.y -= ny * overlap * wa; b.x += nx * overlap * wb; b.y += ny * overlap * wb;
        if (a.team !== b.team && !dead) {
          const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (closing > 0) {
            const r = collide({ m: ma * (1 + 0.5 * a.a.strength), vx: a.vx, vy: a.vy }, { m: mb * (1 + 0.5 * b.a.strength), vx: b.vx, vy: b.vy }, nx, ny, 0.1);
            a.vx = r.a.vx; a.vy = r.a.vy; b.vx = r.b.vx; b.vy = r.b.vy;
            // a hard collision staggers whoever took the bigger change of velocity, unless his Balance holds (the ball carrier is only ever grounded by a tackle)
            if (closing > 9) {
              const loser = wa > wb ? a : b;
              if (loser.stumbleT <= 0 && this.ball.holder !== loser.idx && ((loser.idx * 7 + this.tick) % 10) / 10 > 0.25 + 0.7 * loser.a.balance) loser.stumbleT = 0.6;
            }
          }
        }
      }
    }
  }
  clampField(a: Athlete, margin = 0) {
    const L = C.FIELD_HALF + margin;
    a.x = clamp(a.x, -L, L); a.y = clamp(a.y, -L, L);
  }

  arrowsStep(dt: number) {
    for (const ar of this.arrows) {
      if (ar.resolved) { ar.life -= dt; continue; }
      const px = ar.x, py = ar.y;
      ar.x += ar.vx * dt; ar.y += ar.vy * dt; ar.z += ar.vz * dt; ar.life -= dt;
      const t = this.ath[ar.target];
      const sx = ar.x - px, sy = ar.y - py, sl = sx * sx + sy * sy;
      let k = sl > 0 ? ((t.x - px) * sx + (t.y - py) * sy) / sl : 0; k = clamp(k, 0, 1);
      const cx = px + sx * k, cy = py + sy * k;
      const hr = t.body.radius * 1.15;                      // strike panels: torso and outer thighs
      const hit = dist2(cx, cy, t.x, t.y) < hr * hr && ar.z < t.body.height + 1.5;
      if (hit || ar.life <= 0 || ar.z <= 0) {
        ar.resolved = true; ar.life = 0.3;
        const archer = this.ath.find((a) => a.team === ar.team && a.role === 'archer');
        if (hit && archer && t.frozenT <= 0 && t.immuneT <= 0 && t.recoverT <= 0 && this.active(t) && this.teams[ar.team].freezesLeft > 0) {
          this.teams[ar.team].freezesLeft--;
          archer.stats.arrowHits++;
          t.frozenT = C.FREEZE_TIME; t.vx = t.vy = 0; t.act = 'frozen';
          ar.x = t.x; ar.y = t.y;
          this.ev('freeze', ar.team, archer.idx, `ARROW HIT: ${t.d.name} frozen 5 s`);
          this.say('ARROW HIT — FROZEN', ar.team, 1.2);
          if (this.ball.holder === t.idx) this.dropBall(t);
        }
      }
    }
    this.arrows = this.arrows.filter((a) => a.life > 0);
  }

  ballPhysics(dt: number, live: boolean) {
    const b = this.ball;
    if (b.holder >= 0) {
      const h = this.ath[b.holder];
      const px = b.x;
      b.x = h.x + Math.cos(h.facing) * 0.35; b.y = h.y + Math.sin(h.facing) * 0.35; b.z = Math.min(1.3, h.body.height * 0.5);
      if (live && this.phase === 'live') this.checkCarryGoal(h, px);
      return;
    }
    const px = b.x, py = b.y, pz = b.z;
    const bounced = ballStep(b, dt);
    if (bounced) { b.isShot = b.isShot && hyp(b.vx, b.vy) > 4; }
    if (b.z <= PHYS.BALL_R + 1e-6 && hyp(b.vx, b.vy, b.vz) < 0.05) b.inFlight = false;
    if (!live) return;
    // goal plane: a goal counts only if the WHOLE ball crosses the plane inside the semicircle
    for (const gx of [-C.FIELD_HALF, C.FIELD_HALF]) {
      if ((px - gx) * (b.x - gx) < 0 || (b.x === gx && px !== gx)) {
        const k = (gx - px) / (b.x - px);
        const cy = py + (b.y - py) * k, cz = pz + (b.z - pz) * k;
        const margin = (C.GOAL_R - PHYS.BALL_R) - hyp(cy, cz);       // > 0: whole ball inside
        if (Math.abs(margin) < 0.6 || margin > 0) { if (this.judgeGoal(gx, margin)) { if (b.noScore) { this.tossNoScore(gx, cy); return; } this.goalScored(gx, -1, cy, cz); return; } }
      }
    }
    if (Math.abs(b.x) > C.FIELD_HALF + PHYS.BALL_R || Math.abs(b.y) > C.FIELD_HALF + PHYS.BALL_R) { this.outOfPlay(px, py); return; }
    this.catches(px, py, pz);
  }

  /**
   * Goal judge + review. The on-field call has a few centimetres of judgement noise on close calls.
   * The team the wrong call hurts may challenge (one per half, two in overtime combined): the call is
   * reversed only if it was wrong by MORE than 5 cm; inside 5 cm it stands and the challenge (and a timeout) is lost.
   */
  judgeGoal(gx: number, margin: number): boolean {
    const truth = margin >= 0;
    let call = truth;
    if (Math.abs(margin) < 0.15) call = margin + this.rng.gauss() * 0.035 >= 0;
    if (call === truth) return call;
    const defending = this.ownGoalX(0) === gx ? 0 : 1;
    const aggrieved = call ? defending : 1 - defending;
    if (this.reviewsLeft[aggrieved] <= 0) return call;
    this.matchStats.reviews[aggrieved]++;
    if (Math.abs(margin) > PHYS.REVIEW_MARGIN) {
      this.ev('review', aggrieved, -1, `Review (${this.tn(aggrieved)}): call reversed, tracking shows ${(Math.abs(margin) * 100).toFixed(0)} cm ${truth ? 'inside' : 'outside'}; ${truth ? 'GOAL' : 'NO GOAL'}`);
      this.blow('info', 'Review: call reversed', `${this.tn(aggrieved)} challenge upheld: the ball was ${(Math.abs(margin) * 100).toFixed(0)} cm ${truth ? 'inside' : 'outside'} (more than 5 cm). ${truth ? 'Goal.' : 'No goal.'}`, aggrieved, -1, 3.5);
      return truth;
    }
    this.reviewsLeft[aggrieved]--;
    if (this.timeoutsLeft[aggrieved] > 0) this.timeoutsLeft[aggrieved]--;
    this.ev('review', aggrieved, -1, `Review (${this.tn(aggrieved)}): call stands (within 5 cm); challenge and a timeout lost`);
    this.blow('info', 'Review: call stands', `Evidence inside 5 cm. ${this.tn(aggrieved)} lose the challenge and a timeout. ${call ? 'Goal.' : 'No goal.'}`, aggrieved, -1, 3.5);
    return call;
  }
  tossNoScore(gx: number, cy: number) {
    // a tossed ball cannot score until another player controls it: treated as out over the goal line
    this.ball.lastTouchTeam = this.ball.noRecover >= 0 && this.ath[this.ball.noRecover] ? this.ath[this.ball.noRecover].team : this.ball.lastTouchTeam;
    this.outOfPlay(gx, cy);
  }

  hReachOf(a: Athlete, intended: boolean) { return hReach(a.body, a.role === 'keeper') + (intended ? 0.35 : 0); }

  /**
   * Catch resolution. The ball path of this step is swept against every athlete's reach (arm span, standing reach
   * and Jumping), each athlete gets ONE catch roll per flight, and the intended receiver has first claim.
   */
  catches(px: number, py: number, pz: number) {
    const b = this.ball;
    if (b.holder >= 0) return;
    const sp = hyp(b.vx, b.vy, b.vz);
    const sx = b.x - px, sy = b.y - py, sz = b.z - pz, sl = sx * sx + sy * sy;
    let best: Athlete | null = null, bestScore = 1e9, bestD = 0, bestZ = 0;
    for (const a of this.ath) {
      if (!this.canAct(a) || a.noCatchT > 0 || a.stumbleT > 0 || a.rolledPass === b.passId || b.noRecover === a.idx) continue;
      const intended = a.idx === b.receiver;
      const reachH = this.hReachOf(a, intended), reachZ = vReach(a.body, a.a.jumpH);
      let k = sl > 1e-9 ? ((a.x - px) * sx + (a.y - py) * sy) / sl : 1; k = clamp(k, 0, 1);
      const cx = px + sx * k, cy = py + sy * k, cz = pz + sz * k;
      if (cz > reachZ || cz < -0.2) continue;
      const d = Math.sqrt(dist2(a.x, a.y, cx, cy));
      if (d >= reachH) continue;
      const score = d / reachH - (intended ? 0.5 : 0);
      if (score < bestScore) { best = a; bestScore = score; bestD = d / reachH; bestZ = cz; }
    }
    if (!best) return;
    const a = best;
    a.rolledPass = b.passId;
    if (bestZ > a.body.reach) a.jumpT = 0.4;
    const intended = a.idx === b.receiver;
    const passer = b.passer >= 0 ? this.ath[b.passer] : null;
    const ownPass = !!passer && passer.team === a.team && !b.isShot && passer.idx !== a.idx;
    const ground = bestZ < 0.4 && sp < 10;
    const fast = Math.max(0, sp - 42) * 0.012;
    let p: number;
    if (ground) p = 0.9 + a.a.catchS * 0.08;
    else if (ownPass) {
      let covered = 0;
      for (const o of this.ath) if (o.team !== a.team && o.role !== 'archer' && this.canAct(o) && dist2(o.x, o.y, a.x, a.y) < 6.5) { covered = 1; break; }
      p = (intended ? 0.8 : 0.62) + a.a.catchS * (intended ? 0.19 : 0.3) - fast - Math.max(0, bestD - 0.7) * 0.25 - covered * 0.1;
      p = Math.max(0.55, p);
    } else if (b.isShot && a.team !== b.shotTeam) {
      // stopping a shot: Keepers use reaction and positioning; field players can only block
      p = a.role === 'keeper' ? 0.3 + 0.5 * ((a.tech.keeperReaction - 60) / 39) - Math.max(0, sp - 45) * 0.006 - bestD * 0.18 : (0.2 + a.a.catchS * 0.25) * (1 - bestD * 0.5);
    } else {
      p = (0.12 + a.a.catchS * 0.35 - fast - bestD * 0.2) * 0.5;       // interceptions are harder than catching your own side's pass
    }
    if (this.rng.chance(clamp(p, 0.04, 0.97))) {
      const wasShot = b.isShot && b.shotTeam !== a.team;
      if (passer && passer.idx === a.idx && b.selfThrow) {
        // dribble: a player throws the ball ahead of himself and replays it, once per possession
        this.dribbles++;
        if (this.dribbles > 1) { a.act = 'catch'; a.actT = 0.3; this.setHolder(a.idx, true); this.offenceMinor(a, 'second dribble in one possession', a.x, a.y); return; }
        this.ev('dribble', a.team, a.idx, `${a.d.name} dribbles (the one allowed this possession)`);
      } else if (passer && passer.idx !== a.idx && !b.isShot) {
        if (passer.team === a.team) { passer.stats.passComp++; a.stats.catches++; if (intended) this.ev('catch', a.team, a.idx, `${a.d.name} catches the pass`); }
        else { a.stats.interceptions++; passer.stats.turnovers++; this.ev('interception', a.team, a.idx, `${a.d.name} intercepts`); this.say('INTERCEPTED', a.team, 1.1); }
      }
      if (wasShot && a.role === 'keeper') { a.stats.saves++; this.ev('save', a.team, a.idx, `${a.d.name} saves`); this.say('KEEPER SAVE', a.team, 1.1); }
      else if (wasShot) this.ev('block', a.team, a.idx, `${a.d.name} blocks the shot`);
      if (this.huntActive && this.poss < 0) this.ev('hunt', a.team, a.idx, `${a.d.name} wins the First Hunt`);
      b.passer = -1; b.isShot = false;
      a.act = 'catch'; a.actT = 0.4;
      this.catchFx.push({ x: a.x, y: a.y, z: Math.max(0.8, bestZ), t: 0.4, ok: true, team: a.team });
      this.setHolder(a.idx, true);
    } else {
      // not held: the ball comes off the hands (a deflection never changes who released it); others get a fresh chance
      a.noCatchT = 0.4; b.passId++; b.receiver = -1; b.selfThrow = false;
      this.catchFx.push({ x: a.x, y: a.y, z: Math.max(0.8, bestZ), t: 0.55, ok: false, team: a.team });
      const shotAtMe = b.isShot && a.team !== b.shotTeam;
      if (shotAtMe && a.role === 'keeper') {
        // a Keeper's touch usually turns the shot away; a weak hand lets it carry on toward the goal
        if (this.rng.chance(0.75)) { a.stats.saves++; this.ev('save', a.team, a.idx, `${a.d.name} parries`); this.say('PARRIED', a.team, 1.0); b.isShot = false; b.vx = -b.vx * 0.25 + this.rng.range(-3, 3); b.vy = b.vy * 0.3 + this.rng.range(-5, 5); b.vz = Math.abs(b.vz) * 0.3 + 2; }
        else { b.vx *= 0.7; b.vy = b.vy * 0.7 + this.rng.range(-2, 2); b.vz = b.vz * 0.6 + this.rng.range(-1, 1.5); this.ev('deflect', a.team, a.idx, `${a.d.name} gets a hand to it`); }
      } else if (shotAtMe) { b.vx *= 0.6; b.vy = b.vy * 0.6 + this.rng.range(-4, 4); b.vz = b.vz * 0.5 + this.rng.range(0, 2); this.ev('deflect', a.team, a.idx, `${a.d.name} deflects the shot`); }
      else {
        if (ownPass) { a.stats.drops++; this.ev('drop', a.team, a.idx, `${a.d.name} drops the pass`); }
        b.vx = -b.vx * 0.15 + this.rng.range(-2, 2); b.vy = b.vy * 0.2 + this.rng.range(-2.5, 2.5); b.vz = Math.abs(b.vz) * 0.3 + 1.5;
      }
      b.lastTouch = a.idx; b.lastTouchTeam = a.team;
    }
  }

  checkCarryGoal(h: Athlete, px: number) {
    const b = this.ball;
    for (const gx of [-C.FIELD_HALF, C.FIELD_HALF]) {
      if ((px - gx) * (b.x - gx) < 0) {
        const margin = (C.GOAL_R - PHYS.BALL_R) - hyp(b.y, b.z);
        if (margin >= 0 || Math.abs(margin) < 0.15) { if (this.judgeGoal(gx, margin)) { this.goalScored(gx, h.idx, b.y, b.z); return; } }
      }
    }
    // touching a boundary line is out at once (the carrier's foot)
    if (Math.abs(h.x) >= C.FIELD_HALF || Math.abs(h.y) >= C.FIELD_HALF) { b.lastTouch = h.idx; b.lastTouchTeam = h.team; this.outOfPlay(h.x, h.y); }
  }

  /**
   * Goal event. Own goal ONLY if the defending team is the holder (carried in) or the deliberate releaser of the ball
   * at the goal event (owner ruling 16 Nov): a defender's deflection of a shot into his own goal is an ordinary goal
   * for the shooter's team.
   */
  goalScored(gx: number, carrier: number, y: number, z: number) {
    const b = this.ball;
    const defending = this.ownGoalX(0) === gx ? 0 : 1;
    const scoring = 1 - defending;
    const holderTeam = carrier >= 0 ? this.ath[carrier].team : -1;
    const own = holderTeam === defending || (carrier < 0 && b.releaseTeam === defending);
    const kind: 'carry' | 'thrown' | 'own' = own ? 'own' : carrier >= 0 ? 'carry' : 'thrown';
    const credit = own ? -1 : carrier >= 0 ? carrier : (b.passer >= 0 && this.ath[b.passer] && this.ath[b.passer].team === scoring && b.releaseTeam === scoring ? b.passer : -1);
    const relDist = b.releaseTeam === scoring ? b.releaseDist : 0;
    const pts = this.goalPoints(kind, relDist);
    const culprit = own ? (carrier >= 0 ? carrier : b.passer) : -1;
    const name = credit >= 0 ? this.ath[credit].d.name : culprit >= 0 && this.ath[culprit] ? this.ath[culprit].d.name : 'loose ball';
    const desc = kind === 'carry' ? 'carried goal' : kind === 'own' ? `own goal (${name})` : b.releaseTeam === scoring ? `thrown goal from ${relDist.toFixed(1)} m` : 'goal from a loose ball';
    const ended = this.award(scoring, pts, kind, credit, `GOAL ${this.tn(scoring)}: ${name} — ${desc} +${pts}`, kind === 'thrown' ? relDist : 0);
    this.say(kind === 'own' ? `OWN GOAL +${pts}` : `GOAL! +${pts}`, scoring, 2.2);
    this.blow('goal', `GOAL — ${this.tn(scoring)} +${pts}`, `${name}: ${desc}. ${this.tn(defending)} scrimmage at their own 40 m line, count 0.`, scoring, credit, 3);
    for (const a of this.ath) if (a.team === scoring && a.role !== 'archer') a.celebrateT = 2.2;
    b.holder = -1; b.vx *= 0.1; b.vy *= 0.1; b.x = gx; b.y = y; b.z = Math.max(PHYS.BALL_R, z);
    if (ended) return;
    this.deadBall(2.4, () => this.setupSnap('scrimmage', defending, this.xFromU(defending, C.SCRIM_LINE), 0, -1, -1, true));
  }

  outOfPlay(x: number, y: number) {
    const b = this.ball;
    const toTeam = b.lastTouchTeam >= 0 ? 1 - b.lastTouchTeam : (this.poss >= 0 ? 1 - this.poss : 0);
    const cx = clamp(x, -C.FIELD_HALF, C.FIELD_HALF); let cy = clamp(y, -C.FIELD_HALF, C.FIELD_HALF);
    // on a goal line the crossing point slides to the edge of the Keeper Zone
    if (Math.abs(cx) >= C.FIELD_HALF - 1e-6 && Math.abs(cy) < C.KEEPER_ZONE_R) cy = (cy >= 0 ? 1 : -1) * C.KEEPER_ZONE_R;
    // the thrower stands with his feet outside the line
    const ox = Math.abs(cx) >= C.FIELD_HALF - 1e-6 ? Math.sign(cx) * (C.FIELD_HALF + 0.4) : cx;
    const oy = Math.abs(cy) >= C.FIELD_HALF - 1e-6 ? Math.sign(cy) * (C.FIELD_HALF + 0.4) : cy;
    b.holder = -1; b.vx = b.vy = b.vz = 0; b.x = cx; b.y = cy;
    this.ev('out', toTeam, -1, `Out of play — toss-in ${this.tn(toTeam)}`);
    this.say('OUT OF PLAY', toTeam, 1.0);
    this.blow('out', `Out of play — toss-in ${this.tn(toTeam)}`, `Last touched by ${b.lastTouchTeam >= 0 ? this.tn(b.lastTouchTeam) : 'nobody'}. Opponents 3 m away; ready after 1.5 s, thrown within 4 s.`, toTeam, -1, 2.4);
    this.deadBall(1.0, () => this.setupSnap('tossin', toTeam, ox, oy));
  }

  rules(dt: number) {
    const b = this.ball;
    if (this.phase === 'snap') {
      this.snapT -= dt;
      if (this.snapT <= 0 && b.holder >= 0) this.missedSnap();
      return;
    }
    // ---- live: clocks ----
    const waitShot = this.clock <= 0 && b.holder < 0 && b.isShot && b.inFlight;      // a shot released before the clock expires still counts
    if (!waitShot) this.clock -= dt;
    if (this.poss >= 0) this.teams[this.poss].possTime += dt;
    // possession: a team has the ball once a player has held it uncontested for 500 ms
    if (b.holder >= 0 && this.ath[b.holder].team !== this.poss) {
      this.ctrlT += dt;
      if (this.ctrlT >= C.CONTROL_TIME) this.changePossession(this.ath[b.holder].team, 'secured');
    } else this.ctrlT = 0;
    if (this.huntActive) {
      if (hyp(b.x, b.y) > C.CENTRE_CIRCLE_R + PHYS.BALL_R) this.huntActive = false;       // the whole ball has left the circle
      else { this.huntT += dt; if (this.huntT > C.HUNT_LIMIT) { this.ev('hunt_repeat', -1, -1, 'Hunt repeated: the ball did not leave the circle within 6 s'); this.blow('hunt', 'Hunt repeated', 'The ball did not leave the centre circle within 6 s.', -1, -1, 2); this.deadBall(0.8, () => this.setupHunt()); return; } }
    }
    if (this.poss >= 0 && !this.huntActive) {
      this.playClock -= dt;
      if (this.playClock <= 0) {
        const opp = 1 - this.poss;
        const bx = b.holder >= 0 ? this.ath[b.holder].x : b.x, by = b.holder >= 0 ? this.ath[b.holder].y : b.y;
        if (b.holder >= 0) this.ath[b.holder].stats.turnovers++;
        this.turnover(opp, bx, by, 'play clock expired (30 s)');
        return;
      }
    }
    // Keeper Zone: attackers at most 5 s at a time; breach is a turnover at the 20 m line
    if (this.poss >= 0) {
      const def = 1 - this.poss, gx = this.ownGoalX(def);
      for (const a of this.ath) {
        if (a.team !== this.poss || !this.active(a) || a.role !== 'field') { a.kzT = 0; continue; }
        if (this.inKZ(a.x, a.y, gx)) {
          a.kzT += dt;
          if (a.kzT > C.KZ_ATTACKER_LIMIT) {
            if (b.holder >= 0 && this.ath[b.holder].team === this.poss) this.ath[b.holder].stats.turnovers++;
            this.blow('turnover', 'Keeper Zone violation — turnover', `${this.nm(a)} stayed more than 5 s in the Keeper Zone. ${this.tn(def)} scrimmage at the 20 m line.`, def, a.idx);
            this.turnover(def, this.xFromU(def, C.KEEPER_ZONE_R), 0, `${a.d.name} over 5 s in the Keeper Zone`, true, true);
            return;
          }
        } else a.kzT = 0;
      }
    }
    // BEHAVIORAL model: a tight-marking defender may hold a non-carrier (rarer with higher ARCADE-DERIVED Discipline)
    if (this.poss >= 0 && b.holder >= 0 && this.tick % 30 === 0) {
      for (const a of this.ath) {
        if (a.team === this.poss || a.role !== 'field' || !this.canAct(a) || (this.teams[a.team].human && a.idx === this.teams[a.team].selected)) continue;
        for (const o of this.ath) {
          if (o.team !== this.poss || o.idx === b.holder || !this.canAct(o) || o.role !== 'field') continue;
          const rr = a.body.radius + o.body.radius + 0.25;
          if (dist2(a.x, a.y, o.x, o.y) < rr * rr && this.rng.chance(C.HOLD_RATE * (1.15 - a.a.discipline) * (1.15 - a.a.discipline) * this.diffFor(a.team).noise)) { this.defenceMinor(a, `holding ${o.d.name} (not the carrier)`); return; }
        }
      }
    }
    if (this.clock <= 0 && !waitShot) this.endPeriod();
  }

  /** Missed snap: tackle count +1 and the spot moves 5 m back. A toss-in not thrown in time is treated the same way (PROVISIONAL);
   *  on a goal line the restart is spotted 5 m out from the goal line (owner ruling 16 Nov). */
  missedSnap() {
    const s = this.ath[this.ball.holder]; const r = this.restart!;
    const toss = r.kind === 'tossin';
    this.tackleCount++;
    this.ev('missed_snap', s.team, s.idx, toss ? `Toss-in not thrown in time (${s.d.name}): tackle count +1` : `Missed snap (${s.d.name}): tackle count +1, 5 m back`);
    let x = r.x, y = r.y;
    if (toss && Math.abs(r.x) >= C.FIELD_HALF) x = Math.sign(r.x) * (C.FIELD_HALF - 5);
    else if (toss) y = Math.sign(r.y) * (C.FIELD_HALF - 5);
    else x = clamp(r.x - this.teams[s.team].dir * 5, -C.FIELD_HALF + 1, C.FIELD_HALF - 1);
    if (this.tackleCount >= 2) {
      this.blow('turnover', toss ? 'Toss-in timeout — turnover' : 'Missed snap — turnover', `${this.nm(s)} did not ${toss ? 'throw within 4 s' : 'snap within 10 s'} at tackle count 1.`, 1 - s.team, s.idx);
      this.turnover(1 - s.team, x, y, toss ? 'toss-in not thrown in time at count 1' : 'missed snap at count 1', true);
      return;
    }
    this.blow('info', toss ? 'Toss-in timeout' : 'Missed snap', toss ? `${this.nm(s)} did not throw within 4 s: tackle count +1, scrimmage spotted 5 m in.` : `${this.nm(s)} did not snap within 10 s: tackle count +1 and the spot moves 5 m back.`, s.team, s.idx, 2.4);
    const keep = this.tackleCount, team = s.team, idx = s.idx;
    this.deadBall(0.8, () => { this.setupSnap('spot', team, x, y, idx); this.tackleCount = keep; });
  }

  endPeriod() {
    this.clock = 0;
    const [a, b] = [this.teams[0].score, this.teams[1].score];
    this.ev('period_end', -1, -1, `End of ${this.periodName()} ${a}-${b}`);
    if (this.period >= 4 && a !== b) { this.endMatch(); return; }
    const from = this.period;
    this.period++;
    // PROVISIONAL: sudden-death periods are as long as the first overtime (the Rulebook gives a break "before each sudden-death period" but no length)
    if (this.period >= 6) this.suddenDeath = true;
    this.clock = this.period <= 4 ? this.s.periodLen : this.s.otLen;
    if (this.period === 3) { this.timeoutsLeft = [C.TIMEOUTS_PER_HALF, C.TIMEOUTS_PER_HALF]; this.reviewsLeft = [1, 1]; }     // unused timeouts do not carry over
    if (this.period === 5) { this.timeoutsLeft = [1, 1]; this.reviewsLeft = [2, 2]; }
    if (this.period >= 6) this.timeoutsLeft = [0, 0];
    this.timeoutWanted = [false, false];
    const len = from === 2 ? C.BREAK_HALF : from === 4 ? C.BREAK_OT : from >= 5 ? C.BREAK_SD : C.BREAK_SHORT;
    this.breakInfo = { from, to: this.period, len, label: from === 2 ? 'HALFTIME' : from === 4 ? 'BEFORE OVERTIME' : from >= 5 ? 'BEFORE SUDDEN DEATH' : `END OF PERIOD ${from}` };
    this.whistle = null;
    this.phase = 'break';
  }
  /** Called by the UI (or headless) to finish the break: ends exchanged, players rested, First Hunt. */
  resumeFromBreak() {
    if (this.phase !== 'break') return;
    for (const t of this.teams) t.dir = (t.dir * -1) as 1 | -1;
    const rest = this.breakInfo ? this.breakInfo.len / PHYS.STAMINA_REGEN_SECONDS : 1;
    for (const a of this.squad) { a.stamina = Math.min(1, a.stamina + rest); if (a.injured && !a.onField) a.injured = false; }   // an injured player may return from the next period
    for (const a of this.ath) if (a.role === 'archer') this.placeArcher(a);
    this.breakInfo = null;
    this.pending = null;
    this.benchWindow();
    if ((this.phase as Phase) === 'final') return;
    this.setupHunt();
  }
  endByForfeit(team: number) {
    this.forfeit = team;
    this.ev('forfeit', team, -1, `${this.tn(team)} forfeit: fewer than 12 of 22 players available`);
    this.phase = 'final'; this.winner = 1 - team; this.say('FORFEIT', 1 - team, 99);
  }
  endMatch() {
    this.phase = 'final';
    const [a, b] = [this.teams[0].score, this.teams[1].score];
    this.winner = a > b ? 0 : b > a ? 1 : -1;
    this.ev('final', this.winner, -1, `FINAL ${this.tn(0)} ${a} - ${b} ${this.tn(1)}`);
    this.say('FINAL', this.winner, 99);
  }
  periodName() { return this.period <= 4 ? `P${this.period}` : this.period === 5 ? 'OT' : 'SD'; }

  /** Deterministic state hash for reproducibility checks. */
  hash(): string {
    let h = 2166136261;
    const mix = (v: number) => { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619); };
    mix(this.tick); mix(this.teams[0].score); mix(this.teams[1].score); mix(this.ball.x); mix(this.ball.y); mix(this.ball.z);
    for (const a of this.ath) { mix(a.x); mix(a.y); mix(a.vx); mix(a.vy); mix(a.stamina); }
    mix(this.events.length); mix(this.rng.state());
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  /** Hash of the whole event log (type, time, team, who): the seeded-replay check. */
  eventHash(): string {
    let h = 2166136261;
    for (const e of this.events) { const s = `${e.type}|${e.t.toFixed(3)}|${e.team}|${e.who}|${e.pts ?? ''}`; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
