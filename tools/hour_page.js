// Plays the REAL page (not just core.js) for N hours of game time on a virtual clock: the page's own frame loop, drawing,
// HUD, sheets, modals and saves all run, one 0.1 s frame at a time (the loop's longest step), as fast as the browser can.
// A bot holds the disc 70% of the time with real pointer events, answers every modal like a player, opens Katchin
// Monolith fights with the Monolith button (popping its buffs), Zenkais from the result window, and makes tools/sim.js's
// other choices (upgrades, refining, Z-Fighters, Contracts, cards...) every second. Then it saves, comes back an hour
// later (reload: the save must load and pay out the hour away) and plays 2 more minutes.
// Fails on any page error, console error or blocked script/style (CSP).
// Usage: node tools/hour_page.js <page.html or URL> [hours=1] [outdir]      (needs playwright: NODE_PATH to a copy)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), url = require('url');
const target = process.argv[2] || path.join(__dirname, '..', 'dist', 'idle-app.html');
const HOURS = +process.argv[3] || 1;
const out = process.argv[4] || '.';
const href = /^https?:/.test(target) ? target : url.pathToFileURL(path.resolve(target)).href;

// the bot's choices: aim, needs and decide from tools/sim.js, without its Monolith step (here the bot uses the button)
const sim = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
let botSrc = sim.slice(sim.indexOf('function aim('), sim.indexOf('function maybeZenkai(')).replace(/process\.env\.[A-Z]+/g, 'false');
const cut = botSrc.indexOf('  // Monolith: pop buffs and go');
if (cut < 0) throw new Error('hour_page: sim.js changed shape (no Monolith step in decide)');
botSrc = botSrc.slice(0, cut) + '}\n';
const INIT = `(() => {
  let vt = +(sessionStorage.getItem('__vt') || Date.now()), vp = performance.now();
  Date.now = () => Math.floor(vt);
  performance.now = () => vp;
  const q = [];
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__vstep = (ms) => { vt += ms; vp += ms; const cbs = q.splice(0); for (const cb of cbs) cb(vp); return cbs.length; };
  window.__vsave = (later) => sessionStorage.setItem('__vt', String(vt + (later || 0)));
  window.__mkBot = function (G) { ${botSrc}; return { aim, decide }; };
})();`;

// one call = `frames` frames of 0.1 s; returns a snapshot
function drive(frames) {
  const G = IdleCore, D = window.DBZIdle; // (IdleCore and Render are page-level consts, not window properties)
  const st = window.__st || (window.__st = { bot: window.__mkBot(G), inp: { x: 90, y: 150 }, down: false, hand: 0, decideT: 0, clicks: {}, lastZk: 0 });
  const cv = document.getElementById('field');
  const pe = (type) => {
    const r = cv.getBoundingClientRect(), k = Render.size.scale;
    cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + st.inp.x * k, clientY: r.top + st.inp.y * k }));
  };
  const click = (b) => {
    const h = b.closest('#mBox') ? (b.closest('#mBox').querySelector('h3') || {}).textContent || '' : '';
    const k = b.dataset.act + (h ? ' @ ' + h : '');
    st.clicks[k] = (st.clicks[k] || 0) + 1;
    b.click();
  };
  for (let f = 0; f < frames; f++) {
    const S = D.S, W = D.W, now = Date.now();
    const box = document.getElementById('mBox');
    if (!document.getElementById('modal').hidden) {
      if (st.down) { pe('pointerup'); st.down = false; }
      const pickB = box.querySelector('[data-act="fighter"][data-pick]');
      const start = box.querySelector('[data-act="monoStart"]:not(:disabled)');
      const zk = box.querySelector('[data-act="zenkaiAsk"]');
      if (pickB) click(pickB);
      else if (start) { for (const u of box.querySelectorAll('[data-act="use"]')) click(u); click(box.querySelector('[data-act="monoStart"]')); }
      else if (box.querySelector('[data-act="zenkaiGo"]')) { G.buyZp(S, G.zpMax(S)); st.lastZk = G.zenkaiGain(S); click(box.querySelector('[data-act="zenkaiGo"]')); }
      else if (zk && G.zenkaiGain(S) >= Math.max(10, st.lastZk * 1.2)) click(zk);
      else { const b = box.querySelector('.acts .btn:not(:disabled)') || box.querySelector('.btn:not(:disabled)'); if (b) click(b); }
    } else if (W.mode === 'field' && G.monoReady(S, now) && S.mono.tier < G.TUNE.monoTiers && document.getElementById('sheet').hidden) {
      if (st.down) { pe('pointerup'); st.down = false; }
      click(document.getElementById('monoB'));
    } else {
      st.hand += 0.1;
      const want = W.mode === 'mono' || st.hand % 20 < 14;
      st.bot.aim(S, W, st.inp);
      if (want && !st.down) { pe('pointerdown'); st.down = true; } else if (!want && st.down) { pe('pointerup'); st.down = false; } else if (st.down) pe('pointermove');
    }
    st.decideT += 0.1;
    if (st.decideT >= 1) { st.decideT = 0; st.bot.decide(D.S, D.W, now); }
    window.__vstep(100);
  }
  window.__vsave();
  const S = D.S;
  return { floor: S.floor, best: S.maxFloor, mono: S.mono.tier, level: S.level, zeni: S.zeni, zenkai: S.zenkai.count, mode: D.W.mode, helpers: Object.keys(S.helpers).length, kiPower: S.up.power || 0, clicks: st.clicks };
}

