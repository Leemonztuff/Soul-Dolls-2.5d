import type { TileLegendEntry } from '../../domain/types.ts';

export const DEFAULT_LEGEND: Record<string, TileLegendEntry> = {
  '.': { tile: 'grass', solid: false },
  ',': { tile: 'dirt', solid: false },
  '=': { tile: 'cobble', solid: false },
  '_': { tile: 'stone', solid: false },
  's': { tile: 'sand', solid: false },
  '~': { tile: 'water', solid: true },
  'B': { tile: 'bridge', solid: false },
  '^': { tile: 'stairs', solid: false, ramp: true },
  '"': { tile: 'tall_grass', solid: false, encounter: true },
  '*': { tile: 'flowers', solid: false },
  'c': { tile: 'cave_floor', solid: false },
  '%': { tile: 'cave_floor', solid: false, encounter: true },
  'A': { tile: 'arena_floor', solid: false },
  'w': { tile: 'snow', solid: false },
  '#': { tile: 'stone', solid: true },
};

export interface ZoneCanvas {
  width: number;
  height: number;
  tiles: string[][];
  heights: number[][];
}

export function createZoneCanvas(
  width: number,
  height: number,
  baseTile = '.',
  baseHeight = 1
): ZoneCanvas {
  const tiles = Array.from({ length: height }, () =>
    new Array<string>(width).fill(baseTile)
  );
  const heights = Array.from({ length: height }, () =>
    new Array<number>(width).fill(baseHeight)
  );
  return { width, height, tiles, heights };
}

export function fillRect(
  z: ZoneCanvas,
  x0: number,
  y0: number,
  w: number,
  h: number,
  tile?: string,
  heightVal?: number
): void {
  const xEnd = Math.min(z.width, x0 + w);
  const yEnd = Math.min(z.height, y0 + h);
  for (let y = Math.max(0, y0); y < yEnd; y++) {
    for (let x = Math.max(0, x0); x < xEnd; x++) {
      if (tile !== undefined) z.tiles[y][x] = tile;
      if (heightVal !== undefined) z.heights[y][x] = Math.max(0, Math.min(9, Math.round(heightVal)));
    }
  }
}

export function addHill(
  z: ZoneCanvas,
  cx: number,
  cy: number,
  radius: number,
  peakDelta: number,
  tile?: string
): void {
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(z.height - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(z.width - 1, Math.ceil(cx + radius)); x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 <= r2) {
        const falloff = 1 - Math.sqrt(d2) / radius;
        const nextH = z.heights[y][x] + Math.round(peakDelta * falloff);
        z.heights[y][x] = Math.max(0, Math.min(9, nextH));
        if (tile !== undefined && falloff > 0.35) {
          z.tiles[y][x] = tile;
        }
      }
    }
  }
}

export function addPerimeterMountains(
  z: ZoneCanvas,
  thickness = 4,
  peakHeight = 8,
  ridgeTile = '#'
): void {
  for (let y = 0; y < z.height; y++) {
    for (let x = 0; x < z.width; x++) {
      const edgeDist = Math.min(x, y, z.width - 1 - x, z.height - 1 - y);
      if (edgeDist < thickness) {
        const ratio = 1 - edgeDist / thickness;
        const target = Math.max(z.heights[y][x], Math.round(peakHeight * (0.55 + ratio * 0.45)));
        z.heights[y][x] = Math.min(9, target);
        if (edgeDist <= 1) {
          z.tiles[y][x] = ridgeTile;
        }
      }
    }
  }
}

export function carveRoad(
  z: ZoneCanvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width = 2,
  tile = '=',
  targetHeight?: number
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    for (let dy = 0; dy < width; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < z.width && py >= 0 && py < z.height) {
          z.tiles[py][px] = tile;
          if (targetHeight !== undefined) {
            z.heights[py][px] = targetHeight;
          }
        }
      }
    }
  }
}

export interface MapPassOptions {
  x: number;
  y: number;
  exitDir: 'north' | 'south' | 'west' | 'east';
  roadWidth?: number;
  roadTile?: string;
  height?: number;
  depth?: number;
  shoulderWidth?: number;
  slopeWidth?: number;
  shoulderTile?: string;
}

const PRESERVED_PASS_TILES = new Set(['~', 'B', '^', '"', '*', '=', ',', '_', 'A']);

/**
 * Carves a natural, flat-shouldered valley pass leading to a border warp and
 * gently terraces surrounding perimeter mountains down to road level so
 * map transitions never form abrupt V-shaped cliff trenches.
 */
