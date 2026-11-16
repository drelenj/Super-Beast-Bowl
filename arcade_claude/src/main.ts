import { Engine } from './engine/engine';
import { TEAMS, COLORS, teamByName, defaultSettings } from './engine/match';
import { DT } from './engine/constants';
import { Intent, NO_INTENT, Settings } from './engine/types';
import { Renderer, fmtClock } from './render';
import { touch, consumeTouchEdges, detectTouch, initTouch } from './touch';
import { ballTraj, interceptAt, REACH } from './engine/intercept';
import { audio } from './audio';
import { crestDataUrl, inkFor } from './ui/crest';
import { introHtml, statsTable, matchStatsTable, topTable } from './ui/cards';
import { rosterHtml, playerHtml, findPlayer, downloadTechExport } from './ui/roster';
import { tutorialCards, tutorialDone, markTutorialDone } from './ui/tutorial';
for (const t of ['pointerdown', 'keydown'] as const) window.addEventListener(t, () => audio.unlock(), { once: true });

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const R = new Renderer(ctx);
const crest = (franchise: string, size: number) => crestDataUrl(COLORS[franchise], size);
const urlQ = new URLSearchParams(location.search);
const q = urlQ;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

type Mode = 'hva' | 'ava' | 'hvh';
type Diff = 'rookie' | 'pro' | 'legend';
const app = {
  engine: null as Engine | null, mode: 'hva' as Mode, home: 'Ala Marauders', away: 'Xenar Ignite',
  settings: defaultSettings(), pick: 0 as 0 | 1, speed: 1, paused: false, hold: false, acc: 0, wallT: 0, lastEv: 0, flashShown: '',
  difficulty: 'pro' as Diff,
};
(window as any).__arcade = app;
(window as any).__arcadeTouch = touch; // read-only test hook (tests/touch_check.cjs)

function resize() { R.dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.round(window.innerWidth * R.dpr); canvas.height = Math.round(window.innerHeight * R.dpr); }
window.addEventListener('resize', resize); resize();

function show(id: string | null) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
}
const screenOn = (id: string) => $(id).classList.contains('on');

// ---------------- mute ----------------
function refreshMute() { document.querySelectorAll('button.mute').forEach((b) => { b.classList.toggle('off', !!audio.muted); b.setAttribute('aria-pressed', String(!!audio.muted)); }); }
function toggleMute() { audio.toggle(); try { localStorage.setItem('sbb_muted', audio.muted ? '1' : '0'); } catch { /* ignore */ } refreshMute(); }
try { if (localStorage.getItem('sbb_muted') === '1') audio.setMuted(true); } catch { /* ignore */ }
for (const id of ['mMute', 'pMute', 'hMute']) $(id).onclick = (ev) => { ev.stopPropagation(); toggleMute(); (ev.currentTarget as HTMLElement).blur(); };
refreshMute();

// ---------------- team select ----------------
const grid = $('teamGrid');
for (const t of TEAMS) {
  const c = COLORS[t.franchise];
  const d = document.createElement('div'); d.className = 'team'; d.dataset.name = t.franchise; d.title = `${t.franchise} (${t.formation})`;
  d.innerHTML = `<img src="${crestDataUrl(c, 96)}" alt="${c.abbr}" /><span style="color:${inkFor(c)};text-shadow:0 0 2px #000">${c.abbr}</span>`;
  d.addEventListener('click', (ev) => { if (ev.shiftKey || app.pick === 1) app.away = t.franchise; else app.home = t.franchise; refreshSelect(); });
  d.addEventListener('contextmenu', (ev) => { ev.preventDefault(); app.away = t.franchise; refreshSelect(); });
  grid.appendChild(d);
}
function setPick(p: 0 | 1) { app.pick = p; $('pickH').classList.toggle('on', p === 0); $('pickA').classList.toggle('on', p === 1); }
$('pickH').onclick = () => setPick(0); $('pickA').onclick = () => setPick(1);
($('selL0') as HTMLElement).onclick = () => setPick(0); ($('selL1') as HTMLElement).onclick = () => setPick(1);
function refreshSelect() {
  grid.querySelectorAll('.team').forEach((el) => { const n = (el as HTMLElement).dataset.name; el.classList.toggle('selH', n === app.home); el.classList.toggle('selA', n === app.away); });
  ($('selL0') as HTMLImageElement).src = crest(app.home, 256); $('selN0').textContent = app.home;
  ($('selL1') as HTMLImageElement).src = crest(app.away, 256); $('selN1').textContent = app.away;
}
function openSelect(mode: Mode) { app.mode = mode; ($('optMode') as HTMLSelectElement).value = mode; refreshSelect(); show('scrSelect'); }
$('mPlay').onclick = () => openSelect('hva');
$('mWatch').onclick = () => openSelect('ava');
$('mHvH').onclick = () => openSelect('hvh');
let controlsReturn = 'scrMenu';
$('mControls').onclick = () => { controlsReturn = 'scrMenu'; show('scrControls'); };
$('ctrlBack').onclick = () => show(controlsReturn);
$('selBack').onclick = () => show('scrMenu');
$('selStart').onclick = () => {
  app.mode = ($('optMode') as HTMLSelectElement).value as Mode;
  app.difficulty = (($('optDiff') as HTMLSelectElement).value || 'pro') as Diff;
  const pl = Number(($('optClock') as HTMLSelectElement).value);
  app.settings = { ...defaultSettings(Number(($('optSeed') as HTMLInputElement).value) || 1), scoring: ($('optScoring') as HTMLSelectElement).value as Settings['scoring'], periodLen: pl, otLen: pl === 600 ? 300 : pl / 2, difficulty: app.difficulty };
  startMatch(true);
};

