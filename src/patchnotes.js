// Patch notes shown in Menu > Patch Notes (newest first). Keep PATCH_NOTES.md in step with this.
const PATCH_NOTES = [
  { v: '0.8 - Cards, Stars, Pets and Challenges', notes: [
    'Changed: parts from every machine are now doubled (the wiki's base Ore Income x2), and every Z-Fighter you hire adds another 10% parts. Parts income was far too low to ever afford the Construct research.',
    'Changed: Construct bar prices (Vein research, Vein spawning, Statues) are now 10% of what they were. With a maxed Zenkai the first three Vein zones are researched in about a day and a half and Planet Namek follows once you have the Veins and 2,000 Rainbow Capsules saved.',
    'New: Extreme Challenges (Menu > Challenges > EXTREME), unlocked when every Regular challenge is done. 26 tasks pay 10 Extreme Coins each; spend them on 9 upgrades (damage per Katchin, golden floor multiplier, banked Freebies, Black Star Dragon Ball spawn rate, Pet level cap, Galactic floor chance and more). Divine challenges need systems we do not have yet.',
    'New: Gifts (Menu > Gifts). Katchin Monolith clears give 2 Gifts, 1% of Freebie Packs hold one, and some Value Packs add more. Opening one gives a random reward: SUPER chests, Rainbow Capsules, Skill Bits, buffs, Senzu Beans and more, with rare rolls for extra Gifts or a big capsule prize.',
    'New: Value Packs, the wiki\'s paid bundles made earn-only. Each costs Rainbow Capsules and gives lasting perks (Skill Surge, Banker\'s, Vein Extractor, Pet Trainer, Stargazing Supernova, Loot Bulma Bonanza and more). They open as you clear Monoliths.',
    'New: Pets (Monolith 17, Menu > Pets). Buy Pets with Rainbow Capsules (after the first you need a total number of Pet levels). Each Pet levels up by chance when you do its thing: Crab (fire Ki Blast), Dwarf (Disc Power above level 25), Duck (deplete Veins), Rabbit (Contracts), Penguin (golden floors), Axolotl (Namek alloy), Whale (spend capsules), Totem (golden Veins), Happy-Bot (level up at 100+), Leprechaun (rainbow floors), Starfish (Black Star Dragon Balls), Dino (World 3 Veins), Nagini (golden machines).',
    'Level cap 10. A Skin (from level 5) gives a bonus and 15% better level-up odds. Not in yet: the Mr. Nibbles, Butterfly and Rhino Pets (fishing, frogs, essence) and Pet Quests and ranks.',
    'New: Stargazing (Monolith 23, Menu > Stargazing). Upgrade the Telescope with Veins to discover the 18 Stars (Aries to Phoenix), unlock them with Rainbow Capsules and level each one up with its own Stars for permanent perks. Every half hour the Stars move to new floors; each time you clear a floor a Star is on there is a 1 in 50 chance it appears, plus an extra chance for a Super Star. Tap Stars as they drift across the field, or buy Auto-catch.',
    'Telescope upgrades (spawn rate, double stars, auto-catch, Supernova, Supergiant, All Star multiplier...) are paid in Veins and Super Stars; Super Star upgrades give Experience, Game Speed, Rainbow Veins, Golden machine parts and more. Offline you keep the Stars of the floor you are on. Star cards and a Super Star card are new.',
    'Not in yet: the Black Hole, star wishing and following, and the Stars of World 4. Perks that needed pets, fishing or the Arcanist were swapped for ones we have.',
    'Changed: Loot Bulma now works like the wiki\'s Lootbugs. She flies by every 20 minutes (Contract and Store upgrades speed her up). Tap her plane for a free reward from a weighted list: Rainbow Capsules, Item or SUPER chests, Afterimage charges, 2 minutes of x2 parts, x3 Veins or x2 game speed.',
    'A visit you miss waits in the bank (3 at first; Store upgrades add more) and you claim it from Menu > Loot Bulma. Every visit also offers one more reward for 15 Rainbow Capsules (bigger buffs, x10 Technique recharge); golden visits give it free and triple visits are three at once. The Loot multiplier grows every reward. Loot Bulma and Golden Loot Bulma cards are new.',
    'New: the Cards system now follows the wiki. Cards drop from the thing they are for: machine cards (parts x1.5), alloy cards (alloy x1.5), Technique cards (a recharge may give an extra charge), Vein cards (Veins x1.5), plus Z-Fighter, form and misc cards. Odds add up within one action, and coming back from offline rolls once per card.',
    'New: Gild any card with Zeni, Zenkai Points and Rainbow Capsules for a bigger effect (x2). The new skill This Is Gonna Take A While.. (40 skill points) makes Polychrome Shards drop; 10 of them turn a Gilded card Polychrome (x4). Gilded and Polychrome cards count as new cards for bonuses.',
    'Misc cards: Zenkai, Freebie, Bulma\'s Order, Golden and Rainbow Machine, Earth/Namek/Sadala floors, Golden and Rainbow Vein, plus ours: Katchin, Loot Bulma and Ki Beam. Item, region, chest, goal and crit cards are gone. Infernal cards come later.',
    'Changed: old cards were reset with the new system.',
    'New: Challenges (Monolith 10, Menu > Challenges). 49 Regular challenges pay 10 Challenge Coins each; spend the coins on 18 permanent upgrades (alloy costs, crit, Zenkai and XP gain, damage per challenge and per skill, Katchin armor and more). Extreme and Divine challenges come with the systems they need.',
    'Some challenges are our versions of the wiki\'s: Z-Fighter, Technique and Construct tasks stand in for drone, pet and code ones, and the Technique-stack goals are smaller to fit our capacity.',
    'New: Construct (Monolith 19), a new Capsule Corp tab. Some machines now spawn as Veins (a crystal on top) and drop the zone\'s Veins as well as parts. Veins never reset.',
    'In Construct you research each zone\'s Veins, build 9 Statues (then gild them, then platinize them at Monolith 35) for permanent bonuses, and build the Monuments that open Planet Namek and Planet Sadala.',
    'Changed: Planet Namek and Planet Sadala no longer open with a Monolith clear. Their Monuments do. If you had already reached them, your save keeps them open.',
    'New: Form upgrades (Menu > Upgrades > FORMS, from Monolith 2): Form Power, Form Size, Form Speed, Form Crit and Form Efficiency. They only work while you are transformed, cost Zeni only, and reset on Zenkai.',
    'Fixed: Hellzone Grenade only hit once and stopped. It now hits 5 times, 1.25s apart (Workshop upgrades add more).',
    'Fixed: a Z-Fighter\'s attack bar no longer fills, drops back and fills again when there is nothing to shoot at high attack speed. It waits full until a machine appears.',
    'Z-Fighters now spread their shots out: each shot goes to the machine with the fewest shots already on the way, so a machine only gets two when there are more shots than machines.',
    'Golden machines: now and then a machine spawns golden and drops x3 parts. Rainbow machines (from golden ones) are in, waiting for the spells that make them.',
    'Golden Ore Chance comes from a new World 3 Contract upgrade (Monolith 42), the Golden Machine card and the Golden Ore Bundle in the Capsule Store.',
    'Fixed: "Golden floor 50%" machines (floors 69-72 and on Sadala) now make those floors 50% likely to be golden, as intended, instead of lowering the chance.',
    'Contracts: Salvage Yield is now Golden Floor Multiplier and Chest Meters is now Rainbow Floor Multi (Monolith 28), and four World 3 Contract upgrades arrive at Monolith 42-45.',
    'New: these Patch Notes, in the Menu.'
  ] },
  { v: '0.7', notes: [
    'The big rebalance: DBZ Idle now follows Shminer\'s numbers. Old saves were reset.',
    'Machines, floors, Zenkai, the Katchin Monolith, alloy, items and offline all use the Shminer wiki\'s rules.',
    'New: Planet Sadala (floors 73-102) after Namek; Zenkai upgrades are now unlockable upgrades in tiers; the DISC tab is a long list of upgrades that open with your Power Level.',
    'Techniques store charges that refill on their own timers; new ones unlock in the Workshop and the Store.',
    'New: Freebie Packs (the FREE button), Relics in SUPER chests, a new Workshop, Skill Tree and Capsule Store.'
  ] },
  { v: '0.6', notes: ['New: the Ki Beam (Monolith 9) and new Super Saiyan 3 art for Goku.'] }
];
