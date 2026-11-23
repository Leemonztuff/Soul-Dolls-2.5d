import { getTileHeightLevel } from '../domain/TerrainRules.ts';
import type { MapDef } from '../domain/types.ts';
import { TILE_ATLAS_INDEX, type TileAtlasKey } from '../gfx/ProceduralTiles.ts';
import type {
  ContourPoint2D,
  TerrainContourAnalysis,
  TileContourGeometry,
} from './TerrainContourAnalyzer.ts';

export const SURFACE_TRANSITION_PARAMS = {
  /** Base weight along a shared same-height boundary between two compatible materials */
  MAX_EDGE_BLEND_WEIGHT: 0.5,
  /** Damped corner weight where 3+ distinct compatible materials meet at one vertex */
  TRIPLE_JUNCTION_WEIGHT: 0.36,
  /** Weight at a diagonal-only corner where cardinal edges share the primary material */
  DIAGONAL_CORNER_WEIGHT: 0.34,
  /** GLSL world-space organic fractal noise amplitude around 0.5 threshold */
  NOISE_AMPLITUDE: 0.56,
  /** Base smoothstep half-width around 0.5 (strictly < 0.5 - 0.5 * NOISE_AMPLITUDE = 0.22 so center=0 never speckles) */
  HALF_WINDOW_BASE: 0.16,
} as const;

export interface SurfaceTransitionRule {
  /** Higher priority breaks ties when multiple compatible surfaces compete at a junction */
  readonly priority: number;
  /** Scalar multiplier in [0..1] over MAX_EDGE_BLEND_WEIGHT */
  readonly strength: number;
  /** Edge softness factor [0.7..1.2]; lower = wider feathered transition, higher = tighter crisp patch */
  readonly contrast: number;
}

const RULE_MAP = new Map<string, SurfaceTransitionRule>();

function ruleKey(fromSurface: TileAtlasKey, toSurface: TileAtlasKey): string {
  return `${fromSurface}->${toSurface}`;
}

function registerBidirectionalRule(
  a: TileAtlasKey,
  b: TileAtlasKey,
  ruleAB: SurfaceTransitionRule,
  ruleBA: SurfaceTransitionRule = ruleAB
): void {
  RULE_MAP.set(ruleKey(a, b), ruleAB);
  RULE_MAP.set(ruleKey(b, a), ruleBA);
}

// Declarative compatibility table — extend by adding pairs here without changing planner logic.
registerBidirectionalRule('grass', 'dirt', { priority: 90, strength: 1.0, contrast: 1.0 });
registerBidirectionalRule('grass', 'sand', { priority: 95, strength: 1.0, contrast: 0.92 });
registerBidirectionalRule('dirt', 'sand', { priority: 92, strength: 1.0, contrast: 0.95 });

registerBidirectionalRule('grass', 'snow', { priority: 96, strength: 1.0, contrast: 0.88 });
registerBidirectionalRule('dirt', 'snow', { priority: 93, strength: 1.0, contrast: 0.92 });
registerBidirectionalRule('sand', 'snow', { priority: 86, strength: 0.94, contrast: 0.92 });

for (const stoneKind of ['stone', 'mossy_stone', 'cracked_stone', 'cliff_rock'] as const) {
  registerBidirectionalRule('grass', stoneKind, { priority: 82, strength: 0.92, contrast: 1.06 });
  registerBidirectionalRule('dirt', stoneKind, { priority: 84, strength: 0.96, contrast: 1.04 });
  registerBidirectionalRule('sand', stoneKind, { priority: 80, strength: 0.9, contrast: 1.04 });
  registerBidirectionalRule('snow', stoneKind, { priority: 88, strength: 0.95, contrast: 0.95 });
}

