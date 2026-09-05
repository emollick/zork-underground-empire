import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Materials = Record<string, THREE.MeshStandardMaterial>;
type V3 = [number, number, number];
type Ring = [number, number, number, number?, number?];
type CreatureKind = 'troll' | 'thief' | 'grue' | 'cyclops';
const TAU = Math.PI * 2;
const generatedMaterials = new Map<string, THREE.MeshStandardMaterial>();
let grain: THREE.DataTexture | undefined;
let patina: THREE.DataTexture | undefined;
let roughGrain: THREE.DataTexture | undefined;

function surfaceGrain(): THREE.DataTexture {
  if (grain) return grain;
  const size = 256, pixels = new Uint8Array(size * size * 4), color = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size), freckles = new Float32Array(size * size);
  const hash = (x: number, y: number, period: number) => { const q = Math.sin(((x % period + period) % period) * 127.1 + ((y % period + period) % period) * 311.7 + 7.137) * 43758.5453123; return q - Math.floor(q); };
  const noise = (x: number, y: number, period: number) => {
    x = x / size * period; y = y / size * period;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, a = fx * fx * (3 - 2 * fx), b = fy * fy * (3 - 2 * fy);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy, period), hash(ix + 1, iy, period), a), THREE.MathUtils.lerp(hash(ix, iy + 1, period), hash(ix + 1, iy + 1, period), a), b);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    heights[y * size + x] = noise(x, y, 8) * .43 + noise(x, y, 23) * .26 + noise(x, y, 61) * .19 + noise(x, y, 113) * .12;
    freckles[y * size + x] = noise(x + 67, y + 41, 12) * .7 + noise(x, y, 47) * .3;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const height = heights[y * size + x], f = freckles[y * size + x];
    const dx = (heights[y * size + (x + 1) % size] - heights[y * size + (x - 1 + size) % size]) * 3.3;
    const dy = (heights[((y + 1) % size) * size + x] - heights[((y - 1 + size) % size) * size + x]) * 3.3;
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    pixels[i] = (n.x * .5 + .5) * 255; pixels[i + 1] = (n.y * .5 + .5) * 255; pixels[i + 2] = (n.z * .5 + .5) * 255; pixels[i + 3] = 255;
    const tone = 187 + f * 62 + height * 6;
    color[i] = tone; color[i + 1] = tone * (.973 + f * .025); color[i + 2] = tone * (.933 + f * .066); color[i + 3] = 255;
    rough[i] = rough[i + 1] = rough[i + 2] = 205 + height * 50; rough[i + 3] = 255;
  }
  grain = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  patina = new THREE.DataTexture(color, size, size, THREE.RGBAFormat); patina.colorSpace = THREE.SRGBColorSpace;
  roughGrain = new THREE.DataTexture(rough, size, size, THREE.RGBAFormat);
  for (const texture of [grain, patina, roughGrain]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  return grain;
}

function mat(m: Materials, name: string, color: THREE.ColorRepresentation, roughness = .7, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  if (m[name]) return m[name];
  const key = `${name}:${String(color)}:${roughness}:${metalness}`;
  if (!generatedMaterials.has(key)) {
    const normal = surfaceGrain(), weathered = /skin|leather|cloth|cloak|bone|iron|rubber|copper|brass/i.test(name);
    generatedMaterials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, normalMap: normal, normalScale: new THREE.Vector2(.22, .22), ...(weathered ? { map: patina, roughnessMap: roughGrain } : {}), ...extra }));
  }
  return generatedMaterials.get(key)!;
}

function palette(m: Materials) {
  return {
    iron: mat(m, 'iron', '#454c4d', .42, .85),
    darkIron: mat(m, 'darkIron', '#22292a', .54, .78),
    steel: mat(m, 'steel', '#afc3ca', .25, .94),
    gold: mat(m, 'gold', '#c59848', .31, .86),
    brass: mat(m, 'brass', '#ac8244', .38, .82),
    copper: mat(m, 'copper', '#956449', .48, .75),
    wood: mat(m, 'wood', '#64432e', .88),
    leather: mat(m, 'leather', '#34271f', .94),
    leatherLight: mat(m, 'leatherLight', '#604432', .91),
    cloth: mat(m, 'cloth', '#20272b', 1),
    red: mat(m, 'redCloth', '#602d30', .94),
    black: mat(m, 'black', '#070b0d', .93),
    bone: mat(m, 'bone', '#bbaf89', .76),
    paper: mat(m, 'paper', '#bfb58d', .94),
    stone: mat(m, 'stone', '#6d716d', .96),
    jade: mat(m, 'jade', '#3e8571', .23, .18),
    gem: mat(m, 'gem', '#72b9bb', .11, .34),
    flame: mat(m, 'flame', '#ffe0a0', .4, 0, { emissive: '#ffb94c', emissiveIntensity: 4, toneMapped: false }),
    ember: mat(m, 'ember', '#e57a31', .6, .2, { emissive: '#ee541a', emissiveIntensity: 1.4 }),
    glass: mat(m, 'glass', '#b5d4d2', .12, .12, { transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide }),
  };
}

function creaturePalette(m: Materials, kind: CreatureKind): ReturnType<typeof palette> {
  const p = palette(m);
  if (kind === 'grue') return {
    ...p,
    black: mat(m, 'grueMouth', '#010203', 1, 0, { envMapIntensity: 0, normalScale: new THREE.Vector2(0, 0) }),
    darkIron: mat(m, 'grueHorn', '#080d10', .99, 0, { envMapIntensity: 0 }),
    bone: mat(m, 'grueFang', '#657064', .93, 0, { envMapIntensity: 0, normalScale: new THREE.Vector2(.09, .09) }).clone(),
  };
  if (kind !== 'troll') return p;
  const ironSurface = { normalMap: m.rock?.normalMap ?? surfaceGrain(), normalScale: new THREE.Vector2(.12, .12) };
  return {
    ...p,
    iron: mat(m, 'trollIron', '#3c443d', .79, .57, ironSurface),
    darkIron: mat(m, 'trollDarkIron', '#252c29', .83, .46, ironSurface),
    steel: mat(m, 'trollSteel', '#788078', .59, .77, ironSurface),
    brass: mat(m, 'trollBrass', '#706244', .73, .58),
    bone: mat(m, 'trollBone', '#766d51', .96, .02, { normalScale: new THREE.Vector2(.32, .32) }),
    leather: mat(m, 'trollLeather', '#292b24', .97),
    leatherLight: mat(m, 'trollLeatherLight', '#474337', .97),
    wood: mat(m, 'trollWeaponWood', '#413b2c', .97, 0, { map: m.wood?.map ?? patina, normalMap: m.wood?.normalMap ?? surfaceGrain(), normalScale: new THREE.Vector2(.24, .24) }),
  };
}

function crystalMaterial(m: Materials, name: string, color: string, extra: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshStandardMaterial {
  if (m[name]) return m[name];
  const key = `crystal:${name}:${color}`;
  if (!generatedMaterials.has(key)) generatedMaterials.set(key, new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: .12, transmission: .68, thickness: .075, ior: 1.49, clearcoat: 1, clearcoatRoughness: .09, attenuationColor: '#c5e3e0', attenuationDistance: 1.2, envMapIntensity: .6, side: THREE.DoubleSide, ...extra }));
  return generatedMaterials.get(key)!;
}

function group(parent?: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group(); g.position.set(x, y, z); parent?.add(g); return g;
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, p: V3 = [0, 0, 0], s?: V3, r?: V3): THREE.Mesh {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...p); if (s) object.scale.set(...s); if (r) object.rotation.set(...r);
  object.castShadow = (!material.transparent || material.opacity > .9) && !(material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0); object.receiveShadow = true; parent.add(object); return object;
}

function box(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, size: V3, p: V3, r?: V3) {
  return mesh(parent, new THREE.BoxGeometry(...size), material, p, undefined, r);
}

function sphere(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, size: V3, p: V3, r?: V3, detail = 18) {
  return mesh(parent, new THREE.SphereGeometry(1, detail, Math.max(10, detail / 2)), material, p, size, r);
}

function cyl(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, top: number, bottom: number, height: number, p: V3, r?: V3, sides = 16) {
  return mesh(parent, new THREE.CylinderGeometry(top, bottom, height, sides), material, p, undefined, r);
}

function torus(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, radius: number, thickness: number, p: V3, r: V3 = [0, 0, 0], arc = TAU, segments = 32) {
  return mesh(parent, new THREE.TorusGeometry(radius, thickness, 6, segments, arc), material, p, undefined, r);
}

function path(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, points: V3[], radius: number, radial = 6, segments = 20) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(parent, new THREE.TubeGeometry(curve, segments, radius, radial, false), material);
}

/** Cross-section lofts give the bodies and tools continuous, authored silhouettes. */
function loftGeometry(rings: Ring[], sides = 24, irregularity = 0): THREE.BufferGeometry {
  if (irregularity > 0 && rings.length > 2) {
    const smooth: Ring[] = [];
    const cubic = (a: number, b: number, c: number, d: number, t: number) => .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    for (let j = 0; j < rings.length - 1; j++) for (let s = 0; s < 5; s++) {
      const t = s / 5, a = rings[Math.max(0, j - 1)], b = rings[j], c = rings[j + 1], d = rings[Math.min(rings.length - 1, j + 2)];
      const value = (k: number) => cubic(a[k] ?? 0, b[k] ?? 0, c[k] ?? 0, d[k] ?? 0, t);
      smooth.push([THREE.MathUtils.lerp(b[0], c[0], t), Math.max(.001, value(1)), Math.max(.001, value(2)), value(3), value(4)]);
    }
    smooth.push(rings[rings.length - 1]); rings = smooth;
  }
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let j = 0; j < rings.length; j++) {
    const [y, rx, rz, ox = 0, oz = 0] = rings[j];
    for (let i = 0; i <= sides; i++) {
      const a = i / sides * TAU;
      const wobble = 1 + irregularity * (Math.sin(a * 5 + y * 4.1) * .6 + Math.cos(a * 9 - y * 2.8) * .4);
      positions.push(ox + Math.cos(a) * rx * wobble, y, oz + Math.sin(a) * rz * wobble);
      uv.push(i / sides, j / (rings.length - 1));
      if (i < sides && j < rings.length - 1) {
        const a0 = j * (sides + 1) + i, b = a0 + sides + 1;
        indices.push(a0, b, a0 + 1, a0 + 1, b, b + 1);
      }
    }
  }
  for (const end of [0, rings.length - 1]) {
    const [y, , , ox = 0, oz = 0] = rings[end], center = positions.length / 3, offset = end * (sides + 1);
    positions.push(ox, y, oz); uv.push(.5, end ? 1 : 0);
    for (let i = 0; i < sides; i++) {
      if (end === 0) indices.push(center, offset + i, offset + i + 1);
      else indices.push(center, offset + i + 1, offset + i);
    }
  }
  if (rings[rings.length - 1][0] < rings[0][0]) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}

function loft(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, rings: Ring[], p: V3 = [0, 0, 0], irregularity = 0, sides = 24) {
  return mesh(parent, loftGeometry(rings, sides, irregularity), material, p);
}

function spike(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, points: V3[], radius: number, sides = 7) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], steps = 14;
  const up = new THREE.Vector3(0, 0, 1), tangent = new THREE.Vector3(), right = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let j = 0; j <= steps; j++) {
    const t = j / steps, center = curve.getPoint(t); curve.getTangent(t, tangent);
    right.crossVectors(tangent, Math.abs(tangent.z) > .94 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    normal.crossVectors(right, tangent).normalize();
    const width = radius * Math.pow(1 - t, .7) + .001;
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * TAU, point = center.clone().addScaledVector(right, Math.cos(a) * width).addScaledVector(normal, Math.sin(a) * width);
      positions.push(point.x, point.y, point.z); uvs.push(k / sides, t);
      if (k < sides && j < steps) { const q = j * (sides + 1) + k, b = q + sides + 1; indices.push(q, b, q + 1, q + 1, b, b + 1); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices); geo.computeVertexNormals();
  return mesh(parent, geo, material);
}

function plate(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, shapePoints: [number, number][], depth: number, p: V3, r?: V3, bevel = .018) {
  const shape = new THREE.Shape(); shapePoints.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  return mesh(parent, geo, material, p, undefined, r);
}

function lathe(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, profile: [number, number][], p: V3 = [0, 0, 0], r?: V3, segments = 28) {
  return mesh(parent, new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments), material, p, undefined, r);
}

/** Batch static details by material; articulated joints remain separate. */
function bake(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    let geometry = object.geometry.clone();
    if (geometry.index) { const expanded = geometry.toNonIndexed(); geometry.dispose(); geometry = expanded; }
    geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const material = object.material as THREE.MeshStandardMaterial;
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material)!.push(geometry);
  });
  root.clear();
  for (const [material, parts] of buckets) {
    const geometry = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
    if (geometry) mesh(root, geometry, material);
    if (parts.length > 1) parts.forEach(part => part.dispose());
  }
  return root;
}

function rivets(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, points: V3[], size = .019) {
  points.forEach(p => sphere(parent, material, [size, size, size * .4], p, undefined, 8));
}

function rune(parent: THREE.Object3D, material: THREE.MeshStandardMaterial, x: number, y: number, z: number, scale = .1) {
  path(parent, material, [[x - scale * .4, y - scale, z], [x, y + scale, z], [x + scale * .4, y - scale, z]], scale * .06, 4, 6);
  path(parent, material, [[x - scale * .28, y - scale * .35, z], [x + scale * .28, y - scale * .35, z]], scale * .06, 4, 3);
}

function blade(parent: THREE.Object3D, p: ReturnType<typeof palette>, length: number, width: number, origin: V3) {
  const geometry = loftGeometry([[0, width * .72, .022], [.06, width, .023], [length * .72, width * .84, .018], [length * .92, width * .55, .012], [length, .001, .001]], 4);
  // Rotate diamond cross sections: a central ridge catches light along the blade.
  mesh(parent, geometry, p.steel, origin);
  plate(parent, p.darkIron, [[-.008, .03], [.008, .03], [.006, length * .69], [0, length * .81], [-.006, length * .69]], .001, [origin[0], origin[1], origin[2] + .023], undefined, 0);
}

function sword(parent: THREE.Group, p: ReturnType<typeof palette>) {
  cyl(parent, p.leather, .041, .046, .25, [0, .19, 0]);
  for (let i = 0; i < 8; i++) torus(parent, p.leatherLight, .044, .004, [0, .075 + i * .029, 0], [Math.PI / 2, .12, 0], TAU, 14);
  sphere(parent, p.brass, [.065, .056, .036], [0, .025, 0]);
  mesh(parent, new THREE.OctahedronGeometry(.029), p.gem, [0, .027, .035]);
  path(parent, p.brass, [[-.25, .34, .018], [-.17, .37, 0], [0, .32, 0], [.17, .37, 0], [.25, .34, .018]], .029, 8, 24);
  for (const x of [-.25, .25]) sphere(parent, p.brass, [.04, .03, .03], [x, .34, .018]);
  plate(parent, p.gold, [[-.045, -.07], [-.056, .06], [0, .105], [.056, .06], [.045, -.07]], .03, [0, .34, 0]);
  blade(parent, p, 1.02, .064, [0, .385, 0]);
  rune(parent, p.gold, 0, .495, .025, .043);
  parent.userData.grip = new THREE.Vector3(0, .2, 0);
}

