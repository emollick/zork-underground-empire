import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS } from '../src/campaign.ts';
import { createGame, deserialize, interact, serialize, travel } from '../src/game.ts';
import { arrivalAt, isHouseGrounds, sceneBounds, worldPosition } from '../src/scene-layout.ts';
import { constrainRouteStep, RAINBOW_BRIDGE, rainbowCoordinates, routeFloorHeight } from '../src/route-surfaces.ts';
import type { Vec2 } from '../src/types.ts';

test('every discrete route arrives beside its reciprocal entrance, facing away from it', () => {
  for (const room of Object.values(ROOMS)) for (const exit of room.exits) {
    if (isHouseGrounds(room.id) && isHouseGrounds(exit.to)) continue;
    const destination = ROOMS[exit.to];
    const entrances = destination.exits.filter(other => other.to === room.id);
    assert.equal(entrances.length, 1, `${exit.id}: a unique return route must exist`);
    const entrance = entrances[0], threshold = worldPosition(destination.id, entrance.position);
    const state = createGame(); state.room = room.id;
    if (exit.requires) state.flags[exit.requires] = true;
    assert.equal(travel(state, exit.id).travel, destination.id, exit.id);
    const dx = threshold[0] - state.position[0], dz = threshold[1] - state.position[1];
    const distance = Math.hypot(dx, dz);
    assert.ok(distance > 1 && distance <= 3.6, `${exit.id}: the used entrance must remain close (${distance})`);
    assert.ok(-Math.sin(state.yaw) * dx - Math.cos(state.yaw) * dz < -0.5,
      `${exit.id}: face into the new room, with the entrance behind`);
    const bounds = sceneBounds(destination.id);
    assert.ok(state.position[0] >= bounds.minX + 0.38 && state.position[0] <= bounds.maxX - 0.38, `${exit.id}: x inside scene`);
    assert.ok(state.position[1] >= bounds.minZ + 0.38 && state.position[1] <= bounds.maxZ - 0.38, `${exit.id}: z inside scene`);
    const restored = deserialize(serialize(state)); assert.ok(restored);
    assert.deepEqual(restored.position, state.position, `${exit.id}: a save keeps the entrance arrival`);
    assert.equal(restored.yaw, state.yaw);
  }
});

test('an unopened route preserves the current room and position', () => {
  for (const room of Object.values(ROOMS)) for (const exit of room.exits) {
    if (!exit.requires) continue;
    const state = createGame(); state.room = room.id; state.position = [1.25, 2.5]; state.yaw = 0.75;
    assert.equal(travel(state, exit.id).success, false, exit.id);
    assert.equal(state.room, room.id); assert.deepEqual(state.position, [1.25, 2.5]); assert.equal(state.yaw, 0.75);
  }
});

test('mirrors activate once, then travel at the visible mirror in both directions', () => {
  const state = createGame(); state.room = 'temple';
  assert.equal(interact(state, 'temple_mirror').success, true);
  assert.equal(state.room, 'temple'); assert.equal(state.flags.mirror_awakened, true);
  assert.equal(interact(state, 'temple_mirror').travel, 'atlantis');
  assert.deepEqual(state.position, arrivalAt('atlantis', 'temple').position);
  const restored = deserialize(serialize(state)); assert.ok(restored);
  assert.equal(interact(restored, 'atlantis_mirror').travel, 'temple');
  assert.deepEqual(restored.position, arrivalAt('temple', 'atlantis').position);
});

test('the secured rope supplies both the descent and return ascent', () => {
  const state = createGame(); state.room = 'temple';
  assert.equal(travel(state, 'temple_to_dome').success, false, 'the temple has no climbable rope before it is secured');
  assert.equal(interact(state, 'temple_rope').success, false);
  state.room = 'dome';
  assert.equal(interact(state, 'dome_railing', 'use:rope').success, false);
  state.inventory.push('rope');
  assert.equal(interact(state, 'dome_railing', 'use:rope').success, true); assert.equal(state.room, 'dome');
  assert.equal(interact(state, 'secured_dome_rope').travel, 'temple');
  assert.equal(interact(state, 'temple_rope').travel, 'dome');
  assert.deepEqual(state.position, arrivalAt('dome', 'temple').position);
});

