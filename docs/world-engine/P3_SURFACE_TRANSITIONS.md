# P3 — Surface Transitions & Weathering Shaders

Estado: **Implementado, unificado y verificado** (tras auditoría P1–P5).

---

## 1. Resumen Técnico

La etapa **P3** introduce transiciones orgánicas entre materiales compatibles del mismo nivel de altura (`grass`, `dirt`, `sand`, `snow`, variantes de `stone`, `cave_floor`, `flowers`, `cobble`) sin fragmentar la estética pixel-art ni crear costuras en los límites de chunk `16×16`.

---

## 2. Arquitectura y Módulos

- `src/engine/TerrainSurfaceResolver.ts`
  - **Fuente única de verdad** (`resolveTerrainTileKey`) para convertir una celda `(x, z)` en su `TileAtlasKey` final: normaliza variantes de roca por bioma/solidez (`cliff_rock`, `mossy_stone`, `cracked_stone`), `tall_grass -> grass` por defecto (o preservable con `preserveTallGrass: true`) y sobreescritura altitudinal por `map.snowLine`.
  - Consumida de forma uniforme por `TerrainMesher.ts`, `TerrainContourAnalyzer.ts`, `RockyCliffMesher.ts`, `SurfaceTransitionPlanner.ts` y `FoliageClusterPlanner.ts`.
- `src/engine/SurfaceTransitionPlanner.ts`
  - Define la matriz declarativa bidireccional `SURFACE_TRANSITION_RULES` (`getSurfaceTransitionRule`) y signo canónico por par (`getCanonicalPairSign`).
  - `planSurfaceTransitions(map, contourAnalysis)` sigue los anillos `topPolygon` generados por P1 (`center -> ring`) y respeta zonas protegidas (`stairs`, `bridge`, `water`, `arena_floor`, `buildings`, `warps`, interiores).
  - En aristas compartidas de transición entre 2 materiales, el peso de borde se mantiene simétrico en `MAX_EDGE_BLEND_WEIGHT = 0.5` para que `alpha_A + alpha_B === 1.0` a ambos lados del borde, modulando el ancho/nitidez mediante `contrast = Math.min(1.85, rule.contrast / Math.max(0.6, rule.strength))`.
- `src/engine/TerrainWeatheringShader.ts`
  - `attachTerrainDioramaShader` inyecta los atributos `aCliffMeta` (`vec3`) y `aSurfaceBlend` (`vec4`: `[targetAtlasSlot, weight, noiseSign, contrast]`) en `OverworldScene` y `BattleStage`.
  - En el fragment shader, cuantiza coordenadas mundo a `24 px/tile`, evalúa ruido fractal escalado por `contrast` centrado exactamente en `0.5`, muestrea `uTerrainAtlas` y `uTerrainNormalAtlas` (`512×512`) con *snap* exacto a texel `64×64` y aplica weathering biome-dependiente sobre caras rocosas P2 (`vCliffMeta.x >= 0.5`).
- `src/gfx/AssetProvider.ts`
  - Refresca `terrainLayerCache` / `terrainLayerNormalCache` (`refreshTerrainLayerTextures`) al completar la carga asíncrona de los sheets externos.

---

## 3. Reglas de Compatibilidad y Límites Conocidos

- **Paredes verticales P2**: las caras con `vCliffMeta.x >= 0.5` omiten intencionadamente la proyección planar XZ de P3 y emplean `strataPalette`, `talusTile`, iluminación direccional y AO por vértice (`RockyCliffMesher.ts`) para evitar estiramiento vertical de texturas.
- **Sin patrón ajedrezado**: eliminado el multiplicador `checker` en `TerrainMesher.ts` (mesetas y borde *apron*) para preservar transiciones uniformes en `grass`, `dirt` y `cave_floor`.
