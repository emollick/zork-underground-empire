import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, REST_ROOMS, ROOMS, START_ROOM, TREASURES } from '../src/campaign.ts';
import { allTreasuresDeposited, createGame, defeatEnemy, deserialize, hints, interact, objective, retryFromCheckpoint, serialize, travel } from '../src/game.ts';
import { BALANCE } from '../src/combat.ts';
import type { GameState } from '../src/types.ts';

function act(state: GameState, id: string, choice?: string): void {
  const result = interact(state, id, choice);
  assert.equal(result.success, true, `${state.room}: ${id} ${choice ?? ''}: ${result.message}`);
}

// Walk only through actual campaign exits and satisfied gates. This deliberately
// does not set room, flags, inventories or puzzle outcomes directly.
function go(state: GameState, destination: string): void {
  const queue: { room: string; route: string[] }[] = [{ room: state.room, route: [] }];
  const seen = new Set<string>();
  let route: string[] | undefined;
  while (queue.length) {
    const current = queue.shift()!;
    if (current.room === destination) { route = current.route; break; }
    if (seen.has(current.room)) continue;
    seen.add(current.room);
    for (const exit of ROOMS[current.room].exits) {
      if (!exit.requires || state.flags[exit.requires]) queue.push({ room: exit.to, route: [...current.route, exit.id] });
    }
  }
  assert.ok(route, `No open route from ${state.room} to ${destination}`);
  for (const exitId of route) assert.equal(travel(state, exitId).success, true, exitId);
  assert.equal(state.room, destination);
}

function begin(): GameState {
  const state = createGame();
  act(state, 'mailbox'); go(state, 'behind_house'); act(state, 'kitchen_window');
  go(state, 'kitchen'); for (const id of ['lunch', 'water', 'garlic']) act(state, id);
  go(state, 'attic'); act(state, 'rope');
  go(state, 'living_room'); act(state, 'lantern'); act(state, 'sword'); act(state, 'carpet'); act(state, 'house_hearth');
  go(state, 'forest'); act(state, 'egg');
  go(state, 'troll_bridge');
  assert.equal(travel(state, 'troll_bridge_to_round_room').success, false);
  // Combat is tested by the application owner; this is its explicit outcome API.
  assert.equal(defeatEnemy(state, 'troll').success, true);
  go(state, 'round_room'); act(state, 'surveyor_fire');
  return state;
}

test('opening a visible window and hatch creates an immediately usable passage at that spot', () => {
  const state = createGame();
  go(state, 'behind_house');
  act(state, 'kitchen_window');
  assert.equal(state.room, 'behind_house', 'opening the window should first show the changed opening');
  const climb = interact(state, 'kitchen_window');
  assert.equal(climb.success, true); assert.equal(climb.travel, 'kitchen'); assert.equal(state.room, 'kitchen');
  go(state, 'living_room');
  assert.equal(interact(state, 'cellar_hatch').success, false, 'the hatch is concealed by the carpet');
  act(state, 'carpet');
  const descend = interact(state, 'cellar_hatch');
  assert.equal(descend.success, true); assert.equal(descend.travel, 'cellar'); assert.equal(state.room, 'cellar');
  go(state, 'living_room');
  assert.equal(state.flags.trapdoor_open, true, 'returning through a shortcut cannot close the stairs');
  assert.equal(interact(state, 'cellar_hatch').success, true);
});

test('campaign has a complete, reciprocal graph with nineteen depositable treasures', () => {
  assert.equal(Object.keys(ROOMS).length, 30);
  assert.equal(TREASURES.length, 19);
  assert.equal(new Set(TREASURES).size, 19);
  assert.equal(TREASURES.includes('ancient_map'), false);
  const objectIds = new Set<string>();
  for (const room of Object.values(ROOMS)) {
    assert.ok(room.exits.length > 0, `${room.id} has no exit`);
    assert.ok(Math.abs(room.spawn[0]) < room.size[0] / 2 && Math.abs(room.spawn[1]) < room.size[1] / 2);
    for (const exit of room.exits) {
      assert.ok(ROOMS[exit.to], `${exit.id} has no destination`);
      assert.ok(ROOMS[exit.to].exits.some(back => back.to === room.id), `${exit.id} has no return passage`);
      assert.ok(Math.abs(exit.position[0]) <= room.size[0] / 2 && Math.abs(exit.position[1]) <= room.size[1] / 2, `${exit.id} is outside its room`);
      if (exit.requires) assert.ok(exit.blocked, `${exit.id} needs an understandable blocked message`);
    }
    for (const object of room.objects) {
      assert.ok(!objectIds.has(object.id), `duplicate object id ${object.id}`);
      objectIds.add(object.id);
      assert.ok(Math.abs(object.position[0]) < room.size[0] / 2 && Math.abs(object.position[2]) < room.size[1] / 2, `${object.id} is outside its room`);
      if (object.item) assert.ok(ITEMS[object.item], `${object.id} references an unknown item`);
    }
  }
  for (const id of REST_ROOMS) assert.ok(ROOMS[id].objects.some(object => object.action === 'rest'));
});

