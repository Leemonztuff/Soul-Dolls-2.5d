import * as THREE from 'three';
import type { BattleBiome } from '../domain/types.ts';
import { getBiomeCliffWeathering } from './DioramaLayers.ts';

export interface TerrainWeatheringUniforms {
  uWeatheringColor: { value: THREE.Color };
  uWeatheringSecondary: { value: THREE.Color };
  uWeatheringStrength: { value: number };
  uCreviceShadowStrength: { value: number };
  uTerrainAtlas: { value: THREE.Texture };
  uTerrainNormalAtlas: { value: THREE.Texture };
  uHasTerrainAtlas: { value: number };
}

export interface TerrainDioramaShaderOptions {
  terrainAtlas?: THREE.Texture | null;
  terrainNormalAtlas?: THREE.Texture | null;
}

let fallbackAlbedoTex: THREE.DataTexture | null = null;
let fallbackNormalTex: THREE.DataTexture | null = null;

function getFallbackAlbedoTexture(): THREE.DataTexture {
  if (!fallbackAlbedoTex) {
    fallbackAlbedoTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    fallbackAlbedoTex.colorSpace = THREE.SRGBColorSpace;
    fallbackAlbedoTex.needsUpdate = true;
  }
  return fallbackAlbedoTex;
}

function getFallbackNormalTexture(): THREE.DataTexture {
  if (!fallbackNormalTex) {
    fallbackNormalTex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    fallbackNormalTex.needsUpdate = true;
  }
  return fallbackNormalTex;
}