// ---------------- rosters / player details ----------------
let rosterReturn = 'scrMenu', playerReturn = 'scrRoster', rosterIdx = 0;
const roTeam = $('roTeam') as HTMLSelectElement;
roTeam.innerHTML = TEAMS.map((t, i) => `<option value="${i}">${esc(t.franchise)}</option>`).join('');
function openRoster(franchise: string, ret: string) {
  rosterReturn = ret; rosterIdx = Math.max(0, TEAMS.findIndex((t) => t.franchise === franchise)); renderRoster(); show('scrRoster');
}
function renderRoster() { roTeam.value = String(rosterIdx); $('roBody').innerHTML = rosterHtml(TEAMS[rosterIdx]); $('scrRoster').scrollTop = 0; }
function openPlayer(id: string, ret: string) {
  const f = findPlayer(id); if (!f) return;
  playerReturn = ret; $('plBody').innerHTML = playerHtml(f.p, f.t); show('scrPlayer'); $('scrPlayer').scrollTop = 0;
}
roTeam.onchange = () => { rosterIdx = Number(roTeam.value); renderRoster(); };
$('roPrev').onclick = () => { rosterIdx = (rosterIdx + TEAMS.length - 1) % TEAMS.length; renderRoster(); };
$('roNext').onclick = () => { rosterIdx = (rosterIdx + 1) % TEAMS.length; renderRoster(); };
$('roBack').onclick = () => show(rosterReturn);
$('plBack').onclick = () => show(playerReturn);
$('roExport').onclick = () => downloadTechExport();
$('mRosters').onclick = () => openRoster(app.home, 'scrMenu');
$('selRosters').onclick = () => openRoster(app.pick === 1 ? app.away : app.home, 'scrSelect');
const rowPid = (ev: Event) => ((ev.target as HTMLElement).closest('tr.prow') as HTMLElement | null)?.dataset.pid;
$('roBody').addEventListener('click', (ev) => { const id = rowPid(ev); if (id) openPlayer(id, 'scrRoster'); });
$('fiTop').addEventListener('click', (ev) => { const id = rowPid(ev); if (id) openPlayer(id, 'scrFinal'); });
$('brTop').addEventListener('click', (ev) => { const id = rowPid(ev); if (id) openPlayer(id, 'scrBreak'); });

// ---------------- tutorial ----------------
let tutI = 0, tutDoneCb: (() => void) | null = null;
function renderTut() {
  const cards = tutorialCards(touch.enabled); const c = cards[tutI];
  $('tutStep').textContent = `HOW TO PLAY ${tutI + 1} / ${cards.length}`; $('tutTitle').textContent = c.title; $('tutText').innerHTML = c.body;
  $('tutDots').innerHTML = cards.map((_, i) => `<i class="${i === tutI ? 'on' : ''}"></i>`).join('');
  $('tutNext').textContent = tutI === cards.length - 1 ? 'Got it' : 'Next'; ($('tutPrev') as HTMLButtonElement).disabled = tutI === 0;
}
function openTutorial(done: () => void) { tutI = 0; tutDoneCb = done; renderTut(); show('scrTut'); }
function closeTutorial() { markTutorialDone(); const cb = tutDoneCb; tutDoneCb = null; cb?.(); }
$('tutNext').onclick = () => { if (tutI >= tutorialCards(touch.enabled).length - 1) closeTutorial(); else { tutI++; renderTut(); } };
$('tutPrev').onclick = () => { if (tutI > 0) { tutI--; renderTut(); } };
$('tutSkip').onclick = closeTutorial;
$('mHow').onclick = () => openTutorial(() => show('scrMenu'));
$('pHow').onclick = () => openTutorial(() => show('scrPause'));

