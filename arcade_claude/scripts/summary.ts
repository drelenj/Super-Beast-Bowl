import type { Engine } from '../src/engine/engine';
export function summarize(e: Engine) {
  const m = e.matchStats;
  const cnt = (type: string, team?: number) => e.events.filter((v) => v.type === type && (team === undefined || v.team === team)).length;
  const sum = (ti: number, k: string) => e.squad.filter((a) => a.team === ti).reduce((n, a) => n + (a.stats as unknown as Record<string, number>)[k], 0);
  return {
    home: e.teams[0].data.franchise, away: e.teams[1].data.franchise, seed: e.s.seed, scoring: e.s.scoring, phase: e.phase, period: e.period,
    ticks: e.tick, gameSeconds: +e.time.toFixed(1), score: [e.teams[0].score, e.teams[1].score], winner: e.winner >= 0 ? e.teams[e.winner].data.franchise : 'none',
    hash: e.hash(), eventHash: e.eventHash(), events: e.events.length,
    pointsPlay: m.pointsPlay, pointsAward: m.pointsAward, arrowsLegal: m.arrowsLegal, arrowsIllegal: m.arrowsIllegal, minors: m.minors, majors: m.majors, dqs: m.dqs,
    turnovers: m.turnovers, timeouts: m.timeouts, subs: m.subs, injuries: m.injuries, reviews: m.reviews, possChanges: e.possChanges,
    possSeconds: e.teams.map((t) => +t.possTime.toFixed(0)), breakdown: e.teams.map((t) => t.breakdown),
    perTeam: [0, 1].map((ti) => ({ shots: sum(ti, 'shots'), goals: sum(ti, 'goals'), passAtt: sum(ti, 'passAtt'), passComp: sum(ti, 'passComp'), tackles: sum(ti, 'tackles'), saves: sum(ti, 'saves'),
      interceptions: sum(ti, 'interceptions'), arrowHits: sum(ti, 'arrowHits'), drops: sum(ti, 'drops'), onField: e.ath.filter((a) => a.team === ti && e.active(a)).length })),
    tally: { tossins: cnt('out'), missedSnaps: cnt('missed_snap'), huntRepeats: cnt('hunt_repeat'), dribbles: cnt('dribble'), carryGoals: e.events.filter((v) => v.type === 'score' && v.kind === 'carry').length, ownGoals: e.events.filter((v) => v.type === 'score' && v.kind === 'own').length },
    periodEnds: e.events.filter((v) => v.type === 'period_end').map((v) => v.text),
  };
}
