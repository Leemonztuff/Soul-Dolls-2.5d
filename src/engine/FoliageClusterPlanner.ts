import { createRng } from '../core/Rng.ts';
import { getTileHeightLevel, getTileWorldY, isInsideBuilding, isTileWalkable } from '../domain/TerrainRules.ts';
import type { MapDef, PropKind } from '../domain/types.ts';
import { resolveTerrainTileKey } from './TerrainSurfaceResolver.ts';

export const FOLIAGE_CLUSTER_PARAMS = {
  /** Radio máximo (en unidades de mundo) dentro del cual se colocan los props de un cluster. */
  MAX_CLUSTER_RADIUS: 1.6,
  /** Desplazamiento sub-tile máximo aplicado a cada prop dentro del cluster. */
  SUB_TILE_OFFSET_MAX: 0.35,
  /** Distancia mínima entre centros de cluster para evitar solapamiento visual. */
  MIN_DIST_BETWEEN_CLUSTERS: 3.5,
  /** Escala de árboles dentro de un cluster. */
  TREE_SCALE_RANGE: [0.9, 1.15] as const,
  /** Escala de arbustos dentro de un cluster. */
  BUSH_SCALE_RANGE: [0.8, 1.1] as const,
  /** Escala de rocas bajas dentro de un cluster. */
  ROCK_SCALE_RANGE: [0.75, 1.05] as const,
  /** Escala de parches de flores dentro de un cluster. */
  FLOWER_SCALE_RANGE: [0.8, 1.0] as const,
} as const;

const BIOME_DEFAULT_TREES: Record<MapDef['biome'], ReadonlyArray<PropKind>> = {
  meadow: ['oak', 'birch', 'pine'],
  forest: ['oak', 'birch', 'mushroom_tree', 'mushroom_tree_arcane'],
  mountain: ['pine', 'oak'],
  snow: ['snow_pine'],
  coast: ['oak', 'birch'],
  arena: ['pine', 'snow_pine'],
  cave: [],
};

const SOLID_CLUSTER_PROPS: ReadonlySet<PropKind> = new Set([
  'oak',
  'pine',
  'birch',
  'snow_pine',
  'mushroom_tree',
  'mushroom_tree_arcane',
  'boulder',
]);

export interface ClusterProp {
  kind: PropKind;
  /** Coordenada X continua (centro de tile + offset sub-tile). */
  x: number;
  /** Coordenada Z continua (centro de tile + offset sub-tile). */
  z: number;
  y: number;
  scale: number;
  /** Si true, el prop marca su tile lógico como bloqueado en blockedTiles. */
  solid: boolean;
}

export interface ClusterPlan {
  centerX: number;
  centerZ: number;
  kind: 'forest' | 'riverside' | 'meadow' | 'rocky';
  props: ClusterProp[];
}

export interface FoliageClusterPlan {
  clusters: ClusterPlan[];
  /** Props que deben registrarse en blockedTiles (colisión). */
  solidProps: ClusterProp[];
  /** Props puramente visuales, no bloqueantes. */
  visualProps: ClusterProp[];
}

function pickKind<T extends PropKind>(
  rng: ReturnType<typeof createRng>,
  kinds: ReadonlyArray<T>
): T {
  return kinds[Math.floor(rng.next() * kinds.length)] as T;
}

function clampScale(rng: ReturnType<typeof createRng>, range: readonly [number, number]): number {
  return range[0] + rng.next() * (range[1] - range[0]);
}

function subTileOffset(rng: ReturnType<typeof createRng>): number {
  return (rng.next() - 0.5) * 2 * FOLIAGE_CLUSTER_PARAMS.SUB_TILE_OFFSET_MAX;
}

function isSolidProp(kind: PropKind): boolean {
  return SOLID_CLUSTER_PROPS.has(kind);
}

function getTileAt(map: MapDef, x: number, z: number) {
  const row = map.grid[z];
  if (!row || x < 0 || x >= row.length) return null;
  const ch = row[x];
  if (!ch) return null;
  return map.legend[ch] ?? null;
}

