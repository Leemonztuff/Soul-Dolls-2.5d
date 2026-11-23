import * as THREE from 'three';
import { createRng } from '../core/Rng.ts';
import type { FxQualityTier } from '../domain/FxPool.ts';
import { HEIGHT_UNIT } from '../domain/TerrainRules.ts';
import type { BattleBiome, MapDef, PropKind } from '../domain/types.ts';
import type { AssetProvider } from '../gfx/AssetProvider.ts';
import { hexToNumber, PALETTE } from '../gfx/Palette.ts';
import type { TileAtlasKey } from '../gfx/ProceduralTiles.ts';
import { getTileUv } from './AtlasBuilder.ts';
import {
  createBottomPivotPlaneGeometry,
  createLitBillboardMaterial,
} from './BillboardBatch.ts';
import {
  buildCliffOrnamentsMesh,
  createCliffOrnamentMaterial,
  createCliffOrnamentTexture,
} from './CliffOrnamentMesher.ts';
import { DisposableRegistry } from './Disposables.ts';
import {
  buildCloudBillboards,
  createGradientSkyTexture,
  updateCloudBillboards,
  type CloudDriftItem,
} from './SkyBackdrop.ts';
import {
  buildTerrainChunks,
  type TerrainBuildArtifacts,
} from './TerrainMesher.ts';
import { attachTerrainDioramaShader } from './TerrainWeatheringShader.ts';

export const PLAYER_STATION_POS = new THREE.Vector3(-2.15, 0.24, 2.0);
export const ENEMY_STATION_POS = new THREE.Vector3(2.25, 0.5, -2.35);

interface BiomeTheme {
  skyTop: number;
  skyBottom: number;
  fog: number;
  baseTile: string;
  hillTile: string;
  platformTop: TileAtlasKey;
  platformRim: TileAtlasKey;
  farColor: string;
  midColor: string;
  hasClouds: boolean;
  hasSunRays: boolean;
  hasGlowLights: boolean;
  glowColor: string;
  trees: PropKind[];
  shrubs: PropKind[];
  accents: PropKind[];
}

function getBiomeTheme(biome: BattleBiome, isBoss: boolean): BiomeTheme {
  if (isBoss) {
    return {
      skyTop: hexToNumber(PALETTE.driedBlood),
      skyBottom: hexToNumber(PALETTE.oldBronze),
      fog: hexToNumber(PALETTE.rust),
      baseTile: 'A',
      hillTile: '#',
      platformTop: 'arena_floor',
      platformRim: 'roof_orange',
      farColor: PALETTE.driedBlood,
      midColor: PALETTE.bloodMoon,
      hasClouds: true,
      hasSunRays: false,
      hasGlowLights: true,
      glowColor: PALETTE.resonantGold,
      trees: ['pillar', 'mushroom_tree_arcane'],
      shrubs: ['bush_arcane', 'tall_grass_flower'],
      accents: ['lamp_double', 'pillar'],
    };
  }

  switch (biome) {
    case 'forest':
      return {
        skyTop: hexToNumber(PALETTE.oceanicTeal),
        skyBottom: 0x9bd3c8,
        fog: 0x7cb8ad,
        baseTile: '.',
        hillTile: '*',
        platformTop: 'grass',
        platformRim: 'log',
        farColor: PALETTE.darkSlate,
        midColor: PALETTE.forestGreen,
        hasClouds: true,
        hasSunRays: true,
        hasGlowLights: false,
        glowColor: PALETTE.paleGold,
        trees: ['pine', 'oak', 'mushroom_tree', 'mushroom_tree_arcane'],
        shrubs: ['bush', 'bush_arcane', 'tall_grass_clump', 'tall_grass_flower'],
        accents: ['lamp_wood', 'sign'],
      };
    case 'mountain':
      return {
        skyTop: hexToNumber(PALETTE.stoneShadow),
        skyBottom: 0xc2b99b,
        fog: 0x9aa4ab,
        baseTile: ',',
        hillTile: '#',
        platformTop: 'stone',
        platformRim: 'cliff_rock',
        farColor: PALETTE.stoneShadow,
        midColor: PALETTE.stoneMid,
        hasClouds: true,
        hasSunRays: false,
        hasGlowLights: false,
        glowColor: PALETTE.paleGold,
        trees: ['snow_pine', 'pine'],
        shrubs: ['bush', 'tall_grass_clump'],
        accents: ['pillar', 'lamp_stone'],
      };
    case 'cave':
      return {
        skyTop: hexToNumber(PALETTE.abyssInk),
        skyBottom: hexToNumber(PALETTE.nightshade),
        fog: hexToNumber(PALETTE.cryptInk),
        baseTile: 'c',
        hillTile: '#',
        platformTop: 'cave_floor',
        platformRim: 'wall_crypt',
        farColor: PALETTE.abyssInk,
        midColor: PALETTE.nightshade,
        hasClouds: false,
        hasSunRays: false,
        hasGlowLights: true,
        glowColor: PALETTE.soulViolet,
        trees: ['cave_entrance', 'pillar', 'mushroom_tree_arcane'],
        shrubs: ['bush_arcane'],
        accents: ['lamp_stone', 'pillar'],
      };
    case 'arena':
      return {
        skyTop: hexToNumber(PALETTE.deepAmethyst),
        skyBottom: 0xb9914a,
        fog: hexToNumber(PALETTE.oldBronze),
        baseTile: 'A',
        hillTile: '#',
        platformTop: 'arena_floor',
        platformRim: 'palace_tile',
        farColor: PALETTE.nightshade,
        midColor: PALETTE.royalPurple,
        hasClouds: true,
        hasSunRays: false,
        hasGlowLights: true,
        glowColor: PALETTE.resonantGold,
        trees: ['pillar', 'oak'],
        shrubs: ['bush_arcane', 'tall_grass_flower'],
        accents: ['lamp_double', 'pillar'],
      };
    case 'meadow':
    default:
      return {
        skyTop: hexToNumber(PALETTE.oceanicTeal),
        skyBottom: 0xa4d9d0,
        fog: 0x86c4bd,
        baseTile: '.',
        hillTile: '*',
        platformTop: 'grass',
        platformRim: 'wall_fieldstone',
        farColor: PALETTE.stoneShadow,
        midColor: PALETTE.forestGreen,
        hasClouds: true,
        hasSunRays: true,
        hasGlowLights: false,
        glowColor: PALETTE.paleGold,
        trees: ['oak', 'birch', 'pine'],
        shrubs: ['bush', 'tall_grass_flower', 'tall_grass_clump'],
        accents: ['lamp_wood', 'well', 'sign'],
      };
  }
}

