import {
  addOrganicPerimeterMountains,
  addOrganicPlateau,
  addSteppedIslet,
  carveMapPass,
  carveWindingRiver,
  createZoneCanvas,
  fillRect,
  finalizeZone,
  fbmNoise2D,
  type MapPassOptions,
  type SteppedIsletTier,
  type ZoneCanvas,
} from './mapBuilder.ts';

export type RoomShapeArchetype =
  | 'lobed'
  | 'crescent'
  | 'winding_meadow'
  | 'tiered_amphitheater'
  | 'craggy_sanctuary';

export interface NoiseRoomSpec {
  cx: number;
  cy: number;
  rx: number;
  rz: number;
  height: number;
  tile: string;
  shape: RoomShapeArchetype;
  seed?: number;
  /** Angular rotation in radians */
  angle?: number;
  /** Number of organic lobes for 'lobed' / 'craggy_sanctuary' (default 4..6) */
  lobes?: number;
  /** Amplitude of noise/lobe distortion (default 0.34) */
  distortion?: number;
  /** Optional recessed/raised inner pocket tile & height */
  innerTile?: string;
  innerHeight?: number;
  /** Optional stepped cliff rim height around the room perimeter */
  rimHeight?: number;
  rimTile?: string;
  /** Do not overwrite stairs/bridges/road tiles already carved */
  preserveProtected?: boolean;
  borderMargin?: number;
}

export interface NoisePathSpec {
  waypoints: ReadonlyArray<{ x: number; y: number }>;
  baseWidth?: number;
  /** Perpendicular noise meander amplitude in tiles (default 1.8) */
  meanderAmp?: number;
  /** Noise frequency along world coords (default 0.14) */
  meanderFreq?: number;
  /** Width breathing variation [0..0.7] (default 0.35) */
  widthBreath?: number;
  tile: string;
  /** Optional height to set along path; omit to follow underlying ground */
  height?: number;
  /** Optional stepped border shoulder tile (e.g. '.' around path) */
  shoulderTile?: string;
  shoulderRadius?: number;
  /** Preserve existing height if lower/higher unless forceHeight=true */
  preserveProtected?: boolean;
  seed?: number;
}

export interface NoiseElevationFieldSpec {
  seed: number;
  baseHeight: number;
  maxHeight: number;
  scale?: number;
  warpAmp?: number;
  /** Threshold [0..1] above which elevation rises into stepped hillock terraces */
  ridgeThreshold?: number;
  ridgeTile?: string;
  highTile?: string;
  borderMargin?: number;
}

export interface NoiseOutcropClusterSpec {
  cx: number;
  cy: number;
  count?: number;
  spread?: number;
  baseHeight: number;
  capTile?: string;
  shelfTile?: string;
  seed: number;
}

export interface NoiseLakeSpec {
  kind: 'lake';
  cx: number;
  cy: number;
  rx: number;
  rz: number;
  waterHeight: number;
  waterTile?: string;
  shoreTile?: string;
  shoreHeight?: number;
  seed?: number;
  jitter?: number;
  borderMargin?: number;
}

export interface NoiseRiverSpec {
  kind: 'river';
  waypoints: ReadonlyArray<{ x: number; y: number }>;
  halfWidth: number;
  waterHeight: number;
  waterTile?: string;
  bankTile?: string;
  bankHeight?: number;
  bankMargin?: number;
  seed?: number;
}

export interface NoiseIsletSpec {
  cx: number;
  cy: number;
  rx: number;
  rz: number;
  tiers: readonly SteppedIsletTier[];
  seed?: number;
}

export interface NoiseBridgeSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  height: number;
  tile?: string;
}

export interface NoiseStairRunSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  height: number;
  tile?: string;
}

export interface GuaranteedCellSpec {
  x: number;
  y: number;
  tile?: string;
  height?: number;
}

