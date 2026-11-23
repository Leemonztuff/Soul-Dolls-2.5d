import * as THREE from 'three';
import { getTileHeightLevel, HEIGHT_UNIT } from '../domain/TerrainRules.ts';
import type { MapDef } from '../domain/types.ts';
import type { TileAtlasKey } from '../gfx/ProceduralTiles.ts';
import { getTileUv } from './AtlasBuilder.ts';
import {
  DIORAMA_RENDER_ORDER,
  type CliffBoundary,
  type CliffDirection,
} from './DioramaLayers.ts';
import {
  appendTileRockyCliffs,
  RockyCliffBuildContext,
  type CliffOrnamentAnchor,
  type RockyCliffChunkBuffers,
} from './RockyCliffMesher.ts';
import {
  getCanonicalPairSign,
  getSurfaceTransitionRule,
  planSurfaceTransitions,
  type SurfaceTransitionPlan,
} from './SurfaceTransitionPlanner.ts';
import {
  analyzeTerrainContours,
  type TerrainContourAnalysis,
} from './TerrainContourAnalyzer.ts';
import { resolveTerrainTileKey } from './TerrainSurfaceResolver.ts';

export const CHUNK_SIZE = 16;
const WATER_BED_OFFSET = 0.16;
const MAX_CLIFF_BAND_HEIGHT = 1.0;

/**
 * Simetría exacta de lecho costero por esquina compartida entre hasta 4 tiles de agua:
 * evalúa los 3 tiles adyacentes a la esquina `(x+dx, z)`, `(x, z+dz)` y `(x+dx, z+dz)`
 * (todos los tiles water que comparten ese vértice inspeccionan exactamente la misma cruz
 * de 4 celdas, eliminando escalones verticales en esquinas interiores en L).
 */
function shoreFactorAt(
  map: MapDef,
  x: number,
  z: number,
  dx: number,
  dz: number
): number {
  const isNonWater = (tx: number, tz: number): boolean => {
    const ch = map.grid[tz]?.[tx];
    const leg = ch ? map.legend[ch] : undefined;
    return Boolean(leg && leg.tile !== 'water');
  };

  const nonWaterCount =
    Number(isNonWater(x + dx, z)) +
    Number(isNonWater(x, z + dz)) +
    Number(isNonWater(x + dx, z + dz));

  return nonWaterCount / 3;
}

export interface TerrainChunk {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  boundingBox: THREE.Box3;
  mesh: THREE.Mesh;
  waterUvIndices: number[];
}

export interface TerrainBuildArtifacts {
  contourAnalysis: TerrainContourAnalysis | null;
  transitionPlan: SurfaceTransitionPlan;
  ornamentAnchors: CliffOrnamentAnchor[];
}

export interface BuildTerrainChunksOptions {
  /** Use organic plateau contours when true (defaults to !map.isInterior) */
  organic?: boolean;
  /** Optional output container populated with shared contour, transition, and cliff ornament data */
  artifactsOut?: Partial<TerrainBuildArtifacts>;
  /** Optional precomputed contours/transitions to skip full-map reanalysis during localized rebuilds */
  precomputed?: {
    contourAnalysis?: TerrainContourAnalysis | null;
    transitionPlan?: SurfaceTransitionPlan;
  };
  /** Optional list of `"cx,cz"` chunk keys to build incrementally */
  chunkKeys?: readonly string[];
}

export { resolveTerrainTileKey } from './TerrainSurfaceResolver.ts';

export function resolveCliffWallTileKey(
  map: MapDef,
  _x: number,
  _z: number,
  topTile: TileAtlasKey,
  dropLevels: number
): TileAtlasKey {
  if (map.biome === 'cave' || map.music === 'cave' || map.id === 'cueva_eco') {
    return 'cracked_stone';
  }
  if (map.biome === 'forest' && dropLevels === 1 && (topTile === 'grass' || topTile === 'stone')) {
    return 'mossy_stone';
  }
  if (topTile === 'dirt' || topTile === 'sand') {
    return 'dirt';
  }
  return 'cliff_rock';
}

const CARDINAL_CLIFF_NEIGHBORS: ReadonlyArray<{
  dx: number;
  dz: number;
  face: CliffDirection;
}> = [
  { dx: 0, dz: -1, face: 'north' },
  { dx: 0, dz: 1, face: 'south' },
  { dx: -1, dz: 0, face: 'west' },
  { dx: 1, dz: 0, face: 'east' },
];

export function detectCliffBoundaries(map: MapDef): CliffBoundary[] {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  const boundaries: CliffBoundary[] = [];

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const hC = getTileHeightLevel(map, x, z);
      const topTile = resolveTerrainTileKey(map, x, z);

      for (const n of CARDINAL_CLIFF_NEIGHBORS) {
        const nx = x + n.dx;
        const nz = z + n.dz;
        if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;

        const hN = getTileHeightLevel(map, nx, nz);
        if (hC <= hN) continue;

        const nTile = resolveTerrainTileKey(map, nx, nz);
        const yTop = hC * HEIGHT_UNIT;
        const yBottom =
          nTile === 'water' ? hN * HEIGHT_UNIT - WATER_BED_OFFSET : hN * HEIGHT_UNIT;
        const cliffTile = resolveCliffWallTileKey(map, x, z, topTile, hC - hN);

        boundaries.push({
          x,
          z,
          nx,
          nz,
          face: n.face,
          topLevel: hC,
          bottomLevel: hN,
          yTop,
          yBottom,
          topTile,
          cliffTile,
        });
      }
    }
  }

  return boundaries;
}

