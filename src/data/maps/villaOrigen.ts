import type { MapDef } from '../../domain/types.ts';
import { hexToNumber, PALETTE } from '../../gfx/Palette.ts';
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

function buildVillaOrigen() {
  const z = createZoneCanvas(48, 48, '.', 2);

  // Rolling perimeter hills and distant mountain backdrop
  addPerimeterMountains(z, 5, 8, '#');
  addHill(z, 10, 10, 8, 3);
  addHill(z, 38, 12, 9, 4);
  addHill(z, 11, 37, 8, 3);
  addHill(z, 37, 36, 9, 4);

  // Village central plateau at height 2 (+ south-east cottage plot & yard)
  fillRect(z, 12, 14, 24, 22, '.', 2);
  fillRect(z, 28, 30, 9, 7, '.', 2);
  // Village plaza cobble, lab entrance walkway & cottage walkway
  fillRect(z, 17, 20, 14, 11, '=', 2);
  fillRect(z, 18, 18, 3, 2, '=', 2);
  fillRect(z, 29, 31, 4, 5, '=', 2);
  // Pond on east side
  fillRect(z, 31, 24, 5, 5, '~', 1);
  // Flower meadows
  fillRect(z, 13, 25, 3, 4, '*', 2);
  fillRect(z, 33, 16, 3, 3, '*', 2);
  // Workshop cobble courtyard
  fillRect(z, 29, 17, 4, 3, '=', 2);

  // North exit road to Ruta 1
  carveRoad(z, 23, 0, 23, 21, 2, '=', 2);
  // Subtle stairs approaching north gate
  fillRect(z, 23, 5, 2, 2, '^', 2);
  // Wide grassy pass into Ruta 1 (avoids steep V-trench)
  carveMapPass(z, {
    x: 23,
    y: 0,
    exitDir: 'north',
    roadTile: '=',
    height: 2,
    depth: 8,
    shoulderWidth: 3,
    slopeWidth: 5,
    shoulderTile: '.',
  });

  return finalizeZone(z);
}

const built = buildVillaOrigen();

export const MAP_VILLA_ORIGEN: MapDef = {
  id: 'villa_origen',
  nameKey: 'villa_origen',
  biome: 'meadow',
  music: 'town',
  skyTopColor: hexToNumber(PALETTE.oceanicTeal),
  skyBottomColor: hexToNumber(PALETTE.frostedGlass),
  fogColor: hexToNumber(PALETTE.iceCyan),
  snowLine: 8,
  grid: built.grid,
  heights: built.heights,
  legend: DEFAULT_LEGEND,
  buildings: [
    { kind: 'lab', x: 17, z: 14, width: 5, depth: 4, facing: 'down' },
    { kind: 'house_red', x: 13, z: 19, width: 4, depth: 3, facing: 'down' },
    { kind: 'workshop', x: 29, z: 14, width: 4, depth: 3, facing: 'down' },
    { kind: 'house_blue', x: 30, z: 31, width: 3, depth: 3, facing: 'down' },
  ],
  props: [
    { kind: 'well', x: 20, z: 24 },
    { kind: 'lamp_wood', x: 22, z: 20 },
    { kind: 'lamp_wood', x: 28, z: 19 },
    { kind: 'lamp_post', x: 22, z: 30 },
    { kind: 'lamp_post', x: 26, z: 30 },
    { kind: 'lamp_stone', x: 30, z: 29 },
    { kind: 'lamp_double', x: 28, z: 21 },
    { kind: 'atlas_banco_00', x: 18, z: 29 },
    { kind: 'atlas_cerca_00', x: 13, z: 24 },
    { kind: 'atlas_cerca_00', x: 14, z: 24 },
    { kind: 'atlas_cerca_00', x: 15, z: 24 },
    { kind: 'oak', x: 14, z: 31 },
    { kind: 'atlas_arbolmanzano_00', x: 11, z: 31 },
    { kind: 'birch', x: 35, z: 31 },
    { kind: 'atlas_arbolmanzano_00', x: 38, z: 31 },
    { kind: 'mushroom_tree', x: 13, z: 29 },
    { kind: 'mushroom_tree_arcane', x: 35, z: 18 },
    { kind: 'lamp_wood', x: 21, z: 3 },
    { kind: 'lamp_wood', x: 26, z: 3 },
    { kind: 'atlas_cerca_00', x: 20, z: 2 },
    { kind: 'atlas_cerca_00', x: 21, z: 2 },
    { kind: 'atlas_cerca_00', x: 26, z: 2 },
    { kind: 'atlas_cerca_00', x: 27, z: 2 },
  ],
  decoration: {
    seed: 101,
    treeDensity: 0.14,
    bushDensity: 0.08,
    flowerDensity: 0.06,
    rockDensity: 0.03,
    mushroomDensity: 0.02,
    treeKinds: ['oak', 'birch', 'pine'],
  },
  warps: [
    { x: 23, y: 0, targetMap: 'ruta_1', targetX: 23, targetY: 53, dir: 'up' },
    { x: 24, y: 0, targetMap: 'ruta_1', targetX: 24, targetY: 53, dir: 'up' },
    {
      x: 19,
      y: 18,
      targetMap: 'laboratorio_origen',
      targetX: 8,
      targetY: 10,
      dir: 'up',
      doorStyle: 'building',
    },
    {
      x: 30,
      y: 17,
      targetMap: 'taller_origen',
      targetX: 8,
      targetY: 10,
      dir: 'up',
      doorStyle: 'building',
    },
    {
      x: 31,
      y: 17,
      targetMap: 'taller_origen',
      targetX: 9,
      targetY: 10,
      dir: 'up',
      doorStyle: 'building',
    },
    {
      x: 31,
      y: 34,
      targetMap: 'casa_villa_pb',
      targetX: 8,
      targetY: 10,
      dir: 'up',
      houseId: 'casa_villa',
      doorStyle: 'building',
    },
  ],
  npcs: [
    {
      id: 'guia_villa',
      name: 'Guía Lía',
      role: 'trainer',
      x: 24,
      y: 24,
      dir: 'down',
      dialogKey: 'guide_remind_prof',
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'aldeano_origen',
      name: 'Vecina Alba',
      role: 'npc',
      x: 16,
      y: 26,
      dir: 'right',
      dialogKey: 'villager_origen',
      patrol: {
        waypoints: [
          { x: 16, y: 26 },
          { x: 19, y: 26 },
          { x: 19, y: 28 },
          { x: 16, y: 28 },
        ],
        speed: 1.5,
        pauseSec: 1.3,
      },
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'aprendiz_taller',
      name: 'Aprendiz Kael',
      role: 'artisan',
      x: 33,
      y: 18,
      dir: 'left',
      dialogKey: 'aprendiz_taller',
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'agente_villa',
      name: 'Agente Bruno',
      role: 'merchant',
      x: 29,
      y: 34,
      dir: 'down',
      dialogKey: 'house_broker_villa',
      houseBrokerId: 'casa_villa',
      lookAtPlayerAfterTalk: true,
    },
  ],
  signs: [
    { x: 22, y: 18, textKey: 'sign_origen' },
    { x: 28, y: 17, textKey: 'sign_taller' },
  ],
};
