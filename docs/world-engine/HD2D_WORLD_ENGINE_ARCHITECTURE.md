# Soul-Dolls 2.5D — Arquitectura del Motor Artístico de Mundo HD-2D (P0)

> **Estado del documento**: Diagnóstico técnico y diseño de arquitectura (Etapa **P0**).  
> **Alcance**: Investigación, auditoría del repositorio real y diseño objetivo. **Ningún código de motor ha sido implementado ni modificado en esta etapa.**  
> **Principio rector**: Evolucionar el motor actual de mapas hacia escenarios 2.5D orgánicos inspirados en la filosofía HD-2D de *Octopath Traveler* con identidad propia de **Soul-Dolls**, preservando intacto el **Logical World** (grilla, alturas lógicas, colisiones, navegación, warps y spawns) separado del **Visual World**.

---

## 1. Resumen del motor actual

El overworld actual de **Soul-Dolls** (`src/scenes/OverworldScene.ts`) renderiza mundos 2.5D en **Three.js** combinando:

- **Terreno por chunks (`16×16` tiles)** en `src/engine/TerrainMesher.ts` con iluminación `MeshStandardMaterial` + mapas de normales (`tiles_5x5_normal.png` y `tiles_extra_normal.png`), colores por vértice y sombreado direccional.
- **Un faldón exterior continuo (`buildTerrainBorderApron`)** de 44 unidades más allá del mapa jugable para evitar el vacío del horizonte.
- **Sistemas arquitectónicos y de relieve**: edificios 3D low-poly (`src/engine/BuildingMesher.ts`), portales/arcos de ruta (`src/engine/GateMesher.ts`), escaleras de 4 peldaños (`src/engine/StaircaseMesher.ts`), ornamentos planos en bordes de acantilado (`src/engine/CliffOrnamentMesher.ts`) y superficie de agua animada por shader (`src/engine/WaterSurface.ts`).
- **Props y personajes como billboards iluminados**: lotes instanciados (`src/engine/BillboardBatch.ts`) con animación de viento por vértice, reacción al paso del jugador en hierba alta y recorte de oclusión frente a la cámara (`src/engine/OcclusionCutout.ts`).
- **Atmósfera y post-procesado HD-2D**: luces hemisférica y direccional con ciclo día/noche (`OverworldScene.ts`), halos HDR, luces puntuales cercanas, haces de luz y partículas por bioma (`src/engine/OverworldAtmosphere.ts`), más pipeline `OverworldPostFx` (`PixelSsaoShader` con `DepthTexture`, `UnrealBloomPass` con umbral HDR `1.04`, y `DioramaGradeShader` con tilt-shift, color grading por bioma y viñeta).

### Diagnóstico visual frente al objetivo artístico

Aunque la capa de **iluminación, atmósfera y post-procesado** ya ofrece una base HD-2D sólida, la **geometría y composición del terreno** siguen siendo estrictamente modulares y ortogonales:

1. Cada tile `(x, z)` del área jugable genera **un único quad plano horizontal** `[x - 0.5, x + 0.5] × [z - 0.5, z + 0.5]` a altura discreta `level * 0.5`.
2. Cada diferencia de altura entre tiles cardinales genera **planos verticales estrictos de 90°**, con ornamentos en tarjetas planas desplazadas `0.025` unidades hacia fuera.
3. No existen plataformas con siluetas orgánicas, esquinas erosionadas/achaflanadas, taludes rocosos multi-faceta, transiciones graduales entre materiales (tierra/pasto/roca/arena), orillas curvas de agua ni agrupación compositiva de vegetación.

---

## 2. Arquitectura actual y dependencias

### 2.1 Diagrama de dependencias reales del Overworld

```text
src/domain/types.ts (MapDef, TileKind, PropKind, BattleBiome)
  │
  ├── src/domain/TerrainRules.ts (HEIGHT_UNIT=0.5, isTileWalkable, sampleInterpolatedHeight)
  ├── src/data/maps/*.ts + mapBuilder.ts (grid[], heights[], legend, decoration, props, warps)
  │
  └── src/scenes/OverworldScene.ts (Orquestador del mapa actual)
        ├── src/gfx/AssetProvider.ts + ProceduralTiles.ts + PropSprites.ts + Palette.ts
        │     ├── src/engine/AtlasBuilder.ts (getTileUv -> atlas 8×8 de 512×512)
        │     └── src/data/propAssets.ts (PROP_ATLAS_REGISTRY = [])
        ├── src/engine/TerrainMesher.ts (buildTerrainChunks, detectCliffBoundaries, buildTerrainBorderApron)
        │     ├── src/engine/DioramaLayers.ts (DIORAMA_RENDER_ORDER, CliffBoundary, weathering profiles)
        │     └── src/engine/TerrainWeatheringShader.ts (onBeforeCompile -> aCliffMeta)
        ├── src/engine/CliffOrnamentMesher.ts (buildCliffOrnamentsMesh -> 128×32 procedural)
        ├── src/engine/WaterSurface.ts (ShaderMaterial transparent + aShore)
        ├── src/engine/StaircaseMesher.ts (4 peldaños por tile '^')
        ├── src/engine/BuildingMesher.ts + GateMesher.ts (QuadGeometry.ts)
        ├── src/engine/BillboardBatch.ts (InstancedMesh por PropKind + wind shader)
        ├── src/engine/OcclusionCutout.ts (attachCameraOcclusionCutout)
        ├── src/engine/OverworldAtmosphere.ts + SkyBackdrop.ts
        ├── src/engine/CameraRig.ts (follow + sampleTerrain collision lift)
        └── src/engine/Renderer.ts + OverworldPostFx.ts (PixelSsaoShader + Bloom + DioramaGradeShader)
```

### 2.2 Auditoría detallada de componentes

#### A. `src/domain/types.ts` y `src/domain/TerrainRules.ts`
- **Responsabilidad**: Definir el modelo lógico del mapa (`MapDef`) y las reglas de colisión, paso de altura y muestreo de elevación.
- **Cómo funciona actualmente**:
  - `MapDef` almacena `grid: string[]`, `heights: string[]` (dígitos `'0'..'9'`), `legend: Record<string, TileLegendEntry>`, `buildings`, `props`, `decoration: DecorationDensity`, `warps`, `npcs`, `signs`, `pickups`, `biome` y `snowLine?`.
  - `HEIGHT_UNIT = 0.5` convierte niveles `0..9` en alturas `0.0..4.5`.
  - `sampleInterpolatedHeight(map, wx, wz)` interpola bilinealmente `getTileWorldY` entre los 4 centros enteros circundantes.
  - `isTileWalkable(map, fromX, fromY, toX, toY, blockedDynamic)` valida límites, `!targetLegend.solid`, `tile !== 'water'`, `!isInsideBuilding`, ausencia de `map.props` / `map.signs` / `blockedDynamic`, y diferencia de altura `<= maxStep` (`2` si algún extremo es `ramp` o `stairs`; `1` en caso normal).
- **Datos que recibe / produce**: Recibe `MapDef` y coordenadas de grilla/mundo; produce booleanos de transitabilidad y altura `Y` continua para actores y cámara.
- **Limitaciones**: No contempla offsets visuales ni distingue entre colisión lógica del tile y su silueta artística; `sampleInterpolatedHeight` interpola en cruz de 4 tiles sobre la grilla discreta sin conocer si un borde visual está retraído o achaflanado.
- **Veredicto**: **Reutilizable al 100%** como núcleo inmutable del *Logical World*.

