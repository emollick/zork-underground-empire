import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Quaternion, Vector3 } from 'three';
import { ROOMS } from '../src/campaign.ts';
import { createGame, interact, serialize, travel } from '../src/game.ts';
import { hasLight } from '../src/darkness.ts';
import { doorwayTargetScore } from '../src/interaction-target.ts';
import { arrivalAt, houseExterior, isHouseGrounds } from '../src/scene-layout.ts';
import { COFFIN_CONTENTS_POSITION } from '../src/coffin-pose.ts';
import type { ExitDef, GameState, ObjectDef, RoomDef, Vec2 } from '../src/types.ts';

// Exercise the actual main-loop selector, including object competition, gates
// and outdoor transforms. Only the camera/UI/render-position boundary is stubbed.
const mainSource = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const selector = mainSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'selectTarget') as ts.FunctionDeclaration;
assert.ok(selector?.body, 'The production target selector must remain part of this integration check');
const compiledSelector = ts.transpileModule(selector.getText(mainSource), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const select = new Function('ROOMS', 'doorwayTargetScore', 'hasLight', 'Vector3', `
  return function(state, view) {
    const forward = new Vector3(), ui = { prompt() {} }, darkTime = 0;
    let target = {};
    ${compiledSelector}
    selectTarget();
    return target;
  };
`)(ROOMS, doorwayTargetScore, hasLight, Vector3) as (state: GameState, view: unknown) => { exit?: ExitDef; object?: ObjectDef };

function scene(state: GameState): RoomDef { return isHouseGrounds(state.room) ? houseExterior(state) : ROOMS[state.room]; }
function readyState(room: string): GameState {
  const state = createGame(); state.room = room;
  state.inventory = ['lantern']; state.lantern = true;
  for (const place of Object.values(ROOMS)) for (const exit of place.exits) if (exit.requires) state.flags[exit.requires] = true;
  return state;
}
function selectAt(state: GameState, position: Vec2, yaw: number) {
  return select(state, {
    worldRoom: scene(state),
    camera: { position: new Vector3(position[0], 1.68, position[1]), quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw) },
    objectPosition: (object: ObjectDef) => new Vector3(...(object.id === 'sceptre' ? COFFIN_CONTENTS_POSITION : object.position)),
  });
}
function routePoint(exit: ExitDef, inward: number, across = 0): Vec2 {
  const yaw = exit.yaw ?? 0;
  return [exit.position[0] + Math.sin(yaw) * inward + Math.cos(yaw) * across,
    exit.position[1] + Math.cos(yaw) * inward - Math.sin(yaw) * across];
}
const physicalRoutes = Object.values(ROOMS).filter(room => !isHouseGrounds(room.id) || room.id === 'west_house')
  .flatMap(room => scene(readyState(room.id)).exits.map(exit => ({ room: exit.district ?? room.id, exit })));
function selectedRoute(result: ReturnType<typeof selectAt>, exit: ExitDef): boolean {
  return exit.via ? result.object?.id === exit.via : result.exit?.id === exit.id;
}

test('doorways remain usable at either jamb and just beyond the threshold', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, .71]) {
    const exit = { position: [4, -7] as [number, number], yaw };
    const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    for (const across of [-.65, 0, .65]) for (const inward of [1.4, .1, 0, -.5]) {
      const position = { x: 4 + Math.sin(yaw) * inward + Math.cos(yaw) * across,
        z: -7 + Math.cos(yaw) * inward - Math.sin(yaw) * across };
      assert.ok(Number.isFinite(doorwayTargetScore(exit, position, forward)), `${yaw}: ${across}, ${inward}`);
    }
  }
});

test('doorway reach does not allow nearby walls, distant travel, or returning while facing away', () => {
  const exit = { position: [0, 0] as [number, number], yaw: 0 };
  assert.equal(doorwayTargetScore(exit, { x: 1.6, z: .05 }, { x: 0, z: -1 }), Infinity, 'beside the aperture');
  assert.equal(doorwayTargetScore(exit, { x: .5, z: 0 }, { x: 0, z: 1 }), Infinity, 'facing into the room');
  assert.equal(doorwayTargetScore(exit, { x: 0, z: 4.5 }, { x: 0, z: -1 }), Infinity, 'outside interaction range');
  assert.equal(doorwayTargetScore(exit, { x: 0, z: -1.3 }, { x: 0, z: -1 }), Infinity, 'past the threshold tolerance');
  assert.ok(Number.isFinite(doorwayTargetScore(exit, { x: .6, z: 3.2 }, { x: 0, z: -1 })), 'normal approach');
});

test('the actual kitchen doorway reproducer and cardinal house exits stay targetable', () => {
  const exit = ROOMS.kitchen.exits.find(exit => exit.to === 'living_room')!;
  const position = { x: -5.38, z: .43 }, forward = { x: -1, z: 0 };
  const dx = exit.position[0] - position.x, dz = exit.position[1] - position.z;
  assert.ok((dx * forward.x + dz * forward.z) / Math.hypot(dx, dz) < .68, 'the former center-point cone missed this position');
  assert.ok(Number.isFinite(doorwayTargetScore(exit, position, forward)));
  for (const room of Object.values(ROOMS).filter(room => room.kind === 'house')) for (const route of room.exits.filter(exit => !exit.via)) {
    const yaw = route.yaw!, point = { x: route.position[0] + Math.cos(yaw) * .55, z: route.position[1] - Math.sin(yaw) * .55 };
    assert.ok(Number.isFinite(doorwayTargetScore(route, point, { x: -Math.sin(yaw), z: -Math.cos(yaw) })), route.id);
  }
});

