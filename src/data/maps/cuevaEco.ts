import type { MapDef } from '../../domain/types.ts';
import { hexToNumber, PALETTE } from '../../gfx/Palette.ts';
import { ENCOUNTERS } from '../encounters.ts';
import {
  DEFAULT_LEGEND,
  generateNoiseWorldMap,
} from './mapBuilder.ts';

function buildCuevaEcoTerrain() {
  return generateNoiseWorldMap({
    width: 52,
    height: 52,
    seed: 505,
    baseTile: 'c',
    baseHeight: 2,
    perimeter: {
      thickness: 4.8,
      peakHeight: 9,
      ridgeTile: '#',
      shelfTile: 'c',
      amplitude: 3.1,
      seed: 505,
    },
    rooms: [
      // Level 1 South Entrance Cavern (varied craggy chamber)
      {
        cx: 24.5,
        cy: 42.0,
        rx: 13.5,
        rz: 6.5,
        height: 2,
        tile: 'c',
        shape: 'craggy_sanctuary',
        lobes: 5,
        distortion: 0.34,
        seed: 511,
      },
      {
        cx: 38.0,
        cy: 40.5,
        rx: 5.5,
        rz: 4.2,
        height: 2,
        tile: 'c',
        shape: 'crescent',
        angle: Math.PI,
        distortion: 0.34,
        seed: 513,
      },
      // Level 2 Central & Western Crystal Chambers
      {
        cx: 21.0,
        cy: 26.5,
        rx: 11.5,
        rz: 7.4,
        height: 4,
        tile: 'c',
        shape: 'tiered_amphitheater',
        lobes: 5,
        distortion: 0.3,
        seed: 523,
      },
      {
        cx: 31.0,
        cy: 26.5,
        rx: 9.0,
        rz: 6.8,
        height: 4,
        tile: 'c',
        shape: 'lobed',
        lobes: 4,
        distortion: 0.32,
        seed: 527,
      },
      // Level 3 Guardian Vault (upper cavern crown)
      {
        cx: 26.0,
        cy: 11.5,
        rx: 11.5,
        rz: 6.4,
        height: 6,
        tile: 'c',
        shape: 'craggy_sanctuary',
        lobes: 5,
        distortion: 0.32,
        seed: 563,
      },
      // Secret North Crystal Gallery along NW wing
      {
        cx: 9.5,
        cy: 15.0,
        rx: 4.0,
        rz: 7.4,
        height: 4,
        tile: 'c',
        shape: 'winding_meadow',
        angle: 0.1,
        distortion: 0.34,
        seed: 577,
      },
    ],
    waterBodies: [
      // Level 1 subterranean pond (bed height 1)
      {
        kind: 'lake',
        cx: 37.5,
        cy: 41.5,
        rx: 5.2,
        rz: 3.6,
        waterHeight: 1,
        waterTile: '~',
        jitter: 0.36,
        borderMargin: 5,
        seed: 517,
      },
      // Level 2 subterranean lagoon (bed height 3)
      {
        kind: 'lake',
        cx: 38.2,
        cy: 25.0,
        rx: 6.5,
        rz: 4.6,
        waterHeight: 3,
        waterTile: '~',
        jitter: 0.36,
        borderMargin: 4,
        seed: 541,
      },
    ],
    islets: [
      // Level 1 pond stepped rock spire
      {
        cx: 39.5,
        cy: 43.5,
        rx: 1.7,
        rz: 1.5,
        tiers: [
          { scale: 1.0, height: 2, tile: 'c' },
          { scale: 0.55, height: 3, tile: '#' },
        ],
        seed: 521,
      },
      // Level 1 pond pickup peninsula
      {
        cx: 36.8,
        cy: 39.4,
        rx: 1.8,
        rz: 1.4,
        tiers: [{ scale: 1.0, height: 2, tile: 'c' }],
        seed: 522,
      },
      // Level 2 organic crystal island inside subterranean lagoon
      {
        cx: 41.5,
        cy: 24.2,
        rx: 3.1,
        rz: 2.7,
        tiers: [{ scale: 1.0, height: 4, tile: 'c' }],
        seed: 547,
      },
      // Level 2 stepped rock spire
      {
        cx: 35.0,
        cy: 21.8,
        rx: 1.7,
        rz: 1.5,
        tiers: [
          { scale: 1.0, height: 4, tile: 'c' },
          { scale: 0.55, height: 6, tile: '#' },
        ],
        seed: 557,
      },
      // Level 2 lagoon west shore headland
      {
        cx: 32.0,
        cy: 24.5,
        rx: 2.2,
        rz: 2.0,
        tiers: [{ scale: 1.0, height: 4, tile: 'c' }],
        seed: 559,
      },
    ],
    outcropClusters: [
      // Stepped cliff rims & pillars between cavern tiers
      { cx: 15.5, cy: 34.5, count: 3, spread: 2.6, baseHeight: 2, shelfTile: 'c', capTile: '#', seed: 531 },
      { cx: 32.5, cy: 34.5, count: 3, spread: 2.4, baseHeight: 2, shelfTile: 'c', capTile: '#', seed: 537 },
      { cx: 20.0, cy: 18.2, count: 3, spread: 2.4, baseHeight: 4, shelfTile: 'c', capTile: '#', seed: 569 },
      { cx: 32.0, cy: 18.2, count: 3, spread: 2.4, baseHeight: 4, shelfTile: 'c', capTile: '#', seed: 571 },
      { cx: 14.2, cy: 12.5, count: 3, spread: 2.4, baseHeight: 4, shelfTile: 'c', capTile: '#', seed: 587 },
    ],
    passes: [
      {
        x: 25,
        y: 0,
        exitDir: 'south',
        roadWidth: 2,
        roadTile: 'c',
        height: 2,
        depth: 8,
        shoulderWidth: 3,
        slopeWidth: 5,
        shoulderTile: 'c',
      },
      {
        x: 25,
        y: 0,
        exitDir: 'north',
        roadWidth: 2,
        roadTile: 'c',
        height: 6,
        depth: 8,
        shoulderWidth: 3,
        slopeWidth: 5,
        shoulderTile: 'c',
      },
    ],
    stairs: [
      // Central & East stone ramps 2 -> 3 -> 4
      { x: 24, y: 33, w: 4, h: 1, height: 4, tile: '^' },
      { x: 24, y: 34, w: 4, h: 1, height: 3, tile: '^' },
      { x: 24, y: 35, w: 4, h: 1, height: 2, tile: '^' },
      { x: 38, y: 33, w: 3, h: 1, height: 4, tile: '^' },
      { x: 38, y: 34, w: 3, h: 1, height: 3, tile: '^' },
      { x: 38, y: 35, w: 3, h: 1, height: 2, tile: '^' },
      // Guardian Vault ramp 4 -> 5 -> 6
      { x: 24, y: 17, w: 4, h: 1, height: 6, tile: '^' },
      { x: 24, y: 18, w: 4, h: 1, height: 5, tile: '^' },
      { x: 24, y: 19, w: 4, h: 1, height: 4, tile: '^' },
    ],
    bridges: [
      // Short bridges spanning only the underground water channels
      { x: 34, y: 41, w: 5, h: 1, height: 2, tile: 'B' },
      { x: 33, y: 24, w: 6, h: 2, height: 4, tile: 'B' },
    ],
    paths: [
      // Meandering subterranean Level-1 trail
      {
        waypoints: [
          { x: 25.5, y: 49 },
          { x: 23.0, y: 44 },
          { x: 25.5, y: 40 },
          { x: 26.0, y: 36 },
        ],
        baseWidth: 2.2,
        meanderAmp: 1.5,
        meanderFreq: 0.16,
        widthBreath: 0.35,
        tile: '_',
        height: 2,
        seed: 589,
      },
      // Meandering Level-2 crystal chamber trail & bridge approach
      {
        waypoints: [
          { x: 26.0, y: 32 },
          { x: 23.5, y: 28 },
          { x: 26.0, y: 24 },
          { x: 26.0, y: 20 },
        ],
        baseWidth: 2.2,
        meanderAmp: 1.6,
        meanderFreq: 0.16,
        widthBreath: 0.35,
        tile: '_',
        height: 4,
        seed: 591,
      },
      {
        waypoints: [
          { x: 26.0, y: 26 },
          { x: 30.0, y: 25 },
          { x: 33.0, y: 24.5 },
        ],
        baseWidth: 2.0,
        meanderAmp: 0.9,
        meanderFreq: 0.18,
        widthBreath: 0.3,
        tile: '_',
        height: 4,
        seed: 592,
      },
      // Curved NW secret crystal gallery trail
      {
        waypoints: [
          { x: 15.5, y: 24.5 },
          { x: 10.5, y: 21.5 },
          { x: 9.2, y: 15.5 },
          { x: 9.5, y: 10.0 },
        ],
        baseWidth: 2.0,
        meanderAmp: 1.4,
        meanderFreq: 0.16,
        widthBreath: 0.34,
        tile: '_',
        height: 4,
        seed: 593,
      },
    ],
    glades: [
      { cx: 16, cy: 40, rx: 4.2, rz: 2.8, height: 2, tile: '%', shape: 'lobed', distortion: 0.34, seed: 599 },
      { cx: 19.5, cy: 26.5, rx: 3.8, rz: 3.0, height: 4, tile: '%', shape: 'crescent', distortion: 0.34, seed: 601 },
      { cx: 31.5, cy: 11.5, rx: 3.0, rz: 2.5, height: 6, tile: '%', shape: 'lobed', distortion: 0.34, seed: 607 },
    ],
    guaranteedCells: [
      // Patrol (16..20, 42), NPCs, stair approaches, bridges & pickups
      { x: 16, y: 42, tile: 'c', height: 2 },
      { x: 17, y: 42, tile: 'c', height: 2 },
      { x: 18, y: 42, tile: 'c', height: 2 },
      { x: 19, y: 42, tile: 'c', height: 2 },
      { x: 20, y: 42, tile: 'c', height: 2 },
      { x: 24, y: 41, tile: '_', height: 2 },
      { x: 25, y: 26, tile: '_', height: 4 },
      { x: 25, y: 11, tile: 'c', height: 6 },
      { x: 37, y: 40, tile: 'c', height: 2 },
      { x: 33, y: 41, tile: 'c', height: 2 },
      { x: 39, y: 41, tile: 'c', height: 2 },
      { x: 42, y: 23, tile: 'c', height: 4 },
      { x: 39, y: 24, tile: 'c', height: 4 },
      { x: 39, y: 25, tile: 'c', height: 4 },
      { x: 32, y: 24, tile: '_', height: 4 },
      { x: 32, y: 25, tile: '_', height: 4 },
      { x: 9, y: 10, tile: '_', height: 4 },
      { x: 8, y: 18, tile: 'c', height: 4 },
      { x: 24, y: 36, tile: 'c', height: 2 },
      { x: 25, y: 36, tile: 'c', height: 2 },
      { x: 26, y: 36, tile: 'c', height: 2 },
      { x: 27, y: 36, tile: 'c', height: 2 },
      { x: 24, y: 32, tile: 'c', height: 4 },
      { x: 25, y: 32, tile: 'c', height: 4 },
      { x: 26, y: 32, tile: 'c', height: 4 },
      { x: 27, y: 32, tile: 'c', height: 4 },
      { x: 38, y: 32, tile: 'c', height: 4 },
      { x: 39, y: 32, tile: 'c', height: 4 },
      { x: 40, y: 32, tile: 'c', height: 4 },
      { x: 38, y: 36, tile: 'c', height: 2 },
      { x: 39, y: 36, tile: 'c', height: 2 },
      { x: 40, y: 36, tile: 'c', height: 2 },
      { x: 24, y: 16, tile: 'c', height: 6 },
      { x: 25, y: 16, tile: 'c', height: 6 },
      { x: 26, y: 16, tile: 'c', height: 6 },
      { x: 27, y: 16, tile: 'c', height: 6 },
      { x: 24, y: 20, tile: 'c', height: 4 },
      { x: 25, y: 20, tile: 'c', height: 4 },
      { x: 26, y: 20, tile: 'c', height: 4 },
      { x: 27, y: 20, tile: 'c', height: 4 },
    ],
    customPostProcess: (z) => {
      // Connect Level 1 & Level 2 cliff edges cleanly behind stair landings
      for (let x = 23; x <= 28; x++) {
        if (x < 24 || x > 27) {
          z.tiles[34][x] = '#';
          z.heights[34][x] = 3;
          z.tiles[18][x] = '#';
          z.heights[18][x] = 5;
        }
      }
      for (let x = 37; x <= 41; x++) {
        if (x < 38 || x > 40) {
          z.tiles[34][x] = '#';
          z.heights[34][x] = 3;
        }
      }
    },
  });
}

