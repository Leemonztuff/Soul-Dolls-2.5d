import * as THREE from 'three';
import { getTileWorldY } from '../domain/TerrainRules.ts';
import type {
  BuildingPlacement,
  BuildingVariant,
  MapDef,
} from '../domain/types.ts';
import type { RoofTextureKind } from '../gfx/AssetProvider.ts';
import type { TileAtlasKey } from '../gfx/ProceduralTiles.ts';
import {
  buildGeometryFromQuadBuilder,
  createQuadBuilder,
  pushColorBox,
  pushQuad,
  pushTiledBox,
  pushTiledQuad,
  pushTiledQuadKey,
  pushTriangle,
  type QuadBuilder,
} from './QuadGeometry.ts';

function getBuildingPalette(b: BuildingPlacement): {
  wall: TileAtlasKey;
  roof: TileAtlasKey;
  roofKind: RoofTextureKind;
  wallHeight: number;
  roofHeight: number;
} {
  let base: {
    wall: TileAtlasKey;
    roof: TileAtlasKey;
    roofKind: RoofTextureKind;
    wallHeight: number;
    roofHeight: number;
  };
  switch (b.kind) {
    case 'house_red':
      base = {
        wall: 'wall_plaster',
        roof: 'roof_red',
        roofKind: 'terracotta',
        wallHeight: 2.1,
        roofHeight: 1.25,
      };
      break;
    case 'house_blue':
      base = {
        wall: 'wall_brick',
        roof: 'roof_slate',
        roofKind: 'slate',
        wallHeight: 2.15,
        roofHeight: 1.25,
      };
      break;
    case 'lab':
      base = {
        wall: 'wall_vine_brick',
        roof: 'roof_patina',
        roofKind: 'patina',
        wallHeight: 2.35,
        roofHeight: 1.3,
      };
      break;
    case 'center':
      base = {
        wall: 'palace_tile',
        roof: 'roof_red',
        roofKind: 'terracotta',
        wallHeight: 2.25,
        roofHeight: 1.2,
      };
      break;
    case 'shop':
      base = {
        wall: 'wall_wood_gold',
        roof: 'roof_wood',
        roofKind: 'wood',
        wallHeight: 2.15,
        roofHeight: 1.15,
      };
      break;
    case 'gym':
      base = {
        wall: 'wall_castle',
        roof: 'roof_slate',
        roofKind: 'slate',
        wallHeight: 2.55,
        roofHeight: 1.35,
      };
      break;
    case 'arena_hall':
      base = {
        wall: 'wall_castle',
        roof: 'roof_blue',
        roofKind: 'indigo',
        wallHeight: 2.85,
        roofHeight: 1.45,
      };
      break;
    case 'workshop':
      base = {
        wall: 'wall_fieldstone',
        roof: 'roof_wood',
        roofKind: 'wood',
        wallHeight: 2.3,
        roofHeight: 1.35,
      };
      break;
  }

  if (b.wallStyle) {
    base.wall = b.wallStyle;
  }
  if (b.roofStyle) {
    base.roofKind = b.roofStyle;
    const roofMap: Record<RoofTextureKind, TileAtlasKey> = {
      terracotta: 'roof_red',
      slate: 'roof_slate',
      wood: 'roof_wood',
      patina: 'roof_patina',
      indigo: 'roof_blue',
    };
    base.roof = roofMap[b.roofStyle];
  }
  return base;
}

function getOrCreateWallBuilder(
  wallBuilders: Map<TileAtlasKey, QuadBuilder> | null,
  fallback: QuadBuilder,
  key: TileAtlasKey
): QuadBuilder {
  if (!wallBuilders) return fallback;
  let b = wallBuilders.get(key);
  if (!b) {
    b = createQuadBuilder();
    wallBuilders.set(key, b);
  }
  return b;
}

function getOrCreateRoofBuilder(
  roofBuilders: Map<RoofTextureKind, QuadBuilder> | null,
  fallback: QuadBuilder,
  kind: RoofTextureKind
): QuadBuilder {
  if (!roofBuilders) return fallback;
  let b = roofBuilders.get(kind);
  if (!b) {
    b = createQuadBuilder();
    roofBuilders.set(kind, b);
  }
  return b;
}

function pushWallBox(
  wallBuilders: Map<TileAtlasKey, QuadBuilder> | null,
  fallback: QuadBuilder,
  key: TileAtlasKey,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  shade = 1,
  tint: [number, number, number] = [1, 1, 1]
): void {
  if (wallBuilders) {
    const wqb = getOrCreateWallBuilder(wallBuilders, fallback, key);
    pushTiledBox(wqb, x0, x1, y0, y1, z0, z1, shade, tint);
  } else {
    const [r, g, b] = tint;
    const w = Math.max(1, Math.round(x1 - x0));
    const d = Math.max(1, Math.round(z1 - z0));
    const h = Math.max(1, Math.round(y1 - y0));
    pushTiledQuadKey(fallback, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], key, w, h, 0.96 * shade * r, 0.96 * shade * g, 0.96 * shade * b);
    pushTiledQuadKey(fallback, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], key, w, h, 0.80 * shade * r, 0.80 * shade * g, 0.80 * shade * b);
    pushTiledQuadKey(fallback, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], key, d, h, 0.88 * shade * r, 0.88 * shade * g, 0.88 * shade * b);
    pushTiledQuadKey(fallback, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], key, d, h, 0.84 * shade * r, 0.84 * shade * g, 0.84 * shade * b);
    pushTiledQuadKey(fallback, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], key, w, d, 1.02 * shade * r, 1.02 * shade * g, 1.02 * shade * b);
  }
}

