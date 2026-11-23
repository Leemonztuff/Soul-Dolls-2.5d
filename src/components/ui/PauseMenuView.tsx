import React, { useState } from 'react';
import { ALL_SPECIES_IDS, getSpecies } from '../../data/species.ts';
import { getBestiaryCounts } from '../../domain/Bestiary.ts';
import { getTotalVesselCount } from '../../domain/BodyParts.ts';
import { getAlbumCounts, getSoulDust } from '../../domain/Cards.ts';
import type {
  CameraMode,
  CameraLabProfileId,
  GameOptions,
  GraphicsQualitySetting,
  SaveData,
} from '../../domain/types.ts';
import type { AssetProvider } from '../../gfx/AssetProvider.ts';
import { ES } from '../../i18n/es.ts';
import { defaultOptions } from '../../save/migrations.ts';
import { PxTypeBadge } from './PxBadge.tsx';
import { PxButton } from './PxButton.tsx';
import { PxNotice } from './PxNotice.tsx';
import { PxPanel, PxPanelFooter, PxPanelHeader } from './PxPanel.tsx';
import { PxSlider } from './PxSlider.tsx';
import { PxSoulDustIcon } from './PxSoulDustCounter.tsx';
import { PxTabs, type PxTabItem } from './PxTabs.tsx';

export type PauseOptionsTab = 'sound' | 'quality' | 'postfx' | 'game';

export interface PauseMenuViewCallbacks {
  onParty: () => void;
  onBag: () => void;
  onVessels?: () => void;
  onBestiary?: () => void;
  onCards?: () => void;
  onQuests?: () => void;
  onSpriteInspector?: () => void;
  onSave: () => boolean;
  onOptionsChanged: (options: GameOptions) => void;
  onClose: () => void;
}

export interface PauseMenuViewProps {
  save: SaveData;
  assets: AssetProvider;
  slotLabel?: string;
  optionsOnly?: boolean;
  initialView?: 'main' | 'dex' | 'options';
  initialOptionsTab?: PauseOptionsTab;
  onOptionsTabChange?: (tab: PauseOptionsTab) => void;
  callbacks: PauseMenuViewCallbacks;
}

interface ToggleRowProps {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}

const PxToggleRow: React.FC<ToggleRowProps> = ({ label, enabled, onToggle }) => (
  <PxButton variant="secondary" fullWidth align="between" onClick={onToggle}>
    <span>{label}</span>
    <span className={`font-bold tabular-nums ${enabled ? 'text-neon-mint' : 'text-bone-gray'}`}>
      {enabled ? ES.options.yes : ES.options.no}
    </span>
  </PxButton>
);

