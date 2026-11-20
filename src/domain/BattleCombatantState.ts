import { createDefaultStages } from './Damage.ts';
import type { BattleCombatantState, CreatureInstance } from './types.ts';

export type CombatantIdentity = Pick<CreatureInstance, 'uid'>;

/** Creates isolated volatile state for every creature in a battle party. */
export function createBattleCombatantStates(
  party: readonly CombatantIdentity[]
): Record<string, BattleCombatantState> {
  const states: Record<string, BattleCombatantState> = {};
  for (const creature of party) {
    if (states[creature.uid]) {
      throw new Error(`Duplicate creature uid in battle party: ${creature.uid}`);
    }
    states[creature.uid] = {
      stages: createDefaultStages(),
      flinched: false,
      confusedTurns: 0,
      trappedTurns: 0,
      leechSeeded: false,
      protected: false,
      statDropGuarded: false,
      lowHpBerryUsed: false,
    };
  }
  return states;
}

export function getBattleCombatantState(
  states: Readonly<Record<string, BattleCombatantState>>,
  uid: string
): BattleCombatantState {
  const state = states[uid];
  if (!state) throw new Error(`Missing battle state for creature uid: ${uid}`);
  return state;
}
