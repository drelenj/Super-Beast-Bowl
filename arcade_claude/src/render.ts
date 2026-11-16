// Elevated three-quarter 2.5D renderer (Canvas 2D). Reads engine state; never mutates it.
// One world-to-screen transform P(x, y, z); static stadium cached to an offscreen canvas.
import * as C from './engine/constants';
import type { Engine } from './engine/engine';
import type { Athlete, TeamColors } from './engine/types';
import { animFor, drawFigure, specOf, roundRect, rgba, darken, lighten, lum, type FigSpec } from './sprites';
import { Fx } from './gfx/fx';
import { audio } from './audio';

const SQ = 0.58;   // vertical squash of the ground plane (camera elevation)
const ZK = 0.92;   // height projection
const F = C.FIELD_HALF;
const HI = ['#ffe14d', '#4dd2ff'];
/** instant replay is not implemented in this build */
export const REPLAY_ENABLED = false;
/** sprites are drawn slightly larger than true scale for readability at a 75 m wide view (visual only) */
const SPR = 1.3;

export class Camera {
  x = 0; y = 0; s = 17; mode: 'ball' | 'athlete' = 'ball'; follow = -1;
  update(e: Engine, w: number, h: number, dt: number) {
    const b = e.ball;
    let tx = b.x, ty = b.y, vx = b.vx, vy = b.vy;
    if (b.holder >= 0 && e.ath[b.holder]) { vx = e.ath[b.holder].vx; vy = e.ath[b.holder].vy; }
    if (this.mode === 'athlete' && this.follow >= 0 && e.ath[this.follow]) { const a = e.ath[this.follow]; tx = a.x; ty = a.y; vx = a.vx; vy = a.vy; }
    // about 75 m of field width on a desktop, a little less on a phone
    this.s = Math.max(13, Math.min(27, w / 75));
    const hw = w / 2 / this.s, hh = h / 2 / this.s / SQ;
    const la = 0.3, lim = Math.min(9, hw * 0.3);
    const gx = tx + Math.max(-lim, Math.min(lim, vx * la)), gy = ty + Math.max(-lim, Math.min(lim, vy * la));
    const k = 1 - Math.exp(-Math.min(0.1, dt) * 4.5);
    this.x += (gx - this.x) * k; this.y += (gy - this.y) * k;
    // never lose the followed target: hard-keep it inside the inner 76 % of the view
    const mx = hw * 0.76, my = hh * 0.7;
    if (tx - this.x > mx) this.x = tx - mx; else if (this.x - tx > mx) this.x = tx + mx;
    if (ty - this.y > my) this.y = ty - my; else if (this.y - ty > my) this.y = ty + my;
    const ex = F + 13, ey0 = F + 26, ey1 = F + 9;
    this.x = hw >= ex ? 0 : Math.max(-ex + hw, Math.min(ex - hw, this.x));
    this.y = hh * 2 >= ey0 + ey1 ? (ey1 - ey0) / 2 : Math.max(-ey0 + hh, Math.min(ey1 - hh, this.y));
  }
}

// stadium cache geometry (world metres -> cache pixels)
const SQm = 14, SX0 = -(F + 50), SY0 = -90, SW = 2 * (F + 50), SH = 136;

interface Tracer { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; team: number; fade: number; seen: number }
interface Hero { f: FigSpec; col: TeamColors; x: number; anim: string; sc: number; left: boolean }

export class Renderer {
  cam = new Camera();
  dpr = 1;
  /** sim-time multiplier requested by the renderer (slow-mo on goals); main loop multiplies by it */
  timeScale = 1;
  /** 0..1 fraction of the way from the previous sim step to the current one (render interpolation) */
  alpha = 1;
  /** kept for main.ts; logo images are no longer drawn (team colours + original crest glyph only) */
  logos: Record<string, HTMLImageElement> = {};
  trail: [number, number, number][] = [];
  fx = new Fx();
  private lastE: Engine | null = null;
  private evIdx = 0; private lastWall = 0; private frame = 0;
  private phase: number[] = []; private squash: number[] = []; private wasFrozen: boolean[] = []; private hadBall = -1;
  private shake = 0; private shx = 0; private shy = 0; private slowT = 0; private flashT = 0; private flashCol = '#ffffff';
  private tracers = new Map<object, Tracer>();
  private stadium: HTMLCanvasElement | null = null; private stadiumKey = '';
  private titleBg: HTMLCanvasElement | null = null; private titleKey = '';
  private heroes: Hero[] | null = null;
  constructor(public ctx: CanvasRenderingContext2D) {}

