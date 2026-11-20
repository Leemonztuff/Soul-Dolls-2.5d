import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/Rng.ts';
import { ENCOUNTERS } from '../src/data/encounters.ts';
import { ITEMS } from '../src/data/items.ts';
import { getMove } from '../src/data/moves.ts';
import { SPECIES } from '../src/data/species.ts';
import { BattleEngine } from '../src/domain/BattleEngine.ts';
import { computeCatchProbability } from '../src/domain/Catch.ts';
import { createCreature } from '../src/domain/Creature.ts';
import { calculateDamage, createDefaultStages } from '../src/domain/Damage.ts';
import { syncBodyPartsFull } from '../src/domain/BodyParts.ts';
import {
  advanceWorldClock,
  DEFAULT_WORLD_CLOCK_MINUTES,
  filterEncountersByTime,
  formatWorldClock,
  getDefaultBiomeWeather,
  getTimeLightingProfile,
  getTimePhase,
  getTimePhaseLabel,
  MINUTES_PER_DAY,
} from '../src/domain/TimeOfDay.ts';
import { ES } from '../src/i18n/es.ts';
import { createInitialSave, migrateSaveData } from '../src/save/migrations.ts';

function pickSpeciesOfType(type: string): number {
  const found = Object.values(SPECIES).find((s) => s.types.includes(type as never));
  if (!found) throw new Error(`Missing test species of type ${type}`);
  return found.id;
}

