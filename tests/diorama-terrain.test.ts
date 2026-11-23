import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/data/maps/index.ts';
import { HEIGHT_UNIT } from '../src/domain/TerrainRules.ts';
import type { BattleBiome, MapDef } from '../src/domain/types.ts';
import { getTileUv } from '../src/engine/AtlasBuilder.ts';
import {
  buildCliffOrnamentsMesh,
  createCliffOrnamentMaterial,
  planCliffOrnaments,
} from '../src/engine/CliffOrnamentMesher.ts';
import {
  DIORAMA_RENDER_ORDER,
  getBiomeCliffWeathering,
} from '../src/engine/DioramaLayers.ts';
import { attachCameraOcclusionCutout } from '../src/engine/OcclusionCutout.ts';
import { PixelSsaoShader } from '../src/engine/PixelSsaoShader.ts';
import {
  buildStaircaseMeshes,
  detectStairClimbDirection,
} from '../src/engine/StaircaseMesher.ts';
import {
  buildTerrainChunks,
  detectCliffBoundaries,
} from '../src/engine/TerrainMesher.ts';
import {
  attachTerrainDioramaShader,
  updateTerrainDioramaBiome,
} from '../src/engine/TerrainWeatheringShader.ts';

function makeCliffTestMap(biome: BattleBiome = 'forest'): MapDef {
  return {
    id: 'cliff_test',
    nameKey: 'cliff_test',
    biome,
    music: biome === 'cave' ? 'cave' : 'route',
    skyTopColor: 0x000000,
    skyBottomColor: 0x111111,
    fogColor: 0x222222,
    grid: [
      '.....',
      '.###.',
      '.#^#.',
      '.###.',
      '.....',
    ],
    heights: [
      '11111',
      '13331',
      '13231',
      '13331',
      '11111',
    ],
    legend: {
      '.': { tile: 'grass', solid: false },
      '#': { tile: 'stone', solid: true },
      '^': { tile: 'stairs', solid: false, ramp: true },
    },
    buildings: [],
    props: [],
    decoration: {
      seed: 42,
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

describe('Diorama 90-degree cliff terrain & shaders', () => {
  it('detects cliff boundaries and emits non-sheared organic plateau & vertical wall triangles with exact normals', () => {
    const map = makeCliffTestMap('mountain');
    const boundaries = detectCliffBoundaries(map);
    expect(boundaries.length).toBeGreaterThan(0);

    // Center raised stone ring (level 3) drops onto outer grass (level 1) and stair (level 2)
    const northEdge = boundaries.find((b) => b.x === 2 && b.z === 1 && b.face === 'north');
    expect(northEdge).toBeDefined();
    expect(northEdge!.yTop).toBeCloseTo(3 * HEIGHT_UNIT);
    expect(northEdge!.yBottom).toBeCloseTo(1 * HEIGHT_UNIT);

    const mat = new THREE.MeshStandardMaterial();
    const chunks = buildTerrainChunks(map, mat);
    expect(chunks).toHaveLength(1);
    const mesh = chunks[0].mesh;
    expect(mesh.renderOrder).toBe(DIORAMA_RENDER_ORDER.TERRAIN_BASE);

    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const norm = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const cliffMeta = mesh.geometry.getAttribute('aCliffMeta') as THREE.BufferAttribute;
    const index = mesh.geometry.getIndex() as THREE.BufferAttribute;
    expect(cliffMeta).toBeDefined();
    expect(cliffMeta.itemSize).toBe(3);
    expect(index).toBeDefined();

    let horizontalArea = 0;
    let cliffTris = 0;
    let slopedOrBevelTris = 0;
    let undercutTris = 0;
    const allowedCliffRects = (
      ['cliff_rock', 'mossy_stone', 'cracked_stone', 'dirt', 'stone', 'cave_floor'] as const
    ).map((k) => getTileUv(k));

    for (let t = 0; t < index.count; t += 3) {
      const i0 = index.getX(t);
      const i1 = index.getX(t + 1);
      const i2 = index.getX(t + 2);
      const ny = norm.getY(i0);
      const nx = norm.getX(i0);
      const nz = norm.getZ(i0);

      if (Math.abs(ny - 1) < 0.001) {
        // Every flat top or lower-floor triangle must have identical Y across all 3 vertices
        const y0 = pos.getY(i0);
        expect(pos.getY(i1)).toBeCloseTo(y0);
        expect(pos.getY(i2)).toBeCloseTo(y0);

        const ax = pos.getX(i0), az = pos.getZ(i0);
        const bx = pos.getX(i1), bz = pos.getZ(i1);
        const cx = pos.getX(i2), cz = pos.getZ(i2);
        const signedArea = ((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * -0.5;
        expect(signedArea).toBeGreaterThan(0);
        horizontalArea += signedArea;
      } else {
        cliffTris++;
        // 3D rocky cliff triangles must have normalized 3D unit normals and cliff metadata flag
        expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1.0, 4);
        expect(cliffMeta.getX(i0)).toBeCloseTo(1.0);
        if (ny > 0.05) slopedOrBevelTris++;
        if (ny < -0.05) undercutTris++;

        for (const vi of [i0, i1, i2]) {
          const u = uv.getX(vi);
          const v = uv.getY(vi);
          const insideAnySlot = allowedCliffRects.some(
            (r) =>
              u >= r.u0 - 1e-5 &&
              u <= r.u1 + 1e-5 &&
              v >= r.v0 - 1e-5 &&
              v <= r.v1 + 1e-5
          );
          expect(insideAnySlot).toBe(true);
        }
      }
    }

    // Watertight 5x5 tile horizontal footprint must equal exact 25.0 world square units
    expect(horizontalArea).toBeCloseTo(25.0, 4);
    expect(cliffTris).toBeGreaterThan(boundaries.length * 4);
    expect(slopedOrBevelTris).toBeGreaterThan(0);
    expect(undercutTris).toBeGreaterThan(0);

    mesh.geometry.dispose();
    mat.dispose();
  });

  it('auto-orients staircases toward higher terrain and assigns staircase renderOrder', () => {
    const map = makeCliffTestMap('meadow');
    // At (2,2) level 2, neighbors (1,2), (3,2), (2,1), (2,3) are level 3, north checked first
    const orient = detectStairClimbDirection(map, 2, 2);
    expect(orient.dir).toBe('north');
    expect(orient.yLow).toBeCloseTo(2 * HEIGHT_UNIT);
    expect(orient.yHigh).toBeCloseTo(3 * HEIGHT_UNIT);

    // Pueblo Bruma terrace stairs at (23, 29) climb north from level 2 to level 3
    const brumaOrient = detectStairClimbDirection(MAPS.pueblo_bruma, 23, 29);
    expect(brumaOrient.dir).toBe('north');
    expect(brumaOrient.yHigh).toBeCloseTo(3 * HEIGHT_UNIT);

    // Explicit west-climbing stairs (higher tile at x=1) and east-climbing stairs (higher tile at x=3)
    const westMap = makeCliffTestMap('meadow');
    westMap.heights = ['11111', '11111', '13211', '11111', '11111'];
    expect(detectStairClimbDirection(westMap, 2, 2).dir).toBe('west');
    westMap.heights = ['11111', '11111', '11231', '11111', '11111'];
    expect(detectStairClimbDirection(westMap, 2, 2).dir).toBe('east');

    const mat = new THREE.MeshStandardMaterial();
    const group = buildStaircaseMeshes(map, mat);
    expect(group.children.length).toBe(1);
    const stairMesh = group.children[0] as THREE.Mesh;
    expect(stairMesh.renderOrder).toBe(DIORAMA_RENDER_ORDER.STAIRCASE);
    expect(stairMesh.geometry.getAttribute('position').count).toBe(4 * 2 * 4); // 4 steps * (tread + riser) * 4 verts
    stairMesh.geometry.dispose();
    mat.dispose();
  });

  it('snaps floating cliff ornaments cleanly to 90-degree boundaries with outward anti-Z-fighting offset', () => {
    const forestMap = makeCliffTestMap('forest');
    const boundaries = detectCliffBoundaries(forestMap);
    const placements = planCliffOrnaments(forestMap, boundaries);
    expect(placements.length).toBeGreaterThan(0);

    for (const p of placements) {
      expect(p.offsetOutward).toBeGreaterThan(0);
      // Verify ornament coordinates align with one of the detected boundaries + outward offset
      const match = boundaries.find(
        (b) =>
          b.face === p.face &&
          Math.abs(b.x + p.nx * (0.5 + p.offsetOutward) - p.x) < 1e-4 &&
          Math.abs(b.z + p.nz * (0.5 + p.offsetOutward) - p.z) < 1e-4
      );
      expect(match).toBeDefined();
    }

    const dummyTex = new THREE.DataTexture(new Uint8Array(16), 2, 2) as unknown as THREE.CanvasTexture;
    const mat = createCliffOrnamentMaterial(dummyTex);
    expect(mat.polygonOffset).toBe(true);

    const group = buildCliffOrnamentsMesh(forestMap, mat);
    expect(group).not.toBeNull();
    const mesh = group!.children[0] as THREE.Mesh;
    expect(mesh.renderOrder).toBe(DIORAMA_RENDER_ORDER.CLIFF_ORNAMENT);
    expect(mesh.renderOrder).toBeGreaterThan(DIORAMA_RENDER_ORDER.TERRAIN_BASE);
    expect(mesh.renderOrder).toBeLessThan(DIORAMA_RENDER_ORDER.WATER_SURFACE);

    // Cave biome selects crystal_icicle / cracked_trim ornaments
    const cavePlacements = planCliffOrnaments(makeCliffTestMap('cave'));
    expect(
      cavePlacements.some((p) => p.kind === 'crystal_icicle' || p.kind === 'cracked_trim')
    ).toBe(true);

    mesh.geometry.dispose();
    mat.dispose();
    dummyTex.dispose();
  });

  it('provides biome-specific cliff-top weathering profiles and chains shader hooks cleanly', () => {
    const biomes: BattleBiome[] = [
      'meadow',
      'forest',
      'mountain',
      'snow',
      'cave',
      'arena',
      'coast',
    ];
    const hexes = new Set<string>();
    for (const b of biomes) {
      const prof = getBiomeCliffWeathering(b);
      expect(prof.strength).toBeGreaterThan(0.2);
      expect(prof.edgeBandHeight).toBeGreaterThan(0.2);
      hexes.add(prof.edgeColor.getHexString());
    }
    expect(hexes.size).toBe(biomes.length);

    const mat = new THREE.MeshStandardMaterial();
    attachCameraOcclusionCutout(mat, { minRelY: -0.35 });
    attachTerrainDioramaShader(mat, 'forest');

    const cacheKey = mat.customProgramCacheKey();
    expect(cacheKey).toContain('cam_occ_');
    expect(cacheKey).toContain('terrain_diorama_v1');

    const uniforms = mat.userData.__terrainDioramaUniforms as {
      uWeatheringColor: { value: THREE.Color };
      uWeatheringStrength: { value: number };
    };
    const forestHex = uniforms.uWeatheringColor.value.getHexString();
    updateTerrainDioramaBiome(mat, 'cave');
    expect(uniforms.uWeatheringColor.value.getHexString()).not.toBe(forestHex);

    mat.dispose();
  });

  it('configures PixelSsaoShader with perspective depth linearization and pixel-grid uniforms', () => {
    expect(PixelSsaoShader.uniforms.tDepth).toBeDefined();
    expect(PixelSsaoShader.uniforms.uPixelGrid.value.x).toBeGreaterThan(0);
    expect(PixelSsaoShader.uniforms.uCameraNear.value).toBeGreaterThan(0);
    expect(PixelSsaoShader.uniforms.uCameraFar.value).toBeGreaterThan(
      PixelSsaoShader.uniforms.uCameraNear.value
    );
    expect(PixelSsaoShader.fragmentShader).toContain('perspectiveDepthToViewZ');
    expect(PixelSsaoShader.fragmentShader).toContain('uPixelGrid');
  });
});
