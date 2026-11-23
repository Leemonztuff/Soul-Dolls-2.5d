import { getTileHeightLevel } from '../domain/TerrainRules.ts';
import type { MapDef } from '../domain/types.ts';
import type { TileAtlasKey } from '../gfx/ProceduralTiles.ts';

export interface ResolveTerrainTileOptions {
  /** Keep 'tall_grass' distinct from 'grass' when building geometry/spawners that differentiate it. */
  preserveTallGrass?: boolean;
}

/**
 * Canonical single source of truth for resolving a logical map cell (x, z) to its
 * rendered/planned TileAtlasKey, unifying biome rock variants, tall grass normalization,
 * and snowLine altitude overrides across P1–P5 terrain, cliff, shader, and foliage systems.
 */
export function resolveTerrainTileKey(
  map: MapDef,
  x: number,
  z: number,
  options?: ResolveTerrainTileOptions
): TileAtlasKey {
  const ch = map.grid[z]?.[x] ?? '.';
  const legend = map.legend[ch] ?? { tile: 'grass' as const, solid: false };
  const tileLevel = getTileHeightLevel(map, x, z);

  let tileKey: TileAtlasKey = legend.tile;
  if (tileKey === 'tall_grass' && !options?.preserveTallGrass) {
    tileKey = 'grass';
  } else if (tileKey === 'stone') {
    if (legend.solid) {
      tileKey = 'cliff_rock';
    } else if (map.biome === 'forest') {
      tileKey = 'mossy_stone';
    } else if (map.biome === 'cave' || map.music === 'cave' || map.id === 'cueva_eco') {
      tileKey = 'cracked_stone';
    }
  }

  if (
    tileKey !== 'water' &&
    tileKey !== 'bridge' &&
    tileKey !== 'stairs' &&
    tileKey !== 'cobble' &&
    tileKey !== 'arena_floor' &&
    map.snowLine !== undefined &&
    tileLevel >= map.snowLine &&
    (tileKey === 'grass' || tileKey === 'dirt' || tileKey === 'tall_grass' || tileKey === 'flowers')
  ) {
    tileKey = 'snow';
  }

  return tileKey;
}