function getStairTileBaseY(map: MapDef, x: number, z: number, tileLevel: number): number {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  let minLevel = tileLevel;
  for (const n of CARDINAL_CLIFF_NEIGHBORS) {
    const nx = x + n.dx;
    const nz = z + n.dz;
    if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
    minLevel = Math.min(minLevel, getTileHeightLevel(map, nx, nz));
  }
  return minLevel * HEIGHT_UNIT;
}

function pushQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  colors: number[],
  cliffMeta: number[],
  surfaceBlends: number[],
  targetIndices: number[],
  verts: readonly [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ],
  normal: readonly [number, number, number],
  uvCoords: readonly [number, number, number, number, number, number, number, number],
  shades: readonly [number, number, number, number],
  metas: readonly [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ]
): number {
  const vertBase = positions.length / 3;
  for (let i = 0; i < 4; i++) {
    positions.push(verts[i][0], verts[i][1], verts[i][2]);
    normals.push(normal[0], normal[1], normal[2]);
    uvs.push(uvCoords[i * 2], uvCoords[i * 2 + 1]);
    const s = shades[i];
    colors.push(s, s, s);
    cliffMeta.push(metas[i][0], metas[i][1], metas[i][2]);
    surfaceBlends.push(0, 0, 0, 0);
  }
  targetIndices.push(
    vertBase,
    vertBase + 1,
    vertBase + 2,
    vertBase,
    vertBase + 2,
    vertBase + 3
  );
  return vertBase;
}

function pushTriangle(
  positions: number[],
  normals: number[],
  uvs: number[],
  colors: number[],
  cliffMeta: number[],
  surfaceBlends: number[],
  targetIndices: number[],
  verts: readonly [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ],
  normal: readonly [number, number, number],
  uvCoords: readonly [number, number, number, number, number, number],
  shades: readonly [number, number, number],
  metas: readonly [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ]
): number {
  const vertBase = positions.length / 3;
  for (let i = 0; i < 3; i++) {
    positions.push(verts[i][0], verts[i][1], verts[i][2]);
    normals.push(normal[0], normal[1], normal[2]);
    uvs.push(uvCoords[i * 2], uvCoords[i * 2 + 1]);
    const s = shades[i];
    colors.push(s, s, s);
    cliffMeta.push(metas[i][0], metas[i][1], metas[i][2]);
    surfaceBlends.push(0, 0, 0, 0);
  }
  targetIndices.push(vertBase, vertBase + 1, vertBase + 2);
  return vertBase;
}

type TileUvRect = ReturnType<typeof getTileUv>;

function sampleLocalTileUv(
  px: number,
  pz: number,
  tileX: number,
  tileZ: number,
  useCustomGrass: boolean,
  rect: TileUvRect | null
): [number, number] {
  const fx = Math.max(0, Math.min(1, px - (tileX - 0.5)));
  const fz = Math.max(0, Math.min(1, pz - (tileZ - 0.5)));
  if (useCustomGrass || !rect) {
    const gu0 = (tileX % 2) * 0.5;
    const gv1 = 1 - (tileZ % 2) * 0.5;
    const gv0 = gv1 - 0.5;
    return [gu0 + fx * 0.5, gv0 + (1 - fz) * 0.5];
  }
  return [
    rect.u0 + fx * (rect.u1 - rect.u0),
    rect.v0 + (1 - fz) * (rect.v1 - rect.v0),
  ];
}

const FACE_SHADE: Record<CliffDirection, number> = {
  south: 0.96,
  east: 0.91,
  west: 0.83,
  north: 0.77,
};

const FACE_NORMAL: Record<CliffDirection, readonly [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

function buildVertexHeightGrid(map: MapDef): Float32Array {
  const h = map.grid.length;
  const w = map.grid[0]?.length ?? 0;
  const cols = w + 1;
  const rows = h + 1;
  const grid = new Float32Array(cols * rows);

  for (let vz = 0; vz < rows; vz++) {
    for (let vx = 0; vx < cols; vx++) {
      let sum = 0;
      let count = 0;
      let hasWater = false;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = vx + dx;
          const tz = vz + dz;
          if (tx >= 0 && tx < w && tz >= 0 && tz < h) {
            const ch = map.grid[tz][tx];
            if (map.legend[ch]?.tile === 'water') hasWater = true;
            sum += getTileHeightLevel(map, tx, tz);
            count++;
          }
        }
      }
      const avg = count > 0 ? sum / count : 0;
      grid[vz * cols + vx] = hasWater
        ? Math.min(avg, getTileHeightLevel(map, Math.min(w - 1, vx), Math.min(h - 1, vz)))
        : avg;
    }
  }
  return grid;
}

