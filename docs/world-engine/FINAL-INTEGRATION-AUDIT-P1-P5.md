# Auditoría Integral del Artistic World Engine (P1–P5)

- **Proyecto**: Soul-Dolls 2.5D RPG (`SoulDolls — RPG 2.5D de Marionetas`)
- **Alcance**: P1 (Organic Plateaus), P2 (Rocky Cliffs & Stratification), P3 (Terrain Blending & Shaders), P4 (Water Shoreline Geometry), P5 (Vegetation & Prop Clumping)
- **Modo**: Solo inspección — cero modificaciones de código, tests, assets o configuraciones.
- **Limitación de historial**: No existe directorio `.git` en el repositorio (`/app/applet/.git` ausente), por lo que la asignación entre archivos creados vs. modificados históricamente por etapa se infiere de la arquitectura y pruebas existentes y se marca como **No verificable por Git** donde no puede probarse sin historial de commits.

---

## A. Resumen ejecutivo

Las cinco etapas del **Artistic World Engine (P1–P5)** produjeron avances reales visibles en **P1** (contornos orgánicos de mesetas en `TerrainContourAnalyzer.ts`), **P2** (relieve estratificado 3D y cornisas con ornamentos en `RockyCliffMesher.ts` + `CliffOrnamentMesher.ts`) y la base cromática de **P3** (`SurfaceTransitionPlanner.ts` + `TerrainWeatheringShader.ts`). El proyecto compila (`npm run lint`: 0 errores, `npm run build`: exitoso en `1.28 s`) y pasa la suite actual (`npm test`: 58 archivos, 292 tests en verde) con 0 errores de consola en ejecución headless.

Sin embargo, **el conjunto P1–P5 todavía NO conforma un sistema integrado coherente ni listo para producción**:
1. **P4 (Water Shoreline Geometry) no altera la geometría de la orilla**: `TerrainContourAnalyzer.ts:266` bloquea (`vertexLocked`) todos los vértices junto a `water`, y `WaterSurface.ts:84-133` sigue generando quads ortogonales planos `1×1`. Adicionalmente, `TerrainMesher.ts:32-52, 493-506` introduce un **desgarro vertical (`0.08 u`)** en esquinas cóncavas/en L de agua (actualmente oculto porque los mapas vigentes solo usan estanques rectangulares).
2. **P3 (Terrain Blending) presenta un defecto matemático simétrico en bordes**: `TerrainWeatheringShader.ts:163` evalúa `smoothstep(0.5 - p3HalfWin, 0.5 + p3HalfWin, ...)` alrededor del umbral `0.5`, pero `SurfaceTransitionPlanner.ts:315` multiplica `0.5 * rule.strength`. Todo par con `strength < 1.0` (`cobble<->grass` `0.37`, `cliff_rock<->grass` `0.46`, `cave_floor<->cliff_rock` `0.45`, etc.) y toda unión triple (`<= 0.36`) cae por debajo de `0.5` en ambos lados del borde, produciendo un corte escalonado visible en **100 %** de los sectores en transición de `villa_origen` y `cueva_eco` y **70.3 %** de `ruta_1`.
3. **P5 (Vegetation & Prop Clumping) rompe reglas de bioma, densidad y pendiente**: `FoliageClusterPlanner.ts` ignora `map.biome`, `map.snowLine`, `map.decoration.treeKinds` y `treeDensity === 0`, spawning `snow_pine`, `mushroom_tree_arcane`, `bush` y `flower_patch` dentro de `cueva_eco` (`biome: 'cave'`, densidades en `0`) y colocando props sobre taludes escarpados (`maxDiff > 1`).
4. **Sistemas huérfanos, duplicación de análisis e inconsistencias transversales**:
   - `AssetProvider.ts:1277-1307` (`getTerrainLayerTexture` / `NormalTexture`) no tiene ningún consumidor en producción (solo su test unitario).
   - `OverworldScene.loadMap` ejecuta `analyzeTerrainContours(map)` **dos veces por carga** (`TerrainMesher.ts:353` y `CliffOrnamentMesher.ts:314`), duplicando `100–225 ms` de cálculo de contornos y anchors en mapas `48×48`.
   - `BattleStage.ts:610` construye terrenos con `buildTerrainChunks` sin adjuntar `attachTerrainDioramaShader` ni construir `WaterSurface` / `CliffOrnamentMesher`.

---

## B. Inventario real (Fase A)

> Nota: Por ausencia de `.git`, se clasifica la autoría por rol arquitectónico verificado en el código; las fechas/commits exactos de creación vs. modificación quedan como **No verificable por ausencia de `.git`**.

### B.1 Archivos de motor, gráficos, escena, datos, pruebas y documentación relacionados con P1–P5