registerBidirectionalRule('stone', 'mossy_stone', { priority: 76, strength: 0.94, contrast: 1.0 });
registerBidirectionalRule('stone', 'cracked_stone', { priority: 76, strength: 0.94, contrast: 1.0 });
registerBidirectionalRule('mossy_stone', 'cracked_stone', { priority: 76, strength: 0.92, contrast: 1.0 });
registerBidirectionalRule('cliff_rock', 'stone', { priority: 74, strength: 0.9, contrast: 1.02 });
registerBidirectionalRule('cliff_rock', 'mossy_stone', { priority: 74, strength: 0.9, contrast: 1.02 });
registerBidirectionalRule('cliff_rock', 'cracked_stone', { priority: 74, strength: 0.9, contrast: 1.02 });

registerBidirectionalRule('cave_floor', 'cracked_stone', { priority: 78, strength: 0.94, contrast: 1.0 });
registerBidirectionalRule('cave_floor', 'stone', { priority: 77, strength: 0.92, contrast: 1.0 });
registerBidirectionalRule('cave_floor', 'cliff_rock', { priority: 75, strength: 0.9, contrast: 1.02 });
registerBidirectionalRule('cave_floor', 'dirt', { priority: 75, strength: 0.9, contrast: 1.02 });
registerBidirectionalRule('cave_floor', 'sand', { priority: 74, strength: 0.88, contrast: 1.02 });

registerBidirectionalRule('flowers', 'grass', { priority: 85, strength: 0.96, contrast: 0.95 });
registerBidirectionalRule('flowers', 'dirt', { priority: 80, strength: 0.88, contrast: 1.0 });
registerBidirectionalRule('flowers', 'sand', { priority: 78, strength: 0.84, contrast: 1.0 });

registerBidirectionalRule('cobble', 'dirt', { priority: 64, strength: 0.78, contrast: 1.12 });
registerBidirectionalRule('cobble', 'grass', { priority: 62, strength: 0.74, contrast: 1.14 });
registerBidirectionalRule('cobble', 'mossy_stone', { priority: 66, strength: 0.82, contrast: 1.08 });
registerBidirectionalRule('cobble', 'sand', { priority: 60, strength: 0.72, contrast: 1.14 });

export const SURFACE_TRANSITION_RULES: ReadonlyMap<string, SurfaceTransitionRule> = RULE_MAP;

export function getSurfaceTransitionRule(
  fromSurface: TileAtlasKey,
  toSurface: TileAtlasKey
): SurfaceTransitionRule | null {
  if (fromSurface === toSurface) return null;
  return RULE_MAP.get(ruleKey(fromSurface, toSurface)) ?? null;
}

/**
 * Ensures both sides of a shared tile edge compute opposite noise offsets around the 0.5 midpoint,
 * guaranteeing exact pixel-for-pixel visual symmetry across boundaries and chunk seams.
 */
export function getCanonicalPairSign(
  primarySurface: TileAtlasKey,
  targetSurface: TileAtlasKey
): 1 | -1 {
  const idxA = TILE_ATLAS_INDEX[primarySurface] ?? 0;
  const idxB = TILE_ATLAS_INDEX[targetSurface] ?? 0;
  if (idxA !== idxB) {
    return idxA < idxB ? 1 : -1;
  }
  return primarySurface < targetSurface ? 1 : -1;
}

export function resolveSurfaceMaterialKey(map: MapDef, x: number, z: number): TileAtlasKey {
  const ch = map.grid[z]?.[x] ?? '.';
  const legend = map.legend[ch] ?? { tile: 'grass' as const, solid: false };
  const tileLevel = getTileHeightLevel(map, x, z);

  let tileKey: TileAtlasKey = legend.tile;
  if (tileKey === 'tall_grass') {
    tileKey = 'grass';
  } else if (tileKey === 'stone') {
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
    (tileKey === 'grass' || tileKey === 'dirt' || tileKey === 'flowers')
  ) {
    tileKey = 'snow';
  }

  return tileKey;
}

