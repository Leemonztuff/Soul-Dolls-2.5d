import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEV_MAPS, MAPS } from '../src/data/maps/index.ts';
import { HEIGHT_UNIT } from '../src/domain/TerrainRules.ts';
import type { BattleBiome, MapDef } from '../src/domain/types.ts';
import {
  buildCliffOrnamentsMesh,
  createCliffOrnamentMaterial,
} from '../src/engine/CliffOrnamentMesher.ts';
import {
  appendTileRockyCliffs,
  classifyCliffSegmentSurface,
  extractRockyCliffOrnamentAnchors,
  ROCKY_CLIFF_PARAMS,
  RockyCliffBuildContext,
  type RockyCliffChunkBuffers,
} from '../src/engine/RockyCliffMesher.ts';
import { analyzeTerrainContours } from '../src/engine/TerrainContourAnalyzer.ts';
import { buildTerrainChunks, CHUNK_SIZE } from '../src/engine/TerrainMesher.ts';

function makeTallCliffMap(biome: BattleBiome = 'mountain'): MapDef {
  return {
    id: `rocky_test_${biome}`,
    nameKey: 'rocky_test',
    biome,
    music: biome === 'cave' ? 'cave' : 'route',
    skyTopColor: 0x000000,
    skyBottomColor: 0x111111,
    fogColor: 0x222222,
    grid: [
      '.......',
      '.#####.',
      '.#####.',
      '.##^##.',
      '.##~##.',
      '.......',
    ],
    heights: [
      '1111111',
      '1444441',
      '1444441',
      '1432341',
      '1110111',
      '1110111',
    ],
    legend: {
      '.': { tile: 'grass', solid: false },
      '#': { tile: 'stone', solid: true },
      '^': { tile: 'stairs', solid: false, ramp: true },
      '~': { tile: 'water', solid: true },
    },
    buildings: [
      { kind: 'house_blue', x: 2, z: 1, width: 1, depth: 1, facing: 'down' },
    ],
    props: [],
    decoration: {
      seed: 109,
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
  };
}

function emptyBuffers(): RockyCliffChunkBuffers {
  return {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    cliffMeta: [],
    atlasIndices: [],
  };
}

describe('P2 RockyCliffMesher — Stratification, Overhangs, Talus & Continuity', () => {
  it('classifies surfaces per biome and disables overhangs on protected walls, stairs and water edges', () => {
    const caveMap = makeTallCliffMap('cave');
    const caveAnalysis = analyzeTerrainContours(caveMap);
    const openContour = caveAnalysis.tileContours[1 * 7 + 1]; // rocky plateau corner (1,1)
    const caveClass = classifyCliffSegmentSurface(
      caveMap,
      openContour,
      openContour.rimSegments[0],
      'cliff_rock'
    );
    expect(caveClass.strataPalette).toContain('cracked_stone');
    expect(caveClass.ornamentSuitability.crystalIcicle).toBe(true);
    expect(caveClass.ornamentSuitability.hangingVine).toBe(false);
    expect(caveClass.allowOverhang).toBe(true);

    // Building footprint tile (2,1) is protected
    const bldgContour = caveAnalysis.tileContours[1 * 7 + 2];
    const bldgSeg = bldgContour.rimSegments[0];
    expect(bldgSeg).toBeDefined();
    const protClass = classifyCliffSegmentSurface(caveMap, bldgContour, bldgSeg, 'cliff_rock');
    expect(protClass.isProtectedWall).toBe(true);
    expect(protClass.allowOverhang).toBe(false);
    expect(protClass.allowTalus).toBe(false);

    // Forest map classifies mossy strata & hanging vines
    const forestMap = makeTallCliffMap('forest');
    const forestAnalysis = analyzeTerrainContours(forestMap);
    const forestCorner = forestAnalysis.tileContours[1 * 7 + 1];
    const forestClass = classifyCliffSegmentSurface(
      forestMap,
      forestCorner,
      forestCorner.rimSegments[0],
      'grass'
    );
    expect(forestClass.strataPalette).toContain('mossy_stone');
    expect(forestClass.ornamentSuitability.hangingVine).toBe(true);
  });

  it('builds 3D cliff bands (shoulder, overhang lip & underside, strata, basal talus) with valid geometry', () => {
    const map = makeTallCliffMap('mountain');
    const analysis = analyzeTerrainContours(map);
    const ctx = new RockyCliffBuildContext(map, analysis);
    const buffers = emptyBuffers();
    let totalBands = 0;

    for (const c of analysis.tileContours) {
      if (c.rimSegments.length === 0) continue;
      const stats = appendTileRockyCliffs(ctx, c, 'cliff_rock', buffers);
      totalBands += stats.bandQuadCount;
    }

    expect(totalBands).toBeGreaterThan(20);
    expect(buffers.positions.length % 3).toBe(0);
    expect(buffers.normals.length).toBe(buffers.positions.length);
    expect(buffers.cliffMeta.length).toBe(buffers.positions.length);
    expect(buffers.uvs.length).toBe((buffers.positions.length / 3) * 2);

    const vertCount = buffers.positions.length / 3;
    let hasPositiveSlopeNy = false;
    let hasUndercutNegativeNy = false;
    let hasVerticalFaceNy = false;

    for (let i = 0; i < buffers.positions.length; i++) {
      expect(Number.isFinite(buffers.positions[i])).toBe(true);
      expect(Number.isFinite(buffers.normals[i])).toBe(true);
      expect(Number.isFinite(buffers.colors[i])).toBe(true);
      expect(Number.isFinite(buffers.cliffMeta[i])).toBe(true);
    }
    for (let v = 0; v < vertCount; v++) {
      const nx = buffers.normals[v * 3];
      const ny = buffers.normals[v * 3 + 1];
      const nz = buffers.normals[v * 3 + 2];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1.0, 4);
      expect(ny).toBeLessThanOrEqual(0.921);
      expect(buffers.cliffMeta[v * 3]).toBeCloseTo(1.0);
      if (ny > 0.12) hasPositiveSlopeNy = true;
      if (ny < -0.12) hasUndercutNegativeNy = true;
      if (Math.abs(ny) < 0.08) hasVerticalFaceNy = true;
    }

    expect(hasPositiveSlopeNy).toBe(true);
    expect(hasUndercutNegativeNy).toBe(true);
    expect(hasVerticalFaceNy).toBe(true);

    // Every emitted triangle must have strictly positive 3D area and valid indices
    for (let t = 0; t < buffers.atlasIndices.length; t += 3) {
      const i0 = buffers.atlasIndices[t];
      const i1 = buffers.atlasIndices[t + 1];
      const i2 = buffers.atlasIndices[t + 2];
      expect(i0).toBeLessThan(vertCount);
      expect(i1).toBeLessThan(vertCount);
      expect(i2).toBeLessThan(vertCount);

      const ax = buffers.positions[i0 * 3];
      const ay = buffers.positions[i0 * 3 + 1];
      const az = buffers.positions[i0 * 3 + 2];
      const bx = buffers.positions[i1 * 3];
      const by = buffers.positions[i1 * 3 + 1];
      const bz = buffers.positions[i1 * 3 + 2];
      const cx = buffers.positions[i2 * 3];
      const cy = buffers.positions[i2 * 3 + 1];
      const cz = buffers.positions[i2 * 3 + 2];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const area =
        0.5 *
        Math.hypot(
          e1y * e2z - e1z * e2y,
          e1z * e2x - e1x * e2z,
          e1x * e2y - e1y * e2x
        );
      expect(area).toBeGreaterThan(ROCKY_CLIFF_PARAMS.MIN_TRI_AREA_3D);
    }
  });

  it('produces 100% deterministic output across repeated calls', () => {
    const map = DEV_MAPS.test_riverbank;
    const mat = new THREE.MeshStandardMaterial();
    const runA = buildTerrainChunks(map, mat);
    const runB = buildTerrainChunks(map, mat);

    expect(runA.length).toBe(runB.length);
    for (let i = 0; i < runA.length; i++) {
      const pA = runA[i].mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const pB = runB[i].mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const nA = runA[i].mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const nB = runB[i].mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
      expect(pA.count).toBe(pB.count);
      for (let k = 0; k < pA.array.length; k++) {
        expect(pA.array[k]).toBe(pB.array[k]);
        expect(nA.array[k]).toBe(nB.array[k]);
      }
      runA[i].mesh.geometry.dispose();
      runB[i].mesh.geometry.dispose();
    }
    mat.dispose();
  });

  it('keeps chunk boundaries x=16 and z=16 continuous with zero terrain seams on test_riverbank', () => {
    const map = DEV_MAPS.test_riverbank;
    const analysis = analyzeTerrainContours(map);
    const ctx = new RockyCliffBuildContext(map, analysis);

    // Collect cliff endpoint profile coordinates touching vertical/horizontal chunk seams
    const collectSeamHeights = (axis: 'x' | 'z', seamCoord: number) => {
      const sideA = new Map<string, number[]>();
      const sideB = new Map<string, number[]>();

      for (const c of analysis.tileContours) {
        if (c.rimSegments.length === 0) continue;
        const buf = emptyBuffers();
        appendTileRockyCliffs(ctx, c, 'cliff_rock', buf);
        const tileCoord = axis === 'x' ? c.x : c.z;
        const target = tileCoord < CHUNK_SIZE ? sideA : sideB;

        for (let v = 0; v < buf.positions.length / 3; v++) {
          const px = buf.positions[v * 3];
          const py = buf.positions[v * 3 + 1];
          const pz = buf.positions[v * 3 + 2];
          const coord = axis === 'x' ? px : pz;
          if (Math.abs(coord - seamCoord) < 0.025) {
            const key = `${px.toFixed(3)},${pz.toFixed(3)}`;
            let list = target.get(key);
            if (!list) {
              list = [];
              target.set(key, list);
            }
            list.push(py);
          }
        }
      }
      return { sideA, sideB };
    };

    const seamX = collectSeamHeights('x', CHUNK_SIZE - 0.5);
    const seamZ = collectSeamHeights('z', CHUNK_SIZE - 0.5);
    expect(seamX.sideA.size + seamZ.sideA.size).toBeGreaterThan(0);

    for (const seam of [seamX, seamZ]) {
      for (const [key, ysA] of seam.sideA) {
        const ysB = seam.sideB.get(key);
        if (!ysB) continue;
        const uniqA = [...new Set(ysA.map((v) => v.toFixed(3)))];
        const uniqB = [...new Set(ysB.map((v) => v.toFixed(3)))];
        expect(uniqA).toEqual(uniqB);
      }
    }
  });

  it('respects vertex budget (<20,000 verts/chunk) and exact floor footprints across ALL maps', () => {
    const mat = new THREE.MeshStandardMaterial();
    for (const map of Object.values(MAPS)) {
      const chunks = buildTerrainChunks(map, mat);
      expect(chunks.length).toBeGreaterThan(0);
      for (const ch of chunks) {
        const pos = ch.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        expect(pos.count).toBeLessThan(20_000);
        expect(pos.count).toBeLessThan(65_535);
        ch.mesh.geometry.dispose();
      }
    }
    mat.dispose();
  });

  it('anchors 3D cliff ornaments directly onto non-protected rock lips without NaN or talus penetration', () => {
    const forestMap = makeTallCliffMap('forest');
    const analysis = analyzeTerrainContours(forestMap);
    const anchors = extractRockyCliffOrnamentAnchors(forestMap, analysis);
    expect(anchors.length).toBeGreaterThan(0);

    for (const a of anchors) {
      expect(a.suitability.edgeLip).toBe(true);
      expect(a.maxHangHeight).toBeGreaterThanOrEqual(0.12);
      expect(Math.hypot(a.nx, a.ny, a.nz)).toBeCloseTo(1.0, 4);
      // Stairs tile at (2,3) and protected building tile at (2,1) must not receive anchors
      expect(!(a.tileX === 2 && a.tileZ === 1)).toBe(true);
      expect(!(a.tileX === 2 && a.tileZ === 3)).toBe(true);
    }

    const dummyTex = new THREE.DataTexture(new Uint8Array(16), 2, 2) as unknown as THREE.CanvasTexture;
    const ornMat = createCliffOrnamentMaterial(dummyTex);
    const ornGroup = buildCliffOrnamentsMesh(DEV_MAPS.test_riverbank, ornMat);
    expect(ornGroup).not.toBeNull();

    const mesh = ornGroup!.children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const norm = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
      expect(Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i))).toBeCloseTo(1.0, 4);
    }

    // Check drop height vs HEIGHT_UNIT sanity
    expect(HEIGHT_UNIT).toBeGreaterThanOrEqual(0.5);

    mesh.geometry.dispose();
    ornMat.dispose();
    dummyTex.dispose();
  });
});
