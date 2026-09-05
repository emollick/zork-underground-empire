import type { ExitDef } from './types.ts';

type PlanarPoint = { x: number; z: number };

/** Aim at the opening, including when its center is beside or just behind you. */
export function doorwayTargetScore(exit: Pick<ExitDef, 'position' | 'yaw'>, position: PlanarPoint, forward: PlanarPoint): number {
  const dx = position.x - exit.position[0], dz = position.z - exit.position[1];
  const yaw = exit.yaw ?? 0, sin = Math.sin(yaw), cos = Math.cos(yaw);
  const inward = dx * sin + dz * cos, across = dx * cos - dz * sin;
  const facingThrough = -(forward.x * sin + forward.z * cos);
  // Stay within the aperture and face through it. Arriving with your back to a
  // doorway must not immediately offer the way you just came through.
  if (Math.abs(across) <= 1.25 && inward >= -1.1 && inward <= 1.5 && facingThrough > .45) {
    return Math.abs(inward) + Math.abs(across) * .25 + (1 - facingThrough) * 1.2 + .4;
  }
  const distance = Math.hypot(dx, dz);
  if (distance < .5 || distance >= 4.3) return Infinity;
  const dot = -(dx * forward.x + dz * forward.z) / distance;
  return dot > .68 ? distance + (1 - dot) * 2.5 + .4 : Infinity;
}
