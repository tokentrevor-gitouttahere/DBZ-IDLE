// DBZ Idle - the page: HUD, panels, input, save and offline. Rules live in core.js, drawing in render.js.
(() => {
  const G = IdleCore;
  const $ = (s) => document.querySelector(s);
  const fmt = G.fmt;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let S, W, C;
  const input = { down: false, x: 0, y: 0, id: null };
  let lastT = 0, lastWall = Date.now(), saveT = 0, sheet = null, sheetStack = [], lockUntil = 0, sheetSig = '', modalOpen = false;
  const ui = { labRegion: 0, amt: 'max', resetArm: 0, ccTab: 'crew', skill: null, lastLoot: null, monoTab: 'next', zpAmt: '1', cardKind: 'machine', discTab: 'disc' };
  const app = $('#app'), cv = $('#field');

  // ------------------------------------------------------------------ tips: the loading splash and the Zenkai window
  const TIPS = [
    '<b>Z points survive Zenkai. Zeni does not.</b> Right before you Zenkai, go to Capsule Corp, Z-Fighters and exchange ALL your Zeni (MAX) for Z points.',
    'Z points get pricier the more you buy, but the price never resets: every point you buy now makes the next run\'s Z-Fighters stronger.',
    'Forms drain Ki. Save a full Ki bar and transform the moment a Monolith fight starts.',
    'Damage you deal to a Katchin Monolith stays between tries, even through Zenkai. Keep chipping at it.',
    'Double-tap a machine in Bulma\'s Lab to jump to the floor it shows up on most. STAY keeps you there.',
    'Tap Loot Bulma\'s plane when she flies by: prizes, sometimes Rainbow Capsules.',
    'Hold the disc where machines bunch up: one spin saws through all of them.',
    'Krillin\'s Cutting Edge ignores armor. Planet 1 machines have none, but the Monolith and Planet 2 do.',
    'Vegeta\'s blasts double with every Trait level, up to 64 a throw.',
    'Switch between Goku and Vegeta any time in Menu, Options. It only changes the looks.',
    'The Ki Beam (Monolith 9) and forms drink from the same Ki. Beam while transformed for a huge burst, then rest in base form to refill.'
  ];
  // the Zenkai tip comes up a lot more than the rest
  const pickTip = () => (Math.random() < 0.4 ? TIPS[0] : TIPS[1 + Math.floor(Math.random() * (TIPS.length - 1))]);
  const splashAt = Date.now();
  $('#splTip').innerHTML = '<b>TIP:</b> ' + pickTip();
  function hideSplash() {
    const sp = $('#splash');
    if (!sp || sp.classList.contains('out')) return;
    sp.classList.add('out');
    setTimeout(() => sp.remove(), 400);
  }
  $('#splash').addEventListener('click', () => { if (S) hideSplash(); });

  // ------------------------------------------------------------------ save / load (own key: the fight sim's save is never touched)
  function load(now) {
    try { const raw = localStorage.getItem(G.SAVE_KEY); if (raw) return G.migrate(JSON.parse(raw), now); } catch (e) { /* no storage: play without saving */ }
    return null;
  }
  function save() {
    if (!S) return;
    S.lastSave = Date.now();
    try { localStorage.setItem(G.SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ }
  }

  // ------------------------------------------------------------------ boot
  function boot(data) {
    const now = Date.now();
    let fresh = false, away = null;
    S = null;
    try { if (data && data.save) S = G.migrate(JSON.parse(data.save), now); } catch (e) { S = null; }
    if (!S) S = load(now);
    if (S) away = G.offline(S, (now - S.lastSave) / 1000);
    else { S = G.newState(now); fresh = true; }
    W = G.newWorld();
    C = G.calc(S);
    Render.init(cv);
    Render.setReduce(!!S.opt.reduce);
    G.goalsFor(S, now);
    buildCrew();
    buildTechs();
    buildForm();
    paintFace();
    layout();
    window.addEventListener('resize', layout);
    // pick a fighter first (new games, and saves from before fighters existed), then the welcome or the away report
    const next = () => { if (away && away.secs >= 60) showAway(away); else if (fresh) showHelp(true); else closeModal(); };
    if (!S.fighter) showFighterPick(next);
    else next();
    // keep the splash up long enough to read its tip (tap it to skip)
    setTimeout(hideSplash, Math.max(0, 2200 - (Date.now() - splashAt)));
    lastT = performance.now();
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ layout: size the canvas, keep machines clear of the HUD
  function layout() {
    const r = app.getBoundingClientRect();
    Render.resize(r.width, r.height, window.devicePixelRatio || 1);
    const hud = $('#hud').getBoundingClientRect();
    const goal = $('#goal');
    goal.style.top = hud.bottom - r.top + 2 + 'px';
    const gb = goal.getBoundingClientRect();
    $('#barsL').style.top = gb.bottom - r.top + 8 + 'px';
    $('#sideR').style.top = hud.bottom - r.top + 6 + 'px';
    $('#buffs').style.top = gb.bottom - r.top + 6 + 'px';
    $('#monoHud').style.top = hud.bottom - r.top + 2 + 'px';
    const nav = $('#nav').getBoundingClientRect();
    $('#bottom').style.bottom = r.bottom - nav.top + 6 + 'px';
    $('#toast').style.bottom = r.bottom - nav.top + 80 + 'px';
    const sh = $('#sheet');
    sh.style.top = hud.bottom - r.top + 'px';
    sh.style.bottom = r.bottom - nav.top + 'px';
    const bl = $('#barsL').getBoundingClientRect(), sr = $('#sideR').getBoundingClientRect(), bo = $('#bottom').getBoundingClientRect();
    const bottomTop = bo.top - r.top;
    $('#hint').style.top = bottomTop - 22 + 'px';
    const [x0, y0] = Render.toGame(bl.right - r.left + 2, gb.bottom - r.top + 16);
    const [x1, y1] = Render.toGame(sr.left - r.left - 2, bottomTop - 6);
    W.bounds = { x0, y0, x1: Math.max(x0 + 40, x1), y1: Math.max(y0 + 60, y1) };
    const from = {};
    document.querySelectorAll('.cell[data-h]').forEach((el) => {
      const b = el.getBoundingClientRect();
      from[el.dataset.h] = Render.toGame(b.left + b.width / 2 - r.left, b.top + 6 - r.top);
    });
    Render.setHelperOrigins(from);
    // the Ki Beam leaves from your fighter's hands at the top
    const fc = $('#hFace').getBoundingClientRect();
    W.beamFrom = Render.toGame(fc.left + fc.width / 2 - r.left, fc.bottom - r.top + 2);
    W.nodes = W.nodes.filter((n) => n.x > W.bounds.x0 && n.x < W.bounds.x1 && n.y > W.bounds.y0 && n.y < W.bounds.y1 + 4);
  }

  // ------------------------------------------------------------------ input: hold anywhere on the field (tap Bulma's plane to catch her)
  function gamePos(e) {
    const r = cv.getBoundingClientRect();
    return Render.toGame(e.clientX - r.left, e.clientY - r.top);
  }
  function setPos(e) {
    const [x, y] = gamePos(e);
    input.x = x;
    input.y = y - (e.pointerType === 'touch' ? 6 : 0); // keep the disc visible above a fingertip
  }
  cv.addEventListener('pointerdown', (e) => {
    if (sheet || modalOpen) return;
    const [gx, gy] = gamePos(e);
    if (Render.hitsBulma(W, gx, gy)) { const got = G.catchBulma(S, W, Date.now()); if (got) { toast('LOOT BULMA: ' + got.toUpperCase()); save(); } e.preventDefault(); return; }
    input.down = true; input.id = e.pointerId; setPos(e);
    input.beam = e.button === 2; // right click fires the Ki Beam whatever HOLD is set to
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    $('#hint').hidden = true;
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => { if (input.down && e.pointerId === input.id) setPos(e); });
  const up = (e) => { if (e.pointerId === input.id) { input.down = false; input.id = null; input.beam = false; } };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Escape') { if (modalOpen && !pickNext) closeModal(); else if (sheet) closeSheet(); }
    if (sheet || modalOpen) return;
    const n = +e.key;
    if (n >= 1 && n <= G.TECH_KEYS.length) act('tech', { id: G.TECH_KEYS[n - 1] });
    if (e.key === 'f' || e.key === 'F') act('form');
    if (e.key === 'b' || e.key === 'B') act('weapon');
  });

  // ------------------------------------------------------------------ main loop
  function loop(ts) {
    const dt = Math.min(0.1, Math.max(0, (ts - lastT) / 1000));
    lastT = ts;
    const now = Date.now();
    // a long gap (tab in the background) counts as time away
    if (now - lastWall > 30000) {
      const away = G.offline(S, (now - lastWall) / 1000);
      if (away.secs >= 60) showAway(away);
    }
    lastWall = now;
    if (sheet || modalOpen) input.down = false;
    C = G.tick(S, W, dt, input, now);
    for (const e of W.events) { Render.event(e); onEvent(e, now); }
    W.events.length = 0;
    Render.frame(S, W, input, C, dt);
    hud(now);
    if (sheet && now > lockUntil) refreshSheet(false);
    saveT += dt;
    if (saveT > 10) { saveT = 0; save(); }
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ HUD
  const last = {};
  function set(id, v, prop) {
    const k = id + (prop || '');
    if (last[k] === v) return;
    last[k] = v;
    const el = document.getElementById(id);
    if (!el) return;
    if (prop === 'w') el.style.width = v;
    else if (prop === 'h') el.style.height = v;
    else if (prop === 'html') el.innerHTML = v;
    else el.textContent = v;
  }
  const tog = (el, cls, on) => { if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); };
  function hud(now) {
    set('hZp', fmt(S.zenkai.pts));
    const nx = G.xpNext(S.level), cap = G.levelCap(S);
    set('hPl', S.level >= cap ? 'CAPPED' : fmt(S.xp) + '/' + fmt(nx));
    set('hLv', S.level + '/' + cap);
    set('hXp', Math.min(100, (S.xp / nx) * 100).toFixed(1) + '%', 'w');
    set('hZeni', fmt(S.zeni));
    set('hCaps', fmt(S.caps));
    // goals
    const Gl = G.goalsFor(S, now);
    const g = Gl.list[0];
    set('gT', 'TRAINING GOALS (' + Gl.done + '/' + G.TUNE.goalsPerDay + ')');
    set('gX', g ? (g.have >= g.n ? 'CLAIM: ' : '') + g.text : 'ALL DONE - NEW GOALS TOMORROW');
    set('gB', g ? ((g.have / g.n) * 100).toFixed(1) + '%' : '100%', 'w');
    tog($('#goal'), 'ready', g && g.have >= g.n);
    // chest meters
    const iOn = G.has(S, 'itemChests'), sOn = G.has(S, 'superChests');
    set('miL', iOn ? 'ITEM' : 'M' + G.unlockAt('itemChests'));
    set('msL', sOn ? 'SUPER' : 'M' + G.unlockAt('superChests'));
    set('miF', (iOn ? S.meter.item * 100 : 0).toFixed(1) + '%', 'h');
    set('msF', (sOn ? S.meter.super * 100 : 0).toFixed(1) + '%', 'h');
    set('miN', fmt(S.chests.item));
    set('msN', fmt(S.chests.super));
    tog($('#mItem'), 'locked', !iOn); tog($('#mSuper'), 'locked', !sOn);
    tog($('#mItem'), 'ready', iOn && S.chests.item > 0); tog($('#mSuper'), 'ready', sOn && S.chests.super > 0);
    // techniques
    const techSig = G.TECH_KEYS.map((k) => (G.techOpen(S, k) ? 1 : 0)).join('') + (C.autoTech ? 'a' : '') + (W.mode === 'mono' ? 'm' : '');
    if (last.techSig !== techSig) { last.techSig = techSig; buildTechs(); }
    for (const k of G.TECH_KEYS) {
      if (!G.techOpen(S, k)) continue;
      const left = S.tcd[k] || 0, full = G.TECHS[k].cd * C.techCd;
      set('tcv-' + k, (left > 0 ? (left / full) * 100 : 0).toFixed(1) + '%', 'h');
      set('tct-' + k, left > 0 ? Math.ceil(left) + 's' : '');
    }
    const ab = document.getElementById('tAuto');
    if (ab) { tog(ab, 'on', S.autoTech); set('tAuto', S.autoTech ? 'AUTO ON' : 'AUTO'); }
    // forms: the FORM button and the Ki bar
    const formSig = G.formsOpenTop(S) + ':' + S.formSel + ':' + S.formOn + ':' + S.fighter + ':' + S.weapon + G.has(S, 'beam') + S.beamLook;
    if (last.formSig !== formSig) { last.formSig = formSig; buildForm(); }
    if (G.formsOpenTop(S) > 0) {
      set('kiF', 'calc(' + Math.min(100, (S.ki / C.kiMax) * 100).toFixed(1) + '% - 2px)', 'w');
      set('kiN', 'KI ' + Math.floor(S.ki) + '/' + Math.round(C.kiMax));
      const fb = document.getElementById('fBtn');
      if (fb) tog(fb, 'low', !S.formOn && S.ki < G.TUNE.kiMinStart);
      const wb = document.getElementById('wBtn');
      if (wb) tog(wb, 'firing', W.beamOn);
    }
    // Monolith
    const mono = W.mode === 'mono';
    const ready = G.monoReady(S, now);
    tog($('#monoB'), 'ready', ready && !mono);
    set('monoT', mono ? 'FIGHT' : S.mono.tier >= G.TUNE.monoTiers ? 'DONE' : ready ? 'READY' : G.fmtTime((S.mono.readyAt - now) / 1000));
    const mh = $('#monoHud');
    if (mh.hidden === mono) { mh.hidden = !mono; $('#goal').hidden = mono; }
    if (mono && W.mono) {
      const M = W.mono;
      set('mhT', 'KATCHIN MONOLITH ' + (M.tier + 1) + '  ARMOR ' + fmt(M.armor));
      set('mhB', ((M.hp / M.max) * 100).toFixed(2) + '%', 'w');
      set('mhH', fmt(M.hp) + ' / ' + fmt(M.max));
      set('mhC', Math.ceil(M.left) + 's');
      tog($('#mhC'), 'low', M.left < 10);
    }
    // floor panel
    const need = G.floorNeed(S, S.floor, C);
    set('flN', 'FLOOR ' + S.floor);
    set('flR', G.REGIONS[G.regionOf(S.floor)].name.toUpperCase() + (G.canDescend(S, S.floor) || S.floor >= G.MAX_FLOOR ? '' : ' - BEAT MONOLITH ' + G.PLANETS[G.planetOf(S.floor) + 1].gate));
    set('flB', Math.min(100, (S.floorKills / need) * 100).toFixed(1) + '%', 'w');
    set('flK', S.floorKills + '/' + need + (S.maxFloor > S.floor ? '  BEST ' + S.maxFloor : ''));
    tog($('#flStay'), 'on', S.stay);
    // buffs
    set('buffs', Object.keys(S.buffs).map((k) => '<span class="buff"><i style="background:' + G.ITEMS[k].col + '"></i>' + esc(G.ITEMS[k].name.split(' ').pop().toUpperCase()) + ' ' + Math.ceil(S.buffs[k]) + 's</span>').join(''), 'html');
    // companion cooldown ticks
    for (const h of G.HELPERS) {
      const el = document.getElementById('cd-' + h.id);
      if (el && S.helpers[h.id]) el.style.width = Math.min(100, ((W.helperT[h.id] || 0) / G.helperStats(S, C, h).every) * 100) + '%';
    }
    // dots: something to buy
    $('#dotDisc').hidden = !(G.UP_KEYS.some((k) => (S.up[k] || 0) < G.UPS[k].max && G.canAfford(S, G.upCost(k, S.up[k] || 0, S)))
      || (G.has(S, 'beam') && G.BEAM_KEYS.some((k) => (S.bup[k] || 0) < G.BEAM_UPS[k].max && G.canAfford(S, G.beamCost(k, S.bup[k] || 0, S)))));
    $('#dotItems').hidden = !((iOn && S.chests.item > 0) || (sOn && S.chests.super > 0));
    $('#dotCC').hidden = !(G.HELPERS.some((h) => G.has(S, 'companions') && S.mono.tier >= h.mono && !S.helpers[h.id] && S.zp + (S.zeni >= G.zpCost(S, 1) ? G.zpMax(S) : 0) >= h.hire));
    $('#dotMenu').hidden = !(G.zenkaiGain(S) > 0 || (G.has(S, 'skills') && S.skillPts > 0 && G.SKILLS.some((s) => canSkill(s))) || G.ZK.some((z) => G.zkTierOpen(S, z.tier) && (S.zenkai.up[z.id] || 0) < z.max && S.zenkai.pts >= G.zkCost(z, S.zenkai.up[z.id] || 0)));
    const crewSig = G.HELPERS.map((h) => (S.helpers[h.id] ? 'h' : '') + (S.mono.tier >= h.mono ? 'u' : '')).join(',') + G.has(S, 'companions');
    if (last.crew !== crewSig) { last.crew = crewSig; buildCrew(); }
    const faceSig = (S.fighter || 'goku') + S.formOn;
    if (last.face !== faceSig) { last.face = faceSig; paintFace(); }
    else if (S.formOn && G.formLook(S, S.formOn).spark && now - (last.boltT || 0) > 110) { last.boltT = now; paintFace(); }
  }
  // "all CRIT, 25% SUPER" from a raw chance
  function critText(raw) {
    const [k, f] = G.critSplit(raw);
    const T = G.CRIT_TIERS;
    if (k === 0) return Math.round(f * 100) + '% CRIT';
    return 'all ' + T[Math.min(k, T.length - 1)] + (k + 1 < T.length && f > 0 ? ', ' + Math.round(f * 100) + '% ' + T[k + 1] : '');
  }
  function canSkill(s) {
    if ((S.skills[s.id] || 0) >= s.max || !G.skillRowOpen(S, s.row) || S.skillPts < s.cost) return false;
    const p = G.skillParent(s);
    return !p || S.skills[p.id] > 0;
  }

  // the HUD portrait: your fighter, in the form you're in right now
  function paintFace() {
    const c = $('#faceCv'), g = c.getContext('2d');
    const L = G.formLook(S, S.formOn);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(Render.rigSprite(L.rig, 26, 32, { crop: 0.62, pose: 'idle', hair: L.hair }), 0, 0);
    if (S.formOn && L.spark) drawBolts(g, c.width, c.height);
    $('#hFace').style.boxShadow = S.formOn ? '0 0 0 2px ' + L.aura : '';
  }
  // SSJ2 / Majin lightning: a couple of jagged bolts that flicker over the fighter (repainted every few frames)
  function drawBolts(g, w, h) {
    const n = Math.random() < 0.25 ? 0 : 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let b = 0; b < n; b++) {
      let x = 3 + Math.random() * (w - 6), y = 1 + Math.random() * h * 0.45;
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let s = 0; s < 6; s++) {
        const nx = x + dir * (1 + Math.round(Math.random() * 2)) * (s % 2 ? -1 : 1), ny = y + 1 + Math.round(Math.random() * 2);
        for (let k = 0; k <= 2; k++) {
          const px = Math.round(x + ((nx - x) * k) / 2), py = Math.round(y + ((ny - y) * k) / 2);
          g.fillStyle = 'rgba(127,212,255,0.55)'; g.fillRect(px - 1, py, 3, 1);
          g.fillStyle = s % 2 ? '#ffffff' : '#bfe8ff'; g.fillRect(px, py, 1, 1);
        }
        x = nx; y = ny;
      }
    }
  }
  function paintRig(canvas, id, crop, opts) {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(Render.rigSprite(id, canvas.width, canvas.height, Object.assign({ crop }, opts)), 0, 0);
  }
  function paintCanvases(root) {
    root.querySelectorAll('canvas[data-rig]').forEach((c) => paintRig(c, c.dataset.rig, +c.dataset.crop || 0.42, { pose: c.dataset.pose, hair: c.dataset.hair }));
    root.querySelectorAll('canvas[data-m]').forEach((c) => { const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, c.width, c.height); g.drawImage(Render.thumb(c.dataset.m, c.width), 0, 0); });
    root.querySelectorAll('canvas[data-tile]').forEach((c) => { const [n, i] = c.dataset.tile.split(':'); const im = Render.tileIcon(n, +i || 0); const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, c.width, c.height); const k = Math.min(c.width / im.width, c.height / im.height); g.drawImage(im, (c.width - im.width * k) / 2, (c.height - im.height * k) / 2, im.width * k, im.height * k); });
  }
  function buildCrew() {
    const el = $('#crew');
    const on = G.has(S, 'companions');
    el.innerHTML = G.HELPERS.map((h0) => {
      const h = G.helperView(S, h0), c = S.helpers[h.id];
      const lab = c ? 'LV' + (1 + c.dmg + c.spd + c.multi + (c.crit || 0) + (c.trait || 0)) : on && S.mono.tier >= h.mono ? 'HIRE' : 'M' + h.mono;
      return '<button class="cell' + (c ? '' : ' empty') + '" data-h="' + h.id + '" data-act="sheet" data-id="cc" data-tab="crew" aria-label="' + h.name + (c ? '' : ', not hired') + '"><canvas width="18" height="18" data-rig="' + h.rig + '"></canvas><span class="lv">' + lab + '</span>' + (c ? '<i class="cd" id="cd-' + h.id + '"></i>' : '') + '</button>';
    }).join('');
    paintCanvases(el);
    requestAnimationFrame(layout);
  }
  function buildTechs() {
    const el = $('#tpanel');
    if (!G.has(S, 'techniques')) { el.innerHTML = '<span class="t">TECHNIQUES</span><span class="tlock">CLEAR<br>MONOLITH ' + G.unlockAt('techniques') + '</span>'; return; }
    let h = '<span class="t">TECHNIQUES</span>';
    for (const k of G.TECH_KEYS) {
      const T = G.TECHS[k];
      if (!G.techOpen(S, k)) continue;
      h += '<button class="btn tbtn" data-act="tech" data-id="' + k + '" aria-label="' + T.name + '"' + (W && W.mode === 'mono' ? ' disabled' : '') + '><i style="background:' + T.col + '"></i>' + T.short + '<span class="cdv" id="tcv-' + k + '"></span><span class="cdt" id="tct-' + k + '"></span></button>';
    }
    const next = G.TECH_KEYS.find((k) => !G.techOpen(S, k));
    if (next) h += '<span class="tlock">' + G.TECHS[next].short + '<br>M' + G.TECHS[next].mono + '</span>';
    if (C && C.autoTech) h += '<button class="btn alt stay" id="tAuto" data-act="autoTech">AUTO</button>';
    el.innerHTML = h;
    for (const k of Object.keys(last)) if (k.startsWith('tc')) delete last[k];
    delete last.tAuto;
  }
  // the FORM panel: tap FORM to transform (or power down), arrows pick the step, the bar is your Ki
  function buildForm() {
    const el = $('#fpanel');
    const top = G.formsOpenTop(S);
    const t1 = G.FORM_TIERS[1].mono;
    if (!top) { el.innerHTML = '<span class="t">FORM</span><span class="tlock">' + G.formLook(S, 1).short + '<br>M' + t1 + '</span>'; return; }
    const sel = Math.min(S.formSel || 1, top);
    const L = G.formLook(S, S.formOn || sel);
    el.innerHTML = '<span class="t">FORM</span>'
      + '<button class="btn tbtn form' + (S.formOn ? ' on' : '') + '" id="fBtn" data-act="form" style="--aura:' + L.aura + '" aria-label="' + (S.formOn ? 'Power down from ' : 'Transform: ') + esc(L.name) + '"><i style="background:' + L.aura + '"></i>' + esc(L.short) + '</button>'
      + (top > 1 ? '<div class="fsel"><button class="btn alt" data-act="formStep" data-d="-1" aria-label="Lower form"' + (sel <= 1 ? ' disabled' : '') + '>&#9664;</button><button class="btn alt" data-act="formStep" data-d="1" aria-label="Higher form"' + (sel >= top ? ' disabled' : '') + '>&#9654;</button></div>' : '')
      + '<div class="kibar"><i id="kiF"></i></div><span class="kin num" id="kiN"></span>'
      // HOLD: what holding the field fires (the Ki Beam shares the Ki bar above)
      + '<span class="t">HOLD</span>'
      + (G.has(S, 'beam')
        ? '<button class="btn tbtn wbtn' + (S.weapon === 'beam' ? ' beam' : '') + '" id="wBtn" data-act="weapon" style="--beam:' + G.beamLookOf(S).col[1] + '" aria-label="Holding fires the ' + (S.weapon === 'beam' ? 'Ki Beam. Tap for the disc' : 'disc. Tap for the Ki Beam') + '"><i></i>' + (S.weapon === 'beam' ? 'BEAM' : 'DISC') + '</button>'
        : '<span class="tlock">BEAM<br>M' + G.unlockAt('beam') + '</span>');
    delete last.kiF; delete last.kiN;
  }

  // ------------------------------------------------------------------ events from the rules
  function onEvent(e) {
    if (e.type === 'level') {
      if (e.level === G.TUNE.zenkaiLevel) toast('POWER LEVEL ' + e.level + ' - ZENKAI IS OPEN (MENU)');
      else if (e.level % 5 === 0) toast('POWER LEVEL ' + e.level);
    } else if (e.type === 'monoEnd') showMonoResult(e);
    else if (e.type === 'goal') toast('GOAL DONE: +' + fmt(e.zeni) + ' ZENI + ' + e.bonus.toUpperCase());
    else if (e.type === 'zenkai') toast('ZENKAI! +' + e.gain + ' ZENKAI POINTS');
    else if (e.type === 'floor') {
      if (e.region) banner(e.region.name, 'FLOOR ' + e.floor);
      else if (e.first && (e.floor - 1) % 2 === 0) { const m = G.MACHINES[Math.min(49, Math.floor((e.floor - 1) / 2))]; banner('FLOOR ' + e.floor, 'NEW: ' + m.name.toUpperCase()); }
    } else if (e.type === 'chest') { if (!last['chestToast' + e.kind] || Date.now() - last['chestToast' + e.kind] > 8000) { last['chestToast' + e.kind] = Date.now(); toast(e.kind === 'item' ? '+1 ITEM CHEST' : '+1 SUPER CHEST!'); } }
    else if (e.type === 'shout') shout(e.helper, e.text);
    else if (e.type === 'card') { const K = G.CARD[e.id]; banner('NEW CARD: ' + cardName(K), '+' + Math.round(G.CARD_PERK * 100) + '% ' + K.perk); }
    else if (e.type === 'contract') toast('CONTRACT DONE: +' + fmt(e.pts) + ' CONTRACT POINTS' + (e.mult > 1 ? ' (x' + e.mult + '!)' : ''));
    else if (e.type === 'form') { if (e.out) toast('OUT OF KI - BACK TO BASE FORM'); else if (e.tier) banner(G.formLook(S, e.tier).name, G.fighterOf(S).name.toUpperCase() + ' - x' + G.FORM_TIERS[e.tier].mult + ' DISC DAMAGE'); }
    else if (e.type === 'bulma') toast('LOOT BULMA IS FLYING BY - TAP HER PLANE!');
    else if (e.type === 'beamOut') toast('OUT OF KI - THE DISC TAKES OVER');
    else if (e.type === 'beamLow') { if (!last.beamLowT || Date.now() - last.beamLowT > 4000) { last.beamLowT = Date.now(); toast('THE BEAM NEEDS ' + G.TUNE.beamMinStart + ' KI - DISC FOR NOW'); } }
    else if (e.type === 'wish') { const w = G.WISHES.find((x) => x.id === e.id); toast('BUU WISH GRANTED: ' + w.name.toUpperCase() + ' - ' + w.reward.toUpperCase()); }
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'tst';
    t.textContent = msg;
    $('#toast').appendChild(t);
    setTimeout(() => t.remove(), 2500);
    while ($('#toast').children.length > 3) $('#toast').firstChild.remove();
  }
  // a companion yells their move in a speech bubble over their portrait
  function shout(id, text) {
    const cell = document.querySelector('.cell[data-h="' + id + '"]');
    if (!cell || sheet) return;
    const r = app.getBoundingClientRect(), b = cell.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text.toUpperCase();
    el.style.left = Math.max(4, b.left - r.left - 6) + 'px';
    el.style.bottom = r.bottom - b.top + 6 + 'px';
    app.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }
  function banner(big, small) {
    const b = $('#banner');
    b.hidden = true;
    b.innerHTML = '<b>' + esc(big.toUpperCase()) + '</b><span>' + esc(small) + '</span>';
    void b.offsetWidth;
    b.hidden = false;
    clearTimeout(banner.t);
    banner.t = setTimeout(() => { b.hidden = true; }, 2600);
  }

  // ------------------------------------------------------------------ actions (every button has data-act)
  app.addEventListener('pointerdown', (e) => { if (e.target.closest('#sheet')) lockUntil = Date.now() + 450; });
  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    act(b.dataset.act, b.dataset, b);
  });
  // Lab: double-tap (or double-click) a machine's row to go to the floor it shows up on most
  let lastTap = { id: null, t: 0 };
  app.addEventListener('click', (e) => {
    const row = e.target.closest('[data-goto]');
    if (!row || e.target.closest('button')) return;
    const now = Date.now();
    if (lastTap.id === row.dataset.goto && now - lastTap.t < 400) { lastTap = { id: null, t: 0 }; goFarm(row.dataset.goto); }
    else lastTap = { id: row.dataset.goto, t: now };
  });
  function goFarm(id) {
    const m = G.MACH[id];
    if (W.mode !== 'field') { toast('FINISH THE MONOLITH FIGHT FIRST'); return; }
    const f = G.farmFloor(S, m.t);
    if (f == null) { const best = G.floorsFor(m.t)[0]; toast(m.name.toUpperCase() + ' SHOWS UP MOST ON FLOOR ' + (best ? best[0] : '?') + ' - GO DEEPER FIRST'); return; }
    if (f !== S.floor) G.setFloor(S, W, f);
    S.stay = true;
    closeSheet();
    toast('FLOOR ' + f + ': FARMING ' + m.part.toUpperCase() + ' (STAY IS ON)');
  }
  function act(a, d) {
    d = d || {};
    const now = Date.now();
    let changed = true;
    switch (a) {
      case 'sheet': if (sheet === d.id && !d.tab) closeSheet(); else openSheet(d.id, d.tab); return; // tapping the open tab's button again closes it
      case 'close': closeSheet(); return;
      case 'back': { const p = sheetStack.pop(); if (p) openSheet(p, null, true); else closeSheet(); return; }
      case 'mclose': closeModal(); return;
      case 'tech': if (!G.useTech(S, W, d.id)) toast(W.mode === 'mono' ? "TECHNIQUES DON'T WORK ON KATCHIN" : G.TECHS[d.id].name.toUpperCase() + ' IS RECHARGING'); break;
      case 'autoTech': S.autoTech = !S.autoTech; break;
      case 'form':
        if (!G.formsOpenTop(S)) { toast('FORMS OPEN WITH MONOLITH ' + G.FORM_TIERS[1].mono); return; }
        if (!G.transform(S, W)) toast('NEED ' + G.TUNE.kiMinStart + ' KI TO TRANSFORM');
        break;
      case 'formStep': G.selectForm(S, W, Math.min(S.formSel || 1, G.formsOpenTop(S)) + +d.d); break;
      case 'weapon':
        if (!G.setWeapon(S, S.weapon === 'beam' ? 'disc' : 'beam')) { toast('THE KI BEAM OPENS WITH MONOLITH ' + G.unlockAt('beam')); return; }
        toast(S.weapon === 'beam' ? 'HOLD FIRES THE ' + G.beamLookOf(S).name.toUpperCase() + ' (USES KI)' : 'HOLD SPINS THE DESTRUCTO DISC');
        break;
      case 'bup': if (!G.buyBeam(S, d.k)) toast('MISSING ZENI OR ALLOY'); break;
      case 'beamLook': if (!G.setBeamLook(S, d.id)) toast(d.store ? 'GET THIS LOOK IN THE CAPSULE STORE' : 'THIS LOOK UNLOCKS LATER'); break;
      case 'discTab': ui.discTab = d.v; break;
      case 'fighter': {
        S.fighter = d.id === 'vegeta' ? 'vegeta' : 'goku';
        paintFace(); buildCrew(); buildForm();
        if (d.pick) { const fn = pickNext; pickNext = null; save(); if (fn) fn(); else closeModal(); return; }
        toast(G.fighterOf(S).name.toUpperCase() + ' IS YOUR FIGHTER');
        break;
      }
      case 'goal': if (!G.claimGoal(S, W, now)) { const g = S.goals.list[0]; if (g) toast(g.text + ': ' + fmt(g.have) + '/' + fmt(g.n)); } break;
      case 'monoPrep': if (W.mode === 'field') showMonoPrep(now); return;
      case 'monoStart': if (G.startMono(S, W, now)) { closeModal(); closeSheet(); buildTechs(); } break;
      case 'monoQuit': G.quitMono(S, W, now); break;
      case 'stay': S.stay = !S.stay; if (!S.stay && S.floorKills >= G.floorNeed(S, S.floor)) G.setFloor(S, W, S.floor); break;
      case 'floorUp': G.setFloor(S, W, S.floor - 1); break;
      case 'floorDown': G.setFloor(S, W, S.maxFloor); break;
      case 'floors': showFloors(); return;
      case 'goFloor': G.setFloor(S, W, +d.f); closeModal(); break;
      case 'use': if (!G.useItem(S, W, d.id)) toast(d.id === 'senzu' ? 'NO TECHNIQUE IS RECHARGING' : d.id === 'kidrink' ? 'YOUR KI IS ALREADY FULL' : 'THAT BUFF IS ALREADY STACKED TO 20 MINUTES'); else toast(G.ITEMS[d.id].name.toUpperCase() + '!'); if (modalOpen) showMonoPrep(now); break;
      case 'buyItem': if (!G.buyItem(S, d.id, +d.n || 1)) toast('NOT ENOUGH ZENI'); if (modalOpen) showMonoPrep(now); break;
      case 'up': if (!G.buyUp(S, d.k)) toast('MISSING ZENI OR ALLOY'); break;
      case 'ws': if (!G.buyWs(S, d.id)) toast('MISSING ZENI OR ALLOY'); break;
      case 'hire': if (!G.hire(S, d.id)) toast('NOT ENOUGH Z POINTS - BUY SOME ABOVE'); break;
      case 'cup': if (!G.upHelper(S, d.id, d.k)) toast('NOT ENOUGH Z POINTS - BUY SOME ABOVE'); break;
      case 'zpAmt': ui.zpAmt = d.v; break;
      case 'ctDeliver': { const r = G.ctDeliver(S, W); if (!r) toast('NOT ENOUGH ALLOY YET'); break; }
      case 'ctReroll': if (!G.ctReroll(S, now)) toast('NEW ORDER IN ' + Math.ceil((S.ct.rerollAt - now) / 1000) + 's'); break;
      case 'ct': if (!G.buyCt(S, d.id)) toast('NOT ENOUGH CONTRACT POINTS'); break;
      case 'cardKind': ui.cardKind = d.v; break;
      case 'cardGild': if (G.transformCard(S, d.id)) toast(cardName(G.CARD[d.id]).toUpperCase() + ' CARD TRANSFORMED: x3!'); else toast('NOT ENOUGH RAINBOW CAPSULES'); break;
      case 'buyZp': { const got = G.buyZp(S, ui.zpAmt === 'max' ? G.zpMax(S) : +ui.zpAmt); if (got) toast('+' + fmt(got) + ' Z POINTS'); else toast('NOT ENOUGH ZENI'); break; }
      case 'store': if (!G.buyStore(S, d.id)) toast('NOT ENOUGH RAINBOW CAPSULES'); else toast(G.STORE.find((s) => s.id === d.id).name.toUpperCase() + '!'); break;
      case 'skill': ui.skill = d.id; break;
      case 'buySkill': if (!G.buySkill(S, d.id)) toast('NEED MORE SKILL POINTS (OR THE NODE ABOVE)'); break;
      case 'open': { const r = G.openChests(S, d.kind, d.n === 'all' ? 1e9 : +d.n); if (r) ui.lastLoot = r; break; }
      case 'labRegion': ui.labRegion = +d.r; break;
      case 'amt': ui.amt = d.v; break;
      case 'sell': { const z = G.sell(S, d.id, amount(S.parts[d.id] || 0)); if (z) toast('+' + fmt(z) + ' ZENI'); break; }
      case 'refine': { const n = G.refine(S, d.id, amount(Math.floor((S.parts[d.id] || 0) / C.ratio))); if (n) toast('+' + fmt(n) + ' ' + G.MACH[d.id].part.toUpperCase() + ' ALLOY'); else toast('NEED ' + C.ratio + ' PARTS PER ALLOY'); break; }
      case 'sellAll': { let z = 0; for (const m of regionMachines(ui.labRegion)) z += G.sell(S, m.id, S.parts[m.id] || 0); if (z) toast('+' + fmt(z) + ' ZENI'); break; }
      case 'refineAll': { let n = 0; for (const m of regionMachines(ui.labRegion)) n += G.refine(S, m.id, 1e15); if (n) toast('+' + fmt(n) + ' CAPSULE ALLOY'); break; }
      case 'zk': if (!G.buyZk(S, d.id)) toast('NOT ENOUGH ZENKAI POINTS'); break;
      case 'zenkaiAsk': showZenkaiConfirm(); return;
      case 'zenkaiGo': if (G.zenkai(S, W, now)) { closeModal(); openSheet('zenkai'); save(); } break;
      case 'ccTab': ui.ccTab = d.v; break;
      case 'monoTab': ui.monoTab = d.v; break;
      case 'reduce': S.opt.reduce = !S.opt.reduce; Render.setReduce(S.opt.reduce); break;
      case 'offBuffs': S.opt.offBuffs = S.opt.offBuffs === false; break;
      case 'copySave': copySave(); return;
      case 'loadSave': loadSave(); return;
      case 'reset':
        if (now - ui.resetArm > 4000) { ui.resetArm = now; toast('TAP ERASE AGAIN TO CONFIRM'); refreshSheet(true); return; }
        try { localStorage.removeItem(G.SAVE_KEY); } catch (err) { /* nothing saved */ }
        S = G.newState(now); W = G.newWorld(); layout(); closeSheet(); buildCrew(); buildTechs(); buildForm(); paintFace(); showFighterPick(() => showHelp(true)); save(); return;
      default: changed = false;
    }
    if (changed) { refreshSheet(true); if (!['amt', 'zpAmt', 'cardKind', 'labRegion', 'ccTab', 'monoTab', 'skill', 'goal', 'discTab'].includes(a)) save(); }
  }
  function amount(max) { return ui.amt === 'max' ? max : Math.min(max, +ui.amt); }
  const regionMachines = (r) => G.MACHINES.slice(r * 5, r * 5 + 5);

  // ------------------------------------------------------------------ sheets
  const TITLES = { lab: "Bulma's Lab", disc: 'Upgrades', items: 'Capsule Items', chests: 'Chests', cc: 'Capsule Corp', menu: 'Menu', zenkai: 'Zenkai', stats: 'Scouter Stats', options: 'Options', cards: 'Cards', help: 'How To Play', credits: 'Credits', goals: 'Training Goals', mono: 'Katchin Monolith', skills: 'Skill Tree', wishes: 'Buu Wishes', bonuses: 'SUPER Bonuses' };
  function openSheet(id, tab, isBack) {
    if (W.mode === 'mono' && id !== 'stats') { toast('FINISH THE MONOLITH FIGHT FIRST'); return; }
    if (id === 'lab' && sheet !== 'lab') ui.labRegion = G.regionOf(S.floor);
    if (id === 'cc' && tab) ui.ccTab = tab;
    if (!isBack) { if (sheet && sheet !== id && ['menu', 'items'].includes(sheet)) sheetStack.push(sheet); else if (!sheet) sheetStack = []; }
    sheet = id;
    input.down = false;
    $('#sheet').hidden = false;
    $('#shBack').hidden = !sheetStack.length;
    $('#shT').textContent = TITLES[id] || id;
    document.querySelectorAll('#nav .btn').forEach((b) => tog(b, 'act', b.dataset.id === id));
    refreshSheet(true);
    $('#shB').scrollTop = 0;
  }
  function closeSheet() {
    sheet = null;
    sheetStack = [];
    $('#sheet').hidden = true;
    document.querySelectorAll('#nav .btn').forEach((b) => b.classList.remove('act'));
  }
  function refreshSheet(force) {
    if (!sheet) return;
    const html = SHEETS[sheet]();
    if (!force && html === sheetSig) return;
    sheetSig = html;
    const b = $('#shB'), top = b.scrollTop;
    b.innerHTML = html;
    b.scrollTop = top;
    paintCanvases(b);
  }
  const mthumb = (id, s) => '<canvas class="thumb" width="' + (s || 32) + '" height="' + (s || 32) + '" data-m="' + id + '"' + (s ? ' style="width:' + s + 'px;height:' + s + 'px"' : '') + '></canvas>';
  const capico = '<i class="capico"></i>';
  const zeni = (n, short) => '<span class="' + (short ? 'short' : '') + '"><i class="zico">Z</i>' + fmt(n) + '</span>';
  const card = (html, mute) => '<div class="card' + (mute ? ' mute' : '') + '" style="padding:7px 9px">' + html + '</div>';
  const lockline = (n, what) => '<div class="lockline">' + esc(what) + ' OPENS WHEN YOU CLEAR KATCHIN MONOLITH ' + n + '</div>';
  function costChips(cost) {
    let h = zeni(cost.zeni, S.zeni < cost.zeni);
    for (const [id, n] of cost.alloy) {
      const m = G.MACH[id];
      if (!G.partReachable(S, id)) h += '<span class="short"><i class="ingot"></i>' + esc(m.part) + ' (NAMEK)</span>';
      else h += '<span class="' + ((S.alloy[id] || 0) < n ? 'short' : '') + '" title="' + esc(m.part) + ' alloy - floors ' + (2 * m.t + 1) + '-' + (2 * m.t + 6) + '"><i class="ingot" style="background:' + m.col + '"></i>' + fmt(S.alloy[id] || 0) + '/' + fmt(n) + ' ' + esc(m.part) + '</span>';
    }
    return h;
  }
  function upEffect(k) {
    const l = S.up[k] || 0;
    const base = Object.assign({}, S, { buffs: {} });
    const a = G.calc(base), b = G.calc(Object.assign({}, base, { up: Object.assign({}, S.up, { [k]: l + 1 }) }));
    const f = {
      power: (c) => fmt(c.basePower), spin: (c) => c.spin.toFixed(1) + '/s', size: (c) => c.radius.toFixed(1), crit: (c) => Math.round(c.crit * 100) + '%' + (c.crit > 1 ? ' (' + critText(c.crit) + ')' : ''),
      field: (c) => String(c.maxNodes), beacon: (c) => c.spawn.toFixed(2) + 's', value: (c) => 'x' + c.valueMult.toFixed(2), refine: (c) => c.ratio + ' parts'
    }[k];
    return [f(a), f(b)];
  }

  // the KI BEAM tab: how it works, which look it fires as, and its upgrades (reset by Zenkai, like the disc's)
  function beamEffect(k) {
    const l = S.bup[k] || 0;
    const base = Object.assign({}, S, { buffs: {}, formOn: 0 });
    const a = G.calc(base), b = G.calc(Object.assign({}, base, { bup: Object.assign({}, S.bup, { [k]: l + 1 }) }));
    const f = { bpow: (c) => fmt(c.beamDmg), bwide: (c) => c.beamWidth.toFixed(1), beff: (c) => c.beamDrain.toFixed(2) + ' Ki/s', bsplit: (c) => String(c.beams), bburn: (c) => Math.round(c.burnPct * 100) + '%' }[k];
    return [f(a), f(b)];
  }
  function beamHtml() {
    const L = G.beamLookOf(S);
    let h = card('Set HOLD to <b style="color:var(--text)">BEAM</b> (under FORM, key B, or hold the right mouse button): your ' + esc(L.name) + ' fires from your fighter through your finger to the edge of the field and hits everything on the way, the Monolith too. '
      + fmt(C.beamDmg) + ' a hit, ' + C.beamRate + ' hits/s' + (C.beams > 1 ? ' (' + C.beams + ' beams at 60%)' : '') + ', crits like the disc. It drains ' + C.beamDrain.toFixed(1) + ' Ki a second on top of any form, and Ki only refills in base form with the beam off. Out of Ki, the disc takes over. These upgrades reset on Zenkai.', true);
    h += '<div class="sec">LOOK (ALL WORK THE SAME)</div><div class="tabs">';
    for (const B of G.BEAM_LOOKS) {
      const own = G.lookOwned(S, B.id), on = B.id === L.id;
      h += '<button class="btn ' + (on ? 'gold' : 'alt') + ' blook" data-act="beamLook" data-id="' + B.id + '"' + (B.store ? ' data-store="1"' : '') + (own ? '' : ' aria-disabled="true"') + '><i style="background:' + B.col[1] + ';box-shadow:0 0 0 2px ' + B.col[0] + '"></i>' + esc(B.name.toUpperCase()) + (own ? '' : B.store ? ' (STORE)' : ' (LATER)') + '</button>';
    }
    h += '</div>';
    if (S.beamLook) h += '<div class="tabs"><button class="btn alt" data-act="beamLook" data-id="">USE MY FIGHTER\'S BEAM</button></div>';
    h += '<div class="sec">UPGRADES</div>';
    for (const k of G.BEAM_KEYS) {
      const U = G.BEAM_UPS[k], l = S.bup[k] || 0, maxed = l >= U.max;
      const cost = maxed ? null : G.beamCost(k, l, S);
      const [a, b] = beamEffect(k);
      h += '<div class="row"><div><div class="nm"><span>' + U.name + '</span><span class="pill num">' + l + '/' + U.max + '</span></div><div class="sub">' + U.desc + ': <b style="color:var(--text)">' + a + '</b>' + (maxed ? '' : ' &gt; <b style="color:var(--gold)">' + b + '</b>') + '</div></div>'
        + '<div class="acts">' + (maxed ? '<span class="pill g">MAXED</span>' : '<button class="btn" data-act="bup" data-k="' + k + '"' + (G.canAfford(S, cost) ? '' : ' disabled') + '>BUY</button>') + '</div>'
        + (maxed ? '' : '<div class="cost">' + costChips(cost) + '</div>') + '</div>';
    }
    return h;
  }
  // a card: its art (machine, alloy ingot, fighter, form look, Technique / item colour, region ground, misc mark),
  // name, perk and either how to get it or the TRANSFORM button. Transformed ones get the gold frame + glint.
  function cardArt(K) {
    if (K.kind === 'machine') return mthumb(K.m, 40);
    if (K.kind === 'alloy') return '<span class="cart-alloy"><i class="ingot" style="background:' + G.MACH[K.m].col + '"></i>' + mthumb(K.m, 24) + '</span>';
    if (K.kind === 'fighter') { const hv = G.helperView(S, G.HELPER[K.h]); return '<canvas width="22" height="22" data-rig="' + hv.rig + '" data-crop="0.42" style="width:44px;height:44px;image-rendering:pixelated"></canvas>'; }
    if (K.kind === 'form') { const L = G.formLook(S, K.tier); return '<canvas width="26" height="32" data-rig="' + L.rig + '" data-pose="idle" data-crop="0.62"' + (L.hair ? ' data-hair="' + L.hair + '"' : '') + ' style="width:39px;height:48px;image-rendering:pixelated;box-shadow:0 0 0 2px ' + L.aura + '"></canvas>'; }
    if (K.kind === 'tech') return '<i class="cart-sq" style="background:' + G.TECHS[K.tk].col + '"></i>';
    if (K.kind === 'item') return '<i class="cart-gem" style="background:' + G.ITEMS[K.ik].col + '"></i>';
    if (K.kind === 'region') { const R = G.REGIONS[K.region]; return '<i class="cart-sq" style="background:repeating-linear-gradient(45deg,' + R.ground[0] + ' 0 4px,' + R.ground[2] + ' 4px 8px);box-shadow:inset 0 0 0 2px ' + R.crack + '"></i>'; }
    return '<i class="cart-misc">' + ({ x_mono: '&#9650;', x_bulma: '&#9992;', x_zenkai: '&#9733;', x_chest: '&#9635;', x_contract: '&#9998;', x_goal: '&#10003;', x_crit: '!', x_beam: '&#9660;' }[K.id] || '?') + '</i>';
  }
  // form cards are named after your fighter's form (Super Saiyan 2 or Majin Vegeta)
  const cardName = (K) => (K.kind === 'form' ? G.formLook(S, K.tier).name : K.kind === 'fighter' ? G.helperView(S, G.HELPER[K.h]).name : K.name);
  function cardTile(K) {
    const own = S.cards[K.id] || 0, cost = G.transformCost(K.id);
    const pct = Math.round(G.CARD_PERK * (own || 1) * 100);
    return '<div class="ccard k-' + K.kind + (own ? ' own' : ' miss') + (own === 3 ? ' gold' : '') + '"><div class="cart">' + (own ? cardArt(K) : '<i class="cart-q">?</i>') + '</div>'
      + '<b>' + esc(cardName(K)) + '</b><span class="cperk">+' + pct + '% ' + esc(K.perk) + '</span>'
      + (own === 1 ? '<button class="btn gold cgild" data-act="cardGild" data-id="' + K.id + '"' + (S.caps >= cost ? '' : ' disabled') + '>TRANSFORM ' + capico + cost + '</button>' : own === 3 ? '<span class="ctag">TRANSFORMED x3</span>' : '<span class="chow">' + esc(K.how) + '</span>')
      + '</div>';
  }
  function contractsHtml() {
    const o = G.ctCurrent(S), m = G.MACH[o.id], have = S.alloy[o.id] || 0, now = Date.now();
    let h = card('Bulma needs Capsule Alloy. Every order you fill pays Contract Points for the upgrades below, and the next order asks for more. Contract Points and these upgrades reset on Zenkai; the CONTRACTS row in the Zenkai upgrades is permanent.', true);
    h += '<div class="card ctord"><div class="ctord-t"><span>BULMA\'S ORDER #' + (S.ct.done + 1) + '</span><b class="num">' + fmt(S.ct.pts) + ' CP</b></div>'
      + '<div class="ctord-b">' + mthumb(o.id, 32) + '<div><div class="nm"><span>' + esc(m.part) + ' Alloy</span></div><div class="sub num"><i class="ingot" style="background:' + m.col + '"></i> ' + fmt(have) + ' / ' + fmt(o.n) + ' &middot; floors ' + (2 * m.t + 1) + '-' + (2 * m.t + 6) + '</div><div class="bar"><i style="width:' + Math.min(100, (have / o.n) * 100).toFixed(1) + '%"></i></div></div></div>'
      + '<div class="tabs"><button class="btn gold" data-act="ctDeliver"' + (have >= o.n ? '' : ' disabled') + '>DELIVER</button><button class="btn alt" data-act="ctReroll"' + (now >= S.ct.rerollAt ? '' : ' disabled') + '>' + (now >= S.ct.rerollAt ? 'NEW ORDER' : 'NEW ORDER ' + Math.ceil((S.ct.rerollAt - now) / 1000) + 's') + '</button></div>'
      + '<p class="mute">Done this run: ' + S.ct.done + '. Base pay 10 CP (Zenkai boosters add more and roll 2x / 3x / 5x / 10x).</p></div>';
    let lastMono = 0;
    for (const u of G.CT_UPS) {
      if (u.mono !== lastMono) { lastMono = u.mono; h += '<div class="sec">' + (u.mono === 8 ? 'CONTRACT UPGRADES' : 'OPENS AT MONOLITH ' + u.mono) + '</div>'; }
      const open = G.ctOpen(S, u), l = S.ct.up[u.id] || 0, mx = G.ctMax(S, u), maxed = l >= mx, cost = maxed ? 0 : G.ctUpCost(S, u, l);
      h += '<div class="row' + (open ? '' : ' dim') + '"><div><div class="nm"><span>' + u.name + '</span><span class="pill num">' + l + '/' + mx + '</span></div><div class="sub">' + u.desc + '</div></div>'
        + '<div class="acts">' + (!open ? '<span class="pill">MONOLITH ' + u.mono + '</span>' : maxed ? '<span class="pill g">MAXED</span>' : '<button class="btn" data-act="ct" data-id="' + u.id + '"' + (S.ct.pts >= cost ? '' : ' disabled') + '>' + fmt(cost) + ' CP</button>') + '</div></div>';
    }
    return h;
  }

  const SHEETS = {
    lab() {
      const top = G.regionOf(S.maxFloor);
      let h = '<div class="tabs">';
      for (let r = 0; r <= Math.max(top, G.regionOf(S.floor)); r++) h += '<button class="btn ' + (r === ui.labRegion ? 'gold' : 'alt') + '" data-act="labRegion" data-r="' + r + '">' + (r * 10 + 1) + '-' + (r * 10 + 10) + '</button>';
      h += '</div>' + card('Sell parts for Zeni, or refine ' + C.ratio + ' parts into 1 Capsule Alloy. Upgrades need alloy. Each part only drops on the floors its machine shows up on: <b style="color:var(--text)">double-tap a machine</b> to go to the floor it shows up on most.', true);
      h += '<div class="sec">' + G.REGIONS[ui.labRegion].name.toUpperCase() + '</div>';
      for (const m of regionMachines(ui.labRegion)) {
        const seen = S.seen[m.id];
        const p = S.parts[m.id] || 0, al = S.alloy[m.id] || 0;
        const val = Math.round(G.partValue(m.t) * C.valueMult);
        const sn = amount(p), rn = amount(Math.floor(p / C.ratio));
        h += '<div class="row' + (seen ? '' : ' dim') + '" data-goto="' + m.id + '" title="Double-tap to go farm it"><div style="display:flex;gap:8px;align-items:center;min-width:0">' + (seen ? mthumb(m.id) : '<span class="thumb"></span>') + '<div style="min-width:0"><div class="nm"><span>' + (seen ? esc(m.part) : '???') + '</span></div>'
          + '<div class="sub num">' + (seen ? esc(m.name) + ' &middot; ' : '') + 'FLOORS ' + (2 * m.t + 1) + '-' + Math.min(G.MAX_FLOOR, 2 * m.t + 6) + '</div><div class="sub num">PARTS ' + fmt(p) + ' &nbsp; <i class="ingot" style="background:' + m.col + '"></i> ' + fmt(al) + ' &nbsp; ' + fmt(val) + ' Z EACH</div></div></div>'
          + '<div class="acts"><button class="btn go" data-act="sell" data-id="' + m.id + '"' + (sn ? '' : ' disabled') + '>SELL ' + fmt(sn) + '</button><button class="btn" data-act="refine" data-id="' + m.id + '"' + (rn ? '' : ' disabled') + '>REFINE ' + fmt(rn) + '</button></div></div>';
      }
      h += '<div class="tabs" style="justify-content:space-between"><div class="tabs">' + ['1', '10', '100', 'max'].map((v) => '<button class="btn ' + (ui.amt === v ? 'gold' : 'alt') + '" data-act="amt" data-v="' + v + '">' + (v === 'max' ? 'MAX' : v + 'X') + '</button>').join('') + '</div>'
        + '<div class="tabs"><button class="btn go" data-act="sellAll">SELL ALL</button><button class="btn" data-act="refineAll">REFINE ALL</button></div></div>';
      return h;
    },
    disc() {
      const bOn = G.has(S, 'beam');
      let h = '<div class="tabs"><button class="btn ' + (ui.discTab !== 'beam' ? 'gold' : 'alt') + '" data-act="discTab" data-v="disc">DESTRUCTO DISC</button><button class="btn ' + (ui.discTab === 'beam' ? 'gold' : 'alt') + '" data-act="discTab" data-v="beam">KI BEAM' + (bOn ? '' : ' (M' + G.unlockAt('beam') + ')') + '</button></div>';
      if (ui.discTab === 'beam') return h + (bOn ? beamHtml() : lockline(G.unlockAt('beam'), 'THE KI BEAM'));
      h += card('Ki Power ' + fmt(C.basePower) + ' &middot; ' + C.spin.toFixed(1) + ' hits/s &middot; radius ' + C.radius.toFixed(1) + ' &middot; crit ' + Math.round(C.crit * 100) + '%. These reset on Zenkai. Higher levels need alloy from deeper machines, and every third level an older part: go back up and farm it.', true);
      for (const k of G.UP_KEYS) {
        const U = G.UPS[k], l = S.up[k] || 0, maxed = l >= U.max;
        const cost = maxed ? null : G.upCost(k, l, S);
        const [a, b] = upEffect(k);
        h += '<div class="row"><div><div class="nm"><span>' + U.name + '</span><span class="pill num">' + l + '/' + U.max + '</span></div><div class="sub">' + U.desc + ': <b style="color:var(--text)">' + a + '</b>' + (maxed ? '' : ' &gt; <b style="color:var(--gold)">' + b + '</b>') + '</div></div>'
          + '<div class="acts">' + (maxed ? '<span class="pill g">MAXED</span>' : '<button class="btn" data-act="up" data-k="' + k + '"' + (G.canAfford(S, cost) ? '' : ' disabled') + '>BUY</button>') + '</div>'
          + (maxed ? '' : '<div class="cost">' + costChips(cost) + '</div>') + '</div>';
      }
      return h;
    },
    items() {
      let h = '<div class="tabs"><button class="btn gold" data-act="sheet" data-id="chests">OPEN CHESTS (' + fmt(S.chests.item) + ' / ' + fmt(S.chests.super) + ')</button></div>';
      h += card('Items come from Item chests and never reset. Buffs of one kind don\'t stack (the strongest applies); different kinds do. The commons can also be bought.', true);
      for (let r = 0; r < 5; r++) {
        const ids = G.ITEM_KEYS.filter((k) => G.ITEMS[k].r === r);
        h += '<div class="sec"><span class="rar' + r + '">' + G.RARITIES[r].name.toUpperCase() + '</span></div>';
        for (const id of ids) {
          const I = G.ITEMS[id], n = S.items[id] || 0;
          const on = S.buffs[id] ? ' <span class="pill g">' + Math.ceil(S.buffs[id]) + 's</span>' : '';
          h += '<div class="row"><div><div class="nm"><i class="gem" style="background:' + I.col + '"></i><span>' + I.name + '</span><span class="pill num">x' + n + '</span>' + on + '</div><div class="sub">' + I.desc + '</div></div>'
            + '<div class="acts"><button class="btn go" data-act="use" data-id="' + id + '"' + (n ? '' : ' disabled') + '>USE</button>'
            + (I.buy ? '<button class="btn alt" data-act="buyItem" data-id="' + id + '" data-n="1"' + (S.zeni >= G.itemPrice(S, id) ? '' : ' disabled') + '>' + fmt(G.itemPrice(S, id)) + ' Z</button>' : '') + '</div></div>';
        }
      }
      return h;
    },
    chests() {
      const iOn = G.has(S, 'itemChests'), sOn = G.has(S, 'superChests');
      const opener = (kind, n) => '<div class="tabs">' + ['1', '10', '100', 'all'].map((v) => '<button class="btn ' + (v === 'all' ? 'gold' : 'alt') + '" data-act="open" data-kind="' + kind + '" data-n="' + v + '"' + (n ? '' : ' disabled') + '>' + (v === 'all' ? 'ALL' : v) + '</button>').join('') + '</div>';
      let h = card('Chest meters fill as you damage machines (Z-Fighters count too). Monolith clears and Loot Bulma give chests as well.', true);
      h += '<div class="card chestc"><canvas width="32" height="32" data-tile="icon_chest:0"></canvas><div><div class="nm" style="font-size:11px">ITEM CHESTS &middot; ' + fmt(S.chests.item) + '</div><div class="sub">' + (iOn ? 'Meter ' + Math.floor(S.meter.item * 100) + '%. Each holds 1 item (' + G.RARITIES.map((r, i) => '<span class="rar' + i + '">' + G.ITEM_W[i] + '%</span>').join(' ') + ').' : 'Opens at Monolith ' + G.unlockAt('itemChests') + '.') + '</div>' + (iOn ? opener('item', S.chests.item) : '') + '</div></div>';
      h += '<div class="card chestc"><canvas width="32" height="32" data-tile="icon_chest:0" style="filter:hue-rotate(250deg) saturate(1.6)"></canvas><div><div class="nm" style="font-size:11px">SUPER CHESTS &middot; ' + fmt(S.chests.super) + '</div><div class="sub">' + (sOn ? 'Meter ' + Math.floor(S.meter.super * 100) + '%. Each rolls a permanent bonus (' + G.RARITIES.map((r, i) => '<span class="rar' + i + '">' + r.w + '%</span>').join(' ') + ') and 1-3 Rainbow Capsules.' : 'Opens at Monolith ' + G.unlockAt('superChests') + '.') + '</div>' + (sOn ? opener('super', S.chests.super) : '') + '</div></div>';
      if (ui.lastLoot) {
        const L = ui.lastLoot;
        h += '<div class="sec">YOU GOT (' + L.n + ' ' + (L.kind === 'item' ? 'ITEM' : 'SUPER') + ' CHEST' + (L.n > 1 ? 'S' : '') + ')</div><div class="card loot">';
        for (const [id, q] of Object.entries(L.got)) {
          if (id === 'superChest') h += '<span class="rar2">+' + q + ' hidden SUPER chest' + (q > 1 ? 's' : '') + '</span>';
          else if (L.kind === 'item') h += '<span class="rar' + G.ITEMS[id].r + '"><i class="gem" style="background:' + G.ITEMS[id].col + '"></i>' + G.ITEMS[id].name + ' x' + q + '</span>';
          else h += '<span class="rar' + G.SUPERBY[id].r + '">' + G.SUPERBY[id].name + (q > 1 ? ' x' + q : '') + '</span>';
        }
        if (L.caps) h += '<span>' + capico + ' +' + L.caps + ' Rainbow Capsules</span>';
        h += '</div>';
      }
      if (sOn) h += '<div class="tabs"><button class="btn alt" data-act="sheet" data-id="bonuses">YOUR SUPER BONUSES</button></div>';
      return h;
    },
    bonuses() {
      let h = card('Every SUPER chest adds a stack to one of these. They never reset.', true);
      for (let r = 0; r < 5; r++) {
        h += '<div class="sec"><span class="rar' + r + '">' + G.RARITIES[r].name.toUpperCase() + ' &middot; ' + G.RARITIES[r].w + '%</span></div>';
        for (const s of G.SUPER.filter((x) => x.r === r)) h += '<div class="row"><div class="nm"><span class="rar' + r + '">' + s.name + '</span></div><div class="num">x' + (S.sup[s.id] || 0) + (s.max < 1000 ? '/' + s.max : '') + '</div></div>';
      }
      return h;
    },
    cc() {
      const tabs = [['crew', 'Z-FIGHTERS', 'companions'], ['ws', 'WORKSHOP', 'workshop'], ['ct', 'CONTRACTS', 'contracts'], ['store', 'STORE', 'store']];
      let h = '<div class="tabs">' + tabs.map(([v, n, u]) => '<button class="btn ' + (ui.ccTab === v ? 'gold' : 'alt') + '" data-act="ccTab" data-v="' + v + '">' + n + (G.has(S, u) ? '' : ' (M' + G.unlockAt(u) + ')') + '</button>').join('') + '</div>';
      if (ui.ccTab === 'crew') {
        if (!G.has(S, 'companions')) return h + lockline(G.unlockAt('companions'), 'Z-FIGHTERS');
        // the exchange: Zeni -> Z points, priced by every point you've ever bought
        const amts = [['1', '1x'], ['25', '25x'], ['250', '250x'], ['2500', '2500x'], ['max', 'MAX']];
        const n = ui.zpAmt === 'max' ? G.zpMax(S) : +ui.zpAmt;
        const get = n > 0 ? (S.zpBought < G.TUNE.zpFirst ? Math.max(n, G.TUNE.zpFirst - S.zpBought) : n) : 0;
        const cost = n > 0 ? G.zpCost(S, n) : 0;
        h += '<div class="card zpx"><div class="zpx-t"><span>EXCHANGE ZENI FOR Z POINTS</span><b class="num"><i class="zpico"></i>' + fmt(S.zp) + '</b></div>'
          + '<div class="tabs">' + amts.map(([v, l]) => '<button class="btn ' + (ui.zpAmt === v ? 'go' : 'alt') + '" data-act="zpAmt" data-v="' + v + '">' + l + '</button>').join('') + '</div>'
          + '<button class="btn zpbuy" data-act="buyZp"' + (n > 0 && S.zeni >= cost ? '' : ' disabled') + '><span class="num">' + (n > 0 ? fmt(cost) : '-') + ' <i class="zico">Z</i></span><span>&#10140;</span><span class="num"><i class="zpico"></i> +' + fmt(get) + '</span></button>'
          + '<p class="mute">Next point: ' + fmt(Math.max(1, Math.ceil(G.zpZeni(Math.max(S.zpBought, G.TUNE.zpFirst), Math.max(S.zpBought, G.TUNE.zpFirst) + 1)))) + ' Zeni. Bought so far: ' + fmt(S.zpBought) + '. Points cost more the more you buy. Z points survive Zenkai; Zeni does not.</p></div>';
        h += card('Z-Fighters throw ki at machines (and the Monolith) on their own and keep fighting while you are away. Their hits scale with your Ki Power, each one brings a trait, and they never reset. Hire and train them with Z points.', true);
        for (const hp0 of G.HELPERS) {
          const hp = G.helperView(S, hp0), c = S.helpers[hp.id], lock = S.mono.tier < hp.mono;
          const st = G.helperStats(S, C, hp);
          h += '<div class="row' + (lock ? ' dim' : '') + '"><div style="display:flex;gap:8px;align-items:center"><canvas width="22" height="22" data-rig="' + hp.rig + '" data-crop="0.42" style="width:44px;height:44px;image-rendering:pixelated;background:#121216;border:2px solid var(--ink)"></canvas><div><div class="nm"><span>' + hp.name + '</span>' + (hp.standIn ? '<span class="pill">STAND-IN ART</span>' : '') + '</div><div class="sub num">' + fmt(st.dmg) + ' dmg x' + st.shots + ' every ' + st.every.toFixed(2) + 's &middot; crit ' + Math.round(st.crit * 100) + '%</div><div class="sub"><b style="color:var(--gold)">' + hp.trait.name.toUpperCase() + ':</b> ' + hp.trait.desc + ' (' + (hp.trait.key === 'blasts' ? st.trait + ' blasts' + (st.over ? ', +' + Math.round(st.over * hp.trait.blastDmg * 100) + '% blast dmg' : '') : Math.round(st.trait * 100) + '%' + (hp.trait.key === 'steal' ? ' of its part value, min 1 Z' : '')) + ')</div></div></div>'
            + '<div class="acts">' + (lock ? '<span class="pill">MONOLITH ' + hp.mono + '</span>' : c ? '' : '<button class="btn" data-act="hire" data-id="' + hp.id + '"' + (S.zp >= hp.hire ? '' : ' disabled') + '>HIRE <i class="zpico"></i>' + fmt(hp.hire) + '</button>') + '</div>';
          if (c) {
            h += '<div class="cost">';
            for (const [k, U] of Object.entries(G.COMP_UPS)) {
              const l = c[k] || 0, cost = G.compUpCost(hp, k, l);
              h += l >= U.max ? '<span class="pill g">' + U.name.toUpperCase() + ' MAX</span>' : '<button class="btn alt" data-act="cup" data-id="' + hp.id + '" data-k="' + k + '"' + (S.zp >= cost ? '' : ' disabled') + '>' + U.name.toUpperCase() + ' ' + l + '/' + U.max + ' &middot; <i class="zpico"></i>' + fmt(cost) + '</button>';
            }
            h += '</div>';
          }
          h += '</div>';
        }
      } else if (ui.ccTab === 'ws') {
        if (!G.has(S, 'workshop')) return h + lockline(G.unlockAt('workshop'), 'THE WORKSHOP');
        h += card('Permanent upgrades: they survive Zenkai. Paid with Zeni and alloy.', true);
        for (const tier of [1, 2]) {
          h += '<div class="sec">' + (tier === 1 ? 'WORKSHOP' : 'WORKSHOP II') + '</div>';
          if (tier === 2 && !G.has(S, 'workshop2')) { h += lockline(G.unlockAt('workshop2'), 'WORKSHOP II'); continue; }
          for (const w of G.WORKSHOP.filter((x) => x.tier === tier)) {
            const l = S.ws[w.id] || 0, maxed = l >= w.max, cost = maxed ? null : G.wsCost(w, l);
            h += '<div class="row"><div><div class="nm"><span>' + w.name + '</span><span class="pill num">' + l + '/' + w.max + '</span></div><div class="sub">' + w.desc + '</div></div>'
              + '<div class="acts">' + (maxed ? '<span class="pill g">MAXED</span>' : '<button class="btn" data-act="ws" data-id="' + w.id + '"' + (G.canAfford(S, cost) ? '' : ' disabled') + '>BUY</button>') + '</div>'
              + (maxed ? '' : '<div class="cost">' + costChips(cost) + '</div>') + '</div>';
          }
        }
      } else if (ui.ccTab === 'ct') {
        if (!G.has(S, 'contracts')) return h + lockline(G.unlockAt('contracts'), 'CONTRACTS');
        h += contractsHtml();
      } else {
        if (!G.has(S, 'store')) return h + lockline(G.unlockAt('store'), 'THE CAPSULE STORE');
        h += card('Rainbow Capsules come from SUPER chests, Monolith clears, Loot Bulma and Kaio-ken. You have ' + capico + ' <b>' + fmt(S.caps) + '</b>. They are only ever earned in the game.', true);
        for (const s of G.STORE) {
          const l = S.store[s.id] || 0, maxed = s.max && l >= s.max, lock = s.need && !G.has(S, s.need);
          h += '<div class="row' + (lock ? ' dim' : '') + '"><div><div class="nm"><span>' + s.name + '</span>' + (s.max ? '<span class="pill num">' + l + '/' + s.max + '</span>' : '') + '</div><div class="sub">' + s.desc + '</div></div>'
            + '<div class="acts">' + (lock ? '<span class="pill">MONOLITH ' + G.unlockAt(s.need) + '</span>' : maxed ? '<span class="pill g">' + (s.max === 1 ? 'OWNED' : 'MAXED') + '</span>' : '<button class="btn" data-act="store" data-id="' + s.id + '"' + (S.caps >= s.cost ? '' : ' disabled') + '>' + capico + ' ' + s.cost + '</button>') + '</div></div>';
        }
      }
      return h;
    },
    menu() {
      const tile = (id, label, d, lock) => '<button class="btn alt tile"' + (lock ? ' disabled' : '') + ' data-act="sheet" data-id="' + id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="' + d + '"/></svg>' + label + '</button>';
      const zg = G.zenkaiGain(S);
      const lk = (u) => (G.has(S, u) ? '' : ' (M' + G.unlockAt(u) + ')');
      return '<div class="sec">PROGRESS</div><div class="grid2">'
        + tile('mono', 'MONOLITH ' + (S.mono.tier + 1), 'M12 2l6 5v15H6V7z M9 12h6M9 16h6')
        + tile('skills', 'SKILL TREE' + lk('skills') + (G.has(S, 'skills') && S.skillPts ? ' (' + S.skillPts + ')' : ''), 'M12 3v6M12 9l-6 5M12 9l6 5M6 14v6M18 14v6', !G.has(S, 'skills'))
        + tile('zenkai', 'ZENKAI' + (zg ? ' +' + zg : ''), 'M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5z')
        + tile('wishes', 'BUU WISHES' + lk('wishes'), 'M12 4a5 5 0 1 0 0 10a5 5 0 1 0 0-10M8 18h8M10 21h4', !G.has(S, 'wishes'))
        + tile('chests', 'CHESTS', 'M4 10h16v10H4zM4 10l2-5h12l2 5M10 14h4')
        + tile('goals', 'GOALS', 'M6 3h12v18l-6-4-6 4zM9 8h6M9 12h4')
        + tile('cards', 'CARDS' + (G.has(S, 'cards') ? ' ' + G.cardCount(S)[0] + '/' + G.CARDS.length : lk('cards')), 'M5 4h10l4 3v13H5zM9 9h6M9 13h6', !G.has(S, 'cards')) + '</div>'
        + '<div class="sec">MISC</div><div class="grid2">' + tile('stats', 'SCOUTER STATS', 'M4 8h12l4 4-4 4H4zM8 12h4') + tile('help', 'HOW TO PLAY', 'M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2M12 18h.01') + tile('options', 'OPTIONS', 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6M12 3v3M12 18v3M3 12h3M18 12h3') + tile('credits', 'CREDITS', 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4') + '</div>'
        + card('DBZ Idle v0.2 &middot; saves on this device every 10 seconds.', true);
    },
    mono() {
      const k = S.mono.tier;
      let h = '<div class="tabs"><button class="btn ' + (ui.monoTab === 'next' ? 'gold' : 'alt') + '" data-act="monoTab" data-v="next">NEXT FIGHT</button><button class="btn ' + (ui.monoTab === 'rewards' ? 'gold' : 'alt') + '" data-act="monoTab" data-v="rewards">REWARDS</button><button class="btn ' + (ui.monoTab === 'unlocks' ? 'gold' : 'alt') + '" data-act="monoTab" data-v="unlocks">UNLOCKS</button></div>';
      const rew = (n) => {
        const R = G.monoReward(n);
        let s = '<span>' + capico + ' ' + R.caps + '</span><span>ITEM CHEST x' + R.itemChests + '</span>';
        if (R.superChests) s += '<span class="rar2">SUPER CHEST x' + R.superChests + '</span>';
        if (R.skillPts) s += '<span class="rar3">SKILL POINT x' + R.skillPts + '</span>';
        s += '<span>LEVEL CAP +' + R.cap + '</span>';
        for (const u of R.unlocks) s += '<span class="rar4">NEW: ' + esc(u.name.toUpperCase()) + '</span>';
        for (const hh of R.helpers) s += '<span class="rar1">NEW Z-FIGHTER: ' + G.helperView(S, hh).name.toUpperCase() + '</span>';
        for (const t of R.techs) s += '<span class="rar1">NEW TECHNIQUE: ' + G.TECHS[t].name.toUpperCase() + '</span>';
        if (R.skillRow) s += '<span class="rar3">SKILL TREE ROW ' + R.skillRow + '</span>';
        return s;
      };
      if (ui.monoTab === 'next') {
        if (k >= G.TUNE.monoTiers) return h + card('Every Monolith is broken. More are coming with the next planet.');
        const ar = G.monoArmor(S, k, C);
        h += '<div class="card kv num"><span>Monolith</span><span>' + (k + 1) + '</span><span>HP left</span><span>' + fmt(G.monoHp(k) - (S.mono.dmg || 0)) + ' / ' + fmt(G.monoHp(k)) + '</span><span>Armor</span><span>' + fmt(ar) + '</span><span>Fight time</span><span>' + C.monoTime + 's</span><span>Your Ki Power</span><span>' + fmt(C.power) + '</span><span>Ready</span><span>' + (G.monoReady(S, Date.now()) ? 'NOW' : G.fmtTime((S.mono.readyAt - Date.now()) / 1000)) + '</span></div>';
        if (C.power <= ar) h += '<div class="card" style="color:var(--bad)">Your Ki Power is below its armor: hits only do ' + Math.round(G.TUNE.minDmgShare * 100) + '%. Upgrade the disc or pop damage buffs first.</div>';
        h += '<div class="sec">CLEAR IT TO GET</div><div class="card loot">' + rew(k) + '</div>';
        h += '<div class="tabs"><button class="btn gold" data-act="monoPrep">GET READY</button></div>';
      } else if (ui.monoTab === 'rewards') {
        for (let n = 0; n < Math.min(G.TUNE.monoTiers, k + 12); n++) h += '<div class="row' + (n < k ? '' : ' dim') + '"><div><div class="nm"><span>MONOLITH ' + (n + 1) + '</span>' + (n < k ? '<span class="pill g">CLEARED</span>' : '') + '</div><div class="loot" style="margin-top:4px">' + rew(n) + '</div></div></div>';
      } else {
        h += card('Clearing Monoliths opens new systems. More arrive as the game grows.', true);
        for (const u of G.UNLOCKS) h += '<div class="row' + (S.mono.tier >= u.n ? '' : ' dim') + '"><div><div class="nm"><span>' + esc(u.name) + '</span><span class="pill' + (S.mono.tier >= u.n ? ' g' : '') + '">M' + u.n + '</span></div><div class="sub">' + esc(u.desc) + '</div></div></div>';
      }
      return h;
    },
    skills() {
      if (!G.has(S, 'skills')) return lockline(G.unlockAt('skills'), 'THE SKILL TREE');
      let h = '<div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:7px 9px"><span>SKILL POINTS</span><b class="big num" style="color:#ff8fd0">' + S.skillPts + '</b></div>';
      h += '<div class="tree">' + G.BRANCHES.map((b) => '<div class="tcol-h">' + b + '</div>').join('');
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < G.BRANCHES.length; c++) {
          const s = G.SKILLS.find((x) => x.col === c && x.row === r);
          if (!s) { h += '<span></span>'; continue; } // the BEAM branch starts lower down
          const l = S.skills[s.id] || 0;
          const open = G.skillRowOpen(S, r);
          const cls = ['node', 'r' + r, G.skillParent(s) ? '' : 'root', open ? '' : 'locked', l >= s.max ? 'maxed' : canSkill(s) ? 'avail' : '', ui.skill === s.id ? 'sel' : ''].join(' ');
          h += '<button class="' + cls + '" data-act="skill" data-id="' + s.id + '"><span>' + esc(s.name) + '</span><span class="lvn">' + (open ? l + '/' + s.max : 'M' + G.skillRowAt(r)) + '</span></button>';
        }
      }
      h += '</div>';
      const s = ui.skill && G.SKILLBY[ui.skill];
      if (s) {
        const l = S.skills[s.id] || 0;
        h += '<div class="row"><div><div class="nm"><span style="color:var(--gold)">' + esc(s.name) + '</span><span class="pill num">' + l + '/' + s.max + '</span></div><div class="sub">' + esc(s.desc) + ' per level. Costs ' + s.cost + ' point' + (s.cost > 1 ? 's' : '') + '.' + (G.skillRowOpen(S, s.row) ? '' : ' Opens at Monolith ' + G.skillRowAt(s.row) + '.') + '</div></div><div class="acts">' + (l >= s.max ? '<span class="pill g">MAXED</span>' : '<button class="btn" data-act="buySkill" data-id="' + s.id + '"' + (canSkill(s) ? '' : ' disabled') + '>LEARN</button>') + '</div></div>';
      } else h += card('Tap a node to see what it does. Skill Points come from Monolith clears (from Monolith 3) and the Capsule Store. A new row opens every 2 Monoliths.', true);
      return h;
    },
    wishes() {
      if (!G.has(S, 'wishes')) return lockline(G.unlockAt('wishes'), 'BUU WISHES');
      let h = card('Majin Buu grants a wish for each challenge you finish. Each challenge counts within a single run (it starts over on Zenkai). The reward is permanent.', true);
      for (const w of G.WISHES) {
        const done = S.wishes[w.id];
        const [a, b] = w.prog(S);
        h += '<div class="row' + (done ? '' : '') + '"><div style="min-width:0"><div class="nm"><span>' + esc(w.name) + '</span>' + (done ? '<span class="pill g">GRANTED</span>' : '') + '</div><div class="sub">' + esc(w.goal) + '</div><div class="sub" style="color:var(--gold)">' + esc(w.reward) + '</div>' + (done ? '' : '<div class="bar prog"><i style="width:' + Math.min(100, (a / b) * 100) + '%"></i></div><div class="sub num">' + fmt(a) + ' / ' + fmt(b) + '</div>') + '</div></div>';
      }
      return h;
    },
    zenkai() {
      const g = G.zenkaiGain(S);
      let h = '<div class="card"><div class="zk-top"><div><p>Earn Zenkai Points at Power Level ' + G.TUNE.zenkaiLevel + '+. More levels, more Monoliths and deeper floors all give more.</p><p class="mute">Resets: level, Zeni, parts, alloy, floors and Disc upgrades. Keeps: Monolith clears, Z-Fighters, Z points, items, chests, SUPER bonuses, Workshop, Store, Skill Tree, Buu Wishes and Zenkai upgrades.</p></div>'
        + '<div style="text-align:center"><div class="big num">+' + g + '</div><button class="btn gold" data-act="zenkaiAsk"' + (g ? '' : ' disabled') + ' style="margin-top:6px">GO ZENKAI</button></div></div></div>';
      h += '<div class="card" style="display:flex;justify-content:space-between;align-items:center"><span>ZENKAI POINTS</span><span class="big num">' + fmt(S.zenkai.pts) + '</span></div>';
      for (const T of G.ZK_TIERS) {
        const open = G.zkTierOpen(S, T.tier);
        h += '<div class="sec">' + T.name + (open ? '' : ' &middot; ' + T.need.toUpperCase()) + '</div>';
        for (const z of G.ZK.filter((x) => x.tier === T.tier)) {
          const l = S.zenkai.up[z.id] || 0, c = G.zkCost(z, l), maxed = l >= z.max;
          const [k, a] = z.fx[0];
          const tot = k === 'ctPts' ? '+' + a * l + ' points' : k === 'ctCap' ? '+' + l + ' levels' : ['ct2x', 'ct3x', 'ct5x', 'ct10x'].includes(k) ? '+' + +(a * l * 100).toFixed(1) + '% chance' : k === 'ctCostPct' ? 'orders need 1/' + +(1 + a * l).toFixed(2) + ' the alloy' : k === 'ctUpPct' ? '-' + Math.round(a * l * 100) + '% CP cost' : k === 'startZeni' ? (l ? fmt(Math.round(500 * Math.pow(4, l - 1))) + ' Z' : '0 Z') : k === 'monoTime' ? '+' + a * l + 's' : k === 'offlineH' ? '+' + l + 'h' : (k.endsWith('Pct') && ['monoArmorPct', 'techCdPct', 'floorReqPct'].includes(k) ? '-' : '+') + Math.round(a * l * 100) + '%';
          h += '<div class="row' + (open ? '' : ' dim') + '"><div><div class="nm"><span>' + z.name + '</span></div><div class="sub num">' + l + '/' + z.max + ' &middot; NOW ' + tot + '</div></div>'
            + '<div class="acts">' + (maxed ? '<span class="pill g">MAXED</span>' : '<button class="btn" data-act="zk" data-id="' + z.id + '"' + (open && S.zenkai.pts >= c ? '' : ' disabled') + '><i class="dico" style="margin-right:4px"></i>' + fmt(c) + '</button>') + '</div></div>';
        }
      }
      return h;
    },
    goals() {
      const Gl = G.goalsFor(S, Date.now());
      const g = Gl.list[0];
      return card('Five goals a day. Each one pays Zeni and an item; the fifth pays 2 Senzu Beans, a Time Chamber and 5 Item chests.<br><span class="mute">Done today: ' + Gl.done + '/' + G.TUNE.goalsPerDay + '. Next reward: ' + fmt(G.goalReward(S)) + ' Zeni.</span>')
        + (g ? '<div class="row"><div><div class="nm"><span>' + esc(g.text) + '</span></div><div class="sub num">' + fmt(g.have) + ' / ' + fmt(g.n) + '</div></div><div class="acts"><button class="btn gold" data-act="goal"' + (g.have >= g.n ? '' : ' disabled') + '>CLAIM</button></div></div>' : card('All done for today. New goals tomorrow.', true));
    },
    stats() {
      const st = S.stats;
      const rows = [
        ['Ki Power', fmt(C.power)], ['Disc hits / s', C.spin.toFixed(1)], ['Disc radius', C.radius.toFixed(1)], ['Disc crit chance', Math.round(C.crit * 100) + '% (' + critText(C.crit) + ')'], ['Crit damage bonus', '+' + Math.round((C.critDmg - 1) * 100) + '%'],
        ['Max machines', C.maxNodes], ['Technique damage', fmt(C.power * C.techMult)], ['Monolith time', C.monoTime + 's'],
        ['Cards / Transformed', G.has(S, 'cards') ? G.cardCount(S)[0] + '/' + G.CARDS.length + ' / ' + G.cardCount(S)[1] : 'Monolith ' + G.unlockAt('cards')], ['Contracts this run', S.ct.done + ' (' + fmt(S.ct.pts) + ' CP)'],
        ['Ki Beam', G.has(S, 'beam') ? fmt(C.beamDmg) + ' x ' + C.beamRate + '/s' + (C.beams > 1 ? ' x ' + C.beams + ' beams (60%)' : '') + ', ' + C.beamDrain.toFixed(1) + ' Ki/s' : 'Monolith ' + G.unlockAt('beam')],
        ['Fighter / form', G.fighterOf(S).name + ' / ' + G.formLook(S, S.formOn).name + (S.formOn ? ' (x' + C.formMult + ')' : '')], ['Ki', Math.floor(S.ki) + ' / ' + Math.round(C.kiMax) + ' (+' + C.kiRegen.toFixed(1) + '/s in base form)'],
        ['Floor / best this run', S.floor + ' / ' + S.maxFloor], ['Monoliths cleared', S.mono.tier], ['Power Level cap', G.levelCap(S)],
        ['Zenkai done', S.zenkai.count], ['Zenkai points earned', fmt(S.zenkai.total)], ['Rainbow Capsules earned', fmt(st.capsEarned)],
        ['Machines destroyed', fmt(st.kills)], ['Parts salvaged', fmt(st.parts)], ['Damage dealt', fmt(st.dmg)], ['Techniques used', fmt(st.techs)],
        ['Item / SUPER chests opened', fmt(st.chests) + ' / ' + fmt(st.supers)], ['Loot Bulma caught', fmt(st.bulma)], ['Zeni from parts', fmt(st.zeni)],
        ['Monolith wins / tries', st.monoWins + ' / ' + st.monoTries], ['Time played', G.fmtTime(st.play)]
      ];
      return '<div class="card kv num">' + rows.map(([a, b]) => '<span>' + a + '</span><span>' + b + '</span>').join('') + '</div>';
    },
    options() {
      const armed = Date.now() - ui.resetArm < 4000;
      const onoff = (on, act) => '<button class="btn ' + (on ? 'go' : 'alt') + '" data-act="' + act + '">' + (on ? 'ON' : 'OFF') + '</button>';
      const fbtn = (id) => '<button class="btn ' + ((S.fighter || 'goku') === id ? 'gold' : 'alt') + '" data-act="fighter" data-id="' + id + '">' + G.FIGHTERS[id].name.toUpperCase() + '</button>';
      return '<div class="row"><div><div class="nm"><span>Fighter</span></div><div class="sub">Who stands at the top and powers up. Looks only: forms work the same for both. With Vegeta, Goku takes his Z-Fighter slot (same upgrades).</div></div><div class="acts">' + fbtn('goku') + fbtn('vegeta') + '</div></div>'
        + '<div class="row"><div><div class="nm"><span>Reduce effects</span></div><div class="sub">Less shaking, fewer particles</div></div><div class="acts">' + onoff(S.opt.reduce, 'reduce') + '</div></div>'
        + '<div class="row"><div><div class="nm"><span>Use buffs while away</span></div><div class="sub">Running buffs (and the Time Chamber\'s x2 speed) help your Z-Fighters while you are gone. Off: they wait for you.</div></div><div class="acts">' + onoff(S.opt.offBuffs !== false, 'offBuffs') + '</div></div>'
        + '<div class="sec">MOVE YOUR SAVE</div><div class="card"><p class="mute">Copy this code to keep a backup or move to another device, then paste it below on the other device.</p><textarea id="saveOut" readonly>' + esc(exportCode()) + '</textarea><div class="tabs" style="margin-top:6px"><button class="btn alt" data-act="copySave">COPY CODE</button></div></div>'
        + '<div class="card"><textarea id="saveIn" placeholder="Paste a save code here"></textarea><div class="tabs" style="margin-top:6px"><button class="btn" data-act="loadSave">LOAD CODE</button></div></div>'
        + '<div class="sec">DANGER</div><div class="row"><div><div class="nm"><span>Erase this save</span></div><div class="sub">Starts over from nothing. The fight sim is not affected.</div></div><div class="acts"><button class="btn" data-act="reset">' + (armed ? 'TAP AGAIN' : 'ERASE') + '</button></div></div>';
    },
    help() { return helpHtml(); },
    cards() {
      if (!G.has(S, 'cards')) return lockline(G.unlockAt('cards'), 'CARDS');
      const [n, g] = G.cardCount(S);
      let h = card('Every card gives <b style="color:var(--text)">+' + Math.round(G.CARD_PERK * 100) + '%</b> to its own thing. <b style="color:var(--gold)">Transform</b> one with Rainbow Capsules to triple it (+' + Math.round(G.CARD_PERK * 300) + '%). Cards drop as you play: each action rolls once with its chances added up, and coming back from offline rolls once per card for everything done while away. Cards never reset.<br><span class="mute">' + n + '/' + G.CARDS.length + ' cards &middot; ' + g + ' Transformed &middot; ' + capico + ' ' + fmt(S.caps) + '</span>', true);
      h += '<div class="tabs">' + G.CARD_KINDS.map(([k, l]) => { const all = G.CARDS.filter((x) => x.kind === k), got = all.filter((x) => S.cards[x.id]).length; return '<button class="btn ' + (ui.cardKind === k ? 'gold' : 'alt') + '" data-act="cardKind" data-v="' + k + '">' + l + ' ' + got + '/' + all.length + '</button>'; }).join('') + '</div>';
      h += '<div class="cgrid">' + G.CARDS.filter((x) => x.kind === ui.cardKind).map(cardTile).join('') + '</div>';
      return h;
    },
    credits() {
      const rigs = (typeof FS_RIGS !== 'undefined' ? FS_RIGS.RIGS : []);
      return card('DBZ Idle is a mode of the DBZ Fight Simulator. It is a fan project, not affiliated with the Dragon Ball rights holders. Every enemy is a machine.')
        + '<div class="sec">MACHINES, LEVELS AND ICONS</div>' + card('Pixel art packs from craftpix.net (free and licensed packs): drones, robots, factory bosses, war machines, village, dungeon, undead and seabed tilesets, crystals. Repainted variants made in the game.')
        + '<div class="sec">FIGHTERS</div><div class="card">' + rigs.map((r) => '<p>' + esc(r.title) + ' &middot; <span class="mute">Pivot figure by ' + esc(r.credit || 'unknown') + ', edited for the fight sim</span></p>').join('')
        + (typeof FORM_ART !== 'undefined' ? Object.values(FORM_ART).map((a) => '<p>' + esc(a.title) + ' &middot; <span class="mute">Art by ' + esc(a.credit) + ', cut out and mirrored</span></p>').join('') : '') + '</div>'
        + '<div class="sec">FONT</div>' + card('Silkscreen by Jason Kottke, SIL Open Font License 1.1.');
    }
  };
  // the sheet re-renders while open; text inputs would lose what you typed, so the options sheet holds still while one has focus
  const optRender = SHEETS.options;
  SHEETS.options = () => (sheetSig && sheet === 'options' && document.activeElement && document.activeElement.tagName === 'TEXTAREA' ? sheetSig : optRender());

  function exportCode() { try { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); } catch (e) { return ''; } }
  function copySave() {
    const ta = $('#saveOut');
    const code = ta ? ta.value : exportCode();
    const fallback = () => { if (ta) { ta.focus(); ta.select(); } toast('CODE SELECTED - COPY IT'); };
    try { navigator.clipboard.writeText(code).then(() => toast('SAVE CODE COPIED'), fallback); } catch (e) { fallback(); }
  }
  function loadSave() {
    const ta = $('#saveIn');
    try {
      const S2 = G.migrate(JSON.parse(decodeURIComponent(escape(atob(ta.value.trim())))), Date.now());
      if (!S2) throw new Error('bad');
      S = S2; W = G.newWorld(); layout(); save(); closeSheet(); buildCrew(); buildTechs(); buildForm(); paintFace(); toast('SAVE LOADED');
    } catch (e) { toast("THAT CODE DIDN'T LOAD - CHECK IT'S COMPLETE"); }
  }

  // ------------------------------------------------------------------ modals
  function showModal(html) {
    modalOpen = true;
    input.down = false;
    $('#mBox').innerHTML = html;
    $('#modal').hidden = false;
    paintCanvases($('#mBox'));
    const b = $('#mBox').querySelector('.btn:not(:disabled)');
    if (b) b.focus({ preventScroll: true });
  }
  function closeModal() { modalOpen = false; $('#modal').hidden = true; }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !pickNext) closeModal(); }); // the fighter pick needs an answer

  function helpHtml() {
    const b = (s) => '<b style="color:var(--gold)">' + s + '</b>';
    return '<div class="card"><p>' + b('HOLD') + ' on the field to spin your Destructo Disc. It saws through every machine it touches. Wreck enough machines and you drop a floor; a new machine joins every 2 floors and the scenery changes every 10.</p>'
      + '<p>' + b('PARTS') + ' go to Bulma\'s LAB: sell them for Zeni or refine them into Capsule Alloy. DISC upgrades cost both, and some ask for older parts: tap the floor panel (bottom right) to go back up and farm them. STAY keeps you on a floor.</p>'
      + '<p>' + b('KATCHIN MONOLITH') + ' (top right) can be fought every 20 minutes. Use buffs from ITEMS and hold the disc on it. Every clear raises your level cap, pays rewards and opens new systems: Z-Fighters, the Workshop, Techniques, chests and more.</p>'
      + '<p>' + b('LOOT BULMA') + ' flies over now and then. Tap her plane for a prize, sometimes Rainbow Capsules.</p>'
      + '<p>' + b('ZENKAI') + ' (MENU, Power Level 20+): start the run over and come back stronger. Z-Fighters, Z points, items, chests and the permanent upgrades stay.</p>'
      + '<p>' + b('KI BEAM') + ' (Monolith 9): flip HOLD to BEAM under the FORM button and your beam fires from the top of the screen through your finger. Drag it across lines of machines. It uses Ki.</p>'
      + '<p class="mute">Keyboard: 1-5 fire Techniques, F transforms, B flips HOLD between disc and beam; right click fires the beam. No real money anywhere: Rainbow Capsules are earned in the game.</p></div>';
  }
  // choose your fighter: who stands in the HUD and powers up. Looks only; switch any time in Options.
  let pickNext = null;
  function showFighterPick(next) {
    pickNext = next;
    const card = (id, line) => { const F = G.FIGHTERS[id]; return '<button class="btn alt" data-act="fighter" data-id="' + id + '" data-pick="1"><canvas width="48" height="64" data-rig="' + F.forms[0].rig + '" data-pose="idle" data-crop="1"></canvas><b>' + F.name.toUpperCase() + '</b><span>' + line + '</span></button>'; };
    showModal('<h3>Choose your fighter</h3><p>Who stands at the top of the screen and powers up through the forms. It only changes the looks: switch any time in MENU, OPTIONS.</p>'
      + '<div class="fpick">' + card('goku', 'Super Saiyan to Mastered Ultra Instinct') + card('vegeta', 'Super Saiyan to Ultra Ego. Goku joins as a Z-Fighter') + '</div>');
  }
  function showHelp(first) {
    showModal('<h3>' + (first ? 'Welcome, fighter' : 'How to play') + '</h3>' + helpHtml() + '<div class="acts"><button class="btn gold" data-act="mclose">START TRAINING</button></div>');
  }
  function showAway(a) {
    const parts = Object.keys(a.parts).map((id) => '<div class="row"><div class="nm">' + mthumb(id, 24) + '<span>' + esc(G.MACH[id].part) + '</span></div><div class="num">+' + fmt(a.parts[id]) + '</div></div>').join('');
    const crew = Object.keys(S.helpers).length;
    showModal('<h3>While you were away</h3><p>Gone ' + G.fmtTime(a.secs) + (a.capped ? ' (the limit; Workshop and Zenkai raise it)' : '') + '.' + (a.kills ? ' Your Z-Fighters wrecked ' + fmt(a.kills) + ' machines' + (a.floors ? ' and went down ' + a.floors + ' floor' + (a.floors > 1 ? 's' : '') : '') + '.' : '') + '</p>'
      + (parts || '<p class="mute">' + (crew ? 'Your Z-Fighters found nothing this time.' : G.has(S, 'companions') ? 'Hire Z-Fighters at Capsule Corp and they will fight while you are away.' : 'Clear Katchin Monolith 1 to get Z-Fighters who fight while you are away.') + '</p>')
      + (a.cards && a.cards.length ? '<p><b style="color:var(--gold)">New cards:</b> ' + a.cards.map((id) => esc(cardName(G.CARD[id]))).join(', ') + '</p>' : '')
      + (a.chests.item || a.chests.super ? '<p>Chests: +' + a.chests.item + ' Item, +' + a.chests.super + ' SUPER</p>' : '') + (a.xp ? '<p>Power Level +' + fmt(a.xp) + ' XP</p>' : '')
      + '<div class="acts"><button class="btn gold" data-act="mclose">BACK TO THE FIGHT</button></div>');
  }
  function showFloors() {
    let h = '<h3>Choose a floor</h3><p class="mute">You can go to any floor down to your best this run (' + S.maxFloor + '). Each machine only shows up on its own floors.</p>';
    for (let r = 0; r <= G.regionOf(S.maxFloor); r++) {
      h += '<div class="sec">' + G.REGIONS[r].name.toUpperCase() + '</div><div class="tabs">';
      for (let f = r * 10 + 1; f <= Math.min(S.maxFloor, r * 10 + 10); f++) h += '<button class="btn ' + (f === S.floor ? 'gold' : 'alt') + '" data-act="goFloor" data-f="' + f + '">' + f + '</button>';
      h += '</div>';
    }
    h += '<div class="acts"><button class="btn alt" data-act="mclose">CLOSE</button></div>';
    showModal(h);
  }
  function showMonoPrep(now) {
    const k = S.mono.tier;
    if (k >= G.TUNE.monoTiers) { toast('EVERY MONOLITH IS BROKEN'); return; }
    const ready = G.monoReady(S, now);
    const hp = G.monoHp(k) - (S.mono.dmg || 0), ar = G.monoArmor(S, k, C);
    const est = G.effDmg(C.power, ar) * C.spin * C.speed * C.monoTime;
    let h = '<h3>Katchin Monolith ' + (k + 1) + '</h3>'
      + '<p>The hardest metal in the universe. Techniques bounce off it: only the disc' + (G.has(S, 'beam') ? ', the Ki Beam' : '') + ' and your Z-Fighters scratch it.</p>'
      + '<div class="card kv num"><span>HP left</span><span>' + fmt(hp) + ' / ' + fmt(G.monoHp(k)) + (S.mono.dmg ? ' (' + Math.round(S.mono.best * 100) + '% CHIPPED)' : '') + '</span><span>Armor</span><span>' + fmt(ar) + '</span><span>Your Ki Power now</span><span>' + fmt(C.power) + '</span><span>Disc alone, ' + C.monoTime + 's</span><span>~' + fmt(est) + '</span></div>';
    if (!ready) h += '<p class="mute">Ready in ' + G.fmtTime((S.mono.readyAt - now) / 1000) + '.</p>';
    h += '<div class="sec">POP YOUR BUFFS</div>';
    for (const id of ['weights', 'gravity', 'turbo', 'discap', 'chamber', 'radar', 'ritual', 'potara', 'fusion', 'water', 'kidrink']) {
      const I = G.ITEMS[id], n = S.items[id] || 0;
      if (!n && !I.buy) continue;
      h += '<div class="row"><div class="nm"><i class="gem" style="background:' + I.col + '"></i><span>' + I.name + ' x' + n + '</span>' + (S.buffs[id] ? '<span class="pill g">' + Math.ceil(S.buffs[id]) + 's</span>' : '') + '</div><div class="acts">'
        + (n ? '<button class="btn go" data-act="use" data-id="' + id + '">USE</button>' : '<button class="btn alt" data-act="buyItem" data-id="' + id + '" data-n="1"' + (S.zeni >= G.itemPrice(S, id) ? '' : ' disabled') + '>' + fmt(G.itemPrice(S, id)) + ' Z</button>') + '</div></div>';
    }
    h += '<div class="acts"><button class="btn alt" data-act="mclose">LATER</button><button class="btn gold" data-act="monoStart"' + (ready ? '' : ' disabled') + '>FIGHT!</button></div>';
    showModal(h);
  }
  function showMonoResult(e) {
    buildTechs();
    const g = G.zenkaiGain(S);
    if (e.won) {
      const R = e.reward;
      let h = '<h3>Monolith ' + (e.tier + 1) + ' shattered!</h3><div class="card loot"><span>' + capico + ' +' + R.caps + '</span><span>+' + R.itemChests + ' Item chests</span>' + (R.superChests ? '<span class="rar2">+' + R.superChests + ' SUPER chests</span>' : '') + (R.skillPts ? '<span class="rar3">+' + R.skillPts + ' Skill Point' + (R.skillPts > 1 ? 's' : '') + '</span>' : '') + '<span>Level cap ' + G.levelCap(S) + '</span></div>';
      for (const u of R.unlocks) h += '<div class="card"><b style="color:var(--gold)">NEW: ' + esc(u.name.toUpperCase()) + '</b><br>' + esc(u.desc) + '</div>';
      for (const hh of R.helpers) h += '<div class="card"><b style="color:#5fd35a">NEW Z-FIGHTER: ' + G.helperView(S, hh).name.toUpperCase() + '</b><br>Hire them at Capsule Corp with Z points.</div>';
      for (const t of R.techs) h += '<div class="card"><b style="color:#5fd35a">NEW TECHNIQUE: ' + G.TECHS[t].name.toUpperCase() + '</b><br>' + G.TECHS[t].desc + '</div>';
      showModal(h + '<div class="acts"><button class="btn gold" data-act="mclose">KEEP GOING</button></div>');
    } else {
      showModal('<h3>Katchin held</h3><p>You chipped off ' + Math.round(e.dealt * 100) + '% this time. It is down to ' + Math.round((1 - e.frac) * 100) + '% HP, and <b style="color:var(--gold)">the damage stays</b>: every try wears it down further. Next try in ' + G.fmtTime(G.TUNE.monoCooldown) + '.</p>'
        + '<p class="mute">' + (g ? 'Zenkai now for +' + g + ' Zenkai Points, or keep training and try again.' : 'Reach Power Level ' + G.TUNE.zenkaiLevel + ' to Zenkai and come back stronger.') + '</p>'
        + '<div class="acts"><button class="btn alt" data-act="mclose">TRAIN MORE</button>' + (g ? '<button class="btn gold" data-act="zenkaiAsk">ZENKAI +' + g + '</button>' : '') + '</div>');
    }
  }
  function showZenkaiConfirm() {
    const g = G.zenkaiGain(S);
    const zpTip = G.has(S, 'companions') && S.zeni >= G.zpCost(S, 1)
      ? '<p class="tipline"><b>TIP:</b> your ' + fmt(S.zeni) + ' Zeni is about to reset, but Z points stay. Right now it would buy <b>' + fmt(G.zpMax(S)) + ' Z points</b> (Capsule Corp, Z-Fighters, MAX).</p>'
      : '<p class="tipline"><b>TIP:</b> ' + pickTip() + '</p>';
    showModal('<h3>Go Zenkai?</h3><p>You come back stronger: <b class="big">+' + g + '</b> Zenkai Points.</p><p class="mute">Level, Zeni, parts, alloy, floors and Disc upgrades reset. Everything else stays.</p>' + zpTip
      + '<div class="acts"><button class="btn alt" data-act="mclose">NOT YET</button><button class="btn gold" data-act="zenkaiGo">ZENKAI</button></div>');
  }

  // ------------------------------------------------------------------ leaving and coming back
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  // for debugging from the console: DBZIdle.S is the save, DBZIdle.W the live field
  window.DBZIdle = { get S() { return S; }, get W() { return W; }, save };

  // the viewer can hot-swap a new version of the page; carry the save across
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ save: S ? JSON.stringify(S) : null }));
  const start = (data) => {
    const go = () => boot(data || {});
    const fonts = document.fonts && document.fonts.load ? document.fonts.load('8px Silkscreen') : Promise.resolve();
    Promise.race([Promise.all([fonts, Render.load()]), new Promise((r) => setTimeout(r, 2500))]).then(go, go);
  };
  if (hot && hot.ready) hot.ready(start); else start(hot && hot.data ? hot.data : {});
})();
