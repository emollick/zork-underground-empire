import * as THREE from 'three';

export async function loadMaterials(onProgress: (n: number) => void): Promise<Record<string, THREE.MeshStandardMaterial>> {
  const loader = new THREE.TextureLoader();
  let loaded = 0;
  const map: Record<string, THREE.MeshStandardMaterial> = {};
  const definitions: Record<string, { color: string; texture?: string; roughness?: number; metalness?: number; repeat?: number }> = {
    stone: { color: '#9c9c8a', texture: 'stone', repeat: 1.2 },
    floor: { color: '#7e8278', texture: 'moss', repeat: 6 },
    darkStone: { color: '#4f5a58', texture: 'stone', repeat: 1.5 },
    moss: { color: '#536447', texture: 'ground', repeat: 8 },
    wood: { color: '#81715c', texture: 'wood', repeat: 1 },
    metal: { color: '#737d80', roughness: 0.29, metalness: 0.85 },
    gold: { color: '#bd994e', roughness: 0.24, metalness: 0.9 },
    plaster: { color: '#d7d8ca', roughness: 0.91 },
    roof: { color: '#374644', texture: 'stone', repeat: 3 },
    leaf: { color: '#425b39', roughness: 0.96 },
    rock: { color: '#707b76', texture: 'rock', repeat: 1 },
    bark: { color: '#5c5042', texture: 'bark', repeat: 1 },
    water: { color: '#1d5555', roughness: 0.19, metalness: 0.62 },
  };
  const promises = Object.entries(definitions).map(async ([key, def]) => {
    const material = new THREE.MeshStandardMaterial({ color: def.color, roughness: def.roughness ?? 0.9, metalness: def.metalness ?? 0 });
    map[key] = material;
    if (def.texture) {
      const entries = await Promise.allSettled(['color', 'normal', 'roughness'].map(async kind => {
        const texture = await loader.loadAsync(`./textures/${def.texture}-${kind}.jpg`);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.setScalar(def.repeat ?? 1); texture.anisotropy = 8;
        if (kind === 'color') texture.colorSpace = THREE.SRGBColorSpace;
        return { kind, texture };
      }));
      for (const entry of entries) if (entry.status === 'fulfilled') {
        const { kind, texture } = entry.value;
        if (kind === 'color') material.map = texture;
        if (kind === 'normal') { material.normalMap = texture; material.normalScale.setScalar(0.6); }
        if (kind === 'roughness') material.roughnessMap = texture;
      }
      material.needsUpdate = true;
    }
    loaded++; onProgress(loaded / Object.keys(definitions).length);
  });
  await Promise.all(promises);
  return map;
}
