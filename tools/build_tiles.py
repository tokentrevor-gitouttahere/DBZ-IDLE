#!/usr/bin/env python3
"""Builds the level art (src/gen_tiles.js) from the craftpix tilesets in assets/: floor tiles and scenery for each of
the 15 regions, packed into one atlas. render.js lays each region's floor, shapes patches, builds its set pieces
(yards, junk heaps, roads, camps, reefs...) and tints the result (REGIONS below). Skeletons, graves and the big painted crystals are left out on purpose.
Usage: python tools/build_tiles.py   (look at the result in dist/preview.html or the game)"""
import base64, glob, io, json, os, re, sys, zipfile
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'assets')
Z = {
    'village': 'craftpix-net-504452-free-village-pixel-tileset-for-top-down-defense.zip',
    'dungeon': 'craftpix-net-169442-free-2d-top-down-pixel-dungeon-asset-pack.zip',
    'undead': 'craftpix-net-695666-free-undead-tileset-top-down-pixel-art.zip',
    'sea': 'craftpix-net-694865-free-top-down-seabed-objects-pixel-art.zip',
    'crystal': 'craftpix-net-106469-top-down-crystals-pixel-art.zip',
}
_zips = {}


def zimg(key, name):
    z = _zips.setdefault(key, zipfile.ZipFile(os.path.join(A, Z[key])))
    return Image.open(io.BytesIO(z.read(name))).convert('RGBA')


def zlist(key, pattern):
    z = _zips.setdefault(key, zipfile.ZipFile(os.path.join(A, Z[key])))
    return sorted(n for n in z.namelist() if re.search(pattern, n) and not n.startswith('__MACOSX'))


def trim(im):
    b = im.getbbox()
    return im.crop(b) if b else None


def cell(key, name, cx, cy, s=16):
    return zimg(key, name).crop((cx * s, cy * s, cx * s + s, cy * s + s))


# ------------------------------------------------------------------ pieces
def pieces():
    P = {}  # name -> list of images
    V = '1 Tiles/FieldsTile_%02d.png'
    P['sand'] = [zimg('village', V % n) for n in (1, 7, 11, 16, 18, 23, 27, 33, 35, 36, 37, 45, 58, 59, 60)]
    P['sandgrass'] = [zimg('village', V % n) for n in (2, 3, 4, 5, 8, 9, 13, 14, 15, 20, 21, 24, 25, 26, 29, 30, 31)]
    P['grass'] = [zimg('village', V % 38)] * 3 + [zimg('village', V % n) for n in (19, 22, 6, 10)]
    wf = 'PNG/walls_floor.png'
    P['cobble'] = [cell('dungeon', wf, x, y) for x, y in ((3, 1), (4, 1), (5, 1), (6, 1), (7, 1), (8, 1), (1, 1), (7, 16), (8, 16), (9, 16), (10, 16))]
    P['brick'] = [zimg('dungeon', wf).crop((0, 336, 32, 368)), zimg('dungeon', wf).crop((176, 336, 208, 368))]
    P['plate'] = [cell('dungeon', wf, x, y) for x, y in ((1, 5), (1, 6), (1, 7), (4, 5), (4, 7), (5, 5), (5, 7), (3, 5), (3, 7))]
    gr = 'PNG/Ground_rocks.png'
    P['rock'] = [cell('undead', gr, x, y) for x, y in ((20, 22), (21, 22), (22, 22), (23, 22), (24, 22), (25, 22), (26, 22))]
    # scenery
    vo = lambda d: [trim(zimg('village', n)) for n in zlist('village', r'2 Objects/%s/.*\.png$' % d)]
    P['v_stone'] = vo('2 Stone')
    P['v_grass'] = vo('5 Grass')
    P['v_box'] = vo('4 Box')
    P['v_decor'] = [i for i in vo('3 Decor') if i.width <= 48 and i.height <= 56]
    P['v_tent'] = vo('6 Tent')[:2]
    so = lambda pat: [trim(zimg('sea', n)) for n in zlist('sea', r'Objects_separately/(%s)_shadow1\.png$' % pat)]
    P['s_small'] = so('Pearl_sea_shell2|Yellow-white-gray_shell2|Blue-beige_coral2|Blue-beige_coral3|Blue_coral2|Blue_coral3|Gray-red_coral3')
    P['s_mid'] = so('Starfish1|Starfish2|Turtle_shell|Anchor|Steering_wheel|Pearl_sea_shell1|Yellow-white-gray_shell1|Gray-red_coral1|Blue_coral1|Sea_urchin2|Violet-pink_coral3|Riff4')
    P['s_big'] = [i for i in so('Ship2|Riff1|Riff2|Brown-white_shell1') if i.width <= 110]
    uo = lambda pat, mx=72: [i for i in (trim(zimg('undead', n)) for n in zlist('undead', r'Objects_separately/(%s)_shadow1_\d+\.png$' % pat)) if i and i.width <= mx and i.height <= mx]
    P['u_rock'] = uo('Rock')
    P['u_plant'] = uo('Plant|Thorn_plant')
    P['u_tree'] = uo('Tree|Broken_tree', 110)
    P['u_ruin'] = uo('Ruin', 90)
    P['u_crys'] = uo('Crystal')
    obj = zimg('dungeon', 'PNG/Objects.png')
    a = np.asarray(obj)[:, :, 3] > 0
    from build_sprites import components
    P['d_obj'] = [obj.crop((c[0], c[1], c[2], c[3])) for c in components(a) if c[4] > 40 and c[2] - c[0] <= 24 and c[3] - c[1] <= 24 and c[1] > 30]
    cr = lambda col, k: trim(zimg('crystal', 'PNG/Assets_shadow/%s_crystal%d.png' % (col, k)))
    for col, key in (('Green', 'c_green'), ('Blue', 'c_blue'), ('Violet', 'c_violet'), ('Red', 'c_red'), ('Yellow', 'c_yellow'), ('Pink', 'c_pink')):
        P[key] = [cr(col, k) for k in (2, 3, 4)]
    det = zimg('undead', 'PNG/Details.png')
    da = np.asarray(det)[:, :, 3] > 0
    P['u_detail'] = [det.crop((c[0], c[1], c[2], c[3])) for c in components(da) if c[4] > 6 and c[2] - c[0] <= 20]
    # icons for the UI: the dungeon pack's chest (closed, open) and gold pile, plus crystals as loot
    ch = zimg('dungeon', 'PNG/doors_lever_chest_animation.png')
    P['icon_chest'] = [trim(ch.crop((x * 32, 128, x * 32 + 32, 160))) for x in range(5)]
    P['icon_gem'] = [cr(c, 3) for c in ('Blue', 'Green', 'Violet', 'Red', 'Yellow', 'Pink', 'White')]
    return {k: [i for i in v if i is not None] for k, v in P.items()}