// ---------------- match start / intro ----------------
let introTimer = 0;
function startMatch(withIntro = false) {
  const human: [boolean, boolean] = app.mode === 'hva' ? [true, false] : app.mode === 'hvh' ? [true, true] : [false, false];
  app.engine = new Engine(teamByName(app.home), teamByName(app.away), { ...app.settings, difficulty: app.settings.difficulty ?? app.difficulty }, human);
  const e = app.engine;
  app.acc = 0; app.paused = false; app.hold = false; app.lastEv = 0; app.speed = 1; setSpeed(1);
  lastHolder = -2; calloutT = 0;
  R.cam.mode = 'ball'; R.cam.follow = -1; ($('specCam') as HTMLButtonElement).textContent = 'Cam: Ball';
  for (const t of [0, 1]) {
    const c = COLORS[[app.home, app.away][t]];
    ($(`hl${t}`) as HTMLImageElement).src = crestDataUrl(c, 96); $(`hn${t}`).textContent = c.abbr;
    $(`hcb${t}`).style.background = c.primary; $(`hs${t}`).style.borderBottom = `4px solid ${c.secondary}`;
    $(`hTO${t}`).style.display = human[t] ? '' : 'none'; $(`pTO${t}`).style.display = human[t] ? '' : 'none';
    $(`hTO${t}`).textContent = app.mode === 'hvh' ? `T.O. ${c.abbr}` : 'T.O.';
    $(`arch${t}`).style.borderColor = c.primary;
  }
  $('hud').classList.add('on'); $('ticker').style.display = 'block'; $('help').style.display = 'block'; document.body.classList.add('playing');
  $('spec').style.display = app.mode === 'ava' ? 'block' : 'none';
  document.body.classList.toggle('spectate', app.mode === 'ava');
  document.body.classList.toggle('hvh', app.mode === 'hvh');
  $('help').innerHTML = app.mode === 'ava' ? 'Spectator · <b>1-4</b> speed · <b>C</b> camera · <b>N</b> next athlete · <b>M</b> mute · <b>Esc</b> pause'
    : '<b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> pass/snap · <b>J</b> tackle · <b>K</b> switch · <b>L</b> shoot · <b>E</b> archer · <b>T</b> timeout · <b>Esc</b> pause';
  show(null);
  if (!withIntro) return;
  const intro = () => {
    app.hold = true;
    $('introBody').innerHTML = introHtml(e, app.mode === 'ava' ? 'AI vs AI' : app.mode === 'hvh' ? 'Human vs Human' : 'Human vs AI');
    show('scrIntro'); clearTimeout(introTimer); introTimer = window.setTimeout(dismissIntro, 3200);
  };
  if (app.mode !== 'ava' && !q.get('auto') && !tutorialDone()) { app.hold = true; openTutorial(intro); } else intro();
}
function dismissIntro() { clearTimeout(introTimer); if (!screenOn('scrIntro')) return; app.hold = false; show(null); }
$('scrIntro').addEventListener('pointerdown', (ev) => { ev.preventDefault(); dismissIntro(); });

// ---------------- pause / break / final ----------------
function pause(on: boolean) {
  if (!app.engine || app.hold) return;
  app.paused = on; if (on) refreshTimeoutButtons(app.engine); show(on ? 'scrPause' : null); ($('specPause') as HTMLButtonElement).textContent = on ? 'Resume' : 'Pause';
}
const canPauseNow = () => !!app.engine && app.engine.phase !== 'final' && app.engine.phase !== 'break';
$('pResume').onclick = () => pause(false);
$('hPause').onclick = () => { if (canPauseNow()) pause(!app.paused); };
touch.enabled = detectTouch(urlQ.get('touch') === '1');
const setTouchUi = () => document.body.classList.toggle('touch', touch.enabled);
setTouchUi();
initTouch({ onPause: () => { if (canPauseNow()) pause(!app.paused); }, onFirstTouch: () => { if (!touch.enabled) { touch.enabled = true; setTouchUi(); } } });
// a first touch on a hybrid device (e.g. touchscreen laptop) also turns the touch UI on
window.addEventListener('touchstart', () => { if (!touch.enabled) { touch.enabled = true; setTouchUi(); } }, { passive: true, once: true });
$('pRestart').onclick = () => startMatch();
$('pControls').onclick = () => { controlsReturn = 'scrPause'; show('scrControls'); };
$('pMenu').onclick = toMenu;
$('fiMenu').onclick = toMenu;
$('fiRematch').onclick = () => startMatch();
$('brSkip').onclick = () => { app.engine?.resumeFromBreak(); show(null); };
function toMenu() { app.engine = null; app.hold = false; app.paused = false; document.body.classList.remove('playing'); $('hud').classList.remove('on'); $('ticker').style.display = 'none'; $('help').style.display = 'none'; $('spec').style.display = 'none'; show('scrMenu'); }