function pushGabledRoof(
  qb: QuadBuilder,
  roofBuilders: Map<RoofTextureKind, QuadBuilder> | null,
  roofKind: RoofTextureKind,
  roofTile: TileAtlasKey,
  gableWallTile: TileAtlasKey,
  rx0: number,
  rx1: number,
  rz0: number,
  rz1: number,
  yTop: number,
  yPeak: number,
  tint: [number, number, number] = [1, 1, 1]
): void {
  const rMidZ = (rz0 + rz1) * 0.5;
  const [tr, tg, tb] = tint;
  if (roofBuilders) {
    const rqb = getOrCreateRoofBuilder(roofBuilders, qb, roofKind);
    const uRepeat = Math.max(1, Math.round((rx1 - rx0) / 2.2));
    pushTiledQuad(rqb, [rx0, yTop, rz1], [rx1, yTop, rz1], [rx1, yPeak, rMidZ], [rx0, yPeak, rMidZ], uRepeat, 1, tr, tg, tb);
    pushTiledQuad(rqb, [rx1, yTop, rz0], [rx0, yTop, rz0], [rx0, yPeak, rMidZ], [rx1, yPeak, rMidZ], uRepeat, 1, 0.88 * tr, 0.88 * tg, 0.88 * tb);
  } else {
    pushQuad(qb, [rx0, yTop, rz1], [rx1, yTop, rz1], [rx1, yPeak, rMidZ], [rx0, yPeak, rMidZ], roofTile, tr, tg, tb);
    pushQuad(qb, [rx1, yTop, rz0], [rx0, yTop, rz0], [rx0, yPeak, rMidZ], [rx1, yPeak, rMidZ], roofTile, 0.88 * tr, 0.88 * tg, 0.88 * tb);
  }
  pushTriangle(qb, [rx0, yTop, rz0], [rx0, yTop, rz1], [rx0, yPeak, rMidZ], gableWallTile, 0.9);
  pushTriangle(qb, [rx1, yTop, rz1], [rx1, yTop, rz0], [rx1, yPeak, rMidZ], gableWallTile, 0.95);
}

function pushDoorAndWindows(
  qb: QuadBuilder,
  x0: number,
  x1: number,
  groundY: number,
  zFront: number,
  width: number,
  doorX = (x0 + x1) * 0.5,
  withShutters = false,
  shutterColor: [number, number, number] = [0.22, 0.36, 0.54]
): void {
  const doorW = 0.86;
  const doorH = 1.28;
  pushQuad(
    qb,
    [doorX - doorW * 0.5, groundY, zFront],
    [doorX + doorW * 0.5, groundY, zFront],
    [doorX + doorW * 0.5, groundY + doorH, zFront],
    [doorX - doorW * 0.5, groundY + doorH, zFront],
    'door',
    1.0
  );

  if (width >= 3) {
    const winSize = 0.72;
    const wy0 = groundY + 0.82;
    const wy1 = wy0 + winSize;
    const positions = [x0 + 0.28, x1 - 0.28 - winSize];
    for (const wx0 of positions) {
      if (Math.abs(wx0 + winSize * 0.5 - doorX) < 0.72) continue;
      pushQuad(
        qb,
        [wx0, wy0, zFront],
        [wx0 + winSize, wy0, zFront],
        [wx0 + winSize, wy1, zFront],
        [wx0, wy1, zFront],
        'window',
        1.0
      );
      if (withShutters) {
        pushColorBox(qb, wx0 - 0.14, wx0 - 0.01, wy0, wy1, zFront - 0.02, zFront + 0.03, ...shutterColor);
        pushColorBox(qb, wx0 + winSize + 0.01, wx0 + winSize + 0.14, wy0, wy1, zFront - 0.02, zFront + 0.03, ...shutterColor);
      }
    }
  }
}

function resolveHouseVariant(b: BuildingPlacement): BuildingVariant {
  if (b.variant) return b.variant;
  const variants: readonly BuildingVariant[] = ['porch_cabin', 'manor_dormer', 'l_annex'];
  return variants[Math.abs(b.x + b.z) % variants.length];
}