export function buildTerrainChunks(
  map: MapDef,
  material: THREE.Material,
  grassMaterial?: THREE.Material,
  options?: BuildTerrainChunksOptions
): TerrainChunk[] {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  const chunksX = Math.ceil(width / CHUNK_SIZE);
  const chunksZ = Math.ceil(height / CHUNK_SIZE);
  const chunks: TerrainChunk[] = [];
  const organic = options?.organic ?? !map.isInterior;

  const contourAnalysis =
    options?.precomputed && 'contourAnalysis' in options.precomputed
      ? (options.precomputed.contourAnalysis ?? null)
      : organic
        ? analyzeTerrainContours(map)
        : null;
  const transitionPlan =
    options?.precomputed?.transitionPlan ?? planSurfaceTransitions(map, contourAnalysis);
  const rockyCliffCtx = contourAnalysis ? new RockyCliffBuildContext(map, contourAnalysis) : null;
  const collectOrnaments = Boolean(options?.artifactsOut && !map.isInterior);
  const ornamentAnchors: CliffOrnamentAnchor[] = [];
  const chunkKeySet = options?.chunkKeys ? new Set(options.chunkKeys) : null;
  const allBoundaries = organic ? [] : detectCliffBoundaries(map);
  const boundariesByChunk = new Map<string, CliffBoundary[]>();
  for (const b of allBoundaries) {
    const cx = Math.floor(b.x / CHUNK_SIZE);
    const cz = Math.floor(b.z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let list = boundariesByChunk.get(key);
    if (!list) {
      list = [];
      boundariesByChunk.set(key, list);
    }
    list.push(b);
  }

  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      if (chunkKeySet && !chunkKeySet.has(`${cx},${cz}`)) continue;
      const startX = cx * CHUNK_SIZE;
      const startZ = cz * CHUNK_SIZE;
      const endX = Math.min(width, startX + CHUNK_SIZE);
      const endZ = Math.min(height, startZ + CHUNK_SIZE);

      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const colors: number[] = [];
      const cliffMeta: number[] = [];
      const surfaceBlends: number[] = [];
      const atlasIndices: number[] = [];
      const grassIndices: number[] = [];
      const waterUvIndices: number[] = [];
      const chunkCliffBuffers: RockyCliffChunkBuffers = {
        positions,
        normals,
        uvs,
        colors,
        cliffMeta,
        surfaceBlends,
        atlasIndices,
      };

      // 1. Plateau top tiles (flat square for plain interiors, organic polygon fan on borders/corners/surface transitions)
      for (let z = startZ; z < endZ; z++) {
        const row = map.grid[z];
        for (let x = startX; x < endX; x++) {
          const ch = row[x] ?? '.';
          const legend = map.legend[ch] ?? { tile: 'grass' as const, solid: false };
          const tileLevel = getTileHeightLevel(map, x, z);
          const isTallGrass = legend.tile === 'tall_grass';
          const tileKey = resolveTerrainTileKey(map, x, z);

          const topY =
            tileKey === 'water'
              ? tileLevel * HEIGHT_UNIT - WATER_BED_OFFSET
              : tileKey === 'stairs'
                ? getStairTileBaseY(map, x, z, tileLevel)
                : tileLevel * HEIGHT_UNIT;

          const x0 = x - 0.5;
          const x1 = x + 0.5;
          const z0 = z - 0.5;
          const z1 = z + 0.5;

          const useCustomGrass = Boolean(
            grassMaterial && (tileKey === 'grass' || (isTallGrass && tileKey !== 'snow'))
          );
          const targetIndices = useCustomGrass ? grassIndices : atlasIndices;

          const checker = 1.0;
          const heightTint = 0.9 + Math.min(0.14, tileLevel * 0.015);
          const baseShade = Math.min(1.06, 0.99 * checker * heightTint);
          const seamNeutralShade = baseShade;

          const cornerMeta = (sx: number, sz: number): [number, number, number] => {
            const hx =
              sx !== 0 && x + sx >= 0 && x + sx < width
                ? getTileHeightLevel(map, x + sx, z)
                : tileLevel;
            const hz =
              sz !== 0 && z + sz >= 0 && z + sz < height
                ? getTileHeightLevel(map, x, z + sz)
                : tileLevel;
            const hd =
              sx !== 0 &&
              sz !== 0 &&
              x + sx >= 0 &&
              x + sx < width &&
              z + sz >= 0 &&
              z + sz < height
                ? getTileHeightLevel(map, x + sx, z + sz)
                : tileLevel;
            const edgeRim = hx < tileLevel || hz < tileLevel ? 0.72 : 0.0;
            const crevice =
              hx > tileLevel || hz > tileLevel
                ? 0.88
                : sx !== 0 && sz !== 0 && hd > tileLevel
                  ? 0.45
                  : 0.0;
            return [0.0, edgeRim, crevice];
          };

          const pointMeta = (px: number, pz: number): [number, number, number] => {
            const sx = px < x - 0.2 ? -1 : px > x + 0.2 ? 1 : 0;
            const sz = pz < z - 0.2 ? -1 : pz > z + 0.2 ? 1 : 0;
            if (sx === 0 && sz === 0) return [0.0, 0.0, 0.0];
            return cornerMeta(sx, sz);
          };

          const contour = contourAnalysis?.tileContours[z * width + x];
          const tileBlend = transitionPlan.tilePlans[z * width + x];
          const hasSurfaceBlend = Boolean(tileBlend?.hasTransition && tileBlend.sectors.length > 0);
          const isContoured = Boolean(contour && !contour.isPlainInterior && contour.topPolygon.length >= 3);

          if (!isContoured && !hasSurfaceBlend) {
            let uvCoords: [number, number, number, number, number, number, number, number];
            if (useCustomGrass) {
              const gu0 = (x % 2) * 0.5;
              const gu1 = gu0 + 0.5;
              const gv1 = 1 - (z % 2) * 0.5;
              const gv0 = gv1 - 0.5;
              uvCoords = [gu0, gv0, gu1, gv0, gu1, gv1, gu0, gv1];
            } else {
              if (tileKey === 'water') {
                waterUvIndices.push(uvs.length);
              }
              const rect = getTileUv(tileKey);
              uvCoords = [rect.u0, rect.v0, rect.u1, rect.v0, rect.u1, rect.v1, rect.u0, rect.v1];
            }

            // Lecho costero gradual: elevar esquinas del tile water hacia tierra
            // cuando hay vecino no-agua adyacente, creando una playa suave sin
            // cambiar la topología de quads 1x1 ni la capa lógica (TerrainRules).
            const waterCornerYs: [number, number, number, number] = [
              topY,
              topY,
              topY,
              topY,
            ];
            if (tileKey === 'water') {
              const blShore = shoreFactorAt(map, x, z, -1, 1);
              const brShore = shoreFactorAt(map, x, z, 1, 1);
              const trShore = shoreFactorAt(map, x, z, 1, -1);
              const tlShore = shoreFactorAt(map, x, z, -1, -1);
              waterCornerYs[0] = topY + blShore * WATER_BED_OFFSET; // BL
              waterCornerYs[1] = topY + brShore * WATER_BED_OFFSET; // BR
              waterCornerYs[2] = topY + trShore * WATER_BED_OFFSET; // TR
              waterCornerYs[3] = topY + tlShore * WATER_BED_OFFSET; // TL
            }

            pushQuad(
              positions,
              normals,
              uvs,
              colors,
              cliffMeta,
              surfaceBlends,
              targetIndices,
              [
                [x0, waterCornerYs[0], z1],
                [x1, waterCornerYs[1], z1],
                [x1, waterCornerYs[2], z0],
                [x0, waterCornerYs[3], z0],
              ],
              [0, 1, 0],
              uvCoords,
              [baseShade, baseShade, baseShade, baseShade],
              [
                cornerMeta(-1, 1),
                cornerMeta(1, 1),
                cornerMeta(1, -1),
                cornerMeta(-1, -1),
              ]
            );
            continue;
          }

          const rect = useCustomGrass ? null : getTileUv(tileKey);
          const [cu, cv] = sampleLocalTileUv(x, z, x, z, useCustomGrass, rect);
          const anyRise = contour ? contour.topPolygon.some((p) => p.hasRise) : false;

          if (hasSurfaceBlend && tileBlend) {
            const sectors = tileBlend.sectors;
            const nSectors = sectors.length;
            let canUseSharedRing = tileBlend.uniqueTargets.length === 1;
            if (canUseSharedRing) {
              for (let i = 0; i < nSectors; i++) {
                const prev = sectors[(i - 1 + nSectors) % nSectors];
                const cur = sectors[i];
                if (
                  Math.abs(prev.bx - cur.ax) > 1e-5 ||
                  Math.abs(prev.bz - cur.az) > 1e-5 ||
                  Math.abs(prev.weightB - cur.weightA) > 1e-5 ||
                  prev.seamSmoothB !== cur.seamSmoothA
                ) {
                  canUseSharedRing = false;
                  break;
                }
              }
            }

            if (canUseSharedRing) {
              const singleTarget = tileBlend.uniqueTargets[0];
              const singleRule = getSurfaceTransitionRule(tileBlend.primaryMaterial, singleTarget);
              const firstMatchingSector = sectors.find((s) => s.targetTile === singleTarget);
              const singleSlot = firstMatchingSector!.targetAtlasSlot;
              const singleSign = getCanonicalPairSign(tileBlend.primaryMaterial, singleTarget);
              const singleContrast = firstMatchingSector?.contrast ?? singleRule?.contrast ?? 1.0;

              const centerVert = positions.length / 3;
              positions.push(x, topY, z);
              normals.push(0, 1, 0);
              uvs.push(cu, cv);
              colors.push(baseShade, baseShade, baseShade);
              cliffMeta.push(0.0, 0.0, anyRise ? 0.25 : 0.0);
              surfaceBlends.push(singleSlot, 0.0, singleSign, singleContrast);

              const ringStart = positions.length / 3;
              for (let i = 0; i < nSectors; i++) {
                const sec = sectors[i];
                const [pu, pv] = sampleLocalTileUv(sec.ax, sec.az, x, z, useCustomGrass, rect);
                const sh = sec.seamSmoothA ? seamNeutralShade : baseShade;
                const meta = pointMeta(sec.ax, sec.az);
                positions.push(sec.ax, topY, sec.az);
                normals.push(0, 1, 0);
                uvs.push(pu, pv);
                colors.push(sh, sh, sh);
                cliffMeta.push(meta[0], meta[1], meta[2]);
                surfaceBlends.push(singleSlot, sec.weightA, singleSign, singleContrast);
              }

              for (let i = 0; i < nSectors; i++) {
                const next = (i + 1) % nSectors;
                const sec = sectors[i];
                const crossY = (sec.az - z) * (sec.bx - x) - (sec.ax - x) * (sec.bz - z);
                if (crossY > 1e-7) {
                  targetIndices.push(centerVert, ringStart + i, ringStart + next);
                }
              }
            } else {
              // Multi-material junction tile: emit per-sector triangles so targetAtlasSlot is flat per triangle
              for (let i = 0; i < nSectors; i++) {
                const sec = sectors[i];
                const crossY = (sec.az - z) * (sec.bx - x) - (sec.ax - x) * (sec.bz - z);
                if (crossY <= 1e-7) continue;

                const [au, av] = sampleLocalTileUv(sec.ax, sec.az, x, z, useCustomGrass, rect);
                const [bu, bv] = sampleLocalTileUv(sec.bx, sec.bz, x, z, useCustomGrass, rect);
                const metaA = pointMeta(sec.ax, sec.az);
                const metaB = pointMeta(sec.bx, sec.bz);
                const shA = sec.seamSmoothA ? seamNeutralShade : baseShade;
                const shB = sec.seamSmoothB ? seamNeutralShade : baseShade;

                const vBase = positions.length / 3;
                // Center
                positions.push(x, topY, z);
                normals.push(0, 1, 0);
                uvs.push(cu, cv);
                colors.push(baseShade, baseShade, baseShade);
                cliffMeta.push(0.0, 0.0, anyRise ? 0.25 : 0.0);
                surfaceBlends.push(sec.targetAtlasSlot, 0.0, sec.noiseSign, sec.contrast);
                // Ring A
                positions.push(sec.ax, topY, sec.az);
                normals.push(0, 1, 0);
                uvs.push(au, av);
                colors.push(shA, shA, shA);
                cliffMeta.push(metaA[0], metaA[1], metaA[2]);
                surfaceBlends.push(sec.targetAtlasSlot, sec.weightA, sec.noiseSign, sec.contrast);
                // Ring B
                positions.push(sec.bx, topY, sec.bz);
                normals.push(0, 1, 0);
                uvs.push(bu, bv);
                colors.push(shB, shB, shB);
                cliffMeta.push(metaB[0], metaB[1], metaB[2]);
                surfaceBlends.push(sec.targetAtlasSlot, sec.weightB, sec.noiseSign, sec.contrast);

                targetIndices.push(vBase, vBase + 1, vBase + 2);
              }
            }
          } else if (contour) {
            // Organic contoured plateau top without surface transitions: P1 star-shaped indexed fan
            const poly = contour.topPolygon;
            const nPts = poly.length;
            const centerVert = positions.length / 3;

            positions.push(x, topY, z);
            normals.push(0, 1, 0);
            uvs.push(cu, cv);
            colors.push(baseShade, baseShade, baseShade);
            cliffMeta.push(0.0, 0.0, anyRise ? 0.25 : 0.0);
            surfaceBlends.push(0, 0, 0, 0);

            const ringStart = positions.length / 3;
            for (let i = 0; i < nPts; i++) {
              const pt = poly[i];
              const [pu, pv] = sampleLocalTileUv(pt.x, pt.z, x, z, useCustomGrass, rect);
              positions.push(pt.x, topY, pt.z);
              normals.push(0, 1, 0);
              uvs.push(pu, pv);
              colors.push(baseShade, baseShade, baseShade);
              cliffMeta.push(0.0, pt.isRim ? 0.72 : 0.0, pt.hasRise ? 0.88 : 0.0);
              surfaceBlends.push(0, 0, 0, 0);
            }

            for (let i = 0; i < nPts; i++) {
              const next = (i + 1) % nPts;
              const a = poly[i];
              const b = poly[next];
              const crossY = (a.z - z) * (b.x - x) - (a.x - x) * (b.z - z);
              if (crossY > 1e-7) {
                targetIndices.push(centerVert, ringStart + i, ringStart + next);
              }
            }
          }

          if (contour) {
            // Lower-floor watertight perimeter fill where the top plateau retracted inward
            for (const q of contour.lowerFloorQuads) {
              const lowUseGrass = Boolean(
                grassMaterial &&
                  (q.lowerTile === 'grass' || (q.lowerIsTallGrass && q.lowerTile !== 'snow'))
              );
              const lowRect = lowUseGrass ? null : getTileUv(q.lowerTile);
              const lowTarget = lowUseGrass ? grassIndices : atlasIndices;
              const lowLevel = Math.round(q.yBottom / HEIGHT_UNIT);
              const lowShade = Math.min(
                1.06,
                0.99 * checker * (0.9 + Math.min(0.14, lowLevel * 0.015))
              );
              const uv0 = sampleLocalTileUv(q.points[0][0], q.points[0][1], x, z, lowUseGrass, lowRect);
              const uv1 = sampleLocalTileUv(q.points[1][0], q.points[1][1], x, z, lowUseGrass, lowRect);
              const uv2 = sampleLocalTileUv(q.points[2][0], q.points[2][1], x, z, lowUseGrass, lowRect);
              const uv3 = sampleLocalTileUv(q.points[3][0], q.points[3][1], x, z, lowUseGrass, lowRect);

              pushQuad(
                positions,
                normals,
                uvs,
                colors,
                cliffMeta,
                surfaceBlends,
                lowTarget,
                [
                  [q.points[0][0], q.yBottom, q.points[0][1]],
                  [q.points[1][0], q.yBottom, q.points[1][1]],
                  [q.points[2][0], q.yBottom, q.points[2][1]],
                  [q.points[3][0], q.yBottom, q.points[3][1]],
                ],
                [0, 1, 0],
                [uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1], uv3[0], uv3[1]],
                [lowShade, lowShade, lowShade, lowShade],
                [
                  [0.0, 0.0, q.creviceMask[0]],
                  [0.0, 0.0, q.creviceMask[1]],
                  [0.0, 0.0, q.creviceMask[2]],
                  [0.0, 0.0, q.creviceMask[3]],
                ]
              );
            }

            for (const t of contour.lowerFloorTris) {
              const lowUseGrass = Boolean(
                grassMaterial &&
                  (t.lowerTile === 'grass' || (t.lowerIsTallGrass && t.lowerTile !== 'snow'))
              );
              const lowRect = lowUseGrass ? null : getTileUv(t.lowerTile);
              const lowTarget = lowUseGrass ? grassIndices : atlasIndices;
              const lowLevel = Math.round(t.yBottom / HEIGHT_UNIT);
              const lowShade = Math.min(
                1.06,
                0.99 * checker * (0.9 + Math.min(0.14, lowLevel * 0.015))
              );
              const uv0 = sampleLocalTileUv(t.points[0][0], t.points[0][1], x, z, lowUseGrass, lowRect);
              const uv1 = sampleLocalTileUv(t.points[1][0], t.points[1][1], x, z, lowUseGrass, lowRect);
              const uv2 = sampleLocalTileUv(t.points[2][0], t.points[2][1], x, z, lowUseGrass, lowRect);

              pushTriangle(
                positions,
                normals,
                uvs,
                colors,
                cliffMeta,
                surfaceBlends,
                lowTarget,
                [
                  [t.points[0][0], t.yBottom, t.points[0][1]],
                  [t.points[1][0], t.yBottom, t.points[1][1]],
                  [t.points[2][0], t.yBottom, t.points[2][1]],
                ],
                [0, 1, 0],
                [uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1]],
                [lowShade, lowShade, lowShade],
                [
                  [0.0, 0.0, t.creviceMask[0]],
                  [0.0, 0.0, t.creviceMask[1]],
                  [0.0, 0.0, t.creviceMask[2]],
                ]
              );
            }

            // 3D stratified rocky cliffs following contoured rimSegments seamlessly
            if (rockyCliffCtx && contour.rimSegments.length > 0) {
              appendTileRockyCliffs(
                rockyCliffCtx,
                contour,
                tileKey,
                chunkCliffBuffers,
                collectOrnaments ? ornamentAnchors : undefined
              );
            }
          }
        }
      }

      // 2. Legacy orthogonal cliff planes (used when organic=false, e.g. interiors)
      const chunkBoundaries = boundariesByChunk.get(`${cx},${cz}`) ?? [];
      for (const b of chunkBoundaries) {
        const dropHeight = b.yTop - b.yBottom;
        if (dropHeight <= 0.001) continue;

        const rect = getTileUv(b.cliffTile);
        const vSpan = rect.v1 - rect.v0;
        const normal = FACE_NORMAL[b.face];
        const dirShade = FACE_SHADE[b.face];

        const x0 = b.x - 0.5;
        const x1 = b.x + 0.5;
        const z0 = b.z - 0.5;
        const z1 = b.z + 0.5;

        let curTop = b.yTop;
        while (curTop - b.yBottom > 0.001) {
          const curBot = Math.max(b.yBottom, curTop - MAX_CLIFF_BAND_HEIGHT);
          const bandH = curTop - curBot;
          const vTop = rect.v1;
          const vBot = rect.v1 - vSpan * Math.min(1, bandH / MAX_CLIFF_BAND_HEIGHT);

          const topFactorAtTop = Math.max(0, Math.min(1, 1 - (b.yTop - curTop) / 0.55));
          const topFactorAtBot = Math.max(0, Math.min(1, 1 - (b.yTop - curBot) / 0.55));
          const aoAtTop = Math.max(0, Math.min(1, 1 - (curTop - b.yBottom) / 0.45));
          const aoAtBot = Math.max(0, Math.min(1, 1 - (curBot - b.yBottom) / 0.45));

          const topShade = Math.min(1.04, dirShade * (0.94 + Math.min(0.08, curTop * 0.015)));
          const botShade = dirShade * 0.84;

          let verts: [
            [number, number, number],
            [number, number, number],
            [number, number, number],
            [number, number, number],
          ];
          if (b.face === 'north') {
            verts = [
              [x1, curBot, z0],
              [x0, curBot, z0],
              [x0, curTop, z0],
              [x1, curTop, z0],
            ];
          } else if (b.face === 'south') {
            verts = [
              [x0, curBot, z1],
              [x1, curBot, z1],
              [x1, curTop, z1],
              [x0, curTop, z1],
            ];
          } else if (b.face === 'west') {
            verts = [
              [x0, curBot, z0],
              [x0, curBot, z1],
              [x0, curTop, z1],
              [x0, curTop, z0],
            ];
          } else {
            verts = [
              [x1, curBot, z1],
              [x1, curBot, z0],
              [x1, curTop, z0],
              [x1, curTop, z1],
            ];
          }

          pushQuad(
            positions,
            normals,
            uvs,
            colors,
            cliffMeta,
            surfaceBlends,
            atlasIndices,
            verts,
            normal,
            [rect.u0, vBot, rect.u1, vBot, rect.u1, vTop, rect.u0, vTop],
            [botShade, botShade, topShade, topShade],
            [
              [1.0, topFactorAtBot, aoAtBot],
              [1.0, topFactorAtBot, aoAtBot],
              [1.0, topFactorAtTop, aoAtTop],
              [1.0, topFactorAtTop, aoAtTop],
            ]
          );

          curTop = curBot;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute('aCliffMeta', new THREE.Float32BufferAttribute(cliffMeta, 3));
      geo.setAttribute('aSurfaceBlend', new THREE.Float32BufferAttribute(surfaceBlends, 4));

      const mats: THREE.Material[] = [material];
      const indices: number[] = [...atlasIndices];
      geo.addGroup(0, atlasIndices.length, 0);
      if (grassMaterial && grassIndices.length > 0) {
        const idx = mats.length;
        mats.push(grassMaterial);
        geo.addGroup(indices.length, grassIndices.length, idx);
        indices.push(...grassIndices);
      }
      if (indices.length > 0) {
        geo.setIndex(indices);
      }

      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const boundingBox = geo.boundingBox ? geo.boundingBox.clone() : new THREE.Box3();

      const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
      mesh.renderOrder = DIORAMA_RENDER_ORDER.TERRAIN_BASE;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      chunks.push({
        cx,
        cz,
        centerX: (startX + endX) * 0.5,
        centerZ: (startZ + endZ) * 0.5,
        boundingBox,
        mesh,
        waterUvIndices,
      });
    }
  }

  if (options?.artifactsOut) {
    options.artifactsOut.contourAnalysis = contourAnalysis;
    options.artifactsOut.transitionPlan = transitionPlan;
    options.artifactsOut.ornamentAnchors = ornamentAnchors;
  }

  return chunks;
}