// ---------------- timeouts ----------------
function canTimeout(e: Engine, team: number): boolean {
  const x = e as any;
  if (!e.teams[team]?.human || typeof x.callTimeout !== 'function') return false;
  if (typeof x.canTimeout === 'function') { try { return !!x.canTimeout(team); } catch { return false; } }
  return (x.timeoutsLeft?.[team] ?? 0) > 0;
}
function callTimeout(team: number) {
  const e = app.engine; if (!e || !canTimeout(e, team)) return;
  const ok = (e as any).callTimeout?.(team);
  if (ok && app.paused) pause(false);
}
function refreshTimeoutButtons(e: Engine) {
  for (const t of [0, 1]) {
    const left = (e as any).timeoutsLeft?.[t] ?? 0, ok = canTimeout(e, t);
    ($(`hTO${t}`) as HTMLButtonElement).disabled = !ok; ($(`pTO${t}`) as HTMLButtonElement).disabled = !ok;
    $(`pTO${t}`).textContent = `Timeout ${COLORS[e.teams[t].data.franchise].abbr} (${left} left)`;
    $(`hTO${t}`).title = `Call timeout (${left} left)`;
  }
}
for (const t of [0, 1]) { $(`hTO${t}`).onclick = (ev) => { callTimeout(t); (ev.currentTarget as HTMLElement).blur(); }; $(`pTO${t}`).onclick = () => callTimeout(t); }

function nextLabel(to: number) { return to <= 4 ? 'Period ' + to : to === 5 ? 'Overtime' : 'Sudden death: any score wins'; }
function showBreak(e: Engine) {
  const bi = e.breakInfo!;
  $('brTitle').textContent = bi.label;
  ($('brL0') as HTMLImageElement).src = crest(e.teams[0].data.franchise, 256);
  ($('brL1') as HTMLImageElement).src = crest(e.teams[1].data.franchise, 256);
  $('brScore').textContent = `${e.teams[0].score} - ${e.teams[1].score}`;
  $('brInfo').textContent = `Break ${Math.round(bi.len / 6) / 10} min (skippable). Next: ${nextLabel(bi.to)}. Ends exchanged.`;
  $('brStats').innerHTML = statsTable(e); $('brMatch').innerHTML = matchStatsTable(e); $('brTop').innerHTML = topTable(e, 5);
  show('scrBreak'); $('scrBreak').scrollTop = 0;
}
function showFinal(e: Engine) {
  ($('fiL0') as HTMLImageElement).src = crest(e.teams[0].data.franchise, 256); ($('fiL1') as HTMLImageElement).src = crest(e.teams[1].data.franchise, 256);
  $('fiN0').textContent = e.teams[0].data.franchise; $('fiN1').textContent = e.teams[1].data.franchise;
  $('fiScore').textContent = `${e.teams[0].score} - ${e.teams[1].score}`;
  const how = e.period <= 4 ? 'Regulation' : e.period === 5 ? 'after overtime' : 'in sudden death';
  $('fiInfo').textContent = `${e.winner >= 0 ? e.teams[e.winner].data.franchise + ' win' : 'Draw'} · ${how} · seed ${e.s.seed} · ${e.s.scoring} scoring · AI ${String((e.s as any).difficulty ?? 'pro')} · state ${e.hash()}`;
  $('fiStats').innerHTML = statsTable(e); $('fiMatch').innerHTML = matchStatsTable(e); $('fiTop').innerHTML = topTable(e, 10);
  show('scrFinal'); $('scrFinal').scrollTop = 0;
}

// ---------------- spectator ----------------
function setSpeed(s: number) { app.speed = s; document.querySelectorAll('#spec [data-speed]').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.speed) === s)); }
document.querySelectorAll('#spec [data-speed]').forEach((b) => (b as HTMLElement).onclick = () => setSpeed(Number((b as HTMLElement).dataset.speed)));
$('specPause').onclick = () => pause(!app.paused);
$('specCam').onclick = () => toggleCam();
$('specNext').onclick = () => nextFollow();
function toggleCam() { R.cam.mode = R.cam.mode === 'ball' ? 'athlete' : 'ball'; if (R.cam.mode === 'athlete' && R.cam.follow < 0) nextFollow(); ($('specCam') as HTMLButtonElement).textContent = R.cam.mode === 'ball' ? 'Cam: Ball' : 'Cam: Athlete'; }
function nextFollow() { const e = app.engine; if (!e) return; R.cam.follow = (R.cam.follow + 1) % e.ath.length; if (e.ath[R.cam.follow].role === 'archer') R.cam.follow = (R.cam.follow + 1) % e.ath.length; R.cam.mode = 'athlete'; ($('specCam') as HTMLButtonElement).textContent = 'Cam: Athlete'; }

