import * as THREE from 'three';
import type { FxQualityTier } from '../domain/FxPool.ts';
import { getTileWorldY } from '../domain/TerrainRules.ts';
import type { MapDef } from '../domain/types.ts';
import type { DisposableRegistry } from './Disposables.ts';

function isWaterTile(map: MapDef, x: number, z: number): boolean {
  const row = map.grid[z];
  if (!row || x < 0 || x >= row.length) return false;
  return map.legend[row[x]]?.tile === 'water';
}

function getWaterColors(map: MapDef): {
  deep: THREE.Color;
  shallow: THREE.Color;
  foam: THREE.Color;
  glint: THREE.Color;
} {
  if (map.music === 'cave') {
    return {
      deep: new THREE.Color(0x132b4f),
      shallow: new THREE.Color(0x286796),
      foam: new THREE.Color(0x88e6ff),
      glint: new THREE.Color(0.75, 1.35, 1.65),
    };
  }
  if (map.biome === 'forest') {
    return {
      deep: new THREE.Color(0x134c59),
      shallow: new THREE.Color(0x2d8d8f),
      foam: new THREE.Color(0xcff7ef),
      glint: new THREE.Color(1.25, 1.32, 1.05),
    };
  }
  return {
    deep: new THREE.Color(0x165a85),
    shallow: new THREE.Color(0x36a2be),
    foam: new THREE.Color(0xdcf8ff),
    glint: new THREE.Color(1.42, 1.38, 1.15),
  };
}