export function updateVisibleTerrainChunks(
  chunks: readonly TerrainChunk[],
  playerX: number,
  playerZ: number,
  viewRadius = 48,
  frustum?: THREE.Frustum
): void {
  const rSq = viewRadius * viewRadius;
  for (const chunk of chunks) {
    const dx = chunk.centerX - playerX;
    const dz = chunk.centerZ - playerZ;
    const inRange = dx * dx + dz * dz <= rSq;
    chunk.mesh.visible =
      inRange && (!frustum || frustum.intersectsBox(chunk.boundingBox));
  }
}

export function updateTerrainWaterFrame(chunks: readonly TerrainChunk[], frame: 0 | 1): void {
  const rect = getTileUv(frame === 0 ? 'water' : 'water_1');
  for (const chunk of chunks) {
    if (chunk.waterUvIndices.length === 0) continue;
    const uvAttr = chunk.mesh.geometry.attributes.uv;
    for (const idx of chunk.waterUvIndices) {
      uvAttr.setXY(idx / 2, rect.u0, rect.v0);
      uvAttr.setXY(idx / 2 + 1, rect.u1, rect.v0);
      uvAttr.setXY(idx / 2 + 2, rect.u1, rect.v1);
      uvAttr.setXY(idx / 2 + 3, rect.u0, rect.v1);
    }
    uvAttr.needsUpdate = true;
  }
}

