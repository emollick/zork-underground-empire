import type { ExitDef, ItemDef, ObjectDef, RoomDef, RoomKind, Vec2 } from './types.ts';

// Room and object prose draws on the MIT-licensed original Zork I source at
// historicalsource/zork1 commit 97b7b3d68c075dd9af7da499c3e9690ada3471fd.
// Directions and state-dependent clauses are condensed to fit this geography.
// Source mapping: qa/source-design.md. License: licenses/ZORK-MIT.txt.
export const START_ROOM = 'west_house';

const item = (id: string, name: string, description: string, treasure = false): ItemDef => ({ id, name, description, treasure });
export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  item('lantern', 'Brass lantern', 'A brass lantern (battery-powered).'),
  item('sword', 'Elvish sword', 'An elvish sword of great antiquity.'),
  item('rope', 'Coil of rope', 'A large coil of hemp rope.'),
  item('lunch', 'Hot pepper sandwich', 'A hot pepper sandwich, wrapped in a brown sack.'),
  item('water', 'Bottle of water', 'A glass bottle containing a quantity of water.'),
  item('garlic', 'Clove of garlic', 'A clove of garlic. Its smell leaves little room for doubt.'),
  item('skeleton_key', 'Skeleton key', 'A skeleton key from the belongings of a luckless adventurer.'),
  item('wrench', 'Wrench', 'A heavy wrench with square jaws.'),
  item('screwdriver', 'Screwdriver', 'A screwdriver with a narrow, flat blade.'),
  item('putty', 'Frobozz Magic Gunk', '“Frobozz Magic Gunk Company — All-Purpose Gunk.” The contents are a viscous material.'),
  item('matches', 'Matchbook', 'The cover says “Visit Beautiful FCD#3”. Inside: “Close cover before striking.”'),
  item('pump', 'Hand-held air pump', 'A small hand-held air pump.'),
  item('shovel', 'Shovel', 'A shovel, with sand still clinging to its blade.'),
  item('coal', 'Lump of coal', 'A small pile of coal.'),
  item('bell', 'Brass bell', 'A small brass bell.'),
  item('candles', 'Pair of candles', 'A pair of tall candles from the temple altar.'),
  item('black_book', 'Black book', 'Beside page 569, there is only one other page with any legible printing on it. Most of it is unreadable, but the subject seems to be the banishment of evil. Apparently, certain noises, lights, and prayers are efficacious in this regard.'),
  item('fine_picks', 'Thief’s fine picks', 'A set of very fine tools from the thief’s worktable.'),
  item('egg', 'Jewel-encrusted egg', 'The egg is covered with fine gold inlay, and ornamented in lapis lazuli and mother-of-pearl. Unlike most eggs, this one is hinged, with a delicate looking clasp.', true),
  item('canary', 'Golden clockwork canary', 'It has ruby eyes and a silver beak. Through a crystal window below its left wing you can see intricate machinery inside. It appears to have wound down.', true),
  item('bauble', 'Beautiful brass bauble', 'A beautiful brass bauble, glimmering in the light.', true),
  item('painting', 'Beautiful painting', 'A painting by a neglected genius.', true),
  item('platinum_bar', 'Platinum bar', 'A large platinum bar.', true),
  item('torch', 'Ivory torch', 'A flaming torch, made of ivory.', true),
  item('coffin', 'Gold coffin', 'The solid-gold coffin used for the burial of Ramses II.', true),
  item('sceptre', 'Egyptian sceptre', 'A sceptre, possibly that of ancient Egypt itself. The sceptre is ornamented with colored enamel, and tapers to a sharp point.', true),
  item('jewel_trunk', 'Trunk of jewels', 'An old trunk, bulging with assorted jewels.', true),
  item('trident', 'Crystal trident', 'Poseidon’s own crystal trident.', true),
  item('jade', 'Jade figurine', 'An exquisite jade figurine.', true),
  item('bracelet', 'Sapphire-encrusted bracelet', 'A sapphire-encrusted bracelet.', true),
  item('diamond', 'Huge diamond', 'An enormous diamond (perfectly cut).', true),
  item('coins', 'Leather bag of coins', 'An old leather bag, bulging with coins.', true),
  item('skull', 'Crystal skull', 'A beautifully carved crystal skull. It appears to be grinning at you rather nastily.', true),
  item('scarab', 'Jeweled scarab', 'A beautifully carved, jeweled scarab.', true),
  item('emerald', 'Large emerald', 'A large emerald.', true),
  item('chalice', 'Silver chalice', 'A silver chalice, intricately engraved.', true),
  item('gold', 'Pot of gold', 'At the end of the rainbow is a pot of gold.', true),
  item('ancient_map', 'Ancient map', 'The map shows a forest with three clearings. The largest clearing contains a house. Three paths leave the large clearing. One of these paths, leading southwest, is marked “To Stone Barrow”.'),
].map(value => [value.id, value]));

export const TREASURES = Object.values(ITEMS).filter(value => value.treasure).map(value => value.id);

