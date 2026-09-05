import { ITEMS, REST_ROOMS, ROOMS, START_ROOM, TREASURES } from './campaign.ts';
import { BALANCE } from './combat.ts';
import { hasLight } from './darkness.ts';
import { arrivalAt, districtYaw, sceneBounds, worldPosition } from './scene-layout.ts';
import { restoreRoutePosition } from './route-surfaces.ts';
import type { ActionResult, GameState, ObjectDef, RoomDef } from './types.ts';

const SAVE_VERSION = 2;
const utilityTreasures = ['egg', 'canary', 'torch', 'sceptre'];
const cargoItems = ['coal', 'screwdriver', 'torch'];

export function createGame(): GameState {
  return {
    version: SAVE_VERSION, room: START_ROOM, position: [...ROOMS[START_ROOM].spawn], yaw: 0,
    health: 100, stamina: 100, lantern: false, inventory: [], deposited: [], flags: {},
    visited: [START_ROOM], journal: [{ id: 'arrival', title: 'West of House', text: ROOMS[START_ROOM].description }],
    checkpoint: START_ROOM, enemies: {}, deaths: 0, playTime: 0,
    completed: false, settings: { volume: 0.65, sensitivity: 1, fov: 75, quality: 'high', motion: true, difficulty: 'adventurer' },
  };
}

export function retryFromCheckpoint(state: GameState): ActionResult {
  const encounter = ROOMS[state.room]?.enemy;
  if (encounter && !state.flags[`${encounter.id}_defeated`]) {
    state.enemies[encounter.id] = Math.round(encounter.health * BALANCE[state.settings.difficulty ?? 'adventurer'].enemyHealth);
  }
  const safeCheckpoint = (state.checkpoint === START_ROOM || REST_ROOMS.includes(state.checkpoint)) && state.visited.includes(state.checkpoint)
    ? state.checkpoint : START_ROOM;
  const room = ROOMS[safeCheckpoint];
  state.room = room.id; state.checkpoint = room.id;
  Object.assign(state, arrivalAt(room.id));
  state.health = 100; state.stamina = 100; state.lantern = hasItem(state, 'lantern');
  return { success: true, travel: room.id, refresh: true, title: 'A fresh attempt', message: `You catch your breath at ${room.name}. Your discoveries are safe.`, sound: 'rest' };
}

export function hasItem(state: GameState, id: string): boolean { return state.inventory.includes(id); }
export function ownsItem(state: GameState, id: string): boolean { return hasItem(state, id) || state.deposited.includes(id); }
export function allTreasuresDeposited(state: GameState): boolean { return TREASURES.every(id => state.deposited.includes(id)); }
export function objectVisible(state: GameState, object: ObjectDef): boolean {
  return !(object.hiddenIf && state.flags[object.hiddenIf]) && (!object.requires || Boolean(state.flags[object.requires]));
}
export function visibleObjects(state: GameState): ObjectDef[] { return ROOMS[state.room].objects.filter(object => objectVisible(state, object)); }
export function getObject(state: GameState, id: string): ObjectDef | undefined { return ROOMS[state.room]?.objects.find(object => object.id === id); }

function note(state: GameState, id: string, title: string, text: string): void {
  if (!state.journal.some(entry => entry.id === id)) state.journal.push({ id, title, text });
}
function ok(message: string, title?: string, sound = 'solve'): ActionResult {
  return { success: true, message, title, sound, refresh: true };
}
function no(message: string, title?: string): ActionResult { return { success: false, message, title }; }
function menu(title: string, message: string, choices: { label: string; action: string }[]): ActionResult {
  return { success: true, title, message, choices };
}
function remove(state: GameState, id: string): void { state.inventory = state.inventory.filter(value => value !== id); }
function acquire(state: GameState, id: string): void {
  if (!hasItem(state, id) && !state.deposited.includes(id)) state.inventory.push(id);
  state.flags[`picked_${id}`] = true;
}
function requireHeld(state: GameState, id: string, reason: string): ActionResult | undefined {
  if (hasItem(state, id)) return;
  if (state.deposited.includes(id)) return no(`${ITEMS[id].name} is in the trophy case. You can borrow it from the case, use it here, then put it back.`, 'A treasure still has work to do');
  return no(reason);
}
function useItem(state: GameState, choice: string | undefined, id: string, title: string, observation: string, refusal: string): ActionResult | undefined {
  // The choice is transient. Inventory ownership is checked again when it is
  // submitted, and merely examining the target cannot advance the puzzle.
  if (choice === `use:${id}` && hasItem(state, id)) return;
  const selected = choice?.startsWith('use:') ? choice.slice(4) : undefined;
  return {
    success: choice === undefined, title, message: observation, sound: 'ui', itemSelection: true,
    choices: state.inventory.filter(item => Object.hasOwn(ITEMS, item))
      .sort((a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name, 'en'))
      .map(item => ({ label: ITEMS[item].name, action: `use:${item}` })),
    feedback: choice === undefined ? undefined : !selected || !hasItem(state, selected)
      ? 'You are not carrying that item.' : refusal,
  };
}
function treasureCount(state: GameState): number { return TREASURES.filter(id => ownsItem(state, id)).length; }

function take(state: GameState, id: string): ActionResult {
  const item = ITEMS[id];
  if (!item) return no('There is nothing here to take.');
  if (ownsItem(state, id)) return no(`You have already recovered ${item.name.toLowerCase()}.`);
  acquire(state, id);
  if (id === 'lantern') {
    state.lantern = true;
    note(state, 'light', 'Keep a light', 'The brass lantern is your defense against the dark. It switches on as you lift it.');
    return ok('The lantern lights as you lift it. A steady glow fills the room.', item.name, 'pickup');
  }
  if (id === 'ancient_map') {
    state.flags.map_found = true;
    state.flags.barrow_path_open = true;
    note(state, 'last_road', 'The Stone Barrow', 'The map reveals a hidden road northwest of the white house. Nineteen treasures returned; one last threshold remains.');
    return ok('The parchment shows a hidden road northwest of the white house. At its end, a Stone Barrow. The twentieth treasure has given you your final destination.', 'The ancient map', 'reveal');
  }
  if (item.treasure) {
    note(state, `treasure_${id}`, item.name, item.description);
    return ok(`${item.description} ${treasureCount(state)} of 19 treasures recovered.`, item.name, 'treasure');
  }
  return ok(item.description, item.name, 'pickup');
}

function trophyCase(state: GameState, choice?: string): ActionResult {
  const carried = state.inventory.filter(id => TREASURES.includes(id));
  if (choice === 'deposit') {
    if (!carried.length) return no('You are carrying no treasures that belong in the case.');
    for (const id of carried) {
      if (!state.deposited.includes(id)) state.deposited.push(id);
      remove(state, id);
    }
    note(state, 'case_used', 'The trophy case', 'Treasures can be deposited together. Displayed tools can be borrowed again from the case when needed.');
    if (allTreasuresDeposited(state)) {
      state.flags.map_revealed = true;
      note(state, 'nineteen', 'The nineteen treasures', 'Every treasure has returned to the case. A hidden compartment has opened, revealing an ancient map.');
      return ok('Nineteen treasures stand together. A concealed drawer slides open, revealing an ancient map beside the case. Take it: the last road is waiting.', 'The final treasure', 'reveal');
    }
    return ok(`${carried.length === 1 ? 'One treasure has' : `${carried.length} treasures have`} found a home. ${state.deposited.length} of 19 are now in the case.`, 'Treasures returned', 'treasure');
  }
  if (choice?.startsWith('borrow:')) {
    const id = choice.slice(7);
    if (!utilityTreasures.includes(id) || !state.deposited.includes(id)) return no('That treasure is not available to borrow.');
    state.deposited = state.deposited.filter(value => value !== id);
    state.inventory.push(id);
    return ok(`You lift ${ITEMS[id].name.toLowerCase()} from its place. Bring it back when its work is done.`, 'Borrowed from the case', 'pickup');
  }
  const choices: { label: string; action: string }[] = [];
  if (carried.length) choices.push({ label: `Deposit ${carried.length === 1 ? 'your treasure' : `all ${carried.length} carried treasures`}`, action: 'deposit' });
  for (const id of utilityTreasures) if (state.deposited.includes(id)) choices.push({ label: `Borrow ${ITEMS[id].name.toLowerCase()}`, action: `borrow:${id}` });
  const text = allTreasuresDeposited(state)
    ? (state.flags.map_found ? 'All nineteen treasures are here. Follow the ancient map to the Stone Barrow.' : 'All nineteen treasures are here. An ancient map waits beside the case.')
    : `${state.deposited.length} of 19 treasures are displayed. ${carried.length} ${carried.length === 1 ? 'treasure is' : 'treasures are'} in your pack. You may borrow a displayed treasure whenever you still need it.`;
  return choices.length ? menu('The trophy case', text, choices) : ok(text, 'The trophy case', 'inspect');
}

