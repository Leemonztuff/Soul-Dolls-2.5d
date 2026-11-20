import type { CreatureInstance } from './types.ts';

export const MAX_ACTIVE_BATTLE_ALLIES = 3;

/**
 * Selects healthy party slots for the battle formation without mutating the party.
 * The legacy battle mode requests one slot; boss formations may request three.
 */
export function selectActivePartyIndices(
  party: readonly Pick<CreatureInstance, 'currentHp'>[],
  requestedCount = 1
): number[] {
  const count = Math.max(1, Math.min(MAX_ACTIVE_BATTLE_ALLIES, Math.floor(requestedCount)));
  const active: number[] = [];
  for (let index = 0; index < party.length && active.length < count; index += 1) {
    if (party[index].currentHp > 0) active.push(index);
  }
  return active;
}
