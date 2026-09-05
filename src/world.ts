import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Collider, ExitDef, RoomDef } from './types';
import { createWaterMaterial, createFallsMaterial, createRainbowMaterial } from './water-materials';
import { RAINBOW_BRIDGE, rainbowHeight } from './route-surfaces';
import { createPipeLeak } from './pipe-leak';
import { HOUSE_GORGE, houseGorgeDepth, inHouseGorge } from './exterior-geography';

type Mats = Record<string, THREE.MeshStandardMaterial>;
type Animated = { object: THREE.Object3D; kind: string; baseY?: number };
type Batch = { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; shadow: boolean };

// Architecture is authored in metres. Most routes meet a level landing; the
// raised rainbow shares its walking height with the player controller.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const BLOCK = new RoundedBoxGeometry(1, 1, 1, 1, .045);
const ROCK = new THREE.IcosahedronGeometry(1, 1);
const SMALLROCK = new THREE.IcosahedronGeometry(1, 0);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 12);
const TAPER = new THREE.CylinderGeometry(.62, 1, 1, 9);
const CONE = new THREE.ConeGeometry(1, 1, 8);
const PLANE = new THREE.PlaneGeometry(1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const dummy = new THREE.Object3D();
const color = (value: string, roughness = .85, metalness = 0) => new THREE.MeshStandardMaterial({ color: value, roughness, metalness });
const organic = (x: number, z: number, salt = 0) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.31) * 43758.5453123;
  return n - Math.floor(n);
};
// The house stands in an open field. An irregular meadow edge leaves the
// established forest, rear garden and distant routes in their original places.
const inHouseField = (x: number, z: number) => z > -23.5 && x > -23 &&
  Math.hypot((x - 1) / 21, (z - 4) / 27) < 1 + Math.sin(z * .22) * .055 + Math.cos(x * .27 - z * .11) * .035;
// Independent decoration randomness never changes the established obstacle layout.
function decorationRandom(seed: number) {
  return () => { seed = Math.imul(seed ^ seed >>> 15, seed | 1); seed ^= seed + Math.imul(seed ^ seed >>> 7, seed | 61); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; };
}
function meadowClump() {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const root = new THREE.Color('#465337'), tip = new THREE.Color('#9aa16b');
  for (let blade = 0; blade < 9; blade++) {
    const angle = blade * 2.39996, radius = .09 + organic(blade, 0) * .18;
    const bx = Math.cos(angle) * radius, bz = Math.sin(angle) * radius;
    const height = .48 + organic(blade, 1) * .5, bend = .13 + organic(blade, 2) * .3;
    const facing = angle + organic(blade, 3) * 1.4, width = .015 + organic(blade, 4) * .025;
    const start = positions.length / 3;
    for (let segment = 0; segment < 5; segment++) {
      const t = segment / 4, w = width * Math.pow(1 - t, .72);
      const x = bx + Math.cos(angle) * bend * t * t, z = bz + Math.sin(angle) * bend * t * t;
      const shade = root.clone().lerp(tip, t * .72);
      for (const side of [-1, 1]) {
        positions.push(x + Math.cos(facing) * w * side, height * t, z + Math.sin(facing) * w * side);
        colors.push(shade.r, shade.g, shade.b);
      }
      if (segment < 4) { const v = start + segment * 2; indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
const GRASS = meadowClump();
let leafTexture: THREE.Texture | undefined;
let glowTexture: THREE.CanvasTexture | undefined;
let mistTexture: THREE.CanvasTexture | undefined;
let ashlarTexture: THREE.CanvasTexture | undefined;
let shaftTexture: THREE.CanvasTexture | undefined;
let paintTexture: THREE.CanvasTexture | undefined;
let ironSurfaces: { map: THREE.DataTexture; normalMap: THREE.DataTexture; roughnessMap: THREE.DataTexture } | undefined;

function wornIronSurfaces() {
  if (ironSurfaces) return ironSurfaces;
  const size = 256, heights = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = organic(x, y, 82), mottling = .5 + Math.sin(x * .037 + Math.sin(y * .049)) * .19 + Math.cos(y * .029 - x * .013) * .16;
    const pit = grain < .06 ? -.025 : 0, scratch = Math.abs(Math.sin(x * .79 + y * .063)) > .997 ? .008 : 0;
    heights[y * size + x] = .5 + mottling * .025 + pit + scratch;
    const i = (y * size + x) * 4, tone = 171 + mottling * 21 + (grain - .5) * 6 + pit * 320 + scratch * 800;
    albedo[i] = tone; albedo[i + 1] = tone * .988; albedo[i + 2] = tone * .961; albedo[i + 3] = 255;
    rough[i] = rough[i + 1] = rough[i + 2] = 187 + mottling * 47 - scratch * 1200; rough[i + 3] = 255;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = heights[y * size + (x + 1) % size] - heights[y * size + (x - 1 + size) % size];
    const dy = heights[((y + 1) % size) * size + x] - heights[((y - 1 + size) % size) * size + x];
    const n = new THREE.Vector3(-dx * 4, -dy * 4, 1).normalize(), i = (y * size + x) * 4;
    normal[i] = (n.x * .5 + .5) * 255; normal[i + 1] = (n.y * .5 + .5) * 255; normal[i + 2] = (n.z * .5 + .5) * 255; normal[i + 3] = 255;
  }
  const texture = (data: Uint8Array) => {
    const map = new THREE.DataTexture(data, size, size); map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true; return map;
  };
  ironSurfaces = { map: texture(albedo), normalMap: texture(normal), roughnessMap: texture(rough) }; ironSurfaces.map.colorSpace = THREE.SRGBColorSpace;
  return ironSurfaces;
}

function textures() {
  if (leafTexture) return;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  for (let j = 0; j < 14; j++) {
    const a = j * 2.399, r = 12 + j * 3.6, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + .7);
    ctx.fillStyle = ['#759846', '#516f34', '#91a853', '#385a2e'][j % 4];
    ctx.beginPath(); ctx.moveTo(0, -19); ctx.bezierCurveTo(14, -9, 12, 10, 0, 19); ctx.bezierCurveTo(-12, 10, -14, -9, 0, -19); ctx.fill();
    ctx.strokeStyle = '#aabf75'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, 16); ctx.stroke(); ctx.restore();
  }
  leafTexture = new THREE.TextureLoader().load('./textures/beech-foliage.png'); leafTexture.colorSpace = THREE.SRGBColorSpace; leafTexture.anisotropy = 8;
  const glow = document.createElement('canvas'); glow.width = glow.height = 64;
  const gc = glow.getContext('2d')!, grd = gc.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,246,211,1)'); grd.addColorStop(.12, 'rgba(255,216,151,.9)'); grd.addColorStop(.4, 'rgba(255,167,62,.22)'); grd.addColorStop(1, 'rgba(255,140,33,0)');
  gc.fillStyle = grd; gc.fillRect(0, 0, 64, 64); glowTexture = new THREE.CanvasTexture(glow);
  const mist = document.createElement('canvas'); mist.width = 128; mist.height = 256;
  const mc = mist.getContext('2d')!, mg = mc.createRadialGradient(64, 128, 3, 64, 128, 128);
  mg.addColorStop(0, 'rgba(255,255,255,.5)'); mg.addColorStop(.5, 'rgba(255,255,255,.16)'); mg.addColorStop(1, 'rgba(255,255,255,0)');
  mc.fillStyle = mg; mc.fillRect(0, 0, 128, 256); mistTexture = new THREE.CanvasTexture(mist);
  // A quiet mineral surface lets the architecture carry the detail. Individual
  // columns should not have a miniature brick wall repeated around their shafts.
  const stone = document.createElement('canvas'); stone.width = stone.height = 256;
  const sc = stone.getContext('2d')!, pixels = sc.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const grain = (n - Math.floor(n) - .5) * 11;
    const vein = Math.sin(x * .037 + Math.sin(y * .029) * 1.3) * 4 + Math.cos(y * .053 + Math.sin(x * .013) * 2) * 3;
    const value = 201 + grain + vein, i = (y * 256 + x) * 4;
    pixels.data[i] = value + 3; pixels.data[i + 1] = value + 2; pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
  }
  sc.putImageData(pixels, 0, 0); ashlarTexture = new THREE.CanvasTexture(stone);
  ashlarTexture.colorSpace = THREE.SRGBColorSpace; ashlarTexture.wrapS = ashlarTexture.wrapT = THREE.RepeatWrapping; ashlarTexture.anisotropy = 4;
  const shaft = document.createElement('canvas'); shaft.width = 64; shaft.height = 256;
  const sx = shaft.getContext('2d')!, rays = sx.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const t = y / 255, breadth = .09 + t * .56, lateral = (x / 63 - .5) * 2;
    const a = Math.exp(-Math.pow(lateral / breadth, 2) * 2) * Math.pow(Math.sin(t * Math.PI), .6) * (1 - t * .45);
    const i = (y * 64 + x) * 4; rays.data[i] = rays.data[i + 1] = rays.data[i + 2] = 255; rays.data[i + 3] = a * 110;
  }
  sx.putImageData(rays, 0, 0); shaftTexture = new THREE.CanvasTexture(shaft);
  const paint = document.createElement('canvas'); paint.width = paint.height = 256;
  const pc = paint.getContext('2d')!, paintPixels = pc.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const grain = organic(x, y) * 3.3;
    const weather = Math.pow(Math.max(0, Math.sin(x * .078 + Math.sin(y * .014) * .55)), 12) * (4 + Math.sin(y * .032) * 4);
    const value = 246 - grain - weather - (Math.sin(x * .019 + y * .03) + 1) * 2.2;
    const i = (y * 256 + x) * 4; paintPixels.data[i] = value; paintPixels.data[i + 1] = value; paintPixels.data[i + 2] = value - 2; paintPixels.data[i + 3] = 255;
  }
  pc.putImageData(paintPixels, 0, 0); paintTexture = new THREE.CanvasTexture(paint); paintTexture.colorSpace = THREE.SRGBColorSpace; paintTexture.wrapS = paintTexture.wrapT = THREE.RepeatWrapping;
}

