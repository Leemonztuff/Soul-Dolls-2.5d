import React, { useState } from 'react';
import { getMove } from '../../data/moves.ts';
import { getSpecies } from '../../data/species.ts';
import { TYPE_VISUALS } from '../../data/types.ts';
import { getMoveEffectivenessHint } from '../../domain/BattleHints.ts';
import { formatCardBonuses, getCardDef, getCardDismantleValue } from '../../domain/Cards.ts';
import { getCreatureDisplayName } from '../../domain/Creature.ts';
import type { CreatureInstance } from '../../domain/types.ts';
import type { AssetProvider } from '../../gfx/AssetProvider.ts';
import { ES } from '../../i18n/es.ts';
import { CARD_RARITY_STYLES } from '../../ui/cardRarityStyles.ts';
import { PxBadge, PxTypeBadge } from './PxBadge.tsx';
import { PxButton } from './PxButton.tsx';
import { PxModal } from './PxModal.tsx';
import { PxPanel } from './PxPanel.tsx';
import { PxSoulDustCounter } from './PxSoulDustCounter.tsx';

export interface BattleDropCardSummary {
  speciesId: number;
  creatureName: string;
  isDuplicate?: boolean;
  dismantled?: boolean;
  dustGained?: number;
}

export interface BattleActionMenuViewProps {
  creature: CreatureInstance;
  enemy: CreatureInstance;
  isWild: boolean;
  assets: AssetProvider | null;
  onMove: (moveIndex: number) => void;
  onBag: () => void;
  onParty: () => void;
  onRun: () => void;
  movesOnly?: boolean;
}