function lantern(parent: THREE.Group, p: ReturnType<typeof palette>) {
  lathe(parent, p.brass, [[.005, 0], [.12, 0], [.14, .028], [.137, .06], [.105, .09], [.082, .11], [.067, .12], [.067, .135], [.001, .135]]);
  torus(parent, p.gold, .127, .009, [0, .041, 0], [Math.PI / 2, 0, 0]);
  lathe(parent, p.glass, [[.065, .12], [.087, .16], [.078, .28], [.06, .37]], [0, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU, x = Math.sin(a), z = Math.cos(a);
    path(parent, p.darkIron, [[x * .103, .095, z * .103], [x * .118, .22, z * .118], [x * .091, .38, z * .091]], .009, 5, 12);
  }
  lathe(parent, p.brass, [[.095, .37], [.11, .385], [.108, .407], [.078, .416], [.065, .435], [.058, .46], [.046, .473], [.002, .476]]);
  torus(parent, p.gold, .096, .008, [0, .399, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU;
    box(parent, p.black, [.015, .022, .004], [Math.sin(a) * .061, .441, Math.cos(a) * .061], [0, a, 0]);
  }
  path(parent, p.iron, [[-.092, .39, 0], [-.16, .55, 0], [-.115, .65, 0], [0, .688, 0], [.115, .65, 0], [.16, .55, 0], [.092, .39, 0]], .009, 7, 32);
  cyl(parent, p.copper, .014, .014, .055, [.105, .078, 0], [0, 0, Math.PI / 2], 12);
  cyl(parent, p.brass, .027, .027, .012, [.135, .078, 0], [0, 0, Math.PI / 2], 14);
  cyl(parent, p.black, .014, .019, .026, [0, .142, 0]);
  loft(parent, p.flame, [[0, .002, .002], [.018, .023, .023], [.062, .013, .014, .01, 0], [.102, .001, .001, -.006, 0]], [0, .155, 0], .12, 14);
  parent.userData.lightOrigin = new THREE.Vector3(0, .21, 0);
  parent.userData.grip = new THREE.Vector3(0, .67, 0);
}

function skull(parent: THREE.Group, p: ReturnType<typeof palette>, at: V3 = [0, 0, 0], scale = 1) {
  const head = group(parent, ...at); head.scale.setScalar(scale);
  loft(head, p.bone, [[.07, .06, .06, 0, .025], [.12, .13, .11, 0, .005], [.19, .16, .13], [.29, .145, .12, 0, -.012], [.35, .1, .085, 0, -.02], [.374, .003, .003]], [0, 0, 0], .038);
  for (const side of [-1, 1]) {
    sphere(head, p.black, [.052, .045, .026], [side * .073, .205, .109], [0, side * .16, side * .16]);
    path(head, p.bone, [[side * .022, .239, .123], [side * .075, .257, .115], [side * .133, .222, .09]], .014, 6, 10);
    path(head, p.bone, [[side * .13, .166, .079], [side * .107, .107, .105], [side * .026, .089, .13]], .021, 6, 10);
  }
  plate(head, p.black, [[0, .031], [-.023, -.022], [.023, -.022]], .008, [0, .159, .134], undefined, 0);
  for (let i = 0; i < 8; i++) box(head, p.bone, [.016, .029 + Math.cos(i * 2) * .003, .026], [(i - 3.5) * .022, .101, .131]);
  path(head, p.darkIron, [[-.025, .352, .06], [.005, .3, .121], [-.015, .26, .135]], .002, 4, 7);
}

function chest(parent: THREE.Group, p: ReturnType<typeof palette>, long = false) {
  const w = long ? 1.25 : .75, depth = long ? .58 : .48;
  for (let i = 0; i < 4; i++) box(parent, p.wood, [w, .105, depth], [0, .075 + i * .105, 0]);
  const lid = new THREE.Shape(); lid.moveTo(-depth / 2, 0); lid.lineTo(depth / 2, 0); lid.absellipse(0, 0, depth / 2, .19, 0, Math.PI, false, 0); lid.closePath();
  const lidGeo = new THREE.ExtrudeGeometry(lid, { depth: w, bevelEnabled: true, bevelThickness: .012, bevelSize: .008, bevelSegments: 2, steps: 1 });
  lidGeo.translate(0, 0, -w / 2);
  mesh(parent, lidGeo, p.wood, [0, .45, 0], undefined, [0, Math.PI / 2, 0]);
  for (const x of [-w * .36, w * .36]) {
    box(parent, p.darkIron, [.045, .45, depth + .015], [x, .245, 0]);
    path(parent, p.iron, [[x, .45, -depth / 2 - .008], [x, .59, -depth * .32], [x, .649, 0], [x, .59, depth * .32], [x, .45, depth / 2 + .008]], .021, 5, 18);
    rivets(parent, p.brass, [[x, .09, depth / 2 + .014], [x, .24, depth / 2 + .014], [x, .4, depth / 2 + .014]], .012);
  }
  plate(parent, p.brass, [[-.045, -.06], [-.045, .08], [0, .113], [.045, .08], [.045, -.06]], .018, [0, .36, depth / 2 + .027]);
  torus(parent, p.black, .011, .004, [0, .375, depth / 2 + .039], undefined, TAU, 12);
  for (const x of [-w * .5 - .02, w * .5 + .02]) torus(parent, p.iron, .055, .012, [x, .29, 0], [0, Math.PI / 2, 0]);
}

function book(parent: THREE.Group, p: ReturnType<typeof palette>) {
  box(parent, p.paper, [.33, .064, .43], [0, .044, 0]);
  for (let i = 0; i < 7; i++) box(parent, p.leatherLight, [.325, .0013, .428], [0, .016 + i * .009, 0]);
  box(parent, p.red, [.36, .018, .46], [0, .005, 0]);
  box(parent, p.red, [.36, .018, .46], [0, .086, 0]);
  box(parent, p.red, [.026, .097, .46], [-.169, .045, 0]);
  for (const x of [-.145, .145]) for (const z of [-.193, .193]) plate(parent, p.brass, [[-.03, -.03], [.03, -.03], [-.03, .03]], .008, [x, .1, z], [-Math.PI / 2, 0, x * z > 0 ? Math.PI : 0]);
  torus(parent, p.gold, .072, .005, [0, .1, 0], [-Math.PI / 2, 0, 0], TAU, 20);
  const emblem = group(parent, 0, .101, 0); emblem.rotation.x = -Math.PI / 2; rune(emblem, p.gold, 0, 0, 0, .055);
  box(parent, p.brass, [.12, .012, .025], [.131, .1, 0]);
  for (let i = 0; i < 4; i++) box(parent, p.brass, [.026, .004, .024], [-.169, .097, -.155 + i * .1]);
}

function flame(parent: THREE.Group, p: ReturnType<typeof palette>, at: V3, size = 1) {
  const fire = group(parent, ...at); fire.scale.setScalar(size);
  loft(fire, p.ember, [[0, .012, .012], [.048, .055, .045], [.13, .028, .024, -.018, 0], [.24, .001, .001, .025, 0]], [0, 0, 0], .14, 14);
  loft(fire, p.flame, [[0, .009, .009], [.034, .031, .028], [.09, .014, .012, -.011, .003], [.17, .001, .001, .018, 0]], [0, 0, .018], .1, 12);
}

function clueLettering(parent: THREE.Object3D, materials: Materials, text: string, width: number, height: number, at: V3, rotation?: V3, ink = '#40372a') {
  const key = `clue-lettering:${text}:${ink}`;
  if (!generatedMaterials.has(key)) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, 512, 256); ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = text.split('\n'); ctx.font = `${lines.length > 3 ? 30 : 39}px Georgia`;
    lines.forEach((line, i) => ctx.fillText(line, 256, 128 + (i - (lines.length - 1) / 2) * 50, 470));
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    generatedMaterials.set(key, new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: .12, side: THREE.DoubleSide, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  }
  mesh(parent, new THREE.PlaneGeometry(width, height), generatedMaterials.get(key)!, at, undefined, rotation);
}

function cluePaper(parent: THREE.Group, p: ReturnType<typeof palette>, materials: Materials, kind: string) {
  const board = kind === 'clipboard' || kind === 'manifest';
  const sheet = group(parent, 0, board ? .06 : .013, 0); sheet.rotation.x = -Math.PI / 2; sheet.rotation.z = kind === 'sketch' ? -.18 : .09;
  if (board) {
    plate(sheet, p.wood, [[-.36, -.45], [.36, -.45], [.36, .44], [.32, .48], [-.32, .48], [-.36, .44]], .035, [0, 0, -.026], undefined, .008);
    box(sheet, p.iron, [.24, .055, .025], [0, .399, .018]); torus(sheet, p.darkIron, .04, .008, [0, .455, .01]);
  }
  plate(sheet, p.paper, [[-.31, -.39], [-.23, -.405], [-.19, -.382], [.18, -.4], [.215, -.35], [.28, -.36], [.315, .29], [.28, .393], [-.3, .4], [-.319, .18]], .006, [0, 0, 0], undefined, 0);
  // A lifted torn corner and crease distinguish loose paper from a floor icon.
  plate(sheet, p.paper, [[0, 0], [.105, .012], [.035, .11]], .005, [.204, -.371, .016], [-.23, -.12, .05], 0);
  path(sheet, p.leatherLight, [[-.294, -.06, .004], [-.075, -.057, .006], [.143, -.063, .005], [.298, -.061, .004]], .0015, 4, 4);
  const inkKey = `paperInk:${kind}`;
  if (!generatedMaterials.has(inkKey)) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 640;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#473b2b'; ctx.strokeStyle = '#64513c'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.font = 'italic 31px Georgia'; ctx.textAlign = 'center';
    const stroke = (points: [number, number][]) => { ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };
    if (kind === 'sketch') {
      ctx.fillText('The dome', 256, 73);
      ctx.beginPath(); ctx.ellipse(256, 316, 192, 86, -.04, 0, TAU); ctx.stroke();
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, x = 256 + Math.cos(a) * 190, y = 316 + Math.sin(a) * 86; stroke([[x, y], [x + 4, y - 79], [x + 10, y - 81], [x + 7, y]]); }
      stroke([[77, 321], [143, 423], [326, 427], [435, 316]]);
      ctx.font = 'italic 17px Georgia'; ctx.fillText('from the gallery', 254, 531);
    } else if (kind === 'route_notes') {
      ctx.fillText('Gallery', 256, 73); ctx.font = 'italic 22px Georgia';
      for (const [x, y] of [[74, 276], [428, 198], [398, 488]]) { stroke([[256, 316], [(256 + x) / 2 + 11, (316 + y) / 2 - 15], [x, y]]); ctx.beginPath(); ctx.ellipse(x, y, 19, 16, .12, 0, TAU); ctx.stroke(); }
      ctx.fillText('Dome', 88, 241); ctx.fillText('Dam', 414, 169);
    } else {
      const heading = kind === 'manifest' ? ['Mill delivery', 'Coal gas', 'No exposed flame'] : kind === 'clipboard' ? ['Maintenance', 'Control panel'] : ['Notes'];
      heading.forEach((line, i) => ctx.fillText(line, 256, 68 + i * 40, 440));
      ctx.strokeStyle = '#887058'; ctx.lineWidth = .85;
      for (let row = 0; row < 10; row++) for (let word = 0; word < 4; word++) {
        const x = 39 + word * 111, y = 222 + row * 32, width = 53 + ((row * 3 + word * 7) % 5) * 8;
        const points: [number, number][] = [];
        for (let j = 0; j <= 18; j++) points.push([x + j / 18 * width, y + Math.sin(j * 2.3 + row) * 2.3 + Math.sin(j * .9 + word) * 1.7]);
        stroke(points);
      }
      if (kind === 'clipboard') { ctx.strokeStyle = '#52634a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(367, 475, 59, 39, -.15, 0, TAU); ctx.stroke(); }
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    generatedMaterials.set(inkKey, new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: .08, roughness: 1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
  }
  // Ink stays flush with the paper; it is not raised wire geometry.
  mesh(sheet, new THREE.PlaneGeometry(.58, .72), generatedMaterials.get(inkKey)!, [0, 0, .0036]);
}

function carvedFragment(parent: THREE.Group, materials: Materials, p: ReturnType<typeof palette>, kind: string) {
  const stone = mat(materials, 'clueCarvedStone', '#8d8a79', .96, 0, { map: materials.rock?.map, normalMap: materials.rock?.normalMap ?? surfaceGrain(), normalScale: new THREE.Vector2(.26, .26) });
  const carving = mat(materials, 'clueCarvedIncisions', '#3d4138', 1);
  const fragment = group(parent, 0, .29, 0); fragment.rotation.x = -.82; fragment.rotation.z = -.055;
  plate(fragment, stone, [[-.59, -.26], [-.45, -.41], [.23, -.39], [.54, -.22], [.59, .19], [.32, .41], [-.21, .39], [-.55, .21]], .2, [0, 0, 0], undefined, .009);
  if (kind === 'royal_relief') {
    const pigments = ['#95504c', '#a76d42', '#b3a066', '#697c51', '#647d87', '#5c647f', '#746180'];
    pigments.forEach((tint, i) => torus(fragment, mat(materials, `fadedRelief${i}`, tint, .96), .24 + i * .035, .008, [0, -.05, .109], undefined, Math.PI, 30));
    sphere(fragment, stone, [.044, .055, .014], [0, .015, .115]);
    path(fragment, stone, [[-.1, -.26, .115], [0, -.06, .117], [.04, -.24, .115]], .026, 6, 5);
    path(fragment, carving, [[.12, -.28, .116], [.12, .055, .116]], .006, 4, 3);
    path(fragment, stone, [[0, -.067, .123], [.12, -.012, .123]], .017, 5, 4);
  } else if (kind === 'mirror_tablet') {
    for (const x of [-.25, .25]) {
      path(fragment, carving, [[x - .12, -.19, .108], [x - .12, .17, .108], [x + .12, .17, .108], [x + .12, -.19, .108]], .01, 4, 6);
      path(fragment, carving, [[x - .14, -.2, .108], [x + .14, -.2, .108]], .008, 4, 3);
    }
    path(fragment, p.steel, [[-.1, 0, .11], [.1, 0, .11]], .008, 4, 3);
  } else if (kind === 'sand_marks') {
    path(fragment, carving, [[-.23, .25, .108], [-.08, .02, .108], [.07, -.22, .108]], .012, 5, 6);
    sphere(fragment, p.gold, [.019, .012, .007], [.065, -.23, .11], undefined, 10);
  } else {
    for (let row = 0; row < 4; row++) for (let word = 0; word < 3; word++) {
      const x = -.39 + word * .27, y = .18 - row * .105;
      path(fragment, carving, [[x, y, .108], [x + .06, y + .008, .108], [x + .15, y - .004, .108], [x + .205, y, .108]], .004, 4, 5);
    }
    if (kind === 'axe_scars') for (let i = 0; i < 3; i++) path(fragment, carving, [[-.35 + i * .15, -.27, .111], [-.08 + i * .18, .285, .111]], .012, 4, 4);
  }
}

/** Every collectible has an authored, recognizable physical object. */
export function makeProp(type: string, materials: Materials = {}): THREE.Group {
  const result = group(); result.name = `prop:${type}`;
  const p = palette(materials);
  switch (type.toLowerCase()) {
    case 'hatch': case 'surface': break;
    case 'torn_note': case 'sketch': case 'route_notes': case 'clipboard': case 'manifest': cluePaper(result, p, materials, type); break;
    case 'carved_warning': case 'axe_scars': case 'royal_relief': case 'mirror_tablet': case 'sand_marks': carvedFragment(result, materials, p, type); break;
    case 'sword': sword(result, p); break;
    case 'lantern': case 'lamp': lantern(result, p); break;
    case 'resting_sword': {
      const laid = group(result), weapon = group(laid);
      sword(weapon, p);
      // The blade and hilt settle on the tabletop at a slight diagonal.
      weapon.rotation.x = -Math.PI / 2 - .0333;
      laid.rotation.y = Math.PI / 2 - .13;
      laid.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(laid, true), center = bounds.getCenter(new THREE.Vector3());
      laid.position.set(-center.x, -bounds.min.y, -center.z);
      break;
    }
    case 'resting_lantern': {
      const bulb = mat(materials, 'foundLanternBulb', '#bba681', .68, 0, { emissiveIntensity: 0 });
      lantern(result, { ...p, flame: bulb });
      break;
    }
    case 'mailbox': {
      box(result, p.wood, [.13, .98, .13], [0, .49, 0]);
      box(result, p.wood, [.62, .065, .26], [0, .88, 0]);
      const hood = new THREE.Shape(); hood.moveTo(-.18, 0); hood.lineTo(.18, 0); hood.lineTo(.18, .15); hood.absellipse(0, .15, .18, .17, 0, Math.PI, false, 0); hood.closePath();
      const inner = new THREE.Path(); inner.moveTo(-.15, .028); inner.lineTo(-.15, .15); inner.absellipse(0, .15, .15, .14, Math.PI, 0, true, 0); inner.lineTo(.15, .028); inner.closePath(); hood.holes.push(inner);
      const geo = new THREE.ExtrudeGeometry(hood, { depth: .51, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 2, steps: 1 }); geo.translate(0, 0, -.255);
      mesh(result, geo, p.darkIron, [0, .92, 0]);
      plate(result, p.darkIron, [[-.172, 0], [.172, 0], [.172, .2], [.09, .305], [-.09, .305], [-.172, .2]], .018, [0, .924, -.252]);
      const door = group(result, 0, .927, .272); door.name = 'mailbox-door';
      door.userData.articulated = true; door.userData.hingeAxis = 'x'; door.userData.closedAngle = 0; door.userData.openAngle = Math.PI * .53;
      plate(door, p.iron, [[-.165, 0], [.165, 0], [.165, .21], [.09, .294], [-.09, .294], [-.165, .21]], .018, [0, 0, 0]);
      box(door, p.black, [.235, .019, .02], [0, .196, .017]);
      box(door, p.brass, [.085, .026, .037], [0, .256, .031]);
      cyl(result, p.copper, .009, .009, .23, [.206, 1.15, -.04]);
      box(result, p.red, [.011, .105, .115], [.208, 1.247, .005]);
      for (const x of [-.13, .13]) rivets(door, p.brass, [[x, .028, .013], [x, .193, .013]], .009);
      for (const x of [-.11, .11]) cyl(result, p.brass, .018, .018, .065, [x, .932, .273], [0, 0, Math.PI / 2], 12);
      bake(door);
      break;
    }
    case 'book': case 'guide': case 'map': book(result, p); break;
    case 'rug': {
      box(result, p.red, [2.05, .024, 1.4], [0, .014, 0]);
      for (const z of [-.61, .61]) box(result, p.brass, [1.91, .002, .024], [0, .028, z]);
      for (const x of [-.94, .94]) box(result, p.brass, [.022, .002, 1.23], [x, .028, 0]);
      const ornament = group(result, 0, .03, 0); ornament.rotation.x = -Math.PI / 2;
      plate(ornament, p.leatherLight, [[0, -.44], [.57, 0], [0, .44], [-.57, 0]], .002, [0, 0, 0], undefined, 0);
      plate(ornament, p.red, [[0, -.36], [.46, 0], [0, .36], [-.46, 0]], .003, [0, 0, .003], undefined, 0);
      torus(ornament, p.brass, .14, .006, [0, 0, .005], undefined, TAU, 24);
      for (let i = 0; i < 32; i++) for (const side of [-1, 1]) path(result, p.paper, [[side * 1.02, .012, -.66 + i * .043], [side * 1.09, .007, -.66 + i * .043 + Math.sin(i) * .01]], .002, 3, 2);
      break;
    }
    case 'table': {
      for (let z = 0; z < 5; z++) box(result, p.wood, [1.65, .1, .184], [0, .79, (z - 2) * .19]);
      for (const x of [-.62, .62]) for (const z of [-.32, .32]) {
        box(result, p.wood, [.11, .75, .11], [x, .375, z], [0, 0, -x * .055]);
        box(result, p.darkIron, [.12, .07, .12], [x, .15, z]);
      }
      box(result, p.wood, [1.37, .1, .09], [0, .28, 0]);
      for (const x of [-.61, .61]) box(result, p.wood, [.09, .1, .74], [x, .28, 0]);
      for (const x of [-.65, .65]) for (const z of [-.37, .37]) sphere(result, p.darkIron, [.012, .004, .012], [x, .844, z]);
      break;
    }
    case 'case': case 'trophy_case': {
      const shelfGlow = mat(materials, 'caseShelfGlow', '#ebd8ac', .55, 0, { emissive: '#e6bf7b', emissiveIntensity: 1.3 });
      const cabinetGlass = mat(materials, 'cabinetGlass', '#e4ede8', .49, 0, { transparent: true, opacity: .032, depthWrite: false, side: THREE.FrontSide, envMapIntensity: .08, normalMap: null, map: null, roughnessMap: null });
      box(result, p.wood, [2.77, .19, .86], [0, .1, 0]);
      box(result, p.darkIron, [2.88, .043, .92], [0, .021, 0]);
      for (const y of [.25, .95, 1.65, 2.35]) {
        box(result, p.wood, [2.65, .07, .78], [0, y, 0]);
        box(result, p.brass, [2.49, .012, .013], [0, y - .008, .398]);
        if (y > .3) box(result, shelfGlow, [2.36, .009, .016], [0, y - .051, .266]);
      }
      for (const x of [-1.3, 1.3]) for (const z of [-.374, .374]) {
        box(result, p.wood, [.09, 2.25, .089], [x, 1.335, z]);
        box(result, p.brass, [.012, 2.19, .014], [x, 1.335, z + Math.sign(z) * .047]);
      }
      box(result, p.leather, [2.48, 2.085, .022], [0, 1.31, -.387]);
      for (const x of [-1.251, 1.251]) box(result, cabinetGlass, [.008, 2.069, .711], [x, 1.312, -.005]);
      box(result, cabinetGlass, [2.485, 2.069, .01], [0, 1.312, .421]);
      for (const x of [-1.187, 1.187]) for (const y of [.419, 2.194]) {
        box(result, p.brass, [.045, .089, .021], [x, y, .433]);
        rivets(result, p.darkIron, [[x, y - .025, .446], [x, y + .025, .446]], .006);
      }
      plate(result, p.brass, [[-.033, -.048], [.033, -.048], [.033, .048], [-.033, .048]], .016, [1.151, 1.308, .437]);
      torus(result, p.brass, .034, .008, [1.149, 1.283, .456], undefined, TAU, 18);
      box(result, p.wood, [2.92, .115, .96], [0, 2.437, 0]);
      box(result, p.brass, [2.84, .017, .018], [0, 2.464, .487]);
      plate(result, p.wood, [[-.56, 0], [.56, 0], [.42, .075], [0, .129], [-.42, .075]], .19, [0, 2.492, .06], undefined, .01);
      torus(result, p.brass, .048, .005, [0, 2.552, .163], undefined, TAU, 20);
      rune(result, p.gold, 0, 2.552, .165, .028);
      const slotRows = [[-1.08, -.72, -.36, 0, .36, .72, 1.08], [-.975, -.585, -.195, .195, .585, .975], [-.975, -.585, -.195, .195, .585, .975]];
      result.userData.displaySlots = slotRows.flatMap((xs, row) => xs.map(x => [x, .293 + row * .7, .055]));
      result.userData.shelfHeights = [.293, .993, 1.693];
      result.userData.itemMaxSize = [.28, .48, .3];
      result.userData.interiorBounds = { min: [-1.23, .293, -.36], max: [1.23, 2.3, .395] };
      break;
    }
    case 'chest': case 'trunk': chest(result, p, type === 'trunk'); break;
    case 'egg': {
      loft(result, p.gold, [[0, .001, .001], [.018, .08, .08], [.06, .13, .13], [.16, .16, .16], [.26, .129, .129], [.37, .065, .065], [.409, .001, .001]], [0, 0, 0]);
      for (const y of [.105, .215]) torus(result, p.brass, y === .105 ? .151 : .15, .006, [0, y, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU;
        path(result, p.copper, [[Math.sin(a) * .047, .35, Math.cos(a) * .047], [Math.sin(a + .16) * .15, .19, Math.cos(a + .16) * .15], [Math.sin(a) * .065, .032, Math.cos(a) * .065]], .004, 4, 14);
        mesh(result, new THREE.OctahedronGeometry(.018), i % 2 ? p.jade : p.gem, [Math.sin(a) * .154, .18, Math.cos(a) * .154]);
      }
      break;
    }
    case 'bird': {
      spike(result, p.wood, [[0, 0, 0], [-.035, .54, .025], [.055, 1.01, -.023], [-.04, 1.2, .014]], .074, 10);
      path(result, p.wood, [[-.005, .89, 0], [.22, 1.08, .04], [.36, 1.13, .06]], .022, 6, 14);
      const bird = group(result, .2, 1.095, .048);
      sphere(bird, p.leatherLight, [.075, .086, .11], [0, .09, 0]);
      sphere(bird, p.red, [.059, .067, .02], [0, .107, .097]);
      sphere(bird, p.leather, [.052, .057, .055], [0, .186, .055]);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) spike(bird, p.leather, [[side * .06, .137 - i * .01, .021 - i * .013], [side * .087, .069 - i * .008, -.1 - i * .017]], .015, 5);
        sphere(bird, p.black, [.008, .008, .008], [side * .046, .197, .084], undefined, 10);
        path(bird, p.darkIron, [[side * .026, .035, 0], [side * .028, .005, .025], [side * .042, .002, .047]], .003, 4, 5);
      }
      spike(bird, p.darkIron, [[0, .18, .101], [0, .171, .146]], .016, 6);
      for (let i = -1; i <= 1; i++) spike(bird, p.leather, [[i * .017, .061, -.066], [i * .025, -.012, -.217]], .018, 5);
      break;
    }
    case 'canary': {
      sphere(result, p.gold, [.1, .11, .14], [0, .13, 0]); sphere(result, p.gold, [.073, .078, .071], [0, .254, .07]);
      for (const side of [-1, 1]) {
        plate(result, p.brass, [[-.025, .06], [.09, -.07], [-.04, -.08]], .008, [side * .07, .147, -.012], [0, side * .47, side * .38]);
        sphere(result, p.black, [.009, .009, .009], [side * .058, .276, .112], undefined, 10);
        path(result, p.copper, [[side * .035, .065, 0], [side * .035, .014, .013], [side * .062, .008, .063]], .006, 5, 7);
      }
      spike(result, p.brass, [[0, .25, .121], [0, .246, .19]], .022);
      for (let i = -1; i <= 1; i++) spike(result, p.brass, [[i * .019, .095, -.09], [i * .038, .03, -.29]], .024);
      break;
    }
    case 'bauble': {
      const brass = mat(materials, 'baubleBrass', '#b58d3c', .28, .89);
      sphere(result, brass, [.1, .1, .1], [0, .103, 0], undefined, 32);
      torus(result, p.brass, .0998, .0014, [0, .103, 0], [Math.PI / 2, 0, 0], TAU, 40);
      break;
    }
    case 'diamond': {
      const diamond = crystalMaterial(materials, 'diamondCrystal', '#e7f5f8', { roughness: .045, transmission: .83, ior: 2.3, thickness: .16, attenuationDistance: 2.5, flatShading: true });
      const cut = loftGeometry([[0, .001, .001], [.105, .13, .13], [.126, .134, .134], [.139, .128, .128], [.224, .073, .073]], 16).toNonIndexed(); cut.computeVertexNormals();
      mesh(result, cut, diamond, [0, .006, 0]);
      break;
    }
    case 'emerald': {
      const emerald = crystalMaterial(materials, 'cutEmerald', '#0e8045', { roughness: .13, transmission: .32, thickness: .14, ior: 1.57, attenuationColor: '#087345', attenuationDistance: .17, flatShading: true });
      plate(result, emerald, [[-.089, -.118], [-.062, -.15], [.062, -.15], [.089, -.118], [.089, .118], [.062, .15], [-.062, .15], [-.089, .118]], .089, [0, .178, 0], undefined, .025);
      break;
    }
    case 'jade': {
      const jade = mat(materials, 'carvedJade', '#34715c', .33, .02, { map: patina, normalMap: surfaceGrain(), normalScale: new THREE.Vector2(.075, .075) });
      const engraving = mat(materials, 'jadeEngraving', '#1c4d3b', .58);
      lathe(result, jade, [[0, 0], [.112, 0], [.138, .011], [.139, .024], [.12, .039], [.09, .046], [0, .046]], [0, 0, 0], undefined, 28);
      loft(result, jade, [[.042, .086, .059], [.104, .099, .062, 0, -.008], [.173, .073, .052, 0, -.012], [.226, .069, .048], [.247, .037, .032], [.258, .027, .026]], [0, 0, 0], .019, 24);
      for (const side of [-1, 1]) {
        sphere(result, jade, [.079, .033, .058], [side * .048, .069, .026], [0, 0, side * .17], 22);
        path(result, jade, [[side * .057, .218, 0], [side * .089, .151, .037], [side * .035, .155, .068]], .018, 8, 16);
        sphere(result, jade, [.018, .016, .014], [side * .02, .163, .068], undefined, 16);
        path(result, engraving, [[side * .028, .218, .045], [side * .044, .128, .057], [side * .095, .072, .067]], .0025, 4, 12);
      }
      sphere(result, jade, [.047, .057, .043], [0, .293, .002], undefined, 28);
      sphere(result, jade, [.022, .018, .021], [0, .35, -.004], undefined, 18);
      loft(result, jade, [[0, .019, .02], [.033, .016, .023], [.06, .007, .009]], [0, .271, .037], .012, 14);
      for (const side of [-1, 1]) path(result, engraving, [[side * .012, .302, .043], [side * .025, .3, .041], [side * .033, .302, .036]], .0024, 4, 8);
      path(result, engraving, [[-.014, .272, .043], [0, .269, .049], [.012, .272, .043]], .0023, 4, 7);
      torus(result, jade, .038, .004, [0, .267, 0], [Math.PI / 2, 0, 0], TAU, 22);
      break;
    }
    case 'painting': {
      box(result, p.black, [1.04, 1.36, .04], [0, .72, 0]);
      for (const x of [-.54, .54]) { box(result, p.gold, [.1, 1.51, .105], [x, .72, .018]); box(result, p.brass, [.02, 1.46, .02], [x + Math.sign(x) * .045, .72, .082]); }
      for (const y of [-.005, 1.445]) { box(result, p.gold, [1.16, .1, .105], [0, y, .018]); box(result, p.brass, [1.12, .02, .02], [0, y + Math.sign(y - .72) * .045, .082]); }
      // An embossed nocturne: the old empire's white tower under a beaten-gold moon.
      sphere(result, p.brass, [.137, .137, .005], [.26, 1.15, .027]);
      plate(result, p.leatherLight, [[-.48, -.25], [-.3, .1], [-.12, -.12], [.07, .2], [.4, -.22], [.48, -.28]], .004, [0, .64, .03], undefined, 0);
      plate(result, p.stone, [[-.12, -.36], [-.1, .42], [-.16, .42], [-.16, .49], [-.09, .49], [-.09, .55], [-.02, .55], [-.02, .49], [.05, .49], [.05, .42], [0, .42], [.035, -.36]], .004, [0, .58, .039], undefined, 0);
      for (let i = 0; i < 4; i++) box(result, p.gold, [.024, .05, .004], [-.06, .53 + i * .128, .045]);
      for (const x of [-.54, .54]) for (const y of [.02, 1.42]) mesh(result, new THREE.OctahedronGeometry(.055), p.brass, [x, y, .085], [1, 1, .4]);
      break;
    }
    case 'bar': case 'platinum_bar': {
      const platinum = mat(materials, 'treasurePlatinum', '#c7cecd', .31, .95);
      plate(result, platinum, [[-.23, 0], [.23, 0], [.18, .12], [-.18, .12]], .18, [0, .012, 0]);
      const g = group(result, 0, .145, 0); g.rotation.x = -Math.PI / 2; rune(g, p.iron, 0, 0, 0, .044); break;
    }
    case 'gold': case 'pot_of_gold': {
      lathe(result, p.darkIron, [[0, 0], [.092, 0], [.134, .025], [.16, .065], [.17, .17], [.146, .235], [.155, .258], [.155, .278], [.132, .279], [.132, .248], [.143, .168], [.135, .08], [.09, .041], [0, .041]], [0, 0, 0], undefined, 32);
      torus(result, p.copper, .151, .008, [0, .272, 0], [Math.PI / 2, 0, 0], TAU, 28);
      for (const side of [-1, 1]) {
        torus(result, p.copper, .047, .009, [side * .179, .19, .007], undefined, TAU, 22);
        sphere(result, p.darkIron, [.021, .028, .023], [side * .156, .22, .002], undefined, 14);
      }
      for (let i = 0; i < 43; i++) {
        const a = i * 2.399963, r = Math.sqrt(i / 43) * .127, x = Math.sin(a) * r, z = Math.cos(a) * r, y = .274 + (1 - r / .14) * .03 + (i % 3) * .004;
        cyl(result, i % 5 ? p.gold : p.brass, .023, .023, .007, [x, y, z], [Math.sin(i * 1.7) * .16, i, Math.cos(i) * .15], 14);
        if (i % 4 === 0) torus(result, p.brass, .015, .0015, [x, y + .0046, z], [Math.PI / 2, 0, 0], TAU, 12);
      }
      break;
    }
    case 'torch': {
      const ivory = mat(materials, 'carvedIvory', '#d2c29a', .66, 0, { normalScale: new THREE.Vector2(.065, .065) });
      lathe(result, ivory, [[.017, 0], [.035, .016], [.037, .043], [.024, .077], [.026, .35], [.036, .395], [.043, .435], [.059, .491], [.063, .524], [.043, .55], [.015, .55]], [0, 0, 0], undefined, 24);
      for (let i = 0; i < 6; i++) torus(result, ivory, .028, .003, [0, .105 + i * .037, 0], [Math.PI / 2, 0, 0], TAU, 18);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; path(result, p.brass, [[Math.sin(a) * .027, .385, Math.cos(a) * .027], [Math.sin(a) * .05, .49, Math.cos(a) * .05], [Math.sin(a) * .041, .551, Math.cos(a) * .041]], .004, 4, 12); }
      cyl(result, p.brass, .053, .036, .036, [0, .552, 0]); flame(result, p, [0, .57, 0]); break;
    }
    case 'bracelet': case 'necklace': {
      const n = type === 'necklace' ? 28 : 14, radius = type === 'necklace' ? .21 : .1;
      for (let i = 0; i < n; i++) { const a = i / n * TAU; torus(result, p.gold, .018, .005, [Math.sin(a) * radius, .025, Math.cos(a) * radius * 1.25], [Math.PI / 2 + (i % 2) * .9, 0, -a], TAU, 12); }
      if (type === 'bracelet') {
        const sapphire = mat(materials, 'braceletSapphire', '#17438c', .17, .18);
        for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; mesh(result, new THREE.OctahedronGeometry(.024), sapphire, [Math.sin(a) * radius, .044, Math.cos(a) * radius * 1.25], [1, .58, 1]); }
      }
      if (type === 'necklace') { mesh(result, new THREE.OctahedronGeometry(.045), p.gem, [0, .03, radius * 1.25 + .035], [1, .45, 1.3]); torus(result, p.gold, .042, .007, [0, .026, radius * 1.25 + .035], [Math.PI / 2, 0, 0]); }
      break;
    }
    case 'trident': {
      const crystal = crystalMaterial(materials, 'clearQuartz', '#d9efed', { flatShading: true });
      const silver = mat(materials, 'treasureSilver', '#bfc9cc', .29, .94);
      cyl(result, crystal, .021, .024, 1.1, [0, .58, 0], undefined, 8);
      for (const y of [.18, .38, 1.075]) torus(result, silver, .027, .004, [0, y, 0], [Math.PI / 2, 0, 0]);
      path(result, crystal, [[-.21, 1.45, 0], [-.21, 1.19, 0], [0, 1.09, 0], [.21, 1.19, 0], [.21, 1.45, 0]], .029, 6, 20);
      for (const x of [-.21, 0, .21]) { spike(result, crystal, [[x, 1.29, 0], [x, x ? 1.53 : 1.68, 0]], .047, 6); torus(result, silver, .038, .004, [x, 1.3, 0], [Math.PI / 2, 0, 0]); }
      mesh(result, new THREE.OctahedronGeometry(.053), crystal, [0, 1.12, .03]); break;
    }
    case 'coffin': case 'tomb': {
      const isTomb = type === 'tomb', material = isTomb ? p.stone : p.gold;
      const outline: [number, number][] = [[-.23, -.88], [.23, -.88], [.38, .35], [.27, .78], [-.27, .78], [-.38, .35]];
      plate(result, material, outline, isTomb ? .6 : .35, [0, isTomb ? .34 : .2, 0], [-Math.PI / 2, 0, 0], .03);
      const lapis = mat(materials, 'coffinLapis', '#214d68', .39, .16);
      plate(result, isTomb ? p.darkIron : p.brass, outline.map(([x, y]) => [x * .87, y * .93]), .022, [0, isTomb ? .664 : .388, 0], [-Math.PI / 2, 0, 0], .013);
      const ornament = group(result, 0, isTomb ? .68 : .412, -.16); ornament.rotation.x = -Math.PI / 2; skull(ornament, isTomb ? p : { ...p, bone: p.gold, black: lapis }, [0, -.15, 0], .65);
      if (!isTomb) {
        for (let i = 0; i < 6; i++) box(result, i % 2 ? p.gold : lapis, [.34 - i * .014, .005, .025], [0, .408, .08 + i * .086]);
        for (const x of [-.145, .145]) box(result, p.gold, [.01, .006, .505], [x, .41, .288]);
      }
      for (const x of [-.37, .37]) for (const z of [-.42, .28]) torus(result, p.brass, .065, .013, [x, .24, z], [0, Math.PI / 2, 0]);
      break;
    }
    case 'sceptre': {
      cyl(result, p.gold, .023, .031, .67, [0, .35, 0]);
      for (let i = 0; i < 8; i++) torus(result, p.brass, .029, .004, [0, .045 + i * .07, 0], [Math.PI / 2, 0, 0], TAU, 14);
      mesh(result, new THREE.IcosahedronGeometry(.105, 1), p.gem, [0, .79, 0]);
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; spike(result, p.gold, [[Math.sin(a) * .025, .64, Math.cos(a) * .025], [Math.sin(a) * .12, .78, Math.cos(a) * .12], [Math.sin(a) * .038, .92, Math.cos(a) * .038]], .02); }
      break;
    }
    case 'coins': case 'coin': {
      for (let i = 0; i < 28; i++) { const a = i * 2.4, r = Math.sqrt(i / 28) * .23; const x = Math.sin(a) * r, z = Math.cos(a) * r; cyl(result, i % 5 ? p.gold : p.brass, .034, .034, .01, [x, .013 + (i % 4) * .012, z], [Math.sin(i) * .12, 0, Math.cos(i) * .09], 14); if (i % 3 === 0) torus(result, p.brass, .024, .002, [x, .02 + (i % 4) * .012, z], [Math.PI / 2, 0, 0], TAU, 12); }
      if (type === 'coin' || type === 'coins') {
        loft(result, p.leather, [[0, .068, .06], [.04, .12, .088], [.15, .112, .08], [.21, .051, .036], [.239, .075, .059]], [-.1, .027, -.06], .05, 20);
        torus(result, p.leatherLight, .058, .008, [-.1, .238, -.06], [Math.PI / 2, 0, 0], TAU, 18);
        path(result, p.paper, [[-.15, .23, -.06], [-.2, .18, -.04], [-.16, .14, .028]], .004, 4, 8);
      }
      break;
    }
    case 'chalice': {
      const silver = mat(materials, 'treasureSilver', '#bfc9cc', .29, .94);
      lathe(result, silver, [[0, 0], [.13, 0], [.14, .017], [.11, .036], [.049, .07], [.026, .12], [.024, .21], [.05, .24], [.104, .29], [.135, .4], [.137, .445], [.122, .445], [.116, .39], [.088, .3], [.037, .265], [0, .253]]);
      torus(result, silver, .133, .009, [0, .444, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; mesh(result, new THREE.OctahedronGeometry(.016), p.gem, [Math.sin(a) * .122, .372, Math.cos(a) * .122]); }
      break;
    }
    case 'skull': {
      const quartz = crystalMaterial(materials, 'clearQuartz', '#d9efed', { flatShading: true });
      const smoky = crystalMaterial(materials, 'smokyQuartz', '#526e68', { roughness: .21, transmission: .3, thickness: .035 });
      skull(result, { ...p, bone: quartz, black: smoky, darkIron: quartz }); break;
    }
    case 'scarab': {
      sphere(result, p.jade, [.12, .047, .165], [0, .057, 0]);
      path(result, p.gold, [[0, .103, -.15], [0, .108, .13]], .005, 4, 8);
      sphere(result, p.gold, [.085, .035, .058], [0, .04, .163]);
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) path(result, p.gold, [[side * .08, .043, -.07 + i * .085], [side * .16, .024, -.115 + i * .11], [side * .177, .008, -.06 + i * .09]], .012, 5, 8);
      break;
    }
    case 'wrench': {
      plate(result, p.iron, [[-.032, 0], [.032, 0], [.034, .3], [.105, .35], [.1, .45], [.045, .47], [.039, .391], [-.039, .391], [-.045, .47], [-.1, .45], [-.105, .35], [-.034, .3]], .026, [0, .015, 0], undefined, .008);
      torus(result, p.darkIron, .018, .006, [0, .062, .016], undefined, TAU, 12); break;
    }
    case 'screwdriver': {
      loft(result, p.wood, [[0, .025, .025], [.025, .036, .036], [.14, .032, .032], [.18, .021, .021]], [0, 0, 0], 0, 10);
      cyl(result, p.brass, .025, .025, .025, [0, .168, 0]); cyl(result, p.steel, .008, .008, .25, [0, .3, 0]);
      box(result, p.steel, [.024, .036, .008], [0, .425, 0]); break;
    }
    case 'pump': {
      cyl(result, p.darkIron, .055, .063, .5, [0, .265, 0]); box(result, p.iron, [.29, .028, .17], [0, .022, 0]);
      cyl(result, p.steel, .014, .014, .23, [0, .607, 0]); cyl(result, p.wood, .029, .029, .25, [0, .728, 0], [0, 0, Math.PI / 2]);
      path(result, p.black, [[.04, .11, 0], [.23, .075, .05], [.35, .28, .04], [.23, .34, .04]], .011, 7, 20); break;
    }
    case 'boat_folded': {
      const plastic = mat(materials, 'foldedBoatRubber', '#a68b67', .76, 0, { side: THREE.DoubleSide, normalScale: new THREE.Vector2(.1, .1) });
      const seam = mat(materials, 'foldedBoatSeam', '#806849', .83, 0, { normalScale: new THREE.Vector2(.06, .06) });
      const valveRubber = mat(materials, 'boatValveRubber', '#342f25', .87);
      // One continuous membrane doubles back twice, leaving actual gaps and curled edges.
      const profile: V3[] = [[0, .043, -.66], [0, .045, 0], [0, .05, .63], [0, .078, .72],
        [0, .115, .64], [0, .108, 0], [0, .10, -.61], [0, .131, -.72],
        [0, .179, -.61], [0, .174, -.04], [0, .166, .51], [0, .209, .65], [0, .258, .55]];
      const fold = new THREE.CatmullRomCurve3(profile.map(point => new THREE.Vector3(...point)));
      const surface = (u: number, v: number) => {
        const point = fold.getPoint(v), cross = u - .5;
        point.x = cross * (1.11 + .046 * Math.sin(v * 13) + .022 * Math.cos(v * 29)) + .018 * Math.sin(v * 17);
        point.y += .009 * Math.sin(u * 17 + v * 23) + .016 * Math.pow(Math.sin(u * 9 - v * 7), 4) * Math.sin(v * Math.PI);
        point.z += .026 * Math.sin(u * 11 + v * 6) + cross * .11 * Math.sin(v * 9);
        return point;
      };
      const positions: number[] = [], uvs: number[] = [], indices: number[] = [], across = 32, along = 96;
      for (let j = 0; j <= along; j++) for (let i = 0; i <= across; i++) {
        const u = i / across, v = j / along, point = surface(u, v);
        positions.push(point.x, point.y, point.z); uvs.push(u * 2, v * 4);
        if (i < across && j < along) { const a = j * (across + 1) + i, b = a + across + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
      }
      const skin = new THREE.BufferGeometry();
      skin.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); skin.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      skin.setIndex(indices); skin.computeVertexNormals(); mesh(result, skin, plastic);
      for (const u of [0, 1]) {
        const edge: V3[] = []; for (let j = 0; j <= along; j++) edge.push(surface(u, j / along).toArray() as V3);
        path(result, seam, edge, .004, 4, along);
      }
      for (const v of [0, 1]) {
        const lip: V3[] = []; for (let i = 0; i <= across; i++) lip.push(surface(i / across, v).toArray() as V3);
        path(result, plastic, lip, .007, 5, across);
      }
      for (const u of [.09, .91]) {
        const weld: V3[] = [];
        for (let i = 0; i <= 20; i++) { const point = surface(u, .685 + i / 20 * .19); point.y += .003; weld.push(point.toArray() as V3); }
        path(result, seam, weld, .003, 4, 24);
      }
      const valveAt = surface(.73, .79), valve = group(result, ...valveAt.toArray() as V3);
      cyl(valve, valveRubber, .062, .071, .018, [0, .009, 0], undefined, 20);
      torus(valve, seam, .066, .005, [0, .018, 0], [Math.PI / 2, 0, 0], TAU, 24);
      cyl(valve, p.brass, .023, .028, .042, [0, .036, 0], undefined, 12);
      cyl(valve, valveRubber, .017, .017, .003, [0, .058, 0], undefined, 12);
      path(valve, valveRubber, [[.021, .032, 0], [.076, .047, -.025], [.104, .022, -.064], [.09, .018, -.088]], .006, 5, 16);
      cyl(valve, valveRubber, .032, .035, .015, [.086, .015, -.09], [0, .2, .18], 12);
      torus(valve, seam, .022, .004, [.086, .024, -.09], [Math.PI / 2, 0, .18], TAU, 16);
      result.userData.boat = { folded: true, valvePosition: valveAt.toArray(), inflatedType: 'boat' };
      break;
    }
    case 'boat': {
      const rubber = mat(materials, 'rubber', '#9b8060', .9);
      const outline: V3[] = []; for (let i = 0; i <= 32; i++) { const a = i / 32 * TAU; outline.push([Math.sin(a) * .66, .22, Math.cos(a) * 1.15]); }
      path(result, rubber, outline, .17, 10, 64);
      for (let i = 0; i < 11; i++) box(result, p.leatherLight, [1.13 - Math.abs(i - 5) * .065, .062, .18], [0, .086, (i - 5) * .174]);
      for (const z of [-.55, .45]) box(result, rubber, [1.02, .12, .24], [0, .26, z]);
      const line: V3[] = []; for (let i = 0; i <= 32; i++) { const a = i / 32 * TAU; line.push([Math.sin(a) * .74, .345, Math.cos(a) * 1.23]); }
      path(result, p.paper, line, .012, 5, 64);
      cyl(result, p.wood, .018, .02, 1.89, [.44, .48, 0], [Math.PI / 2, .3, 0]);
      sphere(result, p.wood, [.12, .025, .28], [.17, .48, -.94]);
      cyl(result, p.brass, .025, .025, .017, [-.66, .377, -.14]); break;
    }
    case 'rope': {
      for (let i = 0; i < 7; i++) torus(result, p.paper, .11 + i * .02, .013, [0, .015 + (i % 2) * .006, 0], [Math.PI / 2, .012 * i, 0], TAU * .97, 38);
      path(result, p.paper, [[.13, .016, .08], [.18, .018, .22], [.31, .012, .25], [.39, .012, .19]], .013, 6, 15); break;
    }
    case 'garlic': {
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; sphere(result, p.paper, [.048, .073, .046], [Math.sin(a) * .04, .073, Math.cos(a) * .04], [0, 0, Math.sin(a) * .12]); }
      spike(result, p.leatherLight, [[0, .12, 0], [.008, .23, .018]], .028); break;
    }
    case 'bottle': {
      const greenGlass = mat(materials, 'bottleGlass', '#305a44', .17, .12, { transparent: true, opacity: .83 });
      lathe(result, greenGlass, [[0, 0], [.092, 0], [.099, .027], [.097, .24], [.071, .285], [.031, .32], [.029, .411], [.034, .413], [.034, .439], [.02, .439], [.02, .416]]);
      cyl(result, p.wood, .023, .023, .035, [0, .449, 0]);
      box(result, p.paper, [.092, .115, .006], [0, .167, .093]); rune(result, p.leather, 0, .172, .098, .03); break;
    }
    case 'food': {
      sphere(result, p.leatherLight, [.18, .077, .125], [0, .079, 0]);
      for (let i = 0; i < 4; i++) path(result, p.paper, [[-.109 + i * .068, .105, -.075], [-.083 + i * .06, .154, .035], [-.055 + i * .059, .124, .087]], .004, 5, 10);
      break;
    }
    case 'shovel': {
      cyl(result, p.wood, .022, .025, .93, [0, .66, 0]);
      plate(result, p.iron, [[-.14, .24], [.14, .24], [.14, .07], [.09, -.045], [0, -.089], [-.09, -.045], [-.14, .07]], .022, [0, .106, 0]);
      torus(result, p.wood, .097, .021, [0, 1.206, 0], [0, 0, 0], Math.PI, 22); box(result, p.wood, [.21, .041, .038], [0, 1.209, 0]); break;
    }
    case 'coal': {
      for (let i = 0; i < 7; i++) mesh(result, new THREE.DodecahedronGeometry(.063 + (i % 3) * .019, 0), p.darkIron, [Math.sin(i * 2.3) * .09, .064 + (i % 2) * .04, Math.cos(i * 2.3) * .075], [1, .7, 1], [i, i * 2, i * .5]); break;
    }
    case 'bell': {
      lathe(result, p.brass, [[.12, 0], [.132, .016], [.109, .039], [.09, .092], [.07, .19], [.047, .227], [.001, .237]]);
      torus(result, p.gold, .123, .008, [0, .018, 0], [Math.PI / 2, 0, 0]); cyl(result, p.wood, .028, .023, .19, [0, .319, 0]); sphere(result, p.brass, [.035, .02, .035], [0, .414, 0]); break;
    }
    case 'candles': {
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * .155, h = .23 + (i % 2) * .11;
        cyl(result, p.paper, .036, .041, h, [x, h / 2 + .037, 0]);
        lathe(result, p.brass, [[0, 0], [.071, 0], [.074, .02], [.045, .041], [.039, .041]], [x, 0, 0]);
        for (let j = 0; j < 4; j++) path(result, p.paper, [[x + Math.sin(j) * .036, h + .04, Math.cos(j) * .036], [x + Math.sin(j) * .041, h - .02 - j * .017, Math.cos(j) * .04]], .009, 5, 8);
        flame(result, p, [x, h + .05, 0], .43);
      }
      break;
    }
    case 'machine': {
      box(result, p.darkIron, [.88, .16, .62], [0, .08, 0]);
      for (const x of [-.33, .33]) { cyl(result, p.iron, .045, .062, .91, [x, .585, 0]); for (let i = 0; i < 12; i++) torus(result, p.steel, .047, .009, [x, .23 + i * .057, 0], [Math.PI / 2, 0, 0], TAU, 14); }
      box(result, p.darkIron, [.88, .13, .61], [0, 1.068, 0]);
      cyl(result, p.steel, .2, .22, .09, [0, .35, 0]); cyl(result, p.iron, .23, .19, .11, [0, .89, 0]);
      cyl(result, p.steel, .053, .053, .19, [0, .995, 0]);
      torus(result, p.brass, .21, .023, [0, 1.178, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; path(result, p.iron, [[0, 1.178, 0], [Math.sin(a) * .21, 1.178, Math.cos(a) * .21]], .013, 6, 4); }
      box(result, p.brass, [.2, .15, .013], [0, .175, .319]); rune(result, p.darkIron, 0, .17, .331, .043);
      for (const x of [-.37, .37]) for (const y of [.08, 1.07]) rivets(result, p.brass, [[x, y, .317]], .024);
      break;
    }
    case 'valve': {
      cyl(result, p.iron, .072, .072, .33, [0, .38, -.12], [Math.PI / 2, 0, 0]);
      torus(result, p.copper, .28, .029, [0, .38, .085], undefined, TAU, 36);
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; path(result, p.iron, [[0, .38, .085], [Math.sin(a) * .269, .38 + Math.cos(a) * .269, .085]], .019, 6, 4); }
      sphere(result, p.brass, [.065, .065, .035], [0, .38, .096]);
      break;
    }
    case 'altar': {
      box(result, p.stone, [1.54, .14, .9], [0, .07, 0]);
      for (const x of [-.52, .52]) loft(result, p.stone, [[0, .21, .27], [.05, .19, .24], [.54, .13, .19], [.65, .19, .25]], [x, .14, 0], .025, 8);
      box(result, p.stone, [1.7, .17, 1.02], [0, .87, 0]); box(result, p.darkIron, [1.45, .027, .81], [0, .972, 0]);
      for (let i = -2; i <= 2; i++) rune(result, p.brass, i * .24, .867, .516, .044);
      break;
    }
    case 'worktable': {
      box(result, p.wood, [2.25, .12, 1.14], [0, .85, 0]);
      for (const x of [-.91, .91]) for (const z of [-.41, .41]) box(result, p.wood, [.115, .8, .115], [x, .4, z]);
      for (const z of [-.41, .41]) box(result, p.wood, [1.93, .16, .065], [0, .72, z]);
      box(result, p.wood, [1.7, .07, .78], [0, .19, 0]);
      box(result, p.darkIron, [.3, .065, .28], [-.77, .955, .26]);
      for (const x of [-.89, -.65]) box(result, p.iron, [.055, .18, .27], [x, 1.045, .26]);
      cyl(result, p.steel, .017, .017, .4, [-.77, 1.025, .26], [0, 0, Math.PI / 2]);
      box(result, p.leatherLight, [.49, .008, .37], [-.3, .916, -.14], [0, .12, 0]);
      for (let i = 0; i < 4; i++) path(result, p.iron, [[-.5 + i * .11, .93, -.27], [-.48 + i * .11, .934, -.05], [-.44 + i * .11, .934, -.018]], .008, 5, 5);
      break;
    }
    case 'bowl': {
      const stone = mat(materials, 'chewedStoneBowl', '#848575', .95, 0, { map: materials.rock?.map, normalMap: materials.rock?.normalMap ?? surfaceGrain(), normalScale: new THREE.Vector2(.23, .23) });
      const bowl = lathe(result, stone, [[0, .015], [.23, .015], [.28, .08], [.4, .15], [.57, .33], [.61, .46], [.6, .49], [.535, .49], [.53, .42], [.47, .3], [.34, .18], [.18, .13], [0, .13]], [0, 0, 0], undefined, 52);
      const vertices = bowl.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) if (vertices.getY(i) > .38) {
        const angle = Math.atan2(vertices.getZ(i), vertices.getX(i));
        const tooth = Math.exp(-Math.pow((angle - .65) / .095, 2)) + Math.exp(-Math.pow((angle - .87) / .08, 2));
        vertices.setY(i, vertices.getY(i) - tooth * .065);
      }
      bowl.geometry.computeVertexNormals(); break;
    }
    case 'tree_marks': {
      const bark = materials.bark ?? p.wood;
      loft(result, bark, [[0, .43, .38], [.15, .36, .32], [.77, .29, .28], [1.03, .31, .27]], [0, 0, 0], .08, 18);
      cyl(result, p.wood, .281, .287, .028, [0, 1.025, 0], undefined, 20);
      for (const radius of [.065, .12, .18, .235]) torus(result, p.leatherLight, radius, .004, [0, 1.043, 0], [Math.PI / 2, 0, 0], TAU, 26);
      path(result, bark, [[-.24, .5, -.02], [-.48, .63, -.09], [-.68, .75, -.1]], .105, 9, 8);
      plate(result, p.leatherLight, [[-.13, -.14], [.12, -.12], [.1, .19], [-.09, .2]], .008, [0, .62, .3], undefined, .002);
      for (let i = 0; i < 4; i++) path(result, p.leather, [[-.091 + i * .052, .535, .311], [-.07 + i * .051, .766, .311]], .004, 4, 3);
      for (let i = 0; i < 5; i++) torus(result, p.leatherLight, .16 + (i % 2) * .025, .013, [0, 1.064 + i * .018, 0], [Math.PI / 2 + .06 * Math.sin(i), 0, i], TAU, 24);
      break;
    }
    case 'timber_grooves': {
      const scored = mat(materials, 'scoredTimber', '#211d15', 1);
      for (const z of [-.067, .067]) box(result, scored, [.184, .004, .018], [0, 1.143, z]);
      for (let i = 0; i < 6; i++) path(result, p.paper, [[-.085 + i * .029, 1.148, .057], [-.063 + i * .027, 1.151, .087], [-.055 + i * .029, 1.147, .104]], .0018, 4, 4);
      break;
    }
    case 'altar_engraving': {
      for (let row = 0; row < 3; row++) for (let col = 0; col < 12; col++) {
        if ((row + col) % 5 === 0) continue;
        rune(result, p.bone, -.44 + col * .079, .115 - row * .105, .01, .027);
      }
      break;
    }
    case 'gateway_engraving': {
      clueLettering(result, materials, 'ABANDON\nEVERY\nHOPE', .34, .67, [0, 0, .007], undefined, '#b0ab8d'); break;
    }
    case 'machine_plate': {
      plate(result, p.brass, [[-.174, -.073], [.174, -.073], [.174, .073], [-.174, .073]], .009, [0, 0, 0], undefined, .003);
      for (const x of [-.148, .148]) for (const y of [-.05, .05]) rivets(result, p.iron, [[x, y, .008]], .006);
      clueLettering(result, materials, 'CARBON ONLY\nCLOSE INTERLOCK', .275, .1, [0, 0, .006]); break;
    }
    case 'museum_label': {
      const label = group(result, 0, .038, 0); label.rotation.set(-Math.PI / 2 + .08, 0, -.16);
      plate(label, p.paper, [[-.25, -.13], [.25, -.13], [.25, .13], [-.25, .13]], .015, [0, 0, 0], undefined, .002);
      clueLettering(label, materials, 'A painting\nby a neglected genius', .44, .19, [0, 0, .01]); break;
    }
    case 'boat_label': {
      const label = group(result, 0, .018, 0); label.rotation.set(-Math.PI / 2, 0, -.26);
      plate(label, p.paper, [[-.17, -.1], [.15, -.1], [.22, 0], [.15, .1], [-.17, .1]], .006, [0, 0, 0], undefined, .002);
      torus(label, p.leatherLight, .017, .005, [.161, 0, .004]);
      path(label, p.paper, [[.173, .007, .011], [.295, .051, .025], [.347, -.067, .012], [.18, -.01, .011]], .004, 5, 15);
      clueLettering(label, materials, 'FROBOZZ\nMAGIC BOAT CO.', .27, .15, [-.018, 0, .006]); break;
    }
    case 'north_shore_sign': case 'river_sign': {
      box(result, p.wood, [.11, 1.43, .11], [0, .715, 0], [0, 0, -.04]);
      plate(result, p.wood, [[-.69, -.2], [.48, -.2], [.7, 0], [.48, .2], [-.69, .2]], .065, [0, 1.18, 0], undefined, .008);
      rivets(result, p.iron, [[-.53, 1.3, .04], [-.53, 1.06, .04]], .012);
      clueLettering(result, materials, type === 'river_sign' ? 'SANDY LANDING\nFALLS AHEAD' : 'NORTH SHORE', 1.06, .28, [-.04, 1.18, .038], undefined, '#c1b997');
      if (type === 'north_shore_sign') {
        box(result, p.wood, [.72, .24, .045], [0, .72, 0]);
        plate(result, p.bone, [[-.21, 0], [.23, 0], [.14, -.095], [-.14, -.095]], .003, [0, .756, .025], undefined, 0);
        path(result, p.bone, [[0, .759, .03], [0, .865, .03]], .008, 4, 3);
      }
      break;
    }
    case 'dam_plate': {
      for (const x of [-.4, .4]) { cyl(result, p.iron, .03, .032, .91, [x, .455, 0]); box(result, p.iron, [.19, .025, .32], [x, .016, 0]); }
      plate(result, p.copper, [[-.59, -.25], [.59, -.25], [.59, .25], [-.59, .25]], .023, [0, 1.04, 0], [-.16, 0, 0], .008);
      clueLettering(result, materials, 'FLOOD CONTROL\nDAM #3\nYEAR 783', 1.03, .4, [0, 1.04, .019], [-.16, 0, 0], '#d1c8a0');
      for (const x of [-.53, .53]) for (const y of [.85, 1.23]) rivets(result, p.iron, [[x, y, .036]], .014);
      break;
    }
    case 'sign': {
      box(result, p.wood, [.08, 1.08, .085], [0, .54, 0]);
      plate(result, p.wood, [[-.49, -.18], [.36, -.18], [.55, 0], [.36, .18], [-.49, .18]], .049, [0, 1.04, 0], undefined, .008);
      for (let i = 0; i < 5; i++) rune(result, p.leather, -.25 + i * .12, 1.055, .029, .037);
      rivets(result, p.iron, [[-.4, 1.15, .032], [-.4, .93, .032]], .013); break;
    }
    case 'case_plate': {
      const plaqueBrass = mat(materials, 'casePlateBrass', '#96733e', .65, .67);
      const engraving = mat(materials, 'casePlateEngraving', '#493e2c', .84, .2);
      box(result, p.darkIron, [.706, .366, .029], [0, 0, -.026]);
      plate(result, plaqueBrass, [[-.335, -.165], [.335, -.165], [.335, .165], [-.335, .165]], .012, [0, 0, 0], undefined, .005);
      // The concealed side bracket reaches the cabinet stile without a floor stand.
      box(result, p.darkIron, [.174, .034, .046], [-.423, 0, -.046]);
      box(result, p.darkIron, [.026, .205, .037], [-.497, 0, -.047]);
      rivets(result, plaqueBrass, [[-.497, -.075, -.023], [-.497, .075, -.023]], .01);
      for (const x of [-.292, .292]) for (const y of [-.122, .122]) {
        rivets(result, p.brass, [[x, y, .014]], .012);
        box(result, engraving, [.013, .002, .0016], [x, y, .019]);
      }
      torus(result, engraving, .046, .0024, [-.215, .006, .009], undefined, TAU, 24);
      rune(result, engraving, -.215, .006, .009, .032);
      for (let row = 0; row < 4; row++) {
        const y = .073 - row * .048;
        const widths = row % 2 ? [.071, .123, .057] : [.119, .05, .082];
        let x = -.105;
        for (const width of widths) {
          box(result, engraving, [width, .0034, .0018], [x + width / 2, y, .0078]);
          x += width + .014;
        }
      }
      result.userData.mount = { axis: 'z', front: 1, center: [0, 0, 0], cabinetBracketX: -.51 };
      break;
    }
    case 'plaque': {
      // Legacy callers receive a fallen carved fragment, never a repeated
      // freestanding black marker unrelated to the thing being examined.
      carvedFragment(result, materials, p, 'carved_warning');
      break;
    }
    case 'campfire': {
      lathe(result, p.darkIron, [[.17, .25], [.26, .28], [.42, .38], [.48, .48], [.471, .498], [.441, .471], [.377, .371], [.251, .296], [.17, .273]], [0, 0, 0], undefined, 28);
      torus(result, p.iron, .47, .018, [0, .479, 0], [Math.PI / 2, 0, 0], TAU, 28);
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU;
        path(result, p.iron, [[Math.sin(a) * .29, .34, Math.cos(a) * .29], [Math.sin(a) * .3, .13, Math.cos(a) * .3], [Math.sin(a) * .38, .026, Math.cos(a) * .38]], .025, 7, 10);
      }
      for (let i = 0; i < 5; i++) cyl(result, i % 2 ? p.black : p.wood, .043, .055, .58, [Math.cos(i) * .055, .405 + (i % 2) * .035, Math.sin(i) * .053], [Math.PI / 2, i * .67, .1 * Math.sin(i)], 10);
      for (let i = 0; i < 15; i++) mesh(result, new THREE.DodecahedronGeometry(.037, 0), p.ember, [Math.sin(i * 2.4) * .24, .391, Math.cos(i * 2.4) * .19], [1.2, .4, 1]);
      for (let i = 0; i < 5; i++) flame(result, p, [Math.sin(i * 2.4) * .137, .439, Math.cos(i * 2.4) * .127], 1.6 + (i % 3) * .48);
      result.userData.lightOrigin = new THREE.Vector3(0, .82, 0); break;
    }
    case 'grate': case 'grate_above': {
      const overhead = type === 'grate_above';
      const frame = overhead ? group(result, 0, 6.45, 0) : result;
      if (overhead) {
        // Retain the offset container and its nested hinge during static batching.
        frame.name = 'grate-overhead'; frame.userData.articulated = true;
        for (const s of [-1, 1]) {
          box(frame, p.iron, [1.84, .06, .15], [0, -.035, s * .845]);
          box(frame, p.iron, [.15, .06, 1.84], [s * .845, -.035, 0]);
          for (const t of [-1, 1]) cyl(frame, p.brass, .025, .025, .026, [s * .836, -.075, t * .836], undefined, 12);
        }
      } else {
        // The terrain supplies the shaft; leave its 1.34 m aperture open.
        for (const s of [-1, 1]) {
          box(frame, p.stone, [1.61, .1, .135], [0, -.015, s * .7375]);
          box(frame, p.stone, [.135, .1, 1.34], [s * .7375, -.015, 0]);
        }
      }
      for (const s of [-1, 1]) {
        box(frame, p.darkIron, [1.5, .027, .047], [0, .045, s * .733]);
        box(frame, p.darkIron, [.047, .027, 1.5], [s * .733, .045, 0]);
      }
      const lid = group(frame, 0, .112, -.705); lid.name = 'grate-lid';
      lid.userData.articulated = true; lid.userData.hingeAxis = 'x'; lid.userData.closedAngle = 0; lid.userData.openAngle = -Math.PI * .49;
      // Keep the closed bars at their original coordinates. Only the iron
      // cover lifts; each variant's fixed frame stays in place.
      for (const s of [-1, 1]) {
        box(lid, p.iron, [1.43, .075, .084], [0, -.038, .705 + s * .705]);
        box(lid, p.iron, [.084, .075, 1.43], [s * .705, -.038, .705]);
      }
      for (let i = -4; i <= 4; i++) box(lid, p.darkIron, [.023, .053, 1.34], [i * .142, -.038, .705]);
      for (const z of [-.45, .45]) box(lid, p.iron, [1.34, .055, .026], [0, -.033, .705 + z]);
      for (const x of [-.47, .47]) {
        box(frame, p.brass, [.12, .054, .074], [x, .085, -.705]);
        cyl(frame, p.brass, .019, .019, .16, [x, .112, -.705], [0, 0, Math.PI / 2], 12);
        box(lid, p.iron, [.084, .019, .17], [x, -.01, .07]);
      }
      torus(lid, p.iron, .09, .012, [0, 0, 1.165], [Math.PI / 2, 0, 0], TAU, 20);
      box(lid, p.brass, [.11, .048, .086], [.11, .004, 1.356]);
      bake(lid);
      if (overhead) { frame.remove(lid); bake(frame); frame.add(lid); }
      break;
    }
    case 'window': {
      for (const x of [-.49, .49]) box(result, p.wood, [.1, 1.36, .17], [x, 1.49, 0]);
      for (const y of [.81, 2.17]) box(result, p.wood, [1.08, .1, .2], [0, y, 0]);
      box(result, p.stone, [1.2, .11, .38], [0, .73, .057]);
      const sash = group(result, -.435, 1.49, .03); sash.name = 'window-sash';
      sash.userData.articulated = true; sash.userData.hingeAxis = 'y'; sash.userData.closedAngle = 0; sash.userData.openAngle = -1.45;
      for (let i = 0; i < 3; i++) for (const x of [.221, .649]) box(sash, p.glass, [.391, .377, .014], [x, -.41 + i * .41, -.015]);
      for (const x of [.008, .435, .862]) box(sash, p.wood, [.035, 1.25, .067], [x, 0, 0]);
      for (const y of [-.622, -.205, .205, .622]) box(sash, p.wood, [.883, .035, .067], [.435, y, 0]);
      for (const y of [-.46, .46]) {
        box(result, p.darkIron, [.082, .113, .025], [-.462, 1.49 + y, .093]);
        cyl(result, p.iron, .018, .018, .113, [-.438, 1.49 + y, .093], undefined, 12);
        box(sash, p.darkIron, [.112, .033, .014], [.066, y, .042]);
        rivets(sash, p.iron, [[.085, y, .053]], .009);
      }
      box(sash, p.brass, [.034, .10, .016], [.797, -.13, .042]);
      path(sash, p.brass, [[.797, -.101, .05], [.797, -.101, .082], [.797, -.169, .082]], .012, 6, 8);
      bake(sash);
      for (const side of [-1, 1]) {
        const shutter = group(result, side * .55, 1.49, .045); shutter.rotation.y = side * -.68;
        for (let i = 0; i < 4; i++) box(shutter, p.wood, [.119, 1.19, .047], [side * (.066 + i * .122), 0, 0]);
        for (const y of [-.39, .39]) box(shutter, p.darkIron, [.47, .048, .019], [side * .25, y, .034]);
        rivets(shutter, p.iron, [[side * .1, -.39, .052], [side * .4, -.39, .052], [side * .1, .39, .052], [side * .4, .39, .052]], .011);
      }
      break;
    }
    case 'scroll': {
      box(result, p.paper, [.53, .008, .63], [0, .017, 0]);
      for (const z of [-.33, .33]) { cyl(result, p.paper, .055, .055, .55, [0, .064, z], [0, 0, Math.PI / 2], 20); for (const x of [-.3, .3]) sphere(result, p.wood, [.025, .064, .064], [x, .064, z]); }
      for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
        if ((row * 7 + col * 3) % 5 === 0) continue;
        const g = group(result, -.191 + col * .07, .023, -.202 + row * .084); g.rotation.x = -Math.PI / 2; rune(g, p.leatherLight, 0, 0, 0, .019);
      }
      torus(result, p.copper, .046, .006, [.16, .026, .18], [Math.PI / 2, 0, 0], TAU, 18);
      break;
    }
    case 'key': {
      torus(result, p.iron, .061, .013, [0, .026, -.147], [Math.PI / 2, 0, 0], TAU, 24);
      torus(result, p.brass, .027, .005, [0, .026, -.147], [Math.PI / 2, 0, 0], TAU, 16);
      cyl(result, p.iron, .012, .012, .235, [0, .026, .012], [Math.PI / 2, 0, 0], 10);
      for (let i = 0; i < 3; i++) box(result, p.iron, [.055 - (i % 2) * .018, .021, .018], [.021, .026, .079 + i * .031]);
      torus(result, p.brass, .018, .005, [0, .026, -.065], [0, 0, 0], TAU, 14); break;
    }
    case 'pedestal': {
      loft(result, p.stone, [[0, .48, .41], [.09, .48, .41], [.12, .35, .3], [.2, .31, .28], [.7, .24, .24], [.8, .33, .3]], [0, 0, 0], .018, 8);
      box(result, p.stone, [.84, .12, .7], [0, .86, 0]);
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; path(result, p.darkIron, [[Math.sin(a) * .276, .23, Math.cos(a) * .264], [Math.sin(a) * .248, .67, Math.cos(a) * .248]], .005, 4, 3); }
      rune(result, p.brass, 0, .47, .274, .11); break;
    }
    case 'pick': {
      box(result, p.leather, [.47, .027, .28], [0, .017, 0]);
      cyl(result, p.leatherLight, .043, .043, .29, [-.209, .046, 0], [Math.PI / 2, 0, 0], 14);
      for (let i = 0; i < 3; i++) {
        const z = -.088 + i * .088;
        cyl(result, p.leatherLight, .014, .014, .143, [-.085, .044, z], [0, 0, Math.PI / 2], 8);
        path(result, p.steel, [[-.012, .044, z], [.12, .044, z], [.162, .044, z + .008], [.168, .058 + i * .005, z + .017]], .004, 5, 10);
        torus(result, p.brass, .013, .003, [-.018, .044, z], [0, Math.PI / 2, 0], TAU, 12);
      }
      break;
    }
    case 'mirror': {
      const edge: [number, number][] = [[-.52, 0], [.52, 0], [.52, 1.62], [.44, 1.86], [.26, 2.07], [0, 2.16], [-.26, 2.07], [-.44, 1.86], [-.52, 1.62]];
      plate(result, p.brass, edge, .11, [0, .12, 0], undefined, .025);
      const mirrorSurface = mat(materials, 'mirrorSurface', '#778e95', .035, .98, { emissive: '#244954', emissiveIntensity: .22 });
      plate(result, mirrorSurface, edge.map(([x, y]) => [x * .88, y * .94 + .057]), .006, [0, .12, .077], undefined, .004);
      for (let i = 0; i < 11; i++) for (const side of [-1, 1]) mesh(result, new THREE.OctahedronGeometry(.019), i % 2 ? p.jade : p.gold, [side * .487, .3 + i * .12, .09], [1, 1.4, .5]);
      for (const x of [-.44, .44]) box(result, p.stone, [.2, .19, .42], [x, .094, 0]);
      path(result, p.gem, [[-.17, .23, .091], [-.085, .68, .091], [-.13, .93, .091], [.064, 1.32, .091], [.026, 1.65, .091], [.13, 2.1, .091]], .0025, 4, 17);
      torus(result, p.gold, .095, .017, [0, 2.306, .013], undefined, TAU, 24);
      break;
    }
    case 'switches': {
      box(result, p.stone, [.5, .71, .36], [0, .355, -.05]);
      box(result, p.darkIron, [.75, .62, .115], [0, 1, 0]);
      box(result, p.brass, [.665, .535, .014], [0, 1, .067]);
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * .216;
        box(result, p.black, [.03, .2, .02], [x, .961, .085]);
        path(result, p.iron, [[x, .921, .095], [x, 1.026 + (i % 2) * .09, .21]], .015, 6, 4);
        sphere(result, i === 1 ? p.red : p.black, [.031, .04, .031], [x, 1.026 + (i % 2) * .09, .21]);
        sphere(result, i === 0 ? p.jade : p.ember, [.021, .021, .011], [x, 1.19, .09]);
      }
      rivets(result, p.iron, [[-.294, .773, .086], [.294, .773, .086], [-.294, 1.227, .086], [.294, 1.227, .086]], .012); break;
    }
    case 'buoy': {
      const paint = mat(materials, 'buoyPaint', '#a94836', .64, .22);
      lathe(result, paint, [[0, 0], [.21, .015], [.4, .18], [.35, .43], [.19, .61], [.095, .67], [.065, .73], [.065, 1.19]], [0, 0, 0], undefined, 28);
      torus(result, p.paper, .356, .034, [0, .323, 0], [Math.PI / 2, 0, 0], TAU, 30);
      cyl(result, p.darkIron, .117, .117, .025, [0, 1.19, 0]);
      cyl(result, p.glass, .073, .073, .19, [0, 1.305, 0]); sphere(result, p.flame, [.027, .05, .027], [0, 1.304, 0]);
      cyl(result, p.darkIron, .011, .118, .079, [0, 1.44, 0]);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; cyl(result, p.iron, .006, .006, .202, [Math.sin(a) * .079, 1.305, Math.cos(a) * .079], undefined, 6); }
      torus(result, p.iron, .047, .012, [0, 1.502, 0], undefined, TAU, 18); break;
    }
    case 'basket': {
      const reeds = p.leatherLight;
      cyl(result, p.wood, .355, .32, .039, [0, .03, 0], undefined, 20);
      for (let j = 0; j < 14; j++) torus(result, reeds, .325 + j * .005, .012, [0, .056 + j * .034, 0], [Math.PI / 2, 0, 0], TAU, 30);
      for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; path(result, p.wood, [[Math.sin(a) * .318, .036, Math.cos(a) * .318], [Math.sin(a) * .35, .267, Math.cos(a) * .35], [Math.sin(a) * .4, .515, Math.cos(a) * .4]], .012, 5, 10); }
      torus(result, p.iron, .398, .018, [0, .516, 0], [Math.PI / 2, 0, 0], TAU, 30);
      for (const side of [-1, 1]) {
        path(result, p.iron, [[side * .39, .47, 0], [side * .41, .65, 0], [side * .28, .8, 0], [0, .93, 0]], .015, 6, 18);
        for (let j = 0; j < 5; j++) torus(result, p.darkIron, .043, .01, [side * .11, 1.01 + j * .068, 0], [0, j % 2 ? Math.PI / 2 : 0, 0], TAU, 12);
      }
      break;
    }
    case 'cyclops': {
      // This is the interaction target beside the animated cyclops in GameView.
      lathe(result, p.stone, [[.14, 0], [.42, .025], [.64, .13], [.76, .35], [.74, .46], [.67, .46], [.64, .31], [.49, .17], [.24, .12], [0, .12]], [0, 0, 0], undefined, 32);
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const marking = group(result, Math.sin(a) * .71, .32, Math.cos(a) * .71); marking.rotation.y = a; rune(marking, p.leatherLight, 0, 0, 0, .051); }
      break;
    }
    default: {
      lathe(result, p.gold, [[0, 0], [.1, 0], [.14, .045], [.1, .08], [.055, .11], [.035, .22], [.001, .24]]);
      mesh(result, new THREE.OctahedronGeometry(.092), p.gem, [0, .29, 0]);
      for (const side of [-1, 1]) spike(result, p.gold, [[side * .033, .18, 0], [side * .098, .285, 0], [side * .04, .375, 0]], .016);
      break;
    }
  }
  const movingParts = result.children.filter(child => child.userData.articulated);
  for (const part of movingParts) result.remove(part);
  bake(result);
  for (const part of movingParts) result.add(part);
  if (type === 'campfire') {
    const light = new THREE.PointLight('#ffb766', 22, 11, 1.6); light.position.set(0, .8, 0); result.add(light);
  }
  if (type === 'case' || type === 'trophy_case') {
    const light = new THREE.PointLight('#ffe0a0', .7, 3, 1.5); light.position.set(0, 2.25, .25); result.add(light);
  }
  result.userData.type = type;
  return result;
}

