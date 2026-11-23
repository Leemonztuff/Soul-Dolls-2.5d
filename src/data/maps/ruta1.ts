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

function buildRuta1() {
  const z = createZoneCanvas(48, 56, '.', 2);

  addPerimeterMountains(z, 5, 7, '#');
  addHill(z, 11, 15, 9, 4);
  addHill(z, 36, 22, 10, 4);
  addHill(z, 13, 39, 9, 3);
  addHill(z, 35, 42, 8, 3);

  // Winding dirt path from south (23,55) to north (23,0)
  carveRoad(z, 23, 55, 23, 42, 2, ',', 2);
  carveRoad(z, 23, 42, 16, 32, 2, ',', 2);
  carveRoad(z, 16, 32, 16, 22, 2, ',', 3);
  carveRoad(z, 16, 22, 28, 16, 2, ',', 3);
  carveRoad(z, 28, 16, 23, 7, 2, ',', 2);
  carveRoad(z, 23, 7, 23, 0, 2, ',', 2);

  // Ramp transitions on gentle hill
  fillRect(z, 16, 26, 2, 2, '^', 2);
  fillRect(z, 26, 15, 2, 2, '^', 2);

  // Tall grass encounter clearings
  fillRect(z, 18, 43, 8, 5, '"', 2);
  fillRect(z, 12, 25, 6, 6, '"', 3);
  fillRect(z, 24, 24, 9, 6, '"', 2);
  fillRect(z, 16, 8, 9, 6, '"', 2);

  // Pond and flowers
  fillRect(z, 31, 31, 6, 5, '~', 1);
  fillRect(z, 27, 45, 5, 4, '*', 2);
  fillRect(z, 28, 8, 5, 4, '*', 2);

  // Smooth valley passes at south & north exits
  carveMapPass(z, {
    x: 23,
    y: 55,
    exitDir: 'south',
    roadTile: ',',
    height: 2,
    depth: 8,
    shoulderWidth: 3,
    slopeWidth: 5,
    shoulderTile: '.',
  });
  carveMapPass(z, {
    x: 23,
    y: 0,
    exitDir: 'north',
    roadTile: ',',
    height: 2,
    depth: 8,
    shoulderWidth: 3,
    slopeWidth: 5,
    shoulderTile: '.',
  });

  return finalizeZone(z);
}

const built = buildRuta1();

export const MAP_RUTA_1: MapDef = {
  id: 'ruta_1',
  nameKey: 'ruta_1',
  biome: 'meadow',
  music: 'route',
  skyTopColor: hexToNumber(PALETTE.vibrantAqua),
  skyBottomColor: hexToNumber(PALETTE.frostedGlass),
  fogColor: hexToNumber(PALETTE.iceCyan),
  snowLine: 8,
  grid: built.grid,
  heights: built.heights,
  legend: DEFAULT_LEGEND,
  buildings: [],
  props: [
    { kind: 'lamp_wood', x: 22, z: 50 },
    { kind: 'stump', x: 26, z: 38 },
    { kind: 'mushroom', x: 14, z: 36 },
    { kind: 'mushroom_tree', x: 13, z: 35 },
    { kind: 'mushroom_tree_arcane', x: 34, z: 24 },
    { kind: 'atlas_banco_00', x: 29, z: 30 },
    { kind: 'atlas_cerca_00', x: 20, z: 40 },
    { kind: 'atlas_cerca_00', x: 21, z: 40 },
    { kind: 'lamp_wood', x: 25, z: 50 },
    { kind: 'atlas_cerca_00', x: 21, z: 53 },
    { kind: 'atlas_cerca_00', x: 26, z: 53 },
    { kind: 'lamp_wood', x: 21, z: 3 },
    { kind: 'lamp_wood', x: 26, z: 3 },
  ],
  decoration: {
    seed: 202,
    treeDensity: 0.18,
    bushDensity: 0.1,
    flowerDensity: 0.08,
    rockDensity: 0.04,
    mushroomDensity: 0.03,
    treeKinds: ['oak', 'pine', 'birch', 'mushroom_tree'],
  },
  warps: [
    { x: 23, y: 55, targetMap: 'villa_origen', targetX: 23, targetY: 2, dir: 'down' },
    { x: 24, y: 55, targetMap: 'villa_origen', targetX: 24, targetY: 2, dir: 'down' },
    { x: 23, y: 0, targetMap: 'pueblo_bruma', targetX: 23, targetY: 45, dir: 'up' },
    { x: 24, y: 0, targetMap: 'pueblo_bruma', targetX: 24, targetY: 45, dir: 'up' },
  ],
  npcs: [
    {
      id: 'npc_ruta1_scout',
      name: 'Explorador Lucas',
      role: 'trainer',
      x: 15,
      y: 31,
      dir: 'right',
      dialogKey: 'trainer',
      trainerId: 'ruta1_scout',
      sightRange: 4,
      patrol: {
        waypoints: [
          { x: 15, y: 31 },
          { x: 15, y: 34 },
        ],
        speed: 1.35,
        pauseSec: 1.6,
      },
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'npc_rival_1',
      name: 'Rival Damián',
      role: 'rival',
      x: 23,
      y: 6,
      dir: 'down',
      dialogKey: 'trainer',
      trainerId: 'rival_1',
      sightRange: 3,
      flagHidden: 'rival_1_defeated',
    },
  ],
  signs: [{ x: 22, y: 52, textKey: 'sign_ruta1' }],
  pickups: [
    { id: 'ruta1_fragmento', x: 28, y: 12, itemId: 'fragmento_alma', quantity: 1 },
  ],
  encounters: ENCOUNTERS.ruta_1,
};
