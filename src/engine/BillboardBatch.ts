import * as THREE from 'three';
import { getPropAtlasDef } from '../data/propAssets.ts';
import { createRng } from '../core/Rng.ts';
import { getTileWorldY } from '../domain/TerrainRules.ts';
import type { MapDef, PropKind } from '../domain/types.ts';
import type { AssetProvider } from '../gfx/AssetProvider.ts';
import { attachCameraOcclusionCutout } from './OcclusionCutout.ts';

const _dummy = new THREE.Object3D();

export interface PropInstancePlacement {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface PropBatchGroup {
  kind: PropKind;
  mesh: THREE.InstancedMesh;
  items: PropInstancePlacement[];
  lastYaw?: number;
}

export function buildEncounterGrassPlacements(map: MapDef): PropInstancePlacement[] {
  const placements: PropInstancePlacement[] = [];
  const rng = createRng(map.decoration.seed ^ 0x54475253);

  for (let z = 0; z < map.grid.length; z++) {
    const row = map.grid[z];
    for (let x = 0; x < row.length; x++) {
      const legend = map.legend[row[x]];
      if (!legend?.encounter || legend.tile !== 'tall_grass') continue;

      placements.push({
        kind: rng.next() < 0.18 ? 'tall_grass_flower' : 'tall_grass_clump',
        x,
        y: getTileWorldY(map, x, z),
        z,
        scale: 0.92 + rng.next() * 0.16,
      });
    }
  }

  return placements;
}

function getPropDimensions(kind: PropKind): [number, number] {
  const atlasDef = getPropAtlasDef(kind);
  if (atlasDef) return [atlasDef.width, atlasDef.height];

  switch (kind) {
    case 'oak':
      return [2.45, 2.2];
    case 'birch':
      return [2.55, 2.3];
    case 'pine':
      return [1.54, 2.85];
    case 'snow_pine':
      return [1.83, 2.8];
    case 'mushroom_tree':
      return [1.88, 1.98];
    case 'mushroom_tree_arcane':
      return [1.85, 1.98];
    case 'cave_entrance':
      return [2.66, 2.0];
    case 'well':
      return [1.16, 1.75];
    case 'pillar':
      return [0.84, 1.9];
    case 'sign':
      return [0.68, 1.1];
    case 'fence':
      return [1.04, 0.78];
    case 'bench':
      return [1.08, 1.04];
    case 'boulder':
      return [1.05, 0.96];
    case 'crystal':
      return [0.65, 1.11];
    case 'flower_patch':
      return [1.05, 0.91];
    case 'mushroom':
      return [0.68, 0.8];
    case 'stump':
      return [0.98, 0.84];
    case 'capsule_pedestal':
      return [0.78, 1.04];
    case 'heal_machine':
      return [0.92, 1.37];
    case 'lamp_post':
      return [0.34, 1.85];
    case 'lamp_wood':
      return [0.57, 1.85];
    case 'lamp_double':
      return [0.68, 1.9];
    case 'lamp_stone':
      return [0.31, 1.85];
    case 'bush':
    case 'bush_arcane':
      return [1.08, 1.0];
    case 'tall_grass_clump':
      return [1.2, 1.0];
    case 'tall_grass_flower':
      return [1.2, 1.05];
    case 'bed':
      return [1.38, 1.25];
    case 'chest':
      return [0.95, 0.92];
    case 'achievements_wall':
      return [1.35, 1.35];
    case 'sofa':
      return [1.45, 1.05];
    case 'dining_table':
      return [1.1, 0.95];
    case 'kitchen_counter':
      return [1.1, 1.02];
    case 'stove':
      return [1.2, 1.32];
    case 'bookshelf':
      return [1.25, 1.55];
    case 'house_plant':
      return [0.85, 1.05];
    case 'stair_up':
    case 'stair_down':
      return [1.0, 1.1];
    case 'forge_hearth':
      return [1.35, 1.48];
    case 'anvil_bench':
      return [1.05, 0.95];
    case 'doll_worktable':
      return [1.32, 1.08];
    case 'mannequin_rack':
      return [1.28, 1.38];
    case 'blueprint_desk':
      return [1.05, 1.02];
    case 'skill_altar':
      return [1.26, 1.38];
    case 'training_dummy':
      return [1.18, 1.35];
    case 'lab_console':
      return [1.22, 1.28];
    default:
      return [0.95, 0.95];
  }
}

const _windTimeUniform = { value: 0 };

const WIND_PROP_AMP: Partial<Record<PropKind, number>> = {
  oak: 0.055,
  birch: 0.055,
  pine: 0.048,
  snow_pine: 0.042,
  mushroom_tree: 0.032,
  mushroom_tree_arcane: 0.032,
  bush: 0.045,
  bush_arcane: 0.045,
  flower_patch: 0.05,
  tall_grass_clump: 0.07,
  tall_grass_flower: 0.07,
};

const SHADOW_CASTER_PROPS: ReadonlySet<PropKind> = new Set([
  'oak',
  'birch',
  'pine',
  'snow_pine',
  'mushroom_tree',
  'mushroom_tree_arcane',
  'boulder',
  'well',
  'pillar',
  'cave_entrance',
  'lamp_post',
  'lamp_wood',
  'lamp_double',
  'lamp_stone',
]);

const OCCLUDABLE_PROPS: ReadonlySet<PropKind> = new Set([
  'oak',
  'birch',
  'pine',
  'snow_pine',
  'mushroom_tree',
  'mushroom_tree_arcane',
  'bush',
  'bush_arcane',
  'boulder',
  'well',
  'pillar',
  'cave_entrance',
  'lamp_post',
  'lamp_wood',
  'lamp_double',
  'lamp_stone',
  'bookshelf',
  'stove',
  'forge_hearth',
  'doll_worktable',
  'mannequin_rack',
  'skill_altar',
  'training_dummy',
  'lab_console',
]);

export function createBottomPivotPlaneGeometry(
  w: number,
  h: number,
  segX = 1,
  segY = 1
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h, segX, segY);
  geo.translate(0, h * 0.5, 0);
  // Upward vertex normals ensure consistent overhead sun/sky lighting across any camera yaw
  const normAttr = geo.attributes.normal;
  if (normAttr) {
    for (let i = 0; i < normAttr.count; i++) {
      normAttr.setXYZ(i, 0, 1, 0);
    }
    normAttr.needsUpdate = true;
  }
  return geo;
}

