import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchInput, stickVector } from '../src/touch-input.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
const movement = (input: TouchInput) => [input.x, input.z, input.knobX, input.knobY, input.running];
const assertRest = (input: TouchInput) => {
  assert.deepEqual(movement(input), [0, 0, 0, 0, false]);
  assert.equal(input.guardHeld, false);
  assert.equal(input.count, 0);
};

test('movement, camera look and guard keep independent finger ownership', () => {
  const input = new TouchInput();
  assert.equal(input.begin(11, 'move', 80, 700, 48), true);
  input.move(11, 104, 652);
  const moving = movement(input);
  assert.ok(input.x > 0 && input.z < 0 && input.running);

  assert.equal(input.begin(22, 'look', 280, 350), true);
  assert.deepEqual(input.move(22, 260, 356), { dx: -20, dy: 6 });
  assert.deepEqual(input.move(22, 257, 350), { dx: -3, dy: -6 }, 'look uses the last contact, not the beginning of the drag');
  assert.deepEqual(movement(input), moving, 'looking must not replace the moving thumb');
  input.begin(33, 'guard');
  assert.equal(input.guardHeld, true);
  assert.equal(input.move(33, 800, -100), undefined, 'a captured guard stays a guard when the finger slides away');
  assert.deepEqual(movement(input), moving);

  assert.equal(input.end(22), 'look');
  assert.equal(input.guardHeld, true, 'lifting the look finger must not drop the defense');
  assert.deepEqual(movement(input), moving);
  assert.equal(input.end(11), 'move');
  assert.deepEqual(movement(input), [0, 0, 0, 0, false]);
  assert.equal(input.guardHeld, true, 'movement can stop while the guard stays held');
  input.end(33);
  assertRest(input);
});

test('a second contact cannot steal a movement or look control or rebind a held finger', () => {
  const input = new TouchInput();
  input.begin(1, 'move', 50, 50, 40);
  input.move(1, 70, 30);
  const moving = movement(input);
  assert.equal(input.begin(1, 'guard'), false, 'the same contact cannot become another action');
  assert.equal(input.begin(2, 'move', 1000, 1000), false, 'a new finger cannot move the joystick anchor');
  input.move(2, -1000, -1000);
  assert.deepEqual(movement(input), moving);
  assert.equal(input.guardHeld, false);
  assert.equal(input.begin(2, 'look', 200, 200), true, 'a rejected second joystick contact must remain available for a different control');
  assert.equal(input.begin(3, 'look', 0, 0), false);
  assert.deepEqual(input.move(2, 205, 196), { dx: 5, dy: -4 });
  assert.equal(input.end(999), undefined);
  assert.equal(input.end(3), undefined);
  assert.deepEqual(movement(input), moving);
  assert.deepEqual(input.move(2, 207, 195), { dx: 2, dy: -1 });
});

test('guard remains held until its last owning contact ends, including duplicate cancel delivery', () => {
  const input = new TouchInput();
  input.begin(4, 'guard'); input.begin(5, 'guard'); input.begin(6, 'attack');
  assert.equal(input.guardHeld, true);
  input.end(6);
  assert.equal(input.guardHeld, true, 'ending a one-shot action must not release a separate guard');
  input.end(4);
  assert.equal(input.guardHeld, true, 'the other guard contact still owns the hold');
  assert.equal(input.end(4), undefined, 'pointerup followed by lost capture is harmless');
  input.end(5);
  assertRest(input);
});

test('pause or orientation reset clears all holds and ignores late events before a fresh contact', () => {
  const input = new TouchInput();
  input.begin(7, 'move', 90, 600, 40); input.move(7, 130, 560);
  input.begin(8, 'look', 240, 240); input.move(8, 310, 180);
  input.begin(9, 'guard'); input.begin(10, 'lantern');
  input.reset();
  assertRest(input);
  for (const id of [7, 8, 9, 10]) {
    assert.equal(input.move(id, 1000, 1000), undefined);
    assert.equal(input.end(id), undefined);
  }
  assertRest(input);

  input.begin(7, 'move', 30, 40, 30);
  input.move(7, 30, 40);
  assert.deepEqual(movement(input), [0, 0, 0, 0, false], 're-contact must not restore old run or movement');
  input.begin(8, 'look', 30, 40);
  assert.deepEqual(input.move(8, 31, 38), { dx: 1, dy: -2 }, 'look must start at the new orientation contact');
  input.end(7); input.end(8);
  assertRest(input);
});

test('joystick drift has a deadzone and running stops when the thumb returns inward', () => {
  for (const [dx, dy] of [[0, 0], [3, 4], [-3, 4], [0, -5.9]]) {
    const nearCenter = stickVector(dx, dy, 50);
    close(nearCenter.x, 0); close(nearCenter.z, 0);
    assert.equal(nearCenter.running, false);
  }
  const input = new TouchInput();
  input.begin(1, 'move', 100, 100, 50);
  input.move(1, 100, 54);
  assert.equal(input.running, true);
  assert.ok(input.z < -0.9);
  input.move(1, 100, 75);
  assert.equal(input.running, false);
  close(input.z, -(0.5 - 0.12) / (1 - 0.12));
  input.move(1, 103, 104);
  close(input.x, 0); close(input.z, 0);
  input.end(1);
  assertRest(input);
});

test('diagonal and out-of-ring drags stay bounded and preserve their requested direction', () => {
  for (const radius of [1, 38, 48, 70]) for (const angle of [0, 0.2, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const atEdge = stickVector(dx * radius, dy * radius, radius);
    const beyond = stickVector(dx * radius * 100, dy * radius * 100, radius);
    close(atEdge.x, dx); close(atEdge.z, dy);
    close(beyond.x, dx); close(beyond.z, dy);
    close(Math.hypot(beyond.x, beyond.z), 1);
    close(Math.hypot(beyond.knobX, beyond.knobY), radius);
    assert.equal(beyond.running, true);
  }
  close(stickVector(100, 100, 48).x, Math.SQRT1_2);
  close(stickVector(100, 100, 48).z, Math.SQRT1_2);
});

test('a rapid action can be used again after its own release without disturbing movement', () => {
  const input = new TouchInput();
  input.begin(1, 'move', 50, 50, 40); input.move(1, 50, 20);
  const moving = movement(input);
  for (const role of ['attack', 'dodge', 'jump', 'interact', 'lantern'] as const) {
    assert.equal(input.begin(2, role), true);
    assert.equal(input.begin(2, role), false, 'the same pointerdown cannot own a duplicate action');
    assert.equal(input.move(2, 200, 400), undefined);
    assert.equal(input.end(2), role);
    assert.deepEqual(movement(input), moving, `${role} must leave the movement thumb in control`);
  }
  input.end(1);
  assertRest(input);
});