function skinMaterial(materials: Materials, kind: CreatureKind) {
  const color = kind === 'troll' ? '#3b4337' : kind === 'cyclops' ? '#968b70' : kind === 'grue' ? '#05090c' : '#716052';
  return mat(materials, `${kind}Skin`, color, kind === 'grue' ? 1 : kind === 'troll' ? .98 : .87, 0, { normalMap: kind === 'troll' ? materials.rock?.normalMap ?? surfaceGrain() : surfaceGrain(), normalScale: new THREE.Vector2(kind === 'troll' ? .14 : .27, kind === 'troll' ? .14 : .27), ...(kind === 'grue' ? { envMapIntensity: 0, map: null } : {}) });
}

function eye(parent: THREE.Group, p: ReturnType<typeof palette>, glow: THREE.MeshStandardMaterial, x: number, y: number, z: number, s = 1) {
  sphere(parent, p.black, [.082 * s, .054 * s, .041 * s], [x, y, z], [0, 0, x < 0 ? -.11 : .11]);
  sphere(parent, glow, [.04 * s, .034 * s, .025 * s], [x, y, z + .034 * s]);
  sphere(parent, p.black, [.008 * s, .026 * s, .006 * s], [x, y, z + .058 * s], undefined, 10);
}

function bridgekeeperFace(parent: THREE.Group, materials: Materials, p: ReturnType<typeof palette>) {
  const skin = skinMaterial(materials, 'troll');
  const iris = mat(materials, 'trollEye', '#9a6323', .49, 0, { emissive: '#81400f', emissiveIntensity: .19 });
  const blindEye = mat(materials, 'trollBlindEye', '#4c5140', .89);
  const scar = mat(materials, 'trollScar', '#55513d', .99);
  const rust = mat(materials, 'trollRust', '#59432d', .98, .08);
  loft(parent, skin, [[-.285, .165, .144, 0, .02], [-.215, .242, .212, -.016, .06], [-.075, .295, .238, -.012, .02], [.102, .335, .255, 0, -.02], [.265, .286, .218, .01, -.038], [.38, .185, .162, .016, -.04], [.435, .005, .008, 0, -.04]], [0, 0, 0], .084, 28);
  loft(parent, skin, [[-.213, .132, .08], [-.153, .222, .126], [-.07, .215, .111], [-.021, .177, .045]], [-.012, -.04, .18], .07, 22);
  // The worn iron brow and cheek plate belong to a keeper who has held this
  // crossing for centuries. Its asymmetric damage also breaks the face's grin.
  loft(parent, p.darkIron, [[.15, .338, .272, 0, -.028], [.29, .305, .244, .006, -.035], [.385, .219, .179, .012, -.042], [.431, .077, .074, .016, -.04]], [0, 0, 0], .035, 20);
  plate(parent, p.iron, [[-.319, .12], [-.288, .271], [-.087, .312], [.105, .294], [.287, .226], [.315, .12], [.22, .133], [.07, .075], [0, .095], [-.071, .073], [-.231, .124]], .035, [0, 0, .274], undefined, .01);
  for (const side of [-1, 1]) {
    sphere(parent, p.black, [.063, .023, .019], [side * .145, .078, .282], [0, 0, side * .16], 16);
    sphere(parent, side < 0 ? blindEye : iris, [.023, .013, .012], [side * .143, .079, .301], undefined, 14);
    sphere(parent, p.black, [side < 0 ? .014 : .011, .012, .004], [side * .143, .079, .312], undefined, 10);
    path(parent, skin, [[side * .078, .048, .281], [side * .145, .052, .291], [side * .218, .078, .267]], .018, 7, 13);
    path(parent, skin, [[side * .235, -.054, .223], [side * .266, -.112, .195], [side * .17, -.222, .263]], .038, 7, 13);
    plate(parent, skin, [[-.039, -.08], [.04, -.008], [.039, .139], [-.043, .084]], .04, [side * .32, .021, -.055], [0, side * -.61, side * -.29], .012);
  }
  // Broad, low nostrils sit behind a forged nasal guard, rather than a cone.
  loft(parent, skin, [[-.079, .086, .037], [-.052, .105, .066, -.009, .028], [-.008, .097, .079, -.004, .013], [.057, .054, .058], [.113, .025, .033]], [0, -.018, .284], .045, 22);
  for (const side of [-1, 1]) sphere(parent, p.black, [.024, .013, .013], [side * .051, -.079, .345], [0, 0, side * -.14], 12);
  plate(parent, p.iron, [[-.037, .178], [.044, .171], [.042, -.049], [.007, -.099], [-.026, -.047]], .028, [0, 0, .347], undefined, .009);
  plate(parent, p.darkIron, [[-.079, .168], [.071, .132], [.065, -.074], [-.04, -.205], [-.097, -.133]], .03, [.255, -.005, .218], [0, .46, -.09], .009);
  path(parent, p.steel, [[.272, .109, .273], [.255, -.093, .271], [.188, -.2, .267]], .004, 4, 10);
  rivets(parent, p.brass, [[-.255, .205, .297], [-.094, .253, .298], [.092, .248, .298], [.251, .172, .298], [.018, .116, .369], [.281, .051, .249]], .012);
  plate(parent, p.black, [[-.166, -.168], [-.11, -.146], [-.047, -.136], [.027, -.149], [.095, -.143], [.157, -.18], [.075, -.178], [-.012, -.17], [-.109, -.18]], .009, [0, 0, .322], undefined, .002);
  for (const x of [-.108, -.053, .061]) spike(parent, p.bone, [[x, -.153, .331], [x + .003, -.17 - Math.abs(x) * .03, .335]], .009, 6);
  path(parent, skin, [[-.177, -.179, .316], [-.113, -.2, .321], [-.03, -.188, .336], [.086, -.192, .324], [.147, -.203, .292]], .016, 7, 16);
  loft(parent, p.bone, [[0, .041, .035], [.058, .038, .031, -.011, .014], [.103, .025, .02, -.023, .021]], [-.175, -.221, .296], .06, 12);
  spike(parent, p.bone, [[.171, -.222, .294], [.196, -.128, .337], [.166, -.021, .322]], .036, 9);
  // One horn is broken flat; the other is chipped and bent back.
  loft(parent, p.bone, [[0, .084, .079], [.082, .079, .068, -.046, -.012], [.153, .064, .06, -.102, -.025], [.19, .046, .047, -.127, -.029]], [-.267, .29, -.066], .085, 12);
  spike(parent, p.bone, [[.279, .28, -.068], [.393, .365, -.113], [.486, .518, -.141], [.419, .635, -.108]], .075, 10);
  torus(parent, p.darkIron, .08, .018, [-.315, .369, -.078], [Math.PI / 2, 0, -.52], TAU, 18);
  for (let i = 0; i < 5; i++) path(parent, p.leatherLight, [[.3 + i * .025, .3 + i * .035, -.011 - i * .006], [.343 + i * .021, .319 + i * .035, -.037 - i * .009]], .004, 4, 6);
  path(parent, scar, [[-.242, .271, .176], [-.197, .172, .278], [-.151, .105, .317], [-.193, -.029, .279], [-.216, -.061, .259]], .008, 5, 18);
  for (const [x, y, z] of [[-.199, .174, .299], [-.158, .097, .319], [-.187, -.001, .293]] as V3[]) path(parent, p.leatherLight, [[x - .016, y + .008, z], [x + .012, y - .006, z + .002]], .003, 4, 4);
  path(parent, p.brass, [[-.077, .291, .298], [-.077, .218, .302], [.067, .218, .302], [.067, .286, .298]], .004, 4, 9);
  for (const x of [-.03, .019]) path(parent, p.brass, [[x, .22, .303], [x, .286, .303]], .003, 4, 3);
  for (let i = 0; i < 6; i++) plate(parent, rust, [[-.016, -.009], [.013, -.013], [.021, .006], [-.008, .013]], .001, [-.236 + i * .071, .207 + Math.sin(i * 2.7) * .048, .298], [0, 0, i * .49], 0);
}

