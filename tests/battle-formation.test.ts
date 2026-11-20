import { describe, expect, it } from 'vitest';
import { selectActivePartyIndices } from '../src/domain/BattleFormation.ts';

describe('battle formations', () => {
  it('keeps normal encounters to one healthy ally', () => {
    expect(selectActivePartyIndices([{ currentHp: 20 }, { currentHp: 30 }])).toEqual([0]);
  });

  it('selects three healthy allies for a boss formation', () => {
    expect(
      selectActivePartyIndices(
        [{ currentHp: 20 }, { currentHp: 30 }, { currentHp: 40 }, { currentHp: 50 }],
        3
      )
    ).toEqual([0, 1, 2]);
  });

  it('skips fainted members and never selects more than three', () => {
    expect(
      selectActivePartyIndices(
        [{ currentHp: 0 }, { currentHp: 12 }, { currentHp: 0 }, { currentHp: 18 }, { currentHp: 9 }],
        3
      )
    ).toEqual([1, 3, 4]);
  });

  it('returns fewer than three when fewer than three allies are healthy', () => {
    expect(selectActivePartyIndices([{ currentHp: 0 }, { currentHp: 8 }], 3)).toEqual([1]);
  });
});
