#!/usr/bin/env python3
"""Builds the machine-enemy sprite atlas (src/gen_sprites.js) from the art in assets/:
  - the craftpix zip packs (transparent PNG sheets, square frames): read straight from the zips
  - preview images (.jpg/.webp, grey background, art blown up ~4-5x): the pixel grid is found, each art pixel is
    read back from the middle of its block, and the grey background is keyed out
Each machine gets an idle animation and (when the art has one) a death animation, anchored bottom-centre.
Usage: python tools/build_sprites.py [--sheet out.png]   (--sheet writes a contact sheet to check the result)"""
import base64, io, json, os, sys, zipfile
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'assets')
ZD = 'craftpix-net-902201-free-drones-pack-pixel-art.zip'
ZB = 'craftpix-net-412866-free-factory-boss-enemies-asset-pack-for-cyberpunk.zip'
ZR = 'craftpix-net-434566-free-robot-pixel-art-sprite-sheets.zip'

# id: ('zip', file, idle member, death member or None, scale)  |  ('prev', file, idle row, death row or None, scale)
# (from_grid reads the top-down 'battle tanks.jpg'; not used: painted top-down art clashes with the side-view machines)
TYPES = {
    'scout': ('zip', ZD, '1 Drones/1/Idle.png', '1 Drones/1/Death.png', 1),
    'gundrone': ('zip', ZD, '1 Drones/3/Idle.png', '1 Drones/3/Death.png', 1),
    'rotor': ('zip', ZD, '1 Drones/4/Idle.png', '1 Drones/4/Death.png', 0.5),
    'freighter': ('zip', ZD, '1 Drones/5/Idle.png', '1 Drones/5/Death.png', 0.5),
    'hauler': ('zip', ZD, '1 Drones/5_2/Idle.png', '1 Drones/5_2/Death.png', 1),
    'saucer': ('zip', ZD, '1 Drones/6/Walk.png', None, 1),
    'crawler': ('zip', ZB, '2/Idle.png', '2/Death.png', 0.5),
    'spider': ('zip', ZB, '3/Idle.png', '3/Death.png', 0.5),
    'destroyer': ('zip', ZR, 'Destroyer/Idle.png', 'Destroyer/Dead.png', 0.5),
    'infantry': ('zip', ZR, 'Infantryman/Idle.png', 'Infantryman/Dead.png', 0.5),
    'blade': ('zip', ZR, 'Swordsman/Idle.png', 'Swordsman/Dead.png', 0.5),
    'walker': ('prev', 'tank sprite.jpg', 3, 1, 1),
    'balloon': ('prev', 'balloon sprite.jpg', 3, 1, 1),
    'barrel': ('prev', 'barrel sprite.webp', 3, 1, 1),
    'bigtank': ('prev', 'big tank.jpg', 3, 1, 1),
    'patrol': ('prev', 'drone sprite.jpg', 3, 1, 1),
    'flipper': ('prev', 'flipper sprite.jpg', 3, 1, 1),
    'crab': ('prev', 'laser drone.webp', 3, 1, 1),
    'jeep': ('prev', 'missle jeep.jpg', 0, 4, 0.5),
    'scorpion': ('prev', 'scorp drone.webp', 3, 1, 1),
}


# ------------------------------------------------------------------ helpers
def shrink(im, s):
    """Pixel-art downscale by 1/n: each block takes its most common opaque colour (or stays empty)."""
    if s == 1:
        return im
    n = round(1 / s)
    a = np.asarray(im)
    H, W = a.shape[0] // n, a.shape[1] // n
    out = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        for x in range(W):
            blk = a[y * n:(y + 1) * n, x * n:(x + 1) * n].reshape(-1, 4)
            op = blk[blk[:, 3] > 127]
            if len(op) * 2 < len(blk):
                continue
            cols, cnt = np.unique(op[:, :3], axis=0, return_counts=True)
            out[y, x, :3] = cols[cnt.argmax()]
            out[y, x, 3] = 255
    return Image.fromarray(out, 'RGBA')


def bbox_union(frames):
    xs0, ys0, xs1, ys1 = [], [], [], []
    for f in frames:
        b = f.getbbox()
        if b:
            xs0.append(b[0]); ys0.append(b[1]); xs1.append(b[2]); ys1.append(b[3])
    return (min(xs0), min(ys0), max(xs1), max(ys1)) if xs0 else None


