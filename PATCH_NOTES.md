# DBZ Idle patch notes

Newest first. The same notes are in the game (Menu > Patch Notes, from `src/patchnotes.js`); keep both in step.

## 0.9 - A mode of DBZ: Blazing Sun
- **In the Blazing Sun app:** DBZ Idle is now also a mode inside the DBZ: Blazing Sun app (the fight sim's Windows app
  and website). There, Menu > Options > GAME MODE switches to the fight sim, and the fight sim's Options switch back.
  Each game keeps its own save and never changes the other; the app opens in whichever one you played last.
- Saves don't move between this website and the app by themselves: copy your code in Options > MOVE YOUR SAVE and paste
  it into the app's DBZ Idle.

## 0.8 - Cards, Stars, Pets and Challenges
- **Parts x2:** every machine now gives double parts (the wiki's base Ore Income x2) and each hired Z-Fighter adds
  another 10%. **Construct bar prices are 10% of before**, so Namek is reachable in about 4-5 days of play.
- **Extreme Challenges** (Menu > Challenges > EXTREME): open when every Regular challenge is done. 26 tasks pay 10 Extreme
  Coins each; 9 upgrades to buy (damage per Katchin, golden floor multiplier, Pet cap, Galactic chance...). Divine later.
- **Gifts** (Menu > Gifts): each Monolith clear gives 2, 1% of Freebie Packs hold one, some Value Packs add more. A Gift
  is a random reward (SUPER chests, capsules, Skill Bits, buffs, Senzu Beans...) with rare rolls for more Gifts or a big
  capsule prize.
- **Value Packs:** the wiki's paid bundles made earn-only: each costs Rainbow Capsules and gives lasting perks (Skill
  Surge, Banker's, Vein Extractor, Pet Trainer, Stargazing Supernova, Loot Bulma Bonanza...). They open with Monoliths.
- **Pets** (Monolith 17): 13 Pets bought with Rainbow Capsules (after the first you need a total of Pet levels). Each
  levels up by chance when you do its thing (Crab: Ki Blast, Dwarf: Disc Power above 25, Duck: Veins, Rabbit: Contracts,
  Penguin: golden floors, Axolotl: Namek alloy, Whale: spending capsules, Totem: golden Veins, Happy-Bot: levels at 100+,
  Leprechaun: rainbow floors, Starfish: Black Star Dragon Balls, Dino: World 3 Veins, Nagini: golden machines). Cap 10;
  Skins from level 5. Not in yet: Mr. Nibbles, Butterfly, Rhino, Pet Quests.
- **Stargazing** (Monolith 23): upgrade the Telescope with Veins to discover 18 Stars (Aries to Phoenix), unlock them
  with Rainbow Capsules and level each with its own Stars for permanent perks. Stars move floors every half hour; clearing
  a floor with a Star on it has a 1 in 50 chance to show it (plus a Super Star chance). Tap Stars as they drift across, or
  buy Auto-catch. Telescope and Super Star upgrades are paid in Veins and Super Stars. Star cards and a Super Star card
  added. Not in yet: the Black Hole, star wishing/following, World 4 Stars.
- **Loot Bulma** works like the wiki's Lootbugs. She flies by every 20 minutes (Contract and Store upgrades speed her
  up); tap her plane for a free reward from a weighted list (capsules, Item/SUPER chests, Afterimage charges, 2 minutes
  of x2 parts, x3 Veins or x2 game speed). Missed visits wait in the bank (3 at first, Store upgrades add more) and are
  claimed from Menu > Loot Bulma. Each visit also offers a 15-capsule reward; golden visits give it free and triple
  visits are three at once. New cards: Loot Bulma and Golden Loot Bulma.
- **Cards** now follow the wiki. They drop from the thing they are for: machine cards (parts x1.5), alloy cards
  (alloy x1.5), Technique cards (a recharge may give an extra charge), Vein cards (Veins x1.5), plus Z-Fighter, form
  and misc cards. Odds add up within one action; offline rolls once per card.
