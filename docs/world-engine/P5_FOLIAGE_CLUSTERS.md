# P5 — Vegetation & Prop Clumping

Estado: **Implementado, filtrado por bioma/pendiente y verificado**.

---

## 1. Resumen Técnico

La etapa **P5** (`src/engine/FoliageClusterPlanner.ts` + `OverworldScene.collectPropPlacements`) agrupa árboles, arbustos, rocas y acentos florales en composiciones orgánicas deterministas respetando el bioma, la línea de nieve (`map.snowLine`), las densidades declaradas por el mapa, la pendiente del terreno y las rutas transitables.

---

## 2. Reglas de Filtrado y Composición

- **Exclusión de interiores y cuevas cerradas**: `planFoliageClusters` retorna vacío inmediatamente cuando `map.isInterior`, `map.biome === 'cave'` o `map.music === 'cave'` (en cuevas solo actúa la decoración mineral/cristalina explícita del mapa).
- **Respeto a `map.decoration` (`respectDensity: true` en `OverworldScene`)**:
  - Cuando `treeDensity <= 0`, `bushDensity <= 0`, `rockDensity <= 0` y `flowerDensity <= 0`, se omite cualquier generación aleatoria de esa categoría.
  - Los árboles seleccionan de `map.decoration.treeKinds` (si existe y no está vacío) o del catálogo filtrado por `map.biome` (`meadow`, `forest`, `coast`, `mountain`, `snow`, `arena`), aplicando sustitución por `snow_pine` solo cuando `tileLevel >= map.snowLine`.
- **Seguridad geométrica y de navegación (`tileIsFree`)**:
  - Exige celda transitable, no perteneciente a edificios/caminos/agua/puentes/escaleras/arena, pendiente cardinal `maxDiff <= 1` entre vecinos ortogonales para no flotar ni incrustarse sobre taludes P2 escarpados, y guarda cardinal anti-agua (`!hasAdjacentWater`) en árboles ancla.
- **Diferenciación por `clusterKind`**:
  - `inferClusterKind` distingue `'riverside'` (proximidad real a agua), `'rocky'` (alta elevación o terreno rocoso/montaña), `'forest'` (bioma bosque o alta densidad arbórea) y `'meadow'`, variando radio, presencia de árbol central, densidad de arbustos, flores ribereñas/pradera y rocas bajas.
- **Instancing estático (`BillboardBatch.ts`)**:
  - Los props estáticos (`isFixedDecor`: estructuras, bancos, cercas) omiten la re-subida GPU por frame de `instanceMatrix`; los árboles sólidos (`atlas_arbolmanzano_00`) no portan el flag `grass: true`.
