import type { MapDef } from '../../domain/types.ts';
import { hexToNumber, PALETTE } from '../../gfx/Palette.ts';
import {
  DEFAULT_LEGEND,
  generateNoiseWorldMap,
} from './mapBuilder.ts';

function buildArenaCumbreTerrain() {
  return generateNoiseWorldMap({
    width: 52,
    height: 52,
    seed: 606,
    baseTile: 'w',
    baseHeight: 3,
    perimeter: {
      thickness: 4.8,
      peakHeight: 9,
      ridgeTile: '#',
      shelfTile: 'w',
      amplitude: 3.0,
      seed: 606,
    },
    rooms: [
      // Lower Citadel Courtyard (tiered snowy clearing)
      {
        cx: 25.5,
        cy: 38.0,
        rx: 20.0,
        rz: 8.2,
        height: 3,
        tile: 'w',
        shape: 'tiered_amphitheater',
        lobes: 5,
        distortion: 0.26,
        seed: 613,
      },
      // Middle Citadel Terrace (crescent overlooking courtyard)
      {
        cx: 28.0,
        cy: 24.5,
        rx: 17.0,
        rz: 4.6,
        height: 4,
        tile: 'w',
        shape: 'crescent',
        angle: -Math.PI * 0.5,
        distortion: 0.26,
        seed: 621,
      },
      // Upper Summit Sanctuary (Snowy Crown)
      {
        cx: 25.5,
        cy: 12.2,
        rx: 12.2,
        rz: 6.2,
        height: 6,
        tile: 'w',
        shape: 'craggy_sanctuary',
        lobes: 5,
        distortion: 0.24,
        seed: 641,
      },
      // Secret Western Cliff Overlook
      {
        cx: 8.2,
        cy: 21.5,
        rx: 3.0,
        rz: 8.5,
        height: 3,
        tile: 'w',
        shape: 'winding_meadow',
        angle: 0.1,
        distortion: 0.28,
        seed: 661,
      },
    ],
    waterBodies: [
      // Glacial alpine pool in SE lower flank
      {
        kind: 'lake',
        cx: 39.5,
        cy: 42.5,
        rx: 4.4,
        rz: 3.1,
        waterHeight: 2,
        waterTile: '~',
        jitter: 0.36,
        borderMargin: 5,
        seed: 617,
      },
    ],
    islets: [
      // Stepped frozen rock islet in SE glacial pool
      {
        cx: 40.5,
        cy: 43.0,
        rx: 1.6,
        rz: 1.4,
        tiers: [
          { scale: 1.0, height: 3, tile: 'w' },
          { scale: 0.55, height: 5, tile: '#' },
        ],
        seed: 619,
      },
      // Flanking alpine rock spires at summit
      {
        cx: 14.5,
        cy: 10.0,
        rx: 2.2,
        rz: 2.0,
        tiers: [
          { scale: 1.0, height: 7, tile: 'w' },
          { scale: 0.55, height: 8, tile: '#' },
        ],
        seed: 643,
      },
      {
        cx: 36.5,
        cy: 10.0,
        rx: 2.2,
        rz: 2.0,
        tiers: [
          { scale: 1.0, height: 7, tile: 'w' },
          { scale: 0.55, height: 8, tile: '#' },
        ],
        seed: 647,
      },
    ],
    outcropClusters: [
      { cx: 18.0, cy: 28.0, count: 3, spread: 2.2, baseHeight: 3, shelfTile: 'w', capTile: '#', seed: 631 },
      { cx: 32.5, cy: 28.0, count: 2, spread: 1.8, baseHeight: 3, shelfTile: 'w', capTile: '#', seed: 637 },
      { cx: 18.5, cy: 18.2, count: 2, spread: 1.8, baseHeight: 4, shelfTile: 'w', capTile: '#', seed: 653 },
      { cx: 32.5, cy: 18.2, count: 2, spread: 1.8, baseHeight: 4, shelfTile: 'w', capTile: '#', seed: 659 },
      { cx: 11.2, cy: 20.5, count: 3, spread: 2.2, baseHeight: 3, shelfTile: 'w', capTile: '#', seed: 673 },
    ],
    passes: [
      {
        x: 25,
        y: 0,
        exitDir: 'south',
        roadWidth: 2,
        roadTile: 'A',
        height: 3,
        depth: 8,
        shoulderWidth: 3,
        slopeWidth: 5,
        shoulderTile: 'w',
      },
    ],
    stairs: [
      // Middle terrace stairs (3 -> 4)
      { x: 23, y: 27, w: 6, h: 1, height: 4, tile: '^' },
      { x: 23, y: 28, w: 6, h: 1, height: 3, tile: '^' },
      { x: 36, y: 27, w: 4, h: 1, height: 4, tile: '^' },
      { x: 36, y: 28, w: 4, h: 1, height: 3, tile: '^' },
      // Summit sanctuary stairs (4 -> 5 -> 6)
      { x: 23, y: 17, w: 5, h: 1, height: 6, tile: '^' },
      { x: 23, y: 18, w: 5, h: 1, height: 5, tile: '^' },
      { x: 23, y: 19, w: 5, h: 1, height: 4, tile: '^' },
    ],
    paths: [
      // Meandering ceremonial approach in lower courtyard
      {
        waypoints: [
          { x: 25.5, y: 50 },
          { x: 24.0, y: 40 },
          { x: 25.5, y: 29.5 },
        ],
        baseWidth: 2.2,
        meanderAmp: 1.5,
        meanderFreq: 0.15,
        widthBreath: 0.34,
        tile: 'A',
        height: 3,
        seed: 677,
      },
      // Middle terrace ceremonial path
      {
        waypoints: [
          { x: 25.5, y: 26 },
          { x: 25.5, y: 20.5 },
        ],
        baseWidth: 2.2,
        meanderAmp: 1.0,
        meanderFreq: 0.18,
        widthBreath: 0.3,
        tile: 'A',
        height: 4,
        seed: 683,
      },
      // Lower plaza cross avenue
      {
        waypoints: [
          { x: 12.5, y: 36.5 },
          { x: 20.0, y: 37.5 },
          { x: 30.0, y: 36.6 },
          { x: 38.5, y: 36.5 },
        ],
        baseWidth: 2.1,
        meanderAmp: 1.2,
        meanderFreq: 0.16,
        widthBreath: 0.3,
        tile: 'A',
        height: 3,
        seed: 701,
      },
      // Middle terrace branch to Refugio Cumbre
      {
        waypoints: [
          { x: 25.5, y: 24.5 },
          { x: 32.0, y: 25.5 },
          { x: 38.5, y: 25.0 },
        ],
        baseWidth: 2.0,
        meanderAmp: 1.0,
        meanderFreq: 0.18,
        widthBreath: 0.28,
        tile: 'A',
        height: 4,
        seed: 709,
      },
      // Non-linear stone overlook trail up the western cliff shelf
      {
        waypoints: [
          { x: 10.5, y: 32.0 },
          { x: 8.5, y: 25.0 },
          { x: 8.0, y: 15.5 },
        ],
        baseWidth: 2.0,
        meanderAmp: 1.3,
        meanderFreq: 0.16,
        widthBreath: 0.32,
        tile: '_',
        height: 3,
        seed: 727,
      },
    ],
    buildingPads: [
      { x: 22, y: 9, w: 7, h: 6, tile: 'w', height: 6 },
      { x: 10, y: 32, w: 5, h: 5, tile: 'w', height: 3 },
      { x: 36, y: 32, w: 5, h: 5, tile: 'w', height: 3 },
      { x: 36, y: 21, w: 5, h: 5, tile: 'w', height: 4 },
      { x: 15, y: 23, w: 3, h: 3, tile: 'w', height: 4 },
      { x: 23, y: 14, w: 5, h: 3, tile: 'A', height: 6 },
    ],
    guaranteedCells: [
      { x: 8, y: 15, tile: '_', height: 3 },
      { x: 16, y: 24, tile: 'w', height: 4 },
      { x: 22, y: 16, tile: 'A', height: 6 },
      { x: 25, y: 14, tile: 'A', height: 6 },
      { x: 12, y: 36, tile: 'A', height: 3 },
      { x: 38, y: 36, tile: 'A', height: 3 },
      { x: 38, y: 25, tile: 'A', height: 4 },
      { x: 35, y: 25, tile: 'A', height: 4 },
    ],
    customPostProcess: (z) => {
      for (let x = 22; x < 30; x++) {
        if (x < 23 || x > 28) {
          z.tiles[28][x] = '#';
          z.heights[28][x] = 3;
        }
      }
      for (let x = 35; x < 41; x++) {
        if (x < 36 || x > 39) {
          z.tiles[28][x] = '#';
          z.heights[28][x] = 3;
        }
      }
      for (let x = 22; x < 29; x++) {
        if (x < 23 || x > 27) {
          z.tiles[18][x] = '#';
          z.heights[18][x] = 5;
        }
      }
    },
  });
}