function cyclops(state: GameState, choice?: string): ActionResult {
  if (state.flags.cyclops_fled) return ok('The cyclops is gone. The opening he made through the western wall leads directly to the living room.', 'A useful absence', 'inspect');
  if (state.flags.cyclops_passed) return ok('The cyclops is sleeping blissfully. The archway is clear.', 'Cyclops', 'inspect');
  if (choice?.startsWith('say:')) {
    const words = choice.slice(4).toUpperCase().replace(/[^A-Z]/g, '');
    if (words === 'ODYSSEUS' || words === 'ULYSSES') { state.flags.cyclops_name_known = true; choice = 'name'; }
    else return no('The cyclops ignores your words. His eye follows you across the room.', 'Cyclops');
  }
  if (choice === 'name') {
    if (!state.flags.cyclops_name_known) return no('What will you say?');
    state.flags.cyclops_passed = true;
    state.flags.cyclops_fled = true;
    note(state, 'cyclops', 'An older story', 'At the name Odysseus, the cyclops fled through the western wall, opening a shortcut to the living room.');
    return ok('The cyclops, hearing the name of his father\'s deadly nemesis, flees the room by knocking down the wall on the west of the room.', 'Cyclops', 'solve');
  }
  if (choice === 'feed') {
    if (state.flags.cyclops_fed) return no('The cyclops, having eaten the hot peppers, appears to be gasping. His enflamed tongue protrudes from his man-sized mouth.');
    const missing = requireHeld(state, 'lunch', 'The cyclops eyes your empty hands.');
    if (missing) return missing;
    remove(state, 'lunch'); state.flags.cyclops_fed = true;
    return ok('The cyclops says "Mmm Mmm. I love hot peppers! But oh, could I use a drink. Perhaps I could drink the blood of that thing." From the gleam in his eye, it could be surmised that you are "that thing".', 'Cyclops', 'pickup');
  }
  if (choice === 'water') {
    if (!state.flags.cyclops_fed) return no('The cyclops apparently is not thirsty and refuses your generous offer.');
    const missing = requireHeld(state, 'water', 'You have no water to offer.');
    if (missing) return missing;
    remove(state, 'water'); state.flags.cyclops_passed = true;
    note(state, 'cyclops', 'Supper and sleep', 'The pepper sandwich and water persuaded the cyclops to fall asleep. The treasury arch is clear.');
    return ok('The cyclops takes the bottle, checks that it\'s open, and drinks the water. A moment later, he lets out a yawn that nearly blows you over, and then falls fast asleep (what did you put in that drink, anyway?).', 'Cyclops', 'solve');
  }
  const choices = [];
  if (hasItem(state, 'lunch') && !state.flags.cyclops_fed) choices.push({ label: 'Offer your lunch', action: 'feed' });
  if (hasItem(state, 'water')) choices.push({ label: 'Offer your water', action: 'water' });
  return { ...menu('The cyclops', state.flags.cyclops_fed ? 'The cyclops, having eaten the hot peppers, appears to be gasping. His enflamed tongue protrudes from his man-sized mouth.' : 'He looks extremely hungry, even for a cyclops.', choices), prompt: { label: 'Say something to the cyclops', action: 'say', submit: 'Speak' } };
}

function eggLock(state: GameState, choice?: string): ActionResult {
  if (state.flags.egg_open) return ok('The egg’s fine clasp is open.', 'The open egg', 'inspect');
  const missing = requireHeld(state, 'egg', 'A set of very fine lockpicks rests on the worktable.');
  if (missing) return missing;
  if (!state.flags.thief_defeated && choice !== 'offer') {
    return menu('A professional interest', 'The thief glances at the jeweled egg. For a moment, the workmanship interests him more than you do.', [{ label: 'Let the thief open the egg', action: 'offer' }]);
  }
  if (state.flags.thief_defeated) {
    const selection = useItem(state, choice, 'fine_picks', 'The egg’s clasp', 'The jeweled egg has a fine, intricate clasp. Forcing it would damage the workmanship.', 'The clasp resists. You stop before damaging the egg.');
    if (selection) return selection;
  }
  state.flags.egg_open = true;
  acquire(state, 'canary');
  state.flags.thief_distracted = !state.flags.thief_defeated;
  note(state, 'egg_open', 'The egg', 'The egg contains a golden canary. A small winding key protrudes from its back.');
  return ok(state.flags.thief_defeated
    ? 'The picks turn easily. The egg opens, revealing a golden clockwork canary. You lift it free without damaging either treasure.'
    : 'The thief’s fingers blur over the clasp. He tosses the opened egg back. “An insultingly simple lock.” Inside is a golden clockwork canary. For once, his pride has been useful.', 'The egg’s secret', 'treasure');
}

function controls(state: GameState, choice?: string): ActionResult {
  if (!choice) return menu('Maintenance controls', 'Four colored buttons are set into the panel.', [
    { label: 'Press the yellow button', action: 'yellow' },
    { label: 'Press the brown button', action: 'brown' },
    { label: 'Press the red button', action: 'red' },
    { label: 'Press the blue button', action: 'blue' },
  ]);
  if (choice === 'yellow') {
    state.flags.controls_enabled = true;
    note(state, 'dam_controls', 'A click in the wall', 'The yellow button produced a click somewhere behind the wall.');
    return ok('Click.', '', 'switch');
  }
  if (choice === 'brown') {
    state.flags.controls_enabled = false;
    return ok('Click.', '', 'switch');
  }
  if (choice === 'red') return ok('The lights within the room flash.', '', 'switch');
  if (choice === 'blue') {
    if (state.flags.dam_leak) return no('The blue button appears to be jammed.');
    state.flags.dam_leak = true;
    return ok('There is a rumbling sound and a stream of water appears to burst from the east wall of the room (apparently, a leak has occurred in a pipe).', '', 'water');
  }
  return no('That control is not on the panel.');
}

function ritual(state: GameState, choice?: string): ActionResult {
  if (state.flags.hades_open) return ok('The spirits have fled.', 'The way is clear', 'inspect');
  if (!choice) {
    const choices = [];
    if (hasItem(state, 'bell')) choices.push({ label: 'Ring the brass bell', action: 'bell' });
    if (hasItem(state, 'candles')) choices.push({ label: 'Light your candles', action: 'candles' });
    if (hasItem(state, 'black_book')) choices.push({ label: 'Read your black book aloud', action: 'book' });
    return menu('The spirits', state.flags.ritual_candles ? 'The flames flicker wildly and appear to dance. The spirits cower at your unearthly power.' : state.flags.ritual_bell ? 'The wraiths have stopped jeering. They turn slowly to face you.' : 'The spirits jeer loudly and ignore you.', choices);
  }
  if (choice === 'bell') {
    const missing = requireHeld(state, 'bell', 'You have no bell.'); if (missing) return missing;
    state.flags.ritual_bell = true; state.flags.ritual_candles = false;
    return ok('The wraiths, as if paralyzed, stop their jeering and slowly turn to face you. On their ashen faces, the expression of a long-forgotten terror takes shape.', '', 'bell');
  }
  if (choice === 'candles') {
    if (!state.flags.ritual_bell) return no('The spirits jeer loudly and ignore you.');
    const missing = requireHeld(state, 'candles', 'You have no candles.') ?? requireHeld(state, 'matches', 'You have nothing to light them with.');
    if (missing) return missing;
    state.flags.ritual_candles = true;
    return ok('The flames flicker wildly and appear to dance. The earth beneath your feet trembles, and your legs nearly buckle beneath you. The spirits cower at your unearthly power.', '', 'ignite');
  }
  if (choice === 'book') {
    const missing = requireHeld(state, 'black_book', 'You have no book.'); if (missing) return missing;
    if (!state.flags.ritual_bell || !state.flags.ritual_candles) return no('The words are lost in the jeering.');
    state.flags.hades_open = true;
    note(state, 'hades', 'The gate yields', 'Bell, candles, book. The rite has banished the spirits from the gate of Hades.');
    return ok('Each word of the prayer reverberates through the hall in a deafening confusion. As the last word fades, a voice, loud and commanding, speaks: "Begone, fiends!" A heart-stopping scream fills the cavern, and the spirits, sensing a greater power, flee through the walls.', '', 'reveal');
  }
  return no('The spirits jeer loudly and ignore you.');
}

function basket(state: GameState, choice?: string): ActionResult {
  if (state.flags.basket_retrieved) return ok('The basket is empty. Its cargo has been collected below.', 'Cargo collected', 'inspect');
  if (state.flags.basket_lowered) return ok('The basket waits beside the pressure mill below. Follow the side passage to retrieve its cargo.', 'Cargo delivered', 'inspect');
  const missing = requireHeld(state, 'coal', 'The empty basket hangs over the shaft.')
    ?? requireHeld(state, 'screwdriver', 'The mechanism below has a narrow, slotted switch.')
    ?? requireHeld(state, 'torch', 'The basket disappears into an unlit shaft. Your lantern is needed for the narrow passage.');
  if (missing) return missing;
  if (!choice) return menu('The shaft basket', 'The basket can carry the coal, screwdriver and ivory torch down to the mill. Your lantern will stay with you.', [{ label: 'Lower the supplies', action: 'lower' }]);
  if (choice !== 'lower') return no('The basket remains where it is.', 'The shaft basket');
  for (const id of cargoItems) { remove(state, id); state.flags[`basket_${id}`] = true; }
  state.flags.basket_lowered = true;
  note(state, 'mine_freight', 'A way for the cargo', 'The coal, screwdriver and ivory torch have descended in the basket. Retrieve them beside the pressure mill below.');
  return ok('You lower the coal, screwdriver and ivory torch. The flame descends through the shaft and lights the mill below. Your own lantern lights the narrow side passage.', 'The basket descends', 'mechanism');
}

