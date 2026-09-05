import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/** The normal prepass cannot treat cutout leaves, glass or light shafts as solids. */
export class SolidSurfaceAO extends GTAOPass {
  private omitted: THREE.Object3D[] = [];
  _overrideVisibility() {
    this.scene.traverse(object => {
      if (!object.visible) return;
      let skip = object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Sprite || object.layers.mask === 2;
      if (object instanceof THREE.Mesh) {
        const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
        skip ||= materials.some(material => material.transparent || material.alphaTest > 0 || material instanceof THREE.ShaderMaterial);
      }
      if (skip) { this.omitted.push(object); object.visible = false; }
    });
  }
  _restoreVisibility() {
    for (const object of this.omitted) object.visible = true;
    this.omitted.length = 0;
  }
}