test('an actual exit-and-interaction route recovers every treasure and reaches the ending', () => {
  let state = begin();
  go(state, 'gallery'); act(state, 'painting');
  go(state, 'maze'); act(state, 'coins'); act(state, 'skeleton_key'); act(state, 'maze_grate', 'use:skeleton_key'); act(state, 'cyclops_legend');
  go(state, 'cyclops'); act(state, 'cyclops', 'name');
  go(state, 'treasure_room');
  assert.equal(interact(state, 'chalice').success, false, 'chalice must remain guarded');
  assert.equal(defeatEnemy(state, 'thief').success, true);
  assert.equal(interact(state, 'locksmith_table', 'use:fine_picks').success, false, 'collect the fine picks before using them');
  act(state, 'fine_picks'); act(state, 'locksmith_table', 'use:fine_picks'); act(state, 'chalice');
  assert.ok(state.inventory.includes('egg') && state.inventory.includes('canary'), 'thief-first route retains both treasures');
  go(state, 'forest'); act(state, 'songbird_perch', 'use:canary'); act(state, 'bauble');
  go(state, 'dome'); act(state, 'dome_railing', 'use:rope'); act(state, 'torch');
  go(state, 'temple'); act(state, 'bell'); act(state, 'candles'); act(state, 'black_book'); act(state, 'temple_fire'); act(state, 'temple_mirror');
  go(state, 'atlantis');
  assert.equal(interact(state, 'trident').success, false, 'mirror must not bypass the flooded reservoir');
  assert.equal(travel(state, 'atlantis_to_reservoir').success, false);
  go(state, 'egypt'); act(state, 'gold_coffin');
  assert.equal(interact(state, 'gold_coffin').success, false, 'sceptre is secured before the coffin can disappear');
  act(state, 'sceptre'); act(state, 'gold_coffin');
  go(state, 'hades'); act(state, 'hades_lectern', 'bell');
  assert.equal(interact(state, 'hades_lectern', 'candles').success, false, 'matches are still needed');
  go(state, 'loud_room'); act(state, 'echo_stone', 'echo'); act(state, 'platinum_bar');
  go(state, 'dam'); act(state, 'dam_fire');
  go(state, 'maintenance'); for (const id of ['wrench', 'screwdriver', 'putty', 'matches']) act(state, id);
  act(state, 'control_buttons', 'blue'); act(state, 'control_buttons', 'yellow');
  go(state, 'dam'); assert.equal(interact(state, 'dam_bolt', 'use:wrench').success, false, 'a pressure leak prevents operation');
  go(state, 'maintenance'); act(state, 'leaking_pipe', 'use:putty');
  go(state, 'dam'); act(state, 'dam_bolt', 'use:wrench');
  go(state, 'reservoir'); act(state, 'jewel_trunk'); act(state, 'pump');
  go(state, 'atlantis'); act(state, 'trident');
  go(state, 'hades'); act(state, 'hades_lectern', 'candles'); act(state, 'hades_lectern', 'book'); act(state, 'skull');

  // Banking a useful treasure cannot destroy a later puzzle solution.
  go(state, 'living_room'); act(state, 'trophy_case', 'deposit');
  assert.ok(state.deposited.includes('torch') && state.deposited.includes('sceptre'));
  go(state, 'bat_cavern'); act(state, 'bat_roost', 'use:garlic'); act(state, 'jade');
  go(state, 'coal_mine'); act(state, 'gas_notice', 'use:lantern'); act(state, 'bracelet'); act(state, 'coal');
  const absentTorch = interact(state, 'lift_basket', 'lower');
  assert.equal(absentTorch.success, false); assert.match(absentTorch.message, /borrow/i);
  go(state, 'living_room'); act(state, 'trophy_case', 'borrow:torch');
  go(state, 'coal_mine'); act(state, 'lift_basket', 'lower');
  assert.ok(!state.inventory.includes('torch') && state.flags.basket_torch, 'cargo is physically removed until collected');

  // Reload while the only coal and an important treasure are in transit.
  const packed = serialize(state);
  const restored = deserialize(packed); assert.ok(restored);
  assert.deepEqual(restored, state);
  state = restored;
  go(state, 'machine_room'); act(state, 'lowered_basket');
  assert.equal(interact(state, 'pressure_mill', 'use:screwdriver').success, false);
  act(state, 'pressure_mill', 'close');
  assert.match(hints(state)[2], /open.*lid/i, 'closing the empty mill must produce a usable recovery hint');
  act(state, 'pressure_mill', 'open');
  assert.match(hints(state)[2], /load.*coal/i, 'an opened empty chamber advances to loading instead of repeating the lid instruction');
  act(state, 'pressure_mill', 'load'); act(state, 'pressure_mill', 'close');
  const switchChoice = interact(state, 'pressure_mill', 'turn');
  assert.equal(switchChoice.itemSelection, true, 'turning the switch still requires choosing a tool');
  assert.equal(state.flags.diamond_created, undefined);
  act(state, 'pressure_mill', 'use:screwdriver'); act(state, 'diamond');
  assert.doesNotMatch(hints(state)[2], /close|START/i, 'the completed mill directs the player onward');
  assert.ok(state.inventory.includes('torch'), 'the freight torch remains recoverable');
  go(state, 'coal_mine');
  const emptyBasket = interact(state, 'lift_basket');
  assert.equal(emptyBasket.success, true);
  assert.match(emptyBasket.message, /empty|collected/i, 'returning to the shaft acknowledges that the cargo has already been collected');
  assert.doesNotMatch(emptyBasket.message, /retrieve.*cargo/i, 'an empty basket must not start another retrieval loop');
  go(state, 'dam_base'); act(state, 'folded_boat', 'use:pump');
  go(state, 'river'); act(state, 'river_buoy');
  assert.equal(interact(state, 'river_landing', 'current').success, false);
  act(state, 'river_landing', 'shore');
  go(state, 'sandy_cave'); act(state, 'shovel'); act(state, 'sand_drift', 'use:shovel'); act(state, 'scarab');
  const excavated = interact(state, 'sand_drift');
  assert.equal(excavated.success, true);
  assert.doesNotMatch(excavated.message, /scarab is exposed|scarab.*waits/i, 'the excavated drift must not promise a scarab already in the satchel');
  assert.equal(state.inventory.filter(id => id === 'scarab').length, 1);
  go(state, 'falls');
  const absentSceptre = interact(state, 'rainbow_ledge', 'use:sceptre');
  assert.equal(absentSceptre.success, false);
  assert.equal(absentSceptre.itemSelection, true);
  assert.equal(state.flags.rainbow_solid, undefined, 'a displayed sceptre cannot be used from across the empire');
  go(state, 'living_room'); act(state, 'trophy_case', 'borrow:sceptre');
  go(state, 'falls'); act(state, 'rainbow_ledge', 'use:sceptre'); act(state, 'gold');
  const emptyRainbow = interact(state, 'rainbow_ledge');
  assert.equal(emptyRainbow.success, true);
  assert.doesNotMatch(emptyRainbow.message, /gold.*waits/i, 'the rainbow remains a route after its gold has been collected');
  assert.equal(state.inventory.filter(id => id === 'gold').length, 1);
  assert.ok(TREASURES.every(id => state.inventory.includes(id) || state.deposited.includes(id)), 'every treasure can be recovered without a state shortcut');
  go(state, 'living_room'); act(state, 'trophy_case', 'deposit');
  assert.equal(allTreasuresDeposited(state), true);
  assert.equal(state.completed, false, 'depositing is not the final ending trigger');
  go(state, 'cellar'); state.lantern = false;
  assert.match(objective(state).text, /pitch black/i, 'the completed collection must not hide an immediate darkness hazard');
  assert.match(hints(state)[2], /lantern|press L/i, 'requested help must restore light before directing the player to the ending');
  state.lantern = true; go(state, 'living_room');
  act(state, 'ancient_map');
  act(state, 'trophy_case', 'borrow:egg'); go(state, 'barrow');
  assert.match(hints(state)[2], /deposit|return.*case/i, 'a player carrying a borrowed treasure needs a usable next step at the barrow');
  assert.equal(interact(state, 'barrow_threshold').success, false, 'the borrowed egg must return to the display before the first ending');
  go(state, 'living_room'); act(state, 'trophy_case', 'deposit');
  go(state, 'barrow'); const ending = interact(state, 'barrow_threshold');
  assert.equal(ending.ending, true); assert.equal(state.completed, true);
  assert.equal(state.visited.length, 30, 'the route actually visits the complete campaign');
  assert.deepEqual(deserialize(serialize(state)), state, 'a completed expedition survives save/reload');
  go(state, 'living_room'); act(state, 'trophy_case', 'borrow:torch');
  assert.equal(allTreasuresDeposited(state), false, 'borrowing still changes the physical display');
  const afterBorrow = deserialize(serialize(state)); assert.ok(afterBorrow);
  assert.equal(afterBorrow.completed, true, 'continuing to explore with a borrowed treasure must not revoke the earned ending');
  assert.equal(afterBorrow.inventory.includes('torch'), true);
  assert.equal(objective(afterBorrow).title, 'Master Adventurer');
});

