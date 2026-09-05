import * as THREE from 'three';

export const COFFIN_CONTENTS_POSITION = [0, .216, -4.53] as const;

/** Move the model without changing the legacy anchor used to build obstacles. */
export function placeCoffinContents(prop: THREE.Group): void {
  const contents = new THREE.Group(); contents.name = 'coffin-contents';
  contents.add(...prop.children); contents.rotation.x = -Math.PI / 2;
  prop.add(contents); prop.position.set(...COFFIN_CONTENTS_POSITION);
}

function applyLidProgress(lid: THREE.Object3D, progress: number): void {
  const closed = lid.userData.closedPosition as number[];
  const raised = lid.userData.liftPosition as number[];
  const open = lid.userData.openPosition as number[];
  const up = [closed[0], raised[1], closed[2]];
  const [from, to, local] = progress < .18 ? [closed, up, progress / .18]
    : progress < .78 ? [up, raised, (progress - .18) / .6]
      : [raised, open, (progress - .78) / .22];
  const eased = THREE.MathUtils.smoothstep(local, 0, 1);
  lid.position.set(THREE.MathUtils.lerp(from[0], to[0], eased),
    THREE.MathUtils.lerp(from[1], to[1], eased), THREE.MathUtils.lerp(from[2], to[2], eased));
}

export function setCoffinOpen(coffin: THREE.Group, open: boolean, immediate = false): void {
  const lid = coffin.getObjectByName('coffin-lid');
  if (!lid) return;
  lid.userData.openTarget = open ? 1 : 0;
  if (immediate || lid.userData.openProgress === undefined) {
    lid.userData.openProgress = lid.userData.openTarget;
    applyLidProgress(lid, lid.userData.openProgress);
  }
}

export function animateCoffinLid(coffin: THREE.Group, dt: number): void {
  const lid = coffin.getObjectByName('coffin-lid');
  if (!lid || lid.userData.openProgress === lid.userData.openTarget) return;
  const from = lid.userData.openProgress as number, target = lid.userData.openTarget as number;
  lid.userData.openProgress = from + Math.sign(target - from) * Math.min(Math.abs(target - from), Math.max(0, dt) / .85);
  applyLidProgress(lid, lid.userData.openProgress);
}