function getStagePropDimensions(kind: PropKind): [number, number] {
  switch (kind) {
    case 'oak':
      return [2.5, 2.3];
    case 'birch':
      return [2.55, 2.35];
    case 'pine':
      return [1.7, 3.05];
    case 'snow_pine':
      return [1.9, 2.95];
    case 'mushroom_tree':
    case 'mushroom_tree_arcane':
      return [1.9, 2.05];
    case 'cave_entrance':
      return [2.93, 2.2];
    case 'well':
      return [1.16, 1.75];
    case 'pillar':
      return [0.84, 1.9];
    case 'sign':
      return [0.7, 1.13];
    case 'fence':
      return [1.08, 0.81];
    case 'bench':
      return [1.12, 1.08];
    case 'boulder':
      return [1.12, 1.02];
    case 'crystal':
      return [0.7, 1.2];
    case 'flower_patch':
      return [1.12, 0.97];
    case 'mushroom':
      return [0.72, 0.84];
    case 'stump':
      return [1.05, 0.9];
    case 'lamp_post':
      return [0.38, 1.9];
    case 'lamp_wood':
      return [0.62, 1.9];
    case 'lamp_double':
      return [0.72, 1.95];
    case 'lamp_stone':
      return [0.38, 1.85];
    case 'bush':
    case 'bush_arcane':
      return [1.18, 1.06];
    case 'tall_grass_clump':
      return [1.25, 1.05];
    case 'tall_grass_flower':
      return [1.25, 1.1];
    default:
      return [1.0, 1.0];
  }
}

function computeStageCellHeight(wx: number, wz: number, rngVal: number): number {
  const dPlayer = Math.hypot(wx - PLAYER_STATION_POS.x, wz - PLAYER_STATION_POS.z);
  const dEnemy = Math.hypot(wx - ENEMY_STATION_POS.x, wz - ENEMY_STATION_POS.z);
  const edge = Math.max(Math.abs(wx), Math.abs(wz)) / 12;

  if (dPlayer < 2.6) return 0;
  if (dEnemy < 2.6) return 1;
  if (edge > 0.72) return Math.min(6, Math.round((edge - 0.65) * 14 + rngVal * 1.4));
  if (wz < -4.5) return 1 + Math.round(rngVal * 1.2);
  return 0;
}

function buildStageMapDef(
  biome: BattleBiome,
  theme: BiomeTheme
): { map: MapDef; heightGrid: number[][] } {
  const size = 24;
  const grid: string[] = [];
  const heights: string[] = [];
  const heightGrid: number[][] = [];
  const rng = createRng(biome.length * 911 + 42);

  for (let z = 0; z < size; z++) {
    let gRow = '';
    let hRow = '';
    const hNums: number[] = [];
    for (let x = 0; x < size; x++) {
      const wx = x - 11.5;
      const wz = z - 11.5;
      const h = computeStageCellHeight(wx, wz, rng.next());
      const ch = h >= 3 ? theme.hillTile : theme.baseTile;
      gRow += ch;
      hRow += String(h);
      hNums.push(h);
    }
    grid.push(gRow);
    heights.push(hRow);
    heightGrid.push(hNums);
  }

  return {
    heightGrid,
    map: {
      id: `battle_${biome}`,
      nameKey: `battle_${biome}`,
      biome,
      music: biome === 'cave' ? 'cave' : 'route',
      skyTopColor: theme.skyTop,
      skyBottomColor: theme.skyBottom,
      fogColor: theme.fog,
      snowLine: biome === 'mountain' ? 4 : undefined,
      grid,
      heights,
      legend: {
        '.': { tile: 'grass', solid: false },
        ',': { tile: 'dirt', solid: false },
        '*': { tile: 'flowers', solid: false },
        c: { tile: 'cave_floor', solid: false },
        A: { tile: 'arena_floor', solid: false },
        '#': { tile: 'stone', solid: true },
      },
      buildings: [],
      props: [],
      decoration: {
        seed: 1,
        treeDensity: 0,
        bushDensity: 0,
        flowerDensity: 0,
        rockDensity: 0,
        mushroomDensity: 0,
        treeKinds: [],
      },
      warps: [],
      npcs: [],
      signs: [],
    },
  };
}

