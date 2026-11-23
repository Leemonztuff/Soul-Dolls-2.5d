# P1 — Organic Plateaus & Terrain Contour System

Estado: **Implementado y verificado** (fase P1 completa; no incluye sistemas P2–P4).

---

## 1. Resumen Ejecutivo

Se implementó la primera fase del **Artistic World Engine HD-2D** de *SoulDolls 2.5D*, evolucionando el mallado de mesetas de bloques estrictamente ortogonales `1×1` hacia **mesetas con contornos orgánicos, esquinas convexas achaflanadas, esquinas cóncavas suavizadas y aristas erosionadas deterministas**, conservando intacta al 100 % la capa lógica (*Logical World*).

---

## 2. Archivos Creados y Modificados

### Creados
- `src/engine/TerrainContourAnalyzer.ts`
  - Módulo puro TypeScript (cero dependencias de `three`) que analiza el mapa lógico antes del mallado.
  - Exporta `TERRAIN_CONTOUR_PARAMS` y `analyzeTerrainContours(map)`.
- `src/data/maps/testRiverbank.ts`
  - Mapa aislado de validación `test_riverbank` (`32×32`, `2×2` chunks exactos cruzando costuras en `x=16` y `z=16`) con 3 niveles principales de altura (`1`, `3`, `5`), canal de río (`0`) y puente (`B`), 2 escaleras (`^`), corredor estrecho de 2 tiles, esquinas convexas, bahía cóncava, borde de piedra sólida (`#`) y edificio protegido (`house_red`).
- `tests/terrain-contour.test.ts`
  - Suite de 9 pruebas unitarias e integración sin WebGL ni pérdida de invariantes lógicas.
- `docs/world-engine/P1_ORGANIC_PLATEAUS.md`
  - Este documento técnico de cierre de P1.

### Modificados
- `src/engine/TerrainMesher.ts`
  - Evolución de `buildTerrainChunks` (parámetro opcional `options?: { organic?: boolean }`, por defecto `!map.isInterior`) para emitir:
    - Quads rápidos `1×1` en interiores planos de meseta (`isPlainInterior === true`).
    - Abanico estrellado indexado (`center + topPolygon`) en bordes/esquinas orgánicas.
    - Relleno inferior estanco (`lowerFloorQuads` / `lowerFloorTris`) a la altura `yBottom` del tile inferior adyacente, evitando agujeros y superposiciones.
    - Bandas verticales de acantilado siguiendo cada `rimSegment` con normales horizontales normalizadas (`(-dz/len, 0, dx/len)`), sombreado direccional suave e interpolación UV acotada en el atlas.
  - Cálculo de `boundingBox` (`THREE.Box3`) por chunk en `TerrainChunk`.
  - Soporte opcional de `THREE.Frustum` en `updateVisibleTerrainChunks(chunks, playerX, playerZ, viewRadius = 48, frustum?)`.
- `src/engine/CliffOrnamentMesher.ts`
  - `buildCliffOrnamentsMesh` ajusta los ornamentos de acantilado (`edge_lip`, `hanging_vine`, `crystal_icicle`, `cracked_trim`) a los `rimSegments` orgánicos reales en lugar de quedar flotando en el borde cuadrado previo, manteniendo intacto el contrato unitario de `planCliffOrnaments`.
- `src/data/maps/index.ts`
  - Registro aislado `DEV_MAPS = { test_riverbank: MAP_TEST_RIVERBANK }` y resolución en `getMap(id)` sin contaminar `MAPS` ni las pruebas de portales de historia (`tests/map-passages.test.ts`).
- `src/i18n/es.ts`
  - Etiqueta `ES.maps.test_riverbank`.
- `src/core/Game.ts`
  - Soporte de `?testmap=<id>` para arrancar directamente `OverworldScene` en mapas de validación aislados (`?testmap=test_riverbank`).
- `src/scenes/OverworldScene.ts`
  - Reconocimiento de `DEV_MAPS[mapId]` en `loadMap` y actualización de *frustum culling* por chunk sin asignaciones por frame (con verificación *dirty* de posición/rotación/aspecto de cámara y celda del jugador).
- `tests/diorama-terrain.test.ts`
  - Actualización de la prueba 1 para verificar geometría triangular orgánica indexada (`areaHorizontalTotal === 25.0`, altura `Y` uniforme por triángulo, normales horizontales unitarias en acantilados y UVs dentro de `cliff_rock`).

---

## 3. Diseño Geométrico y Continuidad Determinista

1. **Invarianza Lógica Absoluta**
   - No se modificaron `MapDef`, `HEIGHT_UNIT` (`0.5`), `TerrainRules.ts` (`isTileWalkable`, `sampleInterpolatedHeight`), `CameraRig.ts`, warps, spawns ni mapas existentes de historia.
   - Todas las retracciones orgánicas ocurren estrictamente **hacia el interior del tile elevado** (`[x - 0.5, x + 0.5] × [z - 0.5, z + 0.5]`). Ninguna meseta superior invade un tile inferior vecino.

2. **Continuidad Entre Tiles y Chunks (`16×16`)**
   - Cada vértice de la rejilla global `(vx, vz)` se evalúa una sola vez en coordenadas globales enteras usando `hashGrid2D(vx, vz, seed, salt)` (cero `Math.random()`, cero estado local de chunk).
   - Los 4 tiles que comparten `(vx, vz)` reciben exactamente los mismos puntos de esquina y transición (`tlPoints`, `trPoints`, `brPoints`, `blPoints`), garantizando continuidad IEEE-754 exacta a través de las fronteras entre chunks (`x = 16·k`, `z = 16·k`).
   - Cuando `3` o más alturas distintas convergen en un mismo vértice de rejilla, el vértice se bloquea (`inset = 0`) para eliminar ambigüedades multi-nivel.

