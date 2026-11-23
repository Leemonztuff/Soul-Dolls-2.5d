import { createRng } from '../core/Rng.ts';
import { getTileWorldY, isTileWalkable } from '../domain/TerrainRules.ts';
import type { MapDef, PropKind } from '../domain/types.ts';

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

const TREE_KINDS: ReadonlyArray<PropKind> = [
  'oak',
  'pine',
  'birch',
  'snow_pine',
  'mushroom_tree',
  'mushroom_tree_arcane',
];

const BUSH_KINDS: ReadonlyArray<PropKind> = ['bush', 'bush_arcane'];

const ROCK_KINDS: ReadonlyArray<PropKind> = ['boulder', 'crystal', 'stump', 'mushroom'];

const FLOWER_KINDS: ReadonlyArray<PropKind> = ['flower_patch'];

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
  const solidKinds: ReadonlyArray<PropKind> = [
    'oak',
    'pine',
    'birch',
    'snow_pine',
    'mushroom_tree',
    'mushroom_tree_arcane',
    'boulder',
  ];
  return solidKinds.includes(kind);
}

function isPathTile(map: MapDef, x: number, z: number): boolean {
  const row = map.grid[z];
  if (!row) return false;
  const ch = row[x];
  if (!ch) return false;
  const leg = map.legend[ch];
  if (!leg) return false;
  return (
    leg.tile === 'cobble' ||
    leg.tile === 'dirt' ||
    leg.tile === 'bridge' ||
    leg.tile === 'stairs' ||
    leg.tile === 'arena_floor' ||
    leg.tile === 'water' ||
    (leg.tile === 'stone' && !leg.solid)
  );
}

function tileIsFree(
  map: MapDef,
  x: number,
  z: number,
  occupied: Set<string>
): boolean {
  const key = `${Math.round(x)},${Math.round(z)}`;
  if (occupied.has(key)) return false;
  if (isPathTile(map, x, z)) return false;
  return isTileWalkable(map, x, z, x, z);
}

function buildCluster(
  cx: number,
  cz: number,
  kind: ClusterPlan['kind'],
  map: MapDef,
  rng: ReturnType<typeof createRng>,
  occupied: Set<string>
): ClusterPlan | null {
  const props: ClusterProp[] = [];
  const baseY = getTileWorldY(map, Math.round(cx), Math.round(cz));
  void baseY;

  const placeProp = (
    propKind: PropKind,
    offsetX: number,
    offsetZ: number,
    scaleRange: readonly [number, number]
  ): boolean => {
    const x = cx + offsetX;
    const z = cz + offsetZ;
    const rx = Math.round(x);
    const rz = Math.round(z);
    const key = `${rx},${rz}`;
    if (occupied.has(key)) return false;
    if (!tileIsFree(map, rx, rz, occupied)) return false;

    const solid = isSolidProp(propKind);
    const y = getTileWorldY(map, rx, rz);
    const scale = clampScale(rng, scaleRange);

    props.push({ kind: propKind, x, z, y, scale, solid });
    occupied.add(key);
    if (solid) {
      // Las rocas y árboles sólidos ocupan su tile lógico para colisión.
    }
    return true;
  };

  // Composición base: 1 árbol principal + 2-3 arbustos + 1-2 rocas + 0-2 flores
  const nBushes = 2 + Math.floor(rng.next() * 2); // 2 o 3
  const nRocks = 1 + Math.floor(rng.next() * 2); // 1 o 2
  const nFlowers = rng.next() < 0.6 ? 1 + Math.floor(rng.next() * 2) : 0; // 0, 1 o 2

  // Árbol principal en el centro con pequeño offset
  const treeKind = pickKind(rng, TREE_KINDS);
  if (!placeProp(treeKind, subTileOffset(rng), subTileOffset(rng), FOLIAGE_CLUSTER_PARAMS.TREE_SCALE_RANGE)) {
    return null; // No se pudo colocar el ancla del cluster
  }

  // Arbustos satélite alrededor del árbol
  let bushesPlaced = 0;
  let attempts = 0;
  while (bushesPlaced < nBushes && attempts < 12) {
    attempts++;
    const angle = rng.next() * Math.PI * 2;
    const dist = 0.7 + rng.next() * 0.9;
    const ox = Math.cos(angle) * dist;
    const oz = Math.sin(angle) * dist;
    const bushKind = pickKind(rng, BUSH_KINDS);
    if (placeProp(bushKind, ox, oz, FOLIAGE_CLUSTER_PARAMS.BUSH_SCALE_RANGE)) {
      bushesPlaced++;
    }
  }

  // Rocas bajas en la base del árbol
  let rocksPlaced = 0;
  attempts = 0;
  while (rocksPlaced < nRocks && attempts < 12) {
    attempts++;
    const angle = rng.next() * Math.PI * 2;
    const dist = 0.45 + rng.next() * 0.55;
    const ox = Math.cos(angle) * dist;
    const oz = Math.sin(angle) * dist;
    const rockKind = pickKind(rng, ROCK_KINDS);
    if (placeProp(rockKind, ox, oz, FOLIAGE_CLUSTER_PARAMS.ROCK_SCALE_RANGE)) {
      rocksPlaced++;
    }
  }

  // Flores alrededor (solo visuales, no sólidas)
  let flowersPlaced = 0;
  attempts = 0;
  while (flowersPlaced < nFlowers && attempts < 10) {
    attempts++;
    const angle = rng.next() * Math.PI * 2;
    const dist = 1.0 + rng.next() * 0.6;
    const ox = Math.cos(angle) * dist;
    const oz = Math.sin(angle) * dist;
    const flowerKind = pickKind(rng, FLOWER_KINDS);
    if (placeProp(flowerKind, ox, oz, FOLIAGE_CLUSTER_PARAMS.FLOWER_SCALE_RANGE)) {
      flowersPlaced++;
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
  } = {}
): FoliageClusterPlan {
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

  // Intentar colocar clusters en tiles de grass libres, distribuidos por el mapa
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

    // El centro debe estar en un tile libre y transitible
    if (!tileIsFree(map, cx, cz, occupied)) continue;

    const clusterKind: ClusterPlan['kind'] =
      rng.next() < 0.35 ? 'forest' :
      rng.next() < 0.5 ? 'meadow' :
      rng.next() < 0.75 ? 'riverside' :
      'rocky';

    const cluster = buildCluster(cx, cz, clusterKind, map, rng, occupied);
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
