# P2 — Rocky Cliffs, Stratification & Erosion

Estado: **Implementado y verificado** (fase P2 completa; no incluye fases P3–P5).

---

## 1. Resumen Ejecutivo

Se completó la segunda fase del **Artistic World Engine HD-2D** de *SoulDolls 2.5D*, transformando las paredes verticales heredadas de P1 en **acantilados rocosos tridimensionales estratificados** con hombro superior biselado (*Cliff Shoulder*), labio saliente (*Overhang Lip*) y zona inferior sombreada (*Overhang Underside*), estratos horizontales facetados alternando piedra/tierra/musgo según bioma, y talud basal (*Basal Talus*) asentado sobre el nivel inferior.

Asimismo, se actualizó `CliffOrnamentMesher.ts` para anclar `edge_lip`, `hanging_vine`, `crystal_icicle` y `cracked_trim` directamente sobre la geometría 3D generada del acantilado y su cresta de cornisa, respetando la invarianza absoluta del *Logical World*, el sistema de chunks `16×16` y el presupuesto `< 20,000` vértices/chunk.

---

## 2. Archivos Creados y Modificados

### Creados
- `src/engine/RockyCliffMesher.ts`
  - Módulo puro TypeScript (cero dependencias de `three`) desacoplado de `OverworldScene`.
  - Exporta `ROCKY_CLIFF_PARAMS`, `classifyCliffSegmentSurface`, `RockyCliffBuildContext`, `appendTileRockyCliffs` y `extractRockyCliffOrnamentAnchors`.
  - Separa explícitamente:
    1. **Clasificación de superficies** (`classifyCliffSegmentSurface`): paletas de estratos por bioma (`meadow`, `forest`, `mountain`, `snow`, `cave`, `coast`, `arena`), protección de muros arquitectónicos y elegibilidad de *overhang*, talud y ornamentos.
    2. **Generación de geometría 3D y cálculo de normales** (`buildGlobalMiterLookup`, `buildProfileColumnNodes`, `emitColumnBand`, `pushBandQuad`): perfil vertical completo en coordenadas globales, biselado por inglete compartido entre tiles y costuras de chunk, facetas horizontales en segmentos largos y normales unitarias 3D por banda.
    3. **Asignación de materiales/UV y metadatos** (`aCliffMeta`): alternancia de slots en el atlas existente (`cliff_rock`, `cracked_stone`, `mossy_stone`, `dirt`, `stone`, `sand`, `snow`, `cave_floor`) sin crear materiales ni shaders nuevos.
    4. **Extracción de anclas para ornamentos** (`extractRockyCliffOrnamentAnchors`): coordenadas 3D exactas del borde superior y de la cresta de cornisa con altura libre segura sobre el talud basal.
- `tests/rocky-cliff-mesher.test.ts`
  - Suite de 6 pruebas cubriendo clasificación por bioma y zonas protegidas, normales 3D de hombro/socavado/talud, determinismo, continuidad exacta en costuras `x=16` y `z=16`, presupuesto `< 20,000` vértices en todos los mapas y anclaje de ornamentos 3D.
- `docs/world-engine/P2_ROCKY_CLIFFS.md`
  - Este reporte técnico y de validación de P2.

### Modificados
- `src/engine/TerrainMesher.ts`
  - Sustitución de la emisión plana de caras verticales de `rimSegments` por `RockyCliffBuildContext` + `appendTileRockyCliffs`, manteniendo el mallado `1×1` / abanicos orgánicos P1, el sistema de chunks `16×16`, `MeshStandardMaterial`, `aCliffMeta`, `TerrainWeatheringShader`, `OcclusionCutout` y la ruta heredada `organic: false` para interiores.
- `src/engine/CliffOrnamentMesher.ts`
  - `buildCliffOrnamentsMesh` consume `extractRockyCliffOrnamentAnchors` en lugar de proyectar rectángulos desde fronteras cuadradas.
  - `edge_lip` y `cracked_trim` se inclinan siguiendo el bisel 3D entre `yRimTop` y `yLipBottom`; `hanging_vine` y `crystal_icicle` cuelgan verticalmente desde la cresta del labio saliente frente a la zona socavada sin penetrar roca ni talud basal.
  - Densidad acotada (`~50%` de segmentos con ornamentos), inversión UV y variación cromática determinista para dejar visible el esculpido rocoso y evitar repetición uniforme.
- `tests/diorama-terrain.test.ts`
  - Actualización de la prueba 1 para verificar normales unitarias 3D variadas (pendientes positivas en hombros/taludes y negativas en socavados `ny < -0.05`), `aCliffMeta.x === 1.0`, UVs acotadas dentro de los tiles válidos de roca/tierra del atlas y conservación exacta del área horizontal (`25.0`).

---

## 3. Diseño de Geometría 3D, Estratos y Cornisas

1. **Rocky Wall y Facetas Angulares**
   - Los segmentos largos (`segLen > LONG_SEGMENT_SPLIT_THRESHOLD = 0.66`) se subdividen en `2` sub-columnas horizontales en `t = 0.5`. El vértice interior evalúa desplazamiento determinista por coordenada mundial `(x, y, z)` (`FACET_DEPTH_JITTER = 0.04`) sin alterar los extremos compartidos ni el pie/borde superior.
2. **Stratified Rock**
   - Bandas horizontales indexadas en altura global (`STRATUM_BASE_THICKNESS = 0.24`) con ondulación suave (`±0.03` u), alternando piedra, tierra, roca agrietada o musgo según `strataPalette` del bioma.
   - El emparejamiento estructural entre columnas (`bandKind` + `stratumIndex`) evita cortes milimétricos redundantes y mantiene unión vértice a vértice en `x = 16·k` y `z = 16·k`.
