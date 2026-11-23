import type { MapDef, NpcDef, PropPlacementDef } from '../../domain/types.ts';
import { hexToNumber, PALETTE } from '../../gfx/Palette.ts';
import { INTERIOR_LEGEND } from './houseInteriors.ts';

interface ServiceExitConfig {
  id: string;
  targetMap: string;
  targetX: number;
  targetY: number;
}

function makeCenterInterior(
  cfg: ServiceExitConfig & {
    healerId: string;
    healerName: string;
    machineId: string;
    dialogKey: string;
  }
): MapDef {
  const grid = [
    '##############',
    '#KKKKKKKKKKKK#',
    '#KKKKKKKKKKKK#',
    '#KKRRRRRRRRKK#',
    '#KKRRRRRRRRKK#',
    '#KKRRRRRRRRKK#',
    '#KKRRRRRRRRKK#',
    '#KKRRRRRRRRKK#',
    '#KKRRRRRRRRKK#',
    '#KKKKKKKKKKKK#',
    '#KKKKKDDKKKKK#',
    '##############',
  ];
  const heights = grid.map((row) => '1'.repeat(row.length));
  const props: PropPlacementDef[] = [
    { kind: 'bookshelf', x: 1, z: 1 },
    { kind: 'bookshelf', x: 12, z: 1 },
    { kind: 'kitchen_counter', x: 5, z: 3 },
    { kind: 'kitchen_counter', x: 7, z: 3 },
    { kind: 'sofa', x: 2, z: 6 },
    { kind: 'dining_table', x: 11, z: 6 },
    { kind: 'house_plant', x: 1, z: 9 },
    { kind: 'house_plant', x: 12, z: 9 },
    { kind: 'lamp_wood', x: 2, z: 9 },
    { kind: 'lamp_wood', x: 11, z: 9 },
  ];
  const npcs: NpcDef[] = [
    {
      id: cfg.healerId,
      name: cfg.healerName,
      role: 'healer',
      x: 6,
      y: 2,
      dir: 'down',
      dialogKey: cfg.dialogKey,
      healOnTalk: true,
      lookAtPlayerAfterTalk: true,
    },
    {
      id: cfg.machineId,
      name: 'Máquina de Curación',
      role: 'healer',
      x: 8,
      y: 2,
      dir: 'down',
      dialogKey: 'heal_machine_use',
      healOnTalk: true,
    },
  ];
  return {
    id: cfg.id,
    nameKey: cfg.id,
    biome: 'meadow',
    music: 'town',
    isInterior: true,
    skyTopColor: hexToNumber(PALETTE.abyssInk),
    skyBottomColor: hexToNumber(PALETTE.cryptInk),
    fogColor: hexToNumber(PALETTE.abyssInk),
    grid,
    heights,
    legend: INTERIOR_LEGEND,
    buildings: [],
    props,
    decoration: {
      seed: 730,
      treeDensity: 0,
      bushDensity: 0,
      flowerDensity: 0,
      rockDensity: 0,
      mushroomDensity: 0,
      treeKinds: [],
    },
    warps: [
      {
        x: 6,
        y: 10,
        targetMap: cfg.targetMap,
        targetX: cfg.targetX,
        targetY: cfg.targetY,
        dir: 'down',
        doorStyle: 'interior',
      },
      {
        x: 7,
        y: 10,
        targetMap: cfg.targetMap,
        targetX: cfg.targetX,
        targetY: cfg.targetY,
        dir: 'down',
        doorStyle: 'interior',
      },
    ],
    npcs,
    signs: [],
  };
}