function addHouseBuilding(
  qb: QuadBuilder,
  wallBuilders: Map<TileAtlasKey, QuadBuilder> | null,
  roofBuilders: Map<RoofTextureKind, QuadBuilder> | null,
  metalQb: QuadBuilder,
  b: BuildingPlacement,
  groundY: number
): void {
  const pal = getBuildingPalette(b);
  const variant = resolveHouseVariant(b);
  const x0 = b.x - 0.5;
  const x1 = b.x + b.width - 0.5;
  const z0 = b.z - 0.5;
  const z1 = b.z + b.depth - 0.5;
  const midX = (x0 + x1) * 0.5;

  if (variant === 'l_annex' && b.width >= 3) {
    // Primary taller wing on left 65% + lower garden annex on right 35%
    const splitX = x0 + (x1 - x0) * 0.64;
    const mainYTop = groundY + pal.wallHeight + 0.35;
    const mainYPeak = mainYTop + pal.roofHeight;
    const annexYTop = groundY + 1.55;
    const annexYPeak = annexYTop + 0.72;

    // Stone plinth across full footprint
    pushWallBox(wallBuilders, qb, 'wall_fieldstone', x0 - 0.04, x1 + 0.04, groundY - 0.62, groundY + 0.24, z0 - 0.04, z1 + 0.04, 0.94);
    // Primary wing
    pushWallBox(wallBuilders, qb, pal.wall, x0, splitX, groundY + 0.24, mainYTop, z0, z1, 1.0);
    pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 - 0.2, splitX + 0.16, z0 - 0.2, z1 + 0.2, mainYTop, mainYPeak);
    // Side annex
    pushWallBox(wallBuilders, qb, 'wall_plaster', splitX - 0.04, x1, groundY + 0.24, annexYTop, z0 + 0.25, z1 - 0.05, 0.97);
    pushGabledRoof(qb, roofBuilders, 'wood', 'roof_wood', 'wall_plaster', splitX - 0.08, x1 + 0.18, z0 + 0.05, z1 + 0.14, annexYTop, annexYPeak);

    // Front door centered on footprint (matches floor(width/2) warp tile) + annex window + flower planter
    pushDoorAndWindows(qb, x0, splitX, groundY, z1 + 0.02, b.width, midX, false);
    const awx = (splitX + x1) * 0.5;
    pushQuad(qb, [awx - 0.3, groundY + 0.62, z1 - 0.03], [awx + 0.3, groundY + 0.62, z1 - 0.03], [awx + 0.3, groundY + 1.2, z1 - 0.03], [awx - 0.3, groundY + 1.2, z1 - 0.03], 'window', 1.0);
    pushColorBox(qb, awx - 0.42, awx + 0.42, groundY + 0.38, groundY + 0.56, z1 - 0.03, z1 + 0.14, 0.46, 0.3, 0.18);
    pushColorBox(qb, awx - 0.38, awx + 0.38, groundY + 0.56, groundY + 0.65, z1 - 0.01, z1 + 0.12, 0.28, 0.65, 0.32);
    // Entry stone step + brass lantern by door
    pushWallBox(wallBuilders, qb, 'wall_fieldstone', midX - 0.6, midX + 0.6, groundY - 0.05, groundY + 0.12, z1, z1 + 0.36, 1.02);
    pushColorBox(metalQb, midX - 0.66, midX - 0.54, groundY + 1.0, groundY + 1.32, z1, z1 + 0.14, 0.85, 0.72, 0.32);
    return;
  }

  if (variant === 'manor_dormer') {
    const yBot = groundY - 0.62;
    const yTop = groundY + pal.wallHeight + 0.28;
    const yPeak = yTop + pal.roofHeight + 0.18;

    pushWallBox(wallBuilders, qb, 'wall_fieldstone', x0 - 0.04, x1 + 0.04, yBot, groundY + 0.36, z0 - 0.04, z1 + 0.04, 0.94);
    pushWallBox(wallBuilders, qb, pal.wall, x0, x1, groundY + 0.36, yTop, z0, z1, 1.0);
    pushDoorAndWindows(qb, x0, x1, groundY, z1 + 0.02, b.width, midX, true, b.kind === 'house_red' ? [0.55, 0.24, 0.2] : [0.22, 0.34, 0.52]);
    pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 - 0.24, x1 + 0.24, z0 - 0.24, z1 + 0.24, yTop, yPeak);

    // Raised front dormer gable with upper attic window
    const dmW = 0.68;
    const dmZ0 = (z0 + z1) * 0.5 - 0.1;
    const dmZ1 = z1 - 0.02;
    const dmY0 = yTop + 0.08;
    const dmY1 = yTop + 0.82;
    pushWallBox(wallBuilders, qb, pal.wall, midX - dmW, midX + dmW, dmY0, dmY1, dmZ0, dmZ1, 1.02);
    pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, midX - dmW - 0.12, midX + dmW + 0.12, dmZ0, dmZ1 + 0.14, dmY1, dmY1 + 0.45);
    pushQuad(qb, [midX - 0.28, dmY0 + 0.14, dmZ1 + 0.02], [midX + 0.28, dmY0 + 0.14, dmZ1 + 0.02], [midX + 0.28, dmY1 - 0.08, dmZ1 + 0.02], [midX - 0.28, dmY1 - 0.08, dmZ1 + 0.02], 'window', 1.0);

    // Side stone chimney + entry stone sill
    pushWallBox(wallBuilders, qb, 'wall_fieldstone', x1 - 0.65, x1 - 0.18, yTop - 0.1, yPeak + 0.45, z0 + 0.25, z0 + 0.72, 0.92);
    pushColorBox(metalQb, x1 - 0.7, x1 - 0.13, yPeak + 0.45, yPeak + 0.56, z0 + 0.2, z0 + 0.77, 0.36, 0.38, 0.42);
    pushWallBox(wallBuilders, qb, 'wall_fieldstone', midX - 0.65, midX + 0.65, groundY - 0.05, groundY + 0.12, z1, z1 + 0.32, 1.04);
    return;
  }

  // Default: 'porch_cabin'
  const yBot = groundY - 0.62;
  const yTop = groundY + pal.wallHeight;
  const yPeak = yTop + pal.roofHeight;
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', x0 - 0.03, x1 + 0.03, yBot, groundY + 0.22, z0 - 0.03, z1 + 0.03, 0.94);
  pushWallBox(wallBuilders, qb, pal.wall, x0, x1, groundY + 0.22, yTop, z0, z1, 1.0);
  pushDoorAndWindows(qb, x0, x1, groundY, z1 + 0.02, b.width, midX, false);
  pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 - 0.22, x1 + 0.22, z0 - 0.22, z1 + 0.22, yTop, yPeak);

  // Extended porch roof overhang on timber pillars + porch step + window planter boxes
  const porchZ1 = z1 + 0.48;
  pushWallBox(wallBuilders, qb, 'wall_wood_gold', x0 + 0.08, x1 - 0.08, groundY + 1.46, groundY + 1.66, z1 - 0.02, porchZ1, 1.0);
  pushColorBox(qb, x0 + 0.16, x0 + 0.3, groundY, groundY + 1.48, porchZ1 - 0.18, porchZ1 - 0.04, 0.48, 0.31, 0.18);
  pushColorBox(qb, x1 - 0.3, x1 - 0.16, groundY, groundY + 1.48, porchZ1 - 0.18, porchZ1 - 0.04, 0.48, 0.31, 0.18);
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', midX - 0.7, midX + 0.7, groundY - 0.05, groundY + 0.1, z1, porchZ1 - 0.04, 1.02);

  if (b.width >= 3) {
    const planters = [x0 + 0.24, x1 - 0.98];
    for (const px0 of planters) {
      if (Math.abs(px0 + 0.36 - midX) < 0.72) continue;
      pushColorBox(qb, px0, px0 + 0.74, groundY + 0.56, groundY + 0.76, z1, z1 + 0.18, 0.44, 0.28, 0.17);
      pushColorBox(qb, px0 + 0.04, px0 + 0.7, groundY + 0.76, groundY + 0.86, z1 + 0.02, z1 + 0.16, 0.26, 0.68, 0.32);
    }
  }
}

