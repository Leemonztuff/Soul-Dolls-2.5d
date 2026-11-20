import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BattleContainer } from '../components/BattleContainer.tsx';
import {
  BattleActionMenuView,
  BattleResultModalView,
  LearnMoveModalView,
} from '../components/ui/BattleHudViews.tsx';
import { ArcaneBindingOverlay } from '../components/ui/ArcaneBindingOverlay.tsx';
import { getSpecies } from '../data/species.ts';
import { BODY_PART_SHORT } from '../domain/BodyParts.ts';
import { getCreatureDisplayName, xpForLevel } from '../domain/Creature.ts';
import type {
  BattleWeather,
  BodyPartName,
  CreatureInstance,
  CreatureType,
} from '../domain/types.ts';
import type { AssetProvider } from '../gfx/AssetProvider.ts';
import { ES } from '../i18n/es.ts';
import { renderSoulDustCounter } from './renderSoulDustCounter.ts';
import { renderTypeBadges } from './renderTypeBadge.ts';

export interface BattleResultDropSummary {
  speciesId: number;
  creatureName: string;
  isDuplicate?: boolean;
  dismantled?: boolean;
  dustGained?: number;
}

export class BattleHud {
  readonly root: HTMLDivElement;
  readonly fxOverlay: HTMLDivElement;
  private enemyBox: HTMLDivElement;
  private dustBox: HTMLDivElement;
  private weatherBox: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private bottomDock: HTMLDivElement;
  private playerBox: HTMLDivElement;
  private menuBox: HTMLDivElement;
  private replaceModal: HTMLDivElement;
  private currentSoulDust = 0;

  private assets: AssetProvider | null = null;
  private lastEnemyUid = '';
  private lastPlayerUid = '';
  private lastPlayerXp = -1;
  private lastPlayerLevel = -1;
  private targetPlayerHp = 0;
  private displayedPlayerHp = 0;
  private targetPlayerMaxHp = 1;
  private hpTextEl: HTMLSpanElement | null = null;
  private bannerTimer = 0;

  private enemyPartsRoot: Root | null = null;
  private playerPartsRoot: Root | null = null;
  private menuRoot: Root | null = null;
  private replaceRoot: Root | null = null;
  private lastEnemyCreature: CreatureInstance | null = null;
  private lastPlayerCreature: CreatureInstance | null = null;
  private enemyHit: {
    part: BodyPartName | null;
    tick: number;
    amount?: number;
    crit?: boolean;
    effectiveness?: number;
    broken?: boolean;
  } = { part: null, tick: 0 };
  private playerHit: {
    part: BodyPartName | null;
    tick: number;
    amount?: number;
    crit?: boolean;
    effectiveness?: number;
    broken?: boolean;
  } = { part: null, tick: 0 };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'pointer-events-none fixed inset-0 z-22 hidden safe-pad p-2.5 sm:p-3';

    this.fxOverlay = document.createElement('div');
    this.fxOverlay.className = 'pointer-events-none fixed inset-0 z-25 overflow-hidden hidden';

    this.enemyBox = document.createElement('div');
    this.enemyBox.className =
      'pointer-events-none absolute top-[calc(0.375rem+env(safe-area-inset-top,0px))] inset-x-2 mx-auto max-w-[400px] sm:mx-0 sm:max-w-none sm:inset-x-auto sm:left-[calc(0.75rem+env(safe-area-inset-left,0px))] sm:w-[328px] px-panel px-hud-box px-2.5 py-1.5 sm:p-2';

    this.dustBox = document.createElement('div');
    this.dustBox.className =
      'pointer-events-none absolute top-[calc(6.4rem+env(safe-area-inset-top,0px))] left-[calc(0.5rem+env(safe-area-inset-left,0px))] sm:top-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:left-[calc(21.75rem+env(safe-area-inset-left,0px))]';