export function carveMapPass(z: ZoneCanvas, opts: MapPassOptions): void {
  const roadWidth = opts.roadWidth ?? 2;
  const roadTile = opts.roadTile ?? '=';
  const baseH = Math.max(0, Math.min(9, Math.round(opts.height ?? 2)));
  const depth = opts.depth ?? 8;
  const shoulderWidth = opts.shoulderWidth ?? 3;
  const slopeWidth = opts.slopeWidth ?? 5;
  const shoulderTile = opts.shoulderTile ?? '.';

  const isVertical = opts.exitDir === 'north' || opts.exitDir === 'south';
  const crossStart = isVertical ? opts.x : opts.y;
  const crossEnd = crossStart + roadWidth - 1;
  const totalCrossSpan = shoulderWidth + slopeWidth;
  const totalAlongSpan = depth + slopeWidth;

  for (let along = 0; along < totalAlongSpan; along++) {
    const pyBase =
      opts.exitDir === 'north'
        ? along
        : opts.exitDir === 'south'
          ? z.height - 1 - along
          : -1;
    const pxBase =
      opts.exitDir === 'west'
        ? along
        : opts.exitDir === 'east'
          ? z.width - 1 - along
          : -1;

    const innerOvershoot = Math.max(0, along - (depth - 1));

    for (
      let cross = crossStart - totalCrossSpan;
      cross <= crossEnd + totalCrossSpan;
      cross++
    ) {
      const px = isVertical ? cross : pxBase;
      const py = isVertical ? pyBase : cross;
      if (px < 0 || px >= z.width || py < 0 || py >= z.height) continue;

      let sideDist = 0;
      if (cross < crossStart) sideDist = crossStart - cross;
      else if (cross > crossEnd) sideDist = cross - crossEnd;

      const shoulderOvershoot = Math.max(0, sideDist - shoulderWidth);
      const effectiveStep = Math.max(shoulderOvershoot, innerOvershoot);
      const curTile = z.tiles[py][px];

      if (effectiveStep === 0) {
        if (sideDist === 0) {
          if (curTile !== 'B' && curTile !== '^') {
            z.tiles[py][px] = roadTile;
          }
        } else if (!PRESERVED_PASS_TILES.has(curTile)) {
          z.tiles[py][px] = shoulderTile;
        }
        z.heights[py][px] = baseH;
      } else if (effectiveStep <= slopeWidth) {
        const maxH = Math.min(9, baseH + effectiveStep);
        if (z.heights[py][px] > maxH) {
          z.heights[py][px] = maxH;
        }
        if (
          curTile === '#' &&
          effectiveStep <= Math.max(2, Math.floor(slopeWidth * 0.6))
        ) {
          z.tiles[py][px] = shoulderTile;
        }
      }
    }
  }
}

export function finalizeZone(z: ZoneCanvas): { grid: string[]; heights: string[] } {
  return {
    grid: z.tiles.map((row) => row.join('')),
    heights: z.heights.map((row) => row.join('')),
  };
}

function clampInt(v: number, min: number, max: number): number {
  const r = Math.round(v);
  return r < min ? min : r > max ? max : r;
}

function hash2D(ix: number, iy: number, seed: number): number {
  let h =
    (Math.imul(ix | 0, 374761393) +
      Math.imul(iy | 0, 668265263) +
      Math.imul(seed | 0, 1597334677)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

export function fbmNoise2D(x: number, y: number, seed: number): number {
  return (
    valueNoise2D(x, y, seed) * 0.65 +
    valueNoise2D(x * 2.13 + 7.3, y * 2.13 - 4.1, seed + 31) * 0.35
  );
}

const DEFAULT_PROTECTED_TILES = new Set(['^', 'B', '=', 'A']);

export interface OrganicShapeOptions {
  jitter?: number;
  seed?: number;
  heightMode?: 'set' | 'max' | 'min';
  preserveProtected?: boolean;
  borderMargin?: number;
}

/**
 * Stamps an organic elliptical/lobed region using multi-octave noise so cliff plateaus,
 * lakes, clearings, and tall-grass glades form curved bays and promontories instead of boxes.
 */
export function addOrganicPlateau(
  z: ZoneCanvas,
  cx: number,
  cy: number,
  rx: number,
  rz: number,
  heightVal?: number,
  tile?: string,
  opts: OrganicShapeOptions = {}
): void {
  const seed = opts.seed ?? 101;
  const jitter = opts.jitter ?? 0.34;
  const heightMode = opts.heightMode ?? 'set';
  const preserveProtected = opts.preserveProtected ?? false;
  const margin = opts.borderMargin ?? 0;

  const padX = Math.ceil(rx * (1 + jitter)) + 1;
  const padZ = Math.ceil(rz * (1 + jitter)) + 1;
  const minX = Math.max(margin, Math.floor(cx - padX));
  const maxX = Math.min(z.width - 1 - margin, Math.ceil(cx + padX));
  const minY = Math.max(margin, Math.floor(cy - padZ));
  const maxY = Math.min(z.height - 1 - margin, Math.ceil(cy + padZ));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (preserveProtected && DEFAULT_PROTECTED_TILES.has(z.tiles[y][x])) continue;
      const nx = (x - cx) / Math.max(0.5, rx);
      const ny = (y - cy) / Math.max(0.5, rz);
      const radial = Math.hypot(nx, ny);
      const n = (fbmNoise2D(x * 0.28, y * 0.28, seed) - 0.5) * 2;
      const threshold = 1.0 + n * jitter;
      if (radial <= threshold) {
        if (tile !== undefined) {
          z.tiles[y][x] = tile;
        }
        if (heightVal !== undefined) {
          const h = clampInt(heightVal, 0, 9);
          if (heightMode === 'max') {
            z.heights[y][x] = Math.max(z.heights[y][x], h);
          } else if (heightMode === 'min') {
            z.heights[y][x] = Math.min(z.heights[y][x], h);
          } else {
            z.heights[y][x] = h;
          }
        }
      }
    }
  }
}

