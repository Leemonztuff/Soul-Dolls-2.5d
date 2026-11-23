import type { MapDef } from '../../domain/types.ts';
import { hexToNumber, PALETTE } from '../../gfx/Palette.ts';
import {
  createZoneCanvas,
  DEFAULT_LEGEND,
  fillRect,
  finalizeZone,
} from './mapBuilder.ts';

/**
 * Isolated 32x32 (2x2 chunks) terrain contour validation map for P1:
 * - 3 primary elevation tiers (levels 1, 3, 5) + river bed (level 0)
 * - Crosses x=16 and z=16 chunk boundaries on every plateau tier
 * - Exercises convex corners, concave inner bays, eroded straight cliff rims,
 *   narrow 2-tile walkable ridge corridors, staircases, water+bridge, and
 *   a protected building footprint.
 */
function buildTestRiverbank() {
  const z = createZoneCanvas(32, 32, '.', 1);

  // Mid terrace plateau (level 3) spanning x=16 & z=16 chunk boundaries
  fillRect(z, 6, 14, 19, 6, '.', 3);
  // Protruding northern wing at level 3 (creates convex + concave corners across x=16)
  fillRect(z, 6, 8, 7, 6, '.', 3);
  fillRect(z, 20, 14, 7, 6, '.', 3);

  // Carved lower grass bay (level 1) cutting across x=16 and z=16 to create clear concave corners
  fillRect(z, 13, 16, 5, 5, '.', 1);

  // Narrow 2-tile walkable corridor ridge at level 3 connecting west wing to east stairs
  fillRect(z, 13, 10, 7, 2, '.', 3);

  // Upper rocky overlook (level 5) spanning x=16 chunk boundary
  fillRect(z, 12, 3, 13, 5, '#', 5);
  // Flat walkable plaza on top of the level-5 overlook + stair landing at (15..16, 7)
  fillRect(z, 14, 4, 9, 3, '_', 5);
  fillRect(z, 15, 7, 2, 1, '_', 5);

  // Outer stone cap accents on a couple of cliff rims (solid vs walkable corner test)
  fillRect(z, 6, 8, 3, 2, '#', 3);
  fillRect(z, 24, 16, 3, 3, '#', 3);

  // P3 Surface Transitions across tiers & x=16 / z=16 seams (strictly preserving P1/P2 heights & footprints)
  // Upper overlook (level 5): stone <-> dirt <-> grass near rocky cliff edge
  fillRect(z, 18, 4, 4, 2, ',', 5);
  fillRect(z, 20, 5, 2, 1, '.', 5);

  // Mid terrace (level 3): dirt + walkable stone patio crossing x=16, meeting grass and solid rock
  fillRect(z, 8, 15, 4, 3, ',', 3);
  fillRect(z, 15, 14, 4, 2, '_', 3);
  fillRect(z, 19, 15, 3, 3, ',', 3);

  // Lower bay (level 1, z=16..19): dirt & sand patches crossing x=16 right against level-3 cliff foot
  fillRect(z, 14, 17, 4, 3, ',', 1);
  fillRect(z, 15, 19, 3, 1, 's', 1);

  // River channel (level 0 water) with walkable wooden bridge at z=24..25
  fillRect(z, 16, 20, 3, 11, '~', 0);
  fillRect(z, 16, 24, 3, 2, 'B', 1);

  // Sandy & earthy riverbank patches (grass <-> sand, dirt <-> sand, grass <-> dirt)
  fillRect(z, 12, 20, 4, 3, ',', 1);
  fillRect(z, 19, 20, 3, 4, 's', 1);
  fillRect(z, 21, 21, 3, 2, ',', 1);
  fillRect(z, 19, 26, 3, 4, 's', 1);
  fillRect(z, 22, 27, 3, 2, ',', 1);

  // Cobble plaza & protected house yard in south-west quadrant
  fillRect(z, 5, 22, 6, 5, '=', 1);
  fillRect(z, 10, 20, 2, 5, '=', 1);
  fillRect(z, 12, 24, 4, 2, '=', 1);
  fillRect(z, 19, 24, 6, 2, '=', 1);

  // Stairs 1: South riverbank (level 1) -> Mid terrace (level 3)
  fillRect(z, 10, 19, 2, 1, '^', 2);

  // Stairs 2: Mid terrace ridge (level 3) -> Upper overlook (level 5)
  fillRect(z, 15, 8, 2, 1, '^', 4);
  fillRect(z, 15, 9, 2, 1, '^', 3);

  return finalizeZone(z);
}

const built = buildTestRiverbank();

export const MAP_TEST_RIVERBANK: MapDef = {
  id: 'test_riverbank',
  nameKey: 'test_riverbank',
  biome: 'meadow',
  music: 'route',
  skyTopColor: hexToNumber(PALETTE.oceanicTeal),
  skyBottomColor: hexToNumber(PALETTE.frostedGlass),
  fogColor: hexToNumber(PALETTE.iceCyan),
  grid: built.grid,
  heights: built.heights,
  legend: DEFAULT_LEGEND,
  buildings: [
    { kind: 'house_red', x: 5, z: 22, width: 4, depth: 3, facing: 'down' },
  ],
  props: [
    { kind: 'lamp_wood', x: 9, z: 25 },
    { kind: 'oak', x: 3, z: 20 },
    { kind: 'atlas_arbolmanzano_00', x: 2, z: 18 },
    { kind: 'pine', x: 26, z: 22 },
    { kind: 'atlas_arbolmanzano_00', x: 28, z: 20 },
    { kind: 'boulder', x: 23, z: 27 },
    { kind: 'lamp_stone', x: 14, z: 5 },
  ],
  decoration: {
    seed: 777,
    treeDensity: 0,
    bushDensity: 0,
    flowerDensity: 0,
    rockDensity: 0,
    mushroomDensity: 0,
    treeKinds: ['oak', 'pine'],
  },
  warps: [],
  npcs: [],
  signs: [],
};
