import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/data/maps/index.ts';
import {
  clampQuestIndex,
  computeQuestArrowAngleDeg,
  evaluateQuestProgress,
  getActiveQuest,
  MAIN_QUESTS,
  resolveQuestNavTarget,
} from '../src/domain/Quests.ts';
import { isInsideBuilding } from '../src/domain/TerrainRules.ts';
import { createInitialSave, migrateSaveData } from '../src/save/migrations.ts';

describe('Quest & Dynamic Arrow system', () => {
  it('places every main quest target on an existing, non-solid walkable tile', () => {
    for (const q of MAIN_QUESTS) {
      const map = MAPS[q.targetMapId];
      expect(map).toBeDefined();
      const ch = map.grid[q.targetY]?.[q.targetX];
      expect(ch).toBeDefined();
      const leg = map.legend[ch!];
      expect(leg).toBeDefined();
      expect(leg.solid).toBe(false);
      expect(isInsideBuilding(map.buildings, q.targetX, q.targetY)).toBe(false);
      expect(
        map.npcs.some((n) => n.x === q.targetX && n.y === q.targetY)
      ).toBe(false);
    }
  });

  it('advances quest objective only when reaching target map and coordinates within radius', () => {
    const first = MAIN_QUESTS[0];

    // Wrong map
    const wrongMap = evaluateQuestProgress(0, 'ruta_1', first.targetX, first.targetY);
    expect(wrongMap.updated).toBe(false);
    expect(wrongMap.nextIndex).toBe(0);

    // Same map, outside radius
    const far = evaluateQuestProgress(0, first.targetMapId, 24, 26);
    expect(far.updated).toBe(false);
    expect(far.nextIndex).toBe(0);

    // Inside radius
    const reached = evaluateQuestProgress(
      0,
      first.targetMapId,
      first.targetX + 1,
      first.targetY
    );
    expect(reached.updated).toBe(true);
    expect(reached.nextIndex).toBe(1);
    expect(reached.completedQuest?.id).toBe(first.id);

    // Past the last quest returns null active quest and does not advance further
    const lastIdx = MAIN_QUESTS.length;
    expect(getActiveQuest(lastIdx)).toBeNull();
    const afterAll = evaluateQuestProgress(lastIdx, 'liga_cumbre', 7, 4);
    expect(afterAll.updated).toBe(false);
    expect(afterAll.nextIndex).toBe(lastIdx);
  });

  it('routes cross-map objectives toward the connecting exit warp using BFS', () => {
    const brumaQuest = MAIN_QUESTS.find((q) => q.targetMapId === 'pueblo_bruma')!;
    const navFromOrigen = resolveQuestNavTarget(
      brumaQuest,
      MAPS.villa_origen,
      24,
      26,
      MAPS
    );
    expect(navFromOrigen.isCrossMap).toBe(true);
    expect(navFromOrigen.viaMapId).toBe('ruta_1');
    expect(navFromOrigen.y).toBe(0);

    const origenQuest = MAIN_QUESTS[0];
    const navBackFromRuta1 = resolveQuestNavTarget(
      origenQuest,
      MAPS.ruta_1,
      23,
      30,
      MAPS
    );
    expect(navBackFromRuta1.isCrossMap).toBe(true);
    expect(navBackFromRuta1.viaMapId).toBe('villa_origen');
    expect(navBackFromRuta1.y).toBe(59);
  });

  it('computes dynamic directional arrow angle relative to camera yaw', () => {
    // Yaw = 0: North (-Z) is UP (0°), East (+X) is RIGHT (90°), South (+Z) is DOWN (180°), West (-X) is LEFT (270°)
    expect(computeQuestArrowAngleDeg(10, 10, 10, 5, 0)).toBeCloseTo(0, 1);
    expect(computeQuestArrowAngleDeg(10, 10, 15, 10, 0)).toBeCloseTo(90, 1);
    expect(computeQuestArrowAngleDeg(10, 10, 10, 15, 0)).toBeCloseTo(180, 1);
    expect(computeQuestArrowAngleDeg(10, 10, 5, 10, 0)).toBeCloseTo(270, 1);

    // Yaw = +90° (camera looking West / -X): West (-X) becomes UP (0°), North (-Z) becomes RIGHT (90°)
    const yaw90 = Math.PI * 0.5;
    expect(computeQuestArrowAngleDeg(10, 10, 5, 10, yaw90)).toBeCloseTo(0, 1);
    expect(computeQuestArrowAngleDeg(10, 10, 10, 5, yaw90)).toBeCloseTo(90, 1);

    // Yaw = 180° (camera looking South / +Z): South (+Z) becomes UP (0°)
    expect(computeQuestArrowAngleDeg(10, 10, 10, 15, Math.PI)).toBeCloseTo(0, 1);
  });

  it('persists and clamps questIndex in save creation and migration', () => {
    const fresh = createInitialSave();
    expect(fresh.questIndex).toBe(0);

    const migratedValid = migrateSaveData({ ...fresh, questIndex: 3 });
    expect(migratedValid?.questIndex).toBe(3);

    const migratedClamped = migrateSaveData({ ...fresh, questIndex: 999 });
    expect(migratedClamped?.questIndex).toBe(MAIN_QUESTS.length);

    expect(clampQuestIndex(-5)).toBe(0);
    expect(clampQuestIndex(undefined)).toBe(0);
  });
});
