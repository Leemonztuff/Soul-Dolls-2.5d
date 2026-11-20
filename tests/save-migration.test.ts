import { describe, expect, it } from 'vitest';
import {
  CURRENT_SAVE_VERSION,
  defaultOptions,
  migrateSaveData,
} from '../src/save/migrations.ts';

describe('Save migrations', () => {
  it('migrates a v1 save to current schema preserving progress', () => {
    const v1 = {
      version: 1,
      mapId: 'pueblo_bruma',
      playerX: 10,
      playerY: 8,
      playerDir: 'down',
      money: 1200,
      party: [],
      bag: [{ itemId: 'pocion', quantity: 4 }],
      seenSpecies: [1, 10],
      caughtSpecies: [1],
      defeatedTrainers: ['ruta1_scout'],
      flags: { starter_chosen: true },
    };

    const migrated = migrateSaveData(v1);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(CURRENT_SAVE_VERSION);
    expect(migrated!.mapId).toBe('pueblo_bruma');
    expect(migrated!.money).toBe(1200);
    expect(migrated!.repelSteps).toBe(0);
    expect(migrated!.stats.creaturesCaught).toBe(1);
    expect(migrated!.options).toEqual(defaultOptions());
  });

  it('preserves expanded sound, quality, and post-FX options across saves', () => {
    const migrated = migrateSaveData({
      version: 7,
      options: {
        volume: 0.45,
        musicVolume: 0.3,
        sfxVolume: 0.85,
        muted: true,
        batterySaver: true,
        pixelEffect: true,
        graphicsQuality: 'medium',
        shadows: false,
        ambientParticles: false,
        bloom: false,
        bloomIntensity: 1.5,
        tiltShift: false,
        colorGrading: false,
        vignette: false,
        textSpeed: 'fast',
        cameraMode: 'free_orbit',
      },
    });

    expect(migrated?.options).toEqual({
      volume: 0.45,
      musicVolume: 0.3,
      sfxVolume: 0.85,
      muted: true,
      batterySaver: true,
      pixelEffect: true,
      graphicsQuality: 'medium',
      shadows: false,
      ambientParticles: false,
      bloom: false,
      bloomIntensity: 1.5,
      tiltShift: false,
      colorGrading: false,
      vignette: false,
      textSpeed: 'fast',
      cameraMode: 'free_orbit',
      cameraLabEnabled: false,
      cameraLabConfig: { fov: 58, distance: 6.4, height: 2.65 },
      cameraLabProfiles: {
        A: { fov: 58, distance: 6.4, height: 2.65 },
        B: { fov: 50, distance: 9, height: 5 },
        C: { fov: 45, distance: 11, height: 7 },
      },
      cameraLabActiveProfile: 'A',
    });
  });

  it('clamps out-of-range numeric options and sanitizes invalid graphics quality', () => {
    const migrated = migrateSaveData({
      version: 8,
      options: {
        volume: 4,
        musicVolume: -1,
        sfxVolume: 2,
        bloomIntensity: 9,
        graphicsQuality: 'ultra',
        cameraMode: 'pitch_free',
      },
    });

    expect(migrated?.options.volume).toBe(1);
    expect(migrated?.options.musicVolume).toBe(0);
    expect(migrated?.options.sfxVolume).toBe(1);
    expect(migrated?.options.bloomIntensity).toBe(1.6);
    expect(migrated?.options.graphicsQuality).toBe('auto');
    expect(migrated?.options.cameraMode).toBe('fixed');
  });

  it('returns null for invalid payloads', () => {
    expect(migrateSaveData(null)).toBeNull();
    expect(migrateSaveData('bad')).toBeNull();
  });
});
