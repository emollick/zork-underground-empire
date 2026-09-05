import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, defeatEnemy, deserialize, interact, serialize, travel, visibleObjects } from '../src/game.ts';
import type { GameState } from '../src/types.ts';

function act(state: GameState, id: string, choice?: string): void {
  const result = interact(state, id, choice);
  assert.equal(result.success, true, `${state.room}: ${id}: ${result.message}`);
}
function visit(state: GameState, room: string): void {
  const result = travel(state, `${state.room}_to_${room}`);
  assert.equal(result.success, true, result.message);
  assert.equal(state.room, room);
}
function reload(state: GameState): GameState {
  const restored = deserialize(serialize(state));
  assert.ok(restored, 'The current expedition must remain loadable');
  assert.deepEqual(restored, state, 'Reload must retain every progress, inventory, camera, checkpoint and settings field');
  return restored;
}
function maintenance(): GameState {
  const state = createGame();
  visit(state, 'behind_house'); act(state, 'kitchen_window'); act(state, 'kitchen_window');
  visit(state, 'living_room'); act(state, 'lantern'); act(state, 'sword'); act(state, 'carpet');
  act(state, 'cellar_hatch'); visit(state, 'troll_bridge');
  // Continuous combat has its own suite. Use its normal domain outcome callback.
  assert.equal(defeatEnemy(state, 'troll').success, true);
  visit(state, 'round_room'); visit(state, 'dam'); act(state, 'dam_fire'); visit(state, 'maintenance');
  return state;
}
const leakVisible = (state: GameState) => visibleObjects(state).some(object => object.id === 'leaking_pipe');

test('a leak save exposes its repair target, and putty remains reusable after repair and reload', () => {
  let state = maintenance();
  assert.equal(leakVisible(state), false, 'An intact pipe must not offer leak repair');
  assert.equal(interact(state, 'leaking_pipe').success, false);
  act(state, 'control_buttons', 'blue');
  state = reload(state);
  assert.equal(leakVisible(state), true, 'A saved active leak must have a visible repair target');
  const withoutPutty = structuredClone(state);
  assert.equal(interact(state, 'leaking_pipe', 'use:putty').success, false);
  assert.deepEqual(state, withoutPutty, 'A missing tool cannot silently repair or worsen the leak');
  assert.equal(interact(state, 'control_buttons', 'blue').success, false, 'A jammed blue button cannot stack leaks');

  act(state, 'putty');
  const inventory = [...state.inventory];
  act(state, 'leaking_pipe', 'use:putty');
  state = reload(state);
  assert.equal(state.flags.dam_leak, false);
  assert.equal(leakVisible(state), false, 'A repaired pipe must stop offering the obsolete repair interaction');
  assert.deepEqual(state.inventory, inventory, 'Sealing the pipe must leave the tube of putty usable');

  act(state, 'control_buttons', 'blue');
  state = reload(state);
  assert.equal(leakVisible(state), true, 'Reopening the leak must restore its repair interaction');
  act(state, 'leaking_pipe', 'use:putty');
  assert.deepEqual(reload(state).inventory, inventory, 'Repeated experimentation must not consume the only solution');
});

test('the dam requires a wrench, enabled controls and a sealed pipe across reloads', () => {
  let state = maintenance();
  act(state, 'control_buttons', 'blue'); act(state, 'control_buttons', 'yellow');
  state = reload(state); visit(state, 'dam');
  assert.equal(interact(state, 'dam_bolt', 'use:wrench').success, false, 'The controls cannot substitute for the wrench');
  assert.equal(travel(state, 'dam_to_reservoir').success, false);

  visit(state, 'maintenance'); act(state, 'wrench');
  state = reload(state); visit(state, 'dam');
  assert.equal(interact(state, 'dam_bolt', 'use:wrench').success, false, 'The enabled bolt must still respect the active leak');
  assert.equal(travel(state, 'dam_to_reservoir').success, false);

  visit(state, 'maintenance'); act(state, 'putty'); act(state, 'leaking_pipe', 'use:putty'); act(state, 'control_buttons', 'brown');
  state = reload(state); visit(state, 'dam');
  assert.equal(interact(state, 'dam_bolt', 'use:wrench').success, false, 'Repair does not enable controls that were switched off');
  assert.equal(travel(state, 'dam_to_reservoir').success, false);

  visit(state, 'maintenance'); act(state, 'control_buttons', 'yellow');
  state = reload(state); visit(state, 'dam');
  const carried = [...state.inventory];
  act(state, 'dam_bolt', 'use:wrench'); state = reload(state);
  assert.equal(state.flags.reservoir_drained, true);
  assert.deepEqual(state.inventory, carried, 'Turning the bolt must retain both reusable tools');
  visit(state, 'reservoir'); state = reload(state); visit(state, 'dam');
  assert.equal(state.checkpoint, 'dam', 'Solving and crossing the sluice must retain the chosen checkpoint');
});

test('a drained expedition keeps its access and treasure progress after later control experiments', () => {
  let state = maintenance();
  for (const id of ['wrench', 'putty']) act(state, id);
  act(state, 'control_buttons', 'yellow'); visit(state, 'dam'); act(state, 'dam_bolt', 'use:wrench');
  visit(state, 'reservoir'); act(state, 'jewel_trunk'); act(state, 'pump');
  visit(state, 'dam'); visit(state, 'maintenance');
  act(state, 'control_buttons', 'brown'); act(state, 'control_buttons', 'blue');
  state.lantern = false;
  state.health = 41.5; state.stamina = 68.25; state.position = [11, 6.5]; state.yaw = 2.13;
  state.enemies.thief = 93.5; state.deaths = 2; state.playTime = 2047.75;
  state = reload(state);
  assert.equal(state.flags.controls_enabled, false);
  assert.equal(state.flags.dam_leak, true);
  assert.equal(state.flags.reservoir_drained, true, 'A completed sluice must not be recomputed from the current buttons');
  assert.equal(leakVisible(state), true);
  assert.ok(state.inventory.includes('jewel_trunk') && state.inventory.includes('pump'));
  assert.equal(state.enemies.troll, 0); assert.equal(state.enemies.thief, 93.5);
  assert.equal(state.lantern, false);

  visit(state, 'dam');
  const solved = structuredClone(state);
  act(state, 'dam_bolt');
  assert.deepEqual(state, solved, 'Inspecting an already open sluice must not reset flags or consume items');
  state = reload(state); visit(state, 'reservoir');
  assert.equal(visibleObjects(state).some(object => object.id === 'jewel_trunk'), false, 'Previously recovered treasure must not respawn');
  visit(state, 'dam'); visit(state, 'maintenance'); act(state, 'leaking_pipe', 'use:putty');
  state = reload(state);
  assert.equal(state.flags.dam_leak, false);
  assert.equal(state.flags.reservoir_drained, true);
});