export const BattleActionMenuView: React.FC<BattleActionMenuViewProps> = ({
  creature,
  enemy,
  isWild,
  assets,
  onMove,
  onBag,
  onParty,
  onRun,
  movesOnly = false,
}) => {
  const [subMenu, setSubMenu] = useState<'root' | 'moves'>(movesOnly ? 'moves' : 'root');
  const enemyTypes = getSpecies(enemy.speciesId).types;

  const renderIcon = (kind: 'fight' | 'bag' | 'party' | 'run') =>
    assets ? (
      <img
        src={assets.getBattleIconDataUrl(kind)}
        alt=""
        className="pixel-canvas w-4 h-4 sm:w-5 sm:h-5 shrink-0"
      />
    ) : null;

  if (subMenu === 'moves') {
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {creature.moves.map((slot, idx) => {
            const m = getMove(slot.moveId);
            const v = TYPE_VISUALS[m.type];
            const disabled = slot.pp <= 0;
            const hint = getMoveEffectivenessHint(m.type, m.category, enemyTypes);
            const hintTone =
              hint.tone === 'super'
                ? 'emerald'
                : hint.tone === 'immune'
                  ? 'neutral'
                  : 'crimson';

            return (
              <PxButton
                key={`${slot.moveId}-${idx}`}
                variant="ghost"
                showSelector={false}
                disabled={disabled}
                onClick={() => onMove(idx)}
                style={disabled ? undefined : { borderColor: v.border }}
                className="min-h-[46px] sm:min-h-[50px] p-1.5 sm:p-2 text-left flex-col items-stretch justify-between gap-0.5"
              >
                <div className="flex items-center justify-between gap-1 w-full">
                  <span className="font-bold text-xs sm:text-sm text-warm-white truncate">
                    {m.name}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {hint.label && (
                      <PxBadge tone={hintTone} size="xs">
                        {hint.label}
                      </PxBadge>
                    )}
                    <PxTypeBadge type={m.type} size="chip" />
                  </div>
                </div>
                <div className="flex justify-between w-full text-[10px] text-porcelain tabular-nums mt-0.5 font-normal">
                  <span>
                    {ES.summary.power}: {m.power || '—'}
                  </span>
                  <span>
                    PP {slot.pp}/{slot.maxPp}
                  </span>
                </div>
              </PxButton>
            );
          })}
        </div>
        {!movesOnly && (
          <PxButton
            variant="secondary"
            size="sm"
            className="self-end px-3.5"
            onClick={() => setSubMenu('root')}
          >
            {ES.party.back}
          </PxButton>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs sm:text-sm font-bold text-porcelain px-0.5 truncate">
        {ES.battle.whatWillDo(getCreatureDisplayName(creature))}
      </div>
      <div className="px-divider" aria-hidden="true" />
      <div className="grid grid-cols-2 gap-2">
        <PxButton
          variant="danger"
          icon={renderIcon('fight')}
          className="min-h-[44px] sm:min-h-[48px] px-2.5 text-xs sm:text-sm"
          onClick={() => setSubMenu('moves')}
        >
          {ES.battle.fight}
        </PxButton>
        <PxButton
          variant="primary"
          icon={renderIcon('bag')}
          className="min-h-[44px] sm:min-h-[48px] px-2.5 text-xs sm:text-sm"
          onClick={onBag}
        >
          {ES.battle.bag}
        </PxButton>
        <PxButton
          variant="success"
          icon={renderIcon('party')}
          className="min-h-[44px] sm:min-h-[48px] px-2.5 text-xs sm:text-sm"
          onClick={onParty}
        >
          {ES.battle.party}
        </PxButton>
        <PxButton
          variant="arcane"
          disabled={!isWild}
          icon={renderIcon('run')}
          className="min-h-[44px] sm:min-h-[48px] px-2.5 text-xs sm:text-sm"
          onClick={() => {
            if (isWild) onRun();
          }}
        >
          {ES.battle.run}
        </PxButton>
      </div>
    </div>
  );
};

export interface LearnMoveModalViewProps {
  creature: CreatureInstance;
  newMoveId: string;
  onDecision: (replaceIndex: number | null) => void;
}

export const LearnMoveModalView: React.FC<LearnMoveModalViewProps> = ({
  creature,
  newMoveId,
  onDecision,
}) => {
  const newMove = getMove(newMoveId);

  return (
    <PxModal open variant="gold" padding="md" maxWidthClass="max-w-md" zClass="z-40">
      <div className="text-sm font-bold text-resonant-gold mb-2">
        {ES.battle.wantsToLearn(getCreatureDisplayName(creature), newMove.name)}
      </div>
      <div className="text-xs text-bone-gray mb-3">
        {newMove.name} ({ES.types[newMove.type]}, Pot. {newMove.power || '—'}):{' '}
        {newMove.description}
      </div>
      <div className="space-y-2 mb-3">
        {creature.moves.map((slot, idx) => {
          const m = getMove(slot.moveId);
          return (
            <PxButton
              key={`${slot.moveId}-${idx}`}
              variant="ghost"
              fullWidth
              align="between"
              className="hover:bg-blood-moon hover:border-rift-crimson p-2.5"
              onClick={() => onDecision(idx)}
            >
              <span className="font-bold text-sm">{m.name}</span>
              <span className="text-xs text-bone-gray tabular-nums">
                {ES.types[m.type]} · Pot {m.power || '—'}
              </span>
            </PxButton>
          );
        })}
      </div>
      <PxButton variant="secondary" fullWidth onClick={() => onDecision(null)}>
        {ES.battle.skipMove}
      </PxButton>
    </PxModal>
  );
};

export interface BattleResultModalViewProps {
  xpTotal: number;
  soulDust: number;
  championName?: string;
  rewardMoney?: number;
  droppedCards: BattleDropCardSummary[];
  assets: AssetProvider | null;
  onAlbum: () => void;
  onContinue: () => void;
  onDismantleDuplicate?: (index: number) => void;
}

export const BattleResultModalView: React.FC<BattleResultModalViewProps> = ({
  xpTotal,
  soulDust,
  championName,
  rewardMoney,
  droppedCards,
  assets,
  onAlbum,
  onContinue,
  onDismantleDuplicate,
}) => {
  const subtitleParts: string[] = [];
  if (championName) subtitleParts.push(`${championName} vence`);
  if (rewardMoney && rewardMoney > 0) {
    subtitleParts.push(`+${rewardMoney} monedas`);
  }
  const subtitleText =
    subtitleParts.length > 0 ? subtitleParts.join(' · ') : 'Resumen de recompensas y botín';

  return (
    <PxModal
      open
      variant="gold"
      padding="md"
      align="bottom-right"
      transparentBackdrop
      maxWidthClass="max-w-md"
      zClass="z-40"
      panelClassName="max-h-[54dvh] sm:max-h-[calc(100dvh-2.5rem)] space-y-3.5"
    >
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-black text-resonant-gold px-text-shadow">
              ◆ ¡Victoria!
            </div>
            <div className="text-xs text-bone-gray truncate">{subtitleText}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PxSoulDustCounter amount={soulDust} compact showLabel />
            <PxBadge tone="cyan" size="md" className="tabular-nums py-1 px-2.5">
              +{xpTotal} XP
            </PxBadge>
          </div>
        </div>
        <div className="px-divider mt-2.5" aria-hidden="true" />
      </div>

      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-bone-gray mb-2">
          Cartas Obtenidas en Combate
        </div>
        <div className="space-y-2 max-h-44 sm:max-h-56 touch-scroll overflow-y-auto pr-1">
          {droppedCards.length === 0 ? (
            <div className="text-xs text-bone-gray py-2">
              Ninguna carta obtenida en este combate.
            </div>
          ) : (
            droppedCards.map((card, idx) => {
              const cardDef = getCardDef(card.speciesId);
              const rarityStyle = CARD_RARITY_STYLES[cardDef.rarity];
              const rarityTag = ES.cards.rarity[cardDef.rarity];
              const bonuses = formatCardBonuses(cardDef.bonuses);
              const dustValue = getCardDismantleValue(card.speciesId);
              const metaStatus = card.isDuplicate
                ? `${rarityTag} · ${ES.cards.duplicateTag}`
                : `${rarityTag} · Nueva`;

              return (
                <PxPanel
                  key={`${card.speciesId}-${idx}`}
                  variant="card"
                  padding="none"
                  className={`flex flex-wrap sm:flex-nowrap items-center gap-2.5 p-2.5 ${rarityStyle.border} ${rarityStyle.frameBg}`}
                >
                  <img
                    src={assets ? assets.getCreatureDataUrl(card.speciesId, 'front') : ''}
                    className="souldoll-img w-12 h-12 object-contain bg-abyss-ink border border-ash-purple p-0.5 shrink-0"
                    alt={card.creatureName}
                  />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-bold text-xs text-porcelain truncate">
                        {cardDef.name}
                      </span>
                      <span
                        className={`text-[10px] font-bold ${rarityStyle.accent} whitespace-nowrap shrink-0`}
                      >
                        {metaStatus}
                      </span>
                    </div>
                    <div className="text-[10px] text-ki-cyan tabular-nums mt-0.5 truncate">
                      {bonuses}
                    </div>
                  </div>
                  {card.dismantled ? (
                    <span className="text-[11px] font-bold text-ghost-violet tabular-nums shrink-0">
                      {ES.cards.dismantledLabel(card.dustGained ?? dustValue)}
                    </span>
                  ) : card.isDuplicate && onDismantleDuplicate ? (
                    <PxButton
                      variant="arcane"
                      size="sm"
                      className="min-h-[44px] px-2.5 text-[11px]"
                      onClick={() => onDismantleDuplicate(idx)}
                    >
                      {ES.cards.dismantleAction(dustValue)}
                    </PxButton>
                  ) : null}
                </PxPanel>
              );
            })
          )}
        </div>
      </div>

      <div className="px-divider" aria-hidden="true" />
      <div className="flex flex-col sm:flex-row items-center gap-2.5">
        <PxButton
          variant="primary"
          size="md"
          className="w-full sm:flex-1"
          onClick={onAlbum}
        >
          Ver en Álbum de Cartas
        </PxButton>
        <PxButton
          variant="secondary"
          size="md"
          className="w-full sm:flex-1"
          onClick={onContinue}
        >
          Continuar
        </PxButton>
      </div>
    </PxModal>
  );
};
