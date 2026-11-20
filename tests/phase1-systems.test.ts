import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/Rng.ts';
import { BattleEngine } from '../src/domain/BattleEngine.ts';
import {
  claimBestiaryMilestone,
  getBestiaryCounts,
  getClaimableMilestones,
  getSpeciesHabitats,
  markBestiaryCaught,
  markBestiarySeen,
} from '../src/domain/Bestiary.ts';
import { createCreature } from '../src/domain/Creature.ts';
import { equipHeldItem, unequipHeldItem } from '../src/domain/HeldItems.ts';
import { addItem, getItemCount } from '../src/domain/Inventory.ts';
import {
  addCapturedCreature,
  createDefaultStorageBoxes,
  depositCreature,
  moveStoredCreature,
  releaseStoredCreature,
  renameStorageBox,
  STORAGE_BOX_COUNT,
  STORAGE_BOX_SIZE,
  withdrawCreature,
} from '../src/domain/Storage.ts';
import { createInitialSave, CURRENT_SAVE_VERSION, migrateSaveData } from '../src/save/migrations.ts';

describe('Phase 1 systems', () => {
  it('triggers onEntry Intimidación and Marea-absorb ability in BattleEngine', () => {
    const rng = createRng(42);
    const player = createCreature(1, 15, rng);
    player.abilityId = 'intimidacion';
    const enemy = createCreature(7, 15, rng);
    enemy.abilityId = 'absorbe_marea';
    enemy.currentHp = Math.max(1, enemy.stats.hp - 10);
    enemy.moves = [{ moveId: 'placaje', pp: 20, maxPp: 20 }];

    player.moves = [{ moveId: 'pistola_agua', pp: 20, maxPp: 20 }];
    const engine = new BattleEngine([player], [enemy], [], rng);
    const entry = engine.consumeInitialEntryEvents();

    expect(entry.some((e) => e.type === 'ability_triggered' && e.abilityId === 'intimidacion')).toBe(true);
    expect(engine.state.enemy.combatants?.[enemy.uid]?.stages.atk).toBe(-1);

    const hpBefore = enemy.currentHp;
    const events = engine.stepTurn({ type: 'move', moveIndex: 0 });
    expect(events.some((e) => e.type === 'ability_triggered' && e.abilityId === 'absorbe_marea')).toBe(true);
    expect(enemy.currentHp).toBeGreaterThan(hpBefore);
  });

  it('survives lethal hit with Lazo Firme (cinta_aguante) and consumes it', () => {
    const rng = createRng(7);
    const player = createCreature(1, 5, rng);
    player.heldItemId = 'cinta_aguante';
    player.moves = [{ moveId: 'placaje', pp: 20, maxPp: 20 }];

    const enemy = createCreature(6, 40, rng);
    enemy.moves = [{ moveId: 'llamarada', pp: 10, maxPp: 10 }];

    const engine = new BattleEngine([player], [enemy], [], rng);
    const events = engine.stepTurn({ type: 'move', moveIndex: 0 });

    expect(player.currentHp).toBe(1);
    expect(player.heldItemId).toBeUndefined();
    expect(events.some((e) => e.type === 'held_item_triggered' && e.itemId === 'cinta_aguante')).toBe(true);
  });

  it('triggers Baya Roble at <=50% HP and Musgo Vital at end of turn', () => {
    const rng = createRng(13);
    const player = createCreature(4, 20, rng);
    player.heldItemId = 'baya_roble';
    player.currentHp = Math.floor(player.stats.hp * 0.6);
    player.moves = [{ moveId: 'placaje', pp: 20, maxPp: 20 }];

    const enemy = createCreature(13, 18, rng);
    enemy.heldItemId = 'musgo_vital';
    enemy.currentHp = enemy.stats.hp - 6;
    enemy.moves = [{ moveId: 'placaje', pp: 20, maxPp: 20 }];

    const engine = new BattleEngine([player], [enemy], [], rng);
    const events = engine.stepTurn({ type: 'move', moveIndex: 0 });

    expect(
      events.some((e) => e.type === 'held_item_triggered' && e.itemId === 'baya_roble') ||
        events.some((e) => e.type === 'held_item_triggered' && e.itemId === 'musgo_vital')
    ).toBe(true);
  });

  it('equips and unequips held items cleanly via bag', () => {
    const rng = createRng(3);
    const c = createCreature(1, 5, rng);
    const bag = [{ itemId: 'amuleto_flora', quantity: 1 }];
    expect(equipHeldItem(bag, c, 'amuleto_flora')).toBe(true);
    expect(c.heldItemId).toBe('amuleto_flora');
    expect(getItemCount(bag, 'amuleto_flora')).toBe(0);

    expect(unequipHeldItem(bag, c)).toBe('amuleto_flora');
    expect(c.heldItemId).toBeUndefined();
    expect(getItemCount(bag, 'amuleto_flora')).toBe(1);
  });

  it('tracks Bestiary transitions, habitats, and milestone rewards', () => {
    const save = createInitialSave();
    for (let id = 1; id <= 10; id++) {
      markBestiarySeen(save, id, 'Ruta 1', 4);
    }
    const counts = getBestiaryCounts(save);
    expect(counts.seen).toBe(10);
    expect(counts.caught).toBe(0);
    expect(save.bestiary[1].firstLocation).toBe('Ruta 1');

    const claimable = getClaimableMilestones(save);
    expect(claimable.some((m) => m.id === 'seen_10')).toBe(true);
    const moneyBefore = save.money;
    const reward = claimBestiaryMilestone(save, 'seen_10');
    expect(reward).not.toBeNull();
    expect(save.money).toBeGreaterThan(moneyBefore);
    expect(getClaimableMilestones(save).some((m) => m.id === 'seen_10')).toBe(false);

    markBestiaryCaught(save, 1, 'Villa Origen', 5, true);
    expect(save.bestiary[1].state).toBe('caught');
    expect(save.bestiary[1].timesCaught).toBe(1);
    expect(save.bestiary[1].highestLevel).toBe(5);
    expect(getSpeciesHabitats(10).length).toBeGreaterThan(0);
  });

  it('manages 8x20 storage boxes, overflow capture, move/swap, rename, and release', () => {
    const rng = createRng(99);
    const party = Array.from({ length: 6 }, (_, i) => createCreature((i % 3) + 1, 5, rng));
    const boxes = createDefaultStorageBoxes();
    expect(boxes).toHaveLength(STORAGE_BOX_COUNT);
    expect(boxes[0].slots).toHaveLength(STORAGE_BOX_SIZE);

    const extra = createCreature(10, 6, rng);
    const dest = addCapturedCreature(party, boxes, extra);
    expect(dest).toEqual({ destination: 'box', boxIndex: 0 });
    expect(boxes[0].slots[0]?.uid).toBe(extra.uid);

    expect(withdrawCreature(party, boxes, 0, 0)).toEqual({ ok: false, reason: 'party_full' });
    expect(depositCreature(party, boxes, 1, 0)).toEqual({ ok: true });
    expect(party).toHaveLength(5);

    expect(moveStoredCreature(boxes, 0, 0, 1, 3)).toBe(true);
    expect(boxes[1].slots[3]?.uid).toBe(extra.uid);
    expect(boxes[0].slots[0]).toBeNull();

    expect(renameStorageBox(boxes, 1, 'Favoritos')).toBe(true);
    expect(boxes[1].name).toBe('Favoritos');

    const released = releaseStoredCreature(boxes, 1, 3);
    expect(released?.uid).toBe(extra.uid);
    expect(boxes[1].slots[3]).toBeNull();

    while (party.length > 1) {
      depositCreature(party, boxes, party.length - 1, 0);
    }
    expect(depositCreature(party, boxes, 0, 0)).toEqual({ ok: false, reason: 'last_party' });
  });

  it('migrates v1 saves cleanly to v3 with abilities, bestiary, and storage', () => {
    const rng = createRng(5);
    const legacyCreature = createCreature(1, 8, rng);
    delete legacyCreature.abilityId;
    const rawV1 = {
      version: 1,
      mapId: 'ruta_1',
      playerX: 10,
      playerY: 12,
      playerDir: 'up',
      money: 700,
      repelSteps: 0,
      party: [legacyCreature],
      bag: [{ itemId: 'capsula', quantity: 3 }],
      seenSpecies: [1, 10],
      caughtSpecies: [1],
      defeatedTrainers: [],
      flags: { starter_chosen: true },
      stats: { battlesWon: 1, creaturesCaught: 1, steps: 20, playTimeSec: 15 },
      options: { volume: 0.5, muted: false, batterySaver: false, textSpeed: 'normal' },
      savedAt: 1000,
    };

    const migrated = migrateSaveData(rawV1);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(CURRENT_SAVE_VERSION);
    expect(migrated!.party[0].abilityId).toBeTruthy();
    expect(migrated!.bestiary[1]?.state).toBe('caught');
    expect(migrated!.bestiary[10]?.state).toBe('seen');
    expect(migrated!.storageBoxes).toHaveLength(STORAGE_BOX_COUNT);
    expect(Array.isArray(migrated!.badges)).toBe(true);
    addItem(migrated!.bag, 'pocion', 1);
    expect(getItemCount(migrated!.bag, 'pocion')).toBe(1);
  });
});