#### B. `src/data/maps/mapBuilder.ts` y catálogos en `src/data/maps/`
- **Responsabilidad**: Construir matrices `grid` y `heights` para los mapas exteriores (`villaOrigen.ts`, `ruta1.ts`, `puebloBruma.ts`, `ruta2.ts`, `cuevaEco.ts`, `arenaCumbre.ts`).
- **Cómo funciona actualmente**: Primitivas imperativas `createZoneCanvas`, `fillRect`, `addHill` (elevación radial entera), `addPerimeterMountains`, `carveRoad` y `carveMapPass` (abre pasos escalonados hacia los `warps` de borde). `finalizeZone` serializa a `string[]`.
- **Limitaciones**: Produce plataformas principalmente rectangulares (`fillRect`) y estanques rectangulares (`fillRect(..., '~', 1)`), con transiciones simples de un solo carácter por celda.
- **Veredicto**: **Reutilizable y ampliable de forma opcional** (p. ej. metadatos opcionales en `MapDef` para directivas visuales sin romper mapas existentes ni `tests/map-passages.test.ts`).

#### C. `src/gfx/AssetProvider.ts`, `src/gfx/ProceduralTiles.ts`, `src/engine/AtlasBuilder.ts`, `src/data/propAssets.ts`
- **Responsabilidad**: Proveer texturas `THREE.CanvasTexture` de terreno, normales, edificios, props y personajes.
- **Cómo funciona actualmente**:
  - `buildTileAtlasCanvas()` y `buildTileNormalAtlasCanvas()` crean un atlas en memoria de `512×512` (`ATLAS_GRID = 8`, `TILE_SIZE = 64`, 64 slots).
  - Precarga asíncronamente `/assets/tiles_5x5_albedo.png`, `/assets/tiles_5x5_normal.png` (320×320, 25 celdas de 64×64) y `/assets/tiles_extra_albedo.png`, `/assets/tiles_extra_normal.png` (320×128, 10 celdas de 64×64) y los estampa en los slots asignados en `TILE_ATLAS_INDEX`.
  - `getTileUv(key)` devuelve coordenadas dentro del atlas 8×8 con margen `eps = 0.001`.
  - `getGrassTexture()` / `getGrassNormalTexture()` crean una textura `128×128` con patrón `2×2` de la celda `(0,0)` (`grass`) y `RepeatWrapping` habilitado.
  - `getWallTexture(key)` / `getRoofTexture(kind)` crean texturas `64×64` individuales con `RepeatWrapping`.
  - `PROP_ATLAS_REGISTRY` en `src/data/propAssets.ts` está actualmente vacío (`[]`); los props se cargan desde PNGs individuales en `/public/assets/` y `/public/assets/props/`, recortes de `/assets/faroles_ciudad.png` (`LAMP_SHEET_CROPS`) o fallbacks procedurales de `src/gfx/PropSprites.ts`.
- **Limitaciones**:
  1. El atlas `512×512` no admite repetición libre por cara ni muestreo triplanar por shader (`RepeatWrapping` en el atlas completo mezclaría otros tiles).
  2. La carga asíncrona de los PNGs sobre `CanvasTexture` ocurre en runtime del navegador (`new Image()`); en materiales nuevos que hagan *splatting* habrá que respetar el mismo ciclo `tex.needsUpdate = true`.
- **Veredicto**: **Reutilizable con ampliación controlada** (añadir getters para texturas/sub-sheets tileables de acantilado, tierra, arena y musgo reutilizando `tiles_5x5_*` / `tiles_extra_*`).

#### D. `src/engine/TerrainMesher.ts`
- **Responsabilidad**: Construir los chunks de terreno (`buildTerrainChunks`), detectar cortes de altura (`detectCliffBoundaries`), actualizar animaciones de agua base (`updateTerrainWaterFrame`), controlar visibilidad por distancia (`updateVisibleTerrainChunks`) y construir el horizonte exterior (`buildTerrainBorderApron`).
- **Cómo funciona actualmente**:
  - Divide el mapa en chunks de `CHUNK_SIZE = 16` (`16×16` tiles).
  - Por cada tile genera un quad horizontal plano (`normal = [0,1,0]`). Los tiles `'water'` bajan `WATER_BED_OFFSET = 0.16`; los tiles `'stairs'` usan `getStairTileBaseY` (nivel mínimo vecino).
  - Emite atributo `aCliffMeta` (`vec3`): en pisos `[0.0, edgeRim (0 o 0.72), crevice (0 / 0.45 / 0.88)]`; en paredes `[1.0, topFactor, baseAO]`.
  - `detectCliffBoundaries` recorre vecinos cardinales (`hC > hN`) y genera franjas verticales de 90° particionadas a `MAX_CLIFF_BAND_HEIGHT = 1.0`. Usa `FACE_SHADE` y `resolveCliffWallTileKey` (`cracked_stone`, `mossy_stone`, `dirt`, `cliff_rock`).
  - Cada chunk produce un único `THREE.Mesh` con `atlasIndices` (material 0: `terrainAtlasMat`) y opcionalmente `grassIndices` (material 1: `grassMat`, mapeo `2×2` macro-tileado). Usa `geo.setIndex(indices)` con array numéricoJS.
  - **Dato relevante**: Existe la función interna no exportada `buildVertexHeightGrid(map)` (líneas 201–232), actualmente usada **solo** por `buildTerrainBorderApron`, no por los chunks interiores.
  - `updateVisibleTerrainChunks` oculta chunks a distancia cuadrada `> viewRadius^2` (`viewRadius = 48`).
- **Limitaciones**:
  - Topología rígida de 1 quad por tile sin vértices compartidos ni subdivisión de bordes.
  - Paredes estrictamente a 90° sin chaflanes, estratos escalonados, salientes ni hendiduras.
  - No existe frustum culling explícito (solo radio esférico).
  - `updateTerrainWaterFrame` muta UVs del lecho del agua cada `0.45s` incluso estando cubierto por `WaterSurface`.
- **Veredicto**: **Necesita ampliación/refactorización modular** manteniendo la interfaz `TerrainChunk`, `CHUNK_SIZE = 16`, `detectCliffBoundaries` (o adaptador compatible) y el sistema de grupos de material por chunk.

#### E. `src/engine/DioramaLayers.ts` y `src/engine/TerrainWeatheringShader.ts`
- **Responsabilidad**: Definir órdenes de render (`DIORAMA_RENDER_ORDER`), perfiles cromáticos de desgaste por bioma (`getBiomeCliffWeathering`) y el parche GLSL `attachTerrainDioramaShader` vía `onBeforeCompile`.
- **Cómo funciona actualmente**:
  - Modifica `#include <map_fragment>` en `MeshStandardMaterial` usando `aCliffMeta` y ruido cuantizado en espacio mundo (`floor(wp * 16.0) / 16.0`) para teñir en 4 pasos discretos el borde superior de acantilados (`wallTopBand`), el labio de mesetas (`plateauRimLip`) y oscurecer grietas basales (`baseCrevice * uCreviceShadowStrength`).
- **Limitaciones**:
  - Solo tiñe con 2 colores planos del bioma (`uWeatheringColor`, `uWeatheringSecondary`), no mezcla texturas reales ni normales entre suelo/tierra/roca.
  - Depende de `aCliffMeta` calibrado para cortes binarios de 90°.
- **Veredicto**: **Reutilizable y ampliable**. Es el punto natural para inyectar mezcla multi-material (triplanar/splat en borde y pendiente) sin abandonar `MeshStandardMaterial` ni romper sombras ni `OcclusionCutout`.

#### F. `src/engine/CliffOrnamentMesher.ts`
- **Responsabilidad**: Colocar faldones decorativos en lo alto de los bordes de acantilado (`edge_lip`, `hanging_vine`, `crystal_icicle`, `cracked_trim`).
- **Cómo funciona actualmente**:
  - `planCliffOrnaments` toma los `CliffBoundary` (omitiendo escaleras), elige tipo por hash determinista y bioma, y genera quads verticales en `DIORAMA_RENDER_ORDER.CLIFF_ORNAMENT` (`2`) desplazados `ORNAMENT_OFFSET_OUTWARD = 0.025` hacia fuera.
  - `createCliffOrnamentTexture()` dibuja por código un spritesheet `128×32` (4 celdas de `32×32`). Combina todos los ornamentos en **1 solo draw call** (`MeshStandardMaterial` con `alphaTest: 0.45`, `polygonOffset`, `attachCameraOcclusionCutout`).
