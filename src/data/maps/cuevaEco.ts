import type { MapDef } from '../../domain/types.ts';
import { hexToNumber, PALETTE } from '../../gfx/Palette.ts';
import { ENCOUNTERS } from '../encounters.ts';
import {
  addHill,
  addPerimeterMountains,
  carveMapPass,
  carveRoad,
  createZoneCanvas,
  DEFAULT_LEGEND,
  fillRect,
  finalizeZone,
} from './mapBuilder.ts';

function buildCuevaEco() {
  const z = createZoneCanvas(48, 48, 'c', 2);

  addPerimeterMountains(z, 6, 8, '#');
  // Steep cavern ridges inside the cave
  addHill(z, 13, 24, 9, 6, '#');
  addHill(z, 35, 22, 9, 6, '#');
  addHill(z, 15, 10, 6, 5, '#');
  addHill(z, 33, 36, 6, 5, '#');

  // Main cavern walkway from south (23,47) to north (23,0)
  carveRoad(z, 23, 47, 23, 32, 2, '_', 2);
  carveRoad(z, 23, 32, 23, 16, 2, '_', 3);
  fillRect(z, 23, 30, 2, 2, '^', 2);
  carveRoad(z, 23, 16, 23, 0, 2, '_', 4);
  fillRect(z, 23, 15, 2, 2, '^', 3);

  // Underground crystal chambers (encounter zones)
  fillRect(z, 17, 34, 6, 6, '%', 2);
  fillRect(z, 26, 33, 6, 6, '%', 2);
  fillRect(z, 18, 17, 5, 8, '%', 3);
  fillRect(z, 25, 17, 6, 8, '%', 3);

  // Terraced cavern mouths at south & north exits
  carveMapPass(z, {
    x: 23,
    y: 47,
    exitDir: 'south',
    roadTile: '_',
    height: 2,
    depth: 7,
    shoulderWidth: 2,
    slopeWidth: 4,
    shoulderTile: 'c',
  });
  carveMapPass(z, {
    x: 23,
    y: 0,
    exitDir: 'north',
    roadTile: '_',
    height: 4,
    depth: 7,
    shoulderWidth: 2,
    slopeWidth: 4,
    shoulderTile: 'c',
  });

  return finalizeZone(z);
}

const built = buildCuevaEco();

export const MAP_CUEVA_ECO: MapDef = {
  id: 'cueva_eco',
  nameKey: 'cueva_eco',
  biome: 'cave',
  music: 'cave',
  skyTopColor: hexToNumber(PALETTE.abyssInk),
  skyBottomColor: hexToNumber(PALETTE.nightshade),
  fogColor: hexToNumber(PALETTE.cryptInk),
  grid: built.grid,
  heights: built.heights,
  legend: DEFAULT_LEGEND,
  buildings: [],
  props: [
    { kind: 'crystal', x: 19, z: 36 },
    { kind: 'crystal', x: 29, z: 35 },
    { kind: 'crystal', x: 20, z: 20 },
    { kind: 'crystal', x: 28, z: 20 },
    { kind: 'crystal', x: 21, z: 8 },
    { kind: 'crystal', x: 26, z: 8 },
  ],
  decoration: {
    seed: 505,
    treeDensity: 0,
    bushDensity: 0,
    flowerDensity: 0,
    rockDensity: 0.15,
    mushroomDensity: 0.06,
    treeKinds: [],
  },
  warps: [
    { x: 23, y: 47, targetMap: 'ruta_2', targetX: 36, targetY: 2, dir: 'down' },
    { x: 24, y: 47, targetMap: 'ruta_2', targetX: 37, targetY: 2, dir: 'down' },
    { x: 23, y: 0, targetMap: 'arena_cumbre', targetX: 23, targetY: 45, dir: 'up' },
    { x: 24, y: 0, targetMap: 'arena_cumbre', targetX: 24, targetY: 45, dir: 'up' },
  ],
  npcs: [
    {
      id: 'npc_cueva_minero',
      name: 'Geólogo Braulio',
      role: 'trainer',
      x: 22,
      y: 26,
      dir: 'right',
      dialogKey: 'trainer',
      trainerId: 'cueva_minero',
      sightRange: 4,
      patrol: {
        waypoints: [
          { x: 22, y: 26 },
          { x: 22, y: 23 },
        ],
        speed: 1.3,
        pauseSec: 1.6,
      },
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'npc_guardian_eco',
      name: 'Guardián del Eco',
      role: 'leader',
      x: 28,
      y: 23,
      dir: 'left',
      dialogKey: 'trainer',
      trainerId: 'guardian_eco',
      flagRequired: 'rival_2_defeated',
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'npc_rival_2',
      name: 'Rival Damián',
      role: 'rival',
      x: 23,
      y: 8,
      dir: 'down',
      dialogKey: 'trainer',
      trainerId: 'rival_2',
      sightRange: 3,
      flagHidden: 'rival_2_defeated',
    },
  ],
  signs: [{ x: 22, y: 43, textKey: 'sign_cueva' }],
  pickups: [
    { id: 'cueva_fragmento', x: 20, y: 21, itemId: 'fragmento_alma', quantity: 1 },
  ],
  encounters: ENCOUNTERS.cueva_eco,
};
