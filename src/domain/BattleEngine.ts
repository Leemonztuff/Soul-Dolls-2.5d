import type { Rng } from '../core/Rng.ts';
import { getItem } from '../data/items.ts';
import { getMove } from '../data/moves.ts';
import { getSpecies } from '../data/species.ts';
import { ES } from '../i18n/es.ts';
import {
  computeAbilityPriorityDelta,
  computeAbilityStatMultiplier,
  getCreatureAbilityDef,
  isStatusBlockedByAbility,
} from './Abilities.ts';
import {
  applyDamageToBodyParts,
  BODY_PART_LABELS,
  ensureBodyParts,
  getContainerAffinityMatch,
  healBodyParts,
  pickTargetBodyPart,
  syncBodyPartsFull,
} from './BodyParts.ts';
import { rollCardDrop } from './Cards.ts';
import { attemptCatch } from './Catch.ts';
import { getCreatureDisplayName } from './Creature.ts';
import { calculateDamage, createDefaultStages, stageMultiplier } from './Damage.ts';
import { checkLevelEvolution } from './Evolution.ts';
import { awardExperience, computeBattleXp, computeSharedPartyXp } from './Experience.ts';
import { computeHeldStatMultiplier, getHeldItemDef } from './HeldItems.ts';
import { applyMedicineToCreature, removeItem } from './Inventory.ts';
import { getFirstHealthyIndex } from './Party.ts';
import { selectActivePartyIndices } from './BattleFormation.ts';
import { createBattleCombatantStates, getBattleCombatantState } from './BattleCombatantState.ts';
import { planBossRound, type BattleRoundCommand } from './BattleRoundPlanner.ts';
import { getDefaultBiomeWeather } from './TimeOfDay.ts';
import { getTypeMultiplier } from './TypeChart.ts';
import type {
  BagSlot,
  BattleAction,
  BattleBiome,
  BattleEvent,
  BattleSideState,
  BattleState,
  BattleStatName,
  BattleWeather,
  BodyPartName,
  CreatureInstance,
  MoveDef,
  StatusCondition,
  TimePhase,
  TrainerDef,
} from './types.ts';

export class BattleEngine {
  readonly state: BattleState;
  private readonly bag: BagSlot[];
  private readonly rng: Rng;
  private readonly timePhase?: TimePhase;
  private entryTriggeredOnce = false;

  constructor(
    playerParty: CreatureInstance[],
    enemyParty: CreatureInstance[],
    bag: BagSlot[],
    rng: Rng,
    trainer?: TrainerDef,
    biome?: BattleBiome,
    extra?: { timePhase?: TimePhase; weather?: BattleWeather; activePlayerCount?: number }
  ) {
    this.bag = bag;
    this.rng = rng;
    this.timePhase = extra?.timePhase;

    for (const c of playerParty) ensureBodyParts(c);
    for (const c of enemyParty) ensureBodyParts(c);

    const pIdx = Math.max(0, getFirstHealthyIndex(playerParty));
    const eIdx = Math.max(0, getFirstHealthyIndex(enemyParty));
    const initWeather = extra?.weather ?? getDefaultBiomeWeather(biome);

    this.state = {
      isWild: !trainer,
      biome,
      weather: initWeather,
      weatherTurns: initWeather === 'none' ? 0 : -1,
      trainer,
      player: {
        party: playerParty,
        activeIndex: pIdx,
        activeIndices: selectActivePartyIndices(playerParty, extra?.activePlayerCount ?? 1),
        combatants: createBattleCombatantStates(playerParty),
        stages: createDefaultStages(),
        flinched: false,
      },
      enemy: {
        party: enemyParty,
        activeIndex: eIdx,
        combatants: createBattleCombatantStates(enemyParty),
        stages: createDefaultStages(),
        flinched: false,
      },
      turnCount: 0,
      runAttempts: 0,
      finished: false,
    };
  }

  getActive(side: 'player' | 'enemy'): CreatureInstance {
    const s = side === 'player' ? this.state.player : this.state.enemy;
    return s.party[s.activeIndex];
  }

  /** Returns the party slots deployed at battle start; legacy callers still use getActive(). */
  getActivePartyIndices(side: 'player' | 'enemy'): readonly number[] {
    const sideState = this.getSide(side);
    return sideState.activeIndices ?? [sideState.activeIndex];
  }

  getActiveParty(side: 'player' | 'enemy'): CreatureInstance[] {
    const sideState = this.getSide(side);
    return this.getActivePartyIndices(side).map((index) => sideState.party[index]).filter(Boolean);
  }

  private getSide(side: 'player' | 'enemy'): BattleSideState {
    return side === 'player' ? this.state.player : this.state.enemy;
  }

  /** Volatile effects and stat stages follow the individual creature, never the whole party. */
  private getCombatantState(side: 'player' | 'enemy', creature = this.getActive(side)) {
    const sideState = this.getSide(side);
    if (!sideState.combatants) throw new Error(`Missing combatant states for ${side}.`);
    return getBattleCombatantState(sideState.combatants, creature.uid);
  }

  consumeInitialEntryEvents(): BattleEvent[] {
    if (this.entryTriggeredOnce) return [];
    this.entryTriggeredOnce = true;
    const events: BattleEvent[] = [];
    if (this.state.weather !== 'none') {
      events.push({
        type: 'weather_change',
        weather: this.state.weather,
        turns: this.state.weatherTurns,
      });
      events.push({
        type: 'text',
        message: ES.battle.weatherStart[this.state.weather],
      });
    }
    this.triggerOnEntry('player', events);
    this.triggerOnEntry('enemy', events);
    return events;
  }

  private resetCombatantVolatiles(side: 'player' | 'enemy', creature = this.getActive(side)): void {
    const state = this.getCombatantState(side, creature);
    state.stages = createDefaultStages();
    state.flinched = false;
    state.confusedTurns = 0;
    state.trappedTurns = 0;
    state.leechSeeded = false;
    state.protected = false;
    state.statDropGuarded = false;
    state.lowHpBerryUsed = false;
  }