- **Limitaciones**: Al estar fijado a planos cardinales rectos con offset `0.025`, cuando las paredes de acantilado pasen a tener ángulos orgánicos, cornisas o retranqueos, las tarjetas planas cardinales atravesarán la roca o flotarán en el aire.
- **Veredicto**: **Necesita adaptación**. Debe seguir el contorno real de la cornisa orgánica (o integrarse como tarjetas de enredadera/estalactita ancladas a los segmentos reales del borde).

#### G. `src/engine/ProceduralOverhangGenerator.ts`
- **Estado en el repositorio**: **NO EXISTE** (`grep` y listado de `src/engine/` confirman su ausencia).
- **Recomendación arquitectónica**: No crear un generador independiente que proyecte voladizos aleatorios sobre tiles caminables. Las cornisas/salientes visuales deben modelarse de forma acotada dentro del generador de bordes de acantilado sobre caídas reales (`drop >= 1`), garantizando visibilidad de actores y cero invasión de tiles transitables al mismo nivel.

#### H. `src/engine/WaterSurface.ts`
- **Responsabilidad**: Renderizar la lámina de agua animada por encima del lecho del terreno.
- **Cómo funciona actualmente**:
  - Recolecta celdas `water` a `y = getTileWorldY + 0.045`.
  - Calcula el atributo por vértice `aShore` (`1.0` si hay borde ortogonal no-agua, `0.55` si solo diagonal, `0.0` interior).
  - Usa un `ShaderMaterial` custom (`transparent: true`, `depthWrite: false`, `fog: true`, `toneMapped: false`, `renderOrder = 3`) con olas sutiles en vértices, coordenadas cuantizadas `16 px/u`, cáusticas, banda de espuma animada en orillas (`vShore`) y destellos HDR para `UnrealBloomPass`.
- **Limitaciones**:
  - Geometría 100% cuadrada de `1×1` por tile; en esquinas y curvas forma dientes de sierra de 90°.
  - La espuma depende solo de `vShore` en las 4 esquinas del tile, sin distancia real a un borde orgánico ni variación de profundidad suave desde una playa/talud sumergido.
- **Veredicto**: **Reutilizable y ampliable**. El shader procedural ya es muy competente; necesita recibir una malla de ribera adaptada al contorno orgánico y un campo de distancia a orilla/profundidad más fino.

#### I. `src/engine/StaircaseMesher.ts`, `BuildingMesher.ts`, `GateMesher.ts`, `QuadGeometry.ts`
- **Responsabilidad**: Construir escaleras de 4 peldaños, edificios con faldón de cimentación (`yBot = groundY - 0.6`) y portales de salida (`yBot = groundY - 0.75`).
- **Cómo funciona actualmente**: Mallas estáticas con `QuadGeometry.ts` (`Uint16Array` de índices, `computeVertexNormals()`). `StaircaseMesher` orienta automáticamente hacia el vecino más alto (`detectStairClimbDirection`).
- **Limitaciones**: Asumen footprints rectangulares en tiles enteros; si una meseta adyacente retranquea demasiado su esquina junto a una escalera o edificio, podría abrir un hueco visual si no se protege el perímetro. Además, `QuadGeometry.ts` fuerza `Uint16Array` (máximo 65.535 vértices por mesh combinado).
- **Veredicto**: **Reutilizables intactos**, añadiendo únicamente una regla de *Protected Footprints* en el extractor de contornos para que las mesetas encajen limpio contra edificios, escaleras y puentes.

#### J. `src/engine/BillboardBatch.ts` y `src/engine/OcclusionCutout.ts`
- **Responsabilidad**: Renderizar todos los props exteriores en `InstancedMesh` agrupados por `PropKind`, con normales apuntando a `[0,1,0]` para iluminación uniforme sin importar el yaw de cámara, shader de viento y sombra alfa-testeada (`customDepthMaterial`), más la ventana circular quintic-dithered de `OcclusionCutout`.
- **Limitaciones**: En `OverworldScene.collectPropPlacements`, cada prop se ubica exactamente en el centro entero `(x, z)` de un tile libre (máximo 1 prop por celda), sin sub-tile offset, sin rotación variada en elementos de suelo ni agrupación jerárquica en clusters.
- **Veredicto**: **Reutilizables al 100%** en el renderer de batches; la mejora vive en la planificación de colocaciones (permitiendo coordenadas continuas `(x + dx, z + dz)` y distinción entre *prop con colisión* vs *micro-prop puramente visual*).

#### K. `src/engine/OverworldAtmosphere.ts`, `SkyBackdrop.ts`, `CameraRig.ts`, `Renderer.ts`, `OverworldPostFx.ts`, `PixelSsaoShader.ts`, `BiomeGradeShader.ts`
- **Responsabilidad**: Atmósfera, iluminación, cámara tercera persona baja (`fov 58`, `distance 6.4`, `height 2.65`, colisión `groundUnderCam + 1.15`) y post-procesado HD-2D con detección automática de WebGL por software (`isSoftwareGl`) y 3 niveles de calidad (`high`/`medium`/`low`).
- **Limitaciones relevantes para la evolución**:
  - `OverworldPostFx` realiza un pre-pase completo de escena hacia `sceneDepthTarget` (`HalfFloatType` + `DepthTexture`) cuando `qualityTier !== 'low'` y `!isSoftwareGl`, por lo que el conteo de triángulos del terreno y props afecta **dos pases geométricos** (depth target + composer/main) además del `shadowMap` (`1024×1024`).
  - `CameraRig.ts` usa `this.sampleTerrain` (`sampleInterpolatedHeight`) para elevar la cámara sobre colinas detrás del jugador; no debe modificarse y cualquier relieve visual extremo detrás del jugador no debería bloquear la cámara ni ocultar al personaje (ya cubierto por `OcclusionCutout` si el material de terreno tiene `attachCameraOcclusionCutout`, como hoy ocurre).
- **Veredicto**: **Reutilizables sin cambios de arquitectura** (ajustando únicamente presupuestos geométricos y opcionalmente valores de `PixelSsaoShader` si los acantilados tienen mayor relieve).

#### L. `src/scenes/OverworldScene.ts`
- **Responsabilidad**: Ciclo de carga del mapa (`loadMap`), planificación de props (`collectPropPlacements` + `collectBorderApronProps`), gestión de NPCs, `WaterSurface`, `OverworldAtmosphere` y loop `fixedUpdate`/`render`.
- **Limitaciones**:
  - Mezcla lógica de ocupación/colisión (`this.blockedTiles` con `SOLID_SEED_PROPS`) con estética de scattering uniforme tile a tile (`rng.next() < density`).
  - Acopla `updateTerrainWaterFrame(this.chunks, this.waterFrame)` al intervalo de `0.45s` directamente sobre la geometría del chunk.
- **Veredicto**: **Necesita ampliación ligera** en la etapa de construcción de escena y extracción de la lógica pura de planificación decorativa hacia un módulo testeable sin WebGL.

---

## 3. Inventario de assets existentes

Auditoría verificada sobre el árbol real del repositorio (`/public/assets/`, `src/gfx/ProceduralTiles.ts`, `src/gfx/PropSprites.ts`, `src/gfx/Palette.ts`, `src/engine/CliffOrnamentMesher.ts`).