| Capa | Archivo | Líneas | Rol verificado respecto a P1–P5 |
|---|---|---:|---|
| Motor (P1) | `src/engine/TerrainContourAnalyzer.ts` | 1324 | Clasificador morfológico (`analyzeTerrainContours`), vértices compartidos orgánicos, biseles convexos/cóncavos, relleno inferior y `rimSegments`. |
| Motor (P2) | `src/engine/RockyCliffMesher.ts` | 1225 | Mesher de paredes estratificadas, salientes (`overhang`), repisas, miters globales y extracción de anchors de ornamentos (`extractRockyCliffOrnamentAnchors`). |
| Motor (P2) | `src/engine/CliffOrnamentMesher.ts` | 503 | Consume anchors P2 (`buildCliffOrnamentsMesh`) y conserva el planificador legado (`planCliffOrnaments`). |
| Motor (P3) | `src/engine/SurfaceTransitionPlanner.ts` | 734 | Matriz declarativa de reglas (`RULE_MAP`), `resolveSurfaceMaterialKey`, cálculo de pesos y sectores por tile (`planSurfaceTransitions`). |
| Motor (P3) | `src/engine/TerrainWeatheringShader.ts` | 255 | `onBeforeCompile` con `aCliffMeta` (P2/weath/AO) y `aSurfaceBlend` (P3), lectura de `uTerrainAtlas`/`uTerrainNormalAtlas` `512×512`. |
| Motor (P4) | `src/engine/WaterSurface.ts` | 242 | Malla dedicada de superficie de agua con `ShaderMaterial`, factor `aShore` (cruz de 5 tiles), espuma y destellos HDR. |
| Motor (P5) | `src/engine/FoliageClusterPlanner.ts` | 330 | Planificador de clusters (`planFoliageClusters`) sobre `occupied` compartido con `OverworldScene`. |
| Motor (Core) | `src/engine/TerrainMesher.ts` | 1163 | Ensamblador por chunks `16×16` (`buildTerrainChunks`), apron exterior (`buildTerrainBorderApron`), lecho de agua (`shoreFactorAt`), culling (`updateVisibleTerrainChunks`) y animación UV (`updateTerrainWaterFrame`). |
| Motor (Core) | `src/engine/DioramaLayers.ts` | — | Orden de render (`DIORAMA_RENDER_ORDER`) y perfiles de weathering por bioma. |
| Motor (Core) | `src/engine/OcclusionCutout.ts` | 216 | Cutout de cámara por shader en terreno, estructuras, ornamentos y billboards. |
| Motor (Core) | `src/engine/StaircaseMesher.ts` | 315 | Escaleras 3D que comparten `terrainAtlasMat` (emite `aCliffMeta` y `aSurfaceBlend` en ceros). |
| Motor (Core) | `src/engine/BattleStage.ts` | 1172 | Consumidor secundario de `buildTerrainChunks` (sin shader P3/P2, sin agua, sin ornamentos). |
| Motor (Core) | `src/engine/BillboardBatch.ts` | 382 | Instanciación `InstancedMesh` de vegetación/props generados por scatter + P5. |
| Motor (Core) | `src/engine/Renderer.ts` | 284 | Detección de SwiftShader (`isSoftwareGl`), sombras y resolución. |
| Gráficos | `src/gfx/ProceduralTiles.ts` | 634 | Índices `TILE_ATLAS_INDEX` (`0..24`) y generación procedural de los 25 tiles `64×64`. |
| Gráficos | `src/gfx/AssetProvider.ts` | 1543 | Atlas `512×512` (`getTileAtlasTexture`), pasto dedicado (`getGrassTexture`) y helpers huérfanos `getTerrainLayerTexture` / `NormalTexture`. |
| Escena | `src/scenes/OverworldScene.ts` | 3397 | Orquestación de carga (`loadMap` L1300–1450), scatter + P5 (`collectPropPlacements` L870–1100) y loop (`stepSimulation` L2081–2090). |
| Dominio / Datos | `src/domain/TerrainRules.ts`, `src/data/propAssets.ts`, `src/data/maps/*.ts` | — | Grid lógico (`heights`, `grid`, `legend`, `isTileWalkable`), catálogo de props y definición de mapas. |
| Tests | `tests/terrain-contour.test.ts`, `tests/rocky-cliff-mesher.test.ts`, `tests/surface-transition.test.ts`, `tests/water-surface.test.ts`, `tests/foliage-cluster.test.ts`, `tests/asset-provider-terrain-layer.test.ts`, `tests/diorama-terrain.test.ts`, `tests/visual-fx.test.ts`, `tests/tiles-atlas.test.ts`, `tests/tall-grass.test.ts` | — | Cobertura unitaria de P1–P5 y terreno base. |
| Docs | `docs/world-engine/HD2D_WORLD_ENGINE_ARCHITECTURE.md`, `P1_ORGANIC_PLATEAUS.md`, `P2_ROCKY_CLIFFS.md` | — | Especificación de arquitectura global y guías de P1 y P2. **No existen documentos para P3, P4 ni P5.** |

### B.2 Clasificación solicitada

1. **Sistemas reutilizados**: `TerrainMesher` (chunks `16×16`, `pushQuad`/`pushTriangle`, culling, apron), `TerrainRules` (`getTileHeightLevel`, `isTileWalkable` como fuente lógica), `AtlasBuilder` + `ProceduralTiles`, `BillboardBatch` (`InstancedMesh` para P5), `OcclusionCutout` y `WaterSurface` (evolucionado sobre el mesh de agua previo).
2. **Sistemas duplicados**:
   - **Resolución de material de superficie (5 copias divergentes)**: `TerrainMesher.ts:69-99` (`resolveTerrainTileKey`), `TerrainContourAnalyzer.ts:135-161`, `RockyCliffMesher.ts:178-193`, `SurfaceTransitionPlanner.ts:112-144` (`resolveSurfaceMaterialKey`) y `TerrainMesher.ts:1035-1046` (apron). Ejemplo de divergencia: `SurfaceTransitionPlanner.ts:118,138` convierte `tall_grass -> grass` y `flowers -> snow` sobre `snowLine`, mientras `TerrainMesher.ts:404,93` mantiene `flowers` fuera de `snowLine` (si hay transición de otro tile sí, si no renderiza flores sobre nieve).
   - **Análisis de contornos y miters P1/P2 (2 ejecuciones completas por mapa)**: `TerrainMesher.ts:353` ejecuta `analyzeTerrainContours(map)` y `CliffOrnamentMesher.ts:314` vuelve a ejecutar `analyzeTerrainContours(map)` y `extractRockyCliffOrnamentAnchors(map, contourAnalysis)` recalculando columnas/miters por separado.
   - **Población de vegetación (2 pasos desconectados en `OverworldScene.ts:957-1097`)**: scatter tile-a-tile legado + `planFoliageClusters` (P5) encima.
   - **Planificación de ornamentos (2 implementaciones)**: legado `planCliffOrnaments` (`CliffOrnamentMesher.ts:55`, basado en `detectCliffBoundaries`, solo usado en `tests/diorama-terrain.test.ts:197,224`) vs. runtime P2 `buildCliffOrnamentsMesh` (`CliffOrnamentMesher.ts:308`).
3. **Sistemas sin integrar / código huérfano**:
   - `AssetProvider.getTerrainLayerTexture()` y `AssetProvider.getTerrainLayerNormalTexture()` (`src/gfx/AssetProvider.ts:61-62, 1277-1307`): cero usos en `src/`. `TerrainWeatheringShader.ts:166-176` lee directamente del atlas `512×512`.
   - `CliffOrnamentAnchor` y `Plan` de `P3/P4/P5` en `BattleStage.ts:610`: la arena 3D de combate usa `buildTerrainChunks` sin shader P3 (`attachTerrainDioramaShader`), sin `WaterSurface` y sin ornamentos P2.
   - `FoliageClusterPlan.clusters[i].kind` (`'forest' | 'riverside' | 'meadow' | 'rocky'`): asignado en `FoliageClusterPlanner.ts:305-309` e **ignorado completamente** dentro de `buildCluster` (`L122-217`).
4. **Sistemas reemplazados**:
   - Acantilados ortogonales de `TerrainMesher.ts:764-852` (`detectCliffBoundaries`): siguen activos **solo cuando `organic === false`** (interiores), reemplazados en exteriores por `TerrainContourAnalyzer` + `RockyCliffMesher` (`L756-758`).
   - Animación por frame de UVs de agua en `TerrainMesher.ts:918-931` (`updateTerrainWaterFrame`), visualmente cubierta por el `WaterSurface` opaco/translúcido (`alpha 0.72–0.84` encima a `+0.045` + `0.16` = `+0.205` en aguas profundas).
