import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadInput, gamepadStick } from '../src/gamepad-input.ts';
import type { GamepadSnapshot } from '../src/gamepad-input.ts';

const pad = (index = 0): GamepadSnapshot => ({
  index, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
});

test('sticks filter drift, scale smoothly and bound diagonal movement', () => {
  assert.deepEqual(gamepadStick(0.1, 0.1), { x: 0, y: 0 });
  assert.deepEqual(gamepadStick(NaN, 0), { x: 0, y: 0 });
  assert.ok(Math.abs(gamepadStick(0.59, 0).x - 0.5) < 1e-10);
  const diagonal = gamepadStick(1, -1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-10);
  assert.ok(diagonal.x > 0 && diagonal.y < 0);
});

test('buttons fire once per press and holds survive successive frames', () => {
  const input = new GamepadInput(), controller = pad();
  controller.buttons[0].pressed = true; controller.buttons[6].pressed = true;
  input.update([controller]);
  assert.equal(input.pressed[0], true); assert.equal(input.held[6], true);
  input.update([controller]);
  assert.equal(input.pressed[0], false); assert.equal(input.held[6], true);
  controller.buttons[0].pressed = false; controller.buttons[6].pressed = false;
  input.update([controller]);
  assert.equal(input.held[6], false);
  controller.buttons[0].pressed = true; input.update([controller]);
  assert.equal(input.pressed[0], true);
});

test('disconnect, reset and nonstandard controllers clear movement and held buttons', () => {
  const input = new GamepadInput(), controller = pad();
  controller.axes = [1, -1, 0.5, 0]; controller.buttons[6].pressed = true;
  input.update([controller]);
  assert.ok(input.move.x > 0 && input.move.y < 0 && input.look.x > 0);
  input.update([{ ...controller, connected: false }]);
  assert.deepEqual(input.move, { x: 0, y: 0 }); assert.equal(input.held[6], undefined);
  input.update([{ ...controller, mapping: '' }]);
  assert.equal(input.active, false);
  input.update([controller]); input.reset();
  assert.deepEqual(input.look, { x: 0, y: 0 }); assert.equal(input.active, false);
});

test('the selected controller stays stable until disconnected', () => {
  const input = new GamepadInput(), first = pad(0), second = pad(1);
  first.buttons[0].pressed = true; second.buttons[1].pressed = true;
  input.update([null, first, second]); assert.equal(input.pressed[0], true);
  input.update([second, first]); assert.equal(input.held[0], true); assert.equal(input.pressed[0], false);
  input.update([second]); assert.equal(input.pressed[1], true); assert.equal(input.held[0], false);
});
