// npm run bench: headless cost of the simulation step (the renderer is measured in the browser smoke/bench run).
// A 60 fps frame has 16.7 ms; a mid-range phone is taken as ~5x slower than this machine for JS.
import { Engine } from '../src/engine/engine';
import { teamByName, defaultSettings } from '../src/engine/match';
const e = new Engine(teamByName('Ala Marauders'), teamByName('Xenar Ignite'), defaultSettings(7));
const N = 60 * 120; const t0 = performance.now(); let worst = 0;
for (let i = 0; i < N; i++) { if (e.phase === 'break') e.resumeFromBreak(); if (e.phase === 'final') break; const a = performance.now(); e.step(); worst = Math.max(worst, performance.now() - a); }
const ms = (performance.now() - t0) / N;
console.log(JSON.stringify({ steps: N, meanMsPerStep: +ms.toFixed(4), worstMsPerStep: +worst.toFixed(3), simBudgetUsedAt60fps_thisMachine: +(100 * ms / 16.67).toFixed(2) + '%', assumedMidPhoneSlowdown: 5, simBudgetUsedAt60fps_midPhone: +(100 * ms * 5 / 16.67).toFixed(2) + '%' }));