function face(parent: THREE.Group, materials: Materials, kind: 'troll' | 'cyclops', p: ReturnType<typeof palette>) {
  if (kind === 'troll') { bridgekeeperFace(parent, materials, p); return; }
  const skin = skinMaterial(materials, kind);
  const iris = mat(materials, 'cyclopsEye', '#f2cd79', .25, .2, { emissive: '#bc7021', emissiveIntensity: .65 });
  loft(parent, skin, [[-.28, .14, .14, 0, .03], [-.19, .27, .22, 0, .07], [.02, .33, .26], [.23, .32, .25, 0, -.035], [.38, .2, .19, 0, -.035], [.435, .008, .007]], [0, 0, 0], .043, 28);
  // An angular jaw, cheek shelves, a protruding nose, and deeply hooded eyes.
  loft(parent, skin, [[-.26, .15, .08], [-.19, .23, .12], [-.07, .22, .13], [-.03, .16, .08]], [0, -.015, .18], .035, 22);
  plate(parent, p.black, [[-.192, -.023], [-.115, -.04], [.12, -.043], [.192, -.017], [.07, .032], [-.12, .025]], .012, [0, -.137, .29], undefined, .005);
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * .041;
    spike(parent, p.bone, [[x, -.108 - Math.abs(i - 3) * .004, .308], [x + Math.sin(i) * .004, -.145 + Math.cos(i * 2.1) * .009, .315]], .015 + Math.sin(i * 2.4) * .003, 6);
  }
  for (const side of [-1, 1]) {
    path(parent, skin, [[side * .12, -.21, .257], [side * .27, -.11, .18], [side * .29, .036, .123]], .053, 8, 14);
    spike(parent, p.bone, [[side * .17, -.196, .298], [side * .207, -.085, .34], [side * .19, .034, .29]], .04);
    plate(parent, skin, [[-.04, -.08], [.043, -.01], [.04, .16], [-.045, .09]], .047, [side * .317, .045, -.012], [0, side * -.6, side * -.25], .022);
    path(parent, skin, [[side * .09, .16, .247], [side * .22, .196, .205], [side * .3, .103, .12]], .049, 8, 14);
    path(parent, p.leatherLight, [[side * .22, -.028, .264], [side * .19, -.045, .291], [side * .18, -.076, .3]], .004, 4, 8);
  }
  eye(parent, p, iris, 0, .142, .263, 1.62);
  path(parent, skin, [[-.18, .174, .22], [0, .247, .273], [.18, .174, .22]], .054, 8, 20);
  loft(parent, skin, [[-.072, .091, .049, 0, .035], [-.032, .104, .083, 0, .038], [.035, .071, .077, 0, .02], [.077, .031, .029]], [0, -.038, .253], .026, 20);
  for (let i = 0; i < 9; i++) spike(parent, p.leatherLight, [[(i - 4) * .034, -.226, .19], [(i - 4) * .027, -.39 - Math.sin(i) * .035, .16], [(i - 4) * .021, -.47, .092]], .029);
  path(parent, p.leatherLight, [[-.17, .365, .13], [-.125, .258, .223], [-.085, .193, .29], [-.104, .083, .298]], .006, 5, 17);
}

