// Economy sim: a bot plays DBZ Idle with the real rules (src/core.js) and logs when it reaches each milestone.
// Usage: node tools/sim.js [hours=6] [handsOn=0.7] [runs=1]
//   handsOn: share of the time the bot holds the disc down (a person plays in bursts; 1 = never lets go)
const path = require('path');
const G = require(path.join(__dirname, '..', 'src', 'core.js'));

const HOURS = +process.argv[2] || 6;
const HANDS = process.argv[3] != null ? +process.argv[3] : 0.7;
const RUNS = +process.argv[4] || 1;

function run() {
  let now = 0;
  const S = G.newState(now);
  const W = G.newWorld();
  W.bounds = { x0: 30, y0: 60, x1: 150, y1: 260 };
  const input = { down: false, x: 60, y: 100 };
  const log = [];
  const mark = (msg) => log.push(fmtT(now / 1000) + '  ' + msg);
  const floorsSeen = new Set();
  const dt = 0.1;
  let decideT = 0, handT = 0;
  const end = HOURS * 3600 * 1000;
  while (now < end) {
    handT += dt;
    input.down = W.mode === 'mono' ? true : handT % 20 < 20 * HANDS;
    aim(S, W, input);
    G.tick(S, W, dt, input, now);
    for (const e of W.events) {
      if (e.type === 'floor' && e.first && e.floor % 10 === 0 && !floorsSeen.has(e.floor)) { floorsSeen.add(e.floor); mark('first time on floor ' + e.floor); }
      if (e.type === 'monoEnd') {
        mark('Monolith ' + (e.tier + 1) + (e.won ? ' WON' : ' failed at ' + Math.round(e.frac * 100) + '%') + '  (Ki Power lv ' + (S.up.power || 0) + ', PL ' + S.level + ', floor ' + S.floor + ')');
        if (!e.won) maybeZenkai(S, W, now, mark, e);
      }
      if (e.type === 'wish') mark('Buu Wish: ' + e.id);
    }
    W.events.length = 0;
    decideT += dt;
    if (decideT >= 1) { decideT = 0; decide(S, W, now); }
    now += dt * 1000;
  }
  const C = G.calc(S);
  mark('END: PL ' + S.level + '/' + G.levelCap(S) + ', floor ' + S.floor + ' (best ' + S.maxFloor + '), Monoliths ' + S.mono.tier + ', Zenkai x' + S.zenkai.count + ', Ki Power ' + G.fmt(C.basePower) + ' (lv ' + (S.up.power || 0) + '), caps ' + S.caps + ', chests ' + S.stats.chests + '/' + S.stats.supers);
  if (process.env.SIM_DUMP) console.log(JSON.stringify({zeni: S.zeni, up: S.up, parts: S.parts, alloy: S.alloy, floor: S.floor}));
  if (process.env.SIM_DUMP) console.log(JSON.stringify({zeni: S.zeni, up: S.up, parts: S.parts, alloy: S.alloy, floor: S.floor}));
  return log;
}

function aim(S, W, input) {
  if (W.mode === 'mono' && W.mono) { input.x = W.mono.x; input.y = W.mono.y - W.mono.h / 2; return; }
  if (!W.nodes.length) return;
  const R = G.calc(S).radius;
  let best = null, bestN = -1;
  for (const n of W.nodes) {
    const k = W.nodes.filter((m) => (m.x - n.x) ** 2 + (m.y - n.y) ** 2 < (R * 1.6) ** 2).length;
    if (k > bestN) { bestN = k; best = n; }
  }
  input.x += (best.x - input.x) * 0.35;
  input.y += (best.y - best.r * 0.7 - input.y) * 0.35;
}