function prop(id: string, label: string, type: string, x: number, z: number, action: string, extra: Partial<ObjectDef> = {}): ObjectDef {
  return { id, label, type, position: [x, 0, z], action, ...extra };
}
function pickup(id: string, type: string, x: number, z: number, requires?: string, height = 0): ObjectDef {
  return prop(id, ITEMS[id].name, type, x, z, 'take', {
    position: [x, height, z],
    item: id, treasure: ITEMS[id].treasure, description: ITEMS[id].description,
    hiddenIf: `picked_${id}`, ...(requires ? { requires } : {}),
  });
}
const cluePresentation: Record<string, Pick<ObjectDef, 'type'> & Partial<Pick<ObjectDef, 'position' | 'yaw' | 'action'>>> = {
  boarded_door: { type: 'surface', position: [0, 0, -8.65], action: 'inspect' },
  forest_marks: { type: 'tree_marks' },
  attic_sketch: { type: 'sketch' },
  cellar_warning: { type: 'carved_warning' },
  troll_scratches: { type: 'axe_scars' },
  surveyor_map: { type: 'route_notes' },
  gallery_label: { type: 'museum_label' },
  cyclops_legend: { type: 'torn_note' },
  cyclops_bowl: { type: 'bowl' },
  thief_note: { type: 'torn_note', position: [-9.32, .91, 3.11] },
  dome_marks: { type: 'timber_grooves', position: [-4.7, 0, 1] },
  ritual_inscription: { type: 'altar_engraving', position: [2.12, .61, -8.5], yaw: Math.PI / 2 },
  royal_cartouche: { type: 'royal_relief' },
  hades_threshold: { type: 'gateway_engraving', position: [-3.41, 1.65, -5.26] },
  echo_inscription: { type: 'carved_warning' },
  dam_diagram: { type: 'dam_plate' },
  maintenance_label: { type: 'clipboard' },
  reservoir_mark: { type: 'north_shore_sign' },
  atlantis_tablet: { type: 'mirror_tablet' },
  bat_scrap: { type: 'torn_note' },
  mine_manifest: { type: 'manifest' },
  mill_instructions: { type: 'machine_plate', position: [1.5, 1.11, -5.335] },
  boat_label: { type: 'boat_label' },
  river_sign: { type: 'river_sign' },
  sand_scratch: { type: 'sand_marks' },
  falls_carving: { type: 'royal_relief' },
};
function inscription(id: string, label: string, x: number, z: number, text: string, action = 'read'): ObjectDef {
  const presentation = cluePresentation[id] ?? { type: 'torn_note' };
  const floorPaper = ['torn_note', 'sketch', 'route_notes'].includes(presentation.type);
  return prop(id, label, presentation.type, x, z, action, { description: text, ...(floorPaper ? { position: [x, .022, z] as [number, number, number] } : {}), ...presentation });
}
function rest(id: string, x: number, z: number, type = 'campfire'): ObjectDef {
  return prop(id, 'Rest by the fire', type, x, z, 'rest', { description: 'A warm place to rest, mend your wounds and mark a safe return.' });
}
function room(id: string, name: string, subtitle: string, kind: RoomKind, map: Vec2, size: Vec2, description: string, objects: ObjectDef[], dark = false): RoomDef {
  return { id, name, subtitle, kind, map, size, spawn: [0, size[1] / 2 - 5], yaw: 0, description, objects, exits: [], dark };
}