(async () => {
  const b = await chromium.launch({});
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 } });
  await ctx.addInitScript(INIT);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto(href);
  await p.evaluate(() => { localStorage.removeItem('dbzidle.v1'); sessionStorage.removeItem('__vt'); });
  await p.goto(href);
  await p.waitForTimeout(3000); // fonts, sprites, splash
  const t0 = Date.now();
  const mins = Math.round(HOURS * 60);
  let last = null;
  const monoAt = [];
  for (let m = 1; m <= mins; m++) {
    last = await p.evaluate(drive, 600);
    if (monoAt.length < last.mono) monoAt.push(m);
    if (m % 5 === 0 || m === mins) console.log(String(m).padStart(4) + ' min  floor ' + last.floor + ' (best ' + last.best + '), Monoliths ' + last.mono + ', PL ' + last.level + ', Ki Power lv ' + last.kiPower + ', Z-Fighters ' + last.helpers + ', Zenkai x' + last.zenkai + ', Zeni ' + Math.round(last.zeni) + '  [' + Math.round((Date.now() - t0) / 1000) + ' s real]');
    if (errs.length) break;
  }
  console.log('Monolith clears at game minute: ' + (monoAt.join(', ') || 'none'));
  console.log('UI clicks by the bot: ' + JSON.stringify(last.clicks));
  await p.screenshot({ path: path.join(out, 'idle_hour_end.png') });
  // leave, come back an hour later
  const before = await p.evaluate(() => { window.DBZIdle.save(); return { best: window.DBZIdle.S.maxFloor, mono: window.DBZIdle.S.mono.tier, bytes: localStorage.getItem('dbzidle.v1').length }; });
  await p.evaluate(() => window.__vsave(3600 * 1000));
  await p.reload();
  await p.waitForTimeout(3000);
  await p.evaluate(() => window.__vstep(100));
  const back = await p.evaluate(() => ({ best: window.DBZIdle.S.maxFloor, mono: window.DBZIdle.S.mono.tier, modal: document.getElementById('modal').hidden ? '' : document.getElementById('mBox').innerText }));
  await p.screenshot({ path: path.join(out, 'idle_hour_away.png') });
  const okLoad = back.best === before.best && back.mono === before.mono;
  const okAway = /While you were away/i.test(back.modal) && /1h 00m/.test(back.modal);
  console.log((okLoad ? 'ok   ' : 'FAIL ') + 'save loads after the reload (best floor ' + back.best + ', Monoliths ' + back.mono + ', save ' + before.bytes + ' bytes)');
  console.log((okAway ? 'ok   ' : 'FAIL ') + 'an hour away pays out: ' + back.modal.replace(/\s+/g, ' ').slice(0, 300));
  for (let m = 0; m < 2 && !errs.length; m++) last = await p.evaluate(drive, 600);
  console.log('after 2 more minutes: floor ' + last.floor + ', Monoliths ' + last.mono + ', PL ' + last.level);
  console.log(errs.length ? 'ERRORS:\n  ' + errs.slice(0, 20).join('\n  ') : 'no page errors, console errors or blocked scripts');
  await b.close();
  const ok = !errs.length && okLoad && okAway;
  console.log(ok ? 'hour_page OK' : 'hour_page FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
