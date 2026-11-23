import type { BuildingPlacement, Direction, MapDef } from './types.ts';

export const HEIGHT_UNIT = 0.5;

export function getTileHeightLevel(map: MapDef, x: number, y: number): number {
  const row = map.heights[y];
  if (!row) return 0;
  const ch = row[x];
  if (!ch) return 0;
  const n = Number(ch);
  return Number.isFinite(n) ? Math.max(0, Math.min(9, n)) : 0;
}

export function getTileWorldY(map: MapDef, x: number, y: number): number {
  return getTileHeightLevel(map, x, y) * HEIGHT_UNIT;
}

/** Bilinearly interpolated world Y for smooth walking over heightfields */
export function sampleInterpolatedHeight(
  map: MapDef,
  wx: number,
  wz: number
): number {
  const h = map.heights.length;
  const w = map.heights[0]?.length ?? 0;
  if (w === 0 || h === 0) return 0;

  const cx = Math.max(0, Math.min(w - 1, wx));
  const cz = Math.max(0, Math.min(h - 1, wz));
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const x1 = Math.min(w - 1, x0 + 1);
  const z1 = Math.min(h - 1, z0 + 1);
  const tx = cx - x0;
  const tz = cz - z0;

  const h00 = getTileWorldY(map, x0, z0);
  const h10 = getTileWorldY(map, x1, z0);
  const h01 = getTileWorldY(map, x0, z1);
  const h11 = getTileWorldY(map, x1, z1);

  const top = h00 + (h10 - h00) * tx;
  const bot = h01 + (h11 - h01) * tx;
  return top + (bot - top) * tz;
}

export function isInsideBuilding(
  buildings: readonly BuildingPlacement[],
  x: number,
  y: number
): boolean {
  for (const b of buildings) {
    if (x >= b.x && x < b.x + b.width && y >= b.z && y < b.z + b.depth) {
      return true;
    }
  }
  return false;
}

export function isTileWalkable(
  map: MapDef,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  blockedDynamic?: ReadonlySet<string>
): boolean {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  if (toY < 0 || toY >= height || toX < 0 || toX >= width) {
    return false;
  }

  const targetChar = map.grid[toY][toX];
  const targetLegend = map.legend[targetChar];
  if (!targetLegend || targetLegend.solid || targetLegend.tile === 'water') {
    return false;
  }

  if (isInsideBuilding(map.buildings, toX, toY)) {
    return false;
  }

  if (map.props.some((p) => p.x === toX && p.z === toY)) {
    return false;
  }

  if (map.signs.some((s) => s.x === toX && s.y === toY)) {
    return false;
  }

  if (blockedDynamic?.has(`${toX},${toY}`)) {
    return false;
  }

  const fromChar = map.grid[fromY]?.[fromX] ?? '.';
  const fromLegend = map.legend[fromChar];
  const isRamp = Boolean(targetLegend.ramp || fromLegend?.ramp || targetLegend.tile === 'stairs' || fromLegend?.tile === 'stairs');

  const hFrom = getTileHeightLevel(map, fromX, fromY);
  const hTo = getTileHeightLevel(map, toX, toY);
  const maxStep = isRamp ? 2 : 1;

  return Math.abs(hTo - hFrom) <= maxStep;
}

/**
 * Converts a camera-relative D-pad input ('up'|'down'|'left'|'right')
 * into world-grid delta and character facing direction based on camera yaw step (0..3).
 * CameraRig yaw=+90deg (step 1) places camera at +X looking -X (West).
 */
