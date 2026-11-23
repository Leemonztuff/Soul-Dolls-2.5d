import { getTileHeightLevel, HEIGHT_UNIT } from '../domain/TerrainRules.ts';
import type { MapDef } from '../domain/types.ts';
import type { TileAtlasKey } from '../gfx/ProceduralTiles.ts';
import { getTileUv } from './AtlasBuilder.ts';
import type { CliffDirection } from './DioramaLayers.ts';
import type {
  RimSegment,
  TerrainContourAnalysis,
  TileContourGeometry,
} from './TerrainContourAnalyzer.ts';

export const ROCKY_CLIFF_PARAMS = {
  /** Upper beveled shoulder connecting plateau surface to rock wall (0.08-0.15 reference) */
  SHOULDER_MIN_HEIGHT: 0.08,
  SHOULDER_MAX_HEIGHT: 0.14,
  SHOULDER_MIN_BEVEL: 0.08,
  SHOULDER_MAX_BEVEL: 0.15,

  /** Rocky overhang lip extrusion relative to undercut wall below (0.08-0.15 reference) */
  OVERHANG_MIN_EXTRUSION: 0.08,
  OVERHANG_MAX_EXTRUSION: 0.15,
  OVERHANG_LIP_HEIGHT: 0.085,
  OVERHANG_UNDERSIDE_HEIGHT: 0.075,

  /** Stratified horizontal bedrock layers */
  STRATUM_BASE_THICKNESS: 0.24,
  STRATUM_THICKNESS_VARIATION: 0.07,
  STRATUM_DEPTH_STEP: 0.06,
  FACET_DEPTH_JITTER: 0.04,

  /** Basal talus skirt integrating cliff foot into lower level */
  TALUS_MIN_HEIGHT: 0.09,
  TALUS_MAX_HEIGHT: 0.22,
  TALUS_MAX_OUTWARD_SOLID: 0.065,
  TALUS_MAX_OUTWARD_WALKABLE: 0.045,

  /** Horizontal splitting only on long rim segments to preserve vertex budget */
  LONG_SEGMENT_SPLIT_THRESHOLD: 0.66,
  MAX_MITER_SCALE: 1.42,
  MIN_BAND_HEIGHT: 0.025,
  MIN_TRI_AREA_3D: 1e-7,
} as const;

export type CliffBandKind =
  | 'shoulder'
  | 'overhang_lip'
  | 'overhang_underside'
  | 'rock_stratum'
  | 'basal_talus';

export interface CliffSurfaceClassification {
  isProtectedWall: boolean;
  isWaterBank: boolean;
  allowOverhang: boolean;
  allowTalus: boolean;
  shoulderTile: TileAtlasKey;
  lipTile: TileAtlasKey;
  talusTile: TileAtlasKey;
  strataPalette: readonly TileAtlasKey[];
  ornamentSuitability: {
    edgeLip: boolean;
    hangingVine: boolean;
    crystalIcicle: boolean;
    crackedTrim: boolean;
  };
}

export interface CliffOrnamentAnchor {
  tileX: number;
  tileZ: number;
  face: CliffDirection;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  axRim: number;
  azRim: number;
  bxRim: number;
  bzRim: number;
  yRimTop: number;
  yTop: number;
  yLipBottom: number;
  maxHangHeight: number;
  nx: number;
  ny: number;
  nz: number;
  dropLevels: number;
  topTile: TileAtlasKey;
  isOverhang: boolean;
  suitability: CliffSurfaceClassification['ornamentSuitability'];
}

export interface RockyCliffChunkBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  cliffMeta: number[];
  surfaceBlends?: number[];
  atlasIndices: number[];
}

export interface RockyCliffChunkStats {
  segmentCount: number;
  bandQuadCount: number;
  ornamentAnchorCount: number;
}

interface MiterVertexInfo {
  mx: number;
  mz: number;
  safeOutward: number;
  protectedCorner: boolean;
}

