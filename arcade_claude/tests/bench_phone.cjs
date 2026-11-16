// Headless frame benchmark on a "mid phone" profile: 844x390, DPR 3, touch, CPU throttled 4x (Chrome DevTools "mid-tier mobile").
// Reports frame-time percentiles over ~12 s of an AI-vs-AI match. Headless Chromium here renders in software, so this is
// a conservative proxy, not a measurement on a real phone.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:5173/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await ctx.newCDPSession(p);
  await p.goto(BASE + '?auto=ava&seed=9&speed=1&nointro=1&touch=1'); await p.waitForTimeout(2500);
  const run = async (rate) => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    return p.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const t0 = last;
      const f = (now) => { t.push(now - last); last = now; if (now - t0 < 12000) requestAnimationFrame(f); else { t.sort((x, y) => x - y); const q = (k) => +t[Math.floor(t.length * k)].toFixed(1);
        res({ frames: t.length, fps: +(1000 * t.length / (now - t0)).toFixed(1), p50ms: q(0.5), p95ms: q(0.95), p99ms: q(0.99) }); } };
      requestAnimationFrame(f); }));
  };
  const full = await run(1), throttled = await run(4);
  console.log(JSON.stringify({ profile: '844x390 DPR3 touch', noThrottle: full, cpu4xThrottle: throttled, pageErrors: errs.length }));
  await b.close();
})();