function addCenterBuilding(
  qb: QuadBuilder,
  wallBuilders: Map<TileAtlasKey, QuadBuilder> | null,
  roofBuilders: Map<RoofTextureKind, QuadBuilder> | null,
  metalQb: QuadBuilder,
  emissiveQb: QuadBuilder,
  b: BuildingPlacement,
  groundY: number
): void {
  const pal = getBuildingPalette(b);
  const x0 = b.x - 0.5;
  const x1 = b.x + b.width - 0.5;
  const z0 = b.z - 0.5;
  const z1 = b.z + b.depth - 0.5;
  const midX = (x0 + x1) * 0.5;

  const yBot = groundY - 0.65;
  const yTop = groundY + pal.wallHeight;
  const yMidRoof = yTop + 0.75;
  const yPeak = yMidRoof + 0.65;

  // Stone plinth + cream palace walls
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', x0 - 0.05, x1 + 0.05, yBot, groundY + 0.32, z0 - 0.05, z1 + 0.05, 0.96);
  pushWallBox(wallBuilders, qb, pal.wall, x0, x1, groundY + 0.32, yTop, z0, z1, 1.0);
  pushDoorAndWindows(qb, x0, x1, groundY, z1 + 0.02, b.width, midX, false);

  // Two-tier hipped terracotta roof (lower skirt + upper ridge cap)
  pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 - 0.26, x1 + 0.26, z0 - 0.24, z1 + 0.24, yTop, yMidRoof);
  pushWallBox(wallBuilders, qb, 'palace_tile', x0 + 0.55, x1 - 0.55, yMidRoof - 0.15, yMidRoof + 0.25, z0 + 0.65, z1 - 0.65, 1.04);
  pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 + 0.45, x1 - 0.45, z0 + 0.55, z1 - 0.55, yMidRoof + 0.22, yPeak);

  // Projecting front marquee canopy + HDR Ki cross/heart emblem
  const mqZ1 = z1 + 0.54;
  pushColorBox(metalQb, midX - 1.15, midX + 1.15, groundY + 1.48, groundY + 1.72, z1 - 0.02, mqZ1, 0.88, 0.84, 0.76);
  pushColorBox(metalQb, midX - 0.54, midX + 0.54, groundY + 1.66, groundY + 2.48, z1 + 0.08, mqZ1 - 0.06, 0.88, 0.74, 0.34);
  // HDR glowing Ki cross emblem (toneMapped: false)
  pushColorBox(emissiveQb, midX - 0.34, midX + 0.34, groundY + 1.98, groundY + 2.16, mqZ1 - 0.04, mqZ1 + 0.03, 1.25, 0.32, 0.48);
  pushColorBox(emissiveQb, midX - 0.1, midX + 0.1, groundY + 1.78, groundY + 2.38, mqZ1 - 0.04, mqZ1 + 0.03, 1.25, 0.32, 0.48);
  pushColorBox(emissiveQb, midX - 0.06, midX + 0.06, groundY + 2.02, groundY + 2.12, mqZ1 - 0.02, mqZ1 + 0.05, 1.38, 1.18, 0.92);

  // Front stone step + flanking medical lanterns
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', midX - 0.8, midX + 0.8, groundY - 0.05, groundY + 0.1, z1, z1 + 0.38, 1.05);
  pushColorBox(emissiveQb, midX - 0.92, midX - 0.76, groundY + 1.15, groundY + 1.42, z1 + 0.05, z1 + 0.22, 0.45, 1.22, 1.05);
  pushColorBox(emissiveQb, midX + 0.76, midX + 0.92, groundY + 1.15, groundY + 1.42, z1 + 0.05, z1 + 0.22, 0.45, 1.22, 1.05);
}