| Categoría | Recursos existentes verificados | Formato / Dimensión / Uso actual | Estado | Qué adaptar / Qué falta |
|---|---|---|---|---|
| **Ground** | `public/assets/tiles_5x5_albedo.png` & `tiles_5x5_normal.png` (celdas `grass`, `cobble`, `stone`, `palace_tile`, `planks`, `bridge`, `cave_floor`, `arena_floor`); `tiles_extra_albedo/normal.png` (`snow`, `leaves`, `flowers`, `stairs`); fallbacks en `ProceduralTiles.ts` | Sheets PNG `320×320` (5×5 de 64×64) y `320×128` (5×2 de 64×64) estampados en atlas `512×512`; `grass` además se extrae a textura `128×128` 2×2 repeat (`getGrassTexture`) | **Reutilizable directamente** (atlas) / **Adaptable** (para caras no ortogonales) | Falta exponer versiones `RepeatWrapping` individuales o sub-atlas con padding de al menos `stone`, `cobble`, `snow` y `cave_floor` para evitar UV bleeding en mallas biseladas |
| **Soil** | `dirt` en `tiles_5x5_albedo/normal.png` `(0,1)`; `sand` en `tiles_extra_albedo/normal.png` `(1,3)`; `PALETTE.dirtBrown`, `sandDesert`, `darkOak` | Slots `64×64` en el atlas `512×512` | **Requiere adaptación** | Falta textura tileable individual de tierra/arena (`getTerrainLayerTexture`) y variante de **tierra con gravilla/raíces** para transiciones de borde entre camino, pradera y acantilado |
| **Rock** | `public/assets/props/boulder.png` (144×131), `public/assets/props/crystal.png` (84×144), `stone`/`cracked_stone`/`mossy_stone` en `tiles_5x5_*` | Sprites PNG RGBA para billboards instanciados; tiles `64×64` | **Reutilizable directamente** | Faltan **variantes de rocas bajas/guijarros/grupos de piedras** (`rock_cluster`, `pebbles`, `river_stone`) para pies de acantilado y riberas sin colisión |
| **Cliff** | `cliff_rock` `(3,3)`, `cracked_stone` `(1,2)`, `mossy_stone` `(1,3)`, `dirt` `(0,1)` en `tiles_5x5_albedo/normal.png`; `createCliffOrnamentTexture()` en `CliffOrnamentMesher.ts` | Slots `64×64` para muros de 90°; spritesheet procedural `128×32` (`edge_lip`, `hanging_vine`, `crystal_icicle`, `cracked_trim`) | **Requiere adaptación** | Falta textura de acantilado verdaderamente **tileable sin costuras verticales** con estratos horizontales + mapa normal marcado, y **textura/shader para talud inclinado** en la base del acantilado |
| **Moss** | `mossy_stone` `(1,3)` en `tiles_5x5_*`; tinte procedural en `TerrainWeatheringShader.ts` (`DioramaLayers.ts`); `edge_lip` & `hanging_vine` en `CliffOrnamentMesher.ts` | Blending procedural por vértice/fragmento + tarjetas `32×32` | **Reutilizable + Adaptable** | Faltan **parches de musgo rastrero / hiedra en ribera y pie de roca** (decals o micro-billboards) para romper la línea recta entre pared y suelo |
| **Grass** | `grass` `(0,0)` en `tiles_5x5_*` (`getGrassTexture()` `128×128` repeat); `tall_grass` `(1,2)` en `tiles_extra_*`; `/assets/hierba_alta_clump.png` (192×160), `/assets/hierba_alta_flower.png` (192×146) | Textura base `RepeatWrapping` + billboards PNG RGBA con shader de viento | **Reutilizable directamente** | Faltan **matas de hierba baja decorativa / juncos de orilla** (más pequeñas que `tall_grass_clump`, sin connotación de zona de encuentro salvaje) |
| **Foliage** | `/assets/arbol_roble.png` (256×229), `arbol_sauce.png` (256×230), `arbol_pino.png` (138×256), `arbol_pino_nieve.png` (167×256), `arbol_hongo.png` (215×224), `arbol_hongo_arcano.png` (212×224), `arbusto_espinoso.png` (192×177), `arbusto_arcano.png` (192×177), `/assets/props/flower_patch.png` (144×125), `mushroom.png` (123×144), `stump.png` (144×124) | Sprites PNG RGBA alta resolución pixel/ilustrados renderizados con `NearestFilter` en `BillboardBatch` | **Reutilizable directamente** (catálogo sólido) | Faltan **variantes de escala/silueta para sotobosque** (helechos, cañas/juncos ribereños, arbusto nevado/seco) aprovechando `PROP_ATLAS_REGISTRY` o láminas dedicadas |
| **Water** | `water` `(0,0)` y `water_1` `(0,1)` en `tiles_extra_albedo/normal.png`; shader procedural `WaterSurface.ts` | Fondo en atlas (`TerrainMesher`) + `ShaderMaterial` superpuesto | **Reutilizable + Adaptable** | No faltan texturas externas; falta soporte geométrico de **orilla orgánica** y **lecho costero gradual** (arena/guijarro sumergido) bajo la lámina transparente |
| **Props** | `/assets/faroles_ciudad.png` (212×192, 4 faroles); `/assets/props/`: `bench.png`, `fence.png`, `sign.png`, `well.png`, `pillar.png`, `cave_entrance.png`, `capsule_pedestal.png`, `heal_machine.png`; 14 props interiores en `PropSprites.ts` | Sprites PNG RGBA + crops + canvas procedural | **Reutilizable directamente** | Suficiente para P1–P3; opcional añadir puente rústico de piedra/madera sobre elevación si se diseñan pasos sobre río |
| **Buildings** | Fachadas `wall_*` y tejados fila 4 en `tiles_5x5_albedo/normal.png`; `window`, `door` en `tiles_extra_*`; geometría en `BuildingMesher.ts` & `GateMesher.ts` | Texturas `64×64` con `RepeatWrapping` por material | **Reutilizable directamente** | Sin faltantes bloqueantes para el motor de terreno; mantener zócalos de cimentación `-0.6` |

> **Nota sobre recursos no conectados en runtime**: Existen archivos sueltos en la raíz (`/PLAYER.jpeg`, `/NPC07.jpg`, `/NPC08.jpg`, archivos JPG numéricos) y en `/public/assets/aistudio/` (referencias visuales y sprites de SoulDolls/escenarios) que **no forman parte de los assets de terreno cargados por `AssetProvider.ts`** (salvo las copias en `src/assets/chars/`). No debe asumirse su uso en el motor de mapas sin ingesta explícita.

---

## 4. Limitaciones técnicas detectadas

1. **Topología discreta `1 tile = 1 quad plano` sin continuidad en bordes**:
   - En `TerrainMesher.ts` (líneas 276–356), cada tile genera 4 vértices propios desconectados de sus vecinos. Aunque existe `buildVertexHeightGrid(map)`, **solo se usa en el faldón exterior**. Al no compartir ni subdividir vértices en transiciones de altura, las plataformas solo pueden formar cajas ortogonales.
2. **Acantilados exclusivamente a 90° con bandas planas**:
   - `detectCliffBoundaries` solo compara los 4 vecinos cardinales y emite rectángulos verticales coplanares a `x ± 0.5` o `z ± 0.5`. No hay esquinas exteriores redondeadas/achaflanadas, esquinas interiores cóncavas suavizadas, salientes rocosas ni inclinación talud-base.
3. **Acoplamiento del atlas 8×8 frente a UVs orgánicas**:
   - El atlas `512×512` usa `getTileUv(key)` con margen `eps = 0.001` sobre una textura sin mipmaps (`NearestFilter`). En un quad cuadrado `1×1`, las UVs no salen de la celda. En cambio, sobre caras inclinadas, chaflanes o desplazamientos de vértice, interpolar UVs arbitrarias dentro de un atlas empaquetado provoca **estiramiento de textura** o **bleeding con la celda vecina** si se excede el rango `[u0, u1]`.
