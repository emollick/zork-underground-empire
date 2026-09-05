import { ROOMS } from './campaign.ts';
import type { GameState, RoomDef, Vec2 } from './types.ts';

export const HOUSE_DISTRICTS = ['west_house', 'behind_house', 'forest'] as const;
export interface WorldBounds { minX: number; maxX: number; minZ: number; maxZ: number; }
export const HOUSE_BOUNDS: WorldBounds = { minX: -57, maxX: 27, minZ: -39, maxZ: 22 };

export function isHouseGrounds(id: string): boolean {
  return (HOUSE_DISTRICTS as readonly string[]).includes(id);
}

export function districtYaw(id: string): number {
  return id === 'behind_house' ? Math.PI : id === 'forest' ? Math.PI / 2 : 0;
}

/** Zork's room names remain narrative districts; their outdoors share one coordinate space. */
export function worldPosition(id: string, local: Vec2): Vec2 {
  if (id === 'behind_house') return [-local[0] || 0, -23.2 - local[1]];
  if (id === 'forest') return [local[1] - 36, -local[0] || 0];
  return [...local];
}

export function sceneBounds(id: string): WorldBounds {
  if (isHouseGrounds(id)) return HOUSE_BOUNDS;
  const room = ROOMS[id];
  return { minX: -room.size[0] / 2, maxX: room.size[0] / 2, minZ: -room.size[1] / 2, maxZ: room.size[1] / 2 };
}

export function arrivalAt(id: string, from?: string): { position: Vec2; yaw: number } {
  if (id === 'behind_house' && from === 'kitchen') return { position: [0, -19.2], yaw: 0 };
  if (id === 'forest' && from === 'maze') return { position: [-31, 9.3], yaw: Math.PI };
  if (id === 'forest' && from === 'falls') return { position: [-36, -16.7], yaw: Math.PI };
  if (id === 'west_house' && from === 'barrow') return { position: [-10, 13.8], yaw: 0 };
  const room = ROOMS[id];
  const entrance = room.exits.find(exit => exit.to === from);
  if (entrance) {
    const yaw = entrance.yaw ?? 0;
    const arrival = entrance.arrival ?? {
      position: [entrance.position[0] + Math.sin(yaw) * 3.2, entrance.position[1] + Math.cos(yaw) * 3.2] as Vec2,
      yaw: yaw + Math.PI,
    };
    return { position: worldPosition(id, arrival.position), yaw: arrival.yaw + districtYaw(id) };
  }
  return { position: worldPosition(id, room.spawn), yaw: (room.yaw ?? 0) + districtYaw(id) };
}

export function houseDistrictAt(position: Vec2, previous: string): string {
  const [x, z] = position;
  // A small overlap prevents a location banner flickering while walking along a boundary.
  if (x < (previous === 'forest' ? -16.5 : -18.5)) return 'forest';
  if (z < (previous === 'behind_house' ? -16.5 : -18.2)) return 'behind_house';
  return 'west_house';
}

export function houseExterior(state: GameState): RoomDef {
  const objects = HOUSE_DISTRICTS.flatMap(id => ROOMS[id].objects.map(object => {
    const [x, z] = worldPosition(id, [object.position[0], object.position[2]]);
    return { ...object, position: [x, object.position[1], z] as [number, number, number], district: id, yaw: (object.yaw ?? 0) + districtYaw(id) };
  }));
  const exits = HOUSE_DISTRICTS.flatMap(id => ROOMS[id].exits
    .filter(exit => !isHouseGrounds(exit.to))
    .filter(exit => exit.to !== 'barrow' || state.flags.barrow_path_open)
    .map(exit => ({ ...exit, district: id, position: worldPosition(id, exit.position), yaw: (exit.yaw ?? 0) + districtYaw(id) })));
  return { ...ROOMS.west_house, id: 'house_grounds', size: [114, 78], objects, exits };
}

export function visitDistrict(state: GameState, id: string): boolean {
  state.room = id;
  if (state.visited.includes(id)) return false;
  state.visited.push(id);
  const room = ROOMS[id];
  if (!state.journal.some(entry => entry.id === `place_${id}`)) {
    state.journal.push({ id: `place_${id}`, title: room.name, text: room.description });
  }
  return true;
}
