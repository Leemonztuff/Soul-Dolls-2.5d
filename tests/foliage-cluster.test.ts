import { describe, expect, it } from 'vitest';
import { planFoliageClusters, FOLIAGE_CLUSTER_PARAMS } from '../src/engine/FoliageClusterPlanner.ts';
import type { MapDef } from '../src/domain/types.ts';
import { isTileWalkable } from '../src/domain/TerrainRules.ts';

function makeMap({
  width = 24,
  height = 24,
  seed = 12345,
  pathTiles = [] as Array<{ x: number; z: number; tile: string }>,
}: {
  width?: number;
  height?: number;
  seed?: number;
  pathTiles?: Array<{ x: number; z: number; tile: string }>;
} = {}): MapDef {
  const w = width as number;
  const h = height as number;
  const grid: string[] = [];
  const heights: string[] = [];

  for (let z = 0; z < h; z++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const p = pathTiles.find((t) => t.x === x && t.z === z);
      if (p) {
        row += '='; // cobble-ish placeholder
      } else {
        row += '.'; // grass
      }
    }
    grid.push(row);
    heights.push('0'.repeat(w));
  }

  return {
    id: 'foliage_test',
    nameKey: 'foliage_test',
    biome: 'meadow',
    music: 'route',
    skyTopColor: 0x000000,
    skyBottomColor: 0x111111,
    fogColor: 0x222222,
    grid,
    heights,
    legend: {
      '.': { tile: 'grass', solid: false },
      '=': { tile: 'cobble', solid: false },
    },
    buildings: [],
    props: [],
    decoration: {
      seed,
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
  } as unknown as MapDef;
}

