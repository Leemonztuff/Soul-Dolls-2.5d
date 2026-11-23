import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEV_MAPS, MAPS } from '../src/data/maps/index.ts';
import { MAP_TEST_RIVERBANK } from '../src/data/maps/testRiverbank.ts';
import {
  getTileHeightLevel,
  HEIGHT_UNIT,
  isTileWalkable,
  sampleInterpolatedHeight,
} from '../src/domain/TerrainRules.ts';
import type { MapDef } from '../src/domain/types.ts';
import {
  getCanonicalPairSign,
  getSurfaceTransitionRule,
  planSurfaceTransitions,
  SURFACE_TRANSITION_PARAMS,
} from '../src/engine/SurfaceTransitionPlanner.ts';
import { analyzeTerrainContours } from '../src/engine/TerrainContourAnalyzer.ts';
import { buildTerrainChunks, CHUNK_SIZE } from '../src/engine/TerrainMesher.ts';
import { attachTerrainDioramaShader } from '../src/engine/TerrainWeatheringShader.ts';
import { TILE_ATLAS_INDEX } from '../src/gfx/ProceduralTiles.ts';

function makeTransitionMap(
  grid: string[],
  heights: string[],
  extra?: Partial<MapDef>
): MapDef {
  return {
    id: 'p3_unit',
    nameKey: 'p3_unit',
    biome: 'meadow',
    music: 'route',
    skyTopColor: 0x000000,
    skyBottomColor: 0x111111,
    fogColor: 0x222222,
    grid,
    heights,
    legend: {
      '.': { tile: 'grass', solid: false },
      ',': { tile: 'dirt', solid: false },
      s: { tile: 'sand', solid: false },
      _: { tile: 'stone', solid: false },
      '#': { tile: 'stone', solid: true },
      '=': { tile: 'cobble', solid: false },
      '^': { tile: 'stairs', solid: false, ramp: true },
      B: { tile: 'bridge', solid: false },
      '~': { tile: 'water', solid: true },
      '*': { tile: 'flowers', solid: false },
    },
    buildings: [],
    props: [],
    decoration: {
      seed: 101,
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
    ...extra,
  };
}

describe('P3 SurfaceTransitionPlanner & Organic Terrain Blending', () => {
  it('defines bidirectional compatibility rules and canonical symmetry signs', () => {
    const pairs = [
      ['grass', 'dirt'],
      ['grass', 'sand'],
      ['dirt', 'sand'],
      ['grass', 'stone'],
      ['dirt', 'stone'],
      ['stone', 'mossy_stone'],
      ['stone', 'cracked_stone'],
      ['grass', 'snow'],
      ['dirt', 'snow'],
      ['cobble', 'dirt'],
    ] as const;

    for (const [a, b] of pairs) {
      const ruleAB = getSurfaceTransitionRule(a, b);
      const ruleBA = getSurfaceTransitionRule(b, a);
      expect(ruleAB).not.toBeNull();
      expect(ruleBA).not.toBeNull();
      expect(ruleAB!.strength).toBeGreaterThan(0);
      expect(ruleAB!.contrast).toBeGreaterThanOrEqual(0.7);
      expect(getCanonicalPairSign(a, b)).toBe(-getCanonicalPairSign(b, a));
    }

    // Same surface or protected/water types do not produce ground blends
    expect(getSurfaceTransitionRule('grass', 'grass')).toBeNull();
    expect(getSurfaceTransitionRule('grass', 'water')).toBeNull();
    expect(getSurfaceTransitionRule('dirt', 'bridge')).toBeNull();
    expect(getSurfaceTransitionRule('stone', 'stairs')).toBeNull();
    expect(getSurfaceTransitionRule('grass', 'arena_floor')).toBeNull();
  });

  it('produces 100% deterministic transition plans across repeated runs', () => {
    const contoursA = analyzeTerrainContours(MAP_TEST_RIVERBANK);
    const contoursB = analyzeTerrainContours(MAP_TEST_RIVERBANK);
    const planA = planSurfaceTransitions(MAP_TEST_RIVERBANK, contoursA);
    const planB = planSurfaceTransitions(MAP_TEST_RIVERBANK, contoursB);

    expect(planA.tilePlans.length).toBe(planB.tilePlans.length);
    for (let i = 0; i < planA.tilePlans.length; i++) {
      expect(planA.tilePlans[i]).toEqual(planB.tilePlans[i]);
    }
  });

  it('guarantees shared-edge weight symmetry and opposite noise signs across compatible borders', () => {
    const map = makeTransitionMap(
      [
        '....,,,,',
        '....,,,,',
        '....,,,,',
        '....ssss',
        '....ssss',
      ],
      [
        '11111111',
        '11111111',
        '11111111',
        '11111111',
        '11111111',
      ]
    );
    const plan = planSurfaceTransitions(map);
    // At (3,1) [grass] <-> (4,1) [dirt], both must transition toward each other along x=3.5
    const left = plan.tilePlans[1 * 8 + 3];
    const right = plan.tilePlans[1 * 8 + 4];
    expect(left.hasTransition).toBe(true);
    expect(right.hasTransition).toBe(true);

    const leftEastSectors = left.sectors.filter(
      (s) => Math.abs(s.ax - 3.5) < 1e-6 && Math.abs(s.bx - 3.5) < 1e-6 && s.targetTile === 'dirt'
    );
    const rightWestSectors = right.sectors.filter(
      (s) => Math.abs(s.ax - 3.5) < 1e-6 && Math.abs(s.bx - 3.5) < 1e-6 && s.targetTile === 'grass'
    );
    expect(leftEastSectors.length).toBe(2);
    expect(rightWestSectors.length).toBe(2);
    expect(leftEastSectors[0].noiseSign).toBe(-rightWestSectors[0].noiseSign);

    const expectedEdgeW =
      SURFACE_TRANSITION_PARAMS.MAX_EDGE_BLEND_WEIGHT *
      getSurfaceTransitionRule('grass', 'dirt')!.strength;
    expect(leftEastSectors.some((s) => Math.abs(s.weightB - expectedEdgeW) < 1e-5)).toBe(true);
    expect(rightWestSectors.some((s) => Math.abs(s.weightA - expectedEdgeW) < 1e-5)).toBe(true);

    // At triple junction vertex (4, 3) where grass (3,2), dirt (4,2), and sand (4,3)/(3,3) meet
    const tripleTile = plan.tilePlans[2 * 8 + 3]; // (3,2) grass next to dirt(4,2) & sand(4,3)
    expect(tripleTile.hasTransition).toBe(true);
    const seCornerSectors = tripleTile.sectors.filter(
      (s) =>
        ((Math.abs(s.ax - 3.5) < 1e-6 && Math.abs(s.az - 2.5) < 1e-6) ||
          (Math.abs(s.bx - 3.5) < 1e-6 && Math.abs(s.bz - 2.5) < 1e-6)) &&
        s.targetTile !== null
    );
    expect(seCornerSectors.length).toBeGreaterThan(0);
    for (const sec of seCornerSectors) {
      if (Math.abs(sec.ax - 3.5) < 1e-6 && Math.abs(sec.az - 2.5) < 1e-6) {
        expect(sec.weightA).toBeLessThanOrEqual(
          SURFACE_TRANSITION_PARAMS.TRIPLE_JUNCTION_WEIGHT + 1e-5
        );
      }
      if (Math.abs(sec.bx - 3.5) < 1e-6 && Math.abs(sec.bz - 2.5) < 1e-6) {
        expect(sec.weightB).toBeLessThanOrEqual(
          SURFACE_TRANSITION_PARAMS.TRIPLE_JUNCTION_WEIGHT + 1e-5
        );
      }
    }
  });

  it('handles diagonal corner blending when cardinal neighbors match primary surface', () => {
    const map = makeTransitionMap(
      [
        '....',
        '.,..',
        '....',
        '....',
      ],
      [
        '1111',
        '1111',
        '1111',
        '1111',
      ]
    );
    const plan = planSurfaceTransitions(map);
    // (2,2) is diagonally NW adjacent to dirt at (1,1)
    const diagGrass = plan.tilePlans[2 * 4 + 2];
    expect(diagGrass.hasTransition).toBe(true);
    expect(diagGrass.uniqueTargets).toContain('dirt');
    const nwSector = diagGrass.sectors.find(
      (s) =>
        s.targetTile === 'dirt' &&
        Math.abs(s.ax - 1.5) < 1e-6 &&
        Math.abs(s.az - 1.5) < 1e-6
    );
    expect(nwSector).toBeDefined();
    expect(nwSector!.weightA).toBeCloseTo(SURFACE_TRANSITION_PARAMS.MAX_EDGE_BLEND_WEIGHT, 5);
  });

  it('never leaks transitions onto protected zones, cross-height drops, interiors, or P2 cliff walls', () => {
    const map = makeTransitionMap(
      [
        '.,.,.,.,',
        '.=^~B.,.',
        '.###,,,.',
        '.###,,,.',
        '........',
      ],
      [
        '11111111',
        '11201111',
        '13331111',
        '13331111',
        '11111111',
      ],
      {
        buildings: [{ kind: 'house_red', x: 5, z: 2, width: 2, depth: 2, facing: 'down' }],
        warps: [{ x: 1, y: 0, targetMap: 'other', targetX: 0, targetY: 0 }],
      }
    );
    const contours = analyzeTerrainContours(map);
    const plan = planSurfaceTransitions(map, contours);

    // Stairs (2,1), water (3,1), bridge (4,1), warp (1,0), building (5..6, 2..3) must be protected & unblended
    const protectedCoords: ReadonlyArray<[number, number]> = [
      [2, 1],
      [3, 1],
      [4, 1],
      [1, 0],
      [5, 2],
      [6, 3],
    ];
    for (const [x, z] of protectedCoords) {
      const tp = plan.tilePlans[z * 8 + x];
      expect(tp.isProtected).toBe(true);
      expect(tp.hasTransition).toBe(false);
    }

    // Raised plateau edge (3,2) at level 3 vs (4,2) at level 1 must NOT transition across the cliff drop
    const cliffTop = plan.tilePlans[2 * 8 + 3];
    const cliffFoot = plan.tilePlans[2 * 8 + 4];
    expect(
      cliffTop.sectors.every(
        (s) => Math.abs(s.ax - 3.5) > 1e-5 || Math.abs(s.bx - 3.5) > 1e-5 || s.targetTile === null
      )
    ).toBe(true);
    expect(
      cliffFoot.sectors.every(
        (s) => Math.abs(s.ax - 3.5) > 1e-5 || Math.abs(s.bx - 3.5) > 1e-5 || s.targetTile === null
      )
    ).toBe(true);

    // Interior maps disable all transitions
    const interiorPlan = planSurfaceTransitions(MAPS.laboratorio_origen);
    expect(interiorPlan.tilePlans.every((t) => t.isProtected && !t.hasTransition)).toBe(true);

    // Build chunks and verify every P2 cliff wall vertex (aCliffMeta.x == 1.0) has zero blend weight
    const mat = new THREE.MeshStandardMaterial();
    const grassMat = new THREE.MeshStandardMaterial();
    const chunks = buildTerrainChunks(map, mat, grassMat);
    for (const ch of chunks) {
      const meta = ch.mesh.geometry.getAttribute('aCliffMeta') as THREE.BufferAttribute;
      const blend = ch.mesh.geometry.getAttribute('aSurfaceBlend') as THREE.BufferAttribute;
      expect(blend).toBeDefined();
      expect(blend.itemSize).toBe(4);
      for (let i = 0; i < meta.count; i++) {
        if (meta.getX(i) > 0.5) {
          expect(blend.getY(i)).toBe(0);
          expect(blend.getZ(i)).toBe(0);
        }
      }
      ch.mesh.geometry.dispose();
    }
    mat.dispose();
    grassMat.dispose();
  });

  it('maintains seamless vertex/blend continuity across x=16 and z=16 chunk boundaries on test_riverbank', () => {
    const mat = new THREE.MeshStandardMaterial();
    const grassMat = new THREE.MeshStandardMaterial();
    const chunks = buildTerrainChunks(MAP_TEST_RIVERBANK, mat, grassMat);
    expect(chunks).toHaveLength(4);

    // Collect every non-cliff boundary vertex on x=15.5 or z=15.5
    const bySeam = (cx: number, cz: number, axis: 'x' | 'z', seamVal: number) => {
      const chunk = chunks.find((c) => c.cx === cx && c.cz === cz)!;
      const pos = chunk.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = chunk.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const meta = chunk.mesh.geometry.getAttribute('aCliffMeta') as THREE.BufferAttribute;
      const blend = chunk.mesh.geometry.getAttribute('aSurfaceBlend') as THREE.BufferAttribute;
      const points = new Map<
        string,
        { y: number; shade: number; w: number; sign: number; slot: number }[]
      >();
      for (let i = 0; i < pos.count; i++) {
        if (meta.getX(i) > 0.5) continue;
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const c = axis === 'x' ? px : pz;
        if (Math.abs(c - seamVal) < 1e-5) {
          const key = `${px.toFixed(4)},${pz.toFixed(4)}`;
          let list = points.get(key);
          if (!list) {
            list = [];
            points.set(key, list);
          }
          list.push({
            y: pos.getY(i),
            shade: col.getX(i),
            w: blend.getY(i),
            sign: blend.getZ(i),
            slot: blend.getX(i),
          });
        }
      }
      return points;
    };

    const verifySeamPair = (
      sideA: Map<string, { y: number; shade: number; w: number; sign: number; slot: number }[]>,
      sideB: Map<string, { y: number; shade: number; w: number; sign: number; slot: number }[]>
    ) => {
      let matched = 0;
      for (const [key, listA] of sideA) {
        const listB = sideB.get(key);
        if (!listB) continue;
        for (const a of listA) {
          if (a.w <= 0.01) continue;
          // At multi-material corners multiple sectors share (x,y,z); each active weight+sign+shade must have its exact symmetric counterpart across the seam
          const partner = listB.find(
            (b) =>
              Math.abs(b.y - a.y) < 1e-4 &&
              Math.abs(b.w - a.w) < 1e-5 &&
              b.sign === -a.sign
          );
          if (partner) {
            matched++;
            expect(a.shade).toBeCloseTo(partner.shade, 5);
          }
        }
      }
      return matched;
    };

    const matchedX = verifySeamPair(bySeam(0, 1, 'x', 15.5), bySeam(1, 1, 'x', 15.5));
    const matchedZ = verifySeamPair(bySeam(1, 0, 'z', 15.5), bySeam(1, 1, 'z', 15.5));
    expect(matchedX).toBeGreaterThan(0);
    expect(matchedZ).toBeGreaterThan(0);

    for (const c of chunks) c.mesh.geometry.dispose();
    mat.dispose();
    grassMat.dispose();
  });

  it('keeps flat triangles uniform in targetAtlasSlot, obeys vertex budgets, and keeps area & TerrainRules invariant across ALL maps', () => {
    const mat = new THREE.MeshStandardMaterial();
    const grassMat = new THREE.MeshStandardMaterial();

    const allMaps: MapDef[] = [...Object.values(MAPS), ...Object.values(DEV_MAPS)];
    for (const map of allMaps) {
      const chunks = buildTerrainChunks(map, mat, grassMat);
      expect(chunks.length).toBeGreaterThan(0);

      for (const ch of chunks) {
        const geo = ch.mesh.geometry;
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
        const meta = geo.getAttribute('aCliffMeta') as THREE.BufferAttribute;
        const blend = geo.getAttribute('aSurfaceBlend') as THREE.BufferAttribute;
        const idx = geo.getIndex() as THREE.BufferAttribute;

        expect(pos.count).toBeLessThan(20_000);
        expect(blend).toBeDefined();
        expect(blend.count).toBe(pos.count);

        let badBlendVerts = 0;
        let badSlotTris = 0;
        for (let i = 0; i < pos.count; i++) {
          const sx = blend.getX(i);
          const wy = blend.getY(i);
          const sz = blend.getZ(i);
          const cw = blend.getW(i);
          if (
            !Number.isFinite(sx) ||
            !Number.isFinite(wy) ||
            !Number.isFinite(sz) ||
            !Number.isFinite(cw) ||
            wy < 0 ||
            wy > SURFACE_TRANSITION_PARAMS.MAX_EDGE_BLEND_WEIGHT + 1e-5 ||
            (meta.getX(i) > 0.5 && wy !== 0)
          ) {
            badBlendVerts++;
          }
        }

        // Critical invariant: no horizontal triangle ever interpolates atlas slot index between different neighbor materials
        let horizontalArea = 0;
        for (let t = 0; t < idx.count; t += 3) {
          const i0 = idx.getX(t);
          const i1 = idx.getX(t + 1);
          const i2 = idx.getX(t + 2);

          if (Math.abs(norm.getY(i0) - 1) < 1e-3) {
            const s0 = blend.getX(i0);
            if (blend.getX(i1) !== s0 || blend.getX(i2) !== s0) {
              badSlotTris++;
            }

            const ax = pos.getX(i0), az = pos.getZ(i0);
            const bx = pos.getX(i1), bz = pos.getZ(i1);
            const cx = pos.getX(i2), cz = pos.getZ(i2);
            horizontalArea += ((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * -0.5;
          }
        }

        expect(badBlendVerts).toBe(0);
        expect(badSlotTris).toBe(0);

        const startX = ch.cx * CHUNK_SIZE;
        const startZ = ch.cz * CHUNK_SIZE;
        const tilesW = Math.min(CHUNK_SIZE, (map.grid[0]?.length ?? 0) - startX);
        const tilesH = Math.min(CHUNK_SIZE, map.grid.length - startZ);
        expect(horizontalArea).toBeCloseTo(tilesW * tilesH, 3);

        geo.dispose();
      }
    }

    // Verify TerrainRules walkability & height queries on test_riverbank remain unchanged after P3 map transitions
    expect(getTileHeightLevel(MAP_TEST_RIVERBANK, 10, 25)).toBe(1);
    expect(sampleInterpolatedHeight(MAP_TEST_RIVERBANK, 19, 21)).toBeCloseTo(1 * HEIGHT_UNIT);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 18, 24, 19, 24)).toBe(true);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 19, 22, 18, 22)).toBe(false); // water east bank still impassable
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 19, 15, 20, 15)).toBe(true); // mid-terrace dirt transition still walkable

    mat.dispose();
    grassMat.dispose();
  });

  it('configures TerrainWeatheringShader P3 blending uniforms and caches shader variants cleanly', () => {
    const atlasTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const normTex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    const mat = new THREE.MeshStandardMaterial();

    attachTerrainDioramaShader(mat, 'meadow', {
      terrainAtlas: atlasTex,
      terrainNormalAtlas: normTex,
    });

    expect(mat.customProgramCacheKey()).toContain('terrain_diorama_v1');
    expect(mat.customProgramCacheKey()).toContain('p3blend');
    const u = mat.userData.__terrainDioramaUniforms as {
      uTerrainAtlas: { value: THREE.Texture };
      uTerrainNormalAtlas: { value: THREE.Texture };
      uHasTerrainAtlas: { value: number };
    };
    expect(u.uTerrainAtlas.value).toBe(atlasTex);
    expect(u.uTerrainNormalAtlas.value).toBe(normTex);
    expect(u.uHasTerrainAtlas.value).toBe(1.0);
    expect(TILE_ATLAS_INDEX.sand).toBeGreaterThan(0);

    mat.dispose();
    atlasTex.dispose();
    normTex.dispose();
  });
});
