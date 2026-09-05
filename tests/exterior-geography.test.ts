import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE_GORGE, constrainHouseGorgeStep, houseGorgeDepth, inHouseGorge, restoreHouseGorgePosition } from '../src/exterior-geography.ts';
import { createGame, deserialize, serialize, travel } from '../src/game.ts';
import { houseExterior } from '../src/scene-layout.ts';
import type { Vec2 } from '../src/types.ts';

test('the rainbow crosses a broad deep gorge with no low strip of ground around its far end', () => {
  for (const x of [-56, -48, -40, -36, -30, -27]) for (const z of [-24, -30, -38, -44, -60]) {
    assert.equal(houseGorgeDepth(x, z), HOUSE_GORGE.depth, `${x},${z}: continuous deep ravine`);
  }
  for (const point of [[-36, -20], [-36, -18.5], [0, -28], [-24, -30]] as Vec2[]) {
    assert.equal(houseGorgeDepth(...point), 0, 'landing, forest approach and house routes remain dry');
  }
  const state = createGame();
  const exit = houseExterior(state).exits.find(exit => exit.to === 'falls')!;
  assert.deepEqual(exit.position, [-36, -20]);
  assert.equal(travel(Object.assign(createGame(), { room: 'forest' }), 'forest_to_falls').success, false);
  state.room = 'forest'; state.flags.rainbow_solid = true;
  assert.equal(travel(state, 'forest_to_falls').travel, 'falls');
  assert.equal(travel(state, 'falls_to_forest').travel, 'forest');
  assert.deepEqual(state.position, [-36, -16.7]);
});

test('walking and dodging stop at the visible gorge rim from both banks', () => {
  for (let x = -56; x < -25.5; x += .47) for (const step of [.05, .4, 1.5]) {
    const point = constrainHouseGorgeStep([x, -20.62 - step]);
    assert.ok(!inHouseGorge(...point, .379), 'south bank never steps into the drop');
  }
  for (let z = -38; z < -21; z += .43) for (const step of [.05, .4, 1.5]) {
    const point = constrainHouseGorgeStep([-25.12 - step, z]);
    assert.ok(!inHouseGorge(...point, .379), 'east bank never steps into the drop');
  }
  assert.deepEqual(constrainHouseGorgeStep([0, 13]), [0, 13]);
});

test('only old outdoor saves over the new gorge recover to the clear landing, without losing progress', () => {
  const earned = createGame();
  earned.room = 'forest'; earned.visited.push('forest', 'kitchen', 'living_room');
  earned.inventory = ['lantern', 'sword', 'wrench']; earned.deposited = ['painting'];
  earned.flags = { window_open: true, trapdoor_open: true, troll_defeated: true, leak_fixed: true, reservoir_drained: true, picked_lantern: true, picked_sword: true, picked_wrench: true, picked_painting: true };
  earned.lantern = true; earned.yaw = 1.32; earned.playTime = 1234; earned.health = 73;
  const expected = deserialize(serialize(earned))!;
  for (const point of [[-52, -35], [-51.8, -25.3], [-30, -29], [-36, -22]] as Vec2[]) {
    const old = { ...expected, position: point }, restored = deserialize(serialize(old))!;
    assert.deepEqual(restored.position, [-36, -16.7]);
    assert.deepEqual({ ...restored, position: point }, old, 'every field except unsafe position stays exact');
    assert.deepEqual(deserialize(serialize(restored)), restored, 'recovery is idempotent');
  }
  for (const point of [[-36, -20], [-24, -30], [0, 13], [0, -19.2], constrainHouseGorgeStep([-52, -30]), constrainHouseGorgeStep([-26, -32])] as Vec2[]) {
    const saved = { ...expected, position: point };
    assert.equal(serialize(deserialize(serialize(saved))!), serialize(saved));
  }
  assert.deepEqual(restoreHouseGorgePosition([0, 0]), [0, 0]);
});
