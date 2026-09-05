/// <reference types="vite/client" />
import './style.css';
import './touch-controls.css';
import * as THREE from 'three';
import { ROOMS, ITEMS, START_ROOM } from './campaign.ts';
import { createGame, interact, travel, objective, hints, hintKey, serialize, deserialize, defeatEnemy, retryFromCheckpoint } from './game.ts';
import { GameView } from './view.ts';
import { GameUI } from './ui.ts';
import { Soundscape } from './audio.ts';
import { loadMaterials } from './materials.ts';
import { TouchControls, prefersTouchControls } from './touch-controls.ts';
import { arrivalAt, houseDistrictAt, isHouseGrounds, sceneBounds, visitDistrict } from './scene-layout.ts';
import { constrainRouteStep, routeFloorHeight } from './route-surfaces.ts';
import { doorwayTargetScore } from './interaction-target.ts';
import { hasLight, GRUE_DEATH, GRUE_DESCRIPTION, GRUE_WARNING, grueTiming } from './darkness.ts';
import { ATTACK_COST, DODGE_COST, ATTACK_COOLDOWN, PARRY_STAGGER, BALANCE, resolveStrike, enemyTiming, swingConnects, swordDamage } from './combat.ts';
import type { Difficulty } from './combat.ts';
import type { ActionResult, ExitDef, GameState, ObjectDef } from './types.ts';

const ui = new GameUI(), sound = new Soundscape();
const QA = (import.meta.env.DEV || import.meta.env.MODE === 'qa') && new URLSearchParams(location.search).has('review');
const initialTouch = prefersTouchControls() || QA && new URLSearchParams(location.search).has('touch');
const SAVE_KEY = `zork-expedition-v1${QA ? '-review-' + (new URLSearchParams(location.search).get('review') || 'default') : ''}`;
let saved: GameState | null = null;
try { const raw = localStorage.getItem(SAVE_KEY); if (raw) saved = deserialize(raw); } catch { /* Private browsing can disable local saves. */ }
let state = saved ?? createGame();
let qualityChosen = Boolean(saved);
if (!saved && initialTouch) state.settings.quality = 'balanced';
let view: GameView;
let touch: TouchControls | undefined;
let playing = false, paused = true, transitioning = false, titleMode = true, dying = false;
let pitch = 0, time = 0, previousTime = 0, saveTime = 0, uiTime = 0;
let vy = 0, jump = 0, moving = 0, nextStep = 0, damageFlash = 0, darkTime = 0;
let attackTime = 0, attackHit = false, attackCooldown = 0, blocking = false, blockStarted = -10;
let guardHeld = false, mouseGuardHeld = false, touchGuardHeld = false;
let dodgeTime = 0, dodgeVector = new THREE.Vector2(), exhaustedUntil = 0;
let enemyMode = 'idle', enemyTimer = 0, enemyMaxHp = 100, enemyStun = 0, combatEngaged = false;
let enemyFlinch = 0, swingFacing = 0;
let enemyAttackHit = false, nextGrueBite = 0, nextGlancingHint = 0;
let activeObject = '', target: { object?: ObjectDef; exit?: ExitDef } = {};
let hintIndex = 0, hintContext = '', lastHint = '', questReminder = '';
let mouseLookActive = false, capturePending = false, intentionalUnlock = false;
let mousePosition: { x: number; y: number } | null = null;
let edgeLookX = 0, edgeLookY = 0, hoveredTime = 0;
let actualFps = 60, lastRender = 0;
const keys = new Set<string>(), forward = new THREE.Vector3(), motionVector = new THREE.Vector2();
const reviewHolds = new Map<string, number>();
const hintProgress = new Map<string, number>();