function addShopBuilding(
  qb: QuadBuilder,
  wallBuilders: Map<TileAtlasKey, QuadBuilder> | null,
  roofBuilders: Map<RoofTextureKind, QuadBuilder> | null,
  metalQb: QuadBuilder,
  emissiveQb: QuadBuilder,
  b: BuildingPlacement,
  groundY: number
): void {
  const pal = getBuildingPalette(b);
  const x0 = b.x - 0.5;
  const x1 = b.x + b.width - 0.5;
  const z0 = b.z - 0.5;
  const z1 = b.z + b.depth - 0.5;
  const midX = (x0 + x1) * 0.5;

  const yBot = groundY - 0.65;
  const yTop = groundY + pal.wallHeight;
  const yPeak = yTop + pal.roofHeight;

  pushWallBox(wallBuilders, qb, 'wall_fieldstone', x0 - 0.04, x1 + 0.04, yBot, groundY + 0.28, z0 - 0.04, z1 + 0.04, 0.94);
  pushWallBox(wallBuilders, qb, pal.wall, x0, x1, groundY + 0.28, yTop, z0, z1, 1.0);
  pushDoorAndWindows(qb, x0, x1, groundY, z1 + 0.02, b.width, midX, false);
  pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 - 0.22, x1 + 0.22, z0 - 0.22, z1 + 0.22, yTop, yPeak);

  // Angled striped market awning canopy across front facade
  const awSpan = b.width - 0.35;
  const awX0 = midX - awSpan * 0.5;
  const stripes = 7;
  const stripeW = awSpan / stripes;
  const awYHi = groundY + 1.68;
  const awYLo = groundY + 1.32;
  const awZ0 = z1;
  const awZ1 = z1 + 0.62;
  for (let i = 0; i < stripes; i++) {
    const sx0 = awX0 + i * stripeW;
    const sx1 = sx0 + stripeW;
    const isAccent = i % 2 === 0;
    const tr = isAccent ? 0.85 : 0.96;
    const tg = isAccent ? 0.25 : 0.92;
    const tb = isAccent ? 0.22 : 0.78;
    pushColorBox(qb, sx0, sx1, awYLo + 0.08, awYHi, awZ0, awZ1 - 0.14, tr, tg, tb);
    pushColorBox(qb, sx0, sx1, awYLo - 0.06, awYLo + 0.1, awZ1 - 0.14, awZ1, tr * 0.92, tg * 0.92, tb * 0.92);
  }

  // Illuminated showcase counter / window lights + brass brackets
  pushColorBox(emissiveQb, x0 + 0.34, x0 + 0.96, groundY + 0.88, groundY + 1.32, z1 + 0.03, z1 + 0.08, 1.4, 1.2, 0.72);
  pushColorBox(emissiveQb, x1 - 0.96, x1 - 0.34, groundY + 0.88, groundY + 1.32, z1 + 0.03, z1 + 0.08, 1.4, 1.2, 0.72);
  pushColorBox(qb, x0 + 0.26, x0 + 1.04, groundY + 0.38, groundY + 0.74, z1, z1 + 0.24, 0.45, 0.3, 0.18);
  pushColorBox(qb, x1 - 1.04, x1 - 0.26, groundY + 0.38, groundY + 0.74, z1, z1 + 0.24, 0.45, 0.3, 0.18);

  // Hanging brass-mounted shop sign on right front corner
  pushColorBox(metalQb, x1 - 0.04, x1 + 0.46, groundY + 1.82, groundY + 1.9, z1 - 0.3, z1 - 0.2, 0.78, 0.62, 0.24);
  pushColorBox(metalQb, x1 + 0.06, x1 + 0.44, groundY + 1.42, groundY + 1.82, z1 - 0.28, z1 - 0.22, 0.86, 0.72, 0.32);
  pushColorBox(emissiveQb, x1 + 0.14, x1 + 0.36, groundY + 1.5, groundY + 1.74, z1 - 0.3, z1 - 0.2, 1.45, 1.15, 0.35);
}

function addGymBuilding(
  qb: QuadBuilder,
  wallBuilders: Map<TileAtlasKey, QuadBuilder> | null,
  roofBuilders: Map<RoofTextureKind, QuadBuilder> | null,
  metalQb: QuadBuilder,
  emissiveQb: QuadBuilder,
  b: BuildingPlacement,
  groundY: number
): void {
  const pal = getBuildingPalette(b);
  const x0 = b.x - 0.5;
  const x1 = b.x + b.width - 0.5;
  const z0 = b.z - 0.5;
  const z1 = b.z + b.depth - 0.5;
  const midX = (x0 + x1) * 0.5;

  const yBot = groundY - 0.65;
  const yTop = groundY + pal.wallHeight;
  const yPeak = yTop + pal.roofHeight;

  // Stone plinth + castle stone facade
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', x0 - 0.08, x1 + 0.08, yBot, groundY + 0.38, z0 - 0.06, z1 + 0.08, 0.94);
  pushWallBox(wallBuilders, qb, pal.wall, x0, x1, groundY + 0.38, yTop, z0, z1, 1.0);
  pushDoorAndWindows(qb, x0, x1, groundY, z1 + 0.02, b.width, midX, false);
  pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 - 0.26, x1 + 0.26, z0 - 0.24, z1 + 0.24, yTop, yPeak);

  // Broad front steps
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', midX - 1.35, midX + 1.35, groundY - 0.06, groundY + 0.14, z1, z1 + 0.44, 1.04);
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', midX - 1.05, midX + 1.05, groundY + 0.14, groundY + 0.26, z1, z1 + 0.24, 1.08);

  // 4 Fluted Front Columns with metallic brass capitals
  const colPositions = [x0 + 0.32, midX - 0.72, midX + 0.72, x1 - 0.32];
  for (const cx of colPositions) {
    pushWallBox(wallBuilders, qb, 'palace_tile', cx - 0.15, cx + 0.15, groundY + 0.14, yTop - 0.18, z1 + 0.04, z1 + 0.34, 1.02);
    pushColorBox(metalQb, cx - 0.2, cx + 0.2, yTop - 0.2, yTop + 0.02, z1 + 0.02, z1 + 0.38, 0.85, 0.72, 0.32);
  }

  // Triangular front portico pediment + HDR resonance crest
  const pedX0 = midX - 1.75;
  const pedX1 = midX + 1.75;
  const pedZ = z1 + 0.42;
  const pedY0 = yTop - 0.02;
  const pedY1 = yTop + 1.15;
  pushColorBox(metalQb, pedX0, pedX1, pedY0 - 0.1, pedY0 + 0.08, z1, pedZ, 0.82, 0.7, 0.32);
  pushTriangle(qb, [pedX0, pedY0 + 0.08, pedZ], [pedX1, pedY0 + 0.08, pedZ], [midX, pedY1, pedZ], 'wall_castle', 1.05);
  // HDR golden resonance emblem
  pushColorBox(emissiveQb, midX - 0.26, midX + 0.26, pedY0 + 0.24, pedY0 + 0.72, pedZ - 0.04, pedZ + 0.06, 1.32, 1.02, 0.35);
  pushColorBox(emissiveQb, midX - 0.1, midX + 0.1, pedY0 + 0.36, pedY0 + 0.84, pedZ - 0.02, pedZ + 0.08, 0.48, 1.18, 1.35);

  // Flanking heraldic banners
  pushColorBox(qb, x0 + 0.62, x0 + 0.96, groundY + 0.7, yTop - 0.2, z1 + 0.04, z1 + 0.14, 0.18, 0.46, 0.76);
  pushColorBox(qb, x1 - 0.96, x1 - 0.62, groundY + 0.7, yTop - 0.2, z1 + 0.04, z1 + 0.14, 0.18, 0.46, 0.76);
}

