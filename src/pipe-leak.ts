import * as THREE from 'three';

/** A small pressurised water jet, authored relative to the broken coupling. */
export function createPipeLeak(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'state:maintenance:leaking-water';
  const time = { value: 0 };
  const materials: THREE.ShaderMaterial[] = [];
  const waterMaterial = (vertexShader: string, fragmentShader: string) => {
    const material = new THREE.ShaderMaterial({
      uniforms: { time, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: true,
    });
    materials.push(material); return material;
  };
  const fragmentEnd = `
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  `;
  const path = new THREE.CatmullRomCurve3(Array.from({ length: 15 }, (_, i) => {
    const age = i / 14 * .48;
    return new THREE.Vector3(-.213 - 4.5 * age, .85 * age - 4.9 * age * age, -age);
  }));
  const jetGeometry = new THREE.TubeGeometry(path, 36, .03, 6, false);
  const vertices = jetGeometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const progress = jetGeometry.attributes.uv.getX(i), centre = path.getPointAt(progress);
    const width = 1 - progress * .48;
    vertices.setXYZ(i, centre.x + (vertices.getX(i) - centre.x) * width,
      centre.y + (vertices.getY(i) - centre.y) * width, centre.z + (vertices.getZ(i) - centre.z) * width);
  }
  const jet = new THREE.Mesh(jetGeometry, waterMaterial(`
    uniform float time;
    varying vec2 vUv;
    #include <fog_pars_vertex>
    void main() {
      vUv = uv;
      vec3 p = position;
      p.z += sin(uv.x * 37.0 - time * 22.0) * .009 * uv.x;
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `, `
    uniform float time;
    varying vec2 vUv;
    #include <fog_pars_fragment>
    void main() {
      float flow = .72 + .28 * sin(vUv.x * 64.0 - time * 27.0);
      float highlight = pow(abs(sin(vUv.y * 6.283)), 8.0);
      gl_FragColor = vec4(mix(vec3(.28,.47,.51), vec3(.75,.86,.88), highlight),
        flow * (.43 + highlight * .34) * (1.0 - smoothstep(.55, 1.0, vUv.x) * .7));
      ${fragmentEnd}
    }
  `));
  group.add(jet);

  const count = 240, seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seeds.set([(i * .618034) % 1, (i * .754877) % 1, (i * .569841) % 1, i < 185 ? 0 : 1], i * 4);
  }
  const droplets = new THREE.BufferGeometry();
  droplets.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  droplets.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const spray = new THREE.Points(droplets, waterMaterial(`
    uniform float time;
    attribute vec4 seed;
    varying float vAlpha;
    #include <fog_pars_vertex>
    void main() {
      float age = mod(time + seed.x * .72, .72);
      vec3 velocity = vec3(-4.5 + (seed.y - .5) * 1.7,
        .85 + (seed.z - .5) * 1.7, -1.0 + (seed.x - .5) * 1.45);
      vec3 p = vec3(-.213, 0.0, 0.0) + velocity * age;
      p.y -= 4.9 * age * age;
      if (seed.w > .5) {
        age = mod(time + seed.x * .42, .42);
        p = vec3(-2.98 + (seed.y - .5) * .9, -1.405, -.62 + (seed.z - .5) * .65);
        p += vec3((seed.y - .5) * 1.7, 1.05 + seed.z * .6, (seed.x - .5) * 1.7) * age;
        p.y -= 4.9 * age * age;
      }
      vAlpha = smoothstep(0.0, .025, age) * smoothstep(-1.45, -1.3, p.y);
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = clamp((14.0 + seed.z * 12.0) / max(.3, -mvPosition.z), 1.0, 13.0);
      #include <fog_vertex>
    }
  `, `
    varying float vAlpha;
    #include <fog_pars_fragment>
    void main() {
      vec2 p = (gl_PointCoord - .5) * vec2(2.8, 2.0);
      float opacity = (1.0 - smoothstep(.25, 1.0, length(p))) * vAlpha;
      if (opacity < .02) discard;
      gl_FragColor = vec4(.78, .88, .9, opacity * .86);
      ${fragmentEnd}
    }
  `));
  // The shader moves the droplets outside their CPU-side point bounds.
  spray.frustumCulled = false; group.add(spray);

  const ripple = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.6), waterMaterial(`
    varying vec2 vUv;
    #include <fog_pars_vertex>
    void main() {
      vUv = uv;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `, `
    uniform float time;
    varying vec2 vUv;
    #include <fog_pars_fragment>
    void main() {
      vec2 p = (vUv - .5) * 2.0;
      float radius = length(p);
      float rings = pow(max(0.0, sin(radius * 39.0 - time * 12.0)), 12.0);
      float edge = 1.0 - smoothstep(.35, .94, radius);
      gl_FragColor = vec4(.57, .72, .74, rings * edge * .25);
      ${fragmentEnd}
    }
  `));
  ripple.rotation.x = -Math.PI / 2; ripple.position.set(-2.98, -1.424, -.62);
  group.add(ripple);
  group.userData.animate = (elapsed: number) => { time.value = elapsed; };
  // Structural refreshes dispose geometry; these materials belong only to this effect.
  group.userData.disposeMaterials = () => { for (const material of materials) material.dispose(); };
  return group;
}