3. **Cliff Shoulder (`0.08–0.14` alto / bisel `<= 0.15`)**
   - Conecta la arista superior exacta (`s = 0` sobre `topPolygon`) con el muro rocoso sin invadir la plataforma caminable ni provocar grietas.
4. **Overhang Lip (`0.08–0.15` extrusión) & Underside**
   - Extrusión controlada sobre el muro retranqueado inferior (`sUndercut`), con `topFactor` alto en la cara superior del labio y `baseAO = 0.68` en la cara inferior (`overhang_underside`) para sombrear la oquedad en `TerrainWeatheringShader`.
   - Desactivado automáticamente en `isProtectedWall` (edificios, escaleras, puentes), `isWaterBank`, corredores estrechos y esquinas con vértice protegido (`protectedVertex = true` mantiene `s = 0` vertical para sellar encuentros con escaleras).
5. **Basal Talus (`0.09–0.22` alto)**
   - Faldón inclinado al pie del acantilado (`sTalusFoot >= 0`, `TALUS_MAX_OUTWARD_SOLID = 0.065`) que integra el muro con `lowerFloorQuads` / `lowerFloorTris` sin penetrar por debajo de `yBottom`.

---

## 4. Presupuesto de Vértices y Triángulos Medido (`CHUNK_SIZE = 16`, objetivo `< 20,000`)

Medición real ejecutada sobre `buildTerrainChunks(map, mat)` con la geometría final de P2:

| Mapa | Chunks | Máx. vértices/chunk | Promedio vértices/chunk | Máx. triángulos/chunk | Promedio triángulos/chunk | Estado vs `< 20,000` |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `test_riverbank` | 4 | 5,103 | 3,552 | 2,634 | 1,838 | Cumple (`~25.5%`) |
| `villa_origen` | 9 | 11,842 | 7,134 | 6,212 | 3,751 | Cumple (`~59.2%`) |
| `ruta_1` | 12 | 10,142 | 6,529 | 5,345 | 3,438 | Cumple (`~50.7%`) |
| `pueblo_bruma` | 9 | 10,185 | 6,128 | 5,366 | 3,241 | Cumple (`~50.9%`) |
| `ruta_2` | 12 | 10,645 | 6,912 | 5,586 | 3,635 | Cumple (`~53.2%`) |
| `cueva_eco` | 9 | 13,398 | 9,171 | 7,014 | 4,817 | Cumple (`~67.0%`) |
| `arena_cumbre` | 9 | 12,597 | 6,773 | 6,633 | 3,579 | Cumple (`~63.0%`) |
| Interiores (`laboratorio_origen`, `taller_origen`, `casa_*`) | 1–2 | 560–832 | 468–650 | 280–416 | 234–325 | Cumple (`100%` protegidos) |

---

## 5. Verificaciones Ejecutadas

- **Tests automatizados (`npm test` -> `vitest run`)**: **54 archivos / 266 tests aprobados** (`0` fallos).
- **Type-check (`npm run lint` -> `tsc --noEmit`)**: **0 errores**.
- **Compilación y build de producción (`compile_applet` / `npm run build`)**: **Exitoso**.
- **Inspección visual en navegador (Playwright Headless Chromium `1440×900`, `0` errores de consola)**:
  - `?testmap=test_riverbank`: inspección de los 4 ángulos de cámara (`Q`/`E`), subida por escalera sur hacia terraza intermedia, revisión frente a meseta nivel 5, bahía cóncava, puente/río, edificio protegido `house_red` y costuras `x=16, z=16`.
  - **Defectos detectados en Ronda 1 y corregidos antes de Ronda 2**:
    1. Se detectó una rendija vertical fina en la esquina donde la pared protegida junto a la escalera encontraba el retranqueo de un acantilado adyacente; corregido bloqueando `s = 0` en vértices con `protectedVertex === true` y verificado sin rendijas en Ronda 2.
    2. Se redujo la cobertura de ornamentos de ~75 % a ~50 % con tinte más orgánico y menor altura de remate (`trimDrop <= 0.16`) para evitar el aspecto repetitivo de parches verdes y exponer mejor el hombro rocoso esculpido.
  - Regresión en `?testmap=villa_origen` y pantalla de título `/`: renderizado limpio y `0` errores de consola.

---

## 6. Estado Claro: Implementado vs Verificado vs Pendiente

- **Implementado y Verificado (P1 + P2)**:
  - Contornos orgánicos de mesetas, costuras entre chunks, zonas protegidas, paredes rocosas 3D estratificadas, hombros biselados, labio saliente/socavado, talud basal y ornamentos 3D anclados al contorno real.
- **Pendiente (fuera de alcance en P2 — fases P3 a P5)**:
  - **P3**: `SurfaceTransitionPlanner`, texturas tileables sin atlas bleeding y mezcla avanzada por pendiente/altura en `TerrainWeatheringShader` v2.
  - **P4**: `WaterSurface` orgánico acoplado a orillas y `FoliageClusterPlanner` compositivo.
  - **P5**: Pulido global multi-mapa, optimización móvil y limpieza final.
- **Nota conocida sin impacto funcional**: las advertencias del navegador sobre `AudioContext` en `/` se deben a la política estándar de autoplay antes de la primera interacción del usuario; la geometría interior de mapas (`isInterior: true`) conserva deliberadamente el mallado ortogonal heredado.