- **Gilding:** Zeni + Zenkai Points + Rainbow Capsules make a card x2. The skill *This Is Gonna Take A While..*
  (40 skill points) drops Polychrome Shards; 10 turn a Gilded card Polychrome (x4). Gilded and Polychrome cards count
  as new cards for bonuses.
- Misc cards: Zenkai, Freebie, Bulma's Order, Golden/Rainbow Machine, Earth/Namek/Sadala floors, Golden/Rainbow Vein,
  and ours: Katchin, Loot Bulma, Ki Beam. Item, region, chest, goal and crit cards are gone; Infernal cards come later.
  Old cards were reset.
- **Challenges** (Monolith 10, Menu > Challenges): 49 Regular challenges pay 10 Challenge Coins each; spend them on
  18 permanent upgrades (alloy costs, crit, Zenkai and XP gain, damage per challenge and per skill, Katchin armor...).
  Extreme and Divine challenges come with the systems they need. Some tasks are our versions of the wiki's (Z-Fighter,
  Technique and Construct tasks stand in for drone, pet and code ones; Technique-stack goals fit our capacity).
- **Construct** (Monolith 19, new Capsule Corp tab): some machines spawn as **Veins** (a crystal on top) and drop the
  zone's Veins as well as parts; Veins never reset. Research each zone's Veins, build 9 Statues (then gild them, then
  platinize them at Monolith 35) for permanent bonuses, and build the **Monuments** that open Planet Namek and Planet
  Sadala.
- **Changed:** Planet Namek and Planet Sadala no longer open with a Monolith clear; their Monuments do. Saves that had
  already reached them keep them open.
- **Form upgrades** (Menu > Upgrades > FORMS, from Monolith 2): Form Power, Form Size, Form Speed, Form Crit and Form
  Efficiency. They only work while you are transformed, cost Zeni only, and reset on Zenkai.
- **Fixed:** Hellzone Grenade only hit once and stopped. It now hits 5 times, 1.25s apart (Workshop adds more).
- **Fixed:** a Z-Fighter's attack bar no longer fills, drops back and fills again when there is nothing to shoot at
  high attack speed. It waits full until a machine appears.
- Z-Fighters spread their shots out: each shot goes to the machine with the fewest shots already on the way, so a
  machine only gets two when there are more shots than machines.
- **Golden machines:** now and then a machine spawns golden and drops x3 parts. Rainbow machines (rolled on golden
  ones) are in, waiting for the spells that make them.
- Golden Ore Chance comes from a new World 3 Contract upgrade (Monolith 42), the Golden Machine card and the
  Golden Ore Bundle in the Capsule Store.
- **Fixed:** "Golden floor 50%" machines (floors 69-72 and on Sadala) now make those floors 50% likely to be golden,
  as intended, instead of lowering the chance.
- **Contracts:** Salvage Yield is now Golden Floor Multiplier and Chest Meters is now Rainbow Floor Multi
  (Monolith 28); four World 3 Contract upgrades arrive at Monolith 42-45.
- New: Patch Notes in the Menu.

## 0.7 - the Shminer rebalance
- DBZ Idle now follows Shminer's numbers. Old saves were reset.
- Machines, floors, Zenkai, the Katchin Monolith, alloy, items and offline use the Shminer wiki's rules.
- New: Planet Sadala (floors 73-102) after Namek; Zenkai upgrades are unlockable upgrades in tiers; the DISC tab is
  a long list of upgrades that open with your Power Level.
- Techniques store charges that refill on their own timers; new ones unlock in the Workshop and the Store.
- New: Freebie Packs (the FREE button), Relics in SUPER chests, a new Workshop, Skill Tree and Capsule Store.

## 0.6
- New: the Ki Beam (Monolith 9) and new Super Saiyan 3 art for Goku.
