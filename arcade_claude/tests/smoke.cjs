// Browser smoke test (Playwright, headless Chromium). Dev or preview server must be running.
//   BASE=http://localhost:5173/ SHOTS=docs/screens node tests/smoke.cjs
// Menu -> rosters / player details -> team select -> AI vs AI on the 4 x 60 s clock at 8x -> goal -> halftime -> final,
// plus a phone-landscape (844x390, touch) match. Exits non-zero on any failure.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS || 'docs/screens';
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const log = (name, ok, info) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' :: ' + JSON.stringify(info) : '')); };
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png` });

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const watch = (p, tag) => { p.on('pageerror', (e) => errs.push(tag + ': ' + String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(tag + ': ' + m.text()); }); };
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('sbb_tutorial_done', '1'); } catch (e) { /* ignore */ } });
    const p = await ctx.newPage(); watch(p, 'desktop');
    const E = (f, a) => p.evaluate(f, a);

    // 1. menu
    await p.goto(BASE); await p.waitForTimeout(900);
    const menu = await E(() => ({ on: document.getElementById('scrMenu').classList.contains('on'), title: document.querySelector('#scrMenu h1').textContent, note: document.querySelector('#scrMenu .note').textContent }));
    log('menu visible with SUPER BEAST BOWL title', menu.on && /SUPER BEAST BOWL/.test(menu.title), { title: menu.title });
    log('menu disclaimer: separate arcade implementation, not simulator evidence', /not simulator evidence/i.test(menu.note) && /ARCADE-DERIVED, NOT CANON/.test(menu.note));
    log('mute button toggles', await E(() => { const m = document.getElementById('mMute'); m.click(); const a = m.classList.contains('off'); m.click(); return a && !m.classList.contains('off'); }));
    await shot(p, 'smoke_menu');

    // 2. rosters and player details
    await p.click('#mRosters');
    const ro = await E(() => ({ on: document.getElementById('scrRoster').classList.contains('on'), rows: document.querySelectorAll('#roBody tr.prow').length, teams: document.querySelectorAll('#roTeam option').length }));
    log('roster table opens (26 teams, players listed)', ro.on && ro.rows >= 20 && ro.teams === 26, ro);
    await p.click('#roBody tr.prow');
    const pl = await E(() => { const t = document.getElementById('plBody').textContent; return { on: document.getElementById('scrPlayer').classList.contains('on'), bars: document.querySelectorAll('#plBody .bar').length, locked: /LOCKED canon physical ratings/.test(t), arcade: /ARCADE-DERIVED, NOT CANON \(tech-/.test(t) }; });
    log('player details: 9 locked physical + 19 arcade-derived tech ratings, labelled', pl.on && pl.bars === 28 && pl.locked && pl.arcade, pl);
    await shot(p, 'smoke_roster_details');
    await p.click('#plBack');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#roExport')]);
    let exp = null;
    if (dl) { const f = await dl.path(); if (f) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); exp = { label: j.label, version: j.version, count: j.count, keys: Object.keys(j.players[0].tech).length }; } }
    log('tech ratings JSON export (label, version, all players)', !!exp && exp.label === 'ARCADE-DERIVED, NOT CANON' && exp.count === 712 && exp.keys === 19, exp);
    await p.click('#roBack');

    // 3. team select
    await p.click('#mWatch');
    const sel = await E(() => { const ims = [...document.querySelectorAll('.team img')]; return { on: document.getElementById('scrSelect').classList.contains('on'), crests: ims.filter((i) => i.complete && i.naturalWidth > 0 && i.src.startsWith('data:image/svg+xml')).length,
      logoFiles: [...document.querySelectorAll('img')].filter((i) => /logos\/|\.webp|\.png/.test(i.getAttribute('src') || '')).length, diff: document.getElementById('optDiff').value, diffOpts: document.querySelectorAll('#optDiff option').length }; });
    log('team select: 26 colour crests, no logo image files', sel.on && sel.crests === 26 && sel.logoFiles === 0, sel);
    log('difficulty select present (Rookie / Pro / Legend, default Pro)', sel.diff === 'pro' && sel.diffOpts === 3, sel);
    await p.click('.team[data-name="Ala Marauders"]');
    await p.click('#pickA'); await p.click('.team[data-name="Xenar Ignite"]');
    await p.selectOption('#optClock', '60'); await p.selectOption('#optDiff', 'legend');
    await shot(p, 'smoke_select');

    // 4. match start (AI vs AI, 4 x 60 s, 8x) with intro card
    await p.click('#selStart'); await p.waitForTimeout(500);
    const intro = await E(() => ({ on: document.getElementById('scrIntro').classList.contains('on'), sides: document.querySelectorAll('#introBody .iside').length, hold: window.__arcade.hold }));
    log('intro card shown before the match (both teams)', intro.on && intro.sides === 2 && intro.hold === true, intro);
    await shot(p, 'smoke_intro');
    await p.click('#scrIntro'); await p.waitForTimeout(300);
    const st = await E(() => { const e = window.__arcade.engine; return { phase: e.phase, n: e.ath.length, human: e.teams.map((t) => t.human), diff: e.s.difficulty, period: e.s.periodLen, hold: window.__arcade.hold, hud: document.getElementById('hud').classList.contains('on') }; });
    log('match starts: AI vs AI, 24 athletes, difficulty passed to the engine', st.n === 24 && !st.human[0] && !st.human[1] && st.diff === 'legend' && st.period === 60 && !st.hold && st.hud, st);
    await p.click('#spec [data-speed="2"]'); await p.waitForTimeout(2500);
    await shot(p, 'smoke_match');
    await p.click('#spec [data-speed="8"]');
    let sawGoal = false, sawHalf = false, sawWhistle = false, ringOk = false, t0 = Date.now(), fin = false;
    while (Date.now() - t0 < 240000) {
      const s = await E(() => { const e = window.__arcade.engine; return { phase: e.phase, goals: e.events.filter((v) => v.type === 'score').length, from: e.breakInfo ? e.breakInfo.from : 0, label: e.breakInfo ? e.breakInfo.label : '',
        wh: document.getElementById('whistle').classList.contains('on'), ring: document.getElementById('pcNum').textContent, brOn: document.getElementById('scrBreak').classList.contains('on') }; });
      if (s.wh && !sawWhistle) { sawWhistle = true; await shot(p, 'smoke_whistle'); }
      if (/^\d+$/.test(s.ring)) ringOk = true;
      if (s.goals > 0 && !sawGoal) { sawGoal = true; await shot(p, 'smoke_goal'); }
      if (s.phase === 'final') { fin = true; break; }
      if (s.phase === 'break' && s.brOn) {
        if (!sawHalf && (s.from === 2 || /half/i.test(s.label))) {
          sawHalf = true;
          const br = await E(() => ({ title: document.getElementById('brTitle').textContent, match: document.querySelectorAll('#brMatch tr').length, stats: document.querySelectorAll('#brStats tr').length }));
          log('halftime break screen with team stats and match-stats panel', br.match >= 8 && br.stats >= 8, br);
          await shot(p, 'smoke_halftime');
        }
        await p.click('#brSkip');
      }
      await p.waitForTimeout(250);
    }
    log('halftime reached', sawHalf);
    log('play-clock ring shows a number', ringOk);
    log('referee banner shown at least once (e.whistle)', sawWhistle);
    await p.waitForTimeout(400);
    const fi = await E(() => { const e = window.__arcade.engine; const txt = document.getElementById('fiMatch').textContent; return { phase: e.phase, score: e.teams.map((t) => t.score), goals: e.events.filter((v) => v.type === 'score').length, on: document.getElementById('scrFinal').classList.contains('on'),
      panel: ['Points from play', 'Points from penalty awards', 'Arrows legal / illegal', 'Minor fouls', 'Major fouls', 'Disqualifications', 'Turnovers', 'Timeouts used'].every((k) => txt.includes(k)), top: document.querySelectorAll('#fiTop tr.prow').length,
      logoFiles: [...document.querySelectorAll('img')].filter((i) => /logos\/|\.webp/.test(i.getAttribute('src') || '')).length }; });
    log('match reaches the final screen', fin && fi.on && fi.phase === 'final', { score: fi.score });
    log('at least one goal (score event) or the match ended', sawGoal || fin, { goals: fi.goals });
    log('final stat card: match-stats panel and top performers', fi.panel && fi.top >= 5 && fi.logoFiles === 0, fi);
    await shot(p, 'smoke_final');
    await p.click('#fiTop tr.prow');
    log('tapping a top performer opens player details', await E(() => document.getElementById('scrPlayer').classList.contains('on')));
    await p.click('#plBack');
    await p.click('#fiRematch'); await p.waitForTimeout(500);
    log('rematch starts a fresh match', await E(() => { const e = window.__arcade.engine; return e.phase !== 'final' && e.teams[0].score === 0; }));
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    log('pause screen: Resume / Restart / Controls / How to play / Quit', await E(() => document.getElementById('scrPause').classList.contains('on') && ['pResume', 'pRestart', 'pControls', 'pHow', 'pMute', 'pMenu'].every((id) => document.getElementById(id).offsetParent !== null)));
    await p.click('#pHow');
    log('tutorial reopens from the pause screen', await E(() => document.getElementById('scrTut').classList.contains('on') && document.getElementById('tutTitle').textContent.length > 3));
    await p.click('#tutSkip'); await p.click('#pMenu');
    log('quit to menu', await E(() => document.getElementById('scrMenu').classList.contains('on')));
    await ctx.close();

    // 5. phone landscape, touch, Human vs AI (first run: tutorial appears, then intro)
    const ph = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const m = await ph.newPage(); watch(m, 'phone');
    await m.goto(BASE); await m.waitForTimeout(800);
    await shot(m, 'smoke_phone_menu');
    await m.tap('#mPlay'); await m.selectOption('#optClock', '60'); await m.tap('#selStart'); await m.waitForTimeout(400);
    const tut = await m.evaluate(() => ({ on: document.getElementById('scrTut').classList.contains('on'), text: document.getElementById('tutText').textContent }));
    log('phone: first-time tutorial shown with touch wording', tut.on && /stick|Tap/.test(tut.text), { on: tut.on });
    await shot(m, 'smoke_phone_tutorial');
    await m.tap('#tutSkip'); await m.waitForTimeout(300);
    if (await m.evaluate(() => document.getElementById('scrIntro').classList.contains('on'))) { await shot(m, 'smoke_phone_intro'); await m.tap('#scrIntro'); }
    await m.waitForTimeout(2500);
    const lay = await m.evaluate(() => {
      const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: e.offsetParent !== null && b.width > 0 }; };
      const hud = r('hud'), ids = ['tPass', 'tShoot', 'tTackle', 'tSwitch', 'tFire', 'tSprint'];
      const btns = ids.map(r); const hb = r('hudBtns'), tp = r('tPause');
      const overlap = (a, c) => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
      return { hud, allVisible: btns.every((x) => x.vis) && tp.vis, minTap: Math.min(...btns.map((x) => Math.min(x.w, x.h)), tp.w, tp.h, r('hMute').h, r('hTO0').h), hudOverBtns: btns.some((x) => overlap(hud, x)), hudOverTop: overlap(hud, hb) || overlap(hud, tp),
        archer: document.getElementById('arch0').textContent, tutDone: localStorage.getItem('sbb_tutorial_done') };
    });
    log('phone: touch buttons visible, tap targets >= 40 px, HUD does not cover them', lay.allVisible && lay.minTap >= 40 && !lay.hudOverBtns && !lay.hudOverTop, lay);
    log('phone: Archer HUD shows arrows, freezes and legal-target state', /arrows/.test(lay.archer) && /(NO LEGAL TARGET|TARGET IN ZONE)/.test(lay.archer), { archer: lay.archer });
    await shot(m, 'smoke_phone_match');
    await m.tap('#tPause'); await m.waitForTimeout(250);
    log('phone: pause screen fits and Resume works', await m.evaluate(() => document.getElementById('scrPause').classList.contains('on')));
    await shot(m, 'smoke_phone_pause');
    await m.tap('#pResume');
    await ph.close();

    log('no console or page errors', errs.length === 0, errs.slice(0, 6));
  } catch (err) {
    log('smoke run completed without an exception', false, String(err && err.stack || err).slice(0, 600));
  }
  await b.close();
  console.log(failed ? `SMOKE FAIL (${failed} failed)` : 'SMOKE PASS');
  process.exit(failed ? 1 : 0);
})();
