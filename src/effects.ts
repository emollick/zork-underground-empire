import * as THREE from 'three';

/** A small pool of ballistic sparks makes contact readable without hiding a tell. */
export class CombatEffects {
  group = new THREE.Group();
  private capacity = 120;
  private cursor = 0;
  private positions = new Float32Array(this.capacity * 6);
  private colors = new Float32Array(this.capacity * 6);
  private geometry = new THREE.BufferGeometry();
  private particles = Array.from({ length: this.capacity }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color(), life: 0, duration: 1 }));
  constructor() {
    this.positions.fill(-999);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(this.geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false; this.group.add(lines);
  }
  burst(position: THREE.Vector3, kind: 'hit' | 'block' | 'parry', toward: THREE.Vector3) {
    const count = kind === 'parry' ? 32 : kind === 'block' ? 20 : 15;
    const color = new THREE.Color(kind === 'parry' ? '#eafaff' : kind === 'block' ? '#ffce76' : '#f2ab59');
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor++ % this.capacity];
      p.position.copy(position);
      p.velocity.set((Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4).addScaledVector(toward, 1.5);
      p.life = p.duration = 0.2 + Math.random() * 0.28; p.color.copy(color).multiplyScalar(1.6);
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i], offset = i * 6;
      p.life = Math.max(0, p.life - dt);
      if (!p.life) { for (let j = 0; j < 6; j++) this.positions[offset + j] = -999; continue; }
      p.velocity.y -= dt * 7; p.position.addScaledVector(p.velocity, dt);
      for (let axis = 0; axis < 3; axis++) {
        this.positions[offset + axis] = p.position.getComponent(axis);
        this.positions[offset + 3 + axis] = p.position.getComponent(axis) - p.velocity.getComponent(axis) * 0.026;
        this.colors[offset + axis] = this.colors[offset + 3 + axis] = p.color.toArray()[axis] * (p.life / p.duration);
      }
    }
    this.geometry.attributes.position.needsUpdate = this.geometry.attributes.color.needsUpdate = true;
  }
  clear() { for (const particle of this.particles) particle.life = 0; this.update(0); }
}
