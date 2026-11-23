import { getTileHeightLevel, HEIGHT_UNIT } from '../domain/TerrainRules.ts';
import type { MapDef } from '../domain/types.ts';
import type { TileAtlasKey } from '../gfx/ProceduralTiles.ts';
import { resolveTerrainTileKey } from './TerrainSurfaceResolver.ts';

export const TERRAIN_CONTOUR_PARAMS = {
  MAX_EDGE_OFFSET: 0.22,
  WALKABLE_MAX_EDGE_OFFSET: 0.16,
  CONVEX_CHAMFER_SOLID: 0.28,
  CONVEX_CHAMFER_WALKABLE: 0.21,
  CONVEX_CHAMFER_JITTER: 0.04,
  CONCAVE_FILLET_INSET: 0.21,
  CONCAVE_FILLET_CURVE: 0.42,
  CORRIDOR_MAX_OFFSET: 0.10,
  CORRIDOR_MAX_CHAMFER: 0.14,
  WATER_BED_OFFSET: 0.16,
  MIN_TRIANGLE_AREA_2D: 1e-6,
} as const;

export type CornerKind = 'interior' | 'straight' | 'convex' | 'concave';
export type RegionKind = 'walkable' | 'cliff' | 'water';

export interface ContourPoint2D {
  x: number;
  z: number;
  isRim: boolean;
  hasRise: boolean;
}

export interface RimSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  yBottom: number;
  bottomLevel: number;
  lowerTile: TileAtlasKey;
  lowerIsTallGrass: boolean;
  isWaterEdge: boolean;
  dropLevels: number;
  uStart: number;
  uEnd: number;
}

export interface LowerFloorQuad {
  points: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  yBottom: number;
  bottomLevel: number;
  isWaterShore: boolean;
  lowerTile: TileAtlasKey;
  lowerIsTallGrass: boolean;
  creviceMask: readonly [number, number, number, number];
}

export interface LowerFloorTri {
  points: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  yBottom: number;
  bottomLevel: number;
  isWaterShore: boolean;
  lowerTile: TileAtlasKey;
  lowerIsTallGrass: boolean;
  creviceMask: readonly [number, number, number];
}

export interface TileContourGeometry {
  x: number;
  z: number;
  level: number;
  isPlainInterior: boolean;
  isProtected: boolean;
  isNarrowCorridor: boolean;
  corners: {
    nw: CornerKind;
    ne: CornerKind;
    se: CornerKind;
    sw: CornerKind;
  };
  /** Ordered SW -> SE -> NE -> NW around the tile so fan (Center, P_i, P_{i+1}) has +Y normal */
  topPolygon: ContourPoint2D[];
  /** Exposed drop segments in same SW -> SE -> NE -> NW order so normal (-dz, 0, dx) points outward */
  rimSegments: RimSegment[];
  lowerFloorQuads: LowerFloorQuad[];
  lowerFloorTris: LowerFloorTri[];
}

