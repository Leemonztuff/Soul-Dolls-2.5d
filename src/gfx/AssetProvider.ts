import * as THREE from 'three';
import {
  getPropAtlasCropRect,
  getPropAtlasDef,
  getPropAtlasSheetPaths,
  PROP_ATLAS_REGISTRY,
  type PropAtlasDef,
} from '../data/propAssets.ts';
import type { CharacterFrame, CharacterRole, Direction, PropKind } from '../domain/types.ts';
import { generateCharacterSpriteCanvas } from './CharacterSprites.ts';
import { generateCreatureSpriteCanvas } from './CreatureSpriteGen.ts';
import { generateItemIconCanvas } from './ItemIconGen.ts';
import { PALETTE } from './Palette.ts';
import {
  ATLAS_GRID,
  TILE_ATLAS_INDEX,
  EXTRA_TILE_MAPPING,
  SHEET_TILE_MAPPING,
  buildTileAtlasCanvas,
  buildTileNormalAtlasCanvas,
  SHEET_CELL_SIZE,
  stampExtraTilesOntoAtlas,
  stampTileSheetOntoAlbedoAtlas,
  stampTileSheetOntoNormalAtlas,
  TILE_SIZE,
  type SheetCellCoord,
  type TileAtlasKey,
} from './ProceduralTiles.ts';
import { generatePropCanvas } from './PropSprites.ts';
import {
  ALL_SPECIES_IDS_WITH_WILD_SOUL,
  getWildSoulSpriteUrl,
  type CreatureSpriteView,
} from '../data/soulForms.ts';
import {
  extractAndNormalizeSoulDollPair,
  getSoulDollSheetId,
  getSoulDollSheetUrl,
  normalizeWildSoulImage,
  SOULDOLL_MAX_SHEET_ID,
  type NormalizedSoulDollPair,
  type NormalizedWildSoul,
  type SoulDollTorsoAnchor,
} from './SoulDollSheets.ts';
import npcSheet07Url from '../assets/chars/NPC07.jpg';
import npcSheet08Url from '../assets/chars/NPC08.jpg';
import playerSheetUrl from '../assets/chars/PLAYER.jpeg';

export type BattleIconKind = 'fight' | 'bag' | 'party' | 'run';
export type RoofTextureKind = 'terracotta' | 'indigo' | 'patina' | 'wood' | 'slate';

export interface AssetProvider {
  getTileAtlasTexture(): THREE.CanvasTexture;
  getTileAtlasNormalTexture(): THREE.CanvasTexture;
  getGrassTexture(): THREE.CanvasTexture;
  getGrassNormalTexture(): THREE.CanvasTexture;
  getRoofTexture(kind: RoofTextureKind): THREE.CanvasTexture;
  getRoofNormalTexture(kind: RoofTextureKind): THREE.CanvasTexture;
  getWallTexture(key: TileAtlasKey): THREE.CanvasTexture;
  getWallNormalTexture(key: TileAtlasKey): THREE.CanvasTexture;
  getTerrainLayerTexture(key: TileAtlasKey): THREE.CanvasTexture;
  getTerrainLayerNormalTexture(key: TileAtlasKey): THREE.CanvasTexture;
  getCreatureTexture(speciesId: number, view: CreatureSpriteView): THREE.CanvasTexture;
  getCreatureSilhouetteTexture(speciesId: number, view: CreatureSpriteView): THREE.CanvasTexture;
  getCreatureDataUrl(speciesId: number, view?: CreatureSpriteView): string;
  getCreatureSilhouetteDataUrl(speciesId: number): string;
  getCreatureRigAnchor?(speciesId: number, view: CreatureSpriteView): SoulDollTorsoAnchor;
  onCreatureLoaded?(listener: (speciesId: number) => void): () => void;
  getItemIconDataUrl(itemId: string): string;
  getItemTexture(itemId: string): THREE.CanvasTexture;
  getCharacterTexture(
    role: CharacterRole,
    dir: Direction,
    frame: CharacterFrame,
    variant?: string
  ): THREE.CanvasTexture;
  getCharacterDataUrl(role: CharacterRole, dir?: Direction, variant?: string): string;
  getPropTexture(kind: PropKind): THREE.CanvasTexture;
  getBattleIconDataUrl(kind: BattleIconKind): string;
  dispose(): void;
}

function makePixelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeNormalTexture(
  canvas: HTMLCanvasElement,
  wrapRepeat = false
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if (wrapRepeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

function makeFlatNormalCanvas(width = TILE_SIZE, height = TILE_SIZE): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

function makeSoulDollTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

interface CharacterTextureRequest {
  role: CharacterRole;
  dir: Direction;
  frame: CharacterFrame;
  variant?: string;
}

const EXTERNAL_PROP_URLS: Partial<Record<PropKind, string>> = {
  mushroom_tree: '/assets/arbol_hongo.png',
  mushroom_tree_arcane: '/assets/arbol_hongo_arcano.png',
  pine: '/assets/arbol_pino.png',
  snow_pine: '/assets/arbol_pino_nieve.png',
  oak: '/assets/arbol_roble.png',
  birch: '/assets/arbol_sauce.png',
  bush: '/assets/arbusto_espinoso.png',
  bush_arcane: '/assets/arbusto_arcano.png',
  tall_grass_clump: '/assets/hierba_alta_clump.png',
  tall_grass_flower: '/assets/hierba_alta_flower.png',
  boulder: '/assets/props/boulder.png',
  crystal: '/assets/props/crystal.png',
  flower_patch: '/assets/props/flower_patch.png',
  mushroom: '/assets/props/mushroom.png',
  stump: '/assets/props/stump.png',
  cave_entrance: '/assets/props/cave_entrance.png',
  sign: '/assets/props/sign.png',
  well: '/assets/props/well.png',
  pillar: '/assets/props/pillar.png',
  fence: '/assets/props/fence.png',
  bench: '/assets/props/bench.png',
  capsule_pedestal: '/assets/props/capsule_pedestal.png',
  heal_machine: '/assets/props/heal_machine.png',
};

const DIRECTIONAL_CHAR_URLS: Partial<Record<CharacterRole, string>> = {
  professor: '/assets/chars/professor.png',
  rival: '/assets/chars/rival.png',
  healer: '/assets/chars/healer.png',
  trainer: '/assets/chars/trainer.png',
  npc: '/assets/chars/npc.png',
  leader: '/assets/chars/leader.png',
};

const BATTLE_ICON_URLS: Record<BattleIconKind, string> = {
  fight: '/assets/ui/battle_fight.png',
  bag: '/assets/ui/battle_bag.png',
  party: '/assets/ui/battle_party.png',
  run: '/assets/ui/battle_run.png',
};

const ITEM_ICON_ASSET_IDS: ReadonlySet<string> = new Set([
  'piedra_chispa',
  'piedra_brasa',
  'piedra_flora',
  'piedra_marea',
  'piedra_aurora',
  'piedra_eclipse',
  'repelente',
  'cuerda_huida',
  'fragmento_alma',
  'baya_roble',
  'baya_alba',
  'baya_pura',
  'baya_vigil',
  'gema_poder',
  'cinta_aguante',
  'pluma_veloz',
  'musgo_vital',
  'amuleto_brasa',
  'amuleto_marea',
  'amuleto_flora',
  'amuleto_chispa',
  'amuleto_roca',
  'amuleto_brisa',
  'amuleto_umbra',
  'amuleto_comun',
]);

function getNpcSpriteIndex(variant: string): number {
  let hash = 2166136261;
  for (let i = 0; i < variant.length; i++) {
    hash = Math.imul(hash ^ variant.charCodeAt(i), 16777619);
  }
  return (hash >>> 0) % 32;
}

function getCharacterTextureKey(
  role: CharacterRole,
  dir: Direction,
  frame: CharacterFrame,
  variant?: string
): string {
  if (role === 'player' || DIRECTIONAL_CHAR_URLS[role]) {
    return `${role}_${dir}_${frame}`;
  }
  return `npc_${getNpcSpriteIndex(variant ?? role)}`;
}

function makeTintedSilhouetteCanvas(
  source: HTMLCanvasElement,
  color: string
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function makeBattleIconCanvas(kind: BattleIconKind): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };

  switch (kind) {
    case 'fight':
      // Pixel crossed sword
      px(3, 11, 2, 2, PALETTE.brightBrass);
      px(4, 10, 2, 2, PALETTE.resonantGold);
      px(5, 8, 2, 2, PALETTE.boneGray);
      px(7, 6, 2, 2, PALETTE.warmWhite);
      px(9, 4, 2, 2, PALETTE.warmWhite);
      px(11, 2, 3, 3, PALETTE.porcelain);
      px(3, 8, 4, 2, PALETTE.oldBronze);
      px(6, 11, 2, 3, PALETTE.oldBronze);
      break;
    case 'bag':
      // Pixel satchel
      px(5, 2, 6, 2, PALETTE.darkOak);
      px(3, 4, 10, 9, PALETTE.burntUmber);
      px(4, 5, 8, 3, PALETTE.leatherBrown);
      px(7, 7, 2, 3, PALETTE.resonantGold);
      px(4, 9, 8, 3, PALETTE.dirtBrown);
      break;
    case 'party':
      // Pixel Soulpot
      px(7, 2, 2, 1, PALETTE.resonantGold);
      px(5, 3, 6, 2, PALETTE.cryptInk);
      px(6, 3, 4, 1, PALETTE.porcelain);
      px(3, 6, 10, 7, PALETTE.cryptInk);
      px(4, 6, 8, 6, PALETTE.riftCrimson);
      px(4, 8, 8, 2, PALETTE.smokedWood);
      px(7, 8, 2, 2, PALETTE.kiCyan);
      px(5, 13, 6, 1, PALETTE.cryptInk);
      break;
    case 'run':
      // Pixel swift wing
      px(2, 9, 10, 3, PALETTE.vibrantAqua);
      px(4, 6, 9, 3, PALETTE.kiCyan);
      px(7, 3, 7, 3, PALETTE.frostedGlass);
      px(2, 12, 6, 2, PALETTE.oceanicTeal);
      break;
  }

  return canvas;
}

class LruTextureCache {
  private map = new Map<string, THREE.CanvasTexture>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  peek(key: string): THREE.CanvasTexture | undefined {
    return this.map.get(key);
  }

  get(key: string): THREE.CanvasTexture | undefined {
    const val = this.map.get(key);
    if (!val) return undefined;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: string, tex: THREE.CanvasTexture): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        const oldest = this.map.get(oldestKey);
        oldest?.dispose();
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, tex);
  }

  clear(): void {
    for (const tex of this.map.values()) {
      tex.dispose();
    }
    this.map.clear();
  }
}

interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const LAMP_SHEET_CROPS: Partial<Record<PropKind, CropRect>> = {
  lamp_post: { sx: 0, sy: 0, sw: 34, sh: 192 },
  lamp_wood: { sx: 40, sy: 0, sw: 59, sh: 192 },
  lamp_stone: { sx: 105, sy: 0, sw: 32, sh: 192 },
  lamp_double: { sx: 143, sy: 0, sw: 69, sh: 192 },
};

const ROOF_SHEET_CELLS: Record<RoofTextureKind, { row: number; col: number }> = {
  terracotta: { row: 4, col: 0 },
  slate: { row: 4, col: 1 },
  wood: { row: 4, col: 2 },
  patina: { row: 4, col: 3 },
  indigo: { row: 4, col: 4 },
};

function makeGrassFallbackCanvas(): HTMLCanvasElement {
  const size = TILE_SIZE * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PALETTE.pitchBlackGreen;
  ctx.fillRect(0, 0, size, size);
  const step = 8;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      if ((x / step + (y / step) * 3) % 5 === 0) {
        ctx.fillStyle = PALETTE.forestGreen;
        ctx.fillRect(x, y, step, 4);
      } else if (((x / step) * 2 + y / step) % 7 === 0) {
        ctx.fillStyle = PALETTE.oceanicTeal;
        ctx.fillRect(x, y, 4, 4);
      }
    }
  }
  return canvas;
}

function makeRoofFallbackCanvas(kind: RoofTextureKind): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d')!;
  const colors =
    kind === 'terracotta'
      ? [PALETTE.rust, PALETTE.oldBronze, PALETTE.darkOak]
      : kind === 'indigo'
        ? [PALETTE.deepAbyss, PALETTE.royalPurple, PALETTE.resonantGold]
        : kind === 'patina'
          ? [PALETTE.smokedWood, PALETTE.forestGreen, PALETTE.darkOak]
          : kind === 'slate'
            ? [PALETTE.stoneShadow, PALETTE.cryptInk, PALETTE.coldStone]
            : [PALETTE.burntUmber, PALETTE.leatherBrown, PALETTE.darkOak];

  const s = TILE_SIZE / 16;
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  for (let y = 0; y < 16; y += 4) {
    ctx.fillStyle = colors[2];
    ctx.fillRect(0, y * s, TILE_SIZE, s);
    ctx.fillStyle = y % 8 === 0 ? colors[0] : colors[1];
    ctx.fillRect(0, (y + 1) * s, TILE_SIZE, 3 * s);
    for (let x = (y / 4) % 2 === 0 ? 0 : 4; x < 16; x += 8) {
      ctx.fillStyle = colors[2];
      ctx.fillRect(x * s, y * s, s, 4 * s);
    }
  }
  return canvas;
}