/**
 * Builds an HD-2D Octopath-style undulating mountain perimeter with curved promontories,
 * stepped cliff shelves, and natural coves instead of a straight rectangular border wall.
 */
export function addOrganicPerimeterMountains(
  z: ZoneCanvas,
  baseThickness = 4,
  peakHeight = 8,
  ridgeTile = '#',
  seed = 42,
  opts: {
    basePlayHeight?: number;
    shelfTile?: string;
    amplitude?: number;
  } = {}
): void {
  const basePlayH = opts.basePlayHeight ?? 1;
  const shelfTile = opts.shelfTile;
  const amp = opts.amplitude ?? 2.4;

  for (let y = 0; y < z.height; y++) {
    for (let x = 0; x < z.width; x++) {
      const n1 = (fbmNoise2D(x * 0.17, y * 0.17, seed) - 0.45) * amp;
      const n2 = Math.sin(x * 0.31 + y * 0.23 + seed * 0.1) * 0.85;
      const edgeDist = Math.min(x, y, z.width - 1 - x, z.height - 1 - y);
      const localThick = Math.max(2.0, baseThickness + n1 + n2);

      if (edgeDist < localThick) {
        const depthNorm = Math.max(0, Math.min(1, 1 - edgeDist / localThick));
        const stepped =
          depthNorm < 0.32
            ? basePlayH + 1
            : depthNorm < 0.62
              ? Math.round(basePlayH + (peakHeight - basePlayH) * 0.55)
              : peakHeight;
        const target = Math.max(z.heights[y][x], clampInt(stepped, 0, 9));
        z.heights[y][x] = target;
        if (edgeDist <= 1 || depthNorm >= 0.48) {
          z.tiles[y][x] = ridgeTile;
        } else if (shelfTile !== undefined) {
          z.tiles[y][x] = shelfTile;
        }
      }
    }
  }
}

export interface SteppedIsletTier {
  scale: number;
  height: number;
  tile: string;
  offsetX?: number;
  offsetZ?: number;
}

/**
 * Stamps a multi-tiered rounded islet or rocky outcrop (e.g. mossy base shelf -> stone cap -> rock spire),
 * creating stepped organic silhouettes over water or terrain.
 */
export function addSteppedIslet(
  z: ZoneCanvas,
  cx: number,
  cy: number,
  rx: number,
  rz: number,
  tiers: readonly SteppedIsletTier[],
  seed = 77
): void {
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    addOrganicPlateau(
      z,
      cx + (t.offsetX ?? 0),
      cy + (t.offsetZ ?? 0),
      Math.max(0.85, rx * t.scale),
      Math.max(0.85, rz * t.scale),
      t.height,
      t.tile,
      {
        jitter: 0.28,
        seed: seed + i * 19,
        heightMode: 'set',
        preserveProtected: true,
        borderMargin: 1,
      }
    );
  }
}