export interface NoiseWorldMapSpec {
  width: number;
  height: number;
  seed: number;
  baseTile: string;
  baseHeight: number;
  perimeter?: {
    thickness: number;
    peakHeight: number;
    ridgeTile?: string;
    shelfTile?: string;
    amplitude?: number;
    seed?: number;
  };
  noiseField?: NoiseElevationFieldSpec;
  rooms?: NoiseRoomSpec[];
  waterBodies?: Array<NoiseLakeSpec | NoiseRiverSpec>;
  islets?: NoiseIsletSpec[];
  outcropClusters?: NoiseOutcropClusterSpec[];
  passes?: MapPassOptions[];
  stairs?: NoiseStairRunSpec[];
  bridges?: NoiseBridgeSpec[];
  paths?: NoisePathSpec[];
  glades?: NoiseRoomSpec[];
  buildingPads?: Array<{ x: number; y: number; w: number; h: number; tile: string; height: number }>;
  guaranteedCells?: GuaranteedCellSpec[];
  customPostProcess?: (z: ZoneCanvas) => void;
}

const PROTECTED_STRUCTURE_TILES = new Set(['^', 'B', 'A', '=']);

function clampInt(v: number, min: number, max: number): number {
  const r = Math.round(v);
  return r < min ? min : r > max ? max : r;
}

function hash1D(i: number, seed: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 1597334677)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Maps fBm [0,1] (clustered around 0.5 due to bilinear+octave averaging) cleanly to [-1, +1]. */
function centeredFbm(x: number, y: number, seed: number): number {
  const raw = (fbmNoise2D(x, y, seed) - 0.5) * 3.8;
  return raw < -1 ? -1 : raw > 1 ? 1 : raw;
}

/**
 * Applies 2D multi-octave fBm domain warping to world coordinates so corridors,
 * room silhouettes, and shorelines curve naturally instead of aligning to axes.
 */
export function domainWarp2D(
  x: number,
  y: number,
  seed: number,
  scale = 0.14,
  amp = 1.6
): { x: number; y: number } {
  const wx = centeredFbm(x * scale, y * scale, seed) * amp;
  const wy = centeredFbm((x + 19.7) * scale, (y - 11.3) * scale, seed + 73) * amp;
  return { x: x + wx, y: y + wy };
}

/**
 * Evaluates normalized radial distance for varied organic room shapes.
 * Values <= 1.0 fall inside the room floor; values <= 1.24 can form stepped cliff rims.
 */
export function evaluateVariedRoomMask(
  px: number,
  py: number,
  room: NoiseRoomSpec
): number {
  const seed = room.seed ?? 301;
  const angle = room.angle ?? 0;
  const lobes = room.lobes ?? 4;
  const distortion = room.distortion ?? 0.34;
  const rx = Math.max(1.0, room.rx);
  const rz = Math.max(1.0, room.rz);

  const warped = domainWarp2D(px, py, seed, 0.21, Math.min(rx, rz) * 0.22);
  const dx = warped.x - room.cx;
  const dy = warped.y - room.cy;

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const lx = dx * cosA + dy * sinA;
  const ly = -dx * sinA + dy * cosA;

  const nx = lx / rx;
  const ny = ly / rz;
  const theta = Math.atan2(ny, nx);
  const nEdge = centeredFbm(px * 0.27, py * 0.27, seed + 17);

  if (room.shape === 'crescent') {
    const baseDist = Math.hypot(nx, ny);
    // Offset bite pocket to form a C-shaped crescent bay wrapping water or crags
    const biteDist = Math.hypot(nx - 0.42, ny - 0.08);
    const crescentFactor = biteDist < 0.62 ? 1.0 + (0.62 - biteDist) * 1.9 : 1.0;
    return (baseDist * crescentFactor) / (1.0 + nEdge * distortion * 0.65);
  }

  if (room.shape === 'winding_meadow') {
    // Sinuous spine bend along local X
    const spineShift = Math.sin(nx * 2.4 + (seed % 7)) * 0.32;
    const bentDist = Math.hypot(nx, ny - spineShift);
    const wave = 1.0 + Math.sin(theta * 2 + 0.7) * 0.14 + nEdge * distortion * 0.7;
    return bentDist / Math.max(0.45, wave);
  }

  if (room.shape === 'craggy_sanctuary') {
    const harmonic =
      Math.cos(theta * lobes + 0.4) * (distortion * 0.52) +
      Math.sin(theta * (lobes + 2) - 0.9) * (distortion * 0.28);
    const threshold = 1.0 + harmonic + nEdge * distortion * 0.65;
    return Math.hypot(nx, ny) / Math.max(0.42, threshold);
  }

  if (room.shape === 'tiered_amphitheater') {
    const harmonic = Math.cos(theta * Math.max(3, lobes - 1)) * (distortion * 0.36);
    const threshold = 1.0 + harmonic + nEdge * distortion * 0.55;
    return Math.hypot(nx, ny) / Math.max(0.45, threshold);
  }

  // 'lobed' default: multi-petal organic silhouette
  const lobeWave = Math.cos(theta * lobes + (seed % 5)) * (distortion * 0.48);
  const threshold = 1.0 + lobeWave + nEdge * distortion * 0.62;
  return Math.hypot(nx, ny) / Math.max(0.45, threshold);
}

