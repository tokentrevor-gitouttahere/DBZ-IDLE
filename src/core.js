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
    yieldBase: 2, fighterYield: 0.1, // parts per machine: the wiki's base x2, +10% per hired Z-Fighter (ours)
    constructBarK: 0.1, // bar prices in Construct, x the wiki's (1 = exactly the wiki). 0.1 because our parts income is far below the wiki's (no drones): sim puts Namek at ~4-5 days
    // Shminer's base pickaxe stats aren't on the wiki as text; these set ours (tuned with the sim)
    discK: 8, // Ki Power damage = (level + 1)(level + 2) / 2 x discK
    bulmaMin: 1200, bulmaMax: 1200, bulmaStay: 9, bulmaBank: 3 // Loot Bulma (the wiki's Lootbug): seconds between visits (20 minutes), seconds on screen, base banked visits (ours)
  };

  // ------------------------------------------------------------------ world tables
  // Shminer's worlds (wiki Floors): World 1 = floors 1-42 (Earth), World 2 = floors 43-72 (Namek).
  // clear: floor clears needed to go down = floor x this (wiki Floor Clear Requirement)
  const PLANETS = [
    { id: 'earth', name: 'Earth', short: 'EARTH', gate: 0, from: 1, to: 42, clear: 5 },
    { id: 'namek', name: 'Namek', short: 'NAMEK', monument: true, from: 43, to: 72, clear: 15 }, // opens when its Monument is built (Construct)
    // World 3: game speed -30% on the whole planet (wiki); opens with its Monument
    { id: 'sadala', name: 'Planet Sadala', short: 'SADALA', monument: true, from: 73, to: 102, clear: 35, speed: 0.7 }
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
    41: { rbx: 0.5, txt: 'Rainbow multi x0.5' }, 44: { gold: 0.5, txt: 'Golden floor chance 50%' }, 45: { speed: 0.75, txt: 'Game speed -25%' }, 54: { rbx: 0.5, txt: 'Rainbow multi x0.5' }, 65: { rbx: 0.4, txt: 'Rainbow multi x0.4' },
    // World 3 (Sadala). Rainbow-multi modifiers wait for rainbow ores.
    46: { txt: 'Health +600%' }, 47: { crit: 3, txt: 'ULTRA crit+ only' }, 48: { gold: 0.5, txt: 'Golden floor chance 50%' }, 49: { txt: 'Health +800%' },
    50: { crit: 3, txt: 'ULTRA crit+ only' }, 51: { techCd: 0.3, txt: 'Technique recharge x0.3' }, 52: { gold: 0.45, txt: 'Golden floor chance 45%' }, 53: { dmg: 0.15, txt: 'Damage -85%' },
    55: { crit: 7, txt: 'OMEGA crit+ only' }, 56: { gold: 0.4, txt: 'Golden floor chance 40%' }, 57: { speed: 0.75, txt: 'Game speed -25%' }, 58: { speed: 0.75, txt: 'Game speed -25%' },
    59: { gold: 0.45, txt: 'Golden floor chance 45%' }, 60: { crit: 7, txt: 'OMEGA crit+ only' }, 61: { txt: 'Health +800%' }, 62: { speed: 0.75, txt: 'Game speed -25%' },
    63: { txt: 'Health +800%' }, 64: { gold: 0.4, txt: 'Golden floor chance 40%' } };
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
    { n: 10, id: 'cards', name: 'Cards', desc: 'Cards drop from machines, alloy, Techniques, Veins and more. Gild them for a bigger effect.' },
    { n: 17, id: 'pets', name: 'Pets', desc: 'Buy Pets with Rainbow Capsules. Each levels up by chance as you play and gives permanent bonuses.' },
    { n: 23, id: 'stars', name: 'Stargazing', desc: 'Stars appear on certain floors. Catch them and level each Star for permanent bonuses. Upgrade the Telescope with Veins.' },
    { n: 10, id: 'challenges', name: 'Challenges', desc: 'Tasks that pay Challenge Coins, which buy permanent upgrades.' },
    { n: 19, id: 'construct', name: 'Construct', desc: 'Research Veins, build Statues, and build the Monuments that open Planet Namek (floors 43-72) and Planet Sadala (floors 73-102, everything runs 30% slower there).' }
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
  // Form upgrades (DISC sheet, FORMS tab): brand new in our game (not in Shminer), so Zeni only for now. They only work
  // while you are transformed; reset by Zenkai (S.fup). per: bonus a level. Price: the DISC rule (base x N, then 1.3^(N-10) x N).
  const FORM_UPS = {
    fdmg: { name: 'Form Power', desc: 'Disc damage while transformed', per: 0.1, max: 50, base: 40 },
    fsize: { name: 'Form Size', desc: 'Disc size while transformed', per: 0.05, max: 30, base: 30 },
    fspin: { name: 'Form Speed', desc: 'Spin rate while transformed', per: 0.04, max: 30, base: 50 },
    fcrit: { name: 'Form Crit', desc: 'Disc crit chance while transformed', per: 0.01, max: 30, base: 60 },
    fki: { name: 'Form Efficiency', desc: 'Less Ki drained by your form', per: 0.03, max: 20, base: 120 }
  };
  const FORM_KEYS = Object.keys(FORM_UPS);
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
    { id: 'w_chain', name: 'Hellzone Orbs', desc: '+1 hit from every Hellzone Grenade', fx: [], max: 26, mono: 2, bars: [[3, 125], [4, 100], [5, 75]] },
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
    // Shminer's Golden Ore Bundle (a paid Value Pack there; its lasting perks, earned here)
    { id: 'goldbundle', name: 'Golden Ore Bundle', desc: '+3% chance a machine spawns golden (x3 parts), x1.25 golden machine parts', fx: [['goldenOreCh', 0.03], ['goldenOreXPct', 0.25]], max: 1, cost: 3000 },
    // ours
    { id: 'bugcap', name: 'Banked Loot Bulma Cap', desc: '+1 Loot Bulma visit banked', fx: [['bugBank', 1]], max: 5, cost: 120, gem: true },
    { id: 'buggold', name: 'Golden Loot Bulma', desc: '+10% chance Loot Bulma visits golden (her Capsule reward is free)', fx: [['bugGold', 0.1]], max: 5, cost: 200, gem: true },
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
    ['poly', 17, 1, 'This Is Gonna Take A While..', 'Unlocks Polychrome cards: a Gilded card turns Polychrome with 10 Polychrome Shards, which drop like cards', [], 40, 26],
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
    hell: { name: 'Hellzone Grenade', short: 'HELL', cd: 60, dmg: 1, col: '#8cf07a', desc: 'Ki orbs hit every machine 5 times, 1.25s apart (more hits with the Workshop).' },
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
  const newSg = () => ({ tel: 0, up: {}, su: {}, lv: {}, n: {}, ss: 0 }); // Stargazing: telescope, upgrades, Star levels, Star counts, Super Stars
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
      bulma: { next: now + 90 * 1000, bank: 0, offers: [] },
      goals: { day: '', done: 0, seq: 0, list: [] },
      seen: { m0: 1 },
      stats: { kills: 0, dmg: 0, techs: 0, play: 0, parts: 0, zeni: 0, monoWins: 0, monoTries: 0, chests: 0, supers: 0, bulma: 0, capsEarned: 0 },
      opt: { reduce: false, offBuffs: true },
      // fighter: 'goku' | 'vegeta' (null until picked at the start). formSel: the step the FORM button uses; formOn: the step you're in now
      fighter: null, ki: TUNE.kiMax, formSel: 1, formOn: 0,
      // Ki Beam: weapon is what holding the field fires ('disc' | 'beam'); beamLook '' = your fighter's own beam;
      // bup: beam upgrades (this run)
      weapon: 'disc', beamLook: '', bup: {}, fup: {},
      // Z points for Z-Fighters (kept through Zenkai); zpBought: every point ever bought (sets the price)
      zp: 0, zpBought: 0,
      // Contracts (this run) and Cards (kept)
      ct: newCt(), cards: {}, shards: {}, cardV: 2, sg: newSg(), pets: { have: {}, skin: {} }, gifts: 0, vp: {},
      freebie: { n: 0, p: 0 }, bits: 0, // Freebie Packs banked, progress (s) to the next
      cons: newCons(), // Construct: veins, research, statues, monuments (kept through Zenkai)
      chal: newChal() // Challenges: done, coins, bought levels and the counters they read (kept through Zenkai)
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
    const hadCons = !!S.cons;
    const oldCards = S.cardV !== 2; // the wiki card system replaced the old one
    const base = newState(now);
    for (const k of Object.keys(base)) if (S[k] === undefined) S[k] = base[k];
    // saves from before Construct keep the planets they could already reach
    if (!hadCons) { if (S.mono.tier >= 10) S.cons.monu.namek = 1; if (S.mono.tier >= 20) S.cons.monu.sadala = 1; }
    for (const k of ['mono', 'zenkai', 'goals', 'stats', 'chests', 'meter', 'opt', 'bulma']) S[k] = Object.assign({}, base[k], S[k]);
    S.run = Object.assign(newRun(now), S.run);
    S.sg = Object.assign(newSg(), S.sg);
    S.chal = Object.assign({ xdone: {}, xcoins: 0, xbuy: {} }, S.chal);
    if (oldCards) { S.cards = {}; S.shards = {}; S.cardV = 2; }
    S.formOn = 0; // you load in base form
    S.ct = Object.assign(newCt(), S.ct);
    return S;
  }

  // ------------------------------------------------------------------ derived numbers
  const lv = (S, k) => S.up[k] || 0;
  const planetsOpen = (S) => PLANETS.filter((p) => !p.monument || (S.cons && S.cons.monu[p.id])).length;
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
    if (S.cons) for (const st of STATUES) { const t = statueTier(S, st.id); if (t) add(st.fx[t - 1], 1); } // Statues (each at its best tier)
    if (S.sg) sgBonus(S, add);
    if (S.pets) petBonus(S, add);
    if (S.vp) for (const v of VALUE_PACKS) if (S.vp[v.id]) add(v.fx, 1);
    if (S.chal) for (const r of CHAL_REWARDS) add(r.fx, S.chal.buy[r.id] || 0); // Challenge rewards
    if (S.chal) for (const r of CHAL_XREWARDS) add(r.fx, S.chal.xbuy[r.id] || 0);
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
    const cards = S.cards ? cardCount(S)[2] : 0;
    const chalN = S.chal ? Object.keys(S.chal.done).length : 0, skillN = S.skills ? Object.values(S.skills).filter(Boolean).length : 0;
    const basePower = pickDmg(p) * TUNE.discK * (1 + b0(B, 'discPct') + b0(B, 'discPerCt') * ctDone + b0(B, 'discPerCard') * cards + b0(B, 'discPerRelic') * ((S.stats && S.stats.supers) || 0) + b0(B, 'discPerChal') * chalN + b0(B, 'discPerMono') * S.mono.tier + b0(B, 'discPerSkill') * skillN) * b1(B, 'discX') * mulOf(B, 'discM');
    const formMult = (S.formOn > 0 && FORM_TIERS[S.formOn] ? FORM_TIERS[S.formOn].mult : 1) * (1 + FORM_UPS.fdmg.per * flvOn(S, 'fdmg'));
    const power = basePower * (1 + (f.weights > 0 ? 0.3 : 0) + (f.gravity > 0 ? 1 : 0)) * allDmg * formMult; // Rock Cake +30%, Primal Meat +100%
    const cap = b0(B, 'upCap');
    return {
      B, basePower, power, allDmg, formMult, upCap: cap,
      kiMax: TUNE.kiMax + b0(B, 'kiMax'),
      kiRegen: TUNE.kiRegen * (1 + b0(B, 'kiRegenPct')),
      kiDrain: Math.max(0.3, 1 - b0(B, 'kiDrainPct') - FORM_UPS.fki.per * flv(S, 'fki')),
      spin: 4 * (1 + b0(B, 'spinPct') + FORM_UPS.fspin.per * flvOn(S, 'fspin')) * (f.turbo > 0 ? 1.2 : 1),
      radius: 12 * (1 + b0(B, 'sizePct') + FORM_UPS.fsize.per * flvOn(S, 'fsize')) * (f.discap > 0 ? 1.25 : 1),
      // crit tiers (Shminer): each has its own chance; a hit takes the best tier it rolls
      crit: Math.min(1, 0.05 + b0(B, 'critCh') + FORM_UPS.fcrit.per * flvOn(S, 'fcrit') + (f.scouter > 0 ? 0.1 : 0) + (f.blessing > 0 ? 0.25 : 0)),
      superCh: b0(B, 'superCh'), ultraCh: b0(B, 'ultraCh'), omegaCh: b0(B, 'omegaCh'),
      critDmg: 1 + b0(B, 'critDmg') + (f.pole > 0 ? 0.3 : 0) + (f.blessing > 0 ? 0.25 : 0),
      superDmg: 1 + b0(B, 'superDmg'),
      techCrit: 0.05 + b0(B, 'techCritCh'), techSuperCh: b0(B, 'techSuperCh'), techUltraCh: b0(B, 'techUltraCh'), techCritDmg: 1 + b0(B, 'techCritDmg'),
      compCrit: b0(B, 'compCritCh'),
      maxNodes: 10 + b0(B, 'fieldAdd'), // Shminer: 10 machines a screen
      spawn: TUNE.spawnEvery / (1 + b0(B, 'spawnPct')), // seconds per machine while below the cap
      techMult: TUNE.techBase * (1 + b0(B, 'techPct') + b0(B, 'techPerCt') * ctDone) * mulOf(B, 'techM') * (f.ritual > 0 ? 3 : 1) * (1 + b0(B, 'techAll')),
      techCd: Math.max(0.25, 1 - b0(B, 'techCdPct')) / (1 + b0(B, 'techRech')) / (f.ritual > 0 ? 2 : 1),
      freeTech: b0(B, 'freeTech'),
      techCap: Math.floor((TUNE.techCap + b0(B, 'techCapAdd') + (S.techCapPlus || 0)) * (1 + b0(B, 'techCapPct'))),
      basicX: 1 + 0.5 * wsl(S, 'w_basic'), chainN: 5 + wsl(S, 'w_chain') + b0(B, 'chainAdd'), expX: 2 + 0.5 * wsl(S, 'w_expx'), megaAdd: 5 * wsl(S, 'w_mega'),
      wishN: 20 + wsl(S, 'w_d20x'), cherry3: 0.005 * wsl(S, 'w_cherry3'), infScale: 0.01 + 0.001 * wsl(S, 'w_infx'),
      transX: 1 + wsl(S, 'w_trans') + b0(B, 'transAdd'), megaMark: wsl(S, 'w_megamark'), transFlare: wsl(S, 'w_transbop') ? 0.25 : 0,
      ratioCut: Math.min(0.6, 0.1 * b0(B, 'refineMinus') + b0(B, 'ratioCutPct')), // Smart Refining: -10% parts per alloy
      valueMult: (1 + b0(B, 'valuePct')) * b1(B, 'valueX'),
      xpMult: (1 + b0(B, 'xpPct')) * (f.rice > 0 ? 3 : 1) * b1(B, 'xpMono') * b1(B, 'xpX'),
      yieldMult: TUNE.yieldBase * (1 + b0(B, 'yieldPct')) * b1(B, 'yieldX') * (1 + TUNE.fighterYield * Object.keys(S.helpers).length), // base x2 (wiki); each hired Z-Fighter adds 10% (ours)
      doubleOre: b0(B, 'doubleOre'),
      tripleMach: b0(B, 'tripleMach') + (f.radar > 0 ? 0.25 : 0),
      chestMult: (1 + b0(B, 'chestPct')) * b1(B, 'chestX'),
      compMult: (1 + b0(B, 'compPct')) * allDmg,
      compSpd: (1 + b0(B, 'compSpdPct')) * (f.water > 0 ? 1.5 : 1),
      speed: (f.chamber > 0 ? 2 : 1) * (1 + b0(B, 'speedPct')),
      floorReq: Math.max(0.3, 1 - b0(B, 'floorReqPct') - cardVal(S, 'x_zenkai')),
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
      zkMult: (1 + b0(B, 'zkPct')) * b1(B, 'zkMono') * b1(B, 'zkX'),
      autoTech: b0(B, 'autoTech') > 0,
      hellLen: 10 + b0(B, 'hellLen'),
      hellRate: b1(B, 'hellRateX'),
      flareBonus: 2 + wsl(S, 'w_plentyx') + b0(B, 'flareAdd'), // Bomb of Plenty: x2 parts, +1x a Workshop level
      spiritX: b1(B, 'spiritX'),
      kaioCaps: 0.005 * b1(B, 'kaioCapsX'),
      bulmaEvery: 1 / (1 + b0(B, 'bulmaPct')),
      bulmaLoot: (1 + b0(B, 'bulmaLoot')) * (1 + cardVal(S, 'x_bulma')),
      bulmaTriple: b0(B, 'bugTriple'), bulmaGold: b0(B, 'bugGold') + cardVal(S, 'x_golbug'), bulmaBank: TUNE.bulmaBank + b0(B, 'bugBank'),
      itemExtra: b0(B, 'itemExtra'),
      multiAdd: b0(B, 'multiAdd'),
      veinSpawn: 1 + b0(B, 'veinSpawnPct'), veinInc: (1 + b0(B, 'veinIncPct')) * b1(B, 'veinIncX'),
      goldenVeinCh: b0(B, 'goldenVeinCh'), rainbowVeinCh: b0(B, 'rainbowVeinCh'), goldenVeinX: 5 * (1 + b0(B, 'goldenVeinXPct')),
      gemCap: b0(B, 'gemCap'), freebieBit: TUNE.freebieBit + b0(B, 'freebieBit'),
      startFloor: 1 + b0(B, 'startFloor'),
      // golden machines: x3 parts (wiki base) and up; rainbow ones roll only on golden ones (no base given: x1 + bonuses)
      goldenOreCh: b0(B, 'goldenOreCh'), goldenOreX: (3 + b0(B, 'goldenOreXAdd')) * (1 + b0(B, 'goldenOreXPct') + cardVal(S, 'x_golden')),
      rainbowOreCh: b0(B, 'rainbowOreCh'), rainbowOreX: 1 + b0(B, 'rainbowOreXAdd'),
      goldenCh: b0(B, 'goldenCh'), rainbowCh: b0(B, 'rainbowCh'), galacticCh: b0(B, 'galacticCh'), prismCh: b0(B, 'prismCh'),
      goldenX: (5 + b0(B, 'goldenX')) * (1 + b0(B, 'goldenXPct')) * (1 + cardVal(S, 'x_w1')), rainbowX: (50 + b0(B, 'rainbowX')) * (1 + b0(B, 'rainbowXPct')) * (1 + cardVal(S, 'x_w2')), galacticX: (10 + b0(B, 'galacticX')) * (1 + cardVal(S, 'x_w3')), prismX: 1 + b0(B, 'prismX'),
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
  const flv = (S, k) => (S.fup && S.fup[k]) || 0;
  const flvOn = (S, k) => (S.formOn > 0 ? flv(S, k) : 0); // only while transformed
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
    return { mode: 'field', nodes: [], shots: [], dots: [], spawnT: 0, discT: 0, helperT: {}, events: [], bounds: { x0: 4, y0: 4, x1: 120, y1: 200 }, mono: null, nextId: 1, bulma: null, stars: [], slow: 0, beamT: 0, beamOn: false, beamOut: false, beamFrom: null };
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
      const gold = C.goldenOreCh > 0 && Math.random() < C.goldenOreCh;
      const n = { id: W.nextId++, m: m.id, t: m.t, x, y, r: R, hp, max: hp, armor: machArmor(m.t), marks: {}, flash: 0, born: 0, face: Math.random() < 0.5 ? 1 : -1, ph: Math.random() * 10, triple: C.tripleMach > 0 && Math.random() < C.tripleMach, gold, rainbow: gold && C.rainbowOreCh > 0 && Math.random() < C.rainbowOreCh, vein: rollVein(S, C) };
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
    const rbx = n.rainbow ? C.rainbowOreX * ((MODS[n.t] && MODS[n.t].rbx) || 1) * (1 + cardVal(S, 'x_rainbow')) : 1;
    if (n.gold) { cardRoll(S, W, 'x_golden', 1); petRoll(S, W, 'nagini', 1); }
    if (n.rainbow) cardRoll(S, W, 'x_rainbow', 1);
    let qty = Math.max(1, sround(C.yieldMult * floorMult(S, C) * (n.gold ? C.goldenOreX : 1) * rbx * (n.triple ? 3 : 1) * (S.buffs.bug_ore > 0 ? 2 : 1) * (n.marks.flare ? C.flareBonus : 1) * (1 + (n.marks.pride || 0)) * (1 + cardVal(S, 'm' + m.t))));
    if (C.doubleOre && Math.random() < C.doubleOre) qty *= 2;
    const alloy = !!n.marks.smelt;
    S.parts[m.id] = (S.parts[m.id] || 0) + qty;
    chalAdd(S, 'mined', m.id, qty);
    if (n.gold) S.chal.c.goldMined = (S.chal.c.goldMined || 0) + 1;
    if (n.vein && n.vein.rbw) chalAdd(S, 'rvein', n.vein.z, 1);
    if (alloy) { const bars = Math.max(1, sround(qty * C.transX * C.barOut)); S.alloy[m.id] = (S.alloy[m.id] || 0) + bars; chalAdd(S, 'craft', m.id, bars); chalAdd(S, 'smelt', m.id, bars); } // Smelter: bars as well
    S.seen[m.id] = 1;
    const xp = machXp(m.t) * C.xpMult * (n.marks.kaio ? C.expX : 1);
    cardRoll(S, W, (alloy ? 'a' : 'm') + m.t, qty);
    S.stats.kills++; S.stats.parts += qty;
    S.run.kills++; S.run.got[m.id] = (S.run.got[m.id] || 0) + qty;
    let caps = 0;
    if (n.marks.kaio && Math.random() < C.kaioCaps) { caps = Math.max(1, sround(C.capsMult)); addCaps(S, caps); }
    goalHit(S, 'kills', null, 1);
    goalHit(S, 'mine', m.id, qty);
    if (n.vein) { // a vein node drops its zone's Veins on top of its parts (floor multipliers don't apply)
      const amt = sround(C.veinInc * (n.vein.gold ? C.goldenVeinX * (1 + cardVal(S, 'x_gvein')) : 1) * (n.vein.rbw ? 20 * (1 + cardVal(S, 'x_rvein')) : 1) * (1 + cardVal(S, 'v_' + n.vein.z)));
      cardRoll(S, W, 'v_' + n.vein.z, amt);
      petRoll(S, W, 'duck', 1);
      if (n.vein.gold) petRoll(S, W, 'totem', 1);
      if (VEIN[n.vein.z].from >= 73) petRoll(S, W, 'dino', 1);
      if (n.vein.gold) cardRoll(S, W, 'x_gvein', 1);
      if (n.vein.rbw) cardRoll(S, W, 'x_rvein', 1);
      S.cons.veins[n.vein.z] = (S.cons.veins[n.vein.z] || 0) + amt;
      chalAdd(S, 'veins', n.vein.z, amt);
      emit(W, { type: 'vein', x: n.x, y: n.y - n.r * 1.6, amt, name: VEIN[n.vein.z].name, gold: n.vein.gold, rbw: n.vein.rbw });
    }
    W.nodes = W.nodes.filter((x) => x !== n);
    emit(W, { type: 'kill', x: n.x, y: n.y, m: m.id, face: n.face, qty, alloy, caps });
    addXp(S, W, xp);
  }
  function floorCleared(S, W, C) {
    S.floorKills++; // counts floor clears
    if (S.ftype && S.ftype.rainbow) petRoll(S, W, 'leprechaun', 1);
    goalHit(S, 'clear', null, 1);
    if (S.sg.tel > 0 && has(S, 'stars')) sgClear(S, W);
    if (!S.stay && S.floorKills >= floorNeed(S, S.floor, C)) descend(S, W);
  }
  // special floors (wiki Floors): Golden x5 parts, Rainbow x50, Galactic (needs Rainbow) x10, Prismatic (needs
  // Galactic) x1; they stack. Nothing gives these chances yet: the system waits for Relics / items / stars.
  function rollFloorType(S, C) {
    C = C || calc(S);
    let gold = C.goldenCh;
    for (const [t] of floorPool(S.floor)) if (MODS[t] && MODS[t].gold) gold = Math.max(gold, MODS[t].gold); // "Golden floor = 50%" sets it
    const rb = Math.random() < C.rainbowCh, gal = rb && Math.random() < C.galacticCh;
    S.ftype = { gold: Math.random() < gold, rainbow: rb, galactic: gal, prism: gal && Math.random() < C.prismCh };
    if (S.ftype.gold) petRoll(S, null, 'penguin', 1);
    if (S.ftype.galactic) S.chal.c.galFloors = (S.chal.c.galFloors || 0) + 1;
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
    if (S.floor >= 40 && !S.run.discBuys) S.chal.c.noUp40 = 1;
    if (S.floor >= 46 && !S.run.discBuys) S.chal.c.noUp46 = 1;
    rollFloorType(S);
    const nw = ORE_FLOORS.findIndex(([a]) => a === S.floor);
    if (W) emit(W, { type: 'floor', floor: S.floor, region: REGION_FLOORS.some(([a]) => a === S.floor) ? REGIONS[regionOf(S.floor)] : null, first, newMach: first && nw > 0 ? nw : null, ftype: S.ftype });
    if (W) cardRoll(S, W, 'x_w' + (planetOf(S.floor) + 1), 1); // offline floors add to the one offline roll instead
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
      if (S.level >= 100) petRoll(S, W, 'happybot', 1);
      S.stats.bestLevel = Math.max(S.stats.bestLevel || 0, S.level);
      if (W) emit(W, { type: 'level', level: S.level });
    }
  }
  // a disc hit: [base damage, crit tier]. The crit multiplier goes on after armor (Shminer)
  function discHit(C) { return [C.power, discTier(C)]; }

  // input: { down, x, y } in game px
  function tick(S, W, dt, input, now) {
    dt = Math.min(dt, 0.25);
    if (petQ.length) for (const e of petQ.splice(0)) emit(W, e);
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
    // companions. Shots spread out: each one goes to the machine with the fewest shots already on the way (from
    // anyone), so no machine gets two unless there are more shots than machines. When there is nothing to shoot the
    // attack bar waits full (ready) instead of resetting, so it never jumps back; at very high attack speeds up to
    // 4 volleys a frame are thrown.
    if (has(S, 'companions')) {
      const incoming = new Map();
      for (const sh of W.shots) if (!sh.done && sh.target.node != null) incoming.set(sh.target.node, (incoming.get(sh.target.node) || 0) + 1);
      const pickNode = () => {
        let best = [], min = Infinity;
        for (const n of W.nodes) { const c = incoming.get(n.id) || 0; if (c < min) { min = c; best = [n]; } else if (c === min) best.push(n); }
        const n = best[Math.floor(Math.random() * best.length)];
        incoming.set(n.id, min + 1);
        return n;
      };
      for (const h of HELPERS) {
        if (!cl(S, h.id)) continue;
        const hs = helperStats(S, C, h);
        if (W.helperT[h.id] === undefined) W.helperT[h.id] = Math.random() * hs.every;
        W.helperT[h.id] += sdt;
        let volleys = 0;
        while (W.helperT[h.id] >= hs.every && volleys < 4) {
          const inMono = W.mode === 'mono' && W.mono;
          if (!inMono && !W.nodes.length) { W.helperT[h.id] = hs.every; break; } // nothing to hit: wait, full
          W.helperT[h.id] -= hs.every;
          volleys++;
          let fired = 0;
          for (let k = 0; k < hs.shots; k++) {
            let target;
            if (inMono) target = { mono: true, x: W.mono.x + (Math.random() - 0.5) * W.mono.w * 0.6, y: W.mono.y - W.mono.h * (0.25 + Math.random() * 0.5) };
            else { const n = pickNode(); target = { node: n.id, x: n.x, y: n.y - n.r * 0.7 }; }
            const crit = rollCrit(hs.crit);
            // a barrage spreads its shots over half a second at most; alt: Goku throwing in Vegeta's slot
            const hv = helperView(S, h);
            W.shots.push({ helper: h.id, alt: !!hv.alt, target, t: -k * Math.min(0.08, 0.5 / hs.shots), dur: 0.45, dmg: hs.dmg * critMult(crit, C), crit, col: hv.col, trait: h.trait.key, tv: hs.trait, pride: h.pride || 0 });
            fired++;
            // now and then (always on a SUPER crit or better) they shout their move
            W.shoutT = W.shoutT || {};
            if ((crit >= 2 || Math.random() < 0.05) && S.stats.play - (W.shoutT[h.id] || -99) > 6) { W.shoutT[h.id] = S.stats.play; emit(W, { type: 'shout', helper: h.id, text: hv.moves[Math.floor(Math.random() * hv.moves.length)] }); }
          }
          if (fired) cardRoll(S, W, 'f_' + h.id, fired);
        }
        if (volleys >= 4) W.helperT[h.id] %= hs.every; // faster than we can throw: drop the extra
      }
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
    // Stars drift across the field until they are tapped or leave
    if (W.stars.length) { for (const st of W.stars) { st.t += dt; st.x += st.vx * dt; st.y += Math.sin(st.t * 1.3 + st.ph) * 3 * dt; } W.stars = W.stars.filter((st) => st.x < W.bounds.x1 + 14); }
    // Loot Bulma flies by now and then
    if (W.mode === 'field') {
      if (!W.bulma && now >= S.bulma.next) {
        const B = W.bounds;
        W.bulma = { x: B.x0 - 14, y: B.y0 + 16 + Math.random() * Math.max(10, (B.y1 - B.y0) * 0.5), vx: (B.x1 - B.x0 + 28) / TUNE.bulmaStay, t: 0, n: Math.random() < C.bulmaTriple ? 3 : 1, gold: Math.random() < C.bulmaGold };
        emit(W, { type: 'bulma' });
      }
      if (W.bulma) {
        W.bulma.t += dt; W.bulma.x += W.bulma.vx * dt;
        if (W.bulma.t > TUNE.bulmaStay) { const n = W.bulma.n; W.bulma = null; S.bulma.next = now + bulmaWait(C); bankBugs(S, C, n, W); } // a missed visit waits in the bank
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
    if (W.slow >= 1) { W.slow = 0; checkWishes(S, W); trackChal(S, C); checkChallenges(S, W); }
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
      const c = Math.max(1, sround((C.freebieCaps + cardVal(S, 'x_freebie')) * C.capsMult));
      cardRoll(S, W, 'x_freebie', 1);
      addCaps(S, c); got.caps += c; S.chal.c.freebieCaps = (S.chal.c.freebieCaps || 0) + c;
      S.chests.item++; got.item++;
      if (S.mono.tier >= 10 && Math.random() < 0.01) { S.gifts++; got.gifts = (got.gifts || 0) + 1; } // ours: 1% of Freebie Packs hold a Gift
      if (Math.random() < C.freebieSuper) { S.chests.super++; got.super++; }
      // Stonks (skill): 1% each for +200 capsules, +20 Item chests, +10 SUPER chests
      if (C.stonks) { if (Math.random() < C.stonks) { addCaps(S, 200); got.caps += 200; } if (Math.random() < C.stonks) { S.chests.item += 20; got.item += 20; } if (Math.random() < C.stonks) { S.chests.super += 10; got.super += 10; } }
      if (C.freebieRefresh && Math.random() < C.freebieRefresh) F.p = C.freebieEvery; // instant refresh
      if (Math.random() < C.freebieBit) { S.bits++; got.bits++; if (S.bits >= 10) { S.bits -= 10; S.skillPts++; got.sp++; } }
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
      B.t += sdt * techSpd * (S.buffs.bug_tech > 0 ? 10 : 1);
      const cd = TECHS[k].cd * C.techCd;
      while (B.t >= cd && B.c < C.techCap) { B.t -= cd; B.c = Math.min(C.techCap, B.c + 1 + techExtra(cardVal(S, 't_' + k))); }
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
    if (k === 'blast') petRoll(S, W, 'crab', 1);
    chalAdd(S, 'tech', k, 1);
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
    if (key === 'power' && l + 1 > 25) petRoll(S, null, 'dwarf', 1);
    S.run.discBuys++;
    goalHit(S, 'upgrade', null, 1);
    return true;
  }
  const fupCost = (key, l) => ({ zeni: +upPrice(FORM_UPS[key].base, l + 1).toPrecision(3), alloy: [] });
  function buyFormUp(S, key) {
    const l = flv(S, key);
    if (!FORM_UPS[key] || !formsOpenTop(S) || l >= FORM_UPS[key].max) return false;
    const cost = fupCost(key, l);
    if (!canAfford(S, cost)) return false;
    pay(S, cost);
    S.fup[key] = l + 1;
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
    chalAdd(S, 'craft', id, out);
    cardRoll(S, null, 'a' + MACH[id].t, out);
    if (MACH[id].planet === 1) petRoll(S, null, 'axolotl', out);
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
      S.buffs[id] = Math.min(BUFF_MAX, (S.buffs[id] || 0) + I.dur * calc(S).itemDur);
    }
    // the instant items' cards give a chance to keep the item
    S.items[id]--;
    S.run.itemsUsed++;
    S.chal.c.items = (S.chal.c.items || 0) + 1;
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

  // ------------------------------------------------------------------ Construct (Monolith 19): Veins, Statues, Monuments
  // (wiki Veins + Construct). S.cons = { unl: {zone: 1} researched, x2: {zone: 1} spawn research, veins: {zone: n}, st: [tier1 ids,
  // tier2 ids, tier3 ids], monu: {planet: 1} }. Veins never reset. Bars are Capsule Alloy of that ore; gems = Rainbow Capsules.
  // Prices are the wiki's x TUNE.constructBarK for bars. Not built: World 4 (we have 3 worlds) and the World 3 statues.
  function newCons() { return { unl: {}, x2: {}, veins: {}, st: [[], [], []], monu: {} }; }
  const ORE_NAMES = ['Tin', 'Copper', 'Mithril', 'Adamant', 'Runite', 'Citrine', 'Amethyst', 'Topaz', 'Obsidian', 'Demonite', 'VR-Tin', 'VR-Amethyst', 'VR-Demonite', 'VR-ERROR', 'Lunarium', 'Earth-C-137', 'Meteorite', 'Singularity', 'Halium', 'Blasphemite', 'Angelite', 'Elysium', 'Enemite', 'Beepboopium', 'Radion-73', 'Cranium',
    'Lapis', 'Quartz', 'Glacialite', 'Twinklestone', 'Sandcasium', 'Clamite', 'Thunderstone', 'Crabrock', 'Hailstone', 'Frostbite', 'Icebloom', 'Pinguinus', 'Macawrock', 'Cocore', 'Rafflenium', 'Carnivorian', 'Infernite', 'Blood-Onyx', 'Cyrogem', 'Pinnaclite',
    'Omeletite', 'Resinite', 'Impactium', 'Tricerastone', 'Duelysium', 'Arcusite', 'Phalanxite', 'Guardium', 'Cognite', 'Telophite', 'Steamstone', 'Equinine', 'Dynamite', 'Genevium', 'Manhattite', 'Rationium', 'Vaporium', 'Palmite', 'Ransomite', 'MVPD-1988'];
  const barId = (ore) => MACHINES[ORE_NAMES.indexOf(ore)].id;
  const barsOf = (list) => list.map(([ore, n]) => [barId(ore), Math.ceil(n * TUNE.constructBarK)]);
  // [id, our name (the wiki's zone names are in the comment), floors, spawn rarity, Veins needed from the zone before, research bars, spawn-x2 capsules, spawn-x2 bars]
  const VEINS = [
    ['stone', 'West City', 1, 8, 15, 0, [['Adamant', 7.5e6], ['Runite', 7.5e6]], 100, [['Copper', 7.5e6], ['Mithril', 7.5e6]]], // Stone
    ['magma', 'Countryside', 9, 18, 20, 425, [['Obsidian', 925000], ['Demonite', 925000]], 120, [['Amethyst', 11.25e6], ['Topaz', 11.25e6]]], // Magma
    ['virtual', 'Kame Beach', 19, 24, 25, 745, [['VR-Demonite', 2.95e6], ['VR-ERROR', 2.95e6]], 140, [['VR-Tin', 16.85e6], ['VR-Amethyst', 16.85e6]]], // Virtual
    ['space', 'Red Ribbon HQ', 25, 30, 30, 1050, [['Meteorite', 5.85e6], ['Singularity', 5.85e6]], 160, [['Lunarium', 25.25e6], ['Earth-C-137', 25.25e6]]], // Space
    ['cloud', "Dr. Gero's Lab", 31, 36, 35, 1350, [['Angelite', 9.5e6], ['Elysium', 9.5e6]], 180, [['Halium', 37.95e6], ['Blasphemite', 37.95e6]]], // Cloud
    ['atomic', "Gero's Depths", 37, 42, 40, 1850, [['Radion-73', 14.7e6], ['Cranium', 14.7e6]], 200, [['Enemite', 56.85e6], ['Beepboopium', 56.85e6]]], // Atomic
    ['deepsea', 'Namekian Village', 43, 48, 50, 7550, [['Lapis', 82.25e6], ['Quartz', 82.25e6]], 500, [['Glacialite', 85.25e6], ['Twinklestone', 85.25e6]]], // Deep Sea
    ['beach', 'Blue Grass Plains', 49, 54, 50, 11280, [['Sandcasium', 125.5e6], ['Clamite', 125.5e6]], 600, [['Thunderstone', 128.5e6], ['Crabrock', 128.5e6]]], // Beach
    ['valley', 'Ajisa Groves', 55, 60, 50, 16960, [['Hailstone', 195.5e6], ['Frostbite', 195.5e6]], 700, [['Icebloom', 195.5e6], ['Pinguinus', 195.5e6]]], // Valley
    ['jungle', "Frieza's Landing", 61, 66, 50, 385000, [['Macawrock', 2.85e9], ['Cocore', 2.85e9]], 800, [['Rafflenium', 2.9e9], ['Carnivorian', 2.9e9]]], // Jungle
    ['volcano', 'Dying Namek', 67, 72, 50, 585000, [['Infernite', 8.55e9], ['Blood-Onyx', 8.55e9]], 900, [['Cyrogem', 8.75e9], ['Pinnaclite', 8.75e9]]], // Volcano
    ['jurassic', 'Sadala Outskirts', 73, 78, 70, 5.5e6, [['Omeletite', 750e9], ['Resinite', 750e9]], 1500, [['Impactium', 25.5e12], ['Tricerastone', 25.5e12]]], // Jurassic
    ['roman', 'Royal Capital', 79, 84, 70, 20.5e6, [['Duelysium', 7.5e12], ['Arcusite', 7.5e12]], 1600, [['Phalanxite', 125.5e12], ['Guardium', 125.5e12]]], // Roman
    ['industrial', 'Training Grounds', 85, 90, 70, 92.5e6, [['Cognite', 52.5e12], ['Telophite', 52.5e12]], 1700, [['Steamstone', 350.5e12], ['Equinine', 350.5e12]]], // Industrial
    ['warfront', 'Pod Launch Bay', 91, 96, 70, 250e6, [['Dynamite', 5.5e15], ['Genevium', 5.5e15]], 1800, [['Manhattite', 25.5e15], ['Rationium', 25.5e15]]], // Warfront
    ['neon', 'Burning Sadala', 97, 102, 70, 550.5e6, [['Vaporium', 25.12e15], ['Palmite', 25.12e15]], 1900, [['Ransomite', 325.5e15], ['MVPD-1988', 325.5e15]]] // Neon
  ].map(([id, name, from, to, rar, prevVeins, bars, gems, sbars], i) => ({ id, name, from, to, rar, prevVeins, bars, gems, sbars, i }));
  const VEIN = Object.fromEntries(VEINS.map((v) => [v.id, v]));
  const veinZoneOf = (f) => VEINS.find((v) => f >= v.from && f <= v.to) || null;
  // each machine on a screen of this zone has a (spawn multiplier / rarity) / machines chance to be a vein node; the 2x research doubles it
  const veinChance = (S, C, z) => Math.min(1, (C.veinSpawn * (S.cons.x2[z.id] ? 2 : 1) * (S.buffs.bug_vein > 0 ? 3 : 1)) / z.rar / C.maxNodes);
  function rollVein(S, C) {
    const z = veinZoneOf(S.floor);
    if (!z || !S.cons || !S.cons.unl[z.id] || !(Math.random() < veinChance(S, C, z))) return null;
    const gold = Math.random() < C.goldenVeinCh;
    return { z: z.id, gold, rbw: gold && Math.random() < C.rainbowVeinCh };
  }
  // statues: 9, each built in a random order; a statue's bonus is its best tier's (normal, gilded, platinized). Names ours:
  // the wiki's statues are named for their community artists. fx[t] = this tier's effects; txt[t] = what it says.
  const STATUES = [
    { id: 'rhythm', name: 'Statue of Rhythm', fx: [[['discM100', 2], ['veinIncPct', 0.1]], [['discM100', 4], ['veinIncPct', 0.15]], [['discM100', 7], ['veinIncPct', 0.2], ['floorReqPct', 0.25]]],
      txt: ['Disc damage x3, Vein income +10%', 'Disc damage x5, Vein income +15%', 'Disc damage x8, Vein income +20%, floor clears -25%'] },
    { id: 'awareness', name: 'Statue of Awareness', fx: [[['techM100', 2], ['transAdd', 1]], [['techM100', 4], ['transAdd', 2]], [['techM100', 7], ['transAdd', 4], ['techUltraCh', 0.2]]],
      txt: ['Technique damage x3, Smelter alloy +1x', 'Technique damage x5, Smelter alloy +2x', 'Technique damage x8, Smelter alloy +4x, Technique ULTRA crit +20%'] },
    { id: 'slaying', name: 'Statue of Slaying', fx: [[['zkX', 2], ['zkCap', 1]], [['zkX', 3], ['zkCap', 2]], [['zkX', 5], ['zkCap', 3]]],
      txt: ['Zenkai Points x2, +1 cap on Zenkai upgrades', 'Zenkai Points x3, +2 cap', 'Zenkai Points x5, +3 cap'] },
    { id: 'appetite', name: 'Statue of Appetite', fx: [[['techCapPct', 0.3], ['freebieBank', 1]], [['techCapPct', 0.5], ['freebieBank', 2]], [['techCapPct', 0.75], ['freebieBank', 3]]],
      txt: ['Technique capacity x1.3, +1 banked Freebie', 'Technique capacity x1.5, +2 banked Freebies', 'Technique capacity x1.75, +3 banked Freebies'] },
    { id: 'friendship', name: 'Statue of Friendship', fx: [[['freebieCapsAdd', 1], ['goldenXPct', 0.1]], [['freebieCapsAdd', 2], ['goldenXPct', 0.15]], [['freebieCapsAdd', 4], ['goldenXPct', 0.2], ['freebieBit', 0.01]]],
      txt: ['Freebies +1 capsule, Golden floor parts +10%', 'Freebies +2 capsules, Golden floor parts +15%', 'Freebies +4 capsules, Golden floor parts +20%, +1% Skill Bit chance'] },
    { id: 'hygiene', name: 'Statue of Hygiene', fx: [[['wsCap', 2], ['gemCap', 1]], [['wsCap', 3], ['gemCap', 2]], [['wsCap', 4], ['gemCap', 4]]],
      txt: ['+2 cap on Workshop upgrades, +1 on Store upgrades', '+3 Workshop cap, +2 Store cap', '+4 Workshop cap, +4 Store cap'] },
    { id: 'artistry', name: 'Statue of Artistry', fx: [[['rainbowCh', 0.005]], [['rainbowCh', 0.01]], [['rainbowCh', 0.015], ['freebieRefresh', 0.01]]],
      txt: ['Rainbow floor chance +0.5%', 'Rainbow floor chance +1%', 'Rainbow floor chance +1.5%, 1% instant Freebie refresh'] },
    { id: 'randomness', name: 'Statue of Randomness', fx: [[['veinSpawnPct', 0.3], ['goldenVeinCh', 0.03]], [['veinSpawnPct', 0.5], ['goldenVeinCh', 0.05]], [['veinSpawnPct', 0.75], ['goldenVeinCh', 0.1], ['rainbowVeinCh', 0.05]]],
      txt: ['Vein spawn +30%, Golden vein chance +3%', 'Vein spawn +50%, Golden vein chance +5%', 'Vein spawn +75%, Golden vein +10%, Rainbow vein +5%'] },
    { id: 'childhood', name: 'Statue of Childhood', fx: [[['ctCap', 1], ['valuePct', 0.15]], [['ctCap', 2], ['valuePct', 0.2]], [['ctCap', 4], ['valuePct', 0.25], ['rainbowCh', 0.01]]],
      txt: ['+1 cap on Contract upgrades, part sell price +15%', '+2 Contract cap, sell price +20%', '+4 Contract cap, sell price +25%, rainbow floor +1%'] }
  ];
  const STATUE_BY = Object.fromEntries(STATUES.map((x) => [x.id, x]));
  const statueTier = (S, id) => (S.cons.st[2].includes(id) ? 3 : S.cons.st[1].includes(id) ? 2 : S.cons.st[0].includes(id) ? 1 : 0);
  // [vein zone, veins, bars, capsules] for the 1st..9th statue of each tier (wiki Construct)
  const STATUE_COST = [
    [['stone', 500, [['Runite', 10e6]], 300], ['magma', 650, [['Topaz', 14.5e6]], 400], ['virtual', 845, [['VR-ERROR', 21.03e6]], 500], ['space', 1100, [['Singularity', 30.49e6]], 600], ['cloud', 1430, [['Elysium', 44.21e6]], 700],
      ['atomic', 1850, [['Cranium', 64.1e6]], 800], ['stone', 2410, [['Mithril', 92.94e6]], 900], ['virtual', 3130, [['VR-Amethyst', 134.76e6]], 1000], ['atomic', 4070, [['Beepboopium', 195.41e6]], 1100]],
    [['stone', 5300, [['Adamant', 283.34e6]], 1200], ['magma', 6880, [['Obsidian', 410.85e6]], 1300], ['virtual', 8960, [['VR-Demonite', 595.73e6]], 1400], ['space', 11630, [['Meteorite', 863.81e6]], 1500], ['cloud', 15120, [['Angelite', 1.25e9]], 1600],
      ['atomic', 19660, [['Radion-73', 1.82e9]], 1700], ['stone', 25550, [['Copper', 2.63e9]], 1800], ['virtual', 33220, [['VR-Tin', 3.82e9]], 1900], ['atomic', 43190, [['Enemite', 5.54e9]], 2000]],
    [['stone', 1e5, [['Tin', 18e12], ['Copper', 10.8e12], ['Mithril', 7.2e12], ['Adamant', 6.3e12]], 2500], ['magma', 1.5e5, [['Amethyst', 7.8e12], ['Topaz', 6.17e12], ['Obsidian', 5.65e12], ['Demonite', 4.5e12]], 2750],
      ['virtual', 2e5, [['VR-Tin', 6.8e12], ['VR-Amethyst', 5.76e12], ['VR-Demonite', 4.91e12], ['VR-ERROR', 3.86e12]], 3000], ['space', 2.5e5, [['Lunarium', 8.22e12], ['Earth-C-137', 6.97e12], ['Meteorite', 6e12], ['Singularity', 5.22e12]], 3250],
      ['cloud', 3.25e5, [['Halium', 6.36e12], ['Blasphemite', 5.47e12], ['Angelite', 4.92e12], ['Elysium', 4.46e12]], 3500], ['atomic', 4e5, [['Enemite', 4.9e12], ['Beepboopium', 4.09e12], ['Radion-73', 3.5e12], ['Cranium', 3.02e12]], 3750],
      ['deepsea', 5e5, [['Lapis', 3.6e12], ['Quartz', 3.19e12], ['Glacialite', 2.85e12], ['Twinklestone', 2.58e12]], 4000], ['beach', 6.5e5, [['Sandcasium', 3.18e12], ['Clamite', 2.92e12], ['Thunderstone', 2.66e12], ['Crabrock', 2.48e12]], 4250],
      ['valley', 8.5e5, [['Tin', 1e16], ['Frostbite', 3.47e12], ['Icebloom', 3.33e12], ['Pinguinus', 3.08e12]], 4500]]
  ];
  const MONUMENTS = { namek: { name: 'World 2 Monument (Planet Namek)', caps: 2000, veins: [['stone', 2000], ['magma', 2000], ['virtual', 2000]] }, sadala: { name: 'World 3 Monument (Planet Sadala)', caps: 7500, veins: [['valley', 750000], ['jungle', 750000], ['volcano', 750000]], needs: 'namek' } };
  const researchCost = (z) => ({ caps: 0, veins: z.i ? [[VEINS[z.i - 1].id, z.prevVeins]] : [], bars: barsOf(z.bars) });
  const spawnCost = (z) => ({ caps: z.gems, veins: [], bars: barsOf(z.sbars) });
  const statueCost = (S, tier) => { const c = STATUE_COST[tier - 1][S.cons.st[tier - 1].length]; return c ? { caps: c[3], veins: [[c[0], c[1]]], bars: barsOf(c[2]) } : null; };
  const monumentCost = (id) => ({ caps: MONUMENTS[id].caps, veins: MONUMENTS[id].veins, bars: [] });
  const consOk = (S, c) => !!c && S.caps >= (c.caps || 0) && c.veins.every(([z, n]) => (S.cons.veins[z] || 0) >= n) && c.bars.every(([id, n]) => (S.alloy[id] || 0) >= n);
  function consPay(S, c) { S.caps -= c.caps || 0; for (const [z, n] of c.veins) S.cons.veins[z] -= n; for (const [id, n] of c.bars) S.alloy[id] -= n; }
  function researchVein(S, id) {
    const z = VEIN[id];
    if (!has(S, 'construct') || !z || S.cons.unl[id] || (z.i && !S.cons.unl[VEINS[z.i - 1].id])) return false;
    const c = researchCost(z);
    if (!consOk(S, c)) return false;
    consPay(S, c); S.cons.unl[id] = 1;
    return true;
  }
  function researchSpawn(S, id) {
    const z = VEIN[id];
    if (!has(S, 'construct') || !z || !S.cons.unl[id] || S.cons.x2[id]) return false;
    const c = spawnCost(z);
    if (!consOk(S, c)) return false;
    consPay(S, c); S.cons.x2[id] = 1;
    return true;
  }
  // why a statue tier can't be built yet ('' = it can): gilding needs all 9 built, platinizing all 9 gilded and Monolith 35
  const statueGate = (S, tier) => !has(S, 'construct') ? 'CONSTRUCT' : S.cons.st[tier - 1].length >= 9 ? 'ALL 9 DONE' : tier >= 2 && S.cons.st[tier - 2].length < 9 ? 'BUILD ALL 9 ' + (tier === 2 ? 'STATUES' : 'GILDED STATUES') + ' FIRST' : tier === 3 && S.mono.tier < 35 ? 'MONOLITH 35' : '';
  function buildStatue(S, tier) {
    if (statueGate(S, tier)) return null;
    const c = statueCost(S, tier);
    if (!consOk(S, c)) return null;
    const pool = STATUES.filter((x) => !S.cons.st[tier - 1].includes(x.id));
    const st = pool[Math.floor(Math.random() * pool.length)];
    consPay(S, c); S.cons.st[tier - 1].push(st.id);
    return st;
  }
  function buildMonument(S, id) {
    const M = MONUMENTS[id];
    if (!has(S, 'construct') || !M || S.cons.monu[id] || (M.needs && !S.cons.monu[M.needs])) return false;
    const c = monumentCost(id);
    if (!consOk(S, c)) return false;
    consPay(S, c); S.cons.monu[id] = 1;
    return true;
  }

  // ------------------------------------------------------------------ Challenges (Monolith 10; wiki Challenges)
  // Regular tier only for now: 49 tasks, 10 Challenge Coins each, spent on the wiki's 18 reward upgrades (levels, coin
  // cost per level, and the number of challenges you need done). Extreme (26) and Divine (25) tasks and rewards wait
  // for the systems they use (stars, pets, fishing, arcanist...). Tasks that named drones, pets or codes are replaced
  // by ours (Z-Fighters, Techniques...), and the bomb-stack ones are scaled to our smaller Technique capacity.
  // S.chal = { done: {id: 1}, coins, buy: {reward: level}, c: counters }
  function newChal() { return { done: {}, coins: 0, buy: {}, xdone: {}, xcoins: 0, xbuy: {}, c: { craft: {}, mined: {}, tech: {}, smelt: {}, veins: {}, zkAt: {} } }; }
  const chalAdd = (S, k, id, n) => { const o = S.chal.c[k] || (S.chal.c[k] = {}); o[id] = (o[id] || 0) + n; };
  const cc = (S, k) => S.chal.c[k] || 0;
  const cn = (S, k, id) => (S.chal.c[k] && S.chal.c[k][id]) || 0;
  const part = (t) => MACHINES[t].part + ' Alloy';
  const CH_ROWS = [
    [1, 'Hold 50 charges of one Technique at once', (S) => [cc(S, 'maxCharge'), 50]],
    [2, 'Fire 100 Ki Blasts', (S) => [cn(S, 'tech', 'blast'), 100]],
    [3, 'Claim a Training Goal', (S) => [cc(S, 'goals'), 1]],
    [4, 'Refine 10,000 ' + part(0), (S) => [cn(S, 'craft', 'm0'), 1e4]],
    [5, 'Toggle 5 settings (Options, HOLD, AUTO or STAY)', (S) => [cc(S, 'toggles'), 5]],
    [6, 'Fire the Spirit Bomb 666 times', (S) => [cn(S, 'tech', 'spirit'), 666]],
    [7, 'Earn 30,000 Zenkai Points', (S) => [S.zenkai.total, 3e4]],
    [8, 'Get 100 Rainbow Capsules from Freebie Packs', (S) => [cc(S, 'freebieCaps'), 100]],
    [9, 'Refine 20,000 ' + part(1), (S) => [cn(S, 'craft', 'm1'), 2e4]],
    [10, 'Reach level 5 of the Disc Damage upgrade in the Capsule Store', (S) => [S.store.g_disc || 0, 5]],
    [11, 'Hold 1,000,000 Zeni at once', (S) => [cc(S, 'maxZeni'), 1e6]],
    [12, 'Unlock every Tier 1 and Tier 2 Artifact', (S) => [ZK.filter((z) => z.tier <= 2 && zkUnlocked(S, z)).length, ZK.filter((z) => z.tier <= 2).length]],
    [13, 'Reach 2,500,000 Ki Power', (S) => [cc(S, 'maxDmg'), 2.5e6]],
    [14, 'Catch Loot Bulma 10 times', (S) => [S.stats.bulma, 10]],
    [15, "Make 5,000 " + part(2) + " with Bulma's Smelter", (S) => [cn(S, 'smelt', 'm2'), 5000]],
    [16, 'Complete 100 Contracts in one run', (S) => [S.ct.done, 100]],
    [17, 'Hold 150 charges of one Technique at once', (S) => [cc(S, 'maxCharge'), 150]],
    [18, 'Hold 10,000,000 Zeni at once', (S) => [cc(S, 'maxZeni'), 1e7]],
    [19, 'Go Zenkai within 15 seconds of a Zenkai', (S) => [cc(S, 'quickZk'), 1]],
    [20, 'Earn 3,000,000 Zenkai Points', (S) => [S.zenkai.total, 3e6]],
    [21, 'Hire 3 Z-Fighters', (S) => [Object.keys(S.helpers).length, 3]],
    [22, 'Read the Patch Notes', (S) => [cc(S, 'readPatch'), 1]],
    [23, 'Use 10 items', (S) => [cc(S, 'items'), 10]],
    [24, 'Fire 2,500 Energy Transfers', (S) => [cn(S, 'tech', 'battery'), 2500]],
    [25, 'Research the first Veins in Construct', (S) => [S.cons.unl.stone ? 1 : 0, 1]],
    [26, 'Hold 400 charges of one Technique at once', (S) => [cc(S, 'maxCharge'), 400]],
    [27, 'Hold 250,000,000 Zeni at once', (S) => [cc(S, 'maxZeni'), 2.5e8]],
    [28, 'Fire 1,000 Techniques', (S) => [S.stats.techs, 1000]],
    [29, "Raise Smelter Alloy to x8", (S) => [wsl(S, 'w_trans'), 7]],
    [30, 'Refine 666,000 ' + part(9), (S) => [cn(S, 'craft', 'm9'), 666000]],
    [31, 'Transform 3 Cards', (S) => [cardCount(S)[1], 3]],
    [32, 'Earn 10,000,000 Zenkai Points', (S) => [S.zenkai.total, 1e7]],
    [33, 'Switch your fighter 5 times', (S) => [cc(S, 'fighterSw'), 5]],
    [34, 'Catch Loot Bulma 25 times', (S) => [S.stats.bulma, 25]],
    [35, 'Fire 35,000 Ki Blasts', (S) => [cn(S, 'tech', 'blast'), 35000]],
    [36, 'Refine 1,000,000 ' + part(25), (S) => [cn(S, 'craft', 'm25'), 1e6]],
    [37, 'Go Zenkai 10 times at Power Level 120 or higher', (S) => [cn(S, 'zkAt', '120'), 10]],
    [38, 'Build a Statue', (S) => [S.cons.st[0].length, 1]],
    [39, "Raise a Z-Fighter's Damage to level 20", (S) => [Math.max(0, ...Object.values(S.helpers).map((h) => h.dmg || 0)), 20]],
    [40, 'Unlock your third form', (S) => [formsOpenTop(S), 3]],
    [41, 'Mine 1,000 ' + VEIN.stone.name + ' Veins', (S) => [cn(S, 'veins', 'stone'), 1000]],
    [42, 'Fire 20,000 Dragon Ball Wishes', (S) => [cn(S, 'tech', 'wish'), 20000]],
    [43, 'Reach floor 40 without buying a Disc upgrade', (S) => [cc(S, 'noUp40'), 1]],
    [44, 'Complete 200 Contracts without buying a Disc upgrade', (S) => [cc(S, 'noUpCt'), 1]],
    [45, 'Build the World 2 Monument', (S) => [S.cons.monu.namek ? 1 : 0, 1]],
    [46, 'Salvage 5,000,000 ' + MACHINES[30].part, (S) => [cn(S, 'mined', 'm30'), 5e6]],
    [47, 'Gain 25 Technique capacity from Energy Transfer', (S) => [S.techCapPlus || 0, 25]],
    [48, 'Refine 10,000,000 ' + part(29), (S) => [cn(S, 'craft', 'm29'), 1e7]],
    [49, 'Mine 10,000 ' + VEIN.deepsea.name + ' Veins', (S) => [cn(S, 'veins', 'deepsea'), 1e4]]
  ];
  const CHALLENGES = CH_ROWS.map(([id, text, prog]) => ({ id, text, prog }));
  // [id, name, desc, effects, max level, coins per level, challenges needed]
  const CHAL_REWARDS = [
    ['cr_bar', 'Alloy Upgrade Costs', 'Disc upgrades need 5% less alloy', [['alloyCostPct', 0.05]], 3, 10, 1],
    ['cr_chain', 'Hellzone Hits', '+1 Hellzone Grenade hit', [['chainAdd', 1]], 3, 10, 2],
    ['cr_sdmg', 'Disc SUPER Crit Damage', '+10% SUPER crit damage', [['superDmg', 0.1]], 3, 10, 3],
    ['cr_xp', 'XP and Zenkai Gain', '+10% Power Level XP and Zenkai Points', [['xpPct', 0.1], ['zkPct', 0.1]], 3, 10, 4],
    ['cr_cap', 'Technique Capacity', '+3 Technique capacity', [['techCapAdd', 3]], 1, 20, 6],
    ['cr_tcritd', 'Technique Crit Damage', '+20% Technique crit damage', [['techCritDmg', 0.2]], 3, 10, 7],
    ['cr_perch', 'Damage per Challenge', '+1% disc damage for every Challenge done', [['discPerChal', 0.01]], 3, 10, 8],
    ['cr_bit', 'Skill Bit Chance', '+1% Freebie Skill Bit chance', [['freebieBit', 0.01]], 1, 20, 10],
    ['cr_sell', 'Part Sell Price', '+15% part sell price', [['valuePct', 0.15]], 3, 10, 11],
    ['cr_dbl', 'Double Refine Chance', '+3% double refine chance', [['doubleRefine', 0.03]], 3, 10, 12],
    ['cr_tsup', 'Technique SUPER and ULTRA Crit', '+25% Technique SUPER crit chance and +5% ULTRA', [['techSuperCh', 0.25], ['techUltraCh', 0.05]], 1, 30, 15],
    ['cr_perskill', 'Damage per Skill', '+1% disc damage for every Skill learned', [['discPerSkill', 0.01]], 3, 10, 16],
    ['cr_super', 'Disc SUPER Crit Chance', '+2% SUPER crit chance', [['superCh', 0.02]], 3, 10, 17],
    ['cr_armor', 'Katchin Armor', '-12% Katchin Monolith armor', [['monoArmorPct', 0.12]], 1, 30, 20],
    ['cr_gvein', 'Golden Vein Multi', '+5% golden vein multiplier', [['goldenVeinXPct', 0.05]], 3, 10, 21],
    ['cr_both', 'Disc and Technique SUPER Crit', '+2% SUPER crit chance for the disc and Techniques', [['superCh', 0.02], ['techSuperCh', 0.02]], 3, 10, 22],
    ['cr_ratio', 'Parts per Alloy', '-5% parts per alloy', [['ratioCutPct', 0.05]], 2, 10, 23],
    ['cr_gems', 'Freebie Capsules', '+1 Rainbow Capsule from Freebie Packs', [['freebieCapsAdd', 1]], 1, 10, 24]
  ].map(([id, name, desc, fx, max, cost, min]) => ({ id, name, desc, fx, max, cost, min }));
  const chalCount = (S) => Object.keys(S.chal.done).length;
  // tracked once a second: the highest Zeni, Ki Power and Technique stack ever seen, and the no-upgrade runs
  function trackChal(S, C) {
    const c = S.chal.c;
    if (S.zeni > (c.maxZeni || 0)) c.maxZeni = S.zeni;
    if (C.basePower > (c.maxDmg || 0)) c.maxDmg = C.basePower;
    for (const k of TECH_KEYS) { const b = S.bomb && S.bomb[k]; if (b && b.c > (c.maxCharge || 0)) c.maxCharge = b.c; }
    if (S.ct && S.ct.done >= 200 && !S.run.discBuys) c.noUpCt = 1;
  }
  function trackZenkai(S) {
    const c = S.chal.c;
    for (const th of [120, 125, 200]) if (S.level >= th) chalAdd(S, 'zkAt', String(th), 1);
    if (S.run.elapsed < 15) c.quickZk = 1;
  }
  // ---- Extreme challenges: unlocked when every Regular challenge is done, 10 Extreme Coins each. Our versions of the wiki's 26
  // (drone, Void Portal, Arcanist, frog and World 4 tasks are swapped for Z-Fighter, Construct and Stargazing ones; the wiki's
  // numbers are kept where the thing exists). Divine challenges need systems we do not have and are not built.
  const cardsAt = (S, kind, t) => CARDS.filter((c) => c.kind === kind && cardTier(S, c.id) >= t).length;
  const statuesAt = (S, t) => STATUES.filter((st) => statueTier(S, st.id) >= t).length;
  const CX_ROWS = [
    [50, 'Reach floor 46 without buying a Disc upgrade', (S) => [cc(S, 'noUp46'), 1]],
    [51, 'Salvage 666,000,000 ' + MACHINES[9].part, (S) => [cn(S, 'mined', 'm9'), 6.66e8]],
    [52, 'Go Zenkai 5 times at Power Level 125 or higher', (S) => [cn(S, 'zkAt', '125'), 5]],
    [53, 'Hold 5,000,000,000,000 Zeni at once', (S) => [cc(S, 'maxZeni'), 5e12]],
    [54, 'Gild 15 machine cards and 15 alloy cards', (S) => [Math.min(cardsAt(S, 'machine', 2), cardsAt(S, 'alloy', 2)), 15]],
    [55, 'Own 9 Gilded Statues', (S) => [statuesAt(S, 2), 9]],
    [56, 'Earn 100,000,000,000,000 Zeni', (S) => [S.stats.zeni, 1e14]],
    [57, "Make 1,000,000,000,000 " + part(0) + " with Bulma's Smelter", (S) => [cn(S, 'smelt', 'm0'), 1e12]],
    [58, 'Reach level 15 on Taurus and Gemini', (S) => [Math.min(S.sg.lv.taurus || 0, S.sg.lv.gemini || 0), 15]],
    [59, "Raise a Z-Fighter's Speed to level 30", (S) => [Math.max(0, ...Object.values(S.helpers).map((h) => h.spd || 0)), 30]],
    [60, 'Fire 50,000 Energy Transfers', (S) => [cn(S, 'tech', 'battery'), 5e4]],
    [61, 'Salvage 25,000,000,000 ' + MACHINES[3].part, (S) => [cn(S, 'mined', 'm3'), 2.5e10]],
    [62, 'Catch 1,000 Black Star Dragon Balls', (S) => [cc(S, 'ssCaught'), 1000]],
    [63, 'Own 8 Gilded Star cards', (S) => [cardsAt(S, 'star', 2), 8]],
    [64, 'Mine 6,660,000 ' + VEIN.magma.name + ' Veins', (S) => [cn(S, 'veins', 'magma'), 6.66e6]],
    [65, 'Make 46 machine cards Polychrome', (S) => [cardsAt(S, 'machine', 3), 46]],
    [66, 'Reach 400 Technique capacity', (S) => [calc(S).techCap, 400]],
    [67, 'Salvage 6,660,000,000,000 ' + MACHINES[12].part, (S) => [cn(S, 'mined', 'm12'), 6.66e12]],
    [68, 'Go Zenkai 10 times at Power Level 200 or higher', (S) => [cn(S, 'zkAt', '200'), 10]],
    [69, 'Deplete 75,000 rainbow ' + VEIN.volcano.name + ' Veins', (S) => [cn(S, 'rvein', 'volcano'), 75000]],
    [70, 'Build the World 3 Monument', (S) => [S.cons.monu.sadala ? 1 : 0, 1]],
    [71, 'Destroy 222,220 golden machines', (S) => [cc(S, 'goldMined'), 222220]],
    [72, 'Mine 150,000,000 ' + VEIN.stone.name + ' Veins', (S) => [cn(S, 'veins', 'stone'), 1.5e8]],
    [73, 'Catch 2,000 Supergiant Stars', (S) => [cc(S, 'giants'), 2000]],
    [74, 'Clear 5,000 Galactic rainbow floors', (S) => [cc(S, 'galFloors'), 5000]],
    [75, 'Platinize 9 Statues', (S) => [statuesAt(S, 3), 9]]
  ];
  const CHAL_X = CX_ROWS.map(([id, text, prog]) => ({ id, text, prog }));
  const CHAL_XREWARDS = [
    ['cx_mono', 'Damage per Katchin', '+2% disc damage for every Monolith broken', [['discPerMono', 0.02]], 3, 10, 1],
    ['cx_gold', 'Golden Floor Multiplier', '+1x golden floor parts', [['goldenX', 1]], 2, 10, 2],
    ['cx_bulma', 'Loot Bulma Visits', '+10% Loot Bulma visits', [['bulmaPct', 0.1]], 1, 30, 5],
    ['cx_bank', 'Banked Freebie', '+1 banked Freebie Pack', [['freebieBank', 1]], 1, 30, 8],
    ['cx_ss', 'Super Star Spawn Rate', '+10% Black Star Dragon Ball spawn rate', [['sgSuperSpawn', 0.1]], 1, 30, 11],
    ['cx_pet', 'Pet Level Cap', '+1 Pet level cap', [['petCap', 1]], 1, 30, 14],
    ['cx_rbx', 'Rainbow Floor Multiplier', '+5% rainbow floor parts', [['rainbowXPct', 0.05]], 3, 10, 15],
    ['cx_tult', 'Technique ULTRA Crit', '+4% Technique ULTRA crit chance', [['techUltraCh', 0.04]], 3, 10, 16],
    ['cx_gal', 'Galactic Floor Chance', '+2% Galactic rainbow floor chance', [['galacticCh', 0.02]], 1, 30, 19]
  ].map(([id, name, desc, fx, max, cost, min]) => ({ id, name, desc, fx, max, cost, min }));
  const chalXCount = (S) => Object.keys(S.chal.xdone).length;
  const chalXOpen = (S) => chalCount(S) >= CHALLENGES.length;
  function buyChalXReward(S, id) {
    const r = CHAL_XREWARDS.find((x) => x.id === id), l = r ? S.chal.xbuy[id] || 0 : 0;
    if (!r || !chalXOpen(S) || l >= r.max || chalXCount(S) < r.min || S.chal.xcoins < r.cost) return false;
    S.chal.xcoins -= r.cost;
    S.chal.xbuy[id] = l + 1;
    return true;
  }
  function checkChallenges(S, W) {
    if (!has(S, 'challenges')) return;
    for (const ch of CHALLENGES) {
      if (S.chal.done[ch.id]) continue;
      const [a, b] = ch.prog(S);
      if (a >= b) { S.chal.done[ch.id] = 1; S.chal.coins += 10; if (W) emit(W, { type: 'challenge', id: ch.id, text: ch.text }); }
    }
    if (!chalXOpen(S)) return;
    for (const ch of CHAL_X) {
      if (S.chal.xdone[ch.id]) continue;
      const [a, b] = ch.prog(S);
      if (a >= b) { S.chal.xdone[ch.id] = 1; S.chal.xcoins += 10; if (W) emit(W, { type: 'challenge', id: ch.id, text: ch.text }); }
    }
  }
  function buyChalReward(S, id) {
    const r = CHAL_REWARDS.find((x) => x.id === id), l = r ? S.chal.buy[id] || 0 : 0;
    if (!r || !has(S, 'challenges') || l >= r.max || chalCount(S) < r.min || S.chal.coins < r.cost) return false;
    S.chal.coins -= r.cost;
    S.chal.buy[id] = l + 1;
    return true;
  }

  // ------------------------------------------------------------------ Loot Bulma (the wiki's Lootbugs)
  // She flies by every 20 minutes. Tap her plane for a free reward; a missed visit waits in the bank (up to the cap) and can
  // be claimed from the Loot Bulma menu. Each claimed visit also offers a Rainbow Capsule reward to buy (a Golden visit gives
  // it free); a Triple visit is three at once. Rewards are chosen by weight and scale with the Loot multiplier.
  // Ours: the base bank of 3, the Z-Fighter tasks, no star / fishing / archaeology rewards (those systems are not built).
  const BUG_BUFFS = { bug_ore: { name: 'Double Parts', col: '#ffd34d' }, bug_vein: { name: 'Triple Veins', col: '#7ce0ff' }, bug_tech: { name: 'Fast Recharge', col: '#ff8fd0' } };
  // [id, label, base amount, weight, needs]
  const BUG_FREE = [
    ['caps', 'Rainbow Capsules', 2, 30], ['item', 'Item chests', 1, 35], ['super', 'SUPER chest', 1, 5],
    ['cherry', 'Afterimage charges', 10, 20, (S) => techOpen(S, 'cherry')], ['ore', 'x2 parts', 120, 15],
    ['vein', 'x3 Vein spawns', 120, 20, (S) => !!(S.cons && S.cons.unl.stone)], ['speed', 'x2 game speed', 120, 15]
  ];
  const BUG_GEM = [
    ['item', 'Item chests', 3, 18], ['super', 'SUPER chest', 1, 10], ['cherry', 'Afterimage charges', 100, 20, (S) => techOpen(S, 'cherry')],
    ['ore', 'x2 parts', 600, 24], ['vein', 'x3 Vein spawns', 600, 20, (S) => !!(S.cons && S.cons.unl.stone)], ['speed', 'x2 game speed', 600, 24], ['tech', 'x10 Technique recharge', 120, 3]
  ];
  const BUG_COST = 15;
  const bugCost = (S) => Math.max(1, BUG_COST - b0(bonus(S), 'bugCostCut'));
  const bugPick = (S, tab) => {
    const pool = tab.filter((r) => !r[4] || r[4](S)), tot = pool.reduce((a, r) => a + r[3], 0);
    let x = Math.random() * tot;
    for (const r of pool) { x -= r[3]; if (x < 0) return r; }
    return pool[0];
  };
  // gives one reward row; returns what it was, for the toast
  function bugGive(S, C, r) {
    const [id, label, base] = r;
    const q = Math.max(1, sround(base * C.bulmaLoot));
    const addBuff = (k) => { S.buffs[k] = Math.min(BUFF_MAX, (S.buffs[k] || 0) + q); };
    if (id === 'caps') { const c = Math.max(1, sround(q * C.capsMult)); addCaps(S, c); return '+' + c + ' Rainbow Capsules'; }
    if (id === 'item') S.chests.item += q;
    else if (id === 'super') S.chests.super += q;
    else if (id === 'cherry') S.cherry = (S.cherry || 0) + q;
    else if (id === 'ore') addBuff('bug_ore');
    else if (id === 'vein') addBuff('bug_vein');
    else if (id === 'speed') addBuff('chamber');
    else if (id === 'tech') addBuff('bug_tech');
    return id === 'item' || id === 'super' || id === 'cherry' ? '+' + q + ' ' + label : label + ' for ' + fmtTime(q);
  }
  function bankBugs(S, C, n, W) {
    const had = S.bulma.bank;
    S.bulma.bank = Math.min(C.bulmaBank, had + n);
    if (W && S.bulma.bank > had) emit(W, { type: 'bugBanked', n: S.bulma.bank - had, bank: S.bulma.bank });
  }
  // one visit's rewards: a free one, plus the buyable (or, if Golden, free) Rainbow Capsule one
  function bugVisit(S, W, C, gold) {
    const texts = [bugGive(S, C, bugPick(S, BUG_FREE))];
    const g = bugPick(S, BUG_GEM);
    if (gold) texts.push(bugGive(S, C, g));
    else S.bulma.offers.push(g[0]);
    S.stats.bulma++;
    cardRoll(S, W, 'x_bulma', 1);
    if (gold) cardRoll(S, W, 'x_golbug', 1);
    return texts;
  }
  function catchBulma(S, W, now) {
    if (!W.bulma) return null;
    const C = calc(S);
    const at = { x: W.bulma.x, y: W.bulma.y }, n = W.bulma.n || 1, gold = !!W.bulma.gold;
    W.bulma = null;
    S.bulma.next = now + bulmaWait(C);
    S.bulma.offers = [];
    let texts = [];
    for (let i = 0; i < n; i++) texts = texts.concat(bugVisit(S, W, C, gold));
    S.bulma.offers = S.bulma.offers.slice(-3);
    const text = texts.join(', ');
    emit(W, { type: 'bulmaGot', text, x: at.x, y: at.y, caps: 0 });
    return text;
  }
  // claim every banked visit at once
  function claimBulmaBank(S, W) {
    const n = S.bulma.bank;
    if (!(n > 0)) return null;
    const C = calc(S);
    S.bulma.bank = 0;
    S.bulma.offers = [];
    let texts = [];
    for (let i = 0; i < n; i++) texts = texts.concat(bugVisit(S, W, C, false));
    S.bulma.offers = S.bulma.offers.slice(-3);
    return texts.join(', ');
  }
  function buyBulmaOffer(S, i) {
    const id = S.bulma.offers[i];
    if (id === undefined || S.caps < bugCost(S)) return null;
    const r = BUG_GEM.find((x) => x[0] === id), C = calc(S);
    S.caps -= bugCost(S);
    petRoll(S, null, 'whale', bugCost(S));
    S.bulma.offers.splice(i, 1);
    return bugGive(S, C, r);
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
      S.gifts += 2; reward.gifts = 2; // ours: every Monolith clear brings 2 Gifts
      if (S.run.itemsUsed === 0) S.run.pureWin = true;
      S.mono.readyAt = now + calc(S).monoCd * 1000;
      // a new form step opens: the FORM button moves up to it
      if (FORM_TIERS.some((f, k) => f && f.mono === S.mono.tier && k > (S.formSel || 0))) S.formSel = formsOpenTop(S);
      cardRoll(S, W, 'x_mono', 1);
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
    if (s.max && (S.store[id] || 0) >= s.max + (s.gem ? calc(S).gemCap : 0)) return false;
    S.caps -= s.cost;
    petRoll(S, null, 'whale', s.cost);
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
  const KEEP = ['caps', 'skillPts', 'mono', 'helpers', 'items', 'chests', 'meter', 'ws', 'sup', 'store', 'skills', 'wishes', 'autoTech', 'zenkai', 'bulma', 'goals', 'seen', 'stats', 'opt', 'created', 'fighter', 'formSel', 'zp', 'zpBought', 'cards', 'weapon', 'beamLook', 'freebie', 'bits', 'relicN', 'cons', 'chal', 'shards', 'cardV', 'sg', 'pets', 'gifts', 'vp'];
  function zenkai(S, W, now) {
    const g = zenkaiGain(S);
    if (g <= 0 || W.mode !== 'field') return false;
    trackZenkai(S);
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
    { id: 'ctyield', name: 'Golden Floor Multiplier', desc: '+3% Golden floor parts', fx: [['goldenXPct', 0.03]], max: 5, base: 20, g: 1.3, mono: 12 },
    { id: 'ctcaps', name: 'Rainbow Capsules', desc: '+3% Rainbow Capsules from everything', fx: [['capsPct', 0.03]], max: 5, base: 20, g: 1.3, mono: 12 },
    { id: 'ctbulma', name: 'Loot Bulma Visits', desc: 'Loot Bulma flies by 3% more often', fx: [['bulmaPct', 0.03]], max: 5, base: 40, g: 1.3, mono: 14 },
    { id: 'cttrip', name: 'Triple Loot Bulma', desc: '+2% chance Loot Bulma visits three at once', fx: [['bugTriple', 0.02]], max: 10, base: 50, g: 1.3, mono: 14 },
    { id: 'ctspeed', name: 'Game Speed', desc: '+1% speed for everything', fx: [['speedPct', 0.01]], max: 10, base: 40, g: 1.3, mono: 14 },
    { id: 'ctchest', name: 'Rainbow Floor Multi', desc: '+2% Rainbow floor parts', fx: [['rainbowXPct', 0.02]], max: 10, base: 60, g: 1.3, mono: 28 },
    { id: 'ctsuper', name: 'Hidden SUPER Chests', desc: '+0.15% chance an Item chest also holds a SUPER chest', fx: [['superFromItem', 0.0015]], max: 10, base: 60, g: 1.3, mono: 16 },
    // World 3 (wiki Contracts): CP prices are ours (the wiki doesn't list them)
    { id: 'ctrbch', name: 'Rainbow Floor Chance', desc: '+0.3% Rainbow floor chance', fx: [['rainbowCh', 0.003]], max: 10, base: 100, g: 1.3, mono: 42 },
    { id: 'ctgold', name: 'Golden Ore Chance', desc: '+0.2% chance a machine spawns golden (x3 parts)', fx: [['goldenOreCh', 0.002]], max: 15, base: 100, g: 1.3, mono: 42 },
    { id: 'ctomega', name: 'Disc & Technique OMEGA Crit', desc: '+2% OMEGA crit chance', fx: [['omegaCh', 0.02]], max: 15, base: 100, g: 1.3, mono: 42 },
    { id: 'ctdmg', name: 'Disc & Technique Damage', desc: 'x1.08 disc and Technique damage', fx: [['discX', 1.08], ['techM31', 0.08]], max: 5, base: 150, g: 1.3, mono: 45 }
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
    const pts = Math.round((10 + b0(B, 'ctPts') + cardVal(S, 'x_contract')) * mult);
    S.ct.pts += pts;
    S.ct.done++;
    S.ct.cur = ctMake(S, B);
    if (W) emit(W, { type: 'contract', pts, mult });
    cardRoll(S, W, 'x_contract', 1);
    petRoll(S, W, 'rabbit', 1);
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

  // ------------------------------------------------------------------ Gifts and Value Packs (Menu > Gifts)
  // Gifts (the wiki's): open one for a random reward: first a base reward at equal odds, then a few rare rolls that replace it.
  // Ours: they come from Monolith clears (2 each), 1% of Freebie Packs and Value Packs; the rewards that need systems we do
  // not have (fishing, drones, idols, stickers, skins, Divine chests) are left out or swapped for ours.
  // Value Packs: the wiki's paid bundles, earn-only here. Each costs as many Rainbow Capsules as the gems the paid one gave, and
  // gives its lasting perks (the one-time gem and chest parts are dropped; Skill Points and Gifts are kept).
  const rr = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  function giftOne(S, res) {
    const add = (k, n) => { res[k] = (res[k] || 0) + n; };
    const giveItem = (id, n) => { S.items[id] = (S.items[id] || 0) + n; add(ITEMS[id].name, n); };
    const buff = (k, sec, label) => { S.buffs[k] = Math.min(BUFF_MAX, (S.buffs[k] || 0) + sec); add(label, 1); };
    const caps = (n) => { addCaps(S, n); add('Rainbow Capsules', n); };
    let r = [
      () => { const n = rr(3, 5); S.chests.super += n; add('SUPER chests', n); },
      () => { const n = rr(5, 10); S.chests.super += n; add('SUPER chests', n); },
      () => caps(rr(20, 40)),
      () => caps(rr(35, 60)),
      () => { const n = rr(2, 5); S.bits += n; add('Skill Bits', n); while (S.bits >= 10) { S.bits -= 10; S.skillPts++; add('Skill Points', 1); } },
      () => buff('bug_ore', rr(600, 900), 'x2 parts (10-15 min)'),
      () => giveItem('kidrink', rr(4, 6)),
      () => giveItem('senzu', rr(12, 20)),
      () => giveItem('chamber', rr(1, 2)),
      () => (S.maxFloor >= 73 ? (S.cherry = (S.cherry || 0) + rr(1500, 2750), add('Afterimage charges', 1)) : buff('chamber', rr(1200, 1200), 'x2 game speed')),
      () => { const n = rr(25, 40); S.chests.item += n; add('Item chests', n); },
      () => buff('bug_ore', 1200, 'x2 parts (20 min)')
    ][Math.floor(Math.random() * 12)];
    if (Math.random() < 1 / 40) r = () => { S.gifts += 3; add('Gifts', 3); }; // rare rolls replace the base one
    if (Math.random() < 1 / 45) r = () => caps(rr(80, 130));
    r();
  }
  function openGifts(S, n) {
    n = Math.min(n, Math.floor(S.gifts));
    if (n <= 0) return null;
    const res = {};
    S.gifts -= n;
    for (let i = 0; i < n; i++) giftOne(S, res);
    S.stats.giftsOpened = (S.stats.giftsOpened || 0) + n;
    return { n, res };
  }
  // [id, name, text, price in Rainbow Capsules, Monolith needed, bonus effects, one-time gifts, needs]
  const VALUE_PACKS = [
    ['skillsurge', 'Skill Surge Bundle', '+20 Skill Points, +1% Freebie Skill Bit chance', 1050, 0, [['freebieBit', 0.01]], { sp: 20 }],
    ['skillgalore', 'Skill Points Galore!', '+100 Skill Points', 3550, 4, [], { sp: 100 }],
    ['fast', 'Gotta Go Fast Bundle', '+10% game speed', 4250, 0, [['speedPct', 0.1]], {}],
    ['banker', "Banker's Bundle", '+3 banked Freebies and Loot Bulma visits, +1 capsule per Freebie', 3650, 0, [['freebieBank', 3], ['bugBank', 3], ['freebieCapsAdd', 1]], {}],
    ['bigbanker', "Bigger Banker's Bundle", '+5 banked Freebies and Loot Bulma visits, +1 capsule per Freebie', 4250, 0, [['freebieBank', 5], ['bugBank', 5], ['freebieCapsAdd', 1]], {}, 'banker'],
    ['baller', 'Baller Bundle', 'x2 part sell price, +3 capsules per Freebie', 4000, 0, [['valueX', 2], ['freebieCapsAdd', 3]], {}],
    ['goldbug', 'Golden Loot Bulma Bundle', '+20% golden Loot Bulma chance (golden visits are free)', 3750, 0, [['bugGold', 0.2]], {}],
    ['pettrainer', 'Pet Trainer Bundle', 'x1.2 Pet level-up chance, +10% Vein spawn rate, x2 Power Level gain, +1% rainbow floor chance', 3250, 17, [['petChanceX', 1.2], ['veinSpawnPct', 0.1], ['xpX', 2], ['rainbowCh', 0.01]], {}],
    ['capitalist', 'Capitalist Bundle', '+2 capsules per Freebie, +15% extra SUPER chest chance from Freebies', 4250, 19, [['freebieCapsAdd', 2], ['freebieSuperAdd', 0.15]], {}],
    ['veinextract', 'Vein Extractor Bundle', 'x1.15 Vein income, +5% golden Vein chance, +2% rainbow Vein chance, +25% golden Vein amount', 3250, 19, [['veinIncX', 1.15], ['goldenVeinCh', 0.05], ['rainbowVeinCh', 0.02], ['goldenVeinXPct', 0.25]], {}],
    ['supernova', 'Stargazing Supernova Bundle', '+3% Supernova chance, +3% Triple Star chance, +3% Triple Super Star chance', 3650, 23, [['sgNova', 0.03], ['sgTriple', 0.03], ['sgSSTriple', 0.03]], {}],
    ['progress', 'Progression Booster Bundle', 'x1.2 golden floor parts, x1.15 Vein income, +10% Technique recharge, +5% Triple Star chance', 3750, 30, [['goldenXPct', 0.2], ['veinIncX', 1.15], ['techRech', 0.1], ['sgTriple', 0.05]], {}],
    ['bomber', 'Bomber Extraordinaire Bundle', '+10% Technique recharge, +10% Technique capacity', 3750, 30, [['techRech', 0.1], ['techCapPct', 0.1]], {}],
    ['lootbonanza', 'Loot Bulma Bonanza Bundle', 'x1.2 Loot Bulma rewards, +10 banked Loot Bulma visits', 4550, 32, [['bulmaLoot', 0.2], ['bugBank', 10]], {}],
    ['craftmaster', 'Craftmaster Bundle', '+2% 10x refine chance, +5% parts from every machine', 4150, 35, [['tenRefine', 0.02], ['yieldPct', 0.05]], {}],
    ['giftlovers', 'Gift Lovers Bundle', '+150 Gifts (needs 100 Gifts opened)', 4550, 0, [], { gifts: 150 }, 'gifts100']
  ].map(([id, name, txt, price, mono, fx, give, need]) => ({ id, name, txt, price, mono, fx, give, need }));
  const VP = Object.fromEntries(VALUE_PACKS.map((v) => [v.id, v]));
  const vpOpen = (S, v) => !S.vp[v.id] && S.mono.tier >= v.mono && (!v.need || (v.need === 'gifts100' ? (S.stats.giftsOpened || 0) >= 100 : S.vp[v.need]));
  function vpBuy(S, id) {
    const v = VP[id];
    if (!v || !has(S, 'store') || !vpOpen(S, v) || S.caps < v.price) return false;
    S.caps -= v.price;
    petRoll(S, null, 'whale', v.price);
    S.vp[id] = 1;
    if (v.give.sp) S.skillPts += v.give.sp;
    if (v.give.gifts) S.gifts += v.give.gifts;
    return true;
  }

  // ------------------------------------------------------------------ Pets (Monolith 17)
  // The wiki's Pets: buy a Pet with Rainbow Capsules (after the first you need a total of Pet levels), and it levels up by
  // chance when you do its thing: the chance of reaching level L is 1 / (base x (L - 1)). Level cap 10. A level-5 Skin
  // (more capsules) gives +15% level chance and a bonus. Ours: 13 of the 16 Pets (the fishing, frog and essence ones wait for
  // those systems), no Pet Quests or ranks yet, some perks swapped for ones we have (Happy-Bot, Axolotl skin, Duck skin).
  const PET_CAP = 10;
  const petQ = []; // level-ups that happened outside tick (shown on the next tick)
  // [id, name, total Pet levels to unlock, price, level chance base, how it levels, perks [[bonus key, per level, text]], skin name, skin price, skin perks [[key, amount, text]]]
  const PETS = [
    ['crab', 'Crab', 0, 1, 5000, 'fires a Ki Blast', [['techCapPct', 0.03, 'Technique capacity +3%'], ['techRech', 0.01, 'Technique recharge +1%']], 'Sizzle McSnaps', 1000, [['wsCap', 1, 'Workshop upgrade cap +1']]],
    ['dwarf', 'Dwarf', 1, 350, 50, 'Disc Power upgrade bought above level 25', [['discPct', 0.2, 'Disc damage +20%'], ['ultraCh', 0.01, 'ULTRA crit chance +1%']], 'Torvald the Tiny', 1100, [['discPct', 0.5, 'Disc damage +50%']]],
    ['duck', 'Duck', 5, 750, 500, 'a Vein is depleted', [['xpPct', 0.12, 'Power Level gain +12%'], ['bulmaPct', 0.025, 'Loot Bulma visits +2.5%']], 'Not A Duck', 1200, [['monoArmorPct', 0.1, 'Katchin armor -10%']]],
    ['rabbit', 'Rabbit', 12, 1000, 200, 'a Contract is finished', [['ctCostPct', 0.03, 'Contract upgrade cost -3%']], 'Fluffy', 1300, [['ctPts', 1, 'Contract Points +1']]],
    ['penguin', 'Penguin', 18, 1500, 4500, 'a floor spawns golden', [['goldenX', 0.05, 'Golden floor parts +0.05x']], 'Monarch Waddle', 1400, [['valuePct', 0.5, 'Part sell price +50%']]],
    ['axolotl', 'Axolotl', 28, 1750, 6660000, 'you make Namek alloy', [['doubleRefine', 0.02, 'Double refine chance +2%'], ['refineMinus', 0.1, 'Parts per alloy -1%']], 'Dorp', 1500, [['itemDurPct', 0.1, 'Item duration +10%']]],
    ['whale', 'Whale', 40, 2000, 500, 'you spend Rainbow Capsules (each one rolls)', [['discPct', 0.1, 'Disc damage +10%'], ['bugTriple', 0.03, 'Triple Loot Bulma chance +3%']], 'Meltdown Moby', 1600, [['bugCostCut', 2, 'Loot Bulma rewards cost 2 less']]],
    ['totem', 'Totem', 56, 2250, 450, 'a golden Vein is depleted', [['veinSpawnPct', 0.03, 'Vein spawn rate +3%'], ['goldenVeinCh', 0.01, 'Golden Vein chance +1%'], ['goldenVeinXPct', 0.01, 'Golden Vein amount +1%']], 'Marshall', 1700, [['rainbowVeinCh', 0.02, 'Rainbow Vein chance +2%']]],
    ['happybot', 'Happy-Bot', 75, 2500, 400, 'you level up at Power Level 100+', [['zkPct', 0.04, 'Zenkai Points +4%']], 'Unhappy-Bot', 1800, [['ctCap', 1, 'Contract upgrade caps +1']]],
    ['leprechaun', 'Leprechaun', 90, 2750, 5000, 'you clear a rainbow floor', [['speedPct', 0.015, 'Game speed +1.5%'], ['goldenXPct', 0.0125, 'Golden floor parts +1.25%'], ['rainbowCh', 0.0025, 'Rainbow floor chance +0.25%']], 'Plutonium Paddy', 1900, [['rainbowCh', 0.01, 'Rainbow floor chance +1%']]],
    ['starfish', 'Starfish', 100, 3000, 1000, 'you catch a Black Star Dragon Ball', [['sgSS10', 0.002, 'Super Star 10x chance +0.2%'], ['sgSSNova', 0.002, 'Super Star Supernova chance +0.2%']], 'Storm-51', 2000, [['sgSpawn', 0.1, 'Star spawn rate +10%']]],
    ['dino', 'Dino', 140, 4000, 25000000, 'you earn World 3 Veins', [['discPct', 0.2, 'Disc damage +20%'], ['rainbowXPct', 0.025, 'Rainbow floor parts +2.5%']], 'Drumstick', 3000, [['petCap', 1, 'Pet level cap +1']]],
    ['nagini', 'Nagini', 235, 15000, 162000, 'a golden machine is destroyed', [['goldenOreXAdd', 0.05, 'Golden machine parts +0.05x'], ['goldenXPct', 0.02, 'Golden floor parts +2%'], ['rainbowXPct', 0.02, 'Rainbow floor parts +2%']], 'Abomination', 6000, [['goldenOreCh', 0.02, 'Golden machine chance +2%']]]
  ].map(([id, name, need, price, base, how, perks, skin, skinPrice, skinFx], i) => ({ id, name, need, price, base, how, perks, skin, skinPrice, skinFx, i }));
  const PET = Object.fromEntries(PETS.map((p) => [p.id, p]));
  const petTotal = (S) => Object.values(S.pets.have).reduce((a, b) => a + b, 0);
  const petCap = (S) => PET_CAP + b0(bonus(S), 'petCap');
  const petOpen = (S, p) => !S.pets.have[p.id] && petTotal(S) >= p.need;
  function petBonus(S, add) {
    for (const p of PETS) {
      const lv = S.pets.have[p.id];
      if (!lv) continue;
      add(p.perks.map((x) => [x[0], x[1]]), lv);
      if (S.pets.skin[p.id]) add(p.skinFx.map((x) => [x[0], x[1]]), 1);
    }
  }
  function petBuy(S, id) {
    const p = PET[id];
    if (!p || !has(S, 'pets') || S.pets.have[id] || petTotal(S) < p.need || S.caps < p.price) return false;
    S.caps -= p.price;
    S.pets.have[id] = 1;
    petRoll(S, null, 'whale', p.price);
    return true;
  }
  function petSkin(S, id) {
    const p = PET[id];
    if (!p || (S.pets.have[id] || 0) < 5 || S.pets.skin[id] || S.caps < p.skinPrice) return false;
    S.caps -= p.skinPrice;
    S.pets.skin[id] = 1;
    petRoll(S, null, 'whale', p.skinPrice);
    return true;
  }
  const petChance = (S, p) => { const lv = S.pets.have[p.id]; return lv ? (1 / (p.base * lv)) * (S.pets.skin[p.id] ? 1.15 : 1) * b1(bonus(S), 'petChanceX') : 0; };
  // one roll (n of them, added up) for the thing this Pet likes
  function petRoll(S, W, id, n) {
    if (!S.pets || !S.pets.have[id] || S.pets.have[id] >= petCap(S) || !(n > 0)) return false;
    const p = PET[id];
    if (Math.random() >= petChance(S, p) * n) return false;
    S.pets.have[id]++;
    const e = { type: 'petUp', id, name: p.name, lv: S.pets.have[id] };
    if (W) emit(W, e); else petQ.push(e);
    return true;
  }

  // ------------------------------------------------------------------ Stargazing (Monolith 23)
  // The wiki's Stargazing: every half hour (real clock) each Star moves to one of 5 floors. Clearing a floor a Star can be on
  // gives it a 1/50 spawn chance (and an extra 1/100 Super Star). Tap the Star as it drifts across, or let the Auto-catch
  // upgrades do it. Stars level up with their own count; Telescope and Super Star upgrades are paid in Veins and Super Stars.
  // Ours: only the 18 Stars on our three planets (Aries..Phoenix), you pick which discovered Star to unlock, Telescope caps at 18,
  // no Black Hole, no star wishing or following (offline always counts the floor you are on), perks that need pets, fishing,
  // drones or the Arcanist are swapped for something we have, the late costs are fitted.
  const SG_ONCE = 1 / 50, SG_SUPER = 1 / 100, SG_PERIOD = 30 * 60 * 1000;
  // [id, name, level 2 cost, growth, base cap, perks [[bonus key, per level, text]], floors in sets A..E]
  const SG_STARS = [
    ['aries', 'Aries', 150, 1.25, 20, [['veinSpawnPct', 0.03, 'Vein spawn rate +3%'], ['goldenVeinCh', 0.01, 'Golden Vein chance +1%']], [19, 8, 12, 26, 22]],
    ['taurus', 'Taurus', 150, 1.25, 20, [['discPct', 0.12, 'Disc damage +12%'], ['sgAuto', 0.02, 'Auto-catch Stars +2%']], [9, 6, 27, 36, 3]],
    ['gemini', 'Gemini', 150, 1.25, 20, [['goldenXPct', 0.02, 'Golden floor parts +2%'], ['sgSpawn', 0.02, 'Star spawn rate +2%']], [29, 40, 18, 60, 9]],
    ['cancer', 'Cancer', 300, 1.25, 20, [['ct2x', 0.01, 'Double Contract Point chance +1%'], ['ctCostPct', 0.01, 'Contract upgrade cost -1%']], [39, 28, 4, 47, 41]],
    ['leo', 'Leo', 10000, 3, 3, [['wsCap', 1, 'Workshop cap +1'], ['sgSSTriple', 0.04, 'Triple Super Star chance +4%']], [43, 58, 5, 13, 26]],
    ['virgo', 'Virgo', 300, 1.25, 25, [['techRech', 0.01, 'Technique recharge +1%'], ['sgSuperSpawn', 0.01, 'Super Star spawn rate +1%']], [17, 23, 58, 41, 12]],
    ['libra', 'Libra', 300, 1.25, 20, [['zkPct', 0.05, 'Zenkai Points +5%'], ['bugTriple', 0.01, 'Triple Loot Bulma chance +1%']], [42, 13, 39, 4, 17]],
    ['scorpio', 'Scorpio', 150, 1.25, 50, [['discPct', 0.15, 'Disc damage +15%'], ['sgAll', 0.005, 'All Star multiplier +0.5%']], [27, 59, 44, 21, 36]],
    ['sagittarius', 'Sagittarius', 500, 1.25, 15, [['bulmaPct', 0.02, 'Loot Bulma visits +2%'], ['sgTriple', 0.01, 'Triple Star chance +1%']], [59, 17, 21, 7, 46]],
    ['capricorn', 'Capricorn', 300, 1.25, 20, [['xpPct', 0.15, 'Power Level gain +15%'], ['itemDurPct', 0.01, 'Item duration +1%']], [2, 30, 57, 54, 5]],
    ['aquarius', 'Aquarius', 3000, 1.25, 10, [['refineMinus', 0.1, 'Parts per alloy -1%'], ['bugGold', 0.01, 'Golden Loot Bulma chance +1%']], [12, 51, 34, 17, 29]],
    ['pisces', 'Pisces', 100000, 1.25, 2, [['rainbowX', 10, 'Rainbow floor parts +10x']], [60, 50, 46, 53, 55]],
    ['ophiuchus', 'Ophiuchus', 125000, 1.25, 2, [['freebieBank', 1, 'Banked Freebie +1'], ['bugBank', 1, 'Banked Loot Bulma +1']], [48, 45, 52, 56, 64]],
    ['orion', 'Orion', 125000, 1.25, 20, [['tenRefine', 0.001, '10x refine chance +0.1%'], ['goldenOreCh', 0.0025, 'Golden machine chance +0.25%']], [65, 67, 69, 73, 75]],
    ['hercules', 'Hercules', 175000, 1.25, 20, [['sgNova', 0.0015, 'Supernova chance +0.15%'], ['goldenOreXPct', 0.08, 'Golden machine parts +8%']], [68, 73, 76, 78, 83]],
    ['draco', 'Draco', 250000, 1.25, 20, [['galacticCh', 0.0025, 'Galactic floor chance +0.25%'], ['galacticX', 1, 'Galactic floor parts +10%']], [86, 84, 82, 88, 90]],
    ['cetus', 'Cetus', 1020000, 1.25, 20, [['yieldPct', 0.02, 'Parts from every machine +2%']], [95, 94, 91, 98, 99]],
    ['phoenix', 'Phoenix', 2020000, 1.25, 18, [['compPct', 0.03, 'Z-Fighter damage +3%']], [92, 97, 100, 93, 102]]
  ].map(([id, name, base, g, cap, perks, floors], i) => ({ id, name, base, g, cap, perks, floors, i }));
  const SG_STAR = Object.fromEntries(SG_STARS.map((s) => [s.id, s]));
  const SG_EARLY = ['magma', 'space', 'cloud', 'virtual', 'atomic', 'deepsea', 'beach', 'valley'];
  const SG_MID = ['atomic', 'beach', 'space', 'valley', 'magma', 'cloud', 'virtual'];
  const SG_LATE = ['jurassic', 'jungle', 'deepsea', 'roman', 'volcano', 'industrial', 'valley', 'warfront', 'neon'];
  // Telescope upgrades, paid in Veins (every 5th level in Super Stars). [id, name, text, key, per, max, telescope level, level 1 cost, growth, vein cycle, Super Star costs]
  const SG_UPS = [
    ['auto', 'Auto-catch Stars', 'Chance to catch a Star automatically +3%', 'sgAuto', 0.03, 15, 0, 5500, 1.25, SG_EARLY, [10, 25, 50]],
    ['spawn', 'Star Spawn Rate', 'Stars appear 5% more often', 'sgSpawn', 0.05, 20, 0, 6500, 1.25, SG_EARLY, [10, 25, 50, 100]],
    ['dbl', 'Double Star Chance', '+5% chance for 2 Stars at once', 'sgDouble', 0.05, 20, 0, 7500, 1.25, SG_EARLY, [10, 25, 50, 100]],
    ['sspawn', 'Super Star Spawn Rate', 'Super Stars appear 2% more often', 'sgSuperSpawn', 0.02, 25, 0, 9500, 1.25, SG_EARLY, [10, 25, 50, 100, 250]],
    ['nova', 'Star Supernova Chance', '+0.5% chance a Star is a Supernova (x10)', 'sgNova', 0.005, 25, 10, 50000, 1.3, SG_MID, [50, 100, 250, 500, 1000]],
    ['ss10', 'Super Star 10x Chance', '+0.2% chance for 10 Super Stars at once', 'sgSS10', 0.002, 25, 12, 95000, 1.3, SG_MID, [100, 250, 500, 1000, 2500]],
    ['giant', 'Star Supergiant Chance', '+0.2% chance a Star is a Supergiant (x3)', 'sgGiant', 0.002, 25, 14, 1000000, 1.3, SG_LATE, [250, 500, 1000, 2500, 5000]],
    ['cap', 'Capper Upper', '+1 level cap on the first four upgrades', 'sgUpCap', 1, 5, 17, 500000000, 1.3, SG_LATE, []],
    ['ssgiant', 'Super Star Supergiant Chance', '+0.15% chance a Super Star is a Supergiant', 'sgSSGiant', 0.0015, 20, 18, 35000000000, 1.3, SG_LATE, [1000, 2500, 5000, 10000]],
    ['all', 'All Star Multiplier', 'Every Star is worth +0.01x', 'sgAll', 0.01, 30, 18, 60000000000, 1.45, SG_LATE, [2500, 5000, 10000, 25000, 50000, 100000]]
  ].map(([id, name, txt, key, per, max, tel, base, g, cyc, ss]) => ({ id, name, txt, key, per, max, tel, base, g, cyc, ss }));
  const SG_UP = Object.fromEntries(SG_UPS.map((u) => [u.id, u]));
  const SG_TEL = [['stone', 1], ['magma', 1], ['virtual', 5469], ['space', 6836], [null, 10], ['atomic', 10680], ['cloud', 13350], ['beach', 16687], [null, 100], ['valley', 26080], ['cloud', 32600], [null, 500], ['valley', 50930], ['jurassic', 63662], ['roman', 1.11e6], ['industrial', 4.16e6], ['warfront', 15.6e6], ['neon', 58.5e6]];
  const SG_TEL_MAX = SG_TEL.length;
  // Super Star upgrades: [id, name, text, key, per, max, telescope level, levels of the one before, level 1 cost, growth]
  const SG_SUPS = [
    ['rvein', 'Rainbow Vein Chance', '+1% (a golden Vein can be rainbow: x20 Veins)', 'rainbowVeinCh', 0.01, 10, 0, 0, 15, 1.3],
    ['dct', 'Double Contract Points', '+2% chance', 'ct2x', 0.02, 10, 0, 5, 20, 1.3],
    ['xp', 'Experience', 'Power Level gain +25%', 'xpPct', 0.25, 10, 0, 5, 25, 1.3],
    ['idur', 'Item Duration', '+3%', 'itemDurPct', 0.03, 10, 0, 5, 30, 1.3],
    ['speed', 'Game Speed', '+2%', 'speedPct', 0.02, 10, 0, 5, 150, 1.3],
    ['scap', 'Star Level Caps', '+1 level cap on every Star', 'sgCapAll', 1, 2, 0, 5, 1500, 4.6],
    ['capa', 'Aries, Gemini, Cancer Cap', '+2 level cap', 'sgCapA', 2, 3, 0, 2, 2000, 1.75],
    ['capb', 'Virgo, Aquarius, Ophiuchus Cap', '+1 level cap', 'sgCapB', 1, 3, 0, 3, 3500, 1.75],
    ['gstar', 'Supergiant Star Multiplier', '+10% on a Supergiant', 'sgGiantMul', 0.1, 20, 14, 3, 3000, 1.3],
    ['gom', 'Golden Machine Multiplier', 'Golden machines pay +0.06x more', 'goldenOreXAdd', 0.06, 15, 17, 15, 50000, 1.25],
    ['bank', 'Banked Freebies & Loot Bulma', '+1 of each banked', 'sgBank', 1, 5, 17, 5, 100000, 1.3],
    ['loot', 'Loot Bulma Loot Multiplier', '+1.5%', 'bulmaLoot', 0.015, 20, 18, 1, 875000, 1.35],
    ['combo', 'Novagiant Combo Multiplier', '+2% when a Star is both Supernova and Supergiant', 'sgCombo', 0.02, 15, 18, 5, 1150000, 1.35]
  ].map(([id, name, txt, key, per, max, tel, need, base, g]) => ({ id, name, txt, key, per, max, tel, need, base, g }));
  const SG_SUP = Object.fromEntries(SG_SUPS.map((u) => [u.id, u]));
  const sgSet = (now) => (Math.imul(Math.floor(now / SG_PERIOD), 2654435761) >>> 0) % 5;
  const sgNext = (now) => SG_PERIOD - (now % SG_PERIOD);
  const sgDiscovered = (S) => S.sg.tel; // the first N Stars of the list
  const sgUnlocked = (S) => SG_STARS.filter((s) => S.sg.lv[s.id]).length;
  const sgUnlockCost = (S) => (sgUnlocked(S) === 0 ? 1 : 250 * (sgUnlocked(S) + 1)); // Rainbow Capsules
  function sgBonus(S, add) {
    for (const st of SG_STARS) if (S.sg.lv[st.id]) add(st.perks.map((p) => [p[0], p[1]]), S.sg.lv[st.id]);
    for (const u of SG_UPS) if (S.sg.up[u.id]) add([[u.key, u.per]], S.sg.up[u.id]);
    for (const u of SG_SUPS) if (S.sg.su[u.id]) { if (u.key === 'sgBank') add([['freebieBank', 1], ['bugBank', 1]], S.sg.su[u.id]); else add([[u.key, u.per]], S.sg.su[u.id]); }
  }
  const sgStarCap = (S, st, B) => st.cap + b0(B, 'sgCapAll') + (['aries', 'gemini', 'cancer'].includes(st.id) ? b0(B, 'sgCapA') : 0) + (['virgo', 'aquarius', 'ophiuchus'].includes(st.id) ? b0(B, 'sgCapB') : 0);
  const sgUpMax = (S, u) => u.max + (['auto', 'spawn', 'dbl', 'sspawn'].includes(u.id) ? S.sg.up.cap || 0 : 0);
  // cost to buy the next level: { z: vein id | null, n }, null = Super Stars
  function sgUpCost(S, u) {
    const lv = (S.sg.up[u.id] || 0) + 1;
    if (u.id === 'tel') return null;
    if (lv % 5 === 0 && u.ss.length) { const k = lv / 5 - 1; return { z: null, n: u.ss[Math.min(k, u.ss.length - 1)] * (k >= u.ss.length ? Math.pow(2.5, k - u.ss.length + 1) : 1) }; }
    return { z: u.cyc[(lv - 1) % u.cyc.length], n: Math.round(u.base * Math.pow(u.g, lv - 1)) };
  }
  const sgTelCost = (S) => { const c = SG_TEL[S.sg.tel]; return c ? { z: c[0], n: c[1] } : null; };
  const sgSupCost = (S, u) => Math.round(u.base * Math.pow(u.g, (S.sg.su[u.id] || 0)));
  const sgStarCost = (S, st) => Math.round(st.base * Math.pow(st.g, S.sg.lv[st.id] - 1));
  const sgCanPay = (S, c) => c && (c.z ? (S.cons.veins[c.z] || 0) >= c.n : S.sg.ss >= c.n);
  const sgPay = (S, c) => { if (c.z) S.cons.veins[c.z] -= c.n; else S.sg.ss -= c.n; };
  function sgUnlockStar(S, id) {
    const st = SG_STAR[id];
    if (!st || S.sg.lv[id] || st.i >= sgDiscovered(S) || S.caps < sgUnlockCost(S)) return false;
    petRoll(S, null, 'whale', sgUnlockCost(S));
    S.caps -= sgUnlockCost(S);
    S.sg.lv[id] = 1;
    return true;
  }
  function sgLevelStar(S, id) {
    const st = SG_STAR[id], B = bonus(S);
    if (!st || !S.sg.lv[id] || S.sg.lv[id] >= sgStarCap(S, st, B) || (S.sg.n[id] || 0) < sgStarCost(S, st)) return false;
    S.sg.n[id] -= sgStarCost(S, st);
    S.sg.lv[id]++;
    return true;
  }
  function sgBuyTel(S) {
    const c = sgTelCost(S);
    if (!c || !sgCanPay(S, c)) return false;
    sgPay(S, c);
    S.sg.tel++;
    return true;
  }
  const sgUpOpen = (S, u) => S.sg.tel >= u.tel;
  function sgBuyUp(S, id) {
    const u = SG_UP[id];
    if (!u || !sgUpOpen(S, u) || (S.sg.up[id] || 0) >= sgUpMax(S, u)) return false;
    const c = sgUpCost(S, u);
    if (!sgCanPay(S, c)) return false;
    sgPay(S, c);
    S.sg.up[id] = (S.sg.up[id] || 0) + 1;
    return true;
  }
  // a Super Star upgrade opens with the Telescope level and levels in the one before it
  function sgSupOpen(S, u) {
    const i = SG_SUPS.indexOf(u);
    return S.sg.tel >= u.tel && (i === 0 || u.need === 0 || (S.sg.su[SG_SUPS[i - 1].id] || 0) >= u.need);
  }
  function sgBuySup(S, id) {
    const u = SG_SUP[id];
    if (!u || !sgSupOpen(S, u) || (S.sg.su[id] || 0) >= u.max || S.sg.ss < sgSupCost(S, u)) return false;
    S.sg.ss -= sgSupCost(S, u);
    S.sg.su[id] = (S.sg.su[id] || 0) + 1;
    return true;
  }
  // what one Star (or Super Star) is worth
  function sgValue(S, B, sup, st) {
    const nova = Math.random() < b0(B, sup ? 'sgSSNova' : 'sgNova'), giant = Math.random() < b0(B, sup ? 'sgSSGiant' : 'sgGiant'), rad = Math.random() < b0(B, sup ? 'sgSSRad' : 'sgRad');
    let v = (1 + b0(B, 'sgAll')) * (1 + cardVal(S, 'x_ss'));
    if (!sup && st) v *= 1 + cardVal(S, 's_' + st.id);
    if (nova) v *= 10;
    if (giant) v *= 3 * (1 + b0(B, 'sgGiantMul'));
    if (nova && giant) v *= 1 + b0(B, 'sgCombo');
    if (rad) v *= 10 * (1 + b0(B, sup ? 'sgSSRadMul' : 'sgRadMul'));
    return { v, tag: nova && giant ? 'NOVAGIANT' : nova ? 'SUPERNOVA' : giant ? 'SUPERGIANT' : rad ? 'RADIANT' : '' };
  }
  function sgGain(S, W, st, sup, val, at) {
    if (sup) { S.sg.ss += val.v; petRoll(S, W, 'starfish', 1); S.chal.c.ssCaught = (S.chal.c.ssCaught || 0) + 1; } else { S.sg.n[st.id] = (S.sg.n[st.id] || 0) + val.v; if (/GIANT/.test(val.tag)) S.chal.c.giants = (S.chal.c.giants || 0) + 1; }
    S.stats.stars = (S.stats.stars || 0) + (sup ? 0 : 1);
    cardRoll(S, W, sup ? 'x_ss' : 's_' + st.id, val.v);
    emit(W, { type: 'starGot', x: at.x, y: at.y, sup, name: st.name, v: val.v, tag: val.tag });
  }
  function sgSpawn(S, W, B, st, sup) {
    const val = sgValue(S, B, sup, st), bd = W.bounds;
    const at = { x: bd.x0 - 6, y: bd.y0 + 20 + Math.random() * Math.max(10, (bd.y1 - bd.y0) * 0.45) };
    if (Math.random() < b0(B, 'sgAuto')) { sgGain(S, W, st, sup, val, at); return; }
    W.stars.push({ x: at.x, y: at.y, vx: 7 + Math.random() * 3, t: 0, ph: Math.random() * 6, sup, st: st.id, val });
    emit(W, { type: 'starSpawn', sup, name: st.name });
  }
  // clearing a floor: each Star on this floor right now rolls to appear (and an extra Super Star with it)
  function sgClear(S, W) {
    const B = bonus(S), set = sgSet(Date.now()), mult = 1 + b0(B, 'sgSpawn');
    for (const st of SG_STARS) {
      if (!S.sg.lv[st.id] || st.floors[set] !== S.floor || Math.random() >= SG_ONCE * mult) continue;
      const r = Math.random(), tri = b0(B, 'sgTriple'), n = r < tri ? 3 : r < tri + b0(B, 'sgDouble') ? 2 : 1;
      for (let i = 0; i < n; i++) sgSpawn(S, W, B, st, false);
      if (Math.random() < SG_SUPER * (1 + b0(B, 'sgSuperSpawn')) * mult) { // 1/100 each time a Star appears; the spawn rate raises it too
        const k = Math.random() < b0(B, 'sgSS10') ? 10 : Math.random() < b0(B, 'sgSSTriple') ? 3 : 1;
        for (let i = 0; i < k; i++) sgSpawn(S, W, B, st, true);
      }
    }
  }
  function catchStar(S, W, i) {
    const st = W.stars[i];
    if (!st) return null;
    W.stars.splice(i, 1);
    const star = SG_STAR[st.st];
    sgGain(S, W, star, st.sup, st.val, { x: st.x, y: st.y });
    return (st.sup ? 'BLACK STAR BALL +' : star.name.toUpperCase() + ' STAR +') + fmt(Math.round(st.val.v * 100) / 100) + (st.val.tag ? ' ' + st.val.tag : '');
  }
  // offline: you gain the Stars of the floor you are on (spawns x auto-catch x 1/5 of the floor sets)
  function sgOffline(S, C, clears, out) {
    const B = bonus(S), set = sgSet(Date.now()), mult = 1 + b0(B, 'sgSpawn'), auto = Math.min(1, b0(B, 'sgAuto'));
    const many = 1 + b0(B, 'sgDouble') + 2 * b0(B, 'sgTriple');
    const ev = (sup) => (1 + b0(B, 'sgAll')) * (1 + cardVal(S, 'x_ss')) * (1 + 9 * b0(B, sup ? 'sgSSNova' : 'sgNova')) * (1 + b0(B, sup ? 'sgSSGiant' : 'sgGiant') * (3 * (1 + b0(B, 'sgGiantMul')) - 1));
    let got = 0, ss = 0;
    for (const st of SG_STARS) {
      if (!S.sg.lv[st.id] || st.floors[set] !== S.floor) continue;
      const spawns = clears * SG_ONCE * mult, v = spawns * many * auto * 0.2 * ev(false) * (1 + cardVal(S, 's_' + st.id));
      const sv = clears * SG_ONCE * mult * SG_SUPER * mult * (1 + b0(B, 'sgSuperSpawn')) * auto * 0.2 * ev(true) * (1 + 9 * b0(B, 'sgSS10'));
      S.sg.n[st.id] = (S.sg.n[st.id] || 0) + v; S.sg.ss += sv; got += v; ss += sv;
    }
    if (got + ss > 0) out.stars = { n: got, ss };
  }

  // ------------------------------------------------------------------ Cards (Monolith 10; kept through Zenkai)
  // The wiki's card system. A card drops from the thing it is for (odds add up within one action; offline rolls once per
  // card with everything done while away added up). Gild a card (Zeni + Zenkai Points + Rainbow Capsules) for more, and with
  // the "This Is Gonna Take A While.." skill turn a Gilded card Polychrome with 10 Polychrome Shards.
  // Ore cards are our machine cards, Bar cards our Capsule Alloy cards, Bomb cards our Technique cards; Z-Fighter and form
  // cards are ours (Z-Fighters stand in for drones). Infernal cards are not in yet.
  // S.cards = { id: 1 (standard) | 2 (gilded) | 3 (polychrome) }, S.shards = { id: n }
  const CARDS = [];
  const GAIN = [0.5, 1, 3]; // x1.5 / x2 / x4
  const card = (id, kind, name, how, perk, unit, eff, p, pp, cost, extra) => CARDS.push(Object.assign({ id, kind, name, how, perk, unit, eff, p, pp, cost: Object.assign({ zeni: 25e6 }, cost) }, extra));
  const ORE_ODDS = [[5e6, 5e9], [2e7, 2e10], [5e11, 5e12]], BAR_ODDS = [[2.5e6, 5e10], [1e7, 2e11], [5e13, 1.5e14]], VEIN_ODDS = [[5000, 5e5], [20000, 2e6], [2.5e7, 5e7]];
  MACHINES.forEach((m) => {
    const o = ORE_ODDS[m.planet], gems = m.t < 46 ? 50 + 10 * m.t : m.t - 46 < 20 ? 1500 : m.t - 46 < 31 ? 125000 : 1250000;
    card('m' + m.t, 'machine', m.name, 'Destroy ' + m.name + 's', 'parts from ' + m.name + 's', 'x', GAIN, 1 / o[0], 1 / o[1], { zp: m.t < 46 ? 2.5e5 : 2.5e12, caps: gems }, { m: m.id });
  });
  MACHINES.forEach((m) => {
    const o = BAR_ODDS[m.planet], gems = m.t < 46 ? 50 + 10 * m.t : m.t - 46 < 20 ? 1500 : m.t - 46 < 31 ? 125000 : 1250000;
    card('a' + m.t, 'alloy', m.part + ' Alloy', 'Refine ' + m.part + ' Alloy (or Smelt them)', 'alloy from refining ' + m.part + 's', 'x', GAIN, 1 / o[0], 1 / o[1], { zp: m.t < 46 ? 2.5e5 : 2.5e12, caps: gems }, { m: m.id });
  });
  TECH_KEYS.forEach((k, i) => card('t_' + k, 'tech', TECHS[k].name, 'Use ' + TECHS[k].name, 'when ' + TECHS[k].name + ' recharges', 'extra', [0.5, 1, 2], 1 / 5000, 1 / 1e5, { zp: 2.5e5, caps: 100 + 25 * i }, { tk: k }));
  VEINS.forEach((v) => {
    const o = VEIN_ODDS[planetOf(v.from)];
    card('v_' + v.id, 'vein', v.name + ' Vein', 'Collect ' + v.name + ' Veins', 'Veins from ' + v.name, 'x', GAIN, 1 / o[0], 1 / o[1], { zp: 2.5e6 + 5e5 * v.i, caps: v.i < 16 ? 500 + 100 * v.i : v.i < 19 ? 250000 : v.i === 19 ? 1e6 : 2.5e6 }, { zone: v.id });
  });
  HELPERS.forEach((h, i) => card('f_' + h.id, 'fighter', h.name, 'Let ' + h.name + ' fight', h.name + "'s damage", 'x', [0.25, 0.5, 1], 1 / 50000, 1 / 200000, { zp: 2e6 + 25e4 * i, caps: 1000 }, { h: h.id }));
  for (let k = 1; k < FORM_TIERS.length; k++) card('form' + k, 'form', formName(k), 'Stay in this form', 'Ki drain in this form', 'cut', [0.05, 0.1, 0.2], 1 / 900, 1 / 3600, { zp: 2e6, caps: 1000 }, { tier: k });
  SG_STARS.forEach((st, i) => {
    const early = i < 13, SC = { zp: early ? 1e8 : 5.5e12, caps: early ? 1000 : 2500 };
    card('s_' + st.id, 'star', st.name, 'Catch ' + st.name + ' stars', 'stars from ' + st.name, 'x', GAIN, 1 / (early ? 12345 : 500000), 1 / (early ? 34567 : 1e6), SC, { star: st.id });
  });
  const MISC = { zp: 2.5e5, caps: 1500 };
  card('x_ss', 'misc', 'Super Star', 'Catch Super Stars', 'value of every star', 'x', [0.05, 0.1, 0.2], 1 / 37373, 1 / 73737, MISC);
  card('x_zenkai', 'misc', 'Zenkai', 'Go Zenkai', 'floor clears needed', 'cut', [0.05, 0.1, 0.2], 1 / 175, 1 / 150, MISC);
  card('x_freebie', 'misc', 'Freebie', 'Claim Freebie Packs', 'Rainbow Capsules per Freebie', 'add', [1, 2, 4], 1 / 1750, 1 / 4000, MISC);
  card('x_contract', 'misc', "Bulma's Order", 'Finish Contracts', 'Contract Points per order', 'add', [1, 2, 3], 1 / 5000, 1 / 15000, MISC);
  card('x_golden', 'misc', 'Golden Machine', 'Destroy golden machines', 'golden machine parts', 'x', [0.06, 0.12, 0.24], 1 / 5e5, 1 / 1.5e6, MISC);
  card('x_rainbow', 'misc', 'Rainbow Machine', 'Destroy rainbow machines', 'rainbow machine parts', 'x', [0.06, 0.12, 0.24], 1 / 3.5e5, 1 / 1e6, MISC);
  card('x_w1', 'misc', 'Earth', 'Go down floors on Earth', 'Golden floor parts', 'x', [0.06, 0.12, 0.24], 1 / 1e5, 1 / 2e5, MISC);
  card('x_w2', 'misc', 'Namek', 'Go down floors on Namek', 'Rainbow floor parts', 'x', [0.06, 0.12, 0.24], 1 / 2e5, 1 / 2e5, MISC);
  card('x_w3', 'misc', 'Sadala', 'Go down floors on Sadala', 'Galactic floor parts', 'x', [0.06, 0.12, 0.24], 1 / 2.5e5, 1 / 2.5e5, MISC);
  card('x_gvein', 'misc', 'Golden Vein', 'Collect golden Veins', 'golden Vein amount', 'x', [0.08, 0.16, 0.24], 1 / 2.5e5, 1 / 5e5, MISC);
  card('x_rvein', 'misc', 'Rainbow Vein', 'Collect rainbow Veins', 'rainbow Vein amount', 'x', [0.08, 0.16, 0.24], 1 / 2.5e5, 1 / 5e5, MISC);
  // ours
  card('x_mono', 'misc', 'Katchin', 'Break a Katchin Monolith (always drops)', 'damage to the Monolith', 'x', [0.1, 0.25, 0.5], 1, 1 / 4, MISC);
  card('x_bulma', 'misc', 'Loot Bulma', 'Collect Loot Bulma visits', 'Loot Bulma rewards', 'x', [0.1, 0.2, 0.3], 1 / 2500, 1 / 2500, MISC);
  card('x_golbug', 'misc', 'Golden Loot Bulma', 'Collect golden Loot Bulma visits', 'golden visit chance', 'add', [0.02, 0.04, 0.06], 1 / 10000, 1 / 10000, MISC);
  card('x_beam', 'misc', 'Ki Beam', 'Fire the Ki Beam', 'Ki Beam damage', 'x', [0.1, 0.2, 0.4], 1 / 3600, 1 / 14400, MISC);
  const CARD = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const CARD_KINDS = [['machine', 'MACHINES'], ['alloy', 'ALLOY'], ['tech', 'TECHNIQUES'], ['vein', 'VEINS'], ['star', 'STARS'], ['fighter', 'Z-FIGHTERS'], ['form', 'FORMS'], ['misc', 'MISC']];
  const POLY_NEED = 10;
  const cardTier = (S, id) => (S.cards && S.cards[id]) || 0;
  // a card's effect at its tier (x cards: add 1 for the multiplier)
  const cardVal = (S, id) => { const c = CARD[id], t = cardTier(S, id); return c && t ? c.eff[t - 1] : 0; };
  const techExtra = (v) => Math.floor(v) + (Math.random() < v % 1 ? 1 : 0);
  function cardFx(K, t) {
    const v = K.eff[t - 1], r = (x) => String(Math.round(x * 100) / 100);
    return K.unit === 'x' ? 'x' + r(1 + v) : K.unit === 'cut' ? '-' + r(v * 100) + '%' : K.unit === 'extra' ? (v < 1 ? r(v * 100) + '% for +1 charge' : '+' + v + ' charges') : '+' + (v < 1 && v > 0 ? r(v * 100) + '%' : v);
  }
  function cardGive(S, W, id) {
    if (S.cards[id]) return false;
    S.cards[id] = 1;
    if (W) emit(W, { type: 'card', id });
    return true;
  }
  // one roll for an action that counts `n` times toward this card (n parts, n seconds, n shots...)
  function cardRoll(S, W, id, n) {
    if (!has(S, 'cards')) return false;
    const c = CARD[id];
    if (!c) return false;
    if (!S.cards[id] && Math.random() < c.p * n) cardGive(S, W, id);
    if (S.skills.poly && c.pp && S.cards[id] !== 3 && Math.random() < c.pp * n) {
      S.shards[id] = (S.shards[id] || 0) + 1;
      if (W) emit(W, { type: 'shard', id, n: S.shards[id] });
    }
    return true;
  }
  const gildCost = (id) => CARD[id].cost;
  function cardGild(S, id) {
    const c = CARD[id].cost;
    if (cardTier(S, id) !== 1 || S.zeni < c.zeni || S.zenkai.pts < c.zp || S.caps < c.caps) return false;
    S.zeni -= c.zeni; S.zenkai.pts -= c.zp; S.caps -= c.caps;
    petRoll(S, null, 'whale', c.caps);
    S.cards[id] = 2;
    return true;
  }
  function cardPoly(S, id) {
    if (cardTier(S, id) !== 2 || !S.skills.poly || (S.shards[id] || 0) < POLY_NEED) return false;
    S.shards[id] -= POLY_NEED;
    S.cards[id] = 3;
    return true;
  }
  // [cards owned, Gilded or better, total counting every tier]: a Gilded or Polychrome card counts again for "cards owned" bonuses
  const cardCount = (S) => { let n = 0, g = 0, t = 0; for (const k of Object.keys(S.cards)) { n++; t += S.cards[k]; if (S.cards[k] >= 2) g++; } return [n, g, t]; };

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
    const z = Math.round(goalReward(S));
    S.zeni += z;
    S.chal.c.goals = (S.chal.c.goals || 0) + 1;
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
    const bn = Math.min(C.bulmaBank - S.bulma.bank, Math.floor(e / (TUNE.bulmaMin * C.bulmaEvery)));
    if (bn > 0) { S.bulma.bank += bn; out.bugs = bn; }
    if (!has(S, 'companions')) return out;
    const odds = {};
    const sodds = {};
    const addOdds = (id, n) => { const c = CARD[id]; if (!c) return; if (!S.cards[id]) odds[id] = (odds[id] || 0) + c.p * n; if (S.skills.poly && c.pp) sodds[id] = (sodds[id] || 0) + c.pp * n; };
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
        const id = MACHINES[m].id, q = Math.round(n * C.yieldMult * floorMult(S, C) * (1 + C.goldenOreCh * (C.goldenOreX - 1)) * TUNE.offlineEff);
        S.parts[id] = (S.parts[id] || 0) + q;
        S.seen[id] = 1;
        S.run.got[id] = (S.run.got[id] || 0) + q;
        out.parts[id] = (out.parts[id] || 0) + q;
        addOdds('m' + m, q);
        out.xp += n * machXp(m) * 0.2; // Power Level mostly comes from your own training
      }
      out.kills = kills;
      if (S.sg.tel > 0 && has(S, 'stars')) sgOffline(S, C, kills / Math.max(1, C.maxNodes), out);
      S.stats.kills += kills; S.run.kills += kills;
      const vz = veinZoneOf(S.floor); // veins while away: x0.85 (wiki Offline)
      if (vz && S.cons.unl[vz.id]) { const v = Math.floor(kills * veinChance(S, C, vz) * C.veinInc * (1 + C.goldenVeinCh * (C.goldenVeinX - 1)) * 0.85 * (1 + cardVal(S, 'v_' + vz.id))); S.cons.veins[vz.id] = (S.cons.veins[vz.id] || 0) + v; out.veins = v; addOdds('v_' + vz.id, v); }
    }
    for (const h of HELPERS) if (cl(S, h.id)) { const hs = helperStats(S, C, h); addOdds('f_' + h.id, (t / hs.every) * hs.shots); }
    out.cards = [];
    out.shards = [];
    if (has(S, 'cards')) {
      for (const id of Object.keys(odds)) if (Math.random() < odds[id] && cardGive(S, null, id)) out.cards.push(id);
      for (const id of Object.keys(sodds)) if (Math.random() < sodds[id]) { S.shards[id] = (S.shards[id] || 0) + 1; out.shards.push(id); }
    }
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
    floorsFor, farmFloor, useTech, buyUp, buyWs, sell, refine, hire, upHelper, buyItem, useItem, openChests, catchBulma, claimBulmaBank, buyBulmaOffer, BUG_BUFFS, BUG_GEM, BUG_COST, bugCost,
    VALUE_PACKS, openGifts, vpOpen, vpBuy,
    PETS, PET_CAP, petTotal, petCap, petChance, petBuy, petSkin, petOpen,
    monoReady, monoReward, startMono, quitMono, buySkill, buyStore, checkWishes, zenkaiGain, zenkai, buyZk,
    goalsFor, goalReward, claimGoal, offline, fmt, fmtTime, zpZeni, zpCost, zpMax, buyZp,
    FIGHTERS, FORM_TIERS, fighterOf, formLook, formOpen, formsOpenTop, transform, selectForm, helperView,
    CT_UPS, CT_BY, ctOpen, ctMax, ctUpCost, ctCurrent, ctDeliver, ctReroll, buyCt,
    SG_STARS, SG_UPS, SG_SUPS, SG_TEL_MAX, sgSet, sgNext, sgDiscovered, sgUnlocked, sgUnlockCost, sgStarCap, sgUpMax, sgUpCost, sgTelCost, sgSupCost, sgStarCost, sgCanPay, sgUpOpen, sgSupOpen, sgUnlockStar, sgLevelStar, sgBuyTel, sgBuyUp, sgBuySup, catchStar,
    CARDS, CARD, CARD_KINDS, POLY_NEED, cardVal, cardTier, cardFx, gildCost, cardGild, cardPoly, cardCount,
    FORM_UPS, FORM_KEYS, fupCost, buyFormUp, BEAM_UPS, BEAM_KEYS, BEAM_LOOKS, BEAM_LOOK, beamCost, buyBeam, setWeapon, lookOwned, beamLookOf, setBeamLook, beamRays,
    CHALLENGES, CHAL_REWARDS, chalCount, buyChalReward, CHAL_X, CHAL_XREWARDS, chalXCount, chalXOpen, buyChalXReward, VEINS, VEIN, STATUES, MONUMENTS, veinZoneOf, veinChance, researchCost, spawnCost, statueCost, monumentCost, statueGate, statueTier, consOk, researchVein, researchSpawn, buildStatue, buildMonument,
    MODS, ORE_BAR, ORE_FLOORS, REGION_FLOORS, floorMult, ratioOf, refineAvg, upMax, upOpen, pickDmg, zkUnlocked, zkUnlockCost, zkNextLocked, unlockZk
  };
})();
if (typeof module !== 'undefined') module.exports = IdleCore;
