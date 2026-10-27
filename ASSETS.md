# DBZ Idle: assets

## Machines (tools/build_sprites.py -> src/gen_sprites.js)
- craftpix free packs (zips in assets/, read directly): drones pack (scout, gun drone, rotor, freighter, hauler, saucer), factory boss pack (missile crawler, spider walker; boss 1 skipped, it's a person), robot pack (Infantryman, Swordsman, Destroyer androids). The drones pack's "Character animations" are people: skipped.
- Preview sheets (.jpg/.webp, owner has the license): tank sprite (cannon walker), balloon, barrel bot, big tank, drone sprite (patrol drone), flipper (rail crawler), laser drone (crab), missile jeep (half size), scorp drone. The extractor finds each preview's pixel grid (about 4.4-5x), reads every art pixel back from the middle of its block, keys out the grey and adds an outline.
- battle tanks.jpg: top-down painted tanks, cut by `from_grid` but not used (clashed with the side-view art).
- Variants are painted at runtime in render.js (`frames()`): paint = hue swap of saturated pixels; marks = hazard stripes, Red Ribbon badge (9x7 stamp), flag (10x7 stamp).

## Levels (tools/build_tiles.py -> src/gen_tiles.js)
- Village tileset (sand/grass tiles, grass tufts, stones, boxes, decor, tents), dungeon pack (cobble + plate floors, crates/barrels/pots, chest icon), undead tileset (rock floor, rocks, plants, trees, ruins, ground details; bones/graves/lich/skulls left out), seabed objects (shells, starfish, coral, anchor, wheel, ships), top-down crystals (scenery + loot icons). The painted 2D crystals pack is not pixel art: unused.
- `REGIONS` in build_tiles.py holds each region's floor pieces, scenery and tint. `--preview out.png` renders all 10 for a quick look.

## Fighters
- The fight sim's rig drawer and 7 rigs (tools/extract_rigs.py -> src/gen_rigs.js), credits in the game's Credits.

## Fonts
- Silkscreen 400/700 (SIL OFL), from the mockup.

## Licences
- craftpix.net file licence (https://craftpix.net/file-licenses/): use in games, no redistribution of the raw files. The repo keeps the zips; the game ships only cut-down atlases.