test('the food-and-water cyclops route also opens the treasury without consuming failed offerings', () => {
  const state = begin(); go(state, 'maze'); go(state, 'cyclops');
  assert.equal(interact(state, 'cyclops', 'water').success, false);
  assert.ok(state.inventory.includes('water'));
  act(state, 'cyclops', 'feed'); assert.equal(state.inventory.includes('lunch'), false);
  act(state, 'cyclops', 'water'); assert.equal(state.flags.cyclops_passed, true);
  go(state, 'treasure_room');
  act(state, 'locksmith_table', 'offer');
  assert.ok(state.inventory.includes('egg') && state.inventory.includes('canary'));
  assert.equal(state.flags.thief_defeated, undefined, 'the living thief can open the egg');
});

test('the explorer’s allusion preserves the name puzzle until the explicit solution hint', () => {
  const state = begin(); go(state, 'maze');
  act(state, 'skeleton_key'); act(state, 'maze_grate', 'use:skeleton_key');
  const note = interact(state, 'cyclops_legend');
  assert.equal(note.success, true);
  assert.match(note.message, /Nobody.*Ithaca/i, 'the written clue must offer a recognizable literary connection');
  assert.doesNotMatch(note.message, /Odysseus|Ulysses/i, 'reading the clue should not supply the literal answer');
  assert.doesNotMatch(state.journal.find(entry => entry.id === 'cyclops_legend')!.text, /Odysseus|Ulysses/i);
  assert.doesNotMatch(hints(state).slice(0, 2).join(' '), /Odysseus|Ulysses/i);
  assert.match(hints(state)[2], /Odysseus|Ulysses/i, 'the requested solution remains available to players unfamiliar with the Odyssey');
  go(state, 'cyclops');
  const conversation = interact(state, 'cyclops');
  assert.equal(conversation.prompt?.action, 'say');
  assert.ok(conversation.choices?.every(choice => !/Odysseus|Ulysses/i.test(choice.label)), 'ordinary conversation must not contain an answer button');
  assert.doesNotMatch(hints(state).slice(0, 2).join(' '), /Odysseus|Ulysses/i);
  assert.match(hints(state)[2], /Odysseus|Ulysses/i);
  act(state, 'cyclops', 'say:Odysseus');
  assert.equal(state.flags.cyclops_fled, true);
  go(state, 'treasure_room');
});

