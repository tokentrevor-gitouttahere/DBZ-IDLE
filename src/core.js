// DBZ Idle - game rules. No DOM here: the page (ui.js + render.js) and the economy sim (tools/sim.js) both run it.
// State (S) is what gets saved. World (W) is the live field (machines, ki shots, the Monolith fight) and is rebuilt
// on load. Every number a designer may want to tune lives in TUNE or the tables right under it.
const IdleCore = (() => {
  const VERSION = 3; // v3: the Shminer rebalance. Older saves don't load (owner chose a full wipe)
  const SAVE_KEY = 'dbzidle.v1'; // the fight sim uses dbzsim.v1*: separate on purpose. The key stays; S.v versions the data.

  const TUNE = {
    // Katchin Monolith = Shminer's Obelisk (wiki): 20 min between attempts (wins too), 30 s fights, HP and armor x2.8
    monoCooldown: 20 * 60, // s between Katchin Monolith attempts (also the wait before the first one)
    monoTime: 30, // s per attempt, before bonuses
    monoHp: 100000, monoHpG: 2.8, // tier k HP = monoHp * monoHpG^k
    monoArmor: 10, monoArmorG: 2.8, // tier k armor (the first Monolith: 5)
    monoTiers: 50,
    levelCap: 30, levelCapPer: 5, // Power Level cap: 30, +5 per Monolith cleared (Shminer)
    // offline (wiki): up to 12h (24h with the Founder pass: ours is earned in the Capsule Store), parts x0.92,
    // chest meters stop but 0.3 Item and 0.1 SUPER chests come per hour
    offlineCapH: 12, offlineEff: 0.92, offItemPerH: 0.3, offSuperPerH: 0.1,
    // Freebie Pack (wiki Store): every 10 min of game time, 2 banked, 5 Rainbow Capsules + 1 Item chest, 10% SUPER
    // chest, 10% Skill Bit (10 bits = 1 Skill Point)
    freebieEvery: 600, freebieBank: 2, freebieCaps: 5, freebieSuper: 0.1, freebieBit: 0.1,
    spawnEvery: 0.7,
    minDmgShare: 0.05, // hits below armor still do this share of the hit
    zenkaiLevel: 20,
    goalsPerDay: 5,
    itemChestEvery: 150, // machines' worth of damage per Item chest
    superChestEvery: 1200, // ... per SUPER chest
    techBase: 6, // a Technique hits for Ki Power x this x the Technique's own multiplier
    techCap: 10, // Technique (bomb) capacity before bonuses (ours: the wiki doesn't give the base)
    critOver: 2, // above 100% crit chance, this much chance buys 1% of the next crit tier
    kiMax: 100, kiRegen: 5, kiMinStart: 25, // Ki: pool, refill per s in base form, Ki needed to transform
    // Ki Beam (Monolith 9): fires from your fighter through your finger to the edge of the field, hitting everything
    // on the way. beamPower x the disc's Ki Power per hit, beamRate hits a second, drains beamDrain Ki a second
    // (the same Ki as forms). beamWidth in game px; split beams fan out beamSpread radians apart.
    beamPower: 0.5, beamRate: 8, beamDrain: 7, beamMinStart: 15, beamWidth: 10, beamSpread: 0.12,
    burnTime: 3, burnEvery: 0.5, // Burn: machines the beam touched keep burning this long after, hurting every burnEvery s
    // Z points (Z-Fighter currency, bought with Zeni, kept through Zenkai): the first Zeni buys zpFirst points, then
    // 1 Zeni each up to zpFlat bought, then point n costs (n / zpFlat)^zpPow Zeni (the millionth: ~500K Zeni)
    zpFirst: 10, zpFlat: 750, zpPow: 1.824,
    // Zeni prices set before the Shminer rebalance (Workshop, Ki Beam, Z points) are multiplied by this: the wiki's
    // part sell prices are about 50x lower than ours were
    zeniK: 0.02,
    // Shminer's base pickaxe stats aren't on the wiki as text; these set ours (tuned with the sim)
    discK: 8, // Ki Power damage = (level + 1)(level + 2) / 2 x discK
    bulmaMin: 240, bulmaMax: 540, bulmaStay: 9 // Loot Bulma: seconds between visits, seconds on screen
  };

  // ------------------------------------------------------------------ world tables
  // Shminer's worlds (wiki Floors): World 1 = floors 1-42 (Earth), World 2 = floors 43-72 (Namek).
  // clear: floor clears needed to go down = floor x this (wiki Floor Clear Requirement)
  const PLANETS = [
    { id: 'earth', name: 'Earth', short: 'EARTH', gate: 0, from: 1, to: 42, clear: 5 },
    { id: 'namek', name: 'Namek', short: 'NAMEK', gate: 10, from: 43, to: 72, clear: 15 }, // gate: Monoliths cleared to go past floor 42
    // World 3: game speed -30% on the whole planet (wiki). The wiki doesn't say what opens World 3: ours is Monolith 20
    { id: 'sadala', name: 'Planet Sadala', short: 'SADALA', gate: 20, from: 73, to: 102, clear: 35, speed: 0.7 }
  ];
  // regions = Shminer's zones: Stone 1-8, Magma 9-18, Virtual 19-24, Space 25-30, Cloud + Atomic 31-42 (we have five
  // Earth tilesets), then World 2's five zones of six floors
  const REGION_FLOORS = [[1, 8], [9, 18], [19, 24], [25, 30], [31, 42], [43, 48], [49, 54], [55, 60], [61, 66], [67, 72], [73, 78], [79, 84], [85, 90], [91, 96], [97, 102]];
  // 10 floors per region, 5 regions per planet
  const REGIONS = [
    { name: 'West City', ground: ['#3b3a37', '#33322f', '#45433f', '#2a2927'], crack: '#2a2927' },
    { name: 'Countryside', ground: ['#39402f', '#323929', '#434b37', '#282e21'], crack: '#282e21' },
    { name: 'Kame Beach', ground: ['#4a4436', '#423d30', '#554e3e', '#363127'], crack: '#363127' },
    { name: 'Red Ribbon HQ', ground: ['#3a3434', '#322d2d', '#453d3d', '#292424'], crack: '#7a2a24' },
    { name: "Dr. Gero's Lab", ground: ['#2b2a2e', '#242327', '#353439', '#1b1a1e'], crack: '#2fa8c8' },
    { name: 'Namekian Village', ground: ['#34403a', '#2d3832', '#3e4b44', '#252e29'], crack: '#252e29' },
    { name: 'Blue Grass Plains', ground: ['#2f3c42', '#29353a', '#38474e', '#212b2f'], crack: '#212b2f' },
    { name: 'Ajisa Groves', ground: ['#33402f', '#2c3828', '#3d4b38', '#232d20'], crack: '#232d20' },
    { name: "Frieza's Landing", ground: ['#3a3546', '#322e3d', '#443f52', '#29252f'], crack: '#8a5ad0' },
    { name: 'Dying Namek', ground: ['#3d2c2a', '#352624', '#473431', '#2a1e1c'], crack: '#ff6a2a' },
    { name: 'Sadala Outskirts', ground: ['#4a3028', '#402a23', '#563a30', '#33221c'], crack: '#33221c' },
    { name: 'Royal Capital', ground: ['#463634', '#3d2f2d', '#52403d', '#2f2423'], crack: '#c8a040' },
    { name: 'Saiyan Training Grounds', ground: ['#4d3a2a', '#433224', '#594433', '#36281c'], crack: '#36281c' },
    { name: 'Pod Launch Bay', ground: ['#3a3236', '#322b2f', '#453b40', '#282226'], crack: '#ff8a2a' },
    { name: 'Burning Sadala', ground: ['#40261f', '#38211b', '#4b2d25', '#2c1915'], crack: '#ff5a1a' }
  ];
  // sprite: atlas row in gen_sprites.js; r: hit radius in game px; big: tougher than its tier
  const SPRITES = {
    scout: { r: 12 }, patrol: { r: 12 }, hauler: { r: 12 }, saucer: { r: 12 }, gundrone: { r: 11 },
    barrel: { r: 12 }, flipper: { r: 13 }, walker: { r: 14 }, jeep: { r: 13 }, bigtank: { r: 15, big: 1 },
    balloon: { r: 12 }, crab: { r: 14 }, scorpion: { r: 12 }, freighter: { r: 13 }, rotor: { r: 13 },
    spider: { r: 15, big: 1 }, crawler: { r: 17, big: 1 }, infantry: { r: 11 }, blade: { r: 13 }, destroyer: { r: 12, big: 1 }
  };
  // [sprite, name, part dropped, part colour]; hue: tint in degrees (0 = the art's own colours)
  const BASE = {
    scout: ['Scout Drone', 'Scout Rotor', '#e05a4a'], patrol: ['Patrol Drone', 'Optic Lens', '#7ce0ff'], hauler: ['Capsule Hauler', 'Hauler Plate', '#c9d6e3'],
    saucer: ['Pilaf Saucer', 'Saucer Dome', '#ffd34d'], gundrone: ['Gun Drone', 'Drone Barrel', '#ff8a3a'], barrel: ['Barrel Bot', 'Fuel Cell', '#ff7a2a'],
    flipper: ['Rail Crawler', 'Rail Coil', '#ffb030'], walker: ['Cannon Walker', 'Walker Servo', '#6fd27a'], jeep: ['Missile Jeep', 'Missile Pod', '#9be37b'],
    bigtank: ['Battle Tank', 'Tank Tread', '#b08a5a'], balloon: ['Recon Balloon', 'Balloon Burner', '#ff9a7a'], crab: ['Laser Crab', 'Laser Lens', '#ff4a6a'],
    scorpion: ['Scorpion Drone', 'Stinger Tip', '#e8f4ff'], freighter: ['Hover Freighter', 'Hover Engine', '#ff8f40'], rotor: ['Rotor Copter', 'Copter Blade', '#f0a050'],
    spider: ['Spider Walker', 'Coolant Tank', '#8fe06a'], crawler: ['Missile Crawler', 'Warhead', '#62e8b8'], infantry: ['Infantry Android', 'Android Joint', '#f0e0a0'],
    blade: ['Blade Android', 'Plasma Edge', '#9fe4ff'], destroyer: ['Destroyer Android', 'Reactor Core', '#c0b8e0']
  };
  // Variants: a base sprite repainted in a primary colour and/or with a painted pattern makes a new machine.
  // render.js does the painting (paint: red, blue, yellow, green, purple; mark: hazard stripes, rr badge, flag)
  const PAINT = { orange: ['Sadalan ', '#ff8a2a'], red: ['Crimson ', '#e8443a'], blue: ['Cobalt ', '#4f8cff'], yellow: ['Gold ', '#ffd23f'], green: ['Jade ', '#4fd36a'], purple: ['Frieza ', '#b45cff'] };
  const MARK = { hazard: 'Hazard ', rr: 'Red Ribbon ', flag: 'Patriot ' };
  // Shminer parity (wiki Ores + Craft pages): machine t takes ore t's HP, XP and bar cost. Earth = World 1's first 25
  // ores, Namek = World 2's 20 ores then World 3's first 5. Machines have no armor (ores don't); World 2+ ores carry a
  // modifier (MODS below; Health +x% is already in the HP).
  const ORE_HP = [10, 25, 60, 150, 375, 935, 2335, 5835, 14590, 36600, 91150, 227880, 569680, 1.42e6, 3.56e6, 8.9e6, 22.3e6, 55.63e6, 139.08e6, 347.71e6, 869.27e6, 2.17e9, 5.43e9, 13.58e9, 33.96e9,
    84.89e9,
    424.45e9, 1.06e12, 2.65e12, 19.9e12, 16.58e12, 41.45e12, 103.62e12, 1.04e15, 647.66e12, 1.62e15, 16.19e15, 50.6e15, 50.6e15, 126.5e15, 1.9e18, 790.6e15, 1.98e18, 4.94e18, 12.35e18, 30.88e18,
    1.08e21, 386.03e18, 965.08e18, 21.71e21, 6.03e21, 15.08e21, 37.7e21, 94.25e21, 235.62e21, 589.04e21,
    1.47e24, 3.68e24, 27.61e24, 69.03e24, 172.57e24, 3.88e27, 1.08e27, 24.27e27, 6.74e27, 16.85e27];
  const ORE_XP = [2, 5, 12.17, 28.79, 66.23, 147.91, 320.47, 672.98, 1370, 2690, 5110, 9370, 16560, 28150, 45980, 72040, 108060, 154890, 211690, 275190, 339400, 395970, 435570, 450090, 450090, 450090,
    450090, 540100, 648120, 777750, 933300, 1.12e6, 1.34e6, 1.61e6, 1.94e6, 2.32e6, 2.79e6, 3.34e6, 4.01e6, 4.82e6, 5.78e6, 6.93e6, 8.32e6, 9.99e6, 11.98e6, 14.38e6,
    17.26e6, 20.71e6, 34.85e6, 29.82e6, 35.78e6, 42.94e6, 51.52e6, 61.83e6, 74.19e6, 89.03e6,
    106.84e6, 128.21e6, 153.85e6, 184.62e6, 221.54e6, 265.85e6, 319.02e6, 382.83e6, 459.39e6, 551.27e6];
  // parts per alloy before discounts (wiki Craft: Base Cost)
  const ORE_BAR = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 25, 28, 31, 34, 38, 42, 46, 50, 60, 70, 80, 90,
    100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 238, 266, 294, 322, 350, 378, 406, 434,
    502, 570, 638, 706, 774, 842, 910, 978, 1050, 1110, 1180, 1250, 1460, 1670, 1870, 2080, 2290, 2500, 2710, 2910];
  // ore modifiers by machine t (wiki Ores, World 2 and 3). crit: only hits of this crit tier or better do damage;
  // dmg: all damage x; tech: Technique damage x; techCd: Technique cooldowns run at this speed while it's out;
  // speed: game speed x while it's out. Golden floor / rainbow / portal modifiers wait for those systems.
  const MODS = { 26: { crit: 2, txt: 'SUPER crit+ only' }, 27: { dmg: 0.5, txt: 'Damage -50%' }, 28: { tech: 0.25, txt: 'Technique damage -75%' }, 29: { txt: 'Health +200%' },
    30: { tech: 0.25, txt: 'Technique damage -75%' }, 31: { crit: 2, txt: 'SUPER crit+ only' }, 32: { dmg: 0.4, txt: 'Damage -60%' }, 33: { txt: 'Health +300%' },
    34: { crit: 3, txt: 'ULTRA crit+ only' }, 35: { crit: 3, txt: 'ULTRA crit+ only' }, 36: { txt: 'Health +300%' }, 37: { txt: 'Health +400%' }, 38: { tech: 0.15, txt: 'Technique damage -85%' },
    39: { crit: 3, txt: 'ULTRA crit+ only' }, 40: { txt: 'Health +500%' }, 42: { techCd: 0.4, txt: 'Technique recharge x0.4' }, 43: { dmg: 0.3, txt: 'Damage -70%' },
    44: { gold: 0.5, txt: 'Golden floor chance x0.5' }, 45: { speed: 0.75, txt: 'Game speed -25%' },
    // World 3 (Sadala). Rainbow-multi modifiers wait for rainbow ores.
    46: { txt: 'Health +600%' }, 47: { crit: 3, txt: 'ULTRA crit+ only' }, 48: { gold: 0.5, txt: 'Golden floor chance x0.5' }, 49: { txt: 'Health +800%' },
    50: { crit: 3, txt: 'ULTRA crit+ only' }, 51: { techCd: 0.3, txt: 'Technique recharge x0.3' }, 52: { gold: 0.45, txt: 'Golden floor chance x0.45' }, 53: { dmg: 0.15, txt: 'Damage -85%' },
    55: { crit: 7, txt: 'OMEGA crit+ only' }, 56: { gold: 0.4, txt: 'Golden floor chance x0.4' }, 57: { speed: 0.75, txt: 'Game speed -25%' }, 58: { speed: 0.75, txt: 'Game speed -25%' },
    59: { gold: 0.45, txt: 'Golden floor chance x0.45' }, 60: { crit: 7, txt: 'OMEGA crit+ only' }, 61: { txt: 'Health +800%' }, 62: { speed: 0.75, txt: 'Game speed -25%' },
    63: { txt: 'Health +800%' }, 64: { gold: 0.4, txt: 'Golden floor chance x0.4' } };
  // the floors each ore shows up on (wiki Ores)
  const ORE_FLOORS = [[1, 2], [1, 4], [3, 6], [5, 8], [7, 10], [9, 12], [11, 14], [13, 16], [15, 18], [17, 18], [19, 20], [19, 22], [21, 24], [23, 24],
    [25, 26], [25, 28], [27, 30], [29, 30], [31, 32], [31, 34], [33, 36], [35, 36], [37, 38], [37, 40], [39, 42], [41, 42],
    [43, 44], [43, 46], [45, 48], [47, 48], [49, 50], [49, 52], [51, 54], [53, 54], [55, 56], [55, 58], [57, 60], [59, 60], [61, 62], [61, 64],
    [63, 66], [65, 66], [67, 68], [67, 70], [69, 72], [71, 72],
    [73, 74], [73, 76], [75, 78], [77, 78], [79, 80], [79, 82], [81, 84], [83, 84], [85, 87], [85, 89],
    [87, 90], [89, 90], [91, 92], [91, 94], [93, 96], [95, 96], [97, 98], [97, 100], [99, 102], [101, 102]];
  function regionOfF(f) { let r = 0; REGION_FLOORS.forEach(([a], i) => { if (f >= a) r = i; }); return r; }
  const V = (sprite, paint, mark) => ({ sprite, paint: paint || null, mark: mark || null });
  const ROSTER = [
    // Earth: the Red Ribbon Army and friends
    V('scout'), V('patrol'), V('hauler'), V('saucer'), V('gundrone'),
    V('barrel'), V('flipper'), V('walker'), V('jeep'), V('bigtank'),
    V('balloon'), V('crab'), V('scorpion'), V('freighter'), V('rotor'),
    V('infantry', null, 'rr'), V('gundrone', 'red', 'rr'), V('walker', null, 'hazard'), V('jeep', null, 'flag'), V('bigtank', 'red', 'rr'),
    V('blade'), V('spider'), V('destroyer'), V('infantry', null, 'hazard'), V('crawler'),
    // Namek: the Frieza Force's machines
    V('scout', 'blue'), V('patrol', 'yellow'), V('hauler', null, 'hazard'), V('saucer', 'red'), V('gundrone', 'blue', 'hazard'),
    V('barrel', 'blue'), V('flipper', 'red'), V('walker', 'yellow'), V('jeep', null, 'hazard'), V('bigtank', 'blue'),
    V('balloon', 'yellow'), V('crab', 'blue'), V('scorpion', 'red'), V('freighter', null, 'hazard'), V('rotor', 'red'),
    V('infantry', 'purple'), V('blade', 'purple'), V('spider', 'purple'), V('destroyer', 'purple'), V('crawler', 'purple'),
    V('crab', 'purple', 'hazard'), V('jeep', 'purple'), V('blade', 'yellow', 'hazard'), V('destroyer', 'red', 'hazard'), V('crawler', 'purple', 'hazard')
  ];
  // Planet Sadala (World 3): the Saiyans' own machines, in Sadalan orange
  const SADALA = [V('scout', 'orange'), V('patrol', 'orange'), V('hauler', 'orange'), V('saucer', 'orange'), V('gundrone', 'orange'),
    V('barrel', 'orange'), V('flipper', 'orange'), V('walker', 'orange'), V('jeep', 'orange'), V('bigtank', 'orange'),
    V('balloon', 'orange', 'hazard'), V('crab', 'orange'), V('scorpion', 'orange'), V('freighter', 'orange', 'hazard'), V('rotor', 'orange'),
    V('infantry', 'orange'), V('blade', 'orange'), V('spider', 'orange', 'hazard'), V('destroyer', 'orange'), V('crawler', 'orange', 'hazard')];
  const MACHINES = ROSTER.slice(0, 46).concat(SADALA).slice(0, ORE_HP.length).map((v, t) => {
    const B = BASE[v.sprite];
    const pre = (v.mark ? MARK[v.mark] : '') + (v.paint ? PAINT[v.paint][0] : '');
    const col = v.paint ? PAINT[v.paint][1] : B[2];
    return { id: 'm' + t, t, sprite: v.sprite, paint: v.paint, mark: v.mark, name: pre + B[0], part: pre + B[1], col, region: regionOfF(ORE_FLOORS[t][0]), planet: PLANETS.findIndex((p) => ORE_FLOORS[t][0] <= p.to), rarity: t % 5 === 4 ? 2 : t % 5 >= 2 ? 1 : 0, r: SPRITES[v.sprite].r, big: !!SPRITES[v.sprite].big };
  });
  const MACH = Object.fromEntries(MACHINES.map((m) => [m.id, m]));
  const MAX_FLOOR = PLANETS[PLANETS.length - 1].to;
  const machHp = (t) => ORE_HP[t];
  const machArmor = () => 0;
  // sell price per part (wiki Sell: Zeni = Shminer's gold coins)
  const ORE_SELL = [0.05, 0.08, 0.12, 0.17, 0.23, 0.3, 0.38, 0.47, 0.57, 0.68, 0.8, 0.93, 1.07, 1.22, 1.38, 1.55, 1.73, 1.92, 2.12, 2.33, 2.55, 2.78, 3.02, 3.27, 3.53, 3.8,
    5.3, 6.55, 7.94, 9.49, 11.13, 12.93, 14.89, 17.1, 19.39, 21.84, 24.54, 27.41, 30.44, 33.63, 37.14, 40.74, 44.67, 48.86, 53.1, 57.6,
    62.43, 67.5, 72.82, 78.38, 84.27, 90, 96.54, 103.09, 110.45, 117.81, 125.18, 132.54, 140.72, 149.72, 158.72, 167.72, 176.72, 186.54, 197.17, 207.81];
  const partValue = (t) => ORE_SELL[t];
  // parts per alloy: the wiki's base cost, less Smart Refining
  const ratioOf = (t, C) => Math.max(1, Math.round(ORE_BAR[t] * (1 - (C ? C.ratioCut : 0))));
  const machXp = (t) => ORE_XP[t];
  const xpNext = (lv) => Math.max(10, Math.round(250 * (Math.pow(1.2, lv - 1) - 1)));
  const regionOf = (f) => regionOfF(f);
  const planetOf = (f) => Math.max(0, PLANETS.findIndex((p) => f <= p.to));
  // a floor's machines (wiki Floors): two ores; on the floor where the newer one first shows up it's 20% of the
  // machines (80% the older one), on the next floor 50/50. Newest first.
  function floorPool(f) {
    const here = [];
    ORE_FLOORS.forEach(([a, b], t) => { if (f >= a && f <= b) here.push(t); });
    if (here.length < 2) return [[here[0] != null ? here[0] : MACHINES.length - 1, 1]];
    const old = here[0], nw = here[here.length - 1];
    return ORE_FLOORS[nw][0] === f ? [[nw, 0.2], [old, 0.8]] : [[nw, 0.5], [old, 0.5]];
  }

  // ------------------------------------------------------------------ what Monolith clears open
  const UNLOCKS = [
    { n: 1, id: 'companions', name: 'Z-Fighters', desc: 'Fighters who throw ki at machines on their own, even while you are away. Hire and train them with Z points.' },
    { n: 1, id: 'workshop', name: 'Workshop', desc: 'Permanent upgrades bought with Zeni and alloy. They survive Zenkai.' },
    { n: 4, id: 'skills', name: 'Skill Tree', desc: 'Spend Skill Points on permanent perks. More rows open every 2 Monoliths.' },
    { n: 4, id: 'itemChests', name: 'Item Chests', desc: 'The green meter fills as you damage machines. Full = an Item chest.' },
    { n: 5, id: 'superChests', name: 'SUPER Chests', desc: 'The purple meter fills slowly. SUPER chests roll permanent bonuses and Rainbow Capsules.' },
    { n: 8, id: 'contracts', name: 'Contracts', desc: 'Bulma orders Capsule Alloy. Each order pays Contract Points for upgrades this run (Zenkai resets them). Contract boosters join the Zenkai upgrades.' },
    { n: 8, id: 'wishes', name: 'Buu Wishes', desc: 'Challenges with permanent rewards. Each one counts within a single run.' },
    { n: 9, id: 'beam', name: 'Ki Beam', desc: 'Flip HOLD from DISC to BEAM (or right click): a beam fires from your fighter through your finger to the edge of the field and hits everything on the way, the Monolith too. It drains Ki, like forms. Upgrades in the DISC tab, KI BEAM.' },
    { n: 10, id: 'cards', name: 'Cards', desc: 'A card for every machine, alloy, Z-Fighter, form, Technique, item and region: each gives +5% to its own thing. Transform a card with Rainbow Capsules to triple it.' },
    { n: 10, id: 'namek', name: 'Planet Namek', desc: "Floors 43-72: five new regions and the Frieza Force's machines." },
    { n: 20, id: 'sadala', name: 'Planet Sadala', desc: "Floors 73-102: the Saiyan homeworld. Everything runs 30% slower there." }
  ];

  // ------------------------------------------------------------------ fighters and forms
  // The fighter in the HUD is cosmetic: Goku and Vegeta share the form steps (same numbers), only the looks differ.
  // A look is drawn like the fight sim draws it: a rig made for the form, else the base rig with its hair recoloured.
  const FIGHTERS = {
    goku: { name: 'Goku', forms: [
      { name: 'Base', short: 'BASE', rig: 'goku-saiyan' },
      { name: 'Super Saiyan', short: 'SSJ', rig: 'goku-ssj', aura: '#f2b705' },
      { name: 'Super Saiyan 2', short: 'SSJ2', rig: 'goku-saiyan', hair: '#ffd23f', aura: '#f7c948', spark: true },
      // art: a picture (gen_looks.js FORM_ART) stands in for the sim's SSJ3 rig, which reads badly this small
      { name: 'Super Saiyan 3', short: 'SSJ3', rig: 'art:ssj3', aura: '#ffd23f' },
      { name: 'Super Saiyan God', short: 'GOD', rig: 'goku-saiyan', hair: '#e8343f', aura: '#ff4b5c' },
      { name: 'Super Saiyan Blue', short: 'BLUE', rig: 'goku-saiyan', hair: '#38c8f5', aura: '#3fd0ff' },
      { name: 'Mastered Ultra Instinct', short: 'MUI', rig: 'goku-saiyan', hair: '#dfe6f2', aura: '#eef3ff' }
    ] },
    vegeta: { name: 'Vegeta', forms: [
      { name: 'Base', short: 'BASE', rig: 'vegeta-buu-base' },
      { name: 'Super Saiyan', short: 'SSJ', rig: 'vegeta-buu-ssj', aura: '#f2b705' },
      { name: 'Majin Vegeta', short: 'MAJIN', rig: 'vegeta-buu-ssj2', aura: '#f7c948', spark: true },
      { name: 'Super Saiyan God', short: 'GOD', rig: 'vegeta-namek', hair: '#e8343f', aura: '#ff4b5c' },
      { name: 'Super Saiyan Blue', short: 'BLUE', rig: 'vegeta-namek', hair: '#38c8f5', aura: '#3fd0ff' },
      { name: 'Blue Evolution', short: 'EVO', rig: 'vegeta-namek', hair: '#2a5bd8', aura: '#2a6bff', spark: true },
      { name: 'Ultra Ego', short: 'EGO', rig: 'vegeta-namek', hair: '#6a2a9e', aura: '#8a3fd6' }
    ] }
  };
  // form steps 1-6: disc damage multiplier, Ki drained per second, the Monolith clear that opens it
  const FORM_TIERS = [null,
    { mult: 2, drain: 4, mono: 2 },
    { mult: 3, drain: 6, mono: 5 },
    { mult: 4.5, drain: 8, mono: 8 },
    { mult: 6, drain: 9, mono: 11 },
    { mult: 8, drain: 10, mono: 14 },
    { mult: 11, drain: 12, mono: 18 }
  ];
  const fighterOf = (S) => FIGHTERS[S.fighter] || FIGHTERS.goku;
  const formLook = (S, tier) => fighterOf(S).forms[tier || 0];
  const formOpen = (S, tier) => tier >= 1 && tier < FORM_TIERS.length && S.mono.tier >= FORM_TIERS[tier].mono;
  const formsOpenTop = (S) => { let t = 0; while (formOpen(S, t + 1)) t++; return t; };
  const formName = (tier) => FIGHTERS.goku.forms[tier].name + (FIGHTERS.vegeta.forms[tier].name !== FIGHTERS.goku.forms[tier].name ? ' / ' + FIGHTERS.vegeta.forms[tier].name : '');
  for (let k = 1; k < FORM_TIERS.length; k++) {
    UNLOCKS.push({ n: FORM_TIERS[k].mono, id: 'form' + k, name: 'Form: ' + formName(k), desc: k === 1 ? 'Transform with the FORM button: x' + FORM_TIERS[k].mult + ' disc damage while your Ki lasts. Ki refills in base form.' : 'x' + FORM_TIERS[k].mult + ' disc damage, drains ' + FORM_TIERS[k].drain + ' Ki a second.' });
  }
  UNLOCKS.sort((a, b) => a.n - b.n);

  const has = (S, id) => { const u = UNLOCKS.find((x) => x.id === id); return !u || S.mono.tier >= u.n; };
  const unlockAt = (id) => UNLOCKS.find((x) => x.id === id).n;

  // ------------------------------------------------------------------ run upgrades (DISC tab), reset by Zenkai
  // Shminer parity (wiki Upgrades, Worlds 1-2): each upgrade opens at a Power Level. Cost (wiki): base x N for the
  // first ten levels, then base x 1.3^(N-10) x N - for the Zeni AND the alloy (alloy base 1). pay: 'z' Zeni only, 'a'
  // alloy only, 'az' both, and bars: the machines whose alloy it takes (the wiki's bar icons: Sharp Edge = Tin + Copper,
  // Triple Rock = Mithril, then the next ore each). max is the starting cap: the wiki's numbers include both Upgrade
  // Caps upgrades (+3 each), so ours are 6 lower. The wiki gives no Zeni base prices (base: ours, tuned with the sim)
  // and Ki Power's cost "varies" (ours: alloy of the machine at level / 4). fx: the bonus key; step: per level; keys
  // ending in M + a number are their own multiplier (each "Disc Damage" line multiplies the others, as in Shminer).
  //      id        name                        fx              step   max  req  base  pay  bars
  const UP_ROWS = [
    ['power', 'Ki Power', 'power', 1, 171, 1, 0.3, 'az', null],
    ['size', 'Disc Size', 'sizePct', 0.08, 10, 4, 2, 'z', []],
    ['crit', 'Sharp Edge', 'critCh', 0.02, 10, 8, 3, 'a', [0, 1]],
    ['dref', 'Double Refine Chance', 'doubleRefine', 0.02, 10, 12, 6, 'z', []],
    ['triple', 'Triple Machine Chance', 'tripleMach', 0.01, 10, 16, 4, 'a', [2]],
    ['tdmg', 'Technique Damage', 'techM1', 0.2, 10, 20, 25, 'z', []],
    ['sell', 'Haggling', 'valuePct', 0.1, 10, 24, 6, 'a', [3]],
    ['critd', 'Crit Damage', 'critDmg', 0.05, 5, 28, 80, 'z', []],
    ['d1', 'Disc Damage', 'discM1', 0.1, 10, 32, 8, 'a', [4]],
    ['freet', 'Free Technique Chance', 'freeTech', 0.01, 10, 36, 300, 'z', []],
    ['cheap', "Bulma's Discount", 'upZeniPct', 0.05, 10, 40, 10, 'a', [5]],
    ['crit2', 'Sharper Edge', 'critCh', 0.02, 10, 44, 1000, 'z', []],
    ['d2', 'Disc Damage II', 'discM2', 0.15, 10, 48, 12, 'a', [6]],
    ['spin', 'Spin Rate', 'spinPct', 0.02, 10, 52, 3000, 'z', []],
    ['critd2', 'Crit Damage II', 'critDmg', 0.06, 5, 56, 14, 'a', [7]],
    ['trech', 'Technique Recharge', 'techRech', 0.01, 10, 60, 9000, 'az', [8]],
    ['d3', 'Disc Damage III', 'discM3', 0.2, 10, 62, 1.2e4, 'az', [9]],
    ['tdmg2', 'Technique Damage II', 'techM2', 0.4, 10, 65, 1.6e4, 'az', [10]],
    ['tcritd', 'Technique Crit Damage', 'techCritDmg', 0.08, 10, 68, 2.2e4, 'az', [11]],
    ['super', 'SUPER Crit Chance', 'superCh', 0.01, 10, 70, 3e4, 'az', [12]],
    ['spin2', 'Spin Rate II', 'spinPct', 0.02, 10, 72, 4e4, 'az', [13]],
    ['caps1', 'Upgrade Caps', 'upCap', 1, 3, 75, 6e4, 'az', [14]],
    ['d4', 'Disc Damage IV', 'discM4', 0.28, 10, 78, 8e4, 'az', [15]],
    ['tcritd2', 'Technique Crit Damage II', 'techCritDmg', 0.12, 10, 80, 1.1e5, 'az', [16]],
    ['superd', 'SUPER Crit Damage', 'superDmg', 0.1, 5, 82, 1.5e5, 'az', [17]],
    ['crit3', 'Sharpest Edge', 'critCh', 0.02, 10, 85, 2e5, 'az', [18]],
    ['d5', 'Disc Damage V', 'discM5', 0.35, 15, 88, 2.8e5, 'az', [19]],
    ['marmor', 'Katchin Weakness', 'monoArmorPct', 0.02, 10, 90, 3.8e5, 'az', [20]],
    ['ultra', 'ULTRA Crit Chance', 'ultraCh', 0.01, 10, 92, 5e5, 'az', [21]],
    ['meter', 'Chest Meters', 'chestPct', 2, 10, 95, 7e5, 'az', [22]],
    ['tultra', 'Technique ULTRA Crit Chance', 'techUltraCh', 0.01, 10, 98, 1e6, 'az', [23]],
    ['tref', 'Triple Refine Chance', 'tripleRefine', 0.01, 10, 100, 1.3e6, 'az', [24]],
    ['dcard', 'Disc Damage per Card', 'discPerCard', 0.01, 10, 102, 1.8e6, 'az', [25]],
    // World 2 rows (Namek levels)
    ['tdmg3', 'Technique Damage III', 'techM3', 0.25, 44, 105, 2.5e6, 'az', [26]],
    ['super2', 'SUPER Crit Chance II', 'superCh', 0.01, 15, 110, 3.5e6, 'az', [27]],
    ['xp', 'Power Level Gain', 'xpPct', 0.15, 94, 125, 8e6, 'az', [30]],
    ['ultra2', 'ULTRA Crit Chance II', 'ultraCh', 0.01, 10, 130, 1.1e7, 'az', [31]],
    ['alloy', 'Alloy Output', 'barOutPct', 0.01, 10, 135, 1.5e7, 'az', [32]],
    ['omega', 'OMEGA Crit Chance', 'omegaCh', 0.01, 10, 140, 2e7, 'az', [33]],
    ['tultra2', 'Technique ULTRA Crit Chance II', 'techUltraCh', 0.01, 15, 145, 2.8e7, 'az', [34]],
    ['bulma', 'Loot Bulma Prize', 'bulmaLoot', 0.01, 15, 150, 4e7, 'az', [35]],
    ['caps2', 'Upgrade Caps II', 'upCap', 1, 3, 160, 7e7, 'az', [37]],
    ['d6', 'Disc Damage VI', 'discM6', 0.02, 44, 165, 1e8, 'az', [38]],
    ['tdmg4', 'Technique Damage IV', 'techM4', 0.02, 44, 170, 1.3e8, 'az', [39]],
    ['ct3', 'Triple Contract Chance', 'ct3x', 0.005, 14, 175, 1.8e8, 'az', [40]]
  ];
  const UPS = Object.fromEntries(UP_ROWS.map(([id, name, fx, step, max, req, base, pay, bars]) => [id, { id, name, fx, step, max, req, base, pay, bars }]));
  const UP_KEYS = Object.keys(UPS);
  // Ki Beam upgrades (DISC sheet, KI BEAM tab): same pricing as the disc, reset by Zenkai (S.bup)
  const BEAM_UPS = {
    bpow: { name: 'Beam Power', desc: 'Damage of each beam hit', max: 40, base: 400, g: 1.32, from: 2, per: 2 },
    bwide: { name: 'Beam Width', desc: 'A wider beam', max: 12, base: 900, g: 1.7, from: 1, per: 2 },
    beff: { name: 'Ki Efficiency', desc: 'Ki drained per second while beaming', max: 12, base: 700, g: 1.6, from: 1, per: 2 },
    bsplit: { name: 'Split Beam', desc: 'Beams fired at once (each hits for 60%)', max: 4, base: 6000, g: 6, from: 1, per: 6 },
    bburn: { name: 'Burn', desc: 'Machines it hits burn for a share of its damage a second, for 3s', max: 20, base: 1500, g: 1.55, from: 1, per: 2 }
  };
  const BEAM_KEYS = Object.keys(BEAM_UPS);
  // Beam looks: all work the same. Kamehameha (Goku) and Galick Gun (Vegeta) are free and follow your fighter; store:
  // a Capsule Store item unlocks it; later: unlocked by something not built yet. col: [outer, middle, core]
  const BEAM_LOOKS = [
    { id: 'kamehameha', name: 'Kamehameha', col: ['#2f7fe8', '#7fd4ff', '#ffffff'], w: 1 },
    { id: 'galick', name: 'Galick Gun', col: ['#6a2ab0', '#c48bff', '#f6eaff'], w: 1 },
    { id: 'masenko', name: 'Masenko', col: ['#e8a020', '#ffe36a', '#fffbe0'], w: 1, store: 'lk_masenko' },
    { id: 'sbc', name: 'Special Beam Cannon', col: ['#e08a2a', '#fff6b0', '#ffffff'], w: 0.45, spiral: true, store: 'lk_sbc' },
    { id: 'death', name: 'Death Beam', col: ['#b0207a', '#ff6ad0', '#ffffff'], w: 0.4, later: true },
    { id: 'flash', name: 'Final Flash', col: ['#e8c020', '#fff08a', '#ffffff'], w: 1.3, later: true }
  ];
  const BEAM_LOOK = Object.fromEntries(BEAM_LOOKS.map((l) => [l.id, l]));

  // ------------------------------------------------------------------ permanent bonus sources
  // Every permanent upgrade is a list of effects [key, amount per level]. Keys ending in X multiply (amount^level),
  // keys ending in M + a number are each their own (1 + amount x level) multiplier; the rest add up. calc() reads
  // the totals through bonus().
  // Zenkai upgrades = Shminer's Artifacts (wiki Prestige + Prestige/Costs): tiers open at Monolith 0 / 8 / 14 / 19.
  // Each artifact must be unlocked first: Disc Damage is always the tier's first, the rest come in a random order,
  // and each unlock in a tier costs twice the last (the wiki doesn't give the first price: we use the tier's first
  // Disc Damage level). Level n costs base x g^(n-1) (the wiki's tables). Tier 4's statue artifacts and Vein Spawn
  // wait for Construct and Veins. The CONTRACTS tier is ours (Contract boosters), priced for the new point scale.
  const ZK = [
    { id: 'a1disc', name: 'Disc Damage', fx: [['discM7', 0.1]], tier: 1, max: 32, base: 25, g: 1.3 },
    { id: 'a1cost', name: 'Upgrade Alloy Cost', fx: [['alloyMinus', 3]], tier: 1, max: 12, base: 100, g: 1.3, txt: 'alloy' },
    { id: 'a1xp', name: 'Power Level Gain', fx: [['xpPct', 0.1]], tier: 1, max: 27, base: 50, g: 1.3 },
    { id: 'a1free', name: 'Free Refine Chance', fx: [['freeRefine', 0.02]], tier: 1, max: 17, base: 50, g: 1.3 },
    { id: 'a1triple', name: 'Triple Refine Chance', fx: [['tripleRefine', 0.02]], tier: 1, max: 17, base: 70, g: 1.3 },
    { id: 'a1size', name: 'Disc Size', fx: [['sizePct', 0.12]], tier: 1, max: 12, base: 65, g: 1.55 },
    { id: 'a1sell', name: 'Part Sell Price', fx: [['valuePct', 0.12]], tier: 1, max: 17, base: 55, g: 1.3 },
    { id: 'a1item', name: 'Item Duration', fx: [['itemDurPct', 0.06]], tier: 1, max: 17, base: 50, g: 1.3 },
    { id: 'a1tech', name: 'Technique Damage', fx: [['techM8', 0.3]], tier: 1, max: 32, base: 35, g: 1.3 },
    { id: 'a1cd', name: 'Monolith Cooldown', fx: [['monoCdPct', 0.03]], tier: 1, max: 17, base: 50, g: 1.3, neg: true },
    { id: 'a2disc', name: 'Disc Damage II', fx: [['discM8', 0.25]], tier: 2, max: 32, base: 300, g: 1.3 },
    { id: 'a2tech', name: 'Technique Damage II', fx: [['techM9', 0.5]], tier: 2, max: 32, base: 300, g: 1.3 },
    { id: 'a2zk', name: 'Zenkai Point Gain', fx: [['zkPct', 0.05]], tier: 2, max: 17, base: 650, g: 1.35 },
    { id: 'a2super', name: 'SUPER Crit Chance', fx: [['superCh', 0.01]], tier: 2, max: 17, base: 650, g: 1.35 },
    { id: 'a2floor', name: 'Floor Requirement', fx: [['floorReqPct', 0.05]], tier: 2, max: 17, base: 650, g: 1.35, neg: true },
    { id: 'a3disc', name: 'Disc Damage III', fx: [['discM9', 0.6]], tier: 3, max: 32, base: 10000, g: 1.25 },
    { id: 'a3tech', name: 'Technique Damage III', fx: [['techM10', 0.8]], tier: 3, max: 32, base: 12500, g: 1.3 },
    { id: 'a3tsuper', name: 'Technique SUPER Crit Chance', fx: [['techSuperCh', 0.02]], tier: 3, max: 17, base: 2e5, g: 1.35 },
    { id: 'a3armor', name: 'Katchin Armor', fx: [['monoArmorPct', 0.02]], tier: 3, max: 17, base: 2e5, g: 1.35, neg: true },
    { id: 'a3charge', name: 'Technique Capacity', fx: [['techCapAdd', 3]], tier: 3, max: 17, base: 2e5, g: 1.35 },
    { id: 'a4omega', name: 'OMEGA Crit Chance', fx: [['omegaCh', 0.01]], tier: 4, max: 37, base: 7.5e6, g: 1.35 },
    { id: 'a4alloy', name: 'Alloy Output', fx: [['barOutPct', 0.004]], tier: 4, max: 37, base: 7.5e6, g: 1.35 },
    // CONTRACTS (ours): Contract boosters
    { id: 'ctcost', name: 'Contract Discount', fx: [['ctCostPct', 0.25]], tier: 5, max: 40, base: 600, g: 1.25 },
    { id: 'ct2x', name: 'Double Contract Points', fx: [['ct2x', 0.04]], tier: 5, max: 25, base: 480, g: 1.3 },
    { id: 'ct3x', name: 'Triple Contract Points', fx: [['ct3x', 0.02]], tier: 5, max: 25, base: 720, g: 1.3 },
    { id: 'ct5x', name: '5x Contract Points', fx: [['ct5x', 0.01]], tier: 5, max: 20, base: 1200, g: 1.35 },
    { id: 'ct10x', name: '10x Contract Points', fx: [['ct10x', 0.005]], tier: 5, max: 20, base: 1800, g: 1.4 },
    { id: 'ctpts', name: 'Contract Payout', fx: [['ctPts', 2]], tier: 5, max: 20, base: 600, g: 1.3 },
    { id: 'ctcap', name: 'Contract Upgrade Caps', fx: [['ctCap', 1]], tier: 5, max: 10, base: 1500, g: 1.45 },
    { id: 'ctdisc', name: 'Contract Upgrade Discount', fx: [['ctUpPct', 0.04]], tier: 5, max: 15, base: 900, g: 1.35 }
  ];
  const ZK_TIERS = [
    { tier: 1, name: 'TIER 1', need: 'Open from the start', open: () => true, unlock: 25 },
    { tier: 2, name: 'TIER 2', need: 'Clear Monolith 8', open: (S) => S.mono.tier >= 8, unlock: 300 },
    { tier: 3, name: 'TIER 3', need: 'Clear Monolith 14', open: (S) => S.mono.tier >= 14, unlock: 10000 },
    { tier: 4, name: 'TIER 4', need: 'Clear Monolith 19', open: (S) => S.mono.tier >= 19, unlock: 7.5e6 },
    { tier: 5, name: 'CONTRACTS', need: 'Opens with Contracts (Monolith 8)', open: (S) => has(S, 'contracts'), free: true }
  ];

  // Workshop = Shminer's (wiki Workshop, Workshop/Costs): permanent, paid in Capsule Alloy only: three kinds, each
  // base x 1.3^level (rounded down). mono: the Monolith that opens it; bars: [machine t, base]. tier 2 = World 2
  // (Monolith 19). unlock: buying it unlocks that Technique. Ki rows are ours (forms and the Ki Beam), priced the old way.
  const WORKSHOP = [
    { id: 'w_plenty', name: 'Solar Flare Unlocked!', desc: 'Unlocks Solar Flare (Bomb of Plenty)', fx: [], max: 1, mono: 1, bars: [[1, 50], [2, 50], [3, 50]], unlock: 'flare' },
    { id: 'w_basic', name: 'Ki Blast & Hellzone Damage', desc: '+0.5x Ki Blast and Hellzone Grenade damage', fx: [], max: 30, mono: 1, bars: [[2, 50], [3, 40], [4, 30]] },
    { id: 'w_exp', name: 'Kaio-ken Unlocked!', desc: 'Unlocks Kaio-ken (Experience Bomb)', fx: [], max: 1, mono: 2, bars: [[3, 175], [4, 150], [5, 125]], unlock: 'kaio' },
    { id: 'w_chain', name: 'Hellzone Orbs', desc: '+1 Hellzone Grenade hit', fx: [], max: 26, mono: 2, bars: [[3, 125], [4, 100], [5, 75]] },
    { id: 'w_inf', name: 'Destructo Barrage Unlocked!', desc: 'Unlocks Destructo Barrage (Infinity Bomb)', fx: [], max: 1, mono: 3, bars: [[4, 350], [5, 300], [6, 250]], unlock: 'barrage' },
    { id: 'w_plentyx', name: 'Solar Flare Parts', desc: '+1x parts from Solar Flare', fx: [], max: 25, mono: 3, bars: [[5, 300], [6, 250], [7, 200]] },
    { id: 'w_cherry', name: 'Afterimage Unlocked!', desc: 'Unlocks Afterimage (Cherry Bomb)', fx: [], max: 1, mono: 5, bars: [[6, 600], [7, 500], [8, 400]], unlock: 'cherry' },
    { id: 'w_disc', name: 'Disc Damage', desc: '+3% disc damage', fx: [['discPct', 0.03]], max: 42, mono: 6, bars: [[7, 60], [8, 50], [9, 40]] },
    { id: 'w_d20', name: 'Dragon Ball Wish Unlocked!', desc: 'Unlocks Dragon Ball Wish (D20 Bomb)', fx: [], max: 1, mono: 7, bars: [[10, 850], [11, 750], [12, 650]], unlock: 'wish' },
    { id: 'w_expx', name: 'Kaio-ken Bonus', desc: '+0.5x Kaio-ken XP', fx: [], max: 28, mono: 8, bars: [[0, 1000], [12, 400], [13, 300]] },
    { id: 'w_mega', name: 'Spirit Bomb Damage', desc: '+5x Spirit Bomb damage', fx: [], max: 32, mono: 9, bars: [[4, 1000], [7, 900], [9, 800]] },
    { id: 'w_d20x', name: 'Dragon Ball Wish Charges', desc: '+1 charge from a Dragon Ball Wish', fx: [], max: 42, mono: 10, bars: [[2, 800], [3, 500], [15, 150]] },
    { id: 'w_cherry3', name: 'Afterimage x3 Chance', desc: '+0.5% chance an Afterimage gives 3 free Techniques', fx: [], max: 32, mono: 12, bars: [[1, 9750], [16, 5750], [17, 4750]] },
    { id: 'w_infx', name: 'Barrage Scaling', desc: '+0.1% Destructo Barrage growth per Barrage fired', fx: [], max: 32, mono: 14, bars: [[6, 13000], [10, 9750], [14, 7500]] },
    { id: 'w_trans', name: 'Smelter Alloy', desc: "+1x alloy from Bulma's Smelter", fx: [], max: 27, mono: 18, bars: [[23, 450000], [24, 350000], [25, 250000]] },
    { id: 'w_bomb', name: 'Technique Damage', desc: '+35% Technique damage', fx: [['techPct', 0.35]], max: 42, mono: 19, tier: 2, bars: [[26, 100000], [27, 80000], [28, 60000]] },
    { id: 'w_megamark', name: 'Spirit Bomb Mark', desc: 'Machines hit by a Spirit Bomb take +1x damage from everything', fx: [], max: 25, mono: 20, tier: 2, bars: [[29, 2e6], [30, 1.9e6], [31, 1.8e6]] },
    { id: 'w_transbop', name: 'Smelter + Solar Flare', desc: "Bulma's Smelter has a 25% chance to Solar Flare each machine", fx: [], max: 1, mono: 21, tier: 2, bars: [[32, 44.4e6], [33, 22.2e6], [34, 11.1e6]] },
    // ours: Ki (forms and the Ki Beam)
    { id: 'kipool', name: 'Ki Reserve', desc: '+15 max Ki', fx: [['kiMax', 15]], max: 20, base: 3000, g: 1.6, ki: true, mono: 2 },
    { id: 'kiregen', name: 'Ki Recovery', desc: '+10% Ki refill speed', fx: [['kiRegenPct', 0.1]], max: 15, base: 2500, g: 1.55, ki: true, mono: 2 },
    { id: 'kicontrol', name: 'Ki Control', desc: '-4% Ki drain in a form', fx: [['kiDrainPct', 0.04]], max: 12, base: 30000, g: 1.7, ki: true, mono: 8 }
  ];


  // SUPER chests: each roll adds a stack of one bonus from the rolled rarity, plus Rainbow Capsules
  // SUPER chests = Shminer's Relic chests (wiki Chests): one relic each, rarity by these odds (Divine 1 in 25,000)
  const RARITIES = [
    { id: 'common', name: 'Common', col: '#c7c2b8', w: 48 },
    { id: 'rare', name: 'Rare', col: '#5fd35a', w: 30 },
    { id: 'epic', name: 'Epic', col: '#c45bff', w: 14 },
    { id: 'legendary', name: 'Legendary', col: '#ffb030', w: 7 },
    { id: 'mythic', name: 'Mythic', col: '#ff4a4a', w: 1 },
    { id: 'divine', name: 'Divine', col: '#7fe8ff', w: 0.004 }
  ];
  // the relics (wiki Chests, exact amounts and caps; max 1e9 = uncapped). need: [relics of this rarity opened,
  // Monoliths cleared] before it can roll. Pickaxe = disc, Bomb = Technique, Bar = alloy, Obelisk = Monolith.
  // Not yet (no system): Fuel Duration, Bomb Capacity, Vein Income, Star Spawn, Pet Level, Star Supernova,
  // Polychrome Vein Card, Supernova Multi, Fishing Ticks, Rainbow Portal.
  const SUPER = [
    { id: 's_disc', r: 0, name: 'Disc Damage +3%', fx: [['discPct', 0.03]], max: 1e9 },
    { id: 's_value', r: 0, name: 'Part Sell Price +3%', fx: [['valuePct', 0.03]], max: 1e9 },
    { id: 's_tcrit', r: 0, name: 'Technique Crit Chance +1%', fx: [['techCritCh', 0.01]], max: 100 },
    { id: 's_xp', r: 0, name: 'Power Level Gain +1%', fx: [['xpPct', 0.01]], max: 10000, need: [100, 0] },
    { id: 's_tcritd', r: 0, name: 'Technique Crit Damage +1%', fx: [['techCritDmg', 0.01]], max: 10000, need: [500, 0] },
    { id: 's_tech', r: 1, name: 'Technique Damage +20%', fx: [['techPct', 0.2]], max: 1e9 },
    { id: 's_xp3', r: 1, name: 'Power Level Gain +3%', fx: [['xpPct', 0.03]], max: 1e9 },
    { id: 's_triple', r: 1, name: 'Triple Machine Chance +1%', fx: [['tripleMach', 0.01]], max: 100 },
    { id: 's_ctbar', r: 1, name: 'Contract Alloy -2%', fx: [['ctCostPct', 0.02]], max: 25000, need: [500, 12] },
    { id: 's_disc10', r: 2, name: 'Disc Damage +10%', fx: [['discPct', 0.1]], max: 1e9 },
    { id: 's_trech', r: 2, name: 'Technique Recharge +2%', fx: [['techRech', 0.02]], max: 250 },
    { id: 's_multi', r: 2, name: 'Multi Chest Chance +2%', fx: [['multiChest', 0.02]], max: 50 },
    { id: 's_tcap', r: 2, name: 'Technique Capacity +1', fx: [['techCapAdd', 1]], max: 2500, need: [100, 0] },
    { id: 's_goldx', r: 2, name: 'Golden Floor Multi +0.1%', fx: [['goldenXPct', 0.001]], max: 500, need: [500, 0] },
    { id: 's_five', r: 3, name: '5x Refine Chance +1%', fx: [['fiveRefine', 0.01]], max: 100 },
    { id: 's_zk', r: 3, name: 'Zenkai Points +15%', fx: [['zkPct', 0.15]], max: 1e9 },
    { id: 's_mtime', r: 3, name: 'Monolith Fight Length +12%', fx: [['monoTimePct', 0.12]], max: 100 },
    { id: 's_twenty', r: 4, name: '20x Refine Chance +1%', fx: [['twentyRefine', 0.01]], max: 100 },
    { id: 's_techall', r: 4, name: 'All Technique Multipliers +5x', fx: [['techAll', 5]], max: 1e9 },
    { id: 's_gold', r: 4, name: 'Golden Floor Chance +5%', fx: [['goldenCh', 0.05]], max: 20 },
    { id: 's_rainbow', r: 5, name: 'Rainbow Floor Chance +1%', fx: [['rainbowCh', 0.01]], max: 1e9 },
    { id: 's_rbx', r: 5, name: 'Rainbow Floor Multi +20%', fx: [['rainbowXPct', 0.2]], max: 5, need: [6, 25] }
  ];
  const SUPERBY = Object.fromEntries(SUPER.map((s) => [s.id, s]));

  // Capsule Store: Rainbow Capsules only (earned in game - no real money anywhere)
  // Capsule Store = Shminer's Store (wiki Store), Rainbow Capsules = gems, open from the start. Everything is earned
  // in the game: Shminer's paid Perks and Founder bundle are capsule prices here (ours: 2000 / 3000). Value Packs
  // (paid bundles), Gifts and the bomb unlocks are left out. Gem Upgrades use the wiki's price per level.
  const STORE = [
    { id: 'rpack', name: 'Resource Pack', desc: '10 Item chests, 3 SUPER chests and Zenkai Points (0.7 x your best Power Level ever)', cost: 150, grant: (S) => { S.chests.item += 10; S.chests.super += 3; S.zenkai.pts += packZk(S, 0.7); } },
    { id: 'lrpack', name: 'Large Resource Pack', desc: '30 Item chests, 10 SUPER chests and Zenkai Points (2.1 x your best Power Level ever)', cost: 375, grant: (S) => { S.chests.item += 30; S.chests.super += 10; S.zenkai.pts += packZk(S, 2.1); } },
    { id: 'sp', name: 'Skill Point Pack', desc: '+1 Skill Point', cost: 125, grant: (S) => { S.skillPts++; } },
    // Gem Upgrades
    { id: 'g_disc', name: 'Disc Damage', desc: '+0.2x disc damage per level', fx: [['discM20', 0.2]], max: 10, cost: 200, gem: true },
    { id: 'g_tech', name: 'Technique Damage & Capacity', desc: '+20% Technique damage and +10 capacity per level', fx: [['techM20', 0.2], ['techCapAdd', 10]], max: 10, cost: 225, gem: true },
    // Gem Unlocks (wiki Store): Techniques
    { id: 'u_mega', name: 'Unlock: Spirit Bomb', desc: 'Unlocks Spirit Bomb (MEGABOMB): 25x damage on every machine', max: 1, cost: 500 },
    { id: 'u_trans', name: "Unlock: Bulma's Smelter", desc: "Unlocks Bulma's Smelter (Transmuter): machines drop alloy too", max: 1, cost: 750 },
    { id: 'u_battery', name: 'Unlock: Energy Transfer', desc: 'Unlocks Energy Transfer (Battery Bomb): charges 2 other Techniques', max: 1, cost: 1000 },
    { id: 'g_bank', name: 'Banked Freebie Cap', desc: '+1 Freebie Pack banked', fx: [['freebieBank', 1]], max: 2, cost: 250, gem: true },
    { id: 'g_meter', name: 'Chest Meter Fill Rate', desc: 'x5 chest meter fill per level', fx: [['chestX', 5]], max: 5, cost: 300, gem: true },
    { id: 'g_items', name: 'Items Contained In Chests', desc: '+1 item from every Item chest', fx: [['itemExtra', 1]], max: 5, cost: 650, gem: true },
    { id: 'g_sell', name: 'Part Sell Price', desc: '+100% Zeni from selling parts', fx: [['valuePct', 1]], max: 2, cost: 850, gem: true },
    // Perks (paid in Shminer)
    { id: 'p_ore', name: 'Perk: 2x Parts', desc: 'x2 parts from every machine', fx: [['yieldX', 2]], max: 1, cost: 2000 },
    { id: 'p_zk', name: 'Perk: 2x Zenkai Points', desc: 'x2 Zenkai Points', fx: [['zkX', 2]], max: 1, cost: 2000 },
    { id: 'p_bar', name: 'Perk: 2x Alloy', desc: 'x2 Capsule Alloy from refining', fx: [['barX', 2]], max: 1, cost: 2000 },
    { id: 'p_tech', name: 'Perk: 3x Technique Damage', desc: 'x3 Technique damage', fx: [['techM21', 2]], max: 1, cost: 2000 },
    // Shminer's Founder bundle (paid there): its lasting perks
    { id: 'founder', name: 'Capsule Corp Founder', desc: 'x1.25 disc, Technique and Power Level gain, +2% 10x refine, Freebie 1 min faster, 24h offline limit', fx: [['offlineH', 12], ['discM22', 0.25], ['techM22', 0.25], ['xpX', 1.25], ['tenRefine', 0.02], ['freebieCd', 60]], max: 1, cost: 3000 },
    // ours
    { id: 'plane', name: "Bulma's New Plane", desc: 'Loot Bulma visits 20% more often', fx: [['bulmaPct', 0.2]], max: 3, cost: 60 },
    // Ki Beam looks (looks only; pick one in DISC, KI BEAM)
    { id: 'lk_masenko', name: 'Beam Look: Masenko', desc: 'Fire your Ki Beam as a Masenko. Looks only.', max: 1, cost: 150, need: 'beam' },
    { id: 'lk_sbc', name: 'Beam Look: Special Beam Cannon', desc: 'Fire your Ki Beam as a Special Beam Cannon. Looks only.', max: 1, cost: 250, need: 'beam' }
  ];
  // Resource Packs pay Zenkai Points: k x your best Power Level ever x your Zenkai Point gain (wiki Prestige)
  const packZk = (S, k) => Math.round(k * Math.max(S.level, S.stats.bestLevel || 0) * calc(S).zkMult);

  const STOREBY = Object.fromEntries(STORE.map((s) => [s.id, s]));

  // Skill Tree = Shminer's (wiki Skill-Tree), opens at Monolith 4. Rows top to bottom; a skill needs any skill in the
  // row above (the wiki draws a graph; this is our reading of it) and its Monolith (mono). cost: Skill Points per level
  // (one number, or a list for multi-level skills). Pickaxe = disc, Bomb = Technique, Bar = alloy, Ores = machines,
  // Prestige = Zenkai, Obelisk = Monolith. Skills for systems we don't have (drones, fishing, stars, pets, fuel,
  // veins, polychrome cards, lootbugs, auto-prestige) wait for those. The last row is ours (the Ki Beam).
  //  [id, row, col, name, desc, fx, cost, mono]
  const SKILL_ROWS = [
    ['lucky', 0, 0, 'Lucky Strikes', '+5% disc crit chance, +15% crit damage', [['critCh', 0.05], ['critDmg', 0.15]], 1],
    ['blasts', 1, 0, 'Bigger Blasts', '+25% Technique damage', [['techPct', 0.25]], 1],
    ['oreeff', 1, 1, 'Ore Efficiency', '+5% double refine chance', [['doubleRefine', 0.05]], 1],
    ['swing', 2, 0, 'Swing Harder', '+20% disc damage', [['discPct', 0.2]], 1],
    ['ingot', 2, 1, 'Ingot Intuition', 'Ki Power upgrades need 10 less alloy', [['powerMinus', 10]], 1],
    ['arsenal', 3, 0, 'Arsenal Advancement', '+10 Technique capacity, +10% Technique damage, +1% free Technique chance', [['techCapAdd', 10], ['techPct', 0.1], ['freeTech', 0.01]], 3],
    ['allround', 3, 1, 'All-Round Bomber', '+40% Technique damage, +10% Technique recharge, +5% Technique crit chance', [['techPct', 0.4], ['techRech', 0.1], ['techCritCh', 0.05]], 2],
    ['critcrit', 3, 2, 'Wait My Crits Can Crit?', '+10% disc SUPER crit chance', [['superCh', 0.1]], 2],
    ['easy', 3, 3, 'Easy Progressor', '-10% floor clears needed, x1.2 Zenkai Points, x1.2 part sell price', [['floorReqPct', 0.1], ['zkX', 1.2], ['valueX', 1.2]], 3],
    ['ppup', 4, 0, 'PP Go Up', '+25% Zenkai Points, +25% Power Level gain', [['zkPct', 0.25], ['xpPct', 0.25]], 2],
    ['gemchest', 4, 1, 'Gems & Chests', 'Freebie Packs give +1 Rainbow Capsule and +1% SUPER chest chance', [['freebieCapsAdd', 1], ['freebieSuperAdd', 0.01]], 2],
    ['superdmg', 5, 0, 'Super Damage', '+40% disc damage, +20% crit damage, +15% disc size', [['discPct', 0.4], ['critDmg', 0.2], ['sizePct', 0.15]], 4],
    ['hefty', 5, 1, 'Hefty Hammers', '+5% triple refine chance, +1% 10x refine chance', [['tripleRefine', 0.05], ['tenRefine', 0.01]], 3],
    ['relicramp', 5, 2, 'Relic Rampage', '+0.1% disc damage per SUPER chest opened', [['discPerRelic', 0.001]], 3],
    ['waitfast', 5, 3, 'Just Wait Faster', 'Freebie Pack timer -60s', [['freebieCd', 60]], 4],
    ['chrono', 6, 0, 'Chronokeeper', 'Offline Item and SUPER chests x2, +1 banked Freebie, +10 Technique capacity', [['offChestX', 2], ['freebieBank', 1], ['techCapAdd', 10]], 5],
    ['gembomb', 6, 1, 'Capsule Cannon', 'Unlocks Capsule Cannon (Gem Bomb): damage grows with the Rainbow Capsules you hold, 3% chance to give one', [], 5],
    ['treasure', 6, 2, 'Treasure Hunter', '+1% Freebie SUPER chest chance, and +1% more per 250 SUPER chests opened', [['freebieSuperAdd', 0.01], ['treasure', 1]], 7],
    ['demo', 7, 0, 'Demolition Expert', '+20% Technique SUPER crit chance, +3% free Technique chance, more Technique crit damage', [['techSuperCh', 0.2], ['freeTech', 0.03], ['techCritDmg', 0.25]], 5],
    ['supcrit', 7, 1, 'Wait My Super Crits Can Crit?', '+20% disc ULTRA crit chance', [['ultraCh', 0.2]], 5],
    ['autobomb', 8, 0, 'Auto-Bomber', 'Techniques fire on their own, one every 1.25s (AUTO button)', [['autoTech', 1]], 10],
    ['pgold', 8, 1, 'Perfect Gold', '+2x Golden floor parts', [['goldenX', 2]], 10],
    ['flamboy', 9, 0, 'Flamboyant Bombs', '+150% Technique damage, +10% Technique ULTRA crit chance, +5 Technique capacity', [['techPct', 1.5], ['techUltraCh', 0.1], ['techCapAdd', 5]], 12],
    ['moreore', 9, 1, 'More Ore More Problems', '+2 machines a wave, -10% parts per alloy', [['fieldAdd', 2], ['refineMinus', 1]], 12],
    ['freeprice', 10, 0, "Free? That's A Great Price!", 'Freebie timer -60s, +2% Freebie SUPER chest chance, 5% chance the timer refreshes at once', [['freebieCd', 60], ['freebieSuperAdd', 0.02], ['freebieRefresh', 0.05]], 12],
    ['ultcrit', 10, 1, 'Wait My Ultra Crits Can Crit?', '+200% disc damage, +10% disc OMEGA crit chance', [['discPct', 2], ['omegaCh', 0.1]], 12],
    ['neverend', 11, 0, 'Do These Upgrades Ever End', '+1 cap on every Zenkai upgrade and Workshop upgrade', [['zkCap', 1], ['wsCap', 1]], 18],
    ['optical', 11, 1, 'Optical Phenomenon', '+1% Rainbow floor chance (x50 parts)', [['rainbowCh', 0.01]], 18],
    ['luckier', 12, 0, 'Have You Tried Getting Luckier?', 'Chest meters fill x15', [['chestX', 15]], 22, 17],
    ['stonks', 12, 1, 'Stonks', 'Freebie Packs: 1% for +200 Rainbow Capsules, 1% for +20 Item chests, 1% for +10 SUPER chests', [['stonks', 0.01]], 22, 17],
    ['wares', 13, 0, 'I Have Wares, If You Have Coin', 'x2 part sell price, +20% Golden floor parts', [['valueX', 2], ['goldenXPct', 0.2]], 25, 18],
    ['rainy', 14, 0, 'Saving For A Rainy Day', '+2 banked Freebie Packs', [['freebieBank', 2]], 28, 19],
    ['bars', 15, 0, "Who's Asking For All These Bars?", '+2 Contract Points per order, +8% triple Contract Points chance', [['ctPts', 2], ['ct3x', 0.08]], 32, 20],
    ['creative', 15, 1, "I'm Running Out Of Creative Names", '+1% Rainbow floor chance, +2% 10x refine chance, -10% parts per alloy', [['rainbowCh', 0.01], ['tenRefine', 0.02], ['refineMinus', 1]], 32, 20],
    ['tons', 16, 0, 'Tons Of Damage', 'x2 disc damage, +15% disc ULTRA crit chance, +100% Power Level gain', [['discX', 2], ['ultraCh', 0.15], ['xpPct', 1]], 36, 23],
    ['leprechaun', 17, 0, "Leprechaun's Legacy", 'x1.1 Golden floor parts, x1.1 Technique recharge', [['goldenXPct', 0.1], ['techRech', 0.1]], 45, 26],
    // ours: the Ki Beam
    ['scorch', 18, 0, 'Scorched Earth', 'Ki Beam burns stack up to 3 times on the same machine', [['burnStack', 2]], 2, 9]
  ];
  const SKILLS = SKILL_ROWS.map((n) => ({ id: n[0], row: n[1], col: n[2], name: n[3], desc: n[4], fx: n[5], cost: n[6], mono: n[7] || 4, max: 1 }));
  const SKILLBY = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
  const SKILL_ROWS_N = Math.max(...SKILLS.map((x) => x.row)) + 1;
  const skillRowAt = (row) => Math.min(...SKILLS.filter((x) => x.row === row).map((x) => x.mono));
  const skillRowOpen = (S, row) => has(S, 'skills') && S.mono.tier >= skillRowAt(row);

  // Buu Wishes: per-run challenges, each paid once, forever
  const WISHES = [
    { id: 'scrap', name: 'Scrap Collector', goal: 'Salvage 10,000 Scout Rotors in one run', reward: '+10% salvage yield', fx: [['yieldPct', 0.1]], prog: (S) => [S.run.got.m0 || 0, 10000] },
    { id: 'bare', name: 'Bare Hands', goal: 'Reach floor 12 without buying a Disc upgrade', reward: '+25% disc damage', fx: [['discPct', 0.25]], prog: (S) => [S.run.discBuys ? 0 : Math.min(S.maxFloor, 12), 12] },
    { id: 'speed', name: 'Speed Run', goal: 'Reach floor 8 within 15 minutes of a run starting', reward: '-5% floor clears needed', fx: [['floorReqPct', 0.05]], prog: (S) => [S.run.fast25 ? 8 : (S.run.elapsed || 0) <= 900 ? Math.min(S.maxFloor, 8) : 0, 8] },
    { id: 'breaker', name: 'Machine Breaker', goal: 'Destroy 3,000 machines in one run', reward: '+10% chest meters', fx: [['chestPct', 0.1]], prog: (S) => [S.run.kills, 3000] },
    { id: 'tech', name: 'Technique Master', goal: 'Use 40 Techniques in one run', reward: '-5% Technique cooldowns', fx: [['techCdPct', 0.05]], prog: (S) => [S.run.techUsed, 40] },
    { id: 'rich', name: 'Mr. Satan Money', goal: 'Earn 1B Zeni in one run', reward: '+15% part sell value', fx: [['valuePct', 0.15]], prog: (S) => [S.run.zeni, 1e9] },
    { id: 'pure', name: 'No Help Needed', goal: 'Clear a Monolith without using an item that run', reward: '+10s Monolith time', fx: [['monoTime', 10]], prog: (S) => [S.run.pureWin ? 1 : 0, 1] },
    { id: 'deep', name: 'Into The Depths', goal: 'Reach floor 72 (the end of Namek)', reward: '2 Skill Points + 100 Rainbow Capsules', grant: (S) => { S.skillPts += 2; addCaps(S, 100); }, prog: (S) => [Math.min(S.maxFloor, 72), 72] }
  ];

  // Z-Fighters (code: helpers/companions): throw ki at a machine every `every` s for disc Ki Power x mult. Permanent
  // (kept through Zenkai). hire: Z points to hire them; their upgrades cost hire x COMP_UPS mult x g^level Z points.
  // trait: what each companion brings besides damage (value = base + per x their Trait level, capped at max)
  //   steal: Zeni stolen per hit, as a share of the machine's part value (min 1 Z)   pierce: share of armor ignored
  //   pride: marks hit machines for extra parts   crit: extra crit chance   beam: also hits a 2nd machine for this share
  //   splash: hits every machine near the target for this share
  //   blasts: blasts per throw = base x 2^Trait level up to max; levels past that add blastDmg per level each.
  //   pride (on the helper, not the trait): a fixed Saiyan Pride mark on top
  const HELPERS = [
    { id: 'yamcha', name: 'Yamcha', rig: 'goku-saiyan', standIn: true, mono: 1, hire: 20, every: 1.8, mult: 0.35, col: '#ffcf7a', moves: ['Wolf Fang Fist!', 'Spirit Ball!'], trait: { key: 'steal', name: 'Desert Bandit', base: 0.01, per: 0.005, max: 0.25, fmt: 'pct', desc: 'Steals Zeni from every machine he hits' } },
    { id: 'krillin', name: 'Krillin', rig: 'krillin', mono: 1, hire: 26, every: 2.0, mult: 0.8, col: '#ffd23f', moves: ['Kienzan!', 'Scattering Bullet!'], trait: { key: 'pierce', name: 'Cutting Edge', base: 0.3, per: 0.03, max: 0.9, fmt: 'pct', desc: 'His hits ignore part of the armor' } },
    { id: 'gohan', name: 'Gohan', rig: 'gohan-saiyan', mono: 2, hire: 60, every: 1.6, mult: 1.1, col: '#ffe36a', moves: ['Masenko!', 'Kamehameha!'], trait: { key: 'crit', name: 'Hidden Potential', base: 0.25, per: 0.05, max: 5, fmt: 'pct', desc: 'Extra crit chance (it can pass 100%)' } },
    { id: 'piccolo', name: 'Piccolo', rig: 'piccolo-saiyan', mono: 4, hire: 150, every: 2.4, mult: 3.2, col: '#ffef9a', moves: ['Special Beam Cannon!', 'Hellzone Grenade!'], trait: { key: 'beam', name: 'Piercing Beam', base: 0.5, per: 0.05, max: 2, fmt: 'pct', desc: 'Each shot goes through into a second machine' } },
    { id: 'vegeta', name: 'Vegeta', rig: 'vegeta-saiyan', mono: 7, hire: 380, every: 0.6, mult: 0.05, col: '#c48bff', pride: 0.5, moves: ['Final Flash!', 'Galick Gun!', 'Big Bang Attack!'], trait: { key: 'blasts', name: "Vegeta's Technique", base: 2, max: 64, blastDmg: 0.1, fmt: 'blasts', desc: 'A quick barrage of weak blasts. Each Trait level doubles the blasts (up to 64), then adds +10% blast damage. Saiyan Pride: machines he hits drop +50% parts' } },
    { id: 'nappa', name: 'Nappa', rig: 'nappa-saiyan', mono: 10, hire: 940, every: 3.0, mult: 9, col: '#ffb347', moves: ['Break Cannon!', 'Bomber DX!'], trait: { key: 'splash', name: 'Bomber', base: 0.3, per: 0.04, max: 1.5, fmt: 'pct', desc: 'Blasts hit every machine near the target' } }
  ];
  const HELPER = Object.fromEntries(HELPERS.map((h) => [h.id, h]));
  // with Vegeta as your fighter, Goku fights in Vegeta's slot: same key and upgrades, same trait under another name
  const GOKU_SLOT = { name: 'Goku', rig: 'goku-saiyan', col: '#7fd4ff', alt: true, moves: ['Kamehameha!', 'Dragon Fist!', 'Desperate Blasts!'],
    traitName: 'Desperate Blasts', traitDesc: 'A quick barrage of weak blasts. Each Trait level doubles the blasts (up to 64), then adds +10% blast damage. His kindness pays: machines he hits drop +50% parts' };
  function helperView(S, h) {
    if (h.id !== 'vegeta' || !S || S.fighter !== 'vegeta') return h;
    const G2 = GOKU_SLOT;
    return Object.assign({}, h, { name: G2.name, rig: G2.rig, col: G2.col, alt: true, moves: G2.moves, trait: Object.assign({}, h.trait, { name: G2.traitName, desc: G2.traitDesc }) });
  }
  const COMP_UPS = {
    dmg: { name: 'Damage', desc: '+25% damage', max: 100, mult: 0.5, g: 1.103 },
    spd: { name: 'Attack Speed', desc: '+8% attack speed', max: 25, mult: 1.5, g: 1.154 },
    multi: { name: 'Multishot', desc: '+1 ki ball per throw', max: 4, mult: 8, g: 2.41 },
    crit: { name: 'Crit Chance', desc: '+3% crit chance', max: 100, mult: 2, g: 1.082 },
    trait: { name: 'Trait', desc: 'Stronger trait', max: 40, mult: 3, g: 1.112 }
  };

  // Techniques: one button each, own cooldown, no stacking
  // Techniques = Shminer's bombs (wiki Bombs): each has charges that refill one per cd seconds (its recharge), up to
  // the Technique capacity; firing uses a charge. Unlocks as in Shminer: Ki Blast + Hellzone from the start, others in
  // the Workshop (ws) or the Capsule Store (store). They don't hurt the Monolith. dmg: x Ki Power x techBase.
  //   Basic = Ki Blast, Chain = Hellzone Grenade, Bomb of Plenty = Solar Flare, Exp = Kaio-ken, MEGABOMB = Spirit
  //   Bomb, Infinity = Destructo Barrage, Transmuter = Bulma's Smelter, Cherry = Afterimage, Battery = Energy
  //   Transfer, D20 = Dragon Ball Wish
  const TECHS = {
    blast: { name: 'Ki Blast', short: 'BLAST', cd: 30, dmg: 1, col: '#ffe36a', desc: 'One hit on every machine.' },
    hell: { name: 'Hellzone Grenade', short: 'HELL', cd: 60, dmg: 1, col: '#8cf07a', desc: 'Ki orbs hit every machine, 1.25s apart (more with the Workshop).' },
    flare: { name: 'Solar Flare', short: 'FLARE', cd: 110, dmg: 0.3, col: '#fff3a0', ws: 'w_plenty', desc: 'Marks every machine: x2 parts when it is destroyed (more with the Workshop).' },
    kaio: { name: 'Kaio-ken', short: 'KAIO', cd: 120, dmg: 0.5, col: '#ff5a4a', ws: 'w_exp', desc: 'Marks every machine: x2 Power Level XP (more with the Workshop), small chance of a Rainbow Capsule.' },
    spirit: { name: 'Spirit Bomb', short: 'SPIRIT', cd: 120, dmg: 25, col: '#9fe4ff', store: 'u_mega', desc: 'One huge hit on every machine (25x).' },
    barrage: { name: 'Destructo Barrage', short: 'BARRG', cd: 160, dmg: 1, col: '#ffb030', ws: 'w_inf', desc: 'Hits every machine; every Barrage you ever fire makes the next one +1% stronger.' },
    smelt: { name: "Bulma's Smelter", short: 'SMELT', cd: 250, dmg: 0, col: '#c9d6e3', store: 'u_trans', desc: 'Marks every machine to drop Capsule Alloy as well as its parts.' },
    cherry: { name: 'Afterimage', short: 'AFTER', cd: 330, dmg: 0, col: '#ff8fd0', ws: 'w_cherry', desc: 'Your next Technique is free.' },
    battery: { name: 'Energy Transfer', short: 'ENRGY', cd: 345, dmg: 0, col: '#7fd4ff', store: 'u_battery', desc: 'Charges 2 random other Techniques; 0.1% chance of +1 capacity for good.' },
    gem: { name: 'Capsule Cannon', short: 'CAPS', cd: 315, dmg: 1, col: '#ff8fd0', skill: 'gembomb', desc: 'Hits every machine harder the more Rainbow Capsules you hold (+4% each); 3% chance to give one.' },
    wish: { name: 'Dragon Ball Wish', short: 'WISH', cd: 400, dmg: 0, col: '#ffa040', ws: 'w_d20', desc: '5% chance to refill 20 random Technique charges (more with the Workshop).' }
  };
  const TECH_KEYS = Object.keys(TECHS);

  // items = Shminer's Tier 1 items (wiki Items), DBZ names: effect, base duration and the chance an Item chest holds
  // it (w, %). r: the colour group (by how rare). Same item = more time; different items stack. The Ki Drink is ours
  // (it goes with the Ki Beam). Tier 2-4 items wait for Fishing, Lootfrogs and Gifts.
  //   Apple = Scouter, Bread = Disc Capsule, Drone Juice = Sacred Water, Banana Coffee = Turbo Spin, Pike = Power Pole,
  //   Eye of Newt = Dragon Radar, Rock Cake = Weighted Clothes, Juicy Plums = Kami's Blessing, Chaos Totem = Elder
  //   Kai's Ritual, Primal Meat = Gravity Machine, Strawberries = Chi-Chi's Rice Bowl, Charge Magnet = Senzu Bean,
  //   Blue Cow = Time Chamber
  const ITEMS = {
    scouter: { name: 'Scouter', r: 0, w: 16, dur: 90, desc: '+10% disc crit chance', col: '#82f468' },
    discap: { name: 'Disc Capsule', r: 0, w: 16, dur: 90, desc: 'x1.25 disc size', col: '#ffd34d' },
    water: { name: 'Sacred Water', r: 0, w: 16, dur: 90, desc: 'Z-Fighters attack 50% faster', col: '#bff6ff' },
    turbo: { name: 'Turbo Spin', r: 1, w: 10, dur: 120, desc: 'x1.2 spin rate', col: '#7ce0ff' },
    pole: { name: 'Power Pole', r: 1, w: 10, dur: 120, desc: '+30% crit damage', col: '#e8443a' },
    radar: { name: 'Dragon Radar', r: 1, w: 10, dur: 120, desc: '+25% Triple Machine chance', col: '#ffb030' },
    weights: { name: 'Weighted Clothes', r: 2, w: 4.6, dur: 150, desc: '+30% disc damage', col: '#c0563f' },
    blessing: { name: "Kami's Blessing", r: 2, w: 4.6, dur: 150, desc: '+25% crit chance and +25% crit damage', col: '#fff6c0' },
    ritual: { name: "Elder Kai's Ritual", r: 2, w: 4.6, dur: 150, desc: 'x3 Technique damage, Techniques recharge x2', col: '#ff8fd0' },
    gravity: { name: 'Gravity Machine', r: 3, w: 2.6, dur: 180, desc: '+100% disc damage', col: '#9a7cff' },
    rice: { name: "Chi-Chi's Rice Bowl", r: 3, w: 2.6, dur: 180, desc: 'x3 Power Level gain', col: '#f6f0e0' },
    senzu: { name: 'Senzu Bean', r: 3, w: 2.6, dur: 0, desc: 'Up to 20 more charges on every Technique', col: '#6fd27a' },
    kidrink: { name: 'Ki Drink', r: 3, w: 2.6, dur: 0, desc: 'Refills your Ki', col: '#7fd4ff' },
    chamber: { name: 'Time Chamber', r: 4, w: 0.2, dur: 600, desc: 'Everything runs x2 speed', col: '#e8e1d6' }
  };
  const ITEM_KEYS = Object.keys(ITEMS);
  const BUFF_MAX = 1200; // a buff stacks up to 20 minutes
  const ITEM_W = ITEM_KEYS.map((k) => ITEMS[k].w); // chest odds per item

  // ------------------------------------------------------------------ state
  function newRun(now) { return { start: now, elapsed: 0, discBuys: 0, kills: 0, got: {}, techUsed: 0, itemsUsed: 0, zeni: 0, pureWin: false, fast25: false }; }
  function newState(now) {
    return {
      v: VERSION, created: now, lastSave: now,
      // ---- run (reset by Zenkai)
      zeni: 0, level: 1, xp: 0, parts: {}, alloy: {}, up: {},
      floor: 1, floorKills: 0, maxFloor: 1, stay: false, run: newRun(now), ftype: {}, // floorKills = floor clears
      buffs: {}, tcd: {},
      // ---- kept through Zenkai
      caps: 0, skillPts: 0,
      mono: { tier: 0, readyAt: now + TUNE.monoCooldown * 1000, best: 0, dmg: 0 }, // dmg: HP already chipped off the current tier (kept between attempts and through Zenkai)
      helpers: {}, items: { weights: 1, senzu: 1, scouter: 2 }, chests: { item: 0, super: 0 }, meter: { item: 0, super: 0 },
      ws: {}, sup: {}, store: {}, skills: {}, wishes: {}, autoTech: true,
      zenkai: { pts: 0, total: 0, count: 0, up: {}, unl: [] },
      bulma: { next: now + 90 * 1000 },
      goals: { day: '', done: 0, seq: 0, list: [] },
      seen: { m0: 1 },
      stats: { kills: 0, dmg: 0, techs: 0, play: 0, parts: 0, zeni: 0, monoWins: 0, monoTries: 0, chests: 0, supers: 0, bulma: 0, capsEarned: 0 },
      opt: { reduce: false, offBuffs: true },
      // fighter: 'goku' | 'vegeta' (null until picked at the start). formSel: the step the FORM button uses; formOn: the step you're in now
      fighter: null, ki: TUNE.kiMax, formSel: 1, formOn: 0,
      // Ki Beam: weapon is what holding the field fires ('disc' | 'beam'); beamLook '' = your fighter's own beam;
      // bup: beam upgrades (this run)
      weapon: 'disc', beamLook: '', bup: {},
      // Z points for Z-Fighters (kept through Zenkai); zpBought: every point ever bought (sets the price)
      zp: 0, zpBought: 0,
      // Contracts (this run) and Cards (kept)
      ct: newCt(), cards: {},
      freebie: { n: 0, p: 0 }, bits: 0 // Freebie Packs banked, progress (s) to the next
    };
  }
  // saves from older versions come in here; each step upgrades one version
  function migrate(raw, now) {
    if (!raw || typeof raw !== 'object' || !raw.v) return null;
    let S = raw;
    if (S.v < 3) return null; // the Shminer rebalance wiped saves
    if (S.v === 1) {
      // v1 (ore, planets, Ki Blasts) -> v2 (machines, floors, Techniques): start over, keeping Monolith clears, Zenkai (points refunded) and stats
      const n = newState(now);
      n.mono.tier = Math.min(S.mono ? S.mono.tier || 0 : 0, 4);
      n.zenkai.pts = (S.zenkai && S.zenkai.total) || 0;
      n.zenkai.total = n.zenkai.pts;
      n.zenkai.count = (S.zenkai && S.zenkai.count) || 0;
      for (const k of Object.keys(S.helpers || {})) if (HELPER[k] && HELPER[k].mono <= n.mono.tier) n.helpers[k] = { lv: 1, dmg: 0, spd: 0, multi: 0, crit: 0, trait: 0 };
      n.created = S.created || now;
      S = n;
    }
    if (S.v !== VERSION) return null;
    const base = newState(now);
    for (const k of Object.keys(base)) if (S[k] === undefined) S[k] = base[k];
    for (const k of ['mono', 'zenkai', 'goals', 'stats', 'chests', 'meter', 'opt', 'bulma']) S[k] = Object.assign({}, base[k], S[k]);
    S.run = Object.assign(newRun(now), S.run);
    S.formOn = 0; // you load in base form
    S.ct = Object.assign(newCt(), S.ct);
    return S;
  }

  // ------------------------------------------------------------------ derived numbers
  const lv = (S, k) => S.up[k] || 0;
  const planetsOpen = (S) => PLANETS.filter((p) => S.mono.tier >= p.gate).length;
  const levelCap = (S) => TUNE.levelCap + TUNE.levelCapPer * S.mono.tier;
  // all bonuses, summed by key: permanent ones plus this run's DISC upgrades
  const isMul = (k) => /M\d+$/.test(k);
  function bonus(S) {
    const B = {};
    const add = (fx, l) => {
      if (!l) return;
      for (const [k, a] of fx) {
        if (k.endsWith('X')) B[k] = (B[k] || 1) * Math.pow(a, l);
        else if (isMul(k)) B[k] = (B[k] || 1) * (1 + a * l);
        else B[k] = (B[k] || 0) + a * l;
      }
    };
    for (const z of ZK) add(z.fx, S.zenkai.up[z.id] || 0);
    for (const w of WORKSHOP) add(w.fx, S.ws[w.id] || 0);
    for (const s of SUPER) add(s.fx, S.sup[s.id] || 0);
    for (const s of STORE) if (s.fx) add(s.fx, S.store[s.id] || 0);
    for (const s of SKILLS) add(s.fx, S.skills[s.id] || 0);
    for (const w of WISHES) if (w.fx && S.wishes[w.id]) add(w.fx, 1);
    if (S.ct) for (const u of CT_UPS) add(u.fx, S.ct.up[u.id] || 0);
    for (const k of UP_KEYS) if (k !== 'power') add([[UPS[k].fx, UPS[k].step]], S.up[k] || 0);
    if (S.mono) for (const [k, a] of monoPerks(S.mono.tier)) { if (k.startsWith('tcMono')) B.techCapAdd = (B.techCapAdd || 0) + a; else B[k] = (B[k] || 1) * a; } // Monolith reward multipliers (and capacity)
    return B;
  }
  const b0 = (B, k) => B[k] || 0;
  const b1 = (B, k) => (B[k] === undefined ? 1 : B[k]);
  // the product of every "own multiplier" line that starts with this prefix (discM1, discM2... or techM1...)
  const mulOf = (B, pre) => { let m = 1; for (const k of Object.keys(B)) if (k.startsWith(pre) && isMul(k)) m *= B[k]; return m; };
  // Ki Power (Shminer's Upgrade Pickaxe): (level + 1)(level + 2) / 2 base damage
  const pickDmg = (p) => ((p + 1) * (p + 2)) / 2;
  function calc(S) {
    const B = bonus(S);
    const f = S.buffs;
    const p = lv(S, 'power');
    // buffs of one kind don't stack with each other: the strongest one active applies
    const allDmg = (1 + b0(B, 'allPct')) * b1(B, 'allX');
    const ctDone = S.ct ? S.ct.done : 0;
    const cards = S.cards ? Object.keys(S.cards).length : 0;
    const basePower = pickDmg(p) * TUNE.discK * (1 + b0(B, 'discPct') + b0(B, 'discPerCt') * ctDone + b0(B, 'discPerCard') * cards + b0(B, 'discPerRelic') * ((S.stats && S.stats.supers) || 0)) * b1(B, 'discX') * mulOf(B, 'discM');
    const formMult = S.formOn > 0 && FORM_TIERS[S.formOn] ? FORM_TIERS[S.formOn].mult : 1;
    const power = basePower * (1 + (f.weights > 0 ? 0.3 : 0) + (f.gravity > 0 ? 1 : 0)) * allDmg * formMult; // Rock Cake +30%, Primal Meat +100%
    const cap = b0(B, 'upCap');
    return {
      B, basePower, power, allDmg, formMult, upCap: cap,
      kiMax: TUNE.kiMax + b0(B, 'kiMax'),
      kiRegen: TUNE.kiRegen * (1 + b0(B, 'kiRegenPct')),
      kiDrain: Math.max(0.3, 1 - b0(B, 'kiDrainPct')),
      spin: 4 * (1 + b0(B, 'spinPct')) * (f.turbo > 0 ? 1.2 : 1),
      radius: 12 * (1 + b0(B, 'sizePct')) * (f.discap > 0 ? 1.25 : 1),
      // crit tiers (Shminer): each has its own chance; a hit takes the best tier it rolls
      crit: Math.min(1, 0.05 + b0(B, 'critCh') + (f.scouter > 0 ? 0.1 : 0) + (f.blessing > 0 ? 0.25 : 0)),
      superCh: b0(B, 'superCh'), ultraCh: b0(B, 'ultraCh'), omegaCh: b0(B, 'omegaCh'),
      critDmg: 1 + b0(B, 'critDmg') + cardVal(S, 'x_crit') + (f.pole > 0 ? 0.3 : 0) + (f.blessing > 0 ? 0.25 : 0),
      superDmg: 1 + b0(B, 'superDmg'),
      techCrit: 0.05 + b0(B, 'techCritCh'), techSuperCh: b0(B, 'techSuperCh'), techUltraCh: b0(B, 'techUltraCh'), techCritDmg: 1 + b0(B, 'techCritDmg'),
      compCrit: b0(B, 'compCritCh'),
      maxNodes: 10 + b0(B, 'fieldAdd'), // Shminer: 10 machines a screen
      spawn: TUNE.spawnEvery / (1 + b0(B, 'spawnPct')), // seconds per machine while below the cap
      techMult: TUNE.techBase * (1 + b0(B, 'techPct') + b0(B, 'techPerCt') * ctDone) * mulOf(B, 'techM') * (f.ritual > 0 ? 3 : 1) * (1 + b0(B, 'techAll')),
      techCd: Math.max(0.25, 1 - b0(B, 'techCdPct')) / (1 + b0(B, 'techRech')) / (f.ritual > 0 ? 2 : 1),
      freeTech: b0(B, 'freeTech'),
      techCap: Math.floor((TUNE.techCap + b0(B, 'techCapAdd') + (S.techCapPlus || 0)) * (1 + b0(B, 'techCapPct'))),
      basicX: 1 + 0.5 * wsl(S, 'w_basic'), chainN: 1 + wsl(S, 'w_chain'), expX: 2 + 0.5 * wsl(S, 'w_expx'), megaAdd: 5 * wsl(S, 'w_mega'),
      wishN: 20 + wsl(S, 'w_d20x'), cherry3: 0.005 * wsl(S, 'w_cherry3'), infScale: 0.01 + 0.001 * wsl(S, 'w_infx'),
      transX: 1 + wsl(S, 'w_trans'), megaMark: wsl(S, 'w_megamark'), transFlare: wsl(S, 'w_transbop') ? 0.25 : 0,
      ratioCut: Math.min(0.6, 0.1 * b0(B, 'refineMinus')), // Smart Refining: -10% parts per alloy
      valueMult: (1 + b0(B, 'valuePct')) * b1(B, 'valueX'),
      xpMult: (1 + b0(B, 'xpPct')) * (f.rice > 0 ? 3 : 1) * b1(B, 'xpMono') * b1(B, 'xpX'),
      yieldMult: (1 + b0(B, 'yieldPct')) * b1(B, 'yieldX'),
      doubleOre: b0(B, 'doubleOre'),
      tripleMach: b0(B, 'tripleMach') + (f.radar > 0 ? 0.25 : 0),
      chestMult: (1 + b0(B, 'chestPct') + cardVal(S, 'x_chest')) * b1(B, 'chestX'),
      compMult: (1 + b0(B, 'compPct')) * allDmg,
      compSpd: (1 + b0(B, 'compSpdPct')) * (f.water > 0 ? 1.5 : 1),
      speed: (f.chamber > 0 ? 2 : 1) * (1 + b0(B, 'speedPct')),
      floorReq: Math.max(0.3, 1 - b0(B, 'floorReqPct')),
      monoTime: (TUNE.monoTime + b0(B, 'monoTime')) * (1 + b0(B, 'monoTimePct')),
      multiChest: b0(B, 'multiChest'),
      freebieEvery: Math.max(60, TUNE.freebieEvery - b0(B, 'freebieCd')), freebieBank: TUNE.freebieBank + b0(B, 'freebieBank'),
      freebieCaps: TUNE.freebieCaps + b0(B, 'freebieCapsAdd'), freebieRefresh: b0(B, 'freebieRefresh'), stonks: b0(B, 'stonks'),
      freebieSuper: TUNE.freebieSuper + b0(B, 'freebieSuperAdd') + (b0(B, 'treasure') ? 0.01 * Math.floor(((S.stats && S.stats.supers) || 0) / 250) : 0),
      offChestX: b1(B, 'offChestX'), zkCap: b0(B, 'zkCap'), wsCap: b0(B, 'wsCap'),
      monoCd: TUNE.monoCooldown * Math.max(0.3, 1 - b0(B, 'monoCdPct')),
      monoArmorMult: Math.max(0.2, 1 - b0(B, 'monoArmorPct')),
      offlineCap: (TUNE.offlineCapH + b0(B, 'offlineH')) * 3600,
      offlineMult: 1 + b0(B, 'offlinePct'),
      // refining (Shminer Craft): each bonus rolls on its own and they multiply; free refines keep the parts
      doubleRefine: b0(B, 'doubleRefine'), tripleRefine: b0(B, 'tripleRefine'), fiveRefine: b0(B, 'fiveRefine'), tenRefine: b0(B, 'tenRefine'), twentyRefine: b0(B, 'twentyRefine'),
      freeRefine: Math.min(0.9, b0(B, 'freeRefine')), barOut: (1 + b0(B, 'barOutPct')) * b1(B, 'barMono') * b1(B, 'barX'),
      superFromItem: b0(B, 'superFromItem'),
      alloyMinus: b0(B, 'alloyMinus'), powerMinus: b0(B, 'powerMinus'), alloyCost: Math.max(0.5, 1 - b0(B, 'alloyCostPct')),
      upZeni: Math.max(0.2, 1 - b0(B, 'upZeniPct')),
      itemDur: 1 + b0(B, 'itemDurPct'),
      capsMult: 1 + b0(B, 'capsPct'),
      zkMult: (1 + b0(B, 'zkPct')) * (1 + cardVal(S, 'x_zenkai')) * b1(B, 'zkMono') * b1(B, 'zkX'),
      autoTech: b0(B, 'autoTech') > 0,
      hellLen: 10 + b0(B, 'hellLen'),
      hellRate: b1(B, 'hellRateX'),
      flareBonus: 2 + wsl(S, 'w_plentyx') + b0(B, 'flareAdd'), // Bomb of Plenty: x2 parts, +1x a Workshop level
      spiritX: b1(B, 'spiritX'),
      kaioCaps: 0.005 * b1(B, 'kaioCapsX'),
      bulmaEvery: 1 / (1 + b0(B, 'bulmaPct')),
      bulmaLoot: 1 + b0(B, 'bulmaLoot'),
      itemExtra: b0(B, 'itemExtra'),
      multiAdd: b0(B, 'multiAdd'),
      startFloor: 1 + b0(B, 'startFloor'),
      goldenCh: b0(B, 'goldenCh'), rainbowCh: b0(B, 'rainbowCh'), galacticCh: b0(B, 'galacticCh'), prismCh: b0(B, 'prismCh'),
      goldenX: (5 + b0(B, 'goldenX')) * (1 + b0(B, 'goldenXPct')), rainbowX: (50 + b0(B, 'rainbowX')) * (1 + b0(B, 'rainbowXPct')), galacticX: 10 + b0(B, 'galacticX'), prismX: 1 + b0(B, 'prismX'),
      // Ki Beam: hits off the disc's Ki Power (form, buffs and all), so it grows with the disc
      beamDmg: power * TUNE.beamPower * (1 + 0.1 * blv(S, 'bpow')) * (1 + cardVal(S, 'x_beam')),
      beamRate: TUNE.beamRate,
      beamWidth: TUNE.beamWidth + 1.5 * blv(S, 'bwide'),
      beamDrain: TUNE.beamDrain * Math.max(0.4, 1 - 0.05 * blv(S, 'beff')),
      beams: 1 + blv(S, 'bsplit'),
      burnPct: 0.05 * blv(S, 'bburn'),
      burnStack: 1 + b0(B, 'burnStack')
    };
  }
  const blv = (S, k) => (S.bup && S.bup[k]) || 0;
  const wsl = (S, id) => (S.ws && S.ws[id]) || 0;
  // machines have no armor now; only Z-Fighter hits still go through this (and lose nothing)
  const effDmg = (dmg, armor) => Math.max(0, dmg - (armor || 0));
  // Crits. The disc and Techniques use Shminer's tiers: CRIT, SUPER, ULTRA and OMEGA each have their own chance and a
  // hit takes the best one it rolls. Z-Fighters keep our old rule (chance past 100% buys the next tier), since they
  // aren't Shminer's drones.
  const CRIT_TIERS = ['', 'CRIT', 'SUPER', 'ULTRA', 'MEGA', 'GIGA', 'TERA', 'OMEGA'];
  const critEff = (raw) => (raw <= 1 ? raw : 1 + (raw - 1) / TUNE.critOver);
  function rollCrit(raw) {
    const e = critEff(Math.max(0, raw));
    let k = Math.floor(e);
    if (Math.random() < e - k) k++;
    return Math.min(k, CRIT_TIERS.length - 1);
  }
  // chained, as the wiki says: SUPER only rolls when the CRIT hit, ULTRA when the SUPER did, OMEGA when the ULTRA did
  function rollTier(crit, sup, ult, omg) {
    if (!(Math.random() < crit)) return 0;
    if (!(sup && Math.random() < sup)) return 1;
    if (!(ult && Math.random() < ult)) return 2;
    return omg && Math.random() < omg ? 7 : 3;
  }
  const discTier = (C) => rollTier(C.crit, C.superCh, C.ultraCh, C.omegaCh);
  // and the multipliers stack: CRIT x crit damage, SUPER also x super crit damage, ULTRA also x3, OMEGA also x3 (wiki)
  const critMult = (tier, C) => (!tier ? 1 : 2 * C.critDmg * (tier >= 2 ? 2 * C.superDmg : 1) * (tier >= 3 ? 3 : 1) * (tier >= 7 ? 3 : 1));
  // what a raw chance means: [guaranteed tier, chance of the next one]
  const critSplit = (raw) => { const e = critEff(Math.max(0, raw)); return [Math.floor(e), e - Math.floor(e)]; };
  // Katchin Monolith (Shminer Obelisk): HP 100k x 2.8^k, armor 10 x 2.8^k (the first is 5). k = Monoliths cleared.
  const monoHp = (k) => Math.round(TUNE.monoHp * Math.pow(TUNE.monoHpG, k));
  const monoArmor = (S, k, C) => (k === 0 ? 5 : Math.round(TUNE.monoArmor * Math.pow(TUNE.monoArmorG, k))) * (C || calc(S)).monoArmorMult;
  // floor clears to go down (wiki): floor x 5 on Earth, x 15 on Namek, less Floor Requirement bonuses
  const floorNeed = (S, f, C) => Math.max(1, Math.ceil(f * PLANETS[planetOf(f)].clear * (C || calc(S)).floorReq));
  // the buyable items cost about 40 of the newest part on your best floor
  const itemPrice = () => 0;
  const cl = (S, id) => S.helpers[id] || null; // a companion's levels {lv, dmg, spd, multi}
  function helperStats(S, C, h) {
    const c = cl(S, h.id);
    const d = c ? c.dmg : 0, s = c ? c.spd : 0, m = c ? c.multi : 0;
    const T = h.trait, tl = c ? c.trait || 0 : 0, blasts = T.key === 'blasts';
    const over = blasts ? Math.max(0, tl - Math.log2(T.max / T.base)) : 0; // Trait levels past the blast cap
    return { dmg: C.basePower * h.mult * (1 + 0.25 * d) * C.compMult * (1 + (blasts ? T.blastDmg * over : 0)) * (1 + cardVal(S, 'f_' + h.id)), every: h.every / ((1 + 0.08 * s) * C.compSpd), shots: (blasts ? traitVal(h, c) : 1) + m + C.multiAdd, crit: 0.05 + 0.03 * (c ? c.crit || 0 : 0) + C.compCrit + (T.key === 'crit' ? traitVal(h, c) : 0), trait: traitVal(h, c), over };
  }
  const traitVal = (h, c) => {
    const l = c ? c.trait || 0 : 0;
    return h.trait.key === 'blasts' ? Math.min(h.trait.max, h.trait.base * Math.pow(2, l)) : Math.min(h.trait.max, h.trait.base + h.trait.per * l);
  };
  const compUpCost = (h, key, l) => Math.round(h.hire * COMP_UPS[key].mult * Math.pow(COMP_UPS[key].g, l));
  const zkCost = (z, l) => Math.floor(z.base * Math.pow(z.g, l) + 1e-9); // the wiki's tables round down
  const zkTierOpen = (S, t) => ZK_TIERS[t - 1].open(S);
  // Artifacts are unlocked one at a time per tier: Disc Damage first, then the rest in a random order; each unlock
  // costs twice the last one in that tier. The Contracts tier needs no unlocks.
  const zkUnlocked = (S, z) => ZK_TIERS[z.tier - 1].free || (S.zenkai.unl || []).includes(z.id);
  const zkUnlockCost = (S, tier) => ZK_TIERS[tier - 1].unlock * Math.pow(2, (S.zenkai.unl || []).filter((id) => ZK.find((z) => z.id === id).tier === tier).length);
  const zkNextLocked = (S, tier) => ZK.filter((z) => z.tier === tier && !zkUnlocked(S, z));
  function unlockZk(S, tier) {
    const left = zkNextLocked(S, tier);
    if (!zkTierOpen(S, tier) || !left.length) return null;
    const c = zkUnlockCost(S, tier);
    if (S.zenkai.pts < c) return null;
    const first = left.find((z) => /^a\ddisc$/.test(z.id));
    const z = first || left[Math.floor(Math.random() * left.length)];
    S.zenkai.pts -= c;
    S.zenkai.unl = (S.zenkai.unl || []).concat(z.id);
    return z;
  }
  const wsMax = (S, w, C) => w.max + (w.max > 1 ? (C || calc(S)).wsCap : 0);
  const wsOpen = (S, w) => has(S, 'workshop') && S.mono.tier >= (w.mono || 0);

  // a small stable hash, so "a random older part" for an upgrade level is the same every time you look
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function alloyNeed(key, l, from, per, qtyMul) {
    const out = [];
    if (l < from) return out;
    const t = Math.min(MACHINES.length - 1, Math.floor((l - from) / per));
    out.push([MACHINES[t].id, Math.ceil((2 + l * 1.2) * (qtyMul || 1))]);
    // every third level also asks for an older part: no floor sends old machines, so you go back up and farm them
    if (t > 0 && l % 3 === 2) out.push([MACHINES[hash(key + ':' + l) % t].id, Math.ceil((4 + l * 1.5) * (qtyMul || 1))]);
    return out;
  }
  // Shminer's upgrade price: base x N for levels 1-10, then base x 1.3^(N-10) x N (N = the level you buy)
  const upPrice = (base, N) => (N <= 10 ? base * N : base * Math.pow(1.3, N - 10) * N);
  function upCost(key, l, S) {
    const U = UPS[key], N = l + 1;
    const C = S ? calc(S) : null, minus = C ? C.alloyMinus : 0;
    // Ki Power's price "varies" on the wiki: ours grows x1.15 a level after the first ten (the 1.3 rule stalled it)
    const zeni = U.pay.includes('z') ? +((key === 'power' ? (N <= 10 ? U.base * N : U.base * Math.pow(1.15, N - 10) * N) : upPrice(U.base, N)) * (C ? C.upZeni : 1)).toPrecision(3) : 0;
    const alloy = [];
    const qty = (n) => Math.max(1, Math.ceil(n * (C ? C.alloyCost : 1)) - minus);
    if (key === 'power') {
      // Ki Power: alloy of the machine you're around at that level, and every third level an older part
      const t = Math.min(MACHINES.length - 1, Math.floor(l / 4));
      alloy.push([MACHINES[t].id, Math.max(1, qty(2 + 0.6 * l) - (C ? C.powerMinus : 0))]);
      if (t > 0 && l % 3 === 2) alloy.push([MACHINES[hash(key + ':' + l) % t].id, qty(3 + 0.8 * l)]);
    } else if (U.pay.includes('a')) for (const t of U.bars) alloy.push([MACHINES[t].id, qty(upPrice(1, N))]);
    return { zeni, alloy };
  }
  const upMax = (S, key, C) => UPS[key].max + (key === 'power' || UPS[key].fx === 'upCap' ? 0 : (C || calc(S)).upCap);
  const upOpen = (S, key) => S.level >= UPS[key].req;
  function beamCost(key, l, S) {
    const U = BEAM_UPS[key];
    const k = S ? calc(S).alloyCost : 1;
    return { zeni: +(U.base * TUNE.zeniK * Math.pow(U.g, l)).toPrecision(3), alloy: alloyNeed('b' + key, l, U.from, U.per).map(([id, n]) => [id, Math.max(1, Math.ceil(n * k))]) };
  }
  function wsCost(w, l) { return w.ki ? { zeni: +(w.base * TUNE.zeniK * Math.pow(w.g, l)).toPrecision(3), alloy: alloyNeed('ws' + w.id, l + 2, 2, 2, 3) } : { zeni: 0, alloy: w.bars.map(([t, n]) => [MACHINES[t].id, Math.floor(n * Math.pow(1.3, l) + 1e-9)]) }; }
  function canAfford(S, cost) {
    if (S.zeni < cost.zeni) return false;
    return cost.alloy.every(([id, n]) => (S.alloy[id] || 0) >= n);
  }
  function pay(S, cost) {
    S.zeni -= cost.zeni;
    for (const [id, n] of cost.alloy) S.alloy[id] -= n;
  }
  // can this part be got at all right now (its planet is open)?
  const partReachable = (S, id) => MACH[id].planet < planetsOpen(S);

  // ------------------------------------------------------------------ world
  function newWorld() {
    // beamFrom: where the Ki Beam starts (under your fighter at the top; the page sets it). beamOn: firing this frame;
    // beamOut: ran dry (or couldn't start) - the hold uses the disc until you let go
    return { mode: 'field', nodes: [], shots: [], dots: [], spawnT: 0, discT: 0, helperT: {}, events: [], bounds: { x0: 4, y0: 4, x1: 120, y1: 200 }, mono: null, nextId: 1, bulma: null, slow: 0, beamT: 0, beamOn: false, beamOut: false, beamFrom: null };
  }
  // the beam(s) as rays: start point and unit direction. The main one goes from your fighter through the finger;
  // split beams fan out around it.
  function beamRays(S, W, C, input) {
    const B = W.bounds;
    const o = W.beamFrom || [(B.x0 + B.x1) / 2, 0];
    let dx = input.x - o[0], dy = input.y - o[1];
    const l = Math.hypot(dx, dy);
    if (l < 1) { dx = 0; dy = 1; } else { dx /= l; dy /= l; }
    const a0 = Math.atan2(dy, dx), n = C.beams, out = [];
    for (let k = 0; k < n; k++) { const a = a0 + (k - (n - 1) / 2) * TUNE.beamSpread; out.push({ x: o[0], y: o[1], dx: Math.cos(a), dy: Math.sin(a) }); }
    return out;
  }
  // how far along a ray a point is, and how far off it (negative along = behind the fighter)
  const rayDist = (r, x, y) => [(x - r.x) * r.dx + (y - r.y) * r.dy, Math.abs((x - r.x) * r.dy - (y - r.y) * r.dx)];
  function beamHit(S, W, C, input) {
    const rays = beamRays(S, W, C, input);
    const per = C.beamDmg * (rays.length > 1 ? 0.6 : 1), half = C.beamWidth / 2;
    const burn = C.burnPct > 0 ? per * C.beamRate * C.burnPct : 0; // burn damage a second
    for (const r of rays) {
      const crit = discTier(C), d = per * critMult(crit, C);
      if (W.mode === 'mono' && W.mono) {
        const M = W.mono, [along, off] = rayDist(r, M.x, M.y - M.h / 2);
        if (along > 0 && off <= half + M.w / 2) { hitMono(S, W, per, 'beam', r.x + r.dx * along, r.y + r.dy * along, crit, 0, C); if (burn) setBurn(M, burn, C); }
        continue;
      }
      for (const n of W.nodes.slice()) {
        const [along, off] = rayDist(r, n.x, n.y - n.r * 0.7);
        if (along <= 0 || off > half + n.r * 0.7) continue;
        if (burn && n.hp > 0) setBurn(n, burn, C);
        damageNode(S, W, C, n, d, 'beam', crit);
      }
    }
  }
  // a burn lasts burnTime after the last beam hit; with Scorched Earth each second in the beam adds a stack (max 3)
  function setBurn(n, dps, C) {
    const B = n.burn;
    if (!B) { n.burn = { dps, t: TUNE.burnTime, k: 1, e: 0, add: 1 }; return; }
    B.dps = Math.max(B.dps, dps); B.t = TUNE.burnTime;
    if (B.add <= 0 && B.k < C.burnStack) { B.k++; B.add = 1; }
  }
  function burnTick(S, W, C, sdt) {
    const tickOne = (n, hit) => {
      const B = n.burn;
      B.t -= sdt; B.add -= sdt; B.e += sdt;
      while (B.e >= TUNE.burnEvery && n.burn) { B.e -= TUNE.burnEvery; hit(B.dps * TUNE.burnEvery * B.k); }
      if (B.t <= 0) n.burn = null;
    };
    for (const n of W.nodes.slice()) if (n.burn) tickOne(n, (d) => { if (n.hp > 0) damageNode(S, W, C, n, d, 'burn'); });
    if (W.mode === 'mono' && W.mono && W.mono.burn) { const M = W.mono; tickOne(M, (d) => hitMono(S, W, d, 'burn', M.x + (Math.random() - 0.5) * M.w * 0.6, M.y - M.h * (0.3 + Math.random() * 0.4))); }
  }
  const emit = (W, e) => { W.events.push(e); if (W.events.length > 400) W.events.splice(0, 100); };

  // the field is never all one kind: types from the floor's pool that are not out yet come first
  function pickMachine(S, W) {
    let pool = floorPool(S.floor);
    if (W && pool.length > 1) {
      const missing = pool.filter(([t]) => !W.nodes.some((n) => n.t === t));
      if (missing.length) pool = missing;
    }
    const sum = pool.reduce((a, b) => a + b[1], 0);
    let r = Math.random() * sum;
    for (const [t, w] of pool) { r -= w; if (r < 0) return MACHINES[t]; }
    return MACHINES[pool[0][0]];
  }
  function spawnNode(S, W) {
    const m = pickMachine(S, W);
    const B = W.bounds, R = m.r;
    // a full wave must fit: after 20 tries the spacing loosens step by step (machines may overlap a little)
    for (let tries = 0; tries < 60; tries++) {
      const x = B.x0 + R + Math.random() * Math.max(1, B.x1 - B.x0 - 2 * R);
      const y = B.y0 + R * 2 + Math.random() * Math.max(1, B.y1 - B.y0 - 2 * R);
      const room = tries < 20 ? 1 : tries < 40 ? 0.6 : 0;
      if (room && W.nodes.some((n) => (n.x - x) ** 2 + (n.y - y) ** 2 < ((n.r + R + 2) * room) ** 2)) continue;
      const hp = machHp(m.t);
      const C = calc(S);
      const n = { id: W.nextId++, m: m.id, t: m.t, x, y, r: R, hp, max: hp, armor: machArmor(m.t), marks: {}, flash: 0, born: 0, face: Math.random() < 0.5 ? 1 : -1, ph: Math.random() * 10, triple: C.tripleMach > 0 && Math.random() < C.tripleMach };
      W.nodes.push(n);
      return n;
    }
    return null;
  }
  function clearField(W) { W.nodes = []; W.shots = []; W.dots = []; W.wave = false; }

  function damageNode(S, W, C, n, dmg, by, crit, pierce) {
    if (n.hp <= 0) return 0;
    const mod = MODS[n.t];
    if (n.marks.mega) dmg *= 1 + n.marks.mega;
    if (mod) {
      if (mod.crit && (crit || 0) < mod.crit) { emit(W, { type: 'hit', x: n.x, y: n.y - n.r * 0.6, d: 0, by, immune: mod.crit }); return 0; }
      if (mod.dmg) dmg *= mod.dmg;
      if (mod.tech && by === 'tech') dmg *= mod.tech;
    }
    const d = Math.min(n.hp, effDmg(dmg, n.armor * (1 - (pierce || 0))));
    n.hp -= d;
    n.flash = 0.08;
    S.stats.dmg += d;
    // chest meters: a whole machine's HP is one "machine's worth" of damage
    const share = (d / n.max) * C.chestMult;
    if (has(S, 'itemChests')) { S.meter.item += share / TUNE.itemChestEvery; while (S.meter.item >= 1) { S.meter.item -= 1; S.chests.item += 1 + (Math.random() < C.multiChest ? 1 : 0); emit(W, { type: 'chest', kind: 'item' }); } }
    if (has(S, 'superChests')) { S.meter.super += share / TUNE.superChestEvery; while (S.meter.super >= 1) { S.meter.super -= 1; S.chests.super += 1 + (Math.random() < C.multiChest ? 1 : 0); emit(W, { type: 'chest', kind: 'super' }); } }
    emit(W, { type: 'hit', x: n.x, y: n.y - n.r * 0.6, d, by, blocked: dmg <= n.armor, crit });
    if (n.hp <= 0) killNode(S, W, C, n, by);
    return d;
  }
  function helperHit(S, W, C, n, s) {
    const v = s.tv;
    if (s.trait === 'pride') n.marks.pride = Math.max(n.marks.pride || 0, v);
    if (s.pride) n.marks.pride = Math.max(n.marks.pride || 0, s.pride);
    if (s.trait === 'steal') {
      const z = Math.max(1, Math.floor(partValue(n.t) * C.valueMult * v));
      S.zeni += z; S.stats.zeni += z; S.run.zeni += z;
      emit(W, { type: 'steal', x: n.x, y: n.y - n.r * 1.4, z });
    }
    damageNode(S, W, C, n, s.dmg, 'helper', s.crit, s.trait === 'pierce' ? v : 0);
    if (s.trait === 'beam') {
      const others = W.nodes.filter((m) => m !== n);
      if (others.length) { const m = others[Math.floor(Math.random() * others.length)]; emit(W, { type: 'beam', x0: n.x, y0: n.y - n.r * 0.7, x1: m.x, y1: m.y - m.r * 0.7, col: s.col }); damageNode(S, W, C, m, s.dmg * v, 'helper', s.crit); }
    }
    if (s.trait === 'splash') {
      emit(W, { type: 'splash', x: n.x, y: n.y - n.r * 0.7 });
      for (const m of W.nodes.slice()) if (m !== n && (m.x - n.x) ** 2 + (m.y - n.y) ** 2 < 26 * 26) damageNode(S, W, C, m, s.dmg * v, 'helper', s.crit);
    }
  }
  const sround = (x) => Math.floor(x) + (Math.random() < x - Math.floor(x) ? 1 : 0);
  function addCaps(S, n) { S.caps += n; S.stats.capsEarned += n; }
  function killNode(S, W, C, n, by) {
    const m = MACH[n.m];
    let qty = Math.max(1, sround(C.yieldMult * floorMult(S, C) * (n.triple ? 3 : 1) * (n.marks.flare ? C.flareBonus : 1) * (1 + (n.marks.pride || 0)) * (1 + cardVal(S, 'm' + m.t))));
    if (C.doubleOre && Math.random() < C.doubleOre) qty *= 2;
    const alloy = !!n.marks.smelt;
    S.parts[m.id] = (S.parts[m.id] || 0) + qty;
    if (alloy) S.alloy[m.id] = (S.alloy[m.id] || 0) + Math.max(1, sround(qty * C.transX * C.barOut)); // Transmuter: bars as well
    S.seen[m.id] = 1;
    const xp = machXp(m.t) * C.xpMult * (n.marks.kaio ? C.expX : 1) * (1 + cardVal(S, 'r' + regionOf(S.floor)));
    cardRoll(S, W, (alloy ? 'a' : 'm') + m.t, qty);
    S.stats.kills++; S.stats.parts += qty;
    S.run.kills++; S.run.got[m.id] = (S.run.got[m.id] || 0) + qty;
    let caps = 0;
    if (n.marks.kaio && Math.random() < C.kaioCaps) { caps = Math.max(1, sround(C.capsMult)); addCaps(S, caps); }
    goalHit(S, 'kills', null, 1);
    goalHit(S, 'mine', m.id, qty);
    W.nodes = W.nodes.filter((x) => x !== n);
    emit(W, { type: 'kill', x: n.x, y: n.y, m: m.id, face: n.face, qty, alloy, caps });
    addXp(S, W, xp);
  }
  function floorCleared(S, W, C) {
    S.floorKills++; // counts floor clears
    goalHit(S, 'clear', null, 1);
    if (!S.stay && S.floorKills >= floorNeed(S, S.floor, C)) descend(S, W);
  }
  // special floors (wiki Floors): Golden x5 parts, Rainbow x50, Galactic (needs Rainbow) x10, Prismatic (needs
  // Galactic) x1; they stack. Nothing gives these chances yet: the system waits for Relics / items / stars.
  function rollFloorType(S, C) {
    C = C || calc(S);
    let gold = C.goldenCh;
    for (const [t] of floorPool(S.floor)) if (MODS[t] && MODS[t].gold) gold *= MODS[t].gold;
    const rb = Math.random() < C.rainbowCh, gal = rb && Math.random() < C.galacticCh;
    S.ftype = { gold: Math.random() < gold, rainbow: rb, galactic: gal, prism: gal && Math.random() < C.prismCh };
  }
  const floorMult = (S, C) => { const f = S.ftype || {}; return (f.gold ? C.goldenX : 1) * (f.rainbow ? C.rainbowX : 1) * (f.galactic ? C.galacticX : 1) * (f.prism ? C.prismX : 1); };
  function canDescend(S, f) {
    if (f >= MAX_FLOOR) return false;
    return planetOf(f + 1) < planetsOpen(S);
  }
  function descend(S, W) {
    if (!canDescend(S, S.floor)) { S.floorKills = Math.min(S.floorKills, floorNeed(S, S.floor)); return false; }
    S.floor++;
    S.floorKills = 0;
    const first = S.floor > S.maxFloor;
    S.maxFloor = Math.max(S.maxFloor, S.floor);
    if (S.floor >= 8 && S.run.elapsed <= 900) S.run.fast25 = true;
    rollFloorType(S);
    const nw = ORE_FLOORS.findIndex(([a]) => a === S.floor);
    if (W) emit(W, { type: 'floor', floor: S.floor, region: REGION_FLOORS.some(([a]) => a === S.floor) ? REGIONS[regionOf(S.floor)] : null, first, newMach: first && nw > 0 ? nw : null, ftype: S.ftype });
    if (W) cardRoll(S, W, 'r' + regionOf(S.floor), 1); // offline floors add to the one offline roll instead
    goalHit(S, 'floor', null, 1);
    return true;
  }
  // the floors a machine shows up on, most often first (ties: the earlier floor)
  function floorsFor(t) {
    const out = [];
    for (let f = ORE_FLOORS[t][0]; f <= ORE_FLOORS[t][1]; f++) { const hit = floorPool(f).find(([x]) => x === t); if (hit) out.push([f, hit[1]]); }
    return out.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  }
  // where to farm a machine: its best floor you can already reach this run, or null
  function farmFloor(S, t) { const f = floorsFor(t).find(([x]) => x <= S.maxFloor); return f ? f[0] : null; }
  function setFloor(S, W, f) {
    f = Math.max(1, Math.min(S.maxFloor, f | 0));
    if (W.mode !== 'field' || f === S.floor) return false;
    S.floor = f; S.floorKills = 0;
    clearField(W); W.spawnT = 0;
    rollFloorType(S);
    return true;
  }
  function addXp(S, W, xp) {
    const cap = levelCap(S);
    S.xp += xp;
    while (S.xp >= xpNext(S.level)) {
      if (S.level >= cap) { S.xp = Math.min(S.xp, xpNext(S.level)); break; }
      S.xp -= xpNext(S.level);
      S.level++;
      S.stats.bestLevel = Math.max(S.stats.bestLevel || 0, S.level);
      if (W) emit(W, { type: 'level', level: S.level });
    }
  }
  // a disc hit: [base damage, crit tier]. The crit multiplier goes on after armor (Shminer)
  function discHit(C) { return [C.power, discTier(C)]; }

  // input: { down, x, y } in game px
  function tick(S, W, dt, input, now) {
    dt = Math.min(dt, 0.25);
    const C = calc(S);
    let sdt = dt * C.speed * (PLANETS[planetOf(S.floor)].speed || 1);
    if (W.nodes.some((n) => MODS[n.t] && MODS[n.t].speed)) sdt *= Math.min.apply(null, W.nodes.map((n) => (MODS[n.t] && MODS[n.t].speed) || 1));
    S.stats.play += dt;
    S.run.elapsed += dt;
    for (const k of Object.keys(S.buffs)) { S.buffs[k] -= dt; if (S.buffs[k] <= 0) { delete S.buffs[k]; emit(W, { type: 'buffEnd', id: k }); } }
    // ore modifiers on the field: slower Technique recharge, slower game
    let techSpd = 1, slow = 1;
    for (const n of W.nodes) { const md = MODS[n.t]; if (md && md.techCd) techSpd = Math.min(techSpd, md.techCd); if (md && md.speed) slow = Math.min(slow, md.speed); }
    techTick(S, C, sdt, techSpd);
    for (const n of W.nodes) { n.flash = Math.max(0, n.flash - dt); n.born += dt; }
    // the Ki Beam fires instead of the disc while you hold in BEAM (or right click); it needs some Ki to start, and
    // when it runs dry the hold falls back to the disc until you let go
    const held = !!(input && input.down);
    if (!held) W.beamOut = false;
    let beaming = false;
    if (held && has(S, 'beam') && (input.beam || S.weapon === 'beam') && !W.beamOut) {
      if (!W.beamOn && S.ki < TUNE.beamMinStart) { W.beamOut = true; emit(W, { type: 'beamLow' }); }
      else beaming = true;
    }
    W.beamOn = beaming;
    // Ki: a form drains it, so does the beam; it refills only in base form with the beam off. At 0 Ki you drop back
    // to base and the beam stops
    if (S.formOn > 0 || beaming) {
      if (S.formOn > 0) {
        S.ki -= FORM_TIERS[S.formOn].drain * C.kiDrain * (1 - cardVal(S, 'form' + S.formOn)) * dt;
        cardRoll(S, W, 'form' + S.formOn, dt);
      }
      if (beaming) { S.ki -= C.beamDrain * dt; cardRoll(S, W, 'x_beam', dt); }
      if (S.ki <= 0) {
        S.ki = 0;
        if (S.formOn > 0) { S.formOn = 0; emit(W, { type: 'form', tier: 0, out: true }); }
        if (beaming) { W.beamOut = true; W.beamOn = beaming = false; emit(W, { type: 'beamOut' }); }
      }
    } else S.ki = Math.min(C.kiMax, S.ki + C.kiRegen * dt);

    // waves (Shminer): a full field of machines; destroy them all = one floor clear, then the next wave comes
    if (W.mode === 'field' && !W.nodes.length) {
      if (W.wave) { W.wave = false; floorCleared(S, W, C); }
      W.spawnT -= sdt;
      if (W.spawnT <= 0) { for (let i = 0; i < C.maxNodes; i++) spawnNode(S, W); W.wave = true; W.spawnT = C.spawn; }
    }
    // the beam
    const bstep = 1 / C.beamRate;
    if (beaming) {
      W.beamT += sdt;
      while (W.beamT >= bstep) { W.beamT -= bstep; beamHit(S, W, C, input); }
    } else W.beamT = bstep; // the first hit lands the moment it fires
    burnTick(S, W, C, sdt);
    // the disc
    const step = 1 / C.spin;
    if (held && !beaming) {
      W.discT += sdt;
      while (W.discT >= step) {
        W.discT -= step;
        const [d, crit] = discHit(C);
        if (crit >= 2) cardRoll(S, W, 'x_crit', 1);
        if (W.mode === 'mono' && W.mono) {
          const M = W.mono;
          const cx = Math.max(M.x - M.w / 2, Math.min(input.x, M.x + M.w / 2));
          const cy = Math.max(M.y - M.h, Math.min(input.y, M.y));
          if ((cx - input.x) ** 2 + (cy - input.y) ** 2 <= C.radius ** 2) hitMono(S, W, d, 'disc', input.x, input.y, crit, 0, C);
        } else {
          // a machine's body sits above its anchor point (its feet)
          for (const n of W.nodes.slice()) {
            if ((n.x - input.x) ** 2 + (n.y - n.r * 0.7 - input.y) ** 2 <= (C.radius + n.r * 0.8) ** 2) damageNode(S, W, C, n, d * critMult(crit, C), 'disc', crit);
          }
        }
      }
    } else W.discT = step; // the first hit lands the moment you touch
    // companions
    if (has(S, 'companions')) for (const h of HELPERS) {
      if (!cl(S, h.id)) continue;
      const hs = helperStats(S, C, h);
      W.helperT[h.id] = (W.helperT[h.id] || Math.random() * hs.every) + sdt;
      if (W.helperT[h.id] < hs.every) continue;
      W.helperT[h.id] -= hs.every;
      if (W.helperT[h.id] > hs.every) W.helperT[h.id] = 0;
      let fired = 0;
      for (let k = 0; k < hs.shots; k++) {
        let target = null;
        if (W.mode === 'mono' && W.mono) target = { mono: true, x: W.mono.x + (Math.random() - 0.5) * W.mono.w * 0.6, y: W.mono.y - W.mono.h * (0.25 + Math.random() * 0.5) };
        else if (W.nodes.length) { const n = W.nodes[Math.floor(Math.random() * W.nodes.length)]; target = { node: n.id, x: n.x, y: n.y - n.r * 0.7 }; }
        if (!target) continue;
        const crit = rollCrit(hs.crit);
        // a barrage spreads its shots over half a second at most; alt: Goku throwing in Vegeta's slot
        const hv = helperView(S, h);
        W.shots.push({ helper: h.id, alt: !!hv.alt, target, t: -k * Math.min(0.08, 0.5 / hs.shots), dur: 0.45, dmg: hs.dmg * critMult(crit, C), crit, col: hv.col, trait: h.trait.key, tv: hs.trait, pride: h.pride || 0 });
        fired++;
        // now and then (always on a SUPER crit or better) they shout their move
        W.shoutT = W.shoutT || {};
        if ((crit >= 2 || Math.random() < 0.05) && S.stats.play - (W.shoutT[h.id] || -99) > 6) { W.shoutT[h.id] = S.stats.play; emit(W, { type: 'shout', helper: h.id, text: hv.moves[Math.floor(Math.random() * hv.moves.length)] }); }
      }
      if (!fired) W.helperT[h.id] = hs.every * 0.8;
      else cardRoll(S, W, 'f_' + h.id, fired);
    }
    for (const s of W.shots) {
      s.t += sdt;
      if (s.t < s.dur || s.done) continue;
      s.done = true;
      if (s.target.mono) { if (W.mode === 'mono' && W.mono) hitMono(S, W, s.dmg, 'helper', s.target.x, s.target.y, s.crit, s.trait === 'pierce' ? s.tv : 0); }
      else {
        const n = W.nodes.find((m) => m.id === s.target.node);
        if (n) helperHit(S, W, C, n, s);
        emit(W, { type: 'pop', x: s.target.x, y: s.target.y, col: s.col });
      }
    }
    W.shots = W.shots.filter((s) => !s.done);
    // Hellzone Grenade orbs
    for (const D of W.dots) {
      D.t += sdt;
      while (D.t >= D.every && D.ticks > 0) {
        D.t -= D.every; D.ticks--;
        emit(W, { type: 'dot', nodes: W.nodes.map((n) => [n.x, n.y - n.r * 0.7]) });
        for (const n of W.nodes.slice()) { const [m, ct] = techCritHit(C); damageNode(S, W, C, n, D.dmg * m, 'tech', ct); }
      }
    }
    W.dots = W.dots.filter((D) => D.ticks > 0 && W.mode === 'field');
    // Auto Techniques
    W.autoT = (W.autoT || 0) + sdt;
    if (S.autoTech && C.autoTech && W.mode === 'field' && W.nodes.length >= 3 && W.autoT >= 1.25) {
      W.autoT = 0;
      for (const k of TECH_KEYS) if (k !== 'cherry' && techOpen(S, k) && techCharges(S, k) >= 1) { useTech(S, W, k); break; }
    }
    // Loot Bulma flies by now and then
    if (W.mode === 'field') {
      if (!W.bulma && now >= S.bulma.next) {
        const B = W.bounds;
        W.bulma = { x: B.x0 - 14, y: B.y0 + 16 + Math.random() * Math.max(10, (B.y1 - B.y0) * 0.5), vx: (B.x1 - B.x0 + 28) / TUNE.bulmaStay, t: 0 };
        emit(W, { type: 'bulma' });
      }
      if (W.bulma) {
        W.bulma.t += dt; W.bulma.x += W.bulma.vx * dt;
        if (W.bulma.t > TUNE.bulmaStay) { W.bulma = null; S.bulma.next = now + bulmaWait(C); }
      }
    }
    // the Monolith clock
    if (W.mode === 'mono' && W.mono) {
      W.mono.left -= sdt;
      if (W.mono.hp <= 0) endMono(S, W, true, now);
      else if (W.mono.left <= 0) endMono(S, W, false, now);
    }
    freebieTick(S, W, C, sdt);
    // Buu Wishes are checked once a second
    W.slow += dt;
    if (W.slow >= 1) { W.slow = 0; checkWishes(S, W); }
    return C;
  }
  const bulmaWait = (C) => (TUNE.bulmaMin + Math.random() * (TUNE.bulmaMax - TUNE.bulmaMin)) * C.bulmaEvery * 1000;

  // Freebie Packs fill on game time and bank up to the cap
  function freebieTick(S, W, C, sdt) {
    const F = S.freebie;
    if (F.n >= C.freebieBank) { F.p = 0; return; }
    F.p += sdt;
    while (F.p >= C.freebieEvery && F.n < C.freebieBank) { F.p -= C.freebieEvery; F.n++; if (W) emit(W, { type: 'freebie', n: F.n }); }
  }
  function claimFreebie(S, W) {
    const F = S.freebie, C = calc(S);
    if (!(F.n > 0)) return null;
    const got = { caps: 0, item: 0, super: 0, bits: 0, sp: 0 };
    for (; F.n > 0; F.n--) {
      const c = Math.max(1, sround(C.freebieCaps * C.capsMult));
      addCaps(S, c); got.caps += c;
      S.chests.item++; got.item++;
      if (Math.random() < C.freebieSuper) { S.chests.super++; got.super++; }
      // Stonks (skill): 1% each for +200 capsules, +20 Item chests, +10 SUPER chests
      if (C.stonks) { if (Math.random() < C.stonks) { addCaps(S, 200); got.caps += 200; } if (Math.random() < C.stonks) { S.chests.item += 20; got.item += 20; } if (Math.random() < C.stonks) { S.chests.super += 10; got.super += 10; } }
      if (C.freebieRefresh && Math.random() < C.freebieRefresh) F.p = C.freebieEvery; // instant refresh
      if (Math.random() < TUNE.freebieBit) { S.bits++; got.bits++; if (S.bits >= 10) { S.bits -= 10; S.skillPts++; got.sp++; } }
    }
    return got;
  }

  // ------------------------------------------------------------------ actions (return true when something happened)
  // the FORM button: transform into the chosen step, or power down. Needs some Ki to start.
  function transform(S, W) {
    if (S.formOn > 0) { S.formOn = 0; emit(W, { type: 'form', tier: 0 }); return true; }
    const t = Math.min(S.formSel || 1, formsOpenTop(S));
    if (t < 1 || S.ki < TUNE.kiMinStart) return false;
    S.formOn = t;
    emit(W, { type: 'form', tier: t, col: formLook(S, t).aura });
    return true;
  }
  // pick the step the FORM button uses (switches right away if you're already transformed)
  function selectForm(S, W, t) {
    if (!formOpen(S, t)) return false;
    S.formSel = t;
    if (S.formOn > 0 && S.formOn !== t) { S.formOn = t; emit(W, { type: 'form', tier: t, col: formLook(S, t).aura }); }
    return true;
  }
  const techOpen = (S, k) => { const T = TECHS[k]; return T.ws ? (S.ws[T.ws] || 0) > 0 : T.store ? (S.store[T.store] || 0) > 0 : T.skill ? (S.skills[T.skill] || 0) > 0 : true; };
  const techCharges = (S, k) => (S.bomb && S.bomb[k] ? S.bomb[k].c : 0);
  const techReady = (S, k) => techOpen(S, k) && (techCharges(S, k) >= 1 || (S.cherry || 0) > 0);
  // charges refill on game time, each Technique on its own timer
  function techTick(S, C, sdt, techSpd) {
    S.bomb = S.bomb || {};
    for (const k of TECH_KEYS) {
      if (!techOpen(S, k)) continue;
      const B = S.bomb[k] || (S.bomb[k] = { c: 0, t: 0 });
      if (B.c >= C.techCap) { B.t = 0; continue; }
      B.t += sdt * techSpd;
      const cd = TECHS[k].cd * C.techCd * (1 - cardVal(S, 't_' + k));
      while (B.t >= cd && B.c < C.techCap) { B.t -= cd; B.c++; }
    }
  }
  const techCritHit = (C) => { const ct = rollTier(C.techCrit, C.techSuperCh, C.techUltraCh, 0); return [ct ? 2 * C.techCritDmg * (ct >= 2 ? 2 : 1) * (ct >= 3 ? 3 : 1) : 1, ct]; };
  function useTech(S, W, k) {
    if (W.mode !== 'field' || !techReady(S, k)) return false;
    const T = TECHS[k];
    const C = calc(S);
    const B = S.bomb[k] || (S.bomb[k] = { c: 0, t: 0 });
    // an Afterimage charge makes this one free; so does Free Technique Chance
    if (k !== 'cherry' && S.cherry > 0) S.cherry--;
    else if (!(C.freeTech && Math.random() < C.freeTech)) { if (B.c < 1) return false; B.c--; }
    cardRoll(S, W, 't_' + k, 1);
    S.stats.techs++; S.run.techUsed++;
    goalHit(S, 'tech', null, 1);
    emit(W, { type: 'tech', id: k, col: T.col, nodes: W.nodes.map((n) => [n.x, n.y - n.r * 0.7]) });
    let dmg = C.power * C.techMult * T.dmg;
    if (k === 'blast' || k === 'hell') dmg *= C.basicX;
    if (k === 'spirit') dmg *= C.spiritX * (1 + C.megaAdd / 25);
    if (k === 'gem') { dmg *= 1 + 0.04 * S.caps; if (Math.random() < 0.03) addCaps(S, 1); }
    if (k === 'barrage') { dmg *= 1 + C.infScale * (S.stats.barrage || 0); S.stats.barrage = (S.stats.barrage || 0) + 1; }
    if (k === 'hell') { W.dots.push({ t: 1.25, every: 1.25, ticks: C.chainN, dmg }); return true; }
    if (k === 'cherry') { S.cherry = (S.cherry || 0) + (Math.random() < C.cherry3 ? 3 : 1); return true; }
    if (k === 'battery') {
      const others = TECH_KEYS.filter((x) => x !== k && techOpen(S, x));
      for (let i = 0; i < 2 && others.length; i++) { const x = others[Math.floor(Math.random() * others.length)]; S.bomb[x].c = Math.min(C.techCap, S.bomb[x].c + 1); }
      if (Math.random() < 0.001) S.techCapPlus = (S.techCapPlus || 0) + 1;
      return true;
    }
    if (k === 'wish') {
      if (Math.random() < 0.05) { const others = TECH_KEYS.filter((x) => x !== k && techOpen(S, x)); for (let i = 0; i < C.wishN && others.length; i++) { const x = others[Math.floor(Math.random() * others.length)]; S.bomb[x].c = Math.min(C.techCap, S.bomb[x].c + 1); } emit(W, { type: 'wishHit' }); }
      return true;
    }
    for (const n of W.nodes.slice()) {
      if (k === 'smelt') { n.marks.smelt = 1; if (C.transFlare && Math.random() < C.transFlare) n.marks.flare = 1; continue; }
      if (k === 'flare') n.marks.flare = 1;
      if (k === 'kaio') n.marks.kaio = 1;
      if (k === 'spirit' && C.megaMark) n.marks.mega = Math.max(n.marks.mega || 0, C.megaMark);
      const [m, ct] = techCritHit(C);
      damageNode(S, W, C, n, dmg * m, 'tech', ct);
    }
    return true;
  }
  function buyUp(S, key) {
    const l = lv(S, key);
    if (!upOpen(S, key) || l >= upMax(S, key)) return false;
    const cost = upCost(key, l, S);
    if (!canAfford(S, cost)) return false;
    pay(S, cost);
    S.up[key] = l + 1;
    S.run.discBuys++;
    goalHit(S, 'upgrade', null, 1);
    return true;
  }
  function buyBeam(S, key) {
    const l = blv(S, key);
    if (!has(S, 'beam') || l >= BEAM_UPS[key].max) return false;
    const cost = beamCost(key, l, S);
    if (!canAfford(S, cost)) return false;
    pay(S, cost);
    S.bup[key] = l + 1;
    return true;
  }
  // what holding the field fires
  function setWeapon(S, w) {
    if (w === 'beam' && !has(S, 'beam')) return false;
    S.weapon = w === 'beam' ? 'beam' : 'disc';
    return true;
  }
  const lookOwned = (S, id) => { const L = BEAM_LOOK[id]; return !!L && !L.later && (!L.store || (S.store[L.store] || 0) > 0); };
  const beamLookOf = (S) => BEAM_LOOK[lookOwned(S, S.beamLook) ? S.beamLook : S.fighter === 'vegeta' ? 'galick' : 'kamehameha'];
  function setBeamLook(S, id) {
    if (id && !lookOwned(S, id)) return false;
    S.beamLook = id || '';
    return true;
  }
  function buyWs(S, id) {
    const w = WORKSHOP.find((x) => x.id === id);
    const l = S.ws[id] || 0;
    if (!w || !wsOpen(S, w) || l >= wsMax(S, w)) return false;
    const cost = wsCost(w, l);
    if (!canAfford(S, cost)) return false;
    pay(S, cost);
    S.ws[id] = l + 1;
    return true;
  }
  function sell(S, id, n) {
    n = Math.min(n, S.parts[id] || 0);
    if (n <= 0) return 0;
    const C = calc(S);
    const z = +(n * partValue(MACH[id].t) * C.valueMult).toFixed(2); // parts can be worth cents (wiki Sell)
    S.parts[id] -= n;
    S.zeni += z;
    S.stats.zeni += z; S.run.zeni += z;
    goalHit(S, 'sell', null, z);
    return z;
  }
  // expected alloy per refine (the wiki's formula): (1+p2)(1+2p3)(1+4p5)(1+9p10) / (1 - free) x output x card
  function refineAvg(S, id, C) {
    C = C || calc(S);
    const p2 = Math.min(1, C.doubleRefine), p3 = Math.min(1, C.tripleRefine), p5 = Math.min(1, C.fiveRefine), p10 = Math.min(1, C.tenRefine);
    const p20 = Math.min(1, C.twentyRefine);
    return (1 + p2) * (1 + 2 * p3) * (1 + 4 * p5) * (1 + 9 * p10) * (1 + 19 * p20) / (1 - C.freeRefine) * C.barOut * (1 + cardVal(S, 'a' + MACH[id].t));
  }
  function refine(S, id, n) {
    const C = calc(S);
    const ratio = ratioOf(MACH[id].t, C);
    const can = Math.floor((S.parts[id] || 0) / ratio);
    n = Math.min(n, can);
    if (n <= 0) return 0;
    let out = 0, used = 0;
    if (n < 2000) {
      for (let i = 0; i < n; i++) {
        let m = 1;
        if (Math.random() < C.doubleRefine) m *= 2;
        if (Math.random() < C.tripleRefine) m *= 3;
        if (Math.random() < C.fiveRefine) m *= 5;
        if (Math.random() < C.tenRefine) m *= 10;
        if (Math.random() < C.twentyRefine) m *= 20;
        out += m;
        if (!(Math.random() < C.freeRefine)) used++;
      }
      out = sround(out * C.barOut * (1 + cardVal(S, 'a' + MACH[id].t)));
    } else { used = Math.round(n * (1 - C.freeRefine)); out = Math.round(n * refineAvg(S, id, C) * (1 - C.freeRefine)); } // big batches: the average
    S.parts[id] -= used * ratio;
    S.alloy[id] = (S.alloy[id] || 0) + out;
    cardRoll(S, null, 'a' + MACH[id].t, out);
    goalHit(S, 'refine', null, out);
    return out;
  }
  // ---- Z points: Zeni -> Z points at a price that climbs with every point ever bought (S.zpBought)
  // Zeni for points a..b-1 (0-based count of points bought before each one). The first zpFirst cost 1 Zeni together.
  function zpZeni(a, b) {
    const T = TUNE, F = (x) => (T.zpFlat / (T.zpPow + 1)) * Math.pow(x / T.zpFlat, T.zpPow + 1);
    let z = 0;
    if (a < T.zpFirst) { z += (Math.min(b, T.zpFirst) - a) / T.zpFirst; a = Math.min(b, T.zpFirst); }
    if (a < T.zpFlat && b > a) { const e = Math.min(b, T.zpFlat); z += e - a; a = e; }
    if (b > a) z += F(b - 0.5) - F(a - 0.5); // the curve, summed as its integral around each point
    return z;
  }
  // what buying n more points costs (the very first buy always rounds up to the whole first-Zeni pack)
  const zpBuyN = (S, n) => (S.zpBought < TUNE.zpFirst ? Math.max(n, TUNE.zpFirst - S.zpBought) : n);
  const zpCost = (S, n) => +(zpZeni(S.zpBought, S.zpBought + zpBuyN(S, n)) * TUNE.zeniK).toPrecision(4);
  // the most points the Zeni on hand buys
  function zpMax(S) {
    if (S.zeni < zpCost(S, 1)) return 0;
    let lo = 1, hi = 1;
    while (zpCost(S, hi * 2) <= S.zeni && hi < 1e15) hi *= 2;
    hi *= 2;
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (zpCost(S, m) <= S.zeni) lo = m; else hi = m; }
    return lo;
  }
  function buyZp(S, n) {
    if (!has(S, 'companions') || n <= 0) return 0;
    n = zpBuyN(S, n);
    const cost = zpCost(S, n);
    if (S.zeni < cost) return 0;
    S.zeni -= cost;
    S.zp += n;
    S.zpBought += n;
    return n;
  }
  function hire(S, id) {
    const h = HELPER[id];
    if (!has(S, 'companions') || S.mono.tier < h.mono || cl(S, id) || S.zp < h.hire) return false;
    S.zp -= h.hire;
    S.helpers[id] = { lv: 1, dmg: 0, spd: 0, multi: 0, crit: 0, trait: 0 };
    return true;
  }
  function upHelper(S, id, key) {
    const h = HELPER[id], c = cl(S, id);
    if (!c) return false;
    c[key] = c[key] || 0;
    if (c[key] >= COMP_UPS[key].max) return false;
    const cost = compUpCost(h, key, c[key]);
    if (S.zp < cost) return false;
    S.zp -= cost;
    c[key]++;
    return true;
  }
  function buyItem(S, id, n) { // Shminer items can't be bought: kept for old buttons, always no
    if (!ITEMS[id].buy) return false;
    const c = itemPrice(S, id) * n;
    if (S.zeni < c) return false;
    S.zeni -= c;
    S.items[id] = (S.items[id] || 0) + n;
    return true;
  }
  function useItem(S, W, id) {
    if (!(S.items[id] > 0)) return false;
    const I = ITEMS[id];
    if (id === 'senzu') { // Shminer's Charge Magnet: up to 20 more charges on every Technique
      const C = calc(S);
      const ks = TECH_KEYS.filter((k) => techOpen(S, k) && techCharges(S, k) < C.techCap);
      if (!ks.length) return false;
      for (const k of ks) S.bomb[k].c = Math.min(C.techCap, S.bomb[k].c + 20);
    } else if (id === 'kidrink') {
      const max = calc(S).kiMax;
      if (S.ki >= max - 0.5) return false;
      S.ki = max;
    } else {
      if ((S.buffs[id] || 0) + I.dur > BUFF_MAX) return false;
      S.buffs[id] = Math.min(BUFF_MAX, (S.buffs[id] || 0) + I.dur * (1 + cardVal(S, 'i_' + id)) * calc(S).itemDur);
    }
    // the instant items' cards give a chance to keep the item
    if (!(I.dur === 0 && Math.random() < cardVal(S, 'i_' + id))) S.items[id]--;
    cardRoll(S, W, 'i_' + id, 1);
    S.run.itemsUsed++;
    emit(W, { type: 'item', id });
    return true;
  }

  // ------------------------------------------------------------------ chests
  function rollRarity(weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
    return 0;
  }
  function openChests(S, kind, n) {
    n = Math.min(n, S.chests[kind] || 0);
    if (n <= 0 || !has(S, kind === 'item' ? 'itemChests' : 'superChests')) return null;
    const C = calc(S);
    const got = {};
    let caps = 0;
    S.chests[kind] -= n;
    for (let i = 0; i < n; i++) {
      if (kind === 'item') {
        const id = ITEM_KEYS[rollRarity(ITEM_W)];
        const q = 1 + C.itemExtra + (Math.random() < 0.15 ? 1 : 0);
        S.items[id] = (S.items[id] || 0) + q;
        got[id] = (got[id] || 0) + q;
        S.stats.chests++;
      } else {
        const s = giveRelic(S, rollRarity(RARITIES.map((x) => x.w)));
        if (s) got[s.id] = (got[s.id] || 0) + 1;
        S.stats.supers++;
      }
    }
    if (kind === 'item' && C.superFromItem > 0) { const s = sround(n * C.superFromItem); if (s) { S.chests.super += s; got.superChest = s; } }
    if (caps) addCaps(S, caps);
    cardRoll(S, null, 'x_chest', n);
    return { kind, n, got, caps };
  }

  // one relic of rarity r: any of that rarity that's open (its gate met) and under its cap; counts toward the gates
  const relicOpen = (S, x) => (S.sup[x.id] || 0) < x.max && (!x.need || ((S.relicN || {})[x.r] || 0) >= x.need[0] && S.mono.tier >= x.need[1]);
  function giveRelic(S, r) {
    let pool = SUPER.filter((x) => x.r === r && relicOpen(S, x));
    if (!pool.length) pool = SUPER.filter((x) => x.r <= r && relicOpen(S, x));
    if (!pool.length) return null;
    const x = pool[Math.floor(Math.random() * pool.length)];
    S.sup[x.id] = (S.sup[x.id] || 0) + 1;
    S.relicN = S.relicN || {};
    S.relicN[r] = (S.relicN[r] || 0) + 1;
    return x;
  }

  // ------------------------------------------------------------------ Loot Bulma
  function catchBulma(S, W, now) {
    if (!W.bulma) return null;
    const C = calc(S);
    const at = { x: W.bulma.x, y: W.bulma.y };
    W.bulma = null;
    S.bulma.next = now + bulmaWait(C);
    S.stats.bulma++;
    const r = Math.random();
    let text, caps = 0;
    const income = Math.round(120 * partValue(floorPool(S.floor)[0][0]) * C.valueMult * (1 + cardVal(S, 'x_bulma')) * C.bulmaLoot);
    cardRoll(S, W, 'x_bulma', 1);
    if (r < 0.35) { S.zeni += income; text = '+' + fmt(income) + ' Zeni'; }
    else if (r < 0.6) { S.chests.item += 3; text = '+3 Item chests'; }
    else if (r < 0.82) {
      const pool = ITEM_KEYS.filter((k) => ITEMS[k].r <= 3);
      const id = pool[Math.floor(Math.random() * pool.length)];
      S.items[id] = (S.items[id] || 0) + 1; text = '+1 ' + ITEMS[id].name;
    } else if (r < 0.92) { S.chests.super += 1; text = '+1 SUPER chest'; }
    else { caps = Math.max(1, sround((5 + Math.floor(Math.random() * 11)) * C.capsMult)); addCaps(S, caps); text = '+' + caps + ' Rainbow Capsules'; }
    emit(W, { type: 'bulmaGot', text, x: at.x, y: at.y, caps });
    return text;
  }

  // ------------------------------------------------------------------ Katchin Monolith
  const monoReady = (S, now) => now >= S.mono.readyAt && S.mono.tier < TUNE.monoTiers;
  // what clearing Monolith number n pays (wiki Obelisk rewards; Gems = Rainbow Capsules, Relic chests = SUPER chests,
  // Gifts = Item chests, Mythic / Divine chest = a Mythic / Divine relic). Food and other Shminer items wait for an
  // Items batch. perk: a permanent multiplier ([key, x]).
  const MONO_REW = [null,
    [100, { i: 5, s: 5 }], [105, { i: 10, s: 10 }], [110, { i: 20, s: 20 }], [115, { sp: 1, perk: ['zkMono', 1.1] }], [120, { i: 5 }],
    [125, { s: 25 }], [130, { tc: 25 }], [140, { s: 25, sp: 2 }], [150, { m: 1 }], [160, { i: 10 }],
    [170, { s: 50 }], [180, { sp: 4, perk: ['zkMono', 1.25] }], [190, { m: 1 }], [200, { perk: ['xpMono', 1.15] }], [210, { i: 15 }],
    [220, { s: 60, sp: 6 }], [230, { tc: 50 }], [240, {}], [250, { dv: 1 }], [275, { i: 20 }],
    [300, { s: 80, perk: ['barMono', 1.05] }], [325, { i: 200, sp: 10 }], [350, { s: 100 }], [375, {}], [400, { i: 25 }],
    [425, {}], [450, { s: 125 }], [475, { i: 250 }], [500, { sp: 15 }], [550, { i: 30 }],
    [600, { m: 2 }], [650, { i: 300 }], [700, {}], [800, { s: 225 }], [900, { i: 35 }],
    [1000, { i: 400, sp: 20 }], [1250, {}], [1500, { s: 250 }], [1750, {}], [2000, { i: 40 }],
    [2250, {}], [2500, { s: 300 }], [2750, {}], [3000, { i: 600 }], [3250, { i: 45 }],
    [3500, { sp: 25 }], [3750, { s: 500 }], [4000, { i: 800 }], [4250, {}], [4500, { i: 50 }]];
  function monoPerks(tier) { const out = []; for (let n = 1; n <= Math.min(tier, 50); n++) { const x = MONO_REW[n][1]; if (x.perk) out.push(x.perk); if (x.tc) out.push(['tcMono' + n, x.tc]); } return out; }
  const PERK_TXT = { zkMono: 'Zenkai Point gain', xpMono: 'Power Level gain', barMono: 'Alloy output' };
  function monoReward(k) {
    const n = k + 1, R = (MONO_REW[n] || [40 + 10 * n, {}]), x = R[1];
    return {
      caps: R[0],
      itemChests: x.i || 0,
      superChests: x.s || 0, mythic: x.m || 0, divine: x.dv || 0,
      skillPts: x.sp || 0,
      perk: x.perk ? 'x' + x.perk[1] + ' ' + PERK_TXT[x.perk[0]] : x.tc ? '+' + x.tc + ' Technique capacity' : null,
      cap: TUNE.levelCapPer,
      unlocks: UNLOCKS.filter((u) => u.n === n),
      helpers: HELPERS.filter((h) => h.mono === n),
      techs: [],
      skillRow: 0
    };
  }
  function startMono(S, W, now) {
    if (W.mode !== 'field' || !monoReady(S, now)) return false;
    const C = calc(S);
    const k = S.mono.tier;
    const B = W.bounds;
    // damage from earlier attempts stays: weaker players can wear a Monolith down over many tries
    const hp = Math.max(1, monoHp(k) - (S.mono.dmg || 0));
    W.saved = W.nodes;
    W.nodes = [];
    W.shots = [];
    W.dots = [];
    W.bulma = null;
    W.mode = 'mono';
    const h = Math.min(80, (B.y1 - B.y0) * 0.55);
    W.mono = { tier: k, hp, max: monoHp(k), start: hp, armor: monoArmor(S, k, C), left: C.monoTime, time: C.monoTime, x: (B.x0 + B.x1) / 2, y: (B.y0 + B.y1) / 2 + h / 2, w: Math.round(h * 0.56), h, flash: 0 };
    S.mono.readyAt = now + C.monoCd * 1000;
    S.stats.monoTries++;
    emit(W, { type: 'monoStart' });
    return true;
  }
  // base damage minus armor, then the crit multiplier (Shminer); below the armor a hit does nothing
  function hitMono(S, W, dmg, by, x, y, crit, pierce, C) {
    const M = W.mono;
    const over = dmg * (1 + cardVal(S, 'x_mono')) - M.armor * (1 - (pierce || 0));
    const mult = crit && by !== 'helper' ? critMult(crit, C || calc(S)) : 1;
    const d = Math.min(M.hp, Math.max(0, over) * mult);
    M.hp -= d;
    M.flash = 0.06;
    S.stats.dmg += d;
    emit(W, { type: 'monoHit', x, y, d, by, blocked: dmg <= M.armor, crit });
  }
  function endMono(S, W, won, now) {
    const M = W.mono;
    const frac = Math.min(1, 1 - M.hp / M.max); // all damage so far on this tier
    const dealt = Math.min(1, (M.start - Math.max(0, M.hp)) / M.max); // this attempt
    let reward = null;
    if (won) {
      reward = monoReward(M.tier);
      S.mono.tier++;
      S.mono.best = 0;
      S.mono.dmg = 0;
      S.stats.monoWins++;
      addCaps(S, reward.caps);
      S.chests.item += reward.itemChests;
      S.chests.super += reward.superChests;
      for (let i = 0; i < reward.mythic; i++) giveRelic(S, 4);
      for (let i = 0; i < reward.divine; i++) giveRelic(S, 5);
      S.skillPts += reward.skillPts;
      if (S.run.itemsUsed === 0) S.run.pureWin = true;
      S.mono.readyAt = now + calc(S).monoCd * 1000;
      // a new form step opens: the FORM button moves up to it
      if (FORM_TIERS.some((f, k) => f && f.mono === S.mono.tier && k > (S.formSel || 0))) S.formSel = formsOpenTop(S);
      if (has(S, 'cards')) cardGive(S, W, 'x_mono');
    } else { S.mono.dmg = M.max - M.hp; S.mono.best = frac; }
    W.mode = 'field';
    W.nodes = W.saved || [];
    W.saved = null;
    W.mono = null;
    emit(W, { type: 'monoEnd', won, frac, dealt, tier: M.tier, reward });
  }
  function quitMono(S, W, now) { if (W.mode === 'mono') { W.mono.left = 0; endMono(S, W, false, now); } }

  // ------------------------------------------------------------------ skill tree, store, wishes
  // a skill needs any skill in the row above (the first row and our Ki Beam row need none) and its Monolith
  function skillParent(s) { return null; }
  const skillLinked = (S, s) => s.row === 0 || s.id === 'scorch' || SKILLS.some((x) => x.row === s.row - 1 && S.skills[x.id] > 0);
  const skillReady = (S, s) => has(S, 'skills') && !(S.skills[s.id] > 0) && S.mono.tier >= s.mono && skillLinked(S, s) && S.skillPts >= s.cost;
  function buySkill(S, id) {
    const s = SKILLBY[id];
    if (!s || !skillReady(S, s)) return false;
    S.skillPts -= s.cost;
    S.skills[id] = 1;
    return true;
  }
  function buyStore(S, id) {
    const s = STOREBY[id];
    if (!s || !has(S, 'store') || S.caps < s.cost || (s.need && !has(S, s.need))) return false;
    if (s.max && (S.store[id] || 0) >= s.max) return false;
    S.caps -= s.cost;
    S.store[id] = (S.store[id] || 0) + 1;
    if (s.grant) s.grant(S);
    return true;
  }
  function checkWishes(S, W) {
    if (!has(S, 'wishes')) return;
    for (const w of WISHES) {
      if (S.wishes[w.id]) continue;
      const [a, b] = w.prog(S);
      if (a >= b) { S.wishes[w.id] = 1; if (w.grant) w.grant(S); if (W) emit(W, { type: 'wish', id: w.id }); }
    }
  }

  // ------------------------------------------------------------------ Zenkai
  function zenkaiGain(S) {
    if (S.level < TUNE.zenkaiLevel) return 0;
    const C = calc(S);
    // Shminer: 12 x 1.084^(level - 10), and past level 200 also x (1 + 0.05 x (level - 200))
    return Math.floor(12 * Math.pow(1.084, S.level - 10) * (S.level > 200 ? 1 + 0.05 * (S.level - 200) : 1) * C.zkMult);
  }
  // what Zenkai keeps; everything else starts over
  const KEEP = ['caps', 'skillPts', 'mono', 'helpers', 'items', 'chests', 'meter', 'ws', 'sup', 'store', 'skills', 'wishes', 'autoTech', 'zenkai', 'bulma', 'goals', 'seen', 'stats', 'opt', 'created', 'fighter', 'formSel', 'zp', 'zpBought', 'cards', 'weapon', 'beamLook', 'freebie', 'bits', 'relicN'];
  function zenkai(S, W, now) {
    const g = zenkaiGain(S);
    if (g <= 0 || W.mode !== 'field') return false;
    const fresh = newState(now);
    const keep = {};
    for (const k of KEEP) keep[k] = S[k];
    keep.zenkai.pts += g;
    keep.zenkai.total += g;
    keep.zenkai.count++;
    for (const k of Object.keys(S)) delete S[k];
    Object.assign(S, fresh, keep);
    const C = calc(S);
    S.floor = S.maxFloor = Math.min(C.startFloor, PLANETS[0].to);
    clearField(W);
    W.spawnT = 0;
    emit(W, { type: 'zenkai', gain: g });
    cardRoll(S, W, 'x_zenkai', 1);
    return true;
  }
  function buyZk(S, id) {
    const z = ZK.find((x) => x.id === id);
    const l = S.zenkai.up[id] || 0;
    if (!zkTierOpen(S, z.tier) || !zkUnlocked(S, z) || l >= z.max + calc(S).zkCap) return false;
    const c = zkCost(z, l);
    if (S.zenkai.pts < c) return false;
    S.zenkai.pts -= c;
    S.zenkai.up[id] = l + 1;
    return true;
  }

  // ------------------------------------------------------------------ Contracts (Monolith 8; reset by Zenkai)
  // Bulma orders one kind of Capsule Alloy at a time; every order asks for more. Each pays Contract Points (CP).
  // S.ct = { done, pts, up: {id: level}, cur: {id, n}, rerollAt }
  // Contract upgrades: CP cost = base x g^level (x the Zenkai discount); per: true ones cost CT_PER[level].
  // max is the base cap; the Zenkai booster "Contract Upgrade Caps" raises every cap.
  const CT_PER = [10, 500, 1500, 3000, 5000, 8500, 12500, 14000, 17000, 20000, 23000, 26000, 29000, 32000, 35000];
  const CT_UPS = [
    { id: 'cdisc', name: 'Disc Damage per Contract', desc: '+1% disc damage for every Contract done this run', fx: [['discPerCt', 0.01]], max: 1, per: true, mono: 8 },
    { id: 'ctref3', name: 'Triple Refine Chance', desc: '+1% chance a refine gives x3 alloy', fx: [['tripleRefine', 0.01]], max: 5, base: 14, g: 1.3, mono: 8 },
    { id: 'ctcrit', name: 'Disc Crit Chance', desc: '+2% disc crit chance', fx: [['critCh', 0.02]], max: 5, base: 14, g: 1.3, mono: 8 },
    { id: 'cttcd', name: 'Technique Recharge', desc: '-3% Technique cooldowns', fx: [['techCdPct', 0.03]], max: 5, base: 14, g: 1.3, mono: 8 },
    { id: 'ctxp', name: 'Power Level Gain', desc: '+10% Power Level XP', fx: [['xpPct', 0.1]], max: 5, base: 14, g: 1.3, mono: 8 },
    { id: 'ctcritd', name: 'Crit Damage', desc: '+8% crit damage', fx: [['critDmg', 0.08]], max: 5, base: 14, g: 1.3, mono: 8 },
    { id: 'ctdisc', name: 'Disc Damage', desc: '+15% disc damage', fx: [['discPct', 0.15]], max: 3, base: 34, g: 1.3, mono: 8 },
    { id: 'ctalloy', name: 'Upgrade Alloy Cost', desc: '-5% alloy for Disc upgrades', fx: [['alloyCostPct', 0.05]], max: 3, base: 34, g: 1.3, mono: 8 },
    { id: 'ctzk', name: 'Zenkai Point Gain', desc: '+10% Zenkai Points', fx: [['zkPct', 0.1]], max: 3, base: 34, g: 1.3, mono: 8 },
    { id: 'ctref10', name: '10x Refine Chance', desc: '+1% chance a refine gives x10 alloy', fx: [['tenRefine', 0.01]], max: 1, base: 60, g: 1.3, mono: 8 },
    { id: 'ctech', name: 'Technique Damage per Contract', desc: '+1% Technique damage for every Contract done this run', fx: [['techPerCt', 0.01]], max: 1, per: true, mono: 12 },
    { id: 'ctsell', name: 'Part Sell Price', desc: '+15% Zeni from selling parts', fx: [['valuePct', 0.15]], max: 10, base: 20, g: 1.3, mono: 12 },
    { id: 'ctfight', name: 'Z-Fighter Damage', desc: '+4% Z-Fighter damage', fx: [['compPct', 0.04]], max: 5, base: 20, g: 1.3, mono: 12 },
    { id: 'ctultra', name: 'Disc and Z-Fighter Crit', desc: '+1% crit chance for the disc and Z-Fighters', fx: [['critCh', 0.01], ['compCritCh', 0.01]], max: 5, base: 20, g: 1.3, mono: 12 },
    { id: 'ctyield', name: 'Salvage Yield', desc: '+3% parts from machines', fx: [['yieldPct', 0.03]], max: 5, base: 20, g: 1.3, mono: 12 },
    { id: 'ctcaps', name: 'Rainbow Capsules', desc: '+3% Rainbow Capsules from everything', fx: [['capsPct', 0.03]], max: 5, base: 20, g: 1.3, mono: 12 },
    { id: 'ctbulma', name: 'Loot Bulma Visits', desc: 'Loot Bulma flies by 3% more often', fx: [['bulmaPct', 0.03]], max: 5, base: 40, g: 1.3, mono: 14 },
    { id: 'ctspeed', name: 'Game Speed', desc: '+1% speed for everything', fx: [['speedPct', 0.01]], max: 10, base: 40, g: 1.3, mono: 14 },
    { id: 'ctchest', name: 'Chest Meters', desc: '+2% chest meter fill', fx: [['chestPct', 0.02]], max: 10, base: 60, g: 1.3, mono: 16 },
    { id: 'ctsuper', name: 'Hidden SUPER Chests', desc: '+0.15% chance an Item chest also holds a SUPER chest', fx: [['superFromItem', 0.0015]], max: 10, base: 60, g: 1.3, mono: 16 }
  ];
  const CT_BY = Object.fromEntries(CT_UPS.map((u) => [u.id, u]));
  const newCt = () => ({ done: 0, pts: 0, up: {}, cur: null, rerollAt: 0 });
  const ctOpen = (S, u) => has(S, 'contracts') && S.mono.tier >= u.mono;
  const ctMax = (S, u, B) => u.max + b0(B || bonus(S), 'ctCap');
  function ctUpCost(S, u, l, B) {
    const raw = u.per ? CT_PER[Math.min(l, CT_PER.length - 1)] + Math.max(0, l - CT_PER.length + 1) * 3000 : u.base * Math.pow(u.g, l);
    return Math.max(1, Math.round(raw * Math.max(0.2, 1 - b0(B || bonus(S), 'ctUpPct'))));
  }
  // the next order: alloy of one machine this run can farm (the newest ten kinds you've reached), more each time
  function ctMake(S, B) {
    const top = floorPool(S.maxFloor)[0][0];
    const lo = Math.max(MACHINES.findIndex((m) => m.planet === planetOf(S.maxFloor)), top - 9);
    const t = lo + Math.floor(Math.random() * (top - lo + 1));
    const n = Math.max(1, Math.ceil(((10 + 2 * t) * Math.pow(1.1, S.ct.done)) / (1 + b0(B || bonus(S), 'ctCostPct'))));
    return { id: MACHINES[t].id, n };
  }
  function ctCurrent(S) {
    if (!has(S, 'contracts')) return null;
    if (!S.ct.cur) S.ct.cur = ctMake(S);
    return S.ct.cur;
  }
  // hand the alloy over: CP paid, a 2x / 3x / 5x / 10x roll (the best one that hits), and the next order
  function ctDeliver(S, W) {
    const o = ctCurrent(S);
    if (!o || (S.alloy[o.id] || 0) < o.n) return null;
    const B = bonus(S);
    S.alloy[o.id] -= o.n;
    let mult = 1;
    for (const [k, m] of [['ct10x', 10], ['ct5x', 5], ['ct3x', 3], ['ct2x', 2]]) if (Math.random() < b0(B, k)) { mult = m; break; }
    const pts = Math.round((10 + b0(B, 'ctPts')) * mult * (1 + cardVal(S, 'x_contract')));
    S.ct.pts += pts;
    S.ct.done++;
    S.ct.cur = ctMake(S, B);
    if (W) emit(W, { type: 'contract', pts, mult });
    cardRoll(S, W, 'x_contract', 1);
    return { pts, mult };
  }
  // a different order, free once a minute (orders can ask for alloy you'd rather keep)
  function ctReroll(S, now) {
    if (!has(S, 'contracts') || now < S.ct.rerollAt) return false;
    S.ct.cur = ctMake(S);
    S.ct.rerollAt = now + 60 * 1000;
    return true;
  }
  function buyCt(S, id) {
    const u = CT_BY[id], B = bonus(S);
    const l = S.ct.up[id] || 0;
    if (!u || !ctOpen(S, u) || l >= ctMax(S, u, B)) return false;
    const c = ctUpCost(S, u, l, B);
    if (S.ct.pts < c) return false;
    S.ct.pts -= c;
    S.ct.up[id] = l + 1;
    return true;
  }

  // ------------------------------------------------------------------ Cards (Monolith 10; kept through Zenkai)
  // A card for every machine, alloy, Z-Fighter, form step, Technique, item and region, plus a few misc ones.
  // Owning one gives +5% to its own thing; a Transformed card (golden, paid in Rainbow Capsules) gives x3 that.
  // Drops: each action rolls once, its chances added up (a kill dropping 12 parts rolls 12 x the per-part chance).
  // Offline: one roll per missing card with everything you did while away added up (so at most one of each).
  // S.cards = { id: 1 (owned) | 3 (Transformed) }
  const CARDS = [];
  const card = (id, kind, name, how, perk, p, caps, extra) => CARDS.push(Object.assign({ id, kind, name, how, perk, p, caps }, extra));
  MACHINES.forEach((m) => card('m' + m.t, 'machine', m.name, 'Destroy ' + m.name + 's', 'parts from ' + m.name + 's', 1 / (250 * Math.pow(1.12, m.t)), 15 + 3 * m.t, { m: m.id }));
  MACHINES.forEach((m) => card('a' + m.t, 'alloy', m.part + ' Alloy', 'Refine ' + m.part + ' Alloy (or Smelt them)', 'alloy from refining ' + m.part + 's', 1 / (200 * Math.pow(1.1, m.t)), 15 + 3 * m.t, { m: m.id }));
  HELPERS.forEach((h) => card('f_' + h.id, 'fighter', h.name, 'Let ' + h.name + ' fight', h.name + "'s damage", 1 / 20000, 80, { h: h.id }));
  for (let k = 1; k < FORM_TIERS.length; k++) card('form' + k, 'form', formName(k), 'Stay in this form', 'less Ki drain in this form', 1 / 900, 100, { tier: k });
  for (const k of TECH_KEYS) card('t_' + k, 'tech', TECHS[k].name, 'Use ' + TECHS[k].name, 'faster ' + TECHS[k].name + ' cooldown', 1 / 120, 60, { tk: k });
  for (const k of ITEM_KEYS) card('i_' + k, 'item', ITEMS[k].name, 'Use ' + ITEMS[k].name, ITEMS[k].dur === 0 ? 'chance to keep the ' + ITEMS[k].name : 'longer ' + ITEMS[k].name, 1 / 25, 40, { ik: k });
  REGIONS.forEach((r, i) => card('r' + i, 'region', r.name, 'Go down floors in ' + r.name, 'Power Level XP in ' + r.name, 1 / 60, 50, { region: i }));
  card('x_mono', 'misc', 'Katchin', 'Break a Katchin Monolith (always drops)', 'damage to the Monolith', 0, 120);
  card('x_bulma', 'misc', 'Loot Bulma', 'Catch Loot Bulma', "Loot Bulma's Zeni prize", 1 / 8, 100);
  card('x_zenkai', 'misc', 'Zenkai', 'Go Zenkai', 'Zenkai Points', 1 / 3, 120);
  card('x_chest', 'misc', 'Capsule Chest', 'Open chests', 'chest meter fill', 1 / 300, 100);
  card('x_contract', 'misc', "Bulma's Order", 'Finish Contracts', 'Contract Points', 1 / 15, 100);
  card('x_goal', 'misc', 'Training Goal', 'Claim Training Goals', 'Training Goal Zeni', 1 / 8, 80);
  card('x_crit', 'misc', 'Critical Hit', 'Land SUPER crits or better with the disc', 'crit damage', 1 / 4000, 100);
  card('x_beam', 'misc', 'Ki Beam', 'Fire the Ki Beam', 'Ki Beam damage', 1 / 600, 100);
  const CARD = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const CARD_KINDS = [['machine', 'MACHINES'], ['alloy', 'ALLOY'], ['fighter', 'Z-FIGHTERS'], ['form', 'FORMS'], ['tech', 'TECHNIQUES'], ['item', 'ITEMS'], ['region', 'REGIONS'], ['misc', 'MISC']];
  const CARD_PERK = 0.05;
  // a card's bonus: 0, +5% owned, +15% Transformed
  const cardVal = (S, id) => (S.cards && S.cards[id] ? CARD_PERK * S.cards[id] : 0);
  function cardGive(S, W, id) {
    if (S.cards[id]) return false;
    S.cards[id] = 1;
    if (W) emit(W, { type: 'card', id });
    return true;
  }
  // one roll for an action that counts `n` times toward this card (n parts, n seconds, n shots...)
  function cardRoll(S, W, id, n) {
    if (!has(S, 'cards') || S.cards[id]) return false;
    const c = CARD[id];
    if (!c || !c.p) return false;
    return Math.random() < c.p * n ? cardGive(S, W, id) : false;
  }
  const transformCost = (id) => CARD[id].caps;
  function transformCard(S, id) {
    if (S.cards[id] !== 1 || S.caps < transformCost(id)) return false;
    S.caps -= transformCost(id);
    S.cards[id] = 3;
    return true;
  }
  const cardCount = (S) => { let n = 0, g = 0; for (const k of Object.keys(S.cards)) { n++; if (S.cards[k] === 3) g++; } return [n, g]; };

  // ------------------------------------------------------------------ Training Goals (5 a day)
  const dayOf = (now) => { const d = new Date(now); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  function goalReward(S) { return Math.round(80 * partValue(floorPool(S.maxFloor)[0][0]) * (1 + 0.25 * S.goals.done)); }
  function makeGoal(S) {
    S.goals.seq++;
    const kinds = ['mine', 'mine', 'kills', 'refine', 'sell', 'upgrade', 'floor'];
    if (has(S, 'techniques')) kinds.push('tech');
    const kind = kinds[hash('g' + S.goals.seq + S.created) % kinds.length];
    const sc = 1 + S.floor / 20;
    const g = { kind, have: 0, id: S.goals.seq };
    if (kind === 'mine') {
      const pool = floorPool(S.floor);
      const m = MACHINES[pool[pool.length - 1][0]];
      g.key = m.id; g.n = Math.round(25 * sc); g.text = 'Salvage ' + g.n + ' ' + m.part + 's';
    } else if (kind === 'kills') { g.n = Math.round(60 * sc); g.text = 'Destroy ' + g.n + ' machines'; }
    else if (kind === 'refine') { g.n = Math.round(12 * sc); g.text = 'Refine ' + g.n + ' Capsule Alloy'; }
    else if (kind === 'sell') { g.n = Math.round(150 * partValue(floorPool(S.floor)[0][0])); g.text = 'Sell parts for ' + fmt(g.n) + ' Zeni'; }
    else if (kind === 'upgrade') { g.n = 3; g.text = 'Buy 3 Disc upgrades'; }
    else if (kind === 'floor') { g.n = 3; g.text = 'Go down 3 floors'; }
    else { g.n = 6; g.text = 'Use 6 Techniques'; }
    return g;
  }
  function goalsFor(S, now) {
    const day = dayOf(now);
    if (S.goals.day !== day) { S.goals.day = day; S.goals.done = 0; S.goals.list = []; }
    while (S.goals.list.length < 1 && S.goals.done < TUNE.goalsPerDay) S.goals.list.push(makeGoal(S));
    return S.goals;
  }
  function goalHit(S, kind, key, n) {
    for (const g of S.goals.list) if (g.kind === kind && (!g.key || g.key === key)) g.have = Math.min(g.n, g.have + n);
  }
  function claimGoal(S, W, now) {
    const G = goalsFor(S, now);
    const g = G.list[0];
    if (!g || g.have < g.n) return false;
    const z = Math.round(goalReward(S) * (1 + cardVal(S, 'x_goal')));
    S.zeni += z;
    cardRoll(S, W, 'x_goal', 1);
    G.done++;
    G.list.shift();
    let bonus;
    if (G.done === TUNE.goalsPerDay) { S.items.senzu = (S.items.senzu || 0) + 2; S.items.chamber = (S.items.chamber || 0) + 1; S.chests.item += 5; bonus = '2 Senzu Beans, a Time Chamber and 5 Item chests'; }
    else { const k = ['scouter', 'discap', 'turbo', 'pole'][G.done % 4]; S.items[k] = (S.items[k] || 0) + 1; bonus = ITEMS[k].name; }
    emit(W, { type: 'goal', zeni: z, bonus });
    goalsFor(S, now);
    return true;
  }

  // ------------------------------------------------------------------ offline progress
  // Shminer (wiki Offline): the Z-Fighters keep fighting on the floor you left, as if you'd stayed there the whole
  // time (no going down floors), crits at their average, parts x0.92. Chest meters don't move; instead 0.3 Item
  // chests and 0.1 SUPER chests per hour, randomly rounded. Rare drops (cards) roll once for everything done.
  // Technique cooldowns run down; buffs either run down and help (opt.offBuffs) or wait for you.
  function offline(S, secs) {
    if (secs >= 60) { S.formOn = 0; S.ki = TUNE.kiMax + b0(bonus(S), 'kiMax'); } // forms don't run while you're away; you come back with full Ki
    const C = calc(S);
    const e = Math.max(0, Math.min(secs, C.offlineCap));
    const out = { secs: e, parts: {}, xp: 0, floors: 0, kills: 0, chests: { item: 0, super: 0 }, capped: secs > C.offlineCap };
    if (e < 60) return out;
    techTick(S, C, e, 1);
    freebieTick(S, null, C, e);
    let t = e;
    if (S.opt.offBuffs !== false) {
      t += Math.min(e, S.buffs.chamber || 0); // x2 speed for its remaining time
      for (const k of Object.keys(S.buffs)) { S.buffs[k] -= e; if (S.buffs[k] <= 0) delete S.buffs[k]; }
    }
    t *= C.offlineMult * (PLANETS[planetOf(S.floor)].speed || 1);
    // chests by the hour
    const hrs = e / 3600;
    if (has(S, 'itemChests')) { const c = sround(hrs * TUNE.offItemPerH * C.offChestX); S.chests.item += c; out.chests.item = c; }
    if (has(S, 'superChests')) { const c = sround(hrs * TUNE.offSuperPerH * C.offChestX); S.chests.super += c; out.chests.super = c; }
    if (!has(S, 'companions')) return out;
    const odds = {};
    const addOdds = (id, n) => { if (CARD[id] && !S.cards[id]) odds[id] = (odds[id] || 0) + CARD[id].p * n; };
    const pool = floorPool(S.floor);
    let perKill = 0;
    for (const [m, w] of pool) {
      let dps = 0;
      for (const h of HELPERS) if (cl(S, h.id)) {
        const hs = helperStats(S, C, h), crit = Math.min(1, hs.crit);
        dps += (effDmg(hs.dmg, machArmor(m)) * (1 + crit * (2 * C.critDmg - 1)) * hs.shots) / hs.every; // 1 + p(m - 1)
      }
      if (MODS[m] && MODS[m].crit) dps = 0; // crit-only machines: the Z-Fighters' average hit doesn't count
      if (MODS[m] && MODS[m].dmg) dps *= MODS[m].dmg;
      perKill = dps > 0 ? perKill + w * (machHp(m) / dps) : Infinity;
    }
    if (isFinite(perKill) && perKill > 0) {
      const rate = 1 / (perKill + C.spawn / C.maxNodes); // fighting time plus the pause between waves
      const kills = Math.floor(rate * t);
      for (const [m, w] of pool) {
        const n = Math.round(kills * w);
        if (n <= 0) continue;
        const id = MACHINES[m].id, q = Math.round(n * C.yieldMult * floorMult(S, C) * TUNE.offlineEff);
        S.parts[id] = (S.parts[id] || 0) + q;
        S.seen[id] = 1;
        S.run.got[id] = (S.run.got[id] || 0) + q;
        out.parts[id] = (out.parts[id] || 0) + q;
        addOdds('m' + m, q);
        out.xp += n * machXp(m) * 0.2; // Power Level mostly comes from your own training
      }
      out.kills = kills;
      S.stats.kills += kills; S.run.kills += kills;
    }
    for (const h of HELPERS) if (cl(S, h.id)) { const hs = helperStats(S, C, h); addOdds('f_' + h.id, (t / hs.every) * hs.shots); }
    out.cards = [];
    if (has(S, 'cards')) for (const id of Object.keys(odds)) if (Math.random() < odds[id] && cardGive(S, null, id)) out.cards.push(id);
    if (out.xp) addXp(S, null, out.xp);
    return out;
  }

  // ------------------------------------------------------------------ numbers
  const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  function fmt(n) {
    if (!isFinite(n)) return '0';
    const neg = n < 0; n = Math.abs(n);
    let s;
    if (n < 1000) s = n < 1 && n > 0 ? n.toFixed(2) : n < 10 && n % 1 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.floor(n));
    else {
      const k = Math.floor(Math.log10(n) / 3);
      if (k >= SUF.length) s = n.toExponential(2).replace('+', '');
      else { const v = n / Math.pow(1000, k); s = (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v)) + SUF[k]; }
    }
    return (neg ? '-' : '') + s;
  }
  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ':' + String(x).padStart(2, '0');
  }

  return {
    VERSION, SAVE_KEY, TUNE, PLANETS, REGIONS, SPRITES, PAINT, MARK, MACHINES, MACH, MAX_FLOOR, UNLOCKS, UPS, UP_KEYS, ZK, ZK_TIERS, WORKSHOP, RARITIES, SUPER, SUPERBY,
    wsMax, skillReady, skillLinked, SKILL_ROWS_N, giveRelic, relicOpen, claimFreebie, packZk, STORE, techCharges, SKILLS, SKILLBY, WISHES, HELPERS, HELPER, COMP_UPS, TECHS, TECH_KEYS, ITEMS, ITEM_KEYS, BUFF_MAX, ITEM_W, KEEP,
    machHp, machArmor, partValue, machXp, xpNext, regionOf, planetOf, floorPool, has, unlockAt, levelCap, effDmg, monoHp, monoArmor, floorNeed,
    CRIT_TIERS, critEff, critSplit, critMult, rollCrit, itemPrice, helperStats, traitVal, compUpCost, zkCost, zkTierOpen, wsOpen, wsCost, skillRowAt, skillRowOpen, skillParent, techOpen, techReady,
    newState, migrate, calc, bonus, planetsOpen, upCost, canAfford, partReachable, newWorld, spawnNode, tick, canDescend, setFloor,
    floorsFor, farmFloor, useTech, buyUp, buyWs, sell, refine, hire, upHelper, buyItem, useItem, openChests, catchBulma,
    monoReady, monoReward, startMono, quitMono, buySkill, buyStore, checkWishes, zenkaiGain, zenkai, buyZk,
    goalsFor, goalReward, claimGoal, offline, fmt, fmtTime, zpZeni, zpCost, zpMax, buyZp,
    FIGHTERS, FORM_TIERS, fighterOf, formLook, formOpen, formsOpenTop, transform, selectForm, helperView,
    CT_UPS, CT_BY, ctOpen, ctMax, ctUpCost, ctCurrent, ctDeliver, ctReroll, buyCt,
    CARDS, CARD, CARD_KINDS, CARD_PERK, cardVal, transformCost, transformCard, cardCount,
    BEAM_UPS, BEAM_KEYS, BEAM_LOOKS, BEAM_LOOK, beamCost, buyBeam, setWeapon, lookOwned, beamLookOf, setBeamLook, beamRays,
    MODS, ORE_BAR, ORE_FLOORS, REGION_FLOORS, floorMult, ratioOf, refineAvg, upMax, upOpen, pickDmg, zkUnlocked, zkUnlockCost, zkNextLocked, unlockZk
  };
})();
if (typeof module !== 'undefined') module.exports = IdleCore;
