import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../src/campaign.ts';
import { createGame, deserialize, interact, serialize, travel } from '../src/game.ts';
import { arrivalAt } from '../src/scene-layout.ts';
import type { ActionResult, GameState } from '../src/types.ts';

type Puzzle = {
  room: string; object: string; tool: string; flag: string; value?: boolean;
  flags?: Record<string, boolean>; prerequisites?: string[]; opening?: string;
  readyObject?: string; travel?: string;
};
// Explicit player choices, not a helper which finds or submits a valid menu item.
// Both faces of the grating exercise the same puzzle from different saved rooms.
const puzzles: Puzzle[] = [
  { room: 'maintenance', object: 'leaking_pipe', tool: 'putty', flag: 'dam_leak', value: false, flags: { dam_leak: true } },
  { room: 'bat_cavern', object: 'bat_roost', tool: 'garlic', flag: 'bat_quiet' },
  { room: 'maze', object: 'maze_grate', tool: 'skeleton_key', flag: 'grate_open', travel: 'forest' },
  { room: 'forest', object: 'forest_grate', tool: 'skeleton_key', flag: 'grate_open', travel: 'maze' },
  { room: 'dome', object: 'dome_railing', tool: 'rope', flag: 'dome_secured', readyObject: 'secured_dome_rope', travel: 'temple' },
  { room: 'forest', object: 'songbird_perch', tool: 'canary', flag: 'bauble_revealed' },
  { room: 'dam', object: 'dam_bolt', tool: 'wrench', flag: 'reservoir_drained', flags: { controls_enabled: true } },
  { room: 'dam_base', object: 'folded_boat', tool: 'pump', flag: 'boat_ready' },
  { room: 'sandy_cave', object: 'sand_drift', tool: 'shovel', flag: 'scarab_revealed' },
  { room: 'falls', object: 'rainbow_ledge', tool: 'sceptre', flag: 'rainbow_solid' },
  { room: 'treasure_room', object: 'locksmith_table', tool: 'fine_picks', flag: 'egg_open', flags: { thief_defeated: true }, prerequisites: ['egg'] },
  { room: 'machine_room', object: 'pressure_mill', tool: 'screwdriver', flag: 'diamond_created', flags: { machine_closed: true, machine_loaded: true }, opening: 'turn' },
  { room: 'coal_mine', object: 'gas_notice', tool: 'lantern', flag: 'gas_safe' },
];
const variedInventory = ['water', 'wrench', 'sword', 'shovel', 'putty', 'pump', 'skeleton_key', 'rope', 'garlic', 'lantern', 'canary', 'sceptre', 'fine_picks', 'egg', 'screwdriver', 'painting', 'coal', 'torch'];

function scene(puzzle: Puzzle, inventory = variedInventory): GameState {
  const state = createGame();
  state.room = puzzle.room; Object.assign(state, arrivalAt(state.room));
  state.yaw = .73; state.health = 62.5; state.stamina = 71.25;
  state.inventory = [...new Set(inventory)]; state.lantern = state.inventory.includes('lantern');
  state.visited = [...new Set([...state.visited, state.room])];
  state.flags = { troll_defeated: true, ...puzzle.flags };
  for (const id of state.inventory) state.flags[`picked_${id}`] = true;
  state.enemies = { troll: 0, thief: state.flags.thief_defeated ? 0 : 83 };
  state.deaths = 2; state.playTime = 1432.75;
  return state;
}
function assertInventoryMenu(result: ActionResult, state: GameState, context: string) {
  assert.equal(result.itemSelection, true, `${context}: the UI must identify an item picker, including an empty one`);
  const choices = result.choices ?? [];
  assert.deepEqual(choices.map(choice => choice.action).sort(), state.inventory.map(id => `use:${id}`).sort(),
    `${context}: every carried tool and treasure must be selectable without an answer filter`);
  for (const choice of choices) assert.equal(choice.label, ITEMS[choice.action.slice(4)].name, `${context}: item labels must not advertise correctness`);
  const labels = choices.map(choice => choice.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'en')), `${context}: target-independent alphabetic order`);
  assert.ok(result.title && result.message, `${context}: the picker must retain an observation of the target`);
}
function reloaded(state: GameState): GameState {
  const restored = deserialize(serialize(state)); assert.ok(restored);
  assert.deepEqual(restored, state, 'Saving must preserve all fields, without storing a pending answer or resetting progress');
  return restored;
}

