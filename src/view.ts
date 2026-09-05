import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SolidSurfaceAO } from './ambient-occlusion.ts';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHouseExterior, buildWorld } from './world.ts';
import { houseExterior, isHouseGrounds } from './scene-layout.ts';
import { routeFloorHeight } from './route-surfaces.ts';
import { carriesLight, grueTiming, hasLight } from './darkness.ts';
import { makeProp, makeCreature } from './models.ts';
import { animateCoffinLid, placeCoffinContents, setCoffinOpen } from './coffin-pose.ts';
import { makeLandscape, makeSky } from './atmosphere.ts';
import { ROOMS, START_ROOM, TREASURES } from './campaign.ts';
import { createGame } from './game.ts';
import { CombatEffects } from './effects.ts';
import type { Collider, GameState, ObjectDef, RoomDef } from './types.ts';

interface SceneAnimation { object: THREE.Object3D; kind: string; baseY?: number; }
export interface CreatureView { group: THREE.Group; animate: (time: number, mode: string, phase: number) => void; }
const filmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 }, darkness: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float damage; uniform float darkness; varying vec2 vUv;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; float edge=pow(length((vUv-.5)*vec2(1.1,.85)),1.7); c*=1.-edge*.35; c+=(hash(vUv*1900.+fract(time)*50.)-.5)*.011; c=mix(c,c*vec3(.4,.03,.025)+vec3(.2,0.,0.),clamp(damage*edge*2.,0.,.8)); c*=1.-darkness*.76; gl_FragColor=vec4(c,1.); }`,
};

export class GameView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  private heroScene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(76, 1, 0.05, 220);
  private heroCamera = new THREE.PerspectiveCamera(75, 1, 0.04, 5);
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  ao: SolidSurfaceAO;
  film: ShaderPass;
  room?: RoomDef;
  worldRoom?: RoomDef;
  colliders: Collider[] = [];
  objects = new Map<string, THREE.Group>();
  enemy?: CreatureView;
  private secondaryCreature?: CreatureView;
  private grue?: CreatureView;
  private grueAnchor = new THREE.Vector3();
  private grueStage = -99;
  private illumination = { sun: 1, hemisphere: 1, fill: 1, environment: 1 };
  private environment = new THREE.Group();
  private architecture?: THREE.Group;
  private architectureState = '';
  private caseState = '';
  private animations: SceneAnimation[] = [];
  private carriedLightReveals: THREE.Light[] = [];
  private motes?: THREE.Points;
  private sun = new THREE.DirectionalLight('#ffe0a6', 3.4);
  private hemisphere = new THREE.HemisphereLight('#d9ede2', '#2d382b', 1.1);
  private fill = new THREE.DirectionalLight('#abc7d7', 0.45);
  private lanternLight = new THREE.PointLight('#ffc77c', 9, 22, 1.6);
  private lanternBeam = new THREE.SpotLight('#ffdb9d', 8, 27, 0.88, 0.8, 1.6);
  private sky = makeSky();
  private weapon = new THREE.Group();
  private lamp = new THREE.Group();
  private lampPendant = new THREE.Group();
  private lampBulbs: THREE.Object3D[] = [];
  private torch = new THREE.Group();
  private hero = new THREE.Group();
  private swordArm?: { group: THREE.Group; update: () => void };
  private heroFill = new THREE.HemisphereLight('#cbd6d0', '#232623', 0.75);
  private heroKey = new THREE.DirectionalLight('#e0d5be', 1.3);
  private impacts = new CombatEffects();
  private elapsed = 0;
  private titleState?: GameState;
  private baseExposure = 1.04;
  private lastSize = '';
  private touchMode = false;
  private heroFrameScale = 1;
  private heroFrameY = 0;
  private heroFrameZ = 0;
  private objectRotations = new Map<string, number>();
  private transparentMaterials = new Set<THREE.Material>();
  private treasureGlows: { light: THREE.PointLight; halo: THREE.MeshBasicMaterial }[] = [];
  private materialCache = new Set<THREE.Material>();
  materials: Record<string, THREE.MeshStandardMaterial>;
  gpu = '';
  drawCalls = 0;
  renderMs = 0;
  constructor(canvas: HTMLCanvasElement, materials: Record<string, THREE.MeshStandardMaterial>, touchMode = false) {
    this.materials = materials; this.touchMode = touchMode;
    for (const m of Object.values(materials)) this.materialCache.add(m);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !touchMode, powerPreference: 'high-performance', alpha: false });
    const gl = this.renderer.getContext(), gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = gpuInfo ? String(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)) : 'WebGL2';
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: touchMode ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new SolidSurfaceAO(this.scene, this.camera, 1024, 768);
    this.ao.updateGtaoMaterial({ radius: 0.72, distanceExponent: 1.8, thickness: 0.8, distanceFallOff: 1, scale: 0.65, samples: 12 });
    this.ao.blendIntensity = 0.75; this.composer.addPass(this.ao);
    this.heroCamera.layers.set(1);
    const handsPass = new RenderPass(this.heroScene, this.heroCamera); handsPass.clear = false; handsPass.clearDepth = true;
    this.composer.addPass(handsPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1024, 768), 0.24, 0.65, 1.0);
    this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    this.film = new ShaderPass(filmShader); this.composer.addPass(this.film);
    const generator = new THREE.PMREMGenerator(this.renderer);
    const environmentScene = new RoomEnvironment();
    this.scene.environment = generator.fromScene(environmentScene, 0.03).texture;
    this.heroScene.environment = this.scene.environment; this.heroScene.environmentIntensity = 0.55;
    this.scene.environmentIntensity = 0.48; environmentScene.dispose(); generator.dispose();
    this.sun.position.set(-22, 31, -35); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(touchMode ? 1024 : 2048, touchMode ? 1024 : 2048); this.sun.shadow.camera.left = -44; this.sun.shadow.camera.right = 44;
    this.sun.shadow.camera.top = 44; this.sun.shadow.camera.bottom = -44; this.sun.shadow.camera.far = 150;
    this.sun.shadow.bias = -0.00035; this.sun.shadow.normalBias = 0.035; this.sun.shadow.radius = 3;
    this.fill.position.set(20, 12, 25);
    this.lanternBeam.target.position.set(0, 0, -8);
    this.heroFill.layers.set(1); this.heroScene.add(this.heroFill, this.heroCamera);
    const heroKey = this.heroKey; heroKey.layers.set(1);
    heroKey.position.set(-2, 3, 2); heroKey.target.position.set(0, -0.3, -1);
    heroKey.castShadow = true; heroKey.shadow.mapSize.set(touchMode ? 512 : 1024, touchMode ? 512 : 1024);
    Object.assign(heroKey.shadow.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.3, near: 0.1, far: 8 });
    heroKey.shadow.camera.layers.set(1); heroKey.shadow.bias = -0.0001; heroKey.shadow.normalBias = 0.002;
    this.heroCamera.add(heroKey, heroKey.target, this.hero);
    this.lanternLight.position.set(-0.3, -0.2, -0.35); this.lanternBeam.position.set(0.2, -0.1, 0);
    this.camera.add(this.lanternLight, this.lanternBeam, this.lanternBeam.target);
    this.scene.add(this.environment, this.camera, this.sun, this.sun.target, this.fill, this.hemisphere, this.sky, this.impacts.group);
    const sword = makeProp('sword', materials); sword.scale.setScalar(0.5); this.weapon.add(sword);
    this.weapon.position.set(0.37, -0.56, -0.57); this.weapon.rotation.set(-0.18, -0.2, -0.2);
    const lantern = makeProp('lantern', materials); lantern.scale.setScalar(0.52);
    const lanternGrip = ((lantern.userData.grip as THREE.Vector3 | undefined)?.y ?? 0.67) * lantern.scale.y;
    this.lampPendant.position.y = lanternGrip; lantern.position.y = -lanternGrip;
    this.lampPendant.add(lantern); this.lamp.add(this.lampPendant);
    lantern.traverse(object => { if (object instanceof THREE.Mesh) { const list = Array.isArray(object.material) ? object.material : [object.material]; if (list.some(material => material instanceof THREE.MeshStandardMaterial && material.emissiveIntensity > 2)) this.lampBulbs.push(object); } });
    this.lamp.position.set(-0.44, -0.59, -0.83); this.lamp.rotation.z = 0.07;
    const heldTorch = makeProp('torch', materials); heldTorch.scale.setScalar(0.45);
    // Match the carved handle to the hand; the flame stays above the fingers.
    heldTorch.position.y = 0.3 - 0.2 * heldTorch.scale.y; this.torch.add(heldTorch);
    this.torch.position.set(-0.44, -0.76, -0.82); this.torch.rotation.z = 0.13;
    this.hero.add(this.weapon, this.lamp, this.torch);
    const swordHand = this.makeGlove(1, 0.1, false); this.weapon.add(swordHand);
    this.swordArm = this.makeSwordArm(swordHand); this.hero.add(this.swordArm.group); this.swordArm.update();
    this.lamp.add(this.makeGlove(-1, lanternGrip));
    const torchHand = this.makeGlove(1, 0.3); torchHand.scale.x = -1; this.torch.add(torchHand);
    this.hero.traverse(object => {
      object.layers.set(1);
      if (object instanceof THREE.Mesh) {
        object.receiveShadow = true;
        const list = Array.isArray(object.material) ? object.material : [object.material];
        object.castShadow = list.every(material => (!material.transparent || material.opacity > 0.9)
          && !(material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0)
          && !(material instanceof THREE.MeshStandardMaterial && material.emissiveIntensity > 2));
      }
    });
  }
  private makeLanternGlove(grip: number) {
    const hand = new THREE.Group(); hand.name = 'lantern-hand'; hand.position.y = grip;
    const leather = new THREE.MeshStandardMaterial({ color: '#3b3025', roughness: 0.88 });
    const seam = new THREE.MeshStandardMaterial({ color: '#665641', roughness: 1 });
    const cuffLeather = new THREE.MeshStandardMaterial({ color: '#302920', roughness: 0.91 });
    const cloth = new THREE.MeshStandardMaterial({ color: '#30392f', roughness: 1 });
    const normal = this.materials.rock?.normalMap?.clone();
    if (normal) {
      normal.repeat.set(28, 22); normal.needsUpdate = true;
      leather.normalMap = cuffLeather.normalMap = cloth.normalMap = normal;
      leather.normalScale.setScalar(0.025); cuffLeather.normalScale.setScalar(0.025); cloth.normalScale.setScalar(0.04);
    }
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const object = new THREE.Mesh(geometry, material); hand.add(object); return object;
    };
    const ellipsoid = (at: THREE.Vector3, radii: THREE.Vector3, material = leather) => {
      const object = add(new THREE.SphereGeometry(1, 24, 16), material); object.position.copy(at); object.scale.copy(radii); return object;
    };
    const tube = (points: number[][], radius: number, material: THREE.Material, taper = 0) => {
      const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point as [number, number, number])));
      const geometry = new THREE.TubeGeometry(curve, 24, radius, 12, false), positions = geometry.attributes.position;
      const point = new THREE.Vector3();
      for (let ring = 0; ring <= 24; ring++) {
        const t = ring / 24, center = curve.getPointAt(t), width = 1 - taper * t + 0.045 * Math.sin(t * Math.PI * 3);
        for (let side = 0; side <= 12; side++) {
          const index = ring * 13 + side;
          point.fromBufferAttribute(positions, index).sub(center).multiplyScalar(width).add(center);
          positions.setXYZ(index, point.x, point.y, point.z);
        }
      }
      positions.needsUpdate = true; geometry.computeVertexNormals(); return add(geometry, material);
    };
    // The back of the palm continues into the wrist; the four fingers curl
    // around the horizontal wire instead of rotating a vertical fist sideways.
    const palmRings = [
      [0.128, -0.006, -0.037, 0.023, 0.017], [0.101, -0.004, -0.023, 0.027, 0.020],
      [0.076, -0.002, -0.005, 0.036, 0.023], [0.050, 0, 0.014, 0.046, 0.025],
      [0.025, 0, 0.028, 0.048, 0.022], [0.008, 0, 0.030, 0.043, 0.017],
    ];
    const palmCurve = new THREE.CatmullRomCurve3(palmRings.map(([z, x, y]) => new THREE.Vector3(x, y, z)));
    const vertices: number[] = [], uv: number[] = [], indices: number[] = [], ringCount = 32, sides = 28;
    for (let j = 0; j <= ringCount; j++) {
      const t = j / ringCount, center = palmCurve.getPoint(t), offset = t * (palmRings.length - 1);
      const a = palmRings[Math.floor(offset)], b = palmRings[Math.min(palmRings.length - 1, Math.floor(offset) + 1)], blend = offset % 1;
      const rx = THREE.MathUtils.lerp(a[3], b[3], blend), ry = THREE.MathUtils.lerp(a[4], b[4], blend);
      for (let i = 0; i <= sides; i++) {
        const angle = i / sides * Math.PI * 2;
        vertices.push(center.x + Math.cos(angle) * rx, center.y + Math.sin(angle) * ry, center.z); uv.push(i / sides, t);
        if (i < sides && j < ringCount) { const k = j * (sides + 1) + i, n = k + sides + 1; indices.push(k, n, k + 1, k + 1, n, n + 1); }
      }
    }
    for (const end of [0, ringCount]) {
      const center = palmCurve.getPoint(end / ringCount), cap = vertices.length / 3;
      vertices.push(center.x, center.y, center.z); uv.push(0.5, end / ringCount);
      for (let i = 0; i < sides; i++) {
        const k = end * (sides + 1) + i;
        if (end === 0) indices.push(cap, k, k + 1); else indices.push(cap, k + 1, k);
      }
    }
    const palmGeometry = new THREE.BufferGeometry();
    palmGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    palmGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); palmGeometry.setIndex(indices); palmGeometry.computeVertexNormals();
    const palm = add(palmGeometry, leather); palm.name = 'lantern-glove-palm';
    for (const [i, x] of [-0.040, -0.013, 0.014, 0.041].entries()) {
      const wireY = 0.0093 - 0.012 * (x / 0.052) ** 2;
      const radius = [0.0090, 0.0105, 0.0114, 0.0103][i], length = [0.87, 0.97, 1, 0.95][i];
      const finger = tube([
        [x, wireY + 0.035 * length, 0.018], [x, wireY + 0.029 * length, -0.008],
        [x * 0.99, wireY + 0.007, -0.023], [x * 0.98, wireY - 0.013, -0.015],
        [x + 0.002, wireY - 0.013, 0.009], [x + 0.003, wireY - 0.003, 0.020],
      ], radius, leather, 0.22);
      finger.name = `lantern-finger-${i}`;
      ellipsoid(new THREE.Vector3(x + 0.003, wireY - 0.003, 0.020), new THREE.Vector3(radius * 0.79, radius * 0.79, radius * 0.8));
      ellipsoid(new THREE.Vector3(x, wireY + 0.033 * length, 0.015), new THREE.Vector3(radius * 1.04, radius * 0.9, radius * 1.12));
    }
    ellipsoid(new THREE.Vector3(0.042, 0.010, 0.055), new THREE.Vector3(0.023, 0.024, 0.027));
    const thumb = tube([[0.042, 0.014, 0.064], [0.058, 0.019, 0.046], [0.062, 0.013, 0.024],
      [0.054, 0.007, 0.004], [0.040, 0.009, -0.006]], 0.0145, leather, 0.19); thumb.name = 'lantern-thumb';
    ellipsoid(new THREE.Vector3(0.040, 0.009, -0.006), new THREE.Vector3(0.012, 0.012, 0.014));
    for (const x of [-0.017, 0.015]) tube([[x, -0.004, 0.095], [x, 0.026, 0.067], [x, 0.043, 0.038]], 0.0007, seam);
    const wrist = new THREE.Vector3(-0.006, -0.028, 0.111), elbow = new THREE.Vector3(-0.15, -0.53, 0.41);
    const axis = elbow.clone().sub(wrist).normalize();
    const right = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize(), depth = new THREE.Vector3().crossVectors(axis, right).normalize();
    const sleeveSection = (from: number, to: number, near: number, far: number, material: THREE.Material, folds: number) => {
      const positions: number[] = [], uvs: number[] = [], index: number[] = [], rings = 24, radial = 28;
      for (let j = 0; j <= rings; j++) {
        const t = j / rings, center = wrist.clone().addScaledVector(axis, THREE.MathUtils.lerp(from, to, t));
        const radius = THREE.MathUtils.lerp(near, far, t);
        for (let i = 0; i <= radial; i++) {
          const angle = i / radial * Math.PI * 2;
          const crease = 1 + folds * Math.sin(t * 27 + Math.sin(angle * 3)) * Math.exp(-t * 3);
          const point = center.clone().addScaledVector(right, Math.cos(angle) * radius * crease)
            .addScaledVector(depth, Math.sin(angle) * radius * 0.80 * crease);
          positions.push(point.x, point.y, point.z); uvs.push(i / radial, t);
          if (i < radial && j < rings) { const k = j * (radial + 1) + i, n = k + radial + 1; index.push(k, k + 1, n, k + 1, n + 1, n); }
        }
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(index); geometry.computeVertexNormals();
      return add(geometry, material);
    };
    sleeveSection(-0.008, 0.084, 0.029, 0.035, cuffLeather, 0.025).name = 'lantern-glove-cuff';
    sleeveSection(0.067, wrist.distanceTo(elbow), 0.033, 0.063, cloth, 0.07).name = 'lantern-forearm';
    sleeveSection(0.058, 0.069, 0.036, 0.036, leather, 0).name = 'lantern-cuff-hem';
    hand.userData.gripCenter = new THREE.Vector3(0, 0.0093, 0);
    hand.userData.wrist = wrist; hand.userData.forearmAxis = axis;
    return hand;
  }
  private makeGlove(side: number, grip: number, includeForearm = true) {
    if (side < 0) return this.makeLanternGlove(grip);
    const hand = new THREE.Group(); hand.position.y = grip;
    const leather = new THREE.MeshStandardMaterial({ color: '#42362a', roughness: 0.83 });
    const stitching = new THREE.MeshStandardMaterial({ color: '#867353', roughness: 1 });
    const sleeve = new THREE.MeshStandardMaterial({ color: '#29332f', roughness: 1 });
    const strap = new THREE.MeshStandardMaterial({ color: '#51483a', roughness: 0.92 });
    const fineNormal = this.materials.rock.normalMap?.clone();
    if (fineNormal) {
      fineNormal.repeat.set(16, 12); fineNormal.needsUpdate = true;
      leather.normalMap = sleeve.normalMap = fineNormal;
      leather.normalScale.setScalar(0.045); sleeve.normalScale.setScalar(0.06);
    }
    const fist = new THREE.Group(); hand.add(fist);
    // The sword has a vertical grip; the lantern hangs from a horizontal bow.
    if (side < 0) fist.rotation.z = Math.PI / 2;
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), leather);
    palm.scale.set(0.035, 0.062, 0.032); palm.position.set(side * 0.042, 0, 0.026); fist.add(palm);
    for (const offset of [-0.008, 0.008]) {
      const seam = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.049 + offset, -0.037, 0.049), new THREE.Vector3(side * 0.049 + offset, 0, 0.057),
        new THREE.Vector3(side * 0.049 + offset, 0.036, 0.049),
      ]);
      fist.add(new THREE.Mesh(new THREE.TubeGeometry(seam, 10, 0.001, 4, false), stitching));
    }
    for (let i = 0; i < 4; i++) {
      const y = 0.041 - i * 0.024, radius = i === 3 ? 0.0105 : 0.012;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.057, y, 0.026), new THREE.Vector3(side * 0.030, y, 0.056),
        new THREE.Vector3(-side * 0.007, y, 0.036), new THREE.Vector3(-side * 0.015, y, 0.005),
        new THREE.Vector3(side * 0.004, y, -0.009),
      ]);
      fist.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 10, false), leather));
      for (let stitch = 0; stitch < 3; stitch++) {
        const seam = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 5, 4), stitching);
        seam.scale.set(1.5, 0.65, 0.65); seam.position.set(side * (0.055 + stitch * 0.004), y, 0.049); fist.add(seam);
      }
    }
    const thumbPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.058, 0.046, 0.035), new THREE.Vector3(side * 0.028, 0.065, 0.050),
      new THREE.Vector3(-side * 0.018, 0.046, 0.047), new THREE.Vector3(-side * 0.029, 0.022, 0.034),
    ]);
    fist.add(new THREE.Mesh(new THREE.TubeGeometry(thumbPath, 16, 0.016, 12, false), leather));
    const wrist = side > 0 ? new THREE.Vector3(0.043, -0.056, 0.036) : new THREE.Vector3(0.005, -0.066, 0.035);
    hand.userData.wrist = wrist; hand.userData.armMaterials = { leather, sleeve, strap };
    if (!includeForearm) return hand;
    const elbow = new THREE.Vector3(side * 0.17, -0.59, 0.37), axis = elbow.clone().sub(wrist).normalize();
    const segment = (a: THREE.Vector3, b: THREE.Vector3, nearRadius: number, farRadius: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(nearRadius, farRadius, a.distanceTo(b), 28, 6), material);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().sub(b).normalize()); hand.add(mesh); return mesh;
    };
    // Endpoints overlap: the sleeve grows from the cuff and leaves the bottom of the frame.
    segment(wrist.clone().addScaledVector(axis, 0.045), elbow, 0.046, 0.078, sleeve);
    segment(wrist.clone().addScaledVector(axis, -0.017), wrist.clone().addScaledVector(axis, 0.071), 0.043, 0.049, leather);
    segment(wrist.clone().addScaledVector(axis, 0.037), wrist.clone().addScaledVector(axis, 0.056), 0.052, 0.053, strap);
    return hand;
  }
  private makeSwordArm(hand: THREE.Group) {
    const arm = new THREE.Group(); arm.name = 'sword-arm';
    const { leather, sleeve, strap } = hand.userData.armMaterials as Record<string, THREE.MeshStandardMaterial>;
    const shoulder = new THREE.Vector3(0.4, -0.36, 0.08), pole = new THREE.Vector3(0.48, -0.9, -0.04);
    const wrist = new THREE.Vector3(), elbow = new THREE.Vector3(), direction = new THREE.Vector3(), bend = new THREE.Vector3();
    const axis = new THREE.Vector3(), start = new THREE.Vector3(), end = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const upperLength = 0.38, forearmLength = 0.45;
    const section = (name: string, fromRadius: number, toRadius: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(toRadius, fromRadius, 1, 28, 8), material);
      mesh.name = name; arm.add(mesh); return mesh;
    };
    const upper = section('sword-upper-arm', 0.076, 0.061, sleeve);
    const forearm = section('sword-forearm', 0.041, 0.061, sleeve);
    const cuff = section('sword-cuff', 0.034, 0.044, leather);
    const cuffHem = section('sword-cuff-hem', 0.045, 0.046, strap);
    const wristJoin = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), leather);
    wristJoin.name = 'sword-wrist'; wristJoin.scale.set(0.035, 0.035, 0.032); arm.add(wristJoin);
    const elbowJoin = new THREE.Mesh(new THREE.SphereGeometry(0.061, 24, 16), sleeve);
    elbowJoin.name = 'sword-elbow'; arm.add(elbowJoin);
    const fit = (mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
      direction.copy(b).sub(a);
      mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.scale.y = direction.length();
      mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    };
    const update = () => {
      // The hand follows the sword grip, while the upper arm stays attached to
      // the shoulder. Solve the elbow in hero-local space so portrait fitting
      // and camera bob move the complete arm together without stretching it.
      this.weapon.updateMatrix(); hand.updateMatrix();
      wrist.copy(hand.userData.wrist as THREE.Vector3).applyMatrix4(hand.matrix).applyMatrix4(this.weapon.matrix);
      direction.copy(wrist).sub(shoulder);
      const distance = Math.max(0.001, direction.length()); direction.multiplyScalar(1 / distance);
      const along = (upperLength * upperLength - forearmLength * forearmLength + distance * distance) / (2 * distance);
      const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
      bend.copy(pole).sub(shoulder); bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      elbow.copy(shoulder).addScaledVector(direction, along).addScaledVector(bend, height);
      fit(upper, shoulder, elbow);
      axis.copy(elbow).sub(wrist).normalize();
      start.copy(wrist).addScaledVector(axis, 0.053); fit(forearm, start, elbow);
      start.copy(wrist).addScaledVector(axis, -0.012); end.copy(wrist).addScaledVector(axis, 0.073); fit(cuff, start, end);
      start.copy(wrist).addScaledVector(axis, 0.057); end.copy(wrist).addScaledVector(axis, 0.070); fit(cuffHem, start, end);
      wristJoin.position.copy(wrist); wristJoin.quaternion.copy(this.weapon.quaternion).multiply(hand.quaternion);
      elbowJoin.position.copy(elbow);
      arm.userData.shoulder = shoulder; arm.userData.elbow = elbow; arm.userData.wrist = wrist;
    };
    return { group: arm, update };
  }
  enter(room: RoomDef, state: GameState) {
    this.titleState = undefined;
    this.disposeEnvironment(); this.impacts.clear(); this.room = room; this.objects.clear(); this.objectRotations.clear(); this.enemy = undefined; this.secondaryCreature = undefined; this.grue = undefined; this.grueStage = -99; this.caseState = '';
    this.worldRoom = isHouseGrounds(room.id) ? houseExterior(state) : room;
    const world = isHouseGrounds(room.id) ? buildHouseExterior(this.worldRoom, this.materials, state.flags) : buildWorld(room, this.materials, state.flags);
    this.architecture = world.group; this.architectureState = this.structuralState(state);
    this.environment.add(world.group); this.colliders = world.colliders; this.animations = world.animated;
    this.carriedLightReveals = world.lights.filter(light => light.userData.carriedLightReveal);
    for (const light of world.lights) if (!light.parent) this.environment.add(light);
    for (const light of world.lights) {
      if (room.dark) light.visible = false;
      if (light instanceof THREE.PointLight) { light.castShadow = false; if (light.intensity < 2) light.intensity *= 8; }
    }
    const outside = isHouseGrounds(room.id) || ['forest', 'falls', 'rainbow', 'river', 'sand', 'barrow'].includes(room.kind);
    this.sky.visible = outside;
    if (outside) this.environment.add(makeLandscape(this.worldRoom, this.materials));
    const fogColor = outside ? new THREE.Color('#829b86') : room.kind === 'house' ? new THREE.Color('#33362c') : new THREE.Color('#142a2c');
    if (room.kind === 'underworld') fogColor.set('#261a21');
    this.scene.background = fogColor;
    this.scene.fog = new THREE.FogExp2(fogColor, outside ? 0.0105 : room.kind === 'house' ? 0.012 : 0.022);
    this.sun.intensity = outside ? 2.75 : room.kind === 'house' ? 1.2 : 0.34;
    this.hemisphere.intensity = outside ? 0.9 : room.kind === 'house' ? 0.88 : 0.64;
    this.hemisphere.color.set(outside ? '#d8ecdf' : '#729aab');
    this.hemisphere.groundColor.set(outside ? '#5a5d35' : '#1c2021');
    this.fill.intensity = outside ? 0.36 : 0.25;
    this.scene.environmentIntensity = outside ? 0.65 : 0.25;
    this.illumination = { sun: this.sun.intensity, hemisphere: this.hemisphere.intensity, fill: this.fill.intensity, environment: this.scene.environmentIntensity };
    this.baseExposure = outside ? 1.03 : room.kind === 'house' ? 1.1 : 1.25;
    this.refreshObjects(state);
    if (room.enemy && !state.flags[`${room.enemy.id}_defeated`]) {
      this.enemy = makeCreature(room.enemy.kind, this.materials);
      this.enemy.group.position.set(room.enemy.position[0], 0, room.enemy.position[1]); this.environment.add(this.enemy.group);
    }
    if (room.kind === 'cyclops') {
      this.secondaryCreature = makeCreature('cyclops', this.materials);
      this.secondaryCreature.group.position.set(0, 0, -room.size[1] * 0.21); this.environment.add(this.secondaryCreature.group);
    }
    if (room.dark) { this.grue = makeCreature('grue', this.materials); this.grue.group.visible = false; this.environment.add(this.grue.group); }
    this.addMotes(this.worldRoom, outside);
    this.camera.position.set(state.position[0], 1.72 + routeFloorHeight(room.id, state.position, state.flags), state.position[1]); this.camera.rotation.set(0, state.yaw, 0, 'YXZ');
  }
  showTitle(time: number, settings: GameState['settings']) {
    if (!this.titleState) {
      const preview = createGame(); preview.settings = { ...settings };
      this.enter(ROOMS[START_ROOM], preview);
      this.titleState = preview;
    }
    const portrait = window.innerWidth < window.innerHeight;
    // The title uses the same meadow and house, with its own framing and state.
    // Continuing an expedition restores its normal room, camera and field of view.
    this.titleState.settings = { ...settings, fov: portrait ? 68 : 58 };
    const drift = settings.motion ? Math.sin(time * .045) * .32 : 0;
    this.camera.position.set(portrait ? 9 + drift : 9.5 + drift, 3.4, portrait ? 23 : 16);
    this.camera.lookAt(portrait ? 0 : -7.5, 3.4, -13);
  }
  refreshObjects(state: GameState) {
    if (!this.room || !this.worldRoom) return;
    if (isHouseGrounds(this.room.id)) this.worldRoom = houseExterior(state);
    const structure = this.structuralState(state);
    if (structure !== this.architectureState && this.architecture) {
      this.environment.remove(this.architecture);
      const oldGeometry = new Set<THREE.BufferGeometry>();
      this.architecture.traverse(node => {
        if (node instanceof THREE.Mesh || node instanceof THREE.Points) oldGeometry.add(node.geometry);
        node.userData.disposeMaterials?.();
      });
      for (const geometry of oldGeometry) geometry.dispose();
      const world = isHouseGrounds(this.room.id) ? buildHouseExterior(this.worldRoom, this.materials, state.flags) : buildWorld(this.worldRoom, this.materials, state.flags);
      this.architecture = world.group; this.environment.add(world.group); this.colliders = world.colliders; this.animations = world.animated;
      this.carriedLightReveals = world.lights.filter(light => light.userData.carriedLightReveal);
      for (const light of world.lights) { if (!light.parent) world.group.add(light); if (light instanceof THREE.PointLight) light.castShadow = false; if (this.room.dark) light.visible = false; }
      this.architectureState = structure;
    }
    for (const obj of this.worldRoom.objects) {
      const hidden = !!(obj.hiddenIf && state.flags[obj.hiddenIf]) || !!(obj.requires && !state.flags[obj.requires]);
      const propType = obj.id === 'maze_grate' ? 'grate_above' : obj.id === 'folded_boat' && !state.flags.boat_ready ? 'boat_folded' : obj.id === 'trophy_case' ? 'case' : obj.type;
      let group = this.objects.get(obj.id);
      const inflateBoat = !!group && obj.id === 'folded_boat' && group.userData.propType !== propType;
      if (group && inflateBoat) {
        this.environment.remove(group);
        group.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
        this.objects.delete(obj.id); group = undefined;
      }
      if (group) { group.visible = !hidden; this.setObjectPose(group, state); continue; }
      if (hidden) continue;
      group = obj.type === 'hatch' ? new THREE.Group() : makeProp(propType, this.materials);
      group.userData.propType = propType;
      if (inflateBoat) { group.userData.inflating = 0; group.scale.set(0.65, 0.14, 0.65); }
      group.name = obj.id; group.position.set(...obj.position);
      group.rotation.y = obj.yaw ?? 0;
      if (obj.id === 'sceptre') placeCoffinContents(group);
      // Rest the small bracelet on the side working's timber boards.
      if (obj.id === 'bracelet' && this.room.id === 'coal_mine') group.position.y += .065;
      if (obj.id !== 'sceptre' && (obj.treasure || ['egg', 'painting', 'bar', 'chalice', 'coins', 'trident'].includes(obj.type))) {
        const light = new THREE.PointLight('#e9b66a', 2.8, 4.5, 1.5); light.position.set(0, 0.65, 0); group.add(light);
        const haloMaterial = new THREE.MeshBasicMaterial({ color: '#e2bd71', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
        this.transparentMaterials.add(haloMaterial);
        const halo = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.32, 48), haloMaterial); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.015; group.add(halo);
        if (obj.type !== 'torch') this.treasureGlows.push({ light, halo: haloMaterial });
      }
      this.objects.set(obj.id, group); this.environment.add(group); this.objectRotations.set(obj.id, group.rotation.y);
      this.setObjectPose(group, state, true);
    }
    const cabinet = this.objects.get('trophy_case');
    if (cabinet && this.caseState !== state.deposited.join(',')) {
      const previous = cabinet.getObjectByName('displayed-treasures'); if (previous) cabinet.remove(previous);
      const content = new THREE.Group(); content.name = 'displayed-treasures';
      const types: Record<string, string> = { platinum_bar: 'bar', jewel_trunk: 'trunk', gold: 'gold', coins: 'coins' };
      const slots = cabinet.userData.displaySlots as [number, number, number][] | undefined;
      for (let index = 0; index < TREASURES.length; index++) {
        const id = TREASURES[index]; if (!state.deposited.includes(id) || !slots?.[index]) continue;
        const miniature = makeProp(types[id] ?? id, this.materials);
        if (['bracelet', 'scarab'].includes(id)) miniature.rotation.x = Math.PI / 2;
        const bounds = new THREE.Box3().setFromObject(miniature), size = bounds.getSize(new THREE.Vector3());
        const scale = Math.min(0.28 / Math.max(0.001, size.x), 0.48 / Math.max(0.001, size.y), 0.30 / Math.max(0.001, size.z));
        miniature.scale.setScalar(scale); bounds.setFromObject(miniature); const center = bounds.getCenter(new THREE.Vector3());
        miniature.position.set(slots[index][0] - center.x, slots[index][1] - bounds.min.y, slots[index][2] - center.z); content.add(miniature);
      }
      cabinet.add(content); this.caseState = state.deposited.join(',');
    }
  }
  objectPosition(obj: ObjectDef): THREE.Vector3 { const g = this.objects.get(obj.id); return g ? g.position : new THREE.Vector3(...obj.position); }
  private setObjectPose(group: THREE.Group, state: GameState, immediate = false) {
    if (group.name === 'gold_coffin') setCoffinOpen(group, !!state.flags.coffin_open, immediate);
    const sash = group.getObjectByName('window-sash'), lid = group.getObjectByName('mailbox-door'), grate = group.getObjectByName('grate-lid');
    if (sash) { sash.userData.targetAngle = state.flags.window_open ? -1.45 : -0.09; if (immediate) sash.rotation.y = sash.userData.targetAngle; }
    if (lid) { lid.userData.targetAngle = state.flags.mailbox_read ? Math.PI * 0.53 : 0; if (immediate) lid.rotation.x = lid.userData.targetAngle; }
    if (grate) { grate.userData.targetAngle = state.flags.grate_open ? grate.userData.openAngle : grate.userData.closedAngle; if (immediate) grate.rotation.x = grate.userData.targetAngle; }
    const pressure = group.getObjectByName('dam-pressure-needle');
    if (pressure) pressure.rotation.z = state.flags.dam_leak || !state.flags.controls_enabled ? Math.PI * .66 : -Math.PI * .43;
    const bat = group.getObjectByName('roost-bat');
    if (bat) bat.visible = !state.flags.bat_quiet;
  }
  impact(kind: 'hit' | 'block' | 'parry') {
    if (!this.enemy) return;
    const direction = this.camera.position.clone().sub(this.enemy.group.position); direction.y = 0; direction.normalize();
    const position = this.enemy.group.position.clone().addScaledVector(direction, 0.6); position.y = this.room?.enemy?.kind === 'troll' ? 1.45 : 1.22;
    this.impacts.burst(position, kind, direction);
  }
  private structuralState(state: GameState): string {
    const flags = new Set(['window_open', 'trapdoor_open', 'barrow_path_open', 'reservoir_drained', 'rainbow_solid', 'dome_secured', 'hades_open', 'ritual_bell', 'ritual_candles', 'machine_loaded', 'machine_closed', 'diamond_created', 'controls_enabled', 'dam_leak']);
    if (this.worldRoom?.id === 'sandy_cave') flags.add('scarab_revealed');
    for (const exit of this.worldRoom?.exits ?? []) if (exit.requires) flags.add(exit.requires);
    return [...flags].sort().map(key => `${key}:${state.flags[key] ? 1 : 0}`).join('|');
  }
  private addMotes(room: RoomDef, outdoor: boolean) {
    const count = outdoor ? 240 : 180, positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { positions[i * 3] = (Math.random() - 0.5) * room.size[0]; positions[i * 3 + 1] = Math.random() * (outdoor ? 12 : 7); positions[i * 3 + 2] = (Math.random() - 0.5) * room.size[1]; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16); gradient.addColorStop(0, 'rgba(255,236,168,.9)'); gradient.addColorStop(0.2, 'rgba(255,236,168,.45)'); gradient.addColorStop(1, 'rgba(255,236,168,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
    const material = new THREE.PointsMaterial({ color: outdoor ? '#e7d4a2' : '#9bbbba', size: outdoor ? 0.12 : 0.085, map: new THREE.CanvasTexture(canvas), transparent: true, opacity: outdoor ? 0.55 : 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    this.motes = new THREE.Points(geometry, material); this.environment.add(this.motes);
  }
  setTouchMode(enabled: boolean) {
    if (enabled === this.touchMode) return;
    this.touchMode = enabled; this.lastSize = '';
    for (const [light, size] of [[this.sun, enabled ? 1024 : 2048], [this.heroKey, enabled ? 512 : 1024]] as const) {
      // A mapSize change alone leaves the old GPU allocation in place.
      light.shadow.dispose(); light.shadow.map = null; light.shadow.mapPass = null;
      light.shadow.mapSize.set(size, size); light.shadow.needsUpdate = true;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }
  setQuality(state: GameState) {
    const high = state.settings.quality === 'high';
    const samples = this.touchMode ? high ? 2 : 0 : 4;
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples !== samples) { target.dispose(); target.samples = samples; }
    }
    const ratio = Math.min(window.devicePixelRatio, high ? 1.5 : 1.0);
    const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    const size = `${width},${height},${ratio}`;
    if (size !== this.lastSize) {
      this.lastSize = size; this.renderer.setPixelRatio(ratio); this.renderer.setSize(width, height, false);
      this.composer.setPixelRatio(ratio); this.composer.setSize(width, height);
      this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
      this.heroCamera.aspect = this.camera.aspect; this.heroCamera.updateProjectionMatrix();
      const portrait = this.touchMode && width < height;
      this.heroFrameScale = portrait ? this.camera.aspect / 1.15 : 1;
      const depth = 0.72 * (1 - this.heroFrameScale);
      // Fit the actual hanging lamp and sword above the two-thumb controls.
      // Uniform scale plus extra depth preserves the glove proportions; the
      // world camera and all desktop/landscape carry poses stay unchanged.
      this.heroFrameY = portrait ? (440 / height - 1) * (0.83 * this.heroFrameScale + depth)
        * Math.tan(this.heroCamera.fov * Math.PI / 360) + 0.63 * this.heroFrameScale : 0;
      this.heroFrameZ = -depth;
      this.hero.scale.setScalar(this.heroFrameScale);
      this.lanternLight.position.x = -0.3 * this.heroFrameScale;
      this.lanternBeam.position.x = 0.2 * this.heroFrameScale;
    }
    this.bloom.enabled = high; this.ao.enabled = high;
    if (this.camera.fov !== state.settings.fov) { this.camera.fov = state.settings.fov; this.camera.updateProjectionMatrix(); }
  }
  update(dt: number, state: GameState, motion: { moving: number; attack: number; blocking: boolean; damage: number; darkness: number; darkTime: number; title: boolean }) {
    if (motion.title && this.titleState) {
      state = this.titleState;
      motion = { moving: 0, attack: 0, blocking: false, damage: 0, darkness: 0, darkTime: 0, title: true };
    }
    this.elapsed += dt; const t = this.elapsed;
    this.impacts.update(dt);
    for (const group of this.objects.values()) {
      if (group.name === 'gold_coffin') animateCoffinLid(group, dt);
      const sash = group.getObjectByName('window-sash'), lid = group.getObjectByName('mailbox-door'), grate = group.getObjectByName('grate-lid');
      if (sash) sash.rotation.y = THREE.MathUtils.damp(sash.rotation.y, sash.userData.targetAngle ?? 0, 7, dt);
      if (lid) lid.rotation.x = THREE.MathUtils.damp(lid.rotation.x, lid.userData.targetAngle ?? 0, 7, dt);
      if (grate) grate.rotation.x = THREE.MathUtils.damp(grate.rotation.x, grate.userData.targetAngle ?? 0, 7, dt);
      if (group.userData.type === 'bat' && !state.flags.bat_quiet) {
        const left = group.getObjectByName('roost-bat-wing-left'), right = group.getObjectByName('roost-bat-wing-right');
        const breath = Math.sin(t * 1.7) * .024;
        if (left) left.rotation.y = breath;
        if (right) right.rotation.y = -breath;
      }
      if (group.userData.inflating !== undefined) {
        const progress = Math.min(1, (group.userData.inflating as number) + dt / 1.1);
        const expansion = 1 - Math.pow(1 - progress, 3);
        group.scale.set(0.65 + expansion * 0.35, 0.14 + expansion * 0.86, 0.65 + expansion * 0.35);
        if (progress === 1) delete group.userData.inflating; else group.userData.inflating = progress;
      }
    }
    this.setQuality(state);
    this.hero.visible = !motion.title;
    this.weapon.visible = state.inventory.includes('sword');
    if (this.swordArm) this.swordArm.group.visible = this.weapon.visible;
    this.torch.visible = state.inventory.includes('torch') && !state.lantern;
    this.lamp.visible = state.inventory.includes('lantern') && !this.torch.visible;
    for (const bulb of this.lampBulbs) bulb.visible = state.lantern;
    this.lanternLight.visible = carriesLight(state); this.lanternBeam.visible = state.lantern && this.lamp.visible;
    this.lanternLight.intensity = (this.torch.visible ? 7 : 9) + Math.sin(t * 8.3) * 0.18 + Math.sin(t * 13) * 0.1;
    const lightLevel = 1 - motion.darkness * 0.97;
    this.sun.intensity = this.illumination.sun * lightLevel;
    this.hemisphere.intensity = this.illumination.hemisphere * lightLevel;
    this.fill.intensity = this.illumination.fill * lightLevel;
    this.scene.environmentIntensity = this.illumination.environment * lightLevel;
    this.heroScene.environmentIntensity = 0.55 * (1 - motion.darkness * 0.9);
    this.heroFill.intensity = 0.75 * (1 - motion.darkness * 0.94);
    this.heroKey.intensity = 1.3 * (1 - motion.darkness * 0.97);
    for (const glow of this.treasureGlows) { glow.light.intensity = 2.8 * lightLevel; glow.halo.opacity = 0.2 * lightLevel; }
    for (const light of this.carriedLightReveals) light.visible = hasLight(state);
    this.updateGrue(state, motion.darkTime, t, motion.title);
    this.renderer.toneMappingExposure = this.baseExposure;
    const bob = state.settings.motion ? Math.sin(t * 10.5) * motion.moving * 0.013 : 0;
    this.hero.position.set(Math.sin(t * 5) * motion.moving * 0.008 * this.heroFrameScale,
      this.heroFrameY + bob * this.heroFrameScale, this.heroFrameZ);
    this.lamp.rotation.z = 0.05 + (state.settings.motion ? Math.sin(t * 4.6) * (0.008 + motion.moving * 0.012) : 0);
    this.lampPendant.rotation.z = state.settings.motion ? Math.sin(t * 3.8) * (0.012 + motion.moving * 0.026) : 0;
    this.lampPendant.rotation.x = state.settings.motion ? Math.sin(t * 3.3) * (0.006 + motion.moving * 0.018) : 0;
    const swing = motion.attack > 0 ? Math.sin((1 - motion.attack) * Math.PI) : 0;
    this.weapon.rotation.set(-0.18 - swing * 1.2 - (motion.blocking ? 0.7 : 0), -0.2 + swing * 0.6, -0.2 + swing * 1.9 + (motion.blocking ? 1.2 : 0));
    this.weapon.position.x = 0.37 - swing * 0.33 - (motion.blocking ? 0.1 : 0); this.weapon.position.y = -0.56 + swing * 0.15 + (motion.blocking ? 0.14 : 0);
    this.swordArm?.update();
    if (this.motes) this.motes.rotation.y = Math.sin(t * 0.05) * 0.03;
    for (const a of this.animations) {
      if (a.kind === 'water') {
        const material = (a.object as THREE.Mesh).material;
        if (material instanceof THREE.MeshStandardMaterial && material.normalMap) { material.normalMap.offset.x = t * 0.007; material.normalMap.offset.y = t * 0.01; }
        if (a.baseY !== undefined) a.object.position.y = a.baseY + Math.sin(t * 0.6) * 0.025;
      } else if (a.kind === 'waterfall') {
        const material = (a.object as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (material.map) material.map.offset.y = t * 0.61;
        if (material.normalMap) material.normalMap.offset.y = t * 0.43;
      } else if (a.kind === 'flame') {
        if (a.object.userData.flameHeight === undefined) a.object.userData.flameHeight = a.object.scale.y;
        a.object.scale.y = a.object.userData.flameHeight * (0.95 + Math.sin(t * 11 + a.object.id) * 0.13);
      } else if (a.kind === 'wheel' || a.kind === 'gear') a.object.rotation.z = t * 0.09;
      else if (a.kind === 'pipe-leak') a.object.userData.animate(t);
      else if (a.kind === 'mist') {
        if (a.object.userData.mistBaseX === undefined) a.object.userData.mistBaseX = a.object.position.x;
        a.object.position.x = a.object.userData.mistBaseX + Math.sin(t * 0.08 + a.object.id) * 0.6;
      }
    }
    if (this.secondaryCreature) {
      this.secondaryCreature.group.visible = !state.flags.cyclops_fled;
      const asleep = state.flags.cyclops_passed;
      this.secondaryCreature.animate(t, asleep ? 'dead' : 'idle', asleep ? 1 : 0);
    }
    this.film.uniforms.time.value = t; this.film.uniforms.damage.value = motion.damage; this.film.uniforms.darkness.value = motion.darkness;
    this.renderer.info.reset(); const renderStart = performance.now();
    this.composer.render(); this.drawCalls = this.renderer.info.render.calls; this.renderMs = performance.now() - renderStart;
  }
  private updateGrue(state: GameState, darkTime: number, t: number, title: boolean) {
    if (!this.grue) return;
    const root = this.grue.group;
    const visible = !title && !hasLight(state) && darkTime >= 4.5;
    root.visible = visible;
    if (!visible) { this.grueStage = -99; return; }
    const timing = grueTiming(state), attackStart = timing.grace - 0.44;
    const cycle = darkTime < attackStart ? -1 : Math.floor((darkTime - attackStart) / timing.interval);
    if (cycle !== this.grueStage) {
      this.grueStage = cycle;
      const yaw = this.camera.rotation.y + (cycle % 2 ? 0.3 : -0.26);
      this.grueAnchor.set(this.camera.position.x - Math.sin(yaw) * 3.5, 0, this.camera.position.z - Math.cos(yaw) * 3.5);
    }
    const phase = cycle < 0 ? 0 : (darkTime - attackStart - cycle * timing.interval) / 0.8;
    const striking = cycle >= 0 && phase <= 1;
    const lungeArc = striking ? Math.sin(Math.min(1, phase) * Math.PI) : 0;
    const approach = lungeArc * 0.35;
    root.position.copy(this.grueAnchor).lerp(new THREE.Vector3(this.camera.position.x, 0, this.camera.position.z), approach);
    root.position.y = lungeArc * 0.65;
    root.rotation.y = Math.atan2(this.camera.position.x - root.position.x, this.camera.position.z - root.position.z);
    const glimpse = darkTime < 6 ? Math.max(0, Math.sin((darkTime - 4.5) * Math.PI / 1.5)) * 0.28 : darkTime < attackStart ? 0.12 + Math.max(0, Math.sin(t * 2.1)) * 0.22 : striking ? 0.85 : 0.06;
    root.userData.grue?.setReveal(glimpse);
    this.grue.animate(t, striking ? 'lunge' : darkTime > 8 ? 'stalk' : 'lurk', striking ? phase : Math.min(1, (darkTime - 4.5) / 6));
    // A grue never steps into lamplight; only a fleeting outline reaches the edge of vision.
    if (cycle >= 0 && !striking) root.visible = false;
  }
  private disposeEnvironment() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.environment.traverse(obj => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        if (obj.geometry) geometries.add(obj.geometry);
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) if (!this.materialCache.has(m)) materials.add(m);
      }
    });
    // Shared meshes may reuse geometry across rooms; WebGL reuploads disposed geometry on next use.
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    this.environment.clear(); this.animations = []; this.transparentMaterials.clear(); this.treasureGlows = [];
  }
}
