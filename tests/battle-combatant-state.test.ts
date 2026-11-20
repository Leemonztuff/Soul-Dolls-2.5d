import { describe, expect, it } from 'vitest';
import {
  createBattleCombatantStates,
  getBattleCombatantState,
} from '../src/domain/BattleCombatantState.ts';

describe('per-creature battle state', () => {
  it('creates an independent volatile state for each creature uid', () => {
    const states = createBattleCombatantStates([{ uid: 'soul-a' }, { uid: 'soul-b' }, { uid: 'soul-c' }]);

    expect(Object.keys(states)).toEqual(['soul-a', 'soul-b', 'soul-c']);
    getBattleCombatantState(states, 'soul-a').stages.atk = 2;
    getBattleCombatantState(states, 'soul-b').flinched = true;

    expect(getBattleCombatantState(states, 'soul-a').stages.atk).toBe(2);
    expect(getBattleCombatantState(states, 'soul-b').stages.atk).toBe(0);
    expect(getBattleCombatantState(states, 'soul-c').flinched).toBe(false);
  });

  it('rejects duplicate uids instead of silently sharing state', () => {
    expect(() => createBattleCombatantStates([{ uid: 'duplicate' }, { uid: 'duplicate' }]))
      .toThrow('Duplicate creature uid in battle party: duplicate');
  });

  it('fails clearly when a combatant state is missing', () => {
    const states = createBattleCombatantStates([{ uid: 'soul-a' }]);
    expect(() => getBattleCombatantState(states, 'soul-missing'))
      .toThrow('Missing battle state for creature uid: soul-missing');
  });
});