function addArenaHallBuilding(
  qb: QuadBuilder,
  wallBuilders: Map<TileAtlasKey, QuadBuilder> | null,
  roofBuilders: Map<RoofTextureKind, QuadBuilder> | null,
  metalQb: QuadBuilder,
  emissiveQb: QuadBuilder,
  b: BuildingPlacement,
  groundY: number
): void {
  const pal = getBuildingPalette(b);
  const x0 = b.x - 0.5;
  const x1 = b.x + b.width - 0.5;
  const z0 = b.z - 0.5;
  const z1 = b.z + b.depth - 0.5;
  const midX = (x0 + x1) * 0.5;

  const yBot = groundY - 0.7;
  const tier1Top = groundY + pal.wallHeight;
  const tier2Bot = tier1Top - 0.1;
  const tier2Top = tier1Top + 1.35;
  const yPeak = tier2Top + pal.roofHeight;

  // Monumental plinth + lower hall
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', x0 - 0.12, x1 + 0.12, yBot, groundY + 0.45, z0 - 0.1, z1 + 0.12, 0.96);
  pushWallBox(wallBuilders, qb, pal.wall, x0, x1, groundY + 0.45, tier1Top, z0, z1, 1.0);
  pushDoorAndWindows(qb, x0, x1, groundY, z1 + 0.02, b.width, midX, false);

  // Royal colonnade & gold-capped pilasters across front
  const pilasterCount = Math.max(4, Math.min(6, Math.round(b.width)));
  for (let i = 0; i < pilasterCount; i++) {
    const t = i / (pilasterCount - 1);
    const px = x0 + 0.3 + t * (x1 - x0 - 0.6);
    if (Math.abs(px - midX) < 0.52) continue;
    pushWallBox(wallBuilders, qb, 'wall_iron', px - 0.16, px + 0.16, groundY + 0.35, tier1Top - 0.1, z1 + 0.02, z1 + 0.28, 0.98);
    pushColorBox(metalQb, px - 0.22, px + 0.22, tier1Top - 0.12, tier1Top + 0.1, z1, z1 + 0.34, 0.9, 0.74, 0.28);
  }

  // Broad ceremonial staircase
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', midX - 1.65, midX + 1.65, groundY - 0.06, groundY + 0.18, z1, z1 + 0.52, 1.04);
  pushWallBox(wallBuilders, qb, 'wall_fieldstone', midX - 1.25, midX + 1.25, groundY + 0.18, groundY + 0.32, z1, z1 + 0.28, 1.08);

  // First-tier indigo eave skirt + recessed Second-tier royal sanctuary + roof + golden finial
  pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 - 0.28, x1 + 0.28, z0 - 0.24, z1 + 0.28, tier1Top, tier1Top + 0.68);
  const insetX = Math.min(1.1, (x1 - x0) * 0.2);
  const insetZ = Math.min(0.85, (z1 - z0) * 0.2);
  pushWallBox(wallBuilders, qb, 'wall_castle', x0 + insetX, x1 - insetX, tier2Bot, tier2Top, z0 + insetZ, z1 - insetZ, 1.04);
  pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, 'wall_castle', x0 + insetX - 0.22, x1 - insetX + 0.22, z0 + insetZ - 0.2, z1 - insetZ + 0.2, tier2Top, yPeak);
  pushColorBox(metalQb, x0 + insetX - 0.12, x1 - insetX + 0.12, yPeak - 0.04, yPeak + 0.16, (z0 + z1) * 0.5 - 0.1, (z0 + z1) * 0.5 + 0.1, 0.94, 0.78, 0.3);
  pushColorBox(metalQb, midX - 0.34, midX + 0.34, tier1Top + 0.38, tier1Top + 1.12, z1 - insetZ - 0.02, z1 - insetZ + 0.08, 0.9, 0.74, 0.28);
  pushColorBox(emissiveQb, midX - 0.22, midX + 0.22, tier1Top + 0.48, tier1Top + 1.0, z1 - insetZ + 0.04, z1 - insetZ + 0.13, 0.46, 1.14, 1.38);

  // 2 Flanking HDR Ki crystal braziers at entrance
  for (const bx of [midX - 1.78, midX + 1.78]) {
    pushWallBox(wallBuilders, qb, 'wall_fieldstone', bx - 0.24, bx + 0.24, groundY - 0.05, groundY + 0.72, z1 + 0.1, z1 + 0.56, 0.98);
    pushColorBox(metalQb, bx - 0.28, bx + 0.28, groundY + 0.72, groundY + 0.88, z1 + 0.06, z1 + 0.6, 0.85, 0.68, 0.28);
    pushColorBox(emissiveQb, bx - 0.15, bx + 0.15, groundY + 0.88, groundY + 1.38, z1 + 0.18, z1 + 0.48, 0.46, 1.15, 1.38);
  }
}