const locations: RoomDef[] = [
  room('west_house', 'West of House', 'THE EDGE OF THE EMPIRE', 'forest', [0, 0], [38, 36],
    'You are standing in an open field west of a white house, with a boarded front door. There is a small mailbox here.', [
      prop('mailbox', 'Small mailbox', 'mailbox', -5, -4, 'mailbox'),
      inscription('boarded_door', 'Boarded front door', 4, -8, 'The door is boarded and you can’t remove the boards.'),
    ]),
  room('behind_house', 'Behind House', 'THE WHITE HOUSE', 'house', [1, 0], [24, 26],
    'You are behind the white house. In one corner of the house there is a small window.', [
      prop('kitchen_window', 'Kitchen window', 'window', 0, -6, 'window'),
    ]),
  room('forest', 'Forest Path', 'SOMETHING IN THE BRANCHES', 'forest', [0, -1], [42, 38],
    'This is a path winding through a dimly lit forest. One particularly large tree with some low branches stands at the edge of the path.', [
      pickup('egg', 'egg', -7, -5),
      prop('songbird_perch', 'Songbird', 'bird', 7, -5, 'songbird', { hiddenIf: 'bauble_revealed' }),
      pickup('bauble', 'bauble', 6, -1, 'bauble_revealed'),
      prop('forest_grate', 'Iron grating', 'grate', -7, 5, 'grate'),
      inscription('forest_marks', 'Marks on the old tree', 8, 6, 'A few scratches score the bark beside a small bird’s nest. From farther among the trees comes the chirping of a songbird.'),
    ]),
  room('kitchen', 'Kitchen', 'THE LAST ORDINARY ROOM', 'house', [2, 0], [12, 12],
    'You are in the kitchen of the white house. A table seems to have been used recently for the preparation of food. A passage leads to the west and a dark staircase can be seen leading upward. To the east is a small window.', [
      pickup('lunch', 'food', -2, -1.4, undefined, 0.88), pickup('water', 'bottle', 0, -2.3, undefined, 0.88), pickup('garlic', 'garlic', 2, -1.4, undefined, 0.88),
      prop('kitchen_note', 'A cook’s note', 'scroll', -3, 2.2, 'read', { position: [-3, 0.88, 2.2], description: '“Hot peppers.” A water ring has washed away most of the rest of the note.' }),
    ]),
  room('living_room', 'Living Room', 'A PLACE FOR WHAT YOU FIND', 'house', [3, 0], [14, 14],
    'You are in the living room. There is a doorway to the east and a trophy case.', [
      pickup('lantern', 'resting_lantern', -3.3, -2.5, undefined, 0.86), pickup('sword', 'resting_sword', 3.3, -2.5, undefined, 0.86),
      prop('carpet', 'Large oriental rug', 'rug', 0, 0, 'rug', { hiddenIf: 'trapdoor_open' }),
      prop('cellar_hatch', 'Open trap door', 'hatch', 0, 0, 'cellar_hatch', { requires: 'trapdoor_open' }),
      prop('trophy_case', 'Trophy case', 'trophy_case', 0, -5.5, 'case'),
      pickup('ancient_map', 'scroll', 2.5, -5, 'map_revealed'),
      // The world supplies the domestic fireplace; an empty hotspot avoids a second campfire.
      rest('house_hearth', -5, 2.6, 'hatch'),
      prop('case_inscription', 'The case’s brass plate', 'case_plate', 1.78, -5.025, 'read', { position: [1.78, 1.48, -5.025], description: '“GREAT UNDERGROUND EMPIRE.” The shelves have nineteen numbered settings. Each appears intended for a different treasure.' }),
    ]),
  room('attic', 'Attic', 'UNDER THE EAVES', 'house', [2, -1], [12, 12],
    'This is the attic. The only exit is a stairway leading down.', [
      pickup('rope', 'rope', 0, -2),
      inscription('attic_sketch', 'A charcoal sketch', 3, 1.5, 'A ring of wooden posts surrounds an empty space. The lower half of the drawing has torn away.'),
    ]),
  room('cellar', 'Cellar', 'THE GREAT UNDERGROUND EMPIRE', 'cellar', [3, 1], [30, 30],
    'You are in a dark and damp cellar with a narrow passageway leading north. A stairway leads back to the house.', [
      inscription('cellar_warning', 'A scratched warning', -8, -4, '“The grue is a sinister, lurking presence in the dark places of the earth. Its favorite diet is adventurers, but its insatiable appetite is tempered by its fear of light.”'),
    ], true),
  room('troll_bridge', 'Troll Passage', 'THE FIRST KEEPER', 'bridge', [3, 2], [36, 36],
    'Bloodstains and deep scratches (perhaps made by an axe) mar the walls. A stone crossing spans the fissure.', [
      inscription('troll_scratches', 'A warning on the near stone', -10, 8, '“Watch the shoulders. Let the axe strike stone. An exhausted troll makes an excellent opening.” The passage behind you remains clear if you need the fire upstairs.'),
    ], true),
  room('round_room', 'Round Room', 'ROADS UNDER THE WORLD', 'rotunda', [3, 3], [38, 38],
    'This is a circular stone room with passages in all directions. Several of them have unfortunately been blocked by cave-ins.', [
      rest('surveyor_fire', -9, 6),
      inscription('surveyor_map', 'The surveyor’s route notes', 8, 5, '“Gallery — east. Dome — northeast. Flood Control Dam #3 — west.” Beside the routes are four small marks shaped like campfires.'),
    ]),
  room('gallery', 'Gallery', 'A NEGLECTED GENIUS', 'gallery', [4, 3], [32, 26],
    'This is an art gallery. Most of the paintings have been stolen by vandals with exceptional taste.', [
      pickup('painting', 'painting', 0, -7),
      inscription('gallery_label', 'A small museum label', 7, 4, '“A painting by a neglected genius.” No artist’s name is given.'),
    ]),
  room('maze', 'Maze of Twisting Passages', 'THE LAST EXPLORER', 'maze', [2, 3], [38, 38],
    'This is part of a maze of twisty little passages, all alike. A skeleton, probably the remains of a luckless adventurer, lies here.', [
      pickup('coins', 'coin', -8, -6), pickup('skeleton_key', 'key', 6, -6),
      prop('maze_grate', 'The grating lock', 'grate', -9, 8, 'grate'),
      inscription('cyclops_legend', 'The explorer’s final note', 7, 7, '“One eye. He remembers the sailor who called himself Nobody. What was that fellow’s name? Something about a very long voyage home to Ithaca.”', 'cyclops_legend'),
    ], true),
  room('cyclops', 'Cyclops Room', 'A VERY LARGE APPETITE', 'cyclops', [1, 3], [38, 34],
    'This room has an exit on one side and an archway opposite. Bloodstains mar the walls.', [
      prop('cyclops', 'Speak to the cyclops', 'cyclops', 0, -5, 'cyclops'),
      inscription('cyclops_bowl', 'An empty stone bowl', -9, 6, 'The bowl has been licked clean. Tooth marks in its rim are larger than your thumb.'),
    ]),
  room('treasure_room', 'Treasure Room', 'THE THIEF’S LAST CLAIM', 'treasury', [1, 4], [38, 36],
    'This is a large room, whose east wall is solid granite. A worktable stands among the accumulated belongings of its occupant.', [
      prop('locksmith_table', 'The thief’s worktable', 'worktable', -10, 3, 'egg_lock'),
      pickup('fine_picks', 'pick', -9, -6, 'thief_defeated'),
      pickup('chalice', 'chalice', 9, -7, 'thief_defeated'),
      inscription('thief_note', 'A note on the worktable', 10, 5, '“Fine work undertaken.” Below the words is a drawing of an elaborate lock. The writing becomes considerably less legible around the fee.'),
    ]),
  room('dome', 'Dome Room', 'THE LIGHT BELOW', 'dome', [4, 4], [38, 38],
    'You are at the periphery of a large dome, which forms the ceiling of another room below. Protecting you from a precipitous drop is a wooden railing which circles the dome.', [
      prop('dome_railing', 'Wooden railing', 'rope', -7, 4, 'dome_rope', { hiddenIf: 'dome_secured' }),
      prop('secured_dome_rope', 'Descend the rope', 'hatch', -7, 4, 'dome_rope', { requires: 'dome_secured' }),
      pickup('torch', 'torch', 6, -6, 'dome_secured'),
      inscription('dome_marks', 'Grooves in the railing', 9, 6, 'Two close grooves cross the wood. At their deepest point, a few old hemp fibers remain.'),
    ], true),
  room('temple', 'Ancient Temple', 'THE BELIEFS OF THE ANCIENT ZORKERS', 'temple', [4, 5], [40, 38],
    'This is the north end of a large temple. In front of you is what appears to be an altar. There is an ancient inscription, probably a prayer in a long-forgotten language.', [
      pickup('bell', 'bell', -1.3, -8.3, undefined, 1.115), pickup('candles', 'candles', 0, -8.35, undefined, 1.115), pickup('black_book', 'book', 1.3, -8.3, undefined, 1.115),
      inscription('ritual_inscription', 'Ancient inscription', 3.5, -6.3, 'The prayer is inscribed in an ancient script, rarely used today. It seems to be a philippic against small insects, absent-mindedness, and the picking up and dropping of small objects. The final verse consigns trespassers to the land of the dead. All evidence indicates that the beliefs of the ancient Zorkers were obscure.'),
      prop('temple_mirror', 'Ancient mirror', 'mirror', -12, -1, 'mirror', { yaw: Math.PI / 2 }),
      prop('temple_rope', 'Climb the rope', 'hatch', 0, 16, 'dome_ascent', { requires: 'dome_secured' }),
      rest('temple_fire', -9, 7),
    ]),
  room('egypt', 'Egyptian Room', 'THE KING’S BURDEN', 'altar', [5, 5], [34, 30],
    'This is a room which looks like an Egyptian tomb. A passage leads west.', [
      prop('gold_coffin', 'Gold coffin', 'coffin', 0, -5, 'coffin', { hiddenIf: 'picked_coffin' }),
      pickup('sceptre', 'sceptre', 7, -4, 'coffin_open'),
      inscription('royal_cartouche', 'The painted cartouche', -8, 5, 'A royal figure holds a narrow staff. Red, orange, yellow, green, blue, indigo and violet survive in the flaking enamel; most of the landscape behind him has worn away.'),
    ]),
  room('hades', 'Entrance to Hades', 'THE LAND OF THE LIVING DEAD', 'underworld', [4, 6], [40, 38],
    'You are outside a large gateway, on which is inscribed: “Abandon every hope all ye who enter here!” Thousands of voices, lamenting some hideous fate, can be heard.', [
      prop('hades_lectern', 'Stone lectern', 'altar', 0, 3, 'ritual'),
      pickup('skull', 'skull', 0, -10, 'hades_open'),
      inscription('hades_threshold', 'The gateway inscription', -10, 7, 'Abandon every hope, all ye who enter here!'),
    ]),
  room('loud_room', 'Loud Room', 'A WORD RETURNED', 'cellar', [3, 4], [34, 32],
    'This is a large room with a ceiling which cannot be detected from the ground. Sound seems to reverberate from all of the walls.', [
      prop('echo_stone', 'Call into the cavern', 'pedestal', 0, 3, 'echo'),
      pickup('platinum_bar', 'bar', 0, -7, 'echo_solved'),
      inscription('echo_inscription', 'A mason’s joke', -9, 5, '“The last word is always yours.” The same sentence is scratched below it, a little smaller.'),
    ], true),
  room('dam', 'Flood Control Dam #3', 'THE EMPIRE’S GREAT MACHINE', 'dam', [3, 5], [46, 42],
    'You are standing on the top of the Flood Control Dam #3, which was quite a tourist attraction in times far distant. There is a control panel here, on which a large metal bolt is mounted. Directly above the bolt is a small green plastic bubble.', [
      prop('dam_bolt', 'The sluice-control bolt', 'wheel', 0, -7, 'dam_bolt'),
      inscription('dam_diagram', 'Flood Control Dam #3', 12, 7, 'FCD#3 was constructed in year 783 of the Great Underground Empire to harness the mighty Frigid River. This work was supported by a grant of 37 million zorkmids from your omnipotent local tyrant Lord Dimwit Flathead the Excessive.'),
      rest('dam_fire', -12, 7),
    ]),
  room('maintenance', 'Maintenance Room', 'A FEW IMPORTANT BUTTONS', 'machine', [2, 5], [38, 34],
    'This is what appears to have been the maintenance room for Flood Control Dam #3. Apparently, this room has been ransacked recently, for most of the valuable equipment is gone. On the wall in front of you is a group of buttons colored blue, yellow, brown, and red.', [
      pickup('wrench', 'wrench', -9, -6), pickup('screwdriver', 'screwdriver', -3, -7),
      pickup('putty', 'bottle', 3, -7), pickup('matches', 'book', 9, -6),
      prop('control_buttons', 'The colored control buttons', 'lever', 0, 1, 'controls'),
      prop('leaking_pipe', 'Leaking pipe', 'wheel', 11, 4, 'patch', { requires: 'dam_leak' }),
      inscription('maintenance_label', 'A maintenance memorandum', -10, 6, '“Report changes at the control panel before attempting to turn the bolt.” Someone has underlined “changes” and drawn a small green circle.'),
    ]),
  room('reservoir', 'Reservoir Basin', 'WHAT THE WATER KEPT', 'reservoir', [2, 6], [46, 42],
    'You are on what used to be a large lake, but which is now a large mud pile. There are “shores” to the north and south.', [
      pickup('jewel_trunk', 'chest', -9, -6), pickup('pump', 'pump', 9, -5),
      inscription('reservoir_mark', 'A northern landing sign', 11, 7, '“NORTH SHORE.” Below the lettering is a faded picture of a boat. Most of the water has taken its own route out.'),
    ]),
  room('atlantis', 'Atlantis Room', 'A CITY REMEMBERED IN WATER', 'reservoir', [1, 6], [42, 36],
    'This is an ancient room, long under water. Pale columns rise around the shore.', [
      pickup('trident', 'trident', 0, -7, 'reservoir_drained'),
      prop('atlantis_mirror', 'Ancient mirror', 'mirror', -10, 4, 'mirror', { yaw: Math.PI / 2 }),
      inscription('atlantis_tablet', 'The keeper’s tablet', 10, 5, 'The tablet depicts two identical chambers, joined by a single silver line.'),
    ]),
  room('bat_cavern', 'Bat Room', 'AN UNWELCOME HOST', 'bat', [2, 7], [38, 36],
    'You are in a small room whose ceiling disappears into shadow. The air is close and stale.', [
      prop('bat_roost', 'Bat’s roost', 'bat', 0, -4, 'bat'),
      pickup('jade', 'jade', 8, -6, 'bat_quiet'),
      inscription('bat_scrap', 'A miner’s scrap of paper', -9, 6, '“A vampire bat. It can find a man in the dark without seeing him. Perhaps I should have paid more attention to what it smells.”'),
    ], true),
  room('coal_mine', 'Coal Mine', 'CARGO GOES ANOTHER WAY', 'gas', [2, 8], [42, 40],
    'This is a large room, in the middle of which is a small shaft descending through the floor into darkness below. Constructed over the top of the shaft is a metal framework to which a heavy iron chain is attached. The air smells strongly of coal gas.', [
      pickup('coal', 'coal', -10, -7),
      prop('gas_notice', 'Gas passage', 'lantern', 10, 6, 'gas'),
      pickup('bracelet', 'bracelet', 10, -6, 'gas_safe'),
      prop('lift_basket', 'Shaft basket', 'basket', 0, -3, 'basket'),
      inscription('mine_manifest', 'The mill’s freight manifest', -11, 7, '“MILL DELIVERY: carbon sample; service tool for the narrow switch; work light. Freight by chain. Personnel by side passage.” A separate warning reads: “COAL GAS — NO EXPOSED FLAME.”'),
    ], true),
  room('machine_room', 'Machine Room', 'CARBON UNDER PRESSURE', 'machine', [3, 8], [38, 36],
    'This is a large, cold room. There is a machine which is reminiscent of a clothes dryer. On its face is a switch which is labelled “START”. The switch does not appear to be manipulable by any human hand (unless the fingers are about 1/16 by 1/4 inch).', [
      prop('lowered_basket', 'Lowered basket', 'basket', -10, 5, 'basket_retrieve', { hiddenIf: 'basket_retrieved' }),
      prop('pressure_mill', 'Machine', 'machine', 0, -5, 'machine'),
      pickup('diamond', 'diamond', 10, -5, 'diamond_created'),
      inscription('mill_instructions', 'The machine’s plate', 10, 6, '“PRESSURE CHAMBER — CARBON SPECIMENS ONLY. Interlock must be engaged before starting.” A cutaway diagram shows the seal around the heavy lid.'),
    ]),
  room('dam_base', 'Dam Base', 'THE FRIGID RIVER', 'river', [3, 6], [42, 38],
    'You are at the base of Flood Control Dam #3, which looms above you and to the north. The river Frigid is flowing by here. Along the river are the White Cliffs which seem to form giant walls stretching from north to south along the shores of the river as it winds its way downstream.', [
      prop('folded_boat', 'Folded pile of plastic', 'boat', 1.1, -15.7, 'boat'),
      inscription('boat_label', 'Tan label', -1.2, -14.1, '“FROBOZZ MAGIC BOAT COMPANY. Hello, Sailor! This boat is guaranteed against all defects for a period of 76 milliseconds from date of purchase or until first used, whichever comes first. This boat is made of thin plastic. Good Luck!”'),
    ]),
  room('river', 'Frigid River', 'KEEP TO THE LANDING', 'river', [4, 7], [46, 40],
    'The river is running faster here and the sound ahead appears to be that of rushing water. On the east shore is a sandy beach.', [
      prop('river_buoy', 'Red buoy', 'buoy', -9, -4, 'buoy', { hiddenIf: 'picked_emerald' }),
      prop('river_landing', 'Sheltered landing', 'boat', 8, 3, 'land'),
      inscription('river_sign', 'A warning above the water', -11, 7, '“SANDY LANDING — EAST. FALLS AHEAD.” The sheltered channel bends toward the shore. The center of the river does not.'),
    ]),
  room('sandy_cave', 'Sandy Cave', 'BENEATH THE DRIFT', 'sand', [5, 7], [38, 34],
    'This is a sand-filled cave. Wind has banked the sand against the walls.', [
      pickup('shovel', 'shovel', -9, 4),
      prop('sand_drift', 'Sand drift', 'pedestal', 0, -5, 'dig'),
      pickup('scarab', 'scarab', 7, -6, 'scarab_revealed'),
      inscription('sand_scratch', 'A scratch on the cave wall', 9, 6, 'A short mark disappears beneath the drift. Something in the sand catches the light.'),
    ]),
  room('falls', 'Aragain Falls', 'ABOVE THE FRIGID RIVER', 'falls', [5, 8], [48, 44],
    'You are at the top of Aragain Falls, an enormous waterfall with a drop of about 450 feet. A beautiful rainbow can be seen over the falls and to the west.', [
      prop('rainbow_ledge', 'Rainbow', 'surface', 0, 4, 'rainbow'),
      pickup('gold', 'gold', -22.5, -2.6, 'rainbow_solid'),
      inscription('falls_carving', 'A weathered carving', -12, 7, 'Seven bands curve above a royal figure. Only his raised hand and part of a narrow staff remain clear.'),
    ]),
  room('barrow', 'Stone Barrow', 'THE LAST ROAD', 'barrow', [-1, 0], [38, 38],
    'You are standing in front of a massive barrow of stone. In the east face is a huge stone door which is open. You cannot see into the dark of the tomb.', [
      prop('barrow_threshold', 'Enter the Stone Barrow', 'altar', 0, -8, 'ending'),
    ]),
];

