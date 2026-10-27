# DBZ Idle: design plan (v0.2)

Owner: Shulk. Status: playable build in `dist/dbz-idle.html`, published at https://claude.ai/artifact/TPJgPWV98FzjPtZhsXhAyQ. Every number below lives in `src/core.js` (TUNE and the tables under it), so tuning is a one-file job.

## 1. What it is

A new mode for the DBZ Fight Simulator: an idle game where you saw through machines with a Destructo Disc. You hold your finger on the battlefield, wreck Red Ribbon and Frieza Force machines, salvage their parts, sell or refine them, upgrade, and descend floor by floor. Every 20 minutes you can attack the Katchin Monolith; each clear opens new systems. Zenkai lets you start a run over and come back stronger.

Kept from the brief: not connected to the fight sim (own save key `dbzidle.v1`, data versioned by `S.v`), mobile-first hold-to-attack, local saves with offline progress. **Every enemy is a machine. No real money anywhere:** Rainbow Capsules are earned in game only.

## 2. Art

- **Machines**: craftpix packs in `assets/` (drones, robots, factory bosses, plus the war-machine preview sheets cut back to their pixel grid). `tools/build_sprites.py` → `src/gen_sprites.js` (idle + death animations, 20 base machines).
- **Variants**: the renderer repaints each base machine at load time: primary colours (Crimson, Cobalt, Gold, Jade, Frieza purple) and painted marks (yellow/black hazard stripes, a Red Ribbon badge, a USA flag decal), alone or combined. 20 sprites give 50 distinct machines with no extra art.
- **Levels**: craftpix tilesets (village, dungeon, undead, seabed, crystals). `tools/build_tiles.py` → `src/gen_tiles.js`. Each region lays its floor tiles, scatters its scenery and tints the result a little darker than the art, so the machines stand out. Skeletons, graves and the painted crystals were left out.
- **Fighters**: the fight sim's own rigs, drawn small and snapped to pixels (Goku in the HUD turns Super Saiyan after the first Zenkai; companions).
- Everything generated in code: the disc, the Katchin Monolith, Loot Bulma's plane, ki balls, explosions, technique effects.
- Font: Silkscreen. The field is drawn at ~175 game px across and scaled up with nearest-neighbour.

## 3. Screen layout (phone)

| Area | What is there |
|---|---|
| Top HUD | Zenkai Points, PL XP, level / level cap · fighter portrait · Zeni, Rainbow Capsules, Stats and Lab shortcuts |
| Under HUD | Training Goals strip (5 a day) |
| Left | ITEM chest meter (green) and SUPER chest meter (purple), with counts; tap to open chests |
| Right | Katchin Monolith button + timer; Techniques column (cooldowns, AUTO) |
| Bottom | Companion portraits · floor panel (floor, region, progress, up / deepest, STAY, tap name to choose a floor) |
| Nav | LAB · DISC · ITEMS · MENU · CAPSULE CORP (Companions / Workshop / Store) |

## 4. Floors, regions, machines

- 2 planets × 50 floors. Each 10 floors is a region with its own tileset look: **Earth**: West City, Countryside, Kame Beach, Red Ribbon HQ, Dr. Gero's Lab. **Namek**: Namekian Village, Blue Grass Plains, Ajisa Groves, Frieza's Landing, Dying Namek.
- A new machine joins every 2 floors. A floor sends the newest three: newest 20%, previous 35%, oldest 45%. **Older machines do not come back**: to farm an old part you go back up to its floors (floor panel), and STAY keeps you there.
- Destroying `20 + floor` machines (less with upgrades) moves you down a floor. Floor 51+ (Namek) needs Monolith 10.
- Machine tier t (0-49): HP `12 × 1.36^t`, armor `2 × 1.33^t`, part value `1.35^t` Zeni, XP `2 × 1.3^t`. Big machines (tanks, crawlers, Destroyers) have +40% HP.
- Each machine drops its own part (Scout Rotor, Tank Tread, Gold Optic Lens…). Parts go to Bulma's Lab: sell for Zeni or refine 4 → 1 Capsule Alloy.

## 5. What resets and what doesn't

| Resets on Zenkai | Kept forever |
|---|---|
| Power Level, Zeni, parts, alloy, floors, Disc upgrades, buffs, Technique cooldowns, Buu Wish run progress | Monolith clears (and level cap), companions + their upgrades, items, unopened chests, SUPER bonuses, Workshop, Capsule Store perks, Skill Tree, granted Buu Wishes, Rainbow Capsules, Zenkai upgrades |

## 6. Monolith unlocks (order is easy to change: `UNLOCKS` in core.js)

