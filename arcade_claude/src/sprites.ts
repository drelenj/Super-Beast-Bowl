// Procedural athlete sprites (original art, no image assets). One articulated figure drawn with
// Canvas 2D primitives, scaled by real Height and Mass (body.height / body.radius), with the
// silhouette set by Physique. All athletes are Black men (the NBL is the men's league): a range of
// brown skin tones and short / fade / locs / braids hair. "Ancestry" is a fictional tribe tag and
// only selects a small helmet-stripe / armband marking style.
import type { Athlete, TeamColors } from './engine/types';

export const SKIN = ['#4a2e1f', '#603b27', '#7d4f33', '#9a6544'];
const SKIN_SH = ['#38221a', '#4a2c1d', '#643e28', '#7c5136'];
const HAIR = '#15100d';
const ICE = '#cfeeff';

function rgbOf(c: string): [number, number, number] {
  if (c[0] === '#') {
    let h = c.slice(1); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
}
export function mix(c: string, d: string, k: number) {
  const a = rgbOf(c), b = rgbOf(d);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}
export const lighten = (c: string, k: number) => mix(c, '#ffffff', k);
export const darken = (c: string, k: number) => mix(c, '#000000', k);
export function lum(c: string) { const [r, g, b] = rgbOf(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
export function rgba(c: string, a: number) { const [r, g, b] = rgbOf(c); return `rgba(${r},${g},${b},${a})`; }

export type FigRole = 'field' | 'keeper' | 'archer';
export interface FigSpec {
  height: number; radius: number; physique: string; skin: number; hair: number; face: number;
  role: FigRole; jersey: number; tribe: number; frozen: boolean; redLight: boolean; immune: boolean;
}
export interface Pose {
  anim: string;        // idle | run | sprint | throw | shoot | catch | tackle | tackled | frozen | celebrate | injured
  phase: number;       // run-cycle phase (radians), speed-scaled by the caller
  t: number;           // wall time (idle breathing, celebrate)
  k: number;           // 0..1 progress of a one-shot action (throw / shoot / tackle / tackled)
  facingLeft: boolean;
  squash: number;      // 0..~0.35 squash-and-stretch from a hit
}

interface Phys { sh: number; waist: number; leg: number; limb: number; arm: number; belly: number }
const PHYS: Record<string, Phys> = {
  Compact:  { sh: 1.00, waist: 0.80, leg: 0.455, limb: 1.00, arm: 0.92, belly: 0 },
  Lean:     { sh: 0.90, waist: 0.70, leg: 0.50, limb: 0.80, arm: 1.00, belly: 0 },
  Lanky:    { sh: 0.86, waist: 0.68, leg: 0.535, limb: 0.72, arm: 1.10, belly: 0 },
  Stocky:   { sh: 1.10, waist: 0.92, leg: 0.44, limb: 1.15, arm: 0.92, belly: 0.3 },
  Athletic: { sh: 1.08, waist: 0.66, leg: 0.495, limb: 0.96, arm: 1.00, belly: 0 },
  Rangy:    { sh: 0.96, waist: 0.70, leg: 0.52, limb: 0.84, arm: 1.14, belly: 0 },
  Bulky:    { sh: 1.20, waist: 1.00, leg: 0.455, limb: 1.28, arm: 0.96, belly: 0.6 },
  Powerful: { sh: 1.30, waist: 0.74, leg: 0.475, limb: 1.24, arm: 1.02, belly: 0 },
  Hulking:  { sh: 1.42, waist: 0.86, leg: 0.455, limb: 1.42, arm: 1.08, belly: 0.25 },
};
const TRIBES = ['Ly', 'Dryqona', 'Yubu', 'Shyn', 'Psolari', 'Vygari', 'Fefmial'];
export function tribeIndex(ancestry: string): number {
  const s = ancestry || '';
  for (let i = 0; i < TRIBES.length; i++) if (s.startsWith(TRIBES[i])) return i;
  return 0;
}

interface Kit { jersey: string; jerseySh: string; trim: string; shorts: string; helm: string; helmSh: string; sock: string; num: string; numStroke: string; outline: string; pad: string; glove: string; accent: string }
const kitCache = new Map<string, Kit>();
function kitFor(col: TeamColors, role: FigRole, frozen: boolean): Kit {
  const key = col.primary + col.secondary + col.accent + col.number + role + (frozen ? 'f' : '');
  let k = kitCache.get(key);
  if (k) return k;
  let jersey = col.primary, trim = col.secondary, helm = col.secondary, shorts = darken(col.primary, 0.38), sock = col.secondary;
  if (lum(helm) < 0.1 && lum(col.primary) < 0.1) helm = col.accent;
  if (role === 'keeper') { jersey = col.accent; trim = col.primary; helm = col.primary; shorts = darken(col.accent, 0.45); sock = col.accent; }
  if (role === 'archer') { jersey = lighten(col.primary, 0.5); trim = col.accent; helm = lighten(col.secondary, 0.35); shorts = lighten(col.primary, 0.15); sock = lighten(col.primary, 0.5); }
  if (Math.abs(lum(jersey) - lum(trim)) < 0.08) trim = lum(jersey) > 0.5 ? darken(trim, 0.5) : lighten(trim, 0.5);
  let num = col.number;
  if (Math.abs(lum(num) - lum(jersey)) < 0.3) num = lum(jersey) > 0.5 ? '#10131c' : '#ffffff';
  const f = (c: string) => (frozen ? mix(c, ICE, 0.6) : c);
  k = {
    jersey: f(jersey), jerseySh: f(darken(jersey, 0.22)), trim: f(trim), shorts: f(shorts), helm: f(helm), helmSh: f(darken(helm, 0.25)),
    sock: f(sock), num: f(num), numStroke: f(lum(num) > 0.5 ? '#10131c' : '#f4f4f4'),
    outline: f(lum(jersey) < 0.16 ? lighten(jersey, 0.3) : darken(jersey, 0.55)), pad: f(lum(jersey) < 0.16 ? lighten(jersey, 0.18) : darken(jersey, 0.14)),
    glove: f(role === 'keeper' ? '#f4f1e6' : '#1a1c22'), accent: f(col.accent),
  };
  kitCache.set(key, k);
  return k;
}
const SKIN_ICE = SKIN.map((c) => mix(c, ICE, 0.55)), SKIN_SH_ICE = SKIN_SH.map((c) => mix(c, ICE, 0.55));
const fontCache: string[] = [];
const numFont = (px: number) => fontCache[px] || (fontCache[px] = `900 ${px}px "Arial Black", Arial, sans-serif`);

export function specOf(a: Athlete): FigSpec {
  return {
    height: a.body.height, radius: a.body.radius, physique: a.d.physique, skin: a.look.skin, hair: a.look.hair, face: a.look.face,
    role: a.role, jersey: a.d.jersey, tribe: tribeIndex(a.d.ancestry), frozen: a.frozenT > 0, redLight: a.frozenT > 0 || a.recoverT > 0, immune: a.immuneT > 0,
  };
}

/** Draw a figure with its feet at (sx, sy). s = pixels per metre. */
export function drawFigure(ctx: CanvasRenderingContext2D, f: FigSpec, col: TeamColors, sx: number, sy: number, s: number, pose: Pose) {
  const P = PHYS[f.physique] || PHYS.Athletic, kit = kitFor(col, f.role, f.frozen);
  const anim = pose.anim, k = pose.k;
  const skin = f.frozen ? SKIN_ICE[f.skin] : SKIN[f.skin], skinSh = f.frozen ? SKIN_SH_ICE[f.skin] : SKIN_SH[f.skin];
  const archer = f.role === 'archer', keeper = f.role === 'keeper';
  const H = f.height * s * 0.92;
  const hr = s * 0.118 * Math.pow(f.height / 1.9, 0.75);
  const bw = f.radius * 1.5 * s * P.sh * (archer ? 0.9 : 1);         // shoulder width
  const shY = H - hr * 2.25, hipY = H * P.leg, tH = shY - hipY;
  const thigh = hipY * 0.5, shin = hipY * 0.5;
  const lw = Math.max(1.6, f.radius * s * 0.56 * P.limb);                   // thigh thickness
  const aw = Math.max(1.3, lw * 0.72);
  const upArm = tH * 0.5 * P.arm, foreArm = tH * 0.5 * P.arm;
  const detail = hr >= 2.6, fine = s >= 34;

  // pose angles (0 = hanging down, + = forward)
  let lean = 0.03, rot = 0, lift = 0, sit = 0;
  let lA = 0.07, lB = 0.05, rA = -0.07, rB = 0.05;                         // near / far leg (thigh angle, knee bend)
  let nC = 0.12, nD = 0.3, fC = -0.1, fD = 0.3;                            // near / far arm (shoulder angle, elbow bend)
  const ph = pose.phase;
  if (anim === 'run' || anim === 'sprint') {
    const amp = anim === 'sprint' ? 0.95 : 0.6, sn = Math.sin(ph), cs = Math.cos(ph);
    lean = anim === 'sprint' ? 0.34 : 0.13;
    lA = sn * amp; rA = -sn * amp;
    lB = 0.15 + Math.max(0, -cs) * amp * 1.5; rB = 0.15 + Math.max(0, cs) * amp * 1.5;
    nC = -sn * amp * 0.95; fC = sn * amp * 0.95; nD = fD = 0.5 + amp * 0.9;
    lift = Math.abs(cs) * s * 0.06 * amp;
  } else if (anim === 'idle') {
    lift = Math.sin(pose.t * 2.3) * s * 0.012; nC = 0.14 + Math.sin(pose.t * 2.3) * 0.03; lean = 0.05;
  } else if (anim === 'throw') {
    nC = 3.5 - 2.5 * k; nD = 0.7 - 0.5 * k; fC = 1.1 - 0.9 * k; fD = 0.4; lean = -0.12 + 0.3 * k; lA = 0.35; rA = -0.3; rB = 0.25;
  } else if (anim === 'shoot') {
    fC = 1.62; fD = 0; nC = -1.35 + 0.5 * k; nD = 2.75 - 1.6 * k; lean = -0.04; lA = 0.22; rA = -0.2;
  } else if (anim === 'catch') {
    nC = 2.3; fC = 2.0; nD = fD = 0.35; lean = -0.06; lA = 0.2; rA = -0.15;
  } else if (anim === 'tackle') {
    rot = 1.2; nC = 1.9; fC = 1.65; nD = fD = 0.1; lA = -0.25; rA = -0.5; lB = 0.2; rB = 0.5; lean = 0.1;
  } else if (anim === 'tackled') {
    rot = -Math.PI / 2; nC = -1.0; fC = 2.4; nD = 0.5; fD = 0.4; lA = 0.5; rA = 0.15; lB = 0.9; rB = 0.3;
  } else if (anim === 'frozen') {
    nC = 0.55; nD = 1.0; fC = -0.35; fD = 0.6; lA = 0.3; rA = -0.25; lB = 0.3; lean = 0.1;
  } else if (anim === 'celebrate') {
    const w = Math.sin(pose.t * 9);
    lift = Math.abs(Math.sin(pose.t * 5.5)) * s * 0.45; nC = 3.55 + w * 0.2; fC = 2.65 - w * 0.2; nD = fD = 0.25; lA = 0.25; rA = -0.2; lB = rB = 0.4; lean = -0.08;
  } else if (anim === 'injured') {
    sit = 1; lA = 1.35; lB = 1.5; rA = 1.5; rB = 0.15; nC = 1.0; nD = 0.9; fC = 0.8; fD = 0.7; lean = 0.22;
  }

  ctx.save();
  ctx.translate(sx, sy);
  if (pose.facingLeft) ctx.scale(-1, 1);
  if (pose.squash > 0.01) ctx.scale(1 + pose.squash * 0.6, 1 - pose.squash);
  if (rot > 0) { ctx.translate(-H * 0.12, -H * 0.3); ctx.rotate(rot); ctx.translate(0, H * 0.3); }
  else if (rot < 0) { ctx.translate(H * 0.42, -lw * 0.9 - Math.abs(Math.sin(Math.min(1, k * 2.2) * Math.PI)) * s * 0.3); ctx.rotate(rot); }
  const hy = sit ? lw * 0.9 : hipY;                                        // hip height above the ground
  ctx.translate(0, -lift);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  const leg = (A: number, B: number, off: number, far: boolean) => {
    const hx = off, kx = hx + Math.sin(A) * thigh, ky = -hy + Math.cos(A) * thigh;
    const fx = kx + Math.sin(A - B) * shin, fy = ky + Math.cos(A - B) * shin;
    ctx.lineWidth = lw * 0.74; ctx.strokeStyle = far ? skinSh : skin;
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.strokeStyle = kit.sock; ctx.lineWidth = lw * 0.78;                   // sock / shin guard
    ctx.beginPath(); ctx.moveTo(kx + (fx - kx) * 0.5, ky + (fy - ky) * 0.5); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.strokeStyle = far ? darken(kit.shorts, 0.2) : kit.shorts; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(hx, -hy); ctx.lineTo(hx + (kx - hx) * 0.78, -hy + (ky + hy) * 0.78); ctx.stroke();
    if (!far && detail) {                                                    // numbered thigh strike panel
      const px = hx + (kx - hx) * 0.45, py = -hy + (ky + hy) * 0.45;
      ctx.fillStyle = kit.trim; ctx.beginPath(); ctx.arc(px, py, lw * 0.36, 0, 7); ctx.fill();
      if (fine) { ctx.save(); ctx.translate(px, py); if (pose.facingLeft) ctx.scale(-1, 1); ctx.font = numFont(Math.round(lw * 0.42)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = lum(kit.trim) > 0.5 ? '#111' : '#fff'; ctx.fillText('2', 0, 0); ctx.restore(); }
    }
    // boot
    const bl = Math.max(2, s * 0.17 * (0.8 + f.height * 0.12));
    ctx.strokeStyle = '#0e0f13'; ctx.lineWidth = Math.max(1.6, lw * 0.6);
    ctx.beginPath(); ctx.moveTo(fx - bl * 0.2, fy); ctx.lineTo(fx + bl * Math.cos(A - B) * 0.9, fy + (sit ? -bl * 0.5 : Math.max(-bl * 0.4, -Math.sin(A - B) * bl * 0.5))); ctx.stroke();
  };
  const arm = (C: number, D: number, shx: number, far: boolean) => {
    const sy0 = -tH * 0.93, ex = shx + Math.sin(C) * upArm, ey = sy0 + Math.cos(C) * upArm;
    const hx = ex + Math.sin(C + D) * foreArm, hy2 = ey + Math.cos(C + D) * foreArm;
    ctx.strokeStyle = far ? skinSh : skin; ctx.lineWidth = aw * 0.82;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy2); ctx.stroke();
    ctx.strokeStyle = far ? kit.jerseySh : kit.jersey; ctx.lineWidth = aw;
    ctx.beginPath(); ctx.moveTo(shx, sy0); ctx.lineTo(shx + (ex - shx) * 0.7, sy0 + (ey - sy0) * 0.7); ctx.stroke();
    if (!far && detail) {                                                    // tribe armband
      ctx.strokeStyle = f.tribe % 2 ? kit.accent : kit.trim; ctx.lineWidth = aw * 1.04; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(ex + (hx - ex) * 0.12, ey + (hy2 - ey) * 0.12); ctx.lineTo(ex + (hx - ex) * (f.tribe > 3 ? 0.42 : 0.28), ey + (hy2 - ey) * (f.tribe > 3 ? 0.42 : 0.28)); ctx.stroke(); ctx.lineCap = 'round';
    }
    ctx.fillStyle = kit.glove; ctx.beginPath(); ctx.arc(hx, hy2, aw * (keeper ? 0.78 : 0.56), 0, 7); ctx.fill();
    return [hx, hy2];
  };

  // far limbs
  leg(rA, rB, bw * 0.1, true);
  // upper body (rotates about the hips)
  ctx.save(); ctx.translate(0, -hy); ctx.rotate(lean);
  const farHand = arm(fC, fD, bw * 0.3, true);
  ctx.restore();
  leg(lA, lB, -bw * 0.1, false);
  ctx.save(); ctx.translate(0, -hy); ctx.rotate(lean);
  // archer quiver on the back
  if (archer) { ctx.strokeStyle = '#5b4630'; ctx.lineWidth = Math.max(2, bw * 0.2); ctx.beginPath(); ctx.moveTo(-bw * 0.42, -tH * 0.25); ctx.lineTo(-bw * 0.22, -tH * 1.08); ctx.stroke(); ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-bw * 0.2, -tH * 1.1); ctx.lineTo(-bw * 0.14, -tH * 1.28); ctx.moveTo(-bw * 0.27, -tH * 1.08); ctx.lineTo(-bw * 0.3, -tH * 1.26); ctx.stroke(); }
  // locs / braids hang behind the shoulders
  const headY = -tH - hr * 1.12;
  if (detail && f.hair >= 2) {
    const sway = anim === 'run' || anim === 'sprint' ? Math.sin(ph * 2) * hr * 0.25 - hr * 0.5 : 0;
    ctx.strokeStyle = HAIR; ctx.lineWidth = f.hair === 2 ? Math.max(1.2, hr * 0.26) : Math.max(0.9, hr * 0.14);
    const n = f.hair === 2 ? 4 : 5, len = f.hair === 2 ? 1.9 : 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x0 = -hr * (0.35 + i * 0.16); ctx.moveTo(x0, headY + hr * 0.2); ctx.quadraticCurveTo(x0 - hr * 0.3 + sway * 0.5, headY + hr * len * 0.6, x0 - hr * 0.1 + sway, headY + hr * (len - i * 0.08)); }
    ctx.stroke();
    if (f.hair === 3 && fine) { ctx.fillStyle = kit.accent; for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(-hr * (0.45 + i * 0.16) + sway, headY + hr * (len - i * 0.08), hr * 0.09, 0, 7); ctx.fill(); } }
  }
  // torso
  const wst = bw * P.waist;
  ctx.beginPath();
  ctx.moveTo(-bw * 0.5, -tH * 0.96); ctx.quadraticCurveTo(0, -tH * 1.06, bw * 0.5, -tH * 0.96);
  ctx.quadraticCurveTo(bw * (0.5 + P.belly * 0.12), -tH * 0.45, wst * 0.5, tH * 0.04);
  ctx.lineTo(-wst * 0.5, tH * 0.04); ctx.quadraticCurveTo(-bw * 0.52, -tH * 0.5, -bw * 0.5, -tH * 0.96); ctx.closePath();
  ctx.fillStyle = kit.jersey; ctx.fill();
  ctx.lineWidth = Math.max(0.8, s * 0.035); ctx.strokeStyle = kit.outline; ctx.stroke();
  // shorts waistband + side panel
  ctx.fillStyle = kit.shorts; ctx.fillRect(-wst * 0.5, -tH * 0.06, wst, tH * 0.12 + lw * 0.3);
  ctx.fillStyle = kit.trim; ctx.fillRect(-wst * 0.5, -tH * 0.12, wst, Math.max(1, tH * 0.07));
  if (detail) { ctx.fillStyle = kit.jerseySh; ctx.beginPath(); ctx.moveTo(-bw * 0.5, -tH * 0.94); ctx.lineTo(-bw * 0.3, -tH * 0.96); ctx.lineTo(-wst * 0.3, -tH * 0.12); ctx.lineTo(-wst * 0.5, -tH * 0.12); ctx.closePath(); ctx.fill(); }
  if (keeper) { ctx.fillStyle = kit.trim; ctx.fillRect(-bw * 0.47, -tH * 0.36, bw * 0.94, Math.max(1.2, tH * 0.08)); }
  // chest strike panel + jersey number
  const fs = Math.max(6, Math.round(Math.min(bw * 0.52, tH * 0.5)));
  if (detail) { ctx.fillStyle = rgba(kit.num.startsWith('rgb') || kit.num[0] === '#' ? kit.num : '#ffffff', 0.16); roundRect(ctx, -bw * 0.3, -tH * 0.86, bw * 0.66, tH * 0.48, bw * 0.08); ctx.fill(); }
  ctx.save(); ctx.translate(bw * 0.03, -tH * 0.6); if (pose.facingLeft) ctx.scale(-1, 1);
  ctx.font = numFont(fs); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (fs >= 8) { ctx.lineWidth = Math.max(1.4, fs * 0.2); ctx.strokeStyle = kit.numStroke; ctx.strokeText(String(f.jersey), 0, 0); }
  ctx.fillStyle = kit.num; ctx.fillText(String(f.jersey), 0, 0);
  ctx.restore();
  // low-profile shoulder pads
  if (!archer) {
    ctx.fillStyle = kit.pad;
    ctx.beginPath(); ctx.ellipse(-bw * 0.4, -tH * 0.97, bw * 0.24, tH * 0.11, -0.15, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bw * 0.4, -tH * 0.97, bw * 0.22, tH * 0.1, 0.15, 0, 7); ctx.fill();
    if (detail) { ctx.strokeStyle = kit.trim; ctx.lineWidth = Math.max(0.8, tH * 0.025); ctx.beginPath(); ctx.ellipse(-bw * 0.4, -tH * 0.97, bw * 0.24, tH * 0.11, -0.15, Math.PI, Math.PI * 2); ctx.stroke(); }
  }
  // neck + head
  ctx.fillStyle = skinSh; ctx.fillRect(-hr * 0.3, -tH - hr * 0.42, hr * 0.75, hr * 0.5);
  ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(hr * 0.12, headY + hr * 0.12, hr * 0.84, hr * 0.94, 0, 0, 7); ctx.fill();
  if (detail) {
    // hair at the nape (short / fade), facial hair, eye
    ctx.fillStyle = HAIR;
    if (f.hair === 1) ctx.fillRect(-hr * 0.72, headY + hr * 0.3, hr * 0.42, hr * 0.5);
    else if (f.hair === 0) ctx.fillRect(-hr * 0.72, headY + hr * 0.3, hr * 0.3, hr * 0.3);
    if (f.face === 1) { ctx.beginPath(); ctx.ellipse(hr * 0.62, headY + hr * 0.86, hr * 0.26, hr * 0.2, 0, 0, 7); ctx.fill(); }
    else if (f.face === 3) { ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(hr * 0.38, headY + hr * 0.72, hr * 0.56, hr * 0.36, 0.2, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    else if (f.face === 2) ctx.fillRect(hr * 0.5, headY + hr * 0.52, hr * 0.42, hr * 0.12);
    ctx.fillStyle = '#f2ece2'; ctx.beginPath(); ctx.arc(hr * 0.55, headY + hr * 0.08, hr * 0.14, 0, 7); ctx.fill();
    ctx.fillStyle = '#1c120c'; ctx.beginPath(); ctx.arc(hr * 0.6, headY + hr * 0.08, hr * 0.08, 0, 7); ctx.fill();
  }
  // compact padded helmet: shell over the crown and back, ear guard, clear visor
  ctx.fillStyle = kit.helm;
  ctx.beginPath(); ctx.ellipse(-hr * 0.02, headY - hr * 0.1, hr * 1.06, hr * 0.98, 0, Math.PI * 0.86, Math.PI * 2.02); ctx.lineTo(hr * 0.2, headY - hr * 0.05); ctx.lineTo(-hr * 0.3, headY + hr * 0.62); ctx.lineTo(-hr * 0.95, headY + hr * 0.4); ctx.closePath(); ctx.fill();
  if (detail) {
    ctx.strokeStyle = kit.helmSh; ctx.lineWidth = Math.max(0.7, hr * 0.1); ctx.stroke();
    // tribe marking on the shell
    ctx.strokeStyle = kit.accent; ctx.fillStyle = kit.accent; ctx.lineWidth = Math.max(1, hr * 0.2); ctx.lineCap = 'butt';
    const t = f.tribe;
    ctx.beginPath();
    if (t === 0) { ctx.ellipse(-hr * 0.02, headY - hr * 0.1, hr * 0.84, hr * 0.78, 0, Math.PI * 1.05, Math.PI * 1.9); }
    else if (t === 1) { ctx.moveTo(-hr * 0.8, headY - hr * 0.3); ctx.lineTo(hr * 0.1, headY - hr * 1.02); ctx.moveTo(-hr * 0.5, headY - hr * 0.1); ctx.lineTo(hr * 0.4, headY - hr * 0.86); }
    else if (t === 2) { ctx.moveTo(-hr * 0.7, headY - hr * 0.7); ctx.lineTo(-hr * 0.2, headY - hr * 0.35); ctx.lineTo(hr * 0.3, headY - hr * 0.95); }
    else if (t === 3) { ctx.moveTo(-hr * 0.95, headY - hr * 0.25); ctx.lineTo(hr * 0.2, headY - hr * 0.25); }
    else if (t === 4) { ctx.moveTo(-hr * 0.1, headY - hr * 1.06); ctx.lineTo(-hr * 0.3, headY - hr * 0.2); }
    else if (t === 5) { ctx.moveTo(-hr * 0.9, headY - hr * 0.55); ctx.lineTo(-hr * 0.5, headY - hr * 0.55); ctx.moveTo(-hr * 0.25, headY - hr * 0.55); ctx.lineTo(hr * 0.2, headY - hr * 0.55); }
    else { ctx.arc(-hr * 0.35, headY - hr * 0.45, hr * 0.22, 0, 7); }
    ctx.stroke(); ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(190,232,255,0.34)'; ctx.strokeStyle = 'rgba(235,250,255,0.9)'; ctx.lineWidth = Math.max(0.7, hr * 0.09);
    ctx.beginPath(); ctx.ellipse(hr * 0.52, headY + hr * 0.1, hr * 0.56, hr * 0.5, 0, -1.45, 1.25); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = kit.helmSh; ctx.lineWidth = Math.max(0.8, hr * 0.14);                       // chin guard
    ctx.beginPath(); ctx.moveTo(-hr * 0.3, headY + hr * 0.6); ctx.lineTo(hr * 0.75, headY + hr * 0.95); ctx.stroke();
  }
  // status lights on the shell: red = frozen / recovering, amber = immune
  const lr = Math.max(1.3, hr * 0.2);
  if (f.redLight) { ctx.fillStyle = 'rgba(255,40,40,0.35)'; ctx.beginPath(); ctx.arc(-hr * 0.55, headY - hr * 0.95, lr * 2.2, 0, 7); ctx.fill(); }
  ctx.fillStyle = f.redLight ? '#ff3030' : '#4a1414'; ctx.beginPath(); ctx.arc(-hr * 0.55, headY - hr * 0.95, lr, 0, 7); ctx.fill();
  if (f.immune) { ctx.fillStyle = 'rgba(255,176,0,0.35)'; ctx.beginPath(); ctx.arc(hr * 0.1, headY - hr * 1.12, lr * 2.2, 0, 7); ctx.fill(); }
  ctx.fillStyle = f.immune ? '#ffb000' : '#4a3608'; ctx.beginPath(); ctx.arc(hr * 0.1, headY - hr * 1.12, lr, 0, 7); ctx.fill();
  // near arm (+ bow for the Archer, held in the far hand)
  if (archer) {
    const bx = farHand[0], by = farHand[1], br = tH * 0.78, pull = anim === 'shoot' ? (1 - k) * br * 0.55 : 0;
    ctx.strokeStyle = '#e4d3a8'; ctx.lineWidth = Math.max(1.4, s * 0.06);
    ctx.beginPath(); ctx.moveTo(bx - br * 0.18, by - br); ctx.quadraticCurveTo(bx + br * 0.5, by, bx - br * 0.18, by + br); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = Math.max(0.7, s * 0.02);
    ctx.beginPath(); ctx.moveTo(bx - br * 0.18, by - br); ctx.lineTo(bx - br * 0.18 - pull, by); ctx.lineTo(bx - br * 0.18, by + br); ctx.stroke();
    if (anim === 'shoot' && k < 0.5) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, s * 0.035); ctx.beginPath(); ctx.moveTo(bx - br * 0.18 - pull, by); ctx.lineTo(bx + br * 0.75 - pull, by); ctx.stroke(); }
  }
  arm(nC, nD, -bw * 0.34, false);
  ctx.restore();
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function animFor(a: Athlete, _holder: boolean): string {
  if (a.groundedT > 0) return 'tackled';
  if (a.frozenT > 0) return 'frozen';
  if (a.injured) return 'injured';
  if (a.celebrateT > 0) return 'celebrate';
  if (a.act === 'tackle') return 'tackle';
  if (a.act === 'throw') return a.role === 'archer' ? 'shoot' : 'throw';
  if (a.act === 'catch') return 'catch';
  if (a.role === 'archer') return 'idle';
  const sp = Math.hypot(a.vx, a.vy);
  if (sp > a.a.top * 0.72) return 'sprint';
  if (sp > 1) return 'run';
  return 'idle';
}

/** Back-compat wrapper: draw an engine athlete. */
export function drawAthlete(ctx: CanvasRenderingContext2D, a: Athlete, col: TeamColors, sx: number, sy: number, s: number, pose: Pose) {
  drawFigure(ctx, specOf(a), col, sx, sy, s, pose);
}
