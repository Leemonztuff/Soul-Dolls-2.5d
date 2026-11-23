import type { MapDef } from '../../domain/types.ts';
import { MAP_ARENA_CUMBRE } from './arenaCumbre.ts';
import { MAP_CUEVA_ECO } from './cuevaEco.ts';
import { HOUSE_INTERIOR_MAPS } from './houseInteriors.ts';
import { MAP_LABORATORIO_ORIGEN } from './labInterior.ts';
import { MAP_PUEBLO_BRUMA } from './puebloBruma.ts';
import { MAP_RUTA_1 } from './ruta1.ts';
import { MAP_RUTA_2 } from './ruta2.ts';
import { MAP_TEST_RIVERBANK } from './testRiverbank.ts';
import { MAP_VILLA_ORIGEN } from './villaOrigen.ts';
import { MAP_TALLER_ORIGEN } from './workshopInterior.ts';

export const MAPS: Record<string, MapDef> = {
  villa_origen: MAP_VILLA_ORIGEN,
  laboratorio_origen: MAP_LABORATORIO_ORIGEN,
  taller_origen: MAP_TALLER_ORIGEN,
  ruta_1: MAP_RUTA_1,
  pueblo_bruma: MAP_PUEBLO_BRUMA,
  ruta_2: MAP_RUTA_2,
  cueva_eco: MAP_CUEVA_ECO,
  arena_cumbre: MAP_ARENA_CUMBRE,
  ...HOUSE_INTERIOR_MAPS,
};

/** Isolated development/validation maps (excluded from story map-passage assertions) */
export const DEV_MAPS: Record<string, MapDef> = {
  test_riverbank: MAP_TEST_RIVERBANK,
};

export function getMap(id: string): MapDef {
  const m = MAPS[id] ?? DEV_MAPS[id];
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}