5. **Funcionalidades documentadas o nominales sin implementación verificable**:
   - **Documentación P3, P4, P5**: inexistente en `/docs/world-engine/`.
   - **Reconstrucción localizada por chunk / incremental**: no existe API de rebuild de un solo chunk; `buildTerrainChunks` recalcula `analyzeTerrainContours(map)` y `planSurfaceTransitions(map)` para todo el mapa de una sola vez (`TerrainMesher.ts:353-355`).
   - **Geometría orgánica de línea de costa (P4)**: las esquinas de agua siguen bloqueadas a grilla `1×1` cuadrada tanto en terreno (`TerrainContourAnalyzer.ts:266`) como en superficie (`WaterSurface.ts:110-133`).
   - **Exclusión/composición dependiente de bioma y costa en P5**: `FoliageClusterPlanner.ts` no consulta `map.biome`, ni `map.snowLine`, ni proximidad de agua para `'riverside'`, ni límites de pendiente.

---

## C. Estado por etapa (Fase B)

### P1 — Plateau Geometry & Organic Edges (`TerrainContourAnalyzer.ts` + `TerrainMesher.ts`)

| Criterio | Estado | Evidencia verificada |
|---|---|---|
| Generación geométrica real (no solo textura) | **Cumplido** | Modifica vértices de `topPolygon` (`SW -> SE -> NE -> NW`, con biseles de esquina en ángulo ~45° y vértices de borde con offset normal acotado `computeTileOffsetCap`) y rellena el espacio inferior expuesto con `lowerFloorQuads`/`lowerFloorTris`. Comprobado en `04-ruta-2.png` y `05-cueva-eco.png`. |
| Continuidad de vértices compartidos & entre chunks | **Cumplido** | El análisis se ejecuta en grilla global `(width+1)×(height+1)` (`TerrainContourAnalyzer.ts:547+`), produciendo `0` errores en `tests/terrain-contour.test.ts` (seams entre chunks, vértices compartidos y `isPlainInterior`). |
| Determinismo & coordenadas globales | **Cumplido** | Hash puro `hashGrid2D(vx, vz, seed, salt)` (`L78-85`), independiente del chunking. Verificado en test de determinismo. |
| Conservación de alturas lógicas & ausencia de degenerados | **Cumplido** | `topY` usa siempre `tileLevel * HEIGHT_UNIT`; `buildTerrainChunks` y `tests/terrain-contour.test.ts` validan áreas mínimas y normal `+Y`. |
| Reconstrucción localizada (single-chunk) | **No implementado** | `buildTerrainChunks` reconstruye todo el mapa (`TerrainMesher.ts:340-355`). |
| Defectos / Fricciones P1 | **Observado** | (1) `TerrainContourAnalyzer.ts:266` bloquea (`vertexLocked = 1`) **cualquier vértice adyacente a `water`**, impidiendo que P1 suavice riberas (acoplado con P4). (2) El tinte ajedrezado `checker = (x + z) % 2 === 0 ? 1.0 : 0.965` (`TerrainMesher.ts:423`) genera un patrón de damero muy visible sobre `grass` (`01-test-riverbank.png`), `dirt` (`04-ruta-2.png`) y `cave_floor` (`05-cueva-eco.png`), y en los límites P3 colapsa a `seamNeutralShade = 0.9825`. |

### P2 — Cliff Relief & Stratification (`RockyCliffMesher.ts` + `CliffOrnamentMesher.ts`)

| Criterio | Estado | Evidencia verificada |
|---|---|---|
| Relieve geométrico real, estratificación, salientes y repisas | **Cumplido** | `RockyCliffMesher.ts` genera columnas verticales por bandas estratificadas (`MAX_CLIFF_BAND_HEIGHT`), repisa superior biselada (`rimCap`), labio saliente (`overhang`) cuando `drop >= 0.45`, y zócalo inferior/talus. Comprobado en `01-test-riverbank.png`, `04-ruta-2.png`, `05-cueva-eco.png`. |
| Esquinas interiores/exteriores y normales | **Parcial / Con micro-fisuras visuales** | `buildGlobalMiterLookup` (`RockyCliffMesher.ts:835`) calcula miters globales, pero en inspección visual de `04-ruta-2.png` y `05-cueva-eco.png` aparecen **pequeñas rendijas verticales brillantes (1–3 px de cielo/fondo)** en uniones de esquina/base de terrazas rocosas (p. ej. terrazas medias izquierda/derecha en `04-ruta-2.png`). Asimismo, las escaleras (`StaircaseMesher.ts`) junto a acantilados orgánicos quedan ortogonales mientras el borde vecino se bisela. |
| Integración con P1 y materiales | **Parcial** | Consume directamente `contour.rimSegments`; sin embargo, `RockyCliffMesher.ts:813-815` emite `aSurfaceBlend = (0,0,0,0)` fijo, por lo que no hay transición P3 entre pared rocosa y base/cima. |
| Costos geométricos y duplicación | **Problema P1** | `CliffOrnamentMesher.ts:314-315` vuelve a ejecutar `analyzeTerrainContours(map)` y `extractRockyCliffOrnamentAnchors(map, contourAnalysis)` fuera de `TerrainMesher`, repitiendo el análisis completo de contornos y miters. Además `CliffOrnamentMesher.ts:491` agrupa todos los ornamentos del mapa en una sola malla sin chunking. |

### P3 — Terrain Blending & Shaders (`SurfaceTransitionPlanner.ts` + `TerrainWeatheringShader.ts`)