function makeShopInterior(
  cfg: ServiceExitConfig & {
    merchantId: string;
    merchantName: string;
    dialogKey: string;
    shopStock: string[];
  }
): MapDef {
  const grid = [
    '##############',
    '#pppppppppppp#',
    '#pppppppppppp#',
    '#pppppppppppp#',
    '#pppRRRRRRppp#',
    '#pppRRRRRRppp#',
    '#pppRRRRRRppp#',
    '#pppRRRRRRppp#',
    '#pppppppppppp#',
    '#pppppppppppp#',
    '#pppppDDppppp#',
    '##############',
  ];
  const heights = grid.map((row) => '1'.repeat(row.length));
  const props: PropPlacementDef[] = [
    { kind: 'bookshelf', x: 2, z: 1 },
    { kind: 'bookshelf', x: 11, z: 1 },
    { kind: 'kitchen_counter', x: 4, z: 3 },
    { kind: 'kitchen_counter', x: 5, z: 3 },
    { kind: 'kitchen_counter', x: 7, z: 3 },
    { kind: 'kitchen_counter', x: 8, z: 3 },
    { kind: 'chest', x: 11, z: 3 },
    { kind: 'dining_table', x: 2, z: 6 },
    { kind: 'house_plant', x: 1, z: 9 },
    { kind: 'house_plant', x: 12, z: 9 },
    { kind: 'lamp_wood', x: 2, z: 9 },
    { kind: 'lamp_wood', x: 11, z: 9 },
  ];
  const npcs: NpcDef[] = [
    {
      id: cfg.merchantId,
      name: cfg.merchantName,
      role: 'merchant',
      x: 6,
      y: 2,
      dir: 'down',
      dialogKey: cfg.dialogKey,
      shopStock: cfg.shopStock,
      lookAtPlayerAfterTalk: true,
    },
  ];
  return {
    id: cfg.id,
    nameKey: cfg.id,
    biome: 'meadow',
    music: 'town',
    isInterior: true,
    skyTopColor: hexToNumber(PALETTE.abyssInk),
    skyBottomColor: hexToNumber(PALETTE.cryptInk),
    fogColor: hexToNumber(PALETTE.abyssInk),
    grid,
    heights,
    legend: INTERIOR_LEGEND,
    buildings: [],
    props,
    decoration: {
      seed: 745,
      treeDensity: 0,
      bushDensity: 0,
      flowerDensity: 0,
      rockDensity: 0,
      mushroomDensity: 0,
      treeKinds: [],
    },
    warps: [
      {
        x: 6,
        y: 10,
        targetMap: cfg.targetMap,
        targetX: cfg.targetX,
        targetY: cfg.targetY,
        dir: 'down',
        doorStyle: 'interior',
      },
      {
        x: 7,
        y: 10,
        targetMap: cfg.targetMap,
        targetX: cfg.targetX,
        targetY: cfg.targetY,
        dir: 'down',
        doorStyle: 'interior',
      },
    ],
    npcs,
    signs: [],
  };
}

const GYM_BRUMA_GRID = [
  '################',
  '#KKKKRRRRRRKKKK#',
  '#KKKKRRRRRRKKKK#',
  '#KKKKRRRRRRKKKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKKKKKKKKKKKKK#',
  '#KKKKKKKKKKKKKK#',
  '#KKKKKKDDKKKKKK#',
  '################',
];

const LIGA_CUMBRE_GRID = [
  '################',
  '#KKKKRRRRRRKKKK#',
  '#KKKKRRRRRRKKKK#',
  '#KKKKRRRRRRKKKK#',
  '#KKKKRRRRRRKKKK#',
  '#KKK==^^^^==KKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKRRRRRRRRRRKK#',
  '#KKKKKKKKKKKKKK#',
  '#KKKKKKKKKKKKKK#',
  '#KKKKKKDDKKKKKK#',
  '################',
];

const LIGA_CUMBRE_HEIGHTS = LIGA_CUMBRE_GRID.map((row, y) => {
  if (y <= 4) return '2'.repeat(row.length);
  return '1'.repeat(row.length);
});

export const MAP_CENTRO_ORIGEN = makeCenterInterior({
  id: 'centro_origen',
  targetMap: 'villa_origen',
  targetX: 13,
  targetY: 27,
  healerId: 'healer_origen',
  healerName: 'Enfermera Vera',
  machineId: 'heal_machine_origen',
  dialogKey: 'healer_origen',
});

export const MAP_TIENDA_ORIGEN = makeShopInterior({
  id: 'tienda_origen',
  targetMap: 'villa_origen',
  targetX: 37,
  targetY: 21,
  merchantId: 'merchant_origen',
  merchantName: 'Mercader Bruno',
  dialogKey: 'merchant_origen',
  shopStock: [
    'capsula',
    'pocion',
    'antidoto',
    'despertar',
    'antiparalizador',
    'repelente',
    'cuerda_huida',
  ],
});

export const MAP_CENTRO_BRUMA = makeCenterInterior({
  id: 'centro_bruma',
  targetMap: 'pueblo_bruma',
  targetX: 13,
  targetY: 27,
  healerId: 'healer_clara',
  healerName: 'Enfermera Clara',
  machineId: 'heal_machine_bruma',
  dialogKey: 'healer_clara',
});