    this.weatherBox = document.createElement('div');
    this.weatherBox.className =
      'pointer-events-none hidden absolute top-[calc(8.6rem+env(safe-area-inset-top,0px))] left-[calc(0.5rem+env(safe-area-inset-left,0px))] sm:top-[calc(3.15rem+env(safe-area-inset-top,0px))] sm:left-[calc(21.75rem+env(safe-area-inset-left,0px))] px-panel px-hud-box px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ice-cyan tabular-nums';

    this.bannerEl = document.createElement('div');
    this.bannerEl.className =
      'pointer-events-none absolute hidden max-w-[220px] px-panel px-panel-cyan px-2.5 py-1 text-right top-[calc(6.4rem+env(safe-area-inset-top,0px))] right-[calc(0.5rem+env(safe-area-inset-right,0px))] sm:top-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:right-[calc(0.75rem+env(safe-area-inset-right,0px))]';

    this.bottomDock = document.createElement('div');
    this.bottomDock.className =
      'pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-stretch gap-2.5 p-2 sm:flex-row-reverse sm:items-end sm:justify-between sm:gap-5 sm:p-4 safe-pad';

    this.playerBox = document.createElement('div');
    this.playerBox.className =
      'pointer-events-none w-full max-w-[400px] mx-auto sm:mx-0 sm:max-w-none sm:w-[328px] sm:shrink-0 sm:ml-auto mb-[76px] sm:mb-24 px-panel px-hud-box px-2.5 py-1.5 sm:p-2';

    this.menuBox = document.createElement('div');
    this.menuBox.className =
      'pointer-events-auto w-full max-w-[400px] mx-auto sm:mx-0 sm:flex-1 sm:max-w-[424px] hidden px-panel p-2 sm:p-3';

    this.replaceModal = document.createElement('div');
    this.replaceModal.className = 'pointer-events-none fixed inset-0 z-40 hidden';

    this.bottomDock.appendChild(this.playerBox);
    this.bottomDock.appendChild(this.menuBox);