3. **Zonas Protegidas y Corredores Estrechos**
   - Permanecen ortogonales/bloqueados: `map.isInterior`, agua (`water`), escaleras (`stairs`), puentes (`bridge`), footprints de `buildings`, vecindad `1-ring` de `warps`, `cobble` y `arena_floor`.
   - En acantilados colindantes con `stairs`, `getLowerTileInfo` desciende hasta la altura base mínima vecina de la escalera (`getStairTileBaseY`) para cerrar rendijas laterales.
   - Los corredores transitables de `1–2` tiles de anchura limitan su desplazamiento a `CORRIDOR_MAX_OFFSET = 0.10` y `CORRIDOR_MAX_CHAMFER = 0.14` para evitar estrechamiento visual.

4. **Parámetros Centralizados (`TERRAIN_CONTOUR_PARAMS`)**
   - `MAX_EDGE_OFFSET = 0.22`
   - `WALKABLE_MAX_EDGE_OFFSET = 0.16`
   - `CONVEX_CHAMFER_SOLID = 0.28` (`±0.04` jitter)
   - `CONVEX_CHAMFER_WALKABLE = 0.21` (`±0.04` jitter)
   - `CONCAVE_FILLET_INSET = 0.21`, `CONCAVE_FILLET_CURVE = 0.42`
   - `CORRIDOR_MAX_OFFSET = 0.10`, `CORRIDOR_MAX_CHAMFER = 0.14`

---

## 4. Presupuesto de Vértices Medido (`CHUNK_SIZE = 16`, objetivo `< 20,000`)

Medición real ejecutada sobre `buildTerrainChunks(map, terrainMat, grassMat)`:

| Mapa | Chunks | Máx. vértices/chunk | Promedio vértices/chunk | Estado vs objetivo `< 20,000` |
| --- | ---: | ---: | ---: | --- |
| `test_riverbank` | 4 | 2,083 | 1,748 | Cumple (`~10.4%`) |
| `villa_origen` | 9 | 5,082 | 3,398 | Cumple (`~25.4%`) |
| `ruta_1` | 12 | 4,402 | 3,003 | Cumple (`~22.0%`) |
| `pueblo_bruma` | 9 | 4,421 | 2,862 | Cumple (`~22.1%`) |
| `ruta_2` | 12 | 4,710 | 3,216 | Cumple (`~23.6%`) |
| `cueva_eco` | 9 | 5,474 | 4,047 | Cumple (`~27.4%`) |
| `arena_cumbre` | 9 | 5,561 | 3,232 | Cumple (`~27.8%`) |
| Interiores (`laboratorio_origen`, `taller_origen`, `casa_*`) | 1–2 | 560–832 | 468–650 | Cumple (`100%` protegidos) |

---

## 5. Verificaciones Ejecutadas

1. **Suite completa de tests (`npm test` -> `vitest run`)**:
   - **53 archivos de test aprobados / 260 tests aprobados** (`0` fallos).
   - Incluye `tests/terrain-contour.test.ts` (9 tests: regiones conectadas, esquinas convexas, filetes cóncavos compartidos, protección de estructuras/interiores, determinismo y cota `MAX_EDGE_OFFSET`, preservación de corredores estrechos, continuidad de costuras `x=16, z=16`, cero vértices `NaN`/triángulos degenerados, presupuesto `< 20,000` en todos los mapas, *frustum culling*, e invarianza de `TerrainRules`).
2. **Type-check (`npm run lint` -> `tsc --noEmit`)**:
   - **0 errores**.
3. **Build de producción (`npm run build` -> `vite build`)**:
   - **Exitoso** (`212` módulos transformados).
4. **Inspección visual en navegador real (Playwright Headless Chromium `1440×900`)**:
   - `http://localhost:3000/?testmap=test_riverbank`: captura inicial, ascenso por escaleras hacia meseta nivel 3 y rotación sobre costura `x=16` / bahía cóncava (`0` errores de consola). Durante la primera inspección se detectaron rendijas laterales junto a las escaleras y desfase en ornamentos de acantilado sobre bordes retraídos; ambos defectos fueron corregidos en `TerrainContourAnalyzer.ts` y `CliffOrnamentMesher.ts` y verificados visualmente en una segunda captura.
   - `http://localhost:3000/?testmap=villa_origen` y `http://localhost:3000/`: verificación de regresión visual y de pantalla de título con `0` errores de consola.

---

## 6. Limitaciones Conocidas y Pendientes para P2–P4

- **Pendiente P2 (Rocky Cliff Architecture)**: los acantilados siguen usando el muro vertical extruido en bandas con atlas `cliff_rock`/`mossy_stone`/`cracked_stone`; aún no existen estrías rocosas multi-nivel ni cornisas volumétricas (`RockyCliffMesher`).
- **Pendiente P3 (Surface Transitions & Materials)**: los cambios entre pasto/tierra/piedra/nieve conservan bordes por tile; falta planificación de transiciones y mezcla multi-superficie (`SurfaceTransitionPlanner`).
- **Pendiente P4 (Organic Water, Shorelines & Foliage Clusters)**: el agua y sus vértices adyacentes permanecen bloqueados ortogonalmente (`inset = 0`) en P1 para no romper el contacto con `WaterSurface`; las orillas orgánicas y agrupación artística de vegetación corresponden a P4.
- Nota de visualización existente: `StaircaseMesher.ts` solo genera huellas y contrahuellas frontales (contrato validado en `tests/diorama-terrain.test.ts` de `32` vértices por escalera), por lo que cuando `OcclusionCutout` disuelve un acantilado lateral justo detrás de la cámara junto a una escalera, puede verse el perfil abierto bajo los peldaños en ángulos rasantes.
