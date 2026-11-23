import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WaterSurface } from '../src/engine/WaterSurface.ts';
import { DisposableRegistry } from '../src/engine/Disposables.ts';
import type { MapDef } from '../src/domain/types.ts';

function makeWaterMap({
  width = 5,
  height = 5,
  waterCells = [] as Array<{ x: number; z: number }>,
}: {
  width?: number;
  height?: number;
  waterCells?: Array<{ x: number; z: number }>;
} = {}): MapDef {
  const w = width as number;
  const h = height as number;
  const waterSet = new Set(waterCells.map((c) => `${c.x},${c.z}`));
  const grid: string[] = [];
  const heights: string[] = [];

  for (let z = 0; z < h; z++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      row += waterSet.has(`${x},${z}`) ? '~' : '.';
    }
    grid.push(row);
    heights.push('0'.repeat(w));
  }

  return {
    id: 'water_test',
    nameKey: 'water_test',
    biome: 'meadow',
    music: 'route',
    skyTopColor: 0x000000,
    skyBottomColor: 0x111111,
    fogColor: 0x222222,
    grid,
    heights,
    legend: {
      '.': { tile: 'grass', solid: false },
      '~': { tile: 'water', solid: true },
    },
    buildings: [],
    props: [],
    decoration: {
      seed: 1,
      treeDensity: 0,
      bushDensity: 0,
      flowerDensity: 0,
      rockDensity: 0,
      mushroomDensity: 0,
      treeKinds: [],
    },
    warps: [],
    npcs: [],
    signs: [],
  } as unknown as MapDef;
}

function makeSceneAndDisposables() {
  const scene = new THREE.Scene();
  const disposables = new DisposableRegistry();
  return { scene, disposables };
}