export function createLitBillboardMaterial(
  tex: THREE.Texture,
  opts: {
    windAmp?: number;
    alphaTest?: number;
    emissiveHex?: number;
    emissiveIntensity?: number;
  } = {}
): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    alphaTest: opts.alphaTest ?? 0.5,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(opts.emissiveHex ?? 0x1c1b24),
    emissiveIntensity: opts.emissiveIntensity ?? 0.52,
  });

  const windAmp = opts.windAmp ?? 0;
  if (windAmp > 0) {
    mat.customProgramCacheKey = () => `hd2d_wind_${windAmp.toFixed(3)}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = _windTimeUniform;
      shader.uniforms.uWindAmp = { value: windAmp };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uWindTime;
           uniform float uWindAmp;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float windBend = pow(clamp(uv.y, 0.0, 1.0), 1.35) * uWindAmp;
           #ifdef USE_INSTANCING
             vec3 windInstPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
             float windPhase = uWindTime * 1.85 + windInstPos.x * 0.48 + windInstPos.z * 0.37;
           #else
             float windPhase = uWindTime * 1.85;
           #endif
           transformed.x += sin(windPhase) * windBend;
           transformed.z += cos(windPhase * 0.72) * windBend * 0.35;`
        );
    };
  }

  return mat;
}

export function buildInstancedPropBatches(
  placements: readonly PropInstancePlacement[],
  assets: AssetProvider
): PropBatchGroup[] {
  const grouped = new Map<PropKind, PropInstancePlacement[]>();
  for (const p of placements) {
    let list = grouped.get(p.kind);
    if (!list) {
      list = [];
      grouped.set(p.kind, list);
    }
    list.push(p);
  }

  const groups: PropBatchGroup[] = [];
  for (const [kind, list] of grouped.entries()) {
    const atlasDef = getPropAtlasDef(kind);
    const [w, h] = getPropDimensions(kind);
    const windAmp = WIND_PROP_AMP[kind] ?? atlasDef?.windAmp ?? 0;
    const geo = createBottomPivotPlaneGeometry(w, h, 1, windAmp > 0 ? 4 : 1);
    const tex = assets.getPropTexture(kind);
    const mat = createLitBillboardMaterial(tex, { windAmp });
    if (OCCLUDABLE_PROPS.has(kind) || atlasDef?.occludable) {
      attachCameraOcclusionCutout(mat, { minRelY: -999 });
    }
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    inst.receiveShadow = true;
    if (SHADOW_CASTER_PROPS.has(kind) || atlasDef?.shadow) {
      inst.castShadow = true;
      inst.customDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: tex,
        alphaTest: 0.5,
      });
    }
    for (let i = 0; i < list.length; i++) {
      _dummy.position.set(list[i].x, list[i].y, list[i].z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(list[i].scale);
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    groups.push({ kind, mesh: inst, items: list });
  }

  return groups;
}

export function updatePropBatchAnimation(
  groups: readonly PropBatchGroup[],
  yaw: number,
  time: number,
  playerX: number,
  playerZ: number
): void {
  _windTimeUniform.value = time;

  for (const g of groups) {
    const atlasDef = getPropAtlasDef(g.kind);
    const isGrass =
      g.kind === 'tall_grass_clump' ||
      g.kind === 'tall_grass_flower' ||
      atlasDef?.grass === true;
    const isFixedDecor =
      g.kind === 'atlas_banco_00' ||
      g.kind === 'atlas_cerca_00' ||
      atlasDef?.category === 'structure' ||
      atlasDef?.category === 'decor';

    if (!isGrass && (isFixedDecor || g.lastYaw === yaw)) {
      continue;
    }

    const items = g.items;
    const inst = g.mesh;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      _dummy.position.set(item.x, item.y, item.z);
      if (isFixedDecor) {
        _dummy.rotation.set(0, 0, 0);
      } else {
        _dummy.rotation.set(0, yaw, 0);
      }

      if (isGrass) {
        const dist = Math.hypot(item.x - playerX, item.z - playerZ);
        const sway =
          dist < 1.3
            ? (Math.sin(time * 16 + i * 1.7) * 0.28 * Math.max(0, 1.3 - dist)) / 1.3
            : Math.sin(time * 2.8 + i * 0.9) * 0.04;
        _dummy.rotation.z = sway;
      }

      _dummy.scale.setScalar(item.scale);
      _dummy.updateMatrix();
      inst.setMatrixAt(i, _dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (!isFixedDecor) {
      g.lastYaw = yaw;
    }
  }
}
