// Fast headless full-match run of the SAME engine used in the browser.
// Usage: npx tsx scripts/headless.ts [home] [away] [seed] [flat|banded] [periodLen]
import { runHeadless, defaultSettings } from '../src/engine/match';
import { summarize } from './summary';
const [home = 'Ala Marauders', away = 'Xenar Ignite', seedS = '20261115', scoring = 'flat', pl = '600'] = process.argv.slice(2);
const s = defaultSettings(Number(seedS)); s.scoring = scoring as 'flat' | 'banded'; s.periodLen = Number(pl); if (s.periodLen !== 600) s.otLen = s.periodLen / 2;
const t0 = Date.now();
const e = runHeadless(home, away, s);
console.log(JSON.stringify({ ...summarize(e), wallMs: Date.now() - t0 }, null, 1));