function isPathOrForbiddenTile(map: MapDef, x: number, z: number): boolean {
  const leg = getTileAt(map, x, z);
  if (!leg) return true;
  if (
    leg.tile === 'cobble' ||
    leg.tile === 'dirt' ||
    leg.tile === 'bridge' ||
    leg.tile === 'stairs' ||
    leg.tile === 'arena_floor' ||
    leg.tile === 'water' ||
    leg.tile === 'tall_grass' ||
    (leg.tile === 'stone' && !leg.solid)
  ) {
    return true;
  }
  const resolved = resolveTerrainTileKey(map, x, z);
  return (
    resolved === 'cobble' ||
    resolved === 'dirt' ||
    resolved === 'bridge' ||
    resolved === 'stairs' ||
    resolved === 'arena_floor' ||
    resolved === 'water' ||
    resolved === 'cliff_rock' ||
    resolved === 'mossy_stone' ||
    resolved === 'cracked_stone'
  );
}

function hasWaterCardinalNeighbor(map: MapDef, x: number, z: number): boolean {
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (getTileAt(map, x + dx, z + dz)?.tile === 'water') {
      return true;
    }
  }
  return false;
}

function getCardinalMaxSlope(map: MapDef, x: number, z: number): number {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  const hC = getTileHeightLevel(map, x, z);
  let maxDiff = 0;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
    maxDiff = Math.max(maxDiff, Math.abs(getTileHeightLevel(map, nx, nz) - hC));
  }
  return maxDiff;
}

function tileIsFree(
  map: MapDef,
  x: number,
  z: number,
  occupied: Set<string>,
  requireNoWaterBank = false
): boolean {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  if (x < 1 || x >= width - 1 || z < 1 || z >= height - 1) return false;
  const key = `${x},${z}`;
  if (occupied.has(key)) return false;
  if (isInsideBuilding(map.buildings, x, z)) return false;
  if (isPathOrForbiddenTile(map, x, z)) return false;
  if (!isTileWalkable(map, x, z, x, z)) return false;
  if (getCardinalMaxSlope(map, x, z) > 1) return false;
  if (requireNoWaterBank && hasWaterCardinalNeighbor(map, x, z)) return false;
  return true;
}

function inferClusterKind(
  map: MapDef,
  cx: number,
  cz: number,
  rng: ReturnType<typeof createRng>
): ClusterPlan['kind'] {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  let nearWater = false;
  let nearRock = false;

  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
      const leg = getTileAt(map, nx, nz);
      if (!leg) continue;
      if (leg.tile === 'water') nearWater = true;
      if (leg.tile === 'stone') nearRock = true;
    }
  }

  const hC = getTileHeightLevel(map, cx, cz);
  const isSnowy = map.biome === 'snow' || (map.snowLine !== undefined && hC >= map.snowLine);

  if (nearWater) {
    return rng.next() < 0.85 ? 'riverside' : 'meadow';
  }
  if (isSnowy || nearRock || map.biome === 'mountain' || map.biome === 'arena') {
    return rng.next() < 0.72 ? 'rocky' : 'forest';
  }
  if (map.biome === 'forest') {
    return rng.next() < 0.76 ? 'forest' : 'meadow';
  }
  return rng.next() < 0.5 ? 'meadow' : 'forest';
}