interface ProfileNode {
  y: number;
  s: number;
  bandKind: CliffBandKind;
  stratumIndex: number;
  tileKey: TileAtlasKey;
  shadeMul: number;
  topFactor: number;
  baseAO: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function hashWorld3D(x: number, y: number, z: number, seed: number, salt = 0): number {
  const qx = Math.round(x * 100);
  const qy = Math.round(y * 100);
  const qz = Math.round(z * 100);
  let h =
    (Math.imul(qx | 0, 374761393) +
      Math.imul(qy | 0, 1402946736) +
      Math.imul(qz | 0, 668265263) +
      Math.imul(seed | 0, 1597334677) +
      Math.imul(salt | 0, 2246822519)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vertexKey(x: number, z: number): string {
  return `${Math.round(x * 10000)},${Math.round(z * 10000)}`;
}

const FACE_SHADE = {
  south: 0.96,
  east: 0.91,
  west: 0.83,
  north: 0.77,
} as const;

function computeDirectionalShade(nx: number, ny: number, nz: number): number {
  const hLenSq = nx * nx + nz * nz;
  let horizShade = 0.88;
  if (hLenSq > 1e-6) {
    const hnx = nx / Math.sqrt(hLenSq);
    const hnz = nz / Math.sqrt(hLenSq);
    const sx = hnx >= 0 ? FACE_SHADE.east : FACE_SHADE.west;
    const sz = hnz >= 0 ? FACE_SHADE.south : FACE_SHADE.north;
    horizShade = hnx * hnx * sx + hnz * hnz * sz;
  }
  const verticalBias = ny >= 0 ? ny * 0.14 : ny * 0.34;
  return clamp(horizShade + verticalBias, 0.45, 1.06);
}

function inferCardinalDirection(nx: number, nz: number): CliffDirection {
  if (Math.abs(nx) >= Math.abs(nz)) {
    return nx >= 0 ? 'east' : 'west';
  }
  return nz >= 0 ? 'south' : 'north';
}

function resolveTileAtlasKey(map: MapDef, x: number, z: number): TileAtlasKey {
  const ch = map.grid[z]?.[x] ?? '.';
  const legend = map.legend[ch] ?? { tile: 'grass' as const, solid: false };
  const tileLevel = getTileHeightLevel(map, x, z);

  let tileKey: TileAtlasKey = legend.tile;
  if (tileKey === 'stone') {
    if (legend.solid) {
      tileKey = 'cliff_rock';
    } else if (map.biome === 'forest') {
      tileKey = 'mossy_stone';
    } else if (map.biome === 'cave' || map.id === 'cueva_eco') {
      tileKey = 'cracked_stone';
    }
  }

  if (
    tileKey !== 'water' &&
    tileKey !== 'bridge' &&
    tileKey !== 'stairs' &&
    tileKey !== 'cobble' &&
    tileKey !== 'arena_floor' &&
    map.snowLine !== undefined &&
    tileLevel >= map.snowLine &&
    (tileKey === 'grass' || tileKey === 'dirt' || tileKey === 'tall_grass')
  ) {
    tileKey = 'snow';
  }

  return tileKey;
}

/**
 * 1. Surface Classification
 * Determines geological strata palette, shoulder/talus materials, overhang/talus eligibility,
 * and ornament suitability without creating extra materials or shaders.
 */
export function classifyCliffSegmentSurface(
  map: MapDef,
  contour: TileContourGeometry,
  seg: RimSegment,
  topTile: TileAtlasKey
): CliffSurfaceClassification {
  const dropHeight = contour.level * HEIGHT_UNIT - seg.yBottom;
  const isProtectedWall =
    contour.isProtected ||
    seg.lowerTile === 'stairs' ||
    seg.lowerTile === 'bridge' ||
    topTile === 'stairs' ||
    topTile === 'bridge';
  const isWaterBank = seg.isWaterEdge;
  const isCave = map.biome === 'cave' || map.music === 'cave' || map.id === 'cueva_eco';
  const isSnow =
    map.biome === 'snow' ||
    topTile === 'snow' ||
    (map.snowLine !== undefined && contour.level >= map.snowLine);
  const isCoast = map.biome === 'coast' || topTile === 'sand';
  const isForest = map.biome === 'forest';
  const isArena = map.biome === 'arena';

  let shoulderTile: TileAtlasKey = 'cliff_rock';
  let lipTile: TileAtlasKey = 'cliff_rock';
  let talusTile: TileAtlasKey = 'dirt';
  let strataPalette: readonly TileAtlasKey[] = ['cliff_rock', 'dirt', 'cracked_stone', 'mossy_stone'];

  if (isCave) {
    shoulderTile = 'cracked_stone';
    lipTile = 'cracked_stone';
    talusTile = 'cave_floor';
    strataPalette = ['cracked_stone', 'cave_floor', 'cliff_rock', 'stone'];
  } else if (isSnow) {
    shoulderTile = topTile === 'snow' ? 'snow' : 'cracked_stone';
    lipTile = 'cracked_stone';
    talusTile = seg.lowerTile === 'snow' ? 'snow' : 'cracked_stone';
    strataPalette = ['cliff_rock', 'cracked_stone', 'stone', 'dirt'];
  } else if (isCoast) {
    shoulderTile = topTile === 'sand' ? 'sand' : 'dirt';
    lipTile = 'cliff_rock';
    talusTile = 'sand';
    strataPalette = ['cliff_rock', 'dirt', 'sand', 'stone'];
  } else if (isArena) {
    shoulderTile = 'stone';
    lipTile = 'cracked_stone';
    talusTile = 'dirt';
    strataPalette = ['stone', 'cliff_rock', 'cracked_stone', 'dirt'];
  } else if (isForest) {
    shoulderTile = topTile === 'dirt' ? 'dirt' : 'mossy_stone';
    lipTile = 'cliff_rock';
    talusTile = seg.lowerTile === 'grass' ? 'mossy_stone' : 'dirt';
    strataPalette = ['cliff_rock', 'mossy_stone', 'dirt', 'cracked_stone'];
  } else if (map.biome === 'mountain') {
    shoulderTile = topTile === 'dirt' ? 'dirt' : 'cliff_rock';
    lipTile = 'cliff_rock';
    talusTile = 'dirt';
    strataPalette = ['cliff_rock', 'cracked_stone', 'dirt', 'stone'];
  } else {
    // Meadow / default
    shoulderTile = topTile === 'dirt' ? 'dirt' : 'mossy_stone';
    lipTile = 'cliff_rock';
    talusTile = 'dirt';
    strataPalette = ['cliff_rock', 'dirt', 'mossy_stone', 'cracked_stone'];
  }

  const allowOverhang =
    !isProtectedWall && !isWaterBank && dropHeight >= 0.48 && !contour.isNarrowCorridor;
  const allowTalus = !isProtectedWall && !isWaterBank && dropHeight >= 0.45;

  const isRockySurface = !isProtectedWall && dropHeight >= 0.45;
  return {
    isProtectedWall,
    isWaterBank,
    allowOverhang,
    allowTalus,
    shoulderTile,
    lipTile,
    talusTile,
    strataPalette,
    ornamentSuitability: {
      edgeLip: isRockySurface && !isWaterBank,
      hangingVine: isRockySurface && !isWaterBank && !isCave && !isSnow && dropHeight >= 0.85,
      crystalIcicle: isRockySurface && (isCave || isSnow) && dropHeight >= 0.85,
      crackedTrim: isRockySurface && !isWaterBank,
    },
  };
}

/**
 * Builds map-wide shared outward miter normals & safe clearance caps at every rim vertex,
 * ensuring 100% deterministic continuity across tiles and 16x16 chunk boundaries.
 */
function buildGlobalMiterLookup(
  _map: MapDef,
  analysis: TerrainContourAnalysis
): Map<string, MiterVertexInfo> {
  const accum = new Map<
    string,
    {
      x: number;
      z: number;
      nxSum: number;
      nzSum: number;
      nFirstX: number;
      nFirstZ: number;
      count: number;
      protectedCorner: boolean;
    }
  >();

  for (const contour of analysis.tileContours) {
    for (const seg of contour.rimSegments) {
      const dx = seg.bx - seg.ax;
      const dz = seg.bz - seg.az;
      const len = Math.hypot(dx, dz);
      if (len <= 1e-5) continue;
      const nx = -dz / len;
      const nz = dx / len;
      const isProt =
        contour.isProtected ||
        seg.lowerTile === 'stairs' ||
        seg.lowerTile === 'bridge' ||
        seg.isWaterEdge;

      for (const [px, pz] of [
        [seg.ax, seg.az],
        [seg.bx, seg.bz],
      ] as const) {
        const key = vertexKey(px, pz);
        let entry = accum.get(key);
        if (!entry) {
          entry = {
            x: px,
            z: pz,
            nxSum: nx,
            nzSum: nz,
            nFirstX: nx,
            nFirstZ: nz,
            count: 1,
            protectedCorner: isProt,
          };
          accum.set(key, entry);
        } else {
          entry.nxSum += nx;
          entry.nzSum += nz;
          entry.count += 1;
          if (isProt) entry.protectedCorner = true;
        }
      }
    }
  }

  const mapW = analysis.width;
  const mapH = analysis.height;
  const out = new Map<string, MiterVertexInfo>();

  for (const [key, e] of accum) {
    const sumLen = Math.hypot(e.nxSum, e.nzSum);
    let mx = e.nFirstX;
    let mz = e.nFirstZ;
    if (sumLen > 1e-4) {
      const bx = e.nxSum / sumLen;
      const bz = e.nzSum / sumLen;
      const dot = Math.max(0.55, bx * e.nFirstX + bz * e.nFirstZ);
      const miterScale = Math.min(ROCKY_CLIFF_PARAMS.MAX_MITER_SCALE, 1 / dot);
      mx = bx * miterScale;
      mz = bz * miterScale;
    }

    // Determine safe outward horizontal room around world point (e.x, e.z) without touching
    // protected footprints, water, stairs, bridges, or walkable tile interiors.
    let protectedCorner = e.protectedCorner;
    let touchesWalkable = false;
    let maxDistToGrid = 0.25;

    const minTx = Math.max(0, Math.floor(e.x + 0.5) - 1);
    const maxTx = Math.min(mapW - 1, Math.floor(e.x + 0.5));
    const minTz = Math.max(0, Math.floor(e.z + 0.5) - 1);
    const maxTz = Math.min(mapH - 1, Math.floor(e.z + 0.5));

    // Clamp grid check tightly to adjacent 2x2 tiles around (e.x, e.z)
    for (let tz = minTz; tz <= maxTz; tz++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const dxTile = Math.abs(e.x - tx);
        const dzTile = Math.abs(e.z - tz);
        if (dxTile > 0.501 || dzTile > 0.501) continue;
        const idx = tz * mapW + tx;
        if (analysis.protectedFlags[idx] || analysis.waterFlags[idx]) {
          protectedCorner = true;
        }
        if (!analysis.solidFlags[idx] && !analysis.waterFlags[idx]) {
          touchesWalkable = true;
        }
      }
    }

    // Distance inside any retracted edge relative to nearest 0.5 grid line
    const nearestGridX = Math.round(e.x + 0.5) - 0.5;
    const nearestGridZ = Math.round(e.z + 0.5) - 0.5;
    const dxEdge = Math.abs(e.x - nearestGridX);
    const dzEdge = Math.abs(e.z - nearestGridZ);
    const insetFromBoundary = Math.max(dxEdge, dzEdge);

    // Also lock flush on outer map boundaries so border apron fits seamlessly
    const onMapBorder =
      e.x <= -0.49 || e.x >= mapW - 0.51 || e.z <= -0.49 || e.z >= mapH - 0.51;
    if (onMapBorder) {
      protectedCorner = true;
    }

    let safeOutward = 0;
    if (!protectedCorner) {
      if (insetFromBoundary > 0.02) {
        safeOutward = Math.min(0.11, insetFromBoundary * 0.85);
      } else if (!touchesWalkable) {
        safeOutward = 0.08;
      } else {
        // Gentle non-invasive micro-bevel clearance along straight un-retracted edges
        safeOutward = 0.045;
      }
      safeOutward = Math.min(safeOutward, maxDistToGrid);
    }

    out.set(key, {
      mx,
      mz,
      safeOutward,
      protectedCorner,
    });
  }

  return out;
}

/**
 * Computes deterministic vertical profile nodes (Shoulder -> Overhang Lip -> Strata -> Basal Talus)
 * evaluated at global world (x, z) so adjacent segments match seamlessly across tile & chunk seams.
 */
function buildProfileColumnNodes(
  x: number,
  z: number,
  yTop: number,
  yBottom: number,
  safeOutward: number,
  protectedVertex: boolean,
  isNarrowCorridor: boolean,
  seed: number,
  classification: CliffSurfaceClassification
): ProfileNode[] {
  const dropHeight = yTop - yBottom;
  const nodes: ProfileNode[] = [];
  const inwardCap = protectedVertex ? 0.015 : isNarrowCorridor ? 0.045 : 0.11;

  // 1. Exact top rim matching topPolygon (s = 0 -> zero cracks, zero plateau invasion)
  nodes.push({
    y: yTop,
    s: 0,
    bandKind: 'shoulder',
    stratumIndex: 0,
    tileKey: classification.shoulderTile,
    shadeMul: 1.0,
    topFactor: 0.96,
    baseAO: 0.03,
  });

  // Protected wall/vertex or shallow bank fallback (flush s = 0 at protected corners eliminates miter hairlines at stairs/buildings/water)
  if (
    protectedVertex ||
    classification.isProtectedWall ||
    classification.isWaterBank ||
    dropHeight < 0.35
  ) {
    const bevelH = Math.min(dropHeight * 0.25, 0.09);
    const bevelIn = protectedVertex
      ? 0
      : classification.isWaterBank
        ? -0.035
        : -Math.min(inwardCap, 0.025);
    if (dropHeight > bevelH + 0.06) {
      nodes.push({
        y: yTop - bevelH,
        s: 0,
        bandKind: 'shoulder',
        stratumIndex: 0,
        tileKey: classification.shoulderTile,
        shadeMul: 0.96,
        topFactor: 0.72,
        baseAO: 0.08,
      });
      const strataSpan = dropHeight - bevelH;
      const bands = Math.max(1, Math.min(4, Math.round(strataSpan / 0.34)));
      for (let k = 1; k < bands; k++) {
        const yMid = yTop - bevelH - (strataSpan * k) / bands;
        const microStep = protectedVertex
          ? 0
          : (hashWorld3D(x, yMid, z, seed, 301 + k) - 0.5) * 0.025;
        nodes.push({
          y: yMid,
          s: protectedVertex ? 0 : clamp(bevelIn + microStep, -0.05, 0),
          bandKind: 'rock_stratum',
          stratumIndex: k,
          tileKey: classification.strataPalette[k % classification.strataPalette.length],
          shadeMul: k % 2 === 0 ? 0.95 : 0.89,
          topFactor: Math.max(0, 0.45 - k * 0.15),
          baseAO: 0.14 + k * 0.06,
        });
      }
    }
    nodes.push({
      y: yBottom,
      s: 0, // Seal cleanly to outer boundary on protected / water walls
      bandKind: 'basal_talus',
      stratumIndex: 99,
      tileKey: classification.talusTile,
      shadeMul: 0.82,
      topFactor: 0.0,
      baseAO: 0.42,
    });
    return nodes;
  }

  // 2. Cliff Shoulder (bevel 0.08-0.15)
  const shoulderJitter = hashWorld3D(x, yTop, z, seed, 101);
  const shoulderH = clamp(
    Math.min(
      dropHeight * 0.22,
      ROCKY_CLIFF_PARAMS.SHOULDER_MIN_HEIGHT +
        shoulderJitter *
          (ROCKY_CLIFF_PARAMS.SHOULDER_MAX_HEIGHT - ROCKY_CLIFF_PARAMS.SHOULDER_MIN_HEIGHT)
    ),
    0.06,
    dropHeight * 0.28
  );
  const shoulderOut =
    safeOutward > 0.01
      ? clamp(
          Math.max(0.03, safeOutward * (0.65 + 0.35 * shoulderJitter)),
          0,
          safeOutward
        )
      : 0;
  const yShoulder = yTop - shoulderH;

  nodes.push({
    y: yShoulder,
    s: shoulderOut,
    bandKind: 'shoulder',
    stratumIndex: 0,
    tileKey: classification.shoulderTile,
    shadeMul: 0.99,
    topFactor: 0.78,
    baseAO: 0.06,
  });

  // 3. Overhang Lip + Underside (extrusion 0.08-0.15 relative to undercut bedrock below)
  const talusReserve = classification.allowTalus
    ? clamp(
        dropHeight * 0.22,
        ROCKY_CLIFF_PARAMS.TALUS_MIN_HEIGHT,
        ROCKY_CLIFF_PARAMS.TALUS_MAX_HEIGHT
      )
    : 0;
  const yTalusTop = yBottom + talusReserve;
  let yWallTop = yShoulder;

  if (
    classification.allowOverhang &&
    yShoulder - yTalusTop >
      ROCKY_CLIFF_PARAMS.OVERHANG_LIP_HEIGHT +
        ROCKY_CLIFF_PARAMS.OVERHANG_UNDERSIDE_HEIGHT +
        0.08
  ) {
    const lipHash = hashWorld3D(x, yShoulder, z, seed, 137);
    const lipOut = clamp(shoulderOut + 0.015 + lipHash * 0.025, shoulderOut, safeOutward);
    const desiredOverhang =
      ROCKY_CLIFF_PARAMS.OVERHANG_MIN_EXTRUSION +
      lipHash *
        (ROCKY_CLIFF_PARAMS.OVERHANG_MAX_EXTRUSION -
          ROCKY_CLIFF_PARAMS.OVERHANG_MIN_EXTRUSION);
    const sUndercut = clamp(lipOut - desiredOverhang, -inwardCap, -0.03);
    const yLipBot = yShoulder - ROCKY_CLIFF_PARAMS.OVERHANG_LIP_HEIGHT;
    const yUnder = yLipBot - ROCKY_CLIFF_PARAMS.OVERHANG_UNDERSIDE_HEIGHT;

    nodes.push({
      y: yLipBot,
      s: lipOut,
      bandKind: 'overhang_lip',
      stratumIndex: 0,
      tileKey: classification.lipTile,
      shadeMul: 1.02,
      topFactor: 0.62,
      baseAO: 0.12,
    });
    nodes.push({
      y: yUnder,
      s: sUndercut,
      bandKind: 'overhang_underside',
      stratumIndex: 0,
      tileKey: classification.lipTile,
      shadeMul: 0.68,
      topFactor: 0.0,
      baseAO: 0.68,
    });
    yWallTop = yUnder;
  }

  // 4. Stratified Rock Bands using canonical world Y intervals so adjacent multi-tier drops align without sliver cuts
  const remainingRockH = yWallTop - yTalusTop;
  if (remainingRockH > ROCKY_CLIFF_PARAMS.MIN_BAND_HEIGHT) {
    const hasOverhang = nodes.some((n) => n.bandKind === 'overhang_lip');
    const canonWallTop =
      yTop -
      ROCKY_CLIFF_PARAMS.SHOULDER_MAX_HEIGHT -
      (hasOverhang
        ? ROCKY_CLIFF_PARAMS.OVERHANG_LIP_HEIGHT + ROCKY_CLIFF_PARAMS.OVERHANG_UNDERSIDE_HEIGHT
        : 0);
    const wave = Math.sin(x * 0.31 + z * 0.23) * 0.03;
    const stepBase = ROCKY_CLIFF_PARAMS.STRATUM_BASE_THICKNESS;
    const minStratumY = yTalusTop + 0.025;
    const maxStratumY = yWallTop - 0.025;

    // Canonical strata index range ensures adjacent columns emit matching structural bands
    const startPlaneIdx = Math.floor((canonWallTop - 0.03) / stepBase);
    const endPlaneIdx = Math.ceil((yTalusTop + 0.03) / stepBase);
    let lastS = nodes[nodes.length - 1].s;

    for (let planeIdx = startPlaneIdx; planeIdx >= endPlaneIdx; planeIdx--) {
      const planeY = clamp(planeIdx * stepBase + wave, minStratumY, maxStratumY);
      if (planeY <= minStratumY + 1e-4 || planeY >= maxStratumY - 1e-4) continue;

      const sHash = hashWorld3D(x, planeIdx, z, seed, 211 + Math.abs(planeIdx));
      const tiltSign = planeIdx % 2 === 0 ? 1 : -1;
      const targetS = clamp(
        -0.055 +
          tiltSign * (0.025 + sHash * ROCKY_CLIFF_PARAMS.STRATUM_DEPTH_STEP) +
          (sHash - 0.5) * 0.03,
        -inwardCap,
        Math.min(safeOutward * 0.5, 0.035)
      );

      const bandTile =
        classification.strataPalette[Math.abs(planeIdx) % classification.strataPalette.length];
      const isEarthSeam = bandTile === 'dirt' || bandTile === 'mossy_stone';

      nodes.push({
        y: planeY,
        s: (lastS + targetS) * 0.5 + (targetS - lastS) * 0.35,
        bandKind: 'rock_stratum',
        stratumIndex: Math.abs(planeIdx),
        tileKey: bandTile,
        shadeMul: isEarthSeam ? 0.87 : planeIdx % 2 === 0 ? 0.98 : 0.90,
        topFactor: clamp(1 - (yTop - planeY) / 0.85, 0, 0.45),
        baseAO: isEarthSeam ? 0.28 : 0.16,
      });
      lastS = targetS;
    }
  }

  // 5. Basal Talus top & grounded foot at y = yBottom (s >= 0 prevents any floor gaps!)
  if (classification.allowTalus && talusReserve > ROCKY_CLIFF_PARAMS.MIN_BAND_HEIGHT) {
    const talusHash = hashWorld3D(x, yBottom, z, seed, 409);
    const sWallBase = clamp(-0.045 - talusHash * 0.035, -inwardCap, -0.015);
    const talusCap =
      safeOutward > 0.01
        ? Math.min(safeOutward, ROCKY_CLIFF_PARAMS.TALUS_MAX_OUTWARD_SOLID)
        : 0;
    const sTalusFoot = clamp(talusCap * (0.65 + 0.35 * talusHash), 0, talusCap);

    nodes.push({
      y: yTalusTop,
      s: sWallBase,
      bandKind: 'rock_stratum',
      stratumIndex: 7,
      tileKey: classification.strataPalette[0],
      shadeMul: 0.86,
      topFactor: 0.0,
      baseAO: 0.46,
    });
    nodes.push({
      y: yBottom,
      s: sTalusFoot,
      bandKind: 'basal_talus',
      stratumIndex: 99,
      tileKey: classification.talusTile,
      shadeMul: 0.84,
      topFactor: 0.0,
      baseAO: 0.24,
    });
  } else {
    nodes.push({
      y: yBottom,
      s: 0,
      bandKind: 'basal_talus',
      stratumIndex: 99,
      tileKey: classification.talusTile,
      shadeMul: 0.80,
      topFactor: 0.0,
      baseAO: 0.44,
    });
  }

  return nodes;
}

/**
 * Resolves consistent profile nodes at an arbitrary Y span when two adjacent columns
 * share A/B segment endpoints (interpolates interior strata cleanly at matching Y heights).
 */
function sampleColumnOffsetAtY(nodes: readonly ProfileNode[], y: number): number {
  if (y >= nodes[0].y) return nodes[0].s;
  const last = nodes[nodes.length - 1];
  if (y <= last.y) return last.s;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (y <= a.y && y >= b.y) {
      const span = a.y - b.y;
      if (span <= 1e-6) return a.s;
      const t = (a.y - y) / span;
      return a.s + (b.s - a.s) * t;
    }
  }
  return last.s;
}

function pushBandQuad(
  buffers: RockyCliffChunkBuffers,
  bl: readonly [number, number, number],
  br: readonly [number, number, number],
  tr: readonly [number, number, number],
  tl: readonly [number, number, number],
  u0: number,
  u1: number,
  vBot: number,
  vTop: number,
  shadeBot: number,
  shadeTop: number,
  metaBot: readonly [number, number, number],
  metaTop: readonly [number, number, number]
): boolean {
  // Compute outward geometric quad normal (CCW: BL -> BR -> TR -> TL)
  const e1x = br[0] - bl[0];
  const e1y = br[1] - bl[1];
  const e1z = br[2] - bl[2];
  const e2x = tr[0] - bl[0];
  const e2y = tr[1] - bl[1];
  const e2z = tr[2] - bl[2];
  const n1x = e1y * e2z - e1z * e2y;
  const n1y = e1z * e2x - e1x * e2z;
  const n1z = e1x * e2y - e1y * e2x;

  const e3x = tl[0] - bl[0];
  const e3y = tl[1] - bl[1];
  const e3z = tl[2] - bl[2];
  const n2x = e2y * e3z - e2z * e3y;
  const n2y = e2z * e3x - e2x * e3z;
  const n2z = e2x * e3y - e2y * e3x;

  const a1 = Math.hypot(n1x, n1y, n1z) * 0.5;
  const a2 = Math.hypot(n2x, n2y, n2z) * 0.5;
  if (a1 < ROCKY_CLIFF_PARAMS.MIN_TRI_AREA_3D && a2 < ROCKY_CLIFF_PARAMS.MIN_TRI_AREA_3D) {
    return false;
  }

  let nx = n1x + n2x;
  let ny = n1y + n2y;
  let nz = n1z + n2z;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen <= 1e-6) return false;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;

