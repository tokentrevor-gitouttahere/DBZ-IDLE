# DBZ Idle

An idle game mode for the DBZ Fight Simulator: hold to spin a Destructo Disc through Red Ribbon and Frieza Force
machines, salvage parts, upgrade, break the Katchin Monolith, and power up from Super Saiyan to Mastered Ultra
Instinct (Goku) or Ultra Ego (Vegeta).

**Play:** https://tokentrevor-gitouttahere.github.io/DBZ-IDLE/ (mobile first; saves stay in your browser).
Machine variants gallery: https://tokentrevor-gitouttahere.github.io/DBZ-IDLE/gallery.html

A fan project, not affiliated with the Dragon Ball rights holders. No real money anywhere.

## Build

```
python tools/build.py      # src/* -> dist/dbz-idle.html, dist/preview.html, docs/ (GitHub Pages)
node tools/sim.js 24 0.7   # 24h pacing bot
```

- `src/core.js` rules and every tuning number, `src/render.js` canvas, `src/ui.js` HUD and panels.
- `src/gen_*.js` are generated: `tools/extract_rigs.py <fight-sim.html>` (fighters), `tools/build_sprites.py`
  and `tools/build_tiles.py` (machines and levels; these need the craftpix packs in `assets/`, which are not in
  this repo because their licence doesn't allow redistributing the raw files).
- `IDLE_DESIGN.md` is the full design, `HANDOFF.txt` the current state, `ASSETS.md` where the art came from.

## Credits

Machines and levels: craftpix.net packs (https://craftpix.net/file-licenses/), cut down and repainted in the game.
Fighters: the DBZ Fight Simulator's rigs (pivot figures by Killeroner and FNF GAMPLAY, edited for the sim).
Font: Silkscreen by Jason Kottke, SIL Open Font License 1.1.