describe('Pokémon Gold Game Loop Improvements', () => {
  it('advances world clock across 24h phases and filters encounters by time of day', () => {
    expect(getTimePhase(DEFAULT_WORLD_CLOCK_MINUTES)).toBe('morning'); // 09:00
    expect(getTimePhase(12 * 60)).toBe('day');
    expect(getTimePhase(18 * 60 + 30)).toBe('dusk');
    expect(getTimePhase(23 * 60)).toBe('night');
    expect(getTimePhase(2 * 60)).toBe('night');

    expect(formatWorldClock(9 * 60 + 5)).toBe('09:05');
    expect(getTimePhaseLabel('dusk')).toBe('Atardecer');

    // Wraps smoothly past midnight
    const late = 23 * 60 + 55;
    const wrapped = advanceWorldClock(late, 10); // +16 min => 00:11
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(MINUTES_PER_DAY);
    expect(wrapped).toBeCloseTo(11, 4);

    // Day/night lighting darkens outdoor night while keeping interiors/caves neutral
    const dayOutdoor = getTimeLightingProfile('day', false, false);
    const nightOutdoor = getTimeLightingProfile('night', false, false);
    const nightInterior = getTimeLightingProfile('night', true, false);
    expect(nightOutdoor.sunIntensityMult).toBeLessThan(dayOutdoor.sunIntensityMult);
    expect(nightOutdoor.glowIntensityMult).toBeGreaterThan(dayOutdoor.glowIntensityMult);
    expect(nightInterior.fogBlend).toBe(0);

    // Wild encounters on ruta_1 vary cleanly between day and night
    const ruta1Day = filterEncountersByTime(ENCOUNTERS.ruta_1.entries, 'day').map(
      (e) => e.speciesId
    );
    const ruta1Night = filterEncountersByTime(ENCOUNTERS.ruta_1.entries, 'night').map(
      (e) => e.speciesId
    );
    expect(ruta1Day).not.toEqual(ruta1Night);

    // Biome default weather
    expect(getDefaultBiomeWeather('snow')).toBe('snow');
    expect(getDefaultBiomeWeather('meadow')).toBe('none');
  });

  it('activates cave_night capsule multiplier at dusk/night in Catch rules', () => {
    const rng = createRng(10);
    const wild = createCreature(1, 5, rng);
    const testId = '__test_dusk_pot';
    ITEMS[testId] = {
      id: testId,
      name: 'Ocaso Soulpot',
      category: 'capsule',
      price: 500,
      catchMultiplier: 3.0,
      catchCondition: 'cave_night',
      description: 'Test',
    };
    try {
      const pDay = computeCatchProbability(wild, testId, { biome: 'meadow', timePhase: 'day' });
      const pNight = computeCatchProbability(wild, testId, { biome: 'meadow', timePhase: 'night' });
      const pDusk = computeCatchProbability(wild, testId, { biome: 'meadow', timePhase: 'dusk' });
      const pCaveDay = computeCatchProbability(wild, testId, { biome: 'cave', timePhase: 'day' });

      expect(pNight).toBeGreaterThan(pDay);
      expect(pDusk).toBeCloseTo(pNight, 6);
      expect(pCaveDay).toBeCloseTo(pNight, 6);
    } finally {
      delete ITEMS[testId];
    }
  });

  it('applies weather damage multipliers, weather ticks, immunity, and duration expiry', () => {
    const rng = createRng(77);
    const fireId = pickSpeciesOfType('brasa');
    const waterId = pickSpeciesOfType('marea');
    const rockId = pickSpeciesOfType('roca');

    const fireAttacker = createCreature(fireId, 20, rng);
    const waterAttacker = createCreature(waterId, 20, rng);
    const rockDefender = createCreature(rockId, 20, rng);

    const ember = getMove('ascuas');
    const clearFireDmg = calculateDamage(
      fireAttacker,
      rockDefender,
      createDefaultStages(),
      createDefaultStages(),
      ember,
      createRng(1),
      'none'
    );
    const sunFireDmg = calculateDamage(
      fireAttacker,
      rockDefender,
      createDefaultStages(),
      createDefaultStages(),
      ember,
      createRng(1),
      'sun'
    );
    const rainFireDmg = calculateDamage(
      fireAttacker,
      rockDefender,
      createDefaultStages(),
      createDefaultStages(),
      ember,
      createRng(1),
      'rain'
    );
    expect(sunFireDmg.damage).toBeGreaterThan(clearFireDmg.damage);
    expect(rainFireDmg.damage).toBeLessThan(clearFireDmg.damage);

    const waterPulse = getMove('pulso_abismo');
    const rainWaterDmg = calculateDamage(
      waterAttacker,
      fireAttacker,
      createDefaultStages(),
      createDefaultStages(),
      waterPulse,
      createRng(1),
      'rain'
    );
    const sunWaterDmg = calculateDamage(
      waterAttacker,
      fireAttacker,
      createDefaultStages(),
      createDefaultStages(),
      waterPulse,
      createRng(1),
      'sun'
    );
    expect(rainWaterDmg.damage).toBeGreaterThan(sunWaterDmg.damage);

    // Snow biome starts with snow weather and damages non-marea/non-brisa while leaving marea/brisa unscathed
    const pRock = createCreature(rockId, 20, createRng(5));
    const eWater = createCreature(waterId, 20, createRng(6));
    pRock.moves = [{ moveId: 'tormenta_arena', pp: 10, maxPp: 10 }];
    eWater.moves = [{ moveId: 'placaje', pp: 35, maxPp: 35 }];

    const engine = new BattleEngine([pRock], [eWater], [], createRng(12), undefined, 'snow');
    const intro = engine.consumeInitialEntryEvents();
    expect(intro.some((e) => e.type === 'weather_change' && e.weather === 'snow')).toBe(true);

    // Trigger Sandstorm via move: lasts 5 turns and chips non-rock enemy, leaves rock player unharmed
    const turn1 = engine.stepTurn({ type: 'move', moveIndex: 0 });
    expect(engine.state.weather).toBe('sandstorm');
    expect(engine.state.weatherTurns).toBe(4); // set to 5 during move, decremented 1 at end-of-turn
    const sandTicks = turn1.filter((e) => e.type === 'weather_tick');
    expect(sandTicks.some((e) => e.type === 'weather_tick' && e.target === 'enemy')).toBe(true);
    expect(sandTicks.some((e) => e.type === 'weather_tick' && e.target === 'player')).toBe(false);

    // Advance remaining 4 turns so weather clears back to 'none'
    for (let t = 0; t < 4; t++) {
      if (engine.state.finished) break;
      syncBodyPartsFull(pRock);
      syncBodyPartsFull(eWater);
      pRock.moves[0] = { moveId: 'placaje', pp: 35, maxPp: 35 };
      engine.stepTurn({ type: 'move', moveIndex: 0 });
    }
    expect(engine.state.weather).toBe('none');
    expect(engine.state.weatherTurns).toBe(0);
  });

  it('blocks run and switch while trappedTurns > 0 and resolves end-of-turn ticks in speed order', () => {
    const p1 = createCreature(1, 20, createRng(1));
    const p2 = createCreature(4, 20, createRng(2));
    const enemy = createCreature(7, 20, createRng(3));

    const trapEngine = new BattleEngine([p1, p2], [enemy], [], createRng(4));
    trapEngine.state.player.trappedTurns = 2;
    trapEngine.state.player.combatants![p1.uid].trappedTurns = 2;

    const runEvents = trapEngine.stepTurn({ type: 'run' });
    expect(trapEngine.state.finished).toBe(false);
    expect(runEvents.some((e) => e.type === 'text' && e.message === ES.battle.cantEscapeTrapped)).toBe(
      true
    );

    const switchEvents = trapEngine.stepTurn({ type: 'switch', partyIndex: 1 });
    expect(trapEngine.state.player.activeIndex).toBe(0);
    expect(
      switchEvents.some((e) => e.type === 'text' && e.message === ES.battle.cantEscapeTrapped)
    ).toBe(true);

    // Speed-ordered end-of-turn fairness: slow burned player + fast burned enemy at 1 HP -> faster enemy ticks & faints first so player wins!
    const slowPlayer = createCreature(1, 20, createRng(10));
    const fastEnemy = createCreature(4, 20, createRng(11));
    slowPlayer.stats.spe = 120;
    fastEnemy.stats.spe = 15;
    slowPlayer.bodyParts = {
      head: { current: 1, max: 10 },
      torso: { current: 0, max: 20 },
      arms: { current: 0, max: 10 },
      legs: { current: 0, max: 10 },
    };
    fastEnemy.bodyParts = {
      head: { current: 1, max: 10 },
      torso: { current: 0, max: 20 },
      arms: { current: 0, max: 10 },
      legs: { current: 0, max: 10 },
    };
    slowPlayer.currentHp = 1;
    fastEnemy.currentHp = 1;
    slowPlayer.status = 'burn';
    fastEnemy.status = 'burn';
    slowPlayer.moves = [{ moveId: 'placaje', pp: 10, maxPp: 10 }];
    fastEnemy.moves = [{ moveId: 'placaje', pp: 10, maxPp: 10 }];

    const speedEngine = new BattleEngine([slowPlayer], [fastEnemy], [], createRng(99));
    speedEngine.stepTurn({ type: 'move', moveIndex: 0 });
    expect(speedEngine.state.finished).toBe(true);
    expect(speedEngine.state.outcome).toBe('win');
  });

  it('initializes and preserves lastHealPoint and worldClockMinutes across save migrations', () => {
    const initial = createInitialSave();
    expect(initial.worldClockMinutes).toBe(DEFAULT_WORLD_CLOCK_MINUTES);
    expect(initial.lastHealPoint).toEqual({
      mapId: 'villa_origen',
      x: 24,
      y: 26,
      dir: 'up',
    });

    const migrated = migrateSaveData({
      ...initial,
      worldClockMinutes: 1325,
      lastHealPoint: { mapId: 'pueblo_bruma', x: 10, y: 12, dir: 'down' },
    });
    expect(migrated?.worldClockMinutes).toBe(1325);
    expect(migrated?.lastHealPoint).toEqual({
      mapId: 'pueblo_bruma',
      x: 10,
      y: 12,
      dir: 'down',
    });

    const legacy = migrateSaveData({ version: 1, money: 500 });
    expect(legacy?.worldClockMinutes).toBe(DEFAULT_WORLD_CLOCK_MINUTES);
    expect(legacy?.lastHealPoint).toEqual({
      mapId: 'villa_origen',
      x: 24,
      y: 26,
      dir: 'up',
    });
  });
});