4. **Ausencia de transiciones de superficie entre materiales**:
   - El cambio entre `grass`, `dirt`, `sand`, `stone` y `snow` es un corte duro en la frontera de cada `1×1` tile. `TerrainWeatheringShader.ts` solo tiñe bordes de altura con dos colores uniformes (`uWeatheringColor`, `uWeatheringSecondary`), sin mezclar texturas ni erosionar la línea entre tierra y hierba/roca.
5. **Agua en cuadrícula rígida y caída abrupta del lecho**:
   - `TerrainMesher.ts` hunde todo tile `water` exactamente `WATER_BED_OFFSET = 0.16` con paredes verticales de 90° en la orilla, y `WaterSurface.ts` emite cuadrados `[x-0.5, x+0.5]` con `aShore` binario en esquinas (`0`, `0.55`, `1.0`). Esto produce estanques y ríos pixelados en escalera de 90° en la geometría 3D.
6. **Scattering uniforme sin composición ni sub-tile placement**:
   - `OverworldScene.collectPropPlacements` evalúa celda a celda de forma independiente (`roll < treeDensity ...`), excluye vecinos de camino y centra cada prop en `(x, z)` entero. Resultado: árboles y rocas distribuidos como ruido sal-y-pimienta en grilla, sin bosquecillos agrupados, sin piedras agrupadas en base de acantilado ni matas en orillas.
7. **Emisión redundante en terreno bajo edificios y agua**:
   - Se emiten quads horizontales debajo de edificios sólidos y se sigue animando `updateTerrainWaterFrame` cada `0.45s` sobre el lecho cubierto por `WaterSurface`.
8. **Culling básico sin frustum check**:
   - `updateVisibleTerrainChunks` solo filtra por distancia euclidiana (`viewRadius = 48`). Con mallas orgánicas más densas, renderizar chunks detrás de la cámara duplicará innecesariamente el trabajo del depth pre-pass de `PixelSsaoShader`.

---

## 5. Sistemas reutilizables

Los siguientes sistemas ya resuelven problemas clave de Soul-Dolls y **deben conservarse como columna vertebral**:

- **`src/domain/TerrainRules.ts` y `MapDef` (`src/domain/types.ts`)**: fuente única de verdad lógica (colisiones, pasos de altura, rampas, edificios, warps, zonas de encuentro).
- **`src/engine/Renderer.ts` y `src/engine/OverworldPostFx.ts`**: escalado dinámico de calidad (`high`/`medium`/`low`), fallback automático en `isSoftwareGl`, `PixelSsaoShader` con `DepthTexture`, `UnrealBloomPass` HDR y `DioramaGradeShader` con perfiles por `BattleBiome`.
- **`src/engine/OverworldAtmosphere.ts` y `src/engine/SkyBackdrop.ts`**: sombras de contacto instanciadas, halos HDR, 2 `PointLight` dinámicos cerca del jugador, haces de luz, nubes y partículas por bioma.
- **`src/engine/OcclusionCutout.ts`**: recorte suave dithered entre cámara y jugador; seguirá funcionando automáticamente sobre geometría orgánica si los materiales la enlazan.
- **`src/engine/BillboardBatch.ts`**: agrupación en `InstancedMesh` por `PropKind`, normales `[0,1,0]` uniformes ante cualquier giro de cámara, shader de viento e interacción con el jugador.
- **`src/engine/BuildingMesher.ts`, `GateMesher.ts`, `StaircaseMesher.ts`**: geometría arquitectónica y de escaleras con faldones profundos (`-0.6` / `-0.75`) compatibles con el terreno vecino.
- **`src/engine/CameraRig.ts`**: cámara 2.5D fija de 4 pasos u órbita libre + elevación anti-clipping. **No se modifica.**
- **Estrategia de chunking `16×16` (`CHUNK_SIZE = 16`) y `buildTerrainBorderApron`**.

---

## 6. Sistemas que necesitan ampliación

1. **`src/engine/TerrainMesher.ts`**:
   - Pasar de generador monolítico de quads planos a pipeline por fases dentro de los mismos chunks `16×16`: lectura de campos derivados (alturas visuales, contornos, máscaras de transición) -> mesetas con bordes orgánicos -> paredes/taludes rocosos facetados -> faldón exterior conectado.
2. **`src/engine/TerrainWeatheringShader.ts` + `src/engine/DioramaLayers.ts`**:
   - Ampliar atributos de vértice (`aCliffMeta` + nuevo `aSurfaceBlend` o canal extra) para soportar mezcla entre textura base, tierra/arena y roca/musgo según pendiente (`vWorldNormal.y`), altura relativa al borde y ruido cuantizado HD-2D, manteniendo la estética pixel-crisp (stepped/quantized blend, no blur plástico realista).
3. **`src/engine/WaterSurface.ts`**:
   - Permitir que la malla de agua y su distancia de orilla `aShore` se construyan a partir de un contorno continuo/chaflanado derivado de la frontera agua-tierra, manteniendo exactamente el shader estilizado HD-2D (`WaterSurface`) y sus uniformes `uTime`/`uDetail`.
4. **`src/engine/CliffOrnamentMesher.ts`**:
   - Reemplazar la suposición de caras estrictamente cardinales a `±0.5` por anclaje sobre los **segmentos reales del labio superior** del acantilado orgánico (permitiendo orientación arbitraria por normal del segmento y desactivándose automáticamente en transiciones suaves donde no hay corte rocoso).
5. **`src/gfx/AssetProvider.ts` y `src/gfx/ProceduralTiles.ts`**:
   - Exponer texturas `RepeatWrapping` limpias para materiales continuos que el nuevo shader de terreno necesite muestrear en caras inclinadas o estratos (reutilizando celdas existentes de `tiles_5x5_albedo/normal` como `cliff_rock`, `dirt`, `stone`, `mossy_stone`, `snow`) sin romper el atlas `512×512` actual.
6. **`src/scenes/OverworldScene.ts`**:
   - Delegar el cálculo de decoración a un planificador desacoplado capaz de emitir *clusters* compositivos y micro-props con coordenadas continuas `(x, z)`, separando estrictamente **props sólidos** (registrados en `this.blockedTiles` en su celda lógica) de **detalles visuales no bloqueantes**.

---

## 7. Sistemas nuevos realmente necesarios

Para evitar sobreingeniería o sistemas duplicados, solo se justifican **cuatro módulos puros nuevos** (en `src/engine/` o `src/domain/` si aplica lógica pura testeable en Node) coordinados con las ampliaciones anteriores:

1. **Extractor de Contornos y Mesetas (`TerrainContourAnalyzer.ts`)** *(cubre: Plateau Mesh & Organic Edge logic)*
   - **Por qué es necesario**: Hoy `TerrainMesher` evalúa cada tile aislado. Para generar esquinas convexas redondeadas/achaflanadas, esquinas cóncavas orgánicas, bordes erosionados e islas continuas sin romper escaleras/edificios/puentes, hace falta construir una **representación intermedia de celdas, vértices compartidos y bordes clasificados** a partir de `MapDef`.
   - **Función**: Calcula máscara de *Protected Footprints* (edificios, escaleras `^`, puentes `B`, warps), clasifica cada tile/esquina en tipo de contorno (interior plano, borde recto, esquina convexa, esquina cóncava, puente/istmo) y genera desplazamientos deterministas acotados en `(x, y, z)`.