def sheet_frames(img):
    h = img.height
    return [img.crop((i * h, 0, (i + 1) * h, h)) for i in range(img.width // h)]


def from_zip(zname, member, s):
    z = zipfile.ZipFile(os.path.join(A, zname))
    img = Image.open(io.BytesIO(z.read(member))).convert('RGBA')
    fr = sheet_frames(img)
    b = bbox_union(fr)
    fr = [f.crop(b) for f in fr]
    fr = [f for f in fr if f.getbbox()]
    return [shrink(f, s) for f in fr]


def grid_of(path):
    """Finds the art's pixel size and offset in a blown-up preview, then reads each art pixel back."""
    im = np.asarray(Image.open(path).convert('RGB')).astype(int)
    bg = im[5, 5]
    mask = np.abs(im - bg).sum(2) > 60
    dx = (np.abs(np.diff(im, axis=1)).sum(2) > 120) & mask[:, 1:]
    dy = (np.abs(np.diff(im, axis=0)).sum(2) > 120) & mask[1:, :]
    xs = np.nonzero(dx)[1] + 0.5
    ys = np.nonzero(dy)[0] + 0.5
    best = None
    for k in np.arange(2.5, 8.0, 0.005):
        c = abs(np.exp(2j * np.pi * xs / k).mean()) + abs(np.exp(2j * np.pi * ys / k).mean())
        if not best or c > best[0]:
            best = (c, k)
    k = best[1]
    ox = (np.angle(np.exp(2j * np.pi * xs / k).mean()) / (2 * np.pi) * k) % k
    oy = (np.angle(np.exp(2j * np.pi * ys / k).mean()) / (2 * np.pi) * k) % k
    W = int((im.shape[1] - ox) // k)
    H = int((im.shape[0] - oy) // k)
    out = np.zeros((H, W, 4), np.uint8)
    r = max(1, int(k * 0.22))
    for y in range(H):
        cy = int(oy + (y + 0.5) * k)
        for x in range(W):
            cx = int(ox + (x + 0.5) * k)
            blk = im[cy - r:cy + r + 1, cx - r:cx + r + 1].reshape(-1, 3)
            c = np.median(blk, axis=0)
            if np.abs(c - bg).sum() > 45:
                out[y, x, :3] = c
                out[y, x, 3] = 255
    return out, k


def components(alpha):
    """Connected blobs of solid pixels (8-neighbour): list of (x0, y0, x1, y1, area)."""
    H, W = alpha.shape
    seen = np.zeros_like(alpha, bool)
    out = []
    for y in range(H):
        for x in range(W):
            if not alpha[y, x] or seen[y, x]:
                continue
            st = [(y, x)]; seen[y, x] = True
            x0 = x1 = x; y0 = y1 = y; n = 0
            while st:
                cy, cx = st.pop(); n += 1
                x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                for ddy in (-1, 0, 1):
                    for ddx in (-1, 0, 1):
                        ny, nx = cy + ddy, cx + ddx
                        if 0 <= ny < H and 0 <= nx < W and alpha[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; st.append((ny, nx))
            out.append((x0, y0, x1 + 1, y1 + 1, n))
    return out


_prev_cache = {}


def preview_rows(path):
    """The previews share one template: row labels on the left, frames in 210 px cells from x=400.
    Every blob of art is put in the row whose label is nearest its bottom edge, and the cell holding its centre."""
    if path in _prev_cache:
        return _prev_cache[path]
    a, k = grid_of(path)
    alpha = a[:, :, 3] > 0
    lab_w = int(360 / k)
    comps = components(alpha)
    rows = []
    for c in sorted([c for c in comps if c[2] <= lab_w + 2], key=lambda c: c[1]):
        cy = (c[1] + c[3]) / 2
        if not rows or abs(rows[-1] - cy) >= 6:
            rows.append(cy)
    cells = {}
    for c in comps:
        if c[0] <= lab_w:
            continue
        r = min(range(len(rows)), key=lambda j: abs(rows[j] + 25 / k - c[3]))
        i = int(((c[0] + c[2]) / 2 * k - 400) // 210)
        cells.setdefault((r, i), []).append(c)
    _prev_cache[path] = (Image.fromarray(a, 'RGBA'), cells, k)
    return _prev_cache[path]


def from_preview(fname, row, keep_all=False):
    img, cells, k = preview_rows(os.path.join(A, fname))
    boxes = []
    for i in range(8):
        cs = cells.get((row, i))
        if not cs:
            continue
        main = max(cs, key=lambda c: c[4])
        if main[4] < 20:
            continue
        b = list(main[:4])
        for c in cs:  # bits touching the main blob (or, for deaths, every bit in the cell)
            if keep_all or (c[0] <= b[2] + 2 and c[2] >= b[0] - 2 and c[1] <= b[3] + 2 and c[3] >= b[1] - 2):
                b = [min(b[0], c[0]), min(b[1], c[1]), max(b[2], c[2]), max(b[3], c[3])]
        boxes.append((i, b))
    # one canvas size for the whole animation, each frame placed at its spot inside its cell, bottoms aligned
    cx0 = [b[0] - (400 + 210 * i) / k for i, b in boxes]
    cx1 = [b[2] - (400 + 210 * i) / k for i, b in boxes]
    left, right = min(cx0), max(cx1)
    bottom = max(b[3] for _, b in boxes)
    top = min(b[1] for _, b in boxes)
    out = []
    if not keep_all:
        # idle loops: line every frame up on its own bottom-centre so the machine doesn't drift between cells
        w = max(b[2] - b[0] for _, b in boxes)
        h = max(b[3] - b[1] for _, b in boxes)
        for i, b in boxes:
            f = Image.new('RGBA', (w, h))
            f.alpha_composite(img.crop(tuple(b)), ((w - (b[2] - b[0])) // 2, h - (b[3] - b[1])))
            out.append(f)
        return out
    for i, b in boxes:
        ox = int(round((400 + 210 * i) / k + left))
        f = Image.new('RGBA', (int(right - left) + 1, bottom - top))
        piece = img.crop((b[0], b[1], b[2], b[3]))
        f.alpha_composite(piece, (b[0] - ox, b[1] - top))
        out.append(f)
    return out


def from_grid(fname, col, s):
    """Battle tanks preview: 4 rows x 8 columns of top-down tanks on brown ground; take the first row, column `col`."""
    im = np.asarray(Image.open(os.path.join(A, fname)).convert('RGB')).astype(int)
    bg = np.median(im[300:330, 5:40].reshape(-1, 3), axis=0)
    mask = np.abs(im - bg).sum(2) > 45
    X = [(83, 199), (248, 361), (419, 515), (591, 669)][col]
    sub = mask[120:340, X[0] - 4:X[1] + 4]
    ys = np.nonzero(sub.any(1))[0]
    y0, y1 = 120 + ys.min(), 120 + ys.max() + 1
    rgb = Image.fromarray(im[y0:y1, X[0] - 4:X[1] + 4].astype(np.uint8))
    al = Image.fromarray((mask[y0:y1, X[0] - 4:X[1] + 4] * 255).astype(np.uint8))
    f = rgb.convert('RGBA'); f.putalpha(al)
    f = f.rotate(-90, expand=True)  # top-down art faces up; turn it to face right like the rest
    w, h = max(1, round(f.width * s)), max(1, round(f.height * s))
    f = f.resize((w, h), Image.BOX)
    a = np.asarray(f).copy(); a[:, :, 3] = np.where(a[:, :, 3] > 110, 255, 0)
    return [Image.fromarray(a, 'RGBA')]


def outline(f):
    """Adds a 1px dark outline where the art has none (keyed previews lose theirs at the edge)."""
    a = np.asarray(f).copy()
    al = a[:, :, 3] > 0
    pad = np.pad(al, 1)
    near = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
    edge = near & ~al
    a[edge] = (20, 20, 22, 255)
    return Image.fromarray(a, 'RGBA')


# ------------------------------------------------------------------ build
def build():
    out = {}
    for id_, (kind, src, idle, death, s) in TYPES.items():
        if kind == 'zip':
            I = from_zip(src, idle, s)
            D = from_zip(src, death, s) if death else []
        elif kind == 'prev':
            I = [outline(shrink(f, s)) for f in from_preview(src, idle)]
            D = [outline(shrink(f, s)) for f in from_preview(src, death, True)] if death is not None else []
            I = [f for f in I if f.getbbox()]
        else:
            I = [outline(f) for f in from_grid(src, idle, s)]
            D = []
        out[id_] = (I, D)
    # pack: one row per machine, idle frames then death frames
    rows = []
    meta = {}
    y = 0
    for id_, (I, D) in out.items():
        iw, ih = max(f.width for f in I), max(f.height for f in I)
        dw, dh = (max(f.width for f in D), max(f.height for f in D)) if D else (0, 0)
        meta[id_] = {'y': y, 'w': iw, 'h': ih, 'n': len(I), 'dw': dw, 'dh': dh, 'dn': len(D), 'dx': iw * len(I)}
        rows.append((y, I, D, iw, ih, dw, dh))
        y += max(ih, dh) + 1
    W = max(r[3] * len(r[1]) + r[5] * len(r[2]) for r in rows)
    atlas = Image.new('RGBA', (W, y))
    for (y0, I, D, iw, ih, dw, dh) in rows:
        for i, f in enumerate(I):
            atlas.alpha_composite(f, (i * iw + (iw - f.width) // 2, y0 + ih - f.height))
        for i, f in enumerate(D):
            atlas.alpha_composite(f, (iw * len(I) + i * dw + (dw - f.width) // 2, y0 + dh - f.height))
    buf = io.BytesIO(); atlas.save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    p = os.path.join(ROOT, 'src', 'gen_sprites.js')
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// GENERATED by tools/build_sprites.py from the craftpix packs and previews in assets/. Do not edit by hand.\n')
        f.write('// Machine enemies: one atlas row each, idle frames then death frames, anchored bottom-centre.\n')
        f.write('const MACHINE_SPRITES = { atlas: "data:image/png;base64,' + b64 + '", meta: ' + json.dumps(meta, separators=(',', ':')) + ' };\n')
    print('wrote', p, os.path.getsize(p), 'bytes, atlas', atlas.size)
    for k, m in meta.items():
        print('  %-10s idle %dx%d x%d   death %dx%d x%d' % (k, m['w'], m['h'], m['n'], m['dw'], m['dh'], m['dn']))
    if '--sheet' in sys.argv:
        sh = atlas.resize((atlas.width * 3, atlas.height * 3), Image.NEAREST)
        bgc = Image.new('RGBA', sh.size, (58, 57, 55, 255)); bgc.alpha_composite(sh)
        bgc.save(sys.argv[sys.argv.index('--sheet') + 1])


if __name__ == '__main__':
    build()