function needs(S) {
  const need = {};
  for (const k of G.UP_KEYS) {
    const l = S.up[k] || 0;
    if (l >= G.UPS[k].max) continue;
    for (const [id, n] of G.upCost(k, l).alloy) need[id] = Math.max(need[id] || 0, n);
  }
  for (const w of G.WORKSHOP) {
    if (!G.wsOpen(S, w) || (S.ws[w.id] || 0) >= w.max) continue;
    for (const [id, n] of G.wsCost(w, S.ws[w.id] || 0).alloy) need[id] = Math.max(need[id] || 0, n);
  }
  return need;
}

function decide(S, W, now) {
  const C = G.calc(S);
  G.goalsFor(S, now);
  G.claimGoal(S, W, now);
  if (W.bulma) G.catchBulma(S, W, now);
  for (const k of G.TECH_KEYS) if (W.nodes.length >= 3) G.useTech(S, W, k);
  // forms: the top step; transform on a full Ki bar, but keep the Ki for a Monolith that's about to open
  const top = G.formsOpenTop(S);
  if (top) {
    if (S.formSel !== top) G.selectForm(S, W, top);
    const soon = W.mode === 'field' && S.mono.readyAt - now < 40000;
    if (!S.formOn && !soon && S.ki >= C.kiMax * 0.98) G.transform(S, W);
  }
  G.openChests(S, 'item', 1000);
  G.openChests(S, 'super', 1000);
  // refine what upgrades ask for, sell the rest
  const need = needs(S);
  for (const m of G.MACHINES) {
    if (!(S.parts[m.id] > 0)) continue;
    const short = Math.max(0, (need[m.id] || 0) * 2 - (S.alloy[m.id] || 0));
    if (short > 0) G.refine(S, m.id, short);
    const keep = (need[m.id] || 0) * C.ratio * 2;
    if ((S.parts[m.id] || 0) > keep) G.sell(S, m.id, S.parts[m.id] - keep);
  }
  // spend: cheapest useful thing first (Ki Power weighted)
  for (let i = 0; i < 30; i++) {
    let pick = null, cost = Infinity;
    const consider = (c, fn, w) => { if (c * w < cost) { cost = c * w; pick = fn; } };
    for (const k of G.UP_KEYS) {
      const l = S.up[k] || 0;
      if (l >= G.UPS[k].max) continue;
      const c = G.upCost(k, l);
      if (G.canAfford(S, c)) consider(c.zeni, () => G.buyUp(S, k), k === 'power' ? 0.5 : 1);
    }
    for (const w of G.WORKSHOP) {
      if (!G.wsOpen(S, w) || (S.ws[w.id] || 0) >= w.max) continue;
      const c = G.wsCost(w, S.ws[w.id] || 0);
      if (G.canAfford(S, c)) consider(c.zeni, () => G.buyWs(S, w.id), 1.2);
    }
    // Z-Fighters cost Z points: weigh each by the Zeni it takes to buy the points still missing
    const viaZp = (zcost, buy, w) => {
      const need = Math.max(0, zcost - S.zp);
      const zeni = need ? G.zpCost(S, need) : 0;
      if (zeni <= S.zeni) consider(Math.max(zeni, 1), () => { if (need) G.buyZp(S, need); buy(); }, w);
    };
    for (const h of G.HELPERS) {
      if (!G.has(S, 'companions') || S.mono.tier < h.mono) continue;
      if (!S.helpers[h.id]) { viaZp(h.hire, () => G.hire(S, h.id), 0.6); continue; }
      for (const k of ['dmg', 'spd', 'multi']) {
        if (S.helpers[h.id][k] < G.COMP_UPS[k].max) viaZp(G.compUpCost(h, k, S.helpers[h.id][k]), () => G.upHelper(S, h.id, k), 1.5);
      }
    }
    if (!pick) break;
    pick();
  }
  // blocked on Ki Power by a part this floor barely sends? go back up and farm it, then come back down
  const pc = G.upCost('power', S.up.power || 0);
  const miss = pc.alloy.find(([id, n]) => (S.alloy[id] || 0) + Math.floor((S.parts[id] || 0) / C.ratio) < n);
  if (W.mode === 'field') {
    if (miss) {
      const f = Math.min(S.maxFloor, 2 * G.MACH[miss[0]].t + 2);
      const t = G.MACH[miss[0]].t;
      if (2 * t + 2 <= S.maxFloor && G.floorPool(S.floor).every(([x]) => x !== t)) { G.setFloor(S, W, f); S.stay = true; }
      else if (2 * t + 2 > S.maxFloor && S.stay) { S.stay = false; G.setFloor(S, W, S.maxFloor); }
    } else if (S.stay) { S.stay = false; G.setFloor(S, W, S.maxFloor); }
  }
  for (const s of G.SKILLS) G.buySkill(S, s.id);
  for (const s of ['sp', 'house', 'member', 'pouch', 'plane']) G.buyStore(S, s);
  // cards: Transform the cheapest owned card with spare Rainbow Capsules
  if (G.has(S, 'cards')) {
    const gild = G.CARDS.filter((k) => S.cards[k.id] === 1).sort((a, b) => G.transformCost(a.id) - G.transformCost(b.id))[0];
    if (gild && S.caps >= G.transformCost(gild.id) + 30) G.transformCard(S, gild.id);
  }
  // contracts: refine toward the order, deliver it, otherwise swap it; spend CP on the cheapest upgrade
  const o = G.ctCurrent(S);
  if (o) {
    const short = o.n - (S.alloy[o.id] || 0);
    if (short > 0) G.refine(S, o.id, short);
    if (!G.ctDeliver(S, W) && (S.parts[o.id] || 0) < C.ratio) G.ctReroll(S, now);
    for (let i = 0; i < 20; i++) {
      const u = G.CT_UPS.filter((x) => G.ctOpen(S, x) && (S.ct.up[x.id] || 0) < G.ctMax(S, x)).sort((a, b) => G.ctUpCost(S, a, S.ct.up[a.id] || 0) - G.ctUpCost(S, b, S.ct.up[b.id] || 0))[0];
      if (!u || !G.buyCt(S, u.id)) break;
    }
  }
  // Monolith: pop buffs and go
  if (W.mode === 'field' && G.monoReady(S, now)) {
    for (const id of ['weights', 'gravity', 'turbo', 'discap', 'chamber', 'ritual', 'potara']) {
      if (!(S.items[id] > 0) && G.ITEMS[id].buy && G.itemPrice(S, id) < S.zeni * 0.3) G.buyItem(S, id, 1);
      G.useItem(S, W, id);
    }
    if (G.startMono(S, W, now) && top && !S.formOn) G.transform(S, W);
  }
}

