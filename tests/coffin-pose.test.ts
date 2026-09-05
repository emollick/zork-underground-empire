import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeProp } from '../src/models.ts';
import { animateCoffinLid, placeCoffinContents, setCoffinOpen } from '../src/coffin-pose.ts';

test('opening the coffin slides its real lid clear of the cavity and restores that pose on reload', () => {
  const coffin = makeProp('coffin', {}), lid = coffin.getObjectByName('coffin-lid');
  assert.ok(lid, 'the lid must be a separate articulated object');
  setCoffinOpen(coffin, false, true);
  assert.deepEqual(lid.position.toArray(), [0, 0, 0]);
  setCoffinOpen(coffin, true);
  animateCoffinLid(coffin, .4);
  assert.ok(lid.position.x > 0 && lid.position.x < .83, 'the lid slides visibly instead of jumping');
  assert.ok(lid.position.y > 0, 'the lid clears the rim before being set down');
  animateCoffinLid(coffin, 1);
  assert.deepEqual(lid.position.toArray(), lid.userData.openPosition);
  const bounds = new THREE.Box3().setFromObject(lid);
  assert.ok(bounds.min.x > .4, 'open lid no longer covers the coffin opening');
  assert.ok(bounds.min.y >= 0, 'the displaced lid does not penetrate the floor');
  const restored = makeProp('coffin', {});
  setCoffinOpen(restored, true, true);
  assert.deepEqual(restored.getObjectByName('coffin-lid')!.position.toArray(), lid.position.toArray());
  const trophy = makeProp('coffin', {});
  assert.deepEqual(trophy.getObjectByName('coffin-lid')!.position.toArray(), [0, 0, 0], 'a trophy model stays closed');
});

test('the sceptre lies within the coffin, clear of its floor and below its rim', () => {
  const sceptre = makeProp('sceptre', {});
  placeCoffinContents(sceptre);
  const bounds = new THREE.Box3().setFromObject(sceptre);
  assert.ok(bounds.min.x > -.275 && bounds.max.x < .275, 'inside the narrow cavity');
  assert.ok(bounds.min.z > -5.73 && bounds.max.z < -4.27, 'inside the coffin length');
  assert.ok(bounds.min.y >= .08 && bounds.max.y < .368, 'rests in the cavity below the rim');
});