function addLabOrWorkshopBuilding(
  qb: QuadBuilder,
  wallBuilders: Map<TileAtlasKey, QuadBuilder> | null,
  roofBuilders: Map<RoofTextureKind, QuadBuilder> | null,
  metalQb: QuadBuilder,
  emissiveQb: QuadBuilder,
  b: BuildingPlacement,
  groundY: number
): void {
  const pal = getBuildingPalette(b);
  const x0 = b.x - 0.5;
  const x1 = b.x + b.width - 0.5;
  const z0 = b.z - 0.5;
  const z1 = b.z + b.depth - 0.5;
  const midX = (x0 + x1) * 0.5;

  const yBot = groundY - 0.62;
  const yTop = groundY + pal.wallHeight;
  const yPeak = yTop + pal.roofHeight;

  pushWallBox(wallBuilders, qb, 'wall_fieldstone', x0 - 0.04, x1 + 0.04, yBot, groundY + 0.26, z0 - 0.04, z1 + 0.04, 0.94);
  pushWallBox(wallBuilders, qb, pal.wall, x0, x1, groundY + 0.26, yTop, z0, z1, 1.0);
  pushDoorAndWindows(qb, x0, x1, groundY, z1 + 0.02, b.width, midX, false);
  pushGabledRoof(qb, roofBuilders, pal.roofKind, pal.roof, pal.wall, x0 - 0.24, x1 + 0.24, z0 - 0.22, z1 + 0.22, yTop, yPeak);

  if (b.kind === 'lab') {
    // Research skylight cupola + glowing cyan transom over entrance
    pushWallBox(wallBuilders, qb, 'wall_plaster', midX - 0.75, midX + 0.75, yTop + 0.2, yPeak + 0.35, (z0 + z1) * 0.5 - 0.55, (z0 + z1) * 0.5 + 0.55, 1.0);
    pushGabledRoof(qb, roofBuilders, 'patina', 'roof_patina', 'wall_plaster', midX - 0.85, midX + 0.85, (z0 + z1) * 0.5 - 0.65, (z0 + z1) * 0.5 + 0.65, yPeak + 0.35, yPeak + 0.78);
    pushColorBox(metalQb, midX - 0.78, midX + 0.78, groundY + 1.38, groundY + 1.56, z1, z1 + 0.32, 0.55, 0.62, 0.66);
    pushColorBox(emissiveQb, midX - 0.45, midX + 0.45, groundY + 1.56, groundY + 1.84, z1 + 0.02, z1 + 0.14, 0.6, 1.48, 1.75);
  } else {
    // Workshop: stone forge chimney + iron cap + warm forge emblem awning
    const cx0 = x1 - 0.85;
    const cx1 = x1 - 0.25;
    const cz0 = z0 + 0.25;
    const cz1 = z0 + 0.85;
    const cyTop = yPeak + 0.6;
    pushWallBox(wallBuilders, qb, 'wall_castle', cx0, cx1, yTop - 0.1, cyTop, cz0, cz1, 0.95);
    pushColorBox(metalQb, cx0 - 0.08, cx1 + 0.08, cyTop, cyTop + 0.16, cz0 - 0.08, cz1 + 0.08, 0.32, 0.34, 0.38);
    pushColorBox(metalQb, midX - 0.7, midX + 0.7, groundY + 1.4, groundY + 1.88, z1, z1 + 0.24, 0.82, 0.66, 0.26);
    pushColorBox(emissiveQb, midX - 0.45, midX + 0.45, groundY + 1.5, groundY + 1.78, z1 + 0.16, z1 + 0.28, 1.6, 0.92, 0.35);
  }
}

export function buildBuildingsMesh(
  map: MapDef,
  atlasMaterial: THREE.Material,
  getRoofTexture?: (kind: RoofTextureKind) => THREE.CanvasTexture,
  getRoofNormalTexture?: (kind: RoofTextureKind) => THREE.CanvasTexture,
  getWallTexture?: (key: TileAtlasKey) => THREE.CanvasTexture,
  getWallNormalTexture?: (key: TileAtlasKey) => THREE.CanvasTexture
): THREE.Group | null {
  if (map.buildings.length === 0) return null;

  const qb = createQuadBuilder();
  const metalQb = createQuadBuilder();
  const emissiveQb = createQuadBuilder();
  const wallBuilders = getWallTexture ? new Map<TileAtlasKey, QuadBuilder>() : null;
  const roofBuilders = getRoofTexture ? new Map<RoofTextureKind, QuadBuilder>() : null;

  for (const b of map.buildings) {
    const cx = Math.floor(b.x + b.width * 0.5);
    const cz = Math.floor(b.z + b.depth * 0.5);
    const groundY = getTileWorldY(map, cx, cz);

    switch (b.kind) {
      case 'house_red':
      case 'house_blue':
        addHouseBuilding(qb, wallBuilders, roofBuilders, metalQb, b, groundY);
        break;
      case 'center':
        addCenterBuilding(qb, wallBuilders, roofBuilders, metalQb, emissiveQb, b, groundY);
        break;
      case 'shop':
        addShopBuilding(qb, wallBuilders, roofBuilders, metalQb, emissiveQb, b, groundY);
        break;
      case 'gym':
        addGymBuilding(qb, wallBuilders, roofBuilders, metalQb, emissiveQb, b, groundY);
        break;
      case 'arena_hall':
        addArenaHallBuilding(qb, wallBuilders, roofBuilders, metalQb, emissiveQb, b, groundY);
        break;
      case 'lab':
      case 'workshop':
        addLabOrWorkshopBuilding(qb, wallBuilders, roofBuilders, metalQb, emissiveQb, b, groundY);
        break;
    }
  }

  const group = new THREE.Group();

  if (wallBuilders && getWallTexture) {
    for (const [wallKey, wqb] of wallBuilders.entries()) {
      if (wqb.indices.length === 0) continue;
      const wallMat = new THREE.MeshStandardMaterial({
        map: getWallTexture(wallKey),
        normalMap: getWallNormalTexture ? getWallNormalTexture(wallKey) : null,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughness: 0.86,
        metalness: 0.05,
        vertexColors: true,
      });
      const wallMesh = new THREE.Mesh(buildGeometryFromQuadBuilder(wqb), wallMat);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      wallMesh.matrixAutoUpdate = false;
      wallMesh.updateMatrix();
      group.add(wallMesh);
    }
  }

  if (qb.indices.length > 0) {
    const miscMesh = new THREE.Mesh(buildGeometryFromQuadBuilder(qb), atlasMaterial);
    miscMesh.castShadow = true;
    miscMesh.receiveShadow = true;
    miscMesh.matrixAutoUpdate = false;
    miscMesh.updateMatrix();
    group.add(miscMesh);
  }

  if (metalQb.indices.length > 0) {
    const metalMat = new THREE.MeshPhongMaterial({
      shininess: 90,
      specular: 0xd0dce8,
      vertexColors: true,
    });
    const metalMesh = new THREE.Mesh(buildGeometryFromQuadBuilder(metalQb), metalMat);
    metalMesh.castShadow = true;
    metalMesh.receiveShadow = true;
    metalMesh.matrixAutoUpdate = false;
    metalMesh.updateMatrix();
    group.add(metalMesh);
  }

  if (emissiveQb.indices.length > 0) {
    const emissiveMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
    });
    const emissiveMesh = new THREE.Mesh(buildGeometryFromQuadBuilder(emissiveQb), emissiveMat);
    emissiveMesh.castShadow = true;
    emissiveMesh.receiveShadow = true;
    emissiveMesh.matrixAutoUpdate = false;
    emissiveMesh.updateMatrix();
    group.add(emissiveMesh);
  }

  if (roofBuilders && getRoofTexture) {
    for (const [kind, rqb] of roofBuilders.entries()) {
      if (rqb.indices.length === 0) continue;
      const roofMat = new THREE.MeshStandardMaterial({
        map: getRoofTexture(kind),
        normalMap: getRoofNormalTexture ? getRoofNormalTexture(kind) : null,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughness: 0.9,
        metalness: 0.04,
        vertexColors: true,
      });
      const roofMesh = new THREE.Mesh(buildGeometryFromQuadBuilder(rqb), roofMat);
      roofMesh.castShadow = true;
      roofMesh.receiveShadow = true;
      roofMesh.matrixAutoUpdate = false;
      roofMesh.updateMatrix();
      group.add(roofMesh);
    }
  }

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}