export class ProceduralAssetProvider implements AssetProvider {
  private tileAtlas: THREE.CanvasTexture | null = null;
  private tileAtlasNormal: THREE.CanvasTexture | null = null;
  private grassTexture: THREE.CanvasTexture | null = null;
  private grassNormalTexture: THREE.CanvasTexture | null = null;
  private creatureCache = new LruTextureCache(128);
  private silhouetteCache = new LruTextureCache(128);
  private creatureUrls = new Map<string, string>();
  private silhouetteUrls = new Map<number, string>();
  private souldollPairs = new Map<number, NormalizedSoulDollPair>();
  private wildSoulForms = new Map<number, NormalizedWildSoul>();
  private wildSoulLoading = new Set<number>();
  private wildSoulAttempted = new Set<number>();
  private souldollLoading = new Set<number>();
  private souldollAttempted = new Set<number>();
  private souldollQueue: number[] = [];
  private souldollActiveLoads = 0;
  private creatureListeners = new Set<(speciesId: number) => void>();
  private itemIconUrls = new Map<string, string>();
  private itemTextures = new Map<string, THREE.CanvasTexture>();
  private charCache = new Map<string, THREE.CanvasTexture>();
  private charRequests = new Map<string, CharacterTextureRequest>();
  private charUrls = new Map<string, string>();
  private propCache = new Map<PropKind, THREE.CanvasTexture>();
  private roofCache = new Map<RoofTextureKind, THREE.CanvasTexture>();
  private roofNormalCache = new Map<RoofTextureKind, THREE.CanvasTexture>();
  private wallCache = new Map<TileAtlasKey, THREE.CanvasTexture>();
  private wallNormalCache = new Map<TileAtlasKey, THREE.CanvasTexture>();
  private terrainLayerCache = new Map<TileAtlasKey, THREE.CanvasTexture>();
  private terrainLayerNormalCache = new Map<TileAtlasKey, THREE.CanvasTexture>();
  private battleIconUrls = new Map<BattleIconKind, string>();

  private propImages = new Map<PropKind, HTMLImageElement>();
  private propAtlasImages = new Map<string, HTMLImageElement>();
  private itemImages = new Map<string, HTMLImageElement>();
  private tileSheetAlbedoImg: HTMLImageElement | null = null;
  private tileSheetNormalImg: HTMLImageElement | null = null;
  private tileExtraAlbedoImg: HTMLImageElement | null = null;
  private tileExtraNormalImg: HTMLImageElement | null = null;
  private lampsSheetImg: HTMLImageElement | null = null;
  private playerSpriteSheetImg: HTMLImageElement | null = null;
  private roleSpriteSheetImgs = new Map<CharacterRole, HTMLImageElement>();
  private npcSpriteSheetImgs: [HTMLImageElement | null, HTMLImageElement | null] = [null, null];
  private disposed = false;

  constructor() {
    this.preloadExternalProps();
  }

  private refreshTileAtlasAlbedo(): void {
    if (!this.tileAtlas) return;
    const canvas = this.tileAtlas.image as HTMLCanvasElement;
    if (this.tileSheetAlbedoImg) {
      stampTileSheetOntoAlbedoAtlas(canvas, this.tileSheetAlbedoImg);
    }
    if (this.tileExtraAlbedoImg) {
      stampExtraTilesOntoAtlas(canvas, this.tileExtraAlbedoImg);
    }
    this.tileAtlas.needsUpdate = true;
  }

  private refreshTileAtlasNormal(): void {
    if (!this.tileAtlasNormal) return;
    const canvas = this.tileAtlasNormal.image as HTMLCanvasElement;
    if (this.tileSheetNormalImg) {
      stampTileSheetOntoNormalAtlas(canvas, this.tileSheetNormalImg);
    }
    if (this.tileExtraNormalImg) {
      stampExtraTilesOntoAtlas(canvas, this.tileExtraNormalImg);
    }
    this.tileAtlasNormal.needsUpdate = true;
  }