test('every actual doorway stays selected at its jambs with all nearby objects present', () => {
  for (const { room, exit } of physicalRoutes) {
    // Vertical rope/grate/hatch targets remain their ordinary object interactions.
    if (exit.via && !['window', 'mirror'].includes(exit.role ?? '')) continue;
    const state = readyState(room), window = exit.via === 'kitchen_window';
    // The rear casement is approached from the yard, outside its solid facade.
    const depths = window ? [.65, 1.1] : [-.4, .12, 1.1];
    const sides = window ? [-.42, 0, .42] : [-.82, 0, .82];
    for (const inward of depths) for (const across of sides) for (const turn of [-.32, 0, .32]) {
      const position = routePoint(exit, inward, across), selection = selectAt(state, position, exit.yaw! + turn);
      assert.ok(selectedRoute(selection, exit), `${exit.id}: target lost at depth ${inward}, side ${across}, turn ${turn}; selected ${selection.exit?.id ?? selection.object?.id}`);
    }
    for (const side of [-1.6, 1.6]) {
      const point = routePoint(exit, .05, side), forward = { x: -Math.sin(exit.yaw!), z: -Math.cos(exit.yaw!) };
      assert.equal(doorwayTargetScore(exit, { x: point[0], z: point[1] }, forward), Infinity,
        `${exit.id}: a nearby wall does not become the aperture`);
    }
  }
});

test('actual reciprocal arrivals do not immediately target the route just used', () => {
  for (const { room, exit } of physicalRoutes) {
    const state = readyState(room), entrance = arrivalAt(room, exit.to);
    const forwardSelection = selectAt(state, entrance.position, entrance.yaw);
    assert.equal(selectedRoute(forwardSelection, exit), false, `${exit.id}: arrival faces into the room`);
    const dx = exit.position[0] - entrance.position[0], dz = exit.position[1] - entrance.position[1];
    const backSelection = selectAt(state, entrance.position, Math.atan2(-dx, -dz));
    assert.ok(selectedRoute(backSelection, exit), `${exit.id}: turning back toward the used entrance must work; selected ${backSelection.exit?.id ?? backSelection.object?.id}`);
  }
});

test('close targeting cannot bypass a locked route or expose either secret shortcut', () => {
  for (const { room, exit } of physicalRoutes.filter(({ exit }) => exit.requires)) {
    const state = readyState(room); state.flags[exit.requires!] = false;
    state.position = routePoint(exit, .65); state.yaw = exit.yaw!;
    const before = serialize(state), selection = selectAt(state, state.position, state.yaw);
    assert.equal(travel(state, exit.id).success, false, exit.id);
    assert.equal(serialize(state), before, `${exit.id}: a failed close approach changes no progress or position`);
    if (exit.to === 'barrow' || exit.requires === 'cyclops_fled') {
      assert.equal(selectedRoute(selection, exit), false, `${exit.id}: the unrevealed shortcut must stay unadvertised`);
    } else if (!exit.via) {
      assert.ok(selectedRoute(selection, exit), `${exit.id}: an ordinary blocked route still offers its explanation`);
    }
  }
});

test('the transformed yard window and both mirrors keep their two-step opening and travel flow', () => {
  for (const [room, routeId, flag] of [
    ['behind_house', 'behind_house_to_kitchen', 'window_open'],
    ['temple', 'temple_to_atlantis', 'mirror_awakened'],
    ['atlantis', 'atlantis_to_temple', 'mirror_awakened'],
  ] as const) {
    const state = readyState(room); state.flags[flag] = false;
    const exit = scene(state).exits.find(value => value.id === routeId)!;
    const camera = routePoint(exit, .8, .35), first = selectAt(state, camera, exit.yaw!);
    assert.equal(first.object?.id, exit.via, routeId);
    const opened = interact(state, first.object!.id);
    assert.equal(opened.success, true); assert.equal(opened.travel, undefined); assert.equal(state.room, room);
    assert.equal(state.flags[flag], true);
    const second = selectAt(state, camera, exit.yaw!);
    assert.equal(second.object?.id, exit.via);
    assert.equal(interact(state, second.object!.id).travel, exit.to);
    const returned = arrivalAt(exit.to, room);
    assert.deepEqual(state.position, returned.position); assert.equal(state.yaw, returned.yaw);
  }
});

test('the open coffin offers its visible contents, then becomes collectible after they are taken', () => {
  const state = readyState('egypt'); state.position = [0, -2.5]; state.yaw = 0;
  assert.equal(selectAt(state, state.position, state.yaw).object?.id, 'gold_coffin');
  assert.equal(interact(state, 'gold_coffin').success, true);
  assert.equal(selectAt(state, state.position, state.yaw).object?.id, 'sceptre', 'rendered contents outrank their occupied container');
  assert.equal(interact(state, 'sceptre').success, true);
  assert.equal(selectAt(state, state.position, state.yaw).object?.id, 'gold_coffin');
  assert.equal(interact(state, 'gold_coffin').success, true);
  const after = selectAt(state, state.position, state.yaw);
  assert.notEqual(after.object?.id, 'gold_coffin'); assert.notEqual(after.object?.id, 'sceptre');
});