const APRON_OUTER_OFFSETS = [1, 2, 3, 4, 5, 6, 7, 10, 16, 28, 44] as const;

function buildSteppedAxisCoords(count: number): { coords: number[]; innerStart: number; innerEnd: number } {
  const coords: number[] = [];
  for (let i = APRON_OUTER_OFFSETS.length - 1; i >= 0; i--) {
    coords.push(-0.5 - APRON_OUTER_OFFSETS[i]);
  }
  const innerStart = coords.length;
  for (let i = 0; i <= count; i++) {
    coords.push(i - 0.5);
  }
  const innerEnd = coords.length - 1;
  for (let i = 0; i < APRON_OUTER_OFFSETS.length; i++) {
    coords.push(count - 0.5 + APRON_OUTER_OFFSETS[i]);
  }
  return { coords, innerStart, innerEnd };
}

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _norm = new THREE.Vector3();
const _sun = new THREE.Vector3(0.45, 0.82, 0.35).normalize();

/**
 * Builds a seamless outer terrain apron extending 44 units beyond all 4 map borders.
 * Eliminates the open sky void visible behind/beyond map-to-map warp passages while
 * sharing exact boundary vertices with the playable terrain chunks.
 */
export function buildTerrainBorderApron(
  map: MapDef,
  material: THREE.Material,
  grassMaterial?: THREE.Material
): THREE.Mesh | null {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  if (width === 0 || height === 0) return null;

  const vCols = width + 1;
  const vGrid = buildVertexHeightGrid(map);
  const xAxis = buildSteppedAxisCoords(width);
  const zAxis = buildSteppedAxisCoords(height);

  const cols = xAxis.coords.length - 1;
  const rows = zAxis.coords.length - 1;
  const totalCells = cols * rows - width * height;
  if (totalCells <= 0) return null;

  const positions = new Float32Array(totalCells * 4 * 3);
  const uvs = new Float32Array(totalCells * 4 * 2);
  const colors = new Float32Array(totalCells * 4 * 3);
  const cliffMeta = new Float32Array(totalCells * 4 * 3);
  const atlasIndices: number[] = [];
  const grassIndices: number[] = [];

  let vPtr = 0;
  let uvPtr = 0;
  let cPtr = 0;
  let vertBase = 0;

  const sampleBorderVertexY = (wx: number, wz: number): number => {
    const vx = Math.max(0, Math.min(width, Math.round(wx + 0.5)));
    const vz = Math.max(0, Math.min(height, Math.round(wz + 0.5)));
    const outX = wx < -0.5 ? -0.5 - wx : wx > width - 0.5 ? wx - (width - 0.5) : 0;
    const outZ = wz < -0.5 ? -0.5 - wz : wz > height - 0.5 ? wz - (height - 0.5) : 0;
    const outDist = Math.max(outX, outZ);
    let baseY = vGrid[vz * vCols + vx] * HEIGHT_UNIT;
    if (outDist >= 5) {
      const t = Math.min(1, (outDist - 5) / 14);
      const undulate = (Math.sin(wx * 0.16 + wz * 0.13) * 0.5 + 0.5) * 0.65;
      baseY += (0.55 + undulate) * t;
    }
    return baseY;
  };

  for (let iz = 0; iz < rows; iz++) {
    const z0 = zAxis.coords[iz];
    const z1 = zAxis.coords[iz + 1];
    const zInside = iz >= zAxis.innerStart && iz < zAxis.innerEnd;
    const midZ = (z0 + z1) * 0.5;
    const outZ = midZ < -0.5 ? -0.5 - midZ : midZ > height - 0.5 ? midZ - (height - 0.5) : 0;

    for (let ix = 0; ix < cols; ix++) {
      const xInside = ix >= xAxis.innerStart && ix < xAxis.innerEnd;
      if (xInside && zInside) continue;

      const x0 = xAxis.coords[ix];
      const x1 = xAxis.coords[ix + 1];
      const midX = (x0 + x1) * 0.5;
      const outX = midX < -0.5 ? -0.5 - midX : midX > width - 0.5 ? midX - (width - 0.5) : 0;
      const outDist = Math.max(outX, outZ);

      const bendOffset = outDist > 2 ? Math.round(Math.min(3, (outDist - 2) * 0.65)) : 0;
      const effX = outZ > outX ? midX - bendOffset : midX;
      const effZ = outX > outZ ? midZ - bendOffset : midZ;

      const sampleX = Math.max(0, Math.min(width - 1, Math.floor(effX + 0.5)));
      const sampleZ = Math.max(0, Math.min(height - 1, Math.floor(effZ + 0.5)));

      const ch = map.grid[sampleZ]?.[sampleX] ?? '.';
      const legend = map.legend[ch] ?? { tile: 'grass' as const, solid: false };
      const tileLevel = getTileHeightLevel(map, sampleX, sampleZ);

      let tileKey: TileAtlasKey = resolveTerrainTileKey(map, sampleX, sampleZ);
      if (
        outDist > 5.5 &&
        (tileKey === 'cobble' ||
          tileKey === 'dirt' ||
          ((tileKey === 'stone' || tileKey === 'mossy_stone' || tileKey === 'cracked_stone') &&
            !legend.solid))
      ) {
        tileKey =
          map.biome === 'cave' || map.id === 'cueva_eco'
            ? 'cracked_stone'
            : map.biome === 'mountain'
              ? 'dirt'
              : 'grass';
        if (
          map.snowLine !== undefined &&
          tileLevel >= map.snowLine &&
          (tileKey === 'grass' || tileKey === 'dirt')
        ) {
          tileKey = 'snow';
        }
      } else if (tileKey === 'stairs') {
        tileKey = 'cobble';
      } else if (tileKey === 'bridge') {
        tileKey = 'stone';
      }

      const y00 = sampleBorderVertexY(x0, z0);
      const y10 = sampleBorderVertexY(x1, z0);
      const y11 = sampleBorderVertexY(x1, z1);
      const y01 = sampleBorderVertexY(x0, z1);

      positions[vPtr++] = x0; positions[vPtr++] = y01; positions[vPtr++] = z1;
      positions[vPtr++] = x1; positions[vPtr++] = y11; positions[vPtr++] = z1;
      positions[vPtr++] = x1; positions[vPtr++] = y10; positions[vPtr++] = z0;
      positions[vPtr++] = x0; positions[vPtr++] = y00; positions[vPtr++] = z0;

      const dx = x1 - x0;
      const dz = z1 - z0;
      const useCustomGrass = Boolean(grassMaterial && tileKey === 'grass');
      if (useCustomGrass) {
        const gu0 = (Math.abs(Math.round(x0 + 0.5)) % 2) * 0.5;
        const gu1 = gu0 + dx * 0.5;
        const gv1 = 1 - (Math.abs(Math.round(z0 + 0.5)) % 2) * 0.5;
        const gv0 = gv1 - dz * 0.5;
        uvs[uvPtr++] = gu0; uvs[uvPtr++] = gv0;
        uvs[uvPtr++] = gu1; uvs[uvPtr++] = gv0;
        uvs[uvPtr++] = gu1; uvs[uvPtr++] = gv1;
        uvs[uvPtr++] = gu0; uvs[uvPtr++] = gv1;
      } else {
        const rect = getTileUv(tileKey);
        uvs[uvPtr++] = rect.u0; uvs[uvPtr++] = rect.v0;
        uvs[uvPtr++] = rect.u1; uvs[uvPtr++] = rect.v0;
        uvs[uvPtr++] = rect.u1; uvs[uvPtr++] = rect.v1;
        uvs[uvPtr++] = rect.u0; uvs[uvPtr++] = rect.v1;
      }

      _e1.set(dx, y11 - y01, 0);
      _e2.set(0, y00 - y01, -dz);
      _norm.crossVectors(_e1, _e2).normalize();
      const sunDot = Math.max(0, _norm.dot(_sun));
      const checker = 1.0;
      const heightTint = 0.9 + Math.min(0.14, tileLevel * 0.015);
      const shade = Math.min(1.06, (0.76 + sunDot * 0.28) * checker * heightTint);

      for (let k = 0; k < 4; k++) {
        colors[cPtr++] = shade;
        colors[cPtr++] = shade;
        colors[cPtr++] = shade;
      }

      const targetIndices = useCustomGrass ? grassIndices : atlasIndices;
      targetIndices.push(
        vertBase,
        vertBase + 1,
        vertBase + 2,
        vertBase,
        vertBase + 2,
        vertBase + 3
      );
      vertBase += 4;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aCliffMeta', new THREE.BufferAttribute(cliffMeta, 3));
  geo.setAttribute(
    'aSurfaceBlend',
    new THREE.BufferAttribute(new Float32Array(totalCells * 4 * 4), 4)
  );

  const mats: THREE.Material[] = [material];
  const indices: number[] = [...atlasIndices];
  geo.addGroup(0, atlasIndices.length, 0);
  if (grassMaterial && grassIndices.length > 0) {
    const idx = mats.length;
    mats.push(grassMaterial);
    geo.addGroup(indices.length, grassIndices.length, idx);
    indices.push(...grassIndices);
  }
  if (indices.length > 0) {
    geo.setIndex(indices);
  }

  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
  geo.computeBoundingSphere();
  mesh.renderOrder = DIORAMA_RENDER_ORDER.TERRAIN_BASE;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