test('early display of the egg and canary preserves both later puzzle uses', () => {
  const state = begin();
  go(state, 'living_room'); act(state, 'trophy_case', 'deposit');
  assert.ok(state.deposited.includes('egg'));
  go(state, 'maze'); act(state, 'cyclops_legend');
  go(state, 'cyclops'); act(state, 'cyclops', 'say:Odysseus');
  go(state, 'treasure_room'); assert.equal(defeatEnemy(state, 'thief').success, true); act(state, 'fine_picks');
  const absentEgg = interact(state, 'locksmith_table', 'use:fine_picks');
  assert.equal(absentEgg.success, false); assert.match(absentEgg.message, /borrow/i);
  assert.equal(state.flags.egg_open, undefined);
  go(state, 'living_room'); act(state, 'trophy_case', 'borrow:egg');
  go(state, 'treasure_room'); act(state, 'locksmith_table', 'use:fine_picks');
  assert.ok(state.inventory.includes('egg') && state.inventory.includes('canary'));
  go(state, 'living_room'); act(state, 'trophy_case', 'deposit');
  assert.ok(state.deposited.includes('canary'));
  go(state, 'forest');
  const absentCanary = interact(state, 'songbird_perch', 'use:canary');
  assert.equal(absentCanary.success, false);
  assert.equal(absentCanary.itemSelection, true);
  assert.equal(state.flags.bauble_revealed, undefined, 'a displayed canary cannot sing from across the forest');
  go(state, 'living_room'); act(state, 'trophy_case', 'borrow:canary');
  go(state, 'forest'); act(state, 'songbird_perch', 'use:canary'); act(state, 'bauble');
  assert.equal(state.inventory.filter(id => id === 'bauble').length, 1);
  assert.ok(state.deposited.includes('egg'), 'opening the egg leaves the separate egg treasure recoverable');
});