export const MAP_TIENDA_BRUMA = makeShopInterior({
  id: 'tienda_bruma',
  targetMap: 'pueblo_bruma',
  targetX: 37,
  targetY: 27,
  merchantId: 'merchant_mateo',
  merchantName: 'Mercader Mateo',
  dialogKey: 'merchant_mateo',
  shopStock: [
    'capsula',
    'supercapsula',
    'pocion',
    'superpocion',
    'antidoto',
    'despertar',
    'antiparalizador',
    'revivir',
    'repelente',
    'cuerda_huida',
    'baya_roble',
    'baya_pura',
    'fragmento_alma',
  ],
});

export const MAP_GIMNASIO_BRUMA: MapDef = {
  id: 'gimnasio_bruma',
  nameKey: 'gimnasio_bruma',
  biome: 'arena',
  music: 'town',
  isInterior: true,
  skyTopColor: hexToNumber(PALETTE.abyssInk),
  skyBottomColor: hexToNumber(PALETTE.cryptInk),
  fogColor: hexToNumber(PALETTE.abyssInk),
  grid: GYM_BRUMA_GRID,
  heights: GYM_BRUMA_GRID.map((r) => '1'.repeat(r.length)),
  legend: INTERIOR_LEGEND,
  buildings: [],
  props: [
    { kind: 'crystal', x: 4, z: 2 },
    { kind: 'crystal', x: 11, z: 2 },
    { kind: 'crystal', x: 4, z: 12 },
    { kind: 'crystal', x: 11, z: 12 },
    { kind: 'pillar', x: 5, z: 5 },
    { kind: 'pillar', x: 10, z: 5 },
    { kind: 'pillar', x: 5, z: 9 },
    { kind: 'pillar', x: 10, z: 9 },
    { kind: 'lamp_stone', x: 2, z: 13 },
    { kind: 'lamp_stone', x: 13, z: 13 },
  ],
  decoration: {
    seed: 760,
    treeDensity: 0,
    bushDensity: 0,
    flowerDensity: 0,
    rockDensity: 0,
    mushroomDensity: 0,
    treeKinds: [],
  },
  warps: [
    {
      x: 7,
      y: 14,
      targetMap: 'pueblo_bruma',
      targetX: 25,
      targetY: 12,
      dir: 'down',
      doorStyle: 'interior',
    },
    {
      x: 8,
      y: 14,
      targetMap: 'pueblo_bruma',
      targetX: 25,
      targetY: 12,
      dir: 'down',
      doorStyle: 'interior',
    },
  ],
  npcs: [
    {
      id: 'gym_guide_bruma',
      name: 'Heraldo Ciro',
      role: 'scholar',
      x: 10,
      y: 13,
      dir: 'left',
      dialogKey: 'gym_guide_bruma',
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'npc_bruma_discipulo_1',
      name: 'Tadeo',
      role: 'trainer',
      x: 7,
      y: 9,
      dir: 'right',
      dialogKey: 'gym_guide_bruma',
      trainerId: 'bruma_discipulo_1',
      sightRange: 2,
    },
    {
      id: 'npc_bruma_discipulo_2',
      name: 'Ariadna',
      role: 'trainer',
      x: 3,
      y: 6,
      dir: 'right',
      dialogKey: 'gym_guide_bruma',
      trainerId: 'bruma_discipulo_2',
      sightRange: 2,
    },
    {
      id: 'npc_lider_bruma',
      name: 'Líder Bruma',
      role: 'leader',
      x: 7,
      y: 3,
      dir: 'down',
      dialogKey: 'gym_bruma_cleared',
      trainerId: 'lider_bruma',
      lookAtPlayerAfterTalk: true,
    },
  ],
  signs: [],
  pickups: [
    {
      id: 'gym_bruma_superpocion',
      x: 13,
      y: 6,
      itemId: 'superpocion',
      quantity: 2,
      hidden: true,
    },
  ],
};

export const MAP_CENTRO_CUMBRE = makeCenterInterior({
  id: 'centro_cumbre',
  targetMap: 'arena_cumbre',
  targetX: 12,
  targetY: 37,
  healerId: 'healer_cumbre',
  healerName: 'Enfermera Iris',
  machineId: 'heal_machine_cumbre',
  dialogKey: 'healer_cumbre',
});

