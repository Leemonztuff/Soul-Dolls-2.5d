# P4 — Water Shoreline Geometry & Surface Rendering

Estado: **Implementado, integrado con P1 y verificado**.

---

## 1. Resumen Técnico

La etapa **P4** conecta el contorno orgánico de mesetas (P1) con la malla de agua superficial (`WaterSurface.ts`) y el lecho subacuático (`TerrainMesher.ts`), manteniendo intacta la colisión discreta `water` en `src/domain/TerrainRules.ts`.

---

## 2. Arquitectura y Flujo

1. **Contornos naturales vs. canales arquitectónicos (`src/engine/TerrainContourAnalyzer.ts`)**
   - `archProtectedFlags` protege exclusivamente geometría rígida jugable o arquitectónica (`map.isInterior`, `stairs`, `bridge`, `cobble`, `arena_floor`, edificios y vecindad de warps), mientras que las celdas `water` continúan reportando `isProtected = true` en su metadato sin congelar artificialmente los vértices naturales tierra–agua.
   - Las orillas de hierba, tierra o arena retranquean su borde superior o biselan esquinas convexas/cóncavas hacia tierra firme, dejando expuestos *pockets* `lowerFloorQuads` / `lowerFloorTris` con `isWaterShore: true` y `bottomLevel`.
   - Esquinas ambiguas con mezcla simultánea de agua y tierra en el nivel inferior se bloquean automáticamente (`vertexLocked = 1`) para garantizar estanqueidad.
2. **Malla de agua adaptativa (`src/engine/WaterSurface.ts`)**
   - Emite cada celda `water` a `y = getTileWorldY + 0.045` y, cuando recibe `TerrainContourAnalysis`, extiende la superficie sobre todo `lowerFloorQuad` y `lowerFloorTri` marcado `isWaterShore: true` al nivel `bottomLevel * HEIGHT_UNIT + 0.045`.
   - Asigna `aShore = 1.0` a lo largo del borde interior junto al talud y gradiente continuo `cornerShoreAtWorld` hacia aguas abiertas para espuma animada, cáusticas cuantizadas y destellos HDR.
   - Renderiza con `DIORAMA_RENDER_ORDER.WATER_SURFACE`.
3. **Lecho subacuático simétrico (`src/engine/TerrainMesher.ts`)**
   - `shoreFactorAt(map, x, z, dx, dz)` evalúa simétricamente las 4 celdas que rodean cada esquina compartida (`(x+dx, z)`, `(x, z+dz)`, `(x+dx, z+dz)`), eliminando grietas verticales en esquinas interiores en `L`.
   - En `OverworldScene.stepSimulation`, la animación UV de respaldo (`updateTerrainWaterFrame`) solo se ejecuta cuando no hay `WaterSurface.mesh` activa.