// ---------------- input (HumanController) ----------------
const keys = new Set<string>();
const pressed = new Set<string>();
window.addEventListener('keydown', (ev) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.code) && app.engine) ev.preventDefault();
  if (screenOn('scrIntro')) { dismissIntro(); ev.preventDefault(); return; }
  if (screenOn('scrTut')) { if (ev.code === 'Escape') closeTutorial(); else if (ev.code === 'Enter' || ev.code === 'Space' || ev.code === 'ArrowRight') { ev.preventDefault(); $('tutNext').click(); } else if (ev.code === 'ArrowLeft') $('tutPrev').click(); return; }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((ev.target as HTMLElement)?.tagName || '');
  if (!keys.has(ev.code)) pressed.add(ev.code);
  keys.add(ev.code);
  if (ev.code === 'KeyM' && !typing && !ev.repeat) toggleMute();
  if (ev.code === 'Escape' && canPauseNow()) pause(!app.paused);
  if (app.engine && !app.paused && !ev.repeat && app.mode !== 'ava') { if (ev.code === 'KeyT') callTimeout(0); if (ev.code === 'Backslash' && app.mode === 'hvh') callTimeout(1); }
  if (app.mode === 'ava' && app.engine) {
    if (ev.code === 'Digit1') setSpeed(1); if (ev.code === 'Digit2') setSpeed(2); if (ev.code === 'Digit3') setSpeed(4); if (ev.code === 'Digit4') setSpeed(8);
    if (ev.code === 'KeyC') toggleCam(); if (ev.code === 'KeyN') nextFollow();
  }
});
window.addEventListener('keyup', (ev) => keys.delete(ev.code));
window.addEventListener('blur', () => keys.clear());

interface Binding { up: string[]; down: string[]; left: string[]; right: string[]; sprint: string[]; pass: string[]; tackle: string[]; sw: string[]; shoot: string[]; fire: string[] }
const P1: Binding = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], sprint: ['ShiftLeft'], pass: ['Space'], tackle: ['KeyJ'], sw: ['KeyK'], shoot: ['KeyL'], fire: ['KeyE'] };
const P1solo: Binding = { ...P1, up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], sprint: ['ShiftLeft', 'ShiftRight'] };
const P2: Binding = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ControlRight'], pass: ['Enter', 'NumpadEnter'], tackle: ['Period'], sw: ['Comma'], shoot: ['Slash'], fire: ['Quote'] };
const padPrev: Record<number, boolean[]> = {};

function readPad(i: number) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && pads[i];
  if (!p) return null;
  const prev = padPrev[i] || [];
  const btn = (k: number) => !!p.buttons[k]?.pressed;
  const edge = (k: number) => btn(k) && !prev[k];
  const res = { mx: Math.abs(p.axes[0]) > 0.2 ? p.axes[0] : 0, my: Math.abs(p.axes[1]) > 0.2 ? p.axes[1] : 0, sprint: btn(5) || btn(7), pass: edge(0), tackle: edge(1), shoot: edge(2), sw: edge(3), fire: edge(4), pause: edge(9), timeout: edge(8) };
  if (btn(12)) res.my = -1; if (btn(13)) res.my = 1; if (btn(14)) res.mx = -1; if (btn(15)) res.mx = 1;
  padPrev[i] = p.buttons.map((b) => b.pressed);
  return res;
}