test('inspection cannot solve any item-use puzzle and every chooser lists the full carried inventory', () => {
  for (const puzzle of puzzles) {
    const state = scene(puzzle), before = structuredClone(state);
    const result = interact(state, puzzle.object, puzzle.opening);
    assert.equal(result.success, true, puzzle.object);
    assertInventoryMenu(result, state, puzzle.object);
    assert.equal(result.feedback, undefined, 'opening an item picker is not a failed attempt');
    assert.deepEqual(state, before, `${puzzle.object}: mere inspection must not apply the correct item already in the satchel`);
    const restored = reloaded(state);
    assertInventoryMenu(interact(restored, puzzle.object, puzzle.opening), restored, puzzle.object);
    assert.deepEqual(restored, before, `${puzzle.object}: reopening after a save must remain an observation`);
  }
  const empty = scene(puzzles[1], []), before = structuredClone(empty);
  const result = interact(empty, 'bat_roost');
  assert.equal(result.success, true); assertInventoryMenu(result, empty, 'empty satchel');
  assert.deepEqual(result.choices, []); assert.deepEqual(empty, before);
});

test('wrong carried items and forged or no-longer-held selections are harmless and leave the chooser usable', () => {
  for (const puzzle of puzzles) {
    const state = scene(puzzle), opening = interact(state, puzzle.object, puzzle.opening);
    for (const id of state.inventory.filter(id => id !== puzzle.tool)) {
      const before = structuredClone(state), result = interact(state, puzzle.object, `use:${id}`);
      assert.equal(result.success, false, `${puzzle.object}: ${id} cannot substitute for the puzzle's tool`);
      assertInventoryMenu(result, state, `${puzzle.object}/${id}`);
      assert.equal(result.title, opening.title); assert.equal(result.message, opening.message);
      assert.ok(result.feedback?.length, 'a failed attempt must explain itself inside the retained picker');
      assert.deepEqual(state, before, `${puzzle.object}: a wrong item cannot consume an object, hurt the player, move them or alter any progress`);
    }
    for (const choice of ['use:missing_item', 'use:', `use:${puzzle.tool}:extra`]) {
      const before = structuredClone(state), result = interact(state, puzzle.object, choice);
      assert.equal(result.success, false); assertInventoryMenu(result, state, choice);
      assert.ok(result.feedback); assert.deepEqual(state, before);
    }
    state.inventory = state.inventory.filter(id => id !== puzzle.tool);
    if (puzzle.tool === 'lantern') state.lantern = false;
    const before = structuredClone(state), result = interact(state, puzzle.object, `use:${puzzle.tool}`);
    assert.equal(result.success, false, `${puzzle.object}: ownership must be checked at submission time`);
    assertInventoryMenu(result, state, puzzle.object); assert.deepEqual(state, before);
    reloaded(state);
  }
});

test('only the explicitly selected owned item applies each puzzle effect, retains reusable tools and survives reload', () => {
  for (const puzzle of puzzles) {
    const state = scene(puzzle, ['sword', 'lantern', ...puzzle.prerequisites ?? [], puzzle.tool]);
    const carried = [...state.inventory], position = [...state.position], room = state.room;
    const inspection = interact(state, puzzle.object, puzzle.opening);
    assert.equal(inspection.itemSelection, true);
    assert.notEqual(state.flags[puzzle.flag], puzzle.value ?? true, `${puzzle.object}: inspection did not solve it`);
    const result = interact(state, puzzle.object, `use:${puzzle.tool}`);
    assert.equal(result.success, true, `${puzzle.object}: explicit ${puzzle.tool} use should work`);
    assert.notEqual(result.itemSelection, true);
    assert.equal(state.flags[puzzle.flag], puzzle.value ?? true);
    assert.equal(state.room, room); assert.deepEqual(state.position, position, 'applying a tool does not also travel through the route it opened');
    assert.equal(state.health, 62.5); assert.equal(state.stamina, 71.25);
    assert.ok(carried.every(id => state.inventory.includes(id)), `${puzzle.object}: no reusable tool or held treasure may disappear`);
    if (puzzle.object === 'locksmith_table') assert.equal(state.inventory.filter(id => id === 'canary').length, 1);
    else assert.deepEqual(state.inventory, carried);
    reloaded(state);
  }
});

test('saved completed puzzles bypass the chooser without needing their old tools or replaying effects', () => {
  for (const puzzle of puzzles) {
    let state = scene(puzzle, []);
    state.flags[puzzle.flag] = puzzle.value ?? true;
    // These are saved outcomes. No new use:* action earns them in this test.
    state = reloaded(state);
    const object = puzzle.readyObject ?? puzzle.object;
    for (const choice of ['use:missing_item', `use:${puzzle.tool}`]) {
      const before = structuredClone(state), result = interact(state, object, choice);
      assert.notEqual(result.itemSelection, true, `${object}: an earned solution must not ask for its tool again`);
      assert.deepEqual(state, before, `${object}: a stale picker submission must not replay a solve or cause travel`);
    }
    const before = structuredClone(state), result = interact(state, object);
    assert.notEqual(result.itemSelection, true);
    if (puzzle.travel) {
      assert.equal(result.travel, puzzle.travel, `${object}: a later ordinary interaction still uses the open route`);
      assert.equal(state.room, puzzle.travel);
      assert.deepEqual(state.flags, before.flags, 'using an earned route preserves every puzzle flag');
    } else assert.deepEqual(state, before, `${object}: the finished target is now only an observation`);
    reloaded(state);
  }
});