test('gates, duplicate pickups and invalid remote interactions cannot manufacture progress', () => {
  const state = createGame();
  assert.equal(interact(state, 'diamond').success, false);
  assert.equal(defeatEnemy(state, 'thief').success, false);
  assert.equal(travel(state, 'west_house_to_barrow').success, false);
  go(state, 'behind_house');
  assert.equal(travel(state, 'behind_house_to_kitchen').success, false);
  act(state, 'kitchen_window'); go(state, 'living_room');
  assert.equal(interact(state, 'ancient_map').success, false);
  act(state, 'lantern'); assert.equal(state.lantern, true);
  assert.equal(interact(state, 'lantern').success, false);
  assert.equal(state.inventory.filter(id => id === 'lantern').length, 1);
  assert.equal(interact(state, 'trophy_case', 'borrow:diamond').success, false);
});

test('every stage offers an ordered three-level hint, and local mechanisms have nearby clues', () => {
  const state = begin();
  for (const room of Object.values(ROOMS)) {
    // Hint rendering is read-only and must tolerate being inspected from any room.
    const sample = { ...state, room: room.id };
    const entries = hints(sample);
    assert.equal(entries.length, 3, room.id);
    assert.ok(entries.every(value => value.length > 15 && !/TODO|demo|placeholder/i.test(value)));
    assert.ok(objective(sample).title && objective(sample).text);
  }
  for (const roomId of ['maze', 'cyclops', 'treasure_room', 'dome', 'temple', 'hades', 'loud_room', 'dam', 'maintenance', 'bat_cavern', 'coal_mine', 'machine_room', 'river', 'sandy_cave', 'falls']) {
    assert.ok(ROOMS[roomId].objects.some(object => object.action === 'read' || object.action === 'cyclops_legend'), `${roomId} lacks a local clue`);
  }
});

test('guidance advances after entry and a solved dam instead of sending the player through a finished loop', () => {
  const entering = createGame();
  go(entering, 'behind_house'); act(entering, 'kitchen_window'); act(entering, 'kitchen_window');
  assert.equal(entering.room, 'kitchen');
  assert.match(objective(entering).text, /passage.*west.*staircase/i, 'inside guidance describes the visible ways onward');
  assert.ok(hints(entering).every(value => !/behind the house|open the window/i.test(value)), 'entry guidance should recognize that the player is already inside');
  go(entering, 'living_room');
  assert.match(hints(entering)[2], /lantern/i);

  const drained = begin();
  go(drained, 'maintenance'); act(drained, 'wrench'); act(drained, 'control_buttons', 'yellow');
  go(drained, 'dam'); act(drained, 'dam_bolt', 'use:wrench');
  assert.equal(drained.flags.reservoir_drained, true);
  assert.match(hints(drained)[2], /reservoir/i);
  assert.ok(hints(drained).every(value => !/press yellow|turn the bolt|enable.*controls/i.test(value)), 'the next nudge should lead to the reward, not repeat the completed solution');
});