function humanControl(e: Engine, team: 0 | 1, b: Binding, padIdx: number) {
  const T = e.teams[team];
  const any = (ks: string[]) => ks.some((k) => keys.has(k));
  const hit = (ks: string[]) => ks.some((k) => pressed.has(k));
  const pad = readPad(padIdx);
  if (pad?.pause && e.phase !== 'final') pause(!app.paused);
  if (pad?.timeout) callTimeout(team);
  const tc = team === 0 && touch.enabled ? touch : null;
  let mx = (any(b.right) ? 1 : 0) - (any(b.left) ? 1 : 0), my = (any(b.down) ? 1 : 0) - (any(b.up) ? 1 : 0);
  if (pad && (pad.mx || pad.my)) { mx = pad.mx; my = pad.my; }
  if (tc && (tc.mx || tc.my)) { mx = tc.mx; my = tc.my; }
  // auto selection: carrier when we have the ball; otherwise keep / pick nearest to carrier on possession change
  const holder = e.ball.holder >= 0 ? e.ath[e.ball.holder] : null;
  const fieldMates = e.ath.filter((a) => a.team === team && a.role !== 'archer' && e.active(a));
  const nearestTo = (x: number, y: number) => fieldMates.filter((a) => a.frozenT <= 0).sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0] ?? fieldMates[0];
  const sel = T.selected >= 0 ? e.ath[T.selected] : null;
  const lastPoss = (T as any)._lastPoss;
  if (holder && holder.team === team) T.selected = holder.idx;
  else if (!sel || !e.active(sel) || sel.role === 'archer' || sel.frozenT > 0 || lastPoss !== e.poss) {
    const tgt = holder ?? e.ball; T.selected = nearestTo(tgt.x, tgt.y).idx;
  }
  (T as any)._lastPoss = e.poss;
  // a pass is in flight: take over the athlete who can catch it (our pass -> its receiver; their pass -> our best interceptor)
  const bl = e.ball;
  if (bl.holder < 0 && bl.passId !== (T as any)._seenPass) {
    (T as any)._seenPass = bl.passId;
    const passer = bl.passer >= 0 && !bl.isShot ? e.ath[bl.passer] : null;
    if (passer && passer.team === team && bl.receiver >= 0 && e.active(e.ath[bl.receiver])) T.selected = bl.receiver;
    else if (passer && passer.team !== team) {
      const traj = ballTraj(bl);
      let bestI = -1, bestT = 1e9;
      for (const a of fieldMates) { if (a.frozenT > 0 || a.groundedT > 0) continue; const r = interceptAt(traj, 0, a.x, a.y, a.a.top * 0.85, REACH.field); if (r.t < bestT) { bestT = r.t; bestI = a.idx; } }
      if (bestI >= 0) T.selected = bestI;
    }
  }
  if (hit(b.sw) || pad?.sw || tc?.sw) {
    const others = fieldMates.filter((a) => a.idx !== T.selected && a.frozenT <= 0 && a.role !== 'keeper').sort((p, q) => Math.hypot(p.x - e.ball.x, p.y - e.ball.y) - Math.hypot(q.x - e.ball.x, q.y - e.ball.y));
    if (others[0] && !(holder && holder.team === team)) T.selected = others[0].idx;
  }
  const me = e.ath[T.selected];
  const itBase = { mx, my };
  const it: Intent = { ...NO_INTENT(), mx, my, sprint: any(b.sprint) || !!pad?.sprint || !!tc?.sprintBtn || !!tc?.stickSprint };
  // catch assist: if you are the target of a pass and are not steering, you run onto the ball automatically
  if (!holder && bl.receiver === me.idx && Math.hypot(itBase.mx, itBase.my) < 0.15) {
    const ic = interceptAt(ballTraj(bl), 0, me.x, me.y, me.a.top * 0.85, REACH.field + REACH.intendedBonus);
    const dx = ic.x - me.x, dy = ic.y - me.y, d = Math.hypot(dx, dy);
    if (d > 0.3) { const k = Math.min(1, d / 1.5); it.mx = dx / d * k; it.my = dy / d * k; it.sprint = d > 3; }
  }
  if ((hit(b.pass) || pad?.pass || tc?.pass) && holder === me) {
    // pass to the open teammate closest to the pushed direction (or facing)
    const dir = (mx || my) ? Math.atan2(my, mx) : me.facing;
    let best = -1, bs = -1e9;
    for (const a of fieldMates) {
      if (a.idx === me.idx || a.frozenT > 0 || a.groundedT > 0) continue;
      const dx = a.x - me.x, dy = a.y - me.y, d = Math.hypot(dx, dy);
      if (d < 3 || d > 45) continue;
      const cos = (dx * Math.cos(dir) + dy * Math.sin(dir)) / d;
      const sc = cos * 3 - d * 0.03;
      if (sc > bs) { bs = sc; best = a.idx; }
    }
    it.pass = best;
  }
  if ((hit(b.shoot) || pad?.shoot || tc?.shoot) && holder === me) it.shoot = true;
  if (hit(b.tackle) || pad?.tackle || tc?.tackle) it.tackle = true;
  if (hit(b.fire) || pad?.fire || tc?.fire) {
    const archer = e.ath.find((a) => a.team === team && a.role === 'archer')!;
    const cands = e.ath.filter((o) => e.arrowLegal(archer, o));
    const pick = cands.find((o) => o.idx === e.ball.holder) ?? cands.sort((p, q) => Math.hypot(p.x - e.ball.x, p.y - e.ball.y) - Math.hypot(q.x - e.ball.x, q.y - e.ball.y))[0];
    if (pick) it.fire = pick.idx;
  }
  const prev = e.humanIntent[team];
  if (prev) { if (it.pass < 0) it.pass = prev.pass; it.shoot = it.shoot || prev.shoot; it.tackle = it.tackle || prev.tackle; if (it.fire < 0) it.fire = prev.fire; }
  e.humanIntent[team] = it;
}