2. **Generador de Acantilados y Taludes Rocosos (`RockyCliffMesher.ts`)** *(cubre: Cliff / Wall & Erosion Detail)*
   - **Por qué es necesario**: Separar la complejidad geométrica de paredes multi-nivel, cornisas superiores ligeramente salientes, facetas rocosas con normales por cara y taludes basales de tierra/piedra mantendrá `TerrainMesher.ts` legible y testeable.
   - **Función**: A partir de las aristas del contorno de cada meseta, construye estratos horizontales con ligera variación de profundidad (contraste convexo/cóncavo), biselado en hombro superior (*cliff shoulder*) y falda de unión con el nivel inferior.
3. **Planificador de Transiciones y Splatting (`SurfaceTransitionPlanner.ts`)** *(cubre: Terrain Transition)*
   - **Por qué es necesario**: Las transiciones naturales tierra↔pasto, pasto↔roca y orilla↔arena requieren evaluar vecindad y pendiente antes de emitir vértices, escribiendo pesos y máscara de erosión en atributos de vértice (`aSurfaceWeights`) consumidos por `TerrainWeatheringShader`.
4. **Planificador Compositivo de Vegetación y Ribera (`FoliageClusterPlanner.ts`)** *(cubre: Vegetación agrupada y detalle ribereño)*
   - **Por qué es necesario**: La dispersión actual en `OverworldScene.ts` está acoplada a `Scene` y solo itera celda a celda con `rng` plano. Extraer un planificador puro (testeable en `vitest` como `TerrainRules`) permite crear composiciones de árboles + arbustos + rocas + helechos/flores + juncos de orilla con separación visual/lógica explícita.

> **Sobre `ProceduralOverhangGenerator.ts`**: **No** se crea como sistema separado. Cualquier cornisa o saliente superior de acantilado (*overhang lip*) se genera dentro de `RockyCliffMesher.ts` como una extrusión controlada del hombro superior de la pared (`0.08–0.16` unidades), garantizando coherencia de vértices y cero huecos o conflictos con `CameraRig` y `OcclusionCutout`.

---

## 8. Separación entre Logical World y Visual World

La regla arquitectónica no negociable es que **toda la lógica jugable sigue leyendo exactamente `MapDef` y `TerrainRules.ts`**.

| Aspecto | Logical World (Autoritativo — Sin cambios) | Visual World (Derivado determinista — Evolutivo) |
|---|---|---|
| **Sistema de coordenadas** | Grilla entera `(gx, gy)` con `gx ∈ [0, W-1]`, `gy ∈ [0, H-1]`, centro de tile en `(gx, gy)` y extensión `[gx-0.5, gx+0.5]`. | Mismo espacio mundo `THREE.Scene` con centros en `(gx, gz)`. |
| **Alturas y movimiento** | `heights[y][x]` (`0..9`), `HEIGHT_UNIT = 0.5`, `sampleInterpolatedHeight(map, wx, wz)`. | Superficie interior caminable de cada meseta respeta `level * 0.5` en la zona central del tile; la deformación vertical ocurre **en bordes solidificados/no transitables, laderas y taludes**. |
| **Colisiones y navegación** | `isTileWalkable` (`legend.solid`, `water`, `buildings`, `props`, `signs`, `blockedTiles`, `maxStep`). | Props decorativos agrupados en tiles **transitables** no entran a `blockedTiles` y se colocan preferentemente en bordes de tile o márgenes no obstructivos; props sólidos (`SOLID_SEED_PROPS`) siempre quedan fijados en el centro de su tile lógico o con offset `<= 0.15`. |
| **Escaleras, puentes, warps, edificios** | `legend.tile === 'stairs' | 'bridge'`, `map.buildings`, `map.warps`. | Marcados como **`Protected Footprints`**: sus tiles y 1 anillo de transición mantienen geometría ortogonal limpia en altura exacta `level * 0.5` para que `BuildingMesher`, `StaircaseMesher` y `GateMesher` encajen sin flotar ni enterrarse. |
| **Acantilados y bordes orgánicos** | Transición discreta `hA !== hB` (donde `|hA - hB| > 1` ya es intransitable por `isTileWalkable`). | El chaflán, biselado y retranqueo orgánico de esquina se aplica **hacia el lado elevado (o sobre tiles `solid`)** o dentro del margen `±0.28` de la junta no transitable, **nunca invadiendo el área caminable de un tile inferior adyacente**. |
| **Agua y orillas** | Tile `'water'` siempre bloqueante (`solid: true`). | El contorno de `WaterSurface` puede suavizar esquinas cóncavas/convexas adentrándose ligeramente en los bordes del propio tile de agua o bordeando la playa sólida colindante, sin hacer parecer caminable un tile `'water'`. |
| **Cámara (`CameraRig`)** | `sampleInterpolatedHeight(map, camX, camZ) + 1.15`. | Respeta intacto el contrato de altura bajo cámara; `OcclusionCutout` recorta cualquier pared rocosa que se interponga entre cámara y jugador (`minRelY = -0.35`). |

---

## 9. Pipeline de generación propuesto

El nuevo flujo reemplaza la emisión monolítica de quads dentro de `OverworldScene.loadMap` por un pipeline determinista en cuatro etapas, 100% compatible con la carga actual de mapas:

```text
[1. Análisis Lógico (MapDef)]
   ├── Identificar Protected Footprints (edificios, escaleras, puentes, warps, caminos)
   ├── Detectar islas por nivel de altura y bordes agua-tierra
   └── Calcular campo de distancia a bordes (edgeDist, cornerType: convex | concave | straight)
         │
         ▼
[2. Geometry Generation (por Chunk 16×16)]
   ├── Subdivisión adaptativa: tiles interiores planos = 1 quad (bajo costo);
   │   tiles de borde/acantilado/orilla = malla 2×2 o contorno chaflanado
   ├── Mesetas orgánicas: vértices de borde desplazados por ruido determinista acotado
   ├── RockyCliffMesher: corona biselada (shoulder) + estratos rocosos facetados + talud basal
   └── Lecho costero gradual bajo bordes de agua (pendiente suave hacia WATER_BED_OFFSET)
         │
         ▼
[3. Surface & Environment]
   ├── SurfaceTransitionPlanner: calcula pesos en aSurfaceWeights (grass / dirt / rock / sand / snow)
   │   según altura, pendiente (normal.y) y proximidad a camino/agua
   ├── WaterSurface v2: malla acoplada al contorno orgánico de orilla + distancia continua a costa
   ├── CliffOrnamentMesher v2: enredaderas/estalactitas ancladas a segmentos reales de cornisa
   └── FoliageClusterPlanner -> BillboardBatch (árboles + sotobosque + piedras + flores/juncos)
         │
         ▼
[4. World Rendering]
   ├── Chunks 16×16 con frustum culling + radio de visibilidad (viewRadius = 48)
   ├── Materiales compartidos + TerrainWeatheringShader v2 (albedo/normal blending cuantizado)
   ├── OcclusionCutout + Sun PCFSoftShadowMap (1024×1024)
   └── OverworldAtmosphere + OverworldPostFx (PixelSsao -> HDR Bloom -> DioramaGrade)
```

### Detalle clave del mapeo UV sin Atlas Bleeding

Para resolver la limitación #3 del atlas `8×8`:
- La textura principal de terreno sigue usando `getTileAtlasTexture()` para pisos planos/caminos/estructuras compatibles (`grassMat` para macro-pasto 2×2).
- Para **caras inclinadas de acantilado, estratos rocosos y mezcla de tierra/musgo en bordes**, `AssetProvider` expondrá un **set compacto de texturas tileables `RepeatWrapping`** extraídas en memoria desde `tiles_5x5_albedo/normal` (p. ej. `cliff_rock`, `mossy_stone`, `cracked_stone`, `dirt`, `sand`, `snow`) combinadas en un **Texture2DArray** (WebGL2) o **2 materiales dedicados por chunk** (`terrainSurfaceMat` + `terrainCliffMat`) con proyección triplanar/planar cuantizada en coordenadas de mundo (`floor(wp * 16.0) / 16.0`). Esto elimina por completo el bleeding de celdas vecinas del atlas y mantiene 2–3 draw calls por chunk.