class Builder {
  group = new THREE.Group(); colliders: Collider[] = []; animated: Animated[] = []; lights: THREE.Light[] = [];
  private clearedFieldTrees = new Set<Collider>();
  batches = new Map<string, Batch>();
  rnd: () => number;
  w: number; d: number; x: number; z: number;
  mat: Mats;
  constructor(public room: RoomDef, materials: Mats, public flags: Record<string, boolean>) {
    this.w = room.size[0]; this.d = room.size[1]; this.x = this.w / 2; this.z = this.d / 2;
    let seed = [...room.id].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261);
    this.rnd = () => { seed = Math.imul(seed ^ seed >>> 15, seed | 1); seed ^= seed + Math.imul(seed ^ seed >>> 7, seed | 61); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; };
    this.mat = { ...materials,
      limestone: color('#9b9988'), charcoal: color('#242b2a'), brick: color('#766050'), bone: color('#b9ad89'),
      brass: color('#998254', .34, .75), rust: color('#754936', .87, .4), sand: color('#a79b79'),
      darkWood: color('#30271e'), bark: color('#514b3b'), cream: color('#c5c1a8'), red: color('#5b2821'),
      ivy: color('#344c29'), paleStone: color('#aba99c'), slate: color('#374549'),
    };
    for (const key of ['stone', 'floor', 'darkStone', 'moss', 'wood', 'metal', 'gold', 'plaster', 'roof', 'leaf', 'rock', 'water']) {
      if (!this.mat[key]) this.mat[key] = color(key === 'gold' ? '#a88843' : key === 'moss' ? '#3b5135' : '#626b62');
    }
    const tinted = (base: string, value: string) => { const material = this.mat[base].clone(); material.color.set(value); return material; };
    textures();
    const mineral = (value: string, roughness = .8, normal = .36) => {
      const material = this.mat.rock.clone(); material.color.set(value); material.roughness = roughness;
      // Large fissures and fine mineral grain remain visible on a single carved
      // piece; there are no miniature masonry courses wrapped around columns.
      if (material.map) { material.map = material.map.clone(); material.map.repeat.set(.75, 1.15); }
      if (material.normalMap) { material.normalMap = material.normalMap.clone(); material.normalMap.repeat.set(.75, 1.15); }
      if (material.roughnessMap) { material.roughnessMap = material.roughnessMap.clone(); material.roughnessMap.repeat.set(.75, 1.15); }
      material.normalScale.setScalar(normal); return material;
    };
    this.mat.limestone = mineral('#aab0a1', .86, .38); this.mat.paleStone = mineral('#bbb9a7', .78, .28);
    this.mat.ashlar = mineral('#77877d', .91, .44); this.mat.floorSlab = mineral('#78877c', .73, .32);
    this.mat.darkAshlar = mineral('#4b615b', .92, .48); this.mat.marble = mineral('#98a597', .46, .2);
    this.mat.saltStone = mineral('#a2a896', .97, .32); this.mat.mossStone = mineral('#647558', .98, .52);
    this.mat.charcoal = tinted('darkStone', '#29312f'); this.mat.slate = tinted('rock', '#435452');
    this.mat.brick = tinted('stone', '#94735e'); this.mat.darkWood = tinted('wood', '#443729');
    this.mat.bark = materials.bark ?? tinted('wood', '#5b5140');
    if (room.id === 'house_grounds') {
      const paint = this.mat.plaster.clone(); paint.map = paintTexture ?? null; paint.color.set('#dedfd1'); paint.roughness = .94;
      paint.normalMap = this.mat.wood.normalMap?.clone() ?? null; paint.roughnessMap = this.mat.wood.roughnessMap?.clone() ?? null; paint.normalScale.setScalar(.11);
      for (const texture of [paint.normalMap, paint.roughnessMap]) if (texture) { texture.rotation = Math.PI / 2; texture.repeat.set(.85, 2.3); }
      paint.onBeforeCompile = shader => {
        shader.vertexShader = 'varying vec3 vPaintPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec4 paintedPosition=vec4(transformed,1.);\n#ifdef USE_INSTANCING\npaintedPosition=instanceMatrix*paintedPosition;\n#endif\nvPaintPosition=(modelMatrix*paintedPosition).xyz;');
        shader.fragmentShader = 'varying vec3 vPaintPosition;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nfloat rainWear=(1.-smoothstep(.12,1.04,vPaintPosition.y))*(.42+.28*sin(vPaintPosition.x*2.3+vPaintPosition.z*1.8)+.14*sin(vPaintPosition.x*7.8-vPaintPosition.z*4.2));\ndiffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.68,.74,.64),max(0.,rainWear));');
      };
      paint.customProgramCacheKey = () => 'grounds-painted-siding-v1'; this.mat.plaster = paint;
    }
  }
  rand(a = 0, b = 1) { return a + this.rnd() * (b - a); }
  batch(geometry: THREE.BufferGeometry, material: THREE.Material, p: number[], s: number[], r: number[] = [0, 0, 0], shadow = true) {
    dummy.position.set(p[0], p[1], p[2]); dummy.scale.set(s[0], s[1], s[2]); dummy.rotation.set(r[0], r[1], r[2]); dummy.updateMatrix();
    const key = `${geometry.uuid}:${material.uuid}:${shadow}`;
    if (!this.batches.has(key)) this.batches.set(key, { geometry, material, matrices: [], shadow });
    this.batches.get(key)!.matrices.push(dummy.matrix.clone());
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, bevel = false, yaw = 0) {
    this.batch(bevel ? BLOCK : BOX, mat, [x, y, z], [w, h, d], [0, yaw, 0]);
  }
  rock(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat = this.mat.rock, visible = true) {
    const rotation = [this.rand(0, .5), this.rand(0, Math.PI), this.rand(0, .6)];
    if (visible) this.batch(ROCK, mat, [x, y, z], [sx, sy, sz], rotation);
  }
  cylinder(x: number, y: number, z: number, radius: number, height: number, mat: THREE.Material, tapered = false) {
    this.batch(tapered ? TAPER : CYLINDER, mat, [x, y, z], [radius, height, radius]);
  }
  beam(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, taper = false) {
    const delta = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(.5);
    dummy.position.copy(mid); dummy.scale.set(radius, delta.length(), radius); dummy.quaternion.setFromUnitVectors(UP, delta.normalize()); dummy.updateMatrix();
    const geometry = taper ? TAPER : CYLINDER, key = `${geometry.uuid}:${mat.uuid}:true`;
    if (!this.batches.has(key)) this.batches.set(key, { geometry, material: mat, matrices: [], shadow: true });
    this.batches.get(key)!.matrices.push(dummy.matrix.clone());
  }
  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, p: number[], rotation?: number[]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(p[0], p[1], p[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.receiveShadow = true; mesh.castShadow = true; this.group.add(mesh); return mesh;
  }
  collision(x: number, z: number, w: number, d: number) { this.colliders.push({ x, z, w, d }); }
  nearRoute(x: number, z: number, clearance = 2.2) {
    const points = [this.room.spawn, ...this.room.exits.map(e => e.position), ...this.room.objects.map(o => [o.position[0], o.position[2]])];
    if (Math.abs(x) < clearance || Math.abs(z) < clearance) return true;
    // Reciprocal arrivals are inside the threshold. Keep the entire approach
    // clear, including diagonal routes and doors away from the room's axes.
    for (const exit of this.room.exits) {
      const a = this.routeYaw(exit), dx = x - exit.position[0], dz = z - exit.position[1];
      const along = THREE.MathUtils.clamp(dx * Math.sin(a) + dz * Math.cos(a), 0, 6);
      if (Math.hypot(dx - Math.sin(a) * along, dz - Math.cos(a) * along) < Math.max(1.6, clearance)) return true;
    }
    for (const p of points) {
      const length = p[0] * p[0] + p[1] * p[1], t = length ? THREE.MathUtils.clamp((x * p[0] + z * p[1]) / length, 0, 1) : 0;
      if (Math.hypot(x - p[0] * t, z - p[1] * t) < clearance) return true;
      if (Math.hypot(x - p[0], z - p[1]) < clearance + .8) return true;
    }
    return false;
  }
  floorVoids() {
    if (this.room.id === 'living_room' && this.flags.trapdoor_open) return [{ x: 0, z: 0, w: 1.92, d: 1.32 }];
    if (this.room.kind === 'dome') return [{ x: -7, z: 1, w: 4.4, d: 5.5 }];
    if (this.room.id === 'falls') return [{ x: -11.5, z: 1.8, w: 25, d: 7.4 }];
    return [];
  }
  floorShape(w: number, d: number) {
    const shape = new THREE.Shape(); shape.moveTo(-w / 2, -d / 2); shape.lineTo(w / 2, -d / 2); shape.lineTo(w / 2, d / 2); shape.lineTo(-w / 2, d / 2); shape.closePath();
    for (const v of this.floorVoids()) {
      const hole = new THREE.Path(); hole.moveTo(v.x - v.w / 2, -v.z - v.d / 2); hole.lineTo(v.x - v.w / 2, -v.z + v.d / 2); hole.lineTo(v.x + v.w / 2, -v.z + v.d / 2); hole.lineTo(v.x + v.w / 2, -v.z - v.d / 2); hole.closePath(); shape.holes.push(hole);
    }
    const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 6, uv.getY(i) / 6);
    return geometry;
  }
  ground(mat = this.mat.floor, rough = false, y = -.06) {
    if (this.floorVoids().length) { this.mesh(this.floorShape(this.w + 8, this.d + 8), mat, [0, y, 0]); return; }
    const geometry = new THREE.PlaneGeometry(this.w + 8, this.d + 8, rough ? 46 : 1, rough ? 46 : 1);
    geometry.rotateX(-Math.PI / 2);
    if (rough) {
      const pos = geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, this.nearRoute(x, z, 3) ? -.03 : Math.sin(x * .7) * Math.cos(z * .6) * .14 + this.rand(-.08, .08));
      }
      geometry.computeVertexNormals();
    }
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * this.w / 6, uv.getY(i) * this.d / 6);
    this.mesh(geometry, mat, [0, y, 0]);
  }
  paving(w = this.w - 1, d = this.d - 1, mat = this.mat.stone) {
    if (mat === this.mat.stone) mat = this.mat.floorSlab;
    for (let z = -d / 2 + .7; z < d / 2; z += 1.42) for (let x = -w / 2 + .65; x < w / 2; x += 1.34) {
      if (this.floorVoids().some(v => Math.abs(x - v.x) < v.w / 2 + .8 && Math.abs(z - v.z) < v.d / 2 + .8)) continue;
      if (this.rnd() < .08) continue;
      this.box(x + (Math.floor(z / 1.42) % 2) * .2, -.024 + this.rand(-.008, .006), z, 1.27, .07, 1.34, mat, true);
    }
  }
  arch(x: number, z: number, width = 3.6, spring = 2.7, yaw = 0, mat = this.mat.stone, depth = .8) {
    const radius = width / 2, thickness = .42;
    const place = (lx: number, y: number, lz: number) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), y, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    for (const sign of [-1, 1]) {
      const p = place(sign * (radius + thickness / 2), spring / 2, 0);
      this.box(p[0], p[1], p[2], thickness, spring, depth, mat, true, yaw);
      for (const y of [.2, spring - .12]) { const q = place(sign * (radius + thickness / 2), y, 0); this.box(q[0], q[1], q[2], thickness + .2, .2, depth + .16, mat, true, yaw); }
      const footWidth = thickness + .2, footDepth = depth + .16;
      this.collision(p[0], p[2], Math.abs(Math.cos(yaw)) * footWidth + Math.abs(Math.sin(yaw)) * footDepth, Math.abs(Math.sin(yaw)) * footWidth + Math.abs(Math.cos(yaw)) * footDepth);
    }
    const segments = 13, segment = Math.PI / segments;
    const shape = new THREE.Shape();
    const seam = .035 / radius, start = seam, end = segment - seam;
    shape.moveTo(Math.cos(start) * radius, Math.sin(start) * radius);
    shape.absarc(0, 0, radius, start, end, false);
    shape.lineTo(Math.cos(end) * (radius + thickness), Math.sin(end) * (radius + thickness));
    shape.absarc(0, 0, radius + thickness, end, start, true); shape.closePath();
    const wedge = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .025, bevelSize: .025, bevelSegments: 1, steps: 1, curveSegments: 3 });
    wedge.translate(0, 0, -depth / 2);
    for (let i = 0; i < segments; i++) {
      dummy.position.set(x, spring, z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, yaw, 0); dummy.rotateZ(i * segment); dummy.updateMatrix();
      const key = `${wedge.uuid}:${mat.uuid}:true`;
      if (!this.batches.has(key)) this.batches.set(key, { geometry: wedge, material: mat, matrices: [], shadow: true });
      this.batches.get(key)!.matrices.push(dummy.matrix.clone());
    }
    const top = place(0, spring + radius + .03, -.02);
    this.box(top[0], top[1], top[2], .52, .62, depth + .12, this.mat.darkStone, true, yaw);
  }
  wallExits() {
    // Object-mediated routes have their own aperture, never a second wall door.
    return this.room.exits.filter(exit => !exit.via && !['grating', 'window', 'hatch', 'rope'].includes(exit.role ?? '') && (this.room.id !== 'maze' || exit.to !== 'forest'));
  }
  routeYaw(exit: ExitDef) {
    if (exit.yaw !== undefined) return exit.yaw;
    const [x, z] = exit.position;
    return Math.abs(x / this.x) > Math.abs(z / this.z) ? x > 0 ? -Math.PI / 2 : Math.PI / 2 : z > 0 ? Math.PI : 0;
  }
  routePoint(exit: ExitDef, across: number, y: number, outward: number): [number, number, number] {
    const a = this.routeYaw(exit), [x, z] = exit.position;
    return [x + Math.cos(a) * across - Math.sin(a) * outward, y, z - Math.sin(a) * across - Math.cos(a) * outward];
  }
  routeBox(exit: ExitDef, across: number, y: number, outward: number, width: number, height: number, depth: number, mat: THREE.Material, bevel = false) {
    const p = this.routePoint(exit, across, y, outward); this.box(...p, width, height, depth, mat, bevel, this.routeYaw(exit));
  }
  routeCollision(exit: ExitDef, across: number, outward: number, width: number, depth: number) {
    const p = this.routePoint(exit, across, 0, outward), a = this.routeYaw(exit);
    this.collision(p[0], p[2], Math.abs(Math.cos(a)) * width + Math.abs(Math.sin(a)) * depth, Math.abs(Math.sin(a)) * width + Math.abs(Math.cos(a)) * depth);
  }
  cliffOpening(x: number, z: number) {
    return this.wallExits().some(exit => {
      const a = this.routeYaw(exit), dx = x - exit.position[0], dz = z - exit.position[1];
      const across = dx * Math.cos(a) - dz * Math.sin(a), depth = -dx * Math.sin(a) - dz * Math.cos(a);
      const halfWidth = exit.role === 'water' || exit.role === 'landing' ? 4.4 : 2.3;
      // Reserve the route's full width plus the largest cliff-rock radius.
      return Math.abs(across) < halfWidth + 2.8 && depth > -4.5 && depth < 5.5;
    });
  }
  waterPassage(exit: ExitDef) {
    const a = this.routeYaw(exit), blocked = !!exit.requires && !this.flags[exit.requires];
    const center = this.routePoint(exit, 0, .004, 4.5);
    const water = this.water(center[0], center[2], 8.6, 15, .004, '#286771'); water.rotation.y = a;
    water.name = `route:${exit.id}:water`;
    // Cliff banks and a small mooring berth identify water transport immediately.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        if (side > 0 && i >= 3) continue; // The continuing channel bends behind this bank.
        const p = this.routePoint(exit, side * (4.5 + i * .1), 1.1 + i % 2 * .35, i * 2.3 - 1);
        this.rock(p[0], p[1], p[2], 1.35, 2.3 + i % 3 * .35, 1.8, this.mat.paleStone);
      }
      const p = this.routePoint(exit, side * 2.15, .55, -1.25);
      this.cylinder(p[0], p[1], p[2], .13, 1.12, this.mat.darkWood);
      this.cylinder(p[0], .96, p[2], .16, .075, this.mat.brass);
      for (let k = 0; k < 4; k++) this.mesh(new THREE.TorusGeometry(.145, .018, 5, 20), this.mat.wood, [p[0], .51 + k * .045, p[2]], [Math.PI / 2, 0, 0]);
    }
    const bendCenter = this.routePoint(exit, 4.5, .004, 10);
    const bend = this.water(bendCenter[0], bendCenter[2], 18, 8, .004, '#286771'); bend.rotation.y = a; bend.name = `route:${exit.id}:river-bend`;
    // A cliff bend hides the generic distant landscape at the water's end.
    // The river visibly continues sideways between its white banks.
    for (let i = 0; i < 9; i++) {
      const p = this.routePoint(exit, -5.5 + i * 1.75, 3.5 + i % 2 * .35, 14.8);
      this.rock(p[0], p[1], p[2], 1.95, 4.3 + i % 3 * .35, 1.7, this.mat.paleStone);
    }
    for (let i = 0; i < 4; i++) {
      const p = this.routePoint(exit, 14.1, 2.5, 5.4 + i * 2.5);
      this.rock(p[0], p[1], p[2], 1.6, 3.6, 1.9, this.mat.paleStone);
    }
    const haze = this.routePoint(exit, 2.8, 1.1, 9); this.mist(haze[0], haze[1], haze[2], 13, '#abc7c6', .14);
    for (let i = 0; i < 8; i++) this.routeBox(exit, 0, .026, -2.4 + i * .27, 4.5, .075, .24, this.mat.wood);
    const rippleMaterial = new THREE.MeshBasicMaterial({ color: '#b9e0df', transparent: true, opacity: .16, depthWrite: false });
    for (let i = 0; i < 15; i++) {
      const p = this.routePoint(exit, Math.sin(i * 2.3) * 3, .04, i * .83 + .7);
      const ripple = this.mesh(new THREE.PlaneGeometry(.05, .65 + i % 3 * .3), rippleMaterial, p, [-Math.PI / 2, 0, a]);
      ripple.castShadow = false;
    }
    if (exit.role === 'landing' && !blocked) {
      for (let i = 0; i < 8; i++) this.routeBox(exit, 0, .035, i * .33 - .2, 3.3, .08, .3, this.mat.wood);
    }
  }
  passageReveal(exit: ExitDef) {
    for (const side of [-1, 1]) {
      this.routeBox(exit, side * 2.28, 2.6, 2.25, .56, 5.2, 4.8, this.mat.darkAshlar, true);
      for (let i = 0; i < 4; i++) this.routeBox(exit, side * 2.04, .56 + i * 1.08, 2.2, .12, .08, 4.7, this.mat.ashlar);
    }
    this.routeBox(exit, 0, 5.25, 2.2, 4.5, .36, 4.8, this.mat.darkAshlar);
    this.routeBox(exit, 0, -.025, 2.15, 4.1, .09, 4.8, this.mat.floorSlab);
    if (exit.role === 'stairs') for (let i = 0; i < 8; i++) this.routeBox(exit, 0, .08 + i * .16, .05 + i * .33, 3.65, .16, .33, this.mat.ashlar, true);
  }
  exits(style: 'stone' | 'timber' = 'stone') {
    for (const e of this.wallExits()) {
      if (this.room.id === 'behind_house' && e.to === 'kitchen' || this.room.id === 'living_room' && e.to === 'cellar') continue;
      const [x, z] = e.position, yaw = this.routeYaw(e);
      if (e.role === 'water' || e.role === 'landing') { this.waterPassage(e); continue; }
      if (e.role === 'rainbow') continue;
      if (e.role === 'trail') {
        this.routeBox(e, 0, -.017, 2, 3.8, .06, 6, this.mat.moss);
        continue;
      }
      if (style === 'stone') this.arch(x, z, 3.8, 2.65, yaw, this.mat.stone);
      else {
        for (const s of [-1, 1]) this.box(x + Math.cos(yaw) * s * 2, 1.95, z - Math.sin(yaw) * s * 2, .35, 3.9, .45, this.mat.wood, true, yaw);
        this.box(x, 3.9, z, 4.6, .45, .5, this.mat.wood, true, yaw);
      }
      if (style === 'stone') this.passageReveal(e);
      const glow = new THREE.PointLight('#8da8ae', 6, 8, 2); glow.position.set(x, 2.9, z); this.lights.push(glow); this.group.add(glow);
    }
  }
  routeBarriers() {
    for (const exit of this.room.exits) {
      if (exit.role === 'mirror' && exit.via && exit.requires && this.flags[exit.requires]) {
        const object = this.room.objects.find(object => object.id === exit.via);
        if (object) {
          const outline = [[-.52, 0], [.52, 0], [.52, 1.62], [.44, 1.86], [.26, 2.07], [0, 2.16], [-.26, 2.07], [-.44, 1.86], [-.52, 1.62]];
          const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x * .87, y * .935 + .177)));
          const material = createWaterMaterial('#7ca6b8'); material.emissive.set('#4b8eaf'); material.emissiveIntensity = .45; material.opacity = .78;
          const a = object.yaw ?? 0;
          const surface = this.mesh(new THREE.ShapeGeometry(shape, 24), material, [object.position[0] + Math.sin(a) * .09, object.position[1], object.position[2] + Math.cos(a) * .09], [0, a, 0]);
          surface.name = `route:${exit.id}:awakened-mirror`; surface.castShadow = false;
          this.animated.push({ object: surface, kind: 'water' });
        }
      }
      const barrier = exit.barrier;
      if (!barrier || !exit.requires || exit.via || ['creature', 'drop'].includes(barrier)) continue;
      const blocked = !this.flags[exit.requires], domestic = this.room.kind === 'house';
      const width = domestic ? 1.83 : 3.8, height = domestic ? 2.46 : 4.7;
      if (barrier === 'water') {
        if (blocked) {
          this.routeCollision(exit, 0, .24, width + .2, .6);
          if (this.room.id !== 'dam' && exit.role !== 'water' && exit.role !== 'landing') {
            const p = this.routePoint(exit, 0, .02, 2.8), water = this.water(p[0], p[2], width + 2.2, 6, .02, '#255e68'); water.rotation.y = this.routeYaw(exit);
            this.routeBox(exit, 0, .02, -.65, width + .8, .1, .22, this.mat.mossStone, true);
          }
        }
        continue;
      }
      if (blocked) this.routeCollision(exit, 0, .16, width + .1, .68);
      if (barrier === 'sealed-wall') {
        if (blocked) {
          for (let row = 0; row < 6; row++) for (let col = 0; col < 3; col++) this.routeBox(exit, (col - 1) * 1.29, .43 + row * .84, .13, 1.27, .82, .54, row % 3 ? this.mat.ashlar : this.mat.saltStone, true);
          const ring = this.mesh(new THREE.TorusGeometry(.74, .036, 8, 64), this.mat.brass, this.routePoint(exit, 0, 2.5, -.18), [0, this.routeYaw(exit), 0]); ring.name = `route:${exit.id}:sealed`;
        } else {
          const p = this.routePoint(exit, 0, 2.4, .45); this.mist(p[0], p[1], p[2], 3.5, '#a9d5df', .12);
          for (const side of [-1, 1]) this.routeBox(exit, side * 1.92, 2.45, -.06, .045, 4.75, .04, this.mat.brass);
        }
      } else if (barrier === 'nailed-door') {
        if (blocked) {
          const count = domestic ? 6 : 9;
          for (let i = 0; i < count; i++) this.routeBox(exit, -width / 2 + (i + .5) * width / count, height / 2, .11, width / count - .012, height, .17, i % 3 ? this.mat.wood : this.mat.darkWood, true);
          for (const y of [height * .28, height * .72]) this.routeBox(exit, 0, y, -.055, width + .16, .21, .12, this.mat.darkWood, true);
          for (const side of [-1, 1]) for (const y of [height * .28, height * .72]) {
            const p = this.routePoint(exit, side * width * .36, y, -.13); this.rock(p[0], p[1], p[2], .035, .035, .035, this.mat.metal);
          }
        } else {
          for (const side of [-1, 1]) {
            this.routeBox(exit, side * (width / 2 + .16), .45, .04, .17, .9, .2, this.mat.darkWood, true);
            for (let i = 0; i < 4; i++) { const p = this.routePoint(exit, side * (width / 2 + .24 + i * .12), .045, -.25 - i * .17); this.box(p[0], p[1], p[2], .14, .055, .35 + i * .09, this.mat.wood, false, this.routeYaw(exit) + side * i * .23); }
          }
        }
      } else if (barrier === 'gate') {
        const base = blocked ? 0 : height + .32;
        for (let i = 0; i < 13; i++) this.routeBox(exit, -width / 2 + i * width / 12, base + height / 2, .13, .065, height, .09, this.mat.metal, true);
        for (const y of [.22, height * .52, height - .15]) this.routeBox(exit, 0, base + y, .13, width + .18, .13, .16, this.mat.rust, true);
        for (const side of [-1, 1]) this.routeBox(exit, side * (width / 2 + .13), height, .14, .18, height * 2 + .7, .22, this.mat.rust, true);
      } else if (barrier === 'rubble') {
        if (blocked) {
          for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
            const p = this.routePoint(exit, (col - 1.5) * 1.02 + Math.sin(row + col) * .17, .45 + row * .82, .14);
            this.rock(p[0], p[1], p[2], .68, .62, .72, (row + col) % 3 ? this.mat.rock : this.mat.darkAshlar);
          }
        } else for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
          const p = this.routePoint(exit, side * (2.3 + i % 3 * .23), .12, -.8 + Math.floor(i / 3) * .4);
          this.rock(p[0], p[1], p[2], .2 + i % 2 * .13, .18, .24, this.mat.rock);
        }
      }
    }
  }
  walls(height = 7, mat = this.mat.stone) {
    const smooth = mat === this.mat.plaster;
    if (mat === this.mat.stone) mat = this.mat.ashlar;
    else if (mat === this.mat.darkStone) mat = this.mat.darkAshlar;
    const sides = [ { axis: 'x', fixed: -this.z, half: this.x }, { axis: 'x', fixed: this.z, half: this.x }, { axis: 'z', fixed: -this.x, half: this.z }, { axis: 'z', fixed: this.x, half: this.z } ];
    for (const side of sides) {
      const opening = this.wallExits().filter(e => side.axis === 'x' ? Math.abs(e.position[1] - side.fixed) < 3.5 : Math.abs(e.position[0] - side.fixed) < 3.5).map(e => side.axis === 'x' ? e.position[0] : e.position[1]);
      for (let y = .52; y < height; y += 1.04) {
        for (let p = -side.half - .4; p < side.half; p += 1.7) {
          const at = p + (Math.round(y) % 2 ? .35 : 0);
          if (y < 5.2 && opening.some(o => Math.abs(o - at) < 2.55)) continue;
          const x = side.axis === 'x' ? at : side.fixed, z = side.axis === 'x' ? side.fixed : at;
          this.box(x, y, z, side.axis === 'x' ? smooth ? 1.78 : 1.66 : .82, smooth ? 1.1 : 1.01, side.axis === 'x' ? .82 : smooth ? 1.78 : 1.66, !smooth && this.rnd() < .045 ? this.mat.darkAshlar : mat, !smooth);
        }
      }
      for (const h of [.24, height - .24, height - .65]) this.box(side.axis === 'x' ? 0 : side.fixed, h, side.axis === 'x' ? side.fixed : 0, side.axis === 'x' ? this.w + 1 : 1.08, .18, side.axis === 'x' ? 1.08 : this.d + 1, mat, true);
    }
    this.exits();
  }
  column(x: number, z: number, height = 7, radius = .43, mat = this.mat.stone) {
    if (this.nearRoute(x, z, radius + .7)) return;
    if (mat === this.mat.stone) mat = this.mat.limestone;
    if (mat === this.mat.darkStone) mat = this.mat.darkAshlar;
    if (mat === this.mat.moss) mat = this.mat.ashlar;
    this.box(x, .15, z, radius * 3, .3, radius * 3, mat, true);
    this.box(x, .4, z, radius * 2.5, .2, radius * 2.5, mat, true);
    this.cylinder(x, height / 2, z, radius, height - .8, mat);
    for (const y of [.6, height - .6, height - .4]) this.cylinder(x, y, z, radius * 1.25, .16, mat);
    this.box(x, height - .13, z, radius * 3.1, .3, radius * 3.1, mat, true);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; this.cylinder(x + Math.cos(a) * radius * .92, height / 2, z + Math.sin(a) * radius * .92, radius * .11, height - 1.5, mat); }
    if (this.room.kind !== 'house') {
      // Damp plinths and mineral deposits connect the carved stone to the floor.
      this.cylinder(x, .63, z, radius * 1.018, .24, this.mat.mossStone);
      for (let i = 0; i < 7; i++) {
        const a = i * 2.399 + this.rand(-.2, .2), w = this.rand(.045, .11), h = this.rand(.12, .58);
        this.batch(BLOCK, i % 3 ? this.mat.mossStone : this.mat.saltStone, [x + Math.cos(a) * radius * 1.027, .72 + h / 2, z + Math.sin(a) * radius * 1.027], [w, h, .012], [0, Math.PI / 2 - a, this.rand(-.04, .04)]);
      }
    }
    if (!this.nearRoute(x, z, 1.1)) this.collision(x, z, radius * 2.4, radius * 2.4);
  }
  torch(x: number, y: number, z: number, tint = '#ffb45f', power = 21) {
    this.cylinder(x, y - .53, z, .065, .75, this.mat.darkWood);
    this.cylinder(x, y - .2, z, .17, .24, this.mat.metal);
    if (this.room.dark) {
      this.cylinder(x, y - .09, z, .13, .08, this.mat.charcoal);
      return;
    }
    const flame = this.mesh(CONE, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: .9 }), [x, y + .1, z]); flame.scale.set(.16, .52, .16);
    this.animated.push({ object: flame, kind: 'flame', baseY: y + .1 });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: tint, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .7 }));
    sprite.position.set(x, y + .16, z); sprite.scale.set(1.35, 1.8, 1); this.group.add(sprite);
    const light = new THREE.PointLight(tint, power, 13, 2); light.position.set(x, y + .35, z); this.group.add(light); this.lights.push(light);
  }
  candles(x: number, z: number, n = 7) {
    for (let i = 0; i < n; i++) {
      const px = x + this.rand(-.75, .75), pz = z + this.rand(-.5, .5), h = this.rand(.16, .65);
      this.cylinder(px, h / 2, pz, .045, h, this.mat.cream);
      const flame = this.mesh(CONE, new THREE.MeshBasicMaterial({ color: '#ffe3a0' }), [px, h + .055, pz]); flame.scale.set(.025, .11, .025);
    }
    const light = new THREE.PointLight('#ffbc70', 7, 7, 2); light.position.set(x, .8, z); this.group.add(light); this.lights.push(light);
  }
  mist(x: number, y: number, z: number, size = 8, tint = '#bfd2ca', opacity = .13) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTexture, color: tint, transparent: true, opacity, depthWrite: false }));
    sprite.position.set(x, y, z); sprite.scale.set(size * 2, size, 1); this.group.add(sprite); this.animated.push({ object: sprite, kind: 'mist', baseY: y });
  }
  shaft(x: number, z: number, height = 15, tint = '#c9e0c4', radius = 2) {
    const mat = new THREE.MeshBasicMaterial({ map: shaftTexture, color: tint, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      const mesh = this.mesh(PLANE, mat, [x, height / 2, z]); mesh.scale.set(radius * 3.5, height, 1); mesh.rotation.y = angle; mesh.castShadow = false;
    }
  }
  water(x = 0, z = 0, w = this.w, d = this.d, y = -.13, tint = '#284b4e') {
    const mat = createWaterMaterial(tint);
    const geo = new THREE.PlaneGeometry(w, d, 28, 28); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.sin(pos.getX(i) * 2.1) * Math.cos(pos.getZ(i) * 1.4) * .018);
    geo.computeVertexNormals();
    const mesh = this.mesh(geo, mat, [x, y, z]); mesh.castShadow = false; this.animated.push({ object: mesh, kind: 'water', baseY: y });
    const sheen = new THREE.MeshBasicMaterial({ color: '#a4c7ba', transparent: true, opacity: .2, depthWrite: false });
    for (let i = 0; i < 22; i++) {
      const xx = x + this.rand(-w / 2, w / 2), zz = z + this.rand(-d / 2, d / 2);
      this.batch(PLANE, sheen, [xx, y + .035, zz], [this.rand(.3, 1.8), .016, 1], [-Math.PI / 2, 0, this.rand(-.18, .18)], false);
    }
    return mesh;
  }
  rubble(count = 70, mat = this.mat.rock) {
    for (let i = 0; i < count; i++) {
      const x = this.rand(-this.x + .8, this.x - .8), z = this.rand(-this.z + .8, this.z - .8);
      if (this.nearRoute(x, z, 1.8)) continue;
      const s = this.rand(.08, .36); this.rock(x, s * .36, z, s * 1.4, s * .6, s, mat);
    }
  }
  cavern(height = 11, mat = this.mat.rock, roof = true) {
    const wet = ['reservoir', 'river', 'falls', 'rainbow', 'underworld'].includes(this.room.kind);
    this.ground(wet ? this.mat.floorSlab : this.mat.darkStone, true, wet ? -.24 : -.06);
    const count = Math.round((this.w + this.d) / 1.5);
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2;
      const x = Math.cos(a) * (this.x + .8), z = Math.sin(a) * (this.z + .8);
      if (this.cliffOpening(x, z)) continue;
      for (let j = 0; j < 3; j++) this.rock(x + this.rand(-.5, .5), height * (j + .3) / 3, z + this.rand(-.5, .5), this.rand(1.4, 2.6), height * this.rand(.22, .35), this.rand(1.4, 2.5), mat);
      const s = this.rand(.15, .48), h = this.rand(1.5, 4.5);
      if (roof) this.batch(CONE, mat, [x * .85, height - h / 2, z * .85], [s, h, s], [Math.PI, 0, 0]);
    }
    if (roof) this.box(0, height + 1.1, 0, this.w + 10, 2.4, this.d + 10, this.mat.charcoal);
    this.exits(); this.rubble();
  }
  fern(x: number, z: number, s = 1, baseY = 0, visible = true) {
    for (let i = 0; i < 7; i++) {
      const a = i * Math.PI * 2 / 7, len = s * this.rand(.6, 1.05);
      if (!visible) continue;
      const base = new THREE.Vector3(x, baseY + .08, z), tip = new THREE.Vector3(x + Math.cos(a) * len, baseY + .35 * s, z + Math.sin(a) * len);
      this.beam(base, tip, .009 * s, this.mat.ivy);
      for (let j = 1; j < 7; j++) for (const sign of [-1, 1]) {
        const t = j / 8, l = Math.sin(t * Math.PI) * .23 * s;
        const px = x + Math.cos(a) * len * t, pz = z + Math.sin(a) * len * t;
        this.batch(SMALLROCK, this.mat.leaf, [px + Math.cos(a + sign * .9) * l * .55, baseY + .08 + t * .28 * s, pz + Math.sin(a + sign * .9) * l * .55], [l, .018, .045 * s], [0, -a - sign * .9, .08]);
      }
    }
  }
  tree(x: number, z: number, h: number, foliage: THREE.Material, scale = 1) {
    if (Math.abs(x) < this.x && Math.abs(z) < this.z && this.nearRoute(x, z, 2)) return;
    const r = h * .035 * scale, bend = this.rand(-.7, .7);
    const natural = this.room.id === 'house_grounds';
    // Generate every original random sample even for trees cleared from the
    // field; later trees, scenery and saved walking routes must not shift.
    const standing = !natural || !inHouseField(x, z) && !inHouseGorge(x, z);
    const shape = organic(x, z, 17), leanAngle = organic(x, z, 9) * Math.PI * 2;
    const lean = h * (.018 + organic(x, z, 7) * .064), branchCount = 4 + Math.floor(organic(x, z, 23) * 3);
    const trunkAt = (t: number) => new THREE.Vector3(x + Math.cos(leanAngle) * lean * t * t + Math.sin(t * Math.PI) * bend * .44, h * t, z + Math.sin(leanAngle) * lean * t * t);
    if (natural && standing) {
      for (let section = 0; section < 4; section++) {
        const a = section * .235, b = (section + 1) * .235;
        this.beam(trunkAt(a), trunkAt(b + .015), r * (1 - a * .79), this.mat.bark, true);
      }
    } else if (!natural) this.beam(new THREE.Vector3(x, -.1, z), new THREE.Vector3(x + bend, h * .8, z + bend * .4), r, this.mat.bark, true);
    for (let j = 0; j < 7; j++) {
      const a = j * 2.4 + this.rand(-.2, .2), y = h * this.rand(.5, .85), length = h * this.rand(.18, .33);
      let end = new THREE.Vector3(x + Math.cos(a) * length, y + length * .55, z + Math.sin(a) * length);
      let start = new THREE.Vector3(x + bend * .6, y, z);
      const enabled = standing && (!natural || j < branchCount), angle = a + organic(x + j, z, 11) * 2.7;
      if (natural) {
        const low = .33 + organic(x + j, z, 16) * .43;
        start = trunkAt(low);
        const spread = length * (.76 + shape * .7), rise = spread * (.32 + organic(x, z + j, 25) * .45);
        end = start.clone().add(new THREE.Vector3(Math.cos(angle) * spread, rise, Math.sin(angle) * spread));
        if (enabled) {
          const elbow = start.clone().lerp(end, .5); elbow.y -= rise * .18; elbow.x += Math.sin(angle) * spread * .1;
          this.beam(start, elbow, r * (.21 + organic(x + j, z, 26) * .12), this.mat.bark, true);
          this.beam(elbow, end, r * .15, this.mat.bark, true);
          for (let twig = 0; twig < 2; twig++) {
            const fork = elbow.clone().lerp(end, .3 + twig * .43), az = angle + (twig ? -.82 : .74);
            const tip = fork.clone().add(new THREE.Vector3(Math.cos(az) * spread * .4, spread * .25, Math.sin(az) * spread * .4));
            this.beam(fork, tip, r * .062, this.mat.bark, true);
          }
        }
      } else this.beam(start, end, r * .36, this.mat.bark, true);
      for (let k = 0; k < 7; k++) {
        const xx = end.x + this.rand(-1.8, 1.8), yy = end.y + this.rand(-.3, 1.3), zz = end.z + this.rand(-1.8, 1.8), ss = this.rand(2, 3.7);
        // Consume the same placement randomness as the old tree. All changes
        // below affect its visual shape only, not later trees or their colliders.
        const rx = this.rand(.2, 1.2), ry = this.rand(0, Math.PI * 2), rz = this.rand(-.5, .5);
        if (!enabled) continue;
        if (natural) {
          const spread = .95 + shape * .55, droop = k % 3 === 0 ? .65 : 0;
          this.batch(PLANE, foliage, [xx, yy - droop, zz], [ss * spread, ss * (.75 + organic(x + k, z + j, 14) * .39), 1], [rx * 1.25, ry + angle * .4, rz]);
          if (k < 2) {
            const near = start.clone().lerp(end, .63 + k * .22);
            this.batch(PLANE, foliage, [near.x, near.y + .45, near.z], [ss * .96, ss * .9, 1], [.18 + k * .8, angle + k * 1.3, rz * .6]);
          }
        } else this.batch(PLANE, foliage, [xx, yy, zz], [ss, ss, ss], [rx, ry, rz]);
      }
    }
    for (let j = 0; standing && j < 5; j++) {
      const a = j * 1.256 + (natural ? organic(x + j, z, 32) * .86 : 0);
      const reach = r * (natural ? 1.55 + organic(x, z + j, 37) * 1.6 : 3.6);
      this.beam(new THREE.Vector3(x + Math.cos(a) * reach, natural ? -.025 : .05, z + Math.sin(a) * reach), new THREE.Vector3(x, r * (natural ? .72 : 1.5), z), r * (natural ? .24 : .3), this.mat.bark, true);
    }
    if (!this.nearRoute(x, z, 1.1)) {
      this.collision(x, z, r * 2, r * 2);
      // Keep the old footprints only while sampling decorative ground cover;
      // they are removed before the completed world reaches the controller.
      if (!standing) this.clearedFieldTrees.add(this.colliders[this.colliders.length - 1]);
    }
  }
  forest(barrow = false) {
    this.ground(this.mat.moss, true);
    const path = this.mat.moss.clone(); path.color.set('#8c8369'); path.roughness = 1;
    if (path.map) { path.map = path.map.clone(); path.map.repeat.set(1.7, 1.2); }
    if (path.normalMap) { path.normalMap = path.normalMap.clone(); path.normalMap.repeat.set(1.7, 1.2); }
    for (let i = 0; i < 38; i++) {
      const z = -this.z + i / 37 * this.d, x = Math.sin(z * .15) * .35;
      this.batch(ROCK, path, [x, -.095, z], [2.2 + this.rand(0, .55), .045, .7], [0, this.rand(-.2, .2), 0], false);
    }
    const foliage = new THREE.MeshStandardMaterial({ map: leafTexture, alphaTest: .35, side: THREE.DoubleSide, roughness: .9, color: '#a7b993' });
    for (let i = 0; i < 58; i++) {
      let x = this.rand(-this.x - 9, this.x + 9), z = this.rand(-this.z - 9, this.z + 9);
      if ((Math.abs(x) < 7 && z < 2) || this.nearRoute(x, z, 3) || Math.hypot(x - this.room.spawn[0], z - this.room.spawn[1]) < 4) { x = (i % 2 ? 1 : -1) * this.rand(this.x * .75, this.x + 9); }
      this.tree(x, z, this.rand(10, 20), foliage);
    }
    for (let i = 0; i < 125; i++) {
      const x = this.rand(-this.x, this.x), z = this.rand(-this.z, this.z);
      if (this.nearRoute(x, z, 2.6) || Math.abs(x) < 7 && z < -this.z + 11) continue;
      if (i % 3 === 0) this.rock(x, .1, z, this.rand(.3, 1.2), this.rand(.2, .6), this.rand(.3, .9), i % 2 ? this.mat.moss : this.mat.rock);
      else this.fern(x, z, this.rand(.6, 1.3));
    }
    // Fallen tree and mossy roots frame the first view without obstructing it.
    const tx = -this.x * .69, tz = this.z * .14;
    this.beam(new THREE.Vector3(tx - 2, .4, tz - 2.8), new THREE.Vector3(tx + 2, .5, tz + 3), .32, this.mat.bark);
    for (let i = 0; i < 8; i++) this.fern(tx + this.rand(-2.1, 2.1), tz + this.rand(-2.5, 2.5), .7);
    this.mist(-this.x * .4, .8, -this.z * .55, 10, '#b9c9b2', .13); this.mist(this.x * .5, 1.3, -this.z * .8, 12, '#aebfbd', .12);
    this.shaft(-3, 1, 20, '#eddfb3', 2.7); this.shaft(this.x * .4, -3, 22, '#e7ead1', 1.7);
    if (barrow) this.barrow();
    else if (this.room.id === 'forest') {
      // A single storm-twisted tree distinguishes the deep wood from the house.
      const x = -this.x * .53, z = -this.z * .5;
      this.tree(x, z, 25, foliage, 2.1);
      this.beam(new THREE.Vector3(x, 3.1, z), new THREE.Vector3(-3, 5.2, z + 3.1), .6, this.mat.bark, true);
      for (const s of [-1, 1]) this.rock(s * (this.x - 2), 1.4, -this.z + 4, 3.6, 3.8, 3, this.mat.moss);
      this.shaft(-4, -4, 24, '#e5e4ba', 3.7);
    } else this.whiteHouse();
    this.exits('timber');
  }
  houseExterior() {
    // West uses its original coordinates. The rear district is rotated by pi
    // around [0,-23.2]; the forest is rotated by pi/2 around [-36,0].
    const bounds = { minX: -57, maxX: 27, minZ: -39, maxZ: 22 };
    const trails = [
      [[0, 13], [0, 4], [-.6, -2.7], [0, -6.6]],
      [[-5, -4], [-2.5, -3.4], [0, -2.7]],
      [[0, -4.9], [5.9, -5.8], [8.9, -9.5], [8.9, -17.2], [6.5, -20.3], [0, -20.4]],
      [[-1.5, -4.5], [-6.9, -6.1], [-8.9, -10.5], [-8.9, -17.5], [-6, -20.6], [0, -20.4]],
      [[0, -17.8], [0, -22.5], [-.7, -28], [0, -33]],
      [[-3, -2.9], [-10.5, -1.3], [-18, 0], [-27, 0], [-36, 0], [-47, 0]],
      [[-25, 0], [-29, 5.5], [-31, 7], [-29, 13], [-28, 20]],
      [[-25, -.5], [-30, -7], [-36, -6], [-41, -7]],
      [[-36, 0], [-39, 4], [-41, 7]],
      [[-36, 0], [-36.5, -9], [-36, -20]],
    ];
    const barrowRoad = [[-5, 4], [-8, 10], [-10, 17]];
    // Reserve this clearance for a later reveal, but do not draw a road or
    // an inviting entrance before the ancient map has been found.
    const clearances = [...trails, barrowRoad];
    const pathDistance = (x: number, z: number) => {
      let nearest = Infinity;
      for (const path of clearances) for (let i = 0; i < path.length - 1; i++) {
        const [ax, az] = path[i], [bx, bz] = path[i + 1], dx = bx - ax, dz = bz - az;
        const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
      return nearest;
    };
    const houseYard = (x: number, z: number) => Math.abs(x) < 10.8 && z > -23.5 && z < -3.5;
    const rainbowExit = this.room.exits.find(exit => exit.role === 'rainbow');
    const beyondRainbowShore = (x: number, z: number, margin = 0) => {
      if (!rainbowExit) return false;
      const a = this.routeYaw(rainbowExit), dx = x - rainbowExit.position[0], dz = z - rainbowExit.position[1];
      const across = dx * Math.cos(a) - dz * Math.sin(a), outward = -dx * Math.sin(a) - dz * Math.cos(a);
      return Math.abs(across) < 3.9 + margin && outward > .65 - margin && outward < 27 + margin;
    };
    const clearRoute = (x: number, z: number, margin = 2.8) => houseYard(x, z) || pathDistance(x, z) < margin || this.nearRoute(x, z, margin) || Math.hypot(x, z - 13) < 4 || beyondRainbowShore(x, z, margin);
    // Insert exact shaft boundaries into the terrain grid, then leave those
    // cells open. A dark decal cannot substitute for a real descent aperture.
    const xs = [...Array.from({ length: 89 }, (_, i) => -67 + i * 104 / 88), -31.67, -30.33, HOUSE_GORGE.east, HOUSE_GORGE.east - HOUSE_GORGE.shoulder].sort((a, b) => a - b);
    const zs = [...Array.from({ length: 69 }, (_, i) => -49 + i * 81 / 68), 6.33, 7.67, HOUSE_GORGE.south, HOUSE_GORGE.south - HOUSE_GORGE.shoulder].sort((a, b) => a - b);
    const terrainVertices: number[] = [], terrainUVs: number[] = [], terrainIndices: number[] = [];
    for (const z of zs) for (const x of xs) { terrainVertices.push(x, 0, z); terrainUVs.push(x / 3.2, z / 3.2); }
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
      const mx = (xs[i] + xs[i + 1]) / 2, mz = (zs[j] + zs[j + 1]) / 2;
      if (Math.abs(mx + 31) < .67 && Math.abs(mz - 7) < .67) continue;
      const p = j * xs.length + i; terrainIndices.push(p, p + xs.length, p + 1, p + 1, p + xs.length, p + xs.length + 1);
    }
    const terrain = new THREE.BufferGeometry(); terrain.setAttribute('position', new THREE.Float32BufferAttribute(terrainVertices, 3)); terrain.setAttribute('uv', new THREE.Float32BufferAttribute(terrainUVs, 2)); terrain.setIndex(terrainIndices);
    const terrainPos = terrain.attributes.position, terrainUv = terrain.attributes.uv;
    const terrainHeight = (x: number, z: number) => inHouseGorge(x, z) ? -.085 - houseGorgeDepth(x, z) : clearRoute(x, z, 2.9) ? -.085 : -.06 + Math.sin(x * .24) * Math.cos(z * .31) * .12 + Math.cos(x * .52 + z * .28) * .045;
    const terrainColors: number[] = [], dampEarth = new THREE.Color('#819069'), dryEarth = new THREE.Color('#b4b89b');
    for (let i = 0; i < terrainPos.count; i++) {
      const x = terrainPos.getX(i), z = terrainPos.getZ(i);
      terrainPos.setY(i, terrainHeight(x, z)); terrainUv.setXY(i, x / 3.2, z / 3.2);
      const patch = .5 + Math.sin(x * .2 + z * .09) * .19 + Math.cos(z * .24 - x * .13) * .19;
      const shade = dampEarth.clone().lerp(dryEarth, THREE.MathUtils.clamp(patch + (x > -14 && z > -6 ? .18 : -.12), 0, 1));
      terrainColors.push(shade.r, shade.g, shade.b);
    }
    terrain.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3)); terrain.computeVertexNormals();
    const earth = this.mat.moss.clone(); earth.color.set('#adb393'); earth.vertexColors = true; earth.roughness = 1; earth.normalScale.setScalar(.44);
    for (const key of ['map', 'normalMap', 'roughnessMap'] as const) if (earth[key]) { earth[key] = earth[key]!.clone(); earth[key]!.repeat.set(1, 1); }
    this.mesh(terrain, earth, [0, 0, 0]).name = 'grounds:continuous-terrain';
    const path = this.mat.moss.clone(); path.color.set('#8d8468'); path.normalScale.setScalar(.32); path.roughness = 1;
    for (const key of ['map', 'normalMap', 'roughnessMap'] as const) if (path[key]) { path[key] = path[key]!.clone(); path[key]!.repeat.set(1, 1); }
    path.alphaTest = .035; path.alphaToCoverage = true;
    path.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float pathAcross; varying float vPathAcross; varying vec2 vPathGround;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPathAcross=pathAcross; vPathGround=position.xz;');
      shader.fragmentShader = 'varying float vPathAcross; varying vec2 vPathGround;\nfloat trailHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat trailNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(trailHash(i),trailHash(i+vec2(1.,0.)),f.x),mix(trailHash(i+vec2(0.,1.)),trailHash(i+1.),f.x),f.y);}\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\nfloat trailEdge=min(vPathAcross,1.-vPathAcross);\nfloat trailFringe=smoothstep(.015,.225,trailEdge+(trailNoise(vPathGround*1.9)-.5)*.13);\nfloat trailGrain=trailHash(floor(vPathGround*22.));\ndiffuseColor.a*=smoothstep(trailGrain*.94,trailGrain*.94+.12,trailFringe);\ndiffuseColor.rgb*=mix(vec3(.74,.87,.69),vec3(1.),trailFringe);');
    };
    path.customProgramCacheKey = () => 'grounds-natural-trail-v1';
    trails.forEach((points, i) => this.trailRibbon(points, i === 5 ? 3.3 : i < 5 ? 2.7 : 2.35, path));
    if (this.flags.barrow_path_open) this.trailRibbon(barrowRoad, 2.35, path);
    for (const side of [-1, 1]) {
      this.box(-31 + side * .75, -1.18, 7, .16, 2.45, 1.66, this.mat.darkAshlar);
      this.box(-31, -1.18, 7 + side * .75, 1.34, 2.45, .16, this.mat.darkAshlar);
      this.beam(new THREE.Vector3(-31.48, -.13, 7 + side * .4), new THREE.Vector3(-31.48, -2.3, 7 + side * .4), .042, this.mat.rust);
    }
    for (let y = -.23; y > -2.4; y -= .31) this.beam(new THREE.Vector3(-31.48, y, 6.58), new THREE.Vector3(-31.48, y, 7.42), .032, this.mat.metal);
    this.box(-31, -2.43, 7, 1.5, .08, 1.5, this.mat.charcoal);
    this.collision(-31, 7, 1.31, 1.31);

    // The single house owns all four walls, one roof and one solid footprint.
    this.whiteHouse(-13, 8, true);
    for (let z = -22.7; z < -17.7; z += .92) for (const side of [-1, 1]) this.box(side * .54, -.024, z, 1.025, .075, .865, this.mat.floorSlab, true, (Math.round(z) % 2) * .007);
    for (const side of [-1, 1]) {
      const x = side * 3.25, gardenZ = -18.65;
      this.box(x, .14, gardenZ, 2.55, .28, 1.12, this.mat.darkWood, true);
      this.box(x, .286, gardenZ, 2.35, .025, .94, this.mat.charcoal);
      for (let i = 0; i < 5; i++) this.fern(x - .94 + i * .46, gardenZ + Math.sin(i * 2) * .21, .54, .3);
      for (const edge of [-1, 1]) this.box(x + edge * 1.16, .2, gardenZ, .08, .44, 1.22, this.mat.wood, true);
      this.collision(x, gardenZ, 2.55, 1.12);
    }
    this.barrel(4.9, -18.05, .78);
    this.box(-4.7, .26, -17.75, 1.4, .13, .68, this.mat.wood, true);
    for (const x of [-5.23, -4.17]) this.box(x, .12, -17.75, .12, .24, .55, this.mat.darkWood);
    this.collision(-4.7, -17.75, 1.4, .68);
    const ivy = new THREE.MeshStandardMaterial({ map: leafTexture, alphaTest: .35, side: THREE.DoubleSide, color: '#a7b993', roughness: 1 });
    // Preserve the established tree/obstacle random sequence while replacing
    // the disconnected wall decals with rooted climbing stems below.
    for (let i = 0; i < 43; i++) {
      const x = this.rand(-5.7, 5.7), y = this.rand(.35, 4.3);
      if (Math.abs(x) < 1.5 && y < 2.8) continue;
      this.rand(.7, 1.3); this.rand(.8, 1.4); this.rand(-.8, .8);
    }
    const vineStem = color('#63583d', 1), vineRandom = decorationRandom(38241);
    const vines = [[-5.25, 2.65, .3], [-4.5, 2.3, -.14], [-3.88, 1.52, -.2], [-2.5, 1.1, .22], [4.75, 3.75, -.36], [3.91, 2.45, .28], [3, 1.25, .18]];
    for (const [index, [root, height, lean]] of vines.entries()) {
      const stem: THREE.Vector3[] = [];
      for (let j = 0; j < 12; j++) {
        const t = j / 11, x = root + t * lean + Math.sin(t * 5.3 + index) * .13 + Math.sin(t * 11) * .07;
        stem.push(new THREE.Vector3(x, .05 + t * height, -17.245 - t * .012));
        if (j) this.beam(stem[j - 1], stem[j], .013 - t * .005, vineStem);
        if (j > 0) {
          const width = .42 + (1 - t) * .17 + vineRandom() * .15;
          this.batch(PLANE, ivy, [x + (vineRandom() - .5) * .16, .07 + t * height, -17.29], [width, .43 + vineRandom() * .2, 1], [0, Math.PI, (vineRandom() - .5) * 2.2]);
          if (j < 7 && vineRandom() > .46) this.batch(PLANE, ivy, [x + (vineRandom() - .5) * .58, .09 + t * height, -17.305], [width * .9, .45, 1], [0, Math.PI, (vineRandom() - .5) * 2.4]);
        }
      }
      const shoots = height > 2.8 ? 2 : height > 2 ? 1 : 0;
      for (let branch = 0; branch < shoots; branch++) {
        const start = stem[3 + branch * 3], side = (branch + index) % 2 ? 1 : -1;
        const end = new THREE.Vector3(start.x + side * (.18 + vineRandom() * .18), start.y + .5 + vineRandom() * .3, -17.27);
        const middle = start.clone().lerp(end, .52); middle.x += side * .04;
        this.beam(start, middle, .009, vineStem); this.beam(middle, end, .006, vineStem);
        for (const t of [.35, .72, 1]) {
          const at = start.clone().lerp(end, t);
          this.batch(PLANE, ivy, [at.x, at.y, -17.31], [.36 + vineRandom() * .14, .42, 1], [0, Math.PI, (vineRandom() - .5) * 1.9]);
        }
      }
    }
    for (const side of [-1, 1]) for (let j = 0; j < 7; j++) this.box(side * 6.16, 1.95, -16.05 + j * .35, .045, 2.65, .047, this.mat.darkWood);
    for (const side of [-1, 1]) for (let j = 0; j < 7; j++) this.box(side * 6.17, .75 + j * .36, -15, .045, .045, 2.35, this.mat.darkWood);

    const foliage = new THREE.MeshStandardMaterial({ map: leafTexture, alphaTest: .35, side: THREE.DoubleSide, roughness: .94, color: '#a7b993' });
    const forestPoint = (x: number, z: number) => [-36 + z, -x];
    const hero = forestPoint(-11.13, -9.5);
    this.tree(hero[0], hero[1], 25, foliage, 2.1);
    this.beam(new THREE.Vector3(hero[0], 3.1, hero[1]), new THREE.Vector3(-42.4, 5.2, 3), .6, this.mat.bark, true);
    for (const side of [-1, 1]) {
      const [x, z] = forestPoint(side * 19, -15); this.rock(x, 1.4, z, 3.6, 3.8, 3, this.mat.moss);
    }
    const treeSites: number[][] = [];
    for (let i = 0; i < 130 && treeSites.length < 62; i++) {
      const x = this.rand(bounds.minX - 6, bounds.maxX + 6), z = this.rand(bounds.minZ - 5, bounds.maxZ + 5);
      if (clearRoute(x, z, 3.1) || Math.hypot(x - hero[0], z - hero[1]) < 5.5 || treeSites.some(p => Math.hypot(x - p[0], z - p[1]) < 3)) continue;
      treeSites.push([x, z]); this.tree(x, z, this.rand(11, 20), foliage);
    }
    // Edge trees continue the surrounding woods, rather than marking room doors.
    for (let i = 0; i < 28; i++) {
      const edge = i % 4, t = (Math.floor(i / 4) + .5) / 7;
      const x = edge < 2 ? edge === 0 ? bounds.minX - 2 : bounds.maxX + 2 : bounds.minX + t * 84;
      const z = edge < 2 ? bounds.minZ + t * 61 : edge === 2 ? bounds.minZ - 2 : bounds.maxZ + 2;
      if (!clearRoute(x, z, 2.8)) this.tree(x + this.rand(-.8, .8), z + this.rand(-.8, .8), this.rand(13, 21), foliage);
    }
    for (let i = 0; i < 225; i++) {
      const x = this.rand(bounds.minX, bounds.maxX), z = this.rand(bounds.minZ, bounds.maxZ);
      if (clearRoute(x, z, 2.05)) continue;
      if (i % 3 === 0) this.rock(x, .11, z, this.rand(.3, 1.1), this.rand(.2, .6), this.rand(.3, 1), i % 2 ? this.mat.moss : this.mat.rock, !inHouseGorge(x, z));
      else this.fern(x, z, this.rand(.55, 1.15) * (inHouseField(x, z) ? .5 : 1), 0, !inHouseGorge(x, z));
    }
    if (!this.flags.barrow_path_open) {
      this.beam(new THREE.Vector3(-13.7, .56, 16.7), new THREE.Vector3(-7.1, .73, 18.4), .35, this.mat.bark);
      this.collision(-10.4, 17.55, 6.8, 2.4);
      for (let i = 0; i < 26; i++) {
        const x = -14 + (i % 7) * 1.15, z = 16 + Math.floor(i / 7) * 1.05;
        this.fern(x, z, 1.3 + (i % 3) * .16);
        this.batch(PLANE, foliage, [x, .93 + (i % 3) * .22, z], [2.15, 2.35, 1], [0, i * 1.31, .12]);
      }
    }
    // A fallen beech frames the familiar first view; the route remains open.
    this.beam(new THREE.Vector3(-14, .4, 1.4), new THREE.Vector3(-10, .5, 7.2), .32, this.mat.bark);
    for (let i = 0; i < 8; i++) this.fern(-12 + this.rand(-2, 2), 4.3 + this.rand(-2.3, 2.3), .7);
    this.mist(-15, .85, -28, 12, '#b9c9b2', .11); this.mist(15, 1.05, -27, 13, '#aebfbd', .1); this.mist(-45, 1.0, -8, 14, '#afc1ad', .1);
    this.shaft(-3, 1, 20, '#eddfb3', 2.7); this.shaft(13, -13, 22, '#e7ead1', 1.8); this.shaft(-40, -2, 24, '#e5e4ba', 3.2);
    for (const exit of this.room.exits) {
      if (['west_house', 'behind_house', 'forest', 'kitchen', 'maze'].includes(exit.to) || exit.to === 'barrow' && !this.flags.barrow_path_open) continue;
      if (exit.role === 'rainbow') {
        const end = this.routePoint(exit, 0, 0, 23.35);
        this.rainbowSpan(exit.position, [end[0], end[2]], !!exit.requires && !!this.flags[exit.requires], false);
        this.routeBox(exit, 0, .035, -.25, 4.2, .11, 3, this.mat.paleStone, true);
        this.routeBox(exit, 0, .1, 1.05, 7.9, .18, .3, this.mat.saltStone, true);
        this.routeBox(exit, 0, -1.95, 1.2, 7.9, 4, .3, this.mat.darkAshlar);
        const channel = this.water(-88.325, -86.1, 123.35, 127.8, -HOUSE_GORGE.depth + .3, '#173e47');
        channel.name = 'route:forest:rainbow-gorge-water';
        this.routeCollision(exit, 0, 14, 7.8, 26);
        for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
          const p = this.routePoint(exit, side * 4.1, -.5, 1.8 + i * 2.8);
          // Preserve the old channel-bank samples without retaining a narrow
          // walkable-looking canal alongside the rainbow.
          this.rock(p[0], p[1], p[2], .64, 1.4 + i % 3 * .25, 1.6, this.mat.mossStone, false);
        }
        this.houseGorge(exit, foliage);
        continue;
      }
      const [x, z] = exit.position;
      // Low trail stones identify genuine distant routes, without gateways
      // interrupting the continuous house and woodland paths.
      for (const side of [-1, 1]) {
        this.box(x + side * 1.8, .46, z, .55, .92, .48, this.mat.darkAshlar, true, side * .07);
        this.box(x + side * 1.8, .8, z + .26, .31, .055, .045, this.mat.brass, true);
      }
    }
    this.group.userData.exteriorBounds = bounds;
    this.woodlandGroundCover(pathDistance, terrainHeight, bounds);
    this.colliders = this.colliders.filter(collider => !this.clearedFieldTrees.has(collider));
  }
  woodlandGroundCover(pathDistance: (x: number, z: number) => number, terrainHeight: (x: number, z: number) => number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    const random = decorationRandom(140927), grassMaterials = ['#bec5a7', '#939f7c', '#c7cbaa'].map(tint => new THREE.MeshStandardMaterial({ color: tint, vertexColors: true, side: THREE.DoubleSide, roughness: 1 }));
    const broadleaf = new THREE.MeshStandardMaterial({ map: leafTexture, alphaTest: .38, side: THREE.DoubleSide, roughness: 1, color: '#788c57' });
    const shadeleaf = broadleaf.clone(); shadeleaf.color.set('#657a4e');
    const fallen = [color('#6b6240'), color('#887846'), color('#53613d')];
    const sheltered = (x: number, z: number) => Math.abs(x) < 6.45 && z > -17.55 && z < -8.55 || Math.abs(x) < 3.55 && z > -9.15 && z < -6.2;
    const nearTarget = (x: number, z: number, margin = 1.05) => this.room.objects.some(object => Math.hypot(x - object.position[0], z - object.position[2]) < margin);
    const nearShaft = (x: number, z: number, margin: number) => Math.abs(x + 31) < margin && Math.abs(z - 7) < margin;
    // Short, curved blades fill the ground instead of adding another flat green
    // plane. They share three instanced draws and never introduce colliders.
    for (let gz = bounds.minZ - 3; gz < bounds.maxZ + 3; gz += .64) for (let gx = bounds.minX - 3; gx < bounds.maxX + 3; gx += .64) {
      const x = gx + random() * .57, z = gz + random() * .57, edge = pathDistance(x, z);
      if (sheltered(x, z) || nearTarget(x, z, 1.05) || nearShaft(x, z, 2.2) || edge < 1.06) continue;
      const inGarden = z < -17.1 && z > -19.55 && Math.abs(x) < 6.15;
      if (inGarden || this.colliders.some(c => Math.abs(x - c.x) < c.w / 2 + .1 && Math.abs(z - c.z) < c.d / 2 + .1)) continue;
      const lawn = x > -17 && z > -7.7, cluster = .54 + Math.sin(x * .37 + z * .1) * .22 + Math.cos(z * .43 - x * .16) * .19;
      if (random() > cluster + .22) continue;
      const fringe = THREE.MathUtils.smoothstep(edge, 1.06, 2.05);
      const height = (lawn ? .19 + random() * .21 : .25 + random() * .34) * (.35 + fringe * .65);
      const spread = .8 + random() * 1.6, bucket = Math.floor(random() * 3);
      const yaw = random() * Math.PI * 2;
      if (!inHouseGorge(x, z)) this.batch(GRASS, grassMaterials[bucket], [x, terrainHeight(x, z) - .04, z], [spread, height, spread], [0, yaw, 0], false);
    }
    // Ferns and broad leaves form islands under the canopy, leaving the actual
    // house circuit, targets, and paths legible at eye level.
    for (let i = 0; i < 540; i++) {
      const x = bounds.minX - 2 + random() * (bounds.maxX - bounds.minX + 4), z = bounds.minZ - 2 + random() * (bounds.maxZ - bounds.minZ + 4);
      const edge = pathDistance(x, z);
      if (edge < 2.25 || sheltered(x, z) || nearTarget(x, z, 2.1) || nearShaft(x, z, 2.6) || Math.abs(x) < 10.9 && z > -23.8 && z < -3.8) continue;
      const y = terrainHeight(x, z), lush = .7 + random() * .85, angle = random() * Math.PI * 2;
      const meadow = inHouseField(x, z), plantScale = meadow ? .32 : 1;
      if (i % 4 === 0) this.fern(x, z, lush * plantScale, y + .025, !inHouseGorge(x, z));
      else if (!inHouseGorge(x, z)) {
        const material = i % 3 ? broadleaf : shadeleaf;
        for (let face = 0; face < 3; face++) this.batch(PLANE, material, [x + Math.sin(face * 2.4) * .16 * plantScale, y + (.28 + lush * .12) * plantScale, z + Math.cos(face * 2.4) * .16 * plantScale], [lush * 1.6 * plantScale, lush * .86 * plantScale, 1], [face === 2 ? -1.14 : -.26, angle + face * 1.17, .12], false);
        if (!meadow && edge > 3.6 && i % 9 === 0) {
          const twig = new THREE.Vector3(x + Math.cos(angle) * .32, y + 1.16, z + Math.sin(angle) * .32);
          this.beam(new THREE.Vector3(x, y, z), twig, .025, this.mat.bark, true);
          for (let face = 0; face < 2; face++) this.batch(PLANE, material, [twig.x, twig.y + .12, twig.z], [lush * 1.6, lush, 1], [.25, angle + face * 1.2, -.2], false);
        }
      }
    }
    // A few individual leaves cross the worn margins and mask the transition
    // between the photographic trail and the textured earth underneath.
    for (let i = 0; i < 1800; i++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX), z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
      const distance = pathDistance(x, z);
      if (distance > 2.3 || sheltered(x, z) || nearTarget(x, z, .8) || nearShaft(x, z, .95)) continue;
      const sx = .055 + random() * .05, sz = .07 + random() * .04, yaw = random() * Math.PI * 2;
      if (!inHouseGorge(x, z)) this.batch(SMALLROCK, fallen[i % 3], [x, -.022, z], [sx, .004, sz], [0, yaw, -.06], false);
    }
  }
  houseGorge(exit: ExitDef, foliage: THREE.Material) {
    const { east, south, depth } = HOUSE_GORGE;
    // Continuous cliff faces and a broad river replace the former miniature
    // canal. All new rock above the water sits on the unsafe side of the rim.
    for (const side of ['south', 'east'] as const) {
      const across = 64, down = 9, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
      const end = side === 'south' ? east : south;
      for (let j = 0; j <= down; j++) for (let i = 0; i <= across; i++) {
        const p = -150 + (end + 150) * i / across, t = j / down;
        const fold = Math.sin(p * .29 + t * 4.7) * .19 + Math.sin(p * .71 - t * 2.3) * .09;
        const inset = .025 + t * (.95 + fold) + Math.sin(t * Math.PI) * (.24 + organic(i, j, 181) * .34);
        positions.push(side === 'south' ? p : east - inset, -.085 - t * (depth + .5), side === 'south' ? south - inset : p);
        uvs.push(p / 5.5, t * depth / 4.5);
        if (i < across && j < down) { const v = j * (across + 1) + i; indices.push(v, v + 1, v + across + 1, v + 1, v + across + 2, v + across + 1); }
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
      const material = this.mat.rock.clone(); material.side = THREE.DoubleSide;
      this.mesh(geometry, material, [0, 0, 0]).name = `route:forest:${side}-gorge-cliff`;
    }
    // Staggered rock shelves below the rim break up the strata without the
    // repeated pointed columns of the former bank geometry.
    for (let i = 0; i < 14; i++) {
      const x = -70 + i * 3.05, y = -4.2 - organic(i, 1, 182) * 8.5;
      this.batch(ROCK, i % 3 ? this.mat.rock : this.mat.mossStone, [x, y, south - 1.65], [2.1 + organic(i, 2, 182) * 1.4, 1.65 + organic(i, 3, 182) * 1.7, .78], [0, 0, (organic(i, 4, 182) - .5) * .3]);
    }
    for (let i = 0; i < 13; i++) {
      const z = south - 4.6 - i * 3.2, y = -4.5 - organic(i, 1, 183) * 8;
      this.batch(ROCK, i % 3 ? this.mat.rock : this.mat.mossStone, [east - 1.6, y, z], [.75, 1.8 + organic(i, 2, 183) * 1.8, 2.3 + organic(i, 3, 183)], [(organic(i, 4, 183) - .5) * .3, 0, 0]);
    }
    // Wooded folds of the near bank screen the rainbow from the opening field;
    // the actual landing remains a clear three-metre view into the ravine.
    for (let i = 0; i < 5; i++) {
      const x = -32.5 + i * 1.25, h = 2.5 + organic(i, 1, 192) * 1.35, z = south - 1.15 - organic(i, 2, 192) * .55;
      this.batch(ROCK, this.mat.mossStone, [x, h * .52 - .12, z], [1.15, h * .7, .78], [0, 0, 0]);
      for (let leaf = 0; leaf < 3; leaf++) this.batch(PLANE, foliage, [x + Math.sin(leaf * 2.1) * .38, h + .35, z], [1.6, 1.65, 1], [.2 + leaf * .37, leaf * 1.4, .1]);
    }
    const end = this.routePoint(exit, 0, 0, 23.35);
    const far = new THREE.Group(); far.name = 'route:forest:rainbow-promontory';
    const promontories = [[end[0], end[2] - 1.8, 3.55, 1.34], [-36.7, -50.5, 3.65, 1.4], [-38.2, -56.7, 4.1, 1.4], [-37.4, -62.7, 5.1, 1.4]];
    for (const [index, [x, z, radius, stretch]] of promontories.entries()) {
      const geometry = new THREE.CylinderGeometry(radius, radius * 1.32, depth, 13, 7);
      const position = geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const px = position.getX(i), py = position.getY(i), pz = position.getZ(i), a = Math.atan2(pz, px);
        const rough = 1 + Math.sin(a * 3 + index) * .06 + Math.sin(a * 7 - py * .31) * .035;
        position.setXYZ(i, px * rough, py, pz * rough * stretch);
      }
      geometry.computeVertexNormals();
      const rock = new THREE.Mesh(geometry, this.mat.mossStone); rock.position.set(x, -depth / 2 - .085, z); far.add(rock);
    }
    const landing = new THREE.Mesh(BLOCK, this.mat.paleStone); landing.position.set(end[0], -.025, end[2] - .1); landing.scale.set(2.35, .1, 1.45); far.add(landing);
    far.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } }); this.group.add(far);
    const farPath = this.mat.moss.clone(); farPath.color.set('#969176'); farPath.roughness = 1;
    this.trailRibbon([[end[0], end[2]], [-36.2, -47], [-37.8, -54], [-37.7, -61]], 1.55, farPath);
    // Unequal overlapping masses form a wooded headland; a narrow path bends
    // out of sight between its rock folds instead of stopping on a pedestal.
    const headlandRocks: THREE.Mesh[] = [];
    for (const [x, y, z, sx, sy, sz] of [[-64, -9, -64, 10, 12.5, 7], [-48.5, -8.5, -66, 10.2, 13, 8], [-36.8, -9, -66, 7.2, 12, 8.5]]) {
      const rock = this.mesh(ROCK, this.mat.mossStone, [x, y, z], [0, .15, 0]); rock.scale.set(sx, sy, sz); rock.updateMatrixWorld(true); headlandRocks.push(rock);
    }
    for (const [x, z, s] of [[-41.6, -56.8, 2.8], [-32.9, -58.4, 2.5], [-42.3, -63, 3.5]]) this.batch(ROCK, this.mat.mossStone, [x, s * .5 - .15, z], [s * .8, s, s * 1.1], [0, .3, .1]);
    const groundRay = new THREE.Raycaster();
    for (let i = 0; i < 8; i++) {
      const x = -64 + organic(i, 1, 201) * 29, z = -64 - organic(i, 2, 201) * 5, h = 6.5 + organic(i, 3, 201) * 6;
      groundRay.set(new THREE.Vector3(x, 32, z), new THREE.Vector3(0, -1, 0));
      const ground = groundRay.intersectObjects(headlandRocks, false)[0]; if (!ground) continue;
      const base = ground.point.y - .13;
      this.beam(new THREE.Vector3(x, base, z), new THREE.Vector3(x + .38, base + h, z), .19 + h * .005, this.mat.bark, true);
      for (let branch = 0; branch < 4; branch++) {
        const a = branch * 2.4 + organic(i, branch, 202), by = base + h * (.46 + branch * .1), spread = 1.8 + organic(i, branch, 203) * 1.8;
        const tip = new THREE.Vector3(x + Math.cos(a) * spread, by + 1.1, z + Math.sin(a) * spread);
        this.beam(new THREE.Vector3(x + .2, by, z), tip, .075, this.mat.bark, true);
        for (let leaf = 0; leaf < 2; leaf++) this.batch(PLANE, foliage, [tip.x, tip.y + leaf * .45, tip.z], [3.8, 3.5, 1], [.2 + leaf * .7, a + leaf * 1.3, .12]);
      }
    }
    this.mist(-43, -5.5, -43, 17, '#9fbec1', .2);
    this.mist(-44, .8, -57, 18, '#acc5c4', .19);
  }
  trailRibbon(points: number[][], width: number, material: THREE.Material) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], -.044, p[1])));
    const count = Math.max(16, Math.ceil(curve.getLength() * 2.2)), samples = curve.getPoints(count);
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [], across: number[] = [];
    let length = 0;
    for (let i = 0; i <= count; i++) {
      if (i) length += samples[i].distanceTo(samples[i - 1]);
      const direction = curve.getTangent(i / count), normal = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
      const breadth = width * (.5 + Math.sin(i * .38) * .035 + Math.cos(i * .77) * .017);
      for (const side of [-1, 1]) {
        const ragged = 1 + (organic(samples[i].x, samples[i].z, side) - .5) * .105;
        const x = samples[i].x + normal.x * breadth * side * ragged, z = samples[i].z + normal.z * breadth * side * ragged;
        positions.push(x, -.044, z); uvs.push(x / 2.7, z / 2.7); across.push((side + 1) / 2);
      }
      if (i < count) {
        const midX = (samples[i].x + samples[i + 1].x) / 2, midZ = (samples[i].z + samples[i + 1].z) / 2;
        if (this.room.id === 'house_grounds' && Math.hypot(midX + 31, midZ - 7) < 2.1) continue;
        const p = i * 2; indices.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setAttribute('pathAcross', new THREE.Float32BufferAttribute(across, 1)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const ribbon = this.mesh(geometry, material, [0, 0, 0]); ribbon.castShadow = false; ribbon.name = 'grounds:continuous-path';
  }
  whiteHouse(z = -this.z + 5.2, depth = 7.4, enclosed = false) {
    const width = Math.min(11.8, this.w * .55), front = z + depth / 2;
    const plaster = this.mat.plaster, wood = this.mat.darkWood;
    this.box(-width / 4 - .65, 2.2, front, width / 2 - 1.3, 4.4, .45, plaster, true);
    this.box(width / 4 + .65, 2.2, front, width / 2 - 1.3, 4.4, .45, plaster, true);
    this.box(0, 4.0, front, 3.3, .8, .45, plaster, true);
    this.box(-width / 2, 2.2, z, .4, 4.4, depth + .2, plaster, true); this.box(width / 2, 2.2, z, .4, 4.4, depth + .2, plaster, true);
    if (!enclosed) {
      this.collision(-width / 4 - .7, front, width / 2 - 1.2, .55); this.collision(width / 4 + .7, front, width / 2 - 1.2, .55);
      this.collision(-width / 2, z, .45, depth); this.collision(width / 2, z, .45, depth);
    }
    for (let i = 0; i < 17; i++) {
      const yy = .17 + i * .245;
      for (const s of [-1, 1]) this.box(s * (width / 4 + .7), yy, front + .25, width / 2 - 1.35, .035, .045, this.mat.cream);
      this.box(-width / 2 - .21, yy, z, .04, .035, depth + .2, this.mat.cream); this.box(width / 2 + .21, yy, z, .04, .035, depth + .2, this.mat.cream);
    }
    for (const x of [-width / 2 + .12, width / 2 - .12]) this.box(x, 2.25, front + .28, .2, 4.5, .16, this.mat.cream);
    const roofH = 2.8, roofSlope = Math.atan2(roofH, width / 2 + .7), roofLen = Math.hypot(roofH, width / 2 + .7), roofDepth = depth + 2;
    for (const s of [-1, 1]) this.batch(BOX, this.mat.roof, [s * (width / 2 + .7) / 2, 4.5 + roofH / 2, z], [roofLen, .18, roofDepth], [0, 0, -s * roofSlope]);
    // Hundreds of slate courses break up the silhouette and catch the sun.
    for (const s of [-1, 1]) for (let row = 0; row < 13; row++) for (let col = 0; col < 16; col++) {
      const t = (row + .5) / 13, x = s * (width / 2 + .68) * t, y = 4.55 + roofH * (1 - t);
      this.batch(BLOCK, col % 5 === 0 ? this.mat.slate : this.mat.roof, [x, y + .11, z - roofDepth / 2 + (col + .5) * roofDepth / 16 + (row % 2) * .06], [roofLen / 13 + .045, .075, roofDepth / 16 + .015], [0, 0, -s * roofSlope]);
    }
    const triangle = new THREE.BufferGeometry(); triangle.setAttribute('position', new THREE.Float32BufferAttribute([-width / 2 - .72, 4.48, 0, width / 2 + .72, 4.48, 0, 0, 7.32, 0], 3)); triangle.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .5, 1], 2)); triangle.computeVertexNormals();
    const gablemat = plaster.clone(); gablemat.side = THREE.DoubleSide;
    this.mesh(triangle, gablemat, [0, 0, front + .02]);
    this.box(0, 4.44, front, width + .2, .16, .45, plaster);
    for (const x of [-width * .31, width * .31]) {
      this.box(x, 2.7, front + .26, 1.55, 1.9, .13, wood, true);
      this.box(x, 2.7, front + .34, 1.26, 1.63, .05, color('#162626', .18, .4));
      for (const dx of [-.7, 0, .7]) this.box(x + dx, 2.7, front + .4, .07, 1.83, .06, this.mat.cream);
      this.box(x, 2.7, front + .42, 1.5, .07, .06, this.mat.cream);
      this.box(x, 1.7, front + .45, 1.83, .17, .3, this.mat.cream, true);
      for (const sign of [-1, 1]) {
        this.box(x + sign * 1.02, 2.7, front + .36, .49, 1.9, .15, this.mat.ivy, true, sign * .07);
        for (let j = 0; j < 9; j++) this.box(x + sign * 1.02, 1.88 + j * .2, front + .46, .43, .07, .04, this.mat.darkWood);
      }
    }
    this.box(0, 5.55, front + .1, 1.05, 1.25, .13, wood, true);
    this.box(0, 5.55, front + .18, .78, 1, .04, color('#182323', .2, .3));
    this.box(0, 5.55, front + .21, .055, 1.03, .04, this.mat.cream); this.box(0, 5.55, front + .22, .8, .055, .04, this.mat.cream);
    this.box(0, .04, front + 1.2, 6.4, .08, 2.6, this.mat.wood);
    for (let i = 0; i < 13; i++) this.box(-3.02 + i * .5, .105, front + 1.2, .018, .014, 2.55, wood);
    for (const x of [-2.8, 2.8]) { this.box(x, 1.75, front + 2.1, .15, 3.5, .15, this.mat.cream, true); this.box(x, 3.43, front + 1.1, .17, .15, 2.4, this.mat.cream); }
    this.box(0, 3.55, front + 1.15, 6.5, .18, 2.75, this.mat.roof, true);
    for (const x of [-1.2, 1.2]) this.box(x, 1.73, front + .33, .14, 3.46, .12, wood, true);
    this.box(0, 3.41, front + .33, 2.65, .17, .15, wood, true);
    // The iconic boarded entrance makes the open side path the readable route.
    this.box(0, 1.6, front + .08, 2.1, 3.2, .16, this.mat.darkWood, true);
    for (let i = 0; i < 5; i++) this.batch(BLOCK, this.mat.wood, [0, .48 + i * .58, front + .35], [2.6, .23, .13], [0, 0, i % 2 ? -.06 : .045]);
    if (enclosed) { this.collision(0, z, width + .4, depth + .36); this.rearHouseWall(z - depth / 2, width, triangle, gablemat); }
    else this.collision(0, front, 2.7, .5);
    this.box(width * .28, 6.15, z - 1.8, .95, 3.4, 1.15, this.mat.brick, true); this.box(width * .28, 7.9, z - 1.8, 1.15, .22, 1.35, this.mat.darkStone, true);
    const ivyLeaves = new THREE.MeshStandardMaterial({ map: leafTexture, alphaTest: .35, side: THREE.DoubleSide, color: '#536b39' });
    for (let j = 0; j < 35; j++) {
      const y = this.rand(.2, 3.8), x = -width / 2 + this.rand(-.1, .75);
      this.batch(PLANE, ivyLeaves, [x, y, front + .4], [1, 1, 1], [0, 0, this.rand(-1, 1)]);
    }
    const porchLight = new THREE.PointLight('#e2ad66', 6, 6, 2); porchLight.position.set(0, 2.9, front - .9); this.lights.push(porchLight); this.group.add(porchLight);
  }
  rearHouseWall(back: number, width: number, gable: THREE.BufferGeometry, gableMaterial: THREE.Material) {
    const plaster = this.mat.plaster;
    for (const side of [-1, 1]) this.box(side * (width / 4 + .28), 2.2, back, width / 2 - .56, 4.4, .36, plaster);
    this.box(0, .38, back, 1.12, .76, .36, plaster);
    this.box(0, 3.32, back, 1.12, 2.16, .36, plaster);
    this.box(0, .73, back - .15, 1.38, .16, .52, this.mat.cream, true);
    this.box(0, 2.27, back - .03, 1.38, .14, .38, this.mat.cream, true);
    for (const side of [-1, 1]) this.box(side * .64, 1.49, back - .03, .14, 1.57, .31, this.mat.cream, true);
    this.mesh(gable, gableMaterial, [0, 0, back - .02]); this.box(0, 4.44, back, width + .2, .16, .45, plaster);
    const glass = new THREE.MeshStandardMaterial({ color: '#23372f', roughness: .22, metalness: .17 });
    this.box(0, 5.55, back - .1, 1.05, 1.25, .13, this.mat.darkWood, true);
    this.box(0, 5.55, back - .18, .78, 1, .04, glass);
    this.box(0, 5.55, back - .21, .055, 1.03, .04, this.mat.cream); this.box(0, 5.55, back - .22, .8, .055, .04, this.mat.cream);
    for (let i = 0; i < 17; i++) {
      const y = .17 + i * .245;
      if (y > .75 && y < 2.33) for (const side of [-1, 1]) this.box(side * (width / 4 + .36), y, back - .191, width / 2 - .72, .026, .025, this.mat.cream);
      else this.box(0, y, back - .191, width, .026, .025, this.mat.cream);
    }
    for (const side of [-1, 1]) {
      this.box(side * (width / 2 - .08), 2.22, back - .22, .19, 4.44, .12, this.mat.cream);
      const x = side * (width / 2 + .23), z = back + 4.15;
      this.box(x, 2.3, z, .13, 1.75, 1.43, this.mat.darkWood, true);
      this.box(x + side * .07, 2.3, z, .025, 1.47, 1.2, glass);
      for (const dz of [-.65, 0, .65]) this.box(x + side * .09, 2.3, z + dz, .06, 1.65, .055, this.mat.cream);
      this.box(x + side * .1, 2.3, z, .06, .055, 1.34, this.mat.cream);
      this.box(x + side * .12, 1.39, z, .3, .15, 1.64, this.mat.cream, true);
      for (let z1 = back + .6; z1 < back + 7.9; z1 += 1.17) this.box(side * 5.9, .14, z1, .47, .28, 1.12, this.mat.darkAshlar, true);
    }
    for (let x = -5.35; x < 5.9; x += 1.19) this.box(x, .14, back, 1.14, .28, .49, this.mat.darkAshlar, true);
    // The opened sash looks into a furnished recess in this same house. E still
    // enters the authored kitchen scene; the exterior does not expose a void.
    const interior = this.mat.wood.clone(); interior.color.set('#57604a');
    this.box(0, 2.18, back + 3.4, 11.35, 4.36, .16, this.mat.darkWood);
    this.box(0, -.005, back + 1.65, 11.35, .1, 3.35, this.mat.wood);
    this.box(0, .82, back + 2.25, 3.0, .15, .9, this.mat.wood, true);
    for (const x of [-1.25, 1.25]) this.box(x, .38, back + 2.25, .12, .76, .6, this.mat.darkWood);
    this.box(-1.3, 2.05, back + 3.24, 1.15, 1.5, .25, interior, true);
    for (const y of [1.37, 2.72]) this.box(-1.3, y, back + 3.07, 1.32, .085, .5, this.mat.wood, true);
    this.cylinder(.45, 1.03, back + 2.18, .2, .27, this.mat.charcoal);
    this.cylinder(-.37, .97, back + 2.18, .3, .09, this.mat.cream);
    const light = new THREE.PointLight(this.flags.window_open ? '#efd2a2' : '#c29c69', this.flags.window_open ? 8 : 3.4, 6, 2); light.position.set(-.45, 2.15, back + 1.35); light.name = 'state:kitchen:window-light'; this.group.add(light); this.lights.push(light);
  }
  woodFloor() {
    this.ground(this.mat.darkWood);
    const holes = this.floorVoids();
    for (let x = -this.x; x < this.x; x += .48) for (let z = -this.z; z < this.z; z += 3.05) {
      const mat = this.rnd() < .2 ? this.mat.darkWood : this.mat.wood;
      const hole = holes.find(v => x + .455 > v.x - v.w / 2 && x < v.x + v.w / 2 && z + 3 > v.z - v.d / 2 && z < v.z + v.d / 2);
      if (!hole) this.box(x + .225, -.005, z + 1.5, .455, .065, 3, mat);
      else {
        const first = hole.z - hole.d / 2 - z, last = z + 3 - (hole.z + hole.d / 2);
        if (first > .025) this.box(x + .225, -.005, z + first / 2, .455, .065, first, mat);
        if (last > .025) this.box(x + .225, -.005, hole.z + hole.d / 2 + last / 2, .455, .065, last, mat);
      }
    }
  }
  barrel(x: number, z: number, scale = 1, y = 0) {
    this.cylinder(x, y + .66 * scale, z, .44 * scale, 1.28 * scale, this.mat.wood);
    for (const h of [.17, .38, 1.03, 1.19]) this.cylinder(x, y + h * scale, z, .458 * scale, .065 * scale, this.mat.metal);
    for (let j = 0; j < 12; j++) { const a = j * Math.PI / 6; this.box(x + Math.cos(a) * .44 * scale, y + .67 * scale, z + Math.sin(a) * .44 * scale, .021 * scale, 1.13 * scale, .022 * scale, this.mat.darkWood); }
    if (!this.nearRoute(x, z, 1)) this.collision(x, z, .8 * scale, .8 * scale);
  }
  crate(x: number, z: number, s = 1, y = 0) {
    this.box(x, y + s / 2, z, s, s, s, this.mat.wood, true);
    for (const side of [-1, 1]) for (const edge of [-1, 1]) {
      this.box(x + side * s * .51, y + s / 2, z + edge * s * .38, .08, s, .09, this.mat.darkWood);
      this.box(x + edge * s * .38, y + s / 2, z + side * s * .51, .09, s, .08, this.mat.darkWood);
    }
    if (!this.nearRoute(x, z, 1.2)) this.collision(x, z, s, s);
  }
  house() {
    if (this.room.id === 'behind_house') { this.courtyard(); return; }
    const attic = this.room.id === 'attic', kitchen = this.room.id === 'kitchen';
    const ceiling = attic ? 3.05 : kitchen ? 3.3 : 3.8;
    this.woodFloor(); this.houseShell(ceiling, attic);
    if (attic) { this.atticInterior(); return; }
    const ceilingMat = this.mat.plaster.clone(); ceilingMat.color.set('#aca98f'); ceilingMat.map = ashlarTexture ?? null;
    this.box(0, ceiling + .08, 0, this.w, .16, this.d, ceilingMat);
    for (let z = -this.z + 1.25; z < this.z; z += 2.35) {
      this.box(0, ceiling - .1, z, this.w, .21, .2, this.mat.darkWood, true);
      for (const side of [-1, 1]) this.beam(new THREE.Vector3(side * (this.x - .15), ceiling - .65, z), new THREE.Vector3(side * (this.x - .72), ceiling - .08, z), .065, this.mat.wood);
    }
    if (kitchen) this.kitchenInterior();
    else {
      this.livingInterior();
      if (this.flags.trapdoor_open) this.hatch();
    }
    this.mist(0, ceiling - .6, -1, 3, '#ddcba3', .035);
  }
  houseShell(height: number, attic = false) {
    const plaster = this.mat.plaster.clone(); plaster.color.set(attic ? '#88836f' : '#c7bfa6'); plaster.map = ashlarTexture ?? null;
    const panel = this.mat.wood.clone(); panel.color.set(this.room.id === 'kitchen' ? '#5e6650' : '#655643'); panel.normalScale.setScalar(.25);
    const sides = [{ axis: 'x', fixed: -this.z, half: this.x }, { axis: 'x', fixed: this.z, half: this.x }, { axis: 'z', fixed: -this.x, half: this.z }, { axis: 'z', fixed: this.x, half: this.z }];
    for (const side of sides) {
      const horizontal = side.axis === 'x', sign = Math.sign(side.fixed), yaw = horizontal ? 0 : Math.PI / 2;
      const at = (p: number, y: number, inset = 0) => [horizontal ? p : side.fixed - sign * inset, y, horizontal ? side.fixed - sign * inset : p];
      const piece = (p: number, y: number, width: number, h: number, depth: number, mat: THREE.Material, inset = 0, bevel = false) => {
        const q = at(p, y, inset); this.box(q[0], y, q[2], horizontal ? width : depth, h, horizontal ? depth : width, mat, bevel);
      };
      const doors = this.room.exits.filter(e => !e.via && e.to !== 'cellar' && (horizontal ? Math.abs(e.position[1] / this.z) >= Math.abs(e.position[0] / this.x) : Math.abs(e.position[0] / this.x) > Math.abs(e.position[1] / this.z)) && Math.sign(horizontal ? e.position[1] : e.position[0]) === sign).map(e => e.role === 'window'
        ? { p: horizontal ? e.position[0] : e.position[1], width: 1.1, bottom: .79, top: 2.19, kind: 'return-window' }
        : { p: horizontal ? e.position[0] : e.position[1], width: 1.85, bottom: 0, top: 2.5, kind: 'door' });
      const windows = horizontal && sign > 0 && !attic ? [-this.x * .53, this.x * .53].map(p => ({ p, width: 1.7, bottom: 1.25, top: 2.65, kind: 'window' })) : [];
      const openings = [...doors, ...windows];
      const cuts = [-side.half, ...openings.flatMap(o => [o.p - o.width / 2, o.p + o.width / 2]), side.half].sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const p = (cuts[i] + cuts[i + 1]) / 2, width = cuts[i + 1] - cuts[i], hole = openings.find(o => Math.abs(p - o.p) < o.width / 2);
        if (!hole) piece(p, height / 2, width + .008, height, .26, attic ? this.mat.wood : plaster);
        else {
          if (hole.bottom > 0) piece(p, hole.bottom / 2, width + .008, hole.bottom, .26, plaster);
          if (hole.top < height) piece(p, (height + hole.top) / 2, width + .008, height - hole.top, .26, plaster);
        }
        if (!hole || hole.kind.includes('window')) {
          const panelTop = hole?.kind === 'return-window' ? .73 : .93;
          piece(p, (panelTop + .03) / 2, width, panelTop - .03, .09, panel, .17);
          piece(p, panelTop + .05, width, .075, .14, this.mat.darkWood, .19, true);
          piece(p, .09, width, .18, .12, this.mat.darkWood, .18);
          const panels = Math.max(1, Math.round(width / .72));
          for (let j = 0; j < panels; j++) piece(cuts[i] + (j + .5) * width / panels, (panelTop + .05) / 2, width / panels - .13, panelTop - .26, .022, this.mat.wood, .226, true);
        }
      }
      piece(0, height - .08, side.half * 2, .14, .2, this.mat.darkWood, .12, true);
      piece(0, height - .22, side.half * 2, .075, .14, this.mat.wood, .15, true);
      for (const o of openings) {
        for (const edge of [-1, 1]) piece(o.p + edge * (o.width / 2 + .08), (o.top + o.bottom) / 2, .15, o.top - o.bottom + .16, .18, this.mat.darkWood, .12, true);
        piece(o.p, o.top + .07, o.width + .38, .15, .2, this.mat.wood, .12, true);
        piece(o.p, o.bottom + .025, o.width + .27, .07, o.kind.includes('window') ? .36 : .26, this.mat.wood, .13, true);
        if (o.kind.includes('window')) {
          const sky = new THREE.MeshStandardMaterial({ color: '#91a6a1', emissive: '#9eb1a2', emissiveIntensity: .32, roughness: .28 });
          if (o.kind === 'return-window' && this.flags.window_open) {
            const leaf = new THREE.Group(), hinge = at(o.p - o.width / 2, (o.top + o.bottom) / 2, -.08);
            leaf.position.set(...hinge as [number, number, number]); leaf.rotation.y = yaw + (horizontal ? sign : -sign) * 1.15;
            const halfHeight = (o.top - o.bottom) / 2;
            const bar = (x: number, y: number, w: number, h: number) => { const mesh = new THREE.Mesh(BOX, this.mat.cream); mesh.position.set(x, y, 0); mesh.scale.set(w, h, .07); mesh.castShadow = true; leaf.add(mesh); };
            for (const x of [0, o.width]) bar(x, 0, .065, halfHeight * 2);
            for (const y of [-halfHeight, 0, halfHeight]) bar(o.width / 2, y, o.width + .065, .065);
            this.group.add(leaf); leaf.name = 'route:kitchen:return-casement';
            piece(o.p, 1.6, 2.6, 2.7, .02, sky, -1.4);
          } else {
            piece(o.p, (o.top + o.bottom) / 2, o.width - .05, o.top - o.bottom - .04, .02, sky, -.12);
            piece(o.p, (o.top + o.bottom) / 2, .045, o.top - o.bottom, .055, this.mat.cream, .08);
            piece(o.p, (o.top + o.bottom) / 2, o.width, .045, .055, this.mat.cream, .08);
          }
          const q = at(o.p, 2.05, .55), light = new THREE.PointLight('#b8cbbb', 5.5, 8, 2); light.position.set(...q as [number, number, number]); this.group.add(light); this.lights.push(light);
          const curtain = this.mat.red.clone(); curtain.color.set('#514336'); curtain.side = THREE.DoubleSide;
          for (const edge of [-1, 1]) for (let fold = 0; fold < 5; fold++) piece(o.p + edge * (o.width / 2 + .19) + fold * .025, 1.93, .072, 1.56 - fold * .015, .04, curtain, .28 + Math.sin(fold * 1.3) * .035);
        } else {
          const q = at(o.p, 1.9, -.35), light = new THREE.PointLight('#c6c9ae', 2.7, 5, 2); light.position.set(...q as [number, number, number]); this.group.add(light); this.lights.push(light);
          // A short dark reveal gives the threshold depth beyond the room edge.
          for (const edge of [-1, 1]) piece(o.p + edge * .95, 1.2, .09, 2.4, 1.3, panel, -.6);
          piece(o.p, 2.47, 1.9, .1, 1.3, this.mat.darkWood, -.6);
          if (this.room.id === 'kitchen' && horizontal && sign < 0) for (let j = 0; j < 6; j++) piece(o.p, .08 + j * .19, 1.7, .17, .25, this.mat.wood, -.15 - j * .24, true);
        }
      }
    }
  }
  domesticHearth(x: number, z: number, size = 1) {
    this.box(x - .35, 1.36, z, .72, 2.72, 2.2 * size, this.mat.darkAshlar, true);
    for (const s of [-1, 1]) this.box(x + .05, .74, z + s * .84 * size, .74, 1.48, .32, this.mat.ashlar, true);
    this.box(x + .05, 1.63, z, .88, .3, 2.03 * size, this.mat.limestone, true);
    this.box(x + .1, 1.84, z, 1.0, .16, 2.38 * size, this.mat.darkWood, true);
    this.box(x + .4, .025, z, 1.55, .07, 2.5 * size, this.mat.darkAshlar, true);
    this.box(x + .15, .58, z, .065, 1.12, 1.44 * size, this.mat.charcoal);
    this.torch(x + .54, .38, z, '#ffb973', 10);
    for (let i = 0; i < 4; i++) this.beam(new THREE.Vector3(x + .14, .15 + i * .05, z - .54), new THREE.Vector3(x + .57, .15 + i * .05, z + .54), .08, this.mat.darkWood);
    this.collision(x - .1, z, .9, 2.05 * size);
  }
  console(x: number, z: number, width = 2.3, depth = 1.05) {
    const paint = this.mat.darkWood;
    this.box(x, .8, z, width, .12, depth, this.mat.wood, true);
    this.box(x, .56, z - depth * .12, width - .18, .38, depth * .65, paint, true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.box(x + sx * (width / 2 - .18), .36, z + sz * (depth / 2 - .15), .11, .72, .11, paint, true);
      this.box(x + sx * (width / 2 - .18), .1, z + sz * (depth / 2 - .15), .14, .09, .14, this.mat.brass, true);
    }
    for (let j = 0; j < 2; j++) {
      const xx = x + (j ? 1 : -1) * width * .23;
      this.box(xx, .56, z + depth * .24, width * .43, .27, .055, this.mat.wood, true);
      this.box(xx, .56, z + depth * .285, .17, .033, .045, this.mat.brass, true);
    }
    this.collision(x, z, width, depth);
  }
  kitchenInterior() {
    // One working table, with its food arranged on the actual tabletop.
    this.console(0, -1.8, 5.4, 1.8); this.console(-3, 2.2, 1.35, .85);
    const paint = this.mat.wood.clone(); paint.color.set('#667052'); paint.normalScale.setScalar(.24);
    const back = -this.z + .54;
    for (const side of [-1, 1]) {
      const x = side * 3.68;
      this.box(x, .43, back, 3.5, .85, .75, paint, true);
      this.box(x, .91, back + .04, 3.62, .12, .91, this.mat.limestone, true);
      this.box(x, 2.05, back - .06, 3.5, 1.16, .37, this.mat.darkWood, true);
      for (let j = 0; j < 4; j++) {
        const xx = x - 1.29 + j * .86;
        this.box(xx, .45, back + .395, .77, .7, .07, paint, true);
        for (const y of [.17, .71]) this.box(xx, y, back + .44, .64, .043, .025, this.mat.wood, true);
        this.box(xx, 2.05, back + .15, .77, 1.05, .06, paint, true);
        this.box(xx, 2.05, back + .195, .64, .91, .025, this.mat.darkWood, true);
        this.box(xx, 2.05, back + .215, .58, .85, .015, paint, true);
        this.box(xx + .23, .53, back + .465, .038, .135, .034, this.mat.brass, true);
        this.box(xx + .24, 2.02, back + .255, .028, .12, .03, this.mat.brass, true);
      }
      this.box(x, 2.69, back - .005, 3.65, .095, .55, this.mat.wood, true);
      this.collision(x, back, 3.5, .82);
      for (let j = 0; j < 4; j++) {
        const xx = x - 1.2 + j * .68;
        this.cylinder(xx, 1.11, back + .08, .1 + j % 2 * .025, .28, j % 2 ? this.mat.cream : this.mat.rust);
        this.cylinder(xx, 1.27, back + .08, .112 + j % 2 * .025, .034, this.mat.darkWood);
        this.box(xx, 1.09, back + .205, .09, .1, .005, this.mat.cream);
      }
    }
    this.domesticHearth(-5.4, -2.15, .88);
    // Cookware is reachable above the worktop, below the low ceiling beams.
    for (const s of [-1, 1]) this.beam(new THREE.Vector3(s * 1.0, 2.69, -1.85), new THREE.Vector3(s * 1.0, 3.29, -1.85), .014, this.mat.metal);
    this.box(0, 2.69, -1.85, 2.7, .075, .62, this.mat.darkWood, true);
    for (let j = 0; j < 5; j++) {
      const x = -.96 + j * .48, y = 2.3 + j % 2 * .08;
      this.beam(new THREE.Vector3(x, 2.66, -1.85), new THREE.Vector3(x, y + .16, -1.85), .011, this.mat.metal);
      this.batch(CYLINDER, this.mat.rust, [x, y, -1.85], [.17, .07, .17], [Math.PI / 2, 0, 0]);
      this.box(x, y + .22, -1.85, .035, .23, .043, this.mat.brass, true);
      this.mesh(new THREE.TorusGeometry(.175, .013, 5, 28), this.mat.brass, [x, y, -1.80]);
    }
    // A cutting board, ceramic dishes and a folded cloth establish use and scale.
    this.box(-.86, .881, -1.47, .56, .034, .42, this.mat.darkWood, true, .14);
    for (let i = 0; i < 4; i++) this.cylinder(1.01, .875 + i * .018, -2.12, .18, .017, this.mat.cream);
    this.box(1.15, .879, -1.21, .46, .014, .47, this.mat.red, false, .08);
    for (const x of [-1.8, 1.8]) {
      this.cylinder(x, .47, -.21, .31, .12, this.mat.wood);
      for (const s of [-1, 1]) this.box(x + s * .21, .23, -.21, .075, .46, .32, this.mat.darkWood, true);
    }
    this.box(0, .044, 1.5, 2.6, .018, 2.25, this.mat.red);
    for (const x of [-1.2, 1.2]) this.box(x, .055, 1.5, .036, .009, 2.08, this.mat.brass);
    const light = new THREE.PointLight('#ebcf9f', 5.5, 9, 2); light.position.set(0, 2.9, .3); this.group.add(light); this.lights.push(light);
  }
  livingInterior() {
    const casePosition = this.room.objects.find(o => o.id === 'trophy_case')?.position ?? [0, 0, -5.5];
    const bz = casePosition[2] - .48;
    for (const side of [-1, 1]) {
      this.console(side * 3.3, -2.5, 1.8, .91);
      // Bookcases flank the trophy cabinet without competing with its silhouette.
      const bx = side * 4.1;
      this.box(bx, 1.28, bz, 2.15, 2.56, .58, this.mat.darkWood, true);
      this.box(bx, 1.29, bz + .32, 1.99, 2.37, .04, this.mat.red);
      for (let row = 0; row < 5; row++) {
        const y = .13 + row * .49; this.box(bx, y, bz + .17, 2.16, .065, .67, this.mat.wood, true);
        if (row === 4) continue;
        for (let j = 0; j < 13; j++) {
          const xx = bx - .89 + j * .146, h = .31 + (j * 7 % 5) * .022;
          const mat = [this.mat.red, this.mat.ivy, this.mat.darkWood, this.mat.slate][(j + row) % 4];
          this.box(xx, y + .04 + h / 2, bz + .26, .108, h, .36, mat, true, j === 11 ? .13 : 0);
          for (const yy of [y + .11, y + h - .025]) this.box(xx, yy, bz + .447, .081, .011, .012, this.mat.brass);
        }
      }
      this.box(bx, 2.66, bz + .05, 2.36, .12, .81, this.mat.wood, true); this.collision(bx, bz + .04, 2.22, .72);
    }
    this.domesticHearth(-5.6, 2.6);
    // The armchair and hearth form a small resting corner, clear of the hatch.
    const fabric = this.mat.red.clone(); fabric.color.set('#624633'); fabric.roughness = .95; fabric.map = ashlarTexture ?? null;
    this.box(-3.47, .43, 3.37, .91, .19, .98, fabric, true, .3);
    this.box(-3.6, .91, 3.78, .96, .92, .21, fabric, true, .3);
    for (const s of [-1, 1]) this.box(-3.47 + s * .49, .72, 3.37, .14, .32, 1.02, this.mat.wood, true, .3);
    this.collision(-3.47, 3.44, 1.12, 1.18);
    for (const x of [-3.79, -3.15]) for (const z of [3.04, 3.68]) this.box(x, .18, z, .08, .36, .08, this.mat.darkWood, true);
    this.box(0, 1.6, bz + .02, 3.11, 3.2, .18, this.mat.darkWood, true);
    this.box(0, 1.6, bz + .13, 2.85, 2.98, .04, this.mat.red);
    this.box(0, 3.31, bz + .04, 3.42, .17, .4, this.mat.wood, true);
    this.mesh(new THREE.TorusGeometry(.3, .022, 6, 48), this.mat.brass, [0, 2.99, bz + .2]);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; this.batch(BLOCK, this.mat.brass, [Math.cos(a) * .39, 2.99 + Math.sin(a) * .39, bz + .2], [.13, .027, .027], [0, 0, a]); }
    const light = new THREE.PointLight('#e7c78f', 5.4, 7, 2); light.position.set(0, 2.9, -4.3); this.group.add(light); this.lights.push(light);
    // A small suspended brass light ties the domestic ceiling to the low furniture.
    this.beam(new THREE.Vector3(0, 3.7, 1.9), new THREE.Vector3(0, 2.83, 1.9), .013, this.mat.metal);
    this.mesh(new THREE.TorusGeometry(.48, .025, 6, 48), this.mat.brass, [0, 2.82, 1.9], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, x = Math.cos(a) * .47, z = 1.9 + Math.sin(a) * .47; this.cylinder(x, 2.89, z, .024, .18, this.mat.cream); }
    const warm = new THREE.PointLight('#e6c292', 3.8, 8, 2); warm.position.set(0, 2.68, 1.9); this.group.add(warm); this.lights.push(warm);
  }
  atticInterior() {
    const rise = 1.8, slope = Math.atan2(rise, this.x), span = Math.hypot(this.x, rise);
    for (const side of [-1, 1]) this.batch(BOX, this.mat.darkWood, [side * this.x / 2, 3.9, 0], [span + .3, .18, this.d], [0, 0, -side * slope]);
    for (let z = -this.z + .8; z < this.z; z += 2.8) {
      for (const side of [-1, 1]) {
        this.beam(new THREE.Vector3(side * (this.x - .15), 3.0, z), new THREE.Vector3(0, 4.79, z), .11, this.mat.wood);
        this.beam(new THREE.Vector3(side * 3.2, 3.2, z), new THREE.Vector3(side * 1.05, 4.4, z), .055, this.mat.darkWood);
      }
      this.box(0, 3.22, z, 6.8, .15, .19, this.mat.wood, true);
    }
    for (let i = 0; i < 8; i++) {
      const x = (i % 2 ? 1 : -1) * (this.x - .85), z = -this.z + 1.1 + Math.floor(i / 2) * 2.6;
      if (this.nearRoute(x, z, .6)) continue;
      this.crate(x, z, this.rand(.7, 1.05));
      if (i % 3 === 0) this.crate(x + .1, z, .58, .95);
    }
    const back = -this.z + .18;
    this.box(0, 2.39, back, 1.48, 1.78, .13, this.mat.darkWood, true);
    const glass = new THREE.MeshStandardMaterial({ color: '#a6bdb4', emissive: '#799c91', emissiveIntensity: .42, roughness: .3 });
    this.box(0, 2.39, back + .085, 1.21, 1.51, .035, glass);
    this.box(0, 2.39, back + .13, .045, 1.57, .04, this.mat.wood); this.box(0, 2.39, back + .13, 1.22, .045, .04, this.mat.wood);
    this.box(0, 3.92, -this.z, this.w, 1.75, .13, this.mat.darkWood);
    this.box(0, 3.92, this.z, this.w, 1.75, .13, this.mat.darkWood);
    for (let i = 0; i < 6; i++) this.box(-3.1 + i * .13, .07 + i * .045, -3.8, 2.2 - i * .11, .09, .5, this.mat.wood, true, -.17);
    this.mist(0, 2.7, -2, 3.5, '#c8c6ab', .065); this.shaft(0, -3.1, 4.5, '#d8d1b5', .9);
    const light = new THREE.PointLight('#becfc0', 5.5, 8, 2); light.position.set(0, 2.45, back + .7); this.group.add(light); this.lights.push(light);
  }
  hatch() {
    for (const side of [-1, 1]) {
      this.box(side * 1.01, -.12, 0, .15, .32, 1.5, this.mat.darkWood, true);
      this.box(0, -.12, side * .7, 2.15, .32, .14, this.mat.darkWood, true);
      this.box(side * 1.02, -.98, 0, .17, 1.75, 1.55, this.mat.darkAshlar);
    }
    this.box(0, -1.75, 0, 2.1, .15, 1.6, this.mat.charcoal);
    this.box(0, -.98, -.79, 2.1, 1.75, .16, this.mat.darkAshlar);
    for (let i = 0; i < 7; i++) this.box(0, -.16 - i * .22, .55 - i * .175, 1.82, .19, .19, this.mat.limestone, true);
    const lid = this.mesh(new THREE.BoxGeometry(1.98, .085, 1.38), this.mat.wood, [0, .66, -.94], [-1.12, 0, 0]); lid.name = 'state:trapdoor:open';
    for (const x of [-.67, .67]) this.box(x, .075, -.75, .11, .08, .35, this.mat.metal, true);
    this.batch(CYLINDER, this.mat.red, [1.85, .15, .08], [.15, 1.5, .15], [Math.PI / 2, 0, 0]);
    this.collision(0, 0, 1.92, 1.32);
    const light = new THREE.PointLight('#b9854e', 3.8, 4, 2); light.position.set(0, -.7, -.5); this.group.add(light); this.lights.push(light);
  }
  courtyard() {
    this.ground(this.mat.moss, true);
    const target = this.room.objects.find(o => o.id === 'kitchen_window')?.position ?? [0, 0, -6];
    const back = target[2] - .18, width = Math.min(14, this.w * .65), center = target[0];
    // Exact opening matches the 1.08m frame at y=.81..2.17 in the window prop.
    for (const sign of [-1, 1]) this.box(center + sign * (width / 4 + .28), 2.6, back, width / 2 - .56, 5.2, .36, this.mat.plaster);
    this.box(center, .34, back, 1.12, .68, .36, this.mat.plaster);
    this.box(center, 3.73, back, 1.12, 3.0, .36, this.mat.plaster);
    this.box(center, .73, back + .15, 1.38, .16, .52, this.mat.cream, true);
    this.box(center, 2.27, back + .03, 1.38, .14, .38, this.mat.cream, true);
    for (const sign of [-1, 1]) this.box(center + sign * .64, 1.49, back + .03, .14, 1.57, .31, this.mat.cream, true);
    this.collision(center, back, width, .4);
    const rear = Math.max(-this.z + .8, back - 5.6), depth = back - rear;
    for (const sign of [-1, 1]) this.box(center + sign * width / 2, 2.6, back - depth / 2, .35, 5.2, depth, this.mat.plaster);
    this.box(center, 2.6, rear, width, 5.2, .35, this.mat.plaster);
    this.box(center, .1, back - depth / 2, width - .2, .12, depth, this.mat.darkWood);
    const eave = width / 2 + .45, roofRise = 2.2, roofLength = Math.hypot(eave, roofRise), roofAngle = Math.atan2(roofRise, eave);
    for (const sign of [-1, 1]) {
      this.batch(BOX, this.mat.roof, [center + sign * eave / 2, 5.22 + roofRise / 2, back - depth / 2], [roofLength, .16, depth + 1.0], [0, 0, -sign * roofAngle]);
      for (let row = 0; row < 10; row++) for (let col = 0; col < 12; col++) {
        const t = (row + .5) / 10;
        this.batch(BLOCK, col % 4 ? this.mat.roof : this.mat.slate, [center + sign * eave * t, 5.3 + roofRise * (1 - t), back - depth - .4 + col * (depth + .8) / 11], [roofLength / 10 + .03, .06, (depth + .8) / 11], [0, 0, -sign * roofAngle]);
      }
    }
    const gable = new THREE.BufferGeometry(); gable.setAttribute('position', new THREE.Float32BufferAttribute([-width / 2, 5.18, 0, width / 2, 5.18, 0, 0, 7.36, 0], 3)); gable.computeVertexNormals();
    this.mesh(gable, this.mat.plaster, [center, 0, back + .02]);
    this.box(center, 6.13, back + .075, .92, 1.07, .11, this.mat.darkWood, true);
    this.box(center, 6.13, back + .14, .72, .87, .045, this.mat.slate);
    this.box(center, 6.13, back + .18, .055, .91, .04, this.mat.cream); this.box(center, 6.13, back + .18, .75, .055, .04, this.mat.cream);
    for (const sign of [-1, 1]) {
      this.box(center + sign * (width / 2 - .08), 2.6, back + .22, .18, 5.2, .11, this.mat.cream);
      const wx = center + sign * 4.1;
      this.box(wx, 1.69, back + .22, 1.2, 1.68, .12, this.mat.darkWood, true);
      this.box(wx, 1.69, back + .3, .98, 1.45, .03, this.mat.slate);
      this.box(wx, 1.69, back + .35, .06, 1.51, .05, this.mat.cream);
      this.box(wx, 1.69, back + .35, 1.05, .06, .05, this.mat.cream);
    }
    for (let i = 0; i < 19; i++) {
      const y = .17 + i * .27;
      if (y > .75 && y < 2.3) for (const sign of [-1, 1]) this.box(center + sign * (width / 4 + .36), y, back + .191, width / 2 - .72, .021, .02, this.mat.cream);
      else this.box(center, y, back + .191, width, .021, .02, this.mat.cream);
    }
    for (const sign of [-1, 1]) {
      this.box(sign * (this.x - .7), .7, 0, .5, 1.4, this.d, this.mat.stone, true);
      this.box(sign * (this.x - .7), 1.46, 0, .66, .15, this.d, this.mat.darkStone, true);
      const bx = sign * this.w * .29;
      this.box(bx, .33, back + 2.1, 3.8, .55, 1.5, this.mat.darkWood, true);
      for (let j = 0; j < 7; j++) this.fern(bx + this.rand(-1.6, 1.6), back + 2.1 + this.rand(-.4, .4), this.rand(.65, 1.1));
      this.barrel(sign * (this.x - 2.5), -this.z + 5, .9);
    }
    const foliage = new THREE.MeshStandardMaterial({ map: leafTexture, alphaTest: .35, side: THREE.DoubleSide, roughness: 1, color: '#7e9753' });
    for (let i = 0; i < 13; i++) this.tree((i % 2 ? 1 : -1) * (this.x + this.rand(1, 5)), this.rand(-this.z, this.z + 4), this.rand(12, 20), foliage);
    for (let z = back + .8; z < this.z; z += 1.3) this.box(Math.sin(z * .3) * .15, -.01, z, 2.5, .08, 1.19, this.mat.floorSlab, true);
    for (let i = 0; i < 32; i++) {
      const x = this.rand(-width / 2, width / 2), y = this.rand(.3, 5.1);
      if (Math.abs(x - center) < 1.3 && y < 2.85) continue;
      this.batch(PLANE, foliage, [x, y, back + .24], [1.4, 1.5, 1], [0, 0, this.rand(-1, 1)]);
    }
    const light = new THREE.PointLight(this.flags.window_open ? '#efd2a2' : '#c29c69', this.flags.window_open ? 12 : 5, 6, 2); light.position.set(center, 1.6, back - 1.2); light.name = 'state:kitchen:window-light'; this.group.add(light); this.lights.push(light);
    this.mist(-this.x * .6, .7, -4, 9, '#b0c0a3', .09); this.shaft(2, -2, 20, '#e1dfb3', 2.4);
    this.exits('timber');
  }
  cellar() {
    this.ground(); this.paving(); this.walls(5.8);
    for (let z = -this.z + 1; z < this.z; z += 4) {
      this.box(0, 5.35, z, this.w, .5, .5, this.mat.darkWood, true);
      for (const s of [-1, 1]) this.box(s * (this.x - 1), 2.6, z, .45, 5.2, .45, this.mat.darkWood, true);
    }
    for (let i = 0; i < 11; i++) { const x = (i % 2 ? -1 : 1) * (this.x - 1.45), z = -this.z + 2 + Math.floor(i / 2) * 2.1; if (!this.nearRoute(x, z, 1.5)) this.barrel(x, z, this.rand(.9, 1.2)); }
    for (let i = 0; i < 5; i++) this.crate(-this.x + 2.2 + i % 2 * 1.3, this.z - 2 - Math.floor(i / 2) * 1.3, 1.15);
    this.torch(-this.x + .8, 2.7, 1, '#edaa64', 22); this.torch(this.x - .8, 2.7, -this.z + 2, '#e5b074', 17);
    this.box(0, 6, 0, this.w, .6, this.d, this.mat.charcoal); this.rubble(45);
  }
  bridge() {
    this.cavern(17);
    this.box(0, -.16, 0, 6.8, .32, this.d, this.mat.stone); this.paving(6.4, this.d, this.mat.limestone);
    // The west passage crosses the same fissure as the main bridge: it needs
    // its own supported deck instead of an apparent walk across black water.
    this.box(-this.x / 2, -.17, 0, this.x + .5, .34, 4.15, this.mat.darkAshlar);
    for (let x = -1; x > -this.x - .2; x -= 1.25) {
      for (const z of [-1.3, 0, 1.3]) this.box(x, .009, z, 1.19, .065, 1.25, this.mat.floorSlab, true);
      if (x < -4.5) for (const side of [-1, 1]) {
        this.box(x, .32, side * 2.17, 1.16, .64, .23, this.mat.ashlar, true);
        this.box(x, .69, side * 2.17, 1.2, .1, .31, this.mat.saltStone, true);
        this.collision(x, side * 2.17, 1.2, .31);
      }
    }
    for (const s of [-1, 1]) {
      this.box(s * (this.x / 2 + 1.8), -.02, 0, this.x - 3.6, .04, this.d, this.mat.charcoal);
      for (let z = -this.z + 3; z < this.z - 2; z += 3.6) {
        const x = s * 3.6;
        if (!this.nearRoute(x, z, 1.4)) {
          this.box(x, .45, z, .4, .9, 2.4, this.mat.stone, true); this.box(x, .96, z, .53, .16, 2.55, this.mat.darkStone, true); this.collision(x, z, .55, 2.5);
        }
        this.column(s * (this.x - 2.1), z, 13, .8, this.mat.darkStone);
      }
      this.mist(s * 6, .5, 0, 10, '#71928b', .17);
    }
    for (const z of [-this.z * .7, this.z * .7]) { this.arch(0, z, 7, 7.1, 0, this.mat.darkStone, 1.2); this.torch(-4.2, 2.4, z, '#ffc27b', 30); }
    this.shaft(0, -this.z * .4, 17, '#bed5cf', 3.3);
  }
  gallery() {
    this.ground(); this.paving(this.w - 1, this.d - 1, this.mat.paleStone); this.walls(8.6, this.mat.limestone);
    for (const s of [-1, 1]) for (let z = -this.z + 3.2; z < this.z - 1.5; z += 4.4) {
      this.column(s * (this.x - 1.5), z, 7.8, .46, this.mat.paleStone);
      const px = s * (this.x - .57);
      this.box(px, 3.3, z + 1.7, .18, 2.75, 1.85, this.mat.brass, true);
      this.box(px - s * .12, 3.3, z + 1.7, .11, 2.52, 1.62, this.mat.darkStone);
      // Funerary relief: angular headdress, face and shoulders cut into the panels.
      this.rock(px - s * .22, 3.48, z + 1.7, .12, .48, .34, this.mat.bone);
      this.box(px - s * .23, 2.78, z + 1.7, .18, .5, .9, this.mat.bone, true);
      this.batch(CONE, this.mat.brass, [px - s * .24, 4.1, z + 1.7], [.2, .4, .46], [0, 0, 0]);
      if (z < 0) this.torch(s * (this.x - 2.1), 2.6, z, '#e3be82', 15);
    }
    for (const x of [-2.5, 2.5]) this.box(x, .018, 0, .08, .025, this.d - 1, this.mat.brass);
    this.box(0, 8.9, 0, this.w, .5, this.d, this.mat.charcoal);
    this.mist(0, 6, 0, 8, '#a6babb', .08);
  }
  rotunda() {
    this.ground(this.mat.darkStone); this.walls(10.5, this.mat.darkStone);
    const radius = Math.min(this.x, this.z) * .76;
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; this.column(Math.cos(a) * radius, Math.sin(a) * radius, 9, .52, this.mat.paleStone); }
    for (const r of [2.3, 2.45, radius - 1.25, radius - .9]) {
      const torus = new THREE.TorusGeometry(r, .028, 5, 96); this.mesh(torus, this.mat.brass, [0, .035, 0], [Math.PI / 2, 0, 0]);
    }
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      this.box(Math.cos(a) * (radius - 2), .006, Math.sin(a) * (radius - 2), 1.35, .035, .11, this.mat.paleStone, false, -a);
    }
    const astrolabe = new THREE.Group(); astrolabe.position.set(0, 6.2, 0);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(1.5 + i * .13, .025, 6, 96), this.mat.brass); mesh.rotation.set(i * .7, i * .9, i * .45); astrolabe.add(mesh);
    }
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(.48, 2), new THREE.MeshStandardMaterial({ color: '#5b8590', roughness: .18, metalness: .8, emissive: '#3b667b', emissiveIntensity: .35 })); astrolabe.add(orb); this.group.add(astrolabe); this.animated.push({ object: astrolabe, kind: 'wheel' });
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; this.beam(new THREE.Vector3(Math.cos(a) * radius, 9.1, Math.sin(a) * radius), new THREE.Vector3(Math.cos(a) * 2.6, 13, Math.sin(a) * 2.6), .14, this.mat.darkStone); }
    this.mesh(new THREE.TorusGeometry(2.6, .22, 8, 96), this.mat.paleStone, [0, 13, 0], [Math.PI / 2, 0, 0]);
    this.shaft(0, 0, 17, '#b7d9df', 3.4);
    for (const s of [-1, 1]) this.torch(s * (radius - .8), 3, 0, '#e9c28a', 20);
  }
  maze() {
    this.ground(); this.paving(); this.walls(6.4);
    // Keep the camera clear of the masonry that closes the obsolete west arch.
    this.collision(-this.x, 0, .82, 6.6);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * this.x * .61, z = sz * this.z * .62;
        if (!this.nearRoute(x, z, 2.6)) {
          this.box(x, 2.4, z, Math.max(2, this.x * .45), 4.8, 1.2, this.mat.darkStone, true);
          this.box(x, 4.9, z, Math.max(2, this.x * .45) + .18, .24, 1.4, this.mat.stone, true);
          this.collision(x, z, Math.max(2, this.x * .45), 1.2);
        }
      }
      const archX = sx * this.x * .5;
      this.arch(archX, 0, 3.5, 2.3, Math.PI / 2, this.mat.stone, 1.2);
    }
    const shaftX = -9, shaftZ = 8, half = .85;
    this.box((-this.x + shaftX - half) / 2, 6.7, 0, this.x + shaftX - half, .5, this.d, this.mat.charcoal);
    this.box((this.x + shaftX + half) / 2, 6.7, 0, this.x - shaftX - half, .5, this.d, this.mat.charcoal);
    this.box(shaftX, 6.7, (-this.z + shaftZ - half) / 2, half * 2, .5, this.z + shaftZ - half, this.mat.charcoal);
    this.box(shaftX, 6.7, (this.z + shaftZ + half) / 2, half * 2, .5, this.z - shaftZ - half, this.mat.charcoal);
    for (const side of [-1, 1]) {
      this.box(shaftX + side * .96, 7.9, shaftZ, .22, 2.9, 2.14, this.mat.ashlar, true);
      this.box(shaftX, 7.9, shaftZ + side * .96, 1.7, 2.9, .22, this.mat.ashlar, true);
      this.beam(new THREE.Vector3(shaftX - .62, .12, shaftZ + side * .42), new THREE.Vector3(shaftX - .62, 8.9, shaftZ + side * .42), .047, this.mat.rust);
      for (let y = .8; y < 6.5; y += 1.8) this.beam(new THREE.Vector3(shaftX - .62, y, shaftZ + side * .42), new THREE.Vector3(shaftX - .84, y, shaftZ + side * .42), .033, this.mat.metal);
    }
    for (let y = .32; y < 9; y += .32) this.beam(new THREE.Vector3(shaftX - .62, y, shaftZ - .44), new THREE.Vector3(shaftX - .62, y, shaftZ + .44), .035, this.mat.metal);
    const sky = new THREE.MeshBasicMaterial({ color: '#bacac0', side: THREE.DoubleSide });
    const lightwell = this.mesh(new THREE.PlaneGeometry(1.69, 1.69), sky, [shaftX, 9.34, shaftZ], [Math.PI / 2, 0, 0]); lightwell.name = 'route:maze:daylight-shaft'; lightwell.castShadow = false;
    this.torch(-this.x + 1, 2.6, -this.z + 1, '#a8c7a0', 18); this.torch(this.x - 1, 2.6, this.z - 1, '#c29e61', 17); this.rubble(85);
  }
  cyclops() {
    this.cavern(14); this.paving(this.w * .6, this.d * .7);
    const x = -this.x + 3, z = -this.z + 3.5;
    this.box(x, 1.25, z, 4.2, 2.5, 3.4, this.mat.darkStone, true);
    this.box(x, 4.2, z - 1.5, 4.2, 6, .9, this.mat.stone, true);
    for (const s of [-1, 1]) { this.box(x + s * 2, 2.3, z, .65, 4.6, 3.7, this.mat.stone, true); this.rock(x + s * 2, 4.9, z - 1.2, .45, .65, .45, this.mat.darkStone); }
    if (!this.nearRoute(x, z, 3)) this.collision(x, z, 4.7, 4);
    this.beam(new THREE.Vector3(this.x - 3, .5, this.z - 3), new THREE.Vector3(this.x - 1.5, 1.3, this.z - 7), .72, this.mat.paleStone);
    for (let i = 0; i < 40; i++) {
      const px = this.rand(-this.x + 1, this.x - 1), pz = this.rand(-this.z + 1, this.z - 1);
      if (this.nearRoute(px, pz, 2)) continue;
      const len = this.rand(.2, .75), a = this.rand(0, Math.PI); this.beam(new THREE.Vector3(px, .11, pz), new THREE.Vector3(px + Math.cos(a) * len, .11, pz + Math.sin(a) * len), .035, this.mat.bone);
    }
    this.torch(this.x - 2.5, .8, -this.z + 3, '#e99654', 42); this.torch(-this.x + 1, 3.5, 2, '#b6834e', 20); this.mist(1, .5, -3, 7, '#9b8464', .14);
  }
  treasury() {
    this.ground(this.mat.darkStone); this.paving(this.w - 1, this.d - 1, this.mat.slate); this.walls(8.3, this.mat.darkStone);
    for (const s of [-1, 1]) for (let z = -this.z + 2.7; z < this.z - 1; z += 4.1) {
      this.column(s * (this.x - 1.7), z, 7.5, .44, this.mat.darkStone);
      for (const h of [.75, 6.7]) this.cylinder(s * (this.x - 1.7), h, z, .47, .22, this.mat.brass);
      if (this.nearRoute(s * (this.x - 2), z, 1.5)) continue;
      for (let i = 0; i < 28; i++) this.batch(CYLINDER, this.mat.gold, [s * (this.x - 1.9) + this.rand(-.65, .65), this.rand(.06, .3), z + this.rand(-.6, .6)], [.08, .025, .08], [this.rand(-.2, .2), 0, this.rand(-.2, .2)]);
    }
    for (const s of [-1, 1]) { this.box(s * (this.x - .55), 4.2, 0, .08, .025, this.d, this.mat.brass); this.torch(s * (this.x - 2), 3, s * this.z * .5, '#ffd796', 24); }
    this.box(0, 8.6, 0, this.w, .5, this.d, this.mat.charcoal);
    this.mist(0, 5, 0, 8, '#c9b688', .07);
  }
  pipe(points: number[][], radius: number, mat = this.mat.metal) {
    for (let i = 1; i < points.length; i++) {
      const a = new THREE.Vector3(...points[i - 1] as [number, number, number]), b = new THREE.Vector3(...points[i] as [number, number, number]);
      this.beam(a, b, radius, mat); this.rock(a.x, a.y, a.z, radius * 1.17, radius * 1.17, radius * 1.17, mat);
      const delta = b.clone().sub(a), length = delta.length();
      for (let t = 1; t < length; t += 2.5) {
        const p = a.clone().lerp(b, t / length), bandEnd = p.clone().add(delta.clone().normalize().multiplyScalar(.1)); this.beam(p, bandEnd, radius * 1.22, this.mat.rust);
      }
    }
  }
  dam() {
    this.ground(this.mat.darkStone); this.walls(13, this.mat.limestone);
    // A shallow barrel vault meets the existing pier heads; the machine hall
    // must read as an enclosed structure, not a set of walls beneath the sky.
    const vaultSpring = 11, vaultRadius = this.x - 1.2, vaultRise = 5.3;
    this.cathedralVault(vaultSpring, vaultRadius, vaultRise);
    for (let z = -this.z + 3; z < this.z - 2; z += 4) {
      for (let i = 0; i < 26; i++) {
        const a = i / 26 * Math.PI, b = (i + 1) / 26 * Math.PI;
        const x1 = Math.cos(a) * vaultRadius, x2 = Math.cos(b) * vaultRadius;
        const y1 = vaultSpring + Math.sin(a) * vaultRise, y2 = vaultSpring + Math.sin(b) * vaultRise;
        this.batch(BLOCK, this.mat.ashlar, [(x1 + x2) / 2, (y1 + y2) / 2, z], [Math.hypot(x2 - x1, y2 - y1) + .015, .38, .68], [0, 0, Math.atan2(y2 - y1, x2 - x1)]);
      }
      for (const side of [-1, 1]) this.box(side * vaultRadius, 10.84, z, 1.3, .42, 1.3, this.mat.saltStone, true);
    }
    const drained = !!this.flags.reservoir_drained;
    if (!drained) this.water(0, -this.z * .4, this.w - 2, this.d * .35, -.022, '#315a5b').name = 'state:dam:full-water';
    else {
      this.water(-this.x * .6, -this.z * .5, this.w * .19, this.d * .12, -.036, '#344e48').name = 'state:dam:drained-puddle';
      this.water(this.x * .6, -this.z * .44, this.w * .12, this.d * .1, -.033, '#344e48');
      for (let i = 0; i < 28; i++) {
        const x = this.rand(-this.x + 2, this.x - 2), z = this.rand(-this.z * .72, -this.z * .2);
        if (!this.nearRoute(x, z, 2)) this.rock(x, -.025, z, this.rand(.4, 1), .05, this.rand(.4, .9), this.mat.moss);
      }
    }
    for (const s of [-1, 1]) {
      this.box(s * this.x * .54, -.025, 0, this.x * .7, .07, this.d - 1, this.mat.slate);
      for (let z = -this.z + 3; z < this.z - 2; z += 4) this.column(s * (this.x - 1.2), z, 11, .65, this.mat.limestone);
      this.pipe([[s * (this.x - 1.1), 1.5, this.z - 2], [s * (this.x - 1.1), 7.8, this.z - 2], [s * (this.x - 1.1), 7.8, -this.z + 2], [s * (this.x - 1.1), 2.5, -this.z + 2]], .35, this.mat.rust);
    }
    // Each slab has its own metre-scale UVs. Stretching a single box across
    // the whole causeway made the rock photograph look like a dirt mound.
    const causeway = ['#858c7d', '#737d73', '#93988a'].map((tint, i) => {
      const material = this.mat.floorSlab.clone(); material.color.set(tint); material.roughness = .76 + i * .045; material.normalScale.setScalar(.22);
      for (const key of ['map', 'normalMap', 'roughnessMap'] as const) if (material[key]) {
        material[key] = material[key]!.clone(); material[key]!.repeat.set(.78, .78); material[key]!.offset.set(i * .23, i * .17);
      }
      return material;
    });
    const rows = Math.ceil(this.d / 1.5), step = this.d / rows;
    for (let row = 0; row < rows; row++) {
      const z = -this.z + (row + .5) * step;
      for (let col = 0; col < 4; col++) {
        const variant = (row * 7 + col * 5) % 13, worn = variant < 3;
        this.box(-2.25 + col * 1.5, .012, z, worn ? 1.438 : 1.472, .08, step - (worn ? .055 : .025), causeway[variant % 3], true, (row + col) % 2 * Math.PI);
      }
      for (const side of [-1, 1]) this.box(side * 3.085, .028, z, .14, .09, step - .035, this.mat.saltStone, true);
    }
    for (const x of [-4.2, 4.2]) {
      const z = -this.z + 1.25;
      if (Math.abs(x) < this.x - 2) {
        this.mesh(new THREE.TorusGeometry(2.2, .22, 10, 64), this.mat.metal, [x, 5.4, z]);
        this.mesh(new THREE.CircleGeometry(2, 48), this.mat.charcoal, [x, 5.4, z + .02]);
        for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; this.batch(BLOCK, this.mat.metal, [x + Math.cos(a) * 1.23, 5.4 + Math.sin(a) * 1.23, z + .1], [.18, 1.65, .12], [0, 0, a - Math.PI / 2 + .12]); }
        this.pipe([[x, 3, z], [x, 1.1, z], [x, 1.1, z + 2]], .7, this.mat.rust);
      }
    }
    // The northern sluice physically rises when the controls drain the basin.
    const gate = this.mesh(new THREE.BoxGeometry(3.7, 5.2, .28), this.mat.metal, [0, drained ? 7.6 : 2.62, -this.z + 1.1]);
    gate.name = drained ? 'state:sluice:raised' : 'state:sluice:closed';
    for (const s of [-1, 1]) {
      this.box(s * 2.05, 5.6, -this.z + 1.05, .27, 11.2, .6, this.mat.rust, true);
      this.pipe([[s * 2.1, .8, -this.z + 1.7], [s * 2.1, 11.4, -this.z + 1.7]], .11, this.mat.brass);
    }
    for (let i = 0; i < 6; i++) this.box(0, (drained ? 5.25 : .25) + i * .84, -this.z + 1.28, 3.55, .12, .17, this.mat.darkAshlar, true);
    const lampColor = this.flags.dam_leak ? '#d5724c' : this.flags.controls_enabled ? '#91cba0' : '#5d6860';
    const lamp = this.mesh(new THREE.SphereGeometry(.13, 12, 8), new THREE.MeshStandardMaterial({ color: lampColor, emissive: lampColor, emissiveIntensity: this.flags.controls_enabled ? 1.1 : .08, roughness: .25 }), [0, 1.52, -7.46]); lamp.name = 'state:dam:control-lamp';
    this.box(0, 1.52, -7.58, .44, .5, .13, this.mat.darkWood, true);
    const lampGlass = new THREE.MeshStandardMaterial({ color: '#b4c7c8', emissive: '#86aeb5', emissiveIntensity: .8, roughness: .28 });
    for (const z of [-8, 8]) {
      const ceilingY = vaultSpring + vaultRise + .46;
      this.cylinder(0, (8.9 + ceilingY) / 2, z, .032, ceilingY - 8.9, this.mat.metal);
      this.cylinder(0, 8.9, z, .48, .19, this.mat.metal);
      this.mesh(new THREE.SphereGeometry(.25, 12, 8), lampGlass, [0, 8.72, z]);
      const light = new THREE.PointLight('#b2cbd1', 16, 23, 2); light.position.set(0, 8.45, z); this.group.add(light); this.lights.push(light);
    }
    const gateLight = new THREE.PointLight('#e6b777', 23, 17, 2); gateLight.position.set(0, 6.5, -this.z + 4.5); this.group.add(gateLight); this.lights.push(gateLight);
    this.torch(-this.x + 1, 3.5, this.z * .2, '#c3d9d2', 25); this.torch(this.x - 1, 3.5, -this.z * .3, '#e8b572', 28); this.mist(0, .65, -this.z * .6, 9, '#b3d4d2', .2);
  }
  reservoir() {
    this.cavern(14);
    const drained = !!this.flags.reservoir_drained;
    if (!drained) this.water(0, 0, this.w - 1, this.d - 1, -.035, '#274e4d').name = 'state:reservoir:full-water';
    else {
      this.ground(this.mat.floorSlab, true, -.065);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        this.water(sx * this.x * .65, sz * this.z * .61, this.w * .17, this.d * .18, -.042, '#314947').name = 'state:reservoir:remaining-water';
      }
      for (let i = 0; i < 70; i++) {
        const x = this.rand(-this.x + 1, this.x - 1), z = this.rand(-this.z + 1, this.z - 1);
        if (this.nearRoute(x, z, 2.3)) continue;
        this.batch(SMALLROCK, i % 3 ? this.mat.moss : this.mat.darkAshlar, [x, -.025, z], [this.rand(.35, 1.1), .035, this.rand(.25, .8)], [0, this.rand(0, Math.PI), 0]);
      }
    }
    this.box(0, -.02, 0, 5.2, .09, this.d, this.mat.ashlar); this.box(0, -.021, 0, this.w, .09, 4.5, this.mat.ashlar);
    for (const object of this.room.objects) {
      const x = object.position[0], z = object.position[2], length = Math.hypot(x, z);
      if (length < 3) continue;
      this.box(x / 2, -.045, z / 2, length + 2.2, .12, 2.3, this.mat.ashlar, false, -Math.atan2(z, x));
    }
    for (const mirror of this.room.objects.filter(object => object.type === 'mirror')) {
      // The reciprocal mirror arrival faces east, so its landing joins the
      // radial causeway across the shallow water instead of ending beside it.
      const x = mirror.position[0] + 2.05, z = mirror.position[2];
      this.box(x, -.022, z, 5.9, .1, 3.1, this.mat.darkAshlar);
      for (let col = 0; col < 5; col++) for (let row = 0; row < 3; row++) this.box(x - 2.36 + col * 1.18, .028, z - 1.03 + row * 1.03, 1.15, .06, 1, this.mat.floorSlab, true);
      for (const side of [-1, 1]) this.box(x, .051, z + side * 1.55, 5.92, .08, .12, this.mat.saltStone, true);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * this.x * .62, z = sz * this.z * .57; this.column(x, z, 11.5, .65, this.mat.ashlar);
      this.arch(x, z, 4.7, 8.5, 0, this.mat.limestone, 1.1);
      this.cylinder(x, 1.16, z, .67, .34, this.mat.darkAshlar);
    }
    for (let i = 0; i < 10; i++) this.box(0, .01, this.z * .55 + i * .32, 5.9, .11, .28, this.mat.wood);
    this.mist(-3, drained ? .35 : .8, -5, 10, '#94baba', drained ? .075 : .2); this.shaft(this.x * .5, -3, 17, '#b9d6d1', 3.4);
    const light = new THREE.PointLight('#6eaaa9', 32, 20, 2); light.position.set(0, 7, -4); this.group.add(light); this.lights.push(light);
  }
  waterfall(x: number, z: number, width: number, height: number) {
    const material = createFallsMaterial();
    for (let i = 0; i < 20; i++) {
      const px = x - width / 2 + i / 19 * width, strip = this.mesh(PLANE, material, [px, height / 2, z + this.rand(-.18, .18)]); strip.scale.set(this.rand(.18, .55), height * this.rand(.96, 1.03), 1);
      this.animated.push({ object: strip, kind: 'waterfall', baseY: height / 2 });
    }
    this.mist(x, 1.6, z + 1.4, width * 1.7, '#dfefdf', .35); this.mist(x - 2, .4, z + 3, width * 1.5, '#a8caca', .2);
    for (let i = 0; i < 5; i++) this.mesh(new THREE.TorusGeometry(.9 + i * .5, .015, 5, 64), new THREE.MeshBasicMaterial({ color: '#d7e9db', transparent: true, opacity: .22 - i * .03 }), [x, -.035, z + 1], [Math.PI / 2, 0, 0]);
  }
  falls(rainbow = false) {
    this.cavern(19, this.mat.rock, false); this.water(0, -this.z / 2 - 1, this.w - 1, this.z - 2, -.13, '#305b5c');
    const x = -this.x * .46, z = -this.z + 1.9;
    this.waterfall(x, z, Math.min(6.3, this.w * .3), 18);
    for (let i = 0; i < 28; i++) { const xx = this.rand(-this.x + 1, this.x - 1), zz = this.rand(-this.z + 1, this.z - 1); if (!this.nearRoute(xx, zz, 2.7)) this.fern(xx, zz, this.rand(.6, 1.4)); }
    // The west route crosses an actual river gorge. Dry land ends at each ledge.
    this.box(1.65, -.02, 0, 2.05, .08, this.d, this.mat.moss);
    this.box(12, -.015, 0, 22.8, .08, 4.5, this.mat.moss);
    this.box(0, -.02, 10, 5.5, .08, this.d - 20, this.mat.moss);
    this.shaft(2, -4, 20, '#dbeac6', 4);
    const solid = rainbow || !!this.flags.rainbow_solid;
    this.rainbowSpan(RAINBOW_BRIDGE.start, RAINBOW_BRIDGE.end, solid, true);
    const gorgeWater = this.water(-11.5, 1.8, 25, 7.4, -5.9, '#173f4c'); gorgeWater.name = 'route:rainbow:gorge-water';
    for (const bankZ of [-2.03, 5.64]) this.box(-11.5, -3.08, bankZ, 25, 6.15, .3, this.mat.darkAshlar);
    this.box(0, -2.9, 4, 4.8, 5.8, 5.5, this.mat.rock);
    this.box(0, .017, 4, 4.8, .085, 5.5, this.mat.floorSlab, true);
    this.box(-22.3, -2.9, -1.2, 4.4, 5.8, 5.4, this.mat.rock);
    this.box(-22.3, .017, -1.2, 4.4, .085, 5.4, this.mat.floorSlab, true);
    // Steep rock bounds the far promontory. Its north edge cannot be reached by
    // walking around the unsolid rainbow across the shallow-looking water.
    this.box(-22.2, 1.8, -4.5, 4.65, 3.7, .7, this.mat.darkAshlar, true);
    this.box(-19.8, 1.8, -3.03, .65, 3.7, 3.65, this.mat.darkAshlar, true);
    this.collision(-22.2, -4.5, 4.65, .7); this.collision(-19.8, -3.03, .65, 3.65);
    for (let i = 0; i < 9; i++) {
      this.rock(-24.1 + i * .5, 2.9, -4.61, .48, .85 + i % 3 * .16, .42, this.mat.rock);
      if (i < 7) this.rock(-19.65, 2.75, -4.48 + i * .48, .4, .8 + i % 2 * .17, .45, this.mat.mossStone);
    }
    for (let i = 0; i < 34; i++) {
      const px = -23.5 + i * .69, pz = i % 2 ? 5.58 : -1.96;
      if (px > -2.8 || px < -19.7) continue;
      this.rock(px, -.42, pz, .56, .72, .4, i % 3 ? this.mat.rock : this.mat.mossStone);
    }
    // Shoreline cells are collision only where there is no ledge or solid span.
    // The raised surface and its side-step constraint share route-surfaces.ts.
    const { start, end, width } = RAINBOW_BRIDGE, dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz);
    for (let px = -23.6; px < 1; px += .8) for (let pz = -1.5; pz < 5.5; pz += .8) {
      const startLedge = px > -2.65 && pz > 1.05, endLedge = px < -19.7 && pz < 1.8;
      const t = ((px - start[0]) * dx + (pz - start[1]) * dz) / (length * length);
      const side = Math.abs(-(px - start[0]) * dz + (pz - start[1]) * dx) / length;
      if (startLedge || endLedge || solid && t > -.04 && t < 1.04 && side < width / 2 + .96) continue;
      this.collision(px, pz, .8, .8);
    }
  }
  rainbowSpan(start: number[], end: number[], solid: boolean, walkable: boolean) {
    const dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz), segments = 96, across = 28;
    const ribbon = (surface: boolean) => {
      const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
      for (let j = 0; j <= segments; j++) for (let band = 0; band <= across; band++) {
        const t = j / segments, v = band / across, side = (v - .5) * RAINBOW_BRIDGE.width;
        const x = start[0] + dx * t, z = start[1] + dz * t, y = rainbowHeight(t);
        positions.push(x + (surface ? -dz / length * side : 0), y + (surface ? 0 : (.5 - v) * 1.65), z + (surface ? dx / length * side : .015));
        uvs.push(t, v);
        if (j < segments && band < across) { const p = j * (across + 1) + band, next = p + across + 1; indices.push(p, next, p + 1, p + 1, next, next + 1); }
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
    };
    // The forest approaches along the span, so a vertical ribbon would be
    // invisible edge-on. Spread that unsolid spectrum across the channel;
    // its transparent mist remains distinct from the edged, solid bridge.
    const approachSpectrum = !walkable && !solid;
    const bowMaterial = createRainbowMaterial(false); if (solid) bowMaterial.opacity = .24; else if (approachSpectrum) bowMaterial.opacity = .46;
    const bow = this.mesh(ribbon(approachSpectrum), bowMaterial, [0, 0, 0]); bow.name = 'route:rainbow:spectrum'; bow.castShadow = false; bow.renderOrder = 2;
    if (approachSpectrum) {
      // The insubstantial forest spectrum resolves only from the gorge's
      // approach. The cast bridge and the rainbow at Aragain Falls stay visible.
      const observer = new THREE.Vector3();
      bow.onBeforeRender = (_renderer, _scene, camera) => {
        camera.getWorldPosition(observer);
        const distance = Math.hypot(observer.x - start[0], observer.z - start[1]);
        bowMaterial.opacity = .46 * (1 - THREE.MathUtils.smoothstep(distance, 18, 28));
      };
    }
    if (!solid) return;
    const span = this.mesh(ribbon(true), createRainbowMaterial(true), [0, 0, 0]); span.name = walkable ? 'route:rainbow:walkable-span' : 'route:rainbow:distant-span'; span.castShadow = false;
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#e8d4a5', emissive: '#d6d3ac', emissiveIntensity: .42, roughness: .25, metalness: .15 });
    for (const side of [-1, 1]) {
      const points = Array.from({ length: 49 }, (_, i) => {
        const t = i / 48, offset = side * (RAINBOW_BRIDGE.width / 2 + .035);
        return new THREE.Vector3(start[0] + dx * t - dz / length * offset, rainbowHeight(t) + .11, start[1] + dz * t + dx / length * offset);
      });
      const edge = this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 128, .043, 8, false), edgeMaterial, [0, 0, 0]); edge.castShadow = false;
    }
    for (const t of [.18, .5, .82]) {
      const light = new THREE.PointLight('#a8cbd9', 3, 7, 2); light.position.set(start[0] + dx * t, rainbowHeight(t) + .2, start[1] + dz * t); this.group.add(light); this.lights.push(light);
    }
  }
  cathedral(altar = false) {
    const h = altar ? 16 : 18;
    this.ground(this.mat.darkAshlar); this.paving(this.w - 1, this.d - 1, this.mat.floorSlab); this.walls(h - 3, this.mat.darkStone);
    this.cathedralVault(h - 4, this.x * .58);
    for (const s of [-1, 1]) for (let z = -this.z + 2.6; z < this.z - 1; z += 4.7) {
      const x = s * this.x * .58; this.column(x, z, h - 4, .62, this.mat.limestone);
      if (s > 0) this.arch(0, z, this.x * 1.16, h - 4, 0, this.mat.ashlar, .45);
      const radius = this.x * .58;
      for (let j = 0; j < 9; j++) {
        const point = (a: number) => new THREE.Vector3(s * radius * Math.cos(a), h - 4 + radius * Math.sin(a), z + 2.35 * Math.sin(a));
        this.beam(point(j / 9 * Math.PI / 2), point((j + 1) / 9 * Math.PI / 2), .105, this.mat.ashlar);
      }
      if (s > 0) this.box(0, h - 4 + radius, z + 2.35, .5, .35, .52, this.mat.saltStone, true);
      if (!altar && !this.nearRoute(s * this.x * .74, z, 2)) {
        this.box(s * this.x * .74, .5, z, this.x * .28, .14, .7, this.mat.darkWood, true); this.box(s * this.x * .74, .94, z - .34, this.x * .28, .85, .13, this.mat.darkWood, true);
      }
      // Deep pilasters and recessed stone panels articulate the perimeter wall.
      this.box(s * (this.x - .56), 5.6, z, .55, 10.9, 1.13, this.mat.ashlar, true);
      for (const y of [.4, 3.7, 7.4, 10.7]) this.box(s * (this.x - .69), y, z, .81, .15, 1.46, this.mat.saltStone, true);
      this.box(s * (this.x - .7), .23, z + 1.8, .9, .35, 1.7, this.mat.mossStone, true);
    }
    for (const x of [-1.6, 1.6]) this.box(x, .04, 0, .05, .025, this.d, this.mat.brass);
    const rose = new THREE.Group(); rose.position.set(0, 10.3, -this.z + .48);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.55, .19, 8, 64), this.mat.paleStone); rose.add(rim);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const glass = new THREE.Mesh(new THREE.CircleGeometry(.57, 6), new THREE.MeshStandardMaterial({ color: i % 2 ? '#8ca5a2' : '#a48151', emissive: i % 2 ? '#467983' : '#a06d36', emissiveIntensity: .65, roughness: .2, side: THREE.DoubleSide })); glass.position.set(Math.cos(a) * 1.7, Math.sin(a) * 1.7, .02); glass.rotation.z = a; rose.add(glass);
      const spoke = new THREE.Mesh(BOX, this.mat.paleStone); spoke.position.set(Math.cos(a) * 1.3, Math.sin(a) * 1.3, .05); spoke.scale.set(2.35, .08, .1); spoke.rotation.z = a; rose.add(spoke);
    }
    rose.add(new THREE.Mesh(new THREE.CircleGeometry(.67, 32), new THREE.MeshStandardMaterial({ color: '#cebb8d', emissive: '#b39962', emissiveIntensity: .7, side: THREE.DoubleSide }))); this.group.add(rose);
    this.shaft(0, -this.z * .5, 20, '#d4dcb8', 3.3);
    this.candles(-this.x * .5, -this.z * .6, 16); this.candles(this.x * .5, -this.z * .6, 14);
    this.mist(0, .5, -3, 10, '#b2c8c0', .11); this.rubble(100);
    if (!altar) this.templeAltar();
    if (this.room.id === 'temple') this.templeRope(h - 4 + this.x * .58 + .46);
    if (altar) {
      const az = -this.z * .59;
      this.box(0, .46, az, 3.8, .85, 1.55, this.mat.darkStone, true); this.box(0, .98, az, 4.1, .23, 1.85, this.mat.paleStone, true);
      this.mesh(new THREE.TorusGeometry(1.55, .045, 6, 80), this.mat.brass, [0, 4.6, az - .5]);
      for (let i = 0; i < 7; i++) { const y = 2 + i * .66; this.box(0, y, az - .55, .9 - i * .04, .55, .45, this.mat.darkStone, true, i * .22); }
      const light = new THREE.PointLight('#cadcc4', 24, 14, 2); light.position.set(0, 4, az + 1); this.group.add(light); this.lights.push(light);
    }
  }
  cathedralVault(spring: number, radius: number, rise = radius) {
    const r = radius + .46, segments = 48, bays = this.room.id === 'temple' ? 38 : 20, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let j = 0; j <= bays; j++) for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI;
      positions.push(Math.cos(a) * r, spring + Math.sin(a) * (rise + .46), -this.z - 1 + j / bays * (this.d + 2));
      uvs.push(a * r / 4, j / bays * (this.d + 2) / 4);
    }
    for (let j = 0; j < bays; j++) for (let i = 0; i < segments; i++) {
      const midX = Math.cos((i + .5) / segments * Math.PI) * r, midZ = -this.z - 1 + (j + .5) / bays * (this.d + 2);
      if (this.room.id === 'temple' && Math.abs(midX) < .85 && Math.abs(midZ - 16) < .85) continue;
      const p = j * (segments + 1) + i; indices.push(p, p + 1, p + segments + 1, p + 1, p + segments + 2, p + segments + 1);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const vault = this.mat.darkAshlar.clone(); vault.color.set('#4b5650'); vault.side = THREE.DoubleSide; vault.roughness = .96;
    const shell = this.mesh(geometry, vault, [0, 0, 0]); shell.name = 'architecture:solid-stone-vault';
    const end = new THREE.Shape(); end.moveTo(-r, spring); end.lineTo(r, spring); end.absellipse(0, spring, r, rise + .46, 0, Math.PI, false, 0); end.closePath();
    const cap = new THREE.ShapeGeometry(end, 36), uv = cap.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
    for (const side of [-1, 1]) this.mesh(cap, vault, [0, 0, side * (this.z + .38)]);
    for (const side of [-1, 1]) {
      const aisle = this.x - radius + .7;
      this.box(side * (radius + aisle / 2 - .2), spring + .15, 0, aisle + .4, .55, this.d + 2, vault, true);
      // Continuous spring courses connect each rib to the supporting arcade.
      this.box(side * radius, spring -.1, 0, .88, .38, this.d + .7, this.mat.ashlar, true);
      for (let z = -this.z + 2.6; z < this.z - 1; z += 4.7) this.box(side * radius, spring -.42, z, 1.13, .38, 1.2, this.mat.saltStone, true);
    }
  }
  templeRope(ceiling: number) {
    const shaft = this.mat.darkAshlar.clone(); shaft.side = THREE.DoubleSide;
    this.mesh(new THREE.CylinderGeometry(1.15, 1.15, 5, 32, 1, true), shaft, [0, ceiling + 2.2, 16]);
    this.mesh(new THREE.TorusGeometry(1.09, .17, 8, 48), this.mat.ashlar, [0, ceiling -.14, 16], [Math.PI / 2, 0, 0]);
    this.mesh(new THREE.CircleGeometry(1.13, 32), this.mat.charcoal, [0, ceiling + 4.65, 16], [Math.PI / 2, 0, 0]);
    if (!this.flags.dome_secured) return;
    const rope = color('#aa9573'), points = [new THREE.Vector3(.04, .17, 16.08), new THREE.Vector3(.09, 3, 16.04), new THREE.Vector3(-.08, 11, 15.97), new THREE.Vector3(0, ceiling + 3.9, 16)];
    const line = this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 100, .044, 8, false), rope, [0, 0, 0]); line.name = 'route:temple:secured-rope';
    for (let y = .5; y < ceiling; y += 1.8) this.mesh(new THREE.TorusGeometry(.061, .022, 5, 12), rope, [0, y, 16], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) this.mesh(new THREE.TorusGeometry(.18 + i * .043, .027, 6, 28), rope, [.15, .056 + i * .019, 16.2], [Math.PI / 2, 0, 0]);
    const light = new THREE.PointLight('#b6c2b3', 5, 8, 2); light.position.set(0, ceiling - 1, 16); this.group.add(light); this.lights.push(light);
  }
  templeAltar() {
    const az = -8.5, black = this.mat.darkAshlar, trim = this.mat.limestone;
    // The three ritual objects are supplied by campaign props on this tabletop.
    this.box(0, .065, az, 5.6, .13, 2.7, black, true);
    this.box(0, .21, az, 4.8, .22, 2.12, trim, true);
    this.box(0, .6, az, 4.2, .75, 1.56, black, true);
    this.box(0, 1.005, az, 4.6, .18, 1.94, this.mat.marble, true);
    this.collision(0, az, 4.3, 1.8);
    for (const side of [-1, 1]) {
      this.box(side * 2.0, .61, az + .8, .15, .63, .1, trim, true);
      this.box(side * 2.0, .94, az + .83, .24, .075, .14, this.mat.brass, true);
      this.box(side * 2.0, .3, az + .83, .24, .075, .14, this.mat.brass, true);
    }
    this.box(0, .6, az + .795, 3.52, .44, .024, this.mat.charcoal, true);
    for (let i = 0; i < 19; i++) {
      const x = -1.57 + i * .175;
      this.box(x, .62, az + .821, .022, .15 + (i % 3) * .024, .014, this.mat.brass);
      this.box(x + .03, .68, az + .823, .063, .018, .014, this.mat.brass, false, 0);
      if (i % 2) this.box(x - .024, .57, az + .823, .058, .019, .014, this.mat.brass);
    }
    for (const radius of [3.25, 3.5]) this.mesh(new THREE.TorusGeometry(radius, .025, 5, 96), this.mat.brass, [0, .058, az], [Math.PI / 2, 0, 0]);
    for (let j = 0; j < 12; j++) {
      const a = j * Math.PI / 6, x = Math.cos(a) * 3.38, z = az + Math.sin(a) * 3.38;
      this.box(x, .057, z, .1, .019, .29, this.mat.darkAshlar, true, -a);
    }
    // The worn processional stones establish a route and lead the eye to the rite.
    const aisle = this.mat.darkAshlar.clone(); aisle.color.set('#6b7564'); aisle.roughness = .75;
    for (let z = az + 2.1; z < this.z - .9; z += 1.24) {
      for (const side of [-1, 1]) {
        const worn = this.rnd() < .18;
        this.box(side * .71, .032, z, worn ? 1.31 : 1.36, .06, 1.16, worn ? this.mat.ashlar : aisle, true, worn ? this.rand(-.016, .016) : 0);
        this.box(side * 1.51, .025, z, .15, .055, 1.17, this.mat.saltStone, true);
        if (worn) this.batch(SMALLROCK, this.mat.saltStone, [side * 1.38, .062, z + .4], [.08, .025, .1], [0, this.rand(0, Math.PI), 0]);
      }
    }
    // A broken reliquary and cloth standards give the ritual a readable silhouette.
    const back = az - 3.1;
    this.box(0, 2.72, back, 2.7, 5.44, .67, black, true);
    this.box(0, 2.88, back + .365, 2.22, 4.82, .14, this.mat.charcoal, true);
    for (const x of [-1.35, 1.35]) {
      this.box(x, 2.77, back + .1, .31, 5.54, .76, trim, true);
      for (const y of [.19, 1.24, 4.82, 5.49]) this.box(x, y, back + .1, .48, .14, .92, this.mat.saltStone, true);
    }
    this.arch(0, back, 2.12, 4.8, 0, this.mat.ashlar, .63);
    this.mesh(new THREE.TorusGeometry(.8, .052, 8, 64), this.mat.brass, [0, 3.72, back + .49]);
    for (const x of [-.17, .17]) this.box(x, 3.36, back + .53, .053, 2.5, .055, this.mat.brass, true);
    for (const y of [2.43, 3.18, 3.88, 4.55]) this.box(0, y, back + .53, .73, .055, .06, this.mat.brass, true);
    for (const s of [-1, 1]) {
      this.templeBanner(s * 4.25, 6.4, back + .3, s);
      this.cylinder(s * 3.3, .58, az - .6, .29, 1.1, this.mat.ashlar);
      this.torch(s * 3.3, 1.68, az - .6, '#e7bf7f', 8.5);
      this.candles(s * 2.92, az + .63, 11);
      for (let i = 0; i < 7; i++) this.rock(s * (3.0 + this.rand(0, 1.6)), .06, back + this.rand(-1.2, .5), this.rand(.12, .35), .13, this.rand(.1, .27), this.mat.mossStone);
    }
    const focal = new THREE.PointLight('#e0c896', 18, 15, 2); focal.position.set(0, 3.5, az + 1.4); this.group.add(focal); this.lights.push(focal);
    const face = new THREE.PointLight('#ddbc87', 3.3, 4.8, 2); face.position.set(0, 1.25, az + 1.7); this.group.add(face); this.lights.push(face);
    const cold = new THREE.PointLight('#6e9899', 8, 13, 2); cold.position.set(0, 6.5, back - 2.7); this.group.add(cold); this.lights.push(cold);
  }
  templeBanner(x: number, top: number, z: number, sign: number) {
    const width = 1.58, height = 3.6, geometry = new THREE.PlaneGeometry(width, height, 8, 22), position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i), y = position.getY(i), t = (height / 2 - y) / height;
      position.setZ(i, Math.sin(px * 8 + .3) * .062 + Math.sin(t * 5.1) * .1 * sign);
      if (t > .98) position.setY(i, y + .06 + (Math.sin(px * 34) + 1) * .05);
    }
    geometry.computeVertexNormals();
    const cloth = new THREE.MeshStandardMaterial({ color: sign > 0 ? '#5e6556' : '#785e43', map: ashlarTexture ?? null, roughness: .99, side: THREE.DoubleSide });
    this.mesh(geometry, cloth, [x, top - height / 2, z]);
    this.box(x, top + .025, z, 1.96, .07, .09, this.mat.brass, true);
    this.beam(new THREE.Vector3(x, top + .05, z), new THREE.Vector3(x, top + 2.5, z), .018, this.mat.metal);
    for (const side of [-1, 1]) this.box(x + side * .7, top - height / 2, z + .08, .038, height - .16, .015, this.mat.brass);
    this.mesh(new THREE.TorusGeometry(.35, .018, 5, 48), this.mat.brass, [x, top - 1.2, z + .09]);
    for (const y of [top - 1.75, top - 1.22, top - .69]) this.box(x, y, z + .103, y === top - 1.22 ? .97 : .5, .028, .015, this.mat.brass);
    this.box(x, top - 1.21, z + .105, .028, 1.66, .015, this.mat.brass);
  }
  underworld() {
    this.cavern(16, this.mat.charcoal); this.water(0, 0, this.w, this.d, -.09, '#172b2c');
    this.box(0, -.015, 0, 5.5, .07, this.d, this.mat.darkStone); this.box(0, -.02, 0, this.w, .07, 4.8, this.mat.darkStone);
    for (const s of [-1, 1]) for (let z = -this.z + 2; z < this.z; z += 3.4) {
      const x = s * (this.x - 2);
      this.column(x, z, 9.5, .44, this.mat.charcoal);
      for (let j = 0; j < 7; j++) {
        const y = .5 + j * .62;
        this.rock(x - s * .55, y, z, .17, .19, .2, this.mat.bone);
        this.box(x - s * .7, y - .04, z, .05, .05, .14, this.mat.charcoal);
      }
    }
    const gateZ = -5.9, opened = !!this.flags.hades_open;
    this.arch(0, gateZ, 6.4, 5.2, 0, this.mat.darkAshlar, 1.25);
    // The gateway spans a real enclosure rather than standing in open water.
    // Both solid wings remain; only the ritual gate itself opens.
    for (const side of [-1, 1]) {
      const width = this.x - 3.25, x = side * (3.25 + width / 2);
      this.collision(x, gateZ, width + .15, .85);
      for (let row = 0; row < 7; row++) for (let col = 0; col < Math.ceil(width / 1.6); col++) {
        const blockWidth = width / Math.ceil(width / 1.6);
        this.box(side * (3.25 + (col + .5) * blockWidth), .4 + row * .79, gateZ, blockWidth - .018, .765, .85, row % 3 ? this.mat.darkAshlar : this.mat.ashlar, true);
      }
      this.box(x, 5.68, gateZ, width + .1, .24, 1.08, this.mat.saltStone, true);
      for (let px = 5; px < this.x; px += 3.1) {
        this.box(side * px, 3.2, gateZ + .54, .62, 6.4, 1.1, this.mat.darkAshlar, true);
        this.box(side * px, 6.48, gateZ + .42, .85, .19, 1.25, this.mat.ashlar, true);
      }
    }
    const gate = new THREE.Group(); gate.name = opened ? 'state:hades:gate-open' : 'state:hades:gate-closed';
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group(); leaf.position.set(side * 3.2, 0, gateZ); leaf.rotation.y = opened ? side * 1.25 : 0;
      for (let i = 0; i < 9; i++) {
        const bar = new THREE.Mesh(BLOCK, this.mat.metal); bar.position.set(-side * (.15 + i * .355), 2.8, 0); bar.scale.set(.065, 5.6, .09); leaf.add(bar);
        const spike = new THREE.Mesh(CONE, this.mat.brass); spike.position.set(bar.position.x, 5.8, 0); spike.scale.set(.105, .35, .105); leaf.add(spike);
      }
      for (const y of [.35, 2.65, 5.5]) { const cross = new THREE.Mesh(BLOCK, this.mat.metal); cross.position.set(-side * 1.6, y, 0); cross.scale.set(3.2, .13, .15); leaf.add(cross); }
      const seal = new THREE.Mesh(new THREE.TorusGeometry(.52, .024, 6, 40), this.mat.brass); seal.position.set(-side * 1.6, 3.8, .08); leaf.add(seal); gate.add(leaf);
    }
    this.group.add(gate);
    if (!opened) {
      this.collision(0, gateZ, 6.3, .38);
      const material = new THREE.MeshStandardMaterial({ color: '#9fc8c7', emissive: '#507e8f', emissiveIntensity: .45, roughness: 1, transparent: true, opacity: this.flags.ritual_candles ? .27 : .44, depthWrite: false, side: THREE.DoubleSide });
      const body = new THREE.LatheGeometry([new THREE.Vector2(.52, 0), new THREE.Vector2(.44, .25), new THREE.Vector2(.24, 1.1), new THREE.Vector2(.41, 1.65), new THREE.Vector2(.24, 1.87), new THREE.Vector2(.16, 2.2), new THREE.Vector2(0, 2.38)], 18);
      for (let i = 0; i < 5; i++) {
        const spirit = new THREE.Group(), base = .42 + i % 2 * .3 + (this.flags.ritual_candles ? .5 : 0);
        spirit.position.set((i - 2) * 1.1, base, gateZ + .6 + i % 2 * .25); spirit.name = 'state:hades:spirit';
        spirit.add(new THREE.Mesh(body, material));
        const face = new THREE.Mesh(new THREE.SphereGeometry(.205, 12, 10), material); face.position.set(0, 1.91, .07); face.scale.set(.85, 1.25, .73); spirit.add(face);
        for (const s of [-1, 1]) {
          const eye = new THREE.Mesh(SMALLROCK, this.mat.charcoal); eye.position.set(s * .065, 1.96, .222); eye.scale.set(.04, .06, .028); spirit.add(eye);
          const arm = new THREE.Mesh(TAPER, material); arm.position.set(s * .38, this.flags.ritual_bell ? 1.8 : 1.55, .03); arm.scale.set(.12, .78, .12); arm.rotation.z = s * (this.flags.ritual_bell ? -.72 : .65); spirit.add(arm);
        }
        this.group.add(spirit); this.animated.push({ object: spirit, kind: 'mist', baseY: base });
      }
    } else this.shaft(0, gateZ - 4, 14, '#b9dace', 2.1);
    this.torch(-4, 2.6, gateZ, opened ? '#bbd9cb' : '#70b8b3', 21); this.torch(4, 2.6, gateZ, opened ? '#bbd9cb' : '#70b8b3', 21);
    this.mist(0, .4, 0, 15, '#8ebbb1', opened ? .06 : .16); this.mist(-5, 2, -this.z * .4, 10, '#8fa1a2', .1);
  }
  crystal(x: number, y: number, z: number, s: number, tint = '#73b9c5') {
    const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: .18, metalness: .3, emissive: tint, emissiveIntensity: .12 });
    for (let i = 0; i < 6; i++) this.batch(CONE, mat, [x + this.rand(-s * .35, s * .35), y + s * .25, z + this.rand(-s * .35, s * .35)], [s * .15, s * this.rand(.5, 1.5), s * .15], [this.rand(-.4, .4), 0, this.rand(-.4, .4)]);
  }
  mine(gas = false, bat = false) {
    this.cavern(bat ? 17 : 9); this.rubble(90);
    for (let z = -this.z + 2; z < this.z; z += 4.6) {
      this.box(0, 5.6, z, this.w * .75, .42, .46, this.mat.wood, true);
      for (const s of [-1, 1]) { const x = s * this.w * .35; this.box(x, 2.8, z, .43, 5.6, .45, this.mat.wood, true); this.beam(new THREE.Vector3(x, 4.6, z), new THREE.Vector3(x - s * 1.05, 5.65, z), .16, this.mat.darkWood); }
    }
    for (const x of [-.73, .73]) this.box(x, .028, 0, .07, .08, this.d, this.mat.rust);
    for (let z = -this.z; z < this.z; z += .85) this.box(0, .018, z, 2.35, .06, .18, this.mat.darkWood, true);
    for (let i = 0; i < 13; i++) {
      const x = (i % 2 ? 1 : -1) * this.rand(this.x - 2.1, this.x - .8), z = this.rand(-this.z + 1, this.z - 1);
      if (!this.nearRoute(x, z, 2)) this.crystal(x, .1, z, this.rand(.6, 1.4), gas ? '#66797b' : '#6793ab');
    }
    const x = this.x - 2.4, z = this.z * .45;
    if (!this.nearRoute(x, z, 2.5)) {
      this.box(x, .7, z, 1.7, .12, 2.3, this.mat.metal, true);
      for (const sx of [-1, 1]) { this.box(x + sx * .85, 1.13, z, .1, .85, 2.3, this.mat.rust, true); for (const sz of [-1, 1]) this.batch(CYLINDER, this.mat.metal, [x + sx * .9, .32, z + sz * .75], [.3, .13, .3], [0, 0, Math.PI / 2]); }
      for (const sz of [-1, 1]) this.box(x, 1.13, z + sz * 1.1, 1.8, .85, .12, this.mat.rust, true);
      for (let i = 0; i < 12; i++) this.rock(x + this.rand(-.6, .6), 1.15, z + this.rand(-.85, .85), .3, .28, .35, this.mat.charcoal);
      this.collision(x, z, 1.9, 2.4);
    }
    if (gas) this.mineSideWorking();
    else { this.torch(-this.x + 1.1, 3.2, 0, '#dba960', 21); this.torch(this.x - 1.1, 3.2, -this.z + 3, '#7caaa7', 15); }
    if (bat) {
      // The roost joins two existing roof beams. Its underside meets the bat's
      // claws; none of these overhead timbers changes the walking space.
      this.box(0, 4.38, -4.5, .27, .26, 4.92, this.mat.darkWood, true);
      for (const z of [-6.8, -2.2]) {
        this.box(0, 4.93, z, .23, 1.1, .23, this.mat.wood, true);
        this.box(0, 4.43, z, .32, .12, .3, this.mat.rust);
        this.box(0, 5.4, z, .31, .13, .52, this.mat.rust);
      }
      // A few small folded silhouettes actually hang beneath roof timbers.
      // Consume the old swarm's three draws per iteration so later obstacle
      // generation retains its published sequence, even for omitted bats.
      const smallRoosts = [[-6.2, -11.4], [6.6, -6.8], [-8.4, 7], [9.2, 2.4]];
      const folded = new THREE.Shape();
      folded.moveTo(0, -.04); folded.quadraticCurveTo(-.17, .04, -.3, -.12);
      folded.quadraticCurveTo(-.36, -.34, -.2, -.57); folded.quadraticCurveTo(-.13, -.49, -.08, -.56);
      folded.lineTo(0, -.62); folded.lineTo(.08, -.56); folded.quadraticCurveTo(.13, -.49, .2, -.57);
      folded.quadraticCurveTo(.36, -.34, .3, -.12); folded.quadraticCurveTo(.17, .04, 0, -.04);
      const foldedGeometry = new THREE.ShapeGeometry(folded, 7), foldedMaterial = this.mat.charcoal.clone();
      foldedMaterial.color.set('#272222'); foldedMaterial.side = THREE.DoubleSide;
      for (let i = 0; i < 32; i++) {
        const angle = this.rand(0, Math.PI * 2), radius = this.rand(1, this.x * .7), height = this.rand(-2, 3);
        if (i >= smallRoosts.length) continue;
        const [x, z] = smallRoosts[i], scale = .76 + radius / this.x * .22, top = 5.4;
        this.batch(foldedGeometry, foldedMaterial, [x, top, z], [scale, scale, scale], [0, angle, 0], false);
        this.batch(SMALLROCK, this.mat.charcoal, [x, top - .28 * scale, z], [.085 * scale, .25 * scale, .07 * scale], [0, angle, 0], false);
        this.batch(SMALLROCK, this.mat.charcoal, [x, top - .53 * scale, z], [.084 * scale, .075 * scale, .076 * scale], [0, angle, 0], false);
        for (const side of [-1, 1]) this.batch(CONE, this.mat.charcoal, [x + side * .052 * scale, top - .615 * scale, z], [.035 * scale, .105 * scale, .025 * scale], [Math.PI, angle, side * .18], false);
        // The original elevation draw remains consumed above, not reused to
        // levitate a roost. It only varies the short hook between foot and wood.
        this.box(x, top + .018, z, .023, .05 + (height + 2) * .004, .035, this.mat.metal);
      }
      const reveal = new THREE.PointLight('#c1b6a0', 10, 8, 2);
      reveal.name = 'bat-roost-carried-light-reveal'; reveal.userData.carriedLightReveal = true;
      reveal.position.set(-1.6, 3.75, -1.8); this.group.add(reveal); this.lights.push(reveal);
    }
  }
  mineNotice(kind: 'gas' | 'freight' | 'mill', x: number, y: number, z: number, width: number, height: number) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#332e26'; ctx.fillRect(0, 0, 768, 192);
    ctx.strokeStyle = '#9b8a60'; ctx.lineWidth = 5; ctx.strokeRect(9, 9, 750, 174);
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#d0c29a';
    if (kind === 'gas') {
      ctx.font = 'bold 77px Georgia'; ctx.fillText('COAL GAS', 226, 75);
      ctx.font = '36px Georgia'; ctx.fillText('SIDE WORKING', 230, 134);
      ctx.beginPath(); ctx.moveTo(113, 149); ctx.bezierCurveTo(67, 146, 68, 108, 110, 50);
      ctx.bezierCurveTo(99, 93, 143, 94, 147, 122); ctx.bezierCurveTo(151, 141, 130, 153, 113, 149); ctx.fill();
      ctx.strokeStyle = '#a46143'; ctx.lineWidth = 13; ctx.beginPath(); ctx.arc(113, 100, 65, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(65, 50); ctx.lineTo(160, 150); ctx.stroke();
    } else {
      ctx.font = 'bold 74px Georgia'; ctx.textAlign = 'center';
      ctx.fillText(kind === 'freight' ? 'FREIGHT' : 'LOWER MILL', 335, 79);
      ctx.font = '32px Georgia'; ctx.fillText(kind === 'freight' ? 'SHAFT BASKET' : 'PERSONNEL', 335, 135);
      ctx.lineWidth = 11; ctx.strokeStyle = '#d0c29a'; ctx.beginPath();
      if (kind === 'freight') { ctx.moveTo(661, 45); ctx.lineTo(661, 146); ctx.moveTo(633, 117); ctx.lineTo(661, 146); ctx.lineTo(689, 117); }
      else { ctx.moveTo(661, 145); ctx.lineTo(661, 44); ctx.moveTo(633, 73); ctx.lineTo(661, 44); ctx.lineTo(689, 73); }
      ctx.stroke();
    }
    // Fixed wear marks do not consume the room's obstacle random stream.
    ctx.fillStyle = '#332e26';
    for (let i = 0; i < 55; i++) { const px = organic(i, 0, 117) * 768, py = organic(i, 1, 117) * 192; ctx.fillRect(px, py, 2 + organic(i, 2, 117) * 8, 1.2); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    const paint = new THREE.MeshStandardMaterial({ map: texture, roughness: .96, metalness: .04 });
    const plaque = this.mesh(new THREE.PlaneGeometry(width, height), paint, [x, y, z + .061]);
    plaque.name = `mine-notice-${kind}`;
    this.box(x, y, z, width + .1, height + .09, .12, this.mat.darkWood, true);
    for (const side of [-1, 1]) {
      this.box(x + side * width * .37, y + height / 2 + .16, z, .024, .33, .032, this.mat.metal);
      for (const top of [-1, 1]) this.batch(CYLINDER, this.mat.rust, [x + side * (width / 2 - .07), y + top * (height / 2 - .07), z + .069], [.024, .012, .024], [Math.PI / 2, 0, 0]);
    }
  }
  mineSideWorking() {
    // Suspended timbers and flush floor details identify the gas-bearing side
    // working without adding a wall, a collider or a new obstruction to old saves.
    const sleeper = this.mat.darkWood.clone(); sleeper.color.set('#68583e');
    const wornPaint = this.mat.brass.clone(); wornPaint.color.set('#9b8757'); wornPaint.roughness = .9; wornPaint.metalness = .15;
    for (let i = 0; i < 25; i++) {
      const z = 7.5 - i * .64;
      this.box(10, .035, z, 3.95, .055, .56, sleeper, true);
      this.box(10, 3.96, z, 5.05, .075, .32, this.mat.darkWood);
    }
    for (const x of [8.06, 11.94]) this.box(x, .07, -.18, .065, .06, 16.1, this.mat.rust);
    for (const x of [7.6, 12.4]) this.box(x, 3.83, -.18, .2, .26, 16.45, this.mat.wood, true);
    for (const z of [-8.8, -4.2, .4, 5]) {
      this.box(10, 3.72, z, 5.16, .26, .34, this.mat.wood, true);
      for (const x of [7.6, 12.4]) {
        this.box(x, 4.7, z, .115, 1.65, .13, this.mat.metal);
        for (const y of [3.91, 5.45]) this.box(x, y, z, .31, .13, .41, this.mat.rust);
      }
    }
    this.box(10, 3.72, 6.45, 5.15, .26, .34, this.mat.wood, true);
    this.mineNotice('gas', 10, 3.06, 5, 1.92, .48);
    for (let i = 0; i < 9; i++) this.box(8.17 + i * .46, .073, 6.87, .16, .012, .58, wornPaint, false, -.55);
    // Gas remains in the side working after a safe route is found. The clear
    // low strip along its left edge is spatially distinct from the haze above.
    for (const z of [3.7, -.7, -5.1]) {
      const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTexture, color: '#8f9274', transparent: true, opacity: .18, depthWrite: false }));
      haze.name = 'coal-side-working-gas'; haze.position.set(10.8, 2.12, z); haze.scale.set(3.55, 2.8, 1);
      this.group.add(haze); this.animated.push({ object: haze, kind: 'mist', baseY: 2.12 });
    }
    // The freight hoist hangs from existing crossbeams; only its chain descends
    // to the already present basket. The north route is marked for personnel.
    for (const x of [-1.65, 1.65]) {
      this.box(x, 4.85, -1.9, .19, .26, 4.95, this.mat.metal);
      for (const z of [-4.2, .4]) this.box(x, 5.22, z, .13, .76, .14, this.mat.metal);
    }
    this.box(0, 4.73, -3, 3.65, .34, .43, this.mat.metal, true);
    this.box(0, 4.85, -.65, 3.65, .19, .26, this.mat.metal);
    this.mesh(new THREE.TorusGeometry(.29, .064, 8, 28), this.mat.rust, [0, 4.36, -3]);
    this.beam(new THREE.Vector3(0, 4.08, -3), new THREE.Vector3(0, 1.27, -3), .026, this.mat.metal);
    this.mineNotice('freight', 0, 4.14, -.65, 2.45, .67);
    this.mineNotice('mill', 0, 4.52, -17.7, 2.65, .69);
    for (const x of [-.9805, .9805]) this.beam(new THREE.Vector3(x, 5.18, -17.7), new THREE.Vector3(x, 5.5, -18), .019, this.mat.metal);
    const reveal = new THREE.PointLight('#bcc0a7', 5, 9, 2);
    reveal.name = 'coal-working-carried-light-reveal'; reveal.userData.carriedLightReveal = true;
    reveal.position.set(10, 3.1, 8.4); this.group.add(reveal); this.lights.push(reveal);
  }
  gear(x: number, y: number, z: number, radius: number, teeth = 24, active = true) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    g.add(new THREE.Mesh(new THREE.TorusGeometry(radius * .8, radius * .13, 8, 64), this.mat.brass));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * .19, radius * .19, .5, 16), this.mat.metal); hub.rotation.x = Math.PI / 2; g.add(hub);
    const spokes = new THREE.InstancedMesh(BLOCK, this.mat.brass, 6), rimTeeth = new THREE.InstancedMesh(BLOCK, this.mat.brass, teeth);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; dummy.position.set(Math.cos(a) * radius * .43, Math.sin(a) * radius * .43, 0); dummy.scale.set(radius * .72, .13, .16); dummy.rotation.set(0, 0, a); dummy.updateMatrix(); spokes.setMatrixAt(i, dummy.matrix); }
    for (let i = 0; i < teeth; i++) { const a = i / teeth * Math.PI * 2; dummy.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0); dummy.scale.set(radius * .22, radius * .16, .25); dummy.rotation.set(0, 0, a); dummy.updateMatrix(); rimTeeth.setMatrixAt(i, dummy.matrix); }
    spokes.castShadow = rimTeeth.castShadow = true; g.add(spokes, rimTeeth);
    g.name = active ? 'state:machine:running-gear' : 'state:machine:idle-gear'; this.group.add(g); if (active) this.animated.push({ object: g, kind: 'gear' });
  }
  machine() {
    this.ground(this.mat.charcoal); this.walls(11, this.mat.darkStone);
    const mill = this.room.id === 'machine_room', completed = !!this.flags.diamond_created;
    const active = mill ? completed : !!this.flags.controls_enabled;
    const plates = ['#7d8982', '#6c7a74', '#859089'].map(tint => new THREE.MeshStandardMaterial({ color: tint, ...wornIronSurfaces(), normalScale: new THREE.Vector2(.22, .22), roughness: .76, metalness: .58 }));
    const bolt = color('#46514b', .64, .6), nx = Math.ceil(this.w / 1.6), nz = Math.ceil(this.d / 2), pw = this.w / nx, pd = this.d / nz;
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const x = -this.x + (ix + .5) * pw, z = -this.z + (iz + .5) * pd;
      this.box(x, -.025, z, pw - .021, .06, pd - .021, plates[Math.floor(organic(ix, iz, 48) * plates.length)], true);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.cylinder(x + sx * (pw / 2 - .1), .006, z + sz * (pd / 2 - .1), .018, .006, bolt);
    }
    // A solid workshop roof closes the former blue void above the wall courses.
    const ceiling = this.mat.darkAshlar.clone(); ceiling.color.set('#48524b');
    const roof = new THREE.BoxGeometry(this.w + .9, .36, this.d + .9), roofPosition = roof.attributes.position, roofNormal = roof.attributes.normal, roofUv = roof.attributes.uv;
    for (let i = 0; i < roofPosition.count; i++) {
      if (Math.abs(roofNormal.getY(i)) > .5) roofUv.setXY(i, roofPosition.getX(i) / 3, roofPosition.getZ(i) / 3);
      else roofUv.setXY(i, (Math.abs(roofNormal.getX(i)) > .5 ? roofPosition.getZ(i) : roofPosition.getX(i)) / 3, roofPosition.getY(i) / 3);
    }
    this.mesh(roof, ceiling, [0, 11.12, 0]);
    const structure = plates[1];
    for (let z = -this.z + .75; z < this.z; z += 4.75) {
      this.box(0, 10.47, z, this.w + .3, .37, .31, structure, true);
      for (const side of [-1, 1]) {
        this.box(side * (this.x - .18), 9.91, z, .27, 1.45, .36, structure, true);
        this.beam(new THREE.Vector3(side * (this.x - .28), 9.4, z), new THREE.Vector3(side * (this.x - 1.9), 10.47, z), .1, structure);
      }
    }
    for (const z of [-6, 6]) {
      this.beam(new THREE.Vector3(0, 10.5, z), new THREE.Vector3(0, 8.6, z), .025, this.mat.metal);
      this.cylinder(0, 8.56, z, .39, .15, structure);
      const diffuser = new THREE.MeshStandardMaterial({ color: '#bec5b3', emissive: '#d8d8b6', emissiveIntensity: .7, roughness: .7 });
      this.cylinder(0, 8.45, z, .27, .075, diffuser);
      const light = new THREE.PointLight(z < 0 ? '#c9ceba' : '#d7cbaa', 24, 22, 2); light.position.set(0, 8.25, z); this.group.add(light); this.lights.push(light);
    }
    this.gear(-3, 5.6, -this.z + 1.2, 2.6, 28, active); this.gear(1.45, 6.8, -this.z + 1.35, 1.9, 24, active); this.gear(4.2, 4.4, -this.z + 1.1, 1.5, 20, active);
    for (const s of [-1, 1]) {
      const x = s * (this.x - 2);
      if (!this.nearRoute(x, -this.z * .4, 2)) { this.cylinder(x, 2, -this.z * .4, 1.05, 4, this.mat.metal); this.cylinder(x, .3, -this.z * .4, 1.15, .15, this.mat.rust); this.cylinder(x, 3.7, -this.z * .4, 1.1, .15, this.mat.brass); this.collision(x, -this.z * .4, 2.2, 2.2); }
      this.pipe([[x, 4, -this.z * .4], [x, 8.6, -this.z * .4], [x, 8.6, this.z - 1], [x, 1.3, this.z - 1]], .21, this.mat.brass);
      this.pipe([[s * (this.x - .8), 1.5, -this.z + 1], [s * (this.x - .8), 1.5, this.z - 2]], .4, this.mat.rust);
    }
    if (!mill) this.maintenancePipe();
    if (mill) {
      const target = this.room.objects.find(o => o.id === 'pressure_mill')?.position ?? [0, 0, -5], x = target[0], z = target[2];
      for (const s of [-1, 1]) {
        this.cylinder(x + s * 1.13, 2.15, z - .58, .16, 4.3, this.mat.metal);
        this.cylinder(x + s * 1.13, .35, z - .58, .23, .32, this.mat.brass);
        this.cylinder(x + s * 1.13, 4, z - .58, .23, .3, this.mat.brass);
      }
      this.box(x, 4.27, z - .58, 2.85, .34, .85, this.mat.metal, true);
      this.cylinder(x, 3.31, z - .58, .3, 1.65, this.mat.rust);
      this.cylinder(x, this.flags.machine_closed && !completed ? 1.47 : 2.13, z - .58, .17, 1.1, this.mat.metal);
      const platen = this.mesh(new THREE.CylinderGeometry(.65, .65, .17, 24), this.mat.metal, [x, this.flags.machine_closed && !completed ? .97 : 1.65, z - .58]); platen.name = completed ? 'state:mill:finished' : this.flags.machine_closed ? 'state:mill:sealed' : 'state:mill:open';
      if (this.flags.machine_loaded && !completed) this.rock(x, .43, z - .45, .22, .18, .19, this.mat.charcoal);
      this.box(x + 1.5, 1.48, z - .45, .42, .94, .21, this.mat.darkWood, true);
      [this.flags.machine_loaded, this.flags.machine_closed, completed].forEach((on, i) => {
        const tint = on ? i === 2 ? '#87d6bf' : '#e3b86e' : '#314543';
        const lamp = this.mesh(new THREE.SphereGeometry(.072, 12, 8), new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: on ? 1.6 : 0, roughness: .25 }), [x + 1.5, 1.77 - i * .25, z - .32]); lamp.name = `state:mill:lamp-${i}`;
      });
      if (completed) { this.mist(x + .7, 2.2, z - .7, 2.5, '#c3d8d4', .17); const light = new THREE.PointLight('#afdacf', 6, 6, 2); light.position.set(x, 1.8, z); this.group.add(light); this.lights.push(light); }
    }
    this.torch(-this.x + 1, 3.1, 2, '#ffc986', 22); this.torch(this.x - 1, 3.1, -2, '#86bcc3', 20); this.mist(this.x - 2, 3.5, this.z - 2, 5, '#b4c6c2', active ? .16 : .045);
  }
  maintenancePipe() {
    // Keep the established repair target and collision layout so old saves resume
    // at the same approach. This branch visibly joins the east-wall water main.
    const target = this.room.objects.find(object => object.id === 'leaking_pipe')?.position ?? [11, 0, 4];
    const x = target[0], z = target[2], wallX = this.x - .8;
    const leaking = !!this.flags.dam_leak;
    const patched = Object.prototype.hasOwnProperty.call(this.flags, 'dam_leak') && !leaking;
    const iron = new THREE.MeshStandardMaterial({ color: '#526963', ...wornIronSurfaces(), normalScale: new THREE.Vector2(.3, .3), roughness: .68, metalness: .5 });
    const coupling = new THREE.MeshStandardMaterial({ color: '#7d6950', ...wornIronSurfaces(), normalScale: new THREE.Vector2(.16, .16), roughness: .66, metalness: .63 });
    const pipeMaterials: THREE.Material[] = [iron, coupling];
    const pipework = new THREE.Group(); pipework.name = leaking ? 'state:maintenance:broken-pipe' : patched ? 'state:maintenance:patched-pipe' : 'state:maintenance:intact-pipe';
    pipework.userData.disposeMaterials = () => { for (const material of pipeMaterials) material.dispose(); };
    this.group.add(pipework);
    this.pipe([[wallX, 1.5, z], [wallX - 1.4, 1.5, z], [wallX - 1.4, 3.35, z], [x, 3.35, z], [x, 1.58, z]], .205, iron);
    this.pipe([[x, 1.31, z], [x, .12, z]], .205, iron);
    this.cylinder(x, 1.445, z, leaking || patched ? .19 : .205, .28, iron);
    for (const y of [1.31, 1.58]) {
      this.cylinder(x, y, z, .32, .115, coupling);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, bx = x + Math.cos(a) * .264, bz = z + Math.sin(a) * .264;
        this.cylinder(bx, y + .077, bz, .032, .045, this.mat.metal);
      }
    }
    this.cylinder(x, .07, z, .37, .14, this.mat.metal);
    for (const s of [-1, 1]) for (const t of [-1, 1]) this.cylinder(x + s * .235, .158, z + t * .235, .036, .045, coupling);
    for (const bx of [x + 1.05, wallX - 1.4]) {
      this.beam(new THREE.Vector3(bx, 3.35, z), new THREE.Vector3(bx, 10.98, z), .022, this.mat.metal);
      this.box(bx, 10.91, z, .22, .08, .22, coupling, true);
      this.mesh(new THREE.TorusGeometry(.23, .025, 6, 20), coupling, [bx, 3.35, z], [0, Math.PI / 2, 0]);
    }
    if (leaking) {
      // The jet starts at the visible dark split on the west side of the coupling.
      this.mesh(new THREE.SphereGeometry(.065, 10, 6), this.mat.charcoal, [x - .194, 1.45, z]).scale.set(.2, .55, 1);
      const spray = createPipeLeak(); spray.position.set(x, 1.45, z); pipework.add(spray);
      this.animated.push({ object: spray, kind: 'pipe-leak' });
    } else if (patched) {
      const putty = color('#b6b6a0', .95);
      pipeMaterials.push(putty);
      this.cylinder(x, 1.445, z, .235, .18, putty);
      for (const y of [1.38, 1.44, 1.51]) this.mesh(new THREE.TorusGeometry(.226, .018, 6, 24), putty, [x, y, z], [Math.PI / 2, 0, 0]);
    }
    if (leaking || patched) {
      const wet = new THREE.MeshStandardMaterial({ color: '#263e3e', roughness: .16, metalness: .24, transparent: true, opacity: .63, depthWrite: false });
      pipeMaterials.push(wet);
      const outline = new THREE.CircleGeometry(1, 40), points = outline.attributes.position;
      for (let i = 1; i < points.count; i++) {
        const a = Math.atan2(points.getY(i), points.getX(i)), radius = .93 + .048 * Math.sin(a * 5) + .024 * Math.cos(a * 9);
        points.setXYZ(i, points.getX(i) * radius, points.getY(i) * radius, 0);
      }
      const puddle = this.mesh(outline, wet, [x - 2.7, .016, z - .53], [-Math.PI / 2, 0, 0]);
      puddle.scale.set(1.85, 1.13, 1); puddle.name = 'state:maintenance:wet-floor';
    }
  }
  sand() {
    this.cavern(12, this.mat.sand); this.ground(this.mat.sand, true, -.015);
    for (let i = 0; i < 20; i++) {
      const x = this.rand(-this.x, this.x), z = this.rand(-this.z, this.z);
      if (this.nearRoute(x, z, 2.6)) continue;
      this.rock(x, -.15, z, this.rand(1, 3), this.rand(.25, .6), this.rand(1, 2.5), this.mat.sand);
    }
    for (const s of [-1, 1]) {
      this.column(s * (this.x - 2.5), -this.z * .4, 7, .65, this.mat.limestone);
      this.beam(new THREE.Vector3(s * (this.x - 4), .3, this.z * .4), new THREE.Vector3(s * (this.x - 1), 1, this.z * .4 + 2), .65, this.mat.paleStone);
    }
    this.shaft(-2, -4, 15, '#e2d4ab', 3.6); this.mist(0, 1.6, -3, 11, '#ceba91', .14);
    this.torch(this.x - 1, 3, 1, '#dcc089', 13);
    if (this.room.id === 'sandy_cave') this.sandDrift();
  }
  sandDrift() {
    const dug = !!this.flags.scarab_revealed, rings = 24, segments = 64;
    const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
    const vertex = (r: number, a: number) => {
      const edge = 1 + .055 * Math.sin(a * 3 + .6) + .026 * Math.cos(a * 7);
      const x = Math.cos(a) * r * edge * 2.3, z = Math.sin(a) * r * edge * 1.85;
      const mound = Math.pow(1 - r * r, 2) * (.45 - x * .05 + z * .02);
      const scoop = Math.exp(-Math.pow((x + .24) / .92, 4) - Math.pow((z - .16) / .76, 4));
      const lip = .14 * Math.exp(-Math.pow((r - .58) / .18, 2)) * (1 - .6 * Math.max(0, Math.sin(a)));
      const ripples = Math.sin(z * 17 + Math.sin(x * 2.3) * .8) * .013 * Math.sin(Math.PI * r);
      const y = -.05 + (dug ? mound * (1 - scoop * .96) + lip : mound) + ripples * (dug ? 1 - scoop : 1);
      vertices.push(x, y, z);
      const grain = .97 + organic(x * 13, z * 13, 72) * .06;
      const shade = grain * (dug ? 1 - scoop * .29 : 1);
      colors.push(shade, shade, shade);
    };
    vertex(0, 0);
    for (let ring = 1; ring <= rings; ring++) for (let i = 0; i < segments; i++) vertex(ring / rings, i / segments * Math.PI * 2);
    for (let i = 0; i < segments; i++) indices.push(0, 1 + (i + 1) % segments, 1 + i);
    for (let ring = 1; ring < rings; ring++) for (let i = 0; i < segments; i++) {
      const a = 1 + (ring - 1) * segments + i, b = 1 + (ring - 1) * segments + (i + 1) % segments;
      const c = a + segments, d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const material = this.mat.sand.clone(); material.vertexColors = true; material.roughness = 1;
    const drift = this.mesh(geometry, material, [0, 0, -5]);
    drift.name = dug ? 'state:sand:dug-drift' : 'state:sand:undug-drift';
    drift.userData.disposeMaterials = () => material.dispose();
  }
  dome() {
    this.rotunda(); const radius = Math.min(this.x, this.z) * .8;
    for (let i = 0; i < 18; i++) {
      const a = i * Math.PI / 9;
      this.beam(new THREE.Vector3(Math.cos(a) * radius, 8, Math.sin(a) * radius), new THREE.Vector3(Math.cos(a) * 2.8, 14, Math.sin(a) * 2.8), .22, this.mat.stone);
    }
    const cx = -7, cz = 1, halfW = 2.2, halfD = 2.75;
    for (const s of [-1, 1]) {
      this.box(cx + s * (halfW + .12), -2.85, cz, .24, 5.8, halfD * 2 + .4, this.mat.darkAshlar);
      this.box(cx, -2.85, cz + s * (halfD + .12), halfW * 2 + .4, 5.8, .24, this.mat.darkAshlar);
      this.box(cx + s * (halfW + .12), .04, cz, .35, .17, halfD * 2 + .6, this.mat.limestone, true);
      this.box(cx, .04, cz + s * (halfD + .12), halfW * 2 + .6, .17, .35, this.mat.limestone, true);
      for (let z = cz - halfD; z <= cz + halfD + .01; z += .75) this.box(cx + s * (halfW + .1), .54, z, .12, 1.06, .12, this.mat.darkWood, true);
      this.box(cx + s * (halfW + .1), 1.06, cz, .18, .16, halfD * 2 + .25, this.mat.wood, true);
      for (let x = cx - halfW; x <= cx + halfW + .01; x += .75) this.box(x, .54, cz + s * (halfD + .1), .12, 1.06, .12, this.mat.darkWood, true);
      this.box(cx, 1.06, cz + s * (halfD + .1), halfW * 2 + .25, .16, .18, this.mat.wood, true);
    }
    this.collision(cx, cz, halfW * 2 + .2, halfD * 2 + .2);
    this.box(cx, -5.8, cz, halfW * 2 + .3, .2, halfD * 2 + .3, this.mat.charcoal);
    for (let j = 0; j < 13; j++) this.box(cx, -5.27, cz - 2.4 + j * .39, 1.45, .16, .35, this.mat.wood, true);
    const ring = this.mesh(new THREE.TorusGeometry(.12, .024, 6, 24), this.mat.brass, [cx, 1.04, cz + halfD + .15], [Math.PI / 2, 0, 0]); ring.name = 'state:dome:anchor';
    if (this.flags.dome_secured) {
      const rope = color('#aa9573'), curve = new THREE.CatmullRomCurve3([new THREE.Vector3(cx, .03, 4.03), new THREE.Vector3(cx - .09, 1.1, 3.88), new THREE.Vector3(cx, 1.18, 3.6), new THREE.Vector3(cx + .09, -.1, 3.35), new THREE.Vector3(cx + .16, -3.3, 3.15), new THREE.Vector3(cx + .07, -5.12, 2.95)]);
      const line = this.mesh(new THREE.TubeGeometry(curve, 46, .033, 6, false), rope, [0, 0, 0]); line.name = 'state:dome:secured-rope';
      for (let j = 0; j < 5; j++) this.mesh(new THREE.TorusGeometry(.13, .022, 5, 24), rope, [cx - .12 + j * .055, 1.07, 3.88], [0, Math.PI / 2, 0]);
      const light = new THREE.PointLight('#debd80', 8, 8, 2); light.position.set(cx, -4, cz + 1); this.group.add(light); this.lights.push(light);
    }
    this.rubble(170); this.mist(0, .8, 0, 9, '#c4c5b6', .12);
  }
  river() {
    this.cavern(14, this.mat.rock, false); this.water(0, 0, this.w, this.d, -.12, '#244749');
    const bank = (width: number, depth: number, y: number, x = 0, z = 0) => {
      const geometry = new THREE.BoxGeometry(width, .08, depth), positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(normals.getY(i)) > .5) uv.setXY(i, positions.getX(i) / 1.45, positions.getZ(i) / 1.45);
        else if (Math.abs(normals.getX(i)) > .5) uv.setXY(i, positions.getZ(i) / 1.45, positions.getY(i) / 1.45);
        else uv.setXY(i, positions.getX(i) / 1.45, positions.getY(i) / 1.45);
      }
      this.mesh(geometry, this.mat.floorSlab, [x, y, z]);
    };
    // Wet mineral grain keeps its metre scale along the full length of either
    // bank. Scaling a unit box stretched one photograph across the whole room.
    const northWater = this.room.exits.some(exit => (exit.role === 'water' || exit.role === 'landing') && exit.position[1] < -this.z + 3);
    const southWater = this.room.exits.some(exit => (exit.role === 'water' || exit.role === 'landing') && exit.position[1] > this.z - 3);
    const westWater = this.room.exits.some(exit => (exit.role === 'water' || exit.role === 'landing') && exit.position[0] < -this.x + 3);
    const eastWater = this.room.exits.some(exit => (exit.role === 'water' || exit.role === 'landing') && exit.position[0] > this.x - 3);
    bank(5, this.d - (Number(northWater) + Number(southWater)) * 3.1, -.025, 0, (Number(northWater) - Number(southWater)) * 1.55);
    bank(this.w - (Number(westWater) + Number(eastWater)) * 3.1, 4.5, -.02, (Number(westWater) - Number(eastWater)) * 1.55, 0);
    // Small quay spurs connect the existing shore clues to the dry cross-bank.
    // Their positions and the established collision/navigation layout are kept.
    for (const target of this.room.objects.filter(object => object.id === 'boat_label' || object.id === 'river_sign')) {
      const [x, , z] = target.position, end = z + 1.05, start = 1.9, width = 3.0;
      if (Math.abs(x) < 2.4) continue; // The launch label already rests on the main pier.
      bank(width, end - start, -.025, x, (start + end) / 2);
      for (const side of [-1, 1]) {
        for (let p = start + .5; p < end; p += .83) this.box(x + side * (width / 2 - .1), .045, p, .17, .075, .77, this.mat.darkAshlar, true);
        for (let i = 0; i < 7; i++) {
          const p = start + (i + .5) / 7 * (end - start), scale = .12 + organic(i, side, 97) * .12;
          this.batch(SMALLROCK, this.mat.mossStone, [x + side * (width / 2 + .08), -.035, p], [scale, .1, scale * 1.3], [0, i * 1.73, 0]);
        }
      }
      this.box(x, .045, end - .05, width, .075, .17, this.mat.darkAshlar, true);
    }
    if (this.room.id === 'river') {
      bank(3.4, 3.2, -.02, 8, 2.9);
      for (let j = 0; j < 11; j++) this.box(8, .036, 1.38 + j * .295, 3.5, .028, .273, this.mat.wood);
      for (const x of [6.38, 9.62]) this.cylinder(x, .32, 4.28, .1, .72, this.mat.darkWood);
    }
    for (let i = 0; i < 17; i++) this.box(0, .035, this.z - 1.8 - i * .31, 6, .11, .27, this.mat.wood);
    for (const s of [-1, 1]) for (const z of [this.z - 2, this.z - 6.5]) { this.cylinder(s * 3, .35, z, .16, 1.2, this.mat.wood); this.cylinder(s * 3, .8, z, .2, .09, this.mat.darkWood); }
    this.mist(-this.x * .5, .5, 0, 13, '#8cb5b0', .19); this.mist(3, .5, -this.z * .6, 9, '#a5bec0', .16);
    this.torch(-this.x + 1.2, 3, this.z * .5, '#e8bf89', 17); this.shaft(3, -3, 16, '#aec8c7', 2.5);
  }
  barrow() {
    const z = -this.z + 3.5;
    for (let i = 0; i < 20; i++) {
      const a = i * Math.PI * 2 / 20, x = Math.cos(a) * 6.5, zz = z + Math.sin(a) * 4.5;
      if (Math.abs(x) < 2.7 && zz > z - .5) continue;
      this.rock(x, 1.2, zz, 2.4, this.rand(2.5, 4.3), 2.4, this.mat.moss);
    }
    this.arch(0, z + 3.1, 4.4, 3.3, 0, this.mat.darkStone, 1.7);
    for (const s of [-1, 1]) {
      this.box(s * 3.5, 2.35, z + 3.2, 1.15, 4.7, 1.1, this.mat.stone, true, s * .07);
      for (let y = 1; y < 4.3; y += .5) this.box(s * 3.5, y, z + 3.77, .4, .06, .035, this.mat.brass);
    }
    const light = new THREE.PointLight('#e2be7f', 38, 13, 2); light.position.set(0, 3, z + 1); this.lights.push(light); this.group.add(light);
    this.shaft(0, z + 3, 18, '#e9dbb4', 4);
  }
  finish() {
    for (const { geometry, material, matrices, shadow } of this.batches.values()) {
      const instance = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((m, i) => instance.setMatrixAt(i, m)); instance.instanceMatrix.needsUpdate = true;
      instance.castShadow = shadow; instance.receiveShadow = true; instance.computeBoundingSphere(); this.group.add(instance);
    }
    this.group.name = `world:${this.room.id}`;
    return { group: this.group, colliders: this.colliders, animated: this.animated, lights: this.lights };
  }
}

