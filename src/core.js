// DBZ Idle - game rules. No DOM here: the page (ui.js + render.js) and the economy sim (tools/sim.js) both run it.
// State (S) is what gets saved. World (W) is the live field (machines, ki shots, the Monolith fight) and is rebuilt
// on load. Every number a designer may want to tune lives in TUNE or the tables right under it.
const IdleCore = (() => {
  const VERSION = 2;
  const SAVE_KEY = 'dbzidle.v1'; // the fight sim uses dbzsim.v1*: separate on purpose. The key stays; S.v versions the data.

  const TUNE = {
    monoCooldown: 20 * 60, // s between Katchin Monolith attempts (also the wait before the first one)
    monoWinCooldown: 5 * 60, // s after a win
    monoTime: 60, // s per attempt, before bonuses
    monoHp: 20000, monoHpG: 3.2, // tier k HP = monoHp * monoHpG^k
    monoArmor: 8, monoArmorG: 2.3, // tier k armor
    monoTiers: 50,
    levelCap: 25, levelCapPer: 5, // Power Level cap: 25, +5 per Monolith cleared
    offlineCapH: 8, offlineEff: 0.5,
    spawnEvery: 0.7,
    minDmgShare: 0.05, // hits below armor still do this share of the hit
    zenkaiLevel: 20,
    goalsPerDay: 5,
    floorsPerPlanet: 50,
    itemChestEvery: 150, // machines' worth of damage per Item chest
    superChestEvery: 1200, // ... per SUPER chest
    techBase: 6, // a Technique hits for Ki Power x this x the Technique's own multiplier
    critOver: 2, // above 100% crit chance, this much chance buys 1% of the next crit tier
    kiMax: 100, kiRegen: 5, kiMinStart: 25, // Ki: pool, refill per s in base form, Ki needed to transform
    bulmaMin: 240, bulmaMax: 540, bulmaStay: 9 // Loot Bulma: seconds between visits, seconds on screen
  };

  // ------------------------------------------------------------------ world tables
  const PLANETS = [
    { id: 'earth', name: 'Earth', short: 'EARTH', gate: 0 },
    { id: 'namek', name: 'Namek', short: 'NAMEK', gate: 10 } // gate: Monoliths cleared to go past floor 50
  ];
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
    { name: 'Dying Namek', ground: ['#3d2c2a', '#352624', '#473431', '#2a1e1c'], crack: '#ff6a2a' }
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
  const PAINT = { red: ['Crimson ', '#e8443a'], blue: ['Cobalt ', '#4f8cff'], yellow: ['Gold ', '#ffd23f'], green: ['Jade ', '#4fd36a'], purple: ['Frieza ', '#b45cff'] };
  const MARK = { hazard: 'Hazard ', rr: 'Red Ribbon ', flag: 'Patriot ' };
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
  const MACHINES = ROSTER.map((v, t) => {
    const B = BASE[v.sprite];
    const pre = (v.mark ? MARK[v.mark] : '') + (v.paint ? PAINT[v.paint][0] : '');
    const col = v.paint ? PAINT[v.paint][1] : B[2];
    return { id: 'm' + t, t, sprite: v.sprite, paint: v.paint, mark: v.mark, name: pre + B[0], part: pre + B[1], col, region: Math.floor(t / 5), planet: Math.floor(t / 25), rarity: t % 5 === 4 ? 2 : t % 5 >= 2 ? 1 : 0, r: SPRITES[v.sprite].r, big: !!SPRITES[v.sprite].big };
  });
  const MACH = Object.fromEntries(MACHINES.map((m) => [m.id, m]));
  const MAX_FLOOR = PLANETS.length * TUNE.floorsPerPlanet;
  // Planet 1 machines have no armor (only the Monolith does); armor on machines starts on Planet 2.
  // Planet 1 HP is x1.15 to make up for the armor that used to slow first visits to a new type.
  const machHp = (t) => Math.round(12 * Math.pow(1.36, t) * (t < 25 ? 1.15 : 1));
  const machArmor = (t) => (t < 25 ? 0 : Math.round(2 * Math.pow(1.33, t)));
  const partValue = (t) => Math.max(1, Math.round(Math.pow(1.35, t)));
  const machXp = (t) => Math.max(1, Math.round(2 * Math.pow(1.3, t)));
  const xpNext = (lv) => Math.round(30 * Math.pow(1.22, lv - 1));
  const regionOf = (f) => Math.min(REGIONS.length - 1, Math.floor((f - 1) / 10));
  const planetOf = (f) => Math.floor((f - 1) / TUNE.floorsPerPlanet);
  // the machines a floor sends: a new kind every 2 floors; the newest is the rarest, the oldest drops out
  function floorPool(f) {
    const i = Math.min(MACHINES.length - 1, Math.floor((f - 1) / 2));
    const lo = planetOf(f) * 25;
    const out = [];
    [[i, 20], [i - 1, 35], [i - 2, 45]].forEach(([t, w]) => { if (t >= lo) out.push([t, w]); });
    const sum = out.reduce((a, b) => a + b[1], 0);
    return out.map(([t, w]) => [t, w / sum]);
  }

  // ------------------------------------------------------------------ what Monolith clears open
  const UNLOCKS = [
    { n: 1, id: 'companions', name: 'Companions', desc: 'Fighters who throw ki at machines on their own, even while you are away.' },
    { n: 2, id: 'workshop', name: 'Workshop', desc: 'Permanent upgrades bought with Zeni and alloy. They survive Zenkai.' },
    { n: 3, id: 'techniques', name: 'Techniques', desc: 'Solar Flare and Spirit Bomb. Each has its own cooldown.' },
    { n: 3, id: 'skills', name: 'Skill Tree', desc: 'Spend Skill Points on permanent perks. More rows open every 2 Monoliths.' },
    { n: 4, id: 'itemChests', name: 'Item Chests', desc: 'The green meter fills as you damage machines. Full = an Item chest.' },
    { n: 5, id: 'superChests', name: 'SUPER Chests', desc: 'The purple meter fills slowly. SUPER chests roll permanent bonuses and Rainbow Capsules.' },
    { n: 6, id: 'workshop2', name: 'Workshop II', desc: 'Technique and chest upgrades in the Workshop.' },
    { n: 7, id: 'store', name: 'Capsule Store', desc: 'Spend Rainbow Capsules on Skill Points, chests and permanent perks.' },
    { n: 8, id: 'wishes', name: 'Buu Wishes', desc: 'Challenges with permanent rewards. Each one counts within a single run.' },
    { n: 10, id: 'namek', name: 'Planet Namek', desc: "Floors 51-100: five new regions and the Frieza Force's machines." }
  ];

  // ------------------------------------------------------------------ fighters and forms
  // The fighter in the HUD is cosmetic: Goku and Vegeta share the form steps (same numbers), only the looks differ.
  // A look is drawn like the fight sim draws it: a rig made for the form, else the base rig with its hair recoloured.
  const FIGHTERS = {
    goku: { name: 'Goku', forms: [
      { name: 'Base', short: 'BASE', rig: 'goku-saiyan' },
      { name: 'Super Saiyan', short: 'SSJ', rig: 'goku-ssj', aura: '#f2b705' },
      { name: 'Super Saiyan 2', short: 'SSJ2', rig: 'goku-saiyan', hair: '#ffd23f', aura: '#f7c948', spark: true },
      { name: 'Super Saiyan 3', short: 'SSJ3', rig: 'goku-buu-ssj3-hq', aura: '#ffd23f' },
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

  // ------------------------------------------------------------------ run upgrades (Disc tab), reset by Zenkai
  // zeni = base * g^level; from: first level that also needs Capsule Alloy; per: levels per machine of alloy
  const UPS = {
    power: { name: 'Ki Power', desc: 'Damage of each disc hit', max: 100, base: 10, g: 1.3, from: 2, per: 2 },
    spin: { name: 'Spin Rate', desc: 'Disc hits per second', max: 30, base: 30, g: 1.42, from: 1, per: 1 },
    size: { name: 'Disc Size', desc: 'Disc radius', max: 16, base: 45, g: 1.6, from: 1, per: 1 },
    crit: { name: 'Sharp Edge', desc: 'Disc crit chance', max: 40, base: 120, g: 1.5, from: 1, per: 1 },
    field: { name: 'Bigger Battlefield', desc: 'More machines at once', max: 7, base: 90, g: 2.5, from: 1, per: 3 },
    beacon: { name: 'Red Ribbon Beacon', desc: 'Machines respawn faster (same cap)', max: 10, base: 90, g: 1.9, from: 1, per: 3 },
    value: { name: 'Haggling', desc: 'Parts sell for more Zeni', max: 20, base: 260, g: 1.6, from: 2, per: 1 },
    refine: { name: "Bulma's Tuning", desc: 'Fewer parts per alloy', max: 4, base: 400, g: 3.2, from: 0, per: 5 }
  };
  const UP_KEYS = Object.keys(UPS);

  // ------------------------------------------------------------------ permanent bonus sources
  // Every permanent upgrade is a list of effects [key, amount per level]. Keys ending in X multiply (amount^level);
  // the rest add up. calc() reads the totals through bonus().
  const ZK = [
    { id: 'power', name: 'Disc Power', fx: [['discPct', 0.25]], tier: 1, max: 25, base: 2, g: 1.25 },
    { id: 'time', name: 'Monolith Time', fx: [['monoTime', 5]], tier: 1, max: 10, base: 3, g: 1.4 },
    { id: 'weak', name: 'Katchin Weakness', fx: [['monoArmorPct', 0.04]], tier: 1, max: 10, base: 3, g: 1.4 },
    { id: 'xp', name: 'Power Level Gain', fx: [['xpPct', 0.15]], tier: 1, max: 20, base: 2, g: 1.3 },
    { id: 'yield', name: 'Salvage Yield', fx: [['yieldPct', 0.1]], tier: 1, max: 20, base: 2, g: 1.3 },
    { id: 'tcd', name: 'Technique Cooldown', fx: [['techCdPct', 0.03]], tier: 2, max: 15, base: 5, g: 1.35 },
    { id: 'tdmg', name: 'Technique Damage', fx: [['techPct', 0.25]], tier: 2, max: 20, base: 5, g: 1.35 },
    { id: 'start', name: 'Starting Zeni', fx: [['startZeni', 1]], tier: 2, max: 10, base: 4, g: 1.5 },
    { id: 'size', name: 'Disc Size', fx: [['sizePct', 0.05]], tier: 2, max: 10, base: 6, g: 1.4 },
    { id: 'chest', name: 'Chest Meters', fx: [['chestPct', 0.05]], tier: 2, max: 20, base: 6, g: 1.35 },
    { id: 'helper', name: 'Companion Power', fx: [['compPct', 0.25]], tier: 3, max: 20, base: 15, g: 1.35 },
    { id: 'offline', name: 'Offline Limit', fx: [['offlineH', 1]], tier: 3, max: 16, base: 12, g: 1.3 },
    { id: 'refine', name: 'Double Refine', fx: [['doubleRefine', 0.03]], tier: 3, max: 15, base: 15, g: 1.35 },
    { id: 'floor', name: 'Floor Requirement', fx: [['floorReqPct', 0.02]], tier: 3, max: 15, base: 15, g: 1.35 }
  ];
  const ZK_TIERS = [
    { tier: 1, name: 'TIER 1', need: 'Open from the start', open: () => true },
    { tier: 2, name: 'TIER 2', need: 'Clear Monolith 4 or Zenkai twice', open: (S) => S.mono.tier >= 4 || S.zenkai.count >= 2 },
    { tier: 3, name: 'TIER 3', need: 'Clear Monolith 8 or Zenkai 5 times', open: (S) => S.mono.tier >= 8 || S.zenkai.count >= 5 }
  ];

  // Workshop: permanent, paid with Zeni + alloy. Tier 2 rows open with Workshop II.
  const WORKSHOP = [
    { id: 'mastery', name: 'Disc Mastery', desc: '+10% disc damage', fx: [['discPct', 0.1]], max: 50, base: 400, g: 1.38, tier: 1 },
    { id: 'field', name: 'Field Expansion', desc: '+1 machine on the field', fx: [['fieldAdd', 1]], max: 5, base: 2500, g: 4, tier: 1 },
    { id: 'spawn', name: 'Red Ribbon Radar', desc: 'Machines show up 6% faster', fx: [['spawnPct', 0.06]], max: 10, base: 800, g: 1.8, tier: 1 },
    { id: 'prospect', name: 'Salvage Expert', desc: '+8% part sell value', fx: [['valuePct', 0.08]], max: 25, base: 600, g: 1.5, tier: 1 },
    { id: 'descent', name: 'Quick Descent', desc: '-3% machines per floor', fx: [['floorReqPct', 0.03]], max: 10, base: 1500, g: 1.9, tier: 1 },
    { id: 'gen', name: 'Capsule Generator', desc: '+1h offline limit', fx: [['offlineH', 1]], max: 8, base: 3000, g: 2.2, tier: 1 },
    { id: 'kipool', name: 'Ki Reserve', desc: '+15 max Ki', fx: [['kiMax', 15]], max: 20, base: 3000, g: 1.6, tier: 1 },
    { id: 'kiregen', name: 'Ki Recovery', desc: '+10% Ki refill speed', fx: [['kiRegenPct', 0.1]], max: 15, base: 2500, g: 1.55, tier: 1 },
    { id: 'ttrain', name: 'Technique Training', desc: '-3% Technique cooldowns', fx: [['techCdPct', 0.03]], max: 15, base: 20000, g: 1.7, tier: 2 },
    { id: 'tpower', name: 'Technique Power', desc: '+20% Technique damage', fx: [['techPct', 0.2]], max: 30, base: 15000, g: 1.5, tier: 2 },
    { id: 'auto', name: 'Auto Techniques', desc: 'Techniques fire on their own when ready', fx: [['autoTech', 1]], max: 1, base: 80000, g: 1, tier: 2 },
    { id: 'detector', name: 'Chest Detector', desc: '+6% chest meter fill', fx: [['chestPct', 0.06]], max: 20, base: 25000, g: 1.6, tier: 2 },
    { id: 'critws', name: 'Crit Training', desc: '+1% disc crit chance', fx: [['critCh', 0.01]], max: 20, base: 18000, g: 1.6, tier: 2 },
    { id: 'kicontrol', name: 'Ki Control', desc: '-4% Ki drain in a form', fx: [['kiDrainPct', 0.04]], max: 12, base: 30000, g: 1.7, tier: 2 },
    { id: 'startfl', name: 'Head Start', desc: 'Runs start 5 floors deeper', fx: [['startFloor', 5]], max: 8, base: 60000, g: 3, tier: 2 }
  ];

  // SUPER chests: each roll adds a stack of one bonus from the rolled rarity, plus Rainbow Capsules
  const RARITIES = [
    { id: 'common', name: 'Common', col: '#c7c2b8', w: 50 },
    { id: 'rare', name: 'Rare', col: '#5fd35a', w: 30 },
    { id: 'epic', name: 'Epic', col: '#c45bff', w: 14 },
    { id: 'legendary', name: 'Legendary', col: '#ffb030', w: 5 },
    { id: 'mythic', name: 'Mythic', col: '#ff4a4a', w: 1 }
  ];
  const SUPER = [
    { id: 's_disc', r: 0, name: 'Disc Damage +3%', fx: [['discPct', 0.03]], max: 1000 },
    { id: 's_value', r: 0, name: 'Part Sell Value +3%', fx: [['valuePct', 0.03]], max: 1000 },
    { id: 's_xp', r: 0, name: 'Power Level Gain +2%', fx: [['xpPct', 0.02]], max: 1000 },
    { id: 's_comp', r: 0, name: 'Companion Damage +3%', fx: [['compPct', 0.03]], max: 1000 },
    { id: 's_critd', r: 0, name: 'Crit Damage +2% (every tier)', fx: [['critDmg', 0.02]], max: 1000 },
    { id: 's_tech', r: 1, name: 'Technique Damage +10%', fx: [['techPct', 0.1]], max: 1000 },
    { id: 's_chest', r: 1, name: 'Chest Meters +2%', fx: [['chestPct', 0.02]], max: 200 },
    { id: 's_double', r: 1, name: 'Double Salvage Chance +1%', fx: [['doubleOre', 0.01]], max: 50 },
    { id: 's_crit', r: 1, name: 'Disc Crit Chance +1%', fx: [['critCh', 0.01]], max: 1000 },
    { id: 's_ccrit', r: 1, name: 'Companion Crit Chance +1%', fx: [['compCritCh', 0.01]], max: 1000 },
    { id: 's_disc2', r: 2, name: 'Disc Damage +10%', fx: [['discPct', 0.1]], max: 1000 },
    { id: 's_tcd', r: 2, name: 'Technique Cooldown -1%', fx: [['techCdPct', 0.01]], max: 30 },
    { id: 's_cspd', r: 2, name: 'Companion Attack Speed +2%', fx: [['compSpdPct', 0.02]], max: 100 },
    { id: 's_refine', r: 2, name: 'Double Refine +1%', fx: [['doubleRefine', 0.01]], max: 40 },
    { id: 's_zk', r: 3, name: 'Zenkai Points +10%', fx: [['zkPct', 0.1]], max: 200 },
    { id: 's_mtime', r: 3, name: 'Monolith Time +3s', fx: [['monoTime', 3]], max: 50 },
    { id: 's_floor', r: 3, name: 'Floor Requirement -1%', fx: [['floorReqPct', 0.01]], max: 25 },
    { id: 's_all', r: 4, name: 'All Damage +50%', fx: [['allPct', 0.5]], max: 100 },
    { id: 's_multi', r: 4, name: 'Companion Multishot +1', fx: [['multiAdd', 1]], max: 3 }
  ];
  const SUPERBY = Object.fromEntries(SUPER.map((s) => [s.id, s]));

  // Capsule Store: Rainbow Capsules only (earned in game - no real money anywhere)
  const STORE = [
    { id: 'sp', name: 'Skill Point', desc: '+1 Skill Point', cost: 100, grant: (S) => { S.skillPts++; } },
    { id: 'ichest', name: '10 Item Chests', desc: '10 Item chests', cost: 30, grant: (S) => { S.chests.item += 10; } },
    { id: 'schest', name: 'SUPER Chest', desc: '1 SUPER chest', cost: 45, grant: (S) => { S.chests.super += 1; } },
    { id: 'htc', name: '3 Time Chambers', desc: '3 Time Chamber items', cost: 25, grant: (S) => { S.items.chamber = (S.items.chamber || 0) + 3; } },
    { id: 'house', name: 'Capsule House', desc: '+25% offline gains', fx: [['offlinePct', 0.25]], max: 4, cost: 80 },
    { id: 'member', name: 'Capsule Corp Card', desc: '+20% Zeni from selling', fx: [['valuePct', 0.2]], max: 5, cost: 75 },
    { id: 'plane', name: "Bulma's New Plane", desc: 'Loot Bulma visits 20% more often', fx: [['bulmaPct', 0.2]], max: 3, cost: 60 },
    { id: 'pouch', name: 'Bean Pouch', desc: '+1 item from every Item chest', fx: [['itemExtra', 1]], max: 2, cost: 150 }
  ];
  const STOREBY = Object.fromEntries(STORE.map((s) => [s.id, s]));

  // Skill tree: 3 branches x 8 rows. Row r (from 0) opens at Monolith 3 + 2r. A node needs the one above it.
  const BRANCHES = ['DISC', 'TECHNIQUE', 'FORTUNE'];
  const SKILLS = [
    ['edge', 0, 0, 'Destructo Edge', '+20% disc damage', [['discPct', 0.2]], 3, 1],
    ['kictrl', 1, 0, 'Ki Control', '-5% Technique cooldowns', [['techCdPct', 0.05]], 3, 1],
    ['eye', 2, 0, "Bulma's Eye", '+10% part sell value', [['valuePct', 0.1]], 3, 1],
    ['saw', 0, 1, 'Spinning Saw', '+15% spin rate', [['spinPct', 0.15]], 2, 1],
    ['bigbang', 1, 1, 'Big Bang', '+30% Technique damage', [['techPct', 0.3]], 3, 1],
    ['lucky', 2, 1, 'Lucky Capsules', '+5% chest meters', [['chestPct', 0.05]], 3, 1],
    ['wide', 0, 2, 'Wide Disc', '+10% disc size', [['sizePct', 0.1]], 2, 2],
    ['x3', 1, 2, 'Kaio-ken Times Three', 'Kaio-ken capsule chance x2', [['kaioCapsX', 2]], 1, 2],
    ['scrapper', 2, 2, 'Scrapper', '+3% double salvage chance', [['doubleOre', 0.03]], 3, 2],
    ['critedge', 0, 3, 'Crit Edge', '+5% disc crit chance', [['critCh', 0.05]], 3, 2],
    ['afterimage', 1, 3, 'Afterimage', 'Hellzone Grenade lasts 5s longer', [['hellLen', 5]], 1, 2],
    ['refiner', 2, 3, 'Smart Refining', '-0.5 parts per alloy', [['refineMinus', 0.5]], 1, 2],
    ['critcrit', 0, 4, 'Critical Overload', '+20% disc and companion crit chance (it can pass 100%)', [['critCh', 0.2], ['compCritCh', 0.2]], 2, 3],
    ['solar', 1, 4, 'Blinding Light', 'Solar Flare gives +50% more parts', [['flareAdd', 0.5]], 2, 3],
    ['zboost', 2, 4, 'Zenkai Boost', '+15% Zenkai Points', [['zkPct', 0.15]], 3, 3],
    ['masenko', 0, 5, 'Masenko Edge', 'Disc damage x1.5', [['discX', 1.5]], 1, 3],
    ['gather', 1, 5, 'Spirit Gathering', 'Spirit Bomb damage x2', [['spiritX', 2]], 2, 3],
    ['easy', 2, 5, 'Easy Descent', '-10% machines per floor', [['floorReqPct', 0.1]], 2, 3],
    ['team', 0, 6, 'Team Training', '+50% companion damage', [['compPct', 0.5]], 2, 4],
    ['instinct', 1, 6, 'Fighting Instinct', 'Techniques fire on their own', [['autoTech', 1]], 1, 4],
    ['saver', 2, 6, 'Capsule Saver', '+25% Rainbow Capsules', [['capsPct', 0.25]], 2, 4],
    ['ui', 0, 7, 'Ultra Edge', 'All damage x2', [['allX', 2]], 1, 5],
    ['hellmaster', 1, 7, 'Hellzone Mastery', 'Hellzone Grenade hits twice a second', [['hellRateX', 2]], 1, 5],
    ['breaker', 2, 7, 'Monolith Breaker', '+15s Monolith time', [['monoTime', 15]], 1, 5]
  ].map((n) => ({ id: n[0], col: n[1], row: n[2], name: n[3], desc: n[4], fx: n[5], max: n[6], cost: n[7] }));
  const SKILLBY = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
  const skillRowAt = (row) => 3 + 2 * row;
  const skillRowOpen = (S, row) => has(S, 'skills') && S.mono.tier >= skillRowAt(row);

  // Buu Wishes: per-run challenges, each paid once, forever
  const WISHES = [
    { id: 'scrap', name: 'Scrap Collector', goal: 'Salvage 10,000 Scout Rotors in one run', reward: '+10% salvage yield', fx: [['yieldPct', 0.1]], prog: (S) => [S.run.got.m0 || 0, 10000] },
    { id: 'bare', name: 'Bare Hands', goal: 'Reach floor 40 without buying a Disc upgrade', reward: '+25% disc damage', fx: [['discPct', 0.25]], prog: (S) => [S.run.discBuys ? 0 : Math.min(S.maxFloor, 40), 40] },
    { id: 'speed', name: 'Speed Run', goal: 'Reach floor 25 within 15 minutes of a run starting', reward: '-5% machines per floor', fx: [['floorReqPct', 0.05]], prog: (S) => [S.run.fast25 ? 25 : (S.run.elapsed || 0) <= 900 ? Math.min(S.maxFloor, 25) : 0, 25] },
    { id: 'breaker', name: 'Machine Breaker', goal: 'Destroy 3,000 machines in one run', reward: '+10% chest meters', fx: [['chestPct', 0.1]], prog: (S) => [S.run.kills, 3000] },
    { id: 'tech', name: 'Technique Master', goal: 'Use 40 Techniques in one run', reward: '-5% Technique cooldowns', fx: [['techCdPct', 0.05]], prog: (S) => [S.run.techUsed, 40] },
    { id: 'rich', name: 'Mr. Satan Money', goal: 'Earn 1B Zeni in one run', reward: '+15% part sell value', fx: [['valuePct', 0.15]], prog: (S) => [S.run.zeni, 1e9] },
    { id: 'pure', name: 'No Help Needed', goal: 'Clear a Monolith without using an item that run', reward: '+10s Monolith time', fx: [['monoTime', 10]], prog: (S) => [S.run.pureWin ? 1 : 0, 1] },
    { id: 'deep', name: 'Into The Depths', goal: 'Reach floor 75', reward: '2 Skill Points + 100 Rainbow Capsules', grant: (S) => { S.skillPts += 2; addCaps(S, 100); }, prog: (S) => [Math.min(S.maxFloor, 75), 75] }
  ];

  // companions: throw ki at a machine every `every` s for disc Ki Power x mult. Permanent (kept through Zenkai).
  // trait: what each companion brings besides damage (value = base + per x their Trait level, capped at max)
  //   steal: Zeni stolen per hit, as a share of the machine's part value (min 1 Z)   pierce: share of armor ignored
  //   pride: marks hit machines for extra parts   crit: extra crit chance   beam: also hits a 2nd machine for this share
  //   splash: hits every machine near the target for this share
  //   blasts: blasts per throw = base x 2^Trait level up to max; levels past that add blastDmg per level each.
  //   pride (on the helper, not the trait): a fixed Saiyan Pride mark on top
  const HELPERS = [
    { id: 'yamcha', name: 'Yamcha', rig: 'goku-saiyan', standIn: true, mono: 1, hire: 100, every: 1.8, mult: 0.35, col: '#ffcf7a', moves: ['Wolf Fang Fist!', 'Spirit Ball!'], trait: { key: 'steal', name: 'Desert Bandit', base: 0.01, per: 0.005, max: 0.25, fmt: 'pct', desc: 'Steals Zeni from every machine he hits' } },
    { id: 'krillin', name: 'Krillin', rig: 'krillin', mono: 1, hire: 200, every: 2.0, mult: 0.8, col: '#ffd23f', moves: ['Kienzan!', 'Scattering Bullet!'], trait: { key: 'pierce', name: 'Cutting Edge', base: 0.3, per: 0.03, max: 0.9, fmt: 'pct', desc: 'His hits ignore part of the armor' } },
    { id: 'gohan', name: 'Gohan', rig: 'gohan-saiyan', mono: 2, hire: 2000, every: 1.6, mult: 1.1, col: '#ffe36a', moves: ['Masenko!', 'Kamehameha!'], trait: { key: 'crit', name: 'Hidden Potential', base: 0.25, per: 0.05, max: 5, fmt: 'pct', desc: 'Extra crit chance (it can pass 100%)' } },
    { id: 'piccolo', name: 'Piccolo', rig: 'piccolo-saiyan', mono: 4, hire: 30000, every: 2.4, mult: 3.2, col: '#ffef9a', moves: ['Special Beam Cannon!', 'Hellzone Grenade!'], trait: { key: 'beam', name: 'Piercing Beam', base: 0.5, per: 0.05, max: 2, fmt: 'pct', desc: 'Each shot goes through into a second machine' } },
    { id: 'vegeta', name: 'Vegeta', rig: 'vegeta-saiyan', mono: 7, hire: 400000, every: 0.6, mult: 0.05, col: '#c48bff', pride: 0.5, moves: ['Final Flash!', 'Galick Gun!', 'Big Bang Attack!'], trait: { key: 'blasts', name: "Vegeta's Technique", base: 2, max: 64, blastDmg: 0.1, fmt: 'blasts', desc: 'A quick barrage of weak blasts. Each Trait level doubles the blasts (up to 64), then adds +10% blast damage. Saiyan Pride: machines he hits drop +50% parts' } },
    { id: 'nappa', name: 'Nappa', rig: 'nappa-saiyan', mono: 10, hire: 5e6, every: 3.0, mult: 9, col: '#ffb347', moves: ['Break Cannon!', 'Bomber DX!'], trait: { key: 'splash', name: 'Bomber', base: 0.3, per: 0.04, max: 1.5, fmt: 'pct', desc: 'Blasts hit every machine near the target' } }
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
    dmg: { name: 'Damage', desc: '+25% damage', max: 100, mult: 0.5, g: 1.32 },
    spd: { name: 'Attack Speed', desc: '+8% attack speed', max: 25, mult: 1.5, g: 1.5 },
    multi: { name: 'Multishot', desc: '+1 ki ball per throw', max: 4, mult: 25, g: 12 },
    crit: { name: 'Crit Chance', desc: '+3% crit chance', max: 100, mult: 2, g: 1.25 },
    trait: { name: 'Trait', desc: 'Stronger trait', max: 40, mult: 3, g: 1.35 }
  };

  // Techniques: one button each, own cooldown, no stacking
  const TECHS = {
    flare: { name: 'Solar Flare', short: 'FLARE', mono: 3, cd: 30, dmg: 0.3, col: '#fff3a0', desc: 'Blinds every machine: +100% parts when it is destroyed.' },
    spirit: { name: 'Spirit Bomb', short: 'SPIRIT', mono: 3, cd: 120, dmg: 30, col: '#9fe4ff', desc: 'One huge hit on every machine.' },
    kaio: { name: 'Kaio-ken', short: 'KAIO', mono: 4, cd: 45, dmg: 0.5, col: '#ff5a4a', desc: 'Marks every machine: x2 Power Level, and a small chance of a Rainbow Capsule.' },
    hell: { name: 'Hellzone Grenade', short: 'HELL', mono: 6, cd: 60, dmg: 1.2, col: '#8cf07a', desc: 'Ki orbs hit every machine once a second for 10s.' },
    smelt: { name: "Bulma's Smelter", short: 'SMELT', mono: 8, cd: 90, dmg: 0, col: '#c9d6e3', desc: 'Every machine on screen is scrapped straight into Capsule Alloy.' }
  };
  const TECH_KEYS = Object.keys(TECHS);

  // items: timed buffs (and one instant). From Item chests; the commons can also be bought with Zeni.
  const ITEMS = {
    weights: { name: 'Weighted Clothes', r: 0, dur: 120, desc: 'x2 disc damage for 2 min', col: '#c0563f', buy: 150 },
    turbo: { name: 'Turbo Spin', r: 0, dur: 120, desc: '+50% spin rate for 2 min', col: '#7ce0ff', buy: 120 },
    discap: { name: 'Disc Capsule', r: 0, dur: 120, desc: '+40% disc size for 2 min', col: '#ffd34d', buy: 120 },
    scouter: { name: 'Scouter', r: 0, dur: 180, desc: 'x2 Power Level gain for 3 min', col: '#82f468', buy: 100 },
    rice: { name: "Chi-Chi's Rice Bowl", r: 0, dur: 300, desc: '+50% Zeni from selling for 5 min', col: '#f6f0e0', buy: 200 },
    senzu: { name: 'Senzu Bean', r: 1, dur: 0, desc: 'Every Technique is ready again', col: '#6fd27a' },
    chamber: { name: 'Time Chamber', r: 1, dur: 60, desc: 'Everything runs x2 speed for 1 min', col: '#e8e1d6' },
    magnet: { name: 'Capsule Magnet', r: 1, dur: 180, desc: 'Chest meters fill x2 for 3 min', col: '#ff6a6a' },
    water: { name: 'Sacred Water', r: 1, dur: 180, desc: 'Companions attack 50% faster for 3 min', col: '#bff6ff' },
    gravity: { name: 'Gravity Machine', r: 2, dur: 120, desc: 'x3 disc damage for 2 min', col: '#9a7cff' },
    blessing: { name: "Kami's Blessing", r: 2, dur: 180, desc: 'x2 parts from machines for 3 min', col: '#fff6c0' },
    radar: { name: 'Dragon Radar', r: 2, dur: 180, desc: '+25% disc crit chance for 3 min', col: '#ffb030' },
    ritual: { name: "Elder Kai's Ritual", r: 3, dur: 180, desc: 'x2 all damage for 3 min', col: '#ff8fd0' },
    fusion: { name: 'Fusion Dance', r: 3, dur: 120, desc: 'Companions deal x3 damage for 2 min', col: '#ffa040' },
    potara: { name: 'Potara Earrings', r: 4, dur: 60, desc: 'x5 all damage for 1 min', col: '#ffe36a' }
  };
  const ITEM_KEYS = Object.keys(ITEMS);
  const BUFF_MAX = 1200; // a buff stacks up to 20 minutes
  const ITEM_W = [55, 28, 12, 4.5, 0.5];

  // ------------------------------------------------------------------ state
  function newRun(now) { return { start: now, elapsed: 0, discBuys: 0, kills: 0, got: {}, techUsed: 0, itemsUsed: 0, zeni: 0, pureWin: false, fast25: false }; }
  function newState(now) {
    return {
      v: VERSION, created: now, lastSave: now,
      // ---- run (reset by Zenkai)
      zeni: 0, level: 1, xp: 0, parts: {}, alloy: {}, up: {},
      floor: 1, floorKills: 0, maxFloor: 1, stay: false, run: newRun(now),
      buffs: {}, tcd: {},
      // ---- kept through Zenkai
      caps: 0, skillPts: 0,
      mono: { tier: 0, readyAt: now + TUNE.monoCooldown * 1000, best: 0, dmg: 0 }, // dmg: HP already chipped off the current tier (kept between attempts and through Zenkai)
      helpers: {}, items: { weights: 1, senzu: 1 }, chests: { item: 0, super: 0 }, meter: { item: 0, super: 0 },
      ws: {}, sup: {}, store: {}, skills: {}, wishes: {}, autoTech: true,
      zenkai: { pts: 0, total: 0, count: 0, up: {} },
      bulma: { next: now + 90 * 1000 },
      goals: { day: '', done: 0, seq: 0, list: [] },
      seen: { m0: 1 },
      stats: { kills: 0, dmg: 0, techs: 0, play: 0, parts: 0, zeni: 0, monoWins: 0, monoTries: 0, chests: 0, supers: 0, bulma: 0, capsEarned: 0 },
      opt: { reduce: false, offBuffs: true },
      // fighter: 'goku' | 'vegeta' (null until picked at the start). formSel: the step the FORM button uses; formOn: the step you're in now
      fighter: null, ki: TUNE.kiMax, formSel: 1, formOn: 0
    };
  }
  // saves from older versions come in here; each step upgrades one version
  function migrate(raw, now) {
    if (!raw || typeof raw !== 'object' || !raw.v) return null;
    let S = raw;
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
    return S;
  }

  // ------------------------------------------------------------------ derived numbers
  const lv = (S, k) => S.up[k] || 0;
  const planetsOpen = (S) => PLANETS.filter((p) => S.mono.tier >= p.gate).length;
  const levelCap = (S) => TUNE.levelCap + TUNE.levelCapPer * S.mono.tier;
  // all permanent bonuses, summed by key
  function bonus(S) {
    const B = {};
    const add = (fx, l) => {
      if (!l) return;
      for (const [k, a] of fx) {
        if (k.endsWith('X')) B[k] = (B[k] || 1) * Math.pow(a, l);
        else B[k] = (B[k] || 0) + a * l;
      }
    };
    for (const z of ZK) add(z.fx, S.zenkai.up[z.id] || 0);
    for (const w of WORKSHOP) add(w.fx, S.ws[w.id] || 0);
    for (const s of SUPER) add(s.fx, S.sup[s.id] || 0);
    for (const s of STORE) if (s.fx) add(s.fx, S.store[s.id] || 0);
    for (const s of SKILLS) add(s.fx, S.skills[s.id] || 0);
    for (const w of WISHES) if (w.fx && S.wishes[w.id]) add(w.fx, 1);
    return B;
  }
  const b0 = (B, k) => B[k] || 0;
  const b1 = (B, k) => (B[k] === undefined ? 1 : B[k]);
  function calc(S) {
    const B = bonus(S);
    const f = S.buffs;
    const p = lv(S, 'power');
    // buffs of one kind don't stack with each other: the strongest one active applies
    const allDmg = (1 + b0(B, 'allPct')) * b1(B, 'allX') * (f.potara > 0 ? 5 : f.ritual > 0 ? 2 : 1);
    const basePower = (1 + p) * Math.pow(1.1, p) * (1 + 0.03 * (S.level - 1)) * (1 + b0(B, 'discPct')) * b1(B, 'discX');
    const formMult = S.formOn > 0 && FORM_TIERS[S.formOn] ? FORM_TIERS[S.formOn].mult : 1;
    const power = basePower * (f.gravity > 0 ? 3 : f.weights > 0 ? 2 : 1) * allDmg * formMult;
    return {
      B, basePower, power, allDmg, formMult,
      kiMax: TUNE.kiMax + b0(B, 'kiMax'),
      kiRegen: TUNE.kiRegen * (1 + b0(B, 'kiRegenPct')),
      kiDrain: Math.max(0.3, 1 - b0(B, 'kiDrainPct')),
      spin: 4 * (1 + 0.12 * lv(S, 'spin')) * (1 + b0(B, 'spinPct')) * (f.turbo > 0 ? 1.5 : 1),
      radius: (10 + 1.25 * lv(S, 'size')) * (1 + b0(B, 'sizePct')) * (f.discap > 0 ? 1.4 : 1),
      crit: 0.05 + 0.02 * lv(S, 'crit') + b0(B, 'critCh') + (f.radar > 0 ? 0.25 : 0), // raw chance: may pass 100%
      critDmg: 1 + b0(B, 'critDmg'),
      compCrit: b0(B, 'compCritCh'),
      maxNodes: 5 + lv(S, 'field') + b0(B, 'fieldAdd'),
      spawn: TUNE.spawnEvery / ((1 + b0(B, 'spawnPct')) * (1 + 0.06 * lv(S, 'beacon'))), // seconds per machine while below the cap
      techMult: TUNE.techBase * (1 + b0(B, 'techPct')),
      techCd: Math.max(0.25, 1 - b0(B, 'techCdPct')),
      ratio: Math.max(1.5, 4 - 0.5 * lv(S, 'refine') - b0(B, 'refineMinus')),
      valueMult: (1 + 0.15 * lv(S, 'value')) * (1 + b0(B, 'valuePct')) * (f.rice > 0 ? 1.5 : 1),
      xpMult: (1 + b0(B, 'xpPct')) * (f.scouter > 0 ? 2 : 1),
      yieldMult: (1 + b0(B, 'yieldPct')) * (f.blessing > 0 ? 2 : 1),
      doubleOre: b0(B, 'doubleOre'),
      chestMult: (1 + b0(B, 'chestPct')) * (f.magnet > 0 ? 2 : 1),
      compMult: (1 + b0(B, 'compPct')) * (f.fusion > 0 ? 3 : 1) * allDmg,
      compSpd: (1 + b0(B, 'compSpdPct')) * (f.water > 0 ? 1.5 : 1),
      speed: f.chamber > 0 ? 2 : 1,
      floorReq: Math.max(0.3, 1 - b0(B, 'floorReqPct')),
      monoTime: TUNE.monoTime + b0(B, 'monoTime'),
      monoArmorMult: Math.max(0.2, 1 - b0(B, 'monoArmorPct')),
      offlineCap: (TUNE.offlineCapH + b0(B, 'offlineH')) * 3600,
      offlineMult: 1 + b0(B, 'offlinePct'),
      doubleRefine: b0(B, 'doubleRefine'),
      capsMult: 1 + b0(B, 'capsPct'),
      zkMult: 1 + b0(B, 'zkPct'),
      autoTech: b0(B, 'autoTech') > 0,
      hellLen: 10 + b0(B, 'hellLen'),
      hellRate: b1(B, 'hellRateX'),
      flareBonus: 1 + b0(B, 'flareAdd'),
      spiritX: b1(B, 'spiritX'),
      kaioCaps: 0.005 * b1(B, 'kaioCapsX'),
      bulmaEvery: 1 / (1 + b0(B, 'bulmaPct')),
      itemExtra: b0(B, 'itemExtra'),
      multiAdd: b0(B, 'multiAdd'),
      startFloor: 1 + b0(B, 'startFloor'),
      startZeni: B.startZeni ? Math.round(500 * Math.pow(4, B.startZeni - 1)) : 0
    };
  }
  const effDmg = (dmg, armor) => Math.max(dmg - armor, dmg * TUNE.minDmgShare);
  // Crits: chance can pass 100%. Up to 100% it's the chance of a CRIT (x2); beyond that every TUNE.critOver of chance
  // buys 1% of the next tier: SUPER (x3), ULTRA (x4), MEGA (x5)... One roll per hit: the strongest tier that passes.
  const CRIT_TIERS = ['', 'CRIT', 'SUPER', 'ULTRA', 'MEGA', 'GIGA', 'TERA', 'OMEGA'];
  const critEff = (raw) => (raw <= 1 ? raw : 1 + (raw - 1) / TUNE.critOver);
  function rollCrit(raw) {
    const e = critEff(Math.max(0, raw));
    let k = Math.floor(e);
    if (Math.random() < e - k) k++;
    return Math.min(k, CRIT_TIERS.length - 1);
  }
  const critMult = (tier, C) => (tier ? (1 + tier) * C.critDmg : 1);
  // what a raw chance means: [guaranteed tier, chance of the next one]
  const critSplit = (raw) => { const e = critEff(Math.max(0, raw)); return [Math.floor(e), e - Math.floor(e)]; };
  const monoHp = (k) => TUNE.monoHp * Math.pow(TUNE.monoHpG, k);
  const monoArmor = (S, k, C) => TUNE.monoArmor * Math.pow(TUNE.monoArmorG, k) * (C || calc(S)).monoArmorMult;
  const floorNeed = (S, f, C) => Math.max(5, Math.ceil((20 + f * 1.0) * (C || calc(S)).floorReq));
  const itemPrice = (S, id) => Math.round(ITEMS[id].buy * Math.pow(1.5, Math.floor((S.maxFloor - 1) / 5)));
  const cl = (S, id) => S.helpers[id] || null; // a companion's levels {lv, dmg, spd, multi}
  function helperStats(S, C, h) {
    const c = cl(S, h.id);
    const d = c ? c.dmg : 0, s = c ? c.spd : 0, m = c ? c.multi : 0;
    const T = h.trait, tl = c ? c.trait || 0 : 0, blasts = T.key === 'blasts';
    const over = blasts ? Math.max(0, tl - Math.log2(T.max / T.base)) : 0; // Trait levels past the blast cap
    return { dmg: C.basePower * h.mult * (1 + 0.25 * d) * C.compMult * (1 + (blasts ? T.blastDmg * over : 0)), every: h.every / ((1 + 0.08 * s) * C.compSpd), shots: (blasts ? traitVal(h, c) : 1) + m + C.multiAdd, crit: 0.05 + 0.03 * (c ? c.crit || 0 : 0) + C.compCrit + (T.key === 'crit' ? traitVal(h, c) : 0), trait: traitVal(h, c), over };
  }
  const traitVal = (h, c) => {
    const l = c ? c.trait || 0 : 0;
    return h.trait.key === 'blasts' ? Math.min(h.trait.max, h.trait.base * Math.pow(2, l)) : Math.min(h.trait.max, h.trait.base + h.trait.per * l);
  };
  const compUpCost = (h, key, l) => Math.round(h.hire * COMP_UPS[key].mult * Math.pow(COMP_UPS[key].g, l));
  const zkCost = (z, l) => Math.round(z.base * Math.pow(z.g, l));
  const zkTierOpen = (S, t) => ZK_TIERS[t - 1].open(S);
  const wsOpen = (S, w) => has(S, w.tier === 2 ? 'workshop2' : 'workshop');

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
  function upCost(key, l) {
    const U = UPS[key];
    return { zeni: Math.round(U.base * Math.pow(U.g, l)), alloy: alloyNeed(key, l, U.from, U.per) };
  }
  function wsCost(w, l) { return { zeni: Math.round(w.base * Math.pow(w.g, l)), alloy: alloyNeed('ws' + w.id, l + (w.tier === 2 ? 10 : 2), 2, 2, 3) }; }
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
    return { mode: 'field', nodes: [], shots: [], dots: [], spawnT: 0, discT: 0, helperT: {}, events: [], bounds: { x0: 4, y0: 4, x1: 120, y1: 200 }, mono: null, nextId: 1, bulma: null, slow: 0 };
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
    for (let tries = 0; tries < 25; tries++) {
      const x = B.x0 + R + Math.random() * Math.max(1, B.x1 - B.x0 - 2 * R);
      const y = B.y0 + R * 2 + Math.random() * Math.max(1, B.y1 - B.y0 - 2 * R);
      if (W.nodes.some((n) => (n.x - x) ** 2 + (n.y - y) ** 2 < (n.r + R + 2) ** 2)) continue;
      const hp = Math.round(machHp(m.t) * (m.big ? 1.4 : 1));
      const n = { id: W.nextId++, m: m.id, t: m.t, x, y, r: R, hp, max: hp, armor: machArmor(m.t), marks: {}, flash: 0, born: 0, face: Math.random() < 0.5 ? 1 : -1, ph: Math.random() * 10 };
      W.nodes.push(n);
      return n;
    }
    return null;
  }
  function clearField(W) { W.nodes = []; W.shots = []; W.dots = []; }

  function damageNode(S, W, C, n, dmg, by, crit, pierce) {
    if (n.hp <= 0) return 0;
    const d = Math.min(n.hp, effDmg(dmg, n.armor * (1 - (pierce || 0))));
    n.hp -= d;
    n.flash = 0.08;
    S.stats.dmg += d;
    // chest meters: a whole machine's HP is one "machine's worth" of damage
    const share = (d / n.max) * C.chestMult;
    if (has(S, 'itemChests')) { S.meter.item += share / TUNE.itemChestEvery; while (S.meter.item >= 1) { S.meter.item -= 1; S.chests.item++; emit(W, { type: 'chest', kind: 'item' }); } }
    if (has(S, 'superChests')) { S.meter.super += share / TUNE.superChestEvery; while (S.meter.super >= 1) { S.meter.super -= 1; S.chests.super++; emit(W, { type: 'chest', kind: 'super' }); } }
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
    let qty = Math.max(1, sround(C.yieldMult * (n.marks.flare ? 1 + C.flareBonus : 1) * (1 + (n.marks.pride || 0))));
    if (C.doubleOre && Math.random() < C.doubleOre) qty *= 2;
    const alloy = by === 'smelt';
    if (alloy) S.alloy[m.id] = (S.alloy[m.id] || 0) + qty;
    else S.parts[m.id] = (S.parts[m.id] || 0) + qty;
    S.seen[m.id] = 1;
    const xp = machXp(m.t) * C.xpMult * (n.marks.kaio ? 2 : 1);
    S.stats.kills++; S.stats.parts += qty;
    S.run.kills++; S.run.got[m.id] = (S.run.got[m.id] || 0) + qty;
    let caps = 0;
    if (n.marks.kaio && Math.random() < C.kaioCaps) { caps = Math.max(1, sround(C.capsMult)); addCaps(S, caps); }
    goalHit(S, 'kills', null, 1);
    goalHit(S, 'mine', m.id, qty);
    W.nodes = W.nodes.filter((x) => x !== n);
    emit(W, { type: 'kill', x: n.x, y: n.y, m: m.id, face: n.face, qty, alloy, caps });
    addXp(S, W, xp);
    // floors: enough machines destroyed and you go one deeper
    S.floorKills++;
    if (!S.stay && S.floorKills >= floorNeed(S, S.floor, C)) descend(S, W);
  }
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
    if (S.floor >= 25 && S.run.elapsed <= 900) S.run.fast25 = true;
    if (W) emit(W, { type: 'floor', floor: S.floor, region: (S.floor - 1) % 10 === 0 ? REGIONS[regionOf(S.floor)] : null, first });
    goalHit(S, 'floor', null, 1);
    return true;
  }
  // the floors a machine shows up on, most often first (ties: the earlier floor)
  function floorsFor(t) {
    const out = [];
    for (let f = 2 * t + 1; f <= Math.min(MAX_FLOOR, 2 * t + 6); f++) {
      const hit = floorPool(f).find(([x]) => x === t);
      if (hit) out.push([f, hit[1]]);
    }
    return out.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  }
  // where to farm a machine: its best floor you can already reach this run, or null
  function farmFloor(S, t) { const f = floorsFor(t).find(([x]) => x <= S.maxFloor); return f ? f[0] : null; }
  function setFloor(S, W, f) {
    f = Math.max(1, Math.min(S.maxFloor, f | 0));
    if (W.mode !== 'field' || f === S.floor) return false;
    S.floor = f; S.floorKills = 0;
    clearField(W); W.spawnT = 0;
    return true;
  }
  function addXp(S, W, xp) {
    const cap = levelCap(S);
    S.xp += xp;
    while (S.xp >= xpNext(S.level)) {
      if (S.level >= cap) { S.xp = Math.min(S.xp, xpNext(S.level)); break; }
      S.xp -= xpNext(S.level);
      S.level++;
      if (W) emit(W, { type: 'level', level: S.level });
    }
  }
  function discHit(C) {
    const crit = rollCrit(C.crit);
    return [C.power * critMult(crit, C), crit];
  }

  // input: { down, x, y } in game px
  function tick(S, W, dt, input, now) {
    dt = Math.min(dt, 0.25);
    const C = calc(S);
    const sdt = dt * C.speed;
    S.stats.play += dt;
    S.run.elapsed += dt;
    for (const k of Object.keys(S.buffs)) { S.buffs[k] -= dt; if (S.buffs[k] <= 0) { delete S.buffs[k]; emit(W, { type: 'buffEnd', id: k }); } }
    for (const k of Object.keys(S.tcd)) { S.tcd[k] -= sdt; if (S.tcd[k] <= 0) delete S.tcd[k]; }
    for (const n of W.nodes) { n.flash = Math.max(0, n.flash - dt); n.born += dt; }
    // Ki: a form drains it, base form refills it; at 0 Ki you drop back to base
    if (S.formOn > 0) {
      S.ki -= FORM_TIERS[S.formOn].drain * C.kiDrain * dt;
      if (S.ki <= 0) { S.ki = 0; S.formOn = 0; emit(W, { type: 'form', tier: 0, out: true }); }
    } else S.ki = Math.min(C.kiMax, S.ki + C.kiRegen * dt);

    if (W.mode === 'field') {
      W.spawnT -= sdt;
      if (W.spawnT <= 0 && W.nodes.length < C.maxNodes) { spawnNode(S, W); W.spawnT = C.spawn; }
    }
    // the disc
    const step = 1 / C.spin;
    if (input && input.down) {
      W.discT += sdt;
      while (W.discT >= step) {
        W.discT -= step;
        const [d, crit] = discHit(C);
        if (W.mode === 'mono' && W.mono) {
          const M = W.mono;
          const cx = Math.max(M.x - M.w / 2, Math.min(input.x, M.x + M.w / 2));
          const cy = Math.max(M.y - M.h, Math.min(input.y, M.y));
          if ((cx - input.x) ** 2 + (cy - input.y) ** 2 <= C.radius ** 2) hitMono(S, W, d, 'disc', input.x, input.y, crit);
        } else {
          // a machine's body sits above its anchor point (its feet)
          for (const n of W.nodes.slice()) {
            if ((n.x - input.x) ** 2 + (n.y - n.r * 0.7 - input.y) ** 2 <= (C.radius + n.r * 0.8) ** 2) damageNode(S, W, C, n, d, 'disc', crit);
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
        for (const n of W.nodes.slice()) damageNode(S, W, C, n, D.dmg, 'tech');
      }
    }
    W.dots = W.dots.filter((D) => D.ticks > 0 && W.mode === 'field');
    // Auto Techniques
    if (S.autoTech && C.autoTech && W.mode === 'field' && W.nodes.length >= 3) {
      for (const k of TECH_KEYS) if (techReady(S, k)) { useTech(S, W, k); break; }
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
    // Buu Wishes are checked once a second
    W.slow += dt;
    if (W.slow >= 1) { W.slow = 0; checkWishes(S, W); }
    return C;
  }
  const bulmaWait = (C) => (TUNE.bulmaMin + Math.random() * (TUNE.bulmaMax - TUNE.bulmaMin)) * C.bulmaEvery * 1000;

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
  const techOpen = (S, k) => has(S, 'techniques') && S.mono.tier >= TECHS[k].mono;
  const techReady = (S, k) => techOpen(S, k) && !(S.tcd[k] > 0);
  function useTech(S, W, k) {
    if (W.mode !== 'field' || !techReady(S, k)) return false;
    const T = TECHS[k];
    const C = calc(S);
    S.tcd[k] = T.cd * C.techCd;
    S.stats.techs++; S.run.techUsed++;
    goalHit(S, 'tech', null, 1);
    const dmg = C.power * C.techMult * T.dmg * (k === 'spirit' ? C.spiritX : 1);
    emit(W, { type: 'tech', id: k, col: T.col, nodes: W.nodes.map((n) => [n.x, n.y - n.r * 0.7]) });
    if (k === 'hell') { W.dots.push({ t: 0, every: 1 / C.hellRate, ticks: Math.round(C.hellLen * C.hellRate), dmg }); return true; }
    for (const n of W.nodes.slice()) {
      if (k === 'smelt') { killNode(S, W, C, n, 'smelt'); continue; }
      if (k === 'flare') n.marks.flare = 1;
      if (k === 'kaio') n.marks.kaio = 1;
      damageNode(S, W, C, n, dmg, 'tech');
    }
    return true;
  }
  function buyUp(S, key) {
    const l = lv(S, key);
    if (l >= UPS[key].max) return false;
    const cost = upCost(key, l);
    if (!canAfford(S, cost)) return false;
    pay(S, cost);
    S.up[key] = l + 1;
    S.run.discBuys++;
    goalHit(S, 'upgrade', null, 1);
    return true;
  }
  function buyWs(S, id) {
    const w = WORKSHOP.find((x) => x.id === id);
    const l = S.ws[id] || 0;
    if (!w || !wsOpen(S, w) || l >= w.max) return false;
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
    const z = Math.round(n * partValue(MACH[id].t) * C.valueMult);
    S.parts[id] -= n;
    S.zeni += z;
    S.stats.zeni += z; S.run.zeni += z;
    goalHit(S, 'sell', null, z);
    return z;
  }
  function refine(S, id, n) {
    const C = calc(S);
    const can = Math.floor((S.parts[id] || 0) / C.ratio);
    n = Math.min(n, can);
    if (n <= 0) return 0;
    S.parts[id] -= Math.round(n * C.ratio);
    let out = n;
    if (C.doubleRefine > 0) {
      if (n < 2000) { for (let i = 0; i < n; i++) if (Math.random() < C.doubleRefine) out++; }
      else out += Math.round(n * C.doubleRefine);
    }
    S.alloy[id] = (S.alloy[id] || 0) + out;
    goalHit(S, 'refine', null, out);
    return out;
  }
  function hire(S, id) {
    const h = HELPER[id];
    if (!has(S, 'companions') || S.mono.tier < h.mono || cl(S, id) || S.zeni < h.hire) return false;
    S.zeni -= h.hire;
    S.helpers[id] = { lv: 1, dmg: 0, spd: 0, multi: 0, crit: 0, trait: 0 };
    return true;
  }
  function upHelper(S, id, key) {
    const h = HELPER[id], c = cl(S, id);
    if (!c) return false;
    c[key] = c[key] || 0;
    if (c[key] >= COMP_UPS[key].max) return false;
    const cost = compUpCost(h, key, c[key]);
    if (S.zeni < cost) return false;
    S.zeni -= cost;
    c[key]++;
    return true;
  }
  function buyItem(S, id, n) {
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
    if (id === 'senzu') {
      if (!Object.keys(S.tcd).length) return false;
      S.tcd = {};
    } else {
      if ((S.buffs[id] || 0) + I.dur > BUFF_MAX) return false;
      S.buffs[id] = (S.buffs[id] || 0) + I.dur;
    }
    S.items[id]--;
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
        const r = rollRarity(ITEM_W);
        const pool = ITEM_KEYS.filter((k) => ITEMS[k].r === r);
        const id = pool[Math.floor(Math.random() * pool.length)];
        const q = 1 + C.itemExtra + (Math.random() < 0.15 ? 1 : 0);
        S.items[id] = (S.items[id] || 0) + q;
        got[id] = (got[id] || 0) + q;
        S.stats.chests++;
      } else {
        const r = rollRarity(RARITIES.map((x) => x.w));
        let pool = SUPER.filter((s) => s.r === r && (S.sup[s.id] || 0) < s.max);
        if (!pool.length) pool = SUPER.filter((s) => (S.sup[s.id] || 0) < s.max);
        if (pool.length) { const s = pool[Math.floor(Math.random() * pool.length)]; S.sup[s.id] = (S.sup[s.id] || 0) + 1; got[s.id] = (got[s.id] || 0) + 1; }
        caps += Math.max(1, sround((1 + Math.floor(Math.random() * 3) + (Math.random() < 0.05 ? 10 : 0)) * C.capsMult));
        S.stats.supers++;
      }
    }
    if (caps) addCaps(S, caps);
    return { kind, n, got, caps };
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
    const income = Math.round(120 * partValue(floorPool(S.floor)[0][0]) * C.valueMult);
    if (r < 0.35) { S.zeni += income; text = '+' + fmt(income) + ' Zeni'; }
    else if (r < 0.6) { S.chests.item += 3; text = '+3 Item chests'; }
    else if (r < 0.82) {
      const pool = ITEM_KEYS.filter((k) => ITEMS[k].r <= 2);
      const id = pool[Math.floor(Math.random() * pool.length)];
      S.items[id] = (S.items[id] || 0) + 1; text = '+1 ' + ITEMS[id].name;
    } else if (r < 0.92) { S.chests.super += 1; text = '+1 SUPER chest'; }
    else { caps = Math.max(1, sround((5 + Math.floor(Math.random() * 11)) * C.capsMult)); addCaps(S, caps); text = '+' + caps + ' Rainbow Capsules'; }
    emit(W, { type: 'bulmaGot', text, x: at.x, y: at.y, caps });
    return text;
  }

  // ------------------------------------------------------------------ Katchin Monolith
  const monoReady = (S, now) => now >= S.mono.readyAt && S.mono.tier < TUNE.monoTiers;
  // what clearing Monolith number (k+1) pays
  function monoReward(k) {
    const n = k + 1;
    return {
      caps: 20 + 5 * k,
      itemChests: 3 + 2 * k,
      superChests: n >= 5 ? 1 + Math.floor(k / 5) : 0,
      skillPts: n >= 3 ? (n % 3 === 0 ? 2 : 1) : 0,
      cap: TUNE.levelCapPer,
      unlocks: UNLOCKS.filter((u) => u.n === n),
      helpers: HELPERS.filter((h) => h.mono === n),
      techs: TECH_KEYS.filter((t) => TECHS[t].mono === n && n > 3),
      skillRow: SKILLS.some((s) => skillRowAt(s.row) === n && n > 3) ? SKILLS.find((s) => skillRowAt(s.row) === n).row + 1 : 0
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
    S.mono.readyAt = now + TUNE.monoCooldown * 1000;
    S.stats.monoTries++;
    emit(W, { type: 'monoStart' });
    return true;
  }
  function hitMono(S, W, dmg, by, x, y, crit, pierce) {
    const M = W.mono;
    const d = Math.min(M.hp, effDmg(dmg, M.armor * (1 - (pierce || 0))));
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
      S.skillPts += reward.skillPts;
      if (S.run.itemsUsed === 0) S.run.pureWin = true;
      S.mono.readyAt = now + TUNE.monoWinCooldown * 1000;
      // a new form step opens: the FORM button moves up to it
      if (FORM_TIERS.some((f, k) => f && f.mono === S.mono.tier && k > (S.formSel || 0))) S.formSel = formsOpenTop(S);
    } else { S.mono.dmg = M.max - M.hp; S.mono.best = frac; }
    W.mode = 'field';
    W.nodes = W.saved || [];
    W.saved = null;
    W.mono = null;
    emit(W, { type: 'monoEnd', won, frac, dealt, tier: M.tier, reward });
  }
  function quitMono(S, W, now) { if (W.mode === 'mono') { W.mono.left = 0; endMono(S, W, false, now); } }

  // ------------------------------------------------------------------ skill tree, store, wishes
  function skillParent(s) { return s.row > 0 ? SKILLS.find((x) => x.col === s.col && x.row === s.row - 1) : null; }
  function buySkill(S, id) {
    const s = SKILLBY[id];
    const l = S.skills[id] || 0;
    if (!s || l >= s.max || !skillRowOpen(S, s.row) || S.skillPts < s.cost) return false;
    const up = skillParent(s);
    if (up && !(S.skills[up.id] > 0)) return false;
    S.skillPts -= s.cost;
    S.skills[id] = l + 1;
    return true;
  }
  function buyStore(S, id) {
    const s = STOREBY[id];
    if (!s || !has(S, 'store') || S.caps < s.cost) return false;
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
    return Math.floor(Math.pow(S.level - 15, 1.25) * (1 + 0.1 * S.mono.tier) * (1 + S.maxFloor / 200) * (1 + S.mono.best * 0.5) * C.zkMult);
  }
  // what Zenkai keeps; everything else starts over
  const KEEP = ['caps', 'skillPts', 'mono', 'helpers', 'items', 'chests', 'meter', 'ws', 'sup', 'store', 'skills', 'wishes', 'autoTech', 'zenkai', 'bulma', 'goals', 'seen', 'stats', 'opt', 'created', 'fighter', 'formSel'];
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
    S.zeni = C.startZeni;
    S.floor = S.maxFloor = Math.min(C.startFloor, TUNE.floorsPerPlanet);
    clearField(W);
    W.spawnT = 0;
    emit(W, { type: 'zenkai', gain: g });
    return true;
  }
  function buyZk(S, id) {
    const z = ZK.find((x) => x.id === id);
    const l = S.zenkai.up[id] || 0;
    if (!zkTierOpen(S, z.tier) || l >= z.max) return false;
    const c = zkCost(z, l);
    if (S.zenkai.pts < c) return false;
    S.zenkai.pts -= c;
    S.zenkai.up[id] = l + 1;
    return true;
  }

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
    const z = goalReward(S);
    S.zeni += z;
    G.done++;
    G.list.shift();
    let bonus;
    if (G.done === TUNE.goalsPerDay) { S.items.senzu = (S.items.senzu || 0) + 2; S.items.chamber = (S.items.chamber || 0) + 1; S.chests.item += 5; bonus = '2 Senzu Beans, a Time Chamber and 5 Item chests'; }
    else { const k = ['weights', 'turbo', 'discap', 'scouter'][G.done % 4]; S.items[k] = (S.items[k] || 0) + 1; bonus = ITEMS[k].name; }
    emit(W, { type: 'goal', zeni: z, bonus });
    goalsFor(S, now);
    return true;
  }

  // ------------------------------------------------------------------ offline progress
  // Companions keep fighting - and keep going down floors - at TUNE.offlineEff of their live rate. Technique
  // cooldowns run down. Buffs either run down and help (opt.offBuffs) or wait for you. The Monolith timer runs on
  // timestamps and needs nothing here.
  function offline(S, secs) {
    if (secs >= 60) { S.formOn = 0; S.ki = TUNE.kiMax + b0(bonus(S), 'kiMax'); } // forms don't run while you're away; you come back with full Ki
    const C = calc(S);
    const e = Math.max(0, Math.min(secs, C.offlineCap));
    const out = { secs: e, parts: {}, xp: 0, floors: 0, kills: 0, chests: { item: 0, super: 0 }, capped: secs > C.offlineCap };
    if (e < 60) return out;
    for (const k of Object.keys(S.tcd)) { S.tcd[k] -= e; if (S.tcd[k] <= 0) delete S.tcd[k]; }
    let t = e;
    if (S.opt.offBuffs !== false) {
      t += Math.min(e, S.buffs.chamber || 0); // x2 speed for its remaining time
      for (const k of Object.keys(S.buffs)) { S.buffs[k] -= e; if (S.buffs[k] <= 0) delete S.buffs[k]; }
    }
    t *= TUNE.offlineEff * C.offlineMult;
    if (!has(S, 'companions')) return out;
    const before = { item: S.chests.item, super: S.chests.super };
    for (let guard = 0; guard < 300 && t > 0.5; guard++) {
      const pool = floorPool(S.floor);
      let perKill = 0;
      for (const [m, w] of pool) {
        let dps = 0;
        for (const h of HELPERS) if (cl(S, h.id)) { const hs = helperStats(S, C, h); dps += (effDmg(hs.dmg, machArmor(m)) * hs.shots) / hs.every; }
        perKill = dps > 0 ? perKill + w * (machHp(m) / dps) : Infinity;
      }
      if (!isFinite(perKill) || perKill <= 0) break;
      const rate = Math.min(1 / perKill, 1 / (2 * C.spawn));
      const need = floorNeed(S, S.floor, C) - S.floorKills;
      const goOn = !S.stay && canDescend(S, S.floor);
      const kills = goOn && need / rate <= t ? need : Math.floor(rate * t);
      if (kills <= 0) break;
      t -= kills / rate;
      for (const [m, w] of pool) {
        const n = Math.round(kills * w);
        if (n <= 0) continue;
        const id = MACHINES[m].id, q = Math.round(n * C.yieldMult);
        S.parts[id] = (S.parts[id] || 0) + q;
        S.seen[id] = 1;
        S.run.got[id] = (S.run.got[id] || 0) + q;
        out.parts[id] = (out.parts[id] || 0) + q;
        out.xp += n * machXp(m) * 0.2; // Power Level mostly comes from your own training
      }
      out.kills += kills;
      S.stats.kills += kills; S.run.kills += kills;
      const share = kills * C.chestMult;
      if (has(S, 'itemChests')) { S.meter.item += share / TUNE.itemChestEvery; S.chests.item += Math.floor(S.meter.item); S.meter.item %= 1; }
      if (has(S, 'superChests')) { S.meter.super += share / TUNE.superChestEvery; S.chests.super += Math.floor(S.meter.super); S.meter.super %= 1; }
      S.floorKills += kills;
      if (goOn && S.floorKills >= floorNeed(S, S.floor, C)) { if (descend(S, null)) out.floors++; }
      else break;
    }
    out.chests.item = S.chests.item - before.item;
    out.chests.super = S.chests.super - before.super;
    if (out.xp) addXp(S, null, out.xp);
    return out;
  }

  // ------------------------------------------------------------------ numbers
  const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  function fmt(n) {
    if (!isFinite(n)) return '0';
    const neg = n < 0; n = Math.abs(n);
    let s;
    if (n < 1000) s = n < 10 && n % 1 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.floor(n));
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
    STORE, BRANCHES, SKILLS, SKILLBY, WISHES, HELPERS, HELPER, COMP_UPS, TECHS, TECH_KEYS, ITEMS, ITEM_KEYS, BUFF_MAX, ITEM_W, KEEP,
    machHp, machArmor, partValue, machXp, xpNext, regionOf, planetOf, floorPool, has, unlockAt, levelCap, effDmg, monoHp, monoArmor, floorNeed,
    CRIT_TIERS, critEff, critSplit, critMult, rollCrit, itemPrice, helperStats, traitVal, compUpCost, zkCost, zkTierOpen, wsOpen, wsCost, skillRowAt, skillRowOpen, skillParent, techOpen, techReady,
    newState, migrate, calc, bonus, planetsOpen, upCost, canAfford, partReachable, newWorld, spawnNode, tick, canDescend, setFloor,
    floorsFor, farmFloor, useTech, buyUp, buyWs, sell, refine, hire, upHelper, buyItem, useItem, openChests, catchBulma,
    monoReady, monoReward, startMono, quitMono, buySkill, buyStore, checkWishes, zenkaiGain, zenkai, buyZk,
    goalsFor, goalReward, claimGoal, offline, fmt, fmtTime,
    FIGHTERS, FORM_TIERS, fighterOf, formLook, formOpen, formsOpenTop, transform, selectForm, helperView
  };
})();
if (typeof module !== 'undefined') module.exports = IdleCore;