test('rest restores health and stores a safe return without deleting expedition progress', () => {
  const state = begin(); state.health = 19; state.stamina = 3;
  const pack = [...state.inventory]; act(state, 'surveyor_fire');
  assert.equal(state.health, 100); assert.equal(state.stamina, 100); assert.equal(state.checkpoint, 'round_room');
  assert.deepEqual(state.inventory, pack); assert.equal(state.flags.troll_defeated, true);
  assert.equal(deserialize(serialize(state))?.checkpoint, 'round_room');
});

test('early observations preserve discovery and exact puzzle answers require the third hint', () => {
  const first = createGame();
  assert.doesNotMatch([objective(first).text, ...hints(first).slice(0, 2)].join(' '), /window|lantern|sword|trap.?door|barrow|canary/i);
  act(first, 'mailbox');
  assert.doesNotMatch(hints(first).slice(0, 2).join(' '), /kitchen window|climb inside|lantern/i);
  assert.match(hints(first)[2], /small window/i, 'the explicitly requested solution must still make the opening usable');
  go(first, 'forest');
  assert.doesNotMatch([objective(first).text, ...hints(first)].join(' '), /canary|thief|worktable/i, 'an undiscovered egg must not advertise its hidden contents or a distant locksmith');
  act(first, 'egg');
  assert.doesNotMatch([objective(first).text, ...hints(first).slice(0, 2)].join(' '), /canary|thief|worktable/i);
  assert.match(hints(first)[2], /worktable/i);
  assert.doesNotMatch(hints(first).join(' '), /canary/i, 'help opening the egg need not reveal what is inside');

  const underground = begin();
  go(underground, 'dome');
  assert.doesNotMatch([objective(underground).text, ...hints(underground).slice(0, 2)].join(' '), /attic|bring.*rope|use.*rope/i);
  assert.match(hints(underground)[2], /rope.*attic/i);
  go(underground, 'dam');
  assert.doesNotMatch([objective(underground).text, ...hints(underground).slice(0, 2)].join(' '), /yellow|wrench/i);
  assert.match(hints(underground)[2], /yellow.*wrench/i);
  go(underground, 'loud_room');
  assert.doesNotMatch([objective(underground).text, ...hints(underground).slice(0, 2)].join(' '), /\becho\b/i);
  assert.match(hints(underground)[2], /type.*Echo/i);
  act(underground, 'echo_stone', 'say:Echo');
  assert.match(hints(underground)[2], /take.*platinum/i);
  assert.doesNotMatch(hints(underground)[2], /type|call/i, 'a solved word puzzle must advance to its visible reward');
});

test('darkness guidance recognizes an earned torch even when the lantern is switched off', () => {
  const state = begin();
  go(state, 'dome'); act(state, 'dome_railing', 'use:rope'); act(state, 'torch');
  go(state, 'cellar'); state.lantern = false;
  assert.doesNotMatch([objective(state).text, ...hints(state)].join(' '), /pitch black|eaten by a grue|turn on.*lantern/i);
  go(state, 'living_room'); act(state, 'trophy_case', 'deposit');
  go(state, 'cellar');
  assert.match(objective(state).text, /pitch black.*eaten by a grue/i);
  assert.match(hints(state)[2], /Press L/i, 'a carried but unlit lantern remains a valid way out of danger');
  go(state, 'living_room'); act(state, 'trophy_case', 'borrow:torch');
  go(state, 'cellar');
  assert.doesNotMatch([objective(state).text, ...hints(state)].join(' '), /pitch black|eaten by a grue/i);
});