export const MAP_TIENDA_CUMBRE = makeShopInterior({
  id: 'tienda_cumbre',
  targetMap: 'arena_cumbre',
  targetX: 38,
  targetY: 37,
  merchantId: 'merchant_cumbre',
  merchantName: 'Mercader Román',
  dialogKey: 'merchant_cumbre',
  shopStock: [
    'supercapsula',
    'ultracapsula',
    'superpocion',
    'hiperpocion',
    'revivir',
    'repelente',
    'cuerda_huida',
    'baya_alba',
    'baya_pura',
    'gema_poder',
    'cinta_aguante',
    'pluma_veloz',
    'fragmento_alma',
  ],
});

export const MAP_LIGA_CUMBRE: MapDef = {
  id: 'liga_cumbre',
  nameKey: 'liga_cumbre',
  biome: 'arena',
  music: 'town',
  isInterior: true,
  skyTopColor: hexToNumber(PALETTE.abyssInk),
  skyBottomColor: hexToNumber(PALETTE.cryptInk),
  fogColor: hexToNumber(PALETTE.abyssInk),
  grid: LIGA_CUMBRE_GRID,
  heights: LIGA_CUMBRE_HEIGHTS,
  legend: INTERIOR_LEGEND,
  buildings: [],
  props: [
    { kind: 'crystal', x: 4, z: 2 },
    { kind: 'crystal', x: 11, z: 2 },
    { kind: 'crystal', x: 4, z: 6 },
    { kind: 'crystal', x: 11, z: 6 },
    { kind: 'crystal', x: 4, z: 11 },
    { kind: 'crystal', x: 11, z: 11 },
    { kind: 'pillar', x: 2, z: 4 },
    { kind: 'pillar', x: 13, z: 4 },
    { kind: 'pillar', x: 2, z: 9 },
    { kind: 'pillar', x: 13, z: 9 },
    { kind: 'lamp_stone', x: 2, z: 13 },
    { kind: 'lamp_stone', x: 13, z: 13 },
  ],
  decoration: {
    seed: 785,
    treeDensity: 0,
    bushDensity: 0,
    flowerDensity: 0,
    rockDensity: 0,
    mushroomDensity: 0,
    treeKinds: [],
  },
  warps: [
    {
      x: 7,
      y: 14,
      targetMap: 'arena_cumbre',
      targetX: 25,
      targetY: 15,
      dir: 'down',
      doorStyle: 'interior',
    },
    {
      x: 8,
      y: 14,
      targetMap: 'arena_cumbre',
      targetX: 25,
      targetY: 15,
      dir: 'down',
      doorStyle: 'interior',
    },
  ],
  npcs: [
    {
      id: 'heal_machine_liga',
      name: 'Máquina de Curación',
      role: 'healer',
      x: 4,
      y: 12,
      dir: 'down',
      dialogKey: 'heal_machine_use',
      healOnTalk: true,
    },
    {
      id: 'arena_guide_npc',
      name: 'Árbitro Leo',
      role: 'scholar',
      x: 11,
      y: 12,
      dir: 'left',
      dialogKey: 'arena_guide',
      lookAtPlayerAfterTalk: true,
    },
    {
      id: 'npc_arena_discipulo',
      name: 'Sofía',
      role: 'trainer',
      x: 7,
      y: 8,
      dir: 'down',
      dialogKey: 'arena_guide',
      trainerId: 'arena_discipulo',
      sightRange: 2,
    },
    {
      id: 'npc_leader_valeria',
      name: 'Maestra Valeria',
      role: 'leader',
      x: 7,
      y: 3,
      dir: 'down',
      dialogKey: 'leader_after',
      trainerId: 'leader_valeria',
      lookAtPlayerAfterTalk: true,
    },
  ],
  signs: [],
};

export const SERVICE_INTERIOR_MAPS: Record<string, MapDef> = {
  centro_origen: MAP_CENTRO_ORIGEN,
  tienda_origen: MAP_TIENDA_ORIGEN,
  centro_bruma: MAP_CENTRO_BRUMA,
  tienda_bruma: MAP_TIENDA_BRUMA,
  gimnasio_bruma: MAP_GIMNASIO_BRUMA,
  centro_cumbre: MAP_CENTRO_CUMBRE,
  tienda_cumbre: MAP_TIENDA_CUMBRE,
  liga_cumbre: MAP_LIGA_CUMBRE,
};