function machine(state: GameState, choice?: string): ActionResult {
  if (state.flags.diamond_created) return ok(ownsItem(state, 'diamond') ? 'The mill is quiet. The receiving tray is empty.' : 'The mill has done its work. The diamond rests in the receiving tray.', 'Pressure released', 'inspect');
  if (choice === 'load') {
    if (state.flags.machine_loaded) return no('The coal is already in the chamber.');
    if (state.flags.machine_closed) return no('The lid is closed.');
    const missing = requireHeld(state, 'coal', state.flags.basket_coal ? 'Your coal is still in the lowered basket.' : 'You have nothing to put in the chamber.');
    if (missing) return missing;
    remove(state, 'coal'); state.flags.machine_loaded = true;
    return ok('The coal settles into the pressure chamber.', 'Carbon loaded', 'mechanism');
  }
  if (choice === 'close') {
    state.flags.machine_closed = true;
    return ok('The heavy lid closes.', 'Chamber sealed', 'mechanism');
  }
  if (choice === 'open') {
    state.flags.machine_closed = false;
    return ok('The heavy lid opens.', '', 'mechanism');
  }
  if (choice === 'turn' || choice?.startsWith('use:')) {
    if (!state.flags.machine_closed) return no('The machine doesn\'t seem to want to do anything.');
    const selection = useItem(state, choice === 'turn' ? undefined : choice, 'screwdriver', 'The mill’s switch', 'A narrow, slotted switch is marked “START”.', 'That does not fit the slot in the switch.');
    if (selection) return selection;
    if (!state.flags.machine_loaded) return ok('The machine rumbles, flashes, and falls quiet. The chamber is still empty.', '', 'mechanism');
    state.flags.diamond_created = true;
    note(state, 'diamond_made', 'A better class of carbon', 'Coal, a sealed chamber, and the slotted switch. The ancient mill has made a diamond.');
    return ok('The machine comes to life (figuratively) with a dazzling display of colored lights and bizarre noises. After a few moments, the excitement abates. A huge diamond lies in the receiving tray.', 'Carbon transformed', 'reveal');
  }
  const choices = [
    { label: state.flags.machine_closed ? 'Open the pressure lid' : 'Close the pressure lid', action: state.flags.machine_closed ? 'open' : 'close' },
    { label: 'Turn the switch', action: 'turn' },
  ];
  if (hasItem(state, 'coal') && !state.flags.machine_loaded) choices.push({ label: 'Place your coal in the chamber', action: 'load' });
  const contents = state.flags.machine_loaded ? 'The chamber contains coal.' : 'The chamber is empty.';
  return menu('The pressure mill', `${contents} ${state.flags.machine_closed ? 'The lid is closed.' : 'The lid is open.'} A narrow switch is marked “START”.`, choices);
}