/**
 * Carves an irregular organic room or clearing with optional stepped rock rim
 * and inner meadow/floor pocket onto a ZoneCanvas.
 */
export function carveVariedRoom(z: ZoneCanvas, room: NoiseRoomSpec): void {
  const margin = room.borderMargin ?? 2;
  const rx = Math.max(1.0, room.rx);
  const rz = Math.max(1.0, room.rz);
  const padX = Math.ceil(rx * 1.65) + 2;
  const padY = Math.ceil(rz * 1.65) + 2;

  const minX = Math.max(margin, Math.floor(room.cx - padX));
  const maxX = Math.min(z.width - 1 - margin, Math.ceil(room.cx + padX));
  const minY = Math.max(margin, Math.floor(room.cy - padY));
  const maxY = Math.min(z.height - 1 - margin, Math.ceil(room.cy + padY));

  const targetH = clampInt(room.height, 0, 9);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cur = z.tiles[y][x];
      if (room.preserveProtected && PROTECTED_STRUCTURE_TILES.has(cur)) continue;

      const d = evaluateVariedRoomMask(x, y, room);
      if (d <= 1.0) {
        if (room.shape === 'tiered_amphitheater' && d > 0.72) {
          z.heights[y][x] = clampInt(targetH + 1, 0, 9);
          z.tiles[y][x] = room.rimTile ?? room.tile;
        } else if (room.innerTile !== undefined && d <= 0.48) {
          z.tiles[y][x] = room.innerTile;
          z.heights[y][x] =
            room.innerHeight !== undefined ? clampInt(room.innerHeight, 0, 9) : targetH;
        } else {
          z.tiles[y][x] = room.tile;
          z.heights[y][x] = targetH;
        }
      } else if (room.rimHeight !== undefined && d <= 1.24) {
        // Optional organic rocky rim framing part of the room without boxing it completely
        const nRim = fbmNoise2D(x * 0.35, y * 0.35, (room.seed ?? 301) + 91);
        if (nRim > 0.36 && z.heights[y][x] < room.rimHeight) {
          z.heights[y][x] = clampInt(room.rimHeight, 0, 9);
          z.tiles[y][x] = room.rimTile ?? '#';
        }
      }
    }
  }
}

