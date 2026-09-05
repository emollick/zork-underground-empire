import test from 'node:test';
import assert from 'node:assert/strict';
import { compassBearing, compassJournalText } from '../src/compass.ts';
import { createGame, deserialize, interact, serialize, travel } from '../src/game.ts';
import { HOUSE_DISTRICTS, houseExterior } from '../src/scene-layout.ts';
import { ROOMS } from '../src/campaign.ts';

test('the shared house grounds face east toward the house without changing interior north', () => {
  const state = createGame(), exterior = houseExterior(state);
  const front = exterior.objects.find(object => object.id === 'boarded_door')!;
  const rear = exterior.objects.find(object => object.id === 'kitchen_window')!;
  assert.ok(state.position[1] > front.position[2] && front.position[2] > rear.position[2]);
  assert.equal(compassBearing(state.room, state.yaw), 90, 'the starting view faces east toward the house');
  for (const room of HOUSE_DISTRICTS) {
    for (const [yaw, bearing] of [[0, 90], [Math.PI / 2, 0], [Math.PI, 270], [-Math.PI / 2, 180]]) {
      assert.equal(compassBearing(room, yaw), bearing, `${room} stays aligned across the shared landscape`);
      const turnError = Math.abs(compassBearing(room, yaw + Math.PI * 8) - bearing);
      assert.ok(Math.min(turnError, 360 - turnError) < 1e-9, 'turning multiple times keeps the bearing');
    }
  }
  for (const room of Object.values(ROOMS).filter(room => !HOUSE_DISTRICTS.includes(room.id as typeof HOUSE_DISTRICTS[number]))) {
    assert.equal(compassBearing(room.id, 0), 0, `${room.id} keeps its original north`);
    assert.equal(compassBearing(room.id, -Math.PI / 2), 90, `${room.id} keeps its original east`);
  }
});

test('the kitchen window preserves positions and facing bearings through actual travel and reload', () => {
  const state = createGame();
  state.room = 'behind_house'; state.position = [0, -19.2]; state.yaw = Math.PI;
  assert.equal(compassBearing(state.room, state.yaw), 270, 'face west into the rear window');
  assert.equal(interact(state, 'kitchen_window').success, true);
  assert.equal(interact(state, 'kitchen_window').travel, 'kitchen');
  assert.deepEqual(state.position, [3.8, 2.5]);
  assert.equal(compassBearing(state.room, state.yaw), 270, 'still face west inside the kitchen');
  state.yaw = -Math.PI / 2;
  assert.equal(compassBearing(state.room, state.yaw), 90, 'turn east to leave');
  assert.equal(travel(state, 'kitchen_to_behind_house').travel, 'behind_house');
  assert.deepEqual(state.position, [0, -19.2]);
  assert.equal(state.yaw, 0);
  const saved = serialize(state), restored = deserialize(saved)!;
  assert.equal(serialize(restored), saved, 'the compass correction requires no save migration');
  assert.equal(compassBearing(restored.room, restored.yaw), 90, 'still face east after travel and reload');
});

test('an older Stone Barrow observation displays the corrected direction while its save stays exact', () => {
  const state = createGame();
  state.journal.push({ id: 'last_road', title: 'The Stone Barrow', text: 'The map reveals a hidden road southwest of the white house. Nineteen treasures returned; one last threshold remains.' });
  const saved = serialize(state), restored = deserialize(saved)!;
  const entry = restored.journal.find(entry => entry.id === 'last_road')!;
  assert.match(compassJournalText(entry), /road northwest of the white house/);
  assert.equal(serialize(restored), saved, 'display does not rewrite the stored journal');
  assert.equal(compassJournalText(restored.journal[0]), restored.journal[0].text, 'other observations retain their original prose');
});