function resolveAllowedTrees(
  map: MapDef,
  x: number,
  z: number,
  clusterKind: ClusterPlan['kind']
): PropKind[] {
  const level = getTileHeightLevel(map, x, z);
  const isSnowy =
    map.biome === 'snow' || (map.snowLine !== undefined && level >= map.snowLine);
  const configured = map.decoration.treeKinds;
  const rawPool: PropKind[] =
    configured.length > 0
      ? [...configured]
      : [...(BIOME_DEFAULT_TREES[map.biome] ?? BIOME_DEFAULT_TREES.meadow)];

  const expanded: PropKind[] = [];
  for (const k of rawPool) {
    if (k === 'mushroom_tree') {
      expanded.push('mushroom_tree');
      if (map.biome === 'forest' || configured.includes('mushroom_tree')) {
        expanded.push('mushroom_tree_arcane');
      }
    } else if (!expanded.includes(k)) {
      expanded.push(k);
    }
  }

  let filtered: PropKind[];
  if (isSnowy) {
    const snowSet = expanded.filter((k) => k === 'snow_pine' || k === 'pine');
    filtered = snowSet.length > 0 ? snowSet : ['snow_pine'];
  } else {
    filtered = expanded.filter((k) => k !== 'snow_pine');
    if (filtered.length === 0) filtered = ['pine', 'oak'];
  }

  if (clusterKind === 'riverside') {
    const rip = filtered.filter((k) => k === 'birch' || k === 'oak');
    if (rip.length > 0) return rip;
  } else if (clusterKind === 'rocky') {
    const conif = filtered.filter((k) => k === 'pine' || k === 'snow_pine');
    if (conif.length > 0) return conif;
  } else if (clusterKind === 'meadow') {
    const broad = filtered.filter((k) => k === 'oak' || k === 'birch' || k === 'pine');
    if (broad.length > 0) return broad;
  }

  return filtered;
}

function resolveAllowedBushes(map: MapDef, x: number, z: number): PropKind[] {
  const level = getTileHeightLevel(map, x, z);
  const isSnowy =
    map.biome === 'snow' || (map.snowLine !== undefined && level >= map.snowLine);
  if (isSnowy) return [];
  if (map.biome === 'forest' || map.decoration.treeKinds.includes('mushroom_tree')) {
    return ['bush', 'bush_arcane'];
  }
  if (map.biome === 'arena') return ['bush_arcane'];
  return ['bush'];
}

function resolveAllowedRocks(map: MapDef, x: number, z: number): PropKind[] {
  const level = getTileHeightLevel(map, x, z);
  const isSnowy =
    map.biome === 'snow' || (map.snowLine !== undefined && level >= map.snowLine);
  if (map.biome === 'arena') return ['boulder', 'crystal', 'stump'];
  if (
    !isSnowy &&
    (map.biome === 'forest' ||
      map.decoration.mushroomDensity > 0 ||
      map.decoration.treeKinds.includes('mushroom_tree'))
  ) {
    return ['boulder', 'stump', 'mushroom'];
  }
  return ['boulder', 'stump'];
}

function resolveAllowedFlowers(
  map: MapDef,
  x: number,
  z: number,
  clusterKind: ClusterPlan['kind'],
  respectDensity: boolean
): PropKind[] {
  const level = getTileHeightLevel(map, x, z);
  const isSnowy =
    map.biome === 'snow' || (map.snowLine !== undefined && level >= map.snowLine);
  if (isSnowy || clusterKind === 'rocky') return [];
  if (respectDensity && map.decoration.flowerDensity <= 0 && clusterKind !== 'riverside') {
    return [];
  }
  return ['flower_patch'];
}