export class WaterSurface {
  readonly mesh: THREE.Mesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    disposables: DisposableRegistry,
    map: MapDef
  ) {
    const h = map.grid.length;
    const w = map.grid[0]?.length ?? 0;
    const waterCells: Array<{ x: number; z: number; y: number }> = [];

    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        if (isWaterTile(map, x, z)) {
          waterCells.push({ x, z, y: getTileWorldY(map, x, z) + 0.045 });
        }
      }
    }

    if (waterCells.length === 0) return;

    const n = waterCells.length;
    const positions = new Float32Array(n * 4 * 3);
    const uvs = new Float32Array(n * 4 * 2);
    const shores = new Float32Array(n * 4);
    const indices: number[] = [];

    let vPtr = 0;
    let uvPtr = 0;
    let sPtr = 0;
    let base = 0;

    // Corner shore factor: valor continuo en [0, 1] que representa qué tan cerca está
    // esta esquina del agua de una orilla (tierra no-agua). 0 = agua profunda rodeada
    // de agua, 1 = esquina completamente en tierra. Se calcula como fracción ponderada
    // de vecinos no-agua en un cruz de 5 tiles alrededor de la esquina, lo que da
    // transiciones suaves de espuma y profundidad en la ribera sin cambiar la geometría
    // de quads 1×1 del agua.
    const cornerShore = (x: number, z: number, dx: number, dz: number): number => {
      // Vecinos ortogonales inmediatos en las direcciones de la esquina
      const orthA = !isWaterTile(map, x + dx, z);
      const orthB = !isWaterTile(map, x, z + dz);
      // Diagonal en la dirección de la esquina
      const diag = !isWaterTile(map, x + dx, z + dz);
      // Vecinos ortogonales opuestos para contexto de orilla amplia
      const orthOppA = !isWaterTile(map, x - dx, z);
      const orthOppB = !isWaterTile(map, x, z - dz);

      const nonWaterCount =
        (orthA ? 1 : 0) +
        (orthB ? 1 : 0) +
        (diag ? 1 : 0) +
        (orthOppA ? 1 : 0) +
        (orthOppB ? 1 : 0);

      if (nonWaterCount === 0) return 0.0;

      // Fracción continua entre 0.25 y 1.0; 2 no-agua ≈ 0.55 (mismo orden que el valor
      // diagonal previo, preservando el aspecto de ribera existente en mapas actuales).
      return 0.25 + (nonWaterCount / 5) * 0.75;
    };

    for (let i = 0; i < n; i++) {
      const { x, y, z } = waterCells[i];
      const x0 = x - 0.5;
      const x1 = x + 0.5;
      const z0 = z - 0.5;
      const z1 = z + 0.5;

      // BL (x0,z1), BR (x1,z1), TR (x1,z0), TL (x0,z0)
      positions[vPtr++] = x0; positions[vPtr++] = y; positions[vPtr++] = z1;
      positions[vPtr++] = x1; positions[vPtr++] = y; positions[vPtr++] = z1;
      positions[vPtr++] = x1; positions[vPtr++] = y; positions[vPtr++] = z0;
      positions[vPtr++] = x0; positions[vPtr++] = y; positions[vPtr++] = z0;

      uvs[uvPtr++] = x0; uvs[uvPtr++] = z1;
      uvs[uvPtr++] = x1; uvs[uvPtr++] = z1;
      uvs[uvPtr++] = x1; uvs[uvPtr++] = z0;
      uvs[uvPtr++] = x0; uvs[uvPtr++] = z0;

      shores[sPtr++] = cornerShore(x, z, -1, 1);
      shores[sPtr++] = cornerShore(x, z, 1, 1);
      shores[sPtr++] = cornerShore(x, z, 1, -1);
      shores[sPtr++] = cornerShore(x, z, -1, -1);

      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aShore', new THREE.BufferAttribute(shores, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const colors = getWaterColors(map);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsLib.fog,
        uTime: { value: 0 },
        uDetail: { value: 1.0 },
        uDeepColor: { value: colors.deep },
        uShallowColor: { value: colors.shallow },
        uFoamColor: { value: colors.foam },
        uGlintColor: { value: colors.glint },
      },
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        attribute float aShore;
        uniform float uTime;
        uniform float uDetail;
        varying vec2 vWorldXz;
        varying float vShore;

        void main() {
          vWorldXz = uv;
          vShore = aShore;
          vec3 pos = position;
          float wave = sin(pos.x * 2.4 + uTime * 2.2) * cos(pos.z * 2.1 - uTime * 1.7);
          pos.y += wave * 0.018 * (1.0 - aShore * 0.65) * uDetail;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform float uDetail;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;
        uniform vec3 uGlintColor;
        varying vec2 vWorldXz;
        varying float vShore;

        void main() {
          // Pixel-quantized coordinates preserve HD-2D retro water crispness
          vec2 pUv = floor(vWorldXz * 16.0) / 16.0;
          float w1 = sin(pUv.x * 4.2 + uTime * 1.9 + sin(pUv.y * 3.1 - uTime * 1.1));
          float w2 = cos(pUv.y * 5.0 - uTime * 1.5 + cos(pUv.x * 2.7 + uTime * 1.3));
          float ripple = (w1 + w2) * 0.5;

          float depthMix = clamp(vShore * 0.72 + ripple * 0.16 + 0.18, 0.0, 1.0);
          vec3 col = mix(uDeepColor, uShallowColor, depthMix);

          // Caustic pixel highlights
          float caustic = smoothstep(0.62, 0.92, ripple * 0.5 + 0.5);
          col = mix(col, uShallowColor * 1.24, caustic * 0.35);

          // Animated shoreline foam lapping near banks/bridges
          float shoreWave = 0.5 + 0.5 * sin(uTime * 2.8 - vWorldXz.x * 2.5 - vWorldXz.y * 2.5);
          float foamBand = smoothstep(0.58 - shoreWave * 0.14, 0.92, vShore);
          col = mix(col, uFoamColor, foamBand * 0.68);

          // Crisp HDR specular sun glints for UnrealBloomPass sparkle
          if (uDetail > 0.5) {
            float g1 = sin(pUv.x * 11.3 + uTime * 2.7) * cos(pUv.y * 9.7 - uTime * 2.2);
            float g2 = sin((pUv.x + pUv.y) * 7.5 - uTime * 1.8);
            float sparkle = smoothstep(0.91, 0.995, g1 * 0.65 + g2 * 0.35);
            col += uGlintColor * sparkle * 0.85;
          }

          float alpha = mix(0.84, 0.72, vShore * 0.65);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    });

    disposables.track(geo);
    disposables.track(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3; // DIORAMA_RENDER_ORDER.WATER_SURFACE
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);

    this.mesh = mesh;
    this.material = mat;
  }

  update(dt: number, tier: FxQualityTier): void {
    if (!this.material) return;
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uDetail.value = tier === 'low' ? 0.25 : 1.0;
  }
}
