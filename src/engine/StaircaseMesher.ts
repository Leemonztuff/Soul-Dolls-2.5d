import * as THREE from 'three';
import { getTileHeightLevel, HEIGHT_UNIT } from '../domain/TerrainRules.ts';
import type { MapDef } from '../domain/types.ts';
import { getTileUv } from './AtlasBuilder.ts';
import { DIORAMA_RENDER_ORDER, type CliffDirection } from './DioramaLayers.ts';

export interface StairOrientation {
  dir: CliffDirection;
  yLow: number;
  yHigh: number;
}

const OPPOSITE_DIR: Record<CliffDirection, CliffDirection> = {
  north: 'south',
  south: 'north',
  west: 'east',
  east: 'west',
};

export function detectStairClimbDirection(
  map: MapDef,
  x: number,
  z: number
): StairOrientation {
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;
  const baseH = getTileHeightLevel(map, x, z);

  const checks: ReadonlyArray<{ dx: number; dz: number; dir: CliffDirection }> = [
    { dx: 0, dz: -1, dir: 'north' },
    { dx: 0, dz: 1, dir: 'south' },
    { dx: -1, dz: 0, dir: 'west' },
    { dx: 1, dz: 0, dir: 'east' },
  ];

  let bestHigherDir: CliffDirection | null = null;
  let maxNeighborH = baseH;
  let bestLowerDir: CliffDirection | null = null;
  let minNeighborH = baseH;

  for (const c of checks) {
    const nx = x + c.dx;
    const nz = z + c.dz;
    if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
    const hN = getTileHeightLevel(map, nx, nz);
    if (hN > maxNeighborH) {
      maxNeighborH = hN;
      bestHigherDir = c.dir;
    }
    if (hN < minNeighborH) {
      minNeighborH = hN;
      bestLowerDir = c.dir;
    }
  }

  if (bestHigherDir) {
    return {
      dir: bestHigherDir,
      yLow: Math.min(baseH, minNeighborH) * HEIGHT_UNIT,
      yHigh: maxNeighborH * HEIGHT_UNIT,
    };
  }

  if (bestLowerDir) {
    return {
      dir: OPPOSITE_DIR[bestLowerDir],
      yLow: minNeighborH * HEIGHT_UNIT,
      yHigh: baseH * HEIGHT_UNIT,
    };
  }

  // Flat ceremonial steps if surrounded by equal height
  return {
    dir: 'north',
    yLow: baseH * HEIGHT_UNIT,
    yHigh: baseH * HEIGHT_UNIT + 0.16,
  };
}

function pushStairQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  colors: number[],
  cliffMeta: number[],
  indices: number[],
  verts: readonly [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ],
  normal: readonly [number, number, number],
  uvCoords: readonly [number, number, number, number, number, number, number, number],
  shade: number,
  meta: readonly [number, number, number]
): void {
  const base = positions.length / 3;
  for (let i = 0; i < 4; i++) {
    positions.push(verts[i][0], verts[i][1], verts[i][2]);
    normals.push(normal[0], normal[1], normal[2]);
    uvs.push(uvCoords[i * 2], uvCoords[i * 2 + 1]);
    colors.push(shade, shade, shade);
    cliffMeta.push(meta[0], meta[1], meta[2]);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function buildStaircaseMeshes(map: MapDef, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const height = map.grid.length;
  const width = map.grid[0]?.length ?? 0;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const cliffMeta: number[] = [];
  const indices: number[] = [];

  const treadRect = getTileUv('stairs');
  const riserRect = getTileUv('stone');
  const stepCount = 4;
  const stepDepth = 1 / stepCount;

  for (let z = 0; z < height; z++) {
    const row = map.grid[z];
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const leg = map.legend[ch];
      if (!leg || leg.tile !== 'stairs') continue;

      const { dir, yLow, yHigh } = detectStairClimbDirection(map, x, z);
      const totalRise = Math.max(0.08, yHigh - yLow);
      const stepRise = totalRise / stepCount;

      const x0 = x - 0.5;
      const x1 = x + 0.5;
      const z0 = z - 0.5;
      const z1 = z + 0.5;

      const uSpan = treadRect.u1 - treadRect.u0;
      const vSpan = treadRect.v1 - treadRect.v0;

      for (let s = 0; s < stepCount; s++) {
        const syTop = yLow + (s + 1) * stepRise;
        const syBot = yLow + s * stepRise;
        const t0 = s * stepDepth;
        const t1 = (s + 1) * stepDepth;

        // Top tread UV band (1/4 of stairs tile per tread, no shearing)
        const tu0 = treadRect.u0;
        const tu1 = treadRect.u1;
        const tv0 = treadRect.v0 + t0 * vSpan;
        const tv1 = treadRect.v0 + t1 * vSpan;

        // Riser UV slice
        const rV1 = riserRect.v1;
        const rV0 = riserRect.v1 - (riserRect.v1 - riserRect.v0) * Math.min(1, stepRise);

        if (dir === 'north') {
          // Climbs from +Z (z1) toward -Z (z0)
          const szFront = z1 - t0;
          const szBack = z1 - t1;
          pushStairQuad(
            positions, normals, uvs, colors, cliffMeta, indices,
            [
              [x0, syTop, szFront],
              [x1, syTop, szFront],
              [x1, syTop, szBack],
              [x0, syTop, szBack],
            ],
            [0, 1, 0],
            [tu0, tv0, tu1, tv0, tu1, tv1, tu0, tv1],
            0.97,
            [0, 0.25, s === 0 ? 0.35 : 0]
          );
          // Front riser facing +Z (south)
          pushStairQuad(
            positions, normals, uvs, colors, cliffMeta, indices,
            [
              [x0, syBot, szFront],
              [x1, syBot, szFront],
              [x1, syTop, szFront],
              [x0, syTop, szFront],
            ],
            [0, 0, 1],
            [riserRect.u0, rV0, riserRect.u1, rV0, riserRect.u1, rV1, riserRect.u0, rV1],
            0.84,
            [1.0, 0.35, 0.3]
          );
        } else if (dir === 'south') {
          // Climbs from -Z (z0) toward +Z (z1)
          const szFront = z0 + t0;
          const szBack = z0 + t1;
          pushStairQuad(
            positions, normals, uvs, colors, cliffMeta, indices,
            [
              [x0, syTop, szBack],
              [x1, syTop, szBack],
              [x1, syTop, szFront],
              [x0, syTop, szFront],
            ],
            [0, 1, 0],
            [tu0, tv0, tu1, tv0, tu1, tv1, tu0, tv1],
            0.97,
            [0, 0.25, s === 0 ? 0.35 : 0]
          );
          // Front riser facing -Z (north)
          pushStairQuad(
            positions, normals, uvs, colors, cliffMeta, indices,
            [
              [x1, syBot, szFront],
              [x0, syBot, szFront],
              [x0, syTop, szFront],
              [x1, syTop, szFront],
            ],
            [0, 0, -1],
            [riserRect.u0, rV0, riserRect.u1, rV0, riserRect.u1, rV1, riserRect.u0, rV1],
            0.78,
            [1.0, 0.35, 0.3]
          );
        } else if (dir === 'east') {
          // Climbs from -X (x0) toward +X (x1)
          const sxFront = x0 + t0;
          const sxBack = x0 + t1;
          pushStairQuad(
            positions, normals, uvs, colors, cliffMeta, indices,
            [
              [sxFront, syTop, z1],
              [sxBack, syTop, z1],
              [sxBack, syTop, z0],
              [sxFront, syTop, z0],
            ],
            [0, 1, 0],
            [treadRect.u0 + t0 * uSpan, treadRect.v0, treadRect.u0 + t1 * uSpan, treadRect.v0, treadRect.u0 + t1 * uSpan, treadRect.v1, treadRect.u0 + t0 * uSpan, treadRect.v1],
            0.97,
            [0, 0.25, s === 0 ? 0.35 : 0]
          );
          // Front riser facing -X (west)
          pushStairQuad(
            positions, normals, uvs, colors, cliffMeta, indices,
            [
              [sxFront, syBot, z0],
              [sxFront, syBot, z1],
              [sxFront, syTop, z1],
              [sxFront, syTop, z0],
            ],
            [-1, 0, 0],
            [riserRect.u0, rV0, riserRect.u1, rV0, riserRect.u1, rV1, riserRect.u0, rV1],
            0.82,
            [1.0, 0.35, 0.3]
          );
        } else {
          // Climbs west: from +X (x1) toward -X (x0)
          const sxFront = x1 - t0;
          const sxBack = x1 - t1;
          pushStairQuad(
            positions, normals, uvs, colors, cliffMeta, indices,
            [
              [sxBack, syTop, z1],
              [sxFront, syTop, z1],
              [sxFront, syTop, z0],
              [sxBack, syTop, z0],
            ],
            [0, 1, 0],
            [treadRect.u0 + t0 * uSpan, treadRect.v0, treadRect.u0 + t1 * uSpan, treadRect.v0, treadRect.u0 + t1 * uSpan, treadRect.v1, treadRect.u0 + t0 * uSpan, treadRect.v1],
            0.97,
            [0, 0.25, s === 0 ? 0.35 : 0]
          );
          // Front riser facing +X (east)
          pushStairQuad(
            positions, normals, uvs, colors, cliffMeta, indices,
            [
              [sxFront, syBot, z1],
              [sxFront, syBot, z0],
              [sxFront, syTop, z0],
              [sxFront, syTop, z1],
            ],
            [1, 0, 0],
            [riserRect.u0, rV0, riserRect.u1, rV0, riserRect.u1, rV1, riserRect.u0, rV1],
            0.88,
            [1.0, 0.35, 0.3]
          );
        }
      }
    }
  }

  if (positions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aCliffMeta', new THREE.Float32BufferAttribute(cliffMeta, 3));
    geo.setAttribute(
      'aSurfaceBlend',
      new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 4), 4)
    );
    geo.setIndex(indices);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = DIORAMA_RENDER_ORDER.STAIRCASE;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}
