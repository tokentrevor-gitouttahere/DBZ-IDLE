#!/usr/bin/env python3
"""Builds dist/dbz-idle.html (one self-contained page: fonts, CSS and JS inlined) from src/.
Usage: python tools/build.py"""
import base64, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda *p: open(os.path.join(ROOT, *p), encoding='utf-8').read()
b64 = lambda *p: base64.b64encode(open(os.path.join(ROOT, *p), 'rb').read()).decode('ascii')
js = '\n'.join(rd('src', f) for f in ('gen_rigs.js', 'gen_looks.js', 'gen_sprites.js', 'gen_tiles.js', 'core.js', 'patchnotes.js', 'render.js', 'ui.js'))
if '</script' in js:
    raise SystemExit('build: a script contains </script')
page = (rd('src', 'shell.html').replace('{{FONT400}}', b64('assets', 'silkscreen-400.woff2'))
        .replace('{{FONT700}}', b64('assets', 'silkscreen-700.woff2')).replace('{{CSS}}', rd('src', 'idle.css')).replace('{{JS}}', js))
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'dbz-idle.html')
open(out, 'w', encoding='utf-8', newline='\n').write(page)
# a local preview wrapper (the artifact host adds the doctype/head itself)
prev = os.path.join(ROOT, 'dist', 'preview.html')
open(prev, 'w', encoding='utf-8', newline='\n').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>' + page + '</body></html>')
print('built', out, os.path.getsize(out), 'bytes')

# machine gallery: every body x paint x mark, painted by the game's renderer
gjs = '\n'.join(rd('src', f) for f in ('gen_sprites.js', 'gen_tiles.js', 'core.js', 'render.js', 'gallery.js'))
gallery = ('<title>Machine Variants</title><style>'
           ':root{color-scheme:dark;--bg:#16161b;--panel:#1f1f26;--line:#34343d;--text:#ece8de;--mute:#9c988f;--gold:#ffd34d}'
           "@font-face{font-family:'Silkscreen';src:url(data:font/woff2;base64," + b64('assets', 'silkscreen-400.woff2') + ") format('woff2')}"
           'body{background:var(--bg);color:var(--text);font:11px Silkscreen,monospace;margin:0;padding-block:16px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}'
           'h1{font-size:18px;color:var(--gold);margin:0 0 4px}#count{color:var(--mute);margin:0 0 16px}'
           'section{margin-bottom:22px}h2{font-size:13px;margin:0 0 8px;text-transform:uppercase}'
           '.wrap{overflow-x:auto}.grid{display:grid;grid-template-columns:auto repeat(4,auto);gap:6px;align-items:center;justify-content:start}'
           '.grid b{font-size:9px;color:var(--mute);text-transform:uppercase}.cell{position:relative;padding:6px;background:var(--panel);border:2px solid var(--line);display:grid;place-items:end center;min-height:60px}'
           '.cell canvas{image-rendering:pixelated}.cell.used{border-color:var(--gold)}.cell i{position:absolute;left:3px;top:2px;font-style:normal;font-size:7px;color:var(--gold)}'
           '</style><meta name="claude:viewport-fit-sides" content="cover">'
           '<h1>Machine Variants</h1><p id="count">Painting...</p><div class="wrap" id="list"></div><script>' + gjs + '</script>')
open(os.path.join(ROOT, 'dist', 'gallery.html'), 'w', encoding='utf-8', newline='\n').write(gallery)
print('built gallery', os.path.getsize(os.path.join(ROOT, 'dist', 'gallery.html')), 'bytes')

# GitHub Pages (main branch, /docs): the game at the site root, the gallery next to it, both as full documents
os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
doc = lambda body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>' + body + '</body></html>'
open(os.path.join(ROOT, 'docs', 'index.html'), 'w', encoding='utf-8', newline='\n').write(doc(page))
open(os.path.join(ROOT, 'docs', 'gallery.html'), 'w', encoding='utf-8', newline='\n').write(doc(gallery))
open(os.path.join(ROOT, 'docs', '.nojekyll'), 'w').close()
print('built docs/ for GitHub Pages')