describe('FoliageClusterPlanner', () => {
  it('devuelve un plan determinista con el mismo seed', () => {
    const map = makeMap();
    const a = planFoliageClusters(map, { seed: 999, maxClusters: 6 });
    const b = planFoliageClusters(map, { seed: 999, maxClusters: 6 });
    expect(b.clusters.length).toBe(a.clusters.length);
    for (let i = 0; i < a.clusters.length; i++) {
      expect(b.clusters[i].centerX).toBe(a.clusters[i].centerX);
      expect(b.clusters[i].centerZ).toBe(a.clusters[i].centerZ);
      expect(b.clusters[i].props.length).toBe(a.clusters[i].props.length);
    }
  });

  it('distintos seeds producen planes diferentes', () => {
    const map = makeMap();
    const a = planFoliageClusters(map, { seed: 1, maxClusters: 8 });
    const b = planFoliageClusters(map, { seed: 2, maxClusters: 8 });
    let different = false;
    if (a.clusters.length !== b.clusters.length) different = true;
    else {
      for (let i = 0; i < a.clusters.length; i++) {
        if (
          a.clusters[i].centerX !== b.clusters[i].centerX ||
          a.clusters[i].centerZ !== b.clusters[i].centerZ
        ) {
          different = true;
          break;
        }
      }
    }
    expect(different).toBe(true);
  });

  it('el ancla de cada cluster usa offset sub-tile y todos los props están dentro del radio del cluster', () => {
    const map = makeMap();
    const plan = planFoliageClusters(map, { seed: 42, maxClusters: 10 });
    for (const cluster of plan.clusters) {
      const anchor = cluster.props[0];
      const acx = Math.round(anchor.x);
      const acz = Math.round(anchor.z);
      const adx = Math.abs(anchor.x - acx);
      const adz = Math.abs(anchor.z - acz);
      expect(adx).toBeLessThanOrEqual(FOLIAGE_CLUSTER_PARAMS.SUB_TILE_OFFSET_MAX + 1e-6);
      expect(adz).toBeLessThanOrEqual(FOLIAGE_CLUSTER_PARAMS.SUB_TILE_OFFSET_MAX + 1e-6);
      expect(anchor.scale).toBeGreaterThan(0);

      // Todos los props del cluster deben estar dentro del radio máximo desde el centro
      for (const prop of cluster.props) {
        const dx = prop.x - cluster.centerX;
        const dz = prop.z - cluster.centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        expect(dist).toBeLessThanOrEqual(FOLIAGE_CLUSTER_PARAMS.MAX_CLUSTER_RADIUS + 0.05);
      }
    }
  });

  it('los props sólidos respetan isTileWalkable y no se colocan en caminos', () => {
    const map = makeMap({
      pathTiles: [
        { x: 5, z: 5, tile: 'cobble' },
        { x: 6, z: 5, tile: 'cobble' },
        { x: 7, z: 5, tile: 'cobble' },
        { x: 8, z: 5, tile: 'cobble' },
      ],
    });
    const plan = planFoliageClusters(map, { seed: 777, maxClusters: 20 });
    for (const prop of plan.solidProps) {
      const rx = Math.round(prop.x);
      const rz = Math.round(prop.z);
      expect(isTileWalkable(map, rx, rz, rx, rz)).toBe(true);
    }
  });

  it('ningún cluster se coloca sobre un camino', () => {
    const map = makeMap({
      pathTiles: [
        { x: 10, z: 10, tile: 'cobble' },
        { x: 11, z: 10, tile: 'cobble' },
        { x: 12, z: 10, tile: 'cobble' },
      ],
    });
    const plan = planFoliageClusters(map, { seed: 555, maxClusters: 15 });
    for (const cluster of plan.clusters) {
      const rx = Math.round(cluster.centerX);
      const rz = Math.round(cluster.centerZ);
      expect(isTileWalkable(map, rx, rz, rx, rz)).toBe(true);
    }
  });

  it('respeta el límite máximo de clusters', () => {
    const map = makeMap({ width: 40, height: 40 });
    const plan = planFoliageClusters(map, { seed: 31337, maxClusters: 3 });
    expect(plan.clusters.length).toBeLessThanOrEqual(3);
  });

  it('separa centros de cluster por la distancia mínima configurada', () => {
    const map = makeMap({ width: 60, height: 60 });
    const plan = planFoliageClusters(map, { seed: 2024, maxClusters: 20, minDistBetweenClusters: 5 });
    for (let i = 0; i < plan.clusters.length; i++) {
      for (let j = i + 1; j < plan.clusters.length; j++) {
        const dx = plan.clusters[i].centerX - plan.clusters[j].centerX;
        const dz = plan.clusters[i].centerZ - plan.clusters[j].centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        expect(dist).toBeGreaterThanOrEqual(FOLIAGE_CLUSTER_PARAMS.MIN_DIST_BETWEEN_CLUSTERS - 0.5);
      }
    }
  });

  it('toda cluster tiene al menos un árbol principal (ancla)', () => {
    const map = makeMap({ width: 30, height: 30 });
    const plan = planFoliageClusters(map, { seed: 123, maxClusters: 10 });
    for (const cluster of plan.clusters) {
      const hasTree = cluster.props.some(
        (p) =>
          ['oak', 'pine', 'birch', 'snow_pine', 'mushroom_tree', 'mushroom_tree_arcane'].includes(p.kind)
      );
      expect(hasTree).toBe(true);
    }
  });

  it('los props sólidos de un cluster son separados de los visuales', () => {
    const map = makeMap();
    const plan = planFoliageClusters(map, { seed: 4242, maxClusters: 10 });
    const allProps = [...plan.solidProps, ...plan.visualProps];
    const planProps = plan.clusters.flatMap((c) => c.props);
    expect(allProps.length).toBe(planProps.length);
    for (const p of plan.solidProps) {
      expect(
        ['oak', 'pine', 'birch', 'snow_pine', 'mushroom_tree', 'mushroom_tree_arcane', 'boulder'].includes(
          p.kind
        )
      ).toBe(true);
    }
  });
});