export function interact(state: GameState, objectId: string, choice?: string): ActionResult {
  const object = getObject(state, objectId);
  if (!object) return no('There is nothing here by that name.');
  if (!objectVisible(state, object)) return no(object.hiddenIf && state.flags[object.hiddenIf] ? 'You have already taken care of that.' : 'You cannot reach that.');
  switch (object.action) {
    case 'take': return take(state, object.item ?? object.id);
    case 'read':
      note(state, object.id, object.label, object.description ?? 'The lettering has worn away.');
      return ok(object.description ?? 'The lettering has worn away.', object.label, 'inspect');
    case 'mailbox':
      state.flags.mailbox_read = true;
      note(state, 'invitation', 'Leaflet', 'WELCOME TO ZORK! ZORK is a game of adventure, danger, and low cunning. In it you will explore some of the most amazing territory ever seen by mortals. No computer should be without one!');
      return ok('“WELCOME TO ZORK! ZORK is a game of adventure, danger, and low cunning. In it you will explore some of the most amazing territory ever seen by mortals. No computer should be without one!”', 'Leaflet', 'paper');
    case 'window':
      if (state.flags.window_open) return travel(state, 'behind_house_to_kitchen');
      state.flags.window_open = true;
      return ok('With great effort, you open the window far enough to allow entry.', '', 'door');
    case 'rug':
      state.flags.trapdoor_open = true;
      note(state, 'descent', 'Under the carpet', 'The living-room carpet concealed a trapdoor. Beneath it, stairs lead into the Great Underground Empire.');
      return ok('With a great effort, the rug is moved to one side of the room, revealing the dusty cover of a closed trap door. You lift the cover. Stone stairs descend into the dark.', '', 'door');
    case 'cellar_hatch': return travel(state, 'living_room_to_cellar');
    case 'case': return trophyCase(state, choice);
    case 'rest':
      if (ROOMS[state.room].enemy && !state.flags[`${ROOMS[state.room].enemy!.id}_defeated`]) return no('Find a quiet place before resting.');
      state.health = 100; state.stamina = 100; state.checkpoint = state.room;
      state.flags[`rest_${state.room}`] = true;
      if (hasItem(state, 'lantern')) state.lantern = true;
      note(state, `rest_${state.room}`, `Rest: ${ROOMS[state.room].name}`, 'A safe fire, marked for a later return.');
      return ok('You rest beside the fire. Wounds mend, your hands grow steady, and this place becomes your safe return.', 'Rested', 'rest');
    case 'grate': {
      if (state.flags.grate_open) return choice === undefined
        ? travel(state, state.room === 'forest' ? 'forest_to_maze' : 'maze_to_forest')
        : ok('The grating is already open.', 'The iron grating', 'inspect');
      const selection = useItem(state, choice, 'skeleton_key', object.label, 'The grating is locked.', 'That does not fit the lock.');
      if (selection) return selection;
      state.flags.grate_open = true;
      note(state, 'grate', 'Daylight above the maze', 'The skeleton key opens the grating between the maze and the forest.');
      return ok('The skeleton key turns. You lift the iron grate, opening a route between the maze and the forest.', 'A way back to daylight', 'door');
    }
    case 'cyclops_legend':
      state.flags.cyclops_name_known = true;
      note(state, object.id, object.label, object.description!);
      return ok(object.description!, object.label, 'paper');
    case 'cyclops': return cyclops(state, choice);
    case 'egg_lock': return eggLock(state, choice);
    case 'songbird': {
      if (state.flags.bauble_revealed) return ok('The songbird has answered the canary. Its brass bauble lies below the perch.', 'A fair exchange', 'inspect');
      const selection = useItem(state, choice, 'canary', object.label, 'You hear the chirping of a songbird.', 'The songbird continues chirping, quite unimpressed.');
      if (selection) return selection;
      state.flags.bauble_revealed = true;
      note(state, 'song', 'A song answered', 'Winding the clockwork canary in the forest brought an answer from the songbird, and a brass bauble from its beak.');
      return ok('The canary chirps, slightly off-key, an aria from a forgotten opera. From out of the greenery flies a lovely songbird. It perches on a limb just over your head and opens its beak to sing. As it does so a beautiful brass bauble drops from its mouth, bounces off the top of your head, and lands glimmering in the grass. As the canary winds down, the songbird flies away.', '', 'bird');
    }
    case 'dome_rope': {
      if (state.flags.dome_secured) return choice === undefined
        ? travel(state, 'dome_to_temple')
        : ok('The rope is already tied to the railing.', 'A safe descent', 'inspect');
      const selection = useItem(state, choice, 'rope', object.label, 'The drop is too far to jump. A sturdy wooden railing runs around the dome.', 'That will not make the drop safe.');
      if (selection) return selection;
      state.flags.dome_secured = true;
      note(state, 'dome', 'A safe descent', 'The rope is secured to the dome’s wooden railing.');
      return ok('The rope is tied to the railing.', '', 'mechanism');
    }
    case 'dome_ascent': return travel(state, 'temple_to_dome');
    case 'coffin':
      if (!state.flags.coffin_open) {
        state.flags.coffin_open = true;
        return ok('The lid slides back. Inside rests a sceptre, its enamel arranged in the colors of a rainbow. Lift it from the cradle before moving the coffin.', 'The king’s sceptre', 'reveal');
      }
      if (!ownsItem(state, 'sceptre')) return no('Take the sceptre from inside the open coffin first. It deserves a better journey than being rattled against the lid.');
      return take(state, 'coffin');
    case 'mirror':
      if (state.flags.mirror_awakened) {
        const passage = ROOMS[state.room].exits.find(exit => exit.via === object.id);
        if (passage) return travel(state, passage.id);
      }
      state.flags.mirror_awakened = true;
      note(state, 'mirrors', 'The silver passage', 'The mirror’s surface yielded beneath your fingers. Beyond it lies another room.');
      return ok('The surface yields beneath your fingers. The room on the other side is no reflection.', '', 'reveal');
    case 'ritual': return ritual(state, choice);
    case 'echo':
      if (state.flags.echo_solved) return ok('The acoustics of the room have changed.', '', 'inspect');
      if (choice === 'echo' || choice?.startsWith('say:') && choice.slice(4).toUpperCase().replace(/[^A-Z]/g, '') === 'ECHO') {
        state.flags.echo_solved = true;
        note(state, 'echo', 'A word returned', 'Naming the echo quieted the Loud Room and revealed a way to the platinum bar.');
        return ok('The acoustics of the room change subtly.', '', 'reveal');
      }
      if (choice) {
        const word = (choice.startsWith('say:') ? choice.slice(4) : choice).slice(0, 60);
        return { ...menu('Loud Room', `“${word.toUpperCase()} ... ${word} ... ${word.toLowerCase()} ...”`, []), prompt: { label: 'Call into the cavern', action: 'say', submit: 'Call' } };
      }
      return { ...menu('Loud Room', 'Every sound comes back in your own voice.', []), prompt: { label: 'Call into the cavern', action: 'say', submit: 'Call' } };
    case 'controls': return controls(state, choice);
    case 'patch': {
      const selection = useItem(state, choice, 'putty', object.label, 'Water sprays from an open joint in the pipe.', 'That will not seal the leaking joint.');
      if (selection) return selection;
      state.flags.dam_leak = false;
      return ok('You press the putty over the joint. The spray dwindles and stops. There is plenty left in the tube.', 'Pipe sealed', 'solve');
    }
    case 'dam_bolt': {
      if (state.flags.reservoir_drained) return ok('The sluices are locked open. The reservoir stair is clear, and the river continues safely below.', 'The dam is working', 'inspect');
      const selection = useItem(state, choice, 'wrench', object.label, 'A large square bolt is mounted in the control panel. Above it is a small green bubble.', 'You cannot get a grip on the square bolt with that.');
      if (selection) return selection;
      if (!state.flags.controls_enabled) return no('The bolt will not move. The green indicator is dark.');
      if (state.flags.dam_leak) return no('The bolt shudders and stops. The pressure gauge reads empty.');
      state.flags.reservoir_drained = true;
      note(state, 'dam_open', 'The sluices', 'The sluice gates opened, and the reservoir began to empty.');
      return ok('The wrench turns the great bolt. Deep within the dam, gates rise. Water thunders away, exposing the reservoir floor and a stair to the northern shore.', 'Flood Control Dam #3', 'water');
    }
    case 'bat': {
      if (state.flags.bat_quiet) return ok(ownsItem(state, 'jade') ? 'The bat keeps a very respectful distance. The mine passage is clear.' : 'The bat keeps a very respectful distance. The jade figure and mine passage are clear.', 'The discouragement persists', 'inspect');
      const selection = useItem(state, choice, 'garlic', object.label, 'A large vampire bat hangs from the ceiling. It hisses as you approach.', 'The bat bares its fangs and stays where it is.');
      if (selection) return selection;
      state.flags.bat_quiet = true;
      note(state, 'bat', 'A small defense', 'The garlic has driven the vampire bat away from the mine passage and jade figurine.');
      return ok('You raise the garlic. The vampire bat withdraws to the highest part of the cavern with a thoroughly offended squeal.', 'Kitchen wisdom', 'solve');
    }
    case 'gas': {
      if (state.flags.gas_safe) return ok('Clear air hugs the wall of the side working. Your way along it is clear.', object.label, 'inspect');
      const selection = useItem(state, choice, 'lantern', object.label, 'The air smells strongly of coal gas. A warning forbids exposed flames. The timbered working recedes into darkness.', ['use:torch', 'use:candles', 'use:matches'].includes(choice ?? '') ? 'You keep the flame away from the gas. That would be a very poor idea.' : 'That does not help you find a safe way through the gas.');
      if (selection) return selection;
      if (!state.lantern) return no('The lantern is dark. Light it before trying the side working.', object.label);
      state.flags.gas_safe = true;
      return ok('You check the lantern’s sealed shutter. Clear air hugs the wall; something glints farther along the working.', 'A safer light', 'solve');
    }
    case 'basket': return basket(state, choice);
    case 'basket_retrieve':
      if (!state.flags.basket_lowered) return no('The basket has not been lowered. Load it in the coal mine above.');
      for (const id of cargoItems) if (state.flags[`basket_${id}`]) { acquire(state, id); state.flags[`basket_${id}`] = false; }
      state.flags.basket_retrieved = true;
      return ok('You recover the coal, screwdriver and ivory torch. The mill’s open pressure chamber waits beside you.', 'Cargo recovered', 'pickup');
    case 'machine': return machine(state, choice);
    case 'boat': {
      if (state.flags.boat_ready) return ok('The boat is inflated and ready at the landing. The route onto the river is open.', 'Ready to launch', 'inspect');
      const selection = useItem(state, choice, 'pump', object.label, 'The folded plastic is an inflatable boat. Its valve is closed.', 'That does not inflate the boat.');
      if (selection) return selection;
      state.flags.boat_ready = true;
      note(state, 'boat', 'Inflatable boat', 'The boat is inflated.');
      return ok('The boat inflates and appears seaworthy.', '', 'water');
    }
    case 'buoy':
      if (!state.flags.boat_ready) return no('The buoy is out in the river. Reach it with the boat.');
      return take(state, 'emerald');
    case 'land':
      if (state.flags.river_moored) return ok('The boat is moored in the sheltered eddy. The beach and falls trail are open.', 'Safely ashore', 'inspect');
      if (choice === 'current') return no('The center channel ends in a white plunge. You pull back into the eddy. The sign points toward the sheltered landing.');
      if (choice !== 'shore') return menu('The river landing', 'A sheltered channel bends toward the sandy shore. The main current accelerates toward the falls.', [{ label: 'Steer into the sheltered shore', action: 'shore' }, { label: 'Inspect the central current', action: 'current' }]);
      state.flags.river_moored = true;
      return ok('You steer into the eddy and secure the boat. A sandy cave and a trail to the falls lie beyond the landing.', 'A sensible arrival', 'water');
    case 'dig': {
      if (state.flags.scarab_revealed) return ok(ownsItem(state, 'scarab') ? 'Only the hole remains. Further digging would be ambition beyond the needs of the occasion.' : 'The scarab is exposed. You stop digging before the sand begins to have ideas.', 'Enough excavation', 'inspect');
      const selection = useItem(state, choice, 'shovel', object.label, 'Wind has banked the sand into a deep drift here.', 'You disturb a little sand, but get no farther.');
      if (selection) return selection;
      state.flags.scarab_revealed = true;
      return ok('You work carefully through the disturbed drift. A jeweled scarab slides into the light. Further digging would be ambition beyond the needs of the occasion.', 'The sand’s secret', 'reveal');
    }
    case 'rainbow': {
      if (state.flags.rainbow_solid) return ok(ownsItem(state, 'gold') ? 'The rainbow is solid. The far path returns to the forest.' : 'The rainbow is solid. The pot of gold waits across the crossing, and the far path returns to the forest.', 'A road made of light', 'inspect');
      const selection = useItem(state, choice, 'sceptre', object.label, 'The rainbow is beautiful, but far too insubstantial to walk on.', 'The rainbow remains as insubstantial as before.');
      if (selection) return selection;
      state.flags.rainbow_solid = true;
      note(state, 'rainbow', 'A road made of light', 'Raising the Egyptian sceptre at Aragain Falls made the rainbow solid. The crossing leads to gold and a path back to the forest.');
      return ok('Suddenly, the rainbow appears to become solid and, I venture, walkable.', '', 'reveal');
    }
    case 'ending':
      if (!allTreasuresDeposited(state)) return no('The final threshold waits for all nineteen treasures to stand together in the trophy case. Return anything you borrowed.');
      if (!state.flags.map_found) return no('Take the ancient map from the trophy case. It is the final invitation.');
      state.flags.barrow_entered = true; state.completed = true;
      note(state, 'master', 'Master Adventurer', 'Nineteen treasures returned. The ancient map claimed. The Stone Barrow entered.');
      return { ...ok('As you enter the barrow, the door closes inexorably behind you.', 'Master Adventurer', 'win'), ending: true };
    default: return ok(object.description ?? 'Age has left its mark here.', object.label, 'inspect');
  }
}

export function travel(state: GameState, exitId: string): ActionResult {
  const exit = ROOMS[state.room]?.exits.find(value => value.id === exitId);
  if (!exit) return no('There is no passage that way.');
  if (exit.requires && !state.flags[exit.requires]) return no(exit.blocked ?? 'The way is not yet open.');
  const destination = ROOMS[exit.to];
  if (!destination) return no('The passage is blocked.');
  const arrival = arrivalAt(destination.id, state.room);
  state.room = destination.id;
  state.position = arrival.position; state.yaw = arrival.yaw;
  if (!state.visited.includes(destination.id)) {
    state.visited.push(destination.id);
    note(state, `place_${destination.id}`, destination.name, destination.description);
  }
  return { success: true, travel: destination.id, refresh: true, title: destination.name, message: destination.description, sound: 'travel' };
}