| Clear | Opens |
|---|---|
| 1 | Companions (Krillin) |
| 2 | Workshop (Gohan) |
| 3 | Techniques (Solar Flare, Spirit Bomb) + Skill Tree |
| 4 | Item chests (Kaio-ken, Piccolo) |
| 5 | SUPER chests |
| 6 | Workshop II (Hellzone Grenade) |
| 7 | Capsule Store (Vegeta) |
| 8 | Buu Wishes (Bulma's Smelter) |
| 10 | Planet Namek (Nappa) |

## 7. Katchin Monolith

- Fight every 20 min (5 min after a win), real time. 60 s limit (+ Zenkai, SUPER, wishes, skills). Techniques do nothing to it; the disc and companions do.
- Tier k: HP `20,000 × 3.2^k`, armor `8 × 2.3^k`. 50 tiers.
- **Damage carries over**: HP chipped off a tier stays (between attempts and through Zenkai) until it breaks, so a weaker player can wear a Monolith down over many tries.
- Each clear: Rainbow Capsules `20 + 5k`, Item chests `3 + 2k`, SUPER chests from Monolith 5, Skill Points from Monolith 3 (2 every third), **level cap +5** (starts at 25), plus the unlocks above. Menu → Monolith shows the next fight, every tier's rewards (ticked when cleared) and the unlock list.

## 8. The disc (DISC tab, resets)

Ki Power (max 100), Spin Rate, Disc Size, Sharp Edge (crit), Bigger Battlefield (more machines at once), Red Ribbon Beacon (+6% respawn speed per level, same cap), Haggling, Bulma's Tuning. Cost: Zeni `base × g^level` + alloy from the machine of tier `(level − from) / per`, quantity `2 + 1.2 × level`. Every third level also asks for an **older** part (any earlier machine on the planet), which means going back up to farm it. Crits ×2 (5% base); the Skill Tree adds super crits (×5).

## 9. Techniques (cooldowns only, no stacking)

| Technique | Opens | Cooldown | Effect |
|---|---|---|---|
| Solar Flare | M3 | 30s | weak flash; marks every machine: +100% parts |
| Spirit Bomb | M3 | 120s | one huge hit on everything (×30) |
| Kaio-ken | M4 | 45s | marks: ×2 Power Level, 0.5% chance of a Rainbow Capsule each |
| Hellzone Grenade | M6 | 60s | hits everything once a second for 10s |
| Bulma's Smelter | M8 | 90s | every machine on screen is scrapped straight into alloy |

Auto Techniques: Workshop II or the Skill Tree's Fighting Instinct. Keys 1-5 fire them.

## 10. Companions (Capsule Corp, permanent)

Hired with Zeni once their Monolith is cleared. Each throws ki every 1.2-3 s for Ki Power x its multiplier, sometimes shouting its move in a speech bubble (always on a SUPER crit or better). Upgrades per companion: **Damage** (+25%/lvl), **Attack Speed** (+8%/lvl), **Multishot** (+1 ball), **Crit Chance** (+3%/lvl, base 5%), **Trait** (stronger trait).

| Companion | Opens | Trait (base, + per Trait level) |
|---|---|---|
| Yamcha (stand-in art: no rig in the fight sim yet) | M1 | **Desert Bandit**: each hit steals 1% (+0.5%) of the machine's part value as Zeni, min 1 Z |
| Krillin | M1 | **Cutting Edge**: ignores 30% (+3%, max 90%) of armor, the Monolith's too |
| Gohan | M2 | **Hidden Potential**: +25% (+5%) crit chance |
| Piccolo | M4 | **Piercing Beam**: every shot also hits a second machine for 50% (+5%) |
| Vegeta | M7 | **Saiyan Pride**: machines he hits drop +50% (+10%) parts |
| Nappa | M10 | **Bomber**: hits every machine near the target for 30% (+4%) |

## 10b. Crits (disc and companions)

Crit chance can pass 100%. Up to 100% it is the chance of a **CRIT** (x2). Above 100%, every 2% of chance buys 1% of the next tier: 101-300% rolls **SUPER** (x3), then **ULTRA** (x4), **MEGA** (x5), GIGA, TERA, OMEGA. One roll per hit: only the strongest tier that passes counts. Crit Damage bonuses multiply every tier. Damage numbers are coloured by tier (CRIT gold, SUPER red, ULTRA violet, MEGA cyan…), with the tier name over SUPER and up. `TUNE.critOver` sets the "2% buys 1%" rate; `node tools/crit_check.js` prints the split.

## 11. Chests and items

- Meters fill by damage: one "machine's worth" of damage = one machine's HP. Item chest every 150, SUPER every 1,200 (bonuses speed it). Also from Monolith clears, Loot Bulma, goals, the store.
- **Item chest** → 1 item (Common 55 / Rare 28 / Epic 12 / Legendary 4.5 / Mythic 0.5 %).
- **Items** (kept on Zenkai): Weighted Clothes, Turbo Spin, Disc Capsule, Scouter, Chi-Chi's Rice Bowl (commons, also buyable) · Senzu Bean (resets all Technique cooldowns), Time Chamber (×2 speed), Capsule Magnet, Sacred Water · Gravity Machine, Kami's Blessing, Dragon Radar · Elder Kai's Ritual, Fusion Dance · Potara Earrings. Buffs of one kind don't stack: the strongest applies.
- **SUPER chest** → one stack of a permanent bonus (Common 50 / Rare 30 / Epic 14 / Legendary 5 / Mythic 1 %: disc damage, sell value, crits, technique power/cooldown, chest speed, double salvage, companion speed, Zenkai points, Monolith time, floor requirement, all damage +50%, companion multishot) + 1-3 Rainbow Capsules (5% chance of +10).

## 12. Rainbow Capsules (premium currency, earned only)

Sources: SUPER chests, Monolith clears, Loot Bulma, Kaio-ken marks, Buu Wish "Into The Depths". Spent in the **Capsule Store** (M7): Skill Point (100), 10 Item chests (30), SUPER chest (45), 3 Time Chambers (25), Capsule House (+25% offline, ×4), Capsule Corp Card (+20% Zeni, ×5), Bulma's New Plane (Bulma visits 20% more, ×3), Bean Pouch (+1 item per chest, ×2).

## 13. Loot Bulma

Bulma's capsule plane flies across the field every 4-9 minutes for 9 seconds. Tap it: Zeni (35%), 3 Item chests (25%), a random item (22%), a SUPER chest (10%), 5-15 Rainbow Capsules (8%).

## 14. Skill Tree (opens M3)

3 branches (Disc / Technique / Fortune) × 8 rows. Row r opens at Monolith `3 + 2r`. A node needs the node above it. 24 nodes, e.g. Destructo Edge, Spinning Saw, Wait My Crits Can Crit?, Masenko Edge, Ultra Edge (×2 all damage); Ki Control, Big Bang, Kaio-ken Times Three, Afterimage, Spirit Gathering, Fighting Instinct, Hellzone Mastery; Bulma's Eye, Lucky Capsules, Scrapper, Smart Refining, Zenkai Boost, Easy Descent, Capsule Saver, Monolith Breaker.

## 15. Workshop (M2, Workshop II at M6, permanent)

Disc Mastery, Field Expansion, Red Ribbon Radar (spawn speed), Salvage Expert, Quick Descent, Capsule Generator (offline +1h) · II: Technique Training, Technique Power, Auto Techniques, Chest Detector, Crit Training, Head Start (runs start 5 floors deeper).

## 16. Buu Wishes (M8)

Per-run challenges with permanent rewards, each granted once: Scrap Collector (10,000 Scout Rotors), Bare Hands (floor 40 with no Disc upgrades), Speed Run (floor 25 within 15 min), Machine Breaker (3,000 machines), Technique Master (40 Techniques), Mr. Satan Money (1B Zeni), No Help Needed (Monolith clear with no items used), Into The Depths (floor 75).

## 17. Zenkai

PL 20+. Points `(PL − 15)^1.25 × (1 + 0.1 × Monoliths) × (1 + best floor / 200) × (1 + best Monolith % / 2)` × bonuses. Three tiers of upgrades (tier 2: M4 or 2 Zenkais; tier 3: M8 or 5 Zenkais): disc power, Monolith time, Katchin weakness, PL gain, salvage yield, technique cooldown/damage, starting Zeni, disc size, chest meters, companion power, offline limit, double refine, floor requirement.

## 18. Offline

Up to 8 h (+Workshop, +Zenkai). Companions keep fighting at half rate (capped by respawn) **and keep descending floors**; chest meters fill; Technique cooldowns run down. Option "Use buffs while away": running buffs (and the Time Chamber's ×2) help; off, they wait.

## 19. Pacing (`node tools/sim.js 24 0.7`: a near-perfect bot holding the disc 70% of the time)

| Milestone | Bot time |
|---|---|
| Floor 10 | 8 min |
| Monolith 1 (Companions) | 20 min |
| Monolith 3 (Techniques, Skill Tree) | ~2 h |
| Monolith 5 (SUPER chests) | ~3.5 h |
| Monolith 10 (Namek) | ~8 h |
| Floor 100 | ~14.5 h |

Real players will be slower. Watch: Monoliths 8-11 come close together once floor 50 is reached.

## 20. Not built yet

- Inside the fight sim app (needs the sim's `src/`; a `patch_idle.py` adds a tab).
- More planets (Yardrat, Planet Frieza 79, Kai world: same system, new tilesets and variants), events, Dragon Balls, sound, more companions (Yamcha/Tien need rigs).

## 21. Open questions for Shulk

1. Unlock order is in place as you listed it. Your list had Workshop twice, so the second one became "Workshop II" (Technique and chest upgrades) at Monolith 6. Right call?
2. Are 20 min Monolith cooldowns and the pacing table above right for your friends?
3. The battle tanks preview (top-down, painted) is cut but unused: it clashed with the side-view machines. Use it anyway?
4. Should companions descend floors while you're away (current), or only farm the floor you left them on?
