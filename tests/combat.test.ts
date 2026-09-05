import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTACK_COOLDOWN, ATTACK_COST, BALANCE, DODGE_COST, PARRY_STAGGER, PARRY_WINDOW, SWORD_DAMAGE, enemyTiming, resolveStrike, swordDamage, swingConnects } from '../src/combat.ts';
import { ROOMS } from '../src/campaign.ts';

const difficulties = ['explorer', 'adventurer', 'veteran'] as const;
const enemies = [ROOMS.troll_bridge.enemy!, ROOMS.treasure_room.enemy!];

test('challenge options consistently scale incoming damage, reaction time and encounter endurance', () => {
  for (const enemy of enemies) {
    const harm = difficulties.map(d => resolveStrike(enemy.damage, d, false, false, 1, 100).damage);
    const tells = difficulties.map(d => enemyTiming(enemy.kind, d, 0).tell);
    const hitsToWin = difficulties.map(d => Math.ceil(Math.round(enemy.health * BALANCE[d].enemyHealth) / SWORD_DAMAGE));
    assert.ok(harm[0] < harm[1] && harm[1] < harm[2], `${enemy.id}: difficulty must change consequences`);
    assert.ok(tells[0] > tells[1] && tells[1] > tells[2], `${enemy.id}: harder must not have a longer tell`);
    assert.ok(hitsToWin[0] < hitsToWin[1] && hitsToWin[1] < hitsToWin[2], `${enemy.id}: challenge must change actual fight length`);
  }
});

test('even the fastest late encounter offers time to recognize a tell and execute one counterattack', () => {
  for (const enemy of enemies) for (const difficulty of difficulties) for (const injured of [0, 0.6, 0.9]) {
    const timing = enemyTiming(enemy.kind, difficulty, injured);
    assert.ok(timing.tell >= 0.6, `${enemy.id} ${difficulty}: a sub-600ms cue is too abrupt for the adventure default controls`);
    assert.ok(timing.recovery >= 0.8, `${enemy.id} ${difficulty}: recovery needs room for a deliberate counterattack`);
    assert.ok(PARRY_WINDOW > 0.15 && PARRY_WINDOW < timing.tell / 2, 'a parry requires timing rather than holding throughout the tell');
  }
});

test('timed defense is rewarded, holding guard is safer than a hit but has a real cost, and empty guard fails', () => {
  for (const enemy of enemies) for (const difficulty of difficulties) {
    const incoming = resolveStrike(enemy.damage, difficulty, false, false, 1, 100);
    const parry = resolveStrike(enemy.damage, difficulty, false, true, PARRY_WINDOW / 2, 100);
    const guard = resolveStrike(enemy.damage, difficulty, false, true, PARRY_WINDOW + 0.1, 100);
    const empty = resolveStrike(enemy.damage, difficulty, false, true, PARRY_WINDOW + 0.1, 0);
    const dodge = resolveStrike(enemy.damage, difficulty, true, false, 10, 0);
    assert.equal(parry.damage, 0); assert.equal(parry.parried, true);
    assert.ok(parry.staminaCost > 0 && parry.staminaCost < guard.staminaCost);
    assert.ok(guard.damage > 0 && guard.damage < incoming.damage); assert.equal(guard.parried, false);
    assert.equal(empty.damage, incoming.damage); assert.equal(empty.blocked, false);
    assert.equal(dodge.damage, 0, 'a successful dodge must not also take the hit');
  }
});

test('defense never charges more stamina than available or grants an exhausted player a free parry', () => {
  for (let stamina = 0; stamina <= 100; stamina++) for (const difficulty of difficulties) for (const age of [0.01, PARRY_WINDOW, PARRY_WINDOW + 0.001, 10]) {
    const result = resolveStrike(26, difficulty, false, true, age, stamina);
    assert.ok(result.staminaCost >= 0 && result.staminaCost <= stamina);
    assert.ok(result.damage >= 0);
    if (stamina === 0) assert.equal(result.parried, false);
  }
});

test('the stamina budget allows a short defensive burst but cannot fund endless sword swings', () => {
  assert.ok(ATTACK_COST > 0 && DODGE_COST > ATTACK_COST);
  assert.ok(2 * ATTACK_COST + DODGE_COST + 8 <= 100, 'two counters, a dodge and a parry should fit in one full bar');
  assert.ok(6 * ATTACK_COST > 100, 'continuous attacks must eventually require recovery');
  assert.ok(Math.ceil(ROOMS.treasure_room.enemy!.health / SWORD_DAMAGE) * ATTACK_COST > 100, 'the second encounter should outlast a single unbroken sword burst');
  for (const difficulty of difficulties) {
    assert.ok(100 / BALANCE[difficulty].staminaRecovery < 5, 'a spent player should rejoin the fight without a long idle wait');
  }
});

test('reading an opening pays more per stamina than mashing into a guard', () => {
  const fullBarAttacks = Math.floor(100 / ATTACK_COST);
  for (const enemy of enemies) {
    const ordinary = swordDamage(enemy.kind, 'recover');
    const parryPunish = swordDamage(enemy.kind, 'hurt');
    for (const mode of ['idle', 'walk', 'windup', 'attack']) {
      const guarded = swordDamage(enemy.kind, mode);
      assert.ok(guarded.amount > 0 && guarded.amount < ordinary.amount, `${enemy.id}: guard must turn an impatient strike without making it feel unresponsive`);
      assert.equal(guarded.glancing, true);
      assert.ok(fullBarAttacks * guarded.amount < enemy.health * BALANCE.explorer.enemyHealth, `${enemy.id}: even the accessible encounter must survive a bar of guarded hits`);
    }
    assert.ok(parryPunish.amount > ordinary.amount, 'a precise defense needs a tangible reward');
    assert.equal(ordinary.glancing, false); assert.equal(parryPunish.glancing, false);
    const deliberateReads = Math.ceil(enemy.health / (2 * ordinary.amount));
    assert.ok(deliberateReads >= 3 && deliberateReads <= 4, `${enemy.id}: two reliable counters per opening should make a short, substantive encounter`);
  }
});

test('a perfect parry provides a useful burst without erasing either encounter in one opening', () => {
  assert.ok(PARRY_STAGGER >= ATTACK_COOLDOWN * 1.5, 'there should be room to recognize the parry and answer twice');
  // Generously allow an already committed strike at time zero as well as every
  // following cooldown. Even this optimistic burst must leave a full foe alive.
  const generousHits = Math.ceil(PARRY_STAGGER / ATTACK_COOLDOWN) + 1;
  for (const enemy of enemies) for (const difficulty of difficulties) {
    const burst = generousHits * swordDamage(enemy.kind, 'hurt').amount;
    assert.ok(burst < Math.round(enemy.health * BALANCE[difficulty].enemyHealth), `${enemy.id} ${difficulty}: one parry should not settle the entire encounter`);
  }
});

test('a committed enemy swing can be avoided by stepping behind it or out of reach', () => {
  assert.equal(swingConnects(2.7, 0), true, 'standing in front within striking distance must remain dangerous');
  assert.equal(swingConnects(2.7, Math.PI), false, 'the weapon cannot deal damage behind its wielder');
  assert.equal(swingConnects(2.7, Math.PI / 2), false, 'a complete sidestep should escape a committed forward swing');
  assert.equal(swingConnects(4.2, 0), false, 'moving outside the arc must avoid damage');
  assert.equal(swingConnects(2.7, 0.4), swingConnects(2.7, -0.4), 'left and right escapes should be equally fair');
});