# region recipes: floor = [(piece, weight)], decor = [(piece, count per 10k px)], tint = (hue deg, sat x, light x)
# Region recipes. base: the floor tile family laid everywhere; patch: a second family laid in noise-shaped
# patches (coherent blobs, not random tiles); detail: small bits sprinkled lightly; feat: set pieces render.js builds
# (road, yard, junk, wreck, camp, outcrop, grove, ruins, crystals, reef, ship, sea, crater, lava, path);
# tint: (hue shift, saturation x, lightness x).
REGIONS = [
    {'name': 'West City', 'base': 'brick', 'patch': None, 'detail': [('u_detail', 3)], 'feat': ['road', 'yard', 'junk', 'wreck'], 'tint': (20, 0.35, 0.78)},
    {'name': 'Countryside', 'base': 'sand', 'patch': ['sandgrass', 0.45], 'detail': [('v_grass', 10), ('v_stone', 3)], 'feat': ['path', 'camp', 'outcrop', 'wreck'], 'tint': (22, 0.45, 0.6)},
    {'name': 'Kame Beach', 'base': 'sand', 'patch': None, 'detail': [('s_small', 2)], 'feat': ['sea', 'reef', 'ship', 'wreck'], 'tint': (16, 0.55, 0.7)},
    {'name': 'Red Ribbon HQ', 'base': 'brick', 'patch': None, 'detail': [('u_detail', 3)], 'feat': ['road', 'yard', 'yard', 'junk'], 'tint': (-25, 0.35, 0.62)},
    {'name': "Dr. Gero's Lab", 'base': 'brick', 'patch': None, 'detail': [('u_detail', 3)], 'feat': ['crystals', 'yard', 'wreck', 'junk'], 'tint': (-150, 0.3, 0.55)},
    {'name': 'Namekian Village', 'base': 'sand', 'patch': ['sandgrass', 0.5], 'detail': [('v_grass', 8), ('v_stone', 3)], 'feat': ['crystals', 'outcrop', 'path', 'wreck'], 'tint': (95, 0.45, 0.6)},
    {'name': 'Blue Grass Plains', 'base': 'sandgrass', 'patch': ['sand', 0.62], 'detail': [('v_grass', 12), ('v_stone', 3)], 'feat': ['sea', 'outcrop', 'wreck'], 'tint': (175, 0.45, 0.58)},
    {'name': 'Ajisa Groves', 'base': 'rock', 'patch': None, 'detail': [('u_detail', 3)], 'feat': ['grove', 'grove', 'outcrop', 'wreck'], 'tint': (60, 0.7, 0.7)},
    {'name': "Frieza's Landing", 'base': 'rock', 'patch': None, 'detail': [('u_detail', 4)], 'feat': ['crater', 'ruins', 'crystals', 'wreck'], 'tint': (230, 0.45, 0.68)},
    {'name': 'Dying Namek', 'base': 'rock', 'patch': None, 'detail': [('u_detail', 4)], 'feat': ['lava', 'crater', 'outcrop', 'wreck'], 'tint': (-20, 0.9, 0.6)},
    # Planet Sadala (World 3): red-brown Saiyan rock, a royal city, training craters, the pod bay, then fire
    {'name': 'Sadala Outskirts', 'base': 'rock', 'patch': ['sand', 0.6], 'detail': [('u_detail', 4), ('v_stone', 3)], 'feat': ['outcrop', 'crater', 'path', 'wreck'], 'tint': (8, 0.75, 0.66)},
    {'name': 'Royal Capital', 'base': 'brick', 'patch': None, 'detail': [('u_detail', 3)], 'feat': ['road', 'ruins', 'yard', 'junk'], 'tint': (150, 0.8, 0.62)},
    {'name': 'Saiyan Training Grounds', 'base': 'sand', 'patch': ['rock', 0.55], 'detail': [('v_stone', 5)], 'feat': ['crater', 'crater', 'outcrop', 'wreck'], 'tint': (24, 0.6, 0.62)},
    {'name': 'Pod Launch Bay', 'base': 'brick', 'patch': None, 'detail': [('u_detail', 4)], 'feat': ['yard', 'junk', 'crystals', 'wreck'], 'tint': (-12, 0.4, 0.56)},
    {'name': 'Burning Sadala', 'base': 'rock', 'patch': None, 'detail': [('u_detail', 4)], 'feat': ['lava', 'crater', 'ruins', 'wreck'], 'tint': (-45, 1.0, 0.55)},
]
# which crystals each region's 'crystals' set piece uses
CRYSTALS = {"Dr. Gero's Lab": 'c_blue', 'Namekian Village': 'c_green', "Frieza's Landing": 'c_violet'}


