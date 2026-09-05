import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, deserialize, hintKey, interact, serialize, travel } from '../src/game.ts';
import { arrivalAt, houseDistrictAt, houseExterior, visitDistrict } from '../src/scene-layout.ts';
import { carriesLight, grueTiming, hasLight } from '../src/darkness.ts';
import { ROOMS } from '../src/campaign.ts';

test('existing outdoor saves migrate into the shared landscape without losing discoveries', () => {
  for (const [room, local, expected, turn] of [
    ['behind_house', [3, -6], [-3, -17.2], Math.PI],
    ['forest', [-7, -5], [-41, 7], Math.PI / 2],
    ['west_house', [-5, -3], [-5, -3], 0],
  ] as const) {
    const old = createGame(); old.version = 1; old.room = room; old.position = [...local]; old.yaw = 0.4;
    old.flags.window_open = true; old.inventory.push('egg');
    const restored = deserialize(serialize(old)); assert.ok(restored);
    assert.equal(restored.version, 2); assert.deepEqual(restored.position, [...expected]);
    assert.equal(restored.yaw, 0.4 + turn); assert.equal(restored.flags.window_open, true);
    assert.deepEqual(restored.inventory, ['egg']);
    assert.deepEqual(deserialize(serialize(restored))?.position, [...expected], 'migration must happen only once');
  }
});

test('current saves retain locations outside the former individual room rectangles', () => {
  const state = createGame(); state.room = 'forest'; state.position = [-51.8, -20.3]; state.yaw = 2.1;
  const restored = deserialize(serialize(state)); assert.ok(restored);
  assert.deepEqual(restored.position, state.position); assert.equal(restored.yaw, state.yaw);
});

test('ordinary paths share objects and preserve motion while districts change', () => {
  const state = createGame(), exterior = houseExterior(state);
  assert.equal(exterior.objects.filter(object => object.id === 'kitchen_window').length, 1);
  const window = exterior.objects.find(object => object.id === 'kitchen_window')!;
  assert.deepEqual(window.position, [0, 0, -17.2]); assert.equal(window.yaw, Math.PI);
  assert.equal(window.district, 'behind_house');
  assert.equal(exterior.exits.some(exit => ['west_house', 'behind_house', 'forest'].includes(exit.to)), false);
  assert.equal(exterior.exits.some(exit => exit.to === 'barrow'), false, 'an undiscovered road must not advertise a future unlock');
  state.position = [8, -24]; state.yaw = 1.3;
  assert.equal(houseDistrictAt(state.position, 'west_house'), 'behind_house');
  assert.equal(visitDistrict(state, 'behind_house'), true);
  assert.deepEqual(state.position, [8, -24]); assert.equal(state.yaw, 1.3);
  const entries = state.journal.length;
  visitDistrict(state, 'west_house'); visitDistrict(state, 'behind_house');
  assert.equal(state.journal.length, entries, 'walking back around a corner must not repeat discoveries');
  assert.equal(houseDistrictAt([-17.7, -1], 'forest'), 'forest', 'overlap prevents boundary flicker');
});

test('returning through a real threshold emerges beside that threshold', () => {
  const state = createGame(); state.room = 'behind_house'; Object.assign(state, arrivalAt(state.room));
  interact(state, 'kitchen_window'); interact(state, 'kitchen_window');
  assert.equal(state.room, 'kitchen'); assert.deepEqual(state.position, [3.8, 2.5]);
  assert.equal(travel(state, 'kitchen_to_behind_house').success, true);
  assert.deepEqual(state.position, [0, -19.2]); assert.equal(state.flags.window_open, true);
  state.room = 'maze'; state.inventory.push('skeleton_key');
  assert.equal(interact(state, 'maze_grate', 'use:skeleton_key').success, true);
  assert.equal(interact(state, 'maze_grate').travel, 'forest');
  assert.deepEqual(state.position, [-31, 9.3]);
});