function hand(parent: THREE.Group, p: ReturnType<typeof palette>, skin: THREE.MeshStandardMaterial, side: number, claw = false) {
  loft(parent, skin, [[0, .098, .095], [-.09, .12, .077], [-.18, .104, .047], [-.205, .058, .035]], [0, 0, 0], .025, 16);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * .046;
    spike(parent, skin, [[x, -.15, .012], [x * 1.15, -.265, .032], [x * 1.22, -.303 + Math.abs(i - 1.5) * .025, .071]], .027, 6);
    if (claw) spike(parent, p.bone, [[x * 1.17, -.258, .052], [x * 1.23, -.318, .104], [x * 1.25, -.309, .151]], .018, 6);
  }
  spike(parent, skin, [[side * .08, -.035, .01], [side * .151, -.112, .038], [side * .14, -.184, .092]], .046, 7);
}

type Limb = { upper: THREE.Group; lower: THREE.Group; tip: THREE.Group };
function limb(parent: THREE.Group, skin: THREE.MeshStandardMaterial, p: ReturnType<typeof palette>, at: V3, lengths: [number, number], widths: [number, number], side: number, arm: boolean, armored: boolean, clawed = true, naturalFeet = false): Limb {
  const upper = group(parent, ...at); upper.name = arm ? 'upperArm' : 'thigh';
  const [length, lowerLength] = lengths;
  sphere(upper, skin, [widths[0] * .97, widths[0] * .8, widths[0] * .9], [0, -.033, 0]);
  loft(upper, skin, [[.055, widths[0] * .68, widths[0] * .7], [-.03, widths[0], widths[0] * .94], [-length * .45, widths[0] * .87, widths[0] * .79, side * .025], [-length * .91, widths[1] * .77, widths[1] * .85, side * .038], [-length, widths[1] * .7, widths[1] * .67, side * .03]], [0, 0, 0], .032, 20);
  if (arm && armored) {
    loft(upper, p.leather, [[-.15, widths[0] * 1.02, widths[0]], [-.27, widths[0] * .97, widths[0] * .89]], [0, 0, 0], 0, 18);
    rivets(upper, p.brass, [[-.06, -.192, widths[0] * .93], [.06, -.192, widths[0] * .93]], .018);
  }
  bake(upper);
  const lower = group(upper, side * .03, -length, .015); lower.name = arm ? 'forearm' : 'shin';
  sphere(lower, skin, [widths[1] * .76, widths[1] * .65, widths[1] * .73], [0, 0, 0]);
  loft(lower, skin, [[.03, widths[1] * .69, widths[1] * .73], [-lowerLength * .18, widths[1], widths[1] * .83], [-lowerLength * .55, widths[1] * .82, widths[1] * .77], [-lowerLength, widths[1] * .5, widths[1] * .54]], [0, 0, 0], .034, 20);
  if (arm && armored) {
    loft(lower, p.leather, [[-lowerLength * .3, widths[1] * 1.02, widths[1] * .91], [-lowerLength * .83, widths[1] * .71, widths[1] * .71]], [0, 0, 0], 0, 18);
    plate(lower, p.darkIron, [[-widths[1] * .65, .11], [widths[1] * .65, .11], [widths[1] * .52, -.14], [0, -.2], [-widths[1] * .52, -.14]], .025, [0, -lowerLength * .56, widths[1] * .84], [0, 0, side * .1], .02);
    for (const v of [.34, .77]) torus(lower, p.brass, widths[1] * (1.04 - v * .3), .015, [0, -lowerLength * v, 0], [Math.PI / 2, 0, 0], TAU, 20);
  }
  if (!arm && !naturalFeet) {
    loft(lower, p.leather, [[-lowerLength * .16, widths[1] * 1.04, widths[1] * .9], [-lowerLength * .88, widths[1] * .7, widths[1] * .68]], [0, 0, 0], .04, 18);
    for (let i = 0; i < 4; i++) path(lower, p.leatherLight, [[-widths[1] * .64, -lowerLength * .25 - i * .09, widths[1] * .64], [widths[1] * .57, -lowerLength * .36 - i * .09, widths[1] * .64]], .013, 5, 5);
  }
  bake(lower);
  const tip = group(lower, 0, -lowerLength, .018); tip.name = arm ? 'hand' : 'foot';
  if (arm) hand(tip, p, skin, side, clawed);
  else if (naturalFeet) {
    loft(tip, skin, [[.105, widths[1] * .57, .103], [.045, widths[1] * .9, .177, 0, .063], [-.021, widths[1] * .88, .21, 0, .074]], [0, 0, 0], .038, 18);
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * widths[1] * .41;
      spike(tip, skin, [[x, .018, .18], [x * 1.1, -.006, .259 - Math.abs(i - 1.5) * .012]], widths[1] * .21, 6);
      spike(tip, p.bone, [[x * 1.06, .002, .238], [x * 1.12, -.01, .302 - Math.abs(i - 1.5) * .014]], widths[1] * .105, 6);
    }
  }
  else {
    loft(tip, p.leather, [[.11, widths[1] * .65, .14], [.065, widths[1] * .85, .225, 0, .075], [-.025, widths[1] * .9, .26, 0, .08]], [0, 0, 0], .03, 18);
    box(tip, p.darkIron, [widths[1] * 1.77, .034, .46], [0, -.033, .071]);
    if (armored) plate(tip, p.iron, [[-widths[1] * .76, -.065], [widths[1] * .76, -.065], [widths[1] * .87, .035], [0, .085], [-widths[1] * .87, .035]], .02, [0, .055, .228], [.5, 0, 0]);
  }
  bake(tip);
  return { upper, lower, tip };
}