| Criterio | Estado | Evidencia verificada |
|---|---|---|
| Matriz de compatibilidad y materiales definidos | **Implementado con defecto matemático** | `RULE_MAP` (`L49-85`) y `protectedFlags` (`L194-238`, bloqueando `water`, `stairs`, `bridge`, `arena_floor`, `ramp`, edificios y warps) funcionan conceptualmente; **`cobble` sí está en `RULE_MAP` (`L81-84`)** con `strength = 0.72..0.82`. |
| Mezcla simétrica continua entre tiles | **Roto por diseño (`P0`)** | En `TerrainWeatheringShader.ts:163`, la mezcla usa `smoothstep(0.5 - p3HalfWin, 0.5 + p3HalfWin, vSurfaceBlend.y + vSurfaceBlend.z * p3Organic * 0.56)`. Para que `A->B` y `B->A` sumen continuo en el borde, `vSurfaceBlend.y` debe ser **exactamente `0.5`** en la arista. Pero `SurfaceTransitionPlanner.ts:315` define `weight = 0.5 * rule.strength` y `L408-413` `TRIPLE_JUNCTION_WEIGHT * (weight / 0.5)` (`<= 0.36`). Resultado: en **100 %** de transiciones de `villa_origen` (2,104/2,104 sectores) y `cueva_eco` (2,048/2,048), y **70.3 %** de `ruta_1` (1,540/2,192), `weight < 0.5` en ambos lados del borde, causando un salto escalonado en el límite recto de tile visible en `01-test-riverbank.png`, `02-villa-origen.png` y `03-pueblo-bruma.png` (`cobble<->grass` con `weight = 0.37`). |
| Integración con atlas y estética pixel-art | **Cumplido con código muerto paralelo** | El fragment shader cuantiza `vCliffWorldPos.xz` a `24 px/tile` (`L154`) y muestrea `uTerrainAtlas`/`uTerrainNormalAtlas` `512×512` con snap exacto a texel `64×64` (`L169-175`). Pero `AssetProvider.getTerrainLayerTexture/NormalTexture` quedó totalmente huérfano sin refresco tras carga asíncrona de `tiles_5x5_*.png`. |
| Compatibilidad P1 y P2 | **Parcial** | Sigue `contour.topPolygon` (`L479`), pero cuando un tile tiene `uniqueTargets.length > 1` (`TerrainMesher.ts:596-635`: 43 tiles en `test_riverbank`), emite triángulos desindexados (`3` vértices nuevos por sector) y los tiles `lowerFloorQuads`/`Tris` (`TerrainMesher.ts:696,737`) nunca reciben transición. |
| Costo de shader y atributos | **Moderado-Alto** | Añade `aSurfaceBlend` (`vec4`, 16 B/vértice) + `aCliffMeta` (`vec3`, 12 B/vértice) -> **72 bytes/vértice** totales en todo chunk de terreno, aunque las mesas de edificios/escaleras también usen materiales sin transición P3. |

### P4 — Water Shoreline Geometry (`WaterSurface.ts` + `TerrainMesher.ts` + `TerrainContourAnalyzer.ts`)

| Criterio | Estado | Evidencia verificada |
|---|---|---|
| Geometría orgánica de costa (no rectángulos `1×1`) | **NO implementado (`P0`)** | `TerrainContourAnalyzer.ts:266` bloquea (`vertexLocked[vIdx] = 1`) todo vértice adyacente a `water`. `WaterSurface.ts:83-133` emite estrictamente quads planos `1×1` (`[x-0.5, x+0.5] × [z-0.5, z+0.5]`) a `y = level * 0.5 + 0.045`. Verificado visualmente en `01-test-riverbank.png` y `04-ruta-2.png`: esquinas ortogonales de 90° en orillas y diques. |
| Lecho subacuático y continuidad topológica | **Defecto latente (`P1`)** | `shoreFactorAt` (`TerrainMesher.ts:32-52, 498-505`) solo consulta 2 vecinos ortogonales por esquina (`dx1/dz1`, `dx2/dz2`) ignorando el tile diagonal. En una esquina cóncava / en L de agua, los tiles adyacentes calculan alturas distintas (`-0.16` vs `-0.08`), generando una **grieta vertical verificada de `0.08 u`** (0 instancias en los mapas actuales únicamente porque todos sus estanques son rectángulos sin concavidades). |
| Espuma, profundidad, animación y renderOrder | **Funcional (solo shader)** | `aShore` (`WaterSurface.ts:84-106`) usa una cruz de 5 tiles en `[0, 0.40..1.0]` para gradiente somero/profundo, espuma animada y destellos HDR. `mesh.renderOrder = 3` (`L226`) está hardcodeado en lugar de usar `DIORAMA_RENDER_ORDER.WATER_SURFACE`. |
| Redundancia con lecho animado | **Observado** | `OverworldScene.ts:2089` sigue llamando a `updateTerrainWaterFrame(this.chunks, this.waterFrame)` cada `0.45 s` actualizando UVs de quads sumergidos ocultos bajo `WaterSurface`. |

### P5 — Vegetation & Prop Clumping (`FoliageClusterPlanner.ts` + `OverworldScene.ts`)

| Criterio | Estado | Evidencia verificada |
|---|---|---|
| Determinismo e integración con `occupied` / `blockedTiles` | **Cumplido** | Seed `map.decoration.seed ^ 0x464f4c49`; lee `occupied` compartido tras el scatter legado y marca `this.blockedTiles` para `solidProps` (`OverworldScene.ts:1074-1097`). |
| Respeto a bioma, `snowLine` y densidades del mapa | **Roto (`P0`)** | `FoliageClusterPlanner.ts:22-36, 166, 180, 195` elige aleatoriamente de catálogos globales fijos (`TREE_KINDS` incluye `snow_pine` y `mushroom_tree_arcane`; `ROCK_KINDS` incluye `crystal`) e ignora `map.biome`, `map.snowLine`, `map.decoration.treeKinds` y `treeDensity === 0`. En **`cueva_eco`** (`biome: 'cave'`, densidades `0`), P5 genera **8 clusters / 46 props** (`pine: 3`, `mushroom_tree: 4`, `mushroom_tree_arcane: 1`, `bush: 11`, `bush_arcane: 9`, `flower_patch: 7`, `stump: 4`). Confirmado visualmente en `05-cueva-eco.png` y `02-villa-origen.png` (`snow_pine` + `mushroom_tree_arcane` en pradera de inicio). |
| Restricciones de pendiente, bordes de agua y acantilados | **Roto (`P1`)** | `tileIsFree` (`L110-120`) solo valida `isTileWalkable` e `!isPathTile`. No verifica pendiente cardinal (`maxDiff > 1`, a diferencia del scatter legado `OverworldScene.ts:983-990`) ni márgenes junto a acantilados/agua. Resultado empírico sobre mapas reales: **18 props en taludes escarpados** en `pueblo_bruma`, **12** en `cueva_eco` y **9** en `villa_origen`. |
| Composición por tipo de cluster y arquitectura | **Incompleto** | `clusterKind` (`'forest'|'riverside'|'meadow'|'rocky'`, `L305-309`) jamás se usa en `buildCluster` (`L122-217`); todos los clusters tienen idéntica receta (`1 árbol + 2-3 arbustos + 1-2 rocas + 0-2 flores`). Además `L132` (`void baseY`) y `L154-156` (`if (solid) {}`) son restos muertos. |
| Instanciación y render (`BillboardBatch.ts`) | **Observado (fricción menor)** | `BillboardBatch.ts:342-379` fuerza `instanceMatrix.needsUpdate = true` cada frame para `isFixedDecor` aunque `yaw` no cambie; y `propAssets.ts` marca `atlas_arbolmanzano_00` con `grass: true`, haciendo oscilar su copa como pasto al acercarse el jugador. |

