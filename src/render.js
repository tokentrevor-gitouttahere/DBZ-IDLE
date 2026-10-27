// DBZ Idle - pixel renderer. The field is drawn at a low "game pixel" resolution (about 175 px across on a phone)
// and scaled up with nearest-neighbour, so every sprite lands on the pixel grid.
// Levels are built from the craftpix tilesets (gen_tiles.js), machines come from the sprite atlas (gen_sprites.js) and
// are repainted per variant (primary colours, hazard stripes, badges), fighters are the fight sim's rigs drawn small.
const Render = (() => {
  const G = IdleCore;
  let cv, ctx, GW = 175, GH = 380, PX = 3, DPR = 1;
  const INK = '#141416';
  const cache = { ground: {}, mach: {}, mono: {}, rig: {}, thumb: {} };
  let fx = [], texts = [], flash = null, shake = 0, armorNote = 0, t = 0;
  let helperFrom = {};
  let reduce = false;
  let atlasM = null, atlasT = null;

  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  const px = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, 1, 1); };

  // the two atlases are data: URLs; boot waits for them
  function load() {
    const img = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    const arts = typeof FORM_ART !== 'undefined' ? Object.keys(FORM_ART) : [];
    return Promise.all([img(MACHINE_SPRITES.atlas), img(LEVEL_TILES.atlas)].concat(arts.map((k) => img(FORM_ART[k].src).then((i) => { artImg[k] = i; })))).then(([a, b]) => { atlasM = a; atlasT = b; });
  }
  const artImg = {};
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }
  }
  // size the canvas to whole game pixels: PX device pixels per game pixel
  function resize(cssW, cssH, dpr) {
    DPR = dpr || 1;
    PX = Math.max(2, Math.round(2.2 * DPR));
    GW = Math.ceil((cssW * DPR) / PX);
    GH = Math.ceil((cssH * DPR) / PX);
    cv.width = GW;
    cv.height = GH;
    cv.style.width = (GW * PX) / DPR + 'px';
    cv.style.height = (GH * PX) / DPR + 'px';
    ctx.imageSmoothingEnabled = false;
    cache.ground = {};
    return { GW, GH, scale: PX / DPR };
  }
  const toGame = (cssX, cssY) => [(cssX * DPR) / PX, (cssY * DPR) / PX];
  function setHelperOrigins(m) { helperFrom = m; }
  function setReduce(v) { reduce = v; }

  // ------------------------------------------------------------------ colour helpers
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (x) => { x = (x + 360) % 360; return x < 60 ? p + (q - p) * x / 60 : x < 180 ? q : x < 240 ? p + (q - p) * (240 - x) / 60 : p; };
    return [f(h + 120) * 255, f(h) * 255, f(h - 120) * 255];
  }

  // ------------------------------------------------------------------ levels (tilesets)
  // A region's floor is one tile family laid in a grid, a second family in noise-shaped patches, a light sprinkle of
  // detail, then a few built set pieces (gen_tiles.js REGIONS: feat) placed down the sides so the middle stays open.
  function ground(region) {
    const key = region + ':' + GW + 'x' + GH;
    if (cache.ground[key]) return cache.ground[key];
    const R = LEVEL_TILES.regions[region], P = LEVEL_TILES.pieces;
    const c = mk(GW, GH), g = c.getContext('2d');
    const rnd = rng(7919 * (region + 1) + GW * 13 + GH);
    if (!atlasT) { g.fillStyle = G.REGIONS[region].ground[0]; g.fillRect(0, 0, GW, GH); cache.ground[key] = c; return c; }
    const pieceOf = (name) => P[name][Math.floor(rnd() * P[name].length)];
    const put = (name, x, y, i) => { const p = i == null ? pieceOf(name) : P[name][i % P[name].length]; g.drawImage(atlasT, p[0], p[1], p[2], p[3], Math.round(x - p[2] / 2), Math.round(y - p[3]), p[2], p[3]); return p; };
    // value noise for patches
    const nw = Math.ceil(GW / 32) + 3, nh = Math.ceil(GH / 32) + 3;
    const cellv = Array.from({ length: nw * nh }, () => rnd());
    const noise = (x, y) => {
      const fx = x / 48, fy = y / 48;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const v = (i, j) => cellv[(j % nh) * nw + (i % nw)];
      const sm = (t) => t * t * (3 - 2 * t);
      const a1 = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sm(tx), a2 = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sm(tx);
      return a1 + (a2 - a1) * sm(ty);
    };
    const ts = P[R.base][0][2];
    for (let y = 0; y < GH; y += ts) for (let x = 0; x < GW; x += ts) {
      let fam = R.base;
      if (R.patch && noise(x + ts / 2, y + ts / 2) > R.patch[1]) fam = R.patch[0];
      const list = P[fam];
      // mostly the family's first few tiles, now and then another: reads as one surface
      const p = list[rnd() < 0.7 ? Math.floor(rnd() * Math.min(3, list.length)) : Math.floor(rnd() * list.length)];
      g.drawImage(atlasT, p[0], p[1], p[2], p[3], x, y, ts, ts);
    }
    for (const [name, per] of R.detail) {
      const n = Math.floor(per * GW * GH / 10000 + rnd());
      for (let i = 0; i < n; i++) put(name, rnd() * GW, rnd() * GH);
    }
    // set pieces: alternate sides, spread top to bottom
    const late = []; // drawn after the tint, in their own colours (water, lava)
    const feats = R.feat;
    feats.forEach((f, i) => {
      const side = i % 2;
      const y = GH * (0.2 + (0.68 * (i + 0.5)) / feats.length) + (rnd() - 0.5) * 16;
      const x = side ? GW * (0.72 + rnd() * 0.1) : GW * (0.16 + rnd() * 0.1);
      if (FEAT[f]) FEAT[f](g, x, y, side, { rnd, put, P, R, region, late });
    });
    // the region's tint, kept a little dark so the machines stand out
    const [dh, sm, lm] = R.tint;
    const d = g.getImageData(0, 0, GW, GH), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const [h, s2, l] = rgb2hsl(a[i], a[i + 1], a[i + 2]);
      const [r, gg, bb] = hsl2rgb(h + dh, Math.min(1, s2 * sm * 0.85), l * lm * 0.82);
      a[i] = r; a[i + 1] = gg; a[i + 2] = bb; a[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    for (const fn of late) fn(g);
    cache.ground[key] = c;
    return c;
  }
  const sortY = (list) => list.sort((p, q) => p[1] - q[1]);
  // a wrecked machine from this region, burnt dark, lying on a scorch mark
  function wreckAt(g, x, y, region, rnd) {
    const mine = G.MACHINES.filter((x) => x.region === region);
    const m = mine[Math.floor(rnd() * mine.length)] || G.MACHINES[0];
    const F = frames(m);
    const img = F.death.length ? F.death[F.death.length - 1] : F.idle[0];
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(Math.round(x), Math.round(y - 1), Math.max(4, img.width * 0.45), 3, 0, 0, 7); g.fill();
    g.save(); g.globalAlpha = 0.85; g.filter = 'brightness(0.55) saturate(0.4)';
    if (rnd() < 0.5) { g.translate(Math.round(x + img.width / 2), Math.round(y - img.height)); g.scale(-1, 1); g.drawImage(img, 0, 0); }
    else g.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height));
    g.restore();
  }
  const FEAT = {
    // a street across the screen: asphalt, kerbs, yellow dashes
    road(g, x, y) {
      const h = 18, y0 = Math.round(y - h / 2);
      g.fillStyle = '#2b2b2f'; g.fillRect(0, y0, GW, h);
      g.fillStyle = '#4a4a50'; g.fillRect(0, y0, GW, 1); g.fillRect(0, y0 + h - 1, GW, 1);
      g.fillStyle = '#1e1e22'; g.fillRect(0, y0 + 1, GW, 1);
      g.fillStyle = '#c9a43a'; for (let i = 2; i < GW; i += 10) g.fillRect(i, y0 + (h >> 1), 5, 1);
      g.fillStyle = '#35353a'; for (let i = 0; i < GW; i += 3) if ((i * 7) % 5 === 0) g.fillRect(i, y0 + 3 + ((i * 13) % (h - 6)), 1, 1);
    },
    // a dirt track that wanders down the screen
    path(g, x, y, side, k) {
      g.fillStyle = 'rgba(70,45,25,0.45)';
      let px0 = x;
      for (let yy = 0; yy < GH; yy++) { px0 += (k.rnd() - 0.5) * 1.2 + Math.sin(yy / 23) * 0.3; g.fillRect(Math.round(px0 - 5), yy, 10, 1); }
    },
    // a fenced storage yard: crates in rows, barrels in a corner, a gate
    yard(g, x, y, side, k) {
      const w = 56, h = 40, x0 = Math.round(x - w / 2), y0 = Math.round(y - h / 2);
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x0, y0, w, h);
      g.fillStyle = '#23201c'; g.fillRect(x0, y0, w, 1); g.fillRect(x0, y0 + h - 1, w, 1); g.fillRect(x0, y0, 1, h); g.fillRect(x0 + w - 1, y0, 1, h);
      g.fillStyle = '#7a6a52';
      for (let i = 0; i <= w; i += 7) { g.fillRect(x0 + Math.min(i, w - 2), y0 - 2, 2, 3); g.fillRect(x0 + Math.min(i, w - 2), y0 + h - 2, 2, 3); }
      for (let j = 0; j <= h; j += 7) { g.fillRect(x0 - 1, y0 + Math.min(j, h - 2), 3, 2); g.fillRect(x0 + w - 2, y0 + Math.min(j, h - 2), 3, 2); }
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x0 + (side ? 2 : w - 16), y0 + h - 2, 14, 3); // the gate
      const crates = k.P.v_box.concat(k.P.d_obj.filter((p) => p[2] >= 9 && p[3] >= 9));
      const ci = Math.floor(k.rnd() * crates.length);
      for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
        const p = crates[(ci + ((i + r) % 2)) % crates.length];
        g.drawImage(atlasT, p[0], p[1], p[2], p[3], x0 + 4 + i * 12, y0 + 4 + r * 16, Math.min(p[2], 11), Math.min(p[3], 14));
      }
    },
    // a junk heap: crates, barrels and machine scrap piled on each other
    junk(g, x, y, side, k) {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(Math.round(x), Math.round(y + 3), 26, 10, 0, 0, 7); g.fill();
      const ps = [];
      for (let i = 0; i < 14; i++) { const an = k.rnd() * 6.28, r = Math.sqrt(k.rnd()) * 16; ps.push([x + Math.cos(an) * r * 1.4, y + Math.sin(an) * r * 0.6]); }
      for (const [a, b] of sortY(ps)) { if (k.rnd() < 0.4) wreckAt(g, a, b, k.region, k.rnd); else k.put(k.rnd() < 0.5 ? 'd_obj' : 'v_box', a, b); }
      g.fillStyle = '#5d6670'; for (let i = 0; i < 30; i++) g.fillRect(Math.round(x + (k.rnd() - 0.5) * 64), Math.round(y + (k.rnd() - 0.5) * 24), 1, 1);
    },
    // a few burnt-out machines from earlier fights
    wreck(g, x, y, side, k) {
      const ps = [];
      for (let i = 0; i < 2 + Math.floor(k.rnd() * 2); i++) ps.push([x + (k.rnd() - 0.5) * 44, y + (k.rnd() - 0.5) * 26]);
      for (const [a, b] of sortY(ps)) wreckAt(g, a, b, k.region, k.rnd);
    },
    // a camp: a tent, crates and a stone fire ring
    camp(g, x, y, side, k) {
      k.put('v_tent', x, y + 10);
      const fx = x + (side ? -34 : 34), fy = y + 16;
      for (let i = 0; i < 8; i++) { const an = (i / 8) * 6.28; k.put('v_stone', fx + Math.cos(an) * 7, fy + Math.sin(an) * 4, i); }
      g.fillStyle = '#3a2410'; g.fillRect(Math.round(fx - 2), Math.round(fy - 3), 5, 2);
      k.put('v_box', x + (side ? 24 : -24), y + 16); k.put('v_box', x + (side ? 31 : -31), y + 19);
    },
    outcrop(g, x, y, side, k) { const ps = []; for (let i = 0; i < 6; i++) ps.push([x + (k.rnd() - 0.5) * 38, y + (k.rnd() - 0.5) * 18]); for (const [a, b] of sortY(ps)) k.put(k.rnd() < 0.6 ? 'u_rock' : 'v_stone', a, b); },
    grove(g, x, y, side, k) { const ps = []; for (let i = 0; i < 5; i++) ps.push([x + (k.rnd() - 0.5) * 46, y + (k.rnd() - 0.5) * 26]); for (const [a, b] of sortY(ps)) k.put(k.rnd() < 0.5 ? 'u_tree' : 'u_plant', a, b); },
    ruins(g, x, y, side, k) {
      const ps = []; for (let i = 0; i < 3; i++) ps.push([x + (k.rnd() - 0.5) * 42, y + (k.rnd() - 0.5) * 20]);
      for (const [a, b] of sortY(ps)) k.put('u_ruin', a, b);
      for (let i = 0; i < 4; i++) k.put('u_rock', x + (k.rnd() - 0.5) * 52, y + 10 + (k.rnd() - 0.5) * 10);
    },
    crystals(g, x, y, side, k) {
      const ps = []; for (let i = 0; i < 7; i++) ps.push([x + (k.rnd() - 0.5) * 34, y + (k.rnd() - 0.5) * 18, i < 2 ? 0 : i < 4 ? 1 : 2]);
      for (const [a, b, i] of sortY(ps)) k.put(k.R.crystal, a, b, i);
    },
    reef(g, x, y, side, k) { const ps = []; for (let i = 0; i < 8; i++) ps.push([x + (k.rnd() - 0.5) * 42, y + (k.rnd() - 0.5) * 22]); for (const [a, b] of sortY(ps)) k.put(k.rnd() < 0.5 ? 's_small' : 's_mid', a, b); },
    ship(g, x, y, side, k) { k.put('s_big', x, y + 20); },
    // the sea along one edge, with foam on the shoreline
    sea(g, x, y, side, k) {
      const edge = []; let w = 26 + k.rnd() * 8;
      for (let yy = 0; yy < GH; yy++) { w += (k.rnd() - 0.5) * 1.5 + Math.sin(yy / 17) * 0.4; w = Math.max(18, Math.min(42, w)); edge.push(Math.round(w)); }
      k.late.push((g2) => {
        for (let yy = 0; yy < GH; yy++) {
          const ww = edge[yy], x0 = side ? GW - ww : 0;
          g2.fillStyle = '#1d4a5c'; g2.fillRect(x0, yy, ww, 1);
          g2.fillStyle = '#2a6378'; for (let i = 0; i < ww; i += 9) if (((yy >> 2) + (i >> 3)) % 3 === 0) g2.fillRect(x0 + i + ((yy >> 3) % 3), yy, 4, 1);
          g2.fillStyle = '#d9eef2'; g2.fillRect(side ? x0 - 1 : x0 + ww - 1, yy, 2, 1);
          g2.fillStyle = 'rgba(217,238,242,0.35)'; g2.fillRect(side ? x0 - 3 : x0 + ww + 1, yy, 2, 1);
        }
      });
    },
    crater(g, x, y, side, k) {
      const rx = 22, ry = 10;
      for (let yy = -ry - 2; yy <= ry + 2; yy++) for (let xx = -rx - 3; xx <= rx + 3; xx++) {
        const dd = (xx * xx) / (rx * rx) + (yy * yy) / (ry * ry);
        if (dd > 1.25) continue;
        g.fillStyle = dd > 1 ? (yy < 0 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.25)') : dd > 0.75 ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.5)';
        g.fillRect(Math.round(x + xx), Math.round(y + yy), 1, 1);
      }
      for (let i = 0; i < 4; i++) k.put('u_rock', x + (k.rnd() - 0.5) * 62, y + (k.rnd() < 0.5 ? -12 : 18));
    },
    // glowing cracks in the ground (drawn after the tint so they stay hot)
    lava(g, x, y, side, k) {
      const lines = [];
      for (let s2 = 0; s2 < 5; s2++) { let a = x + (k.rnd() - 0.5) * 30, b = y + (k.rnd() - 0.5) * 30; const l = []; for (let i = 0; i < 40; i++) { l.push([a | 0, b | 0]); a += (k.rnd() - 0.5) * 3; b += k.rnd() < 0.5 ? 1 : -1; } lines.push(l); }
      k.late.push((g2) => { for (const l of lines) for (const [a, b] of l) { g2.fillStyle = '#ff6a2a'; g2.fillRect(a - 1, b, 3, 1); g2.fillStyle = '#ffd34d'; g2.fillRect(a, b, 1, 1); } });
    }
  };

  // ------------------------------------------------------------------ machines (atlas + variants)
  const PAINT_HUE = { orange: 24, red: 2, blue: 218, yellow: 48, green: 128, purple: 278 };
  // a Red Ribbon badge and a flag, as tiny pixel stamps (. = clear)
  const BADGE = ['.rrrrrrr.', 'rwwrrwwrr', 'rwrwrwrwr', 'rwwrrwwrr', 'rwrwrwrwr', 'rwrwrwrwr', '.rrrrrrr.'];
  const FLAG = ['bbbbrrrrrr', 'bwbbwwwwww', 'bbbbrrrrrr', 'bwbbwwwwww', 'rrrrrrrrrr', 'wwwwwwwwww', 'rrrrrrrrrr'];
  const STAMP = { r: [210, 40, 40], w: [240, 240, 236], b: [40, 60, 150], k: [20, 20, 22] };
  function frames(m) {
    if (cache.mach[m.id]) return cache.mach[m.id];
    const meta = MACHINE_SPRITES.meta[m.sprite];
    const cut = (x, y, w, h) => { const c = mk(w, h); if (atlasM) c.getContext('2d').drawImage(atlasM, x, y, w, h, 0, 0, w, h); return c; };
    const idle = [], death = [];
    for (let i = 0; i < meta.n; i++) idle.push(cut(i * meta.w, meta.y, meta.w, meta.h));
    for (let i = 0; i < meta.dn; i++) death.push(cut(meta.dx + i * meta.dw, meta.y, meta.dw, meta.dh));
    // the body: solid, not the dark outline. Patterns are placed on frame 0's body and follow it frame by frame
    const all = idle.concat(death);
    const body = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const out = new Uint8Array(c.width * c.height); for (let i = 0; i < out.length; i++) { const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; out[i] = d[i * 4 + 3] > 0 && l > 38 ? 1 : 0; } return out; };
    const b0 = body(idle[0]);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sx = 0, sy = 0, n = 0;
    for (let y = 0; y < idle[0].height; y++) for (let x = 0; x < idle[0].width; x++) if (b0[y * idle[0].width + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; sy += y; n++; }
    const cx = n ? Math.round(sx / n) : idle[0].width >> 1, cy = n ? Math.round(sy / n) : idle[0].height >> 1;
    const shifts = bodyShifts(m.sprite, all, b0, idle[0].width, idle[0].height, body);
    all.forEach((c, fi) => {
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
      const B = body(c);
      // where this frame's body sits compared to frame 0: patterns and badges move with it
      const [ox0, oy] = shifts[fi];
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (!B[y * c.width + x]) continue;
        let [h, s, l] = rgb2hsl(a[i], a[i + 1], a[i + 2]);
        if (m.paint && s > 0.22) { const [r, gg, b] = hsl2rgb(PAINT_HUE[m.paint], Math.min(1, s * 0.9 + 0.15), l); a[i] = r; a[i + 1] = gg; a[i + 2] = b; }
        const yy = y - oy;
        if (m.mark === 'hazard' && yy >= y0 + (y1 - y0) * 0.28 && yy <= y0 + (y1 - y0) * 0.58) {
          const on = Math.floor((x - ox0 + yy) / 2) % 2 === 0;
          const k = 0.75 + l * 0.6;
          const base = on ? [255, 210, 50] : [28, 28, 30];
          a[i] = Math.min(255, base[0] * k); a[i + 1] = Math.min(255, base[1] * k); a[i + 2] = Math.min(255, base[2] * k);
        }
      }
      if (m.mark === 'rr' || m.mark === 'flag') {
        const S = m.mark === 'rr' ? BADGE : FLAG;
        const w = S[0].length, h = S.length;
        const ox = cx - (w >> 1) + ox0, oy2 = cy - (h >> 1) + oy;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const ch = S[y][x], X = ox + x, Y = oy2 + y;
          if (ch === '.' || X < 0 || Y < 0 || X >= c.width || Y >= c.height || !B[Y * c.width + X]) continue;
          const i = (Y * c.width + X) * 4, col = STAMP[ch];
          a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2];
        }
      }
      g.putImageData(d, 0, 0);
    });
    const white = idle.map((c) => { const w = mk(c.width, c.height), g = w.getContext('2d'); g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); return w; });
    const out = { idle, death, white, w: meta.w, h: meta.h };
    cache.mach[m.id] = out;
    return out;
  }
  // How far each frame's body has moved from frame 0's (machines bob, step and recoil). Found once per sprite by
  // sliding the frame over frame 0 and keeping the offset where the most body pixels overlap.
  const shiftCache = {};
  function bodyShifts(sprite, all, b0, w0, h0, body) {
    if (shiftCache[sprite]) return shiftCache[sprite];
    const out = all.map((c) => {
      const B = body(c), w = c.width, h = c.height;
      const bx = (w - w0) >> 1, by = h - h0; // death frames are centred and bottom-aligned in the atlas
      let best = [bx, by], score = -1;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        let n = 0;
        for (let y = 0; y < h0; y += 1) {
          const Y = y + by + dy;
          if (Y < 0 || Y >= h) continue;
          for (let x = 0; x < w0; x++) { const X = x + bx + dx; if (X >= 0 && X < w && b0[y * w0 + x] && B[Y * w + X]) n++; }
        }
        if (n > score || (n === score && Math.abs(dx) + Math.abs(dy) < Math.abs(best[0] - bx) + Math.abs(best[1] - by))) { score = n; best = [bx + dx, by + dy]; }
      }
      return best;
    });
    shiftCache[sprite] = out;
    return out;
  }
  // a small picture of a machine for the panels
  function thumb(id, size) {
    const key = id + ':' + size;
    if (cache.thumb[key]) return cache.thumb[key];
    const F = frames(G.MACH[id]);
    const f = F.idle[0];
    const c = mk(size, size), g = c.getContext('2d');
    const s = Math.min(size / f.width, size / f.height);
    const k = s >= 1 ? Math.floor(s) : s;
    g.imageSmoothingEnabled = false;
    g.drawImage(f, Math.round((size - f.width * k) / 2), Math.round(size - f.height * k), Math.round(f.width * k), Math.round(f.height * k));
    cache.thumb[key] = c;
    return c;
  }
  function tileIcon(name, i) {
    const p = LEVEL_TILES.pieces[name] && LEVEL_TILES.pieces[name][i || 0];
    const c = mk(p ? p[2] : 1, p ? p[3] : 1);
    if (p && atlasT) c.getContext('2d').drawImage(atlasT, p[0], p[1], p[2], p[3], 0, 0, p[2], p[3]);
    return c;
  }

  // ------------------------------------------------------------------ the Katchin Monolith (generated)
  function monoSprite(w, h, tier) {
    const key = w + 'x' + h + ':' + tier;
    if (cache.mono[key]) return cache.mono[key];
    const c = mk(w + 2, h + 2), g = c.getContext('2d');
    const white = mk(w + 2, h + 2), gw = white.getContext('2d');
    const R = rng(777 + tier);
    const tip = Math.max(4, Math.round(w * 0.3));
    const tint = ['#5a6676', '#5a6f6a', '#64587a', '#4d5f78', '#6e5a66'][tier % 5];
    const inside = (x, y) => y >= 0 && y < h && x >= 0 && x < w && (y >= tip || Math.abs(x - (w - 1) / 2) <= ((w - 1) / 2) * (y / tip));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const f = x / w;
      let cl = f < 0.18 ? '#8a96a6' : f < 0.5 ? tint : f < 0.82 ? '#3d4654' : '#2c333d';
      if ((y - tip) % 9 === 0 && y > tip && x > 2 && x < w - 3) cl = '#262c35';
      if (R() < 0.04) cl = '#9aa6b5';
      px(g, x + 1, y + 1, cl); px(gw, x + 1, y + 1, '#ffffff');
    }
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      if (inside(x, y)) continue;
      if (inside(x + 1, y) || inside(x - 1, y) || inside(x, y + 1) || inside(x, y - 1)) { px(g, x + 1, y + 1, INK); px(gw, x + 1, y + 1, '#ffffff'); }
    }
    for (let y = tip + 4; y < h - 6; y += 9) {
      const x0 = Math.round(w * 0.32), x1 = Math.round(w * 0.62);
      for (let x = x0; x <= x1; x++) px(g, x + 1, y + 3, '#7ce0ff');
      px(g, x0 + 2, y + 2, '#7ce0ff'); px(g, x1 - 2, y + 4, '#7ce0ff'); px(g, (x0 + x1) >> 1, y + 1, '#c9f3ff');
    }
    const cracks = [];
    for (let s = 0; s < 8; s++) {
      let x = 3 + R() * (w - 6), y = tip + R() * (h - tip - 8);
      const l = [];
      for (let k = 0; k < 8 + R() * 10; k++) { l.push([x | 0, y | 0]); x += R() < 0.5 ? 1 : -1; y += R() < 0.75 ? 1 : 0; }
      cracks.push(l.filter(([a, b]) => inside(a, b)));
    }
    const out = { c, white, cracks };
    cache.mono[key] = out;
    return out;
  }

  // ------------------------------------------------------------------ fighters (fight sim rigs, pixel-snapped)
  // opts: crop, face, pose ('idle' = the fight sim's idle pose, else the rig's rest pose),
  //   kit (a HAIRKITS id drawn over the head), hair (recolours the rig's own hair, e.g. gold for a form)
  function rigSprite(id, w, h, opts) {
    opts = opts || {};
    const key = [id, w, h, opts.crop || 1, opts.face || 1, opts.pose || '', opts.kit || '', opts.hair || ''].join(':');
    if (cache.rig[key]) return cache.rig[key];
    const out = mk(w, h);
    const S = 6, crop = opts.crop || 1;
    const big = mk(w * S, h * S), gb = big.getContext('2d');
    const figH = (h * S * 0.94) / crop;
    if (id.startsWith('art:')) {
      // a picture instead of a rig: the whole figure is figH tall from the top, body centred (crop shows the top part)
      const k = id.slice(4), im = artImg[k];
      if (!im) return out; // not loaded yet: try again next time
      const A = FORM_ART[k], s = (figH * (A.k || 1)) / im.height;
      gb.drawImage(im, (w * S) / 2 - A.cx * im.width * s, h * S * 0.03, im.width * s, im.height * s);
    } else {
      const rig = (typeof FS_RIGS !== 'undefined' ? FS_RIGS.RIGS : []).find((r) => r.id === id);
      if (!rig) { cache.rig[key] = out; return out; }
      const unit = figH / (rig.top * 0.74);
      const pose = (opts.pose && FS_RIGS.POSES && FS_RIGS.POSES[opts.pose]) || rig.rest;
      const J = FS_RIGS.rigJoints(rig, (w * S) / 2, figH + h * S * 0.03, unit, opts.face || 1, pose, 0, null);
      const kit = opts.kit && FS_RIGS.HAIRKITS ? FS_RIGS.HAIRKITS[opts.kit] || null : null;
      FS_RIGS.drawRig(gb, rig, J, 1, kit ? null : opts.hair || null, kit);
    }
    const sm = mk(w, h), gs = sm.getContext('2d');
    gs.imageSmoothingEnabled = true;
    gs.imageSmoothingQuality = 'high';
    gs.drawImage(big, 0, 0, w, h);
    const d = gs.getImageData(0, 0, w, h);
    const a = d.data;
    const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 100;
    const go = out.getContext('2d');
    const img = go.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (solid(x, y)) {
        const k = a[i + 3] / 255;
        img.data[i] = Math.min(255, a[i] / k); img.data[i + 1] = Math.min(255, a[i + 1] / k); img.data[i + 2] = Math.min(255, a[i + 2] / k); img.data[i + 3] = 255;
      } else if (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1)) {
        img.data[i] = 20; img.data[i + 1] = 20; img.data[i + 2] = 22; img.data[i + 3] = 255;
      }
    }
    go.putImageData(img, 0, 0);
    cache.rig[key] = out;
    return out;
  }

  // ------------------------------------------------------------------ Loot Bulma's plane (generated, 22 x 12)
  const PLANE = [
    '.......kk.............',
    '......kyyk............',
    '..kkkkkyyykkkkkkk.....',
    '.kwwwwwwwwwwwwwwwkk...',
    'kwwbbwwwwwwrrwwwwwwk.p',
    'kwwbbwwwwwwrrwwwwwwwkp',
    'kwwwwwwwwwwwwwwwwwwk.p',
    '.kyyyyyyyyyyyyyyyykk..',
    '..kkkkkkkkkkkkkkkk....',
    '.....k.......k........',
    '....kkk.....kkk.......'
  ];
  const PCOL = { k: INK, w: '#f2efe6', y: '#ffd34d', b: '#5fb8ff', r: '#e8443a', p: '#c9d6e3' };
  function drawPlane(x, y) {
    const bob = Math.round(Math.sin(t * 4) * 1.2);
    const X = Math.round(x - 11), Y = Math.round(y - 6) + bob;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(X + 3, Y + 22, 16, 2);
    PLANE.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch === '.' || (ch === 'p' && Math.floor(t * 20) % 2)) continue; px(ctx, X + i, Y + j, PCOL[ch]); } });
    // a glint so it reads as "tap me"
    if (Math.floor(t * 3) % 2 === 0) { px(ctx, X + 6, Y + 3, '#ffffff'); px(ctx, X + 7, Y + 3, '#ffffff'); }
  }

  // ------------------------------------------------------------------ effects
  function event(e) {
    if (e.type === 'hit' || e.type === 'monoHit') dmgNum(e);
    if (e.type === 'hit') {
      if (e.by === 'disc' && !reduce) for (let i = 0; i < 2; i++) fx.push({ k: 'spark', x: e.x + (Math.random() - 0.5) * 8, y: e.y + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 50, life: 0.18, age: 0, col: e.crit ? '#ff6a4a' : Math.random() < 0.5 ? '#fff3b0' : '#ffd34d' });
      if (e.blocked && t - armorNote > 1.2) { armorNote = t; text(e.x, e.y - 10, 'ARMOR', '#a8a49c'); }
    } else if (e.type === 'kill') {
      const m = G.MACH[e.m];
      const F = frames(m);
      if (F.death.length) fx.push({ k: 'death', F, x: e.x, y: e.y, face: e.face, life: F.death.length / 10 + 0.35, age: 0 });
      boom(e.x, e.y - m.r * 0.6, F.death.length ? 0.6 : 1);
      text(e.x, e.y - m.r * 1.6, '+' + e.qty, e.alloy ? '#c9d6e3' : m.col, e.alloy ? 'alloy' : m.col);
      if (e.caps) text(e.x, e.y - m.r * 1.6 - 10, '+' + e.caps, '#ff8fd0', 'caps');
    } else if (e.type === 'form') {
      // powering up: a flash in the form's colour and a ring off the middle of the field
      if (e.tier > 0) { flash = { col: e.col || '#ffd34d', a: 0.45 }; fx.push({ k: 'ring', x: GW / 2, y: GH / 2, life: 0.6, age: 0, col: e.col || '#ffd34d', r: 60 }); shake = reduce ? 0 : 0.2; }
    } else if (e.type === 'tech') {
      const T = G.TECHS[e.id];
      if (e.id === 'flare') { flash = { col: '#fffbe0', a: 0.75 }; for (const [x, y] of e.nodes) fx.push({ k: 'ring', x, y, life: 0.4, age: 0, col: T.col, r: 14 }); }
      else if (e.id === 'spirit') {
        fx.push({ k: 'sbomb', x: GW / 2, y: GH * 0.45, life: 0.75, age: 0 });
        for (const [x, y] of e.nodes) fx.push({ k: 'ring', x, y, life: 0.5, age: -0.6, col: '#9fe4ff', r: 22 });
        setTimeout(() => { flash = { col: '#d9f6ff', a: 0.6 }; shake = reduce ? 0 : 0.45; }, 600);
      } else if (e.id === 'kaio') { flash = { col: '#ff4a3a', a: 0.3 }; for (const [x, y] of e.nodes) fx.push({ k: 'ring', x, y, life: 0.5, age: 0, col: T.col, r: 12 }); }
      else if (e.id === 'smelt') { for (const [x, y] of e.nodes) { fx.push({ k: 'beam', x, y, life: 0.5, age: 0 }); fx.push({ k: 'ring', x, y, life: 0.45, age: 0, col: '#9fd8ff', r: 10 }); } }
      else if (e.id === 'blast' || e.id === 'barrage') { for (const [x, y] of e.nodes) { fx.push({ k: 'blast', x, y, life: 0.3, age: 0, r: e.id === 'barrage' ? 9 : 6 }); fx.push({ k: 'ring', x, y, life: 0.35, age: 0, col: T.col, r: 10 }); } }
      else if (e.id === 'cherry' || e.id === 'battery' || e.id === 'wish') { flash = { col: T.col, a: 0.25 }; fx.push({ k: 'ring', x: GW / 2, y: GH / 2, life: 0.6, age: 0, col: T.col, r: 50 }); }
      else if (e.id === 'hell') { for (let i = 0; i < 14; i++) fx.push({ k: 'orb', x: Math.random() * GW, y: Math.random() * GH * 0.7 + GH * 0.15, life: 1.2, age: -i * 0.05 }); }
      if (e.id !== 'spirit') shake = reduce ? 0 : 0.15;
    } else if (e.type === 'steal') {
      texts.push({ x: e.x, y: e.y, s: '+' + fmt(e.z) + 'Z', col: '#ffd34d', age: 0, life: 0.7, vx: 0, dmg: 1 });
    } else if (e.type === 'beam') {
      fx.push({ k: 'line', x: e.x0, y: e.y0, x1: e.x1, y1: e.y1, col: e.col, life: 0.18, age: 0 });
    } else if (e.type === 'splash') {
      fx.push({ k: 'ring', x: e.x, y: e.y, life: 0.35, age: 0, col: '#ffb347', r: 26 });
      fx.push({ k: 'blast', x: e.x, y: e.y, life: 0.3, age: 0, r: 8 });
    } else if (e.type === 'dot') {
      for (const [x, y] of e.nodes) { fx.push({ k: 'ring', x, y, life: 0.3, age: 0, col: '#8cf07a', r: 7 }); }
    } else if (e.type === 'pop') {
      for (let i = 0; i < 5; i++) fx.push({ k: 'spark', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50, life: 0.2, age: 0, col: e.col });
    } else if (e.type === 'monoHit') {
      if (!reduce && Math.random() < 0.6) fx.push({ k: 'spark', x: e.x + (Math.random() - 0.5) * 6, y: e.y + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 60, life: 0.2, age: 0, col: '#c9f3ff' });
      if (e.blocked && t - armorNote > 1.2) { armorNote = t; text(e.x, e.y - 10, 'ARMOR', '#a8a49c'); }
    } else if (e.type === 'level') {
      text(GW / 2, GH * 0.42, 'LEVEL ' + e.level, '#ffd34d', null, 1.4);
    } else if (e.type === 'bulmaGot') {
      for (let i = 0; i < 16; i++) fx.push({ k: 'spark', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120, life: 0.5, age: 0, col: ['#ff8fd0', '#ffd34d', '#7ce0ff', '#82f468'][i % 4] });
    } else if (e.type === 'monoEnd' || e.type === 'zenkai') {
      flash = { col: '#ffffff', a: 0.5 };
    }
  }
  function boom(x, y, size) {
    const n = reduce ? 5 : Math.round(14 * size);
    for (let i = 0; i < n; i++) fx.push({ k: 'chunk', x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 90, vy: -20 - Math.random() * 70, life: 0.5 + Math.random() * 0.3, age: 0, col: ['#9aa6b2', '#5d6670', '#3a4048', '#c9d6e3'][i % 4], s: Math.random() < 0.3 ? 2 : 1 });
    fx.push({ k: 'blast', x, y, life: 0.35, age: 0, r: 6 + 6 * size });
  }
  function text(x, y, s, col, icon, life, big) { texts.push({ x, y, s, col, icon, age: 0, life: life || 0.9, big, vx: 0 }); }
  // damage numbers: white for the disc, gold and big for crits, red for super crits, companions in their ki colour
  function dmgNum(e) {
    // a World 2 machine that only takes SUPER (or ULTRA) crits says so now and then
    if (e.immune && t - armorNote > 1.2) { armorNote = t; text(e.x, e.y - 10, G.CRIT_TIERS[e.immune] + '+ ONLY', '#a8a49c'); return; }
    if (!(e.d > 0)) return;
    if (e.by === 'beam' && !e.crit && Math.random() < 0.6) return; // the beam hits 8 times a second: show some
    if (e.by === 'beam' && !reduce && Math.random() < 0.5) fx.push({ k: 'spark', x: e.x + (Math.random() - 0.5) * 6, y: e.y, vx: (Math.random() - 0.5) * 70, vy: -Math.random() * 60, life: 0.2, age: 0, col: Math.random() < 0.5 ? '#ffffff' : '#bfe8ff' });
    if (texts.length > 70) texts.splice(0, texts.length - 70);
    const col = e.crit ? CRIT_COL[Math.min(e.crit, CRIT_COL.length - 1)] : e.by === 'disc' ? '#ffffff' : e.by === 'helper' ? '#ffe9a0' : e.by === 'tech' ? '#9fe4ff' : e.by === 'beam' ? '#bfe8ff' : e.by === 'burn' ? '#ff8a3a' : '#ffffff';
    const s = fmt(e.d) + '!'.repeat(Math.max(0, (e.crit || 0) - 1));
    const x = e.x + (Math.random() - 0.5) * 10;
    texts.push({ x, y: e.y - 4, s, col, age: 0, life: e.crit ? 0.8 : 0.6, big: !!e.crit, vx: (Math.random() - 0.5) * 14, dmg: 1 });
    if (e.crit >= 2) texts.push({ x, y: e.y - 18, s: G.CRIT_TIERS[e.crit], col, age: 0, life: 0.8, vx: 0, dmg: 1 });
  }
  const fmt = (n) => G.fmt(n);
  // CRIT gold, SUPER red, ULTRA violet, MEGA cyan, GIGA green, TERA pink, OMEGA white
  const CRIT_COL = ['#ffffff', '#ffd34d', '#ff5a4a', '#c45bff', '#5ad4ff', '#82f468', '#ff8fd0', '#ffffff'];

  // ------------------------------------------------------------------ the frame
  function frame(S, W, input, C, dt) {
    t += dt;
    const sx = shake > 0 ? Math.round((Math.random() - 0.5) * 3) : 0, sy = shake > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    shake = Math.max(0, shake - dt);
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    ctx.drawImage(ground(G.regionOf(S.floor)), 0, 0);
    ctx.font = '8px Silkscreen, monospace';
    ctx.textBaseline = 'alphabetic';

    // machines, back to front; anchor = feet
    const nodes = W.nodes.slice().sort((a, b) => a.y - b.y);
    for (const n of nodes) {
      const m = G.MACH[n.m];
      const F = frames(m);
      const k = Math.floor((t + n.ph) * 7) % F.idle.length;
      const img = n.flash > 0 ? F.white[k] : F.idle[k];
      const pop = n.born < 0.2 ? Math.round((1 - n.born / 0.2) * 4) : 0;
      const jx = n.flash > 0 && !reduce ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const x = Math.round(n.x - F.w / 2) + jx, y = Math.round(n.y - F.h) - pop;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.round(n.x - n.r * 0.8), Math.round(n.y) - 1, Math.round(n.r * 1.6), 2);
      if (n.face < 0) { ctx.save(); ctx.translate(x + F.w, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore(); }
      else ctx.drawImage(img, x, y);
      const f = n.hp / n.max;
      if (f < 1) {
        const bx = Math.round(n.x - 8), by = y - 3;
        ctx.fillStyle = INK; ctx.fillRect(bx - 1, by - 1, 18, 4);
        ctx.fillStyle = '#3a1416'; ctx.fillRect(bx, by, 16, 2);
        ctx.fillStyle = '#e5484d'; ctx.fillRect(bx, by, Math.max(1, Math.round(16 * f)), 2);
      }
      if (n.marks.flare) { const fx0 = x + 1, fy = y + 1; px(ctx, fx0 + 1, fy, '#fff3a0'); px(ctx, fx0, fy + 1, '#fff3a0'); px(ctx, fx0 + 2, fy + 1, '#fff3a0'); px(ctx, fx0 + 1, fy + 2, '#fff3a0'); }
      if (n.marks.kaio) { ctx.fillStyle = '#ff5a4a'; ctx.fillRect(x + F.w - 3, y + 1, 2, 2); }
    }

    // the Monolith
    if (W.mode === 'mono' && W.mono) {
      const M = W.mono;
      const w = Math.round(M.w), h = Math.round(M.h);
      const sp = monoSprite(w, h, M.tier);
      const x = Math.round(M.x - w / 2) - 1, y = Math.round(M.y - h) - 1;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x - 3, y + h + 1, w + 8, 3);
      ctx.fillStyle = 'rgba(124,224,255,' + (0.12 + 0.06 * Math.sin(t * 3)) + ')';
      ctx.fillRect(x - 2, y + 4, w + 6, h - 2);
      ctx.drawImage(M.flash > 0 ? sp.white : sp.c, x, y);
      M.flash = Math.max(0, M.flash - dt);
      const f = 1 - M.hp / M.max;
      const show = Math.floor(f * sp.cracks.length * 1.2);
      for (let i = 0; i < Math.min(show, sp.cracks.length); i++) for (const [cx, cy] of sp.cracks[i]) px(ctx, x + 1 + cx, y + 1 + cy, INK);
    }

    if (W.bulma) drawPlane(W.bulma.x, W.bulma.y);

    // companion projectiles: each fighter throws their own
    for (const s of W.shots) {
      if (s.t < 0) continue;
      drawShot(s);
    }

    if (W.beamOn) drawBeams(G.beamRays(S, W, C, input), C.beamWidth, G.beamLookOf(S), S.formOn > 0 ? G.formLook(S, S.formOn) : null);
    else if (input.down) {
      if (S.formOn > 0) drawAura(input.x, input.y, C.radius, G.formLook(S, S.formOn));
      drawDisc(input.x, input.y, C.radius);
    }
    // burning machines smoke and flicker orange
    if (!reduce) for (const n of W.nodes) if (n.burn && Math.random() < 0.25) fx.push({ k: 'spark', x: n.x + (Math.random() - 0.5) * n.r, y: n.y - n.r * (0.4 + Math.random() * 0.8), vx: (Math.random() - 0.5) * 10, vy: -20 - Math.random() * 20, life: 0.35, age: 0, col: ['#ff6a2a', '#ffb030', '#ffd34d', '#5d5650'][Math.floor(Math.random() * 4)] });

    // particles
    for (const p of fx) {
      p.age += dt;
      if (p.age < 0) continue;
      const k = p.age / p.life;
      if (p.k === 'spark' || p.k === 'chunk') {
        p.vy += (p.k === 'chunk' ? 170 : 60) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.fillStyle = p.col;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s || 1, p.s || 1);
      } else if (p.k === 'death') {
        const i = Math.min(p.F.death.length - 1, Math.floor(p.age * 10));
        const img = p.F.death[i];
        const x = Math.round(p.x - img.width / 2), y = Math.round(p.y - img.height);
        ctx.globalAlpha = p.age > p.life - 0.3 ? Math.max(0, (p.life - p.age) / 0.3) : 1;
        if (p.face < 0) { ctx.save(); ctx.translate(x + img.width, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore(); } else ctx.drawImage(img, x, y);
        ctx.globalAlpha = 1;
      } else if (p.k === 'blast') {
        const r = Math.round(2 + p.r * Math.min(1, k * 1.8));
        disc(p.x, p.y, r + 1, k < 0.5 ? '#ffb030' : '#7a3a1a');
        if (k < 0.6) disc(p.x, p.y, Math.max(1, r - 2), '#ffe36a');
        if (k < 0.3) disc(p.x, p.y, Math.max(1, r - 4), '#ffffff');
      } else if (p.k === 'ring') {
        ring(p.x, p.y, 2 + p.r * k, p.col, 1 - k);
        if (k < 0.3) ring(p.x, p.y, 1 + p.r * k * 0.5, '#ffffff', 1);
      } else if (p.k === 'line') {
        const n = Math.max(2, Math.round(Math.hypot(p.x1 - p.x, p.y1 - p.y)));
        ctx.globalAlpha = 1 - k;
        for (let i = 0; i <= n; i++) { const a = i / n; ctx.fillStyle = i % 3 ? p.col : '#ffffff'; ctx.fillRect(Math.round(p.x + (p.x1 - p.x) * a), Math.round(p.y + (p.y1 - p.y) * a), 2, 2); }
        ctx.globalAlpha = 1;
      } else if (p.k === 'beam') {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#9fd8ff'; ctx.fillRect(Math.round(p.x) - 2, 0, 5, Math.round(p.y));
        ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(p.x), 0, 1, Math.round(p.y));
        ctx.globalAlpha = 1;
      } else if (p.k === 'orb') {
        ctx.globalAlpha = k > 0.8 ? (1 - k) * 5 : 1;
        disc(p.x + Math.sin(p.age * 6) * 2, p.y + Math.cos(p.age * 5) * 2, 2, '#8cf07a');
        px(ctx, p.x, p.y, '#ffffff');
        ctx.globalAlpha = 1;
      } else if (p.k === 'sbomb') {
        const r = Math.round(4 + 16 * Math.min(1, k * 1.4));
        const y = Math.round(-20 + (p.y + 20) * Math.min(1, k * 1.3));
        disc(p.x, y, r + 2, 'rgba(159,228,255,0.35)');
        disc(p.x, y, r, '#9fe4ff');
        disc(p.x - r * 0.25, y - r * 0.25, r * 0.55, '#e6faff');
      }
    }
    fx = fx.filter((p) => p.age < p.life);
    for (const s of texts) {
      s.age += dt;
      ctx.font = s.big ? '16px Silkscreen, monospace' : '8px Silkscreen, monospace';
      const y = Math.round(s.y - s.age * (s.dmg ? 22 : 14) + (s.dmg ? s.age * s.age * 18 : 0));
      const w = Math.round(ctx.measureText(s.s).width) + (s.icon ? 5 : 0);
      const x = Math.round(s.x + (s.vx || 0) * s.age - w / 2);
      ctx.globalAlpha = s.age > s.life * 0.7 ? Math.max(0, 1 - (s.age - s.life * 0.7) / (s.life * 0.3)) : 1;
      ctx.fillStyle = INK;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(s.s, x + dx, y + dy);
      ctx.fillStyle = s.col;
      ctx.fillText(s.s, x, y);
      if (s.icon) {
        const ix = x + w - 4, iy = y - 5;
        ctx.fillStyle = INK; ctx.fillRect(ix - 1, iy - 1, 5, 5);
        ctx.fillStyle = s.icon === 'alloy' ? '#c9d6e3' : s.icon === 'caps' ? '#ff8fd0' : s.icon; ctx.fillRect(ix, iy, 3, 3);
        px(ctx, ix, iy, '#ffffff');
      }
      ctx.globalAlpha = 1;
    }
    ctx.font = '8px Silkscreen, monospace';
    texts = texts.filter((s) => s.age < s.life);
    if (flash) {
      ctx.globalAlpha = Math.max(0, flash.a);
      ctx.fillStyle = flash.col;
      ctx.fillRect(-4, -4, GW + 8, GH + 8);
      ctx.globalAlpha = 1;
      flash.a -= dt * 1.6;
      if (flash.a <= 0) flash = null;
    }
  }
  function disc(cx, cy, r, col) {
    ctx.fillStyle = col;
    for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y)); ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1); }
  }
  function ring(cx, cy, r, col, a) {
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = col;
    const n = Math.max(12, Math.round(r * 6.3));
    for (let i = 0; i < n; i++) { const an = (i / n) * Math.PI * 2; ctx.fillRect(Math.round(cx + Math.cos(an) * r), Math.round(cy + Math.sin(an) * r), 1, 1); }
    ctx.globalAlpha = 1;
  }
  // companion projectiles. proj: where the shot is at progress k (arc height, wobble), then how it is drawn
  const PROJ_ARC = { yamcha: 10, krillin: 6, gohan: 12, piccolo: 0, vegeta: 8, nappa: 24 };
  function shotPos(s, k) {
    const from = helperFrom[s.helper] || [GW * 0.2, GH * 0.85];
    let x = from[0] + (s.target.x - from[0]) * k, y = from[1] + (s.target.y - from[1]) * k;
    if (s.j == null) s.j = Math.random() * 2 - 1;
    // Vegeta's barrage fans out: each blast gets its own arc height
    y -= Math.sin(k * Math.PI) * ((PROJ_ARC[s.helper] == null ? 16 : PROJ_ARC[s.helper]) + (s.helper === 'vegeta' ? s.j * 10 : 0));
    if (s.helper === 'yamcha') x += Math.sin(k * 14) * 5 * (1 - k); // the Spirit Ball weaves, then curves in
    return [x, y];
  }
  function drawShot(s) {
    const k = Math.min(1, s.t / s.dur);
    const [bx, by] = shotPos(s, k);
    const [px0, py0] = shotPos(s, Math.max(0, k - 0.06));
    let dx = bx - px0, dy = by - py0; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const X = Math.round(bx), Y = Math.round(by);
    const fr = Math.floor(t * 14) % 2;
    switch (s.helper) {
      case 'yamcha': // orange Spirit Ball with a short trail
        for (let i = 3; i >= 1; i--) { const [tx, ty] = shotPos(s, Math.max(0, k - i * 0.04)); ctx.globalAlpha = 0.5 - i * 0.12; disc(tx, ty, 1, '#ff8a2a'); }
        ctx.globalAlpha = 1; disc(X, Y, 2, '#ff8a2a'); disc(X, Y, 1, '#ffd27a'); px(ctx, X, Y, '#ffffff');
        break;
      case 'krillin': // Kienzan: a flat spinning disc
        ctx.fillStyle = '#ffd23f';
        if (fr) { ctx.fillRect(X - 4, Y - 1, 9, 3); ctx.fillStyle = '#fff6b0'; ctx.fillRect(X - 3, Y, 7, 1); }
        else { ctx.fillRect(X - 3, Y - 2, 7, 5); ctx.fillStyle = '#fff6b0'; ctx.fillRect(X - 2, Y - 1, 5, 3); }
        px(ctx, X - 4 + fr * 8, Y, '#ffffff');
        break;
      case 'gohan': // Masenko: fat round head, short tail
        for (let i = 1; i <= 4; i++) { ctx.globalAlpha = 0.7 - i * 0.14; disc(X - dx * i * 2, Y - dy * i * 2, Math.max(1, 3 - Math.floor(i / 2)), '#ffe36a'); }
        ctx.globalAlpha = 1; disc(X, Y, 3, '#ffe36a'); disc(X, Y, 2, '#fff6b0'); px(ctx, X, Y, '#ffffff');
        break;
      case 'piccolo': { // Special Beam Cannon: thin straight beam, a spiral round it
        const L = 14;
        for (let i = 0; i < L; i++) {
          const bxx = bx - dx * i, byy = by - dy * i;
          ctx.globalAlpha = 1 - i / L;
          px(ctx, bxx, byy, '#fff6b0');
          const sp = Math.sin(i * 0.9 - t * 30) * 2;
          px(ctx, bxx - dy * sp, byy + dx * sp, '#e08a2a');
        }
        ctx.globalAlpha = 1; px(ctx, X, Y, '#ffffff');
        break;
      }
      case 'vegeta': { // Vegeta's Technique: a barrage of small purple ki blasts (Goku in the slot: blue Desperate Blasts)
        const P3 = s.alt ? ['#2f7fe8', '#7fd4ff', '#e8f6ff'] : ['#8a4fe0', '#c48bff', '#f0dcff'];
        for (let i = 1; i <= 3; i++) { ctx.globalAlpha = 0.55 - i * 0.15; disc(X - dx * i * 2, Y - dy * i * 2, 1, P3[0]); }
        ctx.globalAlpha = 1; disc(X, Y, 2, P3[0]); disc(X, Y, 1, P3[1]); px(ctx, X, Y, P3[2]);
        break;
      }
      case 'nappa': // Break Cannon: a big orange orb
        ctx.globalAlpha = 0.35; disc(X, Y, 6, '#ff7a1a');
        ctx.globalAlpha = 1; disc(X, Y, 5, '#ff9a2a'); disc(X, Y, 3, '#ffd27a'); disc(X, Y, 1, '#ffffff');
        break;
      default:
        ctx.fillStyle = s.col; ctx.globalAlpha = 0.35; ctx.fillRect(X - 2, Y - 2, 5, 5);
        ctx.globalAlpha = 1; ctx.fillRect(X - 1, Y - 1, 3, 3); px(ctx, X, Y, '#ffffff');
    }
  }
  // the Ki Beam: from the fighter through the finger to the edge of the field. Drawn in pixel squares stepped along
  // the ray, outer colour first, then the middle and the white-hot core; it ripples, and a form adds its aura flicker
  function drawBeams(rays, width, L, form) {
    const w = Math.max(2, width * L.w);
    const pts = rays.map((r) => {
      const p = [];
      for (let i = 0; i < 900; i++) {
        const x = r.x + r.dx * i, y = r.y + r.dy * i;
        if (x < -w || x > GW + w || y < -w || y > GH + w) break;
        p.push([x, y, i]);
      }
      return { r, p };
    });
    const layer = (col, k, wob) => {
      ctx.fillStyle = col;
      for (const { p } of pts) for (const [x, y, i] of p) {
        const ramp = Math.min(1, 0.35 + i / 14); // thin where it leaves the hands
        const s = Math.max(1, Math.round(w * k * ramp + (wob ? Math.sin(t * 40 - i * 0.35) * wob : 0)));
        ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
      }
    };
    ctx.globalAlpha = 0.45; layer(L.col[0], 1.5, 1.2);
    ctx.globalAlpha = 1; layer(L.col[0], 1, 1);
    layer(L.col[1], 0.62, 0.8);
    layer(L.col[2], 0.28, 0);
    for (const { r, p } of pts) {
      // Special Beam Cannon: an orange spiral wrapped round a thin core
      if (L.spiral) for (const [x, y, i] of p) { const sp = Math.sin(i * 0.45 - t * 30) * (w * 1.4 + 1); px(ctx, x - r.dy * sp, y + r.dx * sp, i % 2 ? L.col[0] : '#ffb030'); }
      // a form's aura licks along the edges
      if (form) for (const [x, y, i] of p) if ((i + Math.floor(t * 30)) % 5 === 0 && Math.random() < 0.6) { const sd = (Math.random() < 0.5 ? -1 : 1) * (w * 0.75 + 1 + Math.random() * 2); ctx.globalAlpha = 0.7; px(ctx, x - r.dy * sd, y + r.dx * sd, form.aura); }
      ctx.globalAlpha = 1;
    }
    // the charge ball in the fighter's hands
    const o = rays[0];
    const pr = Math.round(w * 0.7 + 1 + Math.sin(t * 25));
    disc(o.x, o.y, pr + 1, L.col[0]); disc(o.x, o.y, pr, L.col[1]); disc(o.x, o.y, Math.max(1, pr - 2), L.col[2]);
    if (form && form.spark && Math.floor(t * 12) % 3 === 0) {
      const p = pts[0].p, at = p[Math.floor(Math.random() * p.length)];
      if (at) { let x = at[0], y = at[1]; for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 6; y += (Math.random() - 0.5) * 6; px(ctx, x, y, k % 2 ? '#ffffff' : '#bfe8ff'); } }
    }
  }
  // a form's aura around the disc: flickering flames in the form's colour, lightning for SSJ2 / Majin / Blue Evolution
  function drawAura(x, y, R, L) {
    const n = Math.max(20, Math.round(R * 5));
    ctx.fillStyle = L.aura;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const fl = R + 2 + Math.max(0, Math.sin(a * 5 - t * 9) + Math.sin(a * 3 + t * 13)) * 2.2;
      ctx.globalAlpha = 0.35 + 0.35 * Math.max(0, Math.sin(a * 7 + t * 17));
      ctx.fillRect(Math.round(x + Math.cos(a) * fl), Math.round(y + Math.sin(a) * fl - 1), 1, 2);
    }
    ctx.globalAlpha = 1;
    if (L.spark && Math.floor(t * 12) % 3 === 0) {
      let a = Math.random() * Math.PI * 2, px0 = x + Math.cos(a) * R, py0 = y + Math.sin(a) * R;
      for (let k = 0; k < 5; k++) {
        a += (Math.random() - 0.5) * 0.9;
        const px1 = px0 + Math.cos(a) * 3, py1 = py0 + Math.sin(a) * 3;
        px(ctx, px1, py1, k % 2 ? '#ffffff' : '#bfe8ff');
        px0 = px1; py0 = py1;
      }
    }
  }
  function drawDisc(x, y, R) {
    const n = Math.max(16, Math.round(R * 4));
    ctx.fillStyle = 'rgba(255,214,77,0.55)';
    for (let i = 0; i < n; i += 2) { const a = (i / n) * Math.PI * 2 + t * 0.6; ctx.fillRect(Math.round(x + Math.cos(a) * R), Math.round(y + Math.sin(a) * R), 1, 1); }
    const r = Math.max(4, Math.round(R * 0.55));
    disc(x, y, r + 1, 'rgba(255,214,77,0.25)');
    disc(x, y, r, 'rgba(255,226,122,0.55)');
    const teeth = 8, spin = t * 22;
    const m = Math.round(r * 7);
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2;
      const on = Math.sin(a * teeth + spin) > 0;
      ctx.fillStyle = on ? '#fff8d6' : '#ffd34d';
      ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1);
      if (on && Math.sin(a * teeth + spin) > 0.85) ctx.fillRect(Math.round(x + Math.cos(a) * (r + 1)), Math.round(y + Math.sin(a) * (r + 1)), 1, 1);
    }
    disc(x, y, Math.max(1, Math.round(r * 0.3)), '#ffffff');
    for (let k = 0; k < 2; k++) {
      const a = spin * 0.3 + k * Math.PI;
      for (let d = 2; d < r; d++) px(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, '#fff8d6');
    }
  }
  // is a tap (game px) on Loot Bulma's plane?
  const hitsBulma = (W, x, y) => !!W.bulma && Math.abs(x - W.bulma.x) < 16 && Math.abs(y - W.bulma.y) < 12;

  return { load, init, resize, toGame, frame, event, rigSprite, thumb, tileIcon, frames, setHelperOrigins, setReduce, hitsBulma, get size() { return { GW, GH, scale: PX / DPR }; } };
})();