test('correct selections still respect disabled pressure controls, active leaks, a closed lid and a lit lantern', () => {
  const dam = puzzles.find(puzzle => puzzle.object === 'dam_bolt')!;
  for (const flags of [{ controls_enabled: false }, { controls_enabled: true, dam_leak: true }]) {
    const state = scene({ ...dam, flags }, ['wrench', 'putty', 'lantern']), before = structuredClone(state);
    const result = interact(state, 'dam_bolt', 'use:wrench');
    assert.equal(result.success, false); assert.deepEqual(state, before);
    assert.equal(travel(state, 'dam_to_reservoir').success, false, 'a tool choice cannot bypass the hydraulic conditions');
  }
  const mill = scene(puzzles.find(puzzle => puzzle.object === 'pressure_mill')!, ['screwdriver']);
  mill.flags.machine_closed = false;
  const beforeMill = structuredClone(mill);
  assert.equal(interact(mill, 'pressure_mill', 'use:screwdriver').success, false);
  assert.deepEqual(mill, beforeMill, 'the sample and switch survive a failed open-lid attempt');
  const gas = scene(puzzles.find(puzzle => puzzle.object === 'gas_notice')!, ['lantern']); gas.lantern = false;
  const beforeGas = structuredClone(gas);
  assert.equal(interact(gas, 'gas_notice', 'use:lantern').success, false);
  assert.deepEqual(gas, beforeGas, 'choosing an unlit lantern neither lights it automatically nor clears the gas');
});

test('a displayed utility treasure stays unavailable until explicitly borrowed, then its chosen use succeeds', () => {
  for (const id of ['canary', 'sceptre']) {
    const puzzle = puzzles.find(value => value.tool === id)!;
    const state = scene(puzzle, ['lantern', 'sword']);
    state.deposited = [id]; state.flags[`picked_${id}`] = true;
    const before = structuredClone(state), menu = interact(state, puzzle.object);
    assertInventoryMenu(menu, state, puzzle.object);
    assert.ok(!menu.choices?.some(choice => choice.action === `use:${id}`), 'the picker cannot reach into the remote trophy case');
    const result = interact(state, puzzle.object, `use:${id}`);
    assert.equal(result.success, false); assert.deepEqual(state, before);
    state.room = 'living_room'; Object.assign(state, arrivalAt(state.room)); state.visited.push(state.room);
    assert.equal(interact(state, 'trophy_case', `borrow:${id}`).success, true);
    state.room = puzzle.room; Object.assign(state, arrivalAt(state.room));
    assert.equal(interact(state, puzzle.object, `use:${id}`).success, true);
    assert.equal(state.flags[puzzle.flag], true); assert.ok(state.inventory.includes(id));
    reloaded(state);
  }
});

test('the shaft basket waits for an explicit atomic lowering choice and preserves its cargo through transit saves', () => {
  let state = scene({ room: 'coal_mine', object: 'lift_basket', tool: 'coal', flag: 'basket_lowered' }, ['lantern', 'sword', 'coal', 'screwdriver', 'torch']);
  const before = structuredClone(state), result = interact(state, 'lift_basket');
  assert.deepEqual(result.choices, [{ label: 'Lower the supplies', action: 'lower' }]);
  assert.deepEqual(state, before, 'inspecting the basket cannot remove three carried items');
  assert.equal(interact(state, 'lift_basket', 'use:torch').success, false);
  assert.deepEqual(state, before, 'a partial or wrong action cannot strand one item in a new cargo state');
  assert.equal(interact(state, 'lift_basket', 'lower').success, true);
  for (const id of ['coal', 'screwdriver', 'torch']) {
    assert.equal(state.inventory.includes(id), false); assert.equal(state.flags[`basket_${id}`], true);
  }
  assert.deepEqual(state.inventory, ['lantern', 'sword']);
  state = reloaded(state);
  const inTransit = structuredClone(state);
  interact(state, 'lift_basket', 'lower'); assert.deepEqual(state, inTransit, 'a repeated lowering cannot transfer or duplicate cargo again');
  assert.equal(travel(state, 'coal_mine_to_machine_room').success, true);
  assert.equal(interact(state, 'lowered_basket').success, true);
  for (const id of ['coal', 'screwdriver', 'torch']) assert.equal(state.inventory.filter(item => item === id).length, 1);
  state = reloaded(state);
  assert.equal(travel(state, 'machine_room_to_coal_mine').success, true);
  const collected = structuredClone(state), empty = interact(state, 'lift_basket');
  assert.notEqual(empty.itemSelection, true); assert.equal(empty.choices, undefined); assert.deepEqual(state, collected);
});
