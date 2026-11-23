import * as THREE from 'three';
import { getPropAtlasDef } from '../data/propAssets.ts';
import type { FxQualityTier } from '../domain/FxPool.ts';
import { isWithinHiddenSparkleRange } from '../domain/TerrainRules.ts';
import type { BattleBiome, MapDef, PropKind } from '../domain/types.ts';
import type { PropInstancePlacement } from './BillboardBatch.ts';
import { DIORAMA_RENDER_ORDER } from './DioramaLayers.ts';
import type { DisposableRegistry } from './Disposables.ts';

const _dummy = new THREE.Object3D();
const _hdrColor = new THREE.Color();

interface GlowSpec {
  height: number;
  size: number;
  color: number;
  intensity: number;
}

const PROP_SHADOW_RADIUS: Partial<Record<PropKind, number>> = {
  oak: 0.92,
  birch: 0.92,
  pine: 0.7,
  snow_pine: 0.78,
  mushroom_tree: 0.74,
  mushroom_tree_arcane: 0.74,
  boulder: 0.56,
  well: 0.62,
  pillar: 0.48,
  capsule_pedestal: 0.42,
  heal_machine: 0.5,
  crystal: 0.36,
  bench: 0.54,
  sign: 0.34,
  lamp_post: 0.28,
  lamp_wood: 0.3,
  lamp_double: 0.36,
  lamp_stone: 0.28,
  bush: 0.46,
  bush_arcane: 0.46,
  forge_hearth: 0.62,
  anvil_bench: 0.44,
  doll_worktable: 0.56,
  mannequin_rack: 0.52,
  blueprint_desk: 0.42,
  skill_altar: 0.56,
  training_dummy: 0.48,
  lab_console: 0.54,
};

const PROP_GLOW_SPECS: Partial<Record<PropKind, GlowSpec>> = {
  lamp_post: { height: 1.56, size: 1.15, color: 0xffcf70, intensity: 1.55 },
  lamp_wood: { height: 1.48, size: 1.12, color: 0xffc460, intensity: 1.5 },
  lamp_double: { height: 1.58, size: 1.35, color: 0xffd678, intensity: 1.65 },
  lamp_stone: { height: 1.48, size: 1.15, color: 0x9cf0ff, intensity: 1.55 },
  crystal: { height: 0.65, size: 1.05, color: 0x86e8ff, intensity: 1.6 },
  capsule_pedestal: { height: 0.78, size: 0.92, color: 0x7af5d8, intensity: 1.4 },
  heal_machine: { height: 0.95, size: 1.15, color: 0x7effc6, intensity: 1.45 },
  forge_hearth: { height: 0.72, size: 1.45, color: 0xff9248, intensity: 1.7 },
  anvil_bench: { height: 0.62, size: 0.78, color: 0xffb85c, intensity: 1.2 },
  doll_worktable: { height: 0.74, size: 1.05, color: 0x5fe3d2, intensity: 1.35 },
  skill_altar: { height: 1.05, size: 1.35, color: 0x62f2ff, intensity: 1.65 },
  training_dummy: { height: 0.78, size: 0.85, color: 0xf4c35d, intensity: 1.15 },
  lab_console: { height: 0.88, size: 1.18, color: 0x66f2ff, intensity: 1.45 },
};