function getInteriorWallKey(mapId: string): TileAtlasKey {
  if (mapId.startsWith('centro_')) return 'palace_tile';
  if (mapId.startsWith('tienda_')) return 'wall_wood_gold';
  if (mapId === 'gimnasio_bruma' || mapId === 'liga_cumbre') return 'wall_castle';
  if (mapId === 'taller_origen') return 'wall_brick';
  return 'wall_plaster';
}

/**
 * Builds crisp 3D interior walls on solid '#' tiles for indoor house/service maps.
 */
export function buildInteriorWallsMesh(
  map: MapDef,
  atlasMaterial: THREE.Material,
  getWallTexture?: (key: TileAtlasKey) => THREE.CanvasTexture,
  getWallNormalTexture?: (key: TileAtlasKey) => THREE.CanvasTexture
): THREE.Group | null {
  if (!map.isInterior) return null;

  const wallQb = createQuadBuilder();
  const trimQb = createQuadBuilder();
  const h = map.grid.length;
  const w = map.grid[0]?.length ?? 0;

  for (let z = 0; z < h; z++) {
    const row = map.grid[z];
    const isSouthCutaway = z === h - 1;
    const wallTop = isSouthCutaway ? 0.34 : 2.05;
    const trimBot = isSouthCutaway ? 0.30 : 2.0;
    const trimTop = isSouthCutaway ? 0.40 : 2.15;
    for (let x = 0; x < w; x++) {
      if (row[x] !== '#') continue;
      const groundY = getTileWorldY(map, x, z);
      const x0 = x - 0.5;
      const x1 = x + 0.5;
      const z0 = z - 0.5;
      const z1 = z + 0.5;
      pushTiledBox(wallQb, x0, x1, groundY, groundY + wallTop, z0, z1, 0.96, [1.0, 0.96, 0.9]);
      pushTiledBox(trimQb, x0 - 0.01, x1 + 0.01, groundY + trimBot, groundY + trimTop, z0 - 0.01, z1 + 0.01, 0.85);
    }
  }

  if (wallQb.indices.length === 0) return null;

  const group = new THREE.Group();
  const wallKey = getInteriorWallKey(map.id);
  const wallMat = getWallTexture
    ? new THREE.MeshStandardMaterial({
        map: getWallTexture(wallKey),
        normalMap: getWallNormalTexture ? getWallNormalTexture(wallKey) : null,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughness: 0.88,
        metalness: 0.03,
        vertexColors: true,
      })
    : atlasMaterial;
  const wallMesh = new THREE.Mesh(buildGeometryFromQuadBuilder(wallQb), wallMat);
  wallMesh.matrixAutoUpdate = false;
  wallMesh.updateMatrix();
  group.add(wallMesh);

  if (trimQb.indices.length > 0) {
    const trimMat = getWallTexture
      ? new THREE.MeshStandardMaterial({
          map: getWallTexture('wall_wood_gold'),
          normalMap: getWallNormalTexture ? getWallNormalTexture('wall_wood_gold') : null,
          normalScale: new THREE.Vector2(1.05, 1.05),
          roughness: 0.85,
          metalness: 0.05,
          vertexColors: true,
        })
      : atlasMaterial;
    const trimMesh = new THREE.Mesh(buildGeometryFromQuadBuilder(trimQb), trimMat);
    trimMesh.matrixAutoUpdate = false;
    trimMesh.updateMatrix();
    group.add(trimMesh);
  }

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}