  private triggerOnEntry(side: 'player' | 'enemy', events: BattleEvent[]): void {
    const creature = this.getActive(side);
    if (!creature || creature.currentHp <= 0) return;
    ensureBodyParts(creature);
    const ab = getCreatureAbilityDef(creature);
    const entry = ab?.hooks.onEntry;
    if (!ab || !entry) return;

    const oppSide: 'player' | 'enemy' = side === 'player' ? 'enemy' : 'player';
    events.push({
      type: 'ability_triggered',
      side,
      abilityId: ab.id,
      abilityName: ab.name,
    });

    if (entry.enemyStat) {
      const targetSide = this.getSide(oppSide);
      if (!this.getCombatantState(oppSide).statDropGuarded) {
        this.applyStageDelta(oppSide, entry.enemyStat.stat, entry.enemyStat.delta, events);
      }
    }
    if (entry.selfStat) {
      this.applyStageDelta(side, entry.selfStat.stat, entry.selfStat.delta, events);
    }
  }

  private applyStageDelta(
    targetSide: 'player' | 'enemy',
    stat: BattleStatName,
    delta: number,
    events: BattleEvent[]
  ): void {
    const targetCreature = this.getActive(targetSide);
    const combatantState = this.getCombatantState(targetSide, targetCreature);
    if (delta < 0 && combatantState.statDropGuarded) return;
    const targetName = getCreatureDisplayName(targetCreature);
    const next = Math.max(-6, Math.min(6, combatantState.stages[stat] + delta));
    if (next !== combatantState.stages[stat]) {
      combatantState.stages[stat] = next;
      events.push({ type: 'stat_change', target: targetSide, stat, delta });
      const statLabel = ES.stats[stat];
      events.push({
        type: 'text',
        message:
          delta > 0
            ? ES.battle.statUp(targetName, statLabel)
            : ES.battle.statDown(targetName, statLabel),
      });
    }
  }

  private effectiveSpeed(side: 'player' | 'enemy'): number {
    const c = this.getActive(side);
    const s = this.getCombatantState(side, c);
    let spe = c.stats.spe * stageMultiplier(s.stages.spe);
    spe *= computeAbilityStatMultiplier(c, 'spe');
    spe *= computeHeldStatMultiplier(c, 'spe');
    if (c.status === 'paralysis') spe *= 0.5;
    if (c.bodyParts && c.bodyParts.legs.current <= 0) {
      const match = getContainerAffinityMatch(c);
      const legMult = match.level === 'full' ? 0.95 : match.level === 'partial' ? 0.92 : 0.85;
      spe *= legMult;
    }
    return spe;
  }

  chooseEnemyAction(): BattleAction {
    const enemy = this.getActive('enemy');
    const player = this.getActive('player');
    const playerSpecies = getSpecies(player.speciesId);

    const usable = enemy.moves
      .map((slot, index) => ({ slot, index, def: getMove(slot.moveId) }))
      .filter((m) => m.slot.pp > 0);

    if (usable.length === 0) {
      return { type: 'move', moveIndex: 0 };
    }

    let bestIndex = usable[0].index;
    let bestScore = -1;

    for (const candidate of usable) {
      const m = candidate.def;
      let score = 0;
      if (m.category === 'status') {
        if (m.effect.kind === 'status' && player.status === 'none') {
          score = 42;
        } else if (m.effect.kind === 'heal' && enemy.currentHp < enemy.stats.hp * 0.45) {
          score = 65;
        } else if (m.effect.kind === 'protect') {
          score = 12;
        } else {
          score = 18;
        }
      } else {
        const mult = getTypeMultiplier(m.type, playerSpecies.types);
        const stab = getSpecies(enemy.speciesId).types.includes(m.type) ? 1.5 : 1;
        score = m.power * mult * stab * (m.accuracy / 100);
        if (m.effect.kind === 'multi_hit') {
          score *= ((m.effect.minHits ?? 2) + (m.effect.maxHits ?? 3)) * 0.5;
        } else if (m.effect.kind === 'fixed_damage' && m.effect.fixedAmount) {
          score = m.effect.fixedAmount;
        }
        if (mult >= 2) score += 25;
      }
      score += this.rng.next() * 12;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = candidate.index;
      }
    }