function sampleCatmullRom(
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

  const t2 = localT * localT;
  const t3 = t2 * localT;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * localT +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * localT +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * Generates a deterministic, non-linear organic polyline by applying multi-octave
 * perpendicular noise displacement along a Catmull-Rom spline, tapering smoothly to 0
 * at start/end anchors so warps, stairs, and bridges align cleanly.
 */
export function generateNoisePolyline(
  waypoints: ReadonlyArray<{ x: number; y: number }>,
  seed = 77,
  opts: {
    meanderAmp?: number;
    meanderFreq?: number;
    samplesPerUnit?: number;
  } = {}
): Array<{ x: number; y: number; t: number }> {
  if (waypoints.length === 0) return [];
  if (waypoints.length === 1) return [{ x: waypoints[0].x, y: waypoints[0].y, t: 0 }];

  const amp = opts.meanderAmp ?? 1.8;
  const freq = opts.meanderFreq ?? 0.14;
  const samplesPerUnit = opts.samplesPerUnit ?? 3;

  let totalLen = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalLen += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].y - waypoints[i - 1].y);
  }
  const steps = Math.max(16, Math.ceil(totalLen * samplesPerUnit));
  const rawPts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    rawPts.push(sampleCatmullRom(waypoints, i / steps));
  }

  const displaced: Array<{ x: number; y: number; t: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const prev = rawPts[Math.max(0, i - 1)];
    const next = rawPts[Math.min(steps, i + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tLen = Math.hypot(tx, ty) || 1;
    const nx = -ty / tLen;
    const ny = tx / tLen;

    // Taper smoothly to 0 at endpoints so warps/bridges/stairs stay locked
    const envelope = Math.sin(Math.PI * t);
    const n1 = centeredFbm(rawPts[i].x * freq, rawPts[i].y * freq, seed);
    const n2 =
      centeredFbm(rawPts[i].x * freq * 2.1 + 5.7, rawPts[i].y * freq * 2.1 - 3.2, seed + 43) *
      0.55;
    const swerve = Math.sin(t * Math.PI * 2.0 + (seed % 11) * 0.7) * 0.55;
    const shift = (n1 * 0.75 + n2 * 0.3 + swerve * 0.45) * amp * envelope;

    displaced.push({
      x: rawPts[i].x + nx * shift,
      y: rawPts[i].y + ny * shift,
      t,
    });
  }

  return displaced;
}

/**
 * Carves a non-linear noise-warped path with breathing width and organic
 * ground transitions, replacing rigid straight-line corridors.
 */
export function carveNoisePath(z: ZoneCanvas, spec: NoisePathSpec): void {
  const seed = spec.seed ?? 37;
  const baseWidth = spec.baseWidth ?? 2.0;
  const widthBreath = spec.widthBreath ?? 0.35;
  const preserveProtected = spec.preserveProtected ?? true;

  const spine = generateNoisePolyline(spec.waypoints, seed, {
    meanderAmp: spec.meanderAmp ?? 1.8,
    meanderFreq: spec.meanderFreq ?? 0.14,
  });
  if (spine.length === 0) return;

  const halfBase = Math.max(0.7, baseWidth * 0.5);

  for (const pt of spine) {
    const breath = centeredFbm(pt.x * 0.28 + 3.1, pt.y * 0.28 - 1.9, seed + 109);
    const r = Math.max(0.75, halfBase * (1 + breath * widthBreath));
    const rOuter = spec.shoulderRadius ? r + spec.shoulderRadius : r;

    const minX = Math.max(1, Math.floor(pt.x - rOuter - 1));
    const maxX = Math.min(z.width - 2, Math.ceil(pt.x + rOuter + 1));
    const minY = Math.max(1, Math.floor(pt.y - rOuter - 1));
    const maxY = Math.min(z.height - 2, Math.ceil(pt.y + rOuter + 1));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cur = z.tiles[py][px];
        if (preserveProtected && (cur === '^' || cur === 'B')) continue;

        const d = Math.hypot(px - pt.x, py - pt.y);
        if (d <= r + 0.12) {
          if (cur === '~' && spec.height === undefined) continue;
          z.tiles[py][px] = spec.tile;
          if (spec.height !== undefined) {
            z.heights[py][px] = clampInt(spec.height, 0, 9);
          }
        } else if (spec.shoulderTile && d <= rOuter && cur !== spec.tile && cur !== '~') {
          if (cur === '#' || spec.height !== undefined) {
            z.tiles[py][px] = spec.shoulderTile;
            if (spec.height !== undefined) {
              z.heights[py][px] = clampInt(spec.height, 0, 9);
            }
          }
        }
      }
    }
  }
}