---

## D. Integración global (Fase C)

### D.1 Matriz de interacción por pares (P1–P5)

| Par | Estado | Diagnóstico verificado |
|---|---|---|
| **P1 + P2** | **Funcional con micro-fisuras** | `RockyCliffMesher` consume `contour.rimSegments` y `buildGlobalMiterLookup`; en `04-ruta-2.png` se ven uniones de bisel P1+P2 con sliver de 1–3 px en terrazas medias. |
| **P1 + P3** | **Funcional en geometría, roto en borde** | `SurfaceTransitionPlanner` hereda `contour.topPolygon` (`L479`), pero el umbral `0.5` rompe transiciones `strength < 1.0`. `lowerFloorQuads`/`Tris` no participan en P3. |
| **P1 + P4** | **Bloqueado / No integrado** | `TerrainContourAnalyzer.ts:266` congela vértices junto a agua (`vertexLocked = 1`), anulando cualquier contorno orgánico en costas. |
| **P2 + P3** | **Sin integración** | `RockyCliffMesher.ts:814` rellena `aSurfaceBlend` con ceros; el shader omite P3 cuando `vCliffMeta.x >= 0.5` (`TerrainWeatheringShader.ts:153`). |
| **P2 + P4** | **Rígido (ortogonal)** | Donde agua toca un acantilado (`04-ruta-2.png`, `01-test-riverbank.png`), el corte es una caja recta sin transición ni perfil costero rocoso. |
| **P2 + P5** | **Conflicto (`P1`)** | Sin filtro de pendiente en `FoliageClusterPlanner`, P5 coloca `9–18` props por mapa en tiles con `maxDiff > 1` junto a crestas P2. |
| **P3 + P4** | **Sin transición costera** | Tiles protegidos (`water`) están excluidos de `SurfaceTransitionPlanner` (`L208`), sin transición tierra/arena húmeda-seca en orillas (`01-test-riverbank.png`). |
| **P3 + P5** | **Desacoplado** | `FoliageClusterPlanner` no consulta materiales reales (`resolveSurfaceMaterialKey`), `snowLine` ni transiciones P3. |
| **P4 + P5** | **Parcial** | P5 evita colocar props *dentro* de tiles `water` (`isPathTile` + `isTileWalkable`), pero `'riverside'` nunca busca cercanía real al agua. |

### D.2 Flujo global, orden de generación y fuentes de verdad

