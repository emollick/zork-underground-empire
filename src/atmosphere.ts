import * as THREE from 'three';
import type { RoomDef } from './types.ts';
import { HOUSE_GORGE, inHouseGorge } from './exterior-geography.ts';

/** Distant land keeps the navigable clearing inside a larger, continuous landscape. */
export function makeLandscape(room: RoomDef, materials: Record<string, THREE.MeshStandardMaterial>): THREE.Group {
  const group = new THREE.Group();
  const groundMat = materials.moss.clone();
  if (groundMat.map) { groundMat.map = groundMat.map.clone(); groundMat.map.repeat.set(65, 65); }
  if (groundMat.normalMap) { groundMat.normalMap = groundMat.normalMap.clone(); groundMat.normalMap.repeat.set(65, 65); }
  if (groundMat.roughnessMap) { groundMat.roughnessMap = groundMat.roughnessMap.clone(); groundMat.roughnessMap.repeat.set(65, 65); }
  groundMat.color.set('#63755c');
  // Background land must not fill a shaft, gorge, or water route authored in
  // the foreground scene. Exact grid boundaries keep each opening seamless.
  const cutouts: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  if (room.id === 'house_grounds') cutouts.push(
    { minX: -31.67, maxX: -30.33, minZ: 6.33, maxZ: 7.67 },
    { minX: -150, maxX: HOUSE_GORGE.east, minZ: -150, maxZ: HOUSE_GORGE.south },
  );
  if (room.id === 'falls') cutouts.push({ minX: -24, maxX: 1, minZ: -1.9, maxZ: 5.5 });
  for (const exit of room.exits) if (exit.role === 'water' || exit.role === 'landing') {
    const yaw = exit.yaw ?? 0;
    for (const [left, right, near, far] of [[-4.3, 4.3, -3, 12], [-4.5, 13.5, 6, 14]]) {
      const corners = [left, right].flatMap(across => [near, far].map(outward => [
        exit.position[0] + Math.cos(yaw) * across - Math.sin(yaw) * outward,
        exit.position[1] - Math.sin(yaw) * across - Math.cos(yaw) * outward,
      ]));
      cutouts.push({ minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])),
        minZ: Math.min(...corners.map(p => p[1])), maxZ: Math.max(...corners.map(p => p[1])) });
    }
  }
  const base = Array.from({ length: 121 }, (_, i) => -150 + i * 2.5);
  const grid = (boundaries: number[]) => [...new Set([...base, ...boundaries].map(value => Math.round(value * 1e6) / 1e6))].sort((a, b) => a - b);
  const xs = grid(cutouts.flatMap(cutout => [cutout.minX, cutout.maxX]));
  const zs = grid(cutouts.flatMap(cutout => [cutout.minZ, cutout.maxZ]));
  const height = (x: number, z: number) => {
    const distance = Math.hypot(Math.max(0, Math.abs(x) - room.size[0] / 2), Math.max(0, Math.abs(z) - room.size[1] / 2));
    return -0.36 + Math.min(1, distance / 20) * (1.9 + Math.sin(x * 0.078 + 1) * 1.8 + Math.cos(z * 0.065) * 1.6 + Math.sin(x * 0.16 + z * 0.08) * 0.7);
  };
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const z of zs) for (const x of xs) { positions.push(x, height(x, z), z); uvs.push(x / 300 + .5, .5 - z / 300); }
  for (let iz = 0; iz < zs.length - 1; iz++) for (let ix = 0; ix < xs.length - 1; ix++) {
    const x = (xs[ix] + xs[ix + 1]) / 2, z = (zs[iz] + zs[iz + 1]) / 2;
    if (cutouts.some(cutout => x > cutout.minX && x < cutout.maxX && z > cutout.minZ && z < cutout.maxZ)) continue;
    const p = iz * xs.length + ix; indices.push(p, p + xs.length, p + 1, p + 1, p + xs.length, p + xs.length + 1);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); const terrain = new THREE.Mesh(geometry, groundMat); terrain.receiveShadow = true; group.add(terrain);
  let seed = 514;
  const random = () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; };
  const bark = materials.bark ?? materials.wood;
  const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.47, 1, 7, 3);
  const leafGeometry = new THREE.PlaneGeometry(1, 1);
  const foliage = new THREE.TextureLoader().load('./textures/beech-foliage.png');
  foliage.colorSpace = THREE.SRGBColorSpace; foliage.anisotropy = 4;
  const distantLeaf = new THREE.MeshStandardMaterial({ color: '#71895a', map: foliage, alphaTest: 0.42, roughness: 1, side: THREE.DoubleSide });
  const count = 250;
  const trunks = new THREE.InstancedMesh(trunkGeometry, bark, count), crowns = new THREE.InstancedMesh(leafGeometry, distantLeaf, count * 9);
  const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.18, 1, 6), bark, count * 3);
  const matrix = new THREE.Object3D(); let placed = 0, leaves = 0, arms = 0;
  while (placed < count) {
    const x = (random() - 0.5) * 210, z = (random() - 0.5) * 210;
    if (Math.abs(x) < room.size[0] / 2 + 2 && Math.abs(z) < room.size[1] / 2 + 3) continue;
    const h = 11 + random() * 13, y = height(x, z); const width = 0.7 + random();
    // Consume every old sample so scenery elsewhere stays fixed; the gorge
    // cannot contain the distant backdrop's old ground-level trees.
    const standing = room.id !== 'house_grounds' || !inHouseGorge(x, z);
    matrix.position.set(x, y + h / 2, z); matrix.scale.set(width, h, width); matrix.rotation.set((random() - 0.5) * 0.08, random() * Math.PI, (random() - 0.5) * 0.06); if (!standing) matrix.scale.setScalar(0); matrix.updateMatrix(); trunks.setMatrixAt(placed, matrix.matrix);
    for (let j = 0; j < 3; j++) {
      const angle = random() * Math.PI * 2, spread = (3.7 - j * 0.65) * width;
      const end = new THREE.Vector3(x + Math.sin(angle) * spread, y + h * (0.65 + j * 0.12), z + Math.cos(angle) * spread);
      const start = new THREE.Vector3(x, y + h * (0.47 + j * 0.1), z), direction = end.clone().sub(start);
      matrix.position.copy(start).addScaledVector(direction, 0.5); matrix.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()); matrix.scale.set(width, direction.length(), width); if (!standing) matrix.scale.setScalar(0); matrix.updateMatrix(); branches.setMatrixAt(arms++, matrix.matrix);
      for (let face = 0; face < 3; face++) {
        matrix.position.copy(end); matrix.rotation.set((face - 1) * 0.46, angle + face * Math.PI / 3, (random() - 0.5) * 0.6); matrix.scale.set((6.3 - j * 0.5) * width, (5.5 - j * 0.5) * width, 1); if (!standing) matrix.scale.setScalar(0); matrix.updateMatrix(); crowns.setMatrixAt(leaves++, matrix.matrix);
      }
    }
    placed++;
  }
  trunks.castShadow = true; trunks.receiveShadow = true; branches.castShadow = true; crowns.receiveShadow = true;
  group.add(trunks, branches, crowns);
  // Distant ridgelines break the sky without introducing traversable cliffs.
  const mountainMat = new THREE.MeshStandardMaterial({ color: '#536e68', roughness: 1 });
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * Math.PI * 2, radius = 128 + random() * 25;
    const mountain = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), mountainMat);
    mountain.position.set(Math.sin(angle) * radius, -5, Math.cos(angle) * radius); mountain.scale.set(22 + random() * 17, 18 + random() * 29, 21 + random() * 18); mountain.rotation.y = angle; group.add(mountain);
  }
  return group;
}

export function makeSky(): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { zenith: { value: new THREE.Color('#487b91') }, horizon: { value: new THREE.Color('#c8c9a8') }, sunDir: { value: new THREE.Vector3(-0.5, 0.35, -0.7).normalize() } },
    vertexShader: `varying vec3 direction; void main(){ direction=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 direction; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
    void main(){vec3 d=normalize(direction);float h=max(0.,d.y);vec3 c=mix(horizon,zenith,pow(h,.55));vec2 uv=d.xz/max(.18,d.y+.25)*2.;float n=noise(uv)*.55+noise(uv*2.2)*.25+noise(uv*4.5)*.13;float cloud=smoothstep(.47,.76,n)*smoothstep(0.,.3,h);c=mix(c,vec3(.88,.85,.69),cloud*.55);float sun=max(0.,dot(d,sunDir));c+=vec3(1.,.76,.37)*pow(sun,35.)*.36;c+=vec3(1.,.78,.4)*pow(sun,1700.)*3.;gl_FragColor=vec4(c,1.);}`,
  }));
}