export const PauseMenuView: React.FC<PauseMenuViewProps> = ({
  save,
  assets,
  slotLabel,
  optionsOnly = false,
  initialView = optionsOnly ? 'options' : 'main',
  initialOptionsTab = 'sound',
  onOptionsTabChange,
  callbacks,
}) => {
  const [view, setView] = useState<'main' | 'dex' | 'options'>(
    optionsOnly ? 'options' : initialView
  );
  const [activeTab, setActiveTab] = useState<PauseOptionsTab>(initialOptionsTab);
  const [notice, setNotice] = useState('');
  const [, setVersion] = useState(0);

  const rerender = () => setVersion((v) => v + 1);
  const opt = save.options;

  const handleTabChange = (tab: PauseOptionsTab) => {
    setActiveTab(tab);
    onOptionsTabChange?.(tab);
  };

  const mutateOption = (fn: () => void, nextNotice = '') => {
    fn();
    callbacks.onOptionsChanged(opt);
    setNotice(nextNotice);
    rerender();
  };

  if (view === 'dex') {
    return (
      <PxPanel
        variant="gold"
        padding="md"
        ornate
        scrollable
        className="w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] mx-auto"
      >
        <PxPanelHeader
          title={ES.dex.title}
          ornate
          subtitle={`${ES.dex.seen}: ${save.seenSpecies.length}/${ALL_SPECIES_IDS.length} · ${ES.dex.caught}: ${save.caughtSpecies.length}/${ALL_SPECIES_IDS.length}`}
          right={
            <PxButton variant="secondary" size="md" onClick={() => setView('main')}>
              {ES.options.back}
            </PxButton>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {ALL_SPECIES_IDS.map((id) => {
            const seen = save.seenSpecies.includes(id);
            const caught = save.caughtSpecies.includes(id);
            const spec = getSpecies(id);
            return (
              <PxPanel
                key={id}
                variant="card"
                padding="none"
                className={`p-2 flex items-center gap-2 ${
                  caught ? 'border-resonant-gold' : 'border-ash-purple'
                }`}
              >
                {seen ? (
                  <img
                    src={assets.getCreatureDataUrl(id, 'front')}
                    data-souldoll-id={id}
                    data-souldoll-view="front"
                    className="souldoll-img w-12 h-12 object-contain shrink-0"
                    alt={spec.name}
                  />
                ) : (
                  <div className="w-12 h-12 rounded-none border border-ash-purple bg-smoked-wood flex items-center justify-center text-cold-stone font-bold shrink-0">
                    ?
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs text-bone-gray tabular-nums">
                    #{String(id).padStart(2, '0')} {caught ? '★' : ''}
                  </div>
                  <div className="font-bold text-sm truncate">
                    {seen ? spec.name : ES.dex.unknown}
                  </div>
                  {seen && (
                    <div className="mt-0.5 flex gap-1 flex-wrap">
                      {spec.types.map((t) => (
                        <PxTypeBadge key={t} type={t} size="sm" />
                      ))}
                    </div>
                  )}
                </div>
              </PxPanel>
            );
          })}
        </div>
      </PxPanel>
    );
  }

  if (view === 'options') {
    const tabItems: PxTabItem<PauseOptionsTab>[] = [
      { id: 'sound', label: ES.options.tabs.sound },
      { id: 'quality', label: ES.options.tabs.quality },
      { id: 'postfx', label: ES.options.tabs.postfx },
      { id: 'game', label: ES.options.tabs.game },
    ];

    const qualityLevels: GraphicsQualitySetting[] = ['auto', 'low', 'medium', 'high'];
    const cameraModes: { mode: CameraMode; label: string }[] = [
      { mode: 'fixed', label: ES.options.cameraFixed },
      { mode: 'free_orbit', label: ES.options.cameraFreeOrbit },
    ];
    const tiltBlocked = opt.graphicsQuality === 'low' || opt.pixelEffect;

    const exitOptions = () => {
      if (optionsOnly) {
        callbacks.onClose();
      } else {
        setNotice('');
        setView('main');
      }
    };

    return (
      <PxPanel
        variant="gold"
        padding="md"
        ornate
        className="w-[min(94vw,400px)] max-h-[calc(100dvh-1.5rem)] flex flex-col mx-auto"
      >
        <PxPanelHeader
          title={ES.options.title}
          ornate
          right={
            <PxButton variant="secondary" size="sm" onClick={exitOptions}>
              {optionsOnly ? ES.options.close : ES.options.back}
            </PxButton>
          }
        />

        <PxTabs
          items={tabItems}
          value={activeTab}
          onChange={handleTabChange}
          columns={4}
          size="sm"
          className="mb-3"
        />

        {notice && (
          <PxNotice tone="info" className="mb-2">
            {notice}
          </PxNotice>
        )}

        <div className="flex-1 min-h-0 touch-scroll overflow-y-auto space-y-2 pr-0.5 text-sm">
          {activeTab === 'sound' && (
            <>
              <PxSlider
                label={ES.options.volume}
                min={0}
                max={100}
                value={Math.round(opt.volume * 100)}
                displayValue={`${Math.round(opt.volume * 100)}%`}
                onChange={(v) =>
                  mutateOption(() => {
                    opt.volume = v / 100;
                  })
                }
              />
              <PxSlider
                label={ES.options.musicVolume}
                min={0}
                max={100}
                value={Math.round(opt.musicVolume * 100)}
                displayValue={`${Math.round(opt.musicVolume * 100)}%`}
                onChange={(v) =>
                  mutateOption(() => {
                    opt.musicVolume = v / 100;
                  })
                }
              />
              <PxSlider
                label={ES.options.sfxVolume}
                min={0}
                max={100}
                value={Math.round(opt.sfxVolume * 100)}
                displayValue={`${Math.round(opt.sfxVolume * 100)}%`}
                onChange={(v) =>
                  mutateOption(() => {
                    opt.sfxVolume = v / 100;
                  })
                }
              />
              <PxToggleRow
                label={ES.options.muted}
                enabled={opt.muted}
                onToggle={() =>
                  mutateOption(() => {
                    opt.muted = !opt.muted;
                  })
                }
              />
            </>
          )}

          {activeTab === 'quality' && (
            <>
              <PxPanel variant="card" padding="none" className="px-3 py-2">
                <div className="text-xs font-semibold text-porcelain mb-1.5">
                  {ES.options.graphicsQuality}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {qualityLevels.map((lvl) => (
                    <PxButton
                      key={lvl}
                      variant={opt.graphicsQuality === lvl ? 'primary' : 'ghost'}
                      size="sm"
                      className="w-full px-1"
                      onClick={() =>
                        mutateOption(() => {
                          opt.graphicsQuality = lvl;
                        })
                      }
                    >
                      {ES.options.qualityLevels[lvl]}
                    </PxButton>
                  ))}
                </div>
              </PxPanel>
              <PxToggleRow
                label={ES.options.shadows}
                enabled={opt.shadows}
                onToggle={() =>
                  mutateOption(() => {
                    opt.shadows = !opt.shadows;
                  })
                }
              />
              <PxToggleRow
                label={ES.options.ambientParticles}
                enabled={opt.ambientParticles}
                onToggle={() =>
                  mutateOption(() => {
                    opt.ambientParticles = !opt.ambientParticles;
                  })
                }
              />
              <PxToggleRow
                label={ES.options.pixelEffect}
                enabled={opt.pixelEffect}
                onToggle={() =>
                  mutateOption(() => {
                    opt.pixelEffect = !opt.pixelEffect;
                  })
                }
              />
              <PxToggleRow
                label={ES.options.batterySaver}
                enabled={opt.batterySaver}
                onToggle={() =>
                  mutateOption(() => {
                    opt.batterySaver = !opt.batterySaver;
                  })
                }
              />
            </>
          )}

          {activeTab === 'postfx' && (
            <>
              <PxToggleRow
                label={ES.options.bloom}
                enabled={opt.bloom}
                onToggle={() =>
                  mutateOption(() => {
                    opt.bloom = !opt.bloom;
                  })
                }
              />
              <PxSlider
                label={ES.options.bloomIntensity}
                min={40}
                max={160}
                value={Math.round(opt.bloomIntensity * 100)}
                displayValue={`${Math.round(opt.bloomIntensity * 100)}%`}
                disabled={!opt.bloom}
                onChange={(v) =>
                  mutateOption(() => {
                    opt.bloomIntensity = v / 100;
                  })
                }
              />
              <PxToggleRow
                label={ES.options.tiltShift}
                enabled={opt.tiltShift}
                onToggle={() =>
                  mutateOption(() => {
                    opt.tiltShift = !opt.tiltShift;
                  })
                }
              />
              {tiltBlocked && (
                <PxNotice tone="warning" className="text-[11px] font-normal">
                  {ES.options.tiltShiftHint}
                </PxNotice>
              )}
              <PxToggleRow
                label={ES.options.colorGrading}
                enabled={opt.colorGrading}
                onToggle={() =>
                  mutateOption(() => {
                    opt.colorGrading = !opt.colorGrading;
                  })
                }
              />
              <PxToggleRow
                label={ES.options.vignette}
                enabled={opt.vignette}
                onToggle={() =>
                  mutateOption(() => {
                    opt.vignette = !opt.vignette;
                  })
                }
              />
            </>
          )}

          {activeTab === 'game' && (
            <>
              <PxButton
                variant="secondary"
                fullWidth
                align="between"
                onClick={() =>
                  mutateOption(() => {
                    opt.textSpeed = opt.textSpeed === 'normal' ? 'fast' : 'normal';
                  })
                }
              >
                <span>{ES.options.textSpeed}</span>
                <span className="font-bold text-resonant-gold">
                  {opt.textSpeed === 'fast' ? ES.options.fast : ES.options.normal}
                </span>
              </PxButton>
              <PxPanel variant="card" padding="none" className="px-3 py-2">
                <div className="text-xs font-semibold text-porcelain mb-1.5">
                  {ES.options.cameraMode}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {cameraModes.map(({ mode, label }) => (
                    <PxButton
                      key={mode}
                      variant={opt.cameraMode === mode ? 'primary' : 'ghost'}
                      size="sm"
                      className="w-full px-2"
                      onClick={() => {
                        if (opt.cameraMode === mode) return;
                        mutateOption(() => {
                          opt.cameraMode = mode;
                        });
                      }}
                    >
                      {label}
                    </PxButton>
                  ))}
                </div>
                <div className="mt-1.5 text-[11px] leading-snug text-bone-gray">
                  {ES.options.cameraModeHint}
                </div>
              </PxPanel>

              <PxPanel variant="card" padding="none" className="px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold tracking-wider text-resonant-gold">CAMERA LAB</div>
                    <div className="text-[10px] text-bone-gray">MODO DESARROLLADOR · SOLO EXTERIOR</div>
                  </div>
                  <PxButton
                    variant={opt.cameraLabEnabled ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() =>
                      mutateOption(() => {
                        opt.cameraLabEnabled = !opt.cameraLabEnabled;
                      })
                    }
                  >
                    {opt.cameraLabEnabled ? 'ACTIVO' : 'INACTIVO'}
                  </PxButton>
                </div>
                {opt.cameraLabEnabled && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-porcelain">PERFIL ACTIVO</span>
                      <span className="text-xs font-extrabold text-resonant-gold">PROFILE {opt.cameraLabActiveProfile}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['A', 'B', 'C'] as CameraLabProfileId[]).map((profileId) => (
                        <PxButton
                          key={profileId}
                          variant={opt.cameraLabActiveProfile === profileId ? 'primary' : 'ghost'}
                          size="sm"
                          className="w-full"
                          onClick={() =>
                            mutateOption(() => {
                              opt.cameraLabActiveProfile = profileId;
                              opt.cameraLabConfig = { ...opt.cameraLabProfiles[profileId] };
                            })
                          }
                        >
                          PROFILE {profileId}
                        </PxButton>
                      ))}
                    </div>
                    {([
                      { key: 'fov', label: 'FIELD OF VIEW', min: 35, max: 75, step: 1, suffix: '°' },
                      { key: 'distance', label: 'CAMERA DISTANCE', min: 4, max: 14, step: 0.1, suffix: '' },
                      { key: 'height', label: 'CAMERA HEIGHT', min: 1.5, max: 8, step: 0.1, suffix: '' },
                    ] as const).map(({ key, label, min, max, step, suffix }) => (
                      <div key={key} className="rounded-sm border border-ash-purple bg-smoked-wood/70 px-2.5 py-2">
                        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-bold">
                          <label htmlFor={`camera-lab-${key}`} className="text-porcelain">{label}</label>
                          <span className="tabular-nums text-resonant-gold">
                            {key === 'fov' ? opt.cameraLabConfig.fov.toFixed(0) : opt.cameraLabConfig[key].toFixed(1)}{suffix}
                          </span>
                        </div>
                        <input
                          id={`camera-lab-${key}`}
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={opt.cameraLabConfig[key]}
                          onChange={(event) =>
                            mutateOption(() => {
                              opt.cameraLabConfig = {
                                ...opt.cameraLabConfig,
                                [key]: Number(event.currentTarget.value),
                              };
                            })
                          }
                          className="w-full h-8 accent-resonant-gold touch-pan-x cursor-pointer"
                        />
                      </div>
                    ))}
                    <PxButton
                      variant="secondary"
                      fullWidth
                      size="sm"
                      onClick={() =>
                        mutateOption(() => {
                          opt.cameraLabProfiles[opt.cameraLabActiveProfile] = { ...opt.cameraLabConfig };
                        }, 'CONFIGURACIÓN GUARDADA EN PROFILE ' + opt.cameraLabActiveProfile)
                      }
                    >
                      GUARDAR EN PROFILE {opt.cameraLabActiveProfile}
                    </PxButton>
                    <PxButton
                      variant="ghost"
                      fullWidth
                      size="sm"
                      onClick={() =>
                        mutateOption(() => {
                          opt.cameraLabEnabled = true;
                          opt.cameraLabConfig = { fov: 58, distance: 6.4, height: 2.65 };
                          opt.cameraLabProfiles = {
                            A: { fov: 58, distance: 6.4, height: 2.65 },
                            B: { fov: 50, distance: 9, height: 5 },
                            C: { fov: 45, distance: 11, height: 7 },
                          };
                          opt.cameraLabActiveProfile = 'A';
                        }, 'VALORES ORIGINALES RESTAURADOS')
                      }
                    >
                      RESTAURAR VALORES ORIGINALES
                    </PxButton>
                  </div>
                )}
              </PxPanel>
            </>
          )}
        </div>

        <PxPanelFooter align="between">
          <PxButton
            variant="secondary"
            size="sm"
            className="text-bone-gray"
            onClick={() =>
              mutateOption(() => {
                Object.assign(opt, defaultOptions());
              }, ES.options.resetDone)
            }
          >
            {ES.options.resetDefaults}
          </PxButton>
          <PxButton variant="primary" size="sm" className="font-extrabold" onClick={callbacks.onClose}>
            {ES.options.close}
          </PxButton>
        </PxPanelFooter>
      </PxPanel>
    );
  }

  const counts = getBestiaryCounts(save);
  const cardCounts = getAlbumCounts(save);
  const vesselCount = getTotalVesselCount(save);
  const reserveCount = save.soulReserve?.length ?? 0;

  return (
    <PxPanel
      variant="gold"
      padding="sm"
      ornate
      scrollable
      className="w-[min(92vw,300px)] max-h-[calc(100dvh-1.5rem)]"
    >
      <PxPanelHeader
        title={ES.menu.title}
        ornate
        className="mb-2"
        right={
          <div className="flex items-center gap-2 text-xs tabular-nums">
            <span
              className="inline-flex items-center gap-1 text-ghost-violet font-bold"
              title={ES.cards.soulDustLabel}
            >
              <PxSoulDustIcon className="w-3.5 h-3.5" />
              <span>{getSoulDust(save)}</span>
            </span>
            <span className="text-cold-stone" aria-hidden="true">
              ·
            </span>
            <span className="text-pale-gold font-bold">{save.money} ◈</span>
          </div>
        }
      />

      {save.badges.length > 0 && (
        <div className="text-xs text-neon-mint tabular-nums mb-1">
          {ES.menu.badges}: {save.badges.length}/2
        </div>
      )}
      {save.repelSteps > 0 && (
        <div className="text-xs text-ki-cyan tabular-nums mb-1">
          {ES.menu.repelActive}: {save.repelSteps}
        </div>
      )}
      {slotLabel && (
        <div className="text-[11px] text-bone-gray mb-1">
          {ES.menu.slotLabel}: <span className="text-pale-gold font-bold">{slotLabel}</span>
        </div>
      )}
      {notice && (
        <PxNotice tone="info" className="mb-2">
          {notice}
        </PxNotice>
      )}

      <div className="flex flex-col gap-1.5">
        <PxButton variant="secondary" fullWidth align="start" onClick={callbacks.onParty}>
          {ES.menu.party}
        </PxButton>
        <PxButton variant="secondary" fullWidth align="start" onClick={callbacks.onBag}>
          {ES.menu.bag}
        </PxButton>
        <PxButton
          variant="secondary"
          fullWidth
          align="between"
          onClick={() => callbacks.onVessels?.()}
        >
          <span>{ES.menu.vessels}</span>
          <span className="text-xs text-ki-cyan tabular-nums">
            {vesselCount}C · {reserveCount}A
          </span>
        </PxButton>
        <PxButton
          variant="secondary"
          fullWidth
          align="start"
          onClick={() => {
            if (callbacks.onBestiary) {
              callbacks.onBestiary();
            } else {
              setView('dex');
            }
          }}
        >
          {ES.menu.dex} ({counts.caught}/{counts.total})
        </PxButton>
        <PxButton
          variant="secondary"
          fullWidth
          align="between"
          onClick={() => callbacks.onCards?.()}
        >
          <span>{ES.menu.cards}</span>
          <span className="text-xs text-resonant-gold tabular-nums">
            {cardCounts.collected}/{cardCounts.total}
          </span>
        </PxButton>
        <PxButton
          variant="secondary"
          fullWidth
          align="between"
          onClick={() => callbacks.onQuests?.()}
        >
          <span>{ES.menu.quests}</span>
          <span className="text-xs text-pale-gold tabular-nums">
            {save.completedSideQuests?.length ?? 0}/5
          </span>
        </PxButton>
        {callbacks.onSpriteInspector && (
          <PxButton
            variant="secondary"
            fullWidth
            align="start"
            onClick={callbacks.onSpriteInspector}
          >
            🎬 Sprite Studio / Inspector
          </PxButton>
        )}
        <PxButton
          variant="secondary"
          fullWidth
          align="start"
          onClick={() => {
            const ok = callbacks.onSave();
            setNotice(ok ? ES.menu.savedOk : ES.menu.saveFailed);
          }}
        >
          {ES.menu.save}
        </PxButton>
        <PxButton
          variant="secondary"
          fullWidth
          align="start"
          onClick={() => {
            setNotice('');
            setView('options');
          }}
        >
          {ES.menu.options}
        </PxButton>
        <PxButton variant="danger" fullWidth align="start" onClick={callbacks.onClose}>
          {ES.menu.close}
        </PxButton>
      </div>
    </PxPanel>
  );
};

export default PauseMenuView;