function createParallaxStripTexture(
  biome: BattleBiome,
  layer: 'far' | 'mid',
  color: string
): THREE.CanvasTexture {
  const w = 128;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;

  if (biome === 'cave') {
    for (let x = 0; x < w; x += 4) {
      const colH =
        layer === 'far'
          ? 12 + Math.round(Math.sin(x * 0.14) * 6 + Math.cos(x * 0.31) * 4)
          : 10 + Math.round(Math.abs(Math.sin(x * 0.25)) * 14);
      ctx.fillRect(x, h - colH, 4, colH);
    }
  } else if (biome === 'arena') {
    for (let x = 0; x < w; x += 8) {
      const colH = layer === 'far' ? 16 : (x / 8) % 2 === 0 ? 22 : 12;
      ctx.fillRect(x, h - colH, 6, colH);
    }
  } else if (layer === 'far') {
    for (let x = 0; x < w; x++) {
      const ridge =
        10 +
        Math.sin(x * 0.08) * 7 +
        Math.sin(x * 0.21 + 1.1) * 4 +
        (biome === 'mountain' ? Math.abs(Math.sin(x * 0.11)) * 7 : 0);
      const colH = Math.max(4, Math.round(ridge));
      ctx.fillRect(x, h - colH, 1, colH);
    }
  } else {
    for (let x = 0; x < w; x += 3) {
      const treeH = 9 + Math.round(Math.abs(Math.sin(x * 0.33 + 0.7)) * 11);
      ctx.fillRect(x, h - treeH, 3, treeH);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function createBlobShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, 'rgba(11, 8, 14, 0.84)');
  grad.addColorStop(0.55, 'rgba(11, 8, 14, 0.50)');
  grad.addColorStop(1, 'rgba(11, 8, 14, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function createGlowTexture(colorHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
  grad.addColorStop(0, colorHex);
  grad.addColorStop(0.45, colorHex + '88');
  grad.addColorStop(1, 'rgba(11,8,14,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function createSunRayTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(48, 64);
  for (let y = 0; y < 64; y++) {
    const vFade = Math.max(0, 1 - y / 64);
    for (let x = 0; x < 48; x++) {
      const nx = (x - 23.5) / 23.5;
      const hFade = Math.max(0, 1 - nx * nx);
      const a = Math.round(vFade * hFade * hFade * 26); // subtle soft atmospheric shaft (~0.10 max alpha)
      const i = (y * 48 + x) * 4;
      img.data[i] = 252;
      img.data[i + 1] = 238;
      img.data[i + 2] = 196;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function createBossAuraTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(24, 24, 8, 24, 24, 24);
  grad.addColorStop(0, 'rgba(232, 184, 74, 0.16)');
  grad.addColorStop(0.65, 'rgba(194, 35, 75, 0.72)');
  grad.addColorStop(0.88, 'rgba(232, 184, 74, 0.85)');
  grad.addColorStop(1, 'rgba(232, 184, 74, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 48, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildPlatformGeometry(
  cx: number,
  topY: number,
  cz: number,
  radius: number,
  height: number,
  topKey: TileAtlasKey,
  rimKey: TileAtlasKey
): THREE.BufferGeometry {
  const segs = 16;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const topRect = getTileUv(topKey);
  const rimRect = getTileUv(rimKey);
  const botY = topY - height;

  // Top disc
  const centerIdx = 0;
  positions.push(cx, topY, cz);
  uvs.push((topRect.u0 + topRect.u1) * 0.5, (topRect.v0 + topRect.v1) * 0.5);
  colors.push(0.95, 0.95, 0.95);

  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    positions.push(cx + cos * radius, topY, cz + sin * radius);
    uvs.push(
      topRect.u0 + (cos * 0.5 + 0.5) * (topRect.u1 - topRect.u0),
      topRect.v0 + (sin * 0.5 + 0.5) * (topRect.v1 - topRect.v0)
    );
    colors.push(0.88, 0.88, 0.88);
  }
  for (let i = 1; i <= segs; i++) {
    indices.push(centerIdx, i + 1, i);
  }

  // Side rim cylinder
  const baseStart = positions.length / 3;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const u = i % 2 === 0 ? rimRect.u0 : rimRect.u1;
    const shade = 0.72 + 0.22 * (sin * 0.5 + 0.5);

    positions.push(cx + cos * radius, topY, cz + sin * radius);
    uvs.push(u, rimRect.v1);
    colors.push(shade, shade, shade);

    positions.push(cx + cos * (radius + 0.14), botY, cz + sin * (radius + 0.14));
    uvs.push(u, rimRect.v0);
    colors.push(shade * 0.78, shade * 0.78, shade * 0.78);
  }
  for (let i = 0; i < segs; i++) {
    const t0 = baseStart + i * 2;
    const b0 = t0 + 1;
    const t1 = t0 + 2;
    const b1 = t0 + 3;
    indices.push(t0, b0, t1, t1, b0, b1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

interface StagePropMesh {
  mesh: THREE.Mesh;
  tierWeight: number;
}

export class BattleStage {
  private disposables = new DisposableRegistry();
  private clouds: CloudDriftItem[] = [];
  private midLayerMesh: THREE.Mesh | null = null;
  private sunRays: THREE.Mesh[] = [];
  private glowSprites: THREE.Mesh[] = [];
  private perimeterProps: StagePropMesh[] = [];
  private bossAura: THREE.Mesh | null = null;
  private arenaParticles: THREE.Points | null = null;
  private arenaParticleMat: THREE.ShaderMaterial | null = null;
  private sunLight: THREE.DirectionalLight;
  private playerShadow: THREE.Mesh;
  private enemyShadow: THREE.Mesh;
  private time = 0;
  private qualityTier: FxQualityTier = 'high';
  private shadowsEnabled = true;
  private ambientParticlesEnabled = true;
  private isCave = false;

  constructor(
    scene: THREE.Scene,
    assets: AssetProvider,
    biome: BattleBiome,
    isBoss: boolean
  ) {
    const theme = getBiomeTheme(biome, isBoss);

    // Sky gradient + balanced atmospheric fog (keeps SoulDolls crisp & contrasty)
    const skyTex = createGradientSkyTexture(theme.skyTop, theme.skyBottom);
    this.disposables.track(skyTex);
    scene.background = skyTex;
    scene.fog = new THREE.Fog(theme.fog, 16, 36);

    const isCave = biome === 'cave';
    this.isCave = isCave;
    const hemiLight = new THREE.HemisphereLight(
      isCave ? 0xd9c8ff : 0xfff8eb,
      isCave ? 0x6f5894 : 0xa39c8e,
      isCave ? 1.85 : 2.05
    );
    scene.add(hemiLight);
    this.disposables.track(hemiLight);

    const sunLight = new THREE.DirectionalLight(
      isCave ? 0xffe0b8 : 0xfff7e6,
      isCave ? 1.35 : 1.55
    );
    sunLight.position.set(4.5, 8.2, 3.5);
    sunLight.castShadow = !isCave;
    if (sunLight.castShadow) {
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 1;
      sunLight.shadow.camera.far = 32;
      const d = 10.5;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      sunLight.shadow.bias = -0.0008;
      sunLight.shadow.normalBias = 0.03;
    }
    scene.add(sunLight);
    this.disposables.track(sunLight);
    this.sunLight = sunLight;

    // 24x24 heightfield terrain patch with normal mapping + diorama weathering/P3 blending shader
    const terrainAtlasTex = assets.getTileAtlasTexture();
    const terrainNormalTex = assets.getTileAtlasNormalTexture();
    const atlasMat = new THREE.MeshStandardMaterial({
      map: terrainAtlasTex,
      normalMap: terrainNormalTex,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.92,
      metalness: 0.03,
      vertexColors: true,
    });
    const grassMat = new THREE.MeshStandardMaterial({
      map: assets.getGrassTexture(),
      normalMap: assets.getGrassNormalTexture(),
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.95,
      metalness: 0.0,
      vertexColors: true,
    });
    attachTerrainDioramaShader(atlasMat, biome, {
      terrainAtlas: terrainAtlasTex,
      terrainNormalAtlas: terrainNormalTex,
    });
    attachTerrainDioramaShader(grassMat, biome, {
      terrainAtlas: terrainAtlasTex,
      terrainNormalAtlas: terrainNormalTex,
    });
    this.disposables.track(atlasMat);
    this.disposables.track(grassMat);

    const { map: stageMap, heightGrid } = buildStageMapDef(biome, theme);
    const stageArtifacts: Partial<TerrainBuildArtifacts> = {};
    const chunks = buildTerrainChunks(stageMap, atlasMat, grassMat, {
      artifactsOut: stageArtifacts,
    });
    for (const c of chunks) {
      c.mesh.matrixAutoUpdate = true;
      c.mesh.position.set(-11.5, -0.05, -11.5);
      c.mesh.updateMatrix();
      scene.add(c.mesh);
      this.disposables.track(c.mesh.geometry);
    }

    const cliffOrnTex = createCliffOrnamentTexture();
    const cliffOrnMat = createCliffOrnamentMaterial(cliffOrnTex);
    this.disposables.track(cliffOrnTex);
    this.disposables.track(cliffOrnMat);
    const cliffOrnGroup = buildCliffOrnamentsMesh(stageMap, cliffOrnMat, {
      contourAnalysis: stageArtifacts.contourAnalysis,
      anchors: stageArtifacts.ornamentAnchors,
    });
    if (cliffOrnGroup) {
      cliffOrnGroup.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          this.disposables.track(m.geometry);
        }
      });
      cliffOrnGroup.matrixAutoUpdate = true;
      cliffOrnGroup.position.set(-11.5, -0.05, -11.5);
      cliffOrnGroup.updateMatrix();
      scene.add(cliffOrnGroup);
    }

    // Two circular raised platforms seated firmly into their surrounding terrain terraces
    const pGeo = buildPlatformGeometry(
      PLAYER_STATION_POS.x,
      PLAYER_STATION_POS.y,
      PLAYER_STATION_POS.z,
      1.88,
      0.38,
      theme.platformTop,
      theme.platformRim
    );
    const eGeo = buildPlatformGeometry(
      ENEMY_STATION_POS.x,
      ENEMY_STATION_POS.y,
      ENEMY_STATION_POS.z,
      1.72,
      0.6,
      theme.platformTop,
      theme.platformRim
    );
    const pMesh = new THREE.Mesh(pGeo, atlasMat);
    const eMesh = new THREE.Mesh(eGeo, atlasMat);
    pMesh.castShadow = true;
    pMesh.receiveShadow = true;
    eMesh.castShadow = true;
    eMesh.receiveShadow = true;
    scene.add(pMesh, eMesh);
    this.disposables.track(pGeo);
    this.disposables.track(eGeo);

    // Lush surrounding biome vegetation & props framing the arena
    this.buildBiomePerimeterProps(scene, assets, biome, theme, heightGrid);

    // 2 Parallax silhouette billboard layers
    const farTex = createParallaxStripTexture(biome, 'far', theme.farColor);
    const farGeo = new THREE.PlaneGeometry(36, 8.5);
    const farMat = new THREE.MeshBasicMaterial({
      map: farTex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    const farMesh = new THREE.Mesh(farGeo, farMat);
    farMesh.position.set(0, 3.1, -14.5);
    scene.add(farMesh);
    this.disposables.track(farTex);
    this.disposables.track(farGeo);
    this.disposables.track(farMat);

    const midTex = createParallaxStripTexture(biome, 'mid', theme.midColor);
    const midGeo = new THREE.PlaneGeometry(28, 5.2);
    const midMat = new THREE.MeshBasicMaterial({
      map: midTex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    this.midLayerMesh = new THREE.Mesh(midGeo, midMat);
    this.midLayerMesh.position.set(0.5, 1.8, -10.8);
    scene.add(this.midLayerMesh);
    this.disposables.track(midTex);
    this.disposables.track(midGeo);
    this.disposables.track(midMat);

    // Moving clouds (outdoor biomes)
    if (theme.hasClouds) {
      this.clouds = buildCloudBillboards(scene, this.disposables, 0, -9, 15, 5, 331, 7.8);
    }

    // Subtle atmospheric sun-ray shafts (gentle soft alpha so they never wash out SoulDolls)
    if (theme.hasSunRays) {
      const rayTex = createSunRayTexture();
      const rayGeo = new THREE.PlaneGeometry(2.6, 8.2);
      const rayMat = new THREE.MeshBasicMaterial({
        map: rayTex,
        color: new THREE.Color(1.22, 1.15, 0.96),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      this.disposables.track(rayTex);
      this.disposables.track(rayGeo);
      this.disposables.track(rayMat);

      for (const rx of [-4.6, 5.4]) {
        const ray = new THREE.Mesh(rayGeo, rayMat);
        ray.position.set(rx, 4.4, -7.2);
        ray.rotation.z = -0.26;
        ray.userData.baseX = rx;
        scene.add(ray);
        this.sunRays.push(ray);
      }
    }

    // Glow sprites (cave crystals / arena torches) with HDR bloom boost
    if (theme.hasGlowLights) {
      const glowTex = createGlowTexture(theme.glowColor);
      const glowGeo = new THREE.PlaneGeometry(1.4, 1.4);
      const glowMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        color: new THREE.Color(1.5, 1.42, 1.35),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      this.disposables.track(glowTex);
      this.disposables.track(glowGeo);
      this.disposables.track(glowMat);

      const positions: Array<[number, number, number]> = [
        [-4.6, 1.5, -3.5],
        [5.2, 1.9, -5.0],
        [-0.4, 1.6, -6.5],
      ];
      for (const [gx, gy, gz] of positions) {
        const sp = new THREE.Mesh(glowGeo, glowMat);
        sp.position.set(gx, gy, gz);
        scene.add(sp);
        this.glowSprites.push(sp);
      }
    }

    // Boss pulsing HDR aura on enemy platform
    if (isBoss) {
      const auraTex = createBossAuraTexture();
      const auraGeo = new THREE.PlaneGeometry(3.2, 3.2);
      auraGeo.rotateX(-Math.PI / 2);
      const auraMat = new THREE.MeshBasicMaterial({
        map: auraTex,
        color: new THREE.Color(1.55, 1.25, 1.15),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      this.bossAura = new THREE.Mesh(auraGeo, auraMat);
      this.bossAura.position.set(
        ENEMY_STATION_POS.x,
        ENEMY_STATION_POS.y + 0.03,
        ENEMY_STATION_POS.z
      );
      scene.add(this.bossAura);
      this.disposables.track(auraTex);
      this.disposables.track(auraGeo);
      this.disposables.track(auraMat);
    }

    this.buildArenaParticles(scene, biome, isBoss);

    // Soft procedural contact shadows flush on top of each station platform beneath the feet
    const shadowTex = createBlobShadowTexture();
    const playerShadowGeo = new THREE.PlaneGeometry(1.88, 1.2);
    playerShadowGeo.rotateX(-Math.PI / 2);
    const enemyShadowGeo = new THREE.PlaneGeometry(1.62, 1.12);
    enemyShadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    this.disposables.track(shadowTex);
    this.disposables.track(playerShadowGeo);
    this.disposables.track(enemyShadowGeo);
    this.disposables.track(shadowMat);

    this.playerShadow = new THREE.Mesh(playerShadowGeo, shadowMat);
    this.playerShadow.position.set(
      PLAYER_STATION_POS.x,
      PLAYER_STATION_POS.y + 0.008,
      PLAYER_STATION_POS.z
    );
    this.enemyShadow = new THREE.Mesh(enemyShadowGeo, shadowMat);
    this.enemyShadow.position.set(
      ENEMY_STATION_POS.x,
      ENEMY_STATION_POS.y + 0.008,
      ENEMY_STATION_POS.z - 0.06
    );
    scene.add(this.playerShadow, this.enemyShadow);
  }

  private buildBiomePerimeterProps(
    scene: THREE.Scene,
    assets: AssetProvider,
    biome: BattleBiome,
    theme: BiomeTheme,
    heightGrid: number[][]
  ): void {
    const rng = createRng(biome.length * 1337 + 77);
    const matCache = new Map<PropKind, THREE.MeshLambertMaterial>();
    const depthMatCache = new Map<PropKind, THREE.MeshDepthMaterial>();
    const geoCache = new Map<PropKind, THREE.PlaneGeometry>();

    const shadowKinds = new Set<PropKind>([
      'oak',
      'birch',
      'pine',
      'snow_pine',
      'mushroom_tree',
      'mushroom_tree_arcane',
      'pillar',
      'well',
      'cave_entrance',
      'boulder',
    ]);
    const windKinds = new Set<PropKind>([
      'oak',
      'birch',
      'pine',
      'snow_pine',
      'mushroom_tree',
      'mushroom_tree_arcane',
      'bush',
      'bush_arcane',
      'tall_grass_clump',
      'tall_grass_flower',
    ]);

    const getPropMat = (kind: PropKind): THREE.MeshLambertMaterial => {
      let mat = matCache.get(kind);
      if (!mat) {
        mat = createLitBillboardMaterial(assets.getPropTexture(kind), {
          alphaTest: 0.45,
          windAmp: windKinds.has(kind) ? 0.045 : 0,
        });
        matCache.set(kind, mat);
        this.disposables.track(mat);
      }
      return mat;
    };

    const getPropDepthMat = (kind: PropKind): THREE.MeshDepthMaterial | null => {
      if (!shadowKinds.has(kind)) return null;
      let dm = depthMatCache.get(kind);
      if (!dm) {
        dm = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          map: assets.getPropTexture(kind),
          alphaTest: 0.45,
        });
        depthMatCache.set(kind, dm);
        this.disposables.track(dm);
      }
      return dm;
    };

    const getPropGeo = (kind: PropKind): THREE.PlaneGeometry => {
      let geo = geoCache.get(kind);
      if (!geo) {
        const [w, h] = getStagePropDimensions(kind);
        geo = createBottomPivotPlaneGeometry(w, h, 1, windKinds.has(kind) ? 4 : 1);
        geoCache.set(kind, geo);
        this.disposables.track(geo);
      }
      return geo;
    };

    const sampleY = (wx: number, wz: number): number => {
      const gx = Math.max(0, Math.min(23, Math.round(wx + 11.5)));
      const gz = Math.max(0, Math.min(23, Math.round(wz + 11.5)));
      return (heightGrid[gz]?.[gx] ?? 0) * HEIGHT_UNIT - 0.06;
    };

    const canPlace = (wx: number, wz: number): boolean => {
      const dPlayer = Math.hypot(wx - PLAYER_STATION_POS.x, wz - PLAYER_STATION_POS.z);
      const dEnemy = Math.hypot(wx - ENEMY_STATION_POS.x, wz - ENEMY_STATION_POS.z);
      if (dPlayer < 2.65 || dEnemy < 2.65) return false;
      // Keep camera sightline corridor clear (camera at -4.1, 5.85 -> battle center)
      if (wx > -5.4 && wx < -0.5 && wz > 1.2 && wz < 7.2) return false;
      // Keep direct center battle line clear
      if (Math.abs(wx) < 2.4 && Math.abs(wz) < 2.2) return false;
      return true;
    };

    const spawnProp = (
      kind: PropKind,
      wx: number,
      wz: number,
      scale: number,
      tierWeight: number
    ) => {
      if (!canPlace(wx, wz)) return;
      const mesh = new THREE.Mesh(getPropGeo(kind), getPropMat(kind));
      const depthMat = getPropDepthMat(kind);
      if (depthMat) {
        mesh.castShadow = true;
        mesh.customDepthMaterial = depthMat;
      }
      mesh.receiveShadow = true;
      mesh.position.set(wx, sampleY(wx, wz), wz);
      mesh.scale.setScalar(scale);
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.perimeterProps.push({ mesh, tierWeight });
    };

    // Outer canopy ring: trees / cave arches / arena pillars framing the horizon & flanks
    const treeRing: Array<[number, number]> = [
      [-6.8, -5.8],
      [-4.2, -7.2],
      [-1.4, -7.8],
      [1.6, -7.9],
      [4.5, -7.3],
      [7.1, -6.0],
      [8.2, -3.2],
      [7.6, -0.2],
      [6.4, 2.8],
      [-7.2, -2.6],
      [-7.0, 0.8],
      [-5.6, -8.8],
      [-0.4, -9.2],
      [5.4, -8.9],
      [-8.4, -4.4],
      [8.6, -5.2],
    ];
    for (let i = 0; i < treeRing.length; i++) {
      const [bx, bz] = treeRing[i];
      const wx = bx + (rng.next() - 0.5) * 0.65;
      const wz = bz + (rng.next() - 0.5) * 0.65;
      const kind = theme.trees[i % theme.trees.length];
      const scale = 0.88 + rng.next() * 0.34;
      spawnProp(kind, wx, wz, scale, i < 10 ? 0 : 2);
    }

    // Mid-ring shrubs, tall grass clumps, and flower patches framing platforms
    const shrubCoords: Array<[number, number]> = [
      [-4.6, -3.4],
      [-2.8, -4.6],
      [-0.5, -5.2],
      [2.8, -5.4],
      [5.2, -4.0],
      [5.5, -1.2],
      [4.6, 1.5],
      [1.8, 3.2],
      [-4.8, 0.2],
      [-4.5, 2.8],
      [-1.2, 4.2],
      [3.8, -6.4],
      [-3.6, -6.2],
      [0.4, -6.8],
      [6.2, -2.4],
      [-6.0, -1.2],
    ];
    for (let i = 0; i < shrubCoords.length; i++) {
      const [bx, bz] = shrubCoords[i];
      const wx = bx + (rng.next() - 0.5) * 0.55;
      const wz = bz + (rng.next() - 0.5) * 0.55;
      const kind = theme.shrubs[i % theme.shrubs.length];
      const scale = 0.85 + rng.next() * 0.32;
      spawnProp(kind, wx, wz, scale, i % 2 === 0 ? 1 : 2);
    }

    // Storytelling biome accents (lanterns, pillars, wells, signs) flanking platforms
    const accentCoords: Array<[number, number]> = [
      [-4.1, -1.6],
      [4.7, -3.1],
      [0.9, -4.4],
      [3.6, 1.6],
    ];
    for (let i = 0; i < accentCoords.length; i++) {
      const [wx, wz] = accentCoords[i];
      const kind = theme.accents[i % theme.accents.length];
      spawnProp(kind, wx, wz, 0.95, i < 2 ? 0 : 1);
    }
  }

  private buildArenaParticles(
    scene: THREE.Scene,
    biome: BattleBiome,
    isBoss: boolean
  ): void {
    const count = 48;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    const colorA = isBoss
      ? new THREE.Color(1.65, 0.95, 0.42)
      : biome === 'cave'
        ? new THREE.Color(0.8, 1.35, 1.65)
        : biome === 'forest'
          ? new THREE.Color(1.4, 1.35, 0.55)
          : biome === 'mountain' || biome === 'snow'
            ? new THREE.Color(1.08, 1.15, 1.28)
            : new THREE.Color(1.32, 1.24, 0.78);
    const colorB = isBoss
      ? new THREE.Color(1.55, 0.42, 0.58)
      : biome === 'cave'
        ? new THREE.Color(1.32, 0.72, 1.6)
        : new THREE.Color(1.05, 1.32, 0.96);

    for (let i = 0; i < count; i++) {
      const h1 = Math.sin(i * 19.31 + 2.1) * 31415.92;
      const h2 = Math.sin(i * 73.17 + 5.7) * 27182.81;
      const h3 = Math.sin(i * 41.89 + 8.3) * 16180.34;
      positions[i * 3] = (h1 - Math.floor(h1) - 0.5) * 13;
      positions[i * 3 + 1] = (h2 - Math.floor(h2)) * 4.4 + 0.3;
      positions[i * 3 + 2] = (h3 - Math.floor(h3) - 0.5) * 12;
      const c = i % 2 === 0 ? colorA : colorB;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      phases[i] = (i * 0.87) % (Math.PI * 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.78 },
        uDriftY: { value: isBoss || biome === 'arena' || biome === 'cave' ? 0.35 : 0.1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aPhase;
        uniform float uTime;
        uniform float uDriftY;
        varying vec3 vColor;
        varying float vPulse;
        void main() {
          vColor = color;
          vec3 p = position;
          p.x += sin(uTime * 0.85 + aPhase) * 0.45;
          p.y = mod(p.y + uTime * uDriftY, 4.8) + 0.2;
          p.z += cos(uTime * 0.7 + aPhase * 1.2) * 0.35;
          vPulse = 0.55 + 0.45 * sin(uTime * 2.8 + aPhase * 2.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(18.0 / max(1.5, -mv.z), 2.0, 9.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vPulse;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a = smoothstep(1.0, 0.12, d) * vPulse * uOpacity;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.disposables.track(geo);
    this.disposables.track(mat);

    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 3;
    scene.add(pts);
    this.arenaParticles = pts;
    this.arenaParticleMat = mat;
  }

  setQualityTier(tier: FxQualityTier): void {
    if (this.qualityTier === tier) return;
    this.qualityTier = tier;
    this.syncVisualState();
  }

  setShadowsEnabled(enabled: boolean): void {
    if (this.shadowsEnabled === enabled) return;
    this.shadowsEnabled = enabled;
    this.syncVisualState();
  }

  setAmbientParticlesEnabled(enabled: boolean): void {
    if (this.ambientParticlesEnabled === enabled) return;
    this.ambientParticlesEnabled = enabled;
    this.syncVisualState();
  }

  private syncVisualState(): void {
    const tier = this.qualityTier;
    this.sunLight.castShadow = !this.isCave && this.shadowsEnabled && tier !== 'low';
    if (this.midLayerMesh) {
      this.midLayerMesh.visible = tier !== 'low';
    }
    for (let i = 0; i < this.clouds.length; i++) {
      this.clouds[i].mesh.visible =
        tier === 'high' ? true : tier === 'medium' ? i % 2 === 0 : false;
    }
    for (let i = 0; i < this.sunRays.length; i++) {
      this.sunRays[i].visible = tier !== 'low' && this.ambientParticlesEnabled;
    }
    if (this.arenaParticles && this.arenaParticleMat) {
      this.arenaParticles.visible = tier !== 'low' && this.ambientParticlesEnabled;
      this.arenaParticleMat.uniforms.uOpacity.value = tier === 'high' ? 0.78 : 0.45;
    }
    const maxWeight = tier === 'high' ? 2 : tier === 'medium' ? 1 : 0;
    for (let i = 0; i < this.perimeterProps.length; i++) {
      this.perimeterProps[i].mesh.visible = this.perimeterProps[i].tierWeight <= maxWeight;
    }
  }

  setShadowScale(side: 'player' | 'enemy', scale: number, visible: boolean): void {
    const mesh = side === 'player' ? this.playerShadow : this.enemyShadow;
    mesh.visible = visible;
    mesh.scale.setScalar(Math.max(0.1, scale));
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.time += dt;

    if (this.clouds.length > 0 && this.qualityTier !== 'low') {
      updateCloudBillboards(this.clouds, 0, dt);
    }

    for (let i = 0; i < this.sunRays.length; i++) {
      const ray = this.sunRays[i];
      const baseX = (ray.userData.baseX as number | undefined) ?? ray.position.x;
      ray.position.x = baseX + Math.sin(this.time * 0.35 + i * 1.6) * 0.18;
    }

    for (let i = 0; i < this.glowSprites.length; i++) {
      const g = this.glowSprites[i];
      const pulse = 0.88 + Math.sin(this.time * 4.5 + i * 1.7) * 0.14;
      g.scale.setScalar(pulse);
      g.lookAt(cameraPos);
    }

    for (let i = 0; i < this.perimeterProps.length; i++) {
      const p = this.perimeterProps[i].mesh;
      if (p.visible) {
        p.lookAt(cameraPos.x, p.position.y, cameraPos.z);
      }
    }

    if (this.bossAura) {
      const s = 0.94 + Math.sin(this.time * 3.8) * 0.1;
      this.bossAura.scale.set(s, 1, s);
    }

    if (this.arenaParticleMat && this.arenaParticles?.visible) {
      this.arenaParticleMat.uniforms.uTime.value = this.time;
    }
  }

  dispose(): void {
    this.sunLight.shadow.map?.dispose();
    this.disposables.disposeAll();
  }
}