/**
 * Applies a continuous domain-warped fBm elevation field so map interiors form
 * natural stepped hill terraces and cliff knolls rather than flat single-height planes.
 */
export function applyNoiseElevationField(
  z: ZoneCanvas,
  spec: NoiseElevationFieldSpec
): void {
  const scale = spec.scale ?? 0.085;
  const warpAmp = spec.warpAmp ?? 2.2;
  const threshold = spec.ridgeThreshold ?? 0.58;
  const margin = spec.borderMargin ?? 3;
  const spanH = Math.max(0, spec.maxHeight - spec.baseHeight);

  for (let y = margin; y < z.height - margin; y++) {
    for (let x = margin; x < z.width - margin; x++) {
      const w = domainWarp2D(x, y, spec.seed, scale * 1.35, warpAmp);
      const val = fbmNoise2D(w.x * scale, w.y * scale, spec.seed + 19);
      if (val >= threshold && spanH > 0) {
        const norm = Math.min(1, (val - threshold) / Math.max(0.08, 1 - threshold));
        const delta = Math.max(1, Math.ceil(norm * spanH));
        const nextH = clampInt(spec.baseHeight + delta, 0, 9);
        if (nextH > z.heights[y][x]) {
          z.heights[y][x] = nextH;
          if (delta >= spanH && spec.ridgeTile) {
            z.tiles[y][x] = spec.ridgeTile;
          } else if (spec.highTile) {
            z.tiles[y][x] = spec.highTile;
          }
        }
      }
    }
  }
}

/**
 * Places a small Octopath-style cluster of stepped mossy/rocky pedestals
 * flanking riverbanks, lakes, or curved paths for strong vertical diorama framing.
 */
export function addSteppedOutcropCluster(
  z: ZoneCanvas,
  spec: NoiseOutcropClusterSpec
): void {
  const count = spec.count ?? 3;
  const spread = spec.spread ?? 2.8;
  const shelfTile = spec.shelfTile ?? '.';
  const capTile = spec.capTile ?? '#';

  for (let i = 0; i < count; i++) {
    const angle = hash1D(i * 13 + 1, spec.seed) * Math.PI * 2;
    const dist = (0.35 + hash1D(i * 29 + 7, spec.seed) * 0.65) * spread;
    const ox = spec.cx + Math.cos(angle) * dist;
    const oy = spec.cy + Math.sin(angle) * dist;
    const rBase = 1.15 + hash1D(i * 41 + 3, spec.seed) * 0.85;
    const hasCap = i % 2 === 0 || count === 1;

    const tiers: SteppedIsletTier[] = [
      { scale: 1.0, height: clampInt(spec.baseHeight + 1, 0, 9), tile: shelfTile },
    ];
    if (hasCap) {
      tiers.push({
        scale: 0.56,
        height: clampInt(spec.baseHeight + 2, 0, 9),
        tile: capTile,
      });
    }

    addSteppedIslet(z, ox, oy, rBase, rBase * 0.9, tiers, spec.seed + i * 37);
  }
}

/**
 * Declarative noise-based world terrain generator combining:
 * 1) Domain-warped perimeter ridges & multi-octave terrain elevation field
 * 2) Varied irregular room silhouettes ('lobed', 'crescent', 'winding_meadow', etc.)
 * 3) Organic lakes & meandering rivers with stepped rocky/mossy islets & outcrops
 * 4) Non-linear noise-displaced meandering trails connecting all rooms, passes, and bridges
 */