function difficulty(): Difficulty { return state.settings.difficulty ?? 'adventurer'; }
function applyDifficulty(game: GameState, next: Difficulty) {
  const previous = game.settings.difficulty ?? 'adventurer';
  for (const room of Object.values(ROOMS)) {
    const enemy = room.enemy;
    if (!enemy || game.enemies[enemy.id] === undefined || game.flags[`${enemy.id}_defeated`]) continue;
    const oldMax = Math.round(enemy.health * BALANCE[previous].enemyHealth), newMax = Math.round(enemy.health * BALANCE[next].enemyHealth);
    game.enemies[enemy.id] = Math.ceil(Math.min(1, game.enemies[enemy.id] / oldMax) * newMax);
  }
  game.settings.difficulty = next;
}
function save(announce = false) {
  if (!playing) return;
  if (view.room?.id === state.room) { state.position = [view.camera.position.x, view.camera.position.z]; state.yaw = view.camera.rotation.y; }
  try { localStorage.setItem(SAVE_KEY, serialize(state)); saved = deserialize(serialize(state)); if (announce) ui.saveIndicator(); }
  catch { if (announce) ui.toast('This browser could not save your expedition. Export it from the pause menu to keep a copy.', 'Save unavailable', 9); }
}
function canLook() { return playing && !titleMode && !paused && !dying && !document.hidden && document.hasFocus(); }
function resetMousePosition() { mousePosition = null; edgeLookX = 0; edgeLookY = 0; }
function unlock() {
  mouseLookActive = false; resetMousePosition(); ui.canvas.classList.remove('mouse-look-active');
  if (document.pointerLockElement === ui.canvas) { intentionalUnlock = true; document.exitPointerLock(); }
}
function lock() {
  if (!canLook() || touch?.enabled) return;
  mouseLookActive = true; resetMousePosition(); ui.canvas.classList.add('mouse-look-active');
  if (document.pointerLockElement === ui.canvas || capturePending) return;
  capturePending = true;
  try {
    const promise = ui.canvas.requestPointerLock();
    if (promise) void promise.catch(() => { capturePending = false; });
  } catch { capturePending = false; }
  // When capture is unavailable, active play still accepts mouse movement and
  // clicks without requiring a held button. Edge turning covers screen bounds.
}
function setPaused(value: boolean) {
  paused = value; keys.clear(); if (QA) reviewHolds.clear(); blocking = false; guardHeld = false; mouseGuardHeld = false; touchGuardHeld = false; sound.setPaused(value);
  touch?.setActive(!value && playing && !titleMode && !dying && !transitioning);
  if (value) { unlock(); save(); } else { ui.close(); ui.canvas.focus({ preventScroll: true }); lock(); }
}
function resetMotion() {
  touch?.reset();
  pitch = 0; vy = 0; jump = 0; attackTime = 0; attackCooldown = 0; dodgeTime = 0; damageFlash = 0; darkTime = 0;
  enemyMode = 'idle'; enemyTimer = 0; enemyStun = 0; combatEngaged = false; moving = 0; target = {}; nextGrueBite = 0;
  ui.prompt(''); ui.enemy('', 1, '', false); keys.clear(); blocking = false; guardHeld = false; mouseGuardHeld = false; touchGuardHeld = false; enemyAttackHit = false;
}
function loadRoom(reveal = true) {
  resetMotion(); const room = ROOMS[state.room];
  lastHint = ''; hintIndex = 0; hintContext = '';
  view.enter(room, state); sound.enter(room);
  const landing = collidingPosition(view.camera.position.x, view.camera.position.z);
  state.position = [landing.x, landing.y];
  view.camera.position.set(landing.x, 1.72 + routeFloorHeight(state.room, state.position, state.flags), landing.y);
  const enemy = room.enemy;
  if (enemy) { enemyMaxHp = Math.round(enemy.health * BALANCE[difficulty()].enemyHealth); if (state.enemies[enemy.id] === undefined || state.enemies[enemy.id] <= 0 && !state.flags[`${enemy.id}_defeated`]) state.enemies[enemy.id] = enemyMaxHp; }
  if (reveal) ui.location(room);
  refresh();
}
function refresh() { view.refreshObjects(state); ui.objective(objective(state)); }
function enterDistrict(id: string) {
  if (id === state.room) return;
  const firstVisit = visitDistrict(state, id), room = ROOMS[id];
  view.room = room;
  ui.location(room, firstVisit);
  if (firstVisit) ui.toast(room.description, '', 8);
  sound.enter(room); refresh();
}
async function travelTo(exit: ExitDef) {
  if (transitioning || paused) return;
  if (exit.district && exit.district !== state.room) enterDistrict(exit.district);
  const result = travel(state, exit.id);
  if (!result.success || !result.travel) { handleResult(result); return; }
  await transitionRoom();
}
async function transitionRoom() {
  transitioning = true; keys.clear(); touch?.setActive(false); resetMousePosition(); ui.fade(true); sound.effect('door');
  await new Promise(resolve => window.setTimeout(resolve, 270));
  loadRoom(); save();
  await new Promise(resolve => window.setTimeout(resolve, 140));
  ui.fade(false); transitioning = false; touch?.setActive(playing && !paused && !titleMode && !dying);
  ui.toast(ROOMS[state.room].description, '', 5.5);
}
function handleResult(result: ActionResult) {
  if (result.travel) { setPaused(false); void transitionRoom(); return; }
  const ending = result.ending || state.completed && result.ending !== false && result.title?.toLowerCase().includes('master');
  if (result.sound) sound.effect(result.sound); else sound.effect(result.success ? 'take' : 'ui');
  if (result.itemSelection || result.choices?.length || result.prompt) { setPaused(true); ui.choice(result); }
  else {
    if (ui.currentPanel === 'interaction' && !ending) setPaused(false);
    if (result.message) ui.toast(result.message, result.title ?? '', result.message.length > 190 ? 10 : 6);
  }
  if (ending) { setPaused(true); if (result.sound !== 'win' && result.sound !== 'ending') sound.effect('ending'); ui.ending(state); }
  refresh(); save(true);
}
function interactTarget() {
  if (paused || titleMode || transitioning || dying) return;
  selectTarget();
  if (target.exit) { void travelTo(target.exit); return; }
  if (target.object) {
    if (target.object.district && target.object.district !== state.room) enterDistrict(target.object.district);
    activeObject = target.object.id; handleResult(interact(state, activeObject));
  }
  else ui.toast('Move close to something and face it to take a closer look.', '', 3);
}
function selectTarget() {
  const room = view.worldRoom ?? ROOMS[state.room]; const pos = view.camera.position;
  forward.set(0, 0, -1).applyQuaternion(view.camera.quaternion); forward.y = 0; forward.normalize();
  let score = 100, best: typeof target = {};
  for (const object of room.objects) {
    if (darkTime > 4 && !hasLight(state) && !(object.action === 'grate' && state.flags.grate_open) && object.action !== 'cellar_hatch') continue;
    if (object.hiddenIf && state.flags[object.hiddenIf] || object.requires && !state.flags[object.requires]) continue;
    if (object.id === 'kitchen_window' && pos.z > -17.7) continue;
    // The contents are the next reachable object while the opened container is occupied.
    if (object.id === 'gold_coffin' && state.flags.coffin_open && !state.flags.picked_sceptre) continue;
    const objPos = view.objectPosition(object), dx = objPos.x - pos.x, dz = objPos.z - pos.z, distance = Math.hypot(dx, dz);
    const dot = distance < 0.4 ? 1 : (dx * forward.x + dz * forward.z) / distance;
    const passage = room.exits.find(exit => exit.via === object.id && ['window', 'mirror'].includes(exit.role ?? ''));
    const s = passage ? doorwayTargetScore(passage, pos, forward)
      : distance < 3.6 && dot > 0.72 ? distance + (1 - dot) * 2.8 : Infinity;
    if (s < score) { score = s; best = { object }; }
  }
  for (const exit of room.exits) {
    if (exit.via) continue;
    if ((exit.to === 'barrow' || exit.requires === 'cyclops_fled') && !state.flags[exit.requires ?? 'barrow_path_open']) continue;
    const s = doorwayTargetScore(exit, pos, forward);
    if (s < score) { score = s; best = { exit }; }
  }
  target = best;
  if (best.object) {
    const object = best.object;
    const passage = room.exits.find(exit => exit.via === object.id);
    const usablePassage = passage && (!passage.requires || state.flags[passage.requires]);
    const label = object.id === 'kitchen_window' && state.flags.window_open ? 'Climb through the window'
      : object.action === 'grate' && state.flags.grate_open ? 'Climb through the grating'
      : object.action === 'mirror' && state.flags.mirror_awakened ? 'Step through the mirror'
      : object.id === 'mailbox' && state.flags.mailbox_read ? 'Read the leaflet'
      : object.id === 'bat_roost' && state.flags.bat_quiet ? 'Bat’s roost'
      : object.id === 'folded_boat' && state.flags.boat_ready ? 'Inflated boat' : object.label;
    const action = usablePassage ? 'Travel' : object.treasure ? 'Treasure of the empire'
      : object.action === 'take' ? 'Take'
      : object.action === 'read' && !['bowl', 'tree_marks', 'timber_grooves', 'axe_scars', 'sand_marks'].includes(object.type) ? 'Read' : 'Examine';
    ui.prompt(label, action);
  }
  else if (best.exit) ui.prompt(best.exit.label, state.visited.includes(best.exit.to) ? ROOMS[best.exit.to]?.name ?? 'Route' : 'Explore the route');
  else ui.prompt('');
}
function tryAttack() {
  if (paused || titleMode || transitioning || dying) return;
  if (!state.inventory.includes('sword')) { if (target.object || target.exit) interactTarget(); else ui.toast('The house may contain something more useful than your bare hands.', '', 3); return; }
  if (attackCooldown > 0 || dodgeTime > 0) return;
  if (state.stamina < ATTACK_COST) { ui.toast('Let your guard settle. Stamina returns quickly.', '', 2); return; }
  state.stamina -= ATTACK_COST; attackTime = 0.48; attackCooldown = ATTACK_COOLDOWN; attackHit = false; blocking = false; exhaustedUntil = time + 0.6;
  sound.effect('swing');
}
function tryDodge() {
  if (paused || titleMode || transitioning || dodgeTime > 0 || state.stamina < DODGE_COST) return;
  state.stamina -= DODGE_COST; dodgeTime = 0.36; exhaustedUntil = time + 0.5; blocking = false;
  let x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (touch?.input.x ?? 0), z = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0) + (touch?.input.z ?? 0);
  if (!x && !z) z = 1;
  const yaw = view.camera.rotation.y; dodgeVector.set(x * Math.cos(yaw) + z * Math.sin(yaw), z * Math.cos(yaw) - x * Math.sin(yaw)).normalize(); sound.effect('dodge');
}
function beginBlock() { guardHeld = true; if (!paused && state.inventory.includes('sword') && !blocking && attackCooldown <= 0 && dodgeTime <= 0) { blocking = true; blockStarted = time; } }
function releaseMouseGuard() { mouseGuardHeld = false; if (!keys.has('KeyR') && !touchGuardHeld) { blocking = false; guardHeld = false; } }
function releaseTouchGuard() { touchGuardHeld = false; if (!keys.has('KeyR') && !mouseGuardHeld) { blocking = false; guardHeld = false; } }
function toggleLantern() {
  if (paused || titleMode || transitioning || dying) return;
  if (state.inventory.includes('lantern')) { state.lantern = !state.lantern; sound.effect('lantern'); refresh(); save(); }
  else ui.toast('Find a lantern before you enter the dark.', '', 3);
}
function hurt(amount: number, cause = '') {
  if (amount <= 0 || dying) return;
  state.health = Math.max(0, state.health - amount); damageFlash = 0.85; sound.effect('hurt');
  if (state.health <= 0) { dying = true; state.deaths++; setPaused(true); sound.effect('death'); ui.death(ROOMS[state.checkpoint] ?? ROOMS.living_room ?? ROOMS[START_ROOM], cause); }
}
function updateEnemy(dt: number) {
  const def = ROOMS[state.room].enemy, model = view.enemy;
  if (!def || !model) { ui.enemy('', 1, '', false); return; }
  if (state.flags[`${def.id}_defeated`]) { enemyMode = 'dead'; enemyTimer += dt; model.animate(time, 'dead', Math.min(1, enemyTimer * 0.9)); ui.enemy('', 0, '', false); return; }
  const enemy = model.group, player = view.camera.position;
  const dx = player.x - enemy.position.x, dz = player.z - enemy.position.z, distance = Math.hypot(dx, dz);
  const hp = state.enemies[def.id] ?? enemyMaxHp;
  if (def.kind === 'thief' && distance > 7 && !combatEngaged) { model.animate(time, 'idle', 0); ui.enemy('', 1, '', false); return; }
  if (distance < 12 || combatEngaged) {
    if (!combatEngaged) { combatEngaged = true; sound.effect('roar'); ui.toast(def.kind === 'troll' ? 'Watch the axe. Dodge or parry, then strike in the recovery for full damage.' : 'A quick blade. Make him miss, then strike before he recovers.', 'Keep your footing', 5); }
    const facing = Math.atan2(dx, dz);
    if (enemyMode !== 'attack' && (enemyMode !== 'windup' || enemyTimer < 0.25)) enemy.rotation.y += Math.atan2(Math.sin(facing - enemy.rotation.y), Math.cos(facing - enemy.rotation.y)) * Math.min(1, dt * 8);
    const timing = enemyTiming(def.kind, difficulty(), 1 - hp / enemyMaxHp);
    if (enemyStun > 0) { enemyStun -= dt; enemyMode = 'hurt'; if (enemyStun <= 0) { enemyMode = 'idle'; enemyTimer = 0; } }
    else if (enemyMode === 'windup') {
      enemyTimer += dt;
      if (enemyTimer >= timing.tell) {
        enemyMode = 'attack'; enemyTimer = 0; enemyAttackHit = false;
      }
    } else if (enemyMode === 'attack') {
      enemyTimer += dt;
      if (!enemyAttackHit && enemyTimer >= 0.14) {
        enemyAttackHit = true;
        if (swingConnects(distance, facing - enemy.rotation.y)) {
          const toEnemy = new THREE.Vector2(-dx, -dz).normalize(); const look = new THREE.Vector2(-Math.sin(state.yaw), -Math.cos(state.yaw));
          const facingEnemy = toEnemy.dot(look) > 0.15;
          const outcome = resolveStrike(def.damage ?? timing.damage, difficulty(), dodgeTime > 0, blocking && facingEnemy, time - blockStarted, state.stamina);
          state.stamina = Math.max(0, state.stamina - outcome.staminaCost);
          if (outcome.parried) { enemyStun = PARRY_STAGGER; enemyMode = 'hurt'; sound.effect('parry'); view.impact('parry'); ui.toast('A clean parry. Now.', '', 1.3); }
          else if (outcome.blocked) { sound.effect('block'); view.impact('block'); }
          hurt(outcome.damage);
        } else sound.effect('swing');
      }
      if (enemyMode === 'attack' && enemyTimer > 0.35) { enemyMode = 'recover'; enemyTimer = 0; }
    }
    else if (enemyMode === 'recover') { enemyTimer += dt; if (enemyTimer > timing.recovery) { enemyMode = 'idle'; enemyTimer = 0; } }
    else {
      if (distance > 2.75) {
        enemyMode = 'walk'; const speed = def.speed * (def.kind === 'thief' ? 0.92 : 0.85); const step = Math.min(distance - 2.7, speed * dt);
        const result = collidingPosition(enemy.position.x + dx / distance * step, enemy.position.z + dz / distance * step, 0.7);
        enemy.position.x = result.x; enemy.position.z = result.y;
      } else { enemyMode = 'windup'; enemyTimer = 0; }
    }
    const intent = enemyMode === 'windup' ? 'Incoming — dodge or parry' : enemyMode === 'recover' ? 'An opening. Strike.' : enemyMode === 'hurt' ? 'Staggered' : 'Hold your ground';
    ui.enemy(def.name, hp / enemyMaxHp, intent, true);
    const phase = enemyMode === 'windup' ? enemyTimer / timing.tell : enemyMode === 'attack' ? enemyTimer / 0.35 : enemyMode === 'recover' ? enemyTimer / timing.recovery : 0;
    model.animate(time, enemyMode, Math.min(1, phase));
    enemyFlinch = Math.max(0, enemyFlinch - dt * 6);
    model.group.rotation.z = Math.sin(enemyFlinch * Math.PI) * 0.04;
  } else model.animate(time, 'idle', 0);
}
function hitEnemy() {
  const def = ROOMS[state.room].enemy, model = view.enemy; if (!def || !model || state.flags[`${def.id}_defeated`]) return;
  const offset = model.group.position.clone().sub(view.camera.position); offset.y = 0; const distance = offset.length();
  forward.set(0, 0, -1).applyQuaternion(view.camera.quaternion); forward.y = 0; forward.normalize();
  if (distance > 3.3 || distance > 0.1 && offset.normalize().dot(forward) < 0.32) return;
  combatEngaged = true;
  const strike = swordDamage(def.kind, enemyMode);
  state.enemies[def.id] = Math.max(0, (state.enemies[def.id] ?? enemyMaxHp) - strike.amount); sound.effect(strike.glancing ? 'block' : 'hit'); view.impact(strike.glancing ? 'block' : 'hit');
  if (strike.glancing && time > nextGlancingHint) { nextGlancingHint = time + 7; ui.toast('His guard turns the blade. Strike after he misses, or after a parry.', 'Glancing blow', 3); }
  if (state.enemies[def.id] <= 0) { enemyMode = 'dead'; enemyTimer = 0; combatEngaged = false; handleResult(defeatEnemy(state, def.id)); }
  else enemyFlinch = 1;
}
function collidingPosition(x: number, z: number, radius = 0.38) {
  const bounds = sceneBounds(state.room);
  x = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, x));
  z = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, z));
  for (const collider of view.colliders) {
    const nx = Math.max(collider.x - collider.w / 2, Math.min(x, collider.x + collider.w / 2));
    const nz = Math.max(collider.z - collider.d / 2, Math.min(z, collider.z + collider.d / 2));
    const dx = x - nx, dz = z - nz, d = Math.hypot(dx, dz);
    if (d < radius && d > 0.0001) { x += dx / d * (radius - d); z += dz / d * (radius - d); }
    else if (d <= 0.0001) {
      const left = Math.abs(x - (collider.x - collider.w / 2)), right = Math.abs(x - (collider.x + collider.w / 2));
      const front = Math.abs(z - (collider.z - collider.d / 2)), back = Math.abs(z - (collider.z + collider.d / 2));
      const nearest = Math.min(left, right, front, back);
      if (nearest === left) x = collider.x - collider.w / 2 - radius;
      else if (nearest === right) x = collider.x + collider.w / 2 + radius;
      else if (nearest === front) z = collider.z - collider.d / 2 - radius;
      else z = collider.z + collider.d / 2 + radius;
    }
  }
  return new THREE.Vector2(x, z);
}
function updatePlayer(dt: number) {
  if (!touch?.enabled && mouseLookActive && document.pointerLockElement !== ui.canvas) {
    view.camera.rotation.y -= edgeLookX * 1.75 * state.settings.sensitivity * dt;
    pitch = Math.max(-1.38, Math.min(1.38, pitch - edgeLookY * 1.25 * state.settings.sensitivity * dt));
    view.camera.rotation.x = pitch;
  }
  const yaw = view.camera.rotation.y;
  let x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (touch?.input.x ?? 0), z = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0) + (touch?.input.z ?? 0);
  motionVector.set(x, z); if (motionVector.lengthSq() > 1) motionVector.normalize();
  x = motionVector.x; z = motionVector.y;
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || !!touch?.input.running;
  const speed = blocking ? 2.3 : running ? 7.3 : 4.6;
  const dx = (x * Math.cos(yaw) + z * Math.sin(yaw)) * speed * dt, dz = (z * Math.cos(yaw) - x * Math.sin(yaw)) * speed * dt;
  const dodgeStep = dodgeTime > 0 ? 10.5 * dt : 0;
  const pos = view.camera.position;
  const result = collidingPosition(pos.x + dx + dodgeVector.x * dodgeStep, pos.z + dz + dodgeVector.y * dodgeStep);
  const grounded = constrainRouteStep(state.room, [pos.x, pos.z], [result.x, result.y], state.flags);
  result.set(grounded[0], grounded[1]);
  const enemyDef = ROOMS[state.room].enemy;
  if (view.enemy && enemyDef && !state.flags[`${enemyDef.id}_defeated`]) {
    const enemy = view.enemy.group.position, distance = Math.hypot(result.x - enemy.x, result.y - enemy.z), radius = enemyDef.kind === 'troll' ? 1.85 : 1.35;
    if (distance < radius && distance > 0.0001) { result.x = enemy.x + (result.x - enemy.x) / distance * radius; result.y = enemy.z + (result.y - enemy.z) / distance * radius; }
  }
  const displacement = Math.hypot(pos.x - result.x, pos.z - result.y);
  moving = THREE.MathUtils.damp(moving, displacement > dt * 0.1 ? running ? 1.4 : 1 : 0, 9, dt);
  pos.x = result.x; pos.z = result.y;
  if (jump > 0 || vy > 0) { vy -= 17 * dt; jump = Math.max(0, jump + vy * dt); if (jump === 0) vy = 0; }
  pos.y = 1.72 + routeFloorHeight(state.room, [pos.x, pos.z], state.flags) + jump + (state.settings.motion ? Math.sin(time * (running ? 13 : 10)) * moving * 0.024 : 0);
  if (keys.has('ArrowLeft')) view.camera.rotation.y += dt * 1.7;
  if (keys.has('ArrowRight')) view.camera.rotation.y -= dt * 1.7;
  if (keys.has('ArrowUp')) pitch = Math.min(1.3, pitch + dt);
  if (keys.has('ArrowDown')) pitch = Math.max(-1.3, pitch - dt);
  view.camera.rotation.x = pitch;
  state.yaw = view.camera.rotation.y; state.position = [pos.x, pos.z];
  if (isHouseGrounds(state.room)) enterDistrict(houseDistrictAt(state.position, state.room));
  if (displacement > dt * 0.1 && jump <= 0 && time > nextStep) { nextStep = time + (running ? 0.31 : 0.43); sound.effect('step'); }
  if (state.stamina < 100 && time > exhaustedUntil) state.stamina = Math.min(100, state.stamina + dt * BALANCE[difficulty()].staminaRecovery * (blocking ? 0.3 : 1));
  if (!combatEngaged && state.health < 100 && time > exhaustedUntil + 6 && (!ROOMS[state.room].dark || hasLight(state))) state.health = Math.min(100, state.health + dt * 2.5);
  if (ROOMS[state.room].dark && !hasLight(state)) {
    const before = darkTime; darkTime += dt;
    if (before < 1.3 && darkTime >= 1.3) {
      ui.toast(GRUE_WARNING, '', 10);
      if (!state.journal.some(entry => entry.id === 'grue')) state.journal.push({ id: 'grue', title: 'The grue', text: GRUE_DESCRIPTION });
    }
    const grue = grueTiming(state);
    if (darkTime >= grue.grace && darkTime >= nextGrueBite) { nextGrueBite = darkTime + grue.interval; exhaustedUntil = time; hurt(grue.damage, GRUE_DEATH); }
  } else { darkTime = 0; nextGrueBite = 0; }
  dodgeTime = Math.max(0, dodgeTime - dt); attackCooldown = Math.max(0, attackCooldown - dt);
  if (guardHeld && !blocking && attackCooldown <= 0 && dodgeTime <= 0 && state.inventory.includes('sword')) { blocking = true; blockStarted = time - 1; }
  if (attackTime > 0) { attackTime = Math.max(0, attackTime - dt); if (!attackHit && attackTime < 0.3) { attackHit = true; hitEnemy(); } }
  selectTarget();
  if (QA) for (const [key, remaining] of reviewHolds) { if (remaining <= dt) { keys.delete(key); reviewHolds.delete(key); } else reviewHolds.set(key, remaining - dt); }
}
function startFresh() {
  hintProgress.clear();
  const settings = { ...state.settings }; state = createGame(); state.settings = settings;
  beginPlay();
}
function beginPlay() {
  titleMode = false; playing = true; paused = false; dying = false; sound.setPaused(false); ui.play();
  loadRoom(); void sound.start(); sound.setVolume(state.settings.volume); save();
  ui.toast(ROOMS[state.room].description, '', 6); ui.canvas.focus({ preventScroll: true });
  if (state.health <= 0) { dying = true; setPaused(true); ui.death(ROOMS[state.checkpoint] ?? ROOMS[START_ROOM]); }
  else { touch?.setActive(true); lock(); }
}
function showJournal(tab = 'journal', selected = '') {
  const lead = objective(state), context = hintKey(state);
  if (context !== hintContext) { hintContext = context; lastHint = ''; hintIndex = hintProgress.get(context) ?? 0; }
  setPaused(true); ui.journal(state, ROOMS, ITEMS, lead, tab, selected, lastHint, hintProgress.get(context) ?? 0);
}
function canRestTravel() {
  if (dying) return false;
  if (combatEngaged && view.enemy && !state.flags[`${ROOMS[state.room].enemy?.id}_defeated`]) { ui.toast('Find a safe moment before you travel.', 'An enemy is close', 3); return false; }
  return true;
}
touch = new TouchControls(ui.canvas, ui.root, {
  enabled: initialTouch,
  onMode: enabled => {
    ui.setTouchMode(enabled); view?.setTouchMode(enabled);
    if (enabled) { unlock(); if (!saved && !playing && !qualityChosen) state.settings.quality = 'balanced'; }
  },
  onLook: (dx, dy) => {
    if (!canLook() || transitioning || !view) return;
    const rect = ui.canvas.getBoundingClientRect();
    const sensitivity = 2.4 / Math.max(320, Math.min(rect.width, rect.height)) * state.settings.sensitivity;
    view.camera.rotation.y -= dx * sensitivity;
    pitch = Math.max(-1.38, Math.min(1.38, pitch - dy * sensitivity));
    view.camera.rotation.x = pitch; state.yaw = view.camera.rotation.y;
  },
  onAction: action => {
    if (paused || titleMode || transitioning || dying) return;
    void sound.start();
    if (action === 'interact') interactTarget();
    else if (action === 'attack') tryAttack();
    else if (action === 'dodge') tryDodge();
    else if (action === 'jump' && jump === 0) vy = 5.3;
    else if (action === 'lantern') toggleLantern();
  },
  onGuard: held => { if (held) { touchGuardHeld = true; beginBlock(); } else releaseTouchGuard(); },
});
function fitVisualViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--visual-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
  document.documentElement.style.setProperty('--visual-viewport-top', `${viewport?.offsetTop ?? 0}px`);
}
fitVisualViewport();
window.addEventListener('resize', fitVisualViewport);
window.visualViewport?.addEventListener('resize', fitVisualViewport);
window.visualViewport?.addEventListener('scroll', fitVisualViewport);
ui.onChoice = action => { if (activeObject === '__restart') { if (action === 'yes') startFresh(); else { ui.close(); if (titleMode) ui.showTitle(!!saved); else setPaused(false); } return; } handleResult(interact(state, activeObject, action)); };
ui.onAction = action => {
  if (!view) return;
  if (dying && !['retry', 'settings', 'close', 'resume'].includes(action)) return;
  void sound.start();
  if (action === 'start') {
    if (saved) { activeObject = '__restart'; ui.choice({ success: true, title: 'A new expedition', message: 'This replaces the expedition saved on this device. You can export your current adventure from the pause menu first.', choices: [{ label: 'Begin a new expedition', action: 'yes' }, { label: 'Keep my current expedition', action: 'no' }] }); }
    else startFresh();
  } else if (action === 'continue') { if (saved) state = deserialize(serialize(saved)) ?? createGame(); beginPlay(); }
  else if (action === 'interact') interactTarget();
  else if (action === 'pause') { setPaused(true); ui.pause(ROOMS[state.room]); }
  else if (action === 'resume' || action === 'close') {
    if (titleMode) { ui.close(); ui.showTitle(!!saved); }
    else if (dying) ui.death(ROOMS[state.checkpoint] ?? ROOMS[START_ROOM]);
    else setPaused(false);
  } else if (action === 'settings') { setPaused(true); ui.settings(state); }
  else if (action === 'journal' || action === 'map' || action === 'inventory') showJournal(action);
  else if (action.startsWith('inspect:')) showJournal('inventory', action.slice(8));
  else if (action === 'hint') {
    const current = hintKey(state);
    if (current !== hintContext) { hintContext = current; hintIndex = hintProgress.get(current) ?? 0; }
    const options = hints(state); lastHint = options[Math.min(hintIndex++, options.length - 1)] ?? 'Examine the objects nearby.';
    hintProgress.set(current, hintIndex); showJournal();
  } else if (action.startsWith('camp:')) {
    const id = action.slice(5); if (!state.flags[`rest_${id}`] || !['living_room', 'round_room', 'temple', 'dam'].includes(id) || !canRestTravel()) return;
    state.room = id; Object.assign(state, arrivalAt(id)); state.health = 100; state.stamina = 100; state.checkpoint = id;
    setPaused(false); void transitionRoom();
  } else if (action === 'retry') {
    dying = false; retryFromCheckpoint(state);
    setPaused(false); void transitionRoom();
  } else if (action === 'title') { save(true); titleMode = true; playing = false; setPaused(true); ui.showTitle(!!saved); }
  else if (action === 'export') {
    save();
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([serialize(state)], { type: 'application/json' }));
    link.href = url; link.download = 'Zork — expedition.json'; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    ui.toast('Your browser is saving the expedition record.', 'Expedition record');
  } else if (action === 'import') (document.querySelector('#import-save') as HTMLInputElement).click();
  else if (action === 'credits') { setPaused(true); ui.credits(); }
};
ui.onSetting = (key, value) => {
  if (key === 'volume') { state.settings.volume = Number(value) / 100; sound.setVolume(state.settings.volume); }
  else if (key === 'sensitivity') state.settings.sensitivity = Number(value);
  else if (key === 'fov') state.settings.fov = Number(value);
  else if (key === 'quality' && (value === 'high' || value === 'balanced')) { state.settings.quality = value; qualityChosen = true; }
  else if (key === 'motion') state.settings.motion = value === 'true';
  else if (key === 'difficulty' && ['explorer', 'adventurer', 'veteran'].includes(value)) {
    applyDifficulty(state, value as Difficulty);
    const def = ROOMS[state.room].enemy; if (def) enemyMaxHp = Math.round(def.health * BALANCE[difficulty()].enemyHealth);
  }
  if (!playing && saved) {
    applyDifficulty(saved, difficulty()); saved.settings = { ...state.settings };
    try { localStorage.setItem(SAVE_KEY, serialize(saved)); } catch { /* Export remains available during play. */ }
  }
  save();
};
document.querySelector('#import-save')!.addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
  try { if (file.size > 1_000_000) throw new Error('That file is too large to be an expedition record.'); const data = deserialize(await file.text()); if (!data) throw new Error('That file is not a valid Zork expedition.'); hintProgress.clear(); state = data; saved = data; beginPlay(); ui.toast('Your expedition is restored.', 'Welcome back'); }
  catch (error) { ui.toast(error instanceof Error ? error.message : 'The record could not be restored.', 'Import failed', 7); }
  input.value = '';
});
document.addEventListener('keydown', event => {
  if (event.target instanceof Element && event.target.matches('input,select,textarea') && event.code !== 'Escape') return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (dying && event.code !== 'Escape') return;
  if (paused && ui.currentPanel && event.code === 'Tab') return;
  if (!titleMode && !paused && ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.repeat) { if (!paused) keys.add(event.code); return; }
  if (event.code === 'Escape') {
    event.preventDefault();
    if (titleMode) { ui.showTitle(!!saved); return; }
    // The browser can deliver the Escape unlock before this key event. Leave
    // the resulting pause screen open instead of immediately recapturing.
    if (paused && ui.currentPanel === 'pause') return;
    if (paused) ui.onAction('close'); else { setPaused(true); ui.pause(ROOMS[state.room]); }
    return;
  }
  if (titleMode) return;
  if (event.code === 'KeyJ' || event.code === 'KeyM' || event.code === 'Tab') {
    const tab = event.code === 'KeyM' ? 'map' : event.code === 'Tab' ? 'inventory' : 'journal';
    if (paused && ui.currentPanel === tab) setPaused(false);
    else showJournal(tab);
    return;
  }
  if (paused) return;
  keys.add(event.code);
  if (event.code === 'KeyE') interactTarget();
  else if (event.code === 'KeyF') tryAttack();
  else if (event.code === 'KeyR') beginBlock();
  else if (event.code === 'KeyQ') tryDodge();
  else if (event.code === 'KeyL') toggleLantern();
  else if (event.code === 'Space' && jump === 0) vy = 5.3;
});
document.addEventListener('keyup', event => { keys.delete(event.code); if (event.code === 'KeyR' && !mouseGuardHeld && !touchGuardHeld) { blocking = false; guardHeld = false; } });
window.addEventListener('blur', () => { keys.clear(); blocking = false; guardHeld = false; mouseGuardHeld = false; touchGuardHeld = false; touch?.reset(); resetMousePosition(); if (playing && !paused) { setPaused(true); ui.pause(ROOMS[state.room]); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing && !paused) { setPaused(true); ui.pause(ROOMS[state.room]); } });
document.addEventListener('pointerlockchange', () => {
  capturePending = false; resetMousePosition();
  if (document.pointerLockElement === ui.canvas) {
    intentionalUnlock = false;
    if (!mouseLookActive || !canLook()) unlock();
    return;
  }
  if (intentionalUnlock) { intentionalUnlock = false; return; }
  if (playing && !paused && mouseLookActive) { setPaused(true); ui.pause(ROOMS[state.room]); }
});
document.addEventListener('pointerlockerror', () => { capturePending = false; });
ui.canvas.addEventListener('contextmenu', event => event.preventDefault());
ui.canvas.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || paused || titleMode || transitioning) return;
  if (touch?.enabled) touch.setEnabled(false);
  if (event.button === 2) { mouseGuardHeld = true; beginBlock(); return; }
  if (event.button === 0) {
    if (mouseLookActive) tryAttack();
    else lock();
  }
});
window.addEventListener('pointerup', event => {
  if (event.pointerType === 'mouse' && event.button === 2) releaseMouseGuard();
});
ui.canvas.addEventListener('pointerleave', () => { resetMousePosition(); if (document.pointerLockElement !== ui.canvas) releaseMouseGuard(); });
ui.canvas.addEventListener('pointercancel', () => { resetMousePosition(); releaseMouseGuard(); });
document.addEventListener('mousemove', event => {
  if (paused || titleMode || transitioning || !view || !mouseLookActive || touch?.enabled) return;
  let dx = event.movementX, dy = event.movementY;
  if (document.pointerLockElement !== ui.canvas) {
    if (event.target !== ui.canvas) { resetMousePosition(); return; }
    const previous = mousePosition; mousePosition = { x: event.clientX, y: event.clientY };
    const rect = ui.canvas.getBoundingClientRect();
    const edge = (position: number) => position < 0.075 ? Math.max(-1, (position - 0.075) / 0.075) : position > 0.925 ? Math.min(1, (position - 0.925) / 0.075) : 0;
    edgeLookX = edge((event.clientX - rect.left) / rect.width); edgeLookY = edge((event.clientY - rect.top) / rect.height);
    if (!previous) return;
    dx = event.clientX - previous.x; dy = event.clientY - previous.y;
  }
  const sensitivity = 0.0021 * state.settings.sensitivity;
  view.camera.rotation.y -= dx * sensitivity;
  pitch = Math.max(-1.38, Math.min(1.38, pitch - dy * sensitivity));
  view.camera.rotation.x = pitch; state.yaw = view.camera.rotation.y;
});
window.addEventListener('beforeunload', () => save());
window.addEventListener('pagehide', () => { touch?.reset(); save(); });

