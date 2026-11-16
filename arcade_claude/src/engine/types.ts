export type PosCode = 'STR' | 'SCT' | 'SEN' | 'TRK' | 'HNT' | 'TRP' | 'GRD' | 'PDR' | 'PFD' | 'KPR' | 'ARC';

export interface PlayerData {
  id: string; name: string; pos: PosCode; age: number; yoe: number;
  ovr: number; ovrPreCamp: number; ovrChange: number; campScore: number; readiness: number;
  roleFamiliarity: string; role: string; formation: string; salaryMMEL: number; development: string;
  jersey: number;
  // --- morphology + LOCKED physical ratings (canon workbook, phys-1.0) ---
  ancestry: string; ancestryClass: string; heightTribe: string; physique: Physique;
  heightIn: number; heightM: number; massLb: number; massKg: number; armSpanIn: number; armSpanM: number; reachIn: number; reachM: number;
  phys: PhysRatings; primary: string | null; secondary: string | null; shortfall: number | null;
}
export type Physique = 'Compact' | 'Lean' | 'Lanky' | 'Stocky' | 'Athletic' | 'Rangy' | 'Bulky' | 'Powerful' | 'Hulking';
/** The nine LOCKED canon physical ratings, integers 65-100. Never regenerate or adjust. */
export interface PhysRatings { speed: number; strength: number; jumping: number; acceleration: number; agility: number; balance: number; throwPower: number; stamina: number; durability: number }
/** ARCADE-DERIVED, NOT CANON technical ratings (tech-1.0), integers 60-99. See docs/TECH_RATINGS.md. */
export interface TechRatings {
  tackling: number; ballSecurity: number; catching: number; passAccuracy: number; passVision: number; shotAccuracy: number;
  carryPower: number; elusiveness: number; pursuit: number; coverage: number; screening: number; archeryAim: number;
  archeryDiscipline: number; keeperReaction: number; keeperPositioning: number; footwork: number; discipline: number; clutch: number; awareness: number;
}
/** Body geometry in real units, from Height and Mass only (no rating bonuses). */
export interface Body { radius: number; height: number; mass: number; reach: number; armSpan: number }
export interface TeamData { franchise: string; formation: string; registered: number; players: PlayerData[] }
export interface TeamColors { abbr: string; slug: string; primary: string; secondary: string; accent: string; number: string; palette: string }

/** Motor/skill parameters the engine uses, in real units. Physical ones come from the LOCKED physical ratings
 *  through the PLACEHOLDER mappings in physics.ts; skill ones (0..1) from the ARCADE-DERIVED tech ratings. */
export interface Attr {
  speedRating: number; top: number; accel: number; turnRate: number; throwV: number; jumpH: number;
  acc: number; shotAcc: number; catchS: number; tackle: number; strength: number; balance: number; security: number;
  view: number; react: number; archery: number; archDiscipline: number; discipline: number; staminaCap: number; durability: number;
}

export interface Intent {
  mx: number; my: number; sprint: boolean;
  pass: number;        // teammate athlete index or -1
  shoot: boolean;
  tackle: boolean;
  fire: number;        // archer: target athlete index or -1
}
export const NO_INTENT = (): Intent => ({ mx: 0, my: 0, sprint: false, pass: -1, shoot: false, tackle: false, fire: -1 });

export interface Stats {
  points: number; goals: number; passAtt: number; passComp: number; tackles: number; turnovers: number;
  saves: number; arrows: number; arrowHits: number; interceptions: number; minors: number; majors: number;
  catches: number; drops: number; shots: number; knockdowns: number;
}
export const newStats = (): Stats => ({ points: 0, goals: 0, passAtt: 0, passComp: 0, tackles: 0, turnovers: 0, saves: 0, arrows: 0, arrowHits: 0, interceptions: 0, minors: 0, majors: 0, catches: 0, drops: 0, shots: 0, knockdowns: 0 });

export type Role = 'field' | 'keeper' | 'archer';

export interface Memory { x: number; y: number; vx: number; vy: number; t: number; frozen: boolean }

export interface Athlete {
  idx: number; team: 0 | 1; d: PlayerData; a: Attr; role: Role;
  tech: TechRatings; body: Body;
  px: number; py: number;               // position at the previous sim step (render interpolation)
  stamina: number;                      // 0..1
  injured: boolean; onField: boolean; jumpT: number;
  line: number; slotY: number;          // formation slot (line 0 back,1 mid,2 fwd)
  x: number; y: number; z: number; vx: number; vy: number; facing: number;
  intent: Intent;
  frozenT: number; immuneT: number; recoverT: number;
  groundedT: number; stumbleT: number; actT: number; act: string; celebrateT: number;
  noCatchT: number;
  excludedT: number; dq: boolean; minors: number; majors: number;
  kzT: number;
  // AI state (perception-bounded)
  mem: Map<number, Memory>; ballMem: { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; holder: number };
  rolledPass: number;
  nextThink: number; tx: number; ty: number; aiSprint: boolean; aiPassAt: number; plan: Intent; lastFire: number;
  stats: Stats;
  look: { skin: number; hair: number; build: number; height: number; face: number };
}

export interface Arrow { team: 0 | 1; x: number; y: number; z: number; vx: number; vy: number; vz: number; target: number; life: number; tx: number; ty: number; resolved: boolean }

export interface GameEvent { t: number; period: number; clock: number; type: string; team: number; who: number; text: string; pts?: number; kind?: string; dist?: number }

export type Phase = 'pregame' | 'set' | 'live' | 'snap' | 'dead' | 'break' | 'final';

export type Difficulty = 'rookie' | 'pro' | 'legend';
export interface Whistle { t: number; kind: 'foul' | 'turnover' | 'out' | 'goal' | 'timeout' | 'injury' | 'sub' | 'hunt' | 'period' | 'info'; title: string; detail: string; team: number; who: number }
/** Per-match tallies, index = team. Only tracked events. */
export interface MatchStats {
  pointsPlay: [number, number]; pointsAward: [number, number]; arrowsLegal: [number, number]; arrowsIllegal: [number, number];
  minors: [number, number]; majors: [number, number]; dqs: [number, number]; turnovers: [number, number]; timeouts: [number, number];
  subs: [number, number]; injuries: [number, number]; reviews: [number, number];
}
export interface Settings {
  seed: number;
  difficulty?: Difficulty;   // scales AI reaction time and decision noise only (default 'pro')
  scoring: 'flat' | 'banded';
  periodLen: number;     // 600 canon; accelerated clock is a visible setting, off by default
  otLen: number;
}