export function generateNoiseWorldMap(spec: NoiseWorldMapSpec): {
  grid: string[];
  heights: string[];
} {
  const z = createZoneCanvas(spec.width, spec.height, spec.baseTile, spec.baseHeight);

  if (spec.perimeter) {
    addOrganicPerimeterMountains(
      z,
      spec.perimeter.thickness,
      spec.perimeter.peakHeight,
      spec.perimeter.ridgeTile ?? '#',
      spec.perimeter.seed ?? spec.seed,
      {
        basePlayHeight: spec.baseHeight,
        shelfTile: spec.perimeter.shelfTile ?? spec.baseTile,
        amplitude: spec.perimeter.amplitude ?? 2.8,
      }
    );
  }

  if (spec.noiseField) {
    applyNoiseElevationField(z, spec.noiseField);
  }

  for (const room of spec.rooms ?? []) {
    carveVariedRoom(z, room);
  }

  for (const body of spec.waterBodies ?? []) {
    if (body.kind === 'river') {
      carveWindingRiver(z, body.waypoints, body.halfWidth, body.waterHeight, {
        waterTile: body.waterTile ?? '~',
        bankTile: body.bankTile,
        bankHeight: body.bankHeight,
        bankMargin: body.bankMargin ?? 1.4,
        seed: body.seed ?? spec.seed + 51,
      });
    } else {
      if (body.shoreTile !== undefined) {
        addOrganicPlateau(
          z,
          body.cx,
          body.cy,
          body.rx + 1.2,
          body.rz + 1.1,
          body.shoreHeight ?? Math.max(0, body.waterHeight + 1),
          body.shoreTile,
          {
            seed: (body.seed ?? spec.seed) + 3,
            jitter: body.jitter ?? 0.35,
            borderMargin: body.borderMargin ?? 4,
            preserveProtected: true,
          }
        );
      }
      addOrganicPlateau(z, body.cx, body.cy, body.rx, body.rz, body.waterHeight, body.waterTile ?? '~', {
        seed: body.seed ?? spec.seed + 71,
        jitter: body.jitter ?? 0.38,
        borderMargin: body.borderMargin ?? 4,
      });
    }
  }

  for (const islet of spec.islets ?? []) {
    addSteppedIslet(
      z,
      islet.cx,
      islet.cy,
      islet.rx,
      islet.rz,
      islet.tiers,
      islet.seed ?? spec.seed + 99
    );
  }

  for (const cluster of spec.outcropClusters ?? []) {
    addSteppedOutcropCluster(z, cluster);
  }

  for (const pass of spec.passes ?? []) {
    carveMapPass(z, pass);
  }

  for (const stair of spec.stairs ?? []) {
    fillRect(z, stair.x, stair.y, stair.w, stair.h, stair.tile ?? '^', stair.height);
  }

  for (const bridge of spec.bridges ?? []) {
    fillRect(z, bridge.x, bridge.y, bridge.w, bridge.h, bridge.tile ?? 'B', bridge.height);
  }

  for (const path of spec.paths ?? []) {
    carveNoisePath(z, path);
  }

  for (const glade of spec.glades ?? []) {
    carveVariedRoom(z, { ...glade, preserveProtected: glade.preserveProtected ?? true });
  }

  for (const pad of spec.buildingPads ?? []) {
    fillRect(z, pad.x, pad.y, pad.w, pad.h, pad.tile, pad.height);
  }

  for (const cell of spec.guaranteedCells ?? []) {
    if (cell.x >= 0 && cell.x < z.width && cell.y >= 0 && cell.y < z.height) {
      if (cell.tile !== undefined) z.tiles[cell.y][cell.x] = cell.tile;
      if (cell.height !== undefined) z.heights[cell.y][cell.x] = clampInt(cell.height, 0, 9);
    }
  }

  if (spec.customPostProcess) {
    spec.customPostProcess(z);
  }

  return finalizeZone(z);
}