  // Guard against horizontal normal == 1.0 classification collision in contour coverage checks
  if (ny > 0.92) {
    ny = 0.92;
    const hScale = Math.sqrt(1 - ny * ny) / Math.max(1e-5, Math.hypot(nx, nz));
    nx *= hScale;
    nz *= hScale;
  }

  const dirShade = computeDirectionalShade(nx, ny, nz);
  const sBot = clamp(dirShade * shadeBot, 0.35, 1.06);
  const sTop = clamp(dirShade * shadeTop, 0.35, 1.06);

  const vertBase = buffers.positions.length / 3;
  const verts = [bl, br, tr, tl] as const;
  const shades = [sBot, sBot, sTop, sTop] as const;
  const metas = [metaBot, metaBot, metaTop, metaTop] as const;
  const uvArr = [u0, vBot, u1, vBot, u1, vTop, u0, vTop] as const;

  for (let i = 0; i < 4; i++) {
    buffers.positions.push(verts[i][0], verts[i][1], verts[i][2]);
    buffers.normals.push(nx, ny, nz);
    buffers.uvs.push(uvArr[i * 2], uvArr[i * 2 + 1]);
    buffers.colors.push(shades[i], shades[i], shades[i]);
    buffers.cliffMeta.push(metas[i][0], metas[i][1], metas[i][2]);
    if (buffers.surfaceBlends) {
      buffers.surfaceBlends.push(0, 0, 0, 0);
    }
  }