    return { type: 'move', moveIndex: bestIndex };
  }

  stepTurn(playerAction: BattleAction): BattleEvent[] {
    if (this.state.finished) return [];
    const events: BattleEvent[] = [];
    if (!this.entryTriggeredOnce) {
      events.push(...this.consumeInitialEntryEvents());
    }

    this.state.turnCount += 1;
    for (const side of ['player', 'enemy'] as const) {
      for (const creature of this.getActiveParty(side)) {
        const combatant = this.getCombatantState(side, creature);
        combatant.flinched = false;
        combatant.protected = false;
      }
    }

    const enemyAction = this.chooseEnemyAction();

    if (playerAction.type === 'run') {
      if (!this.state.isWild) {
        events.push({ type: 'text', message: ES.battle.cantRunTrainer });
        return events;
      }
      if (this.getCombatantState('player').trappedTurns > 0) {
        events.push({ type: 'text', message: ES.battle.cantEscapeTrapped });
        return events;
      }
      this.state.runAttempts += 1;
      const pSpe = Math.max(1, this.effectiveSpeed('player'));
      const eSpe = Math.max(1, this.effectiveSpeed('enemy'));
      const escapeOdds = ((pSpe * 140) / eSpe + 35 * this.state.runAttempts) / 256;
      if (pSpe >= eSpe || this.rng.next() < escapeOdds) {
        this.state.finished = true;
        this.state.outcome = 'ran';
        events.push({ type: 'run_success' });
        events.push({ type: 'text', message: ES.battle.ranAway });
        events.push({ type: 'battle_end', outcome: 'ran', rewardMoney: 0 });
        return events;
      }
      events.push({ type: 'run_fail' });
      events.push({ type: 'text', message: ES.battle.runFailed });
      this.executeAction('enemy', enemyAction, events);
      if (!this.state.finished) {
        this.resolveEndOfTurn(events);
      }
      return events;
    }

    if (playerAction.type === 'switch') {
      if (this.getCombatantState('player').trappedTurns > 0) {
        events.push({ type: 'text', message: ES.battle.cantEscapeTrapped });
        return events;
      }
      this.executeSwitch('player', playerAction.partyIndex, events);
      this.executeAction('enemy', enemyAction, events);
      if (!this.state.finished) {
        this.resolveEndOfTurn(events);
      }
      return events;
    }

    if (playerAction.type === 'item') {
      const captured = this.executeItem(playerAction.itemId, playerAction.targetPartyIndex, events);
      if (captured) {
        return events;
      }
      if (!this.state.finished) {
        this.executeAction('enemy', enemyAction, events);
        this.resolveEndOfTurn(events);
      }
      return events;
    }

    const pMove = this.getMoveForAction('player', playerAction);
    const eMove = this.getMoveForAction('enemy', enemyAction);
    const pPrio = pMove.priority + computeAbilityPriorityDelta(this.getActive('player'), pMove);
    const ePrio = eMove.priority + computeAbilityPriorityDelta(this.getActive('enemy'), eMove);

    let first: 'player' | 'enemy' = 'player';
    if (ePrio !== pPrio) {
      first = ePrio > pPrio ? 'enemy' : 'player';
    } else {
      const pSpe = this.effectiveSpeed('player');
      const eSpe = this.effectiveSpeed('enemy');
      if (eSpe !== pSpe) {
        first = eSpe > pSpe ? 'enemy' : 'player';
      } else {
        first = this.rng.next() < 0.5 ? 'player' : 'enemy';
      }
    }

    const second: 'player' | 'enemy' = first === 'player' ? 'enemy' : 'player';
    const firstAction = first === 'player' ? playerAction : enemyAction;
    const secondAction = second === 'player' ? playerAction : enemyAction;

    this.executeAction(first, firstAction, events);
    if (!this.state.finished && this.getActive(second).currentHp > 0 && this.getActive(first).currentHp > 0) {
      this.executeAction(second, secondAction, events);
    }

    if (!this.state.finished) {
      this.resolveEndOfTurn(events);
    }

    return events;
  }

  /**
   * Resolves one boss round: each deployed ally acts at most once and the boss
   * receives exactly one action. This domain entry point is intentionally not
   * wired to the scene/HUD until target selection and UID-based events land.
   */
  stepBossRound(
    alliedActions: readonly { partyIndex: number; action: BattleAction }[]
  ): BattleEvent[] {
    if (this.state.finished) return [];
    const deployed = this.getActivePartyIndices('player');
    if (deployed.length < 2 || deployed.length > 3) {
      throw new Error('Boss rounds require a deployed formation of two or three allies.');
    }
    if (alliedActions.length !== deployed.length) {
      throw new Error('Submit exactly one action for each deployed ally.');
    }
    const submitted = new Set(alliedActions.map((entry) => entry.partyIndex));
    if (deployed.some((index) => !submitted.has(index)) || submitted.size !== alliedActions.length) {
      throw new Error('Actions must match the deployed ally slots exactly.');
    }
    if (alliedActions.some((entry) => entry.action.type !== 'move')) {
      throw new Error('Boss rounds currently accept move actions only.');
    }

    const events: BattleEvent[] = [];
    if (!this.entryTriggeredOnce) events.push(...this.consumeInitialEntryEvents());
    this.state.turnCount += 1;
    for (const side of ['player', 'enemy'] as const) {
      for (const creature of this.getActiveParty(side)) {
        const state = this.getCombatantState(side, creature);
        state.flinched = false;
        state.protected = false;
      }
    }

    // The enemy chooses once, against the first currently deployed ally.
    this.state.player.activeIndex = deployed.find((i) => this.state.player.party[i].currentHp > 0) ?? deployed[0];
    const enemyAction = this.chooseEnemyAction();
    const enemy = this.getActive('enemy');
    const enemyMove = this.getMoveForAction('enemy', enemyAction);
    const enemyCommand: BattleRoundCommand = {
      side: 'enemy',
      partyIndex: this.state.enemy.activeIndex,
      action: enemyAction,
      priority: enemyMove.priority + computeAbilityPriorityDelta(enemy, enemyMove),
      speed: this.effectiveSpeed('enemy'),
      tieBreak: this.rng.next(),
    };
    const alliedCommands: BattleRoundCommand[] = alliedActions.map(({ partyIndex, action }) => {
      const ally = this.state.player.party[partyIndex];
      const move = this.getMoveForActionForCreature(ally, action);
      return {
        side: 'player' as const,
        partyIndex,
        action,
        priority: move.priority + computeAbilityPriorityDelta(ally, move),
        speed: ally.stats.spe * stageMultiplier(this.getCombatantState('player', ally).stages.spe) * computeAbilityStatMultiplier(ally, 'spe') * computeHeldStatMultiplier(ally, 'spe'),
        tieBreak: this.rng.next(),
      };
    });

    const plan = planBossRound(alliedCommands, enemyCommand);
    for (const command of plan.commands) {
      if (this.state.finished) break;
      if (command.side === 'player') {
        const ally = this.state.player.party[command.partyIndex];
        if (!ally || ally.currentHp <= 0) continue;
        this.state.player.activeIndex = command.partyIndex;
        this.executeAction('player', command.action, events);
      } else {
        const target = deployed.find((index) => this.state.player.party[index].currentHp > 0);
        if (target === undefined) continue;
        this.state.player.activeIndex = target;
        this.executeAction('enemy', command.action, events);
      }
    }

    if (!this.state.finished) this.resolveEndOfTurn(events);
    return events;
  }

  private getMoveForActionForCreature(creature: CreatureInstance, action: BattleAction): MoveDef {
    const index = action.type === 'move' ? action.moveIndex : 0;
    const slot = creature.moves[index] ?? creature.moves[0];
    return getMove(slot ? slot.moveId : 'placaje');
  }

  forcePlayerSwitch(partyIndex: number): BattleEvent[] {
    const events: BattleEvent[] = [];
    const target = this.state.player.party[partyIndex];
    if (!target || target.currentHp <= 0) return events;
    ensureBodyParts(target);
    this.state.player.activeIndex = partyIndex;
    this.resetCombatantVolatiles('player', target);
    events.push({
      type: 'switch_in',
      side: 'player',
      partyIndex,
      creature: target,
    });
    events.push({ type: 'text', message: ES.battle.goCreature(getCreatureDisplayName(target)) });
    this.triggerOnEntry('player', events);
    return events;
  }

  private getMoveForAction(side: 'player' | 'enemy', action: BattleAction): MoveDef {
    const c = this.getActive(side);
    const idx = action.type === 'move' ? action.moveIndex : 0;
    const slot = c.moves[idx] ?? c.moves[0];
    return getMove(slot ? slot.moveId : 'placaje');
  }

  private executeSwitch(side: 'player' | 'enemy', partyIndex: number, events: BattleEvent[]): void {
    const sideState = this.getSide(side);
    const prev = this.getActive(side);
    if (prev.currentHp > 0) {
      events.push({
        type: 'switch_out',
        side,
        creatureName: getCreatureDisplayName(prev),
      });
      events.push({
        type: 'text',
        message: ES.battle.switchOut(getCreatureDisplayName(prev)),
      });
    }
    sideState.activeIndex = partyIndex;
    const next = this.getActive(side);
    this.resetCombatantVolatiles(side, next);
    ensureBodyParts(next);
    events.push({ type: 'switch_in', side, partyIndex, creature: next });
    events.push({ type: 'text', message: ES.battle.goCreature(getCreatureDisplayName(next)) });
    this.triggerOnEntry(side, events);
  }

  private executeItem(
    itemId: string,
    targetPartyIndex: number | undefined,
    events: BattleEvent[]
  ): boolean {
    const item = getItem(itemId);
    if (item.category === 'capsule') {
      if (!this.state.isWild) {
        events.push({ type: 'text', message: ES.battle.cantCatchTrainer });
        return false;
      }
      if (!removeItem(this.bag, itemId, 1)) return false;
      const wild = this.getActive('enemy');
      const res = attemptCatch(wild, itemId, this.rng, {
        biome: this.state.biome,
        turnCount: this.state.turnCount,
        timePhase: this.timePhase,
      });
      events.push({
        type: 'catch_attempt',
        itemId,
        shakes: res.shakes,
        caught: res.caught,
        speciesId: wild.speciesId,
      });
      if (res.caught) {
        if (item.healOnCatch) {
          syncBodyPartsFull(wild);
          wild.status = 'none';
          wild.sleepTurns = 0;
        }
        this.state.finished = true;
        this.state.outcome = 'caught';
        events.push({
          type: 'text',
          message: ES.battle.caught(getCreatureDisplayName(wild)),
        });
        events.push({ type: 'battle_end', outcome: 'caught', rewardMoney: 0 });
        return true;
      }
      events.push({ type: 'text', message: ES.battle.brokeFree });
      return false;
    }

    if (item.category === 'battle') {
      if (!removeItem(this.bag, itemId, 1)) return false;
      events.push({ type: 'text', message: ES.bag.usedItem(item.name) });
      if (item.guardStatDrop) {
        this.getCombatantState('player').statDropGuarded = true;
        events.push({ type: 'text', message: ES.battle.guardApplied });
      }
      if (item.boostStat) {
        for (const [stat, delta] of Object.entries(item.boostStat) as [BattleStatName, number][]) {
          this.applyStageDelta('player', stat, delta, events);
        }
      }
      return false;
    }

    if (item.category === 'medicine') {
      const idx = targetPartyIndex ?? this.state.player.activeIndex;
      const creature = this.state.player.party[idx];
      if (!creature) return false;
      const applied = applyMedicineToCreature(itemId, creature);
      if (!applied.applied) {
        events.push({ type: 'text', message: ES.bag.noEffect });
        return false;
      }
      removeItem(this.bag, itemId, 1);
      events.push({ type: 'text', message: ES.bag.usedItem(item.name) });
      if (applied.healedHp > 0 && idx === this.state.player.activeIndex) {
        events.push({
          type: 'heal',
          target: 'player',
          amount: applied.healedHp,
          hpAfter: creature.currentHp,
          maxHp: creature.stats.hp,
        });
      }
      return false;
    }

    return false;
  }

  private tryInflictStatus(
    targetSide: 'player' | 'enemy',
    status: Exclude<StatusCondition, 'none'>,
    events: BattleEvent[]
  ): void {
    const target = this.getActive(targetSide);
    if (target.currentHp <= 0 || target.status !== 'none') return;
    const blockingAb = isStatusBlockedByAbility(target, status);
    if (blockingAb) {
      events.push({
        type: 'ability_triggered',
        side: targetSide,
        abilityId: blockingAb.id,
        abilityName: blockingAb.name,
      });
      return;
    }

    target.status = status;
    if (status === 'sleep') {
      target.sleepTurns = this.rng.int(1, 2);
    }
    const targetName = getCreatureDisplayName(target);
    events.push({ type: 'status_apply', target: targetSide, status });
    const msg =
      status === 'burn'
        ? ES.battle.statusBurn(targetName)
        : status === 'poison'
          ? ES.battle.statusPoison(targetName)
          : status === 'paralysis'
            ? ES.battle.statusParalysis(targetName)
            : ES.battle.statusSleep(targetName);
    events.push({ type: 'text', message: msg });
    this.checkHeldItemThresholds(targetSide, events);
  }

  private checkHeldItemThresholds(side: 'player' | 'enemy', events: BattleEvent[]): void {
    const creature = this.getActive(side);
    if (creature.currentHp <= 0) return;
    const held = getHeldItemDef(creature);
    const th = held?.heldHooks?.onHpThreshold;
    if (!held || !th) return;

    let triggered = false;
    if (th.cureStatus && creature.status !== 'none') {
      const oldStatus = creature.status;
      creature.status = 'none';
      creature.sleepTurns = 0;
      events.push({ type: 'status_clear', target: side, status: oldStatus });
      triggered = true;
    } else if (th.healRatio && creature.currentHp <= creature.stats.hp * th.thresholdRatio) {
      const healAmt = Math.max(1, Math.floor(creature.stats.hp * th.healRatio));
      healBodyParts(creature, healAmt);
      events.push({
        type: 'heal',
        target: side,
        amount: healAmt,
        hpAfter: creature.currentHp,
        maxHp: creature.stats.hp,
      });
      triggered = true;
    }

    if (triggered) {
      events.push({
        type: 'held_item_triggered',
        side,
        itemId: held.id,
        itemName: held.name,
        consumed: Boolean(held.heldHooks?.consumable),
      });
      if (held.heldHooks?.consumable) {
        creature.heldItemId = undefined;
      }
    }
  }

  private applyDirectDamageWithSash(
    targetSide: 'player' | 'enemy',
    amount: number,
    effectiveness: number,
    crit: boolean,
    events: BattleEvent[],
    preferredPart: BodyPartName = 'torso'
  ): number {
    const defender = this.getActive(targetSide);
    const held = getHeldItemDef(defender);
    const prevHp = defender.currentHp;
    let actualDamage = amount;
    let sashSaved = false;

    if (
      held?.heldHooks?.onDamageTaken?.surviveOneHit &&
      prevHp > 1 &&
      prevHp >= Math.floor(defender.stats.hp * 0.7) &&
      amount >= prevHp
    ) {
      actualDamage = prevHp - 1;
      sashSaved = true;
    }

    const partRes = applyDamageToBodyParts(defender, actualDamage, preferredPart);
    events.push({
      type: 'damage',
      target: targetSide,
      amount: actualDamage,
      hpAfter: defender.currentHp,
      maxHp: defender.stats.hp,
      effectiveness,
      crit,
      damagedPart: partRes.damagedPart,
      partBroken: partRes.partBroken,
    });

    if (partRes.partBroken) {
      events.push({
        type: 'text',
        message: ES.battle.partBroken(
          getCreatureDisplayName(defender),
          BODY_PART_LABELS[partRes.partBroken]
        ),
      });
    }

    if (sashSaved && held) {
      events.push({
        type: 'held_item_triggered',
        side: targetSide,
        itemId: held.id,
        itemName: held.name,
        consumed: Boolean(held.heldHooks?.consumable),
      });
      events.push({ type: 'text', message: ES.battle.sashSurvived(getCreatureDisplayName(defender), held.name) });
      if (held.heldHooks?.consumable) {
        defender.heldItemId = undefined;
      }
    } else if (defender.currentHp > 0) {
      this.checkHeldItemThresholds(targetSide, events);
    }

    return actualDamage;
  }

  private executeAction(side: 'player' | 'enemy', action: BattleAction, events: BattleEvent[]): void {
    if (action.type !== 'move') return;

    const targetSide: 'player' | 'enemy' = side === 'player' ? 'enemy' : 'player';
    const attacker = this.getActive(side);
    const defender = this.getActive(targetSide);
    const attackerSideState = this.getCombatantState(side, attacker);
    const defenderSideState = this.getCombatantState(targetSide, defender);

    if (attacker.currentHp <= 0 || defender.currentHp <= 0) return;

    const attackerName = getCreatureDisplayName(attacker);

    if (attackerSideState.flinched) {
      events.push({ type: 'flinch', target: side });
      events.push({ type: 'text', message: ES.battle.flinched(attackerName) });
      return;
    }

    if (attacker.status === 'sleep') {
      if (attacker.sleepTurns > 0) {
        attacker.sleepTurns -= 1;
        events.push({ type: 'text', message: ES.battle.fastAsleep(attackerName) });
        return;
      }
      attacker.status = 'none';
      events.push({ type: 'status_clear', target: side, status: 'sleep' });
      events.push({ type: 'text', message: ES.battle.wokeUp(attackerName) });
    }

    if (attacker.status === 'paralysis' && this.rng.chance(25)) {
      events.push({ type: 'text', message: ES.battle.paralyzedCantMove(attackerName) });
      return;
    }

    if (attackerSideState.confusedTurns && attackerSideState.confusedTurns > 0) {
      attackerSideState.confusedTurns -= 1;
      events.push({ type: 'text', message: ES.battle.isConfused(attackerName) });
      if (this.rng.chance(30)) {
        const selfDmg = Math.max(2, Math.floor(attacker.stats.hp * 0.1));
        const partRes = applyDamageToBodyParts(attacker, selfDmg, 'head');
        events.push({
          type: 'damage',
          target: side,
          amount: selfDmg,
          hpAfter: attacker.currentHp,
          maxHp: attacker.stats.hp,
          effectiveness: 1,
          crit: false,
          damagedPart: partRes.damagedPart,
          partBroken: partRes.partBroken,
        });
        events.push({ type: 'text', message: ES.battle.hurtConfusion(attackerName) });
        if (attacker.currentHp <= 0) {
          this.handleFaint(side, events);
        }
        return;
      }
    }

    const slot = attacker.moves[action.moveIndex] ?? attacker.moves[0];
    if (!slot || slot.pp <= 0) {
      events.push({ type: 'text', message: ES.battle.noPp });
      return;
    }

    slot.pp = Math.max(0, slot.pp - 1);
    const move = getMove(slot.moveId);

    events.push({ type: 'move_use', side, moveId: move.id, moveName: move.name });
    events.push({ type: 'text', message: ES.battle.usedMove(attackerName, move.name) });

    if (move.effect.kind === 'protect') {
      attackerSideState.protected = true;
      events.push({ type: 'text', message: ES.battle.protectedSelf(attackerName) });
      return;
    }

    if (defenderSideState.protected && move.effect.target !== 'self') {
      events.push({ type: 'text', message: ES.battle.blockedByProtect(getCreatureDisplayName(defender)) });
      return;
    }

    if (move.accuracy < 100 && !this.rng.chance(move.accuracy)) {
      events.push({ type: 'miss', side });
      events.push({ type: 'text', message: ES.battle.missed(attackerName) });
      return;
    }

    if (move.category !== 'status') {
      const hitPart = pickTargetBodyPart(move.category, this.rng.next());
      if (move.effect.kind === 'fixed_damage' && move.effect.fixedAmount) {
        const eff = getTypeMultiplier(move.type, getSpecies(defender.speciesId).types);
        if (eff === 0) {
          events.push({ type: 'text', message: ES.battle.immune });
          return;
        }
        this.applyDirectDamageWithSash(targetSide, move.effect.fixedAmount, 1, false, events, hitPart);
      } else {
        const hitCount =
          move.effect.kind === 'multi_hit'
            ? this.rng.int(move.effect.minHits ?? 2, move.effect.maxHits ?? 4)
            : 1;

        let totalDamage = 0;
        let lastEffectiveness = 1;
        let anyCrit = false;

        for (let h = 0; h < hitCount; h++) {
          if (defender.currentHp <= 0) break;
          const res = calculateDamage(
            attacker,
            defender,
            attackerSideState.stages,
            defenderSideState.stages,
            move,
            this.rng,
            this.state.weather
          );

          if (res.immuneHealRatio > 0 && res.triggeredDefenderAbility) {
            events.push({
              type: 'ability_triggered',
              side: targetSide,
              abilityId: res.triggeredDefenderAbility.id,
              abilityName: res.triggeredDefenderAbility.name,
            });
            const healAmt = Math.max(1, Math.floor(defender.stats.hp * res.immuneHealRatio));
            healBodyParts(defender, healAmt);
            events.push({
              type: 'heal',
              target: targetSide,
              amount: healAmt,
              hpAfter: defender.currentHp,
              maxHp: defender.stats.hp,
            });
            events.push({ type: 'text', message: ES.battle.healed(getCreatureDisplayName(defender), healAmt) });
            return;
          }

          if (res.effectiveness === 0) {
            events.push({ type: 'text', message: ES.battle.immune });
            return;
          }

          if (h === 0 && res.triggeredAttackerAbility) {
            events.push({
              type: 'ability_triggered',
              side,
              abilityId: res.triggeredAttackerAbility.id,
              abilityName: res.triggeredAttackerAbility.name,
            });
          }
          if (h === 0 && res.triggeredHeldItem) {
            events.push({
              type: 'held_item_triggered',
              side,
              itemId: res.triggeredHeldItem.id,
              itemName: res.triggeredHeldItem.name,
            });
          }
          if (h === 0 && res.triggeredDefenderAbility) {
            events.push({
              type: 'ability_triggered',
              side: targetSide,
              abilityId: res.triggeredDefenderAbility.id,
              abilityName: res.triggeredDefenderAbility.name,
            });
          }

          const dealt = this.applyDirectDamageWithSash(
            targetSide,
            res.damage,
            res.effectiveness,
            res.crit,
            events,
            h === 0 ? hitPart : pickTargetBodyPart(move.category, this.rng.next())
          );
          totalDamage += dealt;
          lastEffectiveness = res.effectiveness;
          if (res.crit) anyCrit = true;
        }

        if (hitCount > 1) {
          events.push({ type: 'text', message: ES.battle.multiHitCount(hitCount) });
        }
        if (anyCrit) {
          events.push({ type: 'text', message: ES.battle.crit });
        }
        if (lastEffectiveness >= 2) {
          events.push({ type: 'text', message: ES.battle.superEffective });
        } else if (lastEffectiveness < 1) {
          events.push({ type: 'text', message: ES.battle.notVeryEffective });
        }

        if (move.effect.kind === 'drain' && move.effect.drainRatio && totalDamage > 0) {
          const healAmt = Math.max(1, Math.floor(totalDamage * move.effect.drainRatio));
          healBodyParts(attacker, healAmt);
          events.push({
            type: 'heal',
            target: side,
            amount: healAmt,
            hpAfter: attacker.currentHp,
            maxHp: attacker.stats.hp,
          });
          events.push({ type: 'text', message: ES.battle.healed(attackerName, healAmt) });
        }

        if (move.effect.kind === 'recoil' && move.effect.recoilRatio && totalDamage > 0) {
          const recoil = Math.max(1, Math.floor(totalDamage * move.effect.recoilRatio));
          const partRes = applyDamageToBodyParts(attacker, recoil, 'arms');
          events.push({
            type: 'damage',
            target: side,
            amount: recoil,
            hpAfter: attacker.currentHp,
            maxHp: attacker.stats.hp,
            effectiveness: 1,
            crit: false,
            damagedPart: partRes.damagedPart,
            partBroken: partRes.partBroken,
          });
        }

        // Contact retaliation ability hook (physical moves)
        if (move.category === 'physical' && totalDamage > 0 && attacker.currentHp > 0) {
          const defAb = getCreatureAbilityDef(defender);
          const contact = defAb?.hooks.onContactHit;
          if (defAb && contact) {
            if (contact.retaliateRatio) {
              const retDmg = Math.max(1, Math.floor(attacker.stats.hp * contact.retaliateRatio));
              const partRes = applyDamageToBodyParts(attacker, retDmg, 'arms');
              events.push({
                type: 'ability_triggered',
                side: targetSide,
                abilityId: defAb.id,
                abilityName: defAb.name,
              });
              events.push({
                type: 'damage',
                target: side,
                amount: retDmg,
                hpAfter: attacker.currentHp,
                maxHp: attacker.stats.hp,
                effectiveness: 1,
                crit: false,
                damagedPart: partRes.damagedPart,
                partBroken: partRes.partBroken,
              });
            }
            if (
              contact.status &&
              attacker.status === 'none' &&
              this.rng.chance(contact.statusChance ?? 30)
            ) {
              events.push({
                type: 'ability_triggered',
                side: targetSide,
                abilityId: defAb.id,
                abilityName: defAb.name,
              });
              this.tryInflictStatus(side, contact.status, events);
            }
          }
        }
      }
    } else if (move.effect.kind === 'heal' && move.effect.healRatio) {
      const healAmt = Math.max(1, Math.floor(attacker.stats.hp * move.effect.healRatio));
      healBodyParts(attacker, healAmt);
      events.push({
        type: 'heal',
        target: side,
        amount: healAmt,
        hpAfter: attacker.currentHp,
        maxHp: attacker.stats.hp,
      });
      events.push({ type: 'text', message: ES.battle.healed(attackerName, healAmt) });
    }

    if (defender.currentHp > 0) {
      this.applyMoveSecondaryEffect(side, targetSide, move, events);
    }

    if (defender.currentHp <= 0) {
      this.handleFaint(targetSide, events);
    }
    if (!this.state.finished && attacker.currentHp <= 0) {
      this.handleFaint(side, events);
    }
  }

  private applyMoveSecondaryEffect(
    attackerSide: 'player' | 'enemy',
    defenderSide: 'player' | 'enemy',
    move: MoveDef,
    events: BattleEvent[]
  ): void {
    const eff = move.effect;
    if (eff.kind === 'weather' && eff.weather) {
      const turns = eff.weatherTurns ?? 5;
      this.state.weather = eff.weather;
      this.state.weatherTurns = turns;
      events.push({ type: 'weather_change', weather: eff.weather, turns });
      events.push({ type: 'text', message: ES.battle.weatherStart[eff.weather] });
      return;
    }

    if (
      eff.kind === 'none' ||
      eff.kind === 'drain' ||
      eff.kind === 'recoil' ||
      eff.kind === 'heal' ||
      eff.kind === 'multi_hit' ||
      eff.kind === 'protect' ||
      eff.kind === 'fixed_damage'
    ) {
      return;
    }

    const chance = eff.chance ?? 100;
    if (!this.rng.chance(chance)) return;

    const defender = this.getActive(defenderSide);
    const defenderName = getCreatureDisplayName(defender);
    const targetSide = eff.target === 'self' ? attackerSide : defenderSide;

    if (eff.kind === 'flinch') {
      this.getCombatantState(defenderSide).flinched = true;
      return;
    }

    if (eff.kind === 'confuse') {
      const dState = this.getCombatantState(defenderSide);
      if (!dState.confusedTurns) {
        dState.confusedTurns = this.rng.int(2, 3);
        events.push({ type: 'text', message: ES.battle.becameConfused(defenderName) });
      }
      return;
    }

    if (eff.kind === 'trap') {
      const dState = this.getSide(defenderSide);
      if (!dState.trappedTurns) {
        dState.trappedTurns = this.rng.int(3, 5);
        events.push({ type: 'text', message: ES.battle.trapped(defenderName) });
      }
      return;
    }

    if (eff.kind === 'leech') {
      const dState = this.getSide(defenderSide);
      if (!dState.leechSeeded) {
        dState.leechSeeded = true;
        events.push({ type: 'text', message: ES.battle.leechSeeded(defenderName) });
      }
      return;
    }

    if (eff.kind === 'burn_flinch') {
      if (this.rng.chance(50)) {
        this.getCombatantState(defenderSide).flinched = true;
      } else {
        this.tryInflictStatus(defenderSide, 'burn', events);
      }
      return;
    }

    if (eff.kind === 'status' && eff.status) {
      this.tryInflictStatus(defenderSide, eff.status, events);
      return;
    }

    if (eff.kind === 'stat_stage' && eff.stages) {
      const entries = Object.entries(eff.stages) as [BattleStatName, number][];
      for (const [stat, delta] of entries) {
        this.applyStageDelta(targetSide, stat, delta, events);
      }
    }
  }

  private resolveEndOfTurn(events: BattleEvent[]): void {
    // Process each deployed combatant once. Environment/round counters remain
    // outside this loop so weather duration is decremented only once per round.
    const participants = (['player', 'enemy'] as const).flatMap((side) =>
      this.getActivePartyIndices(side)
        .map((partyIndex) => ({ side, partyIndex, creature: this.getSide(side).party[partyIndex] }))
        .filter((entry) => entry.creature && entry.creature.currentHp > 0)
    );
    participants.sort((a, b) => {
      const speedA = a.creature.stats.spe * stageMultiplier(this.getCombatantState(a.side, a.creature).stages.spe);
      const speedB = b.creature.stats.spe * stageMultiplier(this.getCombatantState(b.side, b.creature).stages.spe);
      return speedB - speedA;
    });

    const originalIndices = {
      player: this.state.player.activeIndex,
      enemy: this.state.enemy.activeIndex,
    };

    try {
      for (const participant of participants) {
        if (this.state.finished) return;
        const { side, partyIndex } = participant;
        const c = participant.creature;
        const sideState = this.getSide(side);
        sideState.activeIndex = partyIndex;
        const sState = this.getCombatantState(side, c);
        if (c.currentHp <= 0) continue;

        if (c.status === 'burn' || c.status === 'poison') {
          const divisor = c.status === 'burn' ? 12 : 8;
          const dmg = Math.max(1, Math.floor(c.stats.hp / divisor));
          applyDamageToBodyParts(c, dmg, 'torso');
          const name = getCreatureDisplayName(c);
          events.push({
            type: 'status_tick',
            target: side,
            status: c.status,
            damage: dmg,
            hpAfter: c.currentHp,
            maxHp: c.stats.hp,
          });
          events.push({
            type: 'text',
            message: c.status === 'burn' ? ES.battle.burnDamage(name) : ES.battle.poisonDamage(name),
          });
          if (c.currentHp <= 0) {
            this.handleFaint(side, events);
            continue;
          }
        }

        if (sState.trappedTurns > 0 && c.currentHp > 0) {
          sState.trappedTurns -= 1;
          const dmg = Math.max(1, Math.floor(c.stats.hp / 10));
          const partRes = applyDamageToBodyParts(c, dmg, 'legs');
          events.push({
            type: 'damage',
            target: side,
            amount: dmg,
            hpAfter: c.currentHp,
            maxHp: c.stats.hp,
            effectiveness: 1,
            crit: false,
            damagedPart: partRes.damagedPart,
            partBroken: partRes.partBroken,
          });
          events.push({ type: 'text', message: ES.battle.trapDamage(getCreatureDisplayName(c)) });
          if (c.currentHp <= 0) {
            this.handleFaint(side, events);
            continue;
          }
        }

        if (sState.leechSeeded && c.currentHp > 0) {
          const oppSide: 'player' | 'enemy' = side === 'player' ? 'enemy' : 'player';
          const opp = this.getActive(oppSide);
          const drain = Math.max(1, Math.floor(c.stats.hp / 8));
          const partRes = applyDamageToBodyParts(c, drain, 'torso');
          events.push({
            type: 'damage',
            target: side,
            amount: drain,
            hpAfter: c.currentHp,
            maxHp: c.stats.hp,
            effectiveness: 1,
            crit: false,
            damagedPart: partRes.damagedPart,
            partBroken: partRes.partBroken,
          });
          if (opp.currentHp > 0) {
            healBodyParts(opp, drain);
            events.push({ type: 'heal', target: oppSide, amount: drain, hpAfter: opp.currentHp, maxHp: opp.stats.hp });
          }
          events.push({ type: 'text', message: ES.battle.leechDamage(getCreatureDisplayName(c)) });
          if (c.currentHp <= 0) {
            this.handleFaint(side, events);
            continue;
          }
        }

        const ab = getCreatureAbilityDef(c);
        if (ab?.hooks.onTurnEnd?.healRatio && c.currentHp > 0 && c.currentHp < c.stats.hp) {
          const healAmt = Math.max(1, Math.floor(c.stats.hp * ab.hooks.onTurnEnd.healRatio));
          healBodyParts(c, healAmt);
          events.push({ type: 'ability_triggered', side, abilityId: ab.id, abilityName: ab.name });
          events.push({ type: 'heal', target: side, amount: healAmt, hpAfter: c.currentHp, maxHp: c.stats.hp });
        }

        const held = getHeldItemDef(c);
        if (held?.heldHooks?.onTurnEnd?.healRatio && c.currentHp > 0 && c.currentHp < c.stats.hp) {
          const healAmt = Math.max(1, Math.floor(c.stats.hp * held.heldHooks.onTurnEnd.healRatio));
          healBodyParts(c, healAmt);
          events.push({ type: 'held_item_triggered', side, itemId: held.id, itemName: held.name });
          events.push({ type: 'heal', target: side, amount: healAmt, hpAfter: c.currentHp, maxHp: c.stats.hp });
        }
      }

      // Weather affects every deployed combatant, but its duration ticks once.
      if (!this.state.finished && (this.state.weather === 'sandstorm' || this.state.weather === 'snow')) {
        const weather = this.state.weather;
        const weatherTargets = (['player', 'enemy'] as const).flatMap((side) =>
          this.getActivePartyIndices(side).map((partyIndex) => ({ side, partyIndex, creature: this.getSide(side).party[partyIndex] }))
        );
        for (const target of weatherTargets) {
          if (this.state.finished) break;
          const { side, partyIndex, creature } = target;
          if (!creature || creature.currentHp <= 0) continue;
          this.getSide(side).activeIndex = partyIndex;
          const types = getSpecies(creature.speciesId).types;
          const immune = weather === 'sandstorm'
            ? types.includes('roca')
            : types.includes('marea') || types.includes('brisa');
          if (immune) continue;
          const dmg = Math.max(1, Math.floor(creature.stats.hp / 16));
          applyDamageToBodyParts(creature, dmg, 'torso');
          events.push({ type: 'weather_tick', weather, target: side, damage: dmg, hpAfter: creature.currentHp, maxHp: creature.stats.hp });
          events.push({ type: 'text', message: ES.battle.weatherTick[weather](getCreatureDisplayName(creature)) });
          if (creature.currentHp <= 0) this.handleFaint(side, events);
        }
      }

      if (!this.state.finished && this.state.weather !== 'none' && this.state.weatherTurns > 0) {
        this.state.weatherTurns -= 1;
        if (this.state.weatherTurns === 0) {
          this.state.weather = 'none';
          events.push({ type: 'weather_change', weather: 'none', turns: 0 });
          events.push({ type: 'text', message: ES.battle.weatherClear });
        }
      }
    } finally {
      // Restore the legacy player slot. Keep an enemy replacement selected by
      // handleFaint(); restoring the old index here would resurrect a fainted foe.
      this.state.player.activeIndex = originalIndices.player;
    }
  }

  private handleFaint(faintedSide: 'player' | 'enemy', events: BattleEvent[]): void {
    const fainted = this.getActive(faintedSide);
    const faintedName = getCreatureDisplayName(fainted);
    events.push({ type: 'faint', target: faintedSide, creatureName: faintedName });
    events.push({ type: 'text', message: ES.battle.fainted(faintedName) });

    if (faintedSide === 'enemy') {
      const deployedIndices = new Set(this.getActivePartyIndices('player'));
      const baseXp = computeBattleXp(fainted, !this.state.isWild);
      const grantXpToSlot = (slotIdx: number, amount: number): void => {
        const ally = this.state.player.party[slotIdx];
        if (!ally) return;
        const xpRes = awardExperience(ally, amount);
        const allyName = getCreatureDisplayName(ally);
        events.push({ type: 'xp_gain', partyIndex: slotIdx, amount, xpAfter: ally.xp });
        events.push({ type: 'text', message: ES.battle.gainedXp(allyName, amount) });
        for (const lv of xpRes.leveledUpTo) {
          events.push({ type: 'level_up', partyIndex: slotIdx, newLevel: lv, creature: ally });
          events.push({ type: 'text', message: ES.battle.leveledUp(allyName, lv) });
        }
        for (const mId of xpRes.autoLearnedMoves) {
          events.push({
            type: 'text',
            message: ES.battle.learnedMove(allyName, getMove(mId).name),
          });
        }
        for (const mId of xpRes.pendingLearnMoves) {
          events.push({ type: 'learn_move_prompt', partyIndex: slotIdx, moveId: mId });
        }
        const evoTarget = checkLevelEvolution(ally);
        if (evoTarget !== null) {
          events.push({ type: 'evolution_ready', partyIndex: slotIdx, targetSpeciesId: evoTarget });
        }
      };

      // Every deployed ally participated in the boss battle and receives full
      // participant XP. Reserve members keep the existing shared-party amount.
      for (const partyIndex of deployedIndices) {
        grantXpToSlot(partyIndex, baseXp);
      }
      const benchXp = computeSharedPartyXp(baseXp);
      for (let i = 0; i < this.state.player.party.length; i++) {
        if (deployedIndices.has(i)) continue;
        const reserve = this.state.player.party[i];
        if (!reserve || reserve.currentHp <= 0) continue;
        grantXpToSlot(i, benchXp);
      }

      if (rollCardDrop(fainted.speciesId, this.rng, this.state.trainer?.isBoss)) {
        const speciesName = getSpecies(fainted.speciesId).name;
        events.push({
          type: 'card_drop',
          speciesId: fainted.speciesId,
          creatureName: speciesName,
        });
        events.push({
          type: 'text',
          message: ES.battle.cardDropped(speciesName),
        });
      }

      const nextEnemyIdx = getFirstHealthyIndex(this.state.enemy.party);
      if (nextEnemyIdx === -1) {
        this.state.finished = true;
        this.state.outcome = 'win';
        const reward = this.state.trainer?.rewardMoney ?? 0;
        events.push({ type: 'text', message: ES.battle.wonBattle });
        if (reward > 0) {
          events.push({ type: 'text', message: ES.battle.wonMoney(reward) });
        }
        events.push({ type: 'battle_end', outcome: 'win', rewardMoney: reward });
      } else {
        this.state.enemy.activeIndex = nextEnemyIdx;
        const nextEnemy = this.getActive('enemy');
        this.resetCombatantVolatiles('enemy', nextEnemy);
        events.push({
          type: 'switch_in',
          side: 'enemy',
          partyIndex: nextEnemyIdx,
          creature: nextEnemy,
        });
        events.push({
          type: 'text',
          message: ES.battle.trainerSent(
            this.state.trainer?.name ?? '',
            getCreatureDisplayName(nextEnemy)
          ),
        });
        this.triggerOnEntry('enemy', events);
      }
    } else {
      const nextPlayerIdx = getFirstHealthyIndex(this.state.player.party);
      if (nextPlayerIdx === -1) {
        this.state.finished = true;
        this.state.outcome = 'lose';
        events.push({ type: 'text', message: ES.battle.lostBattle });
        events.push({ type: 'battle_end', outcome: 'lose', rewardMoney: 0 });
      }
    }
  }
}