test('retry after a loaded death restarts the unfinished fight at the chosen challenge and keeps earned progress', () => {
  for (const difficulty of ['explorer', 'adventurer', 'veteran'] as const) {
    const state = begin(); state.settings.difficulty = difficulty;
    go(state, 'maze'); act(state, 'coins'); act(state, 'cyclops_legend');
    go(state, 'cyclops'); act(state, 'cyclops', 'name'); go(state, 'treasure_room');
    act(state, 'locksmith_table', 'offer');
    const maximum = Math.round(ROOMS.treasure_room.enemy!.health * BALANCE[difficulty].enemyHealth);
    state.enemies.thief = maximum - 72; state.health = 0; state.stamina = 2; state.lantern = false; state.deaths = 1;
    const loaded = deserialize(serialize(state)); assert.ok(loaded);
    const pack = [...loaded.inventory], flags = { ...loaded.flags }, journal = [...loaded.journal];
    const result = retryFromCheckpoint(loaded);
    assert.equal(result.travel, 'round_room'); assert.equal(loaded.room, 'round_room');
    assert.deepEqual(loaded.position, ROOMS.round_room.spawn); assert.equal(loaded.yaw, ROOMS.round_room.yaw ?? 0);
    assert.equal(loaded.health, 100); assert.equal(loaded.stamina, 100); assert.equal(loaded.lantern, true);
    assert.equal(loaded.enemies.thief, maximum, `${difficulty}: the living foe restarts with its actual scaled maximum`);
    assert.equal(loaded.enemies.troll, 0, 'a defeated keeper must remain defeated');
    assert.deepEqual(loaded.inventory, pack); assert.deepEqual(loaded.flags, flags); assert.deepEqual(loaded.journal, journal);
    assert.equal(loaded.deaths, 1, 'retry must not count the same death twice');
    assert.deepEqual(deserialize(serialize(loaded)), loaded, 'a retry remains stable through another save/reload');
  }
});

test('retry from darkness invents neither a lantern nor an undiscovered enemy and rejects an unsafe checkpoint', () => {
  const state = createGame();
  go(state, 'behind_house'); act(state, 'kitchen_window'); go(state, 'living_room'); act(state, 'carpet'); go(state, 'cellar');
  state.health = 0; state.checkpoint = 'treasure_room';
  retryFromCheckpoint(state);
  assert.equal(state.room, START_ROOM); assert.equal(state.checkpoint, START_ROOM);
  assert.equal(state.lantern, false); assert.deepEqual(state.enemies, {}); assert.deepEqual(state.inventory, []);
  assert.equal(state.flags.trapdoor_open, true);
});

test('save loading rejects corrupt, unknown and duplicate inventory data', () => {
  assert.equal(deserialize('not json'), null);
  assert.equal(deserialize('{}'), null);
  assert.equal(deserialize(JSON.stringify({ ...createGame(), version: 999 })), null);
  assert.equal(deserialize(JSON.stringify({ ...createGame(), room: 'unknown' })), null);
  assert.equal(deserialize(JSON.stringify({ ...createGame(), inventory: ['impossible'] })), null);
  assert.equal(deserialize(JSON.stringify({ ...createGame(), inventory: ['sword', 'sword'] })), null);
  assert.equal(deserialize(JSON.stringify({ ...createGame(), inventory: ['egg'], deposited: ['egg'] })), null);
  assert.equal(deserialize(JSON.stringify({ ...createGame(), deposited: ['lantern'] })), null);
  assert.equal(deserialize(JSON.stringify({ ...createGame(), flags: { bad: 'true' } })), null);
  assert.equal(deserialize(JSON.stringify({ ...createGame(), inventory: [...TREASURES], completed: true, flags: { map_found: true } }))?.completed, false, 'the barrow milestone is still required before a completed expedition can be restored');
  const restored = deserialize(serialize(createGame())); assert.ok(restored);
  assert.equal(restored.room, START_ROOM); assert.equal(restored.completed, false);
});

test('difficulty and scaled live enemy health survive save/restore without initializing undiscovered enemies', () => {
  assert.deepEqual(createGame().enemies, {}, 'first encounter initializes health at the chosen challenge');
  const empty = deserialize(serialize(createGame())); assert.ok(empty); assert.deepEqual(empty.enemies, {});
  for (const difficulty of ['explorer', 'adventurer', 'veteran'] as const) {
    const state = createGame(); state.settings.difficulty = difficulty;
    state.enemies.troll = Math.round(ROOMS.troll_bridge.enemy!.health * BALANCE[difficulty].enemyHealth) - 3;
    state.enemies.thief = Math.round(ROOMS.treasure_room.enemy!.health * BALANCE[difficulty].enemyHealth) - 5;
    const restored = deserialize(serialize(state)); assert.ok(restored);
    assert.equal(restored.settings.difficulty, difficulty);
    assert.deepEqual(restored.enemies, state.enemies, `${difficulty} must not clamp to the default encounter health`);
  }
  const unknown = deserialize(JSON.stringify({ ...createGame(), settings: { ...createGame().settings, difficulty: 'impossible' } }));
  assert.equal(unknown?.settings.difficulty, 'adventurer');
});