export function attachTerrainDioramaShader<T extends THREE.Material>(
  mat: T,
  biome: BattleBiome,
  options?: TerrainDioramaShaderOptions
): T {
  if (mat.userData.__terrainDioramaAttached) {
    updateTerrainDioramaBiome(mat, biome);
    updateTerrainDioramaAtlases(mat, options);
    return mat;
  }
  mat.userData.__terrainDioramaAttached = true;

  const profile = getBiomeCliffWeathering(biome);
  const hasAtlas = Boolean(options?.terrainAtlas);
  const uniforms: TerrainWeatheringUniforms = {
    uWeatheringColor: { value: profile.edgeColor.clone() },
    uWeatheringSecondary: { value: profile.secondaryColor.clone() },
    uWeatheringStrength: { value: profile.strength },
    uCreviceShadowStrength: { value: 0.38 },
    uTerrainAtlas: { value: options?.terrainAtlas ?? getFallbackAlbedoTexture() },
    uTerrainNormalAtlas: { value: options?.terrainNormalAtlas ?? getFallbackNormalTexture() },
    uHasTerrainAtlas: { value: hasAtlas ? 1.0 : 0.0 },
  };
  mat.userData.__terrainDioramaUniforms = uniforms;

  const prevOnBeforeCompile = mat.onBeforeCompile;
  const prevCacheKey = mat.customProgramCacheKey;

  mat.customProgramCacheKey = () => {
    const base = prevCacheKey ? prevCacheKey.call(mat) : '';
    return `${base}|terrain_diorama_v1_p3blend`;
  };

  mat.onBeforeCompile = (shader, renderer) => {
    if (prevOnBeforeCompile) {
      prevOnBeforeCompile.call(mat, shader, renderer);
    }

    shader.uniforms.uWeatheringColor = uniforms.uWeatheringColor;
    shader.uniforms.uWeatheringSecondary = uniforms.uWeatheringSecondary;
    shader.uniforms.uWeatheringStrength = uniforms.uWeatheringStrength;
    shader.uniforms.uCreviceShadowStrength = uniforms.uCreviceShadowStrength;
    shader.uniforms.uTerrainAtlas = uniforms.uTerrainAtlas;
    shader.uniforms.uTerrainNormalAtlas = uniforms.uTerrainNormalAtlas;
    shader.uniforms.uHasTerrainAtlas = uniforms.uHasTerrainAtlas;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 aCliffMeta;
         attribute vec4 aSurfaceBlend;
         varying vec3 vCliffMeta;
         varying vec3 vCliffWorldPos;
         varying vec4 vSurfaceBlend;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vCliffMeta = aCliffMeta;
         vSurfaceBlend = aSurfaceBlend;
         vec4 cliffWorld = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           cliffWorld = instanceMatrix * cliffWorld;
         #endif
         cliffWorld = modelMatrix * cliffWorld;
         vCliffWorldPos = cliffWorld.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uWeatheringColor;
         uniform vec3 uWeatheringSecondary;
         uniform float uWeatheringStrength;
         uniform float uCreviceShadowStrength;
         uniform sampler2D uTerrainAtlas;
         uniform sampler2D uTerrainNormalAtlas;
         uniform float uHasTerrainAtlas;
         varying vec3 vCliffMeta;
         varying vec3 vCliffWorldPos;
         varying vec4 vSurfaceBlend;

         float cliffHash12(vec2 p) {
           vec3 p3 = fract(vec3(p.xyx) * 0.1031);
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.x + p3.y) * p3.z);
         }

         float cliffQuantizedNoise(vec3 wp) {
           vec3 q = floor(wp * 16.0) / 16.0;
           float n1 = cliffHash12(q.xz * 7.1 + q.yy * 3.7);
           float n2 = cliffHash12(q.xy * 5.3 + q.zy * 4.1);
           return fract(n1 * 0.65 + n2 * 0.35);
         }

         float p3ValueNoise(vec2 p) {
           vec2 i = floor(p);
           vec2 f = fract(p);
           vec2 u = f * f * (3.0 - 2.0 * f);
           float a = cliffHash12(i);
           float b = cliffHash12(i + vec2(1.0, 0.0));
           float c = cliffHash12(i + vec2(0.0, 1.0));
           float d = cliffHash12(i + vec2(1.0, 1.0));
           return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
         }`
      )
      .replace(
        '#include <map_fragment>',
        `float p3BlendAlpha = 0.0;
         vec2 p3TargetUv = vec2(0.0);
         #include <map_fragment>
         if (uHasTerrainAtlas > 0.5 && vCliffMeta.x < 0.5 && vSurfaceBlend.y > 0.001 && abs(vSurfaceBlend.z) > 0.5) {
           vec2 p3PixelWp = floor(vCliffWorldPos.xz * 24.0) / 24.0;
           float p3N1 = p3ValueNoise(p3PixelWp * 1.85);
           float p3N2 = p3ValueNoise(p3PixelWp * 4.20 + vec2(17.3, 9.1));
           float p3N3 = cliffHash12(p3PixelWp * 13.7);
           float p3Organic = (p3N1 * 0.58 + p3N2 * 0.30 + p3N3 * 0.12) - 0.5;

           float p3Contrast = clamp(vSurfaceBlend.w, 0.7, 2.0);
           float p3HalfWin = clamp(0.16 / p3Contrast, 0.07, 0.19);
           float p3NoiseScale = 0.56 / mix(1.0, p3Contrast, 0.4);
           float p3Field = vSurfaceBlend.y + vSurfaceBlend.z * p3Organic * p3NoiseScale;
           p3BlendAlpha = smoothstep(0.5 - p3HalfWin, 0.5 + p3HalfWin, p3Field);

           if (p3BlendAlpha > 0.001) {
             float p3Slot = floor(vSurfaceBlend.x + 0.5);
             float p3Col = mod(p3Slot, 8.0);
             float p3Row = floor(p3Slot / 8.0);
             vec2 p3CellLocal = fract(vCliffWorldPos.xz + vec2(0.5));
             float p3Px = clamp(floor(p3CellLocal.x * 64.0), 0.0, 63.0);
             float p3Pz = clamp(floor(p3CellLocal.y * 64.0), 0.0, 63.0);
             p3TargetUv = vec2(
               (p3Col * 64.0 + p3Px + 0.5) / 512.0,
               1.0 - (p3Row * 64.0 + p3Pz + 0.5) / 512.0
             );
             vec3 p3TargetCol = texture2D(uTerrainAtlas, p3TargetUv).rgb;
             diffuseColor.rgb = mix(diffuseColor.rgb, p3TargetCol, p3BlendAlpha);
           }
         }

         float cliffPixNoise = cliffQuantizedNoise(vCliffWorldPos);
         float cliffBandJitter = (cliffPixNoise - 0.5) * 0.38;

         // Apply crisp pixel-art biome weathering along the top edges of 90-degree cliff faces
         // and exposed plateau cliff lips
         float wallTopBand = vCliffMeta.x * smoothstep(0.18, 0.92, vCliffMeta.y + cliffBandJitter);
         float plateauRimLip = (1.0 - vCliffMeta.x) * smoothstep(0.32, 0.85, vCliffMeta.y + cliffBandJitter * 0.65) * 0.48;
         float weatherMask = clamp(max(wallTopBand, plateauRimLip), 0.0, 1.0);

         // Quantize weathering blend into crisp pixel steps
         float weatherStep = floor(weatherMask * 4.0 + 0.5) / 4.0;
         vec3 weatherCol = mix(uWeatheringSecondary, uWeatheringColor, step(0.45, cliffPixNoise));
         diffuseColor.rgb = mix(diffuseColor.rgb, weatherCol, weatherStep * uWeatheringStrength);

         // Grounded crevice ambient shadow at the base of 90-degree cliffs & block corners
         float baseCrevice = clamp(vCliffMeta.z, 0.0, 1.0);
         float baseStep = floor(baseCrevice * 4.0 + 0.5) / 4.0;
         diffuseColor.rgb *= (1.0 - baseStep * uCreviceShadowStrength);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_OBJECTSPACE
           normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
           #ifdef FLIP_SIDED
             normal = - normal;
           #endif
           #ifdef DOUBLE_SIDED
             normal = normal * faceDirection;
           #endif
           normal = normalize( normalMatrix * normal );
         #elif defined( USE_NORMALMAP_TANGENTSPACE )
           vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
           #if defined( USE_PACKED_NORMALMAP )
             mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
           #endif
           if (uHasTerrainAtlas > 0.5 && p3BlendAlpha > 0.001) {
             vec3 p3TargetMapN = texture2D( uTerrainNormalAtlas, p3TargetUv ).xyz * 2.0 - 1.0;
             mapN = normalize(mix(mapN, p3TargetMapN, p3BlendAlpha));
           }
           mapN.xy *= normalScale;
           normal = normalize( tbn * mapN );
         #elif defined( USE_BUMPMAP )
           normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
         #endif`
      );
  };

  mat.needsUpdate = true;
  return mat;
}

export function updateTerrainDioramaAtlases(
  mat: THREE.Material,
  options?: TerrainDioramaShaderOptions
): void {
  const uniforms = mat.userData.__terrainDioramaUniforms as TerrainWeatheringUniforms | undefined;
  if (!uniforms || !options) return;
  if (options.terrainAtlas) {
    uniforms.uTerrainAtlas.value = options.terrainAtlas;
    uniforms.uHasTerrainAtlas.value = 1.0;
  }
  if (options.terrainNormalAtlas) {
    uniforms.uTerrainNormalAtlas.value = options.terrainNormalAtlas;
  }
}

export function updateTerrainDioramaBiome(mat: THREE.Material, biome: BattleBiome): void {
  const uniforms = mat.userData.__terrainDioramaUniforms as TerrainWeatheringUniforms | undefined;
  if (!uniforms) return;
  const profile = getBiomeCliffWeathering(biome);
  uniforms.uWeatheringColor.value.copy(profile.edgeColor);
  uniforms.uWeatheringSecondary.value.copy(profile.secondaryColor);
  uniforms.uWeatheringStrength.value = profile.strength;
}