export interface SectorBlendSpec {
  /** World-space ring vertex A (CCW from center) */
  ax: number;
  az: number;
  /** World-space ring vertex B (CCW from center) */
  bx: number;
  bz: number;
  /** Target neighbor material for this sector, or null if plain primary surface */
  targetTile: TileAtlasKey | null;
  targetAtlasSlot: number;
  weightA: number;
  weightB: number;
  noiseSign: -1 | 0 | 1;
  contrast: number;
  /** True when endpoint A lies on an active transition seam (shared vertex shade match) */
  seamSmoothA: boolean;
  /** True when endpoint B lies on an active transition seam */
  seamSmoothB: boolean;
}

export interface TileTransitionPlan {
  x: number;
  z: number;
  level: number;
  primaryMaterial: TileAtlasKey;
  isProtected: boolean;
  hasTransition: boolean;
  /** Unique non-null target tiles across sectors; length <= 1 allows fast shared-ring indexing */
  uniqueTargets: TileAtlasKey[];
  sectors: SectorBlendSpec[];
}

export interface SurfaceTransitionPlan {
  width: number;
  height: number;
  primaryMaterials: TileAtlasKey[];
  levels: Uint8Array;
  protectedFlags: Uint8Array;
  tilePlans: TileTransitionPlan[];
}

interface EdgeTransitionInfo {
  targetTile: TileAtlasKey;
  weight: number;
  noiseSign: 1 | -1;
  contrast: number;
}

function computeProtectedSurfaceFlags(map: MapDef, width: number, height: number): Uint8Array {
  const flags = new Uint8Array(width * height);
  if (map.isInterior) {
    flags.fill(1);
    return flags;
  }

  for (let z = 0; z < height; z++) {
    const row = map.grid[z] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '.';
      const leg = map.legend[ch];
      if (!leg) continue;
      if (
        leg.tile === 'water' ||
        leg.tile === 'stairs' ||
        leg.tile === 'bridge' ||
        leg.tile === 'arena_floor' ||
        leg.ramp
      ) {
        flags[z * width + x] = 1;
      }
    }
  }

  for (const b of map.buildings) {
    for (let dz = 0; dz < b.depth; dz++) {
      for (let dx = 0; dx < b.width; dx++) {
        const bx = b.x + dx;
        const bz = b.z + dz;
        if (bx >= 0 && bx < width && bz >= 0 && bz < height) {
          flags[bz * width + bx] = 1;
        }
      }
    }
  }

  for (const w of map.warps) {
    if (w.x >= 0 && w.x < width && w.y >= 0 && w.y < height) {
      flags[w.y * width + w.x] = 1;
    }
  }

  return flags;
}

type EdgeSide = 'south' | 'east' | 'north' | 'west' | 'rim';

function classifyBoundaryEdge(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  isRimA: boolean,
  isRimB: boolean
): EdgeSide {
  if (isRimA && isRimB) return 'rim';
  const eps = 1e-4;
  const x0 = x - 0.5;
  const x1 = x + 0.5;
  const z0 = z - 0.5;
  const z1 = z + 0.5;

  if (Math.abs(az - z1) < eps && Math.abs(bz - z1) < eps) return 'south';
  if (Math.abs(ax - x1) < eps && Math.abs(bx - x1) < eps) return 'east';
  if (Math.abs(az - z0) < eps && Math.abs(bz - z0) < eps) return 'north';
  if (Math.abs(ax - x0) < eps && Math.abs(bx - x0) < eps) return 'west';
  return 'rim';
}

function isExactCorner(px: number, pz: number, x: number, z: number): 'sw' | 'se' | 'ne' | 'nw' | null {
  const eps = 1e-4;
  if (Math.abs(px - (x - 0.5)) < eps && Math.abs(pz - (z + 0.5)) < eps) return 'sw';
  if (Math.abs(px - (x + 0.5)) < eps && Math.abs(pz - (z + 0.5)) < eps) return 'se';
  if (Math.abs(px - (x + 0.5)) < eps && Math.abs(pz - (z - 0.5)) < eps) return 'ne';
  if (Math.abs(px - (x - 0.5)) < eps && Math.abs(pz - (z - 0.5)) < eps) return 'nw';
  return null;
}