export interface TerrainRegion {
  id: number;
  level: number;
  kind: RegionKind;
  tileCount: number;
  hasProtectedTiles: boolean;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export interface TerrainContourAnalysis {
  width: number;
  height: number;
  seed: number;
  levels: Uint8Array;
  solidFlags: Uint8Array;
  waterFlags: Uint8Array;
  protectedFlags: Uint8Array;
  narrowCorridorFlags: Uint8Array;
  tileRegionIds: Int32Array;
  regions: TerrainRegion[];
  /** Shared grid vertex states (cols = width + 1, rows = height + 1) */
  vertexLocked: Uint8Array;
  tileContours: TileContourGeometry[];
}

function hashGrid2D(gx: number, gz: number, seed: number, salt = 0): number {
  let h =
    (Math.imul(gx | 0, 374761393) +
      Math.imul(gz | 0, 668265263) +
      Math.imul(seed | 0, 1597334677) +
      Math.imul(salt | 0, 2246822519)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function resolveTileKey(map: MapDef, x: number, z: number): TileAtlasKey {
  return resolveTerrainTileKey(map, x, z);
}

function getFloorY(level: number, isWater: boolean): number {
  return isWater
    ? level * HEIGHT_UNIT - TERRAIN_CONTOUR_PARAMS.WATER_BED_OFFSET
    : level * HEIGHT_UNIT;
}

function computeTileOffsetCap(
  isProtected: boolean,
  isWater: boolean,
  isSolid: boolean,
  isNarrowCorridor: boolean
): { edgeCap: number; chamferBase: number } {
  if (isProtected || isWater) {
    return { edgeCap: 0, chamferBase: 0 };
  }
  if (isNarrowCorridor) {
    return {
      edgeCap: TERRAIN_CONTOUR_PARAMS.CORRIDOR_MAX_OFFSET,
      chamferBase: TERRAIN_CONTOUR_PARAMS.CORRIDOR_MAX_CHAMFER,
    };
  }
  if (!isSolid) {
    return {
      edgeCap: TERRAIN_CONTOUR_PARAMS.WALKABLE_MAX_EDGE_OFFSET,
      chamferBase: TERRAIN_CONTOUR_PARAMS.CONVEX_CHAMFER_WALKABLE,
    };
  }
  return {
    edgeCap: TERRAIN_CONTOUR_PARAMS.MAX_EDGE_OFFSET,
    chamferBase: TERRAIN_CONTOUR_PARAMS.CONVEX_CHAMFER_SOLID,
  };
}

interface VertexCornerOffsets {
  /** Quadrant inside TL tile (vx-1, vz-1) for its SE corner */
  tlPoints: readonly [number, number][];
  tlCornerKind: CornerKind;
  /** Quadrant inside TR tile (vx, vz-1) for its SW corner */
  trPoints: readonly [number, number][];
  trCornerKind: CornerKind;
  /** Quadrant inside BR tile (vx, vz) for its NW corner */
  brPoints: readonly [number, number][];
  brCornerKind: CornerKind;
  /** Quadrant inside BL tile (vx-1, vz) for its NE corner */
  blPoints: readonly [number, number][];
  blCornerKind: CornerKind;
  /** Lower floor triangles created inside the high tile when corner is chamfered or concaved */
  concaveNotchL?: number;
  concaveNotchWater?: boolean;
  concaveNotchTile?: TileAtlasKey;
  concaveNotchTallGrass?: boolean;
}

function computeSharedVertexGeometry(
  map: MapDef,
  vx: number,
  vz: number,
  width: number,
  height: number,
  seed: number,
  levels: Uint8Array,
  solidFlags: Uint8Array,
  waterFlags: Uint8Array,
  archProtectedFlags: Uint8Array,
  narrowCorridorFlags: Uint8Array,
  vertexLocked: Uint8Array
): VertexCornerOffsets {
  const wx = vx - 0.5;
  const wz = vz - 0.5;
  const vIdx = vz * (width + 1) + vx;

  const singlePoint: readonly [number, number][] = [[wx, wz]];
  const defaultOut: VertexCornerOffsets = {
    tlPoints: singlePoint,
    tlCornerKind: 'interior',
    trPoints: singlePoint,
    trCornerKind: 'interior',
    brPoints: singlePoint,
    brCornerKind: 'interior',
    blPoints: singlePoint,
    blCornerKind: 'interior',
  };

  if (vertexLocked[vIdx] || vx <= 0 || vx >= width || vz <= 0 || vz >= height) {
    return defaultOut;
  }

  const coords: readonly [number, number][] = [
    [vx - 1, vz - 1], // 0: TL
    [vx, vz - 1], // 1: TR
    [vx, vz], // 2: BR
    [vx - 1, vz], // 3: BL
  ];

  const tileIdx = coords.map(([tx, tz]) => tz * width + tx);
  const h = tileIdx.map((i) => levels[i]);

  // Lock vertices touching architectural/playable tiles (stairs/bridge/buildings/warps/cobble/interiors).
  // Natural water-to-land vertices stay unlocked so lakes and riverbanks form organic curved shorelines.
  for (const idx of tileIdx) {
    if (archProtectedFlags[idx]) {
      vertexLocked[vIdx] = 1;
      return defaultOut;
    }
  }

  const distinctHeights = new Set(h);
  if (distinctHeights.size <= 1) {
    return defaultOut;
  }
  if (distinctHeights.size >= 3) {
    // 3+ distinct terrain heights meeting at one vertex stay exact to prevent multi-tier gaps
    vertexLocked[vIdx] = 1;
    return defaultOut;
  }

  const low = Math.min(h[0], h[1], h[2], h[3]);
  const high = Math.max(h[0], h[1], h[2], h[3]);
  const isHigh = [h[0] === high, h[1] === high, h[2] === high, h[3] === high];
  const highCount =
    (isHigh[0] ? 1 : 0) + (isHigh[1] ? 1 : 0) + (isHigh[2] ? 1 : 0) + (isHigh[3] ? 1 : 0);

  // Prevent mixed water + land at the lower level from causing ambiguous lower-floor pocket fills,
  // and keep any unexpected elevated water locked flush.
  let hasHighWater = false;
  let hasLowWater = false;
  let hasLowLand = false;
  for (let s = 0; s < 4; s++) {
    const idx = tileIdx[s];
    if (isHigh[s]) {
      if (waterFlags[idx]) hasHighWater = true;
    } else {
      if (waterFlags[idx]) hasLowWater = true;
      else hasLowLand = true;
    }
  }
  if (hasHighWater || (hasLowWater && hasLowLand)) {
    vertexLocked[vIdx] = 1;
    return defaultOut;
  }

  const edgeCapAt = (slot: number): number => {
    const idx = tileIdx[slot];
    return computeTileOffsetCap(
      Boolean(archProtectedFlags[idx]),
      Boolean(waterFlags[idx]),
      Boolean(solidFlags[idx]),
      Boolean(narrowCorridorFlags[idx])
    ).edgeCap;
  };

  const chamferAt = (slot: number): number => {
    const idx = tileIdx[slot];
    const base = computeTileOffsetCap(
      Boolean(archProtectedFlags[idx]),
      Boolean(waterFlags[idx]),
      Boolean(solidFlags[idx]),
      Boolean(narrowCorridorFlags[idx])
    ).chamferBase;
    if (base <= 0) return 0;
    const jitter =
      (hashGrid2D(vx, vz, seed, 11 + slot) - 0.5) *
      2 *
      TERRAIN_CONTOUR_PARAMS.CONVEX_CHAMFER_JITTER;
    return clamp(base + jitter, 0.10, base + TERRAIN_CONTOUR_PARAMS.CONVEX_CHAMFER_JITTER);
  };

  // Helper to resolve tile display info for a low quadrant slot
  const getLowInfo = (slot: number) => {
    const [tx, tz] = coords[slot];
    const ch = map.grid[tz]?.[tx] ?? '.';
    return {
      level: low,
      isWater: Boolean(waterFlags[tileIdx[slot]]),
      tile: resolveTileKey(map, tx, tz),
      isTallGrass: map.legend[ch]?.tile === 'tall_grass',
    };
  };

  // --- CASE 1: highCount === 1 (one convex corner among 3 lower tiles) ---
  // Also handles highCount === 2 checkerboard diagonal naturally per-corner!
  const isCheckerboard =
    highCount === 2 && isHigh[0] === isHigh[2] && isHigh[1] === isHigh[3];

  if (highCount === 1 || isCheckerboard) {
    // Ordered in [SW -> SE -> NE -> NW] order for each tile's corner!
    // Wait: let's return the points for each tile corner IN THAT TILE'S [SW -> SE -> NE -> NW] loop order:
    // - TL (slot 0) owns its SE corner: comes from S edge (+X) -> E edge (-Z). Point1=(wx - insetZ? no, S edge sits at z=wz) -> (wx - c, wz), Point2=(wx, wz - c).
    // - TR (slot 1) owns its SW corner: comes from W edge (+Z) -> S edge (+X). Point1=(wx, wz - c), Point2=(wx + c, wz).
    // - BR (slot 2) owns its NW corner: comes from N edge (-X) -> W edge (+Z). Point1=(wx + c, wz), Point2=(wx, wz + c).
    // - BL (slot 3) owns its NE corner: comes from E edge (-Z) -> N edge (-X). Point1=(wx, wz + c), Point2=(wx - c, wz).
    const c0 = isHigh[0] ? chamferAt(0) : 0;
    const c1 = isHigh[1] ? chamferAt(1) : 0;
    const c2 = isHigh[2] ? chamferAt(2) : 0;
    const c3 = isHigh[3] ? chamferAt(3) : 0;

    return {
      tlPoints: isHigh[0] ? [[wx - c0, wz], [wx, wz - c0]] : singlePoint,
      tlCornerKind: isHigh[0] ? 'convex' : 'interior',
      trPoints: isHigh[1] ? [[wx, wz - c1], [wx + c1, wz]] : singlePoint,
      trCornerKind: isHigh[1] ? 'convex' : 'interior',
      brPoints: isHigh[2] ? [[wx + c2, wz], [wx, wz + c2]] : singlePoint,
      brCornerKind: isHigh[2] ? 'convex' : 'interior',
      blPoints: isHigh[3] ? [[wx, wz + c3], [wx - c3, wz]] : singlePoint,
      blCornerKind: isHigh[3] ? 'convex' : 'interior',
    };
  }

  // --- CASE 2: highCount === 2 along a straight cliff edge ---
  if (highCount === 2) {
    // Random inward displacement in [0, min(edgeCapA, edgeCapB)] strictly into the high side
    const hVal = hashGrid2D(vx, vz, seed, 23);

    if (isHigh[0] && isHigh[1]) {
      // High on North (TL & TR), drops South onto BL & BR -> retract -Z into North tiles
      const cap = Math.min(edgeCapAt(0), edgeCapAt(1));
      const d = hVal * cap;
      const pt: readonly [number, number][] = [[wx, wz - d]];
      return {
        tlPoints: pt,
        tlCornerKind: 'straight',
        trPoints: pt,
        trCornerKind: 'straight',
        brPoints: singlePoint,
        brCornerKind: 'interior',
        blPoints: singlePoint,
        blCornerKind: 'interior',
      };
    }
    if (isHigh[2] && isHigh[3]) {
      // High on South (BR & BL), drops North -> retract +Z into South tiles
      const cap = Math.min(edgeCapAt(2), edgeCapAt(3));
      const d = hVal * cap;
      const pt: readonly [number, number][] = [[wx, wz + d]];
      return {
        tlPoints: singlePoint,
        tlCornerKind: 'interior',
        trPoints: singlePoint,
        trCornerKind: 'interior',
        brPoints: pt,
        brCornerKind: 'straight',
        blPoints: pt,
        blCornerKind: 'straight',
      };
    }
    if (isHigh[0] && isHigh[3]) {
      // High on West (TL & BL), drops East -> retract -X into West tiles
      const cap = Math.min(edgeCapAt(0), edgeCapAt(3));
      const d = hVal * cap;
      const pt: readonly [number, number][] = [[wx - d, wz]];
      return {
        tlPoints: pt,
        tlCornerKind: 'straight',
        trPoints: singlePoint,
        trCornerKind: 'interior',
        brPoints: singlePoint,
        brCornerKind: 'interior',
        blPoints: pt,
        blCornerKind: 'straight',
      };
    }
    if (isHigh[1] && isHigh[2]) {
      // High on East (TR & BR), drops West -> retract +X into East tiles
      const cap = Math.min(edgeCapAt(1), edgeCapAt(2));
      const d = hVal * cap;
      const pt: readonly [number, number][] = [[wx + d, wz]];
      return {
        tlPoints: singlePoint,
        tlCornerKind: 'interior',
        trPoints: pt,
        trCornerKind: 'straight',
        brPoints: pt,
        brCornerKind: 'straight',
        blPoints: singlePoint,
        blCornerKind: 'interior',
      };
    }
  }

  // --- CASE 3: highCount === 3 (CONCAVE L-corner where 1 slot is LOW and 3 slots are HIGH) ---
  const lowSlot = !isHigh[0] ? 0 : !isHigh[1] ? 1 : !isHigh[2] ? 2 : 3;
  const diagSlot = (lowSlot + 2) % 4;
  const cwSlot = (lowSlot + 1) % 4;
  const ccwSlot = (lowSlot + 3) % 4;

  const minCap = Math.min(edgeCapAt(cwSlot), edgeCapAt(ccwSlot), edgeCapAt(diagSlot));
  const fillet = clamp(
    TERRAIN_CONTOUR_PARAMS.CONCAVE_FILLET_INSET *
      (0.85 + 0.3 * hashGrid2D(vx, vz, seed, 37)),
    0,
    minCap > 0 ? Math.min(TERRAIN_CONTOUR_PARAMS.MAX_EDGE_OFFSET, Math.max(0.10, minCap)) : 0
  );

  if (fillet <= 1e-4) {
    return defaultOut;
  }

  const lowInfo = getLowInfo(lowSlot);
  const k = TERRAIN_CONTOUR_PARAMS.CONCAVE_FILLET_CURVE;

  // Build exact shared endpoints & curved fillet inside diagSlot (matching [SW -> SE -> NE -> NW] winding!)
  if (lowSlot === 0) {
    // TL is LOW; TR(1) SW corner retracts +X to (wx+fillet, wz), BL(3) NE corner retracts +Z to (wx, wz+fillet),
    // BR(2) NW corner goes N->W: (wx+fillet, wz) -> (wx+fillet*k, wz+fillet*k) -> (wx, wz+fillet)
    return {
      tlPoints: singlePoint,
      tlCornerKind: 'interior',
      trPoints: [[wx + fillet, wz]],
      trCornerKind: 'concave',
      brPoints: [
        [wx + fillet, wz],
        [wx + fillet * k, wz + fillet * k],
        [wx, wz + fillet],
      ],
      brCornerKind: 'concave',
      blPoints: [[wx, wz + fillet]],
      blCornerKind: 'concave',
      concaveNotchL: lowInfo.level,
      concaveNotchWater: lowInfo.isWater,
      concaveNotchTile: lowInfo.tile,
      concaveNotchTallGrass: lowInfo.isTallGrass,
    };
  }
  if (lowSlot === 1) {
    // TR is LOW; BR(2) NW corner retracts +Z to (wx, wz+fillet), TL(0) SE corner retracts -X to (wx-fillet, wz),
    // BL(3) NE corner goes E->N: (wx, wz+fillet) -> (wx-fillet*k, wz+fillet*k) -> (wx-fillet, wz)
    return {
      tlPoints: [[wx - fillet, wz]],
      tlCornerKind: 'concave',
      trPoints: singlePoint,
      trCornerKind: 'interior',
      brPoints: [[wx, wz + fillet]],
      brCornerKind: 'concave',
      blPoints: [
        [wx, wz + fillet],
        [wx - fillet * k, wz + fillet * k],
        [wx - fillet, wz],
      ],
      blCornerKind: 'concave',
      concaveNotchL: lowInfo.level,
      concaveNotchWater: lowInfo.isWater,
      concaveNotchTile: lowInfo.tile,
      concaveNotchTallGrass: lowInfo.isTallGrass,
    };
  }
  if (lowSlot === 2) {
    // BR is LOW; BL(3) NE corner retracts -X to (wx-fillet, wz), TR(1) SW corner retracts -Z to (wx, wz-fillet),
    // TL(0) SE corner goes S->E: (wx-fillet, wz) -> (wx-fillet*k, wz-fillet*k) -> (wx, wz-fillet)
    return {
      tlPoints: [
        [wx - fillet, wz],
        [wx - fillet * k, wz - fillet * k],
        [wx, wz - fillet],
      ],
      tlCornerKind: 'concave',
      trPoints: [[wx, wz - fillet]],
      trCornerKind: 'concave',
      brPoints: singlePoint,
      brCornerKind: 'interior',
      blPoints: [[wx - fillet, wz]],
      blCornerKind: 'concave',
      concaveNotchL: lowInfo.level,
      concaveNotchWater: lowInfo.isWater,
      concaveNotchTile: lowInfo.tile,
      concaveNotchTallGrass: lowInfo.isTallGrass,
    };
  }
  // lowSlot === 3 (BL is LOW); TL(0) SE corner retracts -Z to (wx, wz-fillet), BR(2) NW corner retracts +X to (wx+fillet, wz),
  // TR(1) SW corner goes W->S: (wx, wz-fillet) -> (wx+fillet*k, wz-fillet*k) -> (wx+fillet, wz)
  return {
    tlPoints: [[wx, wz - fillet]],
    tlCornerKind: 'concave',
    trPoints: [
      [wx, wz - fillet],
      [wx + fillet * k, wz - fillet * k],
      [wx + fillet, wz],
    ],
    trCornerKind: 'concave',
    brPoints: [[wx + fillet, wz]],
    brCornerKind: 'concave',
    blPoints: singlePoint,
    blCornerKind: 'interior',
    concaveNotchL: lowInfo.level,
    concaveNotchWater: lowInfo.isWater,
    concaveNotchTile: lowInfo.tile,
    concaveNotchTallGrass: lowInfo.isTallGrass,
  };
}

function triArea2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number
): number {
  return Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * 0.5;
}

export function analyzeTerrainContours(map: MapDef): TerrainContourAnalysis {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  const total = width * height;
  const seed = map.decoration?.seed ?? 17;

  const levels = new Uint8Array(total);
  const solidFlags = new Uint8Array(total);
  const waterFlags = new Uint8Array(total);
  const protectedFlags = new Uint8Array(total);
  const archProtectedFlags = new Uint8Array(total);
  const narrowCorridorFlags = new Uint8Array(total);
  const tileRegionIds = new Int32Array(total).fill(-1);
  const vertexLocked = new Uint8Array((width + 1) * (height + 1));

  const lockVertexAt = (vx: number, vz: number) => {
    if (vx >= 0 && vx <= width && vz >= 0 && vz <= height) {
      vertexLocked[vz * (width + 1) + vx] = 1;
    }
  };
  const lockTileVertices = (tx: number, tz: number) => {
    lockVertexAt(tx, tz);
    lockVertexAt(tx + 1, tz);
    lockVertexAt(tx, tz + 1);
    lockVertexAt(tx + 1, tz + 1);
  };

  // Pass 1: Extract grid properties & mark protected architectural/playable structures
  for (let z = 0; z < height; z++) {
    const row = map.grid[z] ?? '';
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      const ch = row[x] ?? '.';
      const legend = map.legend[ch] ?? { tile: 'grass' as const, solid: false };
      levels[idx] = getTileHeightLevel(map, x, z);
      solidFlags[idx] = legend.solid ? 1 : 0;
      const isWater = legend.tile === 'water';
      waterFlags[idx] = isWater ? 1 : 0;

      const isArchitectural =
        legend.tile === 'stairs' ||
        legend.tile === 'bridge' ||
        legend.tile === 'cobble' ||
        legend.tile === 'arena_floor' ||
        Boolean(legend.ramp);

      if (map.isInterior || isWater || isArchitectural) {
        protectedFlags[idx] = 1;
      }
      if (map.isInterior || isArchitectural) {
        archProtectedFlags[idx] = 1;
      }
      if (legend.tile === 'stairs' || legend.tile === 'bridge') {
        lockTileVertices(x, z);
      }
    }
  }

  for (const b of map.buildings) {
    for (let dz = 0; dz < b.depth; dz++) {
      for (let dx = 0; dx < b.width; dx++) {
        const bx = b.x + dx;
        const bz = b.z + dz;
        if (bx >= 0 && bx < width && bz >= 0 && bz < height) {
          protectedFlags[bz * width + bx] = 1;
          archProtectedFlags[bz * width + bx] = 1;
          lockTileVertices(bx, bz);
        }
      }
    }
  }

  for (const w of map.warps) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const wx = w.x + dx;
        const wz = w.y + dz;
        if (wx >= 0 && wx < width && wz >= 0 && wz < height) {
          protectedFlags[wz * width + wx] = 1;
          archProtectedFlags[wz * width + wx] = 1;
          if (dx === 0 && dz === 0) lockTileVertices(wx, wz);
        }
      }
    }
  }

  // Also protect 1-ring cardinal neighbors of stairs/bridges so climb edges never chamfer/retract
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const ch = map.grid[z]?.[x] ?? '.';
      const tile = map.legend[ch]?.tile;
      if (tile === 'stairs' || tile === 'bridge') {
        for (const [dx, dz] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nx < width && nz >= 0 && nz < height) {
            protectedFlags[nz * width + nx] = 1;
            archProtectedFlags[nz * width + nx] = 1;
          }
        }
      }
    }
  }

  // Pass 2: Connected Terrain Regions via BFS (flood-fill by level + RegionKind)
  const regionKindOf = (idx: number): RegionKind =>
    waterFlags[idx] ? 'water' : solidFlags[idx] ? 'cliff' : 'walkable';

  const regions: TerrainRegion[] = [];
  const queue = new Int32Array(total);
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const startIdx = z * width + x;
      if (tileRegionIds[startIdx] !== -1) continue;

      const regionId = regions.length;
      const level = levels[startIdx];
      const kind = regionKindOf(startIdx);
      let hasProtectedTiles = Boolean(protectedFlags[startIdx]);
      let minX = x;
      let maxX = x;
      let minZ = z;
      let maxZ = z;

      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      tileRegionIds[startIdx] = regionId;

      while (head < tail) {
        const cur = queue[head++];
        const cx = cur % width;
        const cz = (cur / width) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cz < minZ) minZ = cz;
        if (cz > maxZ) maxZ = cz;
        if (protectedFlags[cur]) hasProtectedTiles = true;

        const nbrs = [
          cx > 0 ? cur - 1 : -1,
          cx + 1 < width ? cur + 1 : -1,
          cz > 0 ? cur - width : -1,
          cz + 1 < height ? cur + width : -1,
        ];
        for (const nIdx of nbrs) {
          if (
            nIdx >= 0 &&
            tileRegionIds[nIdx] === -1 &&
            levels[nIdx] === level &&
            regionKindOf(nIdx) === kind
          ) {
            tileRegionIds[nIdx] = regionId;
            queue[tail++] = nIdx;
          }
        }
      }

      regions.push({
        id: regionId,
        level,
        kind,
        tileCount: tail,
        hasProtectedTiles,
        bounds: { minX, maxX, minZ, maxZ },
      });
    }
  }

  // Pass 3: Detect narrow walkable corridors (1 or 2 tiles wide between drops/walls)
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      if (solidFlags[idx] || waterFlags[idx]) continue;
      const h = levels[idx];

      // Horizontal walkable run at same height & non-solid
      let xLeft = x;
      while (xLeft > 0) {
        const lIdx = z * width + (xLeft - 1);
        if (solidFlags[lIdx] || waterFlags[lIdx] || levels[lIdx] !== h) break;
        xLeft--;
      }
      let xRight = x;
      while (xRight + 1 < width) {
        const rIdx = z * width + (xRight + 1);
        if (solidFlags[rIdx] || waterFlags[rIdx] || levels[rIdx] !== h) break;
        xRight++;
      }
      if (xRight - xLeft + 1 <= 2 && xLeft > 0 && xRight + 1 < width) {
        narrowCorridorFlags[idx] = 1;
        continue;
      }

      // Vertical walkable run at same height & non-solid
      let zTop = z;
      while (zTop > 0) {
        const uIdx = (zTop - 1) * width + x;
        if (solidFlags[uIdx] || waterFlags[uIdx] || levels[uIdx] !== h) break;
        zTop--;
      }
      let zBot = z;
      while (zBot + 1 < height) {
        const dIdx = (zBot + 1) * width + x;
        if (solidFlags[dIdx] || waterFlags[dIdx] || levels[dIdx] !== h) break;
        zBot++;
      }
      if (zBot - zTop + 1 <= 2 && zTop > 0 && zBot + 1 < height) {
        narrowCorridorFlags[idx] = 1;
      }
    }
  }

  // Pass 4: Compute shared grid vertex corner configurations once across the entire map
  const vCols = width + 1;
  const vRows = height + 1;
  const vertexStates: VertexCornerOffsets[] = new Array(vCols * vRows);
  for (let vz = 0; vz < vRows; vz++) {
    for (let vx = 0; vx < vCols; vx++) {
      vertexStates[vz * vCols + vx] = computeSharedVertexGeometry(
        map,
        vx,
        vz,
        width,
        height,
        seed,
        levels,
        solidFlags,
        waterFlags,
        archProtectedFlags,
        narrowCorridorFlags,
        vertexLocked
      );
    }
  }

  // Pass 5: Build deterministic per-tile organic contour geometry
  const tileContours: TileContourGeometry[] = new Array(total);
  const edgeMidOffset = (
    ex: number,
    ez: number,
    horizontal: boolean,
    tx: number,
    tz: number
  ): number => {
    const idx = tz * width + tx;
    const { edgeCap } = computeTileOffsetCap(
      Boolean(archProtectedFlags[idx]),
      Boolean(waterFlags[idx]),
      Boolean(solidFlags[idx]),
      Boolean(narrowCorridorFlags[idx])
    );
    if (edgeCap <= 0) return 0;
    // Slight deterministic organic erosion [0 .. edgeCap]
    return hashGrid2D(ex, ez, seed, horizontal ? 51 : 67) * edgeCap;
  };

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      const level = levels[idx];
      const x0 = x - 0.5;
      const x1 = x + 0.5;
      const z0 = z - 0.5;
      const z1 = z + 0.5;

      const isProtected = Boolean(protectedFlags[idx]);
      const isArchProtected = Boolean(archProtectedFlags[idx]);
      const isNarrowCorridor = Boolean(narrowCorridorFlags[idx]);

      const nLevel = z > 0 ? levels[(z - 1) * width + x] : level;
      const sLevel = z + 1 < height ? levels[(z + 1) * width + x] : level;
      const wLevel = x > 0 ? levels[z * width + (x - 1)] : level;
      const eLevel = x + 1 < width ? levels[z * width + (x + 1)] : level;

      const dropN = nLevel < level;
      const dropS = sLevel < level;
      const dropW = wLevel < level;
      const dropE = eLevel < level;

      const riseN = nLevel > level;
      const riseS = sLevel > level;
      const riseW = wLevel > level;
      const riseE = eLevel > level;

      // Corners of tile (x, z) map to the 4 surrounding grid vertices:
      // SW = vertex (x, z+1) where this tile is TR (slot 1)
      // SE = vertex (x+1, z+1) where this tile is TL (slot 0)
      // NE = vertex (x+1, z) where this tile is BL (slot 3)
      // NW = vertex (x, z) where this tile is BR (slot 2)
      const vSW = vertexStates[(z + 1) * vCols + x];
      const vSE = vertexStates[(z + 1) * vCols + (x + 1)];
      const vNE = vertexStates[z * vCols + (x + 1)];
      const vNW = vertexStates[z * vCols + x];

      const swPts = vSW.trPoints;
      const sePts = vSE.tlPoints;
      const nePts = vNE.blPoints;
      const nwPts = vNW.brPoints;

      const swKind = vSW.trCornerKind;
      const seKind = vSE.tlCornerKind;
      const neKind = vNE.blCornerKind;
      const nwKind = vNW.brCornerKind;

      const midOffsetS =
        dropS && !isArchProtected ? edgeMidOffset(x, z + 1, true, x, z) : 0;
      const midOffsetE =
        dropE && !isArchProtected ? edgeMidOffset(x + 1, z, false, x, z) : 0;
      const midOffsetN =
        dropN && !isArchProtected ? edgeMidOffset(x, z, true, x, z) : 0;
      const midOffsetW =
        dropW && !isArchProtected ? edgeMidOffset(x, z, false, x, z) : 0;

      const isSingleSquareCorner = (
        pts: readonly [number, number][],
        ex: number,
        ez: number
      ) => pts.length === 1 && pts[0][0] === ex && pts[0][1] === ez;

      const isPlainInterior =
        !dropN &&
        !dropS &&
        !dropW &&
        !dropE &&
        isSingleSquareCorner(swPts, x0, z1) &&
        isSingleSquareCorner(sePts, x1, z1) &&
        isSingleSquareCorner(nePts, x1, z0) &&
        isSingleSquareCorner(nwPts, x0, z0);

      const getLowerTileInfo = (nx: number, nz: number) => {
        const nIdx = nz * width + nx;
        let nLevelVal = levels[nIdx];
        const nWater = Boolean(waterFlags[nIdx]);
        const nCh = map.grid[nz]?.[nx] ?? '.';
        const nLegend = map.legend[nCh];
        if (nLegend?.tile === 'stairs') {
          if (nx > 0) nLevelVal = Math.min(nLevelVal, levels[nz * width + (nx - 1)]);
          if (nx + 1 < width) nLevelVal = Math.min(nLevelVal, levels[nz * width + (nx + 1)]);
          if (nz > 0) nLevelVal = Math.min(nLevelVal, levels[(nz - 1) * width + nx]);
          if (nz + 1 < height) nLevelVal = Math.min(nLevelVal, levels[(nz + 1) * width + nx]);
        }
        return {
          level: nLevelVal,
          yBottom: getFloorY(nLevelVal, nWater),
          isWater: nWater,
          tile: resolveTileKey(map, nx, nz),
          isTallGrass: nLegend?.tile === 'tall_grass',
        };
      };

      const topPolygon: ContourPoint2D[] = [];
      const rimSegments: RimSegment[] = [];
      const lowerFloorQuads: LowerFloorQuad[] = [];
      const lowerFloorTris: LowerFloorTri[] = [];

      const pushCorner = (
        pts: readonly [number, number][],
        kind: CornerKind,
        vState: VertexCornerOffsets,
        edgeOuterX: number,
        edgeOuterZ: number,
        riseA: boolean,
        riseB: boolean
      ) => {
        for (let i = 0; i < pts.length; i++) {
          topPolygon.push({
            x: pts[i][0],
            z: pts[i][1],
            isRim: kind !== 'interior',
            hasRise: riseA || riseB,
          });
        }

        // Emit corner cliff rim segments & lower-floor fills for convex/concave corners
        if (pts.length >= 2) {
          // Determine lower height/tile for this corner
          let cornerLevel = level - 1;
          let cornerWater = false;
          let cornerTile: TileAtlasKey = 'grass';
          let cornerTallGrass = false;

          if (kind === 'concave' && vState.concaveNotchL !== undefined) {
            cornerLevel = vState.concaveNotchL;
            cornerWater = Boolean(vState.concaveNotchWater);
            cornerTile = vState.concaveNotchTile ?? 'grass';
            cornerTallGrass = Boolean(vState.concaveNotchTallGrass);
          } else {
            // Convex corner: take the diagonal neighbor if lower, else lower of the 2 cardinal drops
            const diagX = edgeOuterX < x ? x - 1 : x + 1;
            const diagZ = edgeOuterZ < z ? z - 1 : z + 1;
            if (diagX >= 0 && diagX < width && diagZ >= 0 && diagZ < height) {
              const info = getLowerTileInfo(diagX, diagZ);
              cornerLevel = info.level;
              cornerWater = info.isWater;
              cornerTile = info.tile;
              cornerTallGrass = info.isTallGrass;
            }
          }

          const yBot = getFloorY(cornerLevel, cornerWater);
          const dropLevels = Math.max(1, level - cornerLevel);
          const segCount = pts.length - 1;
          for (let i = 0; i < segCount; i++) {
            rimSegments.push({
              ax: pts[i][0],
              az: pts[i][1],
              bx: pts[i + 1][0],
              bz: pts[i + 1][1],
              yBottom: yBot,
              bottomLevel: cornerLevel,
              lowerTile: cornerTile,
              lowerIsTallGrass: cornerTallGrass,
              isWaterEdge: cornerWater,
              dropLevels,
              uStart: i / segCount,
              uEnd: (i + 1) / segCount,
            });
          }

          // Lower floor fill inside the clipped corner triangle/fan from outer square corner (edgeOuterX, edgeOuterZ)
          for (let i = 0; i < segCount; i++) {
            const ax = pts[i][0];
            const az = pts[i][1];
            const bx = pts[i + 1][0];
            const bz = pts[i + 1][1];
            if (
              triArea2D(edgeOuterX, edgeOuterZ, ax, az, bx, bz) >
              TERRAIN_CONTOUR_PARAMS.MIN_TRIANGLE_AREA_2D
            ) {
              // Winding: keep +Y normal ((B - Outer) × (A - Outer) or check sign)
              const cross =
                (ax - edgeOuterX) * (bz - edgeOuterZ) -
                (bx - edgeOuterX) * (az - edgeOuterZ);
              if (cross > 0) {
                lowerFloorTris.push({
                  points: [
                    [edgeOuterX, edgeOuterZ],
                    [bx, bz],
                    [ax, az],
                  ],
                  yBottom: yBot,
                  bottomLevel: cornerLevel,
                  isWaterShore: cornerWater,
                  lowerTile: cornerTile,
                  lowerIsTallGrass: cornerTallGrass,
                  creviceMask: [0.35, 0.85, 0.85],
                });
              } else {
                lowerFloorTris.push({
                  points: [
                    [edgeOuterX, edgeOuterZ],
                    [ax, az],
                    [bx, bz],
                  ],
                  yBottom: yBot,
                  bottomLevel: cornerLevel,
                  isWaterShore: cornerWater,
                  lowerTile: cornerTile,
                  lowerIsTallGrass: cornerTallGrass,
                  creviceMask: [0.35, 0.85, 0.85],
                });
              }
            }
          }
        }
      };

      const pushEdgeMidAndSegments = (
        startPt: readonly [number, number],
        endPt: readonly [number, number],
        startKind: CornerKind,
        endKind: CornerKind,
        rawOuterStartX: number,
        rawOuterStartZ: number,
        rawOuterEndX: number,
        rawOuterEndZ: number,
        midPtX: number,
        midPtZ: number,
        isDrop: boolean,
        hasRise: boolean,
        hasMid: boolean,
        nx: number,
        nz: number
      ) => {
        if (hasMid) {
          topPolygon.push({
            x: midPtX,
            z: midPtZ,
            isRim: isDrop,
            hasRise,
          });
        }

        if (!isDrop) return;
        const lowInfo = getLowerTileInfo(nx, nz);
        const dropLevels = Math.max(1, level - lowInfo.level);

        const outerStartX = startKind === 'convex' ? startPt[0] : rawOuterStartX;
        const outerStartZ = startKind === 'convex' ? startPt[1] : rawOuterStartZ;
        const outerEndX = endKind === 'convex' ? endPt[0] : rawOuterEndX;
        const outerEndZ = endKind === 'convex' ? endPt[1] : rawOuterEndZ;

        if (hasMid) {
          rimSegments.push({
            ax: startPt[0],
            az: startPt[1],
            bx: midPtX,
            bz: midPtZ,
            yBottom: lowInfo.yBottom,
            bottomLevel: lowInfo.level,
            lowerTile: lowInfo.tile,
            lowerIsTallGrass: lowInfo.isTallGrass,
            isWaterEdge: lowInfo.isWater,
            dropLevels,
            uStart: 0.0,
            uEnd: 0.5,
          });
          rimSegments.push({
            ax: midPtX,
            az: midPtZ,
            bx: endPt[0],
            bz: endPt[1],
            yBottom: lowInfo.yBottom,
            bottomLevel: lowInfo.level,
            lowerTile: lowInfo.tile,
            lowerIsTallGrass: lowInfo.isTallGrass,
            isWaterEdge: lowInfo.isWater,
            dropLevels,
            uStart: 0.5,
            uEnd: 1.0,
          });

          const outerMidX = (rawOuterStartX + rawOuterEndX) * 0.5;
          const outerMidZ = (rawOuterStartZ + rawOuterEndZ) * 0.5;
          emitStripSegmentFill(
            outerStartX,
            outerStartZ,
            outerMidX,
            outerMidZ,
            startPt[0],
            startPt[1],
            midPtX,
            midPtZ,
            lowInfo.yBottom,
            lowInfo.level,
            lowInfo.isWater,
            lowInfo.tile,
            lowInfo.isTallGrass,
            lowerFloorQuads,
            lowerFloorTris
          );
          emitStripSegmentFill(
            outerMidX,
            outerMidZ,
            outerEndX,
            outerEndZ,
            midPtX,
            midPtZ,
            endPt[0],
            endPt[1],
            lowInfo.yBottom,
            lowInfo.level,
            lowInfo.isWater,
            lowInfo.tile,
            lowInfo.isTallGrass,
            lowerFloorQuads,
            lowerFloorTris
          );
        } else {
          rimSegments.push({
            ax: startPt[0],
            az: startPt[1],
            bx: endPt[0],
            bz: endPt[1],
            yBottom: lowInfo.yBottom,
            bottomLevel: lowInfo.level,
            lowerTile: lowInfo.tile,
            lowerIsTallGrass: lowInfo.isTallGrass,
            isWaterEdge: lowInfo.isWater,
            dropLevels,
            uStart: 0.0,
            uEnd: 1.0,
          });
          emitStripSegmentFill(
            outerStartX,
            outerStartZ,
            outerEndX,
            outerEndZ,
            startPt[0],
            startPt[1],
            endPt[0],
            endPt[1],
            lowInfo.yBottom,
            lowInfo.level,
            lowInfo.isWater,
            lowInfo.tile,
            lowInfo.isTallGrass,
            lowerFloorQuads,
            lowerFloorTris
          );
        }
      };

      // Walk perimeter in [SW -> SE -> NE -> NW] order:
      // 1. SW corner
      pushCorner(swPts, swKind, vSW, x0, z1, riseW, riseS);
      // 2. S edge: from swPts[last] to sePts[0]
      pushEdgeMidAndSegments(
        swPts[swPts.length - 1],
        sePts[0],
        swKind,
        seKind,
        x0,
        z1,
        x1,
        z1,
        x,
        z1 - midOffsetS,
        dropS,
        riseS,
        midOffsetS > 1e-4,
        x,
        z + 1
      );
      // 3. SE corner
      pushCorner(sePts, seKind, vSE, x1, z1, riseS, riseE);
      // 4. E edge: from sePts[last] to nePts[0]
      pushEdgeMidAndSegments(
        sePts[sePts.length - 1],
        nePts[0],
        seKind,
        neKind,
        x1,
        z1,
        x1,
        z0,
        x1 - midOffsetE,
        z,
        dropE,
        riseE,
        midOffsetE > 1e-4,
        x + 1,
        z
      );
      // 5. NE corner
      pushCorner(nePts, neKind, vNE, x1, z0, riseE, riseN);
      // 6. N edge: from nePts[last] to nwPts[0]
      pushEdgeMidAndSegments(
        nePts[nePts.length - 1],
        nwPts[0],
        neKind,
        nwKind,
        x1,
        z0,
        x0,
        z0,
        x,
        z0 + midOffsetN,
        dropN,
        riseN,
        midOffsetN > 1e-4,
        x,
        z - 1
      );
      // 7. NW corner
      pushCorner(nwPts, nwKind, vNW, x0, z0, riseN, riseW);
      // 8. W edge: from nwPts[last] to swPts[0]
      pushEdgeMidAndSegments(
        nwPts[nwPts.length - 1],
        swPts[0],
        nwKind,
        swKind,
        x0,
        z0,
        x0,
        z1,
        x0 + midOffsetW,
        z,
        dropW,
        riseW,
        midOffsetW > 1e-4,
        x - 1,
        z
      );

      tileContours[idx] = {
        x,
        z,
        level,
        isPlainInterior,
        isProtected,
        isNarrowCorridor,
        corners: {
          nw: nwKind,
          ne: neKind,
          se: seKind,
          sw: swKind,
        },
        topPolygon,
        rimSegments,
        lowerFloorQuads,
        lowerFloorTris,
      };
    }
  }

  return {
    width,
    height,
    seed,
    levels,
    solidFlags,
    waterFlags,
    protectedFlags,
    narrowCorridorFlags,
    tileRegionIds,
    regions,
    vertexLocked,
    tileContours,
  };
}