  if (a1 >= ROCKY_CLIFF_PARAMS.MIN_TRI_AREA_3D) {
    buffers.atlasIndices.push(vertBase, vertBase + 1, vertBase + 2);
  }
  if (a2 >= ROCKY_CLIFF_PARAMS.MIN_TRI_AREA_3D) {
    buffers.atlasIndices.push(vertBase, vertBase + 2, vertBase + 3);
  }
  return true;
}

export class RockyCliffBuildContext {
  readonly map: MapDef;
  readonly analysis: TerrainContourAnalysis;
  private readonly miterMap: Map<string, MiterVertexInfo>;

  constructor(map: MapDef, analysis: TerrainContourAnalysis) {
    this.map = map;
    this.analysis = analysis;
    this.miterMap = buildGlobalMiterLookup(map, analysis);
  }

  getMiterAt(x: number, z: number, fallbackNx: number, fallbackNz: number): MiterVertexInfo {
    return (
      this.miterMap.get(vertexKey(x, z)) ?? {
        mx: fallbackNx,
        mz: fallbackNz,
        safeOutward: 0,
        protectedCorner: true,
      }
    );
  }
}

/**
 * 2 & 3. Geometry Generation + Material Assignment
 * Builds 3D rocky cliff faces (shoulder, overhang lip, strata, basal talus) for a single tile's
 * rim segments inside its chunk buffers, and returns ornament anchors aligned to real geometry.
 */
