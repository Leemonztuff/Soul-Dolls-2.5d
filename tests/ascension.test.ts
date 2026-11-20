import { describe, it, expect } from 'vitest';
import { createCreature } from '../src/domain/Creature.ts';
import { canAscendCreature, ascendCreature, getAscensionStatMultiplier } from '../src/domain/Ascension.ts';
import { createRng } from '../src/core/Rng.ts';
import type { SaveData } from '../src/domain/types.ts';

describe('Prestige / Ascension System', () => {
  it('correctly identifies when a creature can ascend', () => {
    const rng = createRng(42);
    const doll = createCreature(1, 99, rng);
    expect(canAscendCreature(doll)).toBe(false);

    doll.level = 100;
    expect(canAscendCreature(doll)).toBe(true);
  });

  it('performs ascension ritual successfully', () => {
    const rng = createRng(42);
    const doll = createCreature(1, 100, rng);
    const save: SaveData = {
      version: 1,
      mapId: 'villa_origen',
      playerX: 0,
      playerY: 0,
      playerDir: 'down',
      money: 1000,
      repelSteps: 0,
      party: [doll],
      bag: [],
      seenSpecies: [],
      caughtSpecies: [],
      bestiary: {},
      claimedBestiaryMilestones: [],
      storageBoxes: [],
      badges: [],
      collectedPickups: [],
      defeatedTrainers: [],
      flags: {},
      stats: { battlesWon: 0, creaturesCaught: 0, steps: 0, playTimeSec: 0 },
      options: {
        volume: 1,
        musicVolume: 1,
        sfxVolume: 1,
        muted: false,
        batterySaver: false,
        pixelEffect: true,
        graphicsQuality: 'high',
        shadows: true,
        ambientParticles: true,
        bloom: true,
        bloomIntensity: 1,
        tiltShift: false,
        colorGrading: true,
        vignette: true,
        textSpeed: 'normal',
        cameraMode: 'fixed',
        cameraLabEnabled: false,
        cameraLabConfig: { fov: 58, distance: 6.4, height: 2.65 },
        cameraLabProfiles: {
          A: { fov: 58, distance: 6.4, height: 2.65 },
          B: { fov: 50, distance: 9, height: 5 },
          C: { fov: 45, distance: 11, height: 7 },
        },
        cameraLabActiveProfile: 'A',
      },
      soulDust: 100,
      savedAt: Date.now(),
    };

    const res = ascendCreature(save, doll);
    expect(res.ok).toBe(true);
    expect(doll.ascensionRank).toBe(1);
    expect(doll.level).toBe(1);
    expect(getAscensionStatMultiplier(doll)).toBe(1.15);
    expect(save.money).toBe(600); // 1000 - 400
  });
});
