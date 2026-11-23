import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/data/maps/index.ts';
import { TRAINERS } from '../src/data/trainers.ts';
import {
  isInsideBuilding,
  isStandingTileValid,
  isTileWalkable,
  isWithinHiddenSparkleRange,
  validateAndRelocateSpawn,
} from '../src/domain/TerrainRules.ts';
import type { BuildingPlacement, MapDef } from '../src/domain/types.ts';
import {
  buildBuildingsMesh,
  buildInteriorWallsMesh,
} from '../src/engine/BuildingMesher.ts';

function bfsReachable(
  map: MapDef,
  starts: ReadonlyArray<{ x: number; y: number }>
): Set<string> {
  const solidProps = new Set(map.props.map((p) => `${p.x},${p.z}`));
  for (const s of map.signs) {
    solidProps.add(`${s.x},${s.y}`);
  }
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [];

  for (const st of starts) {
    if (!isStandingTileValid(map, st.x, st.y)) continue;
    const key = `${st.x},${st.y}`;
    if (!visited.has(key)) {
      visited.add(key);
      queue.push(st);
    }
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (!isTileWalkable(map, cur.x, cur.y, nx, ny, solidProps)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  return visited;
}

describe('World redesign, composite 3D buildings, interiors & hidden exploration', () => {
  it('registers all 6 exterior maps and 16 visitable interiors with bidirectional warps', () => {
    const exteriors = [
      'villa_origen',
      'ruta_1',
      'pueblo_bruma',
      'ruta_2',
      'cueva_eco',
      'arena_cumbre',
    ];
    const interiors = [
      'laboratorio_origen',
      'taller_origen',
      'centro_origen',
      'tienda_origen',
      'centro_bruma',
      'tienda_bruma',
      'gimnasio_bruma',
      'centro_cumbre',
      'tienda_cumbre',
      'liga_cumbre',
      'casa_villa_pb',
      'casa_villa_hab',
      'casa_bruma_pb',
      'casa_bruma_hab',
      'casa_cumbre_pb',
      'casa_cumbre_hab',
    ];

    for (const id of exteriors) {
      expect(MAPS[id], `Missing exterior ${id}`).toBeDefined();
      expect(Boolean(MAPS[id].isInterior)).toBe(false);
    }
    for (const id of interiors) {
      expect(MAPS[id], `Missing interior ${id}`).toBeDefined();
      expect(MAPS[id].isInterior).toBe(true);
    }

    // Every warp lands on a walkable non-building tile and destination map has a return warp
    for (const map of Object.values(MAPS)) {
      for (const warp of map.warps) {
        const dest = MAPS[warp.targetMap];
        expect(dest).toBeDefined();
        expect(isStandingTileValid(dest, warp.targetX, warp.targetY)).toBe(true);
        const hasReturn = dest.warps.some((rw) => rw.targetMap === map.id);
        expect(hasReturn, `${map.id} -> ${warp.targetMap} lacks return warp`).toBe(true);
      }
    }
  });

  it('connects every warp, NPC, visible/hidden pickup, and secret passage via walkable BFS paths', () => {
    const entryPoints: Record<string, Array<{ x: number; y: number }>> = {
      villa_origen: [{ x: 24, y: 26 }],
    };
    for (const map of Object.values(MAPS)) {
      for (const w of map.warps) {
        entryPoints[w.targetMap] ??= [];
        entryPoints[w.targetMap].push({ x: w.targetX, y: w.targetY });
      }
    }

    const adjDirs = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;

    for (const map of Object.values(MAPS)) {
      const starts = entryPoints[map.id] ?? [];
      expect(starts.length, `${map.id} needs entry points`).toBeGreaterThan(0);
      const reachable = bfsReachable(map, starts);
      expect(reachable.size, `${map.id} reachable region too small`).toBeGreaterThan(15);

      for (const w of map.warps) {
        expect(
          reachable.has(`${w.x},${w.y}`),
          `${map.id} warp (${w.x},${w.y}) -> ${w.targetMap} unreachable`
        ).toBe(true);
      }

      for (const npc of map.npcs) {
        expect(isInsideBuilding(map.buildings, npc.x, npc.y)).toBe(false);
        const canApproach = adjDirs.some(([dx, dy]) =>
          reachable.has(`${npc.x + dx},${npc.y + dy}`)
        );
        expect(canApproach, `${map.id} NPC ${npc.id} unreachable`).toBe(true);
      }

      for (const pk of map.pickups ?? []) {
        expect(isInsideBuilding(map.buildings, pk.x, pk.y)).toBe(false);
        const canTouch = adjDirs.some(([dx, dy]) =>
          reachable.has(`${pk.x + dx},${pk.y + dy}`)
        );
        expect(canTouch, `${map.id} pickup ${pk.id} unreachable`).toBe(true);
      }
    }
  });

  it('provides distinct service buildings, Bruma Gym, Summit League, and badge progression', () => {
    for (const cityId of ['villa_origen', 'pueblo_bruma', 'arena_cumbre']) {
      const city = MAPS[cityId];
      expect(city.buildings.some((b) => b.kind === 'center')).toBe(true);
      expect(city.buildings.some((b) => b.kind === 'shop')).toBe(true);
    }

    expect(MAPS.pueblo_bruma.buildings.some((b) => b.kind === 'gym')).toBe(true);
    expect(MAPS.arena_cumbre.buildings.some((b) => b.kind === 'arena_hall')).toBe(true);

    // East exit of Pueblo Bruma is gated behind 1 badge (Medalla Bruma)
    const eastWarps = MAPS.pueblo_bruma.warps.filter((w) => w.targetMap === 'ruta_2');
    expect(eastWarps.length).toBeGreaterThanOrEqual(1);
    for (const w of eastWarps) {
      expect(w.requiredBadges).toBe(1);
    }
    expect((MAPS.pueblo_bruma.badgeGates ?? []).length).toBeGreaterThanOrEqual(1);

    // Arena Cumbre moved Liga trainers indoors into liga_cumbre
    expect(MAPS.arena_cumbre.npcs.some((n) => n.trainerId === 'leader_valeria')).toBe(false);
    expect(MAPS.liga_cumbre.npcs.some((n) => n.trainerId === 'leader_valeria')).toBe(true);
    expect(MAPS.liga_cumbre.npcs.some((n) => n.trainerId === 'arena_discipulo')).toBe(true);
    expect(MAPS.liga_cumbre.npcs.some((n) => n.id.startsWith('heal_machine'))).toBe(true);

    expect(TRAINERS.lider_bruma.awardsBadge).toBe('medalla_bruma');
    expect(TRAINERS.leader_valeria.awardsBadge).toBe('medalla_cumbre');
    expect(TRAINERS.leader_valeria.isFinalBoss).toBe(true);
    expect(TRAINERS.leader_valeria.isLeague).toBe(true);
  });

  it('builds composite multi-part 3D groups for all BuildingKinds and house variants', () => {
    const mat = new THREE.MeshStandardMaterial();
    const dummyTex = new THREE.DataTexture(
      new Uint8Array(16),
      2,
      2
    ) as unknown as THREE.CanvasTexture;

    const showcaseBuildings: BuildingPlacement[] = [
      { kind: 'house_red', x: 5, z: 5, width: 5, depth: 4, facing: 'down', variant: 'porch_cabin' },
      { kind: 'house_blue', x: 12, z: 5, width: 5, depth: 4, facing: 'down', variant: 'manor_dormer' },
      { kind: 'house_red', x: 19, z: 5, width: 5, depth: 4, facing: 'down', variant: 'l_annex' },
      { kind: 'center', x: 5, z: 12, width: 5, depth: 4, facing: 'down' },
      { kind: 'shop', x: 12, z: 12, width: 5, depth: 4, facing: 'down' },
      { kind: 'gym', x: 19, z: 12, width: 7, depth: 4, facing: 'down' },
      { kind: 'arena_hall', x: 28, z: 12, width: 7, depth: 5, facing: 'down' },
      { kind: 'lab', x: 28, z: 5, width: 5, depth: 4, facing: 'down' },
      { kind: 'workshop', x: 35, z: 5, width: 5, depth: 4, facing: 'down' },
    ];

    const syntheticMap: MapDef = {
      ...MAPS.villa_origen,
      buildings: showcaseBuildings,
    };

    const group = buildBuildingsMesh(
      syntheticMap,
      mat,
      () => dummyTex,
      () => dummyTex,
      () => dummyTex,
      () => dummyTex
    );
    expect(group).not.toBeNull();

    let meshCount = 0;
    const roughnessValues = new Set<number>();
    let hasEmissiveAccent = false;

    group!.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      meshCount += 1;
      const pos = m.geometry.attributes.position.array as Float32Array;
      expect(pos.length).toBeGreaterThan(0);
      const sm = m.material as THREE.MeshStandardMaterial;
      if (typeof sm.roughness === 'number') {
        roughnessValues.add(Number(sm.roughness.toFixed(2)));
      }
      if (sm.toneMapped === false) {
        hasEmissiveAccent = true;
      }
      m.geometry.dispose();
      if (m.material !== mat && !Array.isArray(m.material)) {
        m.material.dispose();
      }
    });

    expect(meshCount).toBeGreaterThanOrEqual(12);
    expect(roughnessValues.size).toBeGreaterThanOrEqual(2);
    expect(hasEmissiveAccent).toBe(true);

    // Verify interior walls build cleanly for service and gym interiors
    for (const id of ['centro_origen', 'tienda_bruma', 'gimnasio_bruma', 'liga_cumbre']) {
      const interiorWalls = buildInteriorWallsMesh(
        MAPS[id],
        mat,
        () => dummyTex,
        () => dummyTex
      );
      expect(interiorWalls, `${id} interior walls`).not.toBeNull();
      interiorWalls!.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        if (m.material !== mat && !Array.isArray(m.material)) {
          m.material.dispose();
        }
      });
    }

    dummyTex.dispose();
    mat.dispose();
  });

  it('reveals hidden item sparkles strictly within 5 tiles and relocates blocked legacy spawns', () => {
    expect(isWithinHiddenSparkleRange(10, 10, 10, 10, 5)).toBe(true);
    expect(isWithinHiddenSparkleRange(10, 10, 13, 14, 5)).toBe(true); // dist === 5.0
    expect(isWithinHiddenSparkleRange(10, 10, 14, 14, 5)).toBe(false); // dist ~ 5.66 > 5

    // Verify every map has hidden items within secret paths
    for (const id of ['villa_origen', 'ruta_1', 'pueblo_bruma', 'ruta_2', 'cueva_eco', 'arena_cumbre']) {
      const hidden = (MAPS[id].pickups ?? []).filter((p) => p.hidden);
      expect(hidden.length, `${id} should include hidden items`).toBeGreaterThanOrEqual(1);
    }

    // Unknown map recovers to villa_origen plaza
    const unknownReloc = validateAndRelocateSpawn('deleted_map', 10, 10, MAPS);
    expect(unknownReloc).toEqual({
      mapId: 'villa_origen',
      x: 24,
      y: 26,
      relocated: true,
    });

    // Coordinates inside new building footprint on Villa Origen relocate to nearest walkable tile
    const insideBuildingReloc = validateAndRelocateSpawn('villa_origen', 12, 23, MAPS);
    expect(insideBuildingReloc.relocated).toBe(true);
    expect(insideBuildingReloc.mapId).toBe('villa_origen');
    expect(
      isStandingTileValid(
        MAPS.villa_origen,
        insideBuildingReloc.x,
        insideBuildingReloc.y
      )
    ).toBe(true);

    // Valid open plaza spawn does not relocate
    const validReloc = validateAndRelocateSpawn('villa_origen', 24, 26, MAPS);
    expect(validReloc).toEqual({
      mapId: 'villa_origen',
      x: 24,
      y: 26,
      relocated: false,
    });
  });
});