function samplePolylinePoint(
  pts: ReadonlyArray<{ x: number; y: number }>,
  t: number
): { x: number; y: number } {
  if (pts.length === 1) return pts[0];
  const scaled = Math.max(0, Math.min(pts.length - 1, t * (pts.length - 1)));
  const idx = Math.min(pts.length - 2, Math.floor(scaled));
  const localT = scaled - idx;
  const p0 = pts[Math.max(0, idx - 1)];
  const p1 = pts[idx];
  const p2 = pts[idx + 1];
  const p3 = pts[Math.min(pts.length - 1, idx + 2)];

  // Smooth Catmull-Rom spline interpolation
  const t2 = localT * localT;
  const t3 = t2 * localT;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * localT +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * localT +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

/**
 * Carves a smoothly curved Catmull-Rom road or dirt trail with organic edge variation,
 * avoiding rigid 90-degree path segments while preserving stairs and bridges.
 */
export function carveOrganicRoad(
  z: ZoneCanvas,
  waypoints: ReadonlyArray<{ x: number; y: number }>,
  width = 2,
  tile = ',',
  targetHeight?: number,
  seed = 13
): void {
  if (waypoints.length < 2) return;
  let totalLen = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalLen += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].y - waypoints[i - 1].y);
  }
  const steps = Math.max(12, Math.ceil(totalLen * 3));
  const halfR = Math.max(0.65, width * 0.5);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = samplePolylinePoint(waypoints, t);
    const sway = (fbmNoise2D(p.x * 0.25, p.y * 0.25, seed) - 0.5) * 0.45;
    const rEff = halfR + Math.max(-0.15, sway);
    const minX = Math.max(1, Math.floor(p.x - rEff));
    const maxX = Math.min(z.width - 2, Math.ceil(p.x + rEff));
    const minY = Math.max(1, Math.floor(p.y - rEff));
    const maxY = Math.min(z.height - 2, Math.ceil(p.y + rEff));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        if (Math.hypot(px - p.x, py - p.y) <= rEff + 0.15) {
          const cur = z.tiles[py][px];
          if (cur === '^' || cur === 'B') continue;
          z.tiles[py][px] = tile;
          if (targetHeight !== undefined) {
            z.heights[py][px] = clampInt(targetHeight, 0, 9);
          }
        }
      }
    }
  }
}

/**
 * Carves a meandering natural river/stream with curved banks and variable channel width.
 */
export function carveWindingRiver(
  z: ZoneCanvas,
  waypoints: ReadonlyArray<{ x: number; y: number }>,
  halfWidth = 2.0,
  waterHeight = 0,
  opts: {
    waterTile?: string;
    bankTile?: string;
    bankHeight?: number;
    bankMargin?: number;
    seed?: number;
    preserveProtected?: boolean;
  } = {}
): void {
  if (waypoints.length < 2) return;
  const waterTile = opts.waterTile ?? '~';
  const bankTile = opts.bankTile;
  const bankHeight = opts.bankHeight;
  const bankMargin = opts.bankMargin ?? 1.4;
  const seed = opts.seed ?? 99;
  const preserveProtected = opts.preserveProtected ?? true;

  let totalLen = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalLen += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].y - waypoints[i - 1].y);
  }
  const steps = Math.max(20, Math.ceil(totalLen * 3));

  for (let i = 0; i <= steps; i++) {
    const p = samplePolylinePoint(waypoints, i / steps);
    const n = (fbmNoise2D(p.x * 0.22, p.y * 0.22, seed) - 0.5) * 1.1;
    const rWater = Math.max(1.0, halfWidth + n);
    const rOuter = rWater + bankMargin;

    const minX = Math.max(1, Math.floor(p.x - rOuter - 1));
    const maxX = Math.min(z.width - 2, Math.ceil(p.x + rOuter + 1));
    const minY = Math.max(1, Math.floor(p.y - rOuter - 1));
    const maxY = Math.min(z.height - 2, Math.ceil(p.y + rOuter + 1));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cur = z.tiles[py][px];
        if (preserveProtected && DEFAULT_PROTECTED_TILES.has(cur)) continue;
        const d = Math.hypot(px - p.x, py - p.y);
        if (d <= rWater) {
          z.tiles[py][px] = waterTile;
          z.heights[py][px] = clampInt(waterHeight, 0, 9);
        } else if (d <= rOuter && cur !== waterTile) {
          if (bankTile !== undefined && cur !== '=') {
            z.tiles[py][px] = bankTile;
          }
          if (bankHeight !== undefined && z.heights[py][px] > bankHeight) {
            z.heights[py][px] = clampInt(bankHeight, 0, 9);
          }
        }
      }
    }
  }
}

export {
  addSteppedOutcropCluster,
  applyNoiseElevationField,
  carveNoisePath,
  carveVariedRoom,
  domainWarp2D,
  evaluateVariedRoomMask,
  generateNoisePolyline,
  generateNoiseWorldMap,
  type GuaranteedCellSpec,
  type NoiseBridgeSpec,
  type NoiseElevationFieldSpec,
  type NoiseIsletSpec,
  type NoiseLakeSpec,
  type NoiseOutcropClusterSpec,
  type NoisePathSpec,
  type NoiseRiverSpec,
  type NoiseRoomSpec,
  type NoiseStairRunSpec,
  type NoiseWorldMapSpec,
  type RoomShapeArchetype,
} from './noiseWorldGen.ts';

