import * as THREE from 'three';
import type { MapDef } from '../domain/types.ts';
import { PALETTE } from '../gfx/Palette.ts';
import {
  DIORAMA_RENDER_ORDER,
  type CliffBoundary,
  type CliffDirection,
} from './DioramaLayers.ts';
import {
  attachCameraOcclusionCutout,
  OCCLUSION_TERRAIN_MIN_REL_Y,
} from './OcclusionCutout.ts';
import {
  extractRockyCliffOrnamentAnchors,
  type CliffOrnamentAnchor,
} from './RockyCliffMesher.ts';
import { analyzeTerrainContours } from './TerrainContourAnalyzer.ts';
import { detectCliffBoundaries } from './TerrainMesher.ts';

export type CliffOrnamentKind =
  | 'edge_lip'
  | 'hanging_vine'
  | 'crystal_icicle'
  | 'cracked_trim';

export interface CliffOrnamentPlacement {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  face: CliffDirection;
  width: number;
  height: number;
  kind: CliffOrnamentKind;
  offsetOutward: number;
}

const ORNAMENT_SLOT_INDEX: Record<CliffOrnamentKind, number> = {
  edge_lip: 0,
  hanging_vine: 1,
  crystal_icicle: 2,
  cracked_trim: 3,
};

function deterministicHash(x: number, z: number, face: CliffDirection, seed: number): number {
  const faceNum = face === 'north' ? 1 : face === 'south' ? 2 : face === 'west' ? 3 : 4;
  let h = (x * 374761393 + z * 668265263 + faceNum * 2147483647 + seed * 1597334677) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

const ORNAMENT_OFFSET_OUTWARD = 0.025;

export function planCliffOrnaments(
  map: MapDef,
  boundaries?: readonly CliffBoundary[]
): CliffOrnamentPlacement[] {
  if (map.isInterior) return [];
  const cliffList = boundaries ?? detectCliffBoundaries(map);
  const placements: CliffOrnamentPlacement[] = [];
  const seed = map.decoration?.seed ?? 17;

  for (const b of cliffList) {
    // Keep stair/ramp faces unobstructed so treads and risers remain cleanly readable
    if (b.topTile === 'stairs') continue;
    const nCh = map.grid[b.nz]?.[b.nx];
    if (nCh && map.legend[nCh]?.tile === 'stairs') continue;

    const drop = b.yTop - b.yBottom;
    if (drop <= 0.05) continue;

    const r = deterministicHash(b.x, b.z, b.face, seed);
    let kind: CliffOrnamentKind;
    let width = 1.0;
    let height = Math.min(drop, 0.22);

    if (map.biome === 'cave' || map.music === 'cave') {
      if (r < 0.45 && drop >= 0.9) {
        kind = 'crystal_icicle';
        width = 0.88;
        height = Math.min(drop * 0.72, 0.56);
      } else {
        kind = 'cracked_trim';
        height = Math.min(drop * 0.48, 0.24);
      }
    } else if (map.biome === 'snow' || b.topTile === 'snow') {
      if (r < 0.48 && drop >= 0.9) {
        kind = 'crystal_icicle';
        width = 0.90;
        height = Math.min(drop * 0.68, 0.48);
      } else {
        kind = 'edge_lip';
        height = Math.min(drop * 0.45, 0.22);
      }
    } else if (map.biome === 'forest' || map.biome === 'meadow') {
      if (r < 0.42 && drop >= 0.9) {
        kind = 'hanging_vine';
        width = 0.92;
        height = Math.min(drop * 0.75, 0.58);
      } else if (r < 0.78) {
        kind = 'edge_lip';
        height = Math.min(drop * 0.44, 0.20);
      } else {
        continue;
      }
    } else {
      if (r < 0.45) {
        kind = 'cracked_trim';
        height = Math.min(drop * 0.46, 0.22);
      } else if (r < 0.8) {
        kind = 'edge_lip';
        height = Math.min(drop * 0.42, 0.20);
      } else {
        continue;
      }
    }

    const nx = b.face === 'east' ? 1 : b.face === 'west' ? -1 : 0;
    const nz = b.face === 'south' ? 1 : b.face === 'north' ? -1 : 0;

    placements.push({
      x: b.x + nx * (0.5 + ORNAMENT_OFFSET_OUTWARD),
      y: b.yTop,
      z: b.z + nz * (0.5 + ORNAMENT_OFFSET_OUTWARD),
      nx,
      nz,
      face: b.face,
      width,
      height,
      kind,
      offsetOutward: ORNAMENT_OFFSET_OUTWARD,
    });
  }

  return placements;
}

export function createCliffOrnamentTexture(): THREE.CanvasTexture {
  const cell = 32;
  const slots = 4;
  const canvas = document.createElement('canvas');
  canvas.width = cell * slots;
  canvas.height = cell;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Slot 0: edge_lip (contiguous chiseled stone coping & moss rim at cliff top edge)
  {
    const ox = 0 * cell;
    for (let px = 0; px < cell; px++) {
      const drop = 6 + ((px * 3 + 2) % 4) + (px % 9 === 0 ? 2 : 0);
      ctx.fillStyle = PALETTE.stoneShadow;
      ctx.fillRect(ox + px, 0, 1, drop + 2);
      ctx.fillStyle = px % 5 === 0 ? PALETTE.stoneMid : PALETTE.stoneHighlight;
      ctx.fillRect(ox + px, 0, 1, Math.max(3, drop - 1));
      ctx.fillStyle = PALETTE.moss;
      ctx.fillRect(ox + px, 0, 1, 3 + (px % 4 === 0 ? 1 : 0));
    }
  }

  // Slot 1: hanging_vine (contiguous solid scalloped pixel-art ivy drapes — zero floating pixels)
  {
    const ox = 1 * cell;
    const drapeCols = [
      { cx: 5, halfW: 4, len: 18 },
      { cx: 14, halfW: 5, len: 25 },
      { cx: 24, halfW: 4, len: 20 },
    ];
    // Solid continuous leafy canopy rim at y = 0..5
    ctx.fillStyle = PALETTE.pitchBlackGreen;
    ctx.fillRect(ox, 0, cell, 7);
    ctx.fillStyle = PALETTE.forestGreen;
    ctx.fillRect(ox, 0, cell, 5);
    ctx.fillStyle = PALETTE.moss;
    ctx.fillRect(ox, 0, cell, 2);

    for (const d of drapeCols) {
      for (let py = 4; py < d.len; py++) {
        const t = (py - 4) / Math.max(1, d.len - 4);
        const w = Math.max(2, Math.round(d.halfW * 2 * (1 - t * 0.72)));
        const sx = ox + d.cx - Math.floor(w * 0.5);
        ctx.fillStyle = PALETTE.pitchBlackGreen;
        ctx.fillRect(sx - 1, py, w + 2, 2);
        ctx.fillStyle = PALETTE.forestGreen;
        ctx.fillRect(sx, py, w, 1);
        if (w >= 3 && py % 3 !== 0) {
          ctx.fillStyle = py < d.len * 0.55 ? PALETTE.emerald : PALETTE.moss;
          ctx.fillRect(sx + 1, py, w - 2, 1);
        }
      }
    }
  }

  // Slot 2: crystal_icicle (contiguous faceted glowing crystal / frost stalactites)
  {
    const ox = 2 * cell;
    const spikes = [
      { x: 2, w: 6, h: 17 },
      { x: 9, w: 7, h: 25 },
      { x: 17, w: 6, h: 20 },
      { x: 24, w: 6, h: 22 },
    ];
    ctx.fillStyle = PALETTE.stoneShadow;
    ctx.fillRect(ox, 0, cell, 5);
    ctx.fillStyle = PALETTE.frostedGlass;
    ctx.fillRect(ox, 0, cell, 3);
    for (const sp of spikes) {
      for (let row = 2; row < sp.h; row++) {
        const shrink = Math.floor(((row - 2) / sp.h) * (sp.w * 0.5));
        const curW = Math.max(2, sp.w - shrink * 2);
        ctx.fillStyle = PALETTE.cryptInk;
        ctx.fillRect(ox + sp.x + shrink - 1, row, curW + 2, 2);
        ctx.fillStyle = row < 7 ? PALETTE.iceCyan : row < sp.h - 4 ? PALETTE.kiCyan : PALETTE.frostedGlass;
        ctx.fillRect(ox + sp.x + shrink, row, curW, 1);
      }
    }
  }

  // Slot 3: cracked_trim (edge-worn chipped stone coping & mortar shadow)
  {
    const ox = 3 * cell;
    for (let px = 0; px < cell; px++) {
      const notch = px % 8 === 3 || px % 11 === 7 ? 2 : 0;
      const drop = Math.max(4, 9 - notch + (px % 4));
      ctx.fillStyle = PALETTE.cryptInk;
      ctx.fillRect(ox + px, 0, 1, drop + 2);
      ctx.fillStyle = px % 3 === 0 ? PALETTE.coldStone : PALETTE.stoneMid;
      ctx.fillRect(ox + px, 0, 1, drop);
      if (notch === 0) {
        ctx.fillStyle = PALETTE.boneGray;
        ctx.fillRect(ox + px, 0, 1, 2);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createCliffOrnamentMaterial(
  texture: THREE.CanvasTexture
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.45,
    roughness: 0.9,
    metalness: 0.04,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  attachCameraOcclusionCutout(mat, { minRelY: OCCLUSION_TERRAIN_MIN_REL_Y });
  return mat;
}

function getBiomeOrnamentTint(
  map: MapDef,
  kind: CliffOrnamentKind
): [number, number, number] {
  if (kind === 'crystal_icicle') {
    return map.biome === 'cave' || map.music === 'cave'
      ? [0.82, 0.70, 0.98]
      : [0.90, 0.96, 1.0];
  }
  if (kind === 'hanging_vine') {
    return map.biome === 'forest' ? [0.76, 0.87, 0.74] : [0.78, 0.86, 0.74];
  }
  if (map.biome === 'cave' || map.music === 'cave') {
    return [0.74, 0.70, 0.88];
  }
  if (map.biome === 'snow') {
    return [0.92, 0.96, 1.0];
  }
  return [0.84, 0.86, 0.82];
}

function selectAnchorOrnamentKind(
  map: MapDef,
  anchor: CliffOrnamentAnchor,
  r: number
): CliffOrnamentKind | null {
  if (r > 0.50) return null; // Leave ~50% of cliff rims open so sculpted 3D shoulders & strata breathe naturally

  if (map.biome === 'cave' || map.music === 'cave') {
    if (anchor.suitability.crystalIcicle && r < 0.24) return 'crystal_icicle';
    return anchor.suitability.crackedTrim ? 'cracked_trim' : null;
  }
  if (map.biome === 'snow' || anchor.topTile === 'snow') {
    if (anchor.suitability.crystalIcicle && r < 0.26) return 'crystal_icicle';
    return anchor.suitability.edgeLip ? 'edge_lip' : null;
  }
  if (map.biome === 'forest' || map.biome === 'meadow') {
    if (anchor.suitability.hangingVine && r < 0.20) return 'hanging_vine';
    if (anchor.suitability.crackedTrim && r >= 0.36) return 'cracked_trim';
    return anchor.suitability.edgeLip ? 'edge_lip' : null;
  }
  if (anchor.suitability.crackedTrim && r < 0.26) return 'cracked_trim';
  return anchor.suitability.edgeLip ? 'edge_lip' : null;
}

export function buildCliffOrnamentsMesh(
  map: MapDef,
  material?: THREE.Material
): THREE.Group | null {
  if (map.isInterior) return null;

  const contourAnalysis = analyzeTerrainContours(map);
  const anchors = extractRockyCliffOrnamentAnchors(map, contourAnalysis);
  if (anchors.length === 0) return null;

  const seed = map.decoration?.seed ?? 17;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertBase = 0;

  const slotStep = 1 / 4;
  const epsU = 0.002;
  const epsV = 0.008;

  const pushQuad3D = (
    bl: readonly [number, number, number],
    br: readonly [number, number, number],
    tr: readonly [number, number, number],
    tl: readonly [number, number, number],
    u0: number,
    u1: number,
    vBot: number,
    vTop: number,
    kind: CliffOrnamentKind,
    face: CliffDirection,
    tintJitter: number
  ) => {
    const e1x = br[0] - bl[0];
    const e1y = br[1] - bl[1];
    const e1z = br[2] - bl[2];
    const e2x = tl[0] - bl[0];
    const e2y = tl[1] - bl[1];
    const e2z = tl[2] - bl[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len <= 1e-6) return;
    nx /= len;
    ny /= len;
    nz /= len;

    const verts = [bl, br, tr, tl] as const;
    const [cr, cg, cb] = getBiomeOrnamentTint(map, kind);
    const dirMul =
      (face === 'south' ? 1.0 : face === 'east' ? 0.94 : face === 'west' ? 0.88 : 0.82) *
      tintJitter;

    for (let i = 0; i < 4; i++) {
      positions.push(verts[i][0], verts[i][1], verts[i][2]);
      normals.push(nx, ny, nz);
      colors.push(cr * dirMul, cg * dirMul, cb * dirMul);
    }
    uvs.push(u0, vBot, u1, vBot, u1, vTop, u0, vTop);
    indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase, vertBase + 2, vertBase + 3);
    vertBase += 4;
  };

  for (const anchor of anchors) {
    const qx = anchor.tileX * 31 + Math.round(anchor.ax * 100);
    const qz = anchor.tileZ * 37 + Math.round(anchor.az * 100);
    const r = deterministicHash(qx, qz, anchor.face, seed);
    const kind = selectAnchorOrnamentKind(map, anchor, r);
    if (!kind) continue;

    const r2 = deterministicHash(
      anchor.tileX * 19 + Math.round(anchor.bx * 100),
      anchor.tileZ * 23 + Math.round(anchor.bz * 100),
      anchor.face,
      seed + 79
    );

    const slot = ORNAMENT_SLOT_INDEX[kind];
    const slotU0 = slot * slotStep + epsU;
    const slotU1 = (slot + 1) * slotStep - epsU;
    const uFlip = r2 > 0.5;
    const u0 = uFlip ? slotU1 : slotU0;
    const u1 = uFlip ? slotU0 : slotU1;
    const tintJitter = 0.93 + r2 * 0.09;

    const widthFrac = 0.80 + r2 * 0.20;
    const shift = (1 - widthFrac) * (0.2 + r * 0.6);
    const tA = shift;
    const tB = shift + widthFrac;

    const hLen = Math.hypot(anchor.nx, anchor.nz);
    const hnx = hLen > 1e-5 ? anchor.nx / hLen : 0;
    const hnz = hLen > 1e-5 ? anchor.nz / hLen : 1;

    if (kind === 'hanging_vine' || kind === 'crystal_icicle') {
      // Hang vertically off the protruding 3D overhang lip crest in front of undercut rock
      const hangClearOut = anchor.isOverhang ? 0.024 : 0.032;
      const ax = anchor.ax + (anchor.bx - anchor.ax) * tA + hnx * hangClearOut;
      const az = anchor.az + (anchor.bz - anchor.az) * tA + hnz * hangClearOut;
      const bx = anchor.ax + (anchor.bx - anchor.ax) * tB + hnx * hangClearOut;
      const bz = anchor.az + (anchor.bz - anchor.az) * tB + hnz * hangClearOut;

      const yTopHang = anchor.isOverhang
        ? anchor.yTop * 0.35 + anchor.yLipBottom * 0.65
        : anchor.yTop;
      const rawHang = 0.32 + r2 * 0.24;
      const hangH = Math.min(anchor.maxHangHeight * 0.92, rawHang);
      if (hangH < 0.12) continue;

      const yBotHang = yTopHang - hangH;
      const vTop = 1 - epsV;
      const vBot = Math.max(epsV, 1 - Math.min(1, hangH / 0.60) + epsV);

      pushQuad3D(
        [ax, yBotHang, az],
        [bx, yBotHang, bz],
        [bx, yTopHang, bz],
        [ax, yTopHang, az],
        u0,
        u1,
        vBot,
        vTop,
        kind,
        anchor.face,
        tintJitter
      );
    } else {
      // Coping & cracked trim conform directly to the beveled 3D shoulder / outer lip face
      const axT = anchor.axRim + (anchor.bxRim - anchor.axRim) * tA + hnx * 0.015;
      const azT = anchor.azRim + (anchor.bzRim - anchor.azRim) * tA + hnz * 0.015;
      const bxT = anchor.axRim + (anchor.bxRim - anchor.axRim) * tB + hnx * 0.015;
      const bzT = anchor.azRim + (anchor.bzRim - anchor.azRim) * tB + hnz * 0.015;

      const axB = anchor.ax + (anchor.bx - anchor.ax) * tA + hnx * 0.022;
      const azB = anchor.az + (anchor.bz - anchor.az) * tA + hnz * 0.022;
      const bxB = anchor.ax + (anchor.bx - anchor.ax) * tB + hnx * 0.022;
      const bzB = anchor.az + (anchor.bz - anchor.az) * tB + hnz * 0.022;

      const yRim = anchor.yRimTop - 0.004;
      const trimDrop = Math.max(0.09, anchor.yRimTop - anchor.yLipBottom);
      const yBotTrim = yRim - Math.min(trimDrop, 0.16);
      const vTop = 1 - epsV;
      const vBot = Math.max(epsV, 1 - Math.min(1, trimDrop / 0.38) + epsV);

      pushQuad3D(
        [axB, yBotTrim, azB],
        [bxB, yBotTrim, bzB],
        [bxT, yRim, bzT],
        [axT, yRim, azT],
        u0,
        u1,
        vBot,
        vTop,
        kind,
        anchor.face,
        tintJitter
      );
    }
  }

  if (indices.length === 0) return null;

  const group = new THREE.Group();
  let ownedTex: THREE.CanvasTexture | null = null;
  let ownedMat: THREE.MeshStandardMaterial | null = null;
  let mat = material;
  if (!mat) {
    ownedTex = createCliffOrnamentTexture();
    ownedMat = createCliffOrnamentMaterial(ownedTex);
    mat = ownedMat;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = DIORAMA_RENDER_ORDER.CLIFF_ORNAMENT;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  group.add(mesh);

  if (ownedTex) group.userData.createdTexture = ownedTex;
  if (ownedMat) group.userData.createdMaterial = ownedMat;
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}