export function defeatEnemy(state: GameState, id: string): ActionResult {
  const enemy = ROOMS[state.room]?.enemy;
  if (!enemy || enemy.id !== id) return no('There is no such opponent here.');
  if (state.flags[`${id}_defeated`]) return ok('The passage is already clear.', undefined, 'inspect');
  state.flags[`${id}_defeated`] = true; state.enemies[id] = 0;
  state.health = Math.min(100, state.health + 20); state.stamina = 100;
  if (id === 'troll') {
    note(state, 'troll_defeated', 'The first keeper', 'The troll has fallen. The round room and the maze are open.');
    return ok('The axe strikes stone for the last time. The passage opens toward the Round Room and the maze. You catch your breath.', 'The troll is defeated', 'victory');
  }
  note(state, 'thief_defeated', 'The last claim', 'The thief is defeated. His silver chalice and fine picks remain beside the worktable.');
  return ok('The thief’s stiletto clatters across the floor.', 'The thief is defeated', 'victory');
}

export function objective(state: GameState): { title: string; text: string } {
  if (ROOMS[state.room].dark && !hasLight(state)) return { title: 'Darkness', text: 'It is pitch black. You are likely to be eaten by a grue.' };
  if (state.completed) return { title: 'Master Adventurer', text: 'The nineteen treasures are home. You have entered the Stone Barrow.' };
  if (allTreasuresDeposited(state)) return state.flags.map_found
    ? { title: 'To Stone Barrow', text: 'The map marks a path northwest of the white house.' }
    : { title: 'The trophy case', text: 'Something has changed among the nineteen treasures.' };
  const r = state.room;
  if (r === 'behind_house') return { title: 'Behind the house', text: state.flags.window_open ? 'The small window is open.' : 'A small window is slightly ajar.' };
  if (r === 'west_house') {
    if (!state.visited.includes('kitchen')) return { title: 'The white house', text: state.flags.window_open ? 'The house is no longer quite so inaccessible.' : 'An open field, a white house, and a boarded front door.' };
    if (!state.flags.trapdoor_open) return { title: 'The white house', text: 'You have found a way inside. There is more to examine there.' };
  }
  if (r === 'kitchen') return { title: 'Inside the white house', text: 'A passage leads west; a staircase leads upward.' };
  if (r === 'attic') return { title: 'Under the eaves', text: hasItem(state, 'rope') ? 'The only exit is a stairway leading down.' : 'Something has been left among the rafters.' };
  if (r === 'living_room') {
    if (!hasItem(state, 'lantern')) return { title: 'The living room', text: 'A few useful possessions remain in the abandoned house.' };
    if (!state.flags.trapdoor_open) return { title: 'The living room', text: 'The furnishings bear a closer look.' };
    if (!state.flags.troll_defeated) return { title: 'Below the house', text: 'The open trap door leads into darkness.' };
    return { title: 'The trophy case', text: `${state.deposited.length} treasures displayed · ${treasureCount(state)} recovered.` };
  }
  if (r === 'cellar') return { title: 'The cellar', text: 'A narrow passageway leads north into the darkness.' };
  if (r === 'troll_bridge' && !state.flags.troll_defeated) return { title: 'The Troll', text: 'A nasty-looking troll, brandishing a bloody axe, blocks the passage.' };
  if (r === 'forest') {
    if (state.flags.bauble_revealed && !ownsItem(state, 'bauble')) return { title: 'A glint in the grass', text: 'Something fell from the songbird’s beak.' };
    if (ownsItem(state, 'egg') && !ownsItem(state, 'canary')) return { title: 'Fine gold inlay', text: 'Unlike most eggs, this one is hinged.' };
    return { title: 'Forest sounds', text: 'You hear in the distance the chirping of a song bird.' };
  }
  if (r === 'maze') return { title: 'Twisty little passages', text: 'The luckless adventurer left more than his bones behind.' };
  if (r === 'cyclops' && !state.flags.cyclops_passed) return { title: 'The Cyclops', text: state.flags.cyclops_fed ? 'The cyclops, having eaten the hot peppers, appears to be gasping.' : 'He looks prepared to eat horses (much less mere adventurers).' };
  if (r === 'treasure_room' && !state.flags.thief_defeated) return { title: 'A rival collector', text: 'A suspicious-looking individual is armed with a deadly stiletto.' };
  if (r === 'dome') return { title: state.flags.dome_secured ? 'The room below' : 'A precipitous drop', text: state.flags.dome_secured ? 'A rope hangs from the wooden railing.' : 'The dome forms the ceiling of another room below.' };
  if (r === 'temple' && !state.flags.hades_open) return { title: 'An ancient inscription', text: 'The beliefs of the ancient Zorkers were obscure.' };
  if (r === 'hades' && !state.flags.hades_open) return { title: 'Abandon every hope', text: state.flags.ritual_candles ? 'The spirits cower at your unearthly power.' : state.flags.ritual_bell ? 'The wraiths stop their jeering and slowly turn to face you.' : 'The way through the gate is barred by evil spirits.' };
  if (r === 'loud_room') return { title: 'The Loud Room', text: state.flags.echo_solved ? 'The acoustics of the room have changed subtly.' : 'The room is deafeningly loud with an undetermined rushing sound.' };
  if (['dam', 'maintenance'].includes(r)) return { title: state.flags.reservoir_drained ? 'What the water kept' : state.flags.dam_leak ? 'A leak' : 'Flood Control Dam #3', text: state.flags.reservoir_drained ? 'The water level behind the dam is low.' : state.flags.dam_leak ? 'Water is escaping from a damaged pipe.' : state.flags.controls_enabled ? 'The green plastic bubble is glowing serenely.' : 'An abandoned machine, and controls which still seem serviceable.' };
  if (r === 'bat_cavern' && !state.flags.bat_quiet) return { title: 'An unwelcome host', text: 'A large vampire bat hangs from the ceiling.' };
  if (r === 'coal_mine') {
    if (!state.flags.gas_safe) return { title: 'Coal gas', text: 'The air smells strongly of coal gas. A timbered side working lies to the east.' };
    return { title: state.flags.basket_lowered ? 'A load below' : 'The mine shaft', text: state.flags.basket_lowered ? 'The chain disappears into the lower workings.' : 'An iron chain lowers freight through the shaft. A separate passage leads north to the mill.' };
  }
  if (r === 'machine_room') return { title: 'The machine', text: state.flags.diamond_created ? ownsItem(state, 'diamond') ? 'The machine has stopped. Its tray is empty.' : 'The machine has stopped. Something remains in the tray.' : !state.flags.basket_retrieved ? 'The freight basket has arrived beside the machine.' : !state.flags.machine_loaded ? state.flags.machine_closed ? 'The chamber is empty. Its lid is closed.' : 'The chamber is empty.' : !state.flags.machine_closed ? 'The chamber contains coal. The lid is still open.' : 'The lid is closed. A very narrow switch is labelled “START”.' };
  if (r === 'dam_base') return { title: 'The Frigid River', text: state.flags.boat_ready ? 'The boat is inflated. The river flows quietly here.' : 'There is a folded pile of plastic here which has a small valve attached.' };
  if (r === 'river') return { title: 'Before the falls', text: state.flags.river_moored ? 'You have reached the sheltered shore.' : 'The river is running faster here. The sound ahead is that of rushing water.' };
  if (r === 'falls') return { title: 'Aragain Falls', text: state.flags.rainbow_solid ? 'A solid rainbow spans the falls.' : 'A beautiful rainbow can be seen over the falls and to the west.' };
  if (treasureCount(state) === TREASURES.length) return { title: 'The collection', text: 'Nineteen treasures recovered. The trophy case awaits them.' };
  return { title: 'The Great Underground Empire', text: `${state.deposited.length} treasures displayed · ${treasureCount(state)} recovered.` };
}