function maybeZenkai(S, W, now, mark, e) {
  const g = G.zenkaiGain(S);
  if (g <= 0 || e.frac > 0.7) return;
  if (g < 10 + S.zenkai.total * 0.8) return;
  G.buyZp(S, G.zpMax(S)); // Zeni resets, Z points stay: dump it all first
  G.zenkai(S, W, now);
  mark('ZENKAI #' + S.zenkai.count + ' +' + g + ' pts');
  for (let i = 0; i < 60; i++) {
    let pick = null, cost = Infinity;
    for (const z of G.ZK) {
      const l = S.zenkai.up[z.id] || 0;
      if (!G.zkTierOpen(S, z.tier) || l >= z.max) continue;
      const c = G.zkCost(z, l) * ({ power: 0.6, weak: 0.8, time: 0.9 }[z.id] || 1.2);
      if (G.zkCost(z, l) <= S.zenkai.pts && c < cost) { cost = c; pick = z.id; }
    }
    if (!pick) break;
    G.buyZk(S, pick);
  }
}

const fmtT = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h + 'h').padStart(4) + String(m).padStart(2, '0') + 'm'; };

for (let r = 0; r < RUNS; r++) {
  console.log('--- run ' + (r + 1) + ' (' + HOURS + 'h, hands on ' + Math.round(HANDS * 100) + '%)');
  console.log(run().join('\n'));
}