test('maze arrivals stay beside the passage or grating actually used', () => {
  for (const from of ['troll_bridge', 'cyclops']) {
    const state = createGame(); state.room = from; state.flags.troll_defeated = true;
    assert.equal(travel(state, `${from}_to_maze`).travel, 'maze');
    const threshold = ROOMS.maze.exits.find(exit => exit.to === from)!;
    assert.ok(Math.hypot(state.position[0] - threshold.position[0], state.position[1] - threshold.position[1]) < 3.5,
      `returning from ${from} should retain its visible doorway as a nearby landmark`);
    const towardRoom = -Math.sin(state.yaw) * -state.position[0] - Math.cos(state.yaw) * -state.position[1];
    assert.ok(towardRoom > 0, 'the arrival faces into the room');
  }
  const state = createGame(); state.room = 'maze'; state.inventory.push('skeleton_key');
  assert.equal(interact(state, 'maze_grate', 'use:skeleton_key').success, true);
  assert.equal(interact(state, 'maze_grate').travel, 'forest');
  assert.equal(interact(state, 'forest_grate').travel, 'maze');
  const grate = ROOMS.maze.objects.find(object => object.id === 'maze_grate')!;
  assert.ok(Math.hypot(state.position[0] - grate.position[0], state.position[1] - grate.position[2]) < 3,
    'the round trip emerges beside the real grating instead of a distant default spawn');
  const restored = deserialize(serialize(state)); assert.ok(restored);
  assert.deepEqual(restored.position, state.position);
  assert.equal(restored.flags.grate_open, true);
});

test('grues respect both portable light and a nearby visible flame', () => {
  const state = createGame(); state.room = 'cellar';
  assert.equal(hasLight(state), false);
  state.inventory.push('lantern'); state.lantern = true; assert.equal(hasLight(state), true);
  state.lantern = false; assert.equal(hasLight(state), false);
  state.inventory.push('torch'); assert.equal(carriesLight(state), true);
  state.inventory = ['lantern']; state.deposited.push('torch'); assert.equal(hasLight(state), false);
  state.room = 'dome'; state.position = [6, -5]; state.flags.dome_secured = true;
  assert.equal(hasLight(state), true);
  state.position = [0, 10]; assert.equal(hasLight(state), false);
  state.position = [6, -5]; state.flags.picked_torch = true; assert.equal(hasLight(state), false);
});

test('darkness allows a clear warning and recovery opportunity at every challenge', () => {
  const state = createGame();
  for (const difficulty of ['explorer', 'adventurer', 'veteran'] as const) {
    state.settings.difficulty = difficulty;
    const timing = grueTiming(state);
    assert.ok(timing.grace >= 10, 'the player has time to notice the warning and light a lamp');
    assert.ok(timing.damage <= 40, 'a first grue strike is recoverable from full health');
    assert.ok(timing.interval >= 2.8, 'there is a real chance to react between attacks');
  }
});

test('spoken solutions are supplied by the player and wrong words do not advance the puzzle', () => {
  const state = createGame(); state.room = 'loud_room';
  const prompt = interact(state, 'echo_stone');
  assert.ok(prompt.prompt); assert.equal(prompt.choices?.length, 0);
  assert.doesNotMatch(prompt.message, /\becho\b/i);
  interact(state, 'echo_stone', 'say:Hello'); assert.equal(state.flags.echo_solved, undefined);
  assert.equal(interact(state, 'echo_stone', 'say:ECHO!').success, true);
  assert.equal(state.flags.echo_solved, true);
  state.room = 'cyclops';
  const cyclops = interact(state, 'cyclops'); assert.ok(cyclops.prompt);
  assert.equal(cyclops.choices?.length, 0, 'unseen food and water are not offered');
  interact(state, 'cyclops', 'say:Hello'); assert.equal(state.flags.cyclops_fled, undefined);
  interact(state, 'cyclops', 'say:Ulysses'); assert.equal(state.flags.cyclops_fled, true);
});

