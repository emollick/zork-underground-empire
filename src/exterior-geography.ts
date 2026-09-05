import type { Vec2 } from './types.ts';

/** The forest ends at a gorge; the rainbow crosses to an isolated far landing. */
export const HOUSE_GORGE = { east: -25.5, south: -21, depth: 18, shoulder: 1.15 } as const;

export function inHouseGorge(x: number, z: number, margin = 0): boolean {
  return x < HOUSE_GORGE.east + margin && z < HOUSE_GORGE.south + margin;
}

export function houseGorgeDepth(x: number, z: number): number {
  const edgeDistance = Math.min(HOUSE_GORGE.east - x, HOUSE_GORGE.south - z);
  return HOUSE_GORGE.depth * Math.max(0, Math.min(1, edgeDistance / HOUSE_GORGE.shoulder));
}

/** Only positions over the new void move; progress, orientation and routes stay intact. */
export function restoreHouseGorgePosition(point: Vec2, radius = .38 - 1e-6): Vec2 {
  return inHouseGorge(point[0], point[1], radius) ? [-36, -16.7] : point;
}

/** Walking and dodging slide along the visible rim instead of entering the drop. */
export function constrainHouseGorgeStep(point: Vec2, radius = .38): Vec2 {
  const [x, z] = point;
  if (!inHouseGorge(x, z, radius)) return point;
  return HOUSE_GORGE.east - x < HOUSE_GORGE.south - z
    ? [HOUSE_GORGE.east + radius, z]
    : [x, HOUSE_GORGE.south + radius];
}