---

## 10. Diseño de la escena de prueba objetivo

> **Nota**: Esta escena se especifica únicamente como **prototipo de validación en papel (P0)** para verificar las fases P1–P4. **No existe ni ha sido creada en el código.**

### 10.1 Especificación espacial (`32×32` tiles, bioma `forest` / `meadow` ribereño)

Se propone un mapa de validación aislado (p. ej. `test_hd2d_riverbank`, de `32×32` celdas = `32×32` unidades de mundo):

1. **Tres mesetas rocosas a alturas distintas**:
   - **Meseta A (Nivel 1 — Ribera baja, `y = 0.5`)**: Orilla oeste/sur con suelo de tierra húmeda y pasto (`z = 18..28`), bordeando directamente el cauce del río.
   - **Meseta B (Nivel 3 — Terraza intermedia, `y = 1.5`)**: Promontorio central-norte (`x = 8..22, z = 10..19`) con borde orgánico saliente hacia el río, suelo mixto pasto/tierra y un claro caminable. Conectada a Meseta A mediante una rampa/escalera de piedra protegida (`x = 14..15, z = 19`).
   - **Meseta C (Nivel 5 — Mirador alto rocoso, `y = 2.5`)**: Risco noreste (`x = 18..29, z = 3..12`) con pared rocosa expuesta de 2 unidades (`4` niveles sobre el río y `2` sobre la Meseta B), coronado por pinos/robles y ruina/pilar decorativo. Conectada a Meseta B mediante escalera protegida en `(20, 12..13)`.
2. **Bordes orgánicos e irregulares**:
   - Las esquinas exteriores de las Mesetas B y C se achaflanan y desplazan de forma determinista (`±0.22` u) rompiendo el perfil de caja de 90°.
   - Los hombros superiores presentan cornisa erosionada (`0.10` u) con parches de musgo.
3. **Paredes rocosas visibles**:
   - El frente sur de la Meseta C (`z ≈ 12`) y el frente suroeste de la Meseta B (`z ≈ 19`) miran directamente hacia la cámara por defecto (`yaw = 0`, mirando hacia `-Z`), exhibiendo estratos horizontales, facetas de roca con sombreado direccional real, grietas oscurecidas en base por vértice + `PixelSsaoShader`, y enredaderas ancladas a la cornisa.
4. **Transiciones tierra / pasto / roca**:
   - El camino caminable de tierra (`,` / `=`) difumina sus bordes hacia el pasto mediante `aSurfaceWeights`.
   - En las crestas con `normal.y < 0.72` y junto a los pies de los acantilados aparece transición natural de roca/grava/tierra antes de fundirse con la hierba.
5. **Musgo y vegetación agrupada**:
   - 3 *clusters* compuestos (en esquinas no bloqueantes de las mesetas y márgenes): cada cluster agrupa 1 árbol principal (`oak` o `pine`), 2–3 arbustos satélite (`bush`), 1–2 rocas bajas (`boulder`) en la base y parches de flores/helechos con ligera variación de escala (`0.78..1.18`) y offset sub-tile.
6. **Agua interactuando con las plataformas**:
   - Un río sinuoso de 4–6 tiles de ancho cruza diagonalmente el cuadrante sureste (`nivel 0`, superficie en `y = 0.045`).
   - La plataforma de Meseta A desciende con talud arenoso/pedregoso suave bajo el agua; el acantilado de Meseta B cae directamente a una ribera profunda con espuma adaptada al contorno curvo de la orilla.
7. **Camino navegable garantizado**:
   - Trayecto continuo validado por `isTileWalkable`: entrada sur `(14, 29)` → ribera Meseta A → escalera `(14, 19)` → terraza Meseta B → escalera `(20, 12)` → mirador Meseta C `(24, 7)`, además de una pasarela/puente corto sobre un brazo estrecho del río.

### 10.2 Criterios de aceptación visual y funcional de la escena de prueba
- Ningún vértice desplazado invade tiles transitables de distinto nivel ni bloquea la visibilidad del personaje (validado junto con `OcclusionCutout`).
- `isTileWalkable` y `sampleInterpolatedHeight` pasan exactamente los mismos invariantes que cualquier `MapDef` estándar.
- En cámara `fixed` (4 rotaciones) y `free_orbit`, las paredes rocosas no muestran caras invertidas, huecos entre chunks ni Z-fighting en orillas.

---

## 11. Riesgos técnicos y de rendimiento

| Riesgo | Impacto | Causa raíz en la arquitectura | Estrategia de mitigación |
|---|---|---|---|
| **Explosión de vértices / límite de índices `Uint16Array`** | Corrupción de malla o caída de FPS en mapas `56×48` | Subdividir cada tile interior además de los bordes multiplicaría por `×8–×16` los triángulos en los 2 pases (`sceneDepthTarget` + main) + `shadowMap`. | **Subdivisión estrictamente adaptativa**: el interior plano de mesetas sigue emitiendo `1` quad (`2` tris) por tile; solo tiles con `edgeMask > 0` o cambio de material subdividen a malla local `2×2` o chaflán. Mantener cada chunk `< 25,000` vértices (`< 65,535` para `Uint16Array`). |
| **Aumento de Draw Calls** | Cuello de botella CPU/WebGL en móviles | Crear un material por bioma/tile o emitir acantilados como meshes separados por plataforma. | Mantener batching por **chunk `16×16`** (`1` mesh con máximo 2–3 grupos de material) + `1` mesh global de `WaterSurface` + `InstancedMesh` por `PropKind` en `BillboardBatch`. |
| **Compilación de shaders y `customProgramCacheKey`** | Stuttering al entrar a mapas nuevos | Inyectar hooks distintos por mapa o no incluir variantes en `customProgramCacheKey`. | Un único shader maestro `terrain_diorama_v2` parametrizado solo por **uniforms** (`uWeatheringColor`, `uCliffTint`, etc.) reutilizado entre biomas y mapas. |
| **UV Bleeding en atlas `8×8`** | Líneas de color ajeno en bordes de acantilados y pendientes | Interpolar UVs sobre un atlas empaquetado sin mipmaps ni padding en caras inclinadas. | Separar el muestreo de roca/tierra/musgo de laderas hacia texturas `RepeatWrapping` limpias (`64×64` / `128×128`) extraídas una vez en `AssetProvider`. |
| **Overdraw y doble render en `OverworldPostFx`** | Caída por debajo de 30 fps en GPUs móviles o integradas | `OverworldPostFx` renderiza primero al `sceneDepthTarget` (`HalfFloatType`) y luego ejecuta `PixelSsaoShader` + `UnrealBloomPass` + `DioramaGradeShader`. | Agregar **frustum culling por chunk** (`THREE.Frustum` contra `chunk.boundingBox`) además del radio `48`; no emitir caras de terreno ocultas bajo edificios o agua profunda; respetar `qualityTier === 'low'` y `isSoftwareGl`. |
| **Compatibilidad móvil y WebGL1/WebGL2** | Fallo de shader en dispositivos antiguos | Funciones exclusivas de WebGL2 (`texture2DArray`, derivadas no soportadas sin cuidado). | Mantener shaders en GLSL compatible con `MeshStandardMaterial` de Three.js (`THREE.ShaderChunk`) evitando dependencias obligatorias de `Texture2DArray` si basta con 2 materiales o un sub-atlas `2×2` con padding. |
| **Regresión en mapas existentes y tests** | Rotura visual en `villa_origen`, `pueblo_bruma`, `cueva_eco` o tests actuales | Cambios abruptos de altura o remoción de `aCliffMeta` rompe `tests/diorama-terrain.test.ts` y `tests/tiles-atlas.test.ts`. | Mantener compatibilidad retroactiva de `MapDef`, conservar `aCliffMeta` y `detectCliffBoundaries` como contrato base, e introducir un flag/modo de mesher o evolución progresiva validada contra los 8 mapas actuales en cada fase. |