const { grid, heights } = buildArenaCumbreTerrain();

export const MAP_ARENA_CUMBRE: MapDef = {
  id: 'arena_cumbre',
  nameKey: 'arena_cumbre',
  biome: 'snow',
  music: 'town',
  skyTopColor: hexToNumber(PALETTE.stoneShadow),
  skyBottomColor: hexToNumber(PALETTE.iceCyan),
  fogColor: hexToNumber(PALETTE.frostedGlass),
  snowLine: 5,
  grid,
  heights,
  legend: DEFAULT_LEGEND,
  buildings: [
    // Salón monumental de la Liga Cumbre (puerta en 25, 14)
    { kind: 'arena_hall', x: 22, z: 9, width: 7, depth: 5, facing: 'down' },
    // Centro de Curación y Tienda en el patio inferior
    { kind: 'center', x: 10, z: 32, width: 5, depth: 4, facing: 'down' },
    { kind: 'shop', x: 36, z: 32, width: 5, depth: 4, facing: 'down' },
    // Refugio Cumbre adquirible en la terraza media (puerta en 38, 25)
    { kind: 'house_blue', x: 36, z: 21, width: 5, depth: 4, facing: 'down', variant: 'manor_dormer' },
  ],
  props: [
    { kind: 'pillar', x: 20, z: 16 },
    { kind: 'pillar', x: 30, z: 16 },
    { kind: 'lamp_stone', x: 21, z: 29 },
    { kind: 'lamp_stone', x: 29, z: 29 },
    { kind: 'lamp_stone', x: 21, z: 42 },
    { kind: 'lamp_stone', x: 29, z: 42 },
    { kind: 'snow_pine', x: 15, z: 38 },
    { kind: 'snow_pine', x: 35, z: 38 },
    { kind: 'snow_pine', x: 17, z: 11 },
    { kind: 'snow_pine', x: 33, z: 11 },
    { kind: 'crystal', x: 7, z: 13 },
  ],
  decoration: {
    seed: 606,
    treeDensity: 0.06,
    bushDensity: 0.02,
    flowerDensity: 0,
    rockDensity: 0.06,
    mushroomDensity: 0,
    treeKinds: ['snow_pine'],
  },
  warps: [
    { x: 25, y: 51, targetMap: 'cueva_eco', targetX: 25, targetY: 1, dir: 'down', doorStyle: 'gate' },
    { x: 26, y: 51, targetMap: 'cueva_eco', targetX: 26, targetY: 1, dir: 'down', doorStyle: 'gate' },
    {
      x: 25,
      y: 14,
      targetMap: 'liga_cumbre',
      targetX: 7,
      targetY: 13,
      dir: 'up',
      doorStyle: 'building',
    },
    {
      x: 12,
      y: 36,
      targetMap: 'centro_cumbre',
      targetX: 6,
      targetY: 9,
      dir: 'up',
      doorStyle: 'building',
    },
    {
      x: 38,
      y: 36,
      targetMap: 'tienda_cumbre',
      targetX: 6,
      targetY: 9,
      dir: 'up',
      doorStyle: 'building',
    },
    {
      x: 38,
      y: 25,
      targetMap: 'casa_cumbre_pb',
      targetX: 8,
      targetY: 10,
      dir: 'up',
      houseId: 'casa_cumbre',
      doorStyle: 'building',
    },
  ],
  npcs: [
    {
      id: 'cumbre_heraldo',
      name: 'Centinela Elsa',
      role: 'scholar',
      x: 22,
      y: 16,
      dir: 'down',
      dialogKey: 'sign_arena',
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'corredor_casa_cumbre',
      name: 'Agente Helga',
      role: 'merchant',
      x: 35,
      y: 25,
      dir: 'down',
      dialogKey: 'sign_arena',
      houseBrokerId: 'casa_cumbre',
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'cumbre_escolta',
      name: 'Vigilante Bruno',
      role: 'trainer',
      x: 18,
      y: 37,
      dir: 'right',
      dialogKey: 'sign_arena',
      patrol: {
        waypoints: [
          { x: 18, y: 37 },
          { x: 22, y: 37 },
        ],
        speed: 1.4,
        pauseSec: 1.8,
      },
      lookAtPlayerAfterTalk: true,
    },
  ],
  signs: [{ x: 23, y: 43, textKey: 'sign_arena' }],
  pickups: [
    { id: 'cumbre_hiperpocion_1', x: 16, y: 24, itemId: 'hiperpocion', quantity: 2 },
    { id: 'cumbre_oculto_gema', x: 8, y: 15, itemId: 'gema_poder', quantity: 1, hidden: true },
  ],
};
