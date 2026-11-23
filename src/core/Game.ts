import { Synth } from '../audio/Synth.ts';
import { CameraRig } from '../engine/CameraRig.ts';
import { PixelRenderer } from '../engine/Renderer.ts';
import { ProceduralAssetProvider, type AssetProvider } from '../gfx/AssetProvider.ts';
import { SaveManager, type SaveSlotId } from '../save/SaveManager.ts';
import { AchievementsScreen } from '../ui/AchievementsScreen.ts';
import { ArGachaModal } from '../ui/ArGachaModal.ts';
import { BagScreen } from '../ui/BagScreen.ts';
import { BattleHud } from '../ui/BattleHud.ts';
import { BattleTransition } from '../ui/BattleTransition.ts';
import { BestiaryScreen } from '../ui/BestiaryScreen.ts';
import { CardAlbumScreen } from '../ui/CardAlbumScreen.ts';
import { ChestScreen } from '../ui/ChestScreen.ts';
import { DialogBox } from '../ui/DialogBox.ts';
import { EndingModal } from '../ui/EndingModal.ts';
import { PauseMenu } from '../ui/Menu.ts';
import { PartyScreen } from '../ui/PartyScreen.ts';
import { QuestJournalModal } from '../ui/QuestJournalModal.ts';
import { SkillAcademyScreen } from '../ui/SkillAcademyScreen.ts';
import { StorageScreen } from '../ui/StorageScreen.ts';
import { SummaryScreen } from '../ui/SummaryScreen.ts';
import { SpriteInspectorModal } from '../ui/SpriteInspectorModal.ts';
import { TouchControls } from '../ui/TouchControls.ts';
import { UiLayerManager } from '../ui/UiLayerManager.ts';
import { VesselScreen } from '../ui/VesselScreen.ts';
import { markBestiaryCaught, markBestiarySeen } from '../domain/Bestiary.ts';
import { ES } from '../i18n/es.ts';
import type {
  BattleBiome,
  CreatureInstance,
  SaveData,
  TrainerDef,
} from '../domain/types.ts';
import { BattleScene } from '../scenes/BattleScene.ts';
import { EvolutionScene } from '../scenes/EvolutionScene.ts';
import { GalleryScene } from '../scenes/GalleryScene.ts';
import { OverworldScene } from '../scenes/OverworldScene.ts';
import { RandomEventScene } from '../scenes/RandomEventScene.ts';
import { ShopScene } from '../scenes/ShopScene.ts';
import { TitleScene } from '../scenes/TitleScene.ts';
import { TutorialScene } from '../scenes/TutorialScene.ts';
import type { RandomEventDef } from '../domain/RandomEvents.ts';
import { EventBus } from './EventBus.ts';
import { Input } from './Input.ts';
import { Loop } from './Loop.ts';
import { createRng, type Rng } from './Rng.ts';
import { SceneStack } from './SceneStack.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export class Game {
  readonly container: HTMLElement;
  readonly renderer: PixelRenderer;
  readonly cameraRig: CameraRig;
  readonly assets: AssetProvider;
  readonly bus: EventBus;
  readonly input: Input;
  readonly synth: Synth;
  readonly saveManager: SaveManager;
  readonly scenes: SceneStack;
  readonly loop: Loop;
  readonly rng: Rng;

  readonly uiLayer: HTMLDivElement;
  readonly uiLayers = new UiLayerManager();
  readonly touchControls: TouchControls;
  readonly dialog: DialogBox;
  readonly menu: PauseMenu;
  readonly summary: SummaryScreen;
  readonly partyScreen: PartyScreen;
  readonly bagScreen: BagScreen;
  readonly bestiaryScreen: BestiaryScreen;
  readonly cardAlbumScreen: CardAlbumScreen;
  readonly storageScreen: StorageScreen;
  readonly battleHud: BattleHud;
  readonly battleTransition: BattleTransition;
  readonly endingModal: EndingModal;
  readonly arGachaModal: ArGachaModal;
  readonly vesselScreen: VesselScreen;
  readonly skillAcademyScreen: SkillAcademyScreen;
  readonly questJournal: QuestJournalModal;
  readonly chestScreen: ChestScreen;
  readonly achievementsScreen: AchievementsScreen;
  readonly spriteInspectorModal: SpriteInspectorModal;

  saveData: SaveData;
  private currentSlot: SaveSlotId | null = null;
  private deferredInstall: BeforeInstallPromptEvent | null = null;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.bus = new EventBus();
    this.input = new Input();
    this.synth = new Synth();
    this.saveManager = new SaveManager();
    this.saveData = this.saveManager.createNew();
    const storedOptions = this.saveManager.loadOptions();
    const existingSave = this.saveManager.loadLatest();
    if (storedOptions) {
      this.saveData.options = { ...storedOptions };
    } else if (existingSave) {
      this.saveData.options = { ...existingSave.data.options };
    }
    this.rng = createRng(Date.now() >>> 0);
    this.assets = new ProceduralAssetProvider();

    this.renderer = new PixelRenderer(container);
    this.cameraRig = new CameraRig(this.renderer.getAspect());
    this.scenes = new SceneStack();

    this.uiLayer = document.createElement('div');
    this.uiLayer.className = 'pointer-events-none fixed inset-0 z-10';
    container.appendChild(this.uiLayer);

    this.touchControls = new TouchControls(this.uiLayer, this.input);
    this.dialog = new DialogBox(this.uiLayer);
    this.summary = new SummaryScreen(this.uiLayer, this.assets);
    this.partyScreen = new PartyScreen(this.uiLayer, this.assets, this.summary);
    this.bagScreen = new BagScreen(this.uiLayer, this.assets);
    this.bestiaryScreen = new BestiaryScreen(this.uiLayer, this.assets);
    this.cardAlbumScreen = new CardAlbumScreen(this.uiLayer, this.assets);
    this.storageScreen = new StorageScreen(this.uiLayer, this.assets, this.summary);
    this.menu = new PauseMenu(this.uiLayer, this.assets);
    this.battleHud = new BattleHud(this.uiLayer);
    this.battleHud.setAssets(this.assets);
    this.battleTransition = new BattleTransition(this.uiLayer);
    this.endingModal = new EndingModal(this.uiLayer, this.assets);
    this.arGachaModal = new ArGachaModal(this.uiLayer, this.assets);
    this.vesselScreen = new VesselScreen(this.uiLayer, this.assets);
    this.skillAcademyScreen = new SkillAcademyScreen(this.uiLayer, this.assets);
    this.questJournal = new QuestJournalModal(this.uiLayer);
    this.chestScreen = new ChestScreen(this.uiLayer, this.assets);
    this.achievementsScreen = new AchievementsScreen(this.uiLayer);
    this.spriteInspectorModal = new SpriteInspectorModal(this.uiLayer);

    this.toastEl = document.createElement('div');
    this.toastEl.className =
      'pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-50 hidden px-panel px-hud-box px-3 py-1.5 text-xs font-bold text-pale-gold';
    this.uiLayer.appendChild(this.toastEl);

    this.uiLayers.register('touchCamera', this.touchControls.cameraTouchEl);
    this.uiLayers.register('touchControls', this.touchControls.root);
    this.uiLayers.register('battleHud', this.battleHud.root);
    this.uiLayers.register('battleFx', this.battleHud.fxOverlay, this.battleTransition.fxRoot);
    this.uiLayers.register('dialog', this.dialog.root);
    this.uiLayers.register('battleTransition', this.battleTransition.transitionRoot);
    this.uiLayers.register(
      'menus',
      this.menu.root,
      this.partyScreen.root,
      this.bagScreen.root,
      this.bestiaryScreen.root,
      this.cardAlbumScreen.root,
      this.storageScreen.root,
      this.summary.root,
      this.endingModal.root,
      this.arGachaModal.root,
      this.vesselScreen.root,
      this.skillAcademyScreen.root,
      this.questJournal.root,
      this.chestScreen.root,
      this.achievementsScreen.root
    );
    this.uiLayers.register('toast', this.toastEl);

    this.input.onFirstGesture(() => {
      this.synth.unlock();
    });

    this.bus.on('audio:sfx', ({ sfx }) => this.synth.playSfx(sfx));
    this.bus.on('audio:music', ({ track }) => this.synth.playMusic(track));
    this.bus.on('game:toast', ({ message }) => this.showToast(message));

    window.addEventListener('beforeinstallprompt', this.handleBeforeInstallPrompt);

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handlePageHide);

    this.loop = new Loop(
      (dt) => {
        this.cameraRig.setAspect(this.renderer.getAspect());
        if (this.toastTimer > 0) {
          this.toastTimer -= dt;
          if (this.toastTimer <= 0) {
            this.toastEl.classList.add('hidden');
          }
        }
        this.scenes.fixedUpdate(dt);
        this.input.endFixedStep();
      },
      (alpha, frameMs) => {
        this.renderer.updateDynamicResolution(frameMs);
        this.scenes.render(alpha);
      }
    );

    this.applyOptions();
    const params = new URLSearchParams(window.location.search);
    if (params.has('gallery')) {
      this.touchControls.setVisible(false);
      this.battleHud.hide();
      this.battleTransition.hide();
      this.scenes.replace(new GalleryScene(this));
    } else if (params.has('testmap')) {
      const testMapId = params.get('testmap') || 'test_riverbank';
      const freshSave = this.saveManager.createNew();
      freshSave.options = { ...this.saveData.options };
      freshSave.mapId = testMapId;
      freshSave.playerX = testMapId === 'test_riverbank' ? 10 : 24;
      freshSave.playerY = testMapId === 'test_riverbank' ? 25 : 26;
      freshSave.playerDir = 'up';
      freshSave.flags.starter_chosen = true;
      freshSave.flags.isekai_intro_seen = true;
      freshSave.flags.villa_guide_intro_done = true;
      this.saveData = freshSave;
      this.applyOptions();
      this.scenes.replace(new OverworldScene(this));
    } else {
      this.startTitle();
      if (params.has('studio')) {
        this.spriteInspectorModal.open(() => {});
      }
    }
    this.loop.start();
  }

  applyOptions(): void {
    const opt = this.saveData.options;
    this.synth.setVolume(opt.volume);
    this.synth.setMusicVolume(opt.musicVolume);
    this.synth.setSfxVolume(opt.sfxVolume);
    this.synth.setMuted(opt.muted);
    this.loop.setBatterySaver(opt.batterySaver);
    this.dialog.setFastMode(opt.textSpeed === 'fast');
    this.cameraRig.setCameraMode(opt.cameraMode);
    this.cameraRig.setCameraLabConfig({
      enabled: opt.cameraLabEnabled,
      fov: opt.cameraLabConfig.fov,
      distance: opt.cameraLabConfig.distance,
      height: opt.cameraLabConfig.height,
    });
    this.touchControls.setCameraMode(opt.cameraMode);
    this.renderer.setPixelEffect(opt.pixelEffect);
    this.renderer.setQualityMode(opt.graphicsQuality);
    this.renderer.setShadowsEnabled(opt.shadows);
    this.renderer.setAmbientParticlesEnabled(opt.ambientParticles);
    this.renderer.setPostFxOptions({
      bloom: opt.bloom,
      bloomIntensity: opt.bloomIntensity,
      tiltShift: opt.tiltShift,
      colorGrading: opt.colorGrading,
      vignette: opt.vignette,
    });
    document.documentElement.classList.toggle('pixel-effect-off', !opt.pixelEffect);
  }

  persistOptions(): void {
    this.saveManager.saveOptions(this.saveData.options);
  }

  saveGame(): boolean {
    const ok = this.saveManager.save(this.saveData);
    if (!ok) {
      const reason = this.saveManager.getLastError();
      this.showToast(
        reason === 'quota' ? ES.app.saveQuotaError : ES.app.saveError
      );
    }
    return ok;
  }

  autosave(): void {
    if (!this.saveData.flags.starter_chosen) return;
    this.saveManager.saveAuto(this.saveData);
  }

  getCurrentSlot(): SaveSlotId | null {
    return this.currentSlot;
  }

  getCurrentSlotLabel(): string {
    if (!this.currentSlot || this.currentSlot === 'auto') return ES.app.autosave;
    return `${ES.app.slot} ${this.currentSlot.slice(-1)}`;
  }

  showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = 2.4;
  }

  canInstallPwa(): boolean {
    return this.deferredInstall !== null;
  }

  isStandalone(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  }

  isIos(): boolean {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  async promptInstall(): Promise<boolean> {
    if (!this.deferredInstall) return false;
    await this.deferredInstall.prompt();
    const choice = await this.deferredInstall.userChoice;
    this.deferredInstall = null;
    return choice.outcome === 'accepted';
  }

  markSpeciesSeen(speciesId: number, level = 0): void {
    const loc = ES.maps[this.saveData.mapId] ?? this.saveData.mapId;
    markBestiarySeen(this.saveData, speciesId, loc, level);
  }

  markSpeciesCaught(
    speciesId: number,
    level = 0,
    incrementCatchCount = true
  ): void {
    const loc = ES.maps[this.saveData.mapId] ?? this.saveData.mapId;
    markBestiaryCaught(this.saveData, speciesId, loc, level, incrementCatchCount);
  }

  startTitle(): void {
    this.touchControls.setVisible(false);
    this.battleHud.hide();
    this.battleTransition.hide();
    this.scenes.replace(new TitleScene(this));
  }

  startNewGame(slot: SaveSlotId = 'slot1'): void {
    const target: SaveSlotId = slot === 'auto' ? 'slot1' : slot;
    const prevOptions = { ...this.saveData.options };
    this.saveManager.deleteSlot(target);
    this.saveData = this.saveManager.createNew();
    this.saveData.options = prevOptions;
    this.currentSlot = target;
    this.saveManager.setActiveSlot(target);
    this.applyOptions();
    this.scenes.replace(new TutorialScene(this));
  }

  continueGame(slot?: SaveSlotId): void {
    const loaded = slot
      ? (() => {
          const data = this.saveManager.loadSlot(slot);
          return data ? { id: slot, data } : null;
        })()
      : this.saveManager.loadLatest();
    if (loaded) {
      this.currentSlot = loaded.id;
      this.saveData = loaded.data;
      const storedOptions = this.saveManager.loadOptions();
      if (storedOptions) this.saveData.options = { ...storedOptions };
      this.saveManager.setActiveSlot(loaded.id);
    } else {
      this.currentSlot = null;
      this.saveData = this.saveManager.createNew();
    }
    if (this.saveManager.wasLastLoadRecovered()) {
      this.showToast(ES.app.saveRecovered);
    }
    this.applyOptions();
    this.scenes.replace(new OverworldScene(this));
  }

  startBattle(params: {
    enemyParty: CreatureInstance[];
    trainer?: TrainerDef;
    biome?: BattleBiome;
    onDone: (outcome: 'win' | 'lose' | 'caught' | 'ran') => void;
  }): void {
    const onDone = params.onDone;
    this.scenes.push(
      new BattleScene(this, {
        ...params,
        onDone: (outcome) => {
          onDone(outcome);
          this.autosave();
        },
      })
    );
  }

  startEvolution(
    partyIndex: number,
    targetSpeciesId: number,
    onDone: (evolved: boolean) => void,
    options?: { replaceTop?: boolean; autoPop?: boolean }
  ): void {
    const scene = new EvolutionScene(
      this,
      partyIndex,
      targetSpeciesId,
      onDone,
      options?.autoPop ?? true
    );
    if (options?.replaceTop) {
      this.scenes.replaceTop(scene);
    } else {
      this.scenes.push(scene);
    }
  }

  openShop(stock: string[], onDone: () => void): void {
    this.scenes.push(new ShopScene(this, stock, onDone));
  }

  startRandomEvent(eventDef: RandomEventDef): void {
    this.scenes.push(new RandomEventScene(this, eventDef));
  }

  private handleBeforeInstallPrompt = (e: Event): void => {
    e.preventDefault();
    this.deferredInstall = e as BeforeInstallPromptEvent;
  };

  private handlePageHide = (): void => {
    this.input.clearAll();
    this.synth.suspend();
    if (this.saveData.flags.starter_chosen) {
      this.saveManager.save(this.saveData);
    }
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.handlePageHide();
    } else {
      this.synth.resumeIfActive();
    }
  };

  dispose(): void {
    window.removeEventListener('beforeinstallprompt', this.handleBeforeInstallPrompt);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.handlePageHide);
    this.loop.dispose();
    this.input.dispose();
    this.synth.dispose();
    this.touchControls.dispose();
    this.dialog.dispose();
    this.menu.dispose();
    this.partyScreen.dispose();
    this.bagScreen.dispose();
    this.bestiaryScreen.dispose();
    this.storageScreen.dispose();
    this.summary.dispose();
    this.endingModal.dispose();
    this.battleTransition.dispose();
    this.battleHud.dispose();
    this.arGachaModal.dispose();
    this.vesselScreen.dispose();
    this.skillAcademyScreen.dispose();
    this.questJournal.dispose();
    this.chestScreen.dispose();
    this.achievementsScreen.dispose();
    this.cardAlbumScreen.dispose();
    this.assets.dispose();
    this.renderer.dispose();
    this.uiLayer.remove();
  }
}
