// Machine gallery: every base machine in every paint x every mark, painted by the game's own renderer.
// Machines already on a floor are marked with that floor. Built into dist/gallery.html by tools/build.py.
(() => {
  const G = IdleCore;
  const PAINTS = [null, 'red', 'blue', 'yellow', 'green', 'purple'];
  const MARKS = [null, 'hazard', 'rr', 'flag'];
  const NAME = { null: 'Original', red: 'Crimson', blue: 'Cobalt', yellow: 'Gold', green: 'Jade', purple: 'Frieza' };
  const MARKN = { null: 'Plain', hazard: 'Hazard', rr: 'Red Ribbon', flag: 'Patriot' };
  const inGame = {};
  for (const m of G.MACHINES) inGame[m.sprite + ':' + m.paint + ':' + m.mark] = m;
  const SCALE = 3;
  const cells = [];
  function build() {
    const root = document.getElementById('list');
    let used = 0, total = 0;
    for (const sprite of Object.keys(MACHINE_SPRITES.meta)) {
      const meta = MACHINE_SPRITES.meta[sprite];
      const sec = document.createElement('section');
      const base = G.MACHINES.find((m) => m.sprite === sprite);
      sec.innerHTML = '<h2>' + (base ? base.name.replace(/^(Hazard |Red Ribbon |Patriot |Crimson |Cobalt |Gold |Jade |Frieza )+/, '') : sprite) + '</h2>';
      const grid = document.createElement('div');
      grid.className = 'grid';
      grid.innerHTML = '<span></span>' + MARKS.map((k) => '<b>' + MARKN[k] + '</b>').join('');
      for (const p of PAINTS) {
        grid.insertAdjacentHTML('beforeend', '<b class="rowh">' + NAME[p] + '</b>');
        for (const k of MARKS) {
          total++;
          const hit = inGame[sprite + ':' + p + ':' + k];
          if (hit) used++;
          const m = { id: 'g:' + sprite + ':' + p + ':' + k, sprite, paint: p, mark: k };
          const c = document.createElement('canvas');
          c.width = meta.w; c.height = meta.h;
          c.style.width = meta.w * SCALE + 'px'; c.style.height = meta.h * SCALE + 'px';
          const cell = document.createElement('div');
          cell.className = 'cell' + (hit ? ' used' : '');
          cell.appendChild(c);
          if (hit) cell.insertAdjacentHTML('beforeend', '<i>FLOORS ' + (2 * hit.t + 1) + '-' + (2 * hit.t + 6) + '</i>');
          grid.appendChild(cell);
          cells.push({ c, F: Render.frames(m) });
        }
      }
      sec.appendChild(grid);
      root.appendChild(sec);
    }
    document.getElementById('count').textContent = total + ' possible machines (20 bodies x 6 paints x 4 marks). ' + used + ' are on a floor today, outlined in gold.';
    let f = 0;
    setInterval(() => {
      f++;
      for (const { c, F } of cells) { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.drawImage(F.idle[f % F.idle.length], 0, 0); }
    }, 140);
  }
  Render.load().then(build);
})();