function buildCluster(
  cx: number,
  cz: number,
  kind: ClusterPlan['kind'],
  map: MapDef,
  rng: ReturnType<typeof createRng>,
  occupied: Set<string>,
  respectDensity: boolean
): ClusterPlan | null {
  const props: ClusterProp[] = [];

  const placeProp = (
    propKind: PropKind,
    offsetX: number,
    offsetZ: number,
    scaleRange: readonly [number, number],
    isAnchor = false
  ): boolean => {
    const x = cx + offsetX;
    const z = cz + offsetZ;
    const rx = Math.round(x);
    const rz = Math.round(z);
    if (!tileIsFree(map, rx, rz, occupied, isAnchor)) return false;

    const solid = isSolidProp(propKind);
    const y = getTileWorldY(map, rx, rz);
    const scale = clampScale(rng, scaleRange);

    props.push({ kind: propKind, x, z, y, scale, solid });
    occupied.add(`${rx},${rz}`);
    return true;
  };

  // Recetas diferenciadas por tipo de cluster
  const nBushes =
    kind === 'forest' || kind === 'riverside'
      ? 2 + Math.floor(rng.next() * 2) // 2..3
      : kind === 'meadow'
        ? 1 + Math.floor(rng.next() * 2) // 1..2
        : rng.next() < 0.45
          ? 1
          : 0;
  const nRocks =
    kind === 'rocky'
      ? 2 + Math.floor(rng.next() * 2) // 2..3
      : kind === 'forest'
        ? 1 + Math.floor(rng.next() * 2) // 1..2
        : kind === 'riverside'
          ? 1
          : rng.next() < 0.5
            ? 1
            : 0;
  const nFlowers =
    kind === 'riverside' || kind === 'meadow'
      ? 2 + Math.floor(rng.next() * 2) // 2..3
      : kind === 'forest' && rng.next() < 0.35
        ? 1
        : 0;

  // Árbol principal en el centro con pequeño offset sub-tile (nunca pegado al filo del agua)
  const treePool = resolveAllowedTrees(map, cx, cz, kind);
  if (treePool.length === 0) return null;
  const treeKind = pickKind(rng, treePool);
  if (
    !placeProp(
      treeKind,
      subTileOffset(rng),
      subTileOffset(rng),
      FOLIAGE_CLUSTER_PARAMS.TREE_SCALE_RANGE,
      true
    )
  ) {
    return null;
  }

  // Arbustos satélite alrededor del árbol (según bioma/altitud)
  const bushPool = resolveAllowedBushes(map, cx, cz);
  if (bushPool.length > 0 && nBushes > 0) {
    let bushesPlaced = 0;
    let attempts = 0;
    while (bushesPlaced < nBushes && attempts < 12) {
      attempts++;
      const angle = rng.next() * Math.PI * 2;
      const dist = 0.7 + rng.next() * 0.9;
      const ox = Math.cos(angle) * dist;
      const oz = Math.sin(angle) * dist;
      const bushKind = pickKind(rng, bushPool);
      if (placeProp(bushKind, ox, oz, FOLIAGE_CLUSTER_PARAMS.BUSH_SCALE_RANGE)) {
        bushesPlaced++;
      }
    }
  }

  // Rocas bajas / tocones / hongos en la base del árbol (sin cristales fuera de cueva/arena)
  const rockPool = resolveAllowedRocks(map, cx, cz);
  if (rockPool.length > 0 && nRocks > 0) {
    let rocksPlaced = 0;
    let attempts = 0;
    while (rocksPlaced < nRocks && attempts < 12) {
      attempts++;
      const angle = rng.next() * Math.PI * 2;
      const dist = 0.45 + rng.next() * 0.65;
      const ox = Math.cos(angle) * dist;
      const oz = Math.sin(angle) * dist;
      const rockKind = pickKind(rng, rockPool);
      if (placeProp(rockKind, ox, oz, FOLIAGE_CLUSTER_PARAMS.ROCK_SCALE_RANGE)) {
        rocksPlaced++;
      }
    }
  }

  // Flores alrededor (según tipo de cluster/snowLine/densidad)
  const flowerPool = resolveAllowedFlowers(map, cx, cz, kind, respectDensity);
  if (flowerPool.length > 0 && nFlowers > 0) {
    let flowersPlaced = 0;
    let attempts = 0;
    while (flowersPlaced < nFlowers && attempts < 10) {
      attempts++;
      const angle = rng.next() * Math.PI * 2;
      const dist = 0.95 + rng.next() * 0.6;
      const ox = Math.cos(angle) * dist;
      const oz = Math.sin(angle) * dist;
      const flowerKind = pickKind(rng, flowerPool);
      if (placeProp(flowerKind, ox, oz, FOLIAGE_CLUSTER_PARAMS.FLOWER_SCALE_RANGE)) {
        flowersPlaced++;
      }
    }
  }

  return { centerX: cx, centerZ: cz, kind, props };
}