---

## 12. Roadmap de implementación (P1–P5)

### Fase P1 — Infraestructura de contorno, separación Lógico/Visual y escena de prueba base
- **Objetivo**: Implementar `TerrainContourAnalyzer.ts` (extracción de islas, *Protected Footprints*, clasificación de esquinas y bordes), evolucionar `TerrainMesher.ts` con subdivisión adaptativa de bordes y mesetas con esquinas chaflanadas/orgánicas acotadas, añadir frustum culling por chunk y crear la **escena de prueba objetivo** aislada para validación automatizada y visual.
- **No incluye aún**: Texturas triplanares nuevas, clusters de vegetación ni agua orgánica (aún usa la base actual para validar geometría pura).
- **Criterio de éxito**: Todos los mapas actuales y la escena de prueba construyen chunks sin huecos, `isTileWalkable` y `tests/diorama-terrain.test.ts` pasan sin regresiones, y `< 20,000` vértices por chunk.

### Fase P2 — Paredes rocosas orgánicas, estratos, cornisa y ornamentos adaptados
- **Objetivo**: Implementar `RockyCliffMesher.ts` integrando estratos rocosos facetados, hombros biselados, salientes de cornisa acotados (`0.08–0.15` u), taludes basales de pie de acantilado y normales calculadas por cara/vértice. Actualizar `CliffOrnamentMesher.ts` para anclar enredaderas/estalactitas a segmentos reales del contorno.
- **Criterio de éxito**: En la escena de prueba, las 3 mesetas muestran paredes rocosas con volumen, estratos y luz direccional diferenciada sin Z-fighting ni cortes en escaleras o edificios.

### Fase P3 — Materiales por orientación/altura, transiciones de terreno y texturas tileables
- **Objetivo**: Implementar `SurfaceTransitionPlanner.ts` + atributo de mezcla de superficies, exponer texturas tileables limpias (`cliff_rock`, `mossy_stone`, `cracked_stone`, `dirt`, `sand`, `snow`) en `AssetProvider.ts` sin bleeding de atlas, y ampliar `TerrainWeatheringShader.ts` (v2) para mezclar pasto↔tierra↔roca↔musgo↔nieve con estética pixel-crisp cuantizada según `normal.y`, elevación y proximidad a bordes.
- **Criterio de éxito**: Transiciones naturales tierra/roca/musgo visibles en caminos, cimas y pies de acantilado tanto en la escena de prueba como en `ruta_1`, `pueblo_bruma` y `ruta_2`.

### Fase P4 — Agua con ribera orgánica y vegetación agrupada compositivamente
- **Objetivo**: Evolucionar `WaterSurface.ts` (contorno suavizado acoplado al borde orgánico + lecho costero gradual + `aShore` continuo) e implementar `FoliageClusterPlanner.ts` integrado con `OverworldScene.collectPropPlacements` y `BillboardBatch.ts` (clusters de árbol + arbusto + roca + micro-vegetación con offset sub-tile, diferenciando props sólidos de visuales).
- **Criterio de éxito**: Ribera continua en la escena de prueba y lagos/canales de `villa_origen`, `pueblo_bruma` y `ruta_2`; vegetación agrupada de forma artística sin invadir caminos ni romper colisiones.

### Fase P5 — Pulido artístico, validación en todos los mapas, optimización móvil y limpieza
- **Objetivo**: Revisar los 6 mapas exteriores existentes (`villa_origen`, `ruta_1`, `pueblo_bruma`, `ruta_2`, `cueva_eco`, `arena_cumbre`) en los 4 yaws de cámara y en viewport móvil; ajustar parámetros de `PixelSsaoShader` / `OverworldAtmosphere` / `QualityTier`; eliminar emisión de caras bajo edificios/agua oculta; perfilar FPS y memoria WebGL.
- **Criterio de éxito**: Build, lint, suite completa de tests y verificación visual en navegador (desktop + móvil) limpios en todos los mapas del juego.

---

## 13. Archivos concretos que se modificarían en cada etapa

| Fase | Archivos existentes a modificar | Archivos nuevos a crear |
|---|---|---|
| **P1** *(Contornos, mesetas orgánicas y escena de prueba)* | `src/engine/TerrainMesher.ts` *(subdivisión adaptativa, mesetas chaflanadas, frustum culling)*<br>`src/scenes/OverworldScene.ts` *(frustum culling por frame y soporte para escena de prueba)*<br>`src/data/maps/index.ts` *(registro opcional/dev o test map de validación)*<br>`tests/diorama-terrain.test.ts` *(ampliar cobertura de contornos y límites)* | `src/engine/TerrainContourAnalyzer.ts` *(análisis puro de islas, Protected Footprints y esquinas)*<br>`src/data/maps/testRiverbank.ts` *(escena de prueba objetivo 32×32, o fixture dedicado)*<br>`tests/terrain-contour.test.ts` *(tests unitarios puros sin WebGL)* |
| **P2** *(Acantilados rocosos, estratos y ornamentos)* | `src/engine/TerrainMesher.ts` *(delegar muros/taludes a `RockyCliffMesher`)*<br>`src/engine/CliffOrnamentMesher.ts` *(anclaje sobre segmentos de cornisa orgánicos)*<br>`src/engine/DioramaLayers.ts` *(tipos de segmento/estrato de acantilado)* | `src/engine/RockyCliffMesher.ts` *(geometría de paredes rocosas facetadas, estratos y talud basal)* |
| **P3** *(Transiciones de superficie y materiales)* | `src/gfx/AssetProvider.ts` *(getters de texturas `RepeatWrapping` para roca/tierra/musgo/arena/nieve)*<br>`src/engine/TerrainWeatheringShader.ts` *(shader v2 multi-superficie por pendiente, altura y bordes)*<br>`src/engine/TerrainMesher.ts` *(emisión de atributo `aSurfaceWeights`)*<br>`src/scenes/OverworldScene.ts` *(enlazar texturas al material de terreno/acantilado)* | `src/engine/SurfaceTransitionPlanner.ts` *(cálculo determinista de pesos de transición por vértice)* |
| **P4** *(Agua ribereña y vegetación agrupada)* | `src/engine/WaterSurface.ts` *(malla suavizada acoplada a contorno de costa y `aShore` continuo)*<br>`src/engine/TerrainMesher.ts` *(lecho gradual bajo orillas)*<br>`src/engine/BillboardBatch.ts` *(soporte de clusters/micro-props no sólidos y variación)*<br>`src/scenes/OverworldScene.ts` *(usar `FoliageClusterPlanner` en `collectPropPlacements`)* | `src/engine/FoliageClusterPlanner.ts` *(planificación pura de bosquecillos, sotobosque y juncos de ribera)*<br>`tests/foliage-cluster.test.ts` *(verificar respeto estricto a `isTileWalkable` y caminos)* |
| **P5** *(Pulido global, rendimiento y QA)* | `src/engine/OverworldPostFx.ts` / `src/engine/PixelSsaoShader.ts` *(ajuste fino de AO en acantilados)*<br>`src/engine/OverworldAtmosphere.ts` *(ajuste de sombras/partículas en ribera)*<br>`src/data/maps/villaOrigen.ts`, `ruta1.ts`, `puebloBruma.ts`, `ruta2.ts`, `cuevaEco.ts`, `arenaCumbre.ts` *(ajustes visuales menores no destructivos si procede)* | — *(ninguno)* |