En `OverworldScene.loadMap` (`L1300-1450`), el orden actual es:
1. `buildTerrainChunks(map, terrainAtlasMat, grassMat)` -> ejecuta **`analyzeTerrainContours(map)` (#1)** + `planSurfaceTransitions(map)` + `RockyCliffBuildContext(map)`.
2. `buildTerrainBorderApron(map, ...)` -> anillo exterior.
3. `new WaterSurface(scene, mapDisposables, map)` -> malla de agua plana `1×1`.
4. `buildInteriorWallsMesh`, `buildBuildingsMesh`, `buildMapGatesGroup`, `buildStaircaseMeshes`.
5. `buildCliffOrnamentsMesh(map, cliffOrnamentMat)` -> ejecuta **`analyzeTerrainContours(map)` (#2)** + `extractRockyCliffOrnamentAnchors(map)`.
6. `collectPropPlacements(map)` -> scatter legado tile-a-tile -> `collectBorderApronProps` -> `planFoliageClusters(map, { occupied })` -> `buildInstancedPropBatches`.

- **Dependencias circulares**: Ninguna detectada en módulos `src/engine/`.
- **Fuentes de verdad**:
  - **Altura lógica y colisión estática**: `src/domain/TerrainRules.ts` (`getTileHeightLevel`, `isTileWalkable`, `isInsideBuilding`).
  - **Colisión dinámica de props**: `OverworldScene.blockedTiles` (nutrido por scatter + `clusterPlan.solidProps`).
  - **Material visual de superficie**: **Fragmentado** en 5 resolvedores distintos (ver §B.2).
  - **Gestión y liberación de memoria**: `OverworldScene.ts` registra geometrías, materiales y texturas en `this.mapDisposables` (`L1326-1448`); en uso standalone, `buildCliffOrnamentsMesh` adjunta `createdTexture`/`createdMaterial` en `group.userData` (`CliffOrnamentMesher.ts:497-498`).

---

## E. Integridad del mundo lógico (Fase D)

**Resultado general: Íntegro y sin regresión de colisiones/navegación, con un desajuste visual menor en alturas muestreadas sobre biseles P1.**

Verificación directa sobre `src/domain/TerrainRules.ts` (`L5-143`) y ejecución de `tests/map-passages.test.ts` + `npm test`:
- **Grid lógico, coordenadas, navegación, colisiones, caminos, puentes, escaleras, warps y spawns**: Todos consumen `map.grid`, `map.heights`, `map.legend`, `map.buildings`, `map.props`, `map.signs`, `map.warps` mediante `TerrainRules.ts`. Ni P1, P2, P3 ni P4 modifican `map.heights`, `map.grid` ni `isTileWalkable`.
- **Bloqueo dinámico P5**: `OverworldScene.ts:1087` añade `solidProps` a `this.blockedTiles`; dado que `FoliageClusterPlanner.ts:144-146` respeta `occupied` (que incluye `warps ±1`, `npcs ±1`, rutas de patrulla y `buildings ±1`), P5 no bloquea pasajes, puertas ni warps (verificado en los 58 suites de test incluyendo `map-passages.test.ts`, aunque no existe test específico que pruebe conectividad BFS tras `OverworldScene.collectPropPlacements` con P5).
- **Acoplamiento visual-lógico en biseles P1**: Al caminar sobre un tile biselado en su esquina (`topPolygon` recortado hacia adentro respecto al centro del cuadrado `1×1`), la interpolación de altura lógica `sampleInterpolatedHeight` (`TerrainRules.ts:19-45`) interpola linealmente sobre la grilla ortogonal `heights` sin conocer la línea de corte del acantilado P1/P2, pudiendo provocar un leve hundimiento/flotación visual de `~0.1–0.25 u` al pisar exactamente el borde recortado de una esquina biselada.

---

## F. Rendimiento y memoria (Fase E)

### F.1 Métricas empíricas medidas por mapa (diagnóstico `npx tsx -e` sobre estado real)

| Mapa | Grid | Chunks | Vértices totales | Max Vért/Chunk | Triángulos (Atlas / Pasto) | Apron (V / T) | Ornam. P2 (V / T) | P1 Cont. / Rims / LowFill | P3 Tiles (Multi) | Agua | Tiempos CPU ms (`Cont / P3 / Chunks / Orn`) |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---|
| `villa_origen` | 48×48 | 9 | 66,749 | 12,060 | 36,450 (26,214 / 10,236) | 10,384 / 5,192 | 8,464 / 4,232 | 930 / 2,375 / 2,370 | 522 (7) | 25 | `54.4 / 22.2 / 349.0 / 224.8` |
| `ruta_1` | 48×56 | 12 | 81,148 | 10,347 | 44,000 (31,157 / 12,843) | 11,088 / 5,544 | 10,460 / 5,230 | 1,152 / 2,920 / 2,916 | 543 (4) | 30 | `37.6 / 13.4 / 240.8 / 163.4` |
| `pueblo_bruma` | 48×48 | 9 | 57,036 | 10,412 | 31,107 (24,040 / 7,067) | 10,384 / 5,192 | 6,152 / 3,076 | 889 / 1,845 / 1,675 | 400 (0) | 24 | `22.2 / 6.6 / 162.1 / 100.1` |
| `ruta_2` | 56×48 | 12 | 85,909 | 10,834 | 46,553 (45,849 / 704) | 11,088 / 5,544 | 10,688 / 5,344 | 1,233 / 3,131 / 3,085 | 572 (4) | 126 | `43.0 / 10.0 / 250.5 / 195.1` |
| `cueva_eco` | 48×48 | 9 | 86,327 | **13,950** | 45,697 (45,697 / 0) | 10,384 / 5,192 | 11,200 / 5,600 | 1,172 / 3,072 / 3,050 | 519 (0) | 0 | `51.0 / 10.2 / 233.3 / 133.5` |
| `arena_cumbre` | 48×48 | 9 | 61,413 | 12,689 | 32,527 (28,392 / 4,135) | 10,384 / 5,192 | 7,744 / 3,872 | 954 / 2,202 / 2,124 | 58 (0) | 0 | `24.9 / 2.3 / 130.3 / 110.6` |
| `test_riverbank` | 32×32 | 4 | 16,322 | 5,643 | 8,836 (6,086 / 2,750) | 7,568 / 3,784 | 940 / 470 | 149 / 316 / 293 | 278 (43) | 27 | `6.7 / 5.3 / 37.9 / 26.9` |
| `laboratorio_origen` (int) | 18×13 | 2 | 936 | — | 468 | 0 | 0 | 0 | 0 | 0 | `< 2 ms` |

### F.2 Análisis de memoria, shader, draw calls y cuellos de botella

- **Huella de atributos por vértice (terreno)**: `position` (12 B) + `normal` (12 B) + `uv` (8 B) + `color` (12 B) + `aCliffMeta` (12 B) + `aSurfaceBlend` (16 B) = **72 bytes/vértice** + índices `Uint16`. En `cueva_eco`, el conjunto terreno + apron + ornamentos suma ~107.9k vértices (~7.7 MB de vertex buffers). El pico por chunk (`13,950` verts) se mantiene seguro por debajo del tope de `20,000` verts de los tests y del límite `65,535` de `Uint16`.
- **Multiplicación geométrica P1 + P2 + P3**:
  - P2 aporta la mayor carga de vértices por mapa en zonas montañosas (`cueva_eco` alcanza `45,697` triángulos por estratificación y salientes).
  - En P3, los tiles con múltiples vecinos compatibles (`uniqueTargets.length > 1`: `43` tiles en `test_riverbank`) desindexan sus abanicos y triplican vértices locales frente al anillo indexado.
- **Costo de carga redundante**: En `villa_origen`, `buildCliffOrnamentsMesh` suma **`224.8 ms`** extra (además de los `349.0 ms` de `buildTerrainChunks`) principalmente por re-ejecutar `analyzeTerrainContours` + `extractRockyCliffOrnamentAnchors` desde cero.
- **Draw calls y culling**:
  - Cada chunk de terreno con atlas + pasto emite 2 grupos (`drawCalls`), pero `updateVisibleTerrainChunks` (`TerrainMesher.ts:901-916`) aplica culling por distancia (`viewRadius = 48`) y frustum.
  - `CliffOrnamentMesher`, `WaterSurface`, `StaircaseMesher` y `BorderApron` son mallas únicas por mapa sin culling por chunk.
  - `BillboardBatch.ts:342-379` re-sube matrices GPU (`instanceMatrix.needsUpdate = true`) cada frame para todo grupo marcado `isFixedDecor` aunque la cámara esté inmóvil.
- **PostFX / Sombras (limitación de medición GPU)**: En hardware real, `OverworldPostFx` realiza pase previo `sceneDepthTarget` (duplicando draw calls de geometría), mientras que bajo SwiftShader (`Renderer.ts:102-108`) se deshabilita `shadowMap` y el post-proceso por defecto, por lo que **la memoria GPU real en driver físico y FPS con sombras/PostFX activos son No verificables en este entorno**.
- **Tamaño de bundle (`npm run build`)**: `dist/assets/index-H1kKN54p.js` pesa **`2,217.24 kB`** (`584.39 kB` gzip), disparando advertencia de Vite (>500 kB), aunque el impacto principal proviene de Three.js y el catálogo del RPG, no solo de P1–P5.

---

## G. Validación visual en navegador (Playwright `1440×900`)

Se inspeccionaron en navegador vivo (`http://localhost:3000/?testmap=...`, `0` console errors, `0` console warnings) 5 mapas representativos:
1. **`test_riverbank`**:
   - **Confirmado visualmente P4**: El cuerpo de agua a la derecha es un **rectángulo rígido de esquinas de 90°** recortado directamente contra la tierra y la base del acantilado, sin curva orgánica de costa.
   - **Confirmado visualmente P3 + checker**: El pasto en primer plano muestra una cuadrícula damero clara/oscura visible; la transición `cobble<->grass` presenta borde serrado abrupto con halo oscuro a lo largo de la arista de celda.
   - **Confirmado visualmente P1 + P2**: Terrazas elevadas con bordes orgánicos, estratificación rocosa y ornamentos de musgo colgando de la cornisa.
2. **`villa_origen`**:
   - **Confirmado visualmente P5**: A la derecha del pueblo (bioma `'meadow'`, `snowLine: 8`) aparece un **pino nevado (`snow_pine`)** junto a un **hongo arcano gigante (`mushroom_tree_arcane`)** y arbustos morados.
   - **Confirmado visualmente P3**: El contorno entre la plaza de `cobble` y el `grass` circundante exhibe corte escalonado cuadrado (sin difuminado continuo por `weight = 0.37 < 0.5`).
3. **`pueblo_bruma`**:
   - **Confirmado visualmente P3**: Mismo corte escalonado `cobble<->grass` frente al muro norte; escaleras `StaircaseMesher` limpias.
4. **`ruta_2`**:
   - **Confirmado visualmente P1 + P2**: Contornos ondulados de mesetas rocosas bien definidos, pero con **rendijas/pinholes verticales blancos de 1–3 px** donde asoma el fondo en las juntas de terrazas medias izquierda y derecha, y fuerte patrón ajedrezado en el suelo de `dirt`.
   - **Confirmado visualmente P4**: Canal/estanque frontal completamente rectangular limitado por un puente recto y muro de piedra recto.
   - **Confirmado visualmente P5**: Cluster en margen izquierdo mezclando `weeping_willow`, `snow_pine`, `bush_arcane` y seta roja en bioma de montaña.
5. **`cueva_eco`**:
   - **Confirmado visualmente P5 (`P0`)**: A la izquierda dentro de la caverna subterránea (`biome: 'cave'`, densidades `0`) aparece un **`mushroom_tree_arcane` gigante** y al fondo junto al portal se distinguen **arbustos verdes/morados**, además del borde duro del camino `stone` frente al `cave_floor` cuadriculado.
   - **Confirmado visualmente P2**: Estalactitas/ornamentos de cristal y grietas se alinean correctamente en los bordes estratificados P1+P2.

---

## H. Registro de problemas (P0–P3)

| ID | Severidad | Etapa(s) | Archivo(s) y líneas | Descripción y evidencia | Estado de verificación |
|---|---|---|---|---|---|
| **AUD-01** | **P0** | P3 | `src/engine/SurfaceTransitionPlanner.ts:12-16, 49-84, 315, 408-413`; `src/engine/TerrainWeatheringShader.ts:163` | `smoothstep` centrado en `0.5`, pero `weight = 0.5 * strength` y triples `<= 0.36` producen `weight < 0.5` en ambos lados del borde para todo par con `strength < 1.0`. Afecta al **100 %** de transiciones de `villa_origen` y `cueva_eco` y **70.3 %** de `ruta_1`. Confirmado visualmente en `cobble<->grass`. | **Confirmado** |
| **AUD-02** | **P0** | P4 / P1 | `src/engine/WaterSurface.ts:84-133`; `src/engine/TerrainContourAnalyzer.ts:266` | P4 no implementa geometría de línea de costa orgánica: los vértices junto a `water` se bloquean (`vertexLocked = 1`) y `WaterSurface` genera únicamente quads rectos `1×1`. Confirmado en `01-test-riverbank.png` y `04-ruta-2.png`. | **Confirmado** |
| **AUD-03** | **P0** | P5 | `src/engine/FoliageClusterPlanner.ts:22-36, 166, 180, 195, 219-317`; `src/scenes/OverworldScene.ts:1074-1097` | `planFoliageClusters` ignora `map.biome`, `map.snowLine`, `map.decoration.treeKinds` y densidades `0`. Genera **46 props de bosque/pradera dentro de `cueva_eco`** (`pine`, `mushroom_tree_arcane`, `bush`, `flower_patch`) y `snow_pine`/`crystal` en `villa_origen`. Confirmado visualmente en `05-cueva-eco.png` y `02-villa-origen.png`. | **Confirmado** |
| **AUD-04** | **P1** | P5 / P2 | `src/engine/FoliageClusterPlanner.ts:110-120` | `tileIsFree` no valida pendiente (`maxDiff > 1`) ni separación de acantilados/agua. Coloca **18** props en taludes escarpados en `pueblo_bruma`, **12** en `cueva_eco` y **9** en `villa_origen`. | **Confirmado** |
| **AUD-05** | **P1** | P4 | `src/engine/TerrainMesher.ts:32-52, 493-506` | `shoreFactorAt` evalúa solo 2 vecinos ortogonales por esquina ignorando el tile diagonal, provocando una **grieta vertical de `0.08 u`** en esquinas cóncavas/en L de agua (comprobado en mapa L sintético; 0 en mapas vigentes por usar solo estanques rectangulares). | **Confirmado** |
| **AUD-06** | **P1** | P2 / Rendimiento | `src/engine/CliffOrnamentMesher.ts:314-315`; `src/engine/TerrainMesher.ts:353` | `OverworldScene.loadMap` ejecuta `analyzeTerrainContours(map)` **dos veces por mapa** y repite la extracción de miters/anchors para ornamentos, añadiendo `100–225 ms` redundantes por carga. | **Confirmado** |
| **AUD-07** | **P1** | P2 | `src/engine/RockyCliffMesher.ts` (juntas de miter/estrato) | En inspección visual de `04-ruta-2.png` y `05-cueva-eco.png`, aparecen pinholes/rendijas verticales brillantes (`1–3 px`) en juntas de acantilados P2. | **Confirmado visualmente** |
| **AUD-08** | **P1** | P3 / Gráficos | `src/gfx/AssetProvider.ts:61-62, 540-589, 1277-1307` | `getTerrainLayerTexture()` y `getTerrainLayerNormalTexture()` están completamente huérfanos en producción y no se actualizan en `albedoSheetImg.onload` / `normalSheetImg.onload`. | **Confirmado** |
| **AUD-09** | **P2** | P1–P3 / Arquitectura | `TerrainMesher.ts:69,1035`; `TerrainContourAnalyzer.ts:135`; `RockyCliffMesher.ts:178`; `SurfaceTransitionPlanner.ts:112` | 5 resolvedores de material duplicados con reglas divergentes (`tall_grass` y `flowers` tratados distinto sobre `snowLine`). | **Confirmado** |
| **AUD-10** | **P2** | P1–P3 | `src/engine/BattleStage.ts:610` | `BattleStage` usa `buildTerrainChunks` sin `attachTerrainDioramaShader`, sin `WaterSurface` y sin ornamentos P2. | **Confirmado** |
| **AUD-11** | **P2** | P1 / P3 | `src/engine/TerrainMesher.ts:423-426, 578, 607, 696, 737` | Tinte ajedrezado `checker` (`1.0 / 0.965`) crea patrón de grilla visible en `grass`, `dirt` y `cave_floor`, y `lowerFloorQuads`/`Tris` carecen de mezcla P3. | **Confirmado** |
| **AUD-12** | **P2** | P2 / P3 | `src/engine/RockyCliffMesher.ts:814`; `src/engine/TerrainWeatheringShader.ts:153` | Paredes P2 emiten `aSurfaceBlend = 0` sin transición base/cima hacia el suelo orgánico. | **Confirmado** |
| **AUD-13** | **P2** | P5 | `src/engine/FoliageClusterPlanner.ts:122-217, 305-309`; `src/scenes/OverworldScene.ts:957-1097` | Doble pipeline de vegetación (scatter + P5) y `clusterKind` (`'forest'|'riverside'|'meadow'|'rocky'`) completamente sin uso en `buildCluster`. | **Confirmado** |
| **AUD-14** | **P2** | P4 / P1 | `src/scenes/OverworldScene.ts:2089`; `src/engine/TerrainMesher.ts:918-931`; `src/engine/WaterSurface.ts:226` | `updateTerrainWaterFrame` muta UVs cada `0.45 s` bajo `WaterSurface`; `WaterSurface.ts:226` hardcodea `renderOrder = 3` en lugar de usar `DIORAMA_RENDER_ORDER.WATER_SURFACE`. | **Confirmado** |
| **AUD-15** | **P2** | P1–P5 | `src/engine/TerrainMesher.ts:340-355` | Sin soporte de reconstrucción localizada de un chunk individual ni caching incremental de contornos. | **Confirmado** |
| **AUD-16** | **P3** | Instancing / Docs / Limpieza | `src/engine/BillboardBatch.ts:342-379`; `src/data/propAssets.ts`; `src/engine/CliffOrnamentMesher.ts:55`; `src/engine/FoliageClusterPlanner.ts:132,154`; `docs/world-engine/` | Re-upload GPU cada frame de matrices `isFixedDecor` aunque no cambie el `yaw`; `atlas_arbolmanzano_00` marcado `grass: true`; `planCliffOrnaments` legado y ramas vacías en P5; ausencia de documentación de P3, P4 y P5. | **Confirmado** |

---

## I. Plan de reparación recomendado (sin ejecutar en esta auditoría)

Orden recomendado para minimizar regresiones e intervenciones cruzadas:
1. **Fase 1 — Corrección crítica de P5 (`AUD-03`, `AUD-04`, `AUD-13`)**: Filtrar catálogos de `FoliageClusterPlanner` por `map.biome`, `map.snowLine` y `map.decoration.treeKinds/densidades` (`0` = no spawnear); exigir `maxDiff <= 1` y distancia mínima a agua/acantilados en `tileIsFree`; conectar `clusterKind` a la receta real (incluyendo `'riverside'` cerca del agua) y unificar o coordinar límites totales con el scatter de `OverworldScene`.
2. **Fase 2 — Corrección matemática de P3 (`AUD-01`, `AUD-08`, `AUD-09`, `AUD-11`)**: Normalizar el umbral/pesos en `SurfaceTransitionPlanner` + `TerrainWeatheringShader` (mantener `weight = 0.5` en borde compartido modulando el radio/ancho con `strength` o escalando el ruido en torno al punto medio real para que `alpha(A->B) + alpha(B->A) = 1.0`), unificar `resolveTerrainTileKey` en un único helper compartido en `src/domain` o `src/engine`, suavizar/suprimir el `checker` en terreno plano y retirar o integrar `getTerrainLayerTexture`.
3. **Fase 3 — Evolución geométrica real de P4 + P1 (`AUD-02`, `AUD-05`, `AUD-14`)**: Corregir `shoreFactorAt` usando los 4 vecinos (incluyendo diagonal) para eliminar la grieta de `0.08 u`; desbloquear vértices de ribera en `TerrainContourAnalyzer` (con reglas de puente/muelle protegidos) y extender `WaterSurface` para seguir polígonos de contorno costero bajo la ribera orgánica; eliminar la animación UV redundante bajo `WaterSurface` y usar `DIORAMA_RENDER_ORDER.WATER_SURFACE`.
4. **Fase 4 — Consolidación P2 e Integración Global (`AUD-06`, `AUD-07`, `AUD-10`, `AUD-12`, `AUD-15`, `AUD-16`)**: Reutilizar un único `TerrainContourAnalysis` + `RockyCliffBuildContext` entre `TerrainMesher` y `CliffOrnamentMesher` (`-100..225 ms` por mapa), sellar los pinholes de miter/base en `RockyCliffMesher`, adjuntar `attachTerrainDioramaShader` en `BattleStage`, evitar re-uploads por frame en `BillboardBatch` para `isFixedDecor` y redactar documentación de P3–P5 en `docs/world-engine/`.

---

## J. Veredicto

- **¿El sistema P1–P5 está integrado como un Artistic World Engine coherente y listo para producción?**: **NO.**
- **Estado real**: **P1** y **P2** ya generan geometría orgánica y estratificación sólida con alto valor visual (salvo micro-fisuras de miter y doble cálculo de análisis), pero **P3** tiene un defecto matemático que corta los bordes de mezcla de textura más frecuentes (`cobble`, `cliff_rock`, `cave_floor`), **P4** sigue siendo agua de grilla rectangular `1×1` sin geometría de costa, y **P5** viola biomas y pendientes (introduciendo árboles de pradera/nieve dentro de cuevas). Se requiere aprobar y ejecutar las Fases 1–4 antes de considerar el motor mundial integrado.

---

### Comandos y verificaciones ejecutadas en esta auditoría

| Verificación | Comando ejecutado | Resultado exacto observado |
|---|---|---|
| Tests unitarios e integración | `npm test` (`vitest run`) | **58 archivos / 292 tests aprobados**, `0` fallos (`15.64 s`). |
| TypeScript / Lint | `npm run lint` (`tsc --noEmit`) | **Salida `0`**, `0` errores. |
| Build de producción | `npm run build` (`vite build`) | **Éxito en `1.28 s`**, 215 módulos; `dist/assets/index-H1kKN54p.js` (`2,217.24 kB`, gzip `584.39 kB`). |
| Diagnóstico geométrico/tiempos/P3/P4/P5 | `npx tsx -e "..."` (solo lectura sobre `MAPS` y `DEV_MAPS`) | Medidos vértices, triángulos, conteos P1/P3/P4/P5, defectos `weight < 0.5`, props fuera de bioma/pendiente y grieta sintética `0.08 u`. |
| Navegador vivo + consola | `playwright-cli` (`1440×900`) sobre `test_riverbank`, `villa_origen`, `pueblo_bruma`, `ruta_2`, `cueva_eco` | `0` errores de consola, `0` warnings; capturas inspeccionadas y directorio temporal `.playwright-cli` eliminado al concluir. |

### Elementos no verificables en este entorno
- Historial de commits / autoría exacta por etapa (`.git` inexistente).
- Rendimiento real en GPU dedicada (FPS, ancho de banda VRAM y sombras/`OverworldPostFx` completos), dado que headless Chromium ejecuta **SwiftShader**, bajo el cual `Renderer.ts:107-108` desactiva `shadowMap` y el post-proceso por defecto.