test('the solid rainbow rises continuously and cannot be entered through its high sides', () => {
  const flags = { rainbow_solid: true }, { start, end, rise, baseHeight } = RAINBOW_BRIDGE;
  const midpoint: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  assert.equal(routeFloorHeight('falls', midpoint, {}), 0, 'light alone has no walkable surface');
  assert.equal(routeFloorHeight('forest', midpoint, flags), 0, 'the bridge does not lift unrelated rooms');
  assert.ok(Math.abs(routeFloorHeight('falls', midpoint, flags) - rise - baseHeight) < 1e-10);
  let before: Vec2 = [start[0] + 0.1, start[1]];
  let lastHeight = 0;
  for (let step = 0; step <= 240; step++) {
    const t = step / 240;
    const next: Vec2 = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
    const grounded = constrainRouteStep('falls', before, next, flags);
    assert.deepEqual(grounded, next, 'the whole centerline must be walkable');
    const height = routeFloorHeight('falls', grounded, flags);
    assert.ok(Math.abs(height - lastHeight) < 0.15, 'each walking step follows the curve smoothly');
    lastHeight = height; before = grounded;
  }
  const offSide: Vec2 = [midpoint[0], midpoint[1] + 4];
  assert.deepEqual(constrainRouteStep('falls', offSide, midpoint, flags), offSide, 'a high side cannot teleport the player onto the bridge');
  const safe = constrainRouteStep('falls', midpoint, offSide, flags);
  assert.ok(Math.abs(rainbowCoordinates(safe).side) <= RAINBOW_BRIDGE.width / 2 - 0.34, 'the visible low edge retains the player');
  assert.ok(routeFloorHeight('falls', safe, flags) > 4, 'walking sideways at the summit cannot drop to the gorge floor');
});

test('older saves beyond repaired barriers recover without unlocking puzzles or losing progress', () => {
  for (const [room, point, flag] of [
    ['hades', [2, -12], 'hades_open'],
    ['falls', [-22.5, -2.6], 'rainbow_solid'],
    ['falls', [-10, 0], 'rainbow_solid'],
  ] as const) {
    const state = createGame(); state.room = room; state.position = [...point];
    state.inventory = ['lantern', 'sword', 'coins']; state.lantern = true; state.health = 73;
    state.flags[flag] = false; state.flags.grate_open = true;
    const restored = deserialize(serialize(state)); assert.ok(restored);
    assert.notDeepEqual(restored.position, state.position, `${room}: the obsolete blocked side must not strand the player`);
    assert.equal(restored.room, room); assert.equal(restored.flags[flag], false);
    assert.equal(restored.flags.grate_open, true); assert.equal(restored.health, 73);
    assert.deepEqual(restored.inventory, state.inventory);
    assert.deepEqual(deserialize(serialize(restored))?.position, restored.position, 'recovery is stable on subsequent loads');
    state.flags[flag] = true;
    const unlocked = deserialize(serialize(state)); assert.ok(unlocked);
    if (room === 'falls' && point[0] > -20) assert.ok(routeFloorHeight(room, unlocked.position, unlocked.flags) > 4,
      'a previously flat but unlocked crossing restores onto its raised replacement');
    else assert.deepEqual(unlocked.position, state.position, 'an earned far landing remains valid');
  }
  const northShore = createGame(); northShore.room = 'falls'; northShore.position = [-22, -12];
  assert.deepEqual(deserialize(serialize(northShore))?.position, northShore.position,
    'an ordinary position on the north shore remains untouched');
  for (const point of [[-31, 7], [-36, -30]] as Vec2[]) for (const open of [false, true]) {
    const state = createGame(); state.room = 'forest'; state.position = point;
    state.inventory = ['skeleton_key', 'sword']; state.flags.grate_open = open; state.flags.rainbow_solid = open;
    const restored = deserialize(serialize(state)); assert.ok(restored);
    assert.notDeepEqual(restored.position, point, 'old terrain positions recover beside the new shaft or shore');
    assert.equal(restored.flags.grate_open, open); assert.equal(restored.flags.rainbow_solid, open);
    assert.deepEqual(restored.inventory, state.inventory);
    assert.deepEqual(deserialize(serialize(restored))?.position, restored.position);
  }
});