export function planFoliageClusters(
  map: MapDef,
  options: {
    seed?: number;
    maxClusters?: number;
    minDistBetweenClusters?: number;
    /** Set de tiles ya ocupados (formato "x,z") que el cluster planner debe respetar. */
    occupied?: Set<string>;
    /** Si true (runtime), respeta treeDensity/bushDensity=0 para evitar árboles en mapas limpios/cuevas. */
    respectDensity?: boolean;
  } = {}
): FoliageClusterPlan {
  if (map.isInterior || map.biome === 'cave' || map.music === 'cave') {
    return { clusters: [], solidProps: [], visualProps: [] };
  }
  const respectDensity = options.respectDensity === true;
  if (respectDensity && map.decoration.treeDensity <= 0 && map.decoration.bushDensity <= 0) {
    return { clusters: [], solidProps: [], visualProps: [] };
  }

  const seed =
    options.seed !== undefined ? options.seed : map.decoration.seed ^ 0x434c5553;
  const maxClusters =
    options.maxClusters !== undefined
      ? options.maxClusters
      : Math.ceil((map.grid.length * map.grid[0].length) / 400);
  const minDist =
    options.minDistBetweenClusters !== undefined
      ? options.minDistBetweenClusters
      : FOLIAGE_CLUSTER_PARAMS.MIN_DIST_BETWEEN_CLUSTERS;
  const rng = createRng(seed);

  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  const occupied = new Set<string>(options.occupied);

  // Reservar tiles ocupados por elementos fijos (solo si no fueron provistos externamente)
  if (!options.occupied) {
    for (const w of map.warps) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          occupied.add(`${w.x + dx},${w.y + dz}`);
        }
      }
    }
    for (const npc of map.npcs) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          occupied.add(`${npc.x + dx},${npc.y + dz}`);
        }
      }
    }
    for (const b of map.buildings) {
      for (let dz = -1; dz <= b.depth + 1; dz++) {
        for (let dx = -1; dx <= b.width; dx++) {
          occupied.add(`${b.x + dx},${b.z + dz}`);
        }
      }
    }
    for (const pk of map.pickups ?? []) {
      occupied.add(`${pk.x},${pk.y}`);
    }
    for (const p of map.props) {
      occupied.add(`${p.x},${p.z}`);
    }
  }

  const clusters: ClusterPlan[] = [];
  const clusterCenters: Array<{ x: number; z: number }> = [];

  const attemptsPerCluster = 6;
  let clustersPlaced = 0;
  let totalAttempts = 0;
  const maxTotalAttempts = maxClusters * attemptsPerCluster * 4;

  while (clustersPlaced < maxClusters && totalAttempts < maxTotalAttempts) {
    totalAttempts++;
    const cx = 1 + Math.floor(rng.next() * (width - 2));
    const cz = 1 + Math.floor(rng.next() * (height - 2));

    // Verificar distancia mínima a centros de cluster previos
    let tooClose = false;
    for (const c of clusterCenters) {
      const dx = cx - c.x;
      const dz = cz - c.z;
      if (Math.sqrt(dx * dx + dz * dz) < minDist) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    if (!tileIsFree(map, cx, cz, occupied, true)) continue;

    const clusterKind = inferClusterKind(map, cx, cz, rng);
    const cluster = buildCluster(cx, cz, clusterKind, map, rng, occupied, respectDensity);
    if (!cluster) continue;

    clusterCenters.push({ x: cx, z: cz });
    clusters.push(cluster);
    clustersPlaced++;
  }

  const solidProps: ClusterProp[] = [];
  const visualProps: ClusterProp[] = [];
  for (const cluster of clusters) {
    for (const prop of cluster.props) {
      if (prop.solid) solidProps.push(prop);
      else visualProps.push(prop);
    }
  }

  return { clusters, solidProps, visualProps };
}