  P = (x: number, y: number, z = 0): [number, number] => {
    const c = this.ctx.canvas;
    return [c.width / this.dpr / 2 + (x - this.cam.x) * this.cam.s + this.shx, c.height / this.dpr / 2 + (y - this.cam.y) * this.cam.s * SQ - z * this.cam.s * ZK + this.shy];
  };
  poly(pts: [number, number, number?][], fill?: string, stroke?: string, lw = 1) {
    const ctx = this.ctx; ctx.beginPath();
    for (let i = 0; i < pts.length; i++) { const p = pts[i], [sx, sy] = this.P(p[0], p[1], p[2] ?? 0); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  private seg(x0: number, y0: number, x1: number, y1: number) { const ctx = this.ctx, [a, b] = this.P(x0, y0), [c, d] = this.P(x1, y1); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
  private gEllipse(cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2) { const [sx, sy] = this.P(cx, cy), s = this.cam.s; this.ctx.beginPath(); this.ctx.ellipse(sx, sy, r * s, r * s * SQ, 0, a0, a1); }

  // ---------- static stadium layer (stands, crowd, boards, floodlights), built once per colour pair ----------
  private buildStadium(cols: [TeamColors, TeamColors]) {
    const cv = document.createElement('canvas'); cv.width = SW * SQm; cv.height = SH * SQm;
    const g = cv.getContext('2d')!;
    const Q = (x: number, y: number, z = 0): [number, number] => [(x - SX0) * SQm, (y * SQ - z * ZK - SY0) * SQm];
    const quad = (p: [number, number, number][], fill: string) => { g.beginPath(); p.forEach((q, i) => { const [a, b] = Q(q[0], q[1], q[2]); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); g.fillStyle = fill; g.fill(); };
    g.fillStyle = '#070a12'; g.fillRect(0, 0, cv.width, cv.height);
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const crowd = [cols[0].primary, cols[1].primary, '#d8d0c0', cols[0].secondary, cols[1].secondary, '#8a7f6a', '#3d4763', '#c9b28a', cols[0].accent, cols[1].accent];
    const skins = ['#4a2e1f', '#7d4f33', '#9a6544', '#c69a72'];
    // concourse + run-off apron
    quad([[-F - 48, -F - 44, 0], [F + 48, -F - 44, 0], [F + 48, F + 30, 0], [-F - 48, F + 30, 0]], '#141926');
    quad([[-F - 11, -F - 9, 0], [F + 11, -F - 9, 0], [F + 11, F + 9, 0], [-F - 11, F + 9, 0]], '#1d3a26');
    quad([[-F - 5, -F - 5, 0], [F + 5, -F - 5, 0], [F + 5, F + 5, 0], [-F - 5, F + 5, 0]], '#27552c');
    const rows = 24;
    // side stands (rows run along y)
    for (const sg of [-1, 1]) for (let r = rows - 1; r >= 0; r--) {
      const x = sg * (F + 13 + r * 1.35), z = 1.2 + r * 0.85;
      quad([[x, -F - 40, z], [x + sg * 1.4, -F - 40, z], [x + sg * 1.4, F + 26, z], [x, F + 26, z]], r % 2 ? '#1a2032' : '#20273c');
      for (let y = -F - 40; y < F + 26; y += 0.62) { if (rnd() < 0.12) continue; const [a, b] = Q(x + sg * 0.5, y, z + 0.5); g.fillStyle = crowd[(rnd() * crowd.length) | 0]; g.fillRect(a - 3, b - 3, 6, 6); g.fillStyle = skins[(rnd() * 4) | 0]; g.fillRect(a - 2, b - 7, 4, 4); }
    }
    // far stand (rows run along x), two tiers with a team-colour fascia
    for (let r = rows - 1; r >= 0; r--) {
      const y = -F - 11 - r * 1.3, z = 1.4 + r * 0.9 + (r > 12 ? 2.4 : 0);
      quad([[-F - 46, y, z], [F + 46, y, z], [F + 46, y, z - 1], [-F - 46, y, z - 1]], r % 2 ? '#1a2032' : '#222a40');
      for (let x = -F - 45; x < F + 45; x += 0.6) { if (rnd() < 0.1) continue; const [a, b] = Q(x, y, z + 0.45); g.fillStyle = crowd[(rnd() * crowd.length) | 0]; g.fillRect(a - 3, b - 3, 6, 7); g.fillStyle = skins[(rnd() * 4) | 0]; g.fillRect(a - 2, b - 7, 4, 4); }
      if (r === 13) { quad([[-F - 46, y + 1, z - 1], [0, y + 1, z - 1], [0, y + 1, z - 3.2], [-F - 46, y + 1, z - 3.2]], cols[0].primary); quad([[0, y + 1, z - 1], [F + 46, y + 1, z - 1], [F + 46, y + 1, z - 3.2], [0, y + 1, z - 3.2]], cols[1].primary); }
    }
    // roof edge + floodlights
    quad([[-F - 48, -F - 43, 27], [F + 48, -F - 43, 27], [F + 48, -F - 43, 24.5], [-F - 48, -F - 43, 24.5]], '#0d111c');
    for (const fxm of [-F - 30, -F / 2 - 5, F / 2 + 5, F + 30]) {
      const [a, b] = Q(fxm, -F - 43, 28.5);
      const gr = g.createRadialGradient(a, b, 4, a, b, 260); gr.addColorStop(0, 'rgba(255,250,225,0.85)'); gr.addColorStop(0.12, 'rgba(255,245,210,0.28)'); gr.addColorStop(1, 'rgba(255,245,210,0)');
      g.fillStyle = gr; g.fillRect(a - 260, b - 260, 520, 520);
      g.fillStyle = '#fffbe8'; for (let i = -3; i <= 3; i++) for (let j = 0; j < 2; j++) g.fillRect(a + i * 13 - 4, b - 6 + j * 12, 9, 8);
    }
    // perimeter boards, far side: team colours + wordmarks (original text only)
    const words = [cols[0].abbr, 'BEASTBALL', cols[1].abbr, 'SUPER BEAST BOWL'];
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 15px "Arial Black", Arial, sans-serif';
    for (let i = 0; i < 12; i++) {
      const x0 = -F - 8 + i * (2 * F + 16) / 12, x1 = x0 + (2 * F + 16) / 12, c = i % 2 ? cols[1] : cols[0], bg = i % 4 < 2 ? c.primary : c.secondary;
      quad([[x0, -F - 7, 1.5], [x1, -F - 7, 1.5], [x1, -F - 7, 0], [x0, -F - 7, 0]], bg);
      const [a, b] = Q((x0 + x1) / 2, -F - 7, 0.72); g.fillStyle = lum(bg) > 0.5 ? '#10131c' : '#ffffff'; g.fillText(words[i % 4], a, b);
    }
    // side kerbs and near-side board backs
    for (const sg of [-1, 1]) quad([[sg * (F + 10.4), -F - 7, 0], [sg * (F + 11), -F - 7, 0], [sg * (F + 11), F + 8, 0], [sg * (F + 10.4), F + 8, 0]], sg < 0 ? cols[0].primary : cols[1].primary);
    quad([[-F - 11, F + 8, 1.2], [F + 11, F + 8, 1.2], [F + 11, F + 8, 0], [-F - 11, F + 8, 0]], '#0c0f18');
    for (let x = -F - 30; x < F + 30; x += 1.1) { const [a, b] = Q(x + rnd() * 0.5, F + 11 + rnd() * 3, 0); g.fillStyle = rnd() < 0.5 ? '#0b0e16' : '#10141f'; g.beginPath(); g.arc(a, b, 9 + rnd() * 4, 0, 7); g.fill(); }
    this.stadium = cv;
  }

  private sfx(name: string, v = 1) { try { audio.play(name, v); } catch { /* audio is optional */ } }

  private reset(e: Engine) {
    this.lastE = e; this.evIdx = e.events.length; this.phase = []; this.squash = []; this.wasFrozen = []; this.hadBall = -1;
    this.fx.clear(); this.tracers.clear(); this.trail.length = 0; this.slowT = 0; this.flashT = 0; this.shake = 0; this.timeScale = 1;
  }

  /** new engine events -> effects + sounds (visual / audio only) */
  private events(e: Engine, cols: [TeamColors, TeamColors]) {
    const n = e.events.length, burst = n - this.evIdx > 10; let sounds = 0;
    for (let i = Math.max(this.evIdx, n - 40); i < n; i++) {
      const ev = e.events[i], who = ev.who >= 0 ? e.ath[ev.who] : undefined;
      const snd = (name: string, v = 1) => { if (sounds++ < 3) this.sfx(name, v); };
      switch (ev.type) {
        case 'score': {
          const t = ev.team === 1 ? 1 : 0;
          this.flashT = 0.7; this.flashCol = cols[t].primary; this.slowT = 1.2; this.shake = Math.max(this.shake, 9);
          this.fx.confetti(e.oppGoalX(t) * 0.94, 0, [cols[t].primary, cols[t].secondary, cols[t].accent, '#ffffff']);
          snd('goal'); break;
        }
        case 'tackle': if (who && !burst) {
          const m = who.body.mass, pw = Math.min(2.2, 0.5 + m / 250);
          this.fx.impact(who.x, who.y, pw, cols[who.team].accent); this.shake = Math.max(this.shake, Math.min(14, 2.5 + m / 55));
          this.squash[who.idx] = 0.3;
          for (const o of e.ath) if (o.team !== who.team && o.groundedT > 0 && Math.hypot(o.x - who.x, o.y - who.y) < 6) this.squash[o.idx] = 0.35;
          snd('tackle', Math.min(1.5, 0.6 + m / 400));
        } break;
        case 'arrow': snd('arrow'); break;
        case 'freeze': snd('freeze'); break;
        case 'catch': case 'hunt': snd('catch'); break;
        case 'interception': case 'save': case 'block': snd('catch'); snd('crowd', 0.6); break;
        case 'shot': snd('throw', 1.2); break;
        case 'out': case 'turnover': case 'foul': case 'whistle': case 'snap': if (ev.type !== 'snap' || !burst) snd('whistle', ev.type === 'snap' ? 0.4 : 0.8); break;
        case 'period_end': case 'final': snd('whistleLong'); break;
        default: break;
      }
    }
    this.evIdx = n;
  }

  draw(e: Engine, cols: [TeamColors, TeamColors], wallT: number, selected: number[]) {
    const ctx = this.ctx, W = ctx.canvas.width / this.dpr, H = ctx.canvas.height / this.dpr, s = this.cam.s, al = this.alpha;
    const dt = Math.max(0, Math.min(0.05, wallT - this.lastWall)); this.lastWall = wallT; this.frame++;
    if (e !== this.lastE) this.reset(e);
    if (e.events.length < this.evIdx) this.evIdx = e.events.length;
    if (e.events.length > this.evIdx) this.events(e, cols);
    // slow-mo (always returns to 1) and screen shake
    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = this.slowT > 0.25 ? 0.35 : this.slowT > 0 ? 1 - 0.65 * (this.slowT / 0.25) : 1; } else this.timeScale = 1;
    if (this.shake > 0.2) { this.shx = (Math.random() - 0.5) * 2 * this.shake; this.shy = (Math.random() - 0.5) * 2 * this.shake; this.shake *= Math.exp(-dt * 9); } else { this.shake = 0; this.shx = this.shy = 0; }
    this.fx.update(dt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
    const key = cols[0].primary + cols[0].secondary + cols[1].primary + cols[1].secondary + cols[0].abbr + cols[1].abbr;
    if (!this.stadium || this.stadiumKey !== key) { this.buildStadium(cols); this.stadiumKey = key; }
    ctx.fillStyle = '#070a12'; ctx.fillRect(0, 0, W, H);
    { const [ox, oy] = this.P(SX0, 0, 0); const k = s / SQm; ctx.drawImage(this.stadium!, ox, oy - (0 - SY0) * s + 0, this.stadium!.width * k, this.stadium!.height * k); }
    // twinkling camera flashes in the far stand
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 10; i++) { const h = Math.floor(wallT * 7 + i * 3.7) * 9301 + i * 49297, r1 = ((h * 233280) % 1000) / 1000, r2 = ((h * 7919) % 1000) / 1000; const [fx2, fy2] = this.P(-F - 40 + Math.abs(r1) * (2 * F + 80), -F - 12 - Math.abs(r2) * 28, 3 + Math.abs(r2) * 20); if (fy2 > -4) ctx.fillRect(fx2, fy2, 2.5, 2.5); }

    // ---------- pitch: mown stripes + canon markings ----------
    for (let i = 0; i < 10; i++) { const x0 = -F + i * 10; this.poly([[x0, -F], [x0 + 10, -F], [x0 + 10, F], [x0, F]], i % 2 ? '#3b7d3d' : '#347236'); }
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let j = 0; j < 10; j += 2) { const [a, b] = this.P(-F, -F + j * 10), [c2, d] = this.P(F, -F + j * 10 + 10); ctx.fillRect(a, b, c2 - a, d - b); }
    // Archer legal zones (each Archer's own half), subtle team tint; stronger for a human-controlled team
    for (const ti of [0, 1]) {
      const gx = e.ownGoalX(ti), [a, b] = this.P(Math.min(gx, 0), -F), [c2, d] = this.P(Math.max(gx, 0), F);
      ctx.fillStyle = rgba(cols[ti].primary, e.teams[ti].human ? 0.1 : 0.05); ctx.fillRect(a, b, c2 - a, d - b);
    }
    // keeper zones (20 m from goal centre), tinted by defending team
    for (const ti of [0, 1]) {
      const gx = e.ownGoalX(ti), a0 = gx < 0 ? -Math.PI / 2 : Math.PI / 2, a1 = gx < 0 ? Math.PI / 2 : Math.PI * 1.5;
      this.gEllipse(gx, 0, C.KEEPER_ZONE_R, a0, a1); ctx.fillStyle = rgba(cols[ti].primary, 0.2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
    }
    const line = 'rgba(255,255,255,0.88)';
    this.poly([[-F, -F], [F, -F], [F, F], [-F, F]], undefined, line, 2.5);
    ctx.strokeStyle = line; ctx.lineWidth = 2; this.seg(0, -F, 0, F);
    this.gEllipse(0, 0, C.CENTRE_CIRCLE_R); ctx.stroke();
    ctx.setLineDash([9, 7]); ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    for (const gx of [-F, F]) { const x = gx - Math.sign(gx) * C.SCRIM_LINE; this.seg(x, -F, x, F); }
    ctx.setLineDash([]);
    // centre crest glyph: original shield in the home colours with the abbreviation
    { const [cx, cy] = this.P(0, 0); ctx.save(); ctx.translate(cx, cy); ctx.scale(s * 0.62, s * 0.62 * SQ); ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.moveTo(-3, -3.4); ctx.lineTo(3, -3.4); ctx.lineTo(3, 0.6); ctx.quadraticCurveTo(2.6, 3, 0, 4); ctx.quadraticCurveTo(-2.6, 3, -3, 0.6); ctx.closePath();
      ctx.fillStyle = cols[0].primary; ctx.fill(); ctx.lineWidth = 0.35; ctx.strokeStyle = cols[0].secondary; ctx.stroke();
      ctx.fillStyle = cols[0].secondary; ctx.fillRect(-3, -1.9, 6, 0.4);
      ctx.font = '900 2.3px "Arial Black", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = lum(cols[0].primary) > 0.5 ? '#10131c' : '#ffffff'; ctx.fillText(cols[0].abbr, 0, 0.6);
      ctx.restore(); ctx.globalAlpha = 1; }

    // interpolated athlete positions
    const ax = (a: Athlete) => a.px + (a.x - a.px) * al, ay = (a: Athlete) => a.py + (a.y - a.py) * al;
    const b = e.ball, holder = b.holder >= 0 ? e.ath[b.holder] : undefined;

    // ---------- Archer aim cones (on the ground, under the sprites) ----------
    if (e.phase === 'live') for (const ti of [0, 1]) {
      if (e.poss === ti) continue;
      const ar = e.ath.find((a) => a.team === ti && a.role === 'archer' && e.active(a)); if (!ar || e.teams[ti].arrowsLeft <= 0) continue;
      let tg: Athlete | undefined, best = 1e9;
      for (const o of e.ath) {
        if (o.team === ti || !e.active(o) || o.role === 'archer' || o.frozenT > 0 || o.immuneT > 0 || e.u(ti, o.x) >= 50) continue;
        const d = o.idx === b.holder ? -1 : Math.hypot(o.x - b.x, o.y - b.y); if (d < best) { best = d; tg = o; }
      }
      if (!tg) continue;
      const [x0, y0] = this.P(ar.x, ar.y, C.PLATFORM_H + 1.4), tx = ax(tg), ty = ay(tg), dx = tx - ar.x, dy = ty - ar.y, dn = Math.hypot(dx, dy) || 1, nx = -dy / dn * 1.6, ny = dx / dn * 1.6;
      const [x1, y1] = this.P(tx + nx, ty + ny), [x2, y2] = this.P(tx - nx, ty - ny);
      ctx.fillStyle = rgba(cols[ti].primary === '#000000' ? cols[ti].accent : cols[ti].primary, e.teams[ti].human ? 0.2 : 0.11);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(HI[ti], 0.55); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); this.gEllipse(tx, ty, 1.7); ctx.stroke(); ctx.setLineDash([]);
    }

    // ---------- goals + platforms ----------
    const drawGoal = (gx: number, ti: number) => {
      const sg = Math.sign(gx), R = C.GOAL_R;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i <= 10; i++) {                                         // quadrant net ribs running back 3 m
        const a = Math.PI * i / 10, y = -Math.cos(a) * R, z = Math.sin(a) * R;
        for (let j = 0; j <= 4; j++) { const q = (Math.PI / 2) * j / 4, [px, py] = this.P(gx + sg * R * Math.sin(q), y, z * Math.cos(q)); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      }
      for (const q of [0.5, 1.0]) for (let i = 0; i <= 10; i++) { const a = Math.PI * i / 10, [px, py] = this.P(gx + sg * R * Math.sin(q), -Math.cos(a) * R, Math.sin(a) * R * Math.cos(q)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
      ctx.beginPath(); for (let i = 0; i <= 20; i++) { const a = Math.PI * i / 20, [px, py] = this.P(gx, -Math.cos(a) * R, Math.sin(a) * R); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.lineCap = 'round'; ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = Math.max(4, s * 0.28); ctx.stroke();
      ctx.strokeStyle = cols[ti].primary === '#000000' ? cols[ti].accent : cols[ti].primary; ctx.lineWidth = Math.max(1.5, s * 0.1); ctx.stroke(); ctx.lineCap = 'butt';
    };
    const drawPlatform = (ti: number) => {
      const gx = e.ownGoalX(ti), px = gx + Math.sign(gx) * C.PLATFORM_BACK, h = C.PLATFORM_H, w = 1.7, c = cols[ti];
      ctx.strokeStyle = '#8a90a0'; ctx.lineWidth = Math.max(2, s * 0.14);
      for (const xx of [px - w, px + w]) { const [a1, b1] = this.P(xx, w, 0), [a2, b2] = this.P(xx, w, h); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); }
      ctx.lineWidth = 1.5; { const [a1, b1] = this.P(px - w, w, 0), [a2, b2] = this.P(px + w, w, h * 0.5), [a3, b3] = this.P(px - w, w, h); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.lineTo(a3, b3); ctx.stroke(); }
      this.poly([[px - w, w, h], [px + w, w, h], [px + w, w, h - 0.7], [px - w, w, h - 0.7]], darken(c.primary, 0.3));
      this.poly([[px - w, -w, h], [px + w, -w, h], [px + w, w, h], [px - w, w, h]], c.primary === '#000000' ? '#20232c' : c.primary, c.secondary, 2);
    };

    type Item = { y: number; k: number; a?: Athlete };
    const items: Item[] = [{ y: 0.01, k: 1 }, { y: 0.02, k: 2 }, { y: 1.6, k: 3 }, { y: 1.61, k: 4 }];
    for (const a of e.ath) if (e.active(a)) items.push({ y: a.role === 'archer' ? 1.7 : ay(a), k: 0, a });
    const hx = holder ? ax(holder) + Math.cos(holder.facing) * 0.35 : b.x - b.vx * C.DT * (1 - al), hy = holder ? ay(holder) + Math.sin(holder.facing) * 0.35 : b.y - b.vy * C.DT * (1 - al);
    items.push({ y: holder ? ay(holder) + 0.05 : hy, k: 5 });
    items.sort((p, q) => p.y - q.y);

    const drawAth = (a: Athlete) => {
      const col = cols[a.team], archer = a.role === 'archer', x = ax(a), y = ay(a), i = a.idx;
      const [gx, gy] = this.P(x, y, 0), zf = archer ? C.PLATFORM_H : Math.max(0, a.z || 0), sy = gy - zf * s * ZK, sx = gx;
      const ss = s * SPR, rr = a.body.radius * ss, Hpx = a.body.height * ss * ZK, sp = Math.hypot(a.vx, a.vy), anim = animFor(a, b.holder === i);
      // run-cycle phase: cadence scales with speed and leg length
      this.phase[i] = (this.phase[i] || i * 1.7) + dt * this.timeScale * Math.min(26, 5 + sp * 2.1 / Math.max(1, a.body.height * 0.52));
      const sq = this.squash[i] || 0; if (sq > 0) this.squash[i] = sq < 0.02 ? 0 : sq * Math.exp(-dt * 7);
      if (!archer) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(gx + rr * 0.5, gy + 1, rr * 1.9, rr * 0.8, 0, 0, 7); ctx.fill(); }
      const hi = HI[a.team], sel = selected.includes(i), carrier = b.holder === i;
      if (sel) { ctx.strokeStyle = hi; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(sx, sy, rr * 2.3 + 4, (rr * 2.3 + 4) * SQ, 0, 0, 7); ctx.stroke(); }
      if (carrier) {                                                         // ball-carrier highlight: bright rotating ring
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 5]); ctx.lineDashOffset = -wallT * 30;
        ctx.beginPath(); ctx.ellipse(sx, sy, rr * 2.8 + 6, (rr * 2.8 + 6) * SQ, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
        ctx.fillStyle = rgba(hi, 0.22); ctx.fill();
      }
      if (b.holder < 0 && b.receiver === i) {                                // intended receiver of the pass in flight
        const pulse = 0.8 + 0.2 * Math.sin(wallT * 14);
        ctx.strokeStyle = hi; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(sx, sy, (rr * 3 + 8) * pulse, (rr * 3 + 8) * SQ * pulse, 0, 0, 7); ctx.stroke();
        const ty = sy - Hpx - 16 - Math.abs(Math.sin(wallT * 9)) * 5; ctx.fillStyle = hi;
        ctx.beginPath(); ctx.moveTo(sx - 8, ty - 11); ctx.lineTo(sx + 8, ty - 11); ctx.lineTo(sx, ty); ctx.closePath(); ctx.fill();
      }
      if (a.frozenT > 0) {                                                   // frozen ring with a countdown arc
        const R2 = rr * 2.6 + 5; ctx.fillStyle = 'rgba(140,215,255,0.2)'; ctx.beginPath(); ctx.ellipse(sx, sy, R2, R2 * SQ, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = '#7fd8ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(sx, sy, R2, R2 * SQ, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, a.frozenT / C.FREEZE_TIME)); ctx.stroke();
      } else if (a.immuneT > 0) {                                            // immunity shimmer: amber dashes that run out with the timer
        const R2 = rr * 2.4 + 4; ctx.globalAlpha = 0.55 + 0.35 * Math.sin(wallT * 10 + i);
        ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 2.5; ctx.setLineDash([3, 6]); ctx.lineDashOffset = wallT * 40;
        ctx.beginPath(); ctx.ellipse(sx, sy, R2, R2 * SQ, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, a.immuneT / C.IMMUNE_TIME)); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
      }
      if (anim === 'sprint') {                                               // speed lines + dust
        const ux = a.vx / (sp || 1), uy = a.vy / (sp || 1); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let j = 0; j < 3; j++) { const hh = Hpx * (0.25 + j * 0.25), ox = sx - ux * (rr * 1.6 + j * 3), oy = sy - uy * rr * SQ - hh; ctx.moveTo(ox, oy); ctx.lineTo(ox - ux * s * (1.2 + ((i + j) % 3) * 0.5), oy - uy * s * 0.6 * SQ); }
        ctx.stroke();
        if ((this.frame + i) % 5 === 0 && this.timeScale === 1) this.fx.dust(x - ux * 0.5, y - uy * 0.5);
      }
      const k = anim === 'throw' ? 1 - Math.min(1, a.actT / 0.35) : anim === 'shoot' ? 1 - Math.min(1, a.actT / 0.9) : anim === 'tackled' ? 1 - Math.min(1, a.groundedT / 1.4) : 0;
      drawFigure(ctx, specOf(a), col, sx, sy, ss, { anim, phase: this.phase[i], t: wallT + i * 0.37, k, facingLeft: Math.cos(a.facing) < -0.05, squash: sq });
      // discipline / status icons above the head
      let iy = sy - Hpx - 7;
      if (a.minors > 0 || a.majors > 0) {
        const n = Math.min(5, a.minors) + (a.majors > 0 ? 1 : 0); let ix = sx - (n - 1) * 3.5;
        for (let j = 0; j < Math.min(5, a.minors); j++, ix += 7) { ctx.fillStyle = '#ffd21f'; ctx.fillRect(ix - 2.5, iy - 6, 5, 7); }
        if (a.majors > 0) { ctx.fillStyle = '#ff3030'; ctx.fillRect(ix - 2.5, iy - 6, 5, 7); }
        iy -= 11;
      }
      if (a.injured) { ctx.fillStyle = '#e02626'; ctx.beginPath(); ctx.arc(sx, iy - 5, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.fillRect(sx - 1.5, iy - 10, 3, 10); ctx.fillRect(sx - 5, iy - 6.5, 10, 3); iy -= 16; }
      if (carrier) { const by = iy - 4 - Math.abs(Math.sin(wallT * 6)) * 3; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(sx, by); ctx.lineTo(sx - 6, by - 8); ctx.lineTo(sx + 6, by - 8); ctx.closePath(); ctx.fill(); iy -= 14; }
      if (sel || carrier || a.role === 'keeper') {
        const label = sel || carrier ? `${a.d.jersey} ${a.d.name.split(' ').slice(-1)[0]} · ${a.d.pos}` : 'KEEPER';
        ctx.font = 'bold 11px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        const tw = ctx.measureText(label).width; ctx.fillStyle = 'rgba(8,10,18,0.72)'; roundRect(ctx, sx - tw / 2 - 5, iy - 13, tw + 10, 15, 4); ctx.fill();
        ctx.fillStyle = sel || carrier ? '#ffffff' : '#ffd9a0'; ctx.fillText(label, sx, iy - 2);
      }
    };

    const drawBall = () => {
      const bz = holder ? 1.1 + Math.max(0, holder.z || 0) : b.z, [gx, gy] = this.P(hx, hy, 0), [bx, by] = this.P(hx, hy, bz);
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz), flying = b.holder < 0 && speed > 7;
      if (flying) { this.trail.push([hx, hy, bz]); if (this.trail.length > 12) this.trail.shift(); } else this.trail.length = 0;
      if (flying && b.z > 0.4) {                                             // pass-in-flight indicator: dotted ground track + landing marker
        const h0 = Math.min(b.z, 1), tl = Math.min(3, (b.vz + Math.sqrt(Math.max(0, b.vz * b.vz + 2 * C.G * (b.z - h0)))) / C.G);
        const lx = Math.max(-F - 3, Math.min(F + 3, b.x + b.vx * tl)), ly = Math.max(-F - 3, Math.min(F + 3, b.y + b.vy * tl)), [mx, my] = this.P(lx, ly);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([3, 7]); ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(mx, my); ctx.stroke(); ctx.setLineDash([]);
        const pr = (0.7 + 0.25 * Math.sin(wallT * 12)) * s; ctx.strokeStyle = b.isShot ? '#ff7a3d' : '#ffffff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(mx, my, pr, pr * SQ, 0, 0, 7); ctx.moveTo(mx - pr * 0.5, my); ctx.lineTo(mx + pr * 0.5, my); ctx.moveTo(mx, my - pr * 0.3); ctx.lineTo(mx, my + pr * 0.3); ctx.stroke();
      }
      if (this.trail.length > 1) {
        ctx.lineCap = 'round';
        for (let i = 1; i < this.trail.length; i++) {
          const p0 = this.trail[i - 1], p1 = this.trail[i], [x0, y0] = this.P(p0[0], p0[1], p0[2]), [x1, y1] = this.P(p1[0], p1[1], p1[2]), u = i / this.trail.length;
          ctx.strokeStyle = b.isShot ? `rgba(255,170,90,${u * 0.6})` : `rgba(255,244,214,${u * 0.55})`; ctx.lineWidth = Math.max(1.5, s * 0.3 * u);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(gx, gy, s * 0.24, s * 0.11, 0, 0, 7); ctx.fill();
      const r = Math.max(4.5, s * 0.24), rot = flying ? wallT * 26 + b.x * 0.7 : 0.6;
      ctx.save(); ctx.translate(bx, by);
      ctx.fillStyle = '#f4e8cc'; ctx.strokeStyle = '#6b3d14'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.rotate(rot); ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.beginPath(); ctx.moveTo(-r * 0.9, 0); ctx.lineTo(r * 0.9, 0); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.4, r * 0.88, 0, 0, 7); ctx.stroke();
      ctx.restore();
    };

    for (const it of items) {
      if (it.k === 0) drawAth(it.a!);
      else if (it.k === 1) drawGoal(-F, e.ownGoalX(0) === -F ? 0 : 1);
      else if (it.k === 2) drawGoal(F, e.ownGoalX(0) === F ? 0 : 1);
      else if (it.k === 3) drawPlatform(0);
      else if (it.k === 4) drawPlatform(1);
      else drawBall();
    }

    // freeze start / thaw detection -> ice burst / shatter; throw whoosh on release
    for (const a of e.ath) {
      const fz = a.frozenT > 0, was = !!this.wasFrozen[a.idx];
      if (fz !== was) { if (e.active(a) && this.fx.parts.length < 300) this.fx.ice(a.x, a.y, a.body.height, !fz); if (!fz) this.sfx('shatter', 0.6); this.wasFrozen[a.idx] = fz; }
    }
    if (this.hadBall >= 0 && b.holder < 0 && Math.hypot(b.vx, b.vy) > 7) this.sfx('throw', 0.8);
    this.hadBall = b.holder;

    this.fx.draw(ctx, this.P, s);

    // catch / drop feedback
    for (const f of e.catchFx) {
      const life = f.ok ? 0.4 : 0.55, u = Math.max(0, 1 - f.t / life), [fx2, fy2] = this.P(f.x, f.y, f.z);
      if (f.ok) {
        ctx.strokeStyle = `rgba(255,255,255,${1 - u})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(fx2, fy2, 8 + u * 30, 0, 7); ctx.stroke();
        ctx.lineWidth = 2; ctx.beginPath(); for (let q = 0; q < 8; q++) { const ang = q * Math.PI / 4, r0 = 12 + u * 22, r1 = 20 + u * 30; ctx.moveTo(fx2 + Math.cos(ang) * r0, fy2 + Math.sin(ang) * r0 * 0.7); ctx.lineTo(fx2 + Math.cos(ang) * r1, fy2 + Math.sin(ang) * r1 * 0.7); } ctx.stroke();
      } else {
        ctx.font = '900 16px "Arial Black", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 3; ctx.strokeStyle = `rgba(0,0,0,${1 - u})`; ctx.fillStyle = `rgba(255,150,40,${1 - u})`;
        ctx.strokeText('DROP', fx2, fy2 - 14 - u * 22); ctx.fillText('DROP', fx2, fy2 - 14 - u * 22);
      }
    }
    // arrows: 250 m/s is too fast to see, so keep a short-lived tracer from the platform to the arrow / impact
    for (const ar of e.arrows) {
      let tr = this.tracers.get(ar);
      if (!tr) { const arc = e.ath.find((a) => a.team === ar.team && a.role === 'archer'); tr = { x0: arc ? arc.x : ar.x, y0: arc ? arc.y : ar.y, z0: C.PLATFORM_H + 1.3, x1: ar.x, y1: ar.y, z1: ar.z, team: ar.team, fade: 0, seen: 0 }; this.tracers.set(ar, tr); }
      tr.x1 = ar.x; tr.y1 = ar.y; tr.z1 = Math.max(0, ar.z); tr.seen = this.frame;
    }
    if (this.tracers.size) {
      ctx.lineCap = 'round';
      for (const [k2, tr] of this.tracers) {
        if (tr.seen !== this.frame) { tr.fade += dt; if (tr.fade > 0.45) { this.tracers.delete(k2); continue; } }
        const u = 1 - tr.fade / 0.45, [x0, y0] = this.P(tr.x0, tr.y0, tr.z0), [x1, y1] = this.P(tr.x1, tr.y1, tr.z1);
        ctx.strokeStyle = rgba(HI[tr.team], 0.3 * u); ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * u})`; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${u})`; ctx.beginPath(); ctx.arc(x1, y1, 3 + (1 - u) * 8, 0, 7); ctx.fill();
      }
      ctx.lineCap = 'butt';
    }
    // goal flash
    if (this.flashT > 0) { this.flashT -= dt; const u = Math.max(0, this.flashT / 0.7); ctx.fillStyle = `rgba(255,255,255,${u * u * 0.5})`; ctx.fillRect(0, 0, W, H); ctx.fillStyle = rgba(this.flashCol, u * 0.25); ctx.fillRect(0, 0, W, H); }
  }

  // ---------- title backdrop: night stadium + hero players (sits behind the DOM menu) ----------
  private buildTitle(W: number, H: number) {
    const cv = document.createElement('canvas'); cv.width = Math.max(2, Math.round(W)); cv.height = Math.max(2, Math.round(H));
    const g = cv.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#05070e'); sky.addColorStop(0.45, '#0e1630'); sky.addColorStop(0.62, '#1a2444'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const cc = ['#c8102e', '#f2c14e', '#1f6feb', '#e8e2d0', '#22b573', '#7a5cff', '#3d4763', '#8a7f6a'];
    const top = H * 0.2, bot = H * 0.6;
    for (let r = 0; r < 26; r++) { const y = top + (bot - top) * r / 26; g.fillStyle = r % 2 ? '#141a2c' : '#1a2238'; g.fillRect(0, y, W, (bot - top) / 26 + 1); for (let x = rnd() * 6; x < W; x += 7) { if (rnd() < 0.15) continue; g.fillStyle = cc[(rnd() * cc.length) | 0]; g.globalAlpha = 0.75; g.fillRect(x, y + 2, 4, 5); } g.globalAlpha = 1; }
    g.fillStyle = '#0a0d17'; g.fillRect(0, top - H * 0.035, W, H * 0.035);
    for (const fxp of [0.12, 0.37, 0.63, 0.88]) { const x = W * fxp, y = top - H * 0.06, R = H * 0.42; const gr = g.createRadialGradient(x, y, 2, x, y, R); gr.addColorStop(0, 'rgba(255,250,225,0.9)'); gr.addColorStop(0.1, 'rgba(255,245,210,0.3)'); gr.addColorStop(1, 'rgba(255,245,210,0)'); g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2); g.fillStyle = '#fffbe8'; for (let i = -2; i <= 2; i++) g.fillRect(x + i * 12 - 4, y - 5, 8, 9); }
    for (let i = 0; i < 16; i++) { g.fillStyle = [cc[0], cc[2], cc[1], cc[4]][i % 4]; g.fillRect(i * W / 16, bot, W / 16 + 1, H * 0.035); }
    for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#2f6b33' : '#285e2d'; const x0 = W / 2 + (i - 4.5) * W * 0.16, x1 = W / 2 + (i - 3.5) * W * 0.16, yb = bot + H * 0.035; g.beginPath(); g.moveTo(x0, yb); g.lineTo(x1 + 1, yb); g.lineTo(W / 2 + (i - 3.5) * W * 0.3, H); g.lineTo(W / 2 + (i - 4.5) * W * 0.3, H); g.closePath(); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3; g.beginPath(); g.ellipse(W / 2, H * 0.86, W * 0.24, H * 0.1, 0, 0, 7); g.stroke();
    const vg = g.createRadialGradient(W / 2, H * 0.5, H * 0.1, W / 2, H * 0.5, Math.max(W, H) * 0.62); vg.addColorStop(0, 'rgba(4,6,12,0.72)'); vg.addColorStop(0.55, 'rgba(4,6,12,0.45)'); vg.addColorStop(1, 'rgba(4,6,12,0.1)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    this.titleBg = cv;
  }
  drawTitle(wallT: number): void {
    const ctx = this.ctx, W = ctx.canvas.width / this.dpr, H = ctx.canvas.height / this.dpr;
    this.timeScale = 1; this.lastE = null;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = 1;
    const key = Math.round(W) + 'x' + Math.round(H);
    if (!this.titleBg || this.titleKey !== key) { this.buildTitle(W, H); this.titleKey = key; }
    const drift = Math.sin(wallT * 0.17) * 12, dy = Math.cos(wallT * 0.13) * 4;
    ctx.fillStyle = '#05070e'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.titleBg!, -16 + drift * 0.5, -6 + dy * 0.5, W + 32, H + 12);
    if (!this.heroes) {
      const A: TeamColors = { abbr: 'EMB', slug: '', primary: '#c8102e', secondary: '#f2c14e', accent: '#ffe9a8', number: '#ffffff', palette: '' };
      const B: TeamColors = { abbr: 'TDE', slug: '', primary: '#1456c8', secondary: '#e8eef8', accent: '#39e0c8', number: '#ffffff', palette: '' };
      const mk = (height: number, radius: number, physique: string, skin: number, hair: number, face: number, role: FigSpec['role'], jersey: number, tribe: number): FigSpec => ({ height, radius, physique, skin, hair, face, role, jersey, tribe, frozen: false, redLight: false, immune: false });
      this.heroes = [
        { f: mk(2.45, 0.44, 'Powerful', 1, 2, 3, 'field', 9, 0), col: A, x: 0.1, anim: 'sprint', sc: 1, left: false },
        { f: mk(1.9, 0.3, 'Compact', 3, 1, 0, 'field', 23, 2), col: B, x: 0.235, anim: 'run', sc: 0.9, left: false },
        { f: mk(3.2, 0.52, 'Hulking', 0, 0, 1, 'field', 77, 4), col: B, x: 0.81, anim: 'celebrate', sc: 0.82, left: true },
        { f: mk(2.75, 0.36, 'Lanky', 2, 3, 2, 'keeper', 1, 5), col: A, x: 0.93, anim: 'idle', sc: 1, left: true },
      ];
    }
    const base = H * 0.97, u = Math.min(H / 5.2, W / 9);
    for (let i = 0; i < this.heroes.length; i++) {
      const h = this.heroes[i], s = u * h.sc, x = W * h.x + drift * (1 + i * 0.2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(x, base - (1 - h.sc) * 40, h.f.radius * s * 2.2, h.f.radius * s * 0.6, 0, 0, 7); ctx.fill();
      drawFigure(ctx, h.f, h.col, x, base - (1 - h.sc) * 40, s, { anim: h.anim, phase: wallT * (h.anim === 'sprint' ? 9 : 7) + i, t: wallT + i * 0.8, k: 0, facingLeft: h.left, squash: 0 });
    }
  }
}

export function fmtClock(t: number) { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${s.toString().padStart(2, '0')}`; }
export { roundRect, lighten };