export function buildHouseExterior(room: RoomDef, materials: Mats, flags: Record<string, boolean>) {
  const b = new Builder({ ...room, id: 'house_grounds', kind: 'forest' }, materials, flags);
  b.houseExterior();
  b.routeBarriers();
  return b.finish();
}

export function buildWorld(room: RoomDef, materials: Mats, flags: Record<string, boolean>) {
  const b = new Builder(room, materials, flags);
  switch (room.kind) {
    case 'forest': b.forest(); break;
    case 'house': b.house(); break;
    case 'cellar': b.cellar(); break;
    case 'bridge': b.bridge(); break;
    case 'gallery': b.gallery(); break;
    case 'rotunda': b.rotunda(); break;
    case 'maze': b.maze(); break;
    case 'cyclops': b.cyclops(); break;
    case 'treasury': b.treasury(); break;
    case 'dam': b.dam(); break;
    case 'reservoir': b.reservoir(); break;
    case 'falls': b.falls(); break;
    case 'rainbow': b.falls(true); break;
    case 'temple': b.cathedral(); break;
    case 'underworld': b.underworld(); break;
    case 'mine': b.mine(); break;
    case 'machine': b.machine(); break;
    case 'gas': b.mine(true); break;
    case 'sand': b.sand(); break;
    case 'bat': b.mine(false, true); break;
    case 'dome': b.dome(); break;
    case 'river': b.river(); break;
    case 'altar': b.cathedral(true); break;
    case 'barrow': b.forest(true); break;
    default: b.cavern();
  }
  b.routeBarriers();
  return b.finish();
}
