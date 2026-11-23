import type { ProceduralAssetProvider } from '../src/gfx/AssetProvider.ts';
import type { TileAtlasKey } from '../src/gfx/ProceduralTiles.ts';
import { describe, expect, it, beforeEach } from 'vitest';

let AssetProviderCtor: new () => ProceduralAssetProvider;
let THREE: typeof import('three');

const makeMockCanvas = (): HTMLCanvasElement =>
  ({
    width: 64,
    height: 64,
    getContext: () =>
      ({
        fillRect: () => {},
        clearRect: () => {},
        drawImage: () => {},
        imageSmoothingEnabled: false,
        putImageData: () => {},
      } as any),
  } as unknown as HTMLCanvasElement);

beforeEach(async () => {
  // Entorno de navegador mínimo para Canvas/Image (Vitest corre en Node por defecto).
  (globalThis as any).document = {
    createElement: () => makeMockCanvas(),
  } as any;
  (globalThis as any).Image = class {
    naturalWidth = 64;
    naturalHeight = 64;
    src = '';
    onload: any = null;
    onerror: any = null;
    complete = true;
    decode = () => Promise.resolve();
  } as any;

  const mod = await import('../src/gfx/AssetProvider.ts');
  AssetProviderCtor = mod.ProceduralAssetProvider;
  THREE = await import('three');
});

describe('AssetProvider getTerrainLayerTexture / getTerrainLayerNormalTexture', () => {
  it('devuelve textura RepeatWrapping para cada clave de capa de terreno', () => {
    const provider = new AssetProviderCtor();
    const keys: TileAtlasKey[] = ['cliff_rock', 'mossy_stone', 'cracked_stone', 'dirt', 'sand', 'snow'];
    for (const key of keys) {
      const tex = provider.getTerrainLayerTexture(key);
      expect(tex.wrapS).toBe(THREE.RepeatWrapping);
      expect(tex.wrapT).toBe(THREE.RepeatWrapping);
      expect(tex.magFilter).toBe(THREE.NearestFilter);
      expect(tex.minFilter).toBe(THREE.NearestFilter);
      expect(tex.generateMipmaps).toBe(false);
      expect(tex.image).toBeDefined();
      expect((tex.image as HTMLCanvasElement).width).toBe(64);
      expect((tex.image as HTMLCanvasElement).height).toBe(64);
    }
  });

  it('devuelve textura normal con NoColorSpace y RepeatWrapping', () => {
    const provider = new AssetProviderCtor();
    const tex = provider.getTerrainLayerNormalTexture('mossy_stone');
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.colorSpace).toBe(THREE.NoColorSpace);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
  });

  it('reutiliza la misma instancia en caché para una misma clave', () => {
    const provider = new AssetProviderCtor();
    const a = provider.getTerrainLayerTexture('cliff_rock');
    const b = provider.getTerrainLayerTexture('cliff_rock');
    expect(b).toBe(a);
  });

  it('devuelve texturas distintas para claves distintas', () => {
    const provider = new AssetProviderCtor();
    const a = provider.getTerrainLayerTexture('dirt');
    const b = provider.getTerrainLayerTexture('sand');
    expect(b).not.toBe(a);
  });

  it('tras dispose() crea una nueva textura al solicitarla de nuevo', () => {
    const provider = new AssetProviderCtor();
    const a = provider.getTerrainLayerTexture('snow');
    provider.dispose();
    const b = provider.getTerrainLayerTexture('snow');
    expect(b).not.toBe(a);
  });
});
