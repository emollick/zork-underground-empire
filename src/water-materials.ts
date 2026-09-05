import * as THREE from 'three';

let ripples: THREE.DataTexture | undefined;
let foam: THREE.CanvasTexture | undefined;
let spectrum: THREE.DataTexture | undefined;

/** A continuous spectrum with soft edges, shared by the bow and its solid span. */
export function createRainbowMaterial(solid = false) {
  if (!spectrum) {
    const width = 32, height = 256, data = new Uint8Array(width * height * 4);
    const colors = ['#ef5948', '#ff9e3c', '#f7d965', '#69cc81', '#48bddd', '#5974d1', '#a06bd0'].map(value => new THREE.Color(value));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const v = y / (height - 1), band = v * (colors.length - 1), at = Math.min(colors.length - 2, Math.floor(band));
      const tint = colors[at].clone().lerp(colors[at + 1], band - at).convertLinearToSRGB();
      const edge = Math.min(1, v * 18, (1 - v) * 18), i = (y * width + x) * 4;
      data[i] = tint.r * 255; data[i + 1] = tint.g * 255; data[i + 2] = tint.b * 255; data[i + 3] = Math.pow(Math.max(0, edge), .65) * 255;
    }
    spectrum = new THREE.DataTexture(data, width, height); spectrum.colorSpace = THREE.SRGBColorSpace;
    spectrum.magFilter = THREE.LinearFilter; spectrum.minFilter = THREE.LinearMipmapLinearFilter; spectrum.generateMipmaps = true; spectrum.needsUpdate = true;
  }
  if (!solid) return new THREE.MeshBasicMaterial({ map: spectrum, transparent: true, opacity: .64, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  return new THREE.MeshStandardMaterial({ map: spectrum, emissiveMap: spectrum, emissive: '#ffffff', emissiveIntensity: .68, roughness: .26, metalness: .08, transparent: true, opacity: .96, side: THREE.DoubleSide, depthWrite: true });
}
function rippleTexture() {
  if (ripples) return ripples.clone();
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const dx = Math.sin(u * 5 + Math.sin(v * 3) * 0.6) * 0.42 + Math.sin(u * 13 - v * 7) * 0.16 + Math.cos(u * 23 + v * 17) * 0.07;
    const dy = Math.cos(v * 4 + Math.sin(u * 4) * 0.8) * 0.38 + Math.cos(v * 11 + u * 8) * 0.13 + Math.sin(u * 19 - v * 21) * 0.08;
    const normal = new THREE.Vector3(dx, dy, 1).normalize(), i = (y * size + x) * 4;
    data[i] = (normal.x * 0.5 + 0.5) * 255; data[i + 1] = (normal.y * 0.5 + 0.5) * 255; data[i + 2] = normal.z * 255; data[i + 3] = 255;
  }
  ripples = new THREE.DataTexture(data, size, size); ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
  ripples.magFilter = THREE.LinearFilter; ripples.minFilter = THREE.LinearMipmapLinearFilter; ripples.generateMipmaps = true; ripples.needsUpdate = true;
  return ripples.clone();
}
export function createWaterMaterial(tint: string) {
  const normal = rippleTexture(); normal.repeat.set(5, 5);
  return new THREE.MeshPhysicalMaterial({ color: tint, normalMap: normal, normalScale: new THREE.Vector2(0.38, 0.38), roughness: 0.16, metalness: 0.25, transparent: true, opacity: 0.9, clearcoat: 0.9, clearcoatRoughness: 0.18, envMapIntensity: 1.2 });
}
export function createFallsMaterial() {
  if (!foam) {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 512;
    const context = canvas.getContext('2d')!, pixels = context.createImageData(128, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 128; x++) {
      const u = x / 128, v = y / 512 * Math.PI * 2;
      const threads = Math.sin(u * 180 + Math.sin(v * 3) * 0.7) * 0.23 + Math.sin(u * 371 - v * 2) * 0.12;
      const flow = 0.5 + Math.sin(v * 9 + u * 13) * 0.18 + Math.cos(v * 19 + u * 31) * 0.12 + threads;
      const edge = Math.pow(Math.sin(u * Math.PI), 0.5), i = (y * 128 + x) * 4;
      pixels.data[i] = 210 + flow * 45; pixels.data[i + 1] = 224 + flow * 31; pixels.data[i + 2] = 222 + flow * 33; pixels.data[i + 3] = Math.min(255, flow * 260 * edge);
    }
    context.putImageData(pixels, 0, 0); foam = new THREE.CanvasTexture(canvas); foam.colorSpace = THREE.SRGBColorSpace; foam.wrapS = foam.wrapT = THREE.RepeatWrapping;
  }
  const map = foam.clone(); map.repeat.set(1, 2.5);
  const normal = rippleTexture(); normal.repeat.set(2, 6);
  return new THREE.MeshStandardMaterial({ color: '#adcacc', map, normalMap: normal, normalScale: new THREE.Vector2(0.15, 0.15), emissive: '#2f5558', emissiveIntensity: 0.15, transparent: true, opacity: 0.74, roughness: 0.28, side: THREE.DoubleSide, depthWrite: false });
}