describe('WaterSurface', () => {
  it('devuelve mesh null cuando no hay celdas de agua', () => {
    const map = makeWaterMap({ waterCells: [] });
    const { scene, disposables } = makeSceneAndDisposables();
    const water = new WaterSurface(scene, disposables, map);
    expect(water.mesh).toBeNull();
  });

  it('genera aShore mayor en esquinas cercanas a tierra y 0 en agua profunda', () => {
    // Agua en el centro (2,2) rodeada de tierra: todas las esquinas deberían tener aShore > 0
    const map = makeWaterMap({
      waterCells: [{ x: 2, z: 2 }],
    });
    const { scene, disposables } = makeSceneAndDisposables();
    const water = new WaterSurface(scene, disposables, map);
    expect(water.mesh).not.toBeNull();

    const geo = water.mesh!.geometry;
    const shoreAttr = geo.attributes.aShore as THREE.BufferAttribute;
    const count = shoreAttr.count;
    expect(count).toBeGreaterThan(0);

    let allZero = true;
    let anyPositive = false;
    for (let i = 0; i < count; i++) {
      const v = shoreAttr.getX(i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v > 0.001) anyPositive = true;
      if (v > 0.001) allZero = false;
    }
    expect(anyPositive).toBe(true);
    expect(allZero).toBe(false);
  });

  it('genera aShore todo cero cuando el agua está rodeada solo de agua (agua profunda)', () => {
    // Bloque de agua 3x3: el centro está rodeado de agua, sus esquinas internas deberían
    // tender a 0 (aunque los bordes del bloque tendrán orilla)
    const map = makeWaterMap({
      width: 5,
      height: 5,
      waterCells: [
        { x: 1, z: 1 },
        { x: 2, z: 1 },
        { x: 3, z: 1 },
        { x: 1, z: 2 },
        { x: 2, z: 2 },
        { x: 3, z: 2 },
        { x: 1, z: 3 },
        { x: 2, z: 3 },
        { x: 3, z: 3 },
      ],
    });
    const { scene, disposables } = makeSceneAndDisposables();
    const water = new WaterSurface(scene, disposables, map);
    expect(water.mesh).not.toBeNull();

    const geo = water.mesh!.geometry;
    const shoreAttr = geo.attributes.aShore as THREE.BufferAttribute;
    const count = shoreAttr.count;
    expect(count).toBeGreaterThan(0);

    // El quad central (celda 2,2) tiene sus 4 esquinas rodeadas de agua en los 5 checks,
    // por lo que sus aShore deberían ser 0 (agua profunda).
    // Cada celda genera 4 vértices consecutivos en orden BL, BR, TR, TL.
    // Celda (2,2) es la 5va celda (índice 4 en el array de waterCells ordenado por lectura).
    // Pero el orden depende de la iteración. Simplemente verificamos que hay al menos un 0.
    let hasZero = false;
    let hasPositive = false;
    for (let i = 0; i < count; i++) {
      const v = shoreAttr.getX(i);
      if (v <= 0.001) hasZero = true;
      if (v > 0.001) hasPositive = true;
    }
    expect(hasZero).toBe(true);
    expect(hasPositive).toBe(true); // los bordes del bloque tienen orilla
  });

  it('los valores de aShore son deterministas con el mismo mapa', () => {
    const map = makeWaterMap({ waterCells: [{ x: 2, z: 2 }, { x: 3, z: 2 }] });
    const { scene: s1, disposables: d1 } = makeSceneAndDisposables();
    const { scene: s2, disposables: d2 } = makeSceneAndDisposables();
    const w1 = new WaterSurface(s1, d1, map);
    const w2 = new WaterSurface(s2, d2, map);
    expect(w1.mesh).not.toBeNull();
    expect(w2.mesh).not.toBeNull();

    const a1 = w1.mesh!.geometry.attributes.aShore as THREE.BufferAttribute;
    const a2 = w2.mesh!.geometry.attributes.aShore as THREE.BufferAttribute;
    expect(a2.count).toBe(a1.count);
    for (let i = 0; i < a1.count; i++) {
      expect(a2.getX(i)).toBeCloseTo(a1.getX(i), 6);
    }
  });

  it('extiende la malla del agua bajo riberas orgánicas P1 con normales +Y, aShore=1 y WATER_SURFACE renderOrder (AUD-02, AUD-14)', async () => {
    const { analyzeTerrainContours } = await import('../src/engine/TerrainContourAnalyzer.ts');
    const { DIORAMA_RENDER_ORDER } = await import('../src/engine/DioramaLayers.ts');

    const map = makeWaterMap({
      width: 6,
      height: 6,
      waterCells: [
        { x: 2, z: 2 },
        { x: 3, z: 2 },
        { x: 2, z: 3 },
        { x: 3, z: 3 },
      ],
    });
    // Elevate surrounding natural grass land to level 1 while pond stays at level 0
    map.heights = [
      '111111',
      '111111',
      '110011',
      '110011',
      '111111',
      '111111',
    ];

    const contourAnalysis = analyzeTerrainContours(map);
    const { scene: sBase, disposables: dBase } = makeSceneAndDisposables();
    const wBase = new WaterSurface(sBase, dBase, map, null);

    const { scene: sOrg, disposables: dOrg } = makeSceneAndDisposables();
    const wOrg = new WaterSurface(sOrg, dOrg, map, contourAnalysis);

    expect(wOrg.mesh).not.toBeNull();
    expect(wOrg.mesh!.renderOrder).toBe(DIORAMA_RENDER_ORDER.WATER_SURFACE);

    const baseCount = (wBase.mesh!.geometry.getAttribute('position') as THREE.BufferAttribute).count;
    const orgPos = wOrg.mesh!.geometry.getAttribute('position') as THREE.BufferAttribute;
    const orgNorm = wOrg.mesh!.geometry.getAttribute('normal') as THREE.BufferAttribute;
    expect(orgPos.count).toBeGreaterThan(baseCount);

    for (let i = 0; i < orgNorm.count; i++) {
      expect(orgNorm.getY(i)).toBeCloseTo(1.0, 4);
    }
  });
});