export const ROOMS: Record<string, RoomDef> = Object.fromEntries(locations.map(value => [value.id, value]));
ROOMS.kitchen.spawn = [0, 4.4];
ROOMS.living_room.spawn = [0, 5.2];
ROOMS.attic.spawn = [0, 4.3];
ROOMS.troll_bridge.enemy = { id: 'troll', name: 'The Troll', kind: 'troll', position: [0, -5], health: 165, damage: 26, speed: 2.4 };
ROOMS.treasure_room.enemy = { id: 'thief', name: 'The Thief', kind: 'thief', position: [2, -5], health: 205, damage: 20, speed: 3.1 };

function link(from: string, to: string, label: string, at: Vec2, requires?: string, blocked?: string): void {
  const exit: ExitDef = { id: `${from}_to_${to}`, to, label, position: at };
  if (requires) exit.requires = requires;
  if (blocked) exit.blocked = blocked;
  ROOMS[from].exits.push(exit);
}
function passage(a: string, b: string, labelA: string, labelB: string, aPos: Vec2, bPos: Vec2, requires?: string, blocked?: string): void {
  link(a, b, labelA, aPos, requires, blocked);
  link(b, a, labelB, bPos, requires, blocked);
}

passage('west_house', 'behind_house', 'Around the house', 'West of house', [18, 3], [-11, 3]);
passage('west_house', 'forest', 'Forest path', 'White house', [-18, 0], [0, 18]);
passage('west_house', 'barrow', 'Forest path', 'White house', [-10, 17], [0, 18], 'barrow_path_open', 'You can’t go that way.');
link('behind_house', 'kitchen', 'Through the kitchen window', [0, -6], 'window_open', 'The kitchen window is ajar. Open it first.');
link('kitchen', 'behind_house', 'Kitchen window', [5.4, 2.5]);
passage('kitchen', 'living_room', 'Living room', 'Kitchen', [-5.4, 1], [6.4, 2]);
passage('kitchen', 'attic', 'Stairs to the attic', 'Kitchen stairs', [0, -5.4], [0, 5.4]);
passage('living_room', 'cellar', 'The cellar stair', 'Back to the house', [0, 0], [0, 14], 'trapdoor_open', 'There is no way down here.');
passage('cellar', 'troll_bridge', 'The troll passage', 'Cellar', [0, -14], [0, 17]);
link('troll_bridge', 'round_room', 'The underground hall', [0, -17], 'troll_defeated', 'The troll blocks your way.');
link('round_room', 'troll_bridge', 'Troll passage', [0, 18]);
link('troll_bridge', 'maze', 'The twisting passages', [-17, 0], 'troll_defeated', 'The troll guards that passage.');
link('maze', 'troll_bridge', 'Troll passage', [18, 0]);
passage('maze', 'forest', 'The surface grating', 'Iron grating', [-18, 0], [-20, 8], 'grate_open', 'The grating is locked.');
passage('maze', 'cyclops', 'The one-eyed keeper', 'Back into the maze', [0, -18], [0, 16]);
link('cyclops', 'treasure_room', 'The archway', [0, -16], 'cyclops_passed', 'The cyclops blocks your way.');
link('treasure_room', 'cyclops', 'Cyclops room', [0, 17]);
passage('cyclops', 'living_room', 'The broken wall', 'The opening to the west', [-18, 0], [-6.4, -1], 'cyclops_fled', 'The wooden door is nailed shut.');
passage('round_room', 'gallery', 'The gallery', 'Round room', [18, 0], [-15, 0]);
passage('round_room', 'dome', 'The great dome', 'Round room', [10, -18], [-18, 5]);
passage('gallery', 'dome', 'Dome gallery', 'Painting gallery', [15, 0], [0, 18]);
link('dome', 'temple', 'The room below', [0, -18], 'dome_secured', 'The room below is beyond your reach.');
link('temple', 'dome', 'The rope ascent', [0, 18], 'dome_secured', 'Without a secured rope, the dome is out of reach.');
passage('temple', 'egypt', 'Egyptian chamber', 'Ancient temple', [19, 0], [-16, 0]);
passage('temple', 'hades', 'The gate of Hades', 'Back to the temple', [0, -18], [0, 18]);
passage('temple', 'atlantis', 'The silver passage', 'The silver passage', [-19, 0], [-20, 0], 'mirror_awakened', 'A wall blocks the passage.');
passage('round_room', 'loud_room', 'The echoing cavern', 'Round room', [0, -18], [0, 15]);
passage('round_room', 'dam', 'Flood Control Dam #3', 'Round room', [-18, -6], [0, 20]);
passage('loud_room', 'dam', 'The sound of running water', 'Loud Room', [-16, 0], [22, 8]);
passage('dam', 'maintenance', 'Maintenance wing', 'Dam controls', [-22, 0], [18, 0]);
link('dam', 'reservoir', 'Reservoir shore', [0, -20], 'reservoir_drained', 'Deep water covers the way.');
link('reservoir', 'dam', 'Back to the dam', [0, 20]);
link('reservoir', 'atlantis', 'Atlantis sanctuary', [-22, 0]);
link('atlantis', 'reservoir', 'Reservoir basin', [20, 0], 'reservoir_drained', 'Water covers the reservoir floor.');
passage('reservoir', 'bat_cavern', 'The coal-bearing hills', 'Reservoir', [0, -20], [0, 17]);
link('bat_cavern', 'coal_mine', 'The coal mine', [0, -17], 'bat_quiet', 'The bat swoops down as you approach the passage.');
link('coal_mine', 'bat_cavern', 'The bat’s cavern', [0, 19]);
link('coal_mine', 'machine_room', 'The lower mill', [0, -19], 'basket_lowered', 'The mill below has not received its delivery.');
link('machine_room', 'coal_mine', 'The mine passage', [0, 17]);
passage('dam', 'dam_base', 'Stairs below the dam', 'Dam stair', [22, -6], [0, 18]);
link('dam_base', 'river', 'Frigid River', [0, -18], 'boat_ready', 'The folded plastic will not float in this condition.');
link('river', 'dam_base', 'Return to the dam landing', [0, 19]);
link('river', 'sandy_cave', 'The sandy landing', [22, 0], 'river_moored', 'Steer into the sheltered landing before going ashore.');
link('sandy_cave', 'river', 'The river landing', [-18, 0]);
link('river', 'falls', 'The path to Aragain Falls', [0, -19], 'river_moored', 'Land the boat first. The middle of the river leads over the falls.');
link('falls', 'river', 'The sheltered river landing', [0, 21]);
passage('sandy_cave', 'falls', 'The falls trail', 'Sandy cave', [0, -16], [23, 2]);
passage('falls', 'forest', 'The rainbow', 'The rainbow', [-23, 0], [20, 0], 'rainbow_solid', 'The rainbow is not solid.');