export function hints(state: GameState): string[] {
  const r = state.room;
  if (ROOMS[r].dark && !hasLight(state)) return hasItem(state, 'lantern')
    ? ['It is pitch black. You are likely to be eaten by a grue.', 'Its insatiable appetite is tempered by its fear of light. Your lantern has an on switch.', 'Press L to turn on the brass lantern.']
    : ['It is pitch black. You are likely to be eaten by a grue.', 'The house contained a source of light. This is a poor place to continue without it.', 'Return to the living room and take the brass lantern to the left of the trophy case. It lights automatically.'];
  if (state.completed) return ['The expedition is complete. The barrow has admitted you.', 'Your journal records the roads and riddles you solved.', 'Keep exploring, or begin a new expedition from the title screen.'];
  if (r === 'barrow') return allTreasuresDeposited(state)
    ? ['The map has brought you to the door of a tomb.', 'The door is open. Whatever lies beyond it is hidden in darkness.', 'Approach the Stone Barrow threshold and press E to enter.']
    : ['The final journey began with nineteen treasures in the case.', 'A borrowed treasure still travels with you.', 'Return the borrowed treasure to the living-room trophy case, then come back to the Stone Barrow.'];
  if (allTreasuresDeposited(state)) return state.flags.map_found
    ? ['The map marks a clearing near the white house.', 'One of its paths is labelled “To Stone Barrow”.', 'Return to West of House, follow the path northwest, and enter the Stone Barrow threshold.']
    : ['Did anything change when the last treasure entered the case?', 'Look beside the completed collection.', 'Take the ancient map which has appeared beside the trophy case.'];
  switch (r) {
    case 'west_house':
    case 'behind_house': {
      if (!state.flags.mailbox_read && r === 'west_house') return ['Have you examined the small object beside the front door?', 'A mailbox is meant to hold something.', 'Approach the small mailbox and press E to open it and read the leaflet.'];
      if (!state.visited.includes('kitchen')) return state.flags.window_open
        ? ['The window is open now.', 'It is large enough for more than a look inside.', 'Press E at the open kitchen window again to climb through.']
        : r === 'behind_house'
          ? ['Is every opening in the house equally well secured?', 'One window is only slightly ajar.', 'Press E at the kitchen window to open it, then E again to climb inside.']
          : ['The front door is not the whole house.', 'Walk around the walls and examine the other openings.', 'Walk behind the white house. Press E at the small window to open it, then E again to climb inside.'];
      if (!state.visited.includes('living_room')) return ['Have you explored the rooms beyond the kitchen?', 'A passage leads west from the kitchen table.', 'Enter the kitchen and take the western doorway to the living room.'];
      if (!state.flags.trapdoor_open) return ['The house has not quite given up its secrets.', 'The living-room furnishings deserve another examination.', 'Return to the living room and examine the large oriental rug with E.'];
      return ['The boarded house has turned out to contain more than it promised.', 'The trophy case gives a purpose to the valuables you have found.', 'Return carried treasures to the living-room case. The open trap door leads back into the underground passages.'];
    }
    case 'forest': {
      if (!ownsItem(state, 'egg')) return ['Have you looked at the tree’s low branches?', 'Something in the nest catches the light.', 'Approach the nest and press E to take the jewel-encrusted egg.'];
      if (!ownsItem(state, 'canary')) return ['Unlike most eggs, this one is hinged.', 'The delicate clasp calls for dexterity. Ordinary force is unlikely to help.', 'Bring the egg to the thief’s worktable in the Treasure Room, borrowing it from the case if necessary. Let him open it; if he has fallen, collect his fine picks, examine the worktable and choose the picks.'];
      if (!state.flags.bauble_revealed) return ['The songbird takes an interest in some sounds more than others.', 'Your clockwork canary was built to sing.', 'Examine the songbird and choose the clockwork canary from your satchel. If you deposited the canary, borrow it from the trophy case first.'];
      if (!ownsItem(state, 'bauble')) return ['Something fell as the songbird opened its beak.', 'Look in the grass below the perch.', 'Take the brass bauble at the foot of the songbird’s tree.'];
      if (!state.flags.grate_open) return ['There is old iron beneath the leaves.', 'The grating has a lock, rather than a lifting handle.', 'Use the skeleton key from the maze at the iron grating. The route can then be used in either direction.'];
      return ['The path and the grating lead away from this clearing.', 'One leads toward the house, the other below ground.', 'Use the iron grating to return to the maze, or walk to the white house and deposit carried treasures.'];
    }
    case 'kitchen':
      if (['lunch', 'water', 'garlic'].some(id => !state.flags[`picked_${id}`])) return ['The table seems to have been used recently for the preparation of food.', 'Some of the supplies left on it can be carried.', 'Collect the hot pepper sandwich, bottle of water and garlic from the table.'];
      if (!state.visited.includes('attic')) return ['Have you followed the staircase?', 'It leads upward into the roof of the house.', 'Take the kitchen’s upstairs exit to the attic and examine what remains there.'];
      return ['There is another room beyond the western doorway.', 'Its furnishings are rather different from those of a kitchen.', 'Take the western doorway to the living room.'];
    case 'attic': return hasItem(state, 'rope')
      ? ['You have taken what remained beneath the rafters.', 'The only exit is a stairway leading down.', 'Return down the kitchen stairs, then take the western doorway to the living room.']
      : ['Something is coiled beneath the rafters.', 'Hemp rope is useful equipment for an expedition.', 'Approach the large coil of rope and press E to take it.'];
    case 'living_room': {
      if (!hasItem(state, 'lantern')) return ['Could anything in this room provide a light?', 'The brass lantern is battery-powered.', 'Take the brass lantern to the left of the trophy case. It switches on as you lift it.'];
      if (!hasItem(state, 'sword') && !state.flags.troll_defeated) return ['Have you considered what protection the house might offer?', 'The old sword is more than an ornament.', 'Take the elvish sword from the cabinet to the right of the trophy case.'];
      if (!state.flags.trapdoor_open) return ['How much of the floor can you actually see?', 'The large rug covers a part of the floor that nothing else obscures.', 'Press E at the large oriental rug to move it, then E at the exposed trap door to descend.'];
      if (!state.flags.troll_defeated) return ['The trap door is open.', 'The stair leads below the house, toward a passage to the north.', 'Examine the open trap door with E to enter the cellar, then explore the northern passage.'];
      if (treasureCount(state) === TREASURES.length) return ['The collection is complete, but is it all on display?', 'A treasure in your satchel is still absent from the case.', 'Examine the trophy case and choose to deposit all carried treasures, including any you borrowed.'];
      return ['A trophy case is not usually left empty.', 'Consider which of your discoveries belong in a collection.', 'Examine the trophy case and deposit carried treasures. A displayed treasure can be borrowed again when you need it.'];
    }
    case 'cellar': return ['There is a narrow passageway to the north.', 'The scratches near it are larger than the marks of ordinary tools.', 'Take the northern passage. If you left the sword or lantern behind, retrieve them from the living room first.'];
    case 'troll_bridge': return state.flags.troll_defeated
      ? ['The troll no longer bars the passages.', 'The west passage twists away; the northern hall is more spacious.', 'Take the western passages into the maze, or the northern hall to the Round Room.']
      : ['How long does the troll need to raise his axe for another blow?', 'He commits to a heavy swing, then pauses to recover.', hasItem(state, 'sword') ? 'Dodge with Q or parry with R just before the blow lands. Strike with F during recovery. The passage behind you remains open if you need to retreat.' : 'Return to the living room for the elvish sword. Then dodge or parry the axe and strike during the troll’s recovery.'];
    case 'round_room': {
      const exit = ROOMS[r].exits.find(e => (!e.requires || state.flags[e.requires]) && !state.visited.includes(e.to));
      return ['The passages do not all lead to the same sort of place.', 'The surveyor’s notes distinguish the worked stone from the sound of water.', exit ? `Take the passage marked “${exit.label}”. It leads somewhere you have not yet explored.` : 'The gallery, dome and dam can all be reached from this room. Choose the branch whose objects you have not finished examining.'];
    }
    case 'gallery': return ownsItem(state, 'painting')
      ? ['The neglected genius’s work is in safer hands now.', 'The gallery continues toward a much larger chamber.', 'Take the Dome gallery exit to examine the dome, or return to the Round Room.']
      : ['The vandals did not take everything.', 'One frame still holds a painting of unparalleled beauty.', 'Approach the remaining painting and press E to take it.'];
    case 'maze':
      if (!state.flags.cyclops_name_known) return ['The luckless adventurer left a written observation.', 'It concerns someone who might be waiting beyond the maze.', 'Take the coins and skeleton key, and read the explorer’s final note beside the remains.'];
      if (!state.flags.grate_open) return ['A little daylight reaches this part of the maze.', 'The skeleton key and the grating belong to the same old lock.', 'Use the skeleton key at the grating to open a route to the forest.'];
      return ['The note describes a creature beyond these passages.', 'A passage leads away from the maze toward a much larger room.', 'Take the passage to the one-eyed keeper. The sailor in the explorer’s note is Odysseus; say his name to the cyclops.'];
    case 'cyclops': {
      if (state.flags.cyclops_passed) return ['The cyclops no longer bars your way.', 'The archway beyond him is accessible.', 'Pass through the archway to the Treasure Room.'];
      if (state.flags.cyclops_fed) return ['The cyclops, having eaten the hot peppers, appears to be gasping.', 'His enflamed tongue protrudes from his man-sized mouth.', 'Offer the bottle of water. If you left it behind, it is on the kitchen table.'];
      return ['He looks prepared to eat horses, much less mere adventurers.', 'Perhaps you are carrying something he would rather eat than you.', state.flags.cyclops_name_known ? 'Offer the hot pepper sandwich, then water. Or say “Odysseus”, the sailor alluded to in the explorer’s note.' : 'Offer the hot pepper sandwich from the kitchen, then the bottle of water. The explorer’s note in the maze also records an alternative.'];
    }
    case 'treasure_room':
      if (ownsItem(state, 'egg') && !ownsItem(state, 'canary')) return ['Have you examined the thief’s worktable?', 'His tools are suited to the sort of clasp on your jeweled egg.', 'Use the worktable with the egg in your satchel, borrowing it from the case if necessary. If the thief has fallen, collect the fine picks beside his table and choose them at the clasp.'];
      if (!state.flags.thief_defeated) return ['The stiletto moves faster than the troll’s axe.', 'The thief leaves less time to counter, but still has to recover after a thrust.', 'Dodge or parry the thrust, then strike during his recovery. Defeat him before trying to take the guarded chalice.'];
      if (!ownsItem(state, 'chalice')) return ['Something valuable remains after the thief’s fall.', 'His intricately engraved cup is no longer guarded.', 'Take the silver chalice.'];
      return ['The worktable remains useful even without its proprietor.', 'Fine locks and ordinary weapons require rather different skills.', 'If you find a delicate locked object, bring it to this table. Otherwise return through the Cyclops Room.'];
    case 'dome': return state.flags.dome_secured
      ? ['The rope hangs down into the room below.', ownsItem(state, 'torch') ? 'The secured rope leads to the temple.' : 'The ivory torch can now be reached.', ownsItem(state, 'torch') ? 'Examine the secured rope to descend to the temple.' : 'Collect the ivory torch, then examine the secured rope to descend to the temple.']
      : ['What made the two grooves across the wooden railing?', 'The old fibers are hemp. The railing would bear considerable weight.', 'Bring the coil of rope from the attic and use it at the wooden railing.'];
    case 'egypt':
      if (!state.flags.coffin_open) return ['How firmly is the coffin sealed?', 'A coffin is a container as well as a valuable object.', 'Examine the gold coffin to open it. Take what is inside, then examine it again to lift the coffin itself.'];
      if (!ownsItem(state, 'sceptre')) return ['Something ornamented lies inside the open coffin.', 'The colored enamel has survived better than the tomb’s paintings.', 'Take the Egyptian sceptre from inside the coffin.'];
      if (!ownsItem(state, 'coffin')) return ['The empty coffin is still made of solid gold.', 'Its contents are not the only treasure here.', 'Examine the opened coffin again to lift it.'];
      return ['The tomb has yielded its treasures.', 'Its western passage returns to the temple.', 'Return west to the temple. Keep the sceptre’s colored enamel in mind.'];
    case 'temple':
      if (['bell', 'candles', 'black_book'].some(id => !hasItem(state, id))) return ['What survives on the altar?', 'The book has a legible page concerned with the banishment of evil.', 'Collect the brass bell, pair of candles and black book. Read the book’s description in the satchel, then examine the gate of Hades.'];
      if (!state.flags.hades_open) return ['The book refers to noises, lights and prayers.', 'The temple’s objects appear to have belonged to a ceremony.', 'Carry the bell, candles and book to the Hades gate. Ask for another nudge there if the ceremony defeats you.'];
      if (!state.flags.mirror_awakened) return ['There is a mirror in this temple.', 'Its reflection does not quite agree with the room around it.', 'Examine the ancient mirror with E to reveal its passage.'];
      return ['The spirits have yielded and the silver passage is open.', 'The temple now joins two branches of the underground.', state.flags.dome_secured ? 'Step through the mirror to Atlantis, or climb the rope to the dome.' : 'Step through the mirror to Atlantis.'];
    case 'hades':
      if (state.flags.hades_open) return ownsItem(state, 'skull')
        ? ['The gate is clear and the skull is yours.', 'The temple is the way back to the living world.', 'Return to the temple. Its mirror and eastern chamber are worth examining if you have not done so.']
        : ['The spirits no longer prevent you from entering.', 'Something in the far corner appears to be grinning at you.', 'Pass the gate and take the crystal skull.'];
      if (state.flags.ritual_candles) return ['The spirits cower at your unearthly power.', 'The ceremony still lacks its spoken part.', 'Read the black book at the stone lectern.'];
      if (state.flags.ritual_bell) return ['The wraiths have stopped jeering and turned to face you.', 'Now that they are listening, something must command their sight.', 'Light the candles at the lectern, using the matchbook from Maintenance. Then read the black book.'];
      return ['The gate is open, but the way is barred.', 'The temple’s book describes a ceremony against evil; ordinary force will not impress these spirits.', 'Bring the temple bell, candles and black book, plus the matchbook from Maintenance. At the lectern, ring the bell, light the candles, then read the book.'];
    case 'loud_room': return state.flags.echo_solved
      ? ['The acoustics of the room have changed subtly.', ownsItem(state, 'platinum_bar') ? 'There is nothing more to be gained by repeating yourself.' : 'The platinum bar can be reached in the quiet.', ownsItem(state, 'platinum_bar') ? 'Take the passage toward running water to reach the dam, or return to the Round Room.' : 'Take the platinum bar from the cavern floor.']
      : ['Whose voice answers when you call?', 'The room returns exactly what you give it. Consider a word for that phenomenon.', 'Examine the echo stone, type “Echo” into the field, and call it into the cavern. Then take the platinum bar.'];
    case 'dam':
    case 'maintenance':
      if (state.flags.reservoir_drained) return ['The water level has fallen.', 'Ground that was hidden beneath the reservoir is accessible.', 'Take the reservoir-shore passage from the dam and search the exposed basin.'];
      if (state.flags.dam_leak) return ['Water is escaping through a damaged pipe.', 'A viscous material might stay in place where the water will not.', 'Take the Frobozz Magic Gunk from Maintenance and apply it to the leaking pipe.'];
      if (!state.flags.controls_enabled) return r === 'maintenance'
        ? ['Does a click always have its effect in the room where you hear it?', 'Watch the dam’s green bubble after trying the colored buttons.', 'Press the yellow button. Take the wrench, return to the dam and use it on the large bolt.']
        : ['The bolt is not the only feature of the control panel.', 'The green bubble appears to be an indicator. Other controls may affect it.', 'Go to Maintenance, press yellow and collect the wrench. Return to the dam and turn the large bolt.'];
      return ['The green plastic bubble is glowing serenely.', 'The controls are ready. The bolt still requires a tool which fits its shape.', hasItem(state, 'wrench') ? 'Examine the large bolt and choose the wrench from your satchel.' : 'Collect the wrench in Maintenance, then use it at the dam’s large bolt.'];
    case 'reservoir':
      if (!ownsItem(state, 'jewel_trunk')) return ['What has the retreating water left in the mud?', 'Part of an old trunk is exposed.', 'Take the trunk of jewels from the basin.'];
      if (!hasItem(state, 'pump')) return ['There is equipment on the northern shore.', 'The small hand pump has not been washed away.', 'Collect the hand-held air pump beside the northern landing.'];
      return ['The basin opens into two quite different passages.', 'One leads among old columns; the other runs under the coal-bearing hills.', !ownsItem(state, 'trident') ? 'Take the western passage to Atlantis and examine the shore.' : 'Take the northern passage beneath the coal-bearing hills.'];
    case 'atlantis':
      if (!state.flags.reservoir_drained) return ['Water still separates you from part of the sanctuary.', 'These ruins share their water level with the reservoir.', 'Return to Flood Control Dam #3. Enable the controls with Maintenance’s yellow button and turn the dam bolt with the wrench.'];
      if (!ownsItem(state, 'trident')) return ['Something clear catches the light at the shore.', 'The object has three points and belongs to an ancient sea god.', 'Take Poseidon’s crystal trident from the shore.'];
      if (!state.flags.mirror_awakened) return ['Have you looked closely at the mirror?', 'The tablet joins two identical chambers with a silver line.', 'Examine the ancient mirror to open the passage to the temple.'];
      return ['The sanctuary’s treasure is recovered.', 'The mirror offers a shorter route away from the reservoir.', 'Use the silver passage to the temple, or return through the reservoir toward the mines.'];
    case 'bat_cavern':
      if (!state.flags.bat_quiet) return ['How does the bat find you without much light?', 'The miner’s note suggests taking advantage of its sense of smell.', 'Bring the garlic from the kitchen, examine the bat’s roost and choose the garlic from your satchel.'];
      return ownsItem(state, 'jade')
        ? ['The bat is no longer attending to the passage.', 'The route beneath its roost leads into the coal mine.', 'Take the northern passage into the mine.']
        : ['Something remains beneath the bat’s roost.', 'The little figure is carved from jade.', 'Take the jade figurine, then enter the coal mine.'];
    case 'coal_mine':
      if (!state.flags.gas_safe) return ['The air smells strongly of coal gas.', 'The warning singles out exposed flames.', 'Keep your brass lantern on, examine the gas-filled side working to the east and choose the lantern from your satchel.'];
      if (!ownsItem(state, 'bracelet')) return ['There is a glint farther along the side working.', 'Blue stones show through the dark.', 'Follow the timbered side working to the sapphire-encrusted bracelet.'];
      if (!state.flags.basket_lowered) return ['The chain and the narrow passage were built for different sorts of traffic.', 'The freight manifest separates the mill’s equipment from its operator.', 'Load coal, the screwdriver and the ivory torch into the shaft basket. Coal is here; the screwdriver is in Maintenance; the torch is below the dome. Borrow the torch from the case if you deposited it.'];
      if (!state.flags.basket_retrieved) return ['The loaded basket has descended out of sight.', 'Your cargo is below, not in your satchel.', 'Follow the lower-mill passage and retrieve the cargo from the lowered basket.'];
      return state.flags.diamond_created
        ? ['The mill has finished its work.', 'The route through the Bat Room leads back toward the dam.', 'Return through the Bat Room and reservoir to the dam. Its fire provides a safe return to the house.']
        : ['The delivery has reached the lower workings.', 'The mill is reached by the passage beside the shaft.', 'Enter the Machine Room and examine the machine and its plate.'];
    case 'machine_room':
      if (!state.flags.basket_retrieved) return ['The basket has arrived beside the machine.', 'Its contents are still inside it.', 'Examine the lowered basket to retrieve your cargo.'];
      if (!state.flags.machine_loaded && state.flags.machine_closed) return ['The closed chamber is empty.', 'The sample must be inside before the chamber is sealed.', 'Open the pressure lid, then load the coal. Close the lid before turning the START switch.'];
      if (!state.flags.machine_loaded) return ['What sort of material might this machine be built to alter?', 'The plate specifies carbon. Consider what the mine produces.', 'Examine the machine and load the coal into its chamber.'];
      if (!state.flags.machine_closed) return ['The coal is in the chamber, but the lid is open.', 'Pressure requires a seal.', 'Examine the machine and close the pressure lid.'];
      if (!state.flags.diamond_created) return ['The switch has a slot much narrower than a finger.', 'A flat tool can fit where a human hand cannot.', 'Use the screwdriver to turn the machine’s START switch.'];
      return ownsItem(state, 'diamond')
        ? ['The experiment has produced its result.', 'There is no need to put the diamond back.', 'Return through the mine with the diamond. It belongs in the trophy case.']
        : ['The machine has stopped, and something shines in its tray.', 'The result is rather different from the coal you loaded.', 'Take the enormous diamond from the receiving tray.'];
    case 'dam_base': return state.flags.boat_ready
      ? ['The boat is inflated.', 'The river flows quietly near the dam.', 'Take the Frigid River exit to launch the boat.']
      : ['The folded plastic has a small valve attached.', 'It is a boat with its air missing.', hasItem(state, 'pump') ? 'Use your hand-held pump on the folded plastic.' : 'Collect the hand-held air pump on the reservoir’s northern shore, then use it on the folded plastic here.'];
    case 'river':
      if (!ownsItem(state, 'emerald')) return ['There is a red buoy here, probably a warning.', 'Most buoys are hollow.', 'Examine the red buoy to open it and collect its contents.'];
      if (!state.flags.river_moored) return ['The sound of rushing water is growing louder.', 'A sheltered channel reaches the sandy shore.', 'Examine the sheltered landing and choose to steer into the shore.'];
      return ['You have reached the landing.', 'A cave and the falls can both be reached from here.', !state.visited.includes('sandy_cave') ? 'Take the sandy-landing passage to the cave.' : 'Take the path to Aragain Falls.'];
    case 'sandy_cave':
      if (!state.flags.scarab_revealed) return ['A mark on the wall disappears beneath the sand.', 'The drift could conceal more than the bottom of the wall.', 'Take the shovel by the cave mouth, then use it at the sand drift.'];
      return ownsItem(state, 'scarab')
        ? ['The drift has yielded its treasure.', 'The falls trail leads away from the cave.', 'Take the falls trail to Aragain Falls, or return to the river landing.']
        : ['Something glitters in the excavated sand.', 'It is shaped like a beetle, rather than an ordinary stone.', 'Take the jeweled scarab from the sand.'];
    case 'falls':
      if (!state.flags.rainbow_solid) return ['The rainbow seems almost within reach.', 'Have you seen these seven colors arranged together somewhere else?', 'Bring the Egyptian sceptre from the gold coffin and use it at the rainbow. If it is in the trophy case, borrow it first.'];
      return ownsItem(state, 'gold')
        ? ['The rainbow has borne your weight.', 'Its far end leads back toward the forest.', 'Use the rainbow crossing to return to the forest and carry the gold to the trophy case.']
        : ['A solid rainbow spans the falls.', 'Look at its far end.', 'Cross to collect the pot of gold.'];
    default: return ['Examine what remains in this room before leaving it.', 'The journal records inscriptions you have already read.', 'Follow an accessible passage you have not visited, or return carried treasures to the living-room case.'];
  }
}

