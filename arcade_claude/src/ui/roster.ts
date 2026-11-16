// Roster table, player details card and tech-ratings export.
// Physical ratings are the LOCKED canon values; technical ratings are ARCADE-DERIVED, NOT CANON.
import { TEAMS, COLORS } from '../engine/match';
import { POS_LABEL } from '../engine/data';
import type { PlayerData, TeamData } from '../engine/types';
import { techRatings, TECH_KEYS, TECH_VERSION } from '../ratings/tech';
import { crestDataUrl, inkFor } from './crest';

export const TECH_LABEL = `ARCADE-DERIVED, NOT CANON (${TECH_VERSION})`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
export const ftIn = (inches: number) => { const t = Math.round(inches); return `${Math.floor(t / 12)}'${t % 12}"`; };
const human = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (ch) => ch.toUpperCase());

const PHYS_KEYS = ['speed', 'strength', 'jumping', 'acceleration', 'agility', 'balance', 'throwPower', 'stamina', 'durability'] as const;

export function findPlayer(id: string): { p: PlayerData; t: TeamData } | null {
  for (const t of TEAMS) { const p = t.players.find((x) => x.id === id); if (p) return { p, t }; }
  return null;
}

export function rosterHtml(t: TeamData): string {
  const c = COLORS[t.franchise];
  const order = (p: PlayerData) => (p.role === 'Projected starter' ? 0 : p.role === 'Projected active' ? 1 : 2);
  const ps = [...t.players].sort((a, b) => order(a) - order(b) || b.ovr - a.ovr);
  const avg = (l: PlayerData[]) => (l.length ? (l.reduce((n, p) => n + p.ovr, 0) / l.length).toFixed(1) : '-');
  const head = `<div class="rohead" style="border-color:${c.primary}"><img src="${crestDataUrl(c, 96)}" alt="${esc(c.abbr)}" /><div><div class="tname" style="color:${inkFor(c)}">${esc(t.franchise)}</div>` +
    `<div class="small">Formation ${esc(t.formation)} · ${t.players.length} registered · starter OVR ${avg(ps.filter((p) => order(p) === 0))}</div></div></div>`;
  let last = -1;
  const rows = ps.map((p) => {
    const o = order(p);
    const sep = o !== last ? `<tr class="sep"><td colspan="7">${['Projected starters', 'Projected active', 'Outside projected 25'][o]}</td></tr>` : '';
    last = o;
    return sep + `<tr class="prow" data-pid="${esc(p.id)}" tabindex="0"><td>${p.jersey ?? ''}</td><td>${esc(p.name)}</td><td>${esc(p.pos)}</td><td><b>${p.ovr}</b></td><td>${ftIn(p.heightIn)} · ${p.heightM.toFixed(2)} m</td><td>${Math.round(p.massKg)} kg</td><td>${esc(p.physique)}</td></tr>`;
  }).join('');
  return head + `<div class="tblwrap"><table class="stats roster"><tr><th>#</th><th>Name</th><th>Pos</th><th>OVR</th><th>Height</th><th>Mass</th><th>Physique</th></tr>${rows}</table></div>`;
}

const bar = (label: string, v: number, col: string) =>
  `<div class="bar"><span class="bl">${esc(label)}</span><span class="bt"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${col}"></i></span><span class="bv">${Math.round(v)}</span></div>`;

export function playerHtml(p: PlayerData, t: TeamData): string {
  const c = COLORS[t.franchise];
  const ink = inkFor(c);
  const tech = techRatings(p);
  const phys = p.phys || ({} as PlayerData['phys']);
  return `<div class="pcard" style="border-color:${c.primary}">` +
    `<div class="rohead" style="border-color:${c.primary}"><img src="${crestDataUrl(c, 96)}" alt="${esc(c.abbr)}" /><div>` +
    `<div class="tname" style="color:${ink}">#${p.jersey ?? ''} ${esc(p.name)}</div>` +
    `<div class="small">${esc(POS_LABEL[p.pos] ?? p.pos)} · ${esc(t.franchise)} · ${esc(p.role)}</div>` +
    `<div class="small">Age ${p.age} · ${p.yoe} yrs experience · readiness ${p.readiness} · ${esc(p.development)}</div></div>` +
    `<div class="ovr" style="background:${c.primary};color:${c.number}">${p.ovr}<span>OVR</span></div></div>` +
    `<div class="pcols"><div class="pcol"><h3>Morphology</h3><table class="morph">` +
    `<tr><td>Height</td><td>${ftIn(p.heightIn)} · ${p.heightM.toFixed(2)} m</td></tr>` +
    `<tr><td>Mass</td><td>${Math.round(p.massKg)} kg · ${Math.round(p.massLb)} lb</td></tr>` +
    `<tr><td>Arm span</td><td>${p.armSpanM.toFixed(2)} m</td></tr>` +
    `<tr><td>Standing reach</td><td>${p.reachM.toFixed(2)} m</td></tr>` +
    `<tr><td>Physique</td><td>${esc(p.physique)}</td></tr>` +
    `<tr><td>Ancestry tag</td><td>${esc(p.ancestry)}</td></tr></table>` +
    `<h3 class="canon">LOCKED canon physical ratings</h3>` + PHYS_KEYS.map((k) => bar(human(k), phys[k] ?? 0, '#ffcf3d')).join('') + `</div>` +
    `<div class="pcol"><h3 class="arcade">${esc(TECH_LABEL)}</h3><div class="small" style="margin-bottom:4px">Technical skills generated for this arcade build only. They are not part of the canon and are not simulator evidence.</div>` +
    TECH_KEYS.map((k) => bar(human(k), tech[k], '#4dd2ff')).join('') + `</div></div></div>`;
}

/** All players' tech ratings as a downloadable JSON document (label and version inside). */
export function techExport() {
  const players = TEAMS.flatMap((t) => t.players.map((p) => ({ id: p.id, name: p.name, team: t.franchise, pos: p.pos, ovr: p.ovr, tech: techRatings(p) })));
  return { label: 'ARCADE-DERIVED, NOT CANON', version: TECH_VERSION, note: 'Technical ratings derived for the Super Beast Bowl arcade build. Not canon, not simulator evidence. Physical ratings are locked canon values and are not included here.', keys: TECH_KEYS, count: players.length, players };
}
export function downloadTechExport() {
  const blob = new Blob([JSON.stringify(techExport(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `super_beast_bowl_tech_ratings_${TECH_VERSION}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