// ---------------- HUD ----------------
const hudCache: Record<string, string> = {};
function setTxt(id: string, s: string, html = false) { if (hudCache[id] === s) return; hudCache[id] = s; if (html) $(id).innerHTML = s; else $(id).textContent = s; }
function setCls(id: string, cls: string, on: boolean) { const k = id + '.' + cls; const v = on ? '1' : '0'; if (hudCache[k] === v) return; hudCache[k] = v; $(id).classList.toggle(cls, on); }
const RING_C = 2 * Math.PI * 19;
let lastHolder = -2, calloutT = 0, calloutHtml = '', calloutCol = '#fff';
function archerState(e: Engine, team: number) {
  const T = e.teams[team];
  const archer = e.ath.find((a) => a.team === team && a.role === 'archer');
  let legal = false;
  if (archer) { try { legal = e.ath.some((o) => o.team !== team && e.arrowLegal(archer, o)); } catch { legal = false; } }
  const quota = T.arrowsLeft > 0 && T.freezesLeft > 0;
  return { legal, quota };
}
function hud(e: Engine, dtReal: number) {
  for (const t of [0, 1]) {
    const T = e.teams[t];
    setTxt(`hsc${t}`, String(T.score));
    setTxt(`ha${t}`, `ARROWS ${T.arrowsLeft}/15 · FREEZE ${T.freezesLeft}/5`);
    ($(`hp${t}`) as HTMLElement).style.visibility = e.poss === t ? 'visible' : 'hidden';
    // Archer HUD chip for human teams
    if (T.human) {
      const s = archerState(e, t);
      const msg = !s.quota ? (T.arrowsLeft <= 0 ? 'OUT OF ARROWS' : 'FREEZE QUOTA USED') : s.legal ? 'TARGET IN ZONE' : 'NO LEGAL TARGET';
      setTxt(`arch${t}`, `ARCHER ${T.arrowsLeft} arrows · ${T.freezesLeft} freezes · <b>${msg}</b>`, true);
      setCls(`arch${t}`, 'on', true); setCls(`arch${t}`, 'ok', s.quota && s.legal); setCls(`arch${t}`, 'no', !(s.quota && s.legal));
      if (t === 0) setCls('tFire', 'dim', !(s.quota && s.legal));
    } else setCls(`arch${t}`, 'on', false);
  }
  setTxt('hper', e.period <= 4 ? `PERIOD ${e.period}` : e.period === 5 ? 'OVERTIME' : 'SUDDEN DEATH');
  setTxt('hclk', e.suddenDeath ? 'SD' : fmtClock(Math.ceil(e.clock)));
  const phaseLbl = e.phase === 'snap' ? 'SNAP' : e.huntActive ? 'FIRST HUNT' : e.phase === 'live' ? 'LIVE' : e.phase === 'set' ? 'SET' : e.phase === 'dead' ? 'DEAD BALL' : '';
  setTxt('hplay', `${phaseLbl}${e.s.periodLen !== 600 ? ' · ACCEL' : ''}`);
  // play-clock ring (30 s, red under 8 s); shows the 10 s snap countdown in the snap phase
  const snap = e.phase === 'snap';
  const val = snap ? Math.max(0, e.snapT) : Math.max(0, e.playClock), full = snap ? 10 : 30;
  setTxt('pcNum', String(Math.ceil(val))); setTxt('pcLab', snap ? 'SNAP' : 'PLAY');
  const off = (RING_C * (1 - Math.max(0, Math.min(1, val / full)))).toFixed(1);
  if (hudCache.pcArc !== off) { hudCache.pcArc = off; $('pcArc').setAttribute('stroke-dashoffset', off); }
  setCls('pcRing', 'red', !snap && val < 8); setCls('pcRing', 'snap', snap);
  setCls('tk0', 'on', e.tackleCount >= 1); setCls('tk1', 'on', e.tackleCount >= 2);
  // referee banner
  const w = (e as any).whistle as { t: number; kind: string; title: string; detail: string; team: number; who: number } | null | undefined;
  if (w && w.t > 0 && e.phase !== 'final') {
    setCls('whistle', 'on', true); setTxt('whTitle', w.title || String(w.kind || '').toUpperCase()); setTxt('whDetail', w.detail || '');
    const col = w.team >= 0 && e.teams[w.team] ? COLORS[e.teams[w.team].data.franchise] : null;
    const bc = col ? col.primary : '#ffffff'; if (hudCache.whCol !== bc) { hudCache.whCol = bc; $('whistle').style.borderColor = bc; $('whTitle').style.color = col ? inkFor(col) : '#fff'; }
  } else setCls('whistle', 'on', false);
  // pass in flight / possession callout
  const bl = e.ball;
  if (bl.holder !== lastHolder) {
    lastHolder = bl.holder;
    const h = bl.holder >= 0 ? e.ath[bl.holder] : null;
    if (h) { const c = COLORS[e.teams[h.team].data.franchise]; calloutT = 2.6; calloutCol = c.primary; calloutHtml = `<span style="color:${inkFor(c)}">${esc(c.abbr)} BALL · #${h.d.jersey} ${esc(h.d.name)} · ${esc(h.d.pos)} · OVR ${h.d.ovr}</span>`; }
  }
  if (calloutT > 0 && !app.paused) calloutT -= dtReal;
  const rc = bl.holder < 0 && bl.receiver >= 0 ? e.ath[bl.receiver] : null;
  if (rc && (e.phase === 'live' || e.phase === 'snap')) {
    const c = COLORS[e.teams[rc.team].data.franchise];
    setTxt('callout', `<span style="color:${inkFor(c)}">PASS &rarr; #${rc.d.jersey} ${esc(rc.d.name.split(' ').slice(-1)[0])}</span>`, true); setCls('callout', 'on', true);
    if (hudCache.coCol !== c.primary) { hudCache.coCol = c.primary; $('callout').style.borderColor = c.primary; }
  } else if (calloutT > 0 && bl.holder >= 0) {
    setTxt('callout', calloutHtml, true); setCls('callout', 'on', true);
    if (hudCache.coCol !== calloutCol) { hudCache.coCol = calloutCol; $('callout').style.borderColor = calloutCol; }
  } else { setCls('callout', 'on', false); setTxt('callout', ''); }
  if ((e.tick & 15) === 0) refreshTimeoutButtons(e);
  const f = $('flash');
  if (e.flash && e.phase !== 'final') { f.style.display = 'block'; setTxt('flash', e.flash.text); f.style.color = e.flash.team >= 0 ? inkFor(COLORS[e.teams[e.flash.team].data.franchise]) : '#fff'; }
  else f.style.display = 'none';
  if (e.events.length !== app.lastEv) {
    app.lastEv = e.events.length;
    const ev = e.events.filter((v) => !['possession', 'shot', 'arrow'].includes(v.type)).slice(-6);
    $('ticker').innerHTML = ev.map((v) => `<div>${v.period <= 4 ? 'P' + v.period : v.period === 5 ? 'OT' : 'SD'} ${fmtClock(v.clock)} · ${esc(v.text)}</div>`).join('');
  }
}