const { grid, heights } = buildCuevaEcoTerrain();

export const MAP_CUEVA_ECO: MapDef = {
  id: 'cueva_eco',
  nameKey: 'cueva_eco',
  biome: 'cave',
  music: 'cave',
  skyTopColor: hexToNumber(PALETTE.abyssInk),
  skyBottomColor: hexToNumber(PALETTE.nightshade),
  fogColor: hexToNumber(PALETTE.cryptInk),
  grid,
  heights,
  legend: DEFAULT_LEGEND,
  buildings: [],
  props: [
    { kind: 'crystal', x: 22, z: 44 },
    { kind: 'crystal', x: 29, z: 44 },
    { kind: 'crystal', x: 21, z: 28 },
    { kind: 'crystal', x: 30, z: 28 },
    { kind: 'crystal', x: 21, z: 12 },
    { kind: 'crystal', x: 30, z: 12 },
    { kind: 'crystal', x: 7, z: 10 },
    { kind: 'boulder', x: 18, z: 40 },
    { kind: 'boulder', x: 18, z: 15 },
    { kind: 'lamp_stone', x: 23, z: 36 },
    { kind: 'lamp_stone', x: 28, z: 36 },
  ],
  decoration: {
    seed: 505,
    treeDensity: 0,
    bushDensity: 0,
    flowerDensity: 0,
    rockDensity: 0.08,
    mushroomDensity: 0.08,
    treeKinds: [],
  },
  warps: [
    { x: 25, y: 51, targetMap: 'ruta_2', targetX: 29, targetY: 1, dir: 'down', doorStyle: 'gate' },
    { x: 26, y: 51, targetMap: 'ruta_2', targetX: 30, targetY: 1, dir: 'down', doorStyle: 'gate' },
    { x: 25, y: 0, targetMap: 'arena_cumbre', targetX: 25, targetY: 50, dir: 'up', doorStyle: 'gate' },
    { x: 26, y: 0, targetMap: 'arena_cumbre', targetX: 26, targetY: 50, dir: 'up', doorStyle: 'gate' },
  ],
  npcs: [
    {
      id: 'npc_cueva_minero',
      name: 'Braulio',
      role: 'trainer',
      x: 24,
      y: 41,
      dir: 'right',
      dialogKey: 'sign_cueva',
      trainerId: 'cueva_minero',
      sightRange: 3,
    },
    {
      id: 'npc_rival_2',
      name: 'Damián',
      role: 'rival',
      x: 25,
      y: 26,
      dir: 'down',
      dialogKey: 'sign_cueva',
      trainerId: 'rival_2',
      sightRange: 2,
      flagHidden: 'rival_2_defeated',
    },
    {
      id: 'guardian_eco',
      name: 'Guardián del Eco',
      role: 'leader',
      x: 25,
      y: 11,
      dir: 'down',
      dialogKey: 'sign_cueva',
      trainerId: 'guardian_eco',
      flagHidden: 'guardian_eco_defeated',
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'cueva_espeleologa',
      name: 'Espeleóloga Maya',
      role: 'scholar',
      x: 16,
      y: 42,
      dir: 'right',
      dialogKey: 'sign_cueva',
      patrol: {
        waypoints: [
          { x: 16, y: 42 },
          { x: 20, y: 42 },
        ],
        speed: 1.2,
        pauseSec: 2.2,
      },
      lookAtPlayerAfterTalk: true,
    },
  ],
  signs: [{ x: 23, y: 47, textKey: 'sign_cueva' }],
  pickups: [
    { id: 'cueva_ultracapsula_1', x: 42, y: 23, itemId: 'ultracapsula', quantity: 2 },
    { id: 'cueva_hiperpocion_1', x: 37, y: 40, itemId: 'hiperpocion', quantity: 1 },
    { id: 'cueva_oculto_eclipse', x: 9, y: 10, itemId: 'piedra_eclipse', quantity: 1, hidden: true },
    { id: 'cueva_oculto_fragmento', x: 8, y: 18, itemId: 'fragmento_alma', quantity: 1, hidden: true },
  ],
  encounters: ENCOUNTERS.cueva_eco,
};
