import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/data/maps/index.ts';
import { MAP_TEST_RIVERBANK } from '../src/data/maps/testRiverbank.ts';
import {
  getTileHeightLevel,
  HEIGHT_UNIT,
  isTileWalkable,
  sampleInterpolatedHeight,
} from '../src/domain/TerrainRules.ts';
import type { MapDef } from '../src/domain/types.ts';
import {
  analyzeTerrainContours,
  TERRAIN_CONTOUR_PARAMS,
} from '../src/engine/TerrainContourAnalyzer.ts';
import {
  buildTerrainChunks,
  CHUNK_SIZE,
  updateVisibleTerrainChunks,
} from '../src/engine/TerrainMesher.ts';

function makeGridMap(
  grid: string[],
  heights: string[],
  extra?: Partial<MapDef>
): MapDef {
  return {
    id: 'contour_unit',
    nameKey: 'contour_unit',
    biome: 'meadow',
    music: 'route',
    skyTopColor: 0x000000,
    skyBottomColor: 0x111111,
    fogColor: 0x222222,
    grid,
    heights,
    legend: {
      '.': { tile: 'grass', solid: false },
      '#': { tile: 'stone', solid: true },
      '=': { tile: 'cobble', solid: false },
      '^': { tile: 'stairs', solid: false, ramp: true },
      B: { tile: 'bridge', solid: false },
      '~': { tile: 'water', solid: true },
    },
    buildings: [],
    props: [],
    decoration: {
      seed: 123,
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

describe('P1 Organic Plateaus & TerrainContourAnalyzer', () => {
  it('detects connected terrain regions cleanly', () => {
    const map = makeGridMap(
      [
        '......',
        '.####.',
        '.#..#.',
        '.####.',
        '......',
      ],
      [
        '111111',
        '133331',
        '131131',
        '133331',
        '111111',
      ]
    );
    const analysis = analyzeTerrainContours(map);
    // Expected: outer level-1 grass ring (1), level-3 stone ring (1), inner level-1 grass pit (1)
    expect(analysis.regions).toHaveLength(3);
    const ring = analysis.regions.find((r) => r.level === 3 && r.kind === 'cliff');
    expect(ring).toBeDefined();
    expect(ring!.tileCount).toBe(10);
    expect(ring!.bounds).toEqual({ minX: 1, maxX: 4, minZ: 1, maxZ: 3 });
  });

  it('classifies convex outer corners and chamfered geometry stays inside tile bounds', () => {
    const map = makeGridMap(
      [
        '.....',
        '.###.',
        '.###.',
        '.###.',
        '.....',
      ],
      [
        '11111',
        '13331',
        '13331',
        '13331',
        '11111',
      ]
    );
    const analysis = analyzeTerrainContours(map);
    const nw = analysis.tileContours[1 * 5 + 1];
    const ne = analysis.tileContours[1 * 5 + 3];
    const se = analysis.tileContours[3 * 5 + 3];
    const sw = analysis.tileContours[3 * 5 + 1];
    const center = analysis.tileContours[2 * 5 + 2];

    expect(nw.corners.nw).toBe('convex');
    expect(ne.corners.ne).toBe('convex');
    expect(se.corners.se).toBe('convex');
    expect(sw.corners.sw).toBe('convex');
    expect(center.isPlainInterior).toBe(true);
    expect(center.topPolygon).toHaveLength(4);

    // Convex tile topPolygon stays strictly inside [x - 0.5, x + 0.5] x [z - 0.5, z + 0.5]
    for (const c of [nw, ne, se, sw]) {
      expect(c.topPolygon.length).toBeGreaterThan(4);
      for (const p of c.topPolygon) {
        expect(p.x).toBeGreaterThanOrEqual(c.x - 0.5 - 1e-6);
        expect(p.x).toBeLessThanOrEqual(c.x + 0.5 + 1e-6);
        expect(p.z).toBeGreaterThanOrEqual(c.z - 0.5 - 1e-6);
        expect(p.z).toBeLessThanOrEqual(c.z + 0.5 + 1e-6);
      }
    }
  });

  it('smooths concave inner corners with shared exact border coordinates across tiles', () => {
    // L-shaped plateau leaving (1,1) low and (2,1),(1,2),(2,2) high -> concave corner at (2,2) NW
    const map = makeGridMap(
      [
        '.....',
        '..##.',
        '.###.',
        '.###.',
        '.....',
      ],
      [
        '11111',
        '11331',
        '13331',
        '13331',
        '11111',
      ]
    );
    const analysis = analyzeTerrainContours(map);
    const tr = analysis.tileContours[1 * 5 + 2]; // (2, 1)
    const bl = analysis.tileContours[2 * 5 + 1]; // (1, 2)
    const br = analysis.tileContours[2 * 5 + 2]; // (2, 2)

    expect(tr.corners.sw).toBe('concave');
    expect(bl.corners.ne).toBe('concave');
    expect(br.corners.nw).toBe('concave');

    // BR's NW fillet has 3 points connecting exact endpoints shared with TR.SW and BL.NE
    const brFirstNW = br.topPolygon.find((p) => Math.abs(p.z - 1.5) < 1e-6 && p.x > 1.5);
    const brLastNW = br.topPolygon.find((p) => Math.abs(p.x - 1.5) < 1e-6 && p.z > 1.5);
    expect(brFirstNW).toBeDefined();
    expect(brLastNW).toBeDefined();

    const trMatch = tr.topPolygon.find(
      (p) => Math.abs(p.x - brFirstNW!.x) < 1e-6 && Math.abs(p.z - 1.5) < 1e-6
    );
    const blMatch = bl.topPolygon.find(
      (p) => Math.abs(p.z - brLastNW!.z) < 1e-6 && Math.abs(p.x - 1.5) < 1e-6
    );
    expect(trMatch).toBeDefined();
    expect(blMatch).toBeDefined();
  });

  it('protects buildings, stairs, bridges, warps, water, and interiors', () => {
    const map = makeGridMap(
      [
        '........',
        '.=^#==..',
        '.~~~B...',
        '........',
        '..####..',
        '..####..',
        '........',
      ],
      [
        '11111111',
        '12232211',
        '10001111',
        '11111111',
        '11111111',
        '11111111',
        '11111111',
      ],
      {
        buildings: [{ kind: 'house_red', x: 2, z: 4, width: 3, depth: 2, facing: 'down' }],
        warps: [{ x: 6, y: 1, targetMap: 'other', targetX: 1, targetY: 1 }],
      }
    );

    const analysis = analyzeTerrainContours(map);
    // Stair (2,1), bridge (4,2), cobble (1,1), warp (6,1), building footprint (2..4,4..5), water (1..3,2)
    expect(analysis.tileContours[1 * 8 + 2].isProtected).toBe(true);
    expect(analysis.tileContours[2 * 8 + 4].isProtected).toBe(true);
    expect(analysis.tileContours[1 * 8 + 1].isProtected).toBe(true);
    expect(analysis.tileContours[1 * 8 + 6].isProtected).toBe(true);
    expect(analysis.tileContours[4 * 8 + 2].isProtected).toBe(true);
    expect(analysis.tileContours[2 * 8 + 1].isProtected).toBe(true);

    // Interior maps mark every tile protected and keep plain orthogonal geometry
    const interiorAnalysis = analyzeTerrainContours(MAPS.laboratorio_origen);
    expect(interiorAnalysis.tileContours.every((c) => c.isProtected && c.isPlainInterior)).toBe(true);
  });

  it('keeps deterministic geometry across repeated runs and respects MAX_EDGE_OFFSET', () => {
    const a1 = analyzeTerrainContours(MAP_TEST_RIVERBANK);
    const a2 = analyzeTerrainContours(MAP_TEST_RIVERBANK);
    expect(a1.tileContours.length).toBe(32 * 32);

    for (let i = 0; i < a1.tileContours.length; i++) {
      const c1 = a1.tileContours[i];
      const c2 = a2.tileContours[i];
      expect(c1.topPolygon).toEqual(c2.topPolygon);
      expect(c1.rimSegments).toEqual(c2.rimSegments);

      for (const p of c1.topPolygon) {
        expect(Math.abs(p.x - c1.x)).toBeLessThanOrEqual(0.5 + 1e-6);
        expect(Math.abs(p.z - c1.z)).toBeLessThanOrEqual(0.5 + 1e-6);
        // Check perimeter vertices don't retract further than max chamfer/offset
        if (Math.abs(Math.abs(p.x - c1.x) - 0.5) > 1e-6 && Math.abs(Math.abs(p.z - c1.z) - 0.5) > 1e-6) {
          // Only concave fillet midpoint sits strictly inside by <= CONCAVE_FILLET_INSET
          const insetX = 0.5 - Math.abs(p.x - c1.x);
          const insetZ = 0.5 - Math.abs(p.z - c1.z);
          expect(Math.min(insetX, insetZ)).toBeLessThanOrEqual(TERRAIN_CONTOUR_PARAMS.MAX_EDGE_OFFSET + 1e-6);
        }
      }
    }
  });

  it('clamps narrow walkable corridors cleanly so playable paths are never visually pinched', () => {
    const analysis = analyzeTerrainContours(MAP_TEST_RIVERBANK);
    // Row z=10, x=14..18 is a 2-tile narrow corridor on level 3
    const corridorTile = analysis.tileContours[10 * 32 + 14];
    expect(corridorTile.isNarrowCorridor).toBe(true);
    for (const p of corridorTile.topPolygon) {
      const dxEdge = 0.5 - Math.abs(p.x - corridorTile.x);
      const dzEdge = 0.5 - Math.abs(p.z - corridorTile.z);
      const minDistToBoxEdge = Math.min(dxEdge, dzEdge);
      expect(minDistToBoxEdge).toBeLessThanOrEqual(TERRAIN_CONTOUR_PARAMS.CORRIDOR_MAX_OFFSET + 1e-6);
    }
  });

  it('maintains watertight vertex continuity across chunk boundaries (x=16, z=16) and stays under 20,000 vertices/chunk', () => {
    const mat = new THREE.MeshStandardMaterial();
    const grassMat = new THREE.MeshStandardMaterial();

    const chunks = buildTerrainChunks(MAP_TEST_RIVERBANK, mat, grassMat);
    expect(chunks).toHaveLength(4); // 32x32 map with CHUNK_SIZE=16

    for (const chunk of chunks) {
      const pos = chunk.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const norm = chunk.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const index = chunk.mesh.geometry.getIndex() as THREE.BufferAttribute;

      expect(pos.count).toBeLessThan(20_000);
      expect(chunk.boundingBox.isEmpty()).toBe(false);

      // Zero NaN/Infinity coordinates or normals
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))).toBe(true);
        expect(Number.isFinite(pos.getY(i))).toBe(true);
        expect(Number.isFinite(pos.getZ(i))).toBe(true);
        expect(Number.isFinite(norm.getX(i))).toBe(true);
        expect(Number.isFinite(norm.getY(i))).toBe(true);
        expect(Number.isFinite(norm.getZ(i))).toBe(true);
      }

      // Zero degenerate triangles and consistent upward +Y horizontal area coverage = 256 per 16x16 chunk
      let horizontalArea = 0;
      for (let t = 0; t < index.count; t += 3) {
        const i0 = index.getX(t);
        const i1 = index.getX(t + 1);
        const i2 = index.getX(t + 2);
        const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
        const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
        const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const crX = e1y * e2z - e1z * e2y;
        const crY = e1z * e2x - e1x * e2z;
        const crZ = e1x * e2y - e1y * e2x;
        const area3d = Math.hypot(crX, crY, crZ) * 0.5;
        expect(area3d).toBeGreaterThan(1e-7);

        if (Math.abs(norm.getY(i0) - 1) < 1e-3) {
          horizontalArea += ((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * -0.5;
        }
      }
      expect(horizontalArea).toBeCloseTo(CHUNK_SIZE * CHUNK_SIZE, 3);

      chunk.mesh.geometry.dispose();
    }

    // Also check chunk-boundary vertex continuity along x = 15.5 (seam between cx=0 and cx=1)
    const seamAnalysis = analyzeTerrainContours(MAP_TEST_RIVERBANK);
    for (let z = 0; z < 32; z++) {
      const left = seamAnalysis.tileContours[z * 32 + 15];
      const right = seamAnalysis.tileContours[z * 32 + 16];
      if (left.level === right.level) {
        // Shared seam vertices at x=15.5 must match in both NE/SE (left) and NW/SW (right)
        const leftAtSeam = left.topPolygon.filter((p) => Math.abs(p.x - 15.5) < 1e-6);
        const rightAtSeam = right.topPolygon.filter((p) => Math.abs(p.x - 15.5) < 1e-6);
        if (leftAtSeam.length > 0 && rightAtSeam.length > 0) {
          for (const lp of leftAtSeam) {
            const match = rightAtSeam.find(
              (rp) => Math.abs(rp.x - lp.x) < 1e-6 && Math.abs(rp.z - lp.z) < 1e-6
            );
            expect(match).toBeDefined();
          }
        }
      }
    }

    // Verify vertex budget across ALL story maps too
    for (const map of Object.values(MAPS)) {
      const mChunks = buildTerrainChunks(map, mat, grassMat);
      for (const ch of mChunks) {
        const count = (ch.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).count;
        expect(count).toBeLessThan(20_000);
        ch.mesh.geometry.dispose();
      }
    }

    mat.dispose();
    grassMat.dispose();
  });

  it('supports camera frustum culling on terrain chunks cleanly', () => {
    const mat = new THREE.MeshStandardMaterial();
    const chunks = buildTerrainChunks(MAP_TEST_RIVERBANK, mat);
    expect(chunks).toHaveLength(4);

    // Camera positioned near South-West chunk looking straight into chunk (0, 1) -> chunks north/far culled when frustum excludes them
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 40);
    cam.position.set(8, 6, 36);
    cam.lookAt(8, 0.5, 24);
    cam.updateMatrixWorld();

    const projScreen = new THREE.Matrix4().multiplyMatrices(
      cam.projectionMatrix,
      cam.matrixWorldInverse
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projScreen);

    updateVisibleTerrainChunks(chunks, 8, 25, 48, frustum);
    const visibleSw = chunks.find((c) => c.cx === 0 && c.cz === 1);
    expect(visibleSw?.mesh.visible).toBe(true);

    // Point camera south away from the entire map -> all chunks culled by frustum
    cam.position.set(8, 6, 60);
    cam.lookAt(8, 0.5, 100);
    cam.updateMatrixWorld();
    projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    updateVisibleTerrainChunks(chunks, 8, 25, 100, frustum);
    expect(chunks.every((c) => c.mesh.visible === false)).toBe(true);

    for (const c of chunks) c.mesh.geometry.dispose();
    mat.dispose();
  });

  it('preserves TerrainRules walkability and height sampling invariance across test_riverbank', () => {
    // Route from south riverbank spawn (10,25) -> stairs (10,19) -> plateau (10,18) -> corridor (15,10) -> stairs (15,9)->(15,8) -> summit (15,7)
    expect(getTileHeightLevel(MAP_TEST_RIVERBANK, 10, 25)).toBe(1);
    expect(sampleInterpolatedHeight(MAP_TEST_RIVERBANK, 10, 25)).toBeCloseTo(1 * HEIGHT_UNIT);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 10, 25, 11, 25)).toBe(true);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 10, 20, 10, 19)).toBe(true);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 10, 19, 10, 18)).toBe(true);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 15, 10, 15, 9)).toBe(true);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 15, 9, 15, 8)).toBe(true);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 15, 8, 15, 7)).toBe(true);
    // Bridge walkable over water channel
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 15, 24, 16, 24)).toBe(true);
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 16, 24, 17, 24)).toBe(true);
    // Water remains impassable
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 15, 22, 16, 22)).toBe(false);
    // Building remains impassable
    expect(isTileWalkable(MAP_TEST_RIVERBANK, 7, 25, 7, 24)).toBe(false);
  });
});