  private refreshTerrainLayerTextures(isNormal: boolean): void {
    const cache = isNormal ? this.terrainLayerNormalCache : this.terrainLayerCache;
    for (const [key, tex] of cache.entries()) {
      const srcCanvas = this.createTerrainLayerCanvas(key, isNormal);
      const dstCanvas = tex.image as HTMLCanvasElement;
      const ctx = dstCanvas?.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, dstCanvas.width, dstCanvas.height);
        ctx.drawImage(srcCanvas, 0, 0, dstCanvas.width, dstCanvas.height);
        tex.needsUpdate = true;
      }
    }
  }

  private refreshWallTextures(isNormal: boolean): void {
    const cache = isNormal ? this.wallNormalCache : this.wallCache;
    for (const [key, tex] of cache.entries()) {
      const cell = SHEET_TILE_MAPPING[key] || EXTRA_TILE_MAPPING[key];
      if (!cell) continue;
      if (SHEET_TILE_MAPPING[key]) {
        const img = isNormal ? this.tileSheetNormalImg : this.tileSheetAlbedoImg;
        if (img) {
          this.stampSheetCellToTexture(tex, img, cell.row, cell.col, 1);
        }
      } else if (EXTRA_TILE_MAPPING[key]) {
        const img = isNormal ? this.tileExtraNormalImg : this.tileExtraAlbedoImg;
        if (img) {
          this.stampSheetCellToTexture(tex, img, cell.row, cell.col, 1);
        }
      }
    }
  }

  private preloadExternalProps(): void {
    if (typeof Image === 'undefined') return;

    this.preloadSoulDollSheets();
    this.preloadCharacterSpriteSheets();

    for (const sheetPath of getPropAtlasSheetPaths()) {
      const img = new Image();
      img.onload = () => {
        if (this.disposed) return;
        this.propAtlasImages.set(sheetPath, img);
        for (const def of PROP_ATLAS_REGISTRY) {
          if (def.sheetPath !== sheetPath) continue;
          const existing = this.propCache.get(def.kind);
          if (existing) {
            this.applyAtlasPropTexture(existing, def, img);
          }
        }
      };
      img.onerror = () => console.error(`Failed to load prop atlas: ${sheetPath}`);
      img.src = sheetPath;
    }

    for (const [kind, url] of Object.entries(EXTERNAL_PROP_URLS) as Array<[PropKind, string]>) {
      const img = new Image();
      img.onload = () => {
        if (this.disposed) return;
        this.propImages.set(kind, img);
        const existing = this.propCache.get(kind);
        if (existing) {
          this.applyImageToTexture(existing, img, 0, 0, img.naturalWidth, img.naturalHeight);
        }
      };
      img.src = url;
    }

    for (const itemId of ITEM_ICON_ASSET_IDS) {
      const img = new Image();
      img.onload = () => {
        if (this.disposed) return;
        this.itemImages.set(itemId, img);
        const existing = this.itemTextures.get(itemId);
        if (existing) {
          this.applyImageToTexture(existing, img, 0, 0, img.naturalWidth, img.naturalHeight);
        }
      };
      img.src = `/assets/items/${itemId}.png`;
    }

    const albedoSheetImg = new Image();
    albedoSheetImg.onload = () => {
      if (this.disposed) return;
      this.tileSheetAlbedoImg = albedoSheetImg;
      this.refreshTileAtlasAlbedo();
      this.refreshTerrainLayerTextures(false);
      this.refreshWallTextures(false);
      if (this.grassTexture) {
        this.stampSheetCellToTexture(this.grassTexture, albedoSheetImg, 0, 0, 2);
      }
      for (const [kind, cell] of Object.entries(ROOF_SHEET_CELLS) as Array<
        [RoofTextureKind, { row: number; col: number }]
      >) {
        const existing = this.roofCache.get(kind);
        if (existing) {
          this.stampSheetCellToTexture(existing, albedoSheetImg, cell.row, cell.col, 1);
        }
      }
    };
    albedoSheetImg.src = '/assets/tiles_5x5_albedo.png';

    const extraAlbedoImg = new Image();
    extraAlbedoImg.onload = () => {
      if (this.disposed) return;
      this.tileExtraAlbedoImg = extraAlbedoImg;
      this.refreshTileAtlasAlbedo();
      this.refreshTerrainLayerTextures(false);
      this.refreshWallTextures(false);
    };
    extraAlbedoImg.src = '/assets/tiles_extra_albedo.png';

    const normalSheetImg = new Image();
    normalSheetImg.onload = () => {
      if (this.disposed) return;
      this.tileSheetNormalImg = normalSheetImg;
      this.refreshTileAtlasNormal();
      this.refreshTerrainLayerTextures(true);
      this.refreshWallTextures(true);
      if (this.grassNormalTexture) {
        this.stampSheetCellToTexture(this.grassNormalTexture, normalSheetImg, 0, 0, 2);
      }
      for (const [kind, cell] of Object.entries(ROOF_SHEET_CELLS) as Array<
        [RoofTextureKind, { row: number; col: number }]
      >) {
        const existing = this.roofNormalCache.get(kind);
        if (existing) {
          this.stampSheetCellToTexture(existing, normalSheetImg, cell.row, cell.col, 1);
        }
      }
    };
    normalSheetImg.src = '/assets/tiles_5x5_normal.png';

    const extraNormalImg = new Image();
    extraNormalImg.onload = () => {
      if (this.disposed) return;
      this.tileExtraNormalImg = extraNormalImg;
      this.refreshTileAtlasNormal();
      this.refreshTerrainLayerTextures(true);
      this.refreshWallTextures(true);
    };
    extraNormalImg.src = '/assets/tiles_extra_normal.png';

    const lampsImg = new Image();
    lampsImg.onload = () => {
      if (this.disposed) return;
      this.lampsSheetImg = lampsImg;
      for (const [kind, rect] of Object.entries(LAMP_SHEET_CROPS) as Array<[PropKind, CropRect]>) {
        const existing = this.propCache.get(kind);
        if (existing) {
          this.applyImageToTexture(existing, lampsImg, rect.sx, rect.sy, rect.sw, rect.sh);
        }
      }
    };
    lampsImg.src = '/assets/faroles_ciudad.png';
  }

  private preloadCharacterSpriteSheets(): void {
    const load = (
      url: string,
      onLoad: (image: HTMLImageElement) => void
    ): void => {
      const image = new Image();
      image.onload = () => {
        if (this.disposed) return;
        onLoad(image);
        this.refreshCharacterTextures();
      };
      image.onerror = () => console.error(`Failed to load character sprite sheet: ${url}`);
      image.src = url;
    };

    load(playerSheetUrl, (image) => {
      this.playerSpriteSheetImg = image;
    });
    for (const [role, url] of Object.entries(DIRECTIONAL_CHAR_URLS) as Array<
      [CharacterRole, string]
    >) {
      load(url, (image) => {
        this.roleSpriteSheetImgs.set(role, image);
      });
    }
    load(npcSheet07Url, (image) => {
      this.npcSpriteSheetImgs[0] = image;
    });
    load(npcSheet08Url, (image) => {
      this.npcSpriteSheetImgs[1] = image;
    });
  }

  private createTransparentSpriteCell(
    image: HTMLImageElement,
    row: number,
    column: number
  ): HTMLCanvasElement {
    const cellWidth = image.naturalWidth / 4;
    const cellHeight = image.naturalHeight / 4;
    if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) {
      throw new Error('Character sprite sheets must be divisible into a 4x4 grid');
    }

    const canvas = document.createElement('canvas');
    canvas.width = cellWidth;
    canvas.height = cellHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create character sprite canvas context');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      column * cellWidth,
      row * cellHeight,
      cellWidth,
      cellHeight,
      0,
      0,
      cellWidth,
      cellHeight
    );
    return canvas;
  }

  private createKeyedSpriteCell(
    image: HTMLImageElement,
    row: number,
    column: number
  ): HTMLCanvasElement {
    const cellWidth = image.naturalWidth / 4;
    const cellHeight = image.naturalHeight / 4;
    if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) {
      throw new Error('Character sprite sheets must be divisible into a 4x4 grid');
    }

    const canvas = document.createElement('canvas');
    canvas.width = cellWidth;
    canvas.height = cellHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create character sprite canvas context');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      column * cellWidth,
      row * cellHeight,
      cellWidth,
      cellHeight,
      0,
      0,
      cellWidth,
      cellHeight
    );

    const imageData = ctx.getImageData(0, 0, cellWidth, cellHeight);
    const { data } = imageData;
    const pixelCount = cellWidth * cellHeight;
    const visited = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;
    const isGreenBackground = (pixel: number): boolean => {
      const offset = pixel * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      return green > 75 && green - red > 22 && green - blue > 22;
    };
    const enqueue = (x: number, y: number): void => {
      const pixel = y * cellWidth + x;
      if (visited[pixel] || !isGreenBackground(pixel)) return;
      visited[pixel] = 1;
      queue[tail++] = pixel;
    };

    for (let x = 0; x < cellWidth; x++) {
      enqueue(x, 0);
      enqueue(x, cellHeight - 1);
    }
    for (let y = 0; y < cellHeight; y++) {
      enqueue(0, y);
      enqueue(cellWidth - 1, y);
    }

    while (head < tail) {
      const pixel = queue[head++];
      data[pixel * 4 + 3] = 0;
      const x = pixel % cellWidth;
      const y = Math.floor(pixel / cellWidth);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < cellWidth && ny >= 0 && ny < cellHeight) {
            enqueue(nx, ny);
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  private createCharacterCanvas(request: CharacterTextureRequest): HTMLCanvasElement {
    const directionRows: Record<Direction, number> = {
      down: 0,
      left: 1,
      right: 2,
      up: 3,
    };

    if (request.role === 'player' && this.playerSpriteSheetImg) {
      return this.createKeyedSpriteCell(
        this.playerSpriteSheetImg,
        directionRows[request.dir],
        request.frame
      );
    }

    const roleSheet = this.roleSpriteSheetImgs.get(request.role);
    if (roleSheet) {
      return this.createTransparentSpriteCell(
        roleSheet,
        directionRows[request.dir],
        request.frame
      );
    }

    if (request.role !== 'player' && !DIRECTIONAL_CHAR_URLS[request.role]) {
      const index = getNpcSpriteIndex(request.variant ?? request.role);
      const sheetIndex = Math.floor(index / 16);
      const image = this.npcSpriteSheetImgs[sheetIndex];
      if (image) {
        const cell = index % 16;
        return this.createKeyedSpriteCell(image, Math.floor(cell / 4), cell % 4);
      }
    }

    return generateCharacterSpriteCanvas(request.role, request.dir, request.frame);
  }

  private updateTextureFromCanvas(
    texture: THREE.CanvasTexture,
    source: HTMLCanvasElement
  ): void {
    if (source.width <= 0 || source.height <= 0) return;
    const canvas = texture.image as HTMLCanvasElement;
    const resized = canvas.width !== source.width || canvas.height !== source.height;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to update character sprite texture');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
    if (resized) {
      texture.dispose();
    }
    texture.needsUpdate = true;
  }

  private preloadSoulDollSheets(): void {
    // Prioritize starter SoulDolls and registered wild soul sprites first
    for (const id of [1, 4, 7]) {
      this.enqueueSoulDollLoad(id, true);
    }
    for (const wildId of ALL_SPECIES_IDS_WITH_WILD_SOUL) {
      this.enqueueWildSoulLoad(wildId);
    }
    for (let id = 1; id <= SOULDOLL_MAX_SHEET_ID; id++) {
      this.enqueueSoulDollLoad(id, false);
    }
  }

  private enqueueWildSoulLoad(speciesId: number): void {
    if (this.disposed || typeof Image === 'undefined') return;
    const sheetId = getSoulDollSheetId(speciesId);
    const wildUrl = getWildSoulSpriteUrl(sheetId);
    if (
      !wildUrl ||
      this.wildSoulForms.has(sheetId) ||
      this.wildSoulLoading.has(sheetId) ||
      this.wildSoulAttempted.has(sheetId)
    ) {
      return;
    }

    this.wildSoulLoading.add(sheetId);
    this.wildSoulAttempted.add(sheetId);
    const img = new Image();
    img.onload = () => {
      this.wildSoulLoading.delete(sheetId);
      if (this.disposed) return;
      const normalized = normalizeWildSoulImage(img);
      if (normalized) {
        this.wildSoulForms.set(sheetId, normalized);
        this.refreshWildSoulAssets(sheetId, normalized);
      }
    };
    img.onerror = () => {
      this.wildSoulLoading.delete(sheetId);
    };
    img.src = wildUrl;
  }

  private refreshWildSoulAssets(sheetId: number, wildForm: NormalizedWildSoul): void {
    const key = `${sheetId}_wild`;
    this.creatureUrls.delete(key);
    const tex = this.creatureCache.peek(key);
    if (tex) {
      this.updateTextureFromCanvas(tex, wildForm.canvas);
    }
    const silTex = this.silhouetteCache.peek(key);
    if (silTex) {
      this.updateTextureFromCanvas(
        silTex,
        makeTintedSilhouetteCanvas(wildForm.canvas, PALETTE.warmWhite)
      );
    }
    for (const listener of this.creatureListeners) {
      listener(sheetId);
    }
  }

  private enqueueSoulDollLoad(speciesId: number, highPriority: boolean): void {
    if (this.disposed || typeof Image === 'undefined') return;
    const sheetId = getSoulDollSheetId(speciesId);
    if (
      this.souldollPairs.has(sheetId) ||
      this.souldollLoading.has(sheetId) ||
      this.souldollAttempted.has(sheetId)
    ) {
      return;
    }

    const existingIdx = this.souldollQueue.indexOf(sheetId);
    if (existingIdx !== -1) {
      if (highPriority && existingIdx > 0) {
        this.souldollQueue.splice(existingIdx, 1);
        this.souldollQueue.unshift(sheetId);
      }
    } else if (highPriority) {
      this.souldollQueue.unshift(sheetId);
    } else {
      this.souldollQueue.push(sheetId);
    }

    this.pumpSoulDollQueue();
  }

  private pumpSoulDollQueue(): void {
    const maxConcurrent = 6;
    while (!this.disposed && this.souldollActiveLoads < maxConcurrent && this.souldollQueue.length > 0) {
      const sheetId = this.souldollQueue.shift()!;
      if (this.souldollPairs.has(sheetId) || this.souldollLoading.has(sheetId)) {
        continue;
      }
      this.souldollLoading.add(sheetId);
      this.souldollAttempted.add(sheetId);
      this.souldollActiveLoads += 1;

      const img = new Image();
      const url = getSoulDollSheetUrl(sheetId);
      const finish = () => {
        this.souldollLoading.delete(sheetId);
        this.souldollActiveLoads = Math.max(0, this.souldollActiveLoads - 1);
        this.pumpSoulDollQueue();
      };

      img.onload = () => {
        if (this.disposed) return;
        const pair = extractAndNormalizeSoulDollPair(img);
        if (pair) {
          this.souldollPairs.set(sheetId, pair);
          this.refreshSoulDollAssets(sheetId, pair);
        }
        finish();
      };
      img.onerror = () => {
        finish();
      };
      img.src = url;
    }
  }

  private refreshSoulDollAssets(sheetId: number, pair: NormalizedSoulDollPair): void {
    this.creatureUrls.delete(`${sheetId}_front`);
    this.creatureUrls.delete(`${sheetId}_back`);
    this.silhouetteUrls.delete(sheetId);

    for (const view of ['front', 'back'] as const) {
      const key = `${sheetId}_${view}`;
      const tex = this.creatureCache.peek(key);
      if (tex) {
        this.updateTextureFromCanvas(tex, pair[view]);
      }
      const silTex = this.silhouetteCache.peek(key);
      if (silTex) {
        this.updateTextureFromCanvas(
          silTex,
          makeTintedSilhouetteCanvas(pair[view], PALETTE.warmWhite)
        );
      }
    }

    for (const listener of this.creatureListeners) {
      listener(sheetId);
    }
  }

  private getCreatureCanvas(speciesId: number, view: CreatureSpriteView): HTMLCanvasElement {
    const sheetId = getSoulDollSheetId(speciesId);
    if (view === 'wild') {
      this.enqueueWildSoulLoad(sheetId);
      const wildForm = this.wildSoulForms.get(sheetId);
      if (wildForm) {
        return wildForm.canvas;
      }
    }
    this.enqueueSoulDollLoad(sheetId, true);
    const pair = this.souldollPairs.get(sheetId);
    if (pair) {
      return view === 'back' ? pair.back : pair.front;
    }
    return generateCreatureSpriteCanvas(speciesId, view === 'back' ? 'back' : 'front');
  }

  private refreshCharacterTextures(): void {
    this.charUrls.clear();
    for (const [key, texture] of this.charCache) {
      const request = this.charRequests.get(key);
      if (request) {
        this.updateTextureFromCanvas(texture, this.createCharacterCanvas(request));
      }
    }
  }

  private applyImageToTexture(
    tex: THREE.CanvasTexture,
    img: HTMLImageElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number
  ): void {
    if (sw <= 0 || sh <= 0 || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
    const canvas = tex.image as HTMLCanvasElement;
    const resized = canvas.width !== sw || canvas.height !== sh;
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    if (resized) {
      tex.dispose();
    }
    tex.needsUpdate = true;
  }

  private applyAtlasPropTexture(
    tex: THREE.CanvasTexture,
    def: PropAtlasDef,
    img: HTMLImageElement
  ): void {
    const crop = getPropAtlasCropRect(def, img.naturalWidth, img.naturalHeight);
    if (!crop) return;
    this.applyImageToTexture(tex, img, crop.sx, crop.sy, crop.sw, crop.sh);
  }

  private stampSheetCellToTexture(
    tex: THREE.CanvasTexture,
    sheetImg: HTMLImageElement,
    row: number,
    col: number,
    repeatGrid: 1 | 2
  ): void {
    const targetSize = TILE_SIZE * repeatGrid;
    const canvas = tex.image as HTMLCanvasElement;
    const resized = canvas.width !== targetSize || canvas.height !== targetSize;
    if (resized) {
      canvas.width = targetSize;
      canvas.height = targetSize;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, targetSize, targetSize);

    const sx = col * SHEET_CELL_SIZE;
    const sy = row * SHEET_CELL_SIZE;
    for (let gy = 0; gy < repeatGrid; gy++) {
      for (let gx = 0; gx < repeatGrid; gx++) {
        ctx.drawImage(
          sheetImg,
          sx,
          sy,
          SHEET_CELL_SIZE,
          SHEET_CELL_SIZE,
          gx * TILE_SIZE,
          gy * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE
        );
      }
    }

    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    if (resized) {
      tex.dispose();
    }
    tex.needsUpdate = true;
  }

  getTileAtlasTexture(): THREE.CanvasTexture {
    if (!this.tileAtlas) {
      const canvas = buildTileAtlasCanvas();
      if (this.tileSheetAlbedoImg) {
        stampTileSheetOntoAlbedoAtlas(canvas, this.tileSheetAlbedoImg);
      }
      if (this.tileExtraAlbedoImg) {
        stampExtraTilesOntoAtlas(canvas, this.tileExtraAlbedoImg);
      }
      this.tileAtlas = makePixelTexture(canvas);
    }
    return this.tileAtlas;
  }

  getTileAtlasNormalTexture(): THREE.CanvasTexture {
    if (!this.tileAtlasNormal) {
      const canvas = buildTileNormalAtlasCanvas();
      if (this.tileSheetNormalImg) {
        stampTileSheetOntoNormalAtlas(canvas, this.tileSheetNormalImg);
      }
      if (this.tileExtraNormalImg) {
        stampExtraTilesOntoAtlas(canvas, this.tileExtraNormalImg);
      }
      this.tileAtlasNormal = makeNormalTexture(canvas, false);
    }
    return this.tileAtlasNormal;
  }

  getGrassTexture(): THREE.CanvasTexture {
    if (!this.grassTexture) {
      const tex = new THREE.CanvasTexture(makeGrassFallbackCanvas());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.grassTexture = tex;

      if (this.tileSheetAlbedoImg) {
        this.stampSheetCellToTexture(tex, this.tileSheetAlbedoImg, 0, 0, 2);
      }
    }
    return this.grassTexture;
  }

  getGrassNormalTexture(): THREE.CanvasTexture {
    if (!this.grassNormalTexture) {
      const tex = makeNormalTexture(
        makeFlatNormalCanvas(TILE_SIZE * 2, TILE_SIZE * 2),
        true
      );
      this.grassNormalTexture = tex;

      if (this.tileSheetNormalImg) {
        this.stampSheetCellToTexture(tex, this.tileSheetNormalImg, 0, 0, 2);
      }
    }
    return this.grassNormalTexture;
  }

  getRoofTexture(kind: RoofTextureKind): THREE.CanvasTexture {
    let tex = this.roofCache.get(kind);
    if (!tex) {
      tex = new THREE.CanvasTexture(makeRoofFallbackCanvas(kind));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.roofCache.set(kind, tex);

      if (this.tileSheetAlbedoImg) {
        const cell = ROOF_SHEET_CELLS[kind];
        this.stampSheetCellToTexture(tex, this.tileSheetAlbedoImg, cell.row, cell.col, 1);
      }
    }
    return tex;
  }

  getRoofNormalTexture(kind: RoofTextureKind): THREE.CanvasTexture {
    let tex = this.roofNormalCache.get(kind);
    if (!tex) {
      tex = makeNormalTexture(makeFlatNormalCanvas(TILE_SIZE, TILE_SIZE), true);
      this.roofNormalCache.set(kind, tex);

      if (this.tileSheetNormalImg) {
        const cell = ROOF_SHEET_CELLS[kind];
        this.stampSheetCellToTexture(tex, this.tileSheetNormalImg, cell.row, cell.col, 1);
      }
    }
    return tex;
  }

  getWallTexture(key: TileAtlasKey): THREE.CanvasTexture {
    let tex = this.wallCache.get(key);
    if (!tex) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

      // Always seed from procedural tile atlas first so walls never appear flat gray before PNG load
      const atlas = this.getTileAtlasTexture();
      const idx = TILE_ATLAS_INDEX[key] ?? 0;
      const ox = (idx % ATLAS_GRID) * TILE_SIZE;
      const oy = Math.floor(idx / ATLAS_GRID) * TILE_SIZE;
      const atlasCanvas = atlas.image as HTMLCanvasElement;
      if (atlasCanvas && typeof ctx.drawImage === 'function') {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(atlasCanvas, ox, oy, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
      }

      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.wallCache.set(key, tex);

      if (this.tileSheetAlbedoImg && SHEET_TILE_MAPPING[key]) {
        const cell = SHEET_TILE_MAPPING[key]!;
        this.stampSheetCellToTexture(tex, this.tileSheetAlbedoImg, cell.row, cell.col, 1);
      } else if (this.tileExtraAlbedoImg && EXTRA_TILE_MAPPING[key]) {
        const cell = EXTRA_TILE_MAPPING[key]!;
        this.stampSheetCellToTexture(tex, this.tileExtraAlbedoImg, cell.row, cell.col, 1);
      }
    }
    return tex;
  }

  getWallNormalTexture(key: TileAtlasKey): THREE.CanvasTexture {
    let tex = this.wallNormalCache.get(key);
    if (!tex) {
      const normalCanvas = makeFlatNormalCanvas(TILE_SIZE, TILE_SIZE);
      const nctx = normalCanvas.getContext('2d');
      const atlasNormal = this.getTileAtlasNormalTexture();
      const idx = TILE_ATLAS_INDEX[key] ?? 0;
      const ox = (idx % ATLAS_GRID) * TILE_SIZE;
      const oy = Math.floor(idx / ATLAS_GRID) * TILE_SIZE;
      const atlasCanvas = atlasNormal.image as HTMLCanvasElement;
      if (nctx && atlasCanvas && typeof nctx.drawImage === 'function') {
        nctx.imageSmoothingEnabled = false;
        nctx.drawImage(atlasCanvas, ox, oy, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
      }

      tex = makeNormalTexture(normalCanvas, true);
      this.wallNormalCache.set(key, tex);

      if (this.tileSheetNormalImg && SHEET_TILE_MAPPING[key]) {
        const cell = SHEET_TILE_MAPPING[key]!;
        this.stampSheetCellToTexture(tex, this.tileSheetNormalImg, cell.row, cell.col, 1);
      } else if (this.tileExtraNormalImg && EXTRA_TILE_MAPPING[key]) {
        const cell = EXTRA_TILE_MAPPING[key]!;
        this.stampSheetCellToTexture(tex, this.tileExtraNormalImg, cell.row, cell.col, 1);
      }
    }
    return tex;
  }

  /**
   * Dibuja una celda individual (64×64) de la hoja de terrenos correspondiente en un canvas limpio.
   * Se usa para exponer texturas RepeatWrapping sueltas (cliff_rock, mossy_stone, cracked_stone,
   * dirt, sand, snow…) destinadas a caras inclinadas y estratos donde el atlas empaquetado
   * provocaría UV bleeding. Prioriza la hoja principal y, si no existe la clave, la hoja extra.
   * Cuando ninguna imagen está aún cargada, fall back al wall texture existente (atlas o gris).
   */
  private createTerrainLayerCanvas(key: TileAtlasKey, isNormal: boolean): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);

    const drawFromSheet = (img: HTMLImageElement | null, cell: SheetCellCoord): boolean => {
      if (!img) return false;
      ctx.drawImage(
        img,
        cell.col * SHEET_CELL_SIZE,
        cell.row * SHEET_CELL_SIZE,
        SHEET_CELL_SIZE,
        SHEET_CELL_SIZE,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE
      );
      return true;
    };

    const sheetCell = SHEET_TILE_MAPPING[key];
    if (sheetCell) {
      const img = isNormal ? this.tileSheetNormalImg : this.tileSheetAlbedoImg;
      if (drawFromSheet(img, sheetCell)) return canvas;
    }

    const extraCell = EXTRA_TILE_MAPPING[key];
    if (extraCell) {
      const img = isNormal ? this.tileExtraNormalImg : this.tileExtraAlbedoImg;
      if (drawFromSheet(img, extraCell)) return canvas;
    }

    // Fallback: copiar del wall texture existente (ya resuelve atlas o gris sólido).
    const fallback = this.getWallTexture(key);
    const fbCanvas = fallback.image as HTMLCanvasElement;
    if (fbCanvas) {
      ctx.drawImage(fbCanvas, 0, 0, TILE_SIZE, TILE_SIZE);
    }
    return canvas;
  }

  getTerrainLayerTexture(key: TileAtlasKey): THREE.CanvasTexture {
    let tex = this.terrainLayerCache.get(key);
    if (!tex) {
      tex = new THREE.CanvasTexture(this.createTerrainLayerCanvas(key, false));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.terrainLayerCache.set(key, tex);
    }
    return tex;
  }

  getTerrainLayerNormalTexture(key: TileAtlasKey): THREE.CanvasTexture {
    let tex = this.terrainLayerNormalCache.get(key);
    if (!tex) {
      tex = new THREE.CanvasTexture(this.createTerrainLayerCanvas(key, true));
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.terrainLayerNormalCache.set(key, tex);
    }
    return tex;
  }

  onCreatureLoaded(listener: (speciesId: number) => void): () => void {
    this.creatureListeners.add(listener);
    return () => {
      this.creatureListeners.delete(listener);
    };
  }

  getCreatureRigAnchor(speciesId: number, view: CreatureSpriteView): SoulDollTorsoAnchor {
    const sheetId = getSoulDollSheetId(speciesId);
    if (view === 'wild') {
      this.enqueueWildSoulLoad(sheetId);
      const wildForm = this.wildSoulForms.get(sheetId);
      if (wildForm) {
        return wildForm.anchor;
      }
    }
    this.enqueueSoulDollLoad(sheetId, true);
    const pair = this.souldollPairs.get(sheetId);
    if (pair) {
      return view === 'back' ? pair.backAnchor : pair.frontAnchor;
    }
    return { torsoX: 0.5, bustY: 0.635, charHeight: 0.96 };
  }

  getCreatureTexture(
    speciesId: number,
    view: CreatureSpriteView
  ): THREE.CanvasTexture {
    const key = `${speciesId}_${view}`;
    const hit = this.creatureCache.get(key);
    if (hit) {
      if (view === 'wild') {
        this.enqueueWildSoulLoad(getSoulDollSheetId(speciesId));
      }
      this.enqueueSoulDollLoad(getSoulDollSheetId(speciesId), true);
      return hit;
    }
    const tex = makeSoulDollTexture(this.getCreatureCanvas(speciesId, view));
    this.creatureCache.set(key, tex);
    return tex;
  }

  getCreatureSilhouetteTexture(
    speciesId: number,
    view: CreatureSpriteView
  ): THREE.CanvasTexture {
    const key = `${speciesId}_${view}`;
    const hit = this.silhouetteCache.get(key);
    if (hit) {
      if (view === 'wild') {
        this.enqueueWildSoulLoad(getSoulDollSheetId(speciesId));
      }
      this.enqueueSoulDollLoad(getSoulDollSheetId(speciesId), true);
      return hit;
    }
    const base = this.getCreatureCanvas(speciesId, view);
    const tex = makeSoulDollTexture(makeTintedSilhouetteCanvas(base, PALETTE.warmWhite));
    this.silhouetteCache.set(key, tex);
    return tex;
  }

  getCreatureDataUrl(speciesId: number, view: CreatureSpriteView = 'front'): string {
    const key = `${speciesId}_${view}`;
    let url = this.creatureUrls.get(key);
    if (!url) {
      const canvas = this.getCreatureCanvas(speciesId, view);
      url = canvas.toDataURL('image/png');
      this.creatureUrls.set(key, url);
    }
    return url;
  }

  getCreatureSilhouetteDataUrl(speciesId: number): string {
    let url = this.silhouetteUrls.get(speciesId);
    if (!url) {
      const base = this.getCreatureCanvas(speciesId, 'front');
      url = makeTintedSilhouetteCanvas(base, PALETTE.smokedWood).toDataURL('image/png');
      this.silhouetteUrls.set(speciesId, url);
    }
    return url;
  }

  getItemIconDataUrl(itemId: string): string {
    if (ITEM_ICON_ASSET_IDS.has(itemId)) {
      return `/assets/items/${itemId}.png`;
    }
    let url = this.itemIconUrls.get(itemId);
    if (!url) {
      url = generateItemIconCanvas(itemId).toDataURL('image/png');
      this.itemIconUrls.set(itemId, url);
    }
    return url;
  }

  getItemTexture(itemId: string): THREE.CanvasTexture {
    let tex = this.itemTextures.get(itemId);
    if (!tex) {
      tex = makePixelTexture(generateItemIconCanvas(itemId));
      this.itemTextures.set(itemId, tex);
      const img = this.itemImages.get(itemId);
      if (img) {
        this.applyImageToTexture(tex, img, 0, 0, img.naturalWidth, img.naturalHeight);
      }
    }
    return tex;
  }

  getCharacterTexture(
    role: CharacterRole,
    dir: Direction,
    frame: CharacterFrame,
    variant?: string
  ): THREE.CanvasTexture {
    const request = { role, dir, frame, variant };
    const key = getCharacterTextureKey(role, dir, frame, variant);
    let tex = this.charCache.get(key);
    if (!tex) {
      tex = makePixelTexture(this.createCharacterCanvas(request));
      this.charCache.set(key, tex);
      this.charRequests.set(key, request);
    }
    return tex;
  }

  getCharacterDataUrl(
    role: CharacterRole,
    dir: Direction = 'down',
    variant?: string
  ): string {
    const key = getCharacterTextureKey(role, dir, 0, variant);
    let url = this.charUrls.get(key);
    if (!url) {
      url = this.createCharacterCanvas({ role, dir, frame: 0, variant }).toDataURL('image/png');
      this.charUrls.set(key, url);
    }
    return url;
  }

  getPropTexture(kind: PropKind): THREE.CanvasTexture {
    let tex = this.propCache.get(kind);
    if (!tex) {
      tex = makePixelTexture(generatePropCanvas(kind));
      this.propCache.set(kind, tex);

      const atlasDef = getPropAtlasDef(kind);
      const atlasImg = atlasDef ? this.propAtlasImages.get(atlasDef.sheetPath) : undefined;
      if (atlasDef && atlasImg) {
        this.applyAtlasPropTexture(tex, atlasDef, atlasImg);
      } else {
        const propImg = this.propImages.get(kind);
        if (propImg) {
          this.applyImageToTexture(
            tex,
            propImg,
            0,
            0,
            propImg.naturalWidth,
            propImg.naturalHeight
          );
        } else {
          const crop = LAMP_SHEET_CROPS[kind];
          if (crop && this.lampsSheetImg) {
            this.applyImageToTexture(tex, this.lampsSheetImg, crop.sx, crop.sy, crop.sw, crop.sh);
          }
        }
      }
    }
    return tex;
  }

  getBattleIconDataUrl(kind: BattleIconKind): string {
    const url = BATTLE_ICON_URLS[kind];
    if (url) return url;
    let cached = this.battleIconUrls.get(kind);
    if (!cached) {
      cached = makeBattleIconCanvas(kind).toDataURL('image/png');
      this.battleIconUrls.set(kind, cached);
    }
    return cached;
  }

  dispose(): void {
    this.disposed = true;
    this.tileAtlas?.dispose();
    this.tileAtlas = null;
    this.tileAtlasNormal?.dispose();
    this.tileAtlasNormal = null;
    this.grassTexture?.dispose();
    this.grassTexture = null;
    this.grassNormalTexture?.dispose();
    this.grassNormalTexture = null;
    this.creatureCache.clear();
    this.silhouetteCache.clear();
    for (const t of this.charCache.values()) t.dispose();
    this.charCache.clear();
    this.charRequests.clear();
    for (const t of this.propCache.values()) t.dispose();
    this.propCache.clear();
    this.propImages.clear();
    this.propAtlasImages.clear();
    for (const t of this.roofCache.values()) t.dispose();
    this.roofCache.clear();
    for (const t of this.roofNormalCache.values()) t.dispose();
    this.roofNormalCache.clear();
    for (const t of this.wallCache.values()) t.dispose();
    this.wallCache.clear();
    for (const t of this.wallNormalCache.values()) t.dispose();
    this.wallNormalCache.clear();
    for (const t of this.terrainLayerCache.values()) t.dispose();
    this.terrainLayerCache.clear();
    for (const t of this.terrainLayerNormalCache.values()) t.dispose();
    this.terrainLayerNormalCache.clear();
    this.tileSheetAlbedoImg = null;
    this.tileSheetNormalImg = null;
    this.tileExtraAlbedoImg = null;
    this.tileExtraNormalImg = null;
    for (const t of this.itemTextures.values()) t.dispose();
    this.itemTextures.clear();
    this.itemImages.clear();
    this.creatureUrls.clear();
    this.silhouetteUrls.clear();
    this.souldollPairs.clear();
    this.souldollLoading.clear();
    this.souldollAttempted.clear();
    this.souldollQueue.length = 0;
    this.creatureListeners.clear();
    this.itemIconUrls.clear();
    this.charUrls.clear();
    this.playerSpriteSheetImg = null;
    this.roleSpriteSheetImgs.clear();
    this.npcSpriteSheetImgs = [null, null];
    this.battleIconUrls.clear();
  }
}