function installReviewControls() {
  const panel = document.createElement('aside'); panel.id = 'review-controls';
  panel.style.cssText = 'position:fixed;left:12px;top:85px;z-index:99;padding:10px;background:#13201dec;color:#ddd;font:11px monospace;display:flex;gap:7px;flex-wrap:wrap;max-width:380px';
  panel.innerHTML = `<label>Review scene <select id="review-room">${Object.values(ROOMS).map(r => `<option value="${r.id}">${r.name}</option>`).join('')}</select></label><button id="review-enter">Enter scene</button><button id="review-equip">Equip expedition tools</button><button data-hold="KeyW">Walk forward 1s</button><button data-hold="KeyS">Walk back 1s</button><button data-hold="KeyA">Strafe left 1s</button><button data-hold="KeyD">Strafe right 1s</button><button id="review-left">Turn left 30°</button><button id="review-right">Turn right 30°</button><button id="review-up">Look up 20°</button><button id="review-down">Look down 20°</button><button id="review-interact">Interact E</button><button id="review-attack">Strike F</button><button id="review-parry">Guard 1s</button><button id="review-dodge">Dodge Q</button><button id="review-freeze">Freeze / resume</button><button id="review-hide">Hide tools</button><output id="review-position"></output>`;
  document.body.append(panel);
  const routeReview = document.createElement('div');
  routeReview.innerHTML = `<label>Review route <select id="review-route">${Object.values(ROOMS).flatMap(room => room.exits.map(exit => `<option value="${exit.id}">${room.name} → ${ROOMS[exit.to].name}</option>`)).join('')}</select></label><button id="review-approach-route">Approach route</button><button id="review-open-route">Open route for review</button><button id="review-close-route">Close route for review</button>`;
  panel.append(routeReview);
  const selectedRoute = () => {
    const id = (panel.querySelector('#review-route') as HTMLSelectElement).value;
    const room = Object.values(ROOMS).find(value => value.exits.some(exit => exit.id === id))!;
    return { room, exit: room.exits.find(value => value.id === id)! };
  };
  panel.querySelector('#review-approach-route')!.addEventListener('click', () => {
    const { room, exit } = selectedRoute();
    state.room = room.id; Object.assign(state, arrivalAt(room.id, exit.to)); state.yaw += Math.PI;
    if (!state.visited.includes(room.id)) state.visited.push(room.id);
    beginPlay();
  });
  for (const open of [false, true]) panel.querySelector(open ? '#review-open-route' : '#review-close-route')!.addEventListener('click', () => {
    const { exit } = selectedRoute();
    if (exit.requires) { state.flags[exit.requires] = open; refresh(); }
  });
  document.querySelector('#review-enter')!.addEventListener('click', () => { state.room = (document.querySelector('#review-room') as HTMLSelectElement).value; Object.assign(state, arrivalAt(state.room)); if (!state.visited.includes(state.room)) state.visited.push(state.room); beginPlay(); });
  document.querySelector('#review-equip')!.addEventListener('click', () => { for (const item of Object.values(ITEMS)) if (!item.treasure && item.id !== 'ancient_map') { if (!state.inventory.includes(item.id)) state.inventory.push(item.id); state.flags[`picked_${item.id}`] = true; } state.lantern = true; refresh(); });
  panel.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(button => button.addEventListener('click', () => { if (titleMode) return; if (paused) setPaused(false); const key = button.dataset.hold!; keys.add(key); reviewHolds.set(key, 1); }));
  document.querySelector('#review-left')!.addEventListener('click', () => { view.camera.rotation.y += Math.PI / 6; state.yaw = view.camera.rotation.y; });
  document.querySelector('#review-right')!.addEventListener('click', () => { view.camera.rotation.y -= Math.PI / 6; state.yaw = view.camera.rotation.y; });
  document.querySelector('#review-up')!.addEventListener('click', () => { pitch = Math.min(1.3, pitch + Math.PI / 9); view.camera.rotation.x = pitch; });
  document.querySelector('#review-down')!.addEventListener('click', () => { pitch = Math.max(-1.3, pitch - Math.PI / 9); view.camera.rotation.x = pitch; });
  document.querySelector('#review-interact')!.addEventListener('click', () => { if (paused && !ui.currentPanel) setPaused(false); interactTarget(); });
  document.querySelector('#review-attack')!.addEventListener('click', () => tryAttack());
  document.querySelector('#review-parry')!.addEventListener('click', () => { beginBlock(); window.setTimeout(() => { blocking = false; guardHeld = false; }, 1000); });
  document.querySelector('#review-dodge')!.addEventListener('click', () => tryDodge());
  document.querySelector('#review-freeze')!.addEventListener('click', () => { paused = !paused; keys.clear(); sound.setPaused(paused); });
  document.querySelector('#review-hide')!.addEventListener('click', () => panel.style.display = 'none');
  const atlas = document.createElement('button'); atlas.textContent = 'Reveal map'; panel.append(atlas);
  atlas.addEventListener('click', () => { state.visited = Object.keys(ROOMS); showJournal('map'); panel.style.display = 'none'; });
  document.addEventListener('keydown', event => { if (event.code === 'Backquote') panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; });
}
function frame(now: number) {
  requestAnimationFrame(frame);
  if (!view) return;
  if (document.hidden) { previousTime = now; return; }
  const rawDt = (now - previousTime) / 1000 || 0.016;
  const dt = Math.min(0.25, rawDt); previousTime = now; time += dt;
  actualFps = actualFps * 0.9 + (1 / Math.max(0.001, rawDt)) * 0.1;
  if (!paused && !titleMode && !transitioning && !dying) {
    state.playTime += dt;
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    for (let i = 0; i < steps && !dying; i++) { updatePlayer(dt / steps); updateEnemy(dt / steps); }
    sound.update(time);
    saveTime += dt; if (saveTime > 8) { saveTime = 0; save(); }
  }
  if (titleMode) {
    const room = ROOMS[state.room]; const angle = Math.sin(time * 0.045) * 0.08;
    view.camera.position.set(room.spawn[0] + 6 + Math.sin(angle) * 2, 2.9, Math.min(room.size[1] / 2 - 3, room.spawn[1] + 1));
    view.camera.lookAt(0, 3.3, -room.size[1] * 0.2);
  }
  damageFlash = Math.max(0, damageFlash - dt * 1.9);
  if ((!paused && !titleMode) || now - lastRender > (titleMode ? 40 : 100)) {
    lastRender = now;
    view.update(dt, state, { moving: paused ? 0 : moving, attack: attackTime / 0.48, blocking, damage: damageFlash, darkness: Math.min(1, darkTime / 7), darkTime, title: titleMode });
  }
  uiTime += dt;
  const lookMode = touch?.enabled ? 'touch' : document.pointerLockElement === ui.canvas ? 'captured' : mouseLookActive ? 'free' : 'inactive';
  if (uiTime > 0.1) {
    uiTime = 0; ui.update(state, lookMode, playing && !paused && !titleMode);
    touch?.setActive(playing && !paused && !titleMode && !transitioning && !dying);
    touch?.update(state.inventory.includes('sword'), state.inventory.includes('lantern'), state.lantern, !!(target.object || target.exit), target.exit ? 'Enter' : target.object?.action === 'take' ? 'Take' : target.object?.action === 'read' ? 'Read' : 'Interact');
  }
  if (QA) { const output = document.querySelector('#review-position'); const enemyDistance = view.enemy ? ` · enemy ${Math.hypot(view.enemy.group.position.x - state.position[0], view.enemy.group.position.z - state.position[1]).toFixed(2)}m` : ''; if (output) output.textContent = `${state.room} · x ${state.position[0].toFixed(1)} z ${state.position[1].toFixed(1)} yaw ${state.yaw.toFixed(2)} · floor ${(view.camera.position.y - 1.72 - jump).toFixed(2)}m · hp ${Math.round(state.health)}${enemyDistance} · attack ${attackTime.toFixed(2)}s · recovery ${attackCooldown.toFixed(2)}s · guard ${blocking ? 'up' : 'down'} · dark ${darkTime.toFixed(2)}s · ${hasLight(state) ? 'light' : 'no light'} · mouse ${lookMode} · ${view.drawCalls} draws · ${Math.round(actualFps)} fps · ${Math.round(view.renderMs)}ms · ${view.gpu}`; }
}
async function boot() {
  try {
    ui.loading(0.04, 'Gathering the things an adventure needs');
    const materials = await loadMaterials(n => ui.loading(0.08 + n * 0.8, 'Opening the Great Underground Empire'));
    view = new GameView(ui.canvas, materials, touch?.enabled ?? initialTouch);
    // Title always opens in the forest; the saved expedition is only loaded on Continue.
    const start = createGame(); state = { ...start, settings: { ...state.settings } };
    view.enter(ROOMS[START_ROOM], state); sound.enter(ROOMS[START_ROOM]); ui.loading(1);
    ui.ready(!!saved); if (QA) installReviewControls(); requestAnimationFrame(frame);
  } catch (error) { console.error(error); ui.error(error instanceof Error ? error.message : 'The graphics engine could not be initialized.'); }
}
void boot();
if (import.meta.env.PROD && import.meta.env.MODE !== 'qa' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
  window.setInterval(() => { if (!document.hidden) void fetch('./health', { cache: 'no-store' }).catch(() => {}); }, 60_000);
}