export function cameraRelativeMove(
  inputDir: Direction,
  yawStep: number
): { dx: number; dy: number; dir: Direction } {
  const normStep = ((yawStep % 4) + 4) % 4;
  // Base clockwise order: up=(0,-1), right=(1,0), down=(0,1), left=(-1,0)
  const dirs: readonly Direction[] = ['up', 'right', 'down', 'left'];
  const vecs: readonly [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const inputIdx = dirs.indexOf(inputDir);
  const worldIdx = (inputIdx - normStep + 4) % 4;
  return {
    dx: vecs[worldIdx][0],
    dy: vecs[worldIdx][1],
    dir: dirs[worldIdx],
  };
}

/**
 * Converts a character's world facing direction into the sprite direction
 * relative to the current camera yaw step (0..3).
 */
export function relativeSpriteDir(worldDir: Direction, yawStep: number): Direction {
  const normStep = ((yawStep % 4) + 4) % 4;
  const dirs: readonly Direction[] = ['up', 'right', 'down', 'left'];
  const idx = dirs.indexOf(worldDir);
  return dirs[(idx + normStep) % 4];
}

export function isWithinHiddenSparkleRange(
  ax: number,
  az: number,
  px: number,
  pz: number,
  maxDist = 5
): boolean {
  return Math.hypot(ax - px, az - pz) <= maxDist;
}

export function isStandingTileValid(
  map: MapDef,
  x: number,
  y: number
): boolean {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  if (y < 0 || y >= height || x < 0 || x >= width) {
    return false;
  }
  const ch = map.grid[y][x];
  const leg = map.legend[ch];
  if (!leg || leg.solid || leg.tile === 'water') {
    return false;
  }
  if (isInsideBuilding(map.buildings, x, y)) {
    return false;
  }
  if (map.props.some((p) => p.x === x && p.z === y)) {
    return false;
  }
  if (map.signs.some((s) => s.x === x && s.y === y)) {
    return false;
  }
  if (map.badgeGates?.some((g) => g.x === x && g.y === y)) {
    return false;
  }
  if (map.npcs.some((n) => !n.flagHidden && !n.flagRequired && n.x === x && n.y === y)) {
    return false;
  }
  return true;
}

function hasWalkableEscape(map: MapDef, x: number, y: number): boolean {
  const dirs: readonly [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (isStandingTileValid(map, nx, ny) && isTileWalkable(map, x, y, nx, ny)) {
      return true;
    }
  }
  return false;
}

export interface RelocatedSpawnResult {
  mapId: string;
  x: number;
  y: number;
  relocated: boolean;
}

export function validateAndRelocateSpawn(
  mapId: string,
  x: number,
  y: number,
  maps: Record<string, MapDef>,
  fallback: { mapId: string; x: number; y: number } = {
    mapId: 'villa_origen',
    x: 24,
    y: 26,
  }
): RelocatedSpawnResult {
  const map = maps[mapId];
  if (!map) {
    const fbMap = maps[fallback.mapId];
    if (fbMap && isStandingTileValid(fbMap, fallback.x, fallback.y)) {
      return { mapId: fallback.mapId, x: fallback.x, y: fallback.y, relocated: true };
    }
    return { mapId: fallback.mapId, x: fallback.x, y: fallback.y, relocated: true };
  }

  const rx = Math.round(x);
  const ry = Math.round(y);
  if (isStandingTileValid(map, rx, ry) && hasWalkableEscape(map, rx, ry)) {
    return { mapId, x: rx, y: ry, relocated: false };
  }

  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  const maxR = Math.max(width, height);
  const seedX = Math.max(0, Math.min(width - 1, rx));
  const seedY = Math.max(0, Math.min(height - 1, ry));

  for (let r = 1; r <= maxR; r++) {
    let best: { x: number; y: number; dist2: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const cx = seedX + dx;
        const cy = seedY + dy;
        if (!isStandingTileValid(map, cx, cy) || !hasWalkableEscape(map, cx, cy)) {
          continue;
        }
        const d2 = dx * dx + dy * dy;
        if (!best || d2 < best.dist2) {
          best = { x: cx, y: cy, dist2: d2 };
        }
      }
    }
    if (best) {
      return { mapId, x: best.x, y: best.y, relocated: true };
    }
  }

  // Fallback to primary city plaza if no valid tile exists on the map
  return { mapId: fallback.mapId, x: fallback.x, y: fallback.y, relocated: true };
}
