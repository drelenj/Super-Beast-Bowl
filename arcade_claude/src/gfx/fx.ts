// Lightweight world-space particle effects (dust, impact sparks, ice shards, confetti, rings). Visual only.
export type Proj = (x: number, y: number, z?: number) => [number, number];
interface Part { kind: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; life: number; size: number; col: string; rot: number; vr: number }
const DUST = 0, SPARK = 1, SHARD = 2, CONFETTI = 3, RING = 4;
const MAX = 420;

export class Fx {
  parts: Part[] = [];
  private add(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, col: string) {
    if (this.parts.length >= MAX) this.parts.shift();
    this.parts.push({ kind, x, y, z, vx, vy, vz, t: 0, life, size, col, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14 });
  }
  clear() { this.parts.length = 0; }
  dust(x: number, y: number) { this.add(DUST, x, y, 0.1, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), 0.45, 0.35 + Math.random() * 0.3, 'rgba(225,235,200,'); }
  impact(x: number, y: number, power: number, col: string) {
    const n = Math.min(22, 8 + Math.round(power * 8));
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 4 + Math.random() * 7 * power; this.add(SPARK, x, y, 1 + Math.random(), Math.cos(a) * v, Math.sin(a) * v, 2 + Math.random() * 5, 0.32 + Math.random() * 0.2, 0.5, i % 3 ? '#ffffff' : col); }
    for (let i = 0; i < 6; i++) this.dust(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2);
    this.add(RING, x, y, 0.05, 0, 0, 0, 0.35, 2 + power * 2.5, '#ffffff');
  }
  ice(x: number, y: number, h: number, shatter: boolean) {
    const n = shatter ? 16 : 9;
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = shatter ? 3 + Math.random() * 6 : 1 + Math.random() * 2.5; this.add(SHARD, x, y, Math.random() * h, Math.cos(a) * v, Math.sin(a) * v, 2 + Math.random() * 5, 0.5 + Math.random() * 0.3, 0.22 + Math.random() * 0.3, i % 2 ? '#dff4ff' : '#8fd4ff'); }
    this.add(RING, x, y, 0.05, 0, 0, 0, 0.45, shatter ? 3.5 : 2.5, '#9fe0ff');
  }
  confetti(x: number, y: number, cols: string[], n = 90) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 3 + Math.random() * 11; this.add(CONFETTI, x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 8, 2 + Math.random() * 3, Math.cos(a) * v, Math.sin(a) * v, 8 + Math.random() * 12, 1.6 + Math.random() * 1.2, 0.3 + Math.random() * 0.25, cols[i % cols.length]); }
  }
  ring(x: number, y: number, r: number, col: string) { this.add(RING, x, y, 0.05, 0, 0, 0, 0.4, r, col); }
  update(dt: number) {
    const ps = this.parts; let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]; p.t += dt; if (p.t >= p.life) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.vr * dt;
      if (p.kind === CONFETTI) { p.vz -= 9 * dt; p.vx *= 1 - 1.8 * dt; p.vy *= 1 - 1.8 * dt; if (p.vz < -3.5) p.vz = -3.5; }
      else if (p.kind !== RING && p.kind !== DUST) p.vz -= 16 * dt;
      if (p.z < 0) { p.z = 0; p.vz = 0; p.vx *= 0.5; p.vy *= 0.5; }
      ps[w++] = p;
    }
    ps.length = w;
  }
  draw(ctx: CanvasRenderingContext2D, P: Proj, s: number) {
    for (const p of this.parts) {
      const u = p.t / p.life, [sx, sy] = P(p.x, p.y, p.z);
      if (p.kind === DUST) { ctx.fillStyle = p.col + (0.32 * (1 - u)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(sx, sy, p.size * s * (0.5 + u), 0, 7); ctx.fill(); }
      else if (p.kind === RING) { ctx.globalAlpha = 1 - u; ctx.strokeStyle = p.col; ctx.lineWidth = 3 * (1 - u) + 1; ctx.beginPath(); ctx.ellipse(sx, sy, p.size * s * (0.3 + u), p.size * s * (0.3 + u) * 0.58, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
      else if (p.kind === SPARK) { ctx.globalAlpha = 1 - u; ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - p.vx * 0.03 * s, sy - (p.vy * 0.58 - p.vz * 0.92) * 0.03 * s); ctx.stroke(); ctx.globalAlpha = 1; }
      else {
        const k = p.size * s; ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1; ctx.fillStyle = p.col;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rot);
        if (p.kind === SHARD) { ctx.beginPath(); ctx.moveTo(0, -k); ctx.lineTo(k * 0.5, k * 0.6); ctx.lineTo(-k * 0.45, k * 0.4); ctx.closePath(); ctx.fill(); }
        else ctx.fillRect(-k * 0.5, -k * 0.3 * Math.cos(p.rot * 2), k, k * 0.6 * Math.cos(p.rot * 2));
        ctx.restore(); ctx.globalAlpha = 1;
      }
    }
  }
}