def pack(P):
    """Shelf-packs every piece into one atlas; returns atlas and {name: [[x, y, w, h], ...]}."""
    items = [(k, i, im) for k, v in P.items() for i, im in enumerate(v)]
    items.sort(key=lambda t: -t[2].height)
    W = 512
    x = y = rowh = 0
    pos = {}
    for k, i, im in items:
        if x + im.width > W:
            x = 0; y += rowh + 1; rowh = 0
        pos[(k, i)] = (x, y)
        x += im.width + 1; rowh = max(rowh, im.height)
    atlas = Image.new('RGBA', (W, y + rowh))
    meta = {k: [None] * len(v) for k, v in P.items()}
    for k, i, im in items:
        px, py = pos[(k, i)]
        atlas.alpha_composite(im, (px, py))
        meta[k][i] = [px, py, im.width, im.height]
    return atlas, meta


def build():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    P = pieces()
    atlas, meta = pack(P)
    buf = io.BytesIO(); atlas.save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    regions = [dict(R, crystal=CRYSTALS.get(R['name'], 'c_green')) for R in REGIONS]
    p = os.path.join(ROOT, 'src', 'gen_tiles.js')
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// GENERATED by tools/build_tiles.py from the craftpix tilesets in assets/. Do not edit by hand.\n')
        f.write('const LEVEL_TILES = { atlas: "data:image/png;base64,' + b64 + '", pieces: ' + json.dumps(meta, separators=(',', ':')) + ', regions: ' + json.dumps(regions, separators=(',', ':')) + ' };\n')
    print('wrote', p, os.path.getsize(p), 'bytes, atlas', atlas.size, {k: len(v) for k, v in P.items()})


if __name__ == '__main__':
    build()
