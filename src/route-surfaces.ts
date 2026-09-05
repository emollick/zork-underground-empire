import type { Vec2 } from './types.ts';

export const RAINBOW_BRIDGE = {
  start: [0, 4] as Vec2, end: [-23, 0] as Vec2,
  width: 3, rise: 5.2, baseHeight: 0.065,
};

export function rainbowHeight(t: number): number {
  return RAINBOW_BRIDGE.baseHeight + RAINBOW_BRIDGE.rise * Math.pow(Math.max(0, Math.sin(Math.PI * Math.max(0, Math.min(1, t)))), 1.5);
}

export function rainbowCoordinates(point: Vec2): { t: number; side: number } {
  const { start, end } = RAINBOW_BRIDGE;
  const dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz);
  const px = point[0] - start[0], pz = point[1] - start[1];
  return { t: (px * dx + pz * dz) / (length * length), side: (-px * dz + pz * dx) / length };
}

export function routeFloorHeight(roomId: string, point: Vec2, flags: Record<string, boolean>): number {
  if (roomId !== 'falls' || !flags.rainbow_solid) return 0;
  const coordinate = rainbowCoordinates(point);
  return coordinate.t >= 0 && coordinate.t <= 1 && Math.abs(coordinate.side) <= RAINBOW_BRIDGE.width / 2 + 0.02
    ? rainbowHeight(coordinate.t) : 0;
}

/** Earlier versions allowed standing beyond these barriers or on a flat rainbow. */
export function restoreRoutePosition(roomId: string, point: Vec2, flags: Record<string, boolean>): Vec2 {
  if (['forest', 'behind_house', 'west_house'].includes(roomId)) {
    if (Math.abs(point[0] + 31) < 1.06 && Math.abs(point[1] - 7) < 1.06) return [-31, 9.3];
    if (point[0] > -40.28 && point[0] < -31.72 && point[1] < -20.62 && point[1] > -47.38) return [-36, -16.7];
    return point;
  }
  if (roomId === 'hades' && !flags.hades_open && point[1] < -5.1) return [0, -3.5];
  if (roomId !== 'falls') return point;
  const [x, z] = point;
  const inGorge = x < -2.65 && z > -2.35 && z < 5.95;
  const farLanding = x < -19.25 && z > -5.2 && z < 2.2;
  if (!flags.rainbow_solid) return inGorge || farLanding ? [1.6, 6.4] : point;
  if (!inGorge || x < -20.2 && z < 1.55) return point;
  const coordinate = rainbowCoordinates(point);
  if (Math.abs(coordinate.side) <= RAINBOW_BRIDGE.width / 2 + .02) return point;
  const t = Math.max(.02, Math.min(.98, coordinate.t));
  return [RAINBOW_BRIDGE.start[0] + (RAINBOW_BRIDGE.end[0] - RAINBOW_BRIDGE.start[0]) * t,
    RAINBOW_BRIDGE.start[1] + (RAINBOW_BRIDGE.end[1] - RAINBOW_BRIDGE.start[1]) * t];
}

/** The raised rainbow has a low visible edge: walking cannot step off its sides. */
export function constrainRouteStep(roomId: string, before: Vec2, next: Vec2, flags: Record<string, boolean>): Vec2 {
  if (roomId !== 'falls' || !flags.rainbow_solid) return next;
  const previousHeight = routeFloorHeight(roomId, before, flags);
  if (routeFloorHeight(roomId, next, flags) - previousHeight > 0.5) return before;
  if (previousHeight <= 0.4) return next;
  const coordinate = rainbowCoordinates(next), edge = RAINBOW_BRIDGE.width / 2 - 0.35;
  if (coordinate.t <= 0 || coordinate.t >= 1 || Math.abs(coordinate.side) <= edge) return next;
  const { start, end } = RAINBOW_BRIDGE;
  const dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz);
  const side = Math.sign(coordinate.side) * edge;
  return [start[0] + dx * coordinate.t - dz / length * side, start[1] + dz * coordinate.t + dx / length * side];
}