test('normal observations do not reveal remote tools or future solutions', () => {
  const state = createGame();
  const leaflet = interact(state, 'mailbox'); assert.match(leaflet.message, /adventure, danger, and low cunning/);
  assert.doesNotMatch(leaflet.message, /window|nineteen|last road/i);
  for (const [room, object, spoilers] of [
    ['forest', 'songbird_perch', /canary|egg|thief/i],
    ['dome', 'dome_railing', /attic/i],
    ['dam_base', 'folded_boat', /reservoir|pump/i],
    ['falls', 'rainbow_ledge', /sceptre|coffin|egypt/i],
  ] as const) {
    state.room = room; const result = interact(state, object);
    assert.notEqual(result.message, 'There is nothing here by that name.');
    assert.doesNotMatch(result.message, spoilers);
  }
  state.room = 'maintenance';
  const controls = interact(state, 'control_buttons'); assert.equal(controls.choices?.length, 4);
  for (const choice of controls.choices ?? []) assert.doesNotMatch(choice.label, /enable|isolate|pressure|lamp/i);
});

test('a new puzzle starts with its own hint tier even when the HUD observation stays the same', () => {
  const state = createGame(); state.room = 'living_room';
  interact(state, 'lantern');
  const swordPuzzle = hintKey(state);
  interact(state, 'sword');
  const carpetPuzzle = hintKey(state);
  assert.notEqual(carpetPuzzle, swordPuzzle, 'two sword hints must not disclose the carpet solution');
  state.room = 'kitchen'; state.room = 'living_room';
  assert.equal(hintKey(state), carpetPuzzle, 'returning to the same unfinished puzzle preserves its hint progress');
  interact(state, 'carpet');
  assert.notEqual(hintKey(state), carpetPuzzle, 'a solved puzzle cannot retain its old answer');
});

test('mill experimentation survives a save and preserves a recoverable cargo path', () => {
  let state = createGame();
  state.room = 'coal_mine'; state.inventory = ['coal', 'screwdriver', 'torch', 'lantern']; state.lantern = true;
  assert.equal(interact(state, 'lift_basket', 'lower').success, true);
  assert.equal(travel(state, 'coal_mine_to_machine_room').success, true);
  assert.equal(interact(state, 'lowered_basket').success, true);
  const cargo = [...state.inventory];

  const actions = interact(state, 'pressure_mill').choices?.map(choice => choice.action) ?? [];
  assert.ok(actions.includes('close') && actions.includes('turn') && actions.includes('load'),
    'physical controls must remain available before the correct operation is discovered');
  assert.equal(interact(state, 'pressure_mill', 'close').success, true, 'the empty chamber can be closed');
  interact(state, 'pressure_mill', 'use:screwdriver');
  assert.equal(Boolean(state.flags.diamond_created), false, 'running an empty chamber cannot create a reward');
  assert.deepEqual(state.inventory, cargo, 'an empty run consumes neither cargo nor the service tool');
  assert.equal(interact(state, 'pressure_mill', 'load').success, false, 'coal cannot pass through the closed lid');
  assert.deepEqual(state.inventory, cargo, 'a rejected load leaves the coal in the satchel');

  const restored = deserialize(serialize(state)); assert.ok(restored); state = restored;
  assert.equal(state.flags.machine_closed, true, 'the mistaken configuration survives save and restore');
  assert.equal(interact(state, 'pressure_mill', 'open').success, true);
  assert.equal(interact(state, 'pressure_mill', 'load').success, true);
  assert.equal(state.inventory.includes('coal'), false);
  assert.equal(interact(state, 'pressure_mill', 'use:screwdriver').success, false, 'the open chamber cannot run');
  assert.equal(Boolean(state.flags.diamond_created), false);
  assert.equal(state.flags.machine_loaded, true, 'the interlock preserves the loaded sample');

  assert.equal(interact(state, 'pressure_mill', 'close').success, true);
  assert.equal(interact(state, 'pressure_mill', 'use:screwdriver').success, true);
  assert.equal(state.flags.diamond_created, true, 'the player can recover and finish after incorrect attempts');
  assert.equal(interact(state, 'diamond').success, true);
  interact(state, 'pressure_mill', 'turn');
  interact(state, 'diamond');
  assert.equal(state.inventory.filter(id => id === 'diamond').length, 1, 'repeated operation cannot duplicate the reward');
  assert.ok(state.inventory.includes('screwdriver') && state.inventory.includes('torch'), 'reusable cargo remains available');
});