export function hintKey(state: GameState): string { return JSON.stringify([state.room, hints(state)]); }

export function serialize(state: GameState): string { return JSON.stringify(state); }

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(entry => typeof entry === 'string'); }
function plain(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export function deserialize(raw: string): GameState | null {
  try {
    if (typeof raw !== 'string' || raw.length > 1_000_000) return null;
    const data: unknown = JSON.parse(raw);
    if (!plain(data) || ![1, SAVE_VERSION].includes(data.version as number) || typeof data.room !== 'string' || !Object.hasOwn(ROOMS, data.room)) return null;
    if (!strings(data.inventory) || !strings(data.deposited) || !strings(data.visited) || !plain(data.flags)) return null;
    if (data.inventory.some(id => !Object.hasOwn(ITEMS, id)) || data.deposited.some(id => !TREASURES.includes(id))) return null;
    const deposits = data.deposited;
    if (new Set(data.inventory).size !== data.inventory.length || new Set(deposits).size !== deposits.length || data.inventory.some(id => deposits.includes(id))) return null;
    if (!Array.isArray(data.position) || data.position.length !== 2 || data.position.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
    const state = createGame();
    if (plain(data.settings) && ['explorer', 'adventurer', 'veteran'].includes(String(data.settings.difficulty))) {
      state.settings.difficulty = data.settings.difficulty as 'explorer' | 'adventurer' | 'veteran';
    }
    const bounds = sceneBounds(data.room), arrival = arrivalAt(data.room);
    const position = data.version === 1 ? worldPosition(data.room, data.position as [number, number]) : data.position as [number, number];
    state.room = data.room;
    state.position = [bounded(position[0], bounds.minX + 0.4, bounds.maxX - 0.4, arrival.position[0]), bounded(position[1], bounds.minZ + 0.4, bounds.maxZ - 0.4, arrival.position[1])];
    state.yaw = bounded(data.yaw, -1e9, 1e9, 0) + (data.version === 1 ? districtYaw(data.room) : 0);
    state.health = bounded(data.health, 0, 100, 100); state.stamina = bounded(data.stamina, 0, 100, 100);
    state.inventory = [...data.inventory]; state.deposited = [...data.deposited];
    state.flags = {};
    for (const [key, value] of Object.entries(data.flags)) {
      if (!/^[a-z][a-z0-9_]{0,80}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || typeof value !== 'boolean') return null;
      state.flags[key] = value;
    }
    for (const id of [...state.inventory, ...state.deposited]) state.flags[`picked_${id}`] = true;
    state.position = restoreRoutePosition(state.room, state.position, state.flags);
    state.lantern = Boolean(data.lantern) && hasItem(state, 'lantern');
    state.visited = [...new Set(data.visited.filter(id => Object.hasOwn(ROOMS, id)))];
    if (!state.visited.includes(state.room)) state.visited.push(state.room);
    state.checkpoint = typeof data.checkpoint === 'string' && (data.checkpoint === START_ROOM || REST_ROOMS.includes(data.checkpoint)) && state.visited.includes(data.checkpoint) ? data.checkpoint : START_ROOM;
    state.journal = Array.isArray(data.journal) ? data.journal.filter((entry): entry is { id: string; title: string; text: string } => plain(entry) && typeof entry.id === 'string' && typeof entry.title === 'string' && typeof entry.text === 'string').slice(0, 300).map(entry => ({ id: entry.id.slice(0, 100), title: entry.title.slice(0, 200), text: entry.text.slice(0, 2000) })) : state.journal;
    if (plain(data.enemies)) for (const id of ['troll', 'thief']) {
      if (!Object.hasOwn(data.enemies, id)) continue;
      const definition = Object.values(ROOMS).find(room => room.enemy?.id === id)?.enemy;
      if (!definition) continue;
      const maximum = Math.round(definition.health * BALANCE[state.settings.difficulty ?? 'adventurer'].enemyHealth);
      state.enemies[id] = state.flags[`${id}_defeated`] ? 0 : bounded(data.enemies[id], 0, maximum, maximum);
    }
    state.deaths = Math.floor(bounded(data.deaths, 0, 1e6, 0)); state.playTime = bounded(data.playTime, 0, 1e12, 0);
    if (plain(data.settings)) {
      state.settings.volume = bounded(data.settings.volume, 0, 1, state.settings.volume);
      state.settings.sensitivity = bounded(data.settings.sensitivity, 0.1, 5, state.settings.sensitivity);
      state.settings.fov = bounded(data.settings.fov, 50, 110, state.settings.fov);
      state.settings.quality = data.settings.quality === 'high' ? 'high' : 'balanced';
      state.settings.motion = typeof data.settings.motion === 'boolean' ? data.settings.motion : true;
    }
    state.completed = data.completed === true && TREASURES.every(id => ownsItem(state, id)) && state.flags.map_found === true && state.flags.barrow_entered === true;
    return state;
  } catch { return null; }
}

export function roomHasLivingEnemy(state: GameState, room: RoomDef = ROOMS[state.room]): boolean {
  return Boolean(room.enemy && !state.flags[`${room.enemy.id}_defeated`]);
}