function emitStripSegmentFill(
  outAx: number,
  outAz: number,
  outBx: number,
  outBz: number,
  inAx: number,
  inAz: number,
  inBx: number,
  inBz: number,
  yBottom: number,
  bottomLevel: number,
  isWaterShore: boolean,
  lowerTile: TileAtlasKey,
  lowerIsTallGrass: boolean,
  lowerFloorQuads: LowerFloorQuad[],
  lowerFloorTris: LowerFloorTri[]
): void {
  const a1 = triArea2D(outAx, outAz, outBx, outBz, inBx, inBz);
  const a2 = triArea2D(outAx, outAz, inBx, inBz, inAx, inAz);
  const eps = TERRAIN_CONTOUR_PARAMS.MIN_TRIANGLE_AREA_2D;

  if (a1 <= eps && a2 <= eps) return;

  // Check if quad winding (outA -> outB -> inB -> inA) yields upward +Y normal:
  // For South edge: outA=(x0,z1), outB=(x1,z1), inB=(x1,z1-d), inA=(x0,z1-d).
  // e1 = outB - outA = (+1, 0), e2 = inB - outA = (+1, -d) -> normal = +Y!
  if (a1 > eps && a2 > eps) {
    lowerFloorQuads.push({
      points: [
        [outAx, outAz],
        [outBx, outBz],
        [inBx, inBz],
        [inAx, inAz],
      ],
      yBottom,
      bottomLevel,
      isWaterShore,
      lowerTile,
      lowerIsTallGrass,
      creviceMask: [0.35, 0.35, 0.85, 0.85],
    });
    return;
  }

  if (a1 > eps) {
    lowerFloorTris.push({
      points: [
        [outAx, outAz],
        [outBx, outBz],
        [inBx, inBz],
      ],
      yBottom,
      bottomLevel,
      isWaterShore,
      lowerTile,
      lowerIsTallGrass,
      creviceMask: [0.35, 0.35, 0.85],
    });
  }
  if (a2 > eps) {
    lowerFloorTris.push({
      points: [
        [outAx, outAz],
        [inBx, inBz],
        [inAx, inAz],
      ],
      yBottom,
      bottomLevel,
      isWaterShore,
      lowerTile,
      lowerIsTallGrass,
      creviceMask: [0.35, 0.85, 0.85],
    });
  }
}
