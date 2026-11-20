import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/Rng.ts';
import { BattleEngine } from '../src/domain/BattleEngine.ts';
import { createCreature } from '../src/domain/Creature.ts';
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

  it('exposes the three selected allies through the battle engine only when requested', () => {
    const rng = createRng(12);
    const party = [createCreature(1, 5, rng), createCreature(2, 5, rng), createCreature(3, 5, rng)];
    const enemy = createCreature(4, 5, rng);
    const normal = new BattleEngine(party, [enemy], [], rng);
    const boss = new BattleEngine(party, [enemy], [], rng, undefined, undefined, {
      activePlayerCount: 3,
    });

    expect(normal.getActivePartyIndices('player')).toEqual([0]);
    expect(boss.getActivePartyIndices('player')).toEqual([0, 1, 2]);
    expect(boss.getActiveParty('player')).toHaveLength(3);
  });
  it('resolves one action per deployed ally and only one boss action', () => {
    const rng = createRng(27);
    const party = [createCreature(1, 8, rng), createCreature(2, 8, rng), createCreature(3, 8, rng)];
    for (const ally of party) ally.moves = [{ moveId: 'placaje', pp: 35, maxPp: 35 }];
    const enemy = createCreature(4, 20, rng);
    enemy.stats.hp = 9999;
    enemy.currentHp = 9999;
    enemy.stats.atk = 1;
    enemy.stats.spa = 1;
    enemy.stats.spe = 1;
    const boss = new BattleEngine(party, [enemy], [], rng, undefined, undefined, {
      activePlayerCount: 3,
    });

    const events = boss.stepBossRound([
      { partyIndex: 0, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 1, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 2, action: { type: 'move', moveIndex: 0 } },
    ]);
    const moveEvents = events.filter((event) => event.type === 'move_use');

    expect(moveEvents.filter((event) => event.side === 'player')).toHaveLength(3);
    expect(moveEvents.filter((event) => event.side === 'enemy')).toHaveLength(1);
  });

  it('awards full participant XP to all deployed boss allies', () => {
    const rng = createRng(31);
    const party = [
      createCreature(1, 20, rng),
      createCreature(2, 20, rng),
      createCreature(3, 20, rng),
      createCreature(4, 20, rng),
    ];
    const enemy = createCreature(5, 1, rng);
    enemy.currentHp = 1;
    const boss = new BattleEngine(party, [enemy], [], rng, undefined, undefined, {
      activePlayerCount: 3,
    });

    const events = boss.stepBossRound([
      { partyIndex: 0, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 1, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 2, action: { type: 'move', moveIndex: 0 } },
    ]);
    const xpEvents = events.filter((event) => event.type === 'xp_gain');

    expect(xpEvents.filter((event) => event.type === 'xp_gain' && event.partyIndex < 3)).toHaveLength(3);
    expect(xpEvents.find((event) => event.type === 'xp_gain' && event.partyIndex === 3)?.amount)
      .toBeLessThan(xpEvents.find((event) => event.type === 'xp_gain' && event.partyIndex === 0)?.amount ?? 0);
  });

  it('replaces a fainted deployed ally with a healthy reserve in the same slot', () => {
    const rng = createRng(32);
    const party = [
      createCreature(1, 10, rng),
      createCreature(2, 10, rng),
      createCreature(3, 10, rng),
      createCreature(4, 10, rng),
    ];
    const enemy = createCreature(5, 10, rng);
    const boss = new BattleEngine(party, [enemy], [], rng, undefined, undefined, {
      activePlayerCount: 3,
    });
    party[1].currentHp = 0;

    const events = boss.replaceDeployedPlayerAlly(1, 3);

    expect(boss.getActivePartyIndices('player')).toEqual([0, 3, 2]);
    expect(events.some((event) => event.type === 'switch_in' && event.partyIndex === 3)).toBe(true);
  });

  it('applies residual status damage independently to all three deployed allies', () => {
    const rng = createRng(29);
    const party = [createCreature(1, 12, rng), createCreature(2, 12, rng), createCreature(3, 12, rng)];
    const enemy = createCreature(4, 40, rng);
    enemy.stats.hp = 9999;
    enemy.currentHp = 9999;
    enemy.stats.atk = 1;
    enemy.stats.spa = 1;
    for (const ally of party) ally.status = 'poison';
    const boss = new BattleEngine(party, [enemy], [], rng, undefined, undefined, {
      activePlayerCount: 3,
    });

    const events = boss.stepBossRound([
      { partyIndex: 0, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 1, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 2, action: { type: 'move', moveIndex: 0 } },
    ]);

    expect(events.filter((event) => event.type === 'status_tick' && event.target === 'player')).toHaveLength(3);
    expect(party.every((ally) => ally.currentHp < ally.stats.hp)).toBe(true);
  });

  it('rejects incomplete or duplicated ally actions before resolving the round', () => {
    const rng = createRng(28);
    const party = [createCreature(1, 8, rng), createCreature(2, 8, rng), createCreature(3, 8, rng)];
    const enemy = createCreature(4, 20, rng);
    const boss = new BattleEngine(party, [enemy], [], rng, undefined, undefined, {
      activePlayerCount: 3,
    });

    expect(() => boss.stepBossRound([
      { partyIndex: 0, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 1, action: { type: 'move', moveIndex: 0 } },
    ])).toThrow('Submit exactly one action for each deployed ally.');
    expect(() => boss.stepBossRound([
      { partyIndex: 0, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 0, action: { type: 'move', moveIndex: 0 } },
      { partyIndex: 2, action: { type: 'move', moveIndex: 0 } },
    ])).toThrow('Actions must match the deployed ally slots exactly.');
  });

});
