import type { MapDef } from './types.ts';

export interface QuestDef {
  id: string;
  title: string;
  objective: string;
  targetMapId: string;
  targetX: number;
  targetY: number;
  radius: number;
}

export const MAIN_QUESTS: readonly QuestDef[] = [
  {
    id: 'q_plaza_soulpots',
    title: 'El Despertar',
    objective: 'Entra al Laboratorio del Prof. Robledo y elige tu SoulDoll',
    targetMapId: 'laboratorio_origen',
    targetX: 12,
    targetY: 5,
    radius: 3,
  },
  {
    id: 'q_estanque_este',
    title: 'Estanque del Este',
    objective: 'Explora la orilla del estanque al este de Villa Origen',
    targetMapId: 'villa_origen',
    targetX: 32,
    targetY: 24,
    radius: 2,
  },
  {
    id: 'q_paso_norte',
    title: 'Paso del Norte',
    objective: 'Toma el sendero norte hacia la Ruta 1',
    targetMapId: 'villa_origen',
    targetX: 23,
    targetY: 4,
    radius: 3,
  },
  {
    id: 'q_ruta1_claro',
    title: 'Sendero Verde',
    objective: 'Explora el claro del norte en la Ruta 1',
    targetMapId: 'ruta_1',
    targetX: 25,
    targetY: 13,
    radius: 3,
  },
  {
    id: 'q_pueblo_bruma',
    title: 'Pueblo Bruma',
    objective: 'Llega a la plaza central de Pueblo Bruma',
    targetMapId: 'pueblo_bruma',
    targetX: 24,
    targetY: 25,
    radius: 3,
  },
  {
    id: 'q_gimnasio_bruma',
    title: 'Medalla Bruma',
    objective: 'Desafía al Líder Bruma dentro del Gimnasio de Pueblo Bruma',
    targetMapId: 'gimnasio_bruma',
    targetX: 7,
    targetY: 4,
    radius: 2,
  },
  {
    id: 'q_ruta2_puente',
    title: 'Puente del Lago',
    objective: 'Cruza los puentes del lago en la Ruta 2',
    targetMapId: 'ruta_2',
    targetX: 27,
    targetY: 34,
    radius: 3,
  },
  {
    id: 'q_cueva_eco',
    title: 'Cristales de Eco',
    objective: 'Explora las cámaras de cristal en Cueva Eco',
    targetMapId: 'cueva_eco',
    targetX: 25,
    targetY: 21,
    radius: 3,
  },
  {
    id: 'q_arena_cumbre',
    title: 'Liga Cumbre',
    objective: 'Entra al Salón de la Liga Cumbre y desafía a la Maestra Valeria',
    targetMapId: 'liga_cumbre',
    targetX: 7,
    targetY: 4,
    radius: 3,
  },
];

export interface QuestProgressResult {
  updated: boolean;
  nextIndex: number;
  completedQuest: QuestDef | null;
}

export interface QuestNavTarget {
  x: number;
  y: number;
  viaMapId: string;
  isCrossMap: boolean;
  distance: number;
}

export function clampQuestIndex(index: unknown, total = MAIN_QUESTS.length): number {
  if (typeof index !== 'number' || !Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(total, Math.floor(index)));
}

export function getActiveQuest(
  questIndex: number,
  quests: readonly QuestDef[] = MAIN_QUESTS
): QuestDef | null {
  const idx = clampQuestIndex(questIndex, quests.length);
  return idx < quests.length ? quests[idx] : null;
}

export function isAtQuestCoordinates(
  quest: QuestDef,
  mapId: string,
  x: number,
  y: number
): boolean {
  if (mapId !== quest.targetMapId) return false;
  const dist = Math.hypot(x - quest.targetX, y - quest.targetY);
  return dist <= quest.radius;
}

export function evaluateQuestProgress(
  questIndex: number,
  mapId: string,
  x: number,
  y: number,
  quests: readonly QuestDef[] = MAIN_QUESTS
): QuestProgressResult {
  const curIdx = clampQuestIndex(questIndex, quests.length);
  const active = getActiveQuest(curIdx, quests);
  if (!active) {
    return { updated: false, nextIndex: curIdx, completedQuest: null };
  }
  if (!isAtQuestCoordinates(active, mapId, x, y)) {
    return { updated: false, nextIndex: curIdx, completedQuest: null };
  }
  return {
    updated: true,
    nextIndex: curIdx + 1,
    completedQuest: active,
  };
}

function findNextHopMapId(
  fromMapId: string,
  targetMapId: string,
  allMaps: Record<string, MapDef>
): string | null {
  if (fromMapId === targetMapId) return null;
  const queue: string[] = [fromMapId];
  const visited = new Set<string>([fromMapId]);
  const firstHop = new Map<string, string>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const map = allMaps[cur];
    if (!map) continue;
    for (const w of map.warps) {
      const next = w.targetMap;
      if (visited.has(next)) continue;
      visited.add(next);
      const hop = cur === fromMapId ? next : (firstHop.get(cur) ?? next);
      firstHop.set(next, hop);
      if (next === targetMapId) return hop;
      queue.push(next);
    }
  }
  return null;
}

export function resolveQuestNavTarget(
  quest: QuestDef,
  currentMap: MapDef,
  playerX: number,
  playerZ: number,
  allMaps: Record<string, MapDef>
): QuestNavTarget {
  if (currentMap.id === quest.targetMapId) {
    return {
      x: quest.targetX,
      y: quest.targetY,
      viaMapId: quest.targetMapId,
      isCrossMap: false,
      distance: Math.hypot(quest.targetX - playerX, quest.targetY - playerZ),
    };
  }

  const nextHop = findNextHopMapId(currentMap.id, quest.targetMapId, allMaps);
  if (nextHop) {
    const matchingWarps = currentMap.warps.filter((w) => w.targetMap === nextHop);
    if (matchingWarps.length > 0) {
      let avgX = 0;
      let avgY = 0;
      for (const w of matchingWarps) {
        avgX += w.x;
        avgY += w.y;
      }
      avgX /= matchingWarps.length;
      avgY /= matchingWarps.length;
      return {
        x: avgX,
        y: avgY,
        viaMapId: nextHop,
        isCrossMap: true,
        distance: Math.hypot(avgX - playerX, avgY - playerZ),
      };
    }
  }

  return {
    x: quest.targetX,
    y: quest.targetY,
    viaMapId: quest.targetMapId,
    isCrossMap: true,
    distance: Math.hypot(quest.targetX - playerX, quest.targetY - playerZ),
  };
}

/**
 * Returns clockwise screen-space angle in degrees where 0° = top of screen (camera forward),
 * 90° = right of screen, 180° = bottom of screen, 270° = left of screen.
 */
export function computeQuestArrowAngleDeg(
  playerX: number,
  playerZ: number,
  targetX: number,
  targetZ: number,
  cameraYawRad: number
): number {
  const dx = targetX - playerX;
  const dz = targetZ - playerZ;
  if (dx * dx + dz * dz < 1e-6) return 0;

  const cosY = Math.cos(cameraYawRad);
  const sinY = Math.sin(cameraYawRad);
  const screenRight = dx * cosY - dz * sinY;
  const screenUp = -dx * sinY - dz * cosY;

  const deg = (Math.atan2(screenRight, screenUp) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}