// Travel, the visible threshold, and the return arrival describe the same route.
// Ordinary passages use a wall opening; exceptional routes supply their own form.
const routeDetails: Record<string, Partial<ExitDef>> = {
  west_house_to_behind_house: { role: 'trail' }, behind_house_to_west_house: { role: 'trail' },
  west_house_to_forest: { role: 'trail' }, forest_to_west_house: { role: 'trail' },
  west_house_to_barrow: { role: 'trail' }, barrow_to_west_house: { role: 'trail' },
  behind_house_to_kitchen: { role: 'window', via: 'kitchen_window', barrier: 'nailed-door' },
  kitchen_to_behind_house: { role: 'window', arrival: { position: [3.8, 2.5], yaw: Math.PI / 2 } },
  kitchen_to_attic: { role: 'stairs', arrival: { position: [0, -3.5], yaw: Math.PI } }, attic_to_kitchen: { role: 'stairs' },
  living_room_to_cellar: { role: 'hatch', via: 'cellar_hatch', barrier: 'drop', arrival: { position: [0, 2.7], yaw: Math.PI } },
  cellar_to_living_room: { role: 'stairs' },
  troll_bridge_to_maze: { barrier: 'creature' }, troll_bridge_to_round_room: { barrier: 'creature' },
  maze_to_forest: { role: 'grating', via: 'maze_grate', barrier: 'gate', arrival: { position: [-6.6, 8], yaw: -Math.PI / 4 } },
  forest_to_maze: { role: 'grating', via: 'forest_grate', barrier: 'gate' },
  cyclops_to_treasure_room: { barrier: 'creature' },
  cyclops_to_living_room: { barrier: 'nailed-door' }, living_room_to_cyclops: { barrier: 'nailed-door' },
  dome_to_temple: { role: 'rope', via: 'secured_dome_rope', barrier: 'drop', yaw: 0, arrival: { position: [-7, 6.8], yaw: Math.PI } },
  temple_to_dome: { role: 'rope', via: 'temple_rope', barrier: 'drop', yaw: Math.PI, arrival: { position: [0, 13.2], yaw: 0 } },
  temple_to_atlantis: { role: 'mirror', via: 'temple_mirror', barrier: 'sealed-wall', yaw: Math.PI / 2, arrival: { position: [-8.8, -1], yaw: -Math.PI / 2 } },
  atlantis_to_temple: { role: 'mirror', via: 'atlantis_mirror', barrier: 'sealed-wall', yaw: Math.PI / 2, arrival: { position: [-6.8, 4], yaw: -Math.PI / 2 } },
  dam_to_reservoir: { role: 'stairs', barrier: 'water' }, reservoir_to_dam: { role: 'stairs' },
  atlantis_to_reservoir: { role: 'stairs', barrier: 'water' }, reservoir_to_atlantis: { role: 'stairs' },
  reservoir_to_bat_cavern: { role: 'trail' }, bat_cavern_to_reservoir: { role: 'trail' },
  bat_cavern_to_coal_mine: { barrier: 'creature' },
  coal_mine_to_machine_room: { role: 'stairs', barrier: 'gate' }, machine_room_to_coal_mine: { role: 'stairs' },
  dam_to_dam_base: { role: 'stairs' }, dam_base_to_dam: { role: 'stairs' },
  dam_base_to_river: { role: 'water', barrier: 'water' }, river_to_dam_base: { role: 'water' },
  river_to_sandy_cave: { role: 'landing', barrier: 'water' }, sandy_cave_to_river: { role: 'landing' },
  river_to_falls: { role: 'landing', barrier: 'water' }, falls_to_river: { role: 'landing' },
  sandy_cave_to_falls: { role: 'trail' }, falls_to_sandy_cave: { role: 'trail' },
  falls_to_forest: { role: 'rainbow', barrier: 'drop', yaw: Math.atan2(23, 4) },
  forest_to_falls: { role: 'rainbow', barrier: 'drop' },
};
for (const room of Object.values(ROOMS)) for (const exit of room.exits) {
  Object.assign(exit, routeDetails[exit.id]);
  exit.role ??= 'passage';
  if (exit.via) {
    const object = room.objects.find(value => value.id === exit.via);
    if (!object) throw new Error(`Missing travel object for ${exit.id}`);
    exit.position = [object.position[0], object.position[2]];
  }
  exit.yaw ??= Math.abs(exit.position[0] / (room.size[0] / 2)) > Math.abs(exit.position[1] / (room.size[1] / 2))
    ? exit.position[0] < 0 ? Math.PI / 2 : -Math.PI / 2
    : exit.position[1] < 0 ? 0 : Math.PI;
}

export const REST_ROOMS = ['living_room', 'round_room', 'temple', 'dam'];
export function getRoom(id: string): RoomDef { return ROOMS[id] ?? ROOMS[START_ROOM]; }