// ---------------- main loop ----------------
let last = performance.now();
function frame(now: number) {
  const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
  app.wallT += dtReal;
  const e = app.engine;
  if (e) {
    if (!app.paused && !app.hold && e.phase !== 'break' && e.phase !== 'final') {
      if (app.mode !== 'ava') {
        humanControl(e, 0, app.mode === 'hvh' ? P1 : P1solo, 0);
        if (app.mode === 'hvh') humanControl(e, 1, P2, 1);
      }
      app.acc += dtReal * app.speed * R.timeScale;
      let n = 0;
      while (app.acc >= DT && n < 1000) {
        e.step(); app.acc -= DT; n++;
        if (n === 1) pressed.clear();
        if ((e.phase as string) === 'break' || (e.phase as string) === 'final') { app.acc = 0; break; }
      }
      if ((e.phase as string) === 'break') { if (q.get('autobreak')) e.resumeFromBreak(); else showBreak(e); }
      if ((e.phase as string) === 'final') showFinal(e);
    }
    R.alpha = Math.max(0, Math.min(1, app.acc / DT));
    R.cam.update(e, canvas.width / R.dpr, canvas.height / R.dpr, dtReal);
    const sel = e.teams.filter((t) => t.human).map((t) => t.selected);
    R.draw(e, [COLORS[e.teams[0].data.franchise], COLORS[e.teams[1].data.franchise]], app.wallT, sel);
    hud(e, dtReal);
  } else {
    R.drawTitle(app.wallT);
  }
  pressed.clear(); consumeTouchEdges();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// URL helpers for testing: ?auto=ava&home=..&away=..&seed=..&speed=..&period=..&difficulty=..&autobreak=1&intro=1
if (q.get('auto')) {
  app.mode = q.get('auto') as Mode; app.home = q.get('home') || app.home; app.away = q.get('away') || app.away;
  const d = q.get('difficulty'); if (d === 'rookie' || d === 'pro' || d === 'legend') app.difficulty = d;
  app.settings = { ...defaultSettings(Number(q.get('seed') || 20261115)), periodLen: Number(q.get('period') || 600), difficulty: app.difficulty };
  if (q.get('scoring') === 'banded') app.settings.scoring = 'banded';
  app.settings.otLen = app.settings.periodLen === 600 ? 300 : app.settings.periodLen / 2;
  // the intro card and the tutorial are skipped for automated runs unless &intro=1 is given
  startMatch(q.get('intro') === '1' && q.get('nointro') !== '1'); if (q.get('speed')) setSpeed(Number(q.get('speed')));
}