function warClub(parent: THREE.Group, p: ReturnType<typeof palette>, large: boolean) {
  const club = group(parent, 0, -.08, .057); club.name = 'weapon'; club.rotation.z = .1;
  cyl(club, p.wood, .047, .028, 1.13, [0, .22, 0], undefined, 12);
  for (let i = 0; i < 6; i++) torus(club, p.leatherLight, .037, .01, [0, -.26 + i * .065, 0], [Math.PI / 2, 0, 0], TAU, 12);
  if (large) {
    loft(club, p.stone, [[.52, .07, .075], [.58, .23, .21], [.97, .255, .215, .05, .01], [1.18, .14, .16, .03, -.01], [1.29, .009, .01, .01, 0]], [0, 0, 0], .14, 11);
    for (const y of [.66, .99]) torus(club, p.darkIron, .215, .029, [0, y, 0], [Math.PI / 2, 0, .11], TAU, 16);
  } else {
    plate(club, p.iron, [[.03, -.14], [-.16, -.14], [-.23, -.22], [-.4, -.255], [-.49, -.2], [-.55, -.09], [-.574, .031], [-.563, .12], [-.576, .145], [-.552, .244], [-.513, .331], [-.467, .397], [-.44, .425], [-.393, .324], [-.305, .27], [-.187, .243], [-.043, .215], [.035, .155]], .067, [0, .64, 0], undefined, .013);
    plate(club, p.steel, [[-.4, -.255], [-.49, -.2], [-.55, -.09], [-.574, .031], [-.563, .12], [-.576, .145], [-.552, .244], [-.513, .331], [-.467, .397], [-.44, .425], [-.43, .346], [-.479, .278], [-.515, .17], [-.526, .051], [-.498, -.063], [-.451, -.143], [-.379, -.195]], .075, [0, .64, 0], undefined, .002);
    loft(club, p.darkIron, [[.481, .07, .074], [.559, .079, .076], [.815, .071, .067], [.883, .06, .064]], [0, 0, 0], .014, 12);
    spike(club, p.iron, [[.018, .76, 0], [.147, .794, 0], [.294, .735, -.013]], .054, 7);
    for (const y of [.523, .831]) torus(club, p.darkIron, .067, .013, [0, y, 0], [Math.PI / 2, 0, 0], TAU, 16);
    for (const y of [.585, .776]) cyl(club, p.brass, .017, .017, .157, [0, y, 0], [Math.PI / 2, 0, 0], 10);
    for (let i = 0; i < 8; i++) {
      const x = -.2 - (i % 3) * .072, y = .542 + Math.floor(i / 3) * .119;
      plate(club, p.darkIron, [[-.025, -.013], [.028, -.009], [.016, .017], [-.019, .023]], .001, [x, y, .035], [0, 0, i * .37], 0);
    }
    for (let i = 0; i < 4; i++) path(club, p.steel, [[-.438 + i * .033, .532 + i * .1, .041], [-.327 + i * .025, .602 + i * .082, .041]], .002, 4, 3);
  }
  bake(club); return club;
}

function capeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], indices: number[] = [];
  const across = 24, down = 16;
  for (let j = 0; j <= down; j++) for (let i = 0; i <= across; i++) {
    const u = i / across, v = j / down, a = (u - .5) * 3.7;
    const radius = .19 + v * .17;
    const y = -v * 1.25 + (j === down ? Math.sin(i * 3.17) * .04 - (i % 4 === 0 ? .085 : 0) : 0);
    pos.push(Math.sin(a) * (.35 + v * .17), y, -.06 - Math.cos(a) * radius + Math.cos(u * 12 * Math.PI) * .023 * v);
    uv.push(u * 2, v * 2);
    if (i < across && j < down) { const q = j * (across + 1) + i, b = q + across + 1; indices.push(q, b, q + 1, q + 1, b, b + 1); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}

function hood(parent: THREE.Group, p: ReturnType<typeof palette>, cloth: THREE.MeshStandardMaterial) {
  const positions: number[] = [], uv: number[] = [], index: number[] = [];
  const rings = [[-.18, .155, .135], [.04, .2, .19], [.19, .183, .18], [.31, .118, .155], [.39, .01, .02]], sides = 22;
  for (let j = 0; j < rings.length; j++) for (let i = 0; i <= sides; i++) {
    const a = .58 + i / sides * (TAU - 1.16), [y, rx, rz] = rings[j];
    positions.push(Math.sin(a) * rx, y, Math.cos(a) * rz - .03);
    uv.push(i / sides, j / (rings.length - 1));
    if (i < sides && j < rings.length - 1) { const q = j * (sides + 1) + i, b = q + sides + 1; index.push(q, b, q + 1, q + 1, b, b + 1); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(index); geo.computeVertexNormals(); mesh(parent, geo, cloth);
  for (const side of [-1, 1]) path(parent, p.leatherLight, [[side * .086, -.18, .084], [side * .111, .04, .129], [side * .104, .19, .123], [side * .066, .31, .096], [0, .39, -.01]], .006, 5, 20);
}

/** Models face +Z. The group origin is at the soles; time is seconds, phase is 0..1. */
export function makeCreature(kind: CreatureKind, materials: Materials = {}): { group: THREE.Group; animate: (time: number, mode: string, phase: number) => void } {
  const root = group(); root.name = `creature:${kind}`;
  const rig = group(root); rig.name = 'bodyRig';
  const p = creaturePalette(materials, kind), skin = skinMaterial(materials, kind);
  const limbs: Limb[] = [];
  let head: THREE.Group, torso: THREE.Group, cape: THREE.Group | undefined;
  let grueJaw: THREE.Group | undefined, grueEyeMaterial: THREE.MeshStandardMaterial | undefined, grueContourMaterial: THREE.MeshStandardMaterial | undefined, grueReveal = 1;
  const grueEyes: THREE.Group[] = [];
  if (kind === 'troll' || kind === 'cyclops') {
    const giant = kind === 'cyclops';
    if (giant) rig.scale.setScalar(1.73);
    torso = group(rig, 0, 1.19, 0);
    loft(torso, skin, [[-.05, .33, .29], [.17, giant ? .55 : .4, .32], [.51, giant ? .61 : .54, .38, 0, -.035], [.84, .63, .335, 0, -.035], [1.05, .44, .27, 0, -.06], [1.17, .25, .22, 0, -.065]], [0, 0, 0], .045, 28);
    if (giant) loft(torso, skin, [[.91, .285, .239], [1.12, .254, .224], [1.32, .232, .22], [1.41, .209, .18]], [0, 0, -.029], .03, 22);
    // Layered muscle planes; the torso is a single continuous loft beneath them.
    for (const side of [-1, 1]) {
      loft(torso, skin, [[0, .14, .045], [.19, .25, .09], [.32, .265, .078], [.39, .17, .035]], [side * .235, .52, .258], .02, 16);
      path(torso, skin, [[side * .28, .39, .28], [side * .205, .27, .314], [side * .18, .14, .29]], .021, 6, 12);
    }
    loft(torso, p.leather, [[-.08, .376, .31], [.08, .433, .325]], [0, 0, 0], 0, 26);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU, skirt = group(torso, Math.sin(a) * .345, -.015, Math.cos(a) * .285); skirt.rotation.y = a;
      plate(skirt, i % 2 ? p.leatherLight : p.leather, [[-.11, .005], [.11, .005], [.098, -.41 - (i % 3) * .035], [-.065, -.46], [-.11, -.34]], .024, [0, 0, 0], [giant ? -.08 : -.18, 0, 0], .008);
    }
    plate(torso, p.brass, [[-.089, -.07], [.089, -.07], [.11, .063], [-.11, .063]], .025, [0, .004, .337]);
    plate(torso, p.darkIron, [[-.052, -.037], [.052, -.037], [.058, .034], [-.058, .034]], .027, [0, .004, .354]);
    if (giant) {
      for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; torus(torso, p.darkIron, .055, .014, [Math.sin(a) * .46, .13 + Math.cos(a) * .025, Math.cos(a) * .33], [Math.PI / 2 + (i % 2) * .8, 0, -a], TAU, 14); }
      for (let i = 0; i < 8; i++) path(torso, p.leatherLight, [[-.29 + i * .08, .87, .312], [-.31 + i * .08, .76, .342], [-.275 + i * .08, .64, .346]], .005, 4, 10);
    } else {
      const strap = group(torso, 0, .58, .314); strap.rotation.z = -.64;
      box(strap, p.leather, [.12, 1.11, .04], [0, 0, 0]);
      for (let i = 0; i < 8; i++) rivets(strap, p.brass, [[0, -.43 + i * .126, .028]], .012);
      const pauldron = group(torso, -.56, .915, -.02);
      loft(pauldron, p.iron, [[-.1, .255, .3], [.04, .3, .28], [.15, .19, .22], [.18, .035, .03]], [0, 0, 0], .045, 14);
      for (let i = 0; i < 3; i++) {
        plate(pauldron, p.darkIron, [[-.081, .075], [.075, .056], [.06, -.122], [-.053, -.148], [-.095, -.08]], .027, [-.153 + i * .14, -.035, .23], [.28, i * .08 - .08, -.06], .008);
        rivets(pauldron, p.brass, [[-.155 + i * .14, .01, .258]], .013);
      }
      path(pauldron, p.steel, [[-.252, -.015, .196], [-.196, .097, .222], [0, .142, .224], [.181, .053, .199]], .009, 5, 18);
      spike(pauldron, p.darkIron, [[-.139, .126, -.079], [-.17, .246, -.091], [-.108, .294, -.057]], .048, 7);
      for (const z of [-.18, .18]) rivets(pauldron, p.brass, [[-.1, .03, z], [.08, .03, z]], .024);
      plate(torso, p.darkIron, [[-.17, -.17], [.11, -.23], [.24, -.04], [.193, .248], [.04, .34], [-.195, .203]], .029, [-.225, .56, .335], [0, -.17, -.14], .012);
      path(torso, p.iron, [[-.361, .389, .347], [-.111, .322, .378], [.019, .522, .389], [-.019, .781, .371]], .009, 5, 16);
      rivets(torso, p.brass, [[-.339, .699, .364], [-.23, .807, .356], [-.012, .574, .38], [-.129, .349, .377]], .015);
      const scar = mat(materials, 'trollBodyScar', '#55513f', .99);
      for (let i = 0; i < 3; i++) path(torso, scar, [[.135 + i * .045, .74 - i * .029, .35], [.23 + i * .043, .598 - i * .033, .354], [.278 + i * .037, .547 - i * .041, .32]], .006, 5, 14);
      for (let i = 0; i < 5; i++) torus(torso, p.darkIron, .032, .01, [.341 + i * .012, .07 - i * .041, .191], [0, i % 2 ? Math.PI / 2 : 0, .2], TAU, 12);
      const oldKey = group(torso, .388, -.17, .2); oldKey.rotation.z = -.16;
      torus(oldKey, p.iron, .039, .011, [0, 0, 0], undefined, TAU, 16);
      cyl(oldKey, p.iron, .009, .009, .16, [0, -.101, 0], undefined, 8);
      for (const y of [-.141, -.173]) box(oldKey, p.iron, [.052, .013, .015], [.02, y, 0]);
    }
    bake(torso);
    head = group(rig, 0, giant ? 2.68 : 2.39, .055); face(head, materials, kind, p); bake(head);
    for (const side of [-1, 1]) {
      const arm = limb(rig, skin, p, [side * .66, 2.03, -.005], [.62, .58], [.225, .2], side, true, true);
      arm.upper.rotation.z = side * .16; arm.upper.rotation.x = -.11; arm.lower.rotation.x = -.22;
      if (side === -1) warClub(arm.tip, p, giant);
      limbs.push(arm);
    }
    for (const side of [-1, 1]) {
      const leg = limb(rig, skin, p, [side * .265, 1.19, -.015], [.62, .48], [.25, .18], side, false, !giant, true, giant);
      leg.upper.rotation.z = side * .06; leg.upper.rotation.x = .065; leg.lower.rotation.x = -.06; limbs.push(leg);
    }
  } else if (kind === 'thief') {
    const cloth = mat(materials, 'thiefCloak', '#243134', .97, 0, { side: THREE.DoubleSide });
    torso = group(rig, 0, .91, 0);
    loft(torso, p.leather, [[-.015, .185, .12], [.2, .192, .129], [.43, .257, .156], [.59, .219, .143], [.64, .105, .094]], [0, 0, 0], .016, 22);
    for (let i = 0; i < 5; i++) loft(torso, i % 2 ? p.leatherLight : p.leather, [[.12 + i * .065, .205 + i * .01, .145 + i * .003], [.157 + i * .065, .205 + i * .01, .145 + i * .003]], [0, 0, .009], 0, 20);
    const sash = group(torso, 0, .32, .154); sash.rotation.z = -.59; box(sash, p.cloth, [.076, .68, .022], [0, 0, 0]);
    plate(sash, p.brass, [[-.036, -.039], [.036, -.039], [.036, .039], [-.036, .039]], .018, [0, .025, .018]);
    loft(torso, p.darkIron, [[.005, .219, .145], [.084, .219, .145]], [0, 0, 0], 0, 22);
    plate(torso, p.brass, [[-.045, -.027], [.045, -.027], [.045, .027], [-.045, .027]], .015, [0, .045, .158]);
    for (const side of [-1, 1]) {
      loft(torso, p.leatherLight, [[0, .046, .035], [.045, .065, .051], [.19, .067, .046], [.235, .028, .018]], [side * .234, -.09, -.035], .045, 14);
      torus(torso, p.brass, .027, .006, [side * .249, .104, .008], undefined, TAU, 14);
    }
    bake(torso);
    cape = group(rig, 0, 1.535, -.022); mesh(cape, capeGeometry(), cloth);
    for (const side of [-1, 1]) path(cape, p.leatherLight, [[side * .333, -.02, .031], [side * .47, -.6, .031], [side * .493, -1.2, -.001]], .006, 5, 20);
    bake(cape);
    head = group(rig, 0, 1.543, .004);
    sphere(head, skin, [.114, .159, .105], [0, .058, .017]);
    sphere(head, p.black, [.095, .096, .028], [0, .04, .093]);
    plate(head, cloth, [[-.108, .024], [.108, .024], [.076, -.09], [-.078, -.09]], .027, [0, .005, .109], undefined, .011);
    const glint = mat(materials, 'thiefEye', '#887a56', .47, 0, { emissive: '#453a23', emissiveIntensity: .03 });
    plate(head, cloth, [[-.112, .103], [.11, .103], [.096, .222], [.028, .252], [-.07, .221]], .021, [0, 0, .107], undefined, .007);
    for (const side of [-1, 1]) sphere(head, glint, [.014, .006, .003], [side * .048, .087, .121], [0, 0, side * .06], 12);
    hood(head, p, cloth); bake(head);
    for (const side of [-1, 1]) {
      const arm = limb(rig, p.leather, p, [side * .259, 1.445, -.012], [.3, .285], [.08, .067], side, true, true, false);
      arm.tip.scale.setScalar(.52); arm.upper.rotation.z = side * .12; arm.lower.rotation.x = -.14;
      if (side === -1) {
        const dagger = group(arm.tip, 0, -.057, .043); dagger.name = 'weapon'; dagger.rotation.z = Math.PI + .25; dagger.scale.setScalar(1.1);
        cyl(dagger, p.leatherLight, .025, .03, .145, [0, .025, 0]);
        path(dagger, p.brass, [[-.095, .102, 0], [0, .085, 0], [.095, .102, 0]], .017, 6, 10);
        blade(dagger, p, .48, .039, [0, .105, 0]); bake(dagger);
      }
      limbs.push(arm);
    }
    for (const side of [-1, 1]) {
      const leg = limb(rig, p.cloth, p, [side * .125, .916, 0], [.44, .394], [.095, .08], side, false, true);
      leg.upper.rotation.z = side * .024; limbs.push(leg);
    }
  } else {
    torso = group(rig, 0, .71, -.05); torso.rotation.x = .55;
    loft(torso, skin, [[-.29, .21, .17, 0, -.09], [-.08, .28, .23], [.2, .37, .26], [.46, .3, .24, 0, -.04], [.6, .145, .16, 0, -.03]], [0, 0, 0], .08, 26);
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) path(torso, skin, [[side * .05, .43 - i * .11, .219], [side * (.22 + Math.sin(i) * .027), .34 - i * .11, .229], [side * .297, .28 - i * .11, .045]], .01, 6, 14);
    for (let i = 0; i < 8; i++) spike(torso, skin, [[0, -.22 + i * .11, -.205], [Math.sin(i) * .022, -.14 + i * .11, -.32 - Math.sin(i) * .055], [Math.sin(i) * .04, -.01 + i * .11, -.35]], .034, 7);
    spike(torso, skin, [[0, -.24, -.075], [0, -.54, -.41], [.2, -.66, -.77], [.33, -.59, -1.03], [.26, -.52, -1.15]], .103, 9);
    bake(torso);
    head = group(rig, 0, 1.12, .4); head.rotation.x = -.05;
    loft(head, skin, [[-.24, .11, .13, 0, .145], [-.11, .23, .2, 0, .08], [.055, .262, .23], [.2, .21, .2, 0, -.032], [.29, .12, .13, 0, -.044], [.34, .001, .001]], [0, 0, 0], .08, 24);
    sphere(head, p.black, [.195, .145, .048], [0, -.11, .254]);
    grueContourMaterial = skin.clone(); grueContourMaterial.name = 'grueAttackContour';
    grueContourMaterial.emissive.set('#526349'); grueContourMaterial.emissiveIntensity = 0;
    grueJaw = group(undefined, 0, -.073, .115); grueJaw.name = 'grue-jaw';
    path(grueJaw, grueContourMaterial, [[-.175, .014, .116], [-.173, -.141, .129], [-.068, -.207, .151], [.081, -.201, .158], [.182, -.133, .12], [.175, .009, .11]], .036, 8, 24);
    sphere(grueJaw, p.black, [.147, .035, .073], [0, -.16, .125]);
    grueEyeMaterial = mat(materials, 'grueEyeGlint', '#53634b', .64, 0, { emissive: '#80936b', emissiveIntensity: 2.45, envMapIntensity: 0, normalMap: null }).clone();
    for (const side of [-1, 1]) {
      path(head, side < 0 ? grueContourMaterial : skin, [[side * .205, .097, .167], [side * .187, -.018, .239], [side * .17, -.076, .252]], .039, 8, 12);
      for (let i = 0; i < 5; i++) {
        const x = side * (.038 + i * .033);
        const fang = Math.sin(i * 2.3 + side) * .024;
        spike(head, p.bone, [[x, -.02 - i * .012, .27], [x * .95, -.092 - i * .007 + fang, .3], [x * .83, -.135 - i * .006 + fang, .277]], .01 + i * .0013, 6);
        spike(grueJaw, p.bone, [[x, -.156 + i * .008, .156], [x * .92, -.101 + i * .004 - fang * .6, .19], [x * .85, -.077 + i * .003 - fang * .6, .167]], .01, 6);
      }
      const eyeY = side < 0 ? .054 : .034;
      sphere(head, p.black, [.065, .038, .026], [side * .122, eyeY, .231], [0, 0, side * .21]);
      const socket = group(undefined, side * .122, eyeY, .269); socket.name = side < 0 ? 'grue-eye-left' : 'grue-eye-right';
      socket.rotation.z = side * .21;
      sphere(socket, grueEyeMaterial, [side < 0 ? .033 : .029, .012, .01], [0, 0, 0], undefined, 14);
      grueEyes.push(socket);
      path(head, skin, [[side * .059, eyeY + .041, .223], [side * .124, eyeY + .026, .262], [side * .184, eyeY + .004, .232]], .023, 7, 10);
      path(head, side > 0 ? grueContourMaterial : skin, [[side * .225, .078, .098], [side * .256, -.03, .14], [side * .204, -.135, .16]], .019, 6, 9);
    }
    bake(head); bake(grueJaw); head.add(grueJaw, ...grueEyes);
    for (const side of [-1, 1]) {
      const arm = limb(rig, skin, p, [side * .39, 1.05, .16], [.46, .44], [.105, .079], side, true, false, false);
      arm.tip.name = side < 0 ? 'grue-claws-left' : 'grue-claws-right';
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * .057, reach = .23 - Math.abs(i - 1.5) * .033;
        spike(arm.tip, p.bone, [[x, -.249, .06], [x * 1.17, -.332, .14], [x * 1.14, -.35, .14 + reach], [x * .86, -.294, .19 + reach]], .016 - Math.abs(i - 1.5) * .0018, 7);
      }
      bake(arm.tip);
      arm.upper.rotation.z = side * .3; arm.upper.rotation.x = -.25; arm.lower.rotation.x = -.3; arm.tip.scale.set(1.16, .82, 1.3); limbs.push(arm);
    }
    for (const side of [-1, 1]) {
      const leg = limb(rig, skin, p, [side * .185, .62, -.43], [.27, .25], [.14, .095], side, false, false, true, true);
      leg.upper.rotation.x = -.5; leg.lower.rotation.x = .45; limbs.push(leg);
    }
  }

  if (kind === 'troll') {
    root.updateMatrixWorld(true);
    const point = new THREE.Vector3(), toRig = rig.matrixWorld.clone().invert(), transform = new THREE.Matrix4();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.material !== skin) return;
      const vertices = object.geometry.getAttribute('position'), colors = new Float32Array(vertices.count * 3);
      transform.multiplyMatrices(toRig, object.matrixWorld);
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i).applyMatrix4(transform);
        const patch = Math.sin(point.x * 8.3 + Math.sin(point.z * 6.7)) * Math.sin(point.y * 9.1 + Math.sin(point.x * 11.2));
        const grain = Math.sin(point.x * 31.7 + point.z * 24.1) * Math.cos(point.y * 27.3 - point.x * 17.1);
        const tone = .855 + patch * .1 + grain * .035;
        colors[i * 3] = tone * .97; colors[i * 3 + 1] = tone; colors[i * 3 + 2] = tone * .94;
      }
      object.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    });
    skin.vertexColors = true; skin.needsUpdate = true;
  }
  const desiredHeight = kind === 'cyclops' ? 5.5 : kind === 'troll' ? 2.4 : kind === 'thief' ? 1.85 : 1.5;
  root.updateMatrixWorld(true);
  const modelBounds = new THREE.Box3().setFromObject(root, true);
  rig.scale.multiplyScalar(desiredHeight / (modelBounds.max.y - modelBounds.min.y));
  root.updateMatrixWorld(true);
  modelBounds.setFromObject(root, true);
  rig.position.y -= modelBounds.min.y;
  const rest = new Map<THREE.Object3D, { p: THREE.Vector3; r: THREE.Euler }>();
  for (const object of [rig, torso, head, ...(cape ? [cape] : []), ...(grueJaw ? [grueJaw] : []), ...limbs.flatMap(l => [l.upper, l.lower, l.tip])]) rest.set(object, { p: object.position.clone(), r: object.rotation.clone() });
  let previousMode = 'idle';
  root.userData.kind = kind;
  root.userData.joints = { head, torso, limbs, cape };
  root.userData.height = desiredHeight;
  if (kind === 'grue') root.userData.grue = {
    eyes: grueEyes, jaw: grueJaw, claws: limbs.slice(0, 2).map(l => l.tip), eyeMaterial: grueEyeMaterial, fangMaterial: p.bone, contourMaterial: grueContourMaterial,
    attackContact: .55,
    setReveal: (amount: number) => { grueReveal = Number.isFinite(amount) ? THREE.MathUtils.clamp(amount, 0, 1) : 0; },
  };
  const armDelta = new THREE.Vector3(), armDirection = new THREE.Vector3(), elbowPole = new THREE.Vector3();
  const elbowPosition = new THREE.Vector3(), handGoal = new THREE.Vector3(), upperDirection = new THREE.Vector3(), lowerDirection = new THREE.Vector3();
  const upperBasis = limbs[0].lower.position.clone().normalize(), lowerBasis = limbs[0].tip.position.clone().normalize();
  const upperLength = limbs[0].lower.position.length(), lowerLength = limbs[0].tip.position.length();
  const inverseUpper = new THREE.Quaternion(), chainRotation = new THREE.Quaternion(), wristRotation = new THREE.Quaternion(), wristEuler = new THREE.Euler();
  // An explicit hand path keeps anticipation and contact visible in the player's
  // melee framing. The elbow follows a two-link solution instead of separating
  // the weapon from the hand or swinging it above the camera.
  const aimWeaponArm = (target: V3, wristPitch: number, wristRoll: number) => {
    const arm = limbs[0], shoulder = arm.upper.position;
    handGoal.set(...target); armDelta.copy(handGoal).sub(shoulder);
    const distance = Math.min(upperLength + lowerLength - .003, Math.max(.04, armDelta.length()));
    armDirection.copy(armDelta).normalize(); handGoal.copy(shoulder).addScaledVector(armDirection, distance);
    elbowPole.set(-1, .08, -.025).addScaledVector(armDirection, -elbowPole.dot(armDirection)).normalize();
    const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    elbowPosition.copy(shoulder).addScaledVector(armDirection, along).addScaledVector(elbowPole, bend);
    upperDirection.copy(elbowPosition).sub(shoulder).normalize();
    arm.upper.quaternion.setFromUnitVectors(upperBasis, upperDirection);
    inverseUpper.copy(arm.upper.quaternion).invert();
    lowerDirection.copy(handGoal).sub(elbowPosition).applyQuaternion(inverseUpper).normalize();
    arm.lower.quaternion.setFromUnitVectors(lowerBasis, lowerDirection);
    chainRotation.multiplyQuaternions(arm.upper.quaternion, arm.lower.quaternion).invert();
    wristRotation.setFromEuler(wristEuler.set(wristPitch, 0, wristRoll));
    arm.tip.quaternion.copy(chainRotation).multiply(wristRotation);
  };
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const animate = (time: number, mode: string, phase: number) => {
    const t = Number.isFinite(time) ? time : 0, q = clamp(Number.isFinite(phase) ? phase : 0);
    for (const [object, transform] of rest) { object.position.copy(transform.p); object.rotation.copy(transform.r); }
    const heavy = kind === 'cyclops' || kind === 'troll', beast = kind === 'grue';
    const breath = Math.sin(t * (heavy ? 1.7 : 2.4));
    torso.position.y += breath * (heavy ? .012 : .006);
    head.rotation.y += Math.sin(t * .47) * .045;
    head.rotation.x += Math.sin(t * 1.7 + .4) * .014;
    limbs[0].upper.rotation.x += breath * .018; limbs[1].upper.rotation.x -= breath * .015;
    if (cape) { cape.rotation.x += Math.sin(t * 1.8) * .018; cape.rotation.z += Math.cos(t * 1.13) * .013; }
    if (mode === 'walk' || mode === 'run' || mode === 'chase') {
      const step = t * (kind === 'cyclops' ? 3.6 : kind === 'troll' ? 4.8 : beast ? 7.8 : 7);
      const stride = mode === 'run' ? 1.25 : 1;
      for (let i = 0; i < 2; i++) {
        const swing = Math.sin(step + i * Math.PI), opposite = Math.sin(step + (1 - i) * Math.PI);
        limbs[i].upper.rotation.x += swing * (beast ? .3 : .32) * stride;
        limbs[i].lower.rotation.x -= Math.max(0, opposite) * .24;
        limbs[i + 2].upper.rotation.x -= swing * .39 * stride;
        limbs[i + 2].lower.rotation.x += Math.max(0, swing) * .42;
      }
      rig.position.y += Math.abs(Math.sin(step)) * (heavy ? .031 : .035);
      torso.rotation.y += Math.sin(step) * .055; head.rotation.y -= Math.sin(step) * .035;
      if (cape) cape.rotation.x -= .085 + Math.sin(step) * .035;
    } else if (mode === 'windup' || mode === 'prepare') {
      const ease = q * q * (3 - 2 * q);
      limbs[0].upper.rotation.x -= ease * 1.8; limbs[0].upper.rotation.z -= ease * .32;
      limbs[0].lower.rotation.x -= ease * .5;
      limbs[1].upper.rotation.x -= ease * .6;
      torso.rotation.y -= ease * .23; torso.rotation.x -= ease * .07;
      head.rotation.x -= ease * .08;
    } else if (mode === 'attack' || mode === 'strike') {
      const strike = Math.sin(q * Math.PI), recoil = Math.cos(q * Math.PI);
      limbs[0].upper.rotation.x += -1.65 + q * 2.65;
      limbs[0].upper.rotation.z += -.25 + strike * .4;
      limbs[0].lower.rotation.x += -.4 + strike * .7;
      limbs[1].upper.rotation.x -= strike * (beast ? 1.2 : .6);
      torso.rotation.x += strike * .14; torso.rotation.y += -.22 + q * .44;
      rig.position.z += strike * (beast ? .34 : kind === 'thief' ? .1 : .12);
      head.rotation.x += strike * .12; head.rotation.y -= recoil * .1;
      if (cape) cape.rotation.x += strike * .16;
    } else if (mode === 'recover' || mode === 'recovery') {
      const settle = 1 - q * q * (3 - 2 * q);
      torso.rotation.y += settle * .22;
      head.rotation.y += settle * .1;
    } else if (mode === 'hurt' || mode === 'hit' || mode === 'stagger') {
      const recoil = Math.sin(q * Math.PI) || .55;
      torso.rotation.x -= recoil * .16; head.rotation.x -= recoil * .25; head.rotation.z += recoil * .1;
      rig.position.z -= recoil * .065; limbs[0].upper.rotation.z -= recoil * .16; limbs[1].upper.rotation.z += recoil * .2;
    } else if (mode === 'dead' || mode === 'death') {
      const fall = q > 0 ? 1 - Math.pow(1 - q, 3) : 1;
      rig.rotation.x -= fall * 1.48; rig.rotation.z += fall * .13;
      rig.position.y += fall * (kind === 'cyclops' ? .52 : .2);
      limbs[0].upper.rotation.z -= fall * .55; limbs[1].upper.rotation.z += fall * .38;
      limbs[2].upper.rotation.x += fall * .17; limbs[3].upper.rotation.x -= fall * .19;
      head.rotation.z += fall * .3;
    }
    if (kind === 'troll' && (mode === 'windup' || mode === 'prepare')) {
      const ease = q * q * (3 - 2 * q);
      aimWeaponArm([-.86 + .2 * ease, 1.18 + .5 * ease, .15 + .17 * ease], -.2 + .35 * ease, -.12 - .23 * ease);
    } else if (kind === 'troll' && (mode === 'attack' || mode === 'strike')) {
      const sweep = Math.sin(q * Math.PI), across = Math.sin(q * Math.PI / 2);
      const contact = Math.sin(Math.min(1, q / .4) * Math.PI / 2);
      aimWeaponArm([-.66 + .86 * across, 1.68 - .24 * q + .05 * sweep, .32 + .19 * sweep], .15 + contact * .95, -.35 - .45 * across);
    } else if (kind === 'troll' && (mode === 'recover' || mode === 'recovery')) {
      const ease = q * q * (3 - 2 * q);
      aimWeaponArm([.2 - 1.06 * ease, 1.44 - .26 * ease, .32 - .17 * ease], 1.1 - 1.3 * ease, -.8 + .68 * ease);
    } else if (kind === 'troll' && (mode === 'idle' || mode === 'walk' || mode === 'run' || mode === 'chase')) {
      const sway = mode === 'idle' ? breath * .006 : Math.sin(t * 4.8) * .05;
      aimWeaponArm([-.86, 1.18 + sway, .15], -.2, -.12);
    } else if (kind === 'thief' && (mode === 'windup' || mode === 'prepare')) {
      const ease = q * q * (3 - 2 * q);
      aimWeaponArm([-.34 + .04 * ease, 1.28 + .28 * ease, .09 + .13 * ease], -.3 - ease * .95, -.08 - ease * .15);
    } else if (kind === 'thief' && (mode === 'attack' || mode === 'strike')) {
      const thrust = q <= .4 ? Math.sin(q / .4 * Math.PI / 2) : Math.cos((q - .4) / .6 * Math.PI / 2);
      aimWeaponArm([-.3 + .265 * thrust, 1.56 + .03 * thrust, .22 + .22 * thrust], -1.25 - thrust * .2, -.23 + thrust * .12);
    } else if (kind === 'thief' && (mode === 'recover' || mode === 'recovery')) {
      const ease = q * q * (3 - 2 * q);
      aimWeaponArm([-.3 - .04 * ease, 1.56 - .28 * ease, .22 - .13 * ease], -1.25 + .95 * ease, -.23 + .15 * ease);
    } else if (kind === 'thief' && (mode === 'idle' || mode === 'walk' || mode === 'run' || mode === 'chase')) {
      const sway = mode === 'idle' ? breath * .004 : Math.sin(t * 7) * .025;
      aimWeaponArm([-.34, 1.28 + sway, .09], -.3, -.08);
    } else if (heavy && (mode === 'windup' || mode === 'prepare' || mode === 'attack' || mode === 'strike')) {
      const desiredAngle = mode === 'attack' || mode === 'strike' ? .15 + q * Math.PI * .52 : .15;
      limbs[0].tip.rotation.x = desiredAngle - limbs[0].upper.rotation.x - limbs[0].lower.rotation.x;
    }
    if (beast && grueJaw && grueEyeMaterial) {
      const ease = (value: number) => value * value * (3 - 2 * value);
      const lunging = mode === 'lunge' || mode === 'attack' || mode === 'strike';
      const withdrawing = mode === 'retreat' || mode === 'repelled';
      const stalking = mode === 'stalk' || mode === 'lurk' || mode === 'windup' || mode === 'prepare';
      const reach = lunging ? q <= .55 ? ease(q / .55) : 1 - ease((q - .55) / .45) : 0;
      grueJaw.rotation.x = .025 + Math.max(0, Math.sin(t * .61)) * .014 + reach * .48;
      if (stalking || lunging || withdrawing) {
        const tension = mode === 'windup' || mode === 'prepare' ? ease(q) : 0;
        const pullback = withdrawing ? ease(q) : 0;
        torso.rotation.x = rest.get(torso)!.r.x + .04 + reach * .16 - pullback * .15;
        torso.rotation.y = rest.get(torso)!.r.y + Math.sin(t * .31) * .025;
        rig.position.z = rest.get(rig)!.p.z + reach * .38 - pullback * .34;
        rig.position.y = rest.get(rig)!.p.y - .025 - tension * .045 + reach * .025;
        head.position.z = rest.get(head)!.p.z + reach * .14;
        head.position.y = rest.get(head)!.p.y - reach * .075;
        head.rotation.x = rest.get(head)!.r.x - reach * .11;
        head.rotation.z = Math.sin(t * .19) * .06 + pullback * .17;
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? -1 : 1;
          limbs[i].upper.rotation.x = -.37 - tension * .22 - reach * 1.02 + pullback * .24;
          limbs[i].upper.rotation.z = side * (.29 - reach * .15 + pullback * .14);
          limbs[i].lower.rotation.x = -.36 - reach * .32;
          limbs[i].tip.rotation.x = -.14 - reach * .19;
          limbs[i].tip.rotation.z = side * (.09 + reach * .16);
          if (mode === 'stalk') {
            limbs[i].upper.rotation.x += Math.sin(t * 3.1 + i * Math.PI) * .045;
            limbs[i + 2].upper.rotation.x -= Math.sin(t * 3.1 + i * Math.PI) * .07;
          }
        }
      }
      // These small surfaces must survive the darkness film without revealing the body.
      grueEyeMaterial.emissiveIntensity = grueReveal * (2.45 + reach * .65);
      p.bone.emissive.set('#768568'); p.bone.emissiveIntensity = grueReveal * (.026 + Math.pow(reach, .65) * .8);
      if (grueContourMaterial) grueContourMaterial.emissiveIntensity = grueReveal * Math.sqrt(reach) * .42;
      for (let i = 0; i < grueEyes.length; i++) {
        grueEyes[i].visible = grueReveal > .005;
        grueEyes[i].scale.y = Math.sin(t * .43 + i * .09) > .996 ? .09 : 1;
      }
    }
    root.userData.animation = mode; root.userData.previousAnimation = previousMode; previousMode = mode;
  };
  animate(0, 'idle', 0);
  return { group: root, animate };
}