export function appendTileRockyCliffs(
  ctx: RockyCliffBuildContext,
  contour: TileContourGeometry,
  topTile: TileAtlasKey,
  buffers: RockyCliffChunkBuffers,
  ornamentAnchorsOut?: CliffOrnamentAnchor[]
): RockyCliffChunkStats {
  const stats: RockyCliffChunkStats = {
    segmentCount: 0,
    bandQuadCount: 0,
    ornamentAnchorCount: 0,
  };

  const yTop = contour.level * HEIGHT_UNIT;
  const seed = ctx.analysis.seed;

  for (const seg of contour.rimSegments) {
    const dropHeight = yTop - seg.yBottom;
    if (dropHeight <= 0.005) continue;

    const dx = seg.bx - seg.ax;
    const dz = seg.bz - seg.az;
    const segLen = Math.hypot(dx, dz);
    if (segLen <= 1e-5) continue;

    stats.segmentCount++;
    const segNx = -dz / segLen;
    const segNz = dx / segLen;
    const classification = classifyCliffSegmentSurface(ctx.map, contour, seg, topTile);

    const miterA = ctx.getMiterAt(seg.ax, seg.az, segNx, segNz);
    const miterB = ctx.getMiterAt(seg.bx, seg.bz, segNx, segNz);

    const nodesA = buildProfileColumnNodes(
      seg.ax,
      seg.az,
      yTop,
      seg.yBottom,
      miterA.safeOutward,
      miterA.protectedCorner,
      contour.isNarrowCorridor,
      seed,
      classification
    );
    const nodesB = buildProfileColumnNodes(
      seg.bx,
      seg.bz,
      yTop,
      seg.yBottom,
      miterB.safeOutward,
      miterB.protectedCorner,
      contour.isNarrowCorridor,
      seed,
      classification
    );

    const subCols = segLen > ROCKY_CLIFF_PARAMS.LONG_SEGMENT_SPLIT_THRESHOLD ? 2 : 1;

    // Emit ornament anchor aligned to the exact generated lip/shoulder crest
    if (ornamentAnchorsOut && classification.ornamentSuitability.edgeLip) {
      const lipNodeA =
        nodesA.find((n) => n.bandKind === 'overhang_lip') ??
        nodesA[Math.min(1, nodesA.length - 1)];
      const lipNodeB =
        nodesB.find((n) => n.bandKind === 'overhang_lip') ??
        nodesB[Math.min(1, nodesB.length - 1)];
      const shoulderNodeA = nodesA[Math.min(1, nodesA.length - 1)];
      const shoulderNodeB = nodesB[Math.min(1, nodesB.length - 1)];

      const anchorAOffset = Math.max(shoulderNodeA.s, lipNodeA.s);
      const anchorBOffset = Math.max(shoulderNodeB.s, lipNodeB.s);
      const axLip = seg.ax + miterA.mx * anchorAOffset;
      const azLip = seg.az + miterA.mz * anchorAOffset;
      const bxLip = seg.bx + miterB.mx * anchorBOffset;
      const bzLip = seg.bz + miterB.mz * anchorBOffset;

      const yCrest = Math.min(shoulderNodeA.y, shoulderNodeB.y);
      const hasLip =
        nodesA.some((n) => n.bandKind === 'overhang_lip') &&
        nodesB.some((n) => n.bandKind === 'overhang_lip');
      const yLipBottom = hasLip ? Math.min(lipNodeA.y, lipNodeB.y) : yCrest;
      const talusTopA =
        nodesA.length >= 2 ? nodesA[nodesA.length - 2].y : seg.yBottom;
      const talusTopB =
        nodesB.length >= 2 ? nodesB[nodesB.length - 2].y : seg.yBottom;
      const yClearBottom = Math.max(talusTopA, talusTopB, seg.yBottom);
      const maxHangHeight = Math.max(0, yLipBottom - yClearBottom);

      const adx = bxLip - axLip;
      const adz = bzLip - azLip;
      const aLen = Math.hypot(adx, adz);
      if (aLen > 0.08 && maxHangHeight >= 0.12) {
        const anx = -adz / aLen;
        const anz = adx / aLen;
        const nyTilt = hasLip ? 0.15 : 0.35;
        const hScale = Math.sqrt(1 - nyTilt * nyTilt);

        ornamentAnchorsOut.push({
          tileX: contour.x,
          tileZ: contour.z,
          face: inferCardinalDirection(anx, anz),
          ax: axLip,
          az: azLip,
          bx: bxLip,
          bz: bzLip,
          axRim: seg.ax,
          azRim: seg.az,
          bxRim: seg.bx,
          bzRim: seg.bz,
          yRimTop: yTop,
          yTop: yCrest,
          yLipBottom,
          maxHangHeight,
          nx: anx * hScale,
          ny: nyTilt,
          nz: anz * hScale,
          dropLevels: seg.dropLevels,
          topTile,
          isOverhang: hasLip,
          suitability: classification.ornamentSuitability,
        });
        stats.ornamentAnchorCount++;
      }
    }

    const inwardCap =
      miterA.protectedCorner || miterB.protectedCorner
        ? 0.015
        : contour.isNarrowCorridor
          ? 0.045
          : 0.11;
    const midSafeOutward = Math.min(miterA.safeOutward, miterB.safeOutward);

    const evalFacetOffset = (
      t: number,
      xAt: number,
      yAt: number,
      zAt: number,
      baseS: number,
      _bandKind: CliffBandKind
    ): number => {
      if (
        subCols <= 1 ||
        Math.abs(t - 0.5) >= 1e-4 ||
        classification.isProtectedWall ||
        classification.isWaterBank ||
        yAt >= yTop - ROCKY_CLIFF_PARAMS.SHOULDER_MAX_HEIGHT - 0.01 ||
        yAt <= seg.yBottom + ROCKY_CLIFF_PARAMS.TALUS_MAX_HEIGHT + 0.01
      ) {
        return baseS;
      }
      const rawFacet =
        (hashWorld3D(xAt, yAt, zAt, seed, 533) - 0.5) *
        2 *
        ROCKY_CLIFF_PARAMS.FACET_DEPTH_JITTER;
      return clamp(baseS + rawFacet, -inwardCap, midSafeOutward);
    };

    const emitColumnBand = (
      t0: number,
      t1: number,
      aTop: ProfileNode,
      aBot: ProfileNode,
      bTop: ProfileNode,
      bBot: ProfileNode,
      bandIdx: number
    ) => {
      const yATop = aTop.y + (bTop.y - aTop.y) * t0;
      const yBTop = aTop.y + (bTop.y - aTop.y) * t1;
      const yABot = aBot.y + (bBot.y - aBot.y) * t0;
      const yBBot = aBot.y + (bBot.y - aBot.y) * t1;

      const avgBandH = ((yATop - yABot) + (yBTop - yBBot)) * 0.5;
      if (avgBandH < 1e-4) return;

      const x0 = seg.ax + dx * t0;
      const z0 = seg.az + dz * t0;
      const x1 = seg.ax + dx * t1;
      const z1 = seg.az + dz * t1;

      const mx0 = miterA.mx + (miterB.mx - miterA.mx) * t0;
      const mz0 = miterA.mz + (miterB.mz - miterA.mz) * t0;
      const mx1 = miterA.mx + (miterB.mx - miterA.mx) * t1;
      const mz1 = miterA.mz + (miterB.mz - miterA.mz) * t1;

      const sATop = evalFacetOffset(
        t0,
        x0,
        yATop,
        z0,
        aTop.s + (bTop.s - aTop.s) * t0,
        aTop.bandKind
      );
      const sABot = evalFacetOffset(
        t0,
        x0,
        yABot,
        z0,
        aBot.s + (bBot.s - aBot.s) * t0,
        aBot.bandKind
      );
      const sBTop = evalFacetOffset(
        t1,
        x1,
        yBTop,
        z1,
        aTop.s + (bTop.s - aTop.s) * t1,
        bTop.bandKind
      );
      const sBBot = evalFacetOffset(
        t1,
        x1,
        yBBot,
        z1,
        aBot.s + (bBot.s - aBot.s) * t1,
        bBot.bandKind
      );

      const bl: [number, number, number] = [x0 + mx0 * sABot, yABot, z0 + mz0 * sABot];
      const br: [number, number, number] = [x1 + mx1 * sBBot, yBBot, z1 + mz1 * sBBot];
      const tr: [number, number, number] = [x1 + mx1 * sBTop, yBTop, z1 + mz1 * sBTop];
      const tl: [number, number, number] = [x0 + mx0 * sATop, yATop, z0 + mz0 * sATop];

      const bandTile = aBot.tileKey;
      const rect = getTileUv(bandTile);
      const uSpan = rect.u1 - rect.u0;
      const vSpan = rect.v1 - rect.v0;
      const segU0 = seg.uStart + (seg.uEnd - seg.uStart) * t0;
      const segU1 = seg.uStart + (seg.uEnd - seg.uStart) * t1;
      const u0 = rect.u0 + segU0 * uSpan;
      const u1 = rect.u0 + segU1 * uSpan;

      // Keep vertical UVs safely inside tile bounds with subtle stratum-to-stratum variation
      const vPad = vSpan * 0.02;
      const vShift = ((bandIdx % 2) * 0.06) * vSpan;
      const vTop = rect.v1 - vPad - vShift;
      const vBot = Math.max(
        rect.v0 + vPad,
        vTop - vSpan * 0.92 * Math.min(1, avgBandH / 0.55)
      );

      const shadeTop = (aTop.shadeMul + (bTop.shadeMul - aTop.shadeMul) * ((t0 + t1) * 0.5));
      const shadeBot = (aBot.shadeMul + (bBot.shadeMul - aBot.shadeMul) * ((t0 + t1) * 0.5));
      const topFactorTop = aTop.topFactor + (bTop.topFactor - aTop.topFactor) * ((t0 + t1) * 0.5);
      const topFactorBot = aBot.topFactor + (bBot.topFactor - aBot.topFactor) * ((t0 + t1) * 0.5);
      const aoTop = aTop.baseAO + (bTop.baseAO - aTop.baseAO) * ((t0 + t1) * 0.5);
      const aoBot = aBot.baseAO + (bBot.baseAO - aBot.baseAO) * ((t0 + t1) * 0.5);

      if (
        pushBandQuad(
          buffers,
          bl,
          br,
          tr,
          tl,
          u0,
          u1,
          vBot,
          vTop,
          shadeBot,
          shadeTop,
          [1.0, topFactorBot, aoBot],
          [1.0, topFactorTop, aoTop]
        )
      ) {
        stats.bandQuadCount++;
      }
    };

    // Synchronize bands structurally across nodesA and nodesB so shared corner vertices match bit-for-bit
    const canFastMatch =
      nodesA.length === nodesB.length &&
      nodesA.every(
        (na, i) =>
          na.bandKind === nodesB[i].bandKind && na.stratumIndex === nodesB[i].stratumIndex
      );

    if (canFastMatch) {
      for (let b = 0; b < nodesA.length - 1; b++) {
        for (let c = 0; c < subCols; c++) {
          const t0 = c / subCols;
          const t1 = (c + 1) / subCols;
          emitColumnBand(
            t0,
            t1,
            nodesA[b],
            nodesA[b + 1],
            nodesB[b],
            nodesB[b + 1],
            b
          );
        }
      }
    } else {
      // Merge unique descending Y levels from both columns so each side evaluates its exact piecewise polyline
      const mergedY: number[] = [];
      for (const n of nodesA) mergedY.push(n.y);
      for (const n of nodesB) mergedY.push(n.y);
      mergedY.sort((a, b) => b - a);
      const uniqueY: number[] = [];
      for (const y of mergedY) {
        if (uniqueY.length === 0 || uniqueY[uniqueY.length - 1] - y > 1e-4) {
          uniqueY.push(y);
        }
      }

      const sampleNodeMeta = (nodes: readonly ProfileNode[], yMid: number): ProfileNode => {
        for (let i = 0; i < nodes.length - 1; i++) {
          if (yMid <= nodes[i].y + 1e-5 && yMid >= nodes[i + 1].y - 1e-5) {
            return nodes[i + 1];
          }
        }
        return nodes[nodes.length - 1];
      };

      for (let b = 0; b < uniqueY.length - 1; b++) {
        const yHi = uniqueY[b];
        const yLo = uniqueY[b + 1];
        if (yHi - yLo < 1e-4) continue;
        const yMid = (yHi + yLo) * 0.5;
        const metaTopA = sampleNodeMeta(nodesA, yHi);
        const metaBotA = sampleNodeMeta(nodesA, yMid);
        const metaTopB = sampleNodeMeta(nodesB, yHi);
        const metaBotB = sampleNodeMeta(nodesB, yMid);

        const syntheticATop: ProfileNode = { ...metaTopA, y: yHi, s: sampleColumnOffsetAtY(nodesA, yHi) };
        const syntheticABot: ProfileNode = { ...metaBotA, y: yLo, s: sampleColumnOffsetAtY(nodesA, yLo) };
        const syntheticBTop: ProfileNode = { ...metaTopB, y: yHi, s: sampleColumnOffsetAtY(nodesB, yHi) };
        const syntheticBBot: ProfileNode = { ...metaBotB, y: yLo, s: sampleColumnOffsetAtY(nodesB, yLo) };

        for (let c = 0; c < subCols; c++) {
          const t0 = c / subCols;
          const t1 = (c + 1) / subCols;
          emitColumnBand(t0, t1, syntheticATop, syntheticABot, syntheticBTop, syntheticBBot, b);
        }
      }
    }
  }

  return stats;
}

/**
 * 4. Ornament Information Extraction
 * Computes deterministic 3D cliff ornament anchors across the map cleanly decoupled from OverworldScene.
 */
export function extractRockyCliffOrnamentAnchors(
  map: MapDef,
  analysis: TerrainContourAnalysis
): CliffOrnamentAnchor[] {
  if (map.isInterior) return [];
  const ctx = new RockyCliffBuildContext(map, analysis);
  const anchors: CliffOrnamentAnchor[] = [];
  const dummyBuffers: RockyCliffChunkBuffers = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    cliffMeta: [],
    atlasIndices: [],
  };

  for (const contour of analysis.tileContours) {
    if (contour.rimSegments.length === 0) continue;
    const topTile = resolveTileAtlasKey(map, contour.x, contour.z);
    appendTileRockyCliffs(ctx, contour, topTile, dummyBuffers, anchors);
  }

  return anchors;
}
