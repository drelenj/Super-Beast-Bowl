// DOM presentation cards: match intro, team stats, match-stats panel, top performers.
import type { Engine } from '../engine/engine';
import { COLORS } from '../engine/match';
import type { Athlete, Stats } from '../engine/types';
import { crestDataUrl, inkFor } from './crest';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const clock = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

/** Every gameday athlete (incl. reserves) when the engine exposes the squad, else the 24 on the field. */
export const squadOf = (e: Engine): Athlete[] => { const s = (e as any).squad as Athlete[] | undefined; return s && s.length ? s : e.ath; };
const colOf = (e: Engine, t: number) => COLORS[e.teams[t].data.franchise];

export function introHtml(e: Engine, modeLabel: string): string {
  const side = (t: number) => {
    const c = colOf(e, t), T = e.teams[t];
    const st = e.ath.filter((a) => a.team === t);
    const avg = st.length ? (st.reduce((n, a) => n + a.d.ovr, 0) / st.length).toFixed(1) : '-';
    const watch = [...st].sort((a, b) => b.d.ovr - a.d.ovr).slice(0, 3);
    return `<div class="iside" style="background:linear-gradient(160deg, ${c.primary}ee, #0b0e16f2 70%);border-color:${c.secondary}">` +
      `<img src="${crestDataUrl(c, 160)}" alt="${esc(c.abbr)}" />` +
      `<div class="iname">${esc(T.data.franchise)}</div>` +
      `<div class="small">${t === 0 ? 'HOME' : 'AWAY'}${T.human ? ' · HUMAN' : ' · AI'} · formation ${esc(T.data.formation)}</div>` +
      `<div class="iovr"><b>${avg}</b> starter OVR</div>` +
      `<div class="iwatch"><div class="small">PLAYERS TO WATCH</div>${watch.map((a) => `<div>#${a.d.jersey} ${esc(a.d.name)} <span>${esc(a.d.pos)} ${a.d.ovr}</span></div>`).join('')}</div></div>`;
  };
  const diff = String((e.s as any).difficulty ?? 'pro').toUpperCase();
  return `<div class="itop">SUPER BEAST BOWL</div><div class="irow">${side(0)}<div class="vs">VS</div>${side(1)}</div>` +
    `<div class="small imeta">${esc(modeLabel)} · ${e.s.scoring} scoring · 4 x ${e.s.periodLen} s · AI ${diff} · seed ${e.s.seed}</div>` +
    `<div class="small ihint">Tap or press any key to start</div>`;
}

export function statsTable(e: Engine): string {
  const A = (t: number) => squadOf(e).filter((a) => a.team === t);
  const sum = (t: number, k: keyof Stats) => A(t).reduce((n, a) => n + a.stats[k], 0);
  const rows: [string, (t: number) => string | number][] = [
    ['Score', (t) => e.teams[t].score],
    ['Thrown goal pts', (t) => e.teams[t].breakdown.thrown], ['Carry goal pts', (t) => e.teams[t].breakdown.carry],
    ['Half-goal / award pts', (t) => e.teams[t].breakdown.half + e.teams[t].breakdown.award], ['Own-goal pts received', (t) => e.teams[t].breakdown.own],
    ['Shots', (t) => e.events.filter((v) => v.type === 'shot' && v.team === t).length],
    ['Passes (comp/att)', (t) => `${sum(t, 'passComp')}/${sum(t, 'passAtt')}`],
    ['Tackles', (t) => sum(t, 'tackles')], ['Interceptions', (t) => sum(t, 'interceptions')],
    ['Keeper saves', (t) => sum(t, 'saves')],
    ['Arrows (hits/shots)', (t) => `${sum(t, 'arrowHits')}/${sum(t, 'arrows')}`],
    ['Possession time', (t) => clock(e.teams[t].possTime)],
  ];
  return teamHead(e) + rows.map(([n, f]) => `<tr><td>${n}</td><td>${f(0)}</td><td>${f(1)}</td></tr>`).join('') + `<tr><td>Possession changes</td><td colspan="2">${e.possChanges}</td></tr>`;
}

const teamHead = (e: Engine) => `<tr><th></th>${[0, 1].map((t) => { const c = colOf(e, t); return `<th style="color:${inkFor(c)}">${esc(c.abbr)}</th>`; }).join('')}</tr>`;

/** Per-match discipline / awards panel from e.matchStats (falls back to athlete stats when the engine has none). */
export function matchStatsTable(e: Engine): string {
  const ms = (e as any).matchStats as Record<string, [number, number]> | undefined;
  const A = (t: number) => squadOf(e).filter((a) => a.team === t);
  const sum = (t: number, k: keyof Stats) => A(t).reduce((n, a) => n + a.stats[k], 0);
  const v = (k: string, fb?: (t: number) => number | string) => (t: number): number | string => ms?.[k]?.[t] ?? (fb ? fb(t) : '-');
  const rows: [string, (t: number) => number | string][] = [
    ['Points from play', v('pointsPlay', (t) => e.teams[t].breakdown.thrown + e.teams[t].breakdown.carry + e.teams[t].breakdown.half)],
    ['Points from penalty awards', v('pointsAward', (t) => e.teams[t].breakdown.award)],
    ['Arrows legal / illegal', (t) => `${v('arrowsLegal', (x) => sum(x, 'arrows'))(t)} / ${v('arrowsIllegal')(t)}`],
    ['Minor fouls', v('minors', (t) => sum(t, 'minors'))],
    ['Major fouls', v('majors', (t) => sum(t, 'majors'))],
    ['Disqualifications', v('dqs', (t) => A(t).filter((a) => a.dq).length)],
    ['Turnovers', v('turnovers', (t) => sum(t, 'turnovers'))],
    ['Timeouts used', v('timeouts')],
    ['Substitutions', v('subs')],
    ['Injuries', v('injuries', (t) => A(t).filter((a) => a.injured).length)],
    ['Reviews', v('reviews')],
  ];
  return teamHead(e) + rows.map(([n, f]) => `<tr><td>${n}</td><td>${f(0)}</td><td>${f(1)}</td></tr>`).join('');
}

export function topTable(e: Engine, n: number): string {
  const score = (a: Athlete) => a.stats.points * 3 + a.stats.tackles + a.stats.saves * 1.5 + a.stats.interceptions * 2 + a.stats.arrowHits * 1.5 + a.stats.passComp * 0.25;
  const top = [...squadOf(e)].sort((a, b) => score(b) - score(a) || b.d.ovr - a.d.ovr).slice(0, n);
  return '<tr><th>Athlete</th><th>Team</th><th>Pos</th><th>OVR</th><th>Pts</th><th>Tkl</th><th>Pass</th><th>Saves</th><th>Arrows</th></tr>' +
    top.map((a) => { const c = colOf(e, a.team); return `<tr class="prow" data-pid="${esc(a.d.id)}" tabindex="0"><td>#${a.d.jersey} ${esc(a.d.name)}</td><td style="color:${inkFor(c)}">${esc(c.abbr)}</td><td>${esc(a.d.pos)}</td><td>${a.d.ovr}</td><td>${a.stats.points}</td><td>${a.stats.tackles}</td><td>${a.stats.passComp}/${a.stats.passAtt}</td><td>${a.stats.saves}</td><td>${a.stats.arrowHits}/${a.stats.arrows}</td></tr>`; }).join('');
}