export function planSurfaceTransitions(
  map: MapDef,
  contourAnalysis?: TerrainContourAnalysis | null
): SurfaceTransitionPlan {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  const total = width * height;

  const primaryMaterials = new Array<TileAtlasKey>(total);
  const levels = new Uint8Array(total);
  const protectedFlags = computeProtectedSurfaceFlags(map, width, height);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      levels[idx] = getTileHeightLevel(map, x, z);
      primaryMaterials[idx] = resolveSurfaceMaterialKey(map, x, z);
    }
  }

  // Evaluate edge compatibility symmetrically in global coordinates
  const evalEdge = (
    tx: number,
    tz: number,
    nx: number,
    nz: number
  ): EdgeTransitionInfo | null => {
    if (nx < 0 || nx >= width || nz < 0 || nz >= height) return null;
    const idxA = tz * width + tx;
    const idxB = nz * width + nx;
    if (protectedFlags[idxA] || protectedFlags[idxB]) return null;
    if (levels[idxA] !== levels[idxB]) return null;

    const matA = primaryMaterials[idxA];
    const matB = primaryMaterials[idxB];
    const rule = getSurfaceTransitionRule(matA, matB);
    if (!rule) return null;

    return {
      targetTile: matB,
      weight: SURFACE_TRANSITION_PARAMS.MAX_EDGE_BLEND_WEIGHT * rule.strength,
      noiseSign: getCanonicalPairSign(matA, matB),
      contrast: rule.contrast,
    };
  };

  // Precompute distinct unprotected material count per shared grid vertex (vx, vz) per elevation level
  const cornerSurfaceCounts = new Map<string, number>();
  const getCornerSurfaceCount = (vx: number, vz: number, level: number): number => {
    const key = `${vx},${vz},${level}`;
    const cached = cornerSurfaceCounts.get(key);
    if (cached !== undefined) return cached;

    const distinct = new Set<TileAtlasKey>();
    for (const [dx, dz] of [
      [-1, -1],
      [0, -1],
      [0, 0],
      [-1, 0],
    ] as const) {
      const tx = vx + dx;
      const tz = vz + dz;
      if (tx < 0 || tx >= width || tz < 0 || tz >= height) continue;
      const idx = tz * width + tx;
      if (!protectedFlags[idx] && levels[idx] === level) {
        distinct.add(primaryMaterials[idx]);
      }
    }
    const count = distinct.size;
    cornerSurfaceCounts.set(key, count);
    return count;
  };

  // Resolve diagonal corner transition when adjacent cardinal edges don't dictate one
  const evalDiagonalAtVertex = (
    tx: number,
    tz: number,
    sx: -1 | 1,
    sz: -1 | 1
  ): EdgeTransitionInfo | null => {
    const nx = tx + sx;
    const nz = tz + sz;
    if (nx < 0 || nx >= width || nz < 0 || nz >= height) return null;
    const idxT = tz * width + tx;
    const idxD = nz * width + nx;
    if (protectedFlags[idxT] || protectedFlags[idxD]) return null;
    const lvl = levels[idxT];
    if (levels[idxD] !== lvl) return null;

    // Cardinal intermediate tiles must stay open at the same level (don't leak through walls/drops)
    const idxC1 = tz * width + nx;
    const idxC2 = nz * width + tx;
    if (
      protectedFlags[idxC1] ||
      protectedFlags[idxC2] ||
      levels[idxC1] !== lvl ||
      levels[idxC2] !== lvl
    ) {
      return null;
    }

    const matT = primaryMaterials[idxT];
    const matD = primaryMaterials[idxD];
    const rule = getSurfaceTransitionRule(matT, matD);
    if (!rule) return null;

    const vx = sx === -1 ? tx : tx + 1;
    const vz = sz === -1 ? tz : tz + 1;
    const distinctCount = getCornerSurfaceCount(vx, vz, lvl);

    // When only 2 unprotected surfaces meet at (vx, vz), adjacent cardinal tiles already share
    // the 0.50 boundary weight at this vertex — match it so all 4 tiles meet seamlessly.
    const baseWeight =
      distinctCount >= 3
        ? SURFACE_TRANSITION_PARAMS.TRIPLE_JUNCTION_WEIGHT * rule.strength
        : SURFACE_TRANSITION_PARAMS.MAX_EDGE_BLEND_WEIGHT * rule.strength;

    return {
      targetTile: matD,
      weight: baseWeight,
      noiseSign: getCanonicalPairSign(matT, matD),
      contrast: rule.contrast,
    };
  };

  // Compute exact symmetric weight at shared grid vertex (vx, vz) for a given pair (matA, targetMat)
  const evalCornerWeightForEdge = (
    vx: number,
    vz: number,
    level: number,
    edgeInfo: EdgeTransitionInfo
  ): number => {
    const distinctCount = getCornerSurfaceCount(vx, vz, level);
    if (distinctCount >= 3) {
      return Math.min(
        edgeInfo.weight,
        SURFACE_TRANSITION_PARAMS.TRIPLE_JUNCTION_WEIGHT *
          (edgeInfo.weight / SURFACE_TRANSITION_PARAMS.MAX_EDGE_BLEND_WEIGHT)
      );
    }
    return edgeInfo.weight;
  };

  const tilePlans = new Array<TileTransitionPlan>(total);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      const level = levels[idx];
      const primaryMaterial = primaryMaterials[idx];
      const isProtected = Boolean(protectedFlags[idx]);

      if (isProtected || map.isInterior) {
        tilePlans[idx] = {
          x,
          z,
          level,
          primaryMaterial,
          isProtected,
          hasTransition: false,
          uniqueTargets: [],
          sectors: [],
        };
        continue;
      }

      const southInfo = evalEdge(x, z, x, z + 1);
      const eastInfo = evalEdge(x, z, x + 1, z);
      const northInfo = evalEdge(x, z, x, z - 1);
      const westInfo = evalEdge(x, z, x - 1, z);

      const swDiag = !southInfo && !westInfo ? evalDiagonalAtVertex(x, z, -1, 1) : null;
      const seDiag = !southInfo && !eastInfo ? evalDiagonalAtVertex(x, z, 1, 1) : null;
      const neDiag = !northInfo && !eastInfo ? evalDiagonalAtVertex(x, z, 1, -1) : null;
      const nwDiag = !northInfo && !westInfo ? evalDiagonalAtVertex(x, z, -1, -1) : null;

      const hasAnyNeighborTransition = Boolean(
        southInfo ||
          eastInfo ||
          northInfo ||
          westInfo ||
          swDiag ||
          seDiag ||
          neDiag ||
          nwDiag
      );

      if (!hasAnyNeighborTransition) {
        tilePlans[idx] = {
          x,
          z,
          level,
          primaryMaterial,
          isProtected: false,
          hasTransition: false,
          uniqueTargets: [],
          sectors: [],
        };
        continue;
      }

      // Build ordered boundary ring [SW -> SE -> NE -> NW], matching contour topPolygon when contoured
      const contour: TileContourGeometry | undefined = contourAnalysis?.tileContours[idx];
      const rawRing: ContourPoint2D[] =
        contour && contour.topPolygon.length >= 3
          ? contour.topPolygon
          : [
              { x: x - 0.5, z: z + 0.5, isRim: false, hasRise: false },
              { x: x + 0.5, z: z + 0.5, isRim: false, hasRise: false },
              { x: x + 0.5, z: z - 0.5, isRim: false, hasRise: false },
              { x: x - 0.5, z: z - 0.5, isRim: false, hasRise: false },
            ];

      const sectors: SectorBlendSpec[] = [];
      const uniqueTargetSet = new Set<TileAtlasKey>();

      const resolveCornerVertexForEdge = (
        corner: 'sw' | 'se' | 'ne' | 'nw',
        edgeInfo: EdgeTransitionInfo | null,
        diagFallback: EdgeTransitionInfo | null
      ): { weight: number; seamSmooth: boolean } => {
        const vx = corner === 'sw' || corner === 'nw' ? x : x + 1;
        const vz = corner === 'nw' || corner === 'ne' ? z : z + 1;
        if (edgeInfo) {
          return {
            weight: evalCornerWeightForEdge(vx, vz, level, edgeInfo),
            seamSmooth: true,
          };
        }
        if (diagFallback) {
          return { weight: diagFallback.weight, seamSmooth: true };
        }
        return { weight: 0, seamSmooth: false };
      };

      const pushSector = (
        ax: number,
        az: number,
        bx: number,
        bz: number,
        info: EdgeTransitionInfo | null,
        weightA: number,
        weightB: number,
        seamSmoothA: boolean,
        seamSmoothB: boolean
      ) => {
        if (!info || (weightA <= 1e-5 && weightB <= 1e-5)) {
          sectors.push({
            ax,
            az,
            bx,
            bz,
            targetTile: null,
            targetAtlasSlot: 0,
            weightA: 0,
            weightB: 0,
            noiseSign: 0,
            contrast: 1,
            seamSmoothA,
            seamSmoothB,
          });
          return;
        }
        uniqueTargetSet.add(info.targetTile);
        sectors.push({
          ax,
          az,
          bx,
          bz,
          targetTile: info.targetTile,
          targetAtlasSlot: TILE_ATLAS_INDEX[info.targetTile],
          weightA,
          weightB,
          noiseSign: info.noiseSign,
          contrast: info.contrast,
          seamSmoothA,
          seamSmoothB,
        });
      };

      const cornerDiagMap: Record<'sw' | 'se' | 'ne' | 'nw', EdgeTransitionInfo | null> = {
        sw: swDiag,
        se: seDiag,
        ne: neDiag,
        nw: nwDiag,
      };
      const cornerCardinalPair: Record<
        'sw' | 'se' | 'ne' | 'nw',
        readonly [EdgeTransitionInfo | null, EdgeTransitionInfo | null]
      > = {
        sw: [southInfo, westInfo],
        se: [southInfo, eastInfo],
        ne: [northInfo, eastInfo],
        nw: [northInfo, westInfo],
      };

      const nPts = rawRing.length;
      for (let i = 0; i < nPts; i++) {
        const pA = rawRing[i];
        const pB = rawRing[(i + 1) % nPts];
        const side = classifyBoundaryEdge(x, z, pA.x, pA.z, pB.x, pB.z, pA.isRim, pB.isRim);
        const cornerA = isExactCorner(pA.x, pA.z, x, z);
        const cornerB = isExactCorner(pB.x, pB.z, x, z);

        const hasCardinalCornerA = cornerA
          ? Boolean(cornerCardinalPair[cornerA][0] || cornerCardinalPair[cornerA][1])
          : false;
        const hasCardinalCornerB = cornerB
          ? Boolean(cornerCardinalPair[cornerB][0] || cornerCardinalPair[cornerB][1])
          : false;

        if (side === 'rim') {
          // Rim edges never cross flat ground transitions, but corners along a rim still smoothly terminate flat transitions
          const infoA = cornerA
            ? cornerCardinalPair[cornerA][0] ?? cornerCardinalPair[cornerA][1] ?? cornerDiagMap[cornerA]
            : null;
          const infoB = cornerB
            ? cornerCardinalPair[cornerB][0] ?? cornerCardinalPair[cornerB][1] ?? cornerDiagMap[cornerB]
            : null;
          const chosen = infoA ?? infoB;
          if (!chosen || (infoA && infoB && infoA.targetTile !== infoB.targetTile)) {
            pushSector(pA.x, pA.z, pB.x, pB.z, null, 0, 0, hasCardinalCornerA, hasCardinalCornerB);
          } else {
            const vxA = cornerA === 'sw' || cornerA === 'nw' ? x : x + 1;
            const vzA = cornerA === 'nw' || cornerA === 'ne' ? z : z + 1;
            const vxB = cornerB === 'sw' || cornerB === 'nw' ? x : x + 1;
            const vzB = cornerB === 'nw' || cornerB === 'ne' ? z : z + 1;
            const wA = infoA && cornerA ? evalCornerWeightForEdge(vxA, vzA, level, infoA) : 0;
            const wB = infoB && cornerB ? evalCornerWeightForEdge(vxB, vzB, level, infoB) : 0;
            pushSector(
              pA.x,
              pA.z,
              pB.x,
              pB.z,
              chosen,
              wA,
              wB,
              Boolean(infoA),
              Boolean(infoB)
            );
          }
          continue;
        }

        const edgeInfo =
          side === 'south'
            ? southInfo
            : side === 'east'
              ? eastInfo
              : side === 'north'
                ? northInfo
                : westInfo;

        const mx = (pA.x + pB.x) * 0.5;
        const mz = (pA.z + pB.z) * 0.5;
        const midWeight = edgeInfo ? edgeInfo.weight : 0;
        const midSeamSmooth = Boolean(edgeInfo);

        // First half: pA -> Midpoint
        if (edgeInfo) {
          const vA = cornerA
            ? resolveCornerVertexForEdge(cornerA, edgeInfo, cornerDiagMap[cornerA])
            : { weight: midWeight, seamSmooth: true };
          pushSector(
            pA.x,
            pA.z,
            mx,
            mz,
            edgeInfo,
            vA.weight,
            midWeight,
            vA.seamSmooth,
            midSeamSmooth
          );
        } else {
          // No edge transition along this side; still preserve localized corner/diagonal fade in the corner half
          const cornerDiagA = cornerA ? cornerDiagMap[cornerA] : null;
          const cornerAltA = cornerA
            ? cornerCardinalPair[cornerA][0] ?? cornerCardinalPair[cornerA][1]
            : null;
          const activeA = cornerAltA ?? cornerDiagA;
          const vxA = cornerA === 'sw' || cornerA === 'nw' ? x : x + 1;
          const vzA = cornerA === 'nw' || cornerA === 'ne' ? z : z + 1;
          const wA = activeA && cornerA ? evalCornerWeightForEdge(vxA, vzA, level, activeA) : 0;
          pushSector(
            pA.x,
            pA.z,
            mx,
            mz,
            activeA,
            wA,
            0,
            Boolean(activeA),
            false
          );
        }

        // Second half: Midpoint -> pB
        if (edgeInfo) {
          const vB = cornerB
            ? resolveCornerVertexForEdge(cornerB, edgeInfo, cornerDiagMap[cornerB])
            : { weight: midWeight, seamSmooth: true };
          pushSector(
            mx,
            mz,
            pB.x,
            pB.z,
            edgeInfo,
            midWeight,
            vB.weight,
            midSeamSmooth,
            vB.seamSmooth
          );
        } else {
          const cornerDiagB = cornerB ? cornerDiagMap[cornerB] : null;
          const cornerAltB = cornerB
            ? cornerCardinalPair[cornerB][0] ?? cornerCardinalPair[cornerB][1]
            : null;
          const activeB = cornerAltB ?? cornerDiagB;
          const vxB = cornerB === 'sw' || cornerB === 'nw' ? x : x + 1;
          const vzB = cornerB === 'nw' || cornerB === 'ne' ? z : z + 1;
          const wB = activeB && cornerB ? evalCornerWeightForEdge(vxB, vzB, level, activeB) : 0;
          pushSector(
            mx,
            mz,
            pB.x,
            pB.z,
            activeB,
            0,
            wB,
            false,
            Boolean(activeB)
          );
        }
      }

      const uniqueTargets = Array.from(uniqueTargetSet);
      tilePlans[idx] = {
        x,
        z,
        level,
        primaryMaterial,
        isProtected: false,
        hasTransition: uniqueTargets.length > 0,
        uniqueTargets,
        sectors,
      };
    }
  }

  return {
    width,
    height,
    primaryMaterials,
    levels,
    protectedFlags,
    tilePlans,
  };
}
