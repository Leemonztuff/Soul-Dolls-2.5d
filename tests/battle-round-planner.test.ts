import { describe, expect, it } from 'vitest';
import { planBossRound, type BattleRoundCommand } from '../src/domain/BattleRoundPlanner.ts';

const ally = (
  partyIndex: number,
  priority: number,
  speed: number,
  tieBreak = 0
): BattleRoundCommand => ({
  side: 'player',
  partyIndex,
  action: { type: 'move', moveIndex: 0 },
  priority,
  speed,
  tieBreak,
});

const boss: BattleRoundCommand = {
  side: 'enemy',
  partyIndex: 0,
  action: { type: 'move', moveIndex: 0 },
  priority: 0,
  speed: 90,
  tieBreak: 0,
};

describe('boss round planner', () => {
  it('orders up to three allies and one boss action by priority, then speed', () => {
    const plan = planBossRound(
      [ally(0, 0, 80), ally(1, 1, 40), ally(2, 0, 120)],
      boss
    );

    expect(plan.commands.map(({ side, partyIndex }) => [side, partyIndex])).toEqual([
      ['player', 1],
      ['player', 2],
      ['enemy', 0],
      ['player', 0],
    ]);
  });

  it('uses the supplied deterministic tie-break for equal priority and speed', () => {
    const plan = planBossRound(
      [ally(0, 0, 100, 0.8), ally(1, 0, 100, 0.2)],
      { ...boss, speed: 100, tieBreak: 0.5 }
    );

    expect(plan.commands.map(({ side, partyIndex }) => [side, partyIndex])).toEqual([
      ['player', 1],
      ['enemy', 0],
      ['player', 0],
    ]);
  });

  it('rejects duplicate ally actions in the same round', () => {
    expect(() => planBossRound([ally(0, 0, 80), ally(0, 0, 70)], boss)).toThrow(
      'Each deployed ally may submit only one action per round.'
    );
  });

  it('rejects more than three allied actions', () => {
    expect(() => planBossRound([ally(0, 0, 1), ally(1, 0, 2), ally(2, 0, 3), ally(3, 0, 4)], boss))
      .toThrow('A boss round requires between one and three allied actions.');
  });

  it('contains one boss action, never one boss response per ally', () => {
    const plan = planBossRound([ally(0, 0, 90), ally(1, 0, 80), ally(2, 0, 70)], boss);

    expect(plan.commands.filter((command) => command.side === 'enemy')).toHaveLength(1);
    expect(plan.commands).toHaveLength(4);
  });
});