    this.root.appendChild(this.enemyBox);
    this.root.appendChild(this.dustBox);
    this.root.appendChild(this.weatherBox);
    this.root.appendChild(this.bannerEl);
    this.root.appendChild(this.bottomDock);
    this.root.appendChild(this.replaceModal);
    parent.appendChild(this.fxOverlay);
    parent.appendChild(this.root);
    this.updateSoulDust(0);
  }

  setAssets(assets: AssetProvider): void {
    this.assets = assets;
  }

  updateSoulDust(amount: number): void {
    this.currentSoulDust = Math.max(0, Math.floor(amount));
    this.dustBox.innerHTML = renderSoulDustCounter(this.currentSoulDust, {
      compact: true,
      showLabel: true,
      dataAttr: 'data-battle-soul-dust',
    });
  }

  updateWeather(weather: BattleWeather, turns: number): void {
    if (weather === 'none') {
      this.weatherBox.classList.add('hidden');
      this.weatherBox.textContent = '';
      return;
    }
    const label = ES.battle.weatherLabel[weather];
    const turnsText = turns > 0 ? ` (${turns}t)` : '';
    const toneClass =
      weather === 'sun'
        ? 'text-resonant-gold border-resonant-gold'
        : weather === 'rain'
          ? 'text-ki-cyan border-ki-cyan'
          : weather === 'sandstorm'
            ? 'text-pale-gold border-brass'
            : 'text-ice-cyan border-ice-cyan';
    this.weatherBox.className = `pointer-events-none absolute top-[calc(8.6rem+env(safe-area-inset-top,0px))] left-[calc(0.5rem+env(safe-area-inset-left,0px))] sm:top-[calc(3.15rem+env(safe-area-inset-top,0px))] sm:left-[calc(21.75rem+env(safe-area-inset-left,0px))] px-panel px-hud-box px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider tabular-nums ${toneClass}`;
    this.weatherBox.textContent = `${label}${turnsText}`;
  }

  setVictoryShowcaseMode(active: boolean): void {
    this.enemyBox.classList.toggle('hidden', active);
    this.playerBox.classList.toggle('hidden', active);
    this.dustBox.classList.toggle('hidden', active);
    if (active) {
      this.weatherBox.classList.add('hidden');
      this.bannerEl.classList.add('hidden');
      this.hideMenu();
    }
  }

  show(): void {
    this.lastEnemyUid = '';
    this.lastPlayerUid = '';
    this.lastPlayerXp = -1;
    this.lastPlayerLevel = -1;
    this.enemyHit = { part: null, tick: 0 };
    this.playerHit = { part: null, tick: 0 };
    this.bannerTimer = 0;
    this.bannerEl.classList.add('hidden');
    this.weatherBox.classList.add('hidden');
    this.setVictoryShowcaseMode(false);
    this.updateSoulDust(this.currentSoulDust);
    this.root.classList.remove('hidden');
    this.fxOverlay.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.fxOverlay.classList.add('hidden');
    this.fxOverlay.innerHTML = '';
    this.bannerEl.classList.add('hidden');
    this.weatherBox.classList.add('hidden');
    this.setVictoryShowcaseMode(false);
    this.hideMenu();
    this.replaceModal.classList.add('hidden');
    this.replaceModal.classList.remove('flex');
    this.unmountPartRoots();
  }

  private unmountPartRoots(): void {
    this.enemyPartsRoot?.unmount();
    this.enemyPartsRoot = null;
    this.playerPartsRoot?.unmount();
    this.playerPartsRoot = null;
    this.menuRoot?.unmount();
    this.menuRoot = null;
    this.replaceRoot?.unmount();
    this.replaceRoot = null;
    this.lastEnemyCreature = null;
    this.lastPlayerCreature = null;
  }

  showBanner(title: string, subtitle?: string): void {
    this.bannerEl.innerHTML = `
      <div class="text-[11px] font-extrabold text-resonant-gold leading-tight">${title}</div>
      ${subtitle ? `<div class="text-[10px] text-porcelain leading-tight">${subtitle}</div>` : ''}
    `;
    this.bannerEl.classList.remove('hidden');
    this.bannerTimer = 1.9;
  }

  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerEl.classList.add('hidden');
      }
    }
    if (!this.hpTextEl) return;
    if (Math.abs(this.displayedPlayerHp - this.targetPlayerHp) > 0.25) {
      const rate = Math.max(12, Math.abs(this.targetPlayerHp - this.displayedPlayerHp) * 6);
      const step = rate * dt;
      if (this.displayedPlayerHp > this.targetPlayerHp) {
        this.displayedPlayerHp = Math.max(this.targetPlayerHp, this.displayedPlayerHp - step);
      } else {
        this.displayedPlayerHp = Math.min(this.targetPlayerHp, this.displayedPlayerHp + step);
      }
      this.hpTextEl.textContent = `${Math.round(this.displayedPlayerHp)}/${this.targetPlayerMaxHp} ${ES.party.hp}`;
    } else if (this.displayedPlayerHp !== this.targetPlayerHp) {
      this.displayedPlayerHp = this.targetPlayerHp;
      this.hpTextEl.textContent = `${this.targetPlayerHp}/${this.targetPlayerMaxHp} ${ES.party.hp}`;
    }
  }

  updateBars(
    player: CreatureInstance,
    enemy: CreatureInstance,
    isWild: boolean,
    playerParty: readonly CreatureInstance[] = [player],
    enemyParty: readonly CreatureInstance[] = [enemy],
    activeAllies: readonly CreatureInstance[] = [player]
  ): void {
    this.renderEnemyCard(enemy, isWild, enemyParty);
    this.renderPlayerCard(player, playerParty, activeAllies);
  }

  private renderHeldBadge(c: CreatureInstance): string {
    if (!c.heldItemId || !this.assets) return '';
    return `<img src="${this.assets.getItemIconDataUrl(c.heldItemId)}" class="pixel-canvas w-4 h-4 object-contain shrink-0" alt="" />`;
  }

  private renderTypeChips(speciesId: number): string {
    return renderTypeBadges(getSpecies(speciesId).types, 'chip', '');
  }

  private renderPartyBalls(party: readonly CreatureInstance[]): string {
    return party
      .slice(0, 6)
      .map((c) => {
        const cls =
          c.currentHp <= 0
            ? 'bg-ash-purple border-cold-stone'
            : c.status !== 'none'
              ? 'bg-ui-warning border-pale-gold'
              : 'bg-rift-crimson border-warm-white';
        return `<span class="inline-block w-2.5 h-2.5 rounded-none border ${cls}"></span>`;
      })
      .join('');
  }

  private renderLimbContainer(side: 'player' | 'enemy'): void {
    const root = side === 'player' ? this.playerPartsRoot : this.enemyPartsRoot;
    const creature = side === 'player' ? this.lastPlayerCreature : this.lastEnemyCreature;
    const hit = side === 'player' ? this.playerHit : this.enemyHit;
    if (!root || !creature) return;

    root.render(
      createElement(BattleContainer, {
        creature,
        variant: side,
        damagedPart: hit.part,
        damageTick: hit.tick,
        damageAmount: hit.amount,
        damageCrit: hit.crit,
        damageEffectiveness: hit.effectiveness,
        damageBroken: hit.broken,
        labels: BODY_PART_SHORT,
        statusLabels: { broken: 'ROT' },
      })
    );
  }

  flashBodyPart(
    side: 'player' | 'enemy',
    part: BodyPartName,
    details?: {
      amount?: number;
      crit?: boolean;
      effectiveness?: number;
      broken?: boolean;
    }
  ): void {
    if (side === 'player') {
      this.playerHit = {
        part,
        tick: this.playerHit.tick + 1,
        amount: details?.amount,
        crit: details?.crit,
        effectiveness: details?.effectiveness,
        broken: details?.broken,
      };
    } else {
      this.enemyHit = {
        part,
        tick: this.enemyHit.tick + 1,
        amount: details?.amount,
        crit: details?.crit,
        effectiveness: details?.effectiveness,
        broken: details?.broken,
      };
    }
    this.renderLimbContainer(side);
  }

  private renderEnemyCard(
    c: CreatureInstance,
    isWild: boolean,
    enemyParty: readonly CreatureInstance[]
  ): void {
    const isNew = this.lastEnemyUid !== c.uid;
    this.lastEnemyUid = c.uid;

    const pct = Math.max(0, Math.min(100, Math.round((c.currentHp / Math.max(1, c.stats.hp)) * 100)));
    const barColor = pct > 50 ? 'bg-ui-success' : pct > 20 ? 'bg-ui-warning' : 'bg-ui-danger';
    const isLow = pct > 0 && pct <= 20;
    const statusBadge =
      c.status !== 'none'
        ? `<span class="px-1.5 py-[1px] rounded-none border border-ethereal-orchid bg-royal-purple text-warm-white text-[10px] font-bold">${ES.statusShort[c.status]}</span>`
        : '';

    if (isNew || !this.enemyBox.querySelector('[data-hp-fill]')) {
      this.enemyPartsRoot?.unmount();
      this.enemyPartsRoot = null;
      this.enemyHit = { part: null, tick: 0 };
      this.enemyBox.classList.remove('battle-slide-left');
      void this.enemyBox.offsetWidth;
      this.enemyBox.classList.add('battle-slide-left');
      this.enemyBox.innerHTML = `
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center gap-1 min-w-0">
            <span class="font-bold text-xs sm:text-sm truncate" data-name></span>
            <span data-held></span>
            <div class="flex items-center gap-1 shrink-0" data-types></div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <div class="flex items-center gap-0.5" data-balls></div>
            <span data-status>${statusBadge}</span>
            <span class="text-[10px] text-bone-gray whitespace-nowrap" data-tag></span>
            <span class="text-[10px] text-cold-stone" aria-hidden="true">·</span>
            <span class="text-[11px] sm:text-xs font-bold text-resonant-gold tabular-nums" data-lv></span>
          </div>
        </div>
        <div class="relative mt-1 h-[8px] w-full rounded-none bg-abyss-ink border border-cold-stone shadow-[inset_0_1px_0_#050505] overflow-hidden">
          <div data-hp-ghost class="absolute inset-y-0 left-0 bg-pale-gold transition-[width] duration-700 ease-out delay-150" style="width:${pct}%"></div>
          <div data-hp-fill class="relative h-full ${barColor} transition-[width] duration-300 ease-out" style="width:${pct}%"></div>
          <div class="pointer-events-none absolute inset-0 px-meter-segmented" aria-hidden="true"></div>
        </div>
        <div data-parts class="mt-1 pt-1 border-t-2 border-ash-purple"></div>
      `;
      const partsSlot = this.enemyBox.querySelector('[data-parts]') as HTMLElement;
      this.enemyPartsRoot = createRoot(partsSlot);
    }

    this.lastEnemyCreature = c;
    (this.enemyBox.querySelector('[data-name]') as HTMLElement).textContent = getCreatureDisplayName(c);
    (this.enemyBox.querySelector('[data-held]') as HTMLElement).innerHTML = this.renderHeldBadge(c);
    (this.enemyBox.querySelector('[data-tag]') as HTMLElement).textContent = isWild
      ? 'Salvaje'
      : 'Soultrainer';
    (this.enemyBox.querySelector('[data-lv]') as HTMLElement).textContent = `${ES.party.lv}${c.level}`;
    (this.enemyBox.querySelector('[data-types]') as HTMLElement).innerHTML = this.renderTypeChips(c.speciesId);
    (this.enemyBox.querySelector('[data-balls]') as HTMLElement).innerHTML = isWild
      ? ''
      : this.renderPartyBalls(enemyParty);
    (this.enemyBox.querySelector('[data-status]') as HTMLElement).innerHTML = statusBadge;
    this.renderLimbContainer('enemy');

    const fill = this.enemyBox.querySelector('[data-hp-fill]') as HTMLElement;
    const ghost = this.enemyBox.querySelector('[data-hp-ghost]') as HTMLElement;
    fill.className = `relative h-full ${barColor} transition-[width] duration-300 ease-out ${isLow ? 'battle-low-hp' : ''}`;
    fill.style.width = `${pct}%`;
    ghost.style.width = `${pct}%`;
  }

  private renderPlayerCard(
    c: CreatureInstance,
    playerParty: readonly CreatureInstance[],
    activeAllies: readonly CreatureInstance[]
  ): void {
    const spec = getSpecies(c.speciesId);
    const isNew = this.lastPlayerUid !== c.uid;
    const leveledUp = !isNew && this.lastPlayerLevel >= 0 && c.level > this.lastPlayerLevel;
    this.lastPlayerUid = c.uid;
    this.lastPlayerLevel = c.level;

    const pct = Math.max(0, Math.min(100, Math.round((c.currentHp / Math.max(1, c.stats.hp)) * 100)));
    const barColor = pct > 50 ? 'bg-ui-success' : pct > 20 ? 'bg-ui-warning' : 'bg-ui-danger';
    const isLow = pct > 0 && pct <= 20;
    const statusBadge =
      c.status !== 'none'
        ? `<span class="px-1.5 py-[1px] rounded-none border border-ethereal-orchid bg-royal-purple text-warm-white text-[10px] font-bold">${ES.statusShort[c.status]}</span>`
        : '';

    const currXp = xpForLevel(c.level, spec.growthRate);
    const nextXp = c.level >= 100 ? currXp + 1 : xpForLevel(c.level + 1, spec.growthRate);
    const expPct =
      c.level >= 100
        ? 100
        : Math.max(0, Math.min(100, Math.round(((c.xp - currXp) / Math.max(1, nextXp - currXp)) * 100)));

    if (isNew || !this.playerBox.querySelector('[data-hp-fill]')) {
      this.playerPartsRoot?.unmount();
      this.playerPartsRoot = null;
      this.playerHit = { part: null, tick: 0 };
      this.displayedPlayerHp = c.currentHp;
      this.playerBox.classList.remove('battle-slide-right');
      void this.playerBox.offsetWidth;
      this.playerBox.classList.add('battle-slide-right');

      this.playerBox.innerHTML = `
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center gap-1 min-w-0">
            <span class="font-bold text-xs sm:text-sm truncate" data-name></span>
            <span data-held></span>
            <div class="flex items-center gap-1 shrink-0" data-types></div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <div class="flex items-center gap-0.5" data-balls></div>
            <span data-status>${statusBadge}</span>
            <span class="text-[11px] sm:text-xs font-bold text-resonant-gold tabular-nums" data-lv></span>
          </div>
        </div>
        <div class="mt-1 flex items-center gap-1.5">
          <div class="relative h-[8px] flex-1 rounded-none bg-abyss-ink border border-cold-stone shadow-[inset_0_1px_0_#050505] overflow-hidden">
            <div data-hp-ghost class="absolute inset-y-0 left-0 bg-pale-gold transition-[width] duration-700 ease-out delay-150" style="width:${pct}%"></div>
            <div data-hp-fill class="relative h-full ${barColor} transition-[width] duration-300 ease-out" style="width:${pct}%"></div>
            <div class="pointer-events-none absolute inset-0 px-meter-segmented" aria-hidden="true"></div>
          </div>
          <span data-hp-text class="text-[10px] sm:text-[11px] font-bold text-porcelain tabular-nums shrink-0 leading-none">${c.currentHp}/${c.stats.hp} ${ES.party.hp}</span>
        </div>
        <div data-parts class="mt-1 pt-1 border-t-2 border-ash-purple"></div>
        <div data-formation class="hidden mt-1 grid grid-cols-3 gap-1"></div>
        <div class="relative mt-1 h-[4px] w-full rounded-none bg-abyss-ink border border-ash-purple overflow-hidden">
          <div data-xp-fill class="h-full bg-ki-cyan transition-[width] duration-500 ease-out" style="width:${expPct}%"></div>
          <div class="pointer-events-none absolute inset-0 px-meter-segmented" aria-hidden="true"></div>
        </div>
      `;
      this.hpTextEl = this.playerBox.querySelector('[data-hp-text]') as HTMLSpanElement;
      const partsSlot = this.playerBox.querySelector('[data-parts]') as HTMLElement;
      this.playerPartsRoot = createRoot(partsSlot);
    }

    this.lastPlayerCreature = c;
    this.targetPlayerHp = c.currentHp;
    this.targetPlayerMaxHp = c.stats.hp;

    (this.playerBox.querySelector('[data-name]') as HTMLElement).textContent = getCreatureDisplayName(c);
    (this.playerBox.querySelector('[data-held]') as HTMLElement).innerHTML = this.renderHeldBadge(c);
    (this.playerBox.querySelector('[data-lv]') as HTMLElement).textContent = `${ES.party.lv}${c.level}`;
    (this.playerBox.querySelector('[data-types]') as HTMLElement).innerHTML = this.renderTypeChips(c.speciesId);
    (this.playerBox.querySelector('[data-balls]') as HTMLElement).innerHTML = this.renderPartyBalls(playerParty);
    (this.playerBox.querySelector('[data-status]') as HTMLElement).innerHTML = statusBadge;
    const formationSlot = this.playerBox.querySelector('[data-formation]') as HTMLElement;
    formationSlot.innerHTML = activeAllies.length > 1
      ? activeAllies.map((ally, index) => {
          const allyPct = Math.max(0, Math.min(100, Math.round((ally.currentHp / Math.max(1, ally.stats.hp)) * 100)));
          const hpTone = allyPct > 50 ? 'bg-ui-success' : allyPct > 20 ? 'bg-ui-warning' : 'bg-ui-danger';
          const state = ally.currentHp <= 0 ? 'CAÍDA' : ally.status !== 'none' ? ES.statusShort[ally.status] : 'ACTIVA';
          return `<div class="min-w-0 border border-cold-stone bg-abyss-ink/80 px-1.5 py-1">
            <div class="flex items-center justify-between gap-1 text-[9px] font-bold text-porcelain">
              <span class="truncate">${index + 1}. ${getSpecies(ally.speciesId).name}</span>
              <span class="shrink-0 text-resonant-gold">${state}</span>
            </div>
            <div class="mt-1 h-[4px] overflow-hidden bg-ash-purple"><div class="h-full ${hpTone}" style="width:${allyPct}%"></div></div>
            <div class="mt-0.5 text-[9px] text-bone-gray tabular-nums">${ally.currentHp}/${ally.stats.hp} PV</div>
          </div>`;
        }).join('')
      : '';
    formationSlot.classList.toggle('hidden', activeAllies.length <= 1);
    this.renderLimbContainer('player');

    const fill = this.playerBox.querySelector('[data-hp-fill]') as HTMLElement;
    const ghost = this.playerBox.querySelector('[data-hp-ghost]') as HTMLElement;
    fill.className = `relative h-full ${barColor} transition-[width] duration-300 ease-out ${isLow ? 'battle-low-hp' : ''}`;
    fill.style.width = `${pct}%`;
    ghost.style.width = `${pct}%`;

    const xpFill = this.playerBox.querySelector('[data-xp-fill]') as HTMLElement;
    xpFill.style.width = `${expPct}%`;
    if (leveledUp || (this.lastPlayerXp >= 0 && c.xp > this.lastPlayerXp)) {
      xpFill.classList.remove('battle-xp-burst');
      void xpFill.offsetWidth;
      if (leveledUp) xpFill.classList.add('battle-xp-burst');
    }
    this.lastPlayerXp = c.xp;

    if (isLow) {
      this.playerBox.style.borderColor = '#C2234B';
    } else {
      this.playerBox.style.borderColor = '#A67F46';
    }
  }

  spawnFloatingNumber(
    normX: number,
    normY: number,
    text: string,
    tone: 'normal' | 'super' | 'resist' | 'crit' | 'heal'
  ): void {
    const el = document.createElement('div');
    const colorCls =
      tone === 'crit'
        ? 'text-ui-gold text-lg sm:text-xl'
        : tone === 'super'
          ? 'text-coral-red text-base sm:text-lg'
          : tone === 'heal'
            ? 'text-neon-mint text-base sm:text-lg'
            : tone === 'resist'
              ? 'text-bone-gray text-sm'
              : 'text-warm-white text-base';
    el.className = `pointer-events-none absolute font-black px-text-outline battle-float-num ${colorCls}`;
    el.style.left = `${Math.round(Math.max(12, Math.min(88, normX * 100)))}%`;
    el.style.top = `${Math.round(Math.max(18, Math.min(72, normY * 100)))}%`;
    el.textContent = text;
    this.fxOverlay.appendChild(el);
    window.setTimeout(() => {
      el.remove();
    }, 960);
  }

  showMainMenu(
    creature: CreatureInstance,
    enemy: CreatureInstance,
    isWild: boolean,
    callbacks: {
      onMove: (moveIndex: number) => void;
      onBag: () => void;
      onParty: () => void;
      onRun: () => void;
    },
    movesOnly = false
  ): void {
    this.menuBox.classList.remove('hidden');
    this.playerBox.classList.remove('mb-[76px]', 'sm:mb-24');
    this.playerBox.classList.add('mb-1', 'sm:mb-0');

    if (!this.menuRoot) {
      this.menuRoot = createRoot(this.menuBox);
    }

    this.menuRoot.render(
      createElement(BattleActionMenuView, {
        key: `${creature.uid}-${enemy.uid}-${isWild ? 'wild' : 'trainer'}`,
        creature,
        enemy,
        isWild,
        assets: this.assets,
        onMove: callbacks.onMove,
        onBag: callbacks.onBag,
        onParty: callbacks.onParty,
        onRun: callbacks.onRun,
        movesOnly,
      })
    );
  }

  hideMenu(): void {
    this.menuBox.classList.add('hidden');
    this.playerBox.classList.remove('mb-1', 'sm:mb-0');
    this.playerBox.classList.add('mb-[76px]', 'sm:mb-24');
  }

  private closeReplaceOverlay(): void {
    this.replaceRoot?.unmount();
    this.replaceRoot = null;
    this.replaceModal.classList.add('hidden');
    this.replaceModal.classList.remove('flex');
  }

  showLearnMovePrompt(
    creature: CreatureInstance,
    newMoveId: string,
    onDecision: (replaceIndex: number | null) => void
  ): void {
    this.replaceModal.className = 'pointer-events-auto fixed inset-0 z-40 block';
    if (!this.replaceRoot) {
      this.replaceRoot = createRoot(this.replaceModal);
    }
    this.replaceRoot.render(
      createElement(LearnMoveModalView, {
        creature,
        newMoveId,
        onDecision: (replaceIndex) => {
          this.closeReplaceOverlay();
          onDecision(replaceIndex);
        },
      })
    );
  }

  showBattleResultOverlay(
    summary: {
      xpTotal: number;
      soulDust?: number;
      championName?: string;
      rewardMoney?: number;
      droppedCards: BattleResultDropSummary[];
    },
    onAlbum: () => void,
    onContinue: () => void,
    onDismantleDuplicate?: (index: number) => void
  ): void {
    const soulDust = summary.soulDust ?? this.currentSoulDust;
    this.replaceModal.className = 'pointer-events-none fixed inset-0 z-40 block';
    if (!this.replaceRoot) {
      this.replaceRoot = createRoot(this.replaceModal);
    }
    this.replaceRoot.render(
      createElement(BattleResultModalView, {
        xpTotal: summary.xpTotal,
        soulDust,
        championName: summary.championName,
        rewardMoney: summary.rewardMoney,
        droppedCards: summary.droppedCards,
        assets: this.assets,
        onAlbum,
        onContinue: () => {
          this.closeReplaceOverlay();
          onContinue();
        },
        onDismantleDuplicate,
      })
    );
  }

  showArcaneBindingOverlay(params: {
    speciesId: number;
    creatureName: string;
    level: number;
    creatureType: CreatureType;
    vesselName?: string;
    spriteUrl?: string;
    durationMs?: number;
    onDone?: () => void;
  }): void {
    const spriteUrl =
      params.spriteUrl ??
      (this.assets ? this.assets.getCreatureDataUrl(params.speciesId, 'front') : undefined);
    this.replaceModal.className = 'pointer-events-auto fixed inset-0 z-40 block';
    if (!this.replaceRoot) {
      this.replaceRoot = createRoot(this.replaceModal);
    }
    this.replaceRoot.render(
      createElement(ArcaneBindingOverlay, {
        speciesId: params.speciesId,
        creatureName: params.creatureName,
        level: params.level,
        creatureType: params.creatureType,
        vesselName: params.vesselName,
        spriteUrl,
        durationMs: params.durationMs ?? 2200,
        onComplete: () => {
          this.closeReplaceOverlay();
          params.onDone?.();
        },
      })
    );
  }

  dispose(): void {
    this.unmountPartRoots();
    this.fxOverlay.remove();
    this.root.remove();
  }
}