export function createContactShadowTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const size = 16;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - (size - 1) * 0.5) / (size * 0.5);
        const dy = (y - (size - 1) * 0.5) / (size * 0.5);
        const d = Math.min(1, Math.hypot(dx, dy));
        const a = Math.round(Math.pow(1 - d, 1.5) * 198);
        const idx = (y * size + x) * 4;
        data[idx] = 10;
        data[idx + 1] = 7;
        data[idx + 2] = 16;
        data[idx + 3] = a;
      }
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 15.5);
  grad.addColorStop(0, 'rgba(10, 7, 16, 0.78)');
  grad.addColorStop(0.55, 'rgba(10, 7, 16, 0.42)');
  grad.addColorStop(1, 'rgba(10, 7, 16, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function createGlowSpriteTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const size = 16;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - (size - 1) * 0.5) / (size * 0.5);
        const dy = (y - (size - 1) * 0.5) / (size * 0.5);
        const d = Math.min(1, Math.hypot(dx, dy));
        const a = Math.round(Math.pow(1 - d, 2) * 255);
        const idx = (y * size + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 240;
        data[idx + 2] = 200;
        data[idx + 3] = a;
      }
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(24, 24, 1, 24, 24, 23);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.28, 'rgba(255, 245, 220, 0.65)');
  grad.addColorStop(0.62, 'rgba(255, 225, 180, 0.18)');
  grad.addColorStop(1, 'rgba(255, 220, 160, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 48, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export type StepPuffKind = 'dust' | 'grass' | 'snow';

interface GlowEntry {
  x: number;
  y: number;
  z: number;
  size: number;
  color: number;
  intensity: number;
  phase: number;
}

interface PooledPointLight {
  light: THREE.PointLight;
  baseIntensity: number;
}

const MAX_STEP_PUFFS = 36;
const MAX_HIDDEN_PICKUP_SLOTS = 12;
const SPARKLES_PER_PICKUP = 4;
const MAX_HIDDEN_SPARKLES = MAX_HIDDEN_PICKUP_SLOTS * SPARKLES_PER_PICKUP;

interface HiddenPickupSparkleSlot {
  id: string;
  x: number;
  y: number;
  z: number;
  collected: boolean;
}

interface StepPuffSlot {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  g: number;
  b: number;
  size: number;
}

function getBiomeParticleConfig(biome: BattleBiome): {
  colorA: THREE.Color;
  colorB: THREE.Color;
  driftX: number;
  driftY: number;
  driftZ: number;
  size: number;
  opacity: number;
} {
  switch (biome) {
    case 'forest':
      return {
        colorA: new THREE.Color(1.45, 1.35, 0.52), // HDR fireflies
        colorB: new THREE.Color(0.65, 1.55, 0.88),
        driftX: 0.25,
        driftY: 0.14,
        driftZ: 0.18,
        size: 16.0,
        opacity: 0.85,
      };
    case 'cave':
      return {
        colorA: new THREE.Color(0.75, 1.35, 1.65), // HDR crystal spores
        colorB: new THREE.Color(1.28, 0.72, 1.55),
        driftX: 0.14,
        driftY: 0.28,
        driftZ: 0.14,
        size: 15.0,
        opacity: 0.82,
      };
    case 'mountain':
    case 'snow':
      return {
        colorA: new THREE.Color(1.05, 1.12, 1.25),
        colorB: new THREE.Color(0.85, 0.98, 1.18),
        driftX: 0.65,
        driftY: -0.75,
        driftZ: 0.28,
        size: 13.0,
        opacity: 0.72,
      };
    case 'arena':
      return {
        colorA: new THREE.Color(1.6, 1.12, 0.42), // HDR arena embers
        colorB: new THREE.Color(1.5, 0.65, 0.35),
        driftX: 0.22,
        driftY: 0.55,
        driftZ: 0.18,
        size: 14.0,
        opacity: 0.85,
      };
    case 'coast':
    case 'meadow':
    default:
      return {
        colorA: new THREE.Color(1.32, 1.22, 0.76), // warm sunlit pollen motes
        colorB: new THREE.Color(1.08, 1.28, 0.92),
        driftX: 0.35,
        driftY: 0.1,
        driftZ: 0.2,
        size: 12.0,
        opacity: 0.68,
      };
  }
}

export class OverworldAtmosphere {
  private readonly shadowTex: THREE.Texture;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly shadowPlaneGeo: THREE.PlaneGeometry;

  private glowMesh: THREE.InstancedMesh | null = null;
  private glowMat: THREE.MeshBasicMaterial | null = null;
  private glowEntries: GlowEntry[] = [];
  private glowIntensityMult = 1.0;
  private nearestLights: PooledPointLight[] = [];

  private shaftGroup: THREE.Group | null = null;
  private shaftMat: THREE.ShaderMaterial | null = null;

  private particles: THREE.Points | null = null;
  private particleMat: THREE.ShaderMaterial | null = null;

  private puffSlots: StepPuffSlot[] = [];
  private puffCursor = 0;
  private puffPositions = new Float32Array(MAX_STEP_PUFFS * 3);
  private puffColors = new Float32Array(MAX_STEP_PUFFS * 3);
  private puffSizes = new Float32Array(MAX_STEP_PUFFS);
  private puffGeo: THREE.BufferGeometry | null = null;
  private puffPoints: THREE.Points | null = null;

  private hiddenPickups: HiddenPickupSparkleSlot[] = [];
  private sparklePositions = new Float32Array(MAX_HIDDEN_SPARKLES * 3);
  private sparkleColors = new Float32Array(MAX_HIDDEN_SPARKLES * 3);
  private sparkleSizes = new Float32Array(MAX_HIDDEN_SPARKLES);
  private sparkleGeo: THREE.BufferGeometry | null = null;
  private sparklePoints: THREE.Points | null = null;

  private readonly scene: THREE.Scene;
  private readonly disposables: DisposableRegistry;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    disposables: DisposableRegistry,
    map: MapDef,
    propPlacements: readonly PropInstancePlacement[],
    extraGlowPoints: readonly { x: number; y: number; z: number; kind: PropKind }[]
  ) {
    this.scene = scene;
    this.disposables = disposables;
    this.shadowTex = createContactShadowTexture();
    this.shadowPlaneGeo = new THREE.PlaneGeometry(1, 1);
    this.shadowPlaneGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    disposables.track(this.shadowTex);
    disposables.track(this.shadowPlaneGeo);
    disposables.track(this.shadowMat);

    this.buildPropShadows(scene, disposables, propPlacements);
    this.buildGlowHalos(scene, disposables, propPlacements, extraGlowPoints);
    this.buildNearestGlowLights(scene, disposables);
    this.buildStepPuffs(scene, disposables);
    if (!map.isInterior) {
      this.buildLightShafts(scene, disposables, map);
      this.buildAmbientParticles(scene, disposables, map.biome);
    }
  }

  createActorShadow(radius = 0.72): THREE.Mesh {
    const mesh = new THREE.Mesh(this.shadowPlaneGeo, this.shadowMat);
    mesh.scale.set(radius, 1, radius * 0.85);
    mesh.renderOrder = DIORAMA_RENDER_ORDER.SHADOW_DECAL;
    return mesh;
  }

  private buildPropShadows(
    scene: THREE.Scene,
    disposables: DisposableRegistry,
    placements: readonly PropInstancePlacement[]
  ): void {
    const shadowItems: Array<{ x: number; y: number; z: number; r: number }> = [];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const atlasDef = getPropAtlasDef(p.kind);
      const baseR =
        PROP_SHADOW_RADIUS[p.kind] ??
        (atlasDef?.shadow ? Math.max(atlasDef.width, atlasDef.height) * 0.38 : undefined);
      if (!baseR) continue;
      shadowItems.push({
        x: p.x,
        y: p.y + 0.02,
        z: p.z,
        r: baseR * 2 * p.scale,
      });
    }
    if (shadowItems.length === 0) return;

    const inst = new THREE.InstancedMesh(
      this.shadowPlaneGeo,
      this.shadowMat,
      shadowItems.length
    );
    inst.renderOrder = DIORAMA_RENDER_ORDER.SHADOW_DECAL;
    for (let i = 0; i < shadowItems.length; i++) {
      const s = shadowItems[i];
      _dummy.position.set(s.x, s.y, s.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(s.r, 1, s.r * 0.82);
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    scene.add(inst);
    disposables.track(inst.geometry);
  }

  private buildGlowHalos(
    scene: THREE.Scene,
    disposables: DisposableRegistry,
    placements: readonly PropInstancePlacement[],
    extraGlowPoints: readonly { x: number; y: number; z: number; kind: PropKind }[]
  ): void {
    const entries: GlowEntry[] = [];
    let idx = 0;
    const add = (x: number, y: number, z: number, scale: number, kind: PropKind) => {
      const spec = PROP_GLOW_SPECS[kind];
      if (!spec) return;
      entries.push({
        x,
        y: y + spec.height * scale,
        z,
        size: spec.size * scale,
        color: spec.color,
        intensity: spec.intensity,
        phase: idx++ * 1.37,
      });
    };

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      add(p.x, p.y, p.z, p.scale, p.kind);
    }
    for (let i = 0; i < extraGlowPoints.length; i++) {
      const e = extraGlowPoints[i];
      add(e.x, e.y, e.z, 1, e.kind);
    }
    if (entries.length === 0) return;

    const glowTex = createGlowSpriteTexture();
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    disposables.track(glowTex);
    disposables.track(glowGeo);
    disposables.track(glowMat);

    const inst = new THREE.InstancedMesh(glowGeo, glowMat, entries.length);
    inst.renderOrder = DIORAMA_RENDER_ORDER.ATMOSPHERE_GLOW;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      _dummy.position.set(e.x, e.y, e.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(e.size);
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
      _hdrColor.setHex(e.color).multiplyScalar(e.intensity);
      inst.setColorAt(i, _hdrColor);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;

    scene.add(inst);
    this.glowMesh = inst;
    this.glowMat = glowMat;
    this.glowEntries = entries;
  }

  setGlowIntensityMult(mult: number): void {
    this.glowIntensityMult = Math.max(0.25, Math.min(2.2, mult));
    if (this.glowMat) {
      this.glowMat.opacity = Math.min(0.95, 0.72 * Math.sqrt(this.glowIntensityMult));
    }
  }

  private buildLightShafts(
    scene: THREE.Scene,
    disposables: DisposableRegistry,
    map: MapDef
  ): void {
    const isCave = map.music === 'cave';
    if (!isCave && map.biome !== 'meadow' && map.biome !== 'forest' && map.biome !== 'coast') {
      return;
    }

    const shaftColor = isCave ? new THREE.Color(0.58, 0.78, 1.32) : new THREE.Color(1.38, 1.24, 0.92);
    const shaftGeo = new THREE.PlaneGeometry(3.2, 13.0);
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: shaftColor },
        uOpacity: { value: isCave ? 0.14 : 0.11 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float horiz = sin(vUv.x * 3.14159265);
          horiz = horiz * horiz;
          float vert = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
          float shimmer = 0.78 + 0.22 * sin(uTime * 0.75 + vUv.x * 5.0 + vUv.y * 2.0);
          float alpha = horiz * vert * shimmer * uOpacity;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    disposables.track(shaftGeo);
    disposables.track(shaftMat);

    const group = new THREE.Group();
    const offsets: Array<[number, number, number, number]> = [
      [-6.5, 4.8, -5.0, 1.0],
      [-1.5, 5.2, -7.2, 1.18],
      [3.8, 5.0, -4.4, 0.95],
      [7.2, 4.7, -6.6, 1.1],
      [-4.2, 4.9, 1.2, 0.9],
    ];
    for (let i = 0; i < offsets.length; i++) {
      const [ox, oy, oz, scale] = offsets[i];
      const beam = new THREE.Mesh(shaftGeo, shaftMat);
      beam.position.set(ox, oy, oz);
      beam.rotation.z = isCave ? -0.18 : -0.34;
      beam.scale.set(scale, 1, 1);
      beam.renderOrder = DIORAMA_RENDER_ORDER.ATMOSPHERE_GLOW;
      group.add(beam);
    }

    scene.add(group);
    this.shaftGroup = group;
    this.shaftMat = shaftMat;
  }

  private buildAmbientParticles(
    scene: THREE.Scene,
    disposables: DisposableRegistry,
    biome: BattleBiome
  ): void {
    const count = 96;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const cfg = getBiomeParticleConfig(biome);

    for (let i = 0; i < count; i++) {
      // Deterministic quasi-random distribution inside [-9, 9] x [0, 6] x [-9, 9]
      const h1 = Math.sin(i * 12.9898 + 1.23) * 43758.5453;
      const h2 = Math.sin(i * 78.233 + 4.56) * 28461.137;
      const h3 = Math.sin(i * 45.164 + 7.89) * 19582.771;
      const rx = h1 - Math.floor(h1);
      const ry = h2 - Math.floor(h2);
      const rz = h3 - Math.floor(h3);

      positions[i * 3] = (rx - 0.5) * 18;
      positions[i * 3 + 1] = ry * 6;
      positions[i * 3 + 2] = (rz - 0.5) * 18;

      const c = i % 2 === 0 ? cfg.colorA : cfg.colorB;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      phases[i] = (i * 0.73) % (Math.PI * 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3(0, 0, 0) },
        uDrift: { value: new THREE.Vector3(cfg.driftX, cfg.driftY, cfg.driftZ) },
        uSize: { value: cfg.size },
        uOpacity: { value: cfg.opacity },
      },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aPhase;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uDrift;
        uniform float uSize;
        varying vec3 vColor;
        varying float vPulse;

        void main() {
          vColor = color;
          vec3 boxSize = vec3(18.0, 6.0, 18.0);
          vec3 local = position + uDrift * uTime;
          local.x += sin(uTime * 0.9 + aPhase) * 0.45;
          local.y += cos(uTime * 1.15 + aPhase * 1.3) * 0.25;

          // Wrap smoothly around player world position so motes stay visible everywhere
          vec3 rel = mod(local - uCenter + boxSize * 0.5, boxSize) - boxSize * 0.5;
          vec3 worldPos = uCenter + rel;
          worldPos.y = max(uCenter.y + 0.25, worldPos.y);

          vPulse = 0.55 + 0.45 * sin(uTime * 2.6 + aPhase * 2.0);
          vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
          gl_PointSize = clamp(uSize / max(1.5, -mvPos.z), 2.0, 10.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vPulse;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float alpha = smoothstep(1.0, 0.1, d) * vPulse * uOpacity;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    disposables.track(geo);
    disposables.track(mat);

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = DIORAMA_RENDER_ORDER.ATMOSPHERE_PARTICLE;
    scene.add(pts);
    this.particles = pts;
    this.particleMat = mat;
  }

  private buildNearestGlowLights(
    scene: THREE.Scene,
    disposables: DisposableRegistry
  ): void {
    if (this.glowEntries.length === 0) return;
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffcf70, 0, 7.2, 1.6);
      scene.add(light);
      disposables.track(light);
      this.nearestLights.push({ light, baseIntensity: 0 });
    }
  }

  private buildStepPuffs(
    scene: THREE.Scene,
    disposables: DisposableRegistry
  ): void {
    for (let i = 0; i < MAX_STEP_PUFFS; i++) {
      this.puffSlots.push({
        active: false,
        age: 0,
        life: 0.3,
        x: 0,
        y: -99,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        r: 1,
        g: 1,
        b: 1,
        size: 0,
      });
      this.puffPositions[i * 3 + 1] = -99;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.puffPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.puffColors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.puffSizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = step(0.05, aSize);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp((aSize * 28.0) / max(1.5, -mv.z), 0.0, 12.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.01) discard;
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float soft = smoothstep(1.0, 0.2, d);
          gl_FragColor = vec4(vColor, soft * 0.75);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    disposables.track(geo);
    disposables.track(mat);

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = DIORAMA_RENDER_ORDER.ATMOSPHERE_PARTICLE;
    scene.add(pts);
    this.puffGeo = geo;
    this.puffPoints = pts;
  }

  private buildHiddenSparkles(
    scene: THREE.Scene,
    disposables: DisposableRegistry
  ): void {
    for (let i = 0; i < MAX_HIDDEN_SPARKLES; i++) {
      this.sparklePositions[i * 3 + 1] = -99;
      this.sparkleSizes[i] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparklePositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkleColors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sparkleSizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = step(0.05, aSize);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp((aSize * 34.0) / max(1.5, -mv.z), 0.0, 14.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.01) discard;
          vec2 p = (gl_PointCoord - 0.5) * 2.0;
          float d = length(p);
          if (d > 1.0) discard;
          float crossStar = max(exp(-abs(p.x) * 4.5) * exp(-abs(p.y) * 1.4), exp(-abs(p.y) * 4.5) * exp(-abs(p.x) * 1.4));
          float core = smoothstep(1.0, 0.15, d);
          float alpha = clamp(core * 0.55 + crossStar * 0.75, 0.0, 1.0);
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    disposables.track(geo);
    disposables.track(mat);

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = DIORAMA_RENDER_ORDER.ATMOSPHERE_PARTICLE;
    scene.add(pts);
    this.sparkleGeo = geo;
    this.sparklePoints = pts;
  }

  setHiddenPickups(
    pickups: ReadonlyArray<{ id: string; x: number; y: number; z: number }>
  ): void {
    this.hiddenPickups = pickups.slice(0, MAX_HIDDEN_PICKUP_SLOTS).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      collected: false,
    }));
    if (this.hiddenPickups.length > 0 && !this.sparklePoints) {
      this.buildHiddenSparkles(this.scene, this.disposables);
    }
  }

  markHiddenPickupCollected(id: string): void {
    for (const slot of this.hiddenPickups) {
      if (slot.id === id) {
        slot.collected = true;
      }
    }
  }

  spawnStepPuff(x: number, y: number, z: number, kind: StepPuffKind): void {
    const count = kind === 'grass' ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const slot = this.puffSlots[this.puffCursor];
      this.puffCursor = (this.puffCursor + 1) % MAX_STEP_PUFFS;

      const angle = (this.puffCursor * 2.39996 + i * 1.4) % (Math.PI * 2);
      const spd = kind === 'grass' ? 1.15 : 0.72;
      slot.active = true;
      slot.age = 0;
      slot.life = kind === 'grass' ? 0.36 : 0.28;
      slot.x = x + Math.cos(angle) * 0.14;
      slot.y = y + (kind === 'grass' ? 0.26 : 0.08);
      slot.z = z + Math.sin(angle) * 0.14;
      slot.vx = Math.cos(angle) * spd;
      slot.vy = kind === 'grass' ? 1.25 : 0.65;
      slot.vz = Math.sin(angle) * spd;
      slot.size = kind === 'grass' ? 1.15 : 0.95;

      if (kind === 'grass') {
        slot.r = 0.42;
        slot.g = 0.85;
        slot.b = 0.42;
      } else if (kind === 'snow') {
        slot.r = 0.9;
        slot.g = 0.96;
        slot.b = 1.0;
      } else {
        slot.r = 0.88;
        slot.g = 0.82;
        slot.b = 0.72;
      }
    }
  }

  update(
    dt: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    yaw: number,
    tier: FxQualityTier,
    showAmbientParticles = true
  ): void {
    this.time += dt;

    if (this.glowMesh && this.glowEntries.length > 0) {
      const showGlow = tier !== 'low';
      this.glowMesh.visible = showGlow;
      if (showGlow) {
        const n = this.glowEntries.length;
        for (let i = 0; i < n; i++) {
          const e = this.glowEntries[i];
          const pulse = 0.92 + Math.sin(this.time * 3.1 + e.phase) * 0.08;
          _dummy.position.set(e.x, e.y, e.z);
          _dummy.rotation.set(0, yaw, 0);
          _dummy.scale.setScalar(e.size * pulse);
          _dummy.updateMatrix();
          this.glowMesh.setMatrixAt(i, _dummy.matrix);
        }
        this.glowMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Update 2 nearest pooled PointLights so nearby lanterns & crystals cast colored light on floor & sprites
    if (this.nearestLights.length > 0) {
      if (tier === 'low') {
        for (const p of this.nearestLights) p.light.intensity = 0;
      } else {
        let bestIdx0 = -1;
        let bestD0 = 110;
        let bestIdx1 = -1;
        let bestD1 = 110;
        for (let i = 0; i < this.glowEntries.length; i++) {
          const e = this.glowEntries[i];
          const dx = e.x - playerX;
          const dz = e.z - playerZ;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD0) {
            bestD1 = bestD0;
            bestIdx1 = bestIdx0;
            bestD0 = d2;
            bestIdx0 = i;
          } else if (d2 < bestD1) {
            bestD1 = d2;
            bestIdx1 = i;
          }
        }

        const picked = [bestIdx0, bestIdx1];
        const dists = [bestD0, bestD1];
        for (let k = 0; k < this.nearestLights.length; k++) {
          const p = this.nearestLights[k];
          const idx = picked[k];
          if (idx < 0) {
            p.light.intensity = 0;
            continue;
          }
          const e = this.glowEntries[idx];
          const fade = Math.max(0, 1 - Math.sqrt(dists[k]) / 10.5);
          const flicker = 0.92 + Math.sin(this.time * 3.1 + e.phase) * 0.08;
          p.light.position.set(e.x, e.y, e.z);
          p.light.color.setHex(e.color);
          p.light.intensity = 2.4 * fade * flicker * this.glowIntensityMult;
        }
      }
    }

    if (this.shaftGroup && this.shaftMat) {
      this.shaftGroup.visible = tier !== 'low' && showAmbientParticles;
      if (this.shaftGroup.visible) {
        // Snap light shafts in 8-unit grid cells around player so beams stay anchored to world geometry
        this.shaftGroup.position.set(
          Math.round(playerX / 8) * 8,
          playerY,
          Math.round(playerZ / 8) * 8
        );
        this.shaftGroup.rotation.y = yaw * 0.35;
        this.shaftMat.uniforms.uTime.value = this.time;
      }
    }

    if (this.particles && this.particleMat) {
      this.particles.visible = tier !== 'low' && showAmbientParticles;
      if (this.particles.visible) {
        this.particleMat.uniforms.uTime.value = this.time;
        this.particleMat.uniforms.uCenter.value.set(playerX, playerY + 1.8, playerZ);
        this.particleMat.uniforms.uOpacity.value = tier === 'high' ? 0.82 : 0.48;
      }
    }

    if (this.puffGeo && this.puffPoints) {
      this.puffPoints.visible = showAmbientParticles;
      let dirty = false;
      for (let i = 0; i < MAX_STEP_PUFFS; i++) {
        const slot = this.puffSlots[i];
        if (!slot.active) continue;
        dirty = true;
        slot.age += dt;
        if (slot.age >= slot.life) {
          slot.active = false;
          this.puffSizes[i] = 0;
          this.puffPositions[i * 3 + 1] = -99;
          continue;
        }
        const t = slot.age / slot.life;
        slot.x += slot.vx * dt;
        slot.y += slot.vy * dt;
        slot.z += slot.vz * dt;
        slot.vy -= 2.4 * dt;

        this.puffPositions[i * 3] = slot.x;
        this.puffPositions[i * 3 + 1] = slot.y;
        this.puffPositions[i * 3 + 2] = slot.z;
        this.puffColors[i * 3] = slot.r;
        this.puffColors[i * 3 + 1] = slot.g;
        this.puffColors[i * 3 + 2] = slot.b;
        this.puffSizes[i] = slot.size * (1 - t);
      }
      if (dirty) {
        this.puffGeo.attributes.position.needsUpdate = true;
        this.puffGeo.attributes.color.needsUpdate = true;
        this.puffGeo.attributes.aSize.needsUpdate = true;
      }
    }

    if (this.sparkleGeo && this.sparklePoints) {
      this.sparklePoints.visible = this.hiddenPickups.length > 0;
      if (this.sparklePoints.visible) {
        const activeSlots = Math.min(this.hiddenPickups.length, MAX_HIDDEN_PICKUP_SLOTS);
        for (let i = 0; i < MAX_HIDDEN_SPARKLES; i++) {
          const slotIdx = Math.floor(i / SPARKLES_PER_PICKUP);
          const subIdx = i % SPARKLES_PER_PICKUP;
          if (slotIdx >= activeSlots) {
            this.sparkleSizes[i] = 0;
            this.sparklePositions[i * 3 + 1] = -99;
            continue;
          }
          const slot = this.hiddenPickups[slotIdx];
          if (
            slot.collected ||
            !isWithinHiddenSparkleRange(slot.x, slot.z, playerX, playerZ, 5.0)
          ) {
            this.sparkleSizes[i] = 0;
            this.sparklePositions[i * 3 + 1] = -99;
            continue;
          }
          const phase = this.time * 2.4 + slotIdx * 1.1 + subIdx * (Math.PI * 0.5);
          const lift = (phase * 0.45 + subIdx * 0.25) % 1;
          const twinkle = Math.sin(lift * Math.PI);
          const orbitR = 0.14 + 0.14 * Math.sin(phase * 0.7);
          this.sparklePositions[i * 3] = slot.x + Math.cos(phase) * orbitR;
          this.sparklePositions[i * 3 + 1] = slot.y + 0.16 + lift * 0.55;
          this.sparklePositions[i * 3 + 2] = slot.z + Math.sin(phase) * orbitR;
          if (subIdx % 2 === 0) {
            this.sparkleColors[i * 3] = 1.75;
            this.sparkleColors[i * 3 + 1] = 1.45;
            this.sparkleColors[i * 3 + 2] = 0.55;
          } else {
            this.sparkleColors[i * 3] = 0.72;
            this.sparkleColors[i * 3 + 1] = 1.65;
            this.sparkleColors[i * 3 + 2] = 1.85;
          }
          this.sparkleSizes[i] = 0.65 + 0.75 * twinkle;
        }
        this.sparkleGeo.attributes.position.needsUpdate = true;
        this.sparkleGeo.attributes.color.needsUpdate = true;
        this.sparkleGeo.attributes.aSize.needsUpdate = true;
      }
    }
  }
}
