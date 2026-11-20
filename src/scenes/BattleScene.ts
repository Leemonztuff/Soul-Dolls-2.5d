import * as THREE from 'three';
import type { Game } from '../core/Game.ts';
import type { Scene } from '../core/SceneStack.ts';
import { getBodyContainer } from '../data/containers.ts';
import { getMove } from '../data/moves.ts';
import { getSpecies } from '../data/species.ts';
import { BattleEngine } from '../domain/BattleEngine.ts';
import {
  computeImpactIntensity,
  takeMoveImpactDamageEvents,
  type DamageEvent,
} from '../domain/BattleImpactSync.ts';
import {
  BODY_PART_LABELS,
  consumeVessel,
  ensureSaveVesselState,
  pickBestVesselForSpecies,
  rebindCreatureContainer,
} from '../domain/BodyParts.ts';
import {
  addCardToAlbum,
  canDismantleDuplicateCard,
  dismantleDuplicateCard,
  formatCardBonuses,
  getCardDef,
  getSoulDust,
} from '../domain/Cards.ts';
import { getCreatureDisplayName } from '../domain/Creature.ts';
import { checkLevelEvolution } from '../domain/Evolution.ts';
import { replaceCreatureMove } from '../domain/Experience.ts';
import { addCapturedCreature } from '../domain/Storage.ts';
import type {
  BattleAction,
  BattleBiome,
  BattleEvent,
  CharacterRole,
  CreatureInstance,
  TrainerDef,
} from '../domain/types.ts';
import { BattleCamera } from '../engine/BattleCamera.ts';
import { BattlePostFx } from '../engine/BattlePostFx.ts';
import {
  createBattleSpriteMaterial,
  type BattleSpriteMaterialHandle,
} from '../engine/BattleSpriteMat.ts';
import {
  BattleStage,
  ENEMY_STATION_POS,
  PLAYER_STATION_POS,
} from '../engine/BattleStage.ts';
import { createBottomPivotPlaneGeometry } from '../engine/BillboardBatch.ts';
import { computeVfxScaleMetrics } from '../engine/AbilityVfxSystem.ts';
import { DisposableRegistry } from '../engine/Disposables.ts';
import { FxSystem } from '../engine/FxSystem.ts';
import {
  createMeleeStabMaterial,
  loadMeleeStabTexture,
  type MeleeStabMaterialHandle,
} from '../engine/MeleeStabSprite.ts';
import {
  getMoveImpactProfile,
  getMoveVfxStyle,
  type MoveImpactProfile,
} from '../engine/moveVfxProfiles.ts';
import { SoulDollIdleRig } from '../engine/SoulDollIdleRig.ts';
import { TweenRunner } from '../engine/Tween.ts';
import {
  DEFAULT_IDLE_FPS,
  getIdleAnimationSpecForSpecies,
  hasSpeciesAnimationRole,
  SPECIES_ANIMATION_REGISTRY,
  type AnimationSheetSpec,
} from '../data/animations.ts';
import {
  hasWildSoulSprite,
  resolveEnemyBattleSpriteView,
} from '../data/soulForms.ts';
import {
  evaluateMeleeStabPhase,
  getAttackSheetSpecForSpecies,
  mapStabProgressToFrame,
  MELEE_STAB_DURATION,
  MELEE_STAB_TOTAL_DURATION,
  PLACEHOLDER_ATTACK_SHEET_PATH,
} from '../domain/MeleeStabTiming.ts';
import { hexToNumber, PALETTE, TYPE_PALETTES } from '../gfx/Palette.ts';
import { ES } from '../i18n/es.ts';
import type { BattleResultDropSummary } from '../ui/BattleHud.ts';
import { CARD_RARITY_STYLES } from '../ui/cardRarityStyles.ts';

const _camPos = new THREE.Vector3();
const _fromPos = new THREE.Vector3();
const _toPos = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _stabFwd = new THREE.Vector3();
const _stabRight = new THREE.Vector3();
const _stabTipPos = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

function scaleImpactProfile(
  profile: MoveImpactProfile,
  factor: number
): MoveImpactProfile {
  return {
    ...profile,
    shake: profile.shake * factor,
    hitStop: profile.hitStop * factor,
    flash: Math.min(0.7, profile.flash * factor),
    distortion: Math.min(0.05, profile.distortion * factor),
    speedLines: Math.min(0.6, profile.speedLines * factor),
    bloom: Math.min(0.75, profile.bloom * factor),
    dim: Math.min(0.26, profile.dim * factor),
  };
}

export class BattleScene implements Scene {
  readonly name = 'battle';
  private scene = new THREE.Scene();
  private disposables = new DisposableRegistry();
  private tweens = new TweenRunner();
  private engine: BattleEngine;
  private biome: BattleBiome;
  private isBoss: boolean;

  private stage: BattleStage;
  private battleCamera: BattleCamera;
  private fx: FxSystem;
  private postFx: BattlePostFx;

  private playerMesh: THREE.Mesh;
  private enemyMesh: THREE.Mesh;
  /** Static formation billboards shown together during boss encounters. */
  private bossAllyMeshes: THREE.Mesh[] = [];
  private meleeStabMesh: THREE.Mesh;
  private trainerMesh: THREE.Mesh | null = null;
  private capsuleMesh: THREE.Mesh;

  private playerMatHandle: BattleSpriteMaterialHandle;
  private enemyMatHandle: BattleSpriteMaterialHandle;
  private meleeStabMatHandle: MeleeStabMaterialHandle;
  private attackTextureCache = new Map<string, THREE.Texture>();
  private playerIdleSpec: AnimationSheetSpec | null = null;
  private enemyIdleSpec: AnimationSheetSpec | null = null;
  private playerIdleElapsed = 0;
  private enemyIdleElapsed = 0;
  private playerIdleFrame = -1;
  private enemyIdleFrame = -1;
  private playerRig: SoulDollIdleRig;
  private enemyRig: SoulDollIdleRig;
  private unsubCreatureLoad: (() => void) | null = null;

  private playerScale = 2.0;
  private enemyScale = 1.6;
  private lastAspect = 0;
  private lastInternalH = 0;
  private playerAnimating = false;
  private enemyAnimating = false;
  private lowHpAlarmTimer = 0;
  private wildFloatTime = 0;
  private exited = false;
  private introDone = false;

  private eventQueue: BattleEvent[] = [];
  private processingEvent = false;
  // The engine resolves a whole turn up front; keep HUD HP staged until each event is presented.
  private displayedHpByUid = new Map<string, number>();
  private displayedActiveUid: Record<'player' | 'enemy', string | null> = {
    player: null,
    enemy: null,
  };
  private pendingBossActions: Array<{ partyIndex: number; action: BattleAction }> = [];
  private pendingEvolutions: Array<{ partyIndex: number; targetSpeciesId: number }> = [];
  private totalXpEarned = 0;
  private droppedCards: BattleResultDropSummary[] = [];
  private onDone: (outcome: 'win' | 'lose' | 'caught' | 'ran') => void;

  private handleStageTap = (): void => {
    if (this.battleCamera.skipIntro()) return;
    if (this.game.dialog.isOpen()) {
      this.game.dialog.advance();
    }
  };

  constructor(
    private readonly game: Game,
    params: {
      enemyParty: CreatureInstance[];
      trainer?: TrainerDef;
      biome?: BattleBiome;
      onDone: (outcome: 'win' | 'lose' | 'caught' | 'ran') => void;
    }
  ) {
    this.onDone = params.onDone;
    this.biome = params.biome ?? 'meadow';
    this.isBoss = Boolean(params.trainer?.isBoss || params.trainer?.isRival);

    this.engine = new BattleEngine(
      game.saveData.party,
      params.enemyParty,
      game.saveData.bag,
      game.rng,
      params.trainer,
      this.biome,
      { activePlayerCount: this.isBoss ? 3 : 1 }
    );

    this.stage = new BattleStage(this.scene, game.assets, this.biome, this.isBoss);
    this.stage.setShadowsEnabled(game.renderer.areShadowsEnabled());
    this.stage.setAmbientParticlesEnabled(game.renderer.areAmbientParticlesEnabled());
    this.battleCamera = new BattleCamera(game.cameraRig.camera);
    this.fx = new FxSystem(this.scene);
    this.fx.setFlashCallback((css, ms) => this.game.battleTransition.flashScreen(css, ms));
    this.postFx = new BattlePostFx(game.renderer.webgl, this.scene, game.cameraRig.camera);
    this.postFx.setBiome(this.biome, this.isBoss);
    this.postFx.setPixelEffect(game.renderer.isPixelEffectEnabled());
    this.postFx.setQualityTier(game.renderer.getQualityTier());
    this.postFx.setPostFxOptions(game.renderer.getPostFxOptions());

    this.lastAspect = game.renderer.getAspect();
    this.lastInternalH = game.renderer.getInternalHeight();
    this.playerScale = this.battleCamera.computeNormalizedSpriteScale(
      PLAYER_STATION_POS,
      0.45
    );
    this.enemyScale = this.battleCamera.computeNormalizedSpriteScale(
      ENEMY_STATION_POS,
      0.285
    );

    const unitGeo = createBottomPivotPlaneGeometry(1, 1, 24, 32);
    // Flip horizontally so raw 3/4 profile sheets (front ↘, back ↖) face each other along the battle diagonal
    const uvAttr = unitGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setX(i, 1 - uvAttr.getX(i));
    }
    uvAttr.needsUpdate = true;
    this.disposables.track(unitGeo);

    const activePlayer = this.engine.getActive('player');
    const activeEnemy = this.engine.getActive('enemy');

    this.playerMatHandle = createBattleSpriteMaterial(
      game.assets.getCreatureTexture(activePlayer.speciesId, 'back')
    );
    this.enemyMatHandle = createBattleSpriteMaterial(
      game.assets.getCreatureTexture(
        activeEnemy.speciesId,
        this.getEnemyBattleView(activeEnemy.speciesId)
      )
    );
    this.disposables.track(this.playerMatHandle.material);
    this.disposables.track(this.enemyMatHandle.material);

    this.playerRig = new SoulDollIdleRig({
      view: 'back',
      flipX: true,
      cycleDuration: 3.5,
      initialPhase: 0.14,
    });
    this.enemyRig = new SoulDollIdleRig({
      view: 'front',
      flipX: true,
      cycleDuration: 3.5,
      initialPhase: 0.58,
    });
    this.syncRigAnchors();
    if (game.assets.onCreatureLoaded) {
      this.unsubCreatureLoad = game.assets.onCreatureLoaded((loadedId) => {
        if (this.exited) return;
        const p = this.engine.getActive('player');
        const e = this.engine.getActive('enemy');
        if (p.speciesId === loadedId) {
          this.applyIdleSheet('player');
        }
        if (e.speciesId === loadedId) {
          this.applyIdleSheet('enemy');
        }
        this.syncRigAnchors();
      });
    }

    this.playerMesh = new THREE.Mesh(unitGeo, this.playerMatHandle.material);
    this.playerMesh.position.set(
      PLAYER_STATION_POS.x,
      this.getGroundedY('player'),
      PLAYER_STATION_POS.z
    );
    this.playerMesh.scale.setScalar(this.playerScale);
    this.playerMesh.visible = false;
    this.playerMesh.renderOrder = 2;

    this.enemyMesh = new THREE.Mesh(unitGeo, this.enemyMatHandle.material);
    this.enemyMesh.position.set(
      ENEMY_STATION_POS.x,
      this.getGroundedY('enemy'),
      ENEMY_STATION_POS.z
    );
    this.enemyMesh.scale.setScalar(this.enemyScale);
    this.enemyMesh.visible = false;
    this.enemyMesh.renderOrder = 2;

    if (this.isBoss) {
      const deployed = this.engine.getActiveParty('player');
      const formationOffsets = [
        { x: -0.9, z: 0.38 },
        { x: 0, z: -0.22 },
        { x: 0.9, z: 0.38 },
      ];
      deployed.forEach((creature, index) => {
        const material = new THREE.MeshBasicMaterial({
          map: game.assets.getCreatureTexture(creature.speciesId, 'back'),
          alphaTest: 0.5,
          side: THREE.DoubleSide,
          transparent: true,
        });
        const mesh = new THREE.Mesh(unitGeo, material);
        const offset = formationOffsets[index] ?? formationOffsets[1];
        mesh.position.set(
          PLAYER_STATION_POS.x + offset.x,
          this.getGroundedY('player'),
          PLAYER_STATION_POS.z + offset.z
        );
        mesh.scale.setScalar(this.playerScale * 0.76);
        mesh.visible = false;
        mesh.renderOrder = 2 + index * 0.01;
        this.bossAllyMeshes.push(mesh);
        this.scene.add(mesh);
        this.disposables.track(material);
      });
    }

    if (params.trainer) {
      const charGeo = createBottomPivotPlaneGeometry(0.67, 1.0);
      const trainerMat = new THREE.MeshBasicMaterial({
        map: game.assets.getCharacterTexture(
          params.trainer.role as CharacterRole,
          'down',
          0,
          params.trainer.id
        ),
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
      this.trainerMesh = new THREE.Mesh(charGeo, trainerMat);
      this.trainerMesh.position.set(
        ENEMY_STATION_POS.x + 3.4,
        ENEMY_STATION_POS.y,
        ENEMY_STATION_POS.z
      );
      this.trainerMesh.scale.setScalar(this.enemyScale * 0.85);
      this.trainerMesh.renderOrder = 2;
      this.scene.add(this.trainerMesh);
      this.disposables.track(charGeo);
      this.disposables.track(trainerMat);
    }

    const capGeo = createBottomPivotPlaneGeometry(0.65, 0.65);
    const capMat = new THREE.MeshBasicMaterial({
      map: game.assets.getItemTexture('capsula'),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    this.capsuleMesh = new THREE.Mesh(capGeo, capMat);
    this.capsuleMesh.position.copy(ENEMY_STATION_POS);
    this.capsuleMesh.visible = false;
    this.capsuleMesh.renderOrder = 4;
    this.disposables.track(capGeo);
    this.disposables.track(capMat);

    const meleeStabGeo = createBottomPivotPlaneGeometry(1, 1);
    const initialSpec = getAttackSheetSpecForSpecies(activePlayer.speciesId);
    const meleeStabTex = loadMeleeStabTexture(initialSpec.path, (loaded) => {
      if (!this.exited) {
        this.meleeStabMatHandle.setTexture(loaded);
      }
    });
    this.attackTextureCache.set(initialSpec.path, meleeStabTex);

    // Preload all registered attack textures plus placeholder so combat animations switch instantly
    const preloadPaths = Array.from(
      new Set([
        ...SPECIES_ANIMATION_REGISTRY.map((entry) => entry.spec.path),
        PLACEHOLDER_ATTACK_SHEET_PATH,
      ])
    );
    for (const sheetPath of preloadPaths) {
      if (!this.attackTextureCache.has(sheetPath)) {
        const tex = loadMeleeStabTexture(sheetPath, (loaded) => {
          this.attackTextureCache.set(sheetPath, loaded);
        });
        this.attackTextureCache.set(sheetPath, tex);
        this.disposables.track(tex);
      }
    }

    this.meleeStabMatHandle = createMeleeStabMaterial(meleeStabTex);
    this.meleeStabMesh = new THREE.Mesh(meleeStabGeo, this.meleeStabMatHandle.material);
    this.meleeStabMesh.visible = false;
    this.meleeStabMesh.renderOrder = 3;
    this.disposables.track(meleeStabGeo);
    this.disposables.track(meleeStabTex);
    this.disposables.track(this.meleeStabMatHandle.material);

    this.scene.add(this.playerMesh, this.enemyMesh, this.meleeStabMesh, this.capsuleMesh);
    this.applyIdleSheet('player');
    this.applyIdleSheet('enemy');
  }

  onEnter(): void {
    this.game.uiLayers.applySceneVisibility({
      overworldHud: false,
      touchControls: false,
      battleHud: true,
      battleFx: true,
      battleTransition: true,
    });
    this.game.touchControls.setVisible(false);
    this.game.renderer.canvas.addEventListener('pointerdown', this.handleStageTap);

    const trainer = this.engine.state.trainer;
    const track = this.isBoss ? 'boss' : trainer ? 'trainer_battle' : 'battle';
    this.game.bus.emit('audio:music', { track });

    this.stage.setShadowScale('player', 1, false);
    this.stage.setShadowScale('enemy', 1, false);
    this.battleCamera.init(this.isBoss, true);

    this.game.battleTransition.playPreBattle(this.game.assets, trainer, () => {
      if (this.exited) return;
      this.battleCamera.init(this.isBoss, true);
      if (trainer) {
        this.runTrainerEntrance(trainer);
      } else {
        this.runWildEntrance();
      }
    });
  }

  private runWildEntrance(): void {
    const enemy = this.engine.getActive('enemy');
    this.game.markSpeciesSeen(enemy.speciesId, enemy.level);

    this.game.bus.emit('audio:sfx', { sfx: 'rustle' });
    const enemyFx = computeVfxScaleMetrics(this.enemyScale).silhouette;
    _toPos.set(
      ENEMY_STATION_POS.x,
      ENEMY_STATION_POS.y + this.enemyScale * 0.45,
      ENEMY_STATION_POS.z
    );
    this.fx.burst(_toPos, {
      count: 20,
      speedMin: 1.2 * enemyFx,
      speedMax: 3.1 * enemyFx,
      lifeMin: 0.35,
      lifeMax: 0.65,
      sizeStart: 0.25 * enemyFx,
      sizeEnd: 0.06 * enemyFx,
      colorHex: hexToNumber(PALETTE.emerald),
      gravity: -3.8 * enemyFx,
      spreadScale: enemyFx,
    });

    this.enemyAnimating = true;
    this.enemyMesh.visible = true;
    this.stage.setShadowScale('enemy', 1, true);
    this.enemyMatHandle.setFlash(0.42);
    this.syncRigAnchors();
    this.enemyRig.resetSprings();
    this.game.synth.playCry(enemy.speciesId);

    this.tweens.start(
      0.42,
      (t) => {
        const ease = 1 - Math.pow(1 - t, 3);
        this.enemyMesh.scale.set(
          this.enemyScale * (0.4 + 0.6 * ease),
          this.enemyScale * (0.4 + 0.6 * ease),
          1
        );
        this.enemyMesh.position.y =
          this.getGroundedY('enemy') + Math.sin(t * Math.PI) * 0.45;
        this.enemyMatHandle.setFlash(Math.max(0, 0.42 * (1 - t * 1.8)));
      },
      () => {
        if (this.exited) return;
        this.enemyAnimating = false;
        this.enemyMesh.position.set(
          ENEMY_STATION_POS.x,
          this.getGroundedY('enemy'),
          ENEMY_STATION_POS.z
        );
        this.enemyMesh.scale.setScalar(this.enemyScale);
        this.enemyMatHandle.setFlash(0);
        this.enemyRig.injectImpulse(0, -0.58, 0.2);
      }
    );

    this.game.dialog.show(ES.battle.wildAppeared(getCreatureDisplayName(enemy)), () => {
      if (this.exited) return;
      this.sendOutCreature('player', () => {
        this.finishIntro();
      });
    });
  }

  private runTrainerEntrance(trainer: TrainerDef): void {
    const tMesh = this.trainerMesh;
    if (tMesh) {
      this.tweens.start(0.45, (t) => {
        const ease = 1 - Math.pow(1 - t, 3);
        tMesh.position.x = ENEMY_STATION_POS.x + (1 - ease) * 3.4;
      });
    }

    this.game.dialog.show(ES.battle.trainerChallenge(trainer.title, trainer.name), () => {
      if (this.exited) return;
      if (tMesh) {
        this.tweens.start(
          0.32,
          (t) => {
            tMesh.position.x = ENEMY_STATION_POS.x + t * 3.6;
          },
          () => {
            if (this.exited) return;
            tMesh.visible = false;
          }
        );
      }

      const enemy = this.engine.getActive('enemy');
      this.game.markSpeciesSeen(enemy.speciesId, enemy.level);
      this.sendOutCreature('enemy', () => {
        if (this.exited) return;
        this.sendOutCreature('player', () => {
          this.finishIntro();
        });
      });
    });
  }

  private finishIntro(): void {
    if (this.exited) return;
    this.introDone = true;
    if (this.isBoss && this.bossAllyMeshes.length > 0) {
      // Render the actual three deployed allies. The legacy player sprite is
      // hidden in boss battles so it cannot duplicate the first ally.
      this.playerMesh.visible = false;
      this.bossAllyMeshes.forEach((mesh) => { mesh.visible = true; });
    }
    this.game.battleHud.show();
    this.refreshHud();
    const entryEvents = this.engine.consumeInitialEntryEvents();
    if (entryEvents.length > 0) {
      this.eventQueue.push(...entryEvents);
      this.pumpEvents();
    } else {
      this.showPlayerCommandMenu();
    }
  }

  private getEnemyBattleView(speciesId: number): 'front' | 'wild' {
    return resolveEnemyBattleSpriteView(speciesId, this.engine.state.isWild);
  }

  private getWildHoverOffsetY(): number {
    if (!this.engine.state.isWild) return 0;
    const enemy = this.engine.getActive('enemy');
    if (!hasWildSoulSprite(enemy.speciesId)) return 0;
    return this.enemyScale * (0.03 + Math.sin(this.wildFloatTime * 2.4) * 0.02);
  }

  private getGroundedY(side: 'player' | 'enemy'): number {
    const stationY = side === 'player' ? PLAYER_STATION_POS.y : ENEMY_STATION_POS.y;
    const scale = side === 'player' ? this.playerScale : this.enemyScale;
    // Compensates 1px PAD_BOTTOM + alpha edge threshold so drawn soles rest firmly on the platform shadow
    return stationY - scale * 0.012;
  }

  private syncRigAnchors(): void {
    const getAnchor = this.game.assets.getCreatureRigAnchor?.bind(this.game.assets);
    if (!getAnchor) return;
    const activePlayer = this.engine.getActive('player');
    const activeEnemy = this.engine.getActive('enemy');
    this.playerRig.setAnchor(getAnchor(activePlayer.speciesId, 'back'));
    this.enemyRig.setAnchor(
      getAnchor(activeEnemy.speciesId, this.getEnemyBattleView(activeEnemy.speciesId))
    );
  }

  private getSheetTexture(path: string): THREE.Texture {
    const cached = this.attackTextureCache.get(path);
    if (cached) return cached;
    const tex = loadMeleeStabTexture(path);
    this.attackTextureCache.set(path, tex);
    this.disposables.track(tex);
    return tex;
  }

  private applyIdleSheet(
    side: 'player' | 'enemy',
    viewOverride?: 'front' | 'back'
  ): void {
    const isPlayer = side === 'player';
    const creature = this.engine.getActive(side);
    const view =
      viewOverride ?? (isPlayer ? 'back' : this.getEnemyBattleView(creature.speciesId));
    const mat = isPlayer ? this.playerMatHandle : this.enemyMatHandle;
    const rig = isPlayer ? this.playerRig : this.enemyRig;
    const spec =
      view === 'wild'
        ? null
        : getIdleAnimationSpecForSpecies(creature.speciesId, view);

    if (isPlayer) {
      this.playerIdleSpec = spec;
      this.playerIdleElapsed = 0;
      this.playerIdleFrame = -1;
    } else {
      this.enemyIdleSpec = spec;
      this.enemyIdleElapsed = 0;
      this.enemyIdleFrame = -1;
    }

    if (spec) {
      mat.setTexture(this.getSheetTexture(spec.path));
      mat.setSheetFrame(0, spec.cols, spec.rows);
      rig.setBreathingEnabled(false);
      return;
    }

    mat.setTexture(this.game.assets.getCreatureTexture(creature.speciesId, view));
    mat.clearFrameRect();
    rig.setBreathingEnabled(true);
  }

  private tickIdleAnimation(side: 'player' | 'enemy', dt: number): void {
    if (dt <= 0) return;
    const isPlayer = side === 'player';
    const spec = isPlayer ? this.playerIdleSpec : this.enemyIdleSpec;
    if (!spec) return;

    const safeTotal = Math.max(1, Math.min(spec.totalFrames, spec.cols * spec.rows));
    if (safeTotal <= 1) return;
    const fps = Math.max(1, spec.fps ?? DEFAULT_IDLE_FPS);
    const cycle = safeTotal / fps;
    const elapsed = ((isPlayer ? this.playerIdleElapsed : this.enemyIdleElapsed) + dt) % cycle;
    const frame = Math.floor(elapsed * fps) % safeTotal;

    if (isPlayer) {
      this.playerIdleElapsed = elapsed;
      if (frame === this.playerIdleFrame) return;
      this.playerIdleFrame = frame;
      this.playerMatHandle.setSheetFrame(frame, spec.cols, spec.rows);
    } else {
      this.enemyIdleElapsed = elapsed;
      if (frame === this.enemyIdleFrame) return;
      this.enemyIdleFrame = frame;
      this.enemyMatHandle.setSheetFrame(frame, spec.cols, spec.rows);
    }
  }

  private sendOutBossAlly(slotIndex: number, creature: CreatureInstance, onDone: () => void): void {
    const mesh = this.bossAllyMeshes[slotIndex];
    if (!mesh) {
      onDone();
      return;
    }
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.map = this.game.assets.getCreatureTexture(creature.speciesId, 'back');
    material.opacity = 1;
    material.transparent = true;
    material.needsUpdate = true;
    const baseScale = this.playerScale * 0.76;
    const homeY = this.getGroundedY('player');
    mesh.position.y = homeY;
    mesh.scale.setScalar(baseScale * 0.35);
    mesh.visible = true;
    this.game.synth.playCry(creature.speciesId);
    this.tweens.start(
      0.38,
      (t) => {
        const ease = 1 - Math.pow(1 - t, 3);
        mesh.scale.setScalar(baseScale * (0.35 + 0.65 * ease));
        mesh.position.y = homeY + Math.sin(t * Math.PI) * 0.24;
        material.opacity = Math.min(1, t * 1.6);
      },
      () => {
        if (this.exited) return;
        mesh.position.y = homeY;
        mesh.scale.setScalar(baseScale);
        material.opacity = 1;
        onDone();
      }
    );
  }

  private sendOutCreature(side: 'player' | 'enemy', onDone: () => void): void {
    const isPlayer = side === 'player';
    const station = isPlayer ? PLAYER_STATION_POS : ENEMY_STATION_POS;
    const baseScale = isPlayer ? this.playerScale : this.enemyScale;
    const mesh = isPlayer ? this.playerMesh : this.enemyMesh;
    const matHandle = isPlayer ? this.playerMatHandle : this.enemyMatHandle;
    const rig = isPlayer ? this.playerRig : this.enemyRig;
    const creature = this.engine.getActive(side);

    matHandle.setDissolve(0);
    matHandle.setOpacity(1);
    matHandle.setFlash(0);
    this.syncRigAnchors();
    this.applyIdleSheet(side);
    rig.resetSprings();

    const startX = isPlayer ? station.x - 2.6 : station.x + 2.6;
    const startY = station.y + 1.35;
    const startZ = isPlayer ? station.z + 1.2 : station.z - 0.8;

    this.game.bus.emit('audio:sfx', { sfx: 'throw' });
    this.capsuleMesh.visible = true;
    this.capsuleMesh.position.set(startX, startY, startZ);
    this.capsuleMesh.rotation.z = 0;

    this.tweens.start(
      0.34,
      (t) => {
        this.capsuleMesh.position.x = THREE.MathUtils.lerp(startX, station.x, t);
        this.capsuleMesh.position.z = THREE.MathUtils.lerp(startZ, station.z, t);
        this.capsuleMesh.position.y =
          THREE.MathUtils.lerp(startY, station.y + 0.25, t) + Math.sin(t * Math.PI) * 1.1;
        this.capsuleMesh.rotation.z = t * Math.PI * 3;
      },
      () => {
        if (this.exited) return;
        this.capsuleMesh.visible = false;
        this.capsuleMesh.rotation.z = 0;

        const fxScale = computeVfxScaleMetrics(baseScale).silhouette;
        _toPos.set(station.x, station.y + baseScale * 0.45, station.z);
        this.fx.burst(_toPos, {
          count: 24,
          speedMin: 1.4 * fxScale,
          speedMax: 3.4 * fxScale,
          lifeMin: 0.25,
          lifeMax: 0.45,
          sizeStart: 0.28 * fxScale,
          sizeEnd: 0.04 * fxScale,
          colorHex: hexToNumber(isPlayer ? PALETTE.kiCyan : PALETTE.resonantGold),
          gravity: -1.5 * fxScale,
          spreadScale: fxScale,
        });

        if (isPlayer) this.playerAnimating = true;
        else this.enemyAnimating = true;

        mesh.position.set(station.x, this.getGroundedY(side), station.z);
        mesh.visible = true;
        this.stage.setShadowScale(side, 1, true);
        matHandle.setFlash(0.55);
        this.game.synth.playCry(creature.speciesId);

        this.tweens.start(
          0.3,
          (t) => {
            const ease = 1 - Math.pow(1 - t, 3);
            mesh.scale.setScalar(baseScale * (0.18 + 0.82 * ease));
            matHandle.setFlash(Math.max(0, 0.55 * (1 - t * 1.8)));
          },
          () => {
            if (this.exited) return;
            if (isPlayer) this.playerAnimating = false;
            else this.enemyAnimating = false;
            mesh.scale.setScalar(baseScale);
            matHandle.setFlash(0);
            rig.injectImpulse(0, -0.62, 0.22);
            onDone();
          }
        );
      }
    );
  }

  private captureDisplayedBattleState(): void {
    for (const side of ['player', 'enemy'] as const) {
      const sideState = this.engine.state[side];
      for (const creature of sideState.party) {
        this.displayedHpByUid.set(creature.uid, creature.currentHp);
      }
      this.displayedActiveUid[side] = this.engine.getActive(side).uid;
    }
  }

  private getDisplayedCreature(side: 'player' | 'enemy'): CreatureInstance {
    const party = this.engine.state[side].party;
    const activeUid = this.displayedActiveUid[side];
    const creature = (activeUid ? party.find((entry) => entry.uid === activeUid) : undefined)
      ?? this.engine.getActive(side);
    const displayedHp = this.displayedHpByUid.get(creature.uid);
    return displayedHp === undefined ? creature : { ...creature, currentHp: displayedHp };
  }

  private applyDisplayedBattleEvent(ev: BattleEvent): void {
    if (ev.type === 'switch_in') {
      this.displayedActiveUid[ev.side] = ev.creature.uid;
      if (!this.displayedHpByUid.has(ev.creature.uid)) {
        this.displayedHpByUid.set(ev.creature.uid, ev.creature.currentHp);
      }
      return;
    }

    if (ev.type === 'damage' || ev.type === 'heal' || ev.type === 'status_tick' || ev.type === 'weather_tick') {
      const uid = this.displayedActiveUid[ev.target];
      if (uid) this.displayedHpByUid.set(uid, ev.hpAfter);
    }
  }

  private refreshHud(): void {
    this.game.battleHud.updateSoulDust(getSoulDust(this.game.saveData));
    const playerParty = this.engine.state.player.party.map((creature) => {
      const hp = this.displayedHpByUid.get(creature.uid);
      return hp === undefined ? creature : { ...creature, currentHp: hp };
    });
    const enemyParty = this.engine.state.enemy.party.map((creature) => {
      const hp = this.displayedHpByUid.get(creature.uid);
      return hp === undefined ? creature : { ...creature, currentHp: hp };
    });
    this.game.battleHud.updateBars(
      this.getDisplayedCreature('player'),
      this.getDisplayedCreature('enemy'),
      this.engine.state.isWild,
      playerParty,
      enemyParty,
      this.engine.getActiveParty('player').map((creature) => {
        const hp = this.displayedHpByUid.get(creature.uid);
        return hp === undefined ? creature : { ...creature, currentHp: hp };
      })
    );
  }

  private showPlayerCommandMenu(): void {
    if (this.engine.state.finished || this.exited) return;
    if (this.isBoss) {
      this.showBossAllyCommandMenu();
      return;
    }
    const active = this.engine.getActive('player');
    if (active.currentHp <= 0) {
      this.promptForcedSwitch();
      return;
    }

    this.game.battleHud.showMainMenu(
      active,
      this.engine.getActive('enemy'),
      this.engine.state.isWild,
      {
        onMove: (moveIndex) => {
          this.submitAction({ type: 'move', moveIndex });
        },
        onBag: () => {
          this.game.battleHud.hideMenu();
          this.game.bagScreen.open(
            this.game.saveData.bag,
            true,
            (itemId) => {
              this.submitAction({
                type: 'item',
                itemId,
                targetPartyIndex: this.engine.state.player.activeIndex,
              });
            },
            () => {
              this.showPlayerCommandMenu();
            },
            getSoulDust(this.game.saveData)
          );
        },
        onParty: () => {
          this.game.battleHud.hideMenu();
          this.game.partyScreen.open(
            this.game.saveData.party,
            {
              kind: 'switch',
              activeIndex: this.engine.state.player.activeIndex,
              allowCancel: true,
              onPick: (partyIndex) => {
                this.submitAction({ type: 'switch', partyIndex });
              },
            },
            () => {
              this.showPlayerCommandMenu();
            }
          );
        },
        onRun: () => {
          this.submitAction({ type: 'run' });
        },
      }
    );
  }

  /**
   * Boss rounds collect one move from each living deployed ally before the
   * engine resolves the complete round. Fainted deployed slots submit a
   * harmless placeholder which the engine skips.
   */
  private showBossAllyCommandMenu(): void {
    if (this.engine.state.finished || this.exited) return;
    const deployedIndices = [...this.engine.getActivePartyIndices('player')];
    if (deployedIndices.length === 0) {
      this.promptForcedSwitch();
      return;
    }
    if (!deployedIndices.some((partyIndex) => this.engine.state.player.party[partyIndex]?.currentHp > 0)) {
      this.promptBossReplacement();
      return;
    }
    if (this.pendingBossActions.length === 0) {
      this.pendingBossActions = [];
    }
    const nextIndex = deployedIndices.find(
      (partyIndex) => !this.pendingBossActions.some((entry) => entry.partyIndex === partyIndex)
    );
    if (nextIndex === undefined) {
      this.game.battleHud.hideMenu();
      this.captureDisplayedBattleState();
      const events = this.engine.stepBossRound(this.pendingBossActions);
      this.pendingBossActions = [];
      this.eventQueue.push(...events);
      this.pumpEvents();
      return;
    }

    const ally = this.engine.state.player.party[nextIndex];
    if (!ally || ally.currentHp <= 0) {
      this.pendingBossActions.push({
        partyIndex: nextIndex,
        action: { type: 'move', moveIndex: 0 },
      });
      this.showBossAllyCommandMenu();
      return;
    }

    this.game.battleHud.showBanner(
      `Turno de ${getCreatureDisplayName(ally)}`,
      `Aliada ${deployedIndices.indexOf(nextIndex) + 1}/${deployedIndices.length}`
    );
    this.game.battleHud.showMainMenu(
      ally,
      this.engine.getActive('enemy'),
      false,
      {
        onMove: (moveIndex) => {
          this.pendingBossActions.push({
            partyIndex: nextIndex,
            action: { type: 'move', moveIndex },
          });
          this.showBossAllyCommandMenu();
        },
        onBag: () => {},
        onParty: () => {},
        onRun: () => {},
      },
      true
    );
  }

  private promptBossReplacement(): void {
    const deployed = [...this.engine.getActivePartyIndices('player')];
    const slotIndex = deployed.findIndex(
      (partyIndex) => this.engine.state.player.party[partyIndex]?.currentHp <= 0
    );
    if (slotIndex < 0) {
      this.promptForcedSwitch();
      return;
    }
    this.game.battleHud.hideMenu();
    this.game.partyScreen.open(
      this.game.saveData.party,
      {
        kind: 'switch',
        activeIndex: deployed[slotIndex],
        allowCancel: false,
        onPick: (partyIndex) => {
          const events = this.engine.replaceDeployedPlayerAlly(slotIndex, partyIndex);
          if (events.length === 0) {
            this.promptBossReplacement();
            return;
          }
          this.eventQueue.push(...events);
          this.pumpEvents();
        },
      },
      () => this.promptBossReplacement()
    );
  }

  private promptForcedSwitch(): void {
    this.game.battleHud.hideMenu();
    this.game.partyScreen.open(
      this.game.saveData.party,
      {
        kind: 'switch',
        activeIndex: this.engine.state.player.activeIndex,
        allowCancel: false,
        onPick: (partyIndex) => {
          const evs = this.engine.forcePlayerSwitch(partyIndex);
          this.eventQueue.push(...evs);
          this.pumpEvents();
        },
      },
      () => {}
    );
  }

  private submitAction(action: BattleAction): void {
    this.game.battleHud.hideMenu();
    this.captureDisplayedBattleState();
    const events = this.engine.stepTurn(action);
    this.eventQueue.push(...events);
    this.pumpEvents();
  }

  private spawnFloatingDamage(
    side: 'player' | 'enemy',
    text: string,
    tone: 'normal' | 'super' | 'resist' | 'crit' | 'heal'
  ): void {
    const station = side === 'player' ? PLAYER_STATION_POS : ENEMY_STATION_POS;
    const scale = side === 'player' ? this.playerScale : this.enemyScale;
    _projVec.set(station.x, station.y + scale * 0.85, station.z);
    _projVec.project(this.game.cameraRig.camera);
    const nx = _projVec.x * 0.5 + 0.5;
    const ny = -_projVec.y * 0.5 + 0.5;
    this.game.battleHud.spawnFloatingNumber(nx, ny, text, tone);
  }

  private hold(seconds: number, done: () => void): void {
    this.tweens.start(seconds, () => {}, done);
  }

  private resolveDamageEvent(
    ev: DamageEvent,
    fromImpact: boolean,
    onDone: () => void
  ): void {
    if (this.exited) {
      onDone();
      return;
    }

    this.applyDisplayedBattleEvent(ev);
    this.refreshHud();
    if (ev.damagedPart) {
      this.game.battleHud.flashBodyPart(ev.target, ev.damagedPart, {
        amount: ev.amount,
        crit: ev.crit,
        effectiveness: ev.effectiveness,
        broken: Boolean(ev.partBroken),
      });
    }

    const isPlayer = ev.target === 'player';
    const party = this.engine.state[ev.target].party;
    const targetCreature = ev.targetUid
      ? party.find((creature) => creature.uid === ev.targetUid) ?? this.getDisplayedCreature(ev.target)
      : this.getDisplayedCreature(ev.target);
    const deployed = isPlayer && this.isBoss ? this.engine.getActiveParty('player') : [];
    const deployedIndex = isPlayer && this.isBoss
      ? deployed.findIndex((creature) => creature.uid === targetCreature.uid)
      : -1;
    const mesh = deployedIndex >= 0
      ? this.bossAllyMeshes[deployedIndex] ?? this.playerMesh
      : isPlayer ? this.playerMesh : this.enemyMesh;
    const matHandle = deployedIndex >= 0
      ? null
      : isPlayer ? this.playerMatHandle : this.enemyMatHandle;
    const targetRig = deployedIndex >= 0
      ? null
      : isPlayer ? this.playerRig : this.enemyRig;
    const home = mesh
      ? { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
      : isPlayer ? PLAYER_STATION_POS : ENEMY_STATION_POS;
    const sfx = ev.crit
      ? 'crit'
      : ev.effectiveness >= 2
        ? 'super'
        : ev.effectiveness < 1
          ? 'hit_weak'
          : 'hit';
    this.game.bus.emit('audio:sfx', { sfx });

    if (ev.partBroken) {
      this.game.battleHud.showBanner(
        '¡Parte Quebrada!',
        `${getCreatureDisplayName(targetCreature)}: ${BODY_PART_LABELS[ev.partBroken]}`
      );
    }

    const strongHit =
      ev.crit ||
      ev.effectiveness >= 2 ||
      ev.amount >= Math.max(4, Math.round(targetCreature.stats.hp * 0.28));

    if (!fromImpact) {
      if (strongHit) {
        this.battleCamera.triggerHitStop(0.055);
        this.battleCamera.triggerShake(
          ev.effectiveness >= 2 || ev.crit ? 0.24 : 0.14,
          8
        );
      } else {
        this.battleCamera.triggerShake(0.08, 10);
      }

      const targetScale = isPlayer ? this.playerScale : this.enemyScale;
      _projVec.set(home.x, home.y + targetScale * 0.5, home.z);
      _projVec.project(this.game.cameraRig.camera);
      this.postFx.triggerShockwave(
        (_projVec.x + 1) * 0.5,
        (_projVec.y + 1) * 0.5,
        strongHit ? 0.026 : 0.012,
        strongHit ? 0.34 : 0.22
      );

      if (ev.crit) {
        this.battleCamera.playImmediate('crit_punch', 0.36, true);
      }
      if (ev.effectiveness >= 2) {
        this.game.battleTransition.flashScreen('rgba(255, 249, 240, 0.72)', 160);
      }
    }

    const tone = ev.crit
      ? 'crit'
      : ev.effectiveness >= 2
        ? 'super'
        : ev.effectiveness < 1
          ? 'resist'
          : 'normal';
    this.spawnFloatingDamage(ev.target, `-${ev.amount}`, tone);

    if (deployedIndex < 0) {
      if (isPlayer) this.playerAnimating = true;
      else this.enemyAnimating = true;
      matHandle?.setFlash(0.92);
      targetRig?.injectImpulse(
        isPlayer ? -0.45 : 0.45,
        strongHit ? -0.78 : -0.48,
        strongHit ? 0.26 : 0.15
      );
    }

    const targetScale = deployedIndex >= 0 ? this.playerScale * 0.76 : isPlayer ? this.playerScale : this.enemyScale;
    const groundedY = home.y;
    const direction = isPlayer ? -1 : 1;
    const knockback = strongHit ? 0.24 : 0.13;
    const squash = strongHit ? 0.12 : 0.06;

    this.tweens.start(
      0.38,
      (t) => {
        const env = Math.sin(Math.min(1, t * 1.35) * Math.PI);
        const jitter = Math.sin(t * Math.PI * 7) * 0.07 * (1 - t);
        mesh.position.x = home.x + direction * knockback * env + jitter;
        mesh.position.y = groundedY - (strongHit ? 0.035 : 0.018) * env;
        mesh.scale.set(
          targetScale * (1 + squash * 0.6 * env),
          targetScale * (1 - squash * env),
          1
        );
        matHandle?.setFlash(Math.max(0, 0.92 * Math.max(0, 1 - t * 2.2)));
      },
      () => {
        if (this.exited) return;
        if (deployedIndex < 0) {
          if (isPlayer) this.playerAnimating = false;
          else this.enemyAnimating = false;
        }
        mesh.position.set(home.x, groundedY, home.z);
        mesh.scale.setScalar(targetScale);
        matHandle?.setFlash(0);
        onDone();
      }
    );
  }

  private pumpEvents(): void {
    if (this.processingEvent || this.exited) return;
    const ev = this.eventQueue.shift();
    if (!ev) {
      if (!this.engine.state.finished) {
        this.showPlayerCommandMenu();
      }
      return;
    }

    this.processingEvent = true;
    this.applyDisplayedBattleEvent(ev);
    const done = () => {
      if (this.exited) return;
      this.processingEvent = false;
      this.pumpEvents();
    };

    switch (ev.type) {
      case 'text':
        this.game.dialog.show(ev.message, done);
        break;

      case 'move_use': {
        const isPlayer = ev.side === 'player';
        const actorCreature = ev.actorUid
          ? this.engine.state[ev.side].party.find((creature) => creature.uid === ev.actorUid) ?? this.engine.getActive(ev.side)
          : this.engine.getActive(ev.side);
        const deployedPlayer = isPlayer ? this.engine.getActiveParty('player') : [];
        const deployedActorIndex = isPlayer && this.isBoss
          ? deployedPlayer.findIndex((creature) => creature.uid === actorCreature.uid)
          : -1;
        const targetPlayerIndex = !isPlayer && this.isBoss
          ? this.engine.state.player.activeIndex
          : -1;
        const deployedTargetIndex = !isPlayer && this.isBoss
          ? deployedPlayer.findIndex((creature) => this.engine.state.player.party.indexOf(creature) === targetPlayerIndex)
          : -1;
        const mesh = deployedActorIndex >= 0
          ? this.bossAllyMeshes[deployedActorIndex] ?? this.playerMesh
          : isPlayer ? this.playerMesh : this.enemyMesh;
        const targetMesh = deployedTargetIndex >= 0
          ? this.bossAllyMeshes[deployedTargetIndex] ?? this.playerMesh
          : isPlayer ? this.enemyMesh : this.playerMesh;
        const home = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
        const target = {
          x: targetMesh.position.x,
          y: targetMesh.position.y,
          z: targetMesh.position.z,
        };
        const baseScale = deployedActorIndex >= 0
          ? this.playerScale * 0.76
          : isPlayer ? this.playerScale : this.enemyScale;
        const targetScale = deployedTargetIndex >= 0
          ? this.playerScale * 0.76
          : isPlayer ? this.enemyScale : this.playerScale;

        const move = getMove(ev.moveId);
        const usedMoveText = this.eventQueue[0];
        if (
          usedMoveText?.type === 'text' &&
          usedMoveText.message.includes(ev.moveName)
        ) {
          this.eventQueue.shift();
        }
        this.game.battleHud.showBanner(
          ev.moveName,
          ev.actorUid
            ? getCreatureDisplayName(
                this.engine.state[ev.side].party.find((creature) => creature.uid === ev.actorUid) ?? this.engine.getActive(ev.side)
              )
            : getCreatureDisplayName(this.engine.getActive(ev.side))
        );
        const vfxStyle = getMoveVfxStyle(
          move.id,
          move.category,
          move.effect.kind,
          move.effect.target
        );
        const baseImpactProfile = getMoveImpactProfile(
          vfxStyle,
          move.power,
          move.category
        );
        this.battleCamera.enqueueShot(
          isPlayer ? 'attack_player' : 'attack_enemy',
          0.45,
          true
        );
        if (move.category === 'special' || move.power >= 70) {
          this.postFx.pulseArenaDim(move.power >= 90 ? 0.24 : 0.18, 0.52);
        }

        _fromPos.set(home.x, home.y + baseScale * 0.5, home.z);
        _toPos.set(target.x, target.y + targetScale * 0.5, target.z);

        if (isPlayer) this.playerAnimating = true;
        else this.enemyAnimating = true;
        const actorRig = deployedActorIndex >= 0
          ? null
          : isPlayer ? this.playerRig : this.enemyRig;
        const attackerMatHandle = deployedActorIndex >= 0
          ? null
          : isPlayer ? this.playerMatHandle : this.enemyMatHandle;
        const setAttackerOpacity = (opacity: number) => {
          if (attackerMatHandle) {
            attackerMatHandle.setOpacity(opacity);
          } else if (!Array.isArray(mesh.material)) {
            const material = mesh.material as THREE.MeshBasicMaterial;
            material.transparent = opacity < 1;
            material.opacity = opacity;
          }
        };
        const targetSide = isPlayer ? 'enemy' : 'player';

        const groundedY = home.y;
        let animFinished = false;
        let pendingImpactReactions = 0;
        let impactResolved = false;

        const maybeFinishMove = () => {
          if (animFinished && pendingImpactReactions === 0) done();
        };

        const finishMoveAnim = () => {
          if (isPlayer) this.playerAnimating = false;
          else this.enemyAnimating = false;
          this.meleeStabMesh.visible = false;
          mesh.visible = true;
          setAttackerOpacity(1);
          mesh.position.set(home.x, groundedY, home.z);
          mesh.scale.setScalar(baseScale);
          actorRig?.injectImpulse(isPlayer ? -0.24 : 0.24, -0.45, 0.14);
          animFinished = true;
          maybeFinishMove();
        };

        const resolveImpact = () => {
          if (impactResolved) return;
          impactResolved = true;

          const damages =
            move.category === 'status'
              ? []
              : takeMoveImpactDamageEvents(this.eventQueue);
          const hasImpact = move.category === 'status' || damages.length > 0;
          if (!hasImpact) return;

          const intensity = computeImpactIntensity(damages);
          const profile = scaleImpactProfile(baseImpactProfile, intensity);
          const accentHex = hexToNumber(TYPE_PALETTES[move.type].accent);

          _projVec.set(target.x, target.y + targetScale * 0.5, target.z);
          _projVec.project(this.game.cameraRig.camera);
          this.postFx.triggerMoveImpact(
            profile,
            accentHex,
            (_projVec.x + 1) * 0.5,
            (_projVec.y + 1) * 0.5
          );
          if (move.category !== 'status') {
            this.battleCamera.triggerHitStop(profile.hitStop);
            this.battleCamera.triggerShake(profile.shake, profile.shakeDecay);
            const isCrit = damages.some((damage) => damage.crit);
            this.battleCamera.triggerImpactKick(
              0.22 + profile.shake * 1.35,
              0.24,
              isCrit ? 0.028 : 0.012
            );
          }

          if (damages.length > 0) {
            pendingImpactReactions += damages.length;
            damages.forEach((damage, index) => {
              const apply = () => {
                this.resolveDamageEvent(damage, true, () => {
                  pendingImpactReactions = Math.max(0, pendingImpactReactions - 1);
                  maybeFinishMove();
                });
              };
              if (index === 0) apply();
              else this.hold(index * 0.075, apply);
            });
          }
        };

        const fromFx = computeVfxScaleMetrics(baseScale).silhouette;
        const toFx = computeVfxScaleMetrics(targetScale).silhouette;

        if (move.category === 'physical') {
          let impactFired = false;
          let dashDustFired = false;
          actorRig?.injectImpulse(isPlayer ? 0.34 : -0.34, 0.36, 0.14);

          const attackSpec = getAttackSheetSpecForSpecies(actorCreature.speciesId);
          const activeTex = this.attackTextureCache.get(attackSpec.path);
          if (activeTex) {
            this.meleeStabMatHandle.setTexture(activeTex);
          }

          const typePal = TYPE_PALETTES[move.type];
          const elemAccentHex = typePal.accent;
          const elemBaseHex = typePal.base;
          const elemLightHex = typePal.light;
          const elemNum = hexToNumber(elemBaseHex);
          const elemLightNum = hexToNumber(elemLightHex);
          const stabScale = targetScale * 1.18;
          const targetGroundedY = this.getGroundedY(targetSide);

          this.tweens.start(
            MELEE_STAB_TOTAL_DURATION,
            (t) => {
              const elapsed = t * MELEE_STAB_TOTAL_DURATION;
              const st = evaluateMeleeStabPhase(elapsed, attackSpec);

              if (st.phase === 'advance') {
                this.meleeStabMesh.visible = false;
                mesh.visible = true;
                setAttackerOpacity(st.attackerOpacity);

                const dashFrac = 0.36 * st.advanceLungeT;
                mesh.position.x = THREE.MathUtils.lerp(home.x, target.x, dashFrac);
                mesh.position.z = THREE.MathUtils.lerp(home.z, target.z, dashFrac);
                mesh.position.y = groundedY + Math.sin(st.phaseT * Math.PI) * (baseScale * 0.1);
                mesh.scale.set(
                  baseScale * (1 + 0.08 * st.advanceLungeT),
                  baseScale * (1 - 0.05 * st.advanceLungeT),
                  1
                );

                if (!dashDustFired && st.phaseT >= 0.18) {
                  dashDustFired = true;
                  this.fx.burst(_fromPos, {
                    count: 10,
                    speedMin: 1.0 * fromFx,
                    speedMax: 2.5 * fromFx,
                    lifeMin: 0.18,
                    lifeMax: 0.32,
                    sizeStart: 0.22 * fromFx,
                    sizeEnd: 0.04 * fromFx,
                    colorHex: elemLightNum,
                    gravity: 0.2 * fromFx,
                    spreadScale: fromFx,
                  });
                }
              } else if (st.phase === 'stab') {
                mesh.visible = false;
                setAttackerOpacity(0);

                // Position directly to the right side of the opponent from the camera's viewpoint
                _stabFwd.set(
                  target.x - this.game.cameraRig.camera.position.x,
                  0,
                  target.z - this.game.cameraRig.camera.position.z
                );
                if (_stabFwd.lengthSq() < 0.0001) _stabFwd.set(0, 0, -1);
                _stabFwd.normalize();
                _stabRight.crossVectors(_stabFwd, _worldUp).normalize();

                const rightOffset = targetScale * 0.44;
                this.meleeStabMesh.position.set(
                  target.x + _stabRight.x * rightOffset - _stabFwd.x * 0.08,
                  targetGroundedY,
                  target.z + _stabRight.z * rightOffset - _stabFwd.z * 0.08
                );
                const aspect = attackSpec.aspectRatio ?? 1;
                this.meleeStabMesh.scale.set(stabScale * aspect, stabScale, 1);
                this.meleeStabMesh.visible = true;

                // Mirror horizontally only if sheet naturally faces right so standing to the right thrusts left into enemy
                const flipX = attackSpec.facing !== 'left';
                this.meleeStabMatHandle.setFrame(
                  st.frameIndex,
                  flipX,
                  attackSpec.cols,
                  attackSpec.rows
                );
                this.meleeStabMatHandle.setOpacity(st.stabOpacity);
                this.meleeStabMatHandle.setElementEffect(elemAccentHex, st.elementGlow);

                if (st.impactTriggered && !impactFired) {
                  impactFired = true;

                  _stabTipPos.set(
                    this.meleeStabMesh.position.x - _stabRight.x * (stabScale * 0.25),
                    target.y + targetScale * 0.52,
                    this.meleeStabMesh.position.z - _stabRight.z * (stabScale * 0.25)
                  );
                  this.fx.playTypeMove(move.type, _stabTipPos, _toPos, 'physical', {
                    power: move.power,
                    fromGroundY: targetGroundedY,
                    toGroundY: target.y,
                    fromScale: stabScale,
                    toScale: targetScale,
                  });
                  this.fx.burst(_toPos, {
                    count: 24,
                    speedMin: 2.2 * toFx,
                    speedMax: 5.4 * toFx,
                    lifeMin: 0.18,
                    lifeMax: 0.38,
                    sizeStart: 0.32 * toFx,
                    sizeEnd: 0.04 * toFx,
                    colorHex: elemNum,
                    gravity: 0.2 * toFx,
                    spreadScale: toFx,
                  });
                  this.fx.ring(_toPos, {
                    count: 18,
                    radius: 0.18 * toFx,
                    speed: 3.4 * toFx,
                    life: 0.34,
                    sizeStart: 0.26 * toFx,
                    sizeEnd: 0.04 * toFx,
                    colorHex: elemLightNum,
                    vy: 0.4 * toFx,
                  });
                  resolveImpact();
                }
              } else {
                // Return phase: restore attacker at home station and fade cleanly back in
                this.meleeStabMesh.visible = false;
                mesh.visible = true;
                mesh.position.set(home.x, groundedY, home.z);
                mesh.scale.setScalar(baseScale);
                setAttackerOpacity(st.attackerOpacity);
              }
            },
            finishMoveAnim
          );
        } else if (move.category === 'special') {
          if (hasSpeciesAnimationRole(actorCreature.speciesId, 'special_attack')) {
            const specialSpec = getAttackSheetSpecForSpecies(
              actorCreature.speciesId,
              'special_attack'
            );
            const specialTex = this.attackTextureCache.get(specialSpec.path);
            if (specialTex) {
              this.meleeStabMatHandle.setTexture(specialTex);
            }
            const typePal = TYPE_PALETTES[move.type];
            const castScale = baseScale * 1.18;
            const aspect = specialSpec.aspectRatio ?? 1;
            let fxFired = false;
            actorRig?.injectImpulse(0, 0.38, 0.14);

            this.tweens.start(
              MELEE_STAB_DURATION,
              (t) => {
                const frameIndex = mapStabProgressToFrame(t, specialSpec.totalFrames);
                const fadeOpacity =
                  t < 0.08 ? t / 0.08 : t > 0.88 ? Math.max(0, 1 - (t - 0.88) / 0.12) : 1;

                mesh.visible = false;
                setAttackerOpacity(0);
                this.meleeStabMesh.position.set(home.x, groundedY, home.z);
                this.meleeStabMesh.scale.set(castScale * aspect, castScale, 1);
                this.meleeStabMesh.visible = true;
                const specialFlipX = specialSpec.facing === 'left' ? !isPlayer : isPlayer;
                this.meleeStabMatHandle.setFrame(
                  frameIndex,
                  specialFlipX,
                  specialSpec.cols,
                  specialSpec.rows
                );
                this.meleeStabMatHandle.setOpacity(fadeOpacity);
                this.meleeStabMatHandle.setElementEffect(typePal.accent, 0.65);

                if (frameIndex >= specialSpec.impactFrame && !fxFired) {
                  fxFired = true;
                  actorRig?.injectImpulse(0, -0.5, 0.18);
                  this.fx.playTypeMove(move.type, _fromPos, _toPos, 'special', {
                    power: move.power,
                    fromGroundY: home.y,
                    toGroundY: target.y,
                    fromScale: baseScale,
                    toScale: targetScale,
                  });
                  resolveImpact();
                }
              },
              finishMoveAnim
            );
          } else {
            let fxFired = false;
            actorRig?.injectImpulse(0, 0.38, 0.14);
            const bx = (home.x - target.x) * 0.08;
            const bz = (home.z - target.z) * 0.08;
            this.fx.ring(_fromPos, {
              count: 14,
              radius: 0.45 * fromFx,
              speed: -1.1 * fromFx,
              life: 0.26,
              sizeStart: 0.22 * fromFx,
              sizeEnd: 0.04 * fromFx,
              colorHex: hexToNumber(PALETTE.warmWhite),
              vy: 0.2 * fromFx,
            });
            this.tweens.start(
              0.42,
              (t) => {
                const hop = t < 0.35 ? Math.sin((t / 0.35) * Math.PI) : 0;
                mesh.position.x = home.x + bx * hop;
                mesh.position.z = home.z + bz * hop;
                mesh.position.y = groundedY + hop * 0.22;
                if (t >= 0.36 && !fxFired) {
                  fxFired = true;
                  actorRig?.injectImpulse(0, -0.5, 0.18);
                  this.fx.playTypeMove(move.type, _fromPos, _toPos, 'special', {
                    power: move.power,
                    fromGroundY: home.y,
                    toGroundY: target.y,
                    fromScale: baseScale,
                    toScale: targetScale,
                  });
                  resolveImpact();
                }
              },
              finishMoveAnim
            );
          }
        } else {
          actorRig?.injectImpulse(0, 0.28, 0.18);
          this.fx.playTypeMove(move.type, _fromPos, _toPos, 'status', {
            power: move.power,
            fromGroundY: home.y,
            toGroundY: target.y,
            fromScale: baseScale,
            toScale: targetScale,
          });
          resolveImpact();
          this.tweens.start(
            0.36,
            (t) => {
              const s = 1 + Math.sin(t * Math.PI * 2) * 0.06;
              mesh.scale.set(baseScale * s, baseScale * (2 - s), 1);
            },
            finishMoveAnim
          );
        }
        break;
      }

      case 'damage':
        this.resolveDamageEvent(ev, false, done);
        break;

      case 'heal': {
        this.refreshHud();
        this.game.bus.emit('audio:sfx', { sfx: 'heal' });
        const home = ev.target === 'player' ? PLAYER_STATION_POS : ENEMY_STATION_POS;
        const targetScale = ev.target === 'player' ? this.playerScale : this.enemyScale;
        const fxScale = computeVfxScaleMetrics(targetScale).silhouette;
        _toPos.set(home.x, home.y + targetScale * 0.48, home.z);
        this.fx.abilityVfx.playHealOrBuff(_toPos, home.y, true, targetScale);
        this.fx.ring(_toPos, {
          count: 16,
          radius: 0.45 * fxScale,
          speed: 0.7 * fxScale,
          life: 0.48,
          sizeStart: 0.22 * fxScale,
          sizeEnd: 0.04 * fxScale,
          colorHex: hexToNumber(PALETTE.emerald),
          vy: 1.2 * fxScale,
        });
        this.spawnFloatingDamage(ev.target, `+${ev.amount}`, 'heal');
        this.hold(0.28, done);
        break;
      }

      case 'status_apply':
      case 'status_clear':
      case 'stat_change': {
        this.refreshHud();
        const side = ev.target;
        const home = side === 'player' ? PLAYER_STATION_POS : ENEMY_STATION_POS;
        const targetScale = side === 'player' ? this.playerScale : this.enemyScale;
        const fxScale = computeVfxScaleMetrics(targetScale).silhouette;
        _toPos.set(home.x, home.y + targetScale * 0.48, home.z);
        const isPos = ev.type === 'status_clear' || (ev.type === 'stat_change' && ev.delta > 0);
        this.fx.abilityVfx.playHealOrBuff(_toPos, home.y, isPos, targetScale);
        this.fx.ring(_toPos, {
          count: 14,
          radius: 0.4 * fxScale,
          speed: 1.2 * fxScale,
          life: 0.4,
          sizeStart: 0.2 * fxScale,
          sizeEnd: 0.04 * fxScale,
          colorHex: hexToNumber(
            ev.type === 'stat_change' && ev.delta > 0 ? PALETTE.resonantGold : PALETTE.soulViolet
          ),
          vy: 0.8 * fxScale,
        });
        this.hold(0.24, done);
        break;
      }

      case 'ability_triggered':
        this.game.battleHud.showBanner(
          ev.abilityName,
          getCreatureDisplayName(this.engine.getActive(ev.side))
        );
        this.hold(0.35, done);
        break;

      case 'held_item_triggered':
        this.refreshHud();
        this.game.battleHud.showBanner(
          ev.itemName,
          getCreatureDisplayName(this.engine.getActive(ev.side))
        );
        this.hold(0.35, done);
        break;

      case 'flinch':
      case 'miss':
        this.refreshHud();
        this.hold(0.18, done);
        break;

      case 'xp_gain':
        this.totalXpEarned += ev.amount;
        this.refreshHud();
        this.hold(0.15, done);
        break;

      case 'status_tick':
        this.refreshHud();
        this.game.bus.emit('audio:sfx', { sfx: 'hit_weak' });
        if (ev.damage > 0) {
          this.spawnFloatingDamage(ev.target, `-${ev.damage}`, 'resist');
        }
        this.hold(0.22, done);
        break;

      case 'faint': {
        const isPlayer = ev.target === 'player';
        const deployed = isPlayer && this.isBoss ? this.engine.getActiveParty('player') : [];
        const deployedIndex = ev.targetUid
          ? deployed.findIndex((creature) => creature.uid === ev.targetUid)
          : -1;
        const isFormationAlly = deployedIndex >= 0;
        const mesh = isFormationAlly
          ? this.bossAllyMeshes[deployedIndex]
          : isPlayer ? this.playerMesh : this.enemyMesh;
        const home = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
        const baseScale = isFormationAlly
          ? this.playerScale * 0.76
          : isPlayer ? this.playerScale : this.enemyScale;
        const material = isFormationAlly
          ? mesh.material as THREE.MeshBasicMaterial
          : null;
        const matHandle = isFormationAlly
          ? null
          : isPlayer ? this.playerMatHandle : this.enemyMatHandle;

        this.battleCamera.playImmediate('ko_slowmo', 0.72, false);
        this.game.bus.emit('audio:sfx', { sfx: 'faint' });

        if (isPlayer) this.playerAnimating = true;
        else this.enemyAnimating = true;

        this.tweens.start(
          0.55,
          (t) => {
            mesh.position.y = home.y - t * baseScale * 0.35;
            if (matHandle) matHandle.setDissolve(t * 1.05);
            if (material) {
              material.transparent = true;
              material.opacity = Math.max(0, 1 - t);
            }
            if (!isFormationAlly) {
              this.stage.setShadowScale(ev.target, 1 - t * 0.8, t < 0.9);
            }
          },
          () => {
            if (this.exited) return;
            if (isPlayer) this.playerAnimating = false;
            else this.enemyAnimating = false;
            mesh.visible = false;
            mesh.position.set(home.x, home.y, home.z);
            if (matHandle) matHandle.setDissolve(0);
            if (material) material.opacity = 1;
            if (!isFormationAlly) this.stage.setShadowScale(ev.target, 1, false);
            done();
          }
        );
        break;
      }

      case 'switch_out': {
        const isPlayer = ev.side === 'player';
        const mesh = isPlayer ? this.playerMesh : this.enemyMesh;
        const matHandle = isPlayer ? this.playerMatHandle : this.enemyMatHandle;
        const baseScale = isPlayer ? this.playerScale : this.enemyScale;

        if (isPlayer) this.playerAnimating = true;
        else this.enemyAnimating = true;
        matHandle.setFlash(0);

        this.tweens.start(
          0.25,
          (t) => {
            matHandle.setFlash(Math.min(1, t * 2));
            mesh.scale.setScalar(baseScale * Math.max(0.08, 1 - t));
          },
          () => {
            if (this.exited) return;
            if (isPlayer) this.playerAnimating = false;
            else this.enemyAnimating = false;
            mesh.visible = false;
            matHandle.setFlash(0);
            this.stage.setShadowScale(ev.side, 1, false);
            done();
          }
        );
        break;
      }

      case 'switch_in': {
        if (ev.side === 'enemy') {
          this.game.markSpeciesSeen(ev.creature.speciesId, ev.creature.level);
        }
        this.refreshHud();
        if (ev.side === 'player' && this.isBoss) {
          const slotIndex = this.engine.getActivePartyIndices('player').indexOf(ev.partyIndex);
          this.sendOutBossAlly(slotIndex, ev.creature, done);
        } else {
          this.sendOutCreature(ev.side, done);
        }
        break;
      }

      case 'catch_attempt': {
        const startX = PLAYER_STATION_POS.x;
        const startY = PLAYER_STATION_POS.y + 1.0;
        const startZ = PLAYER_STATION_POS.z;

        this.game.bus.emit('audio:sfx', { sfx: 'throw' });
        this.capsuleMesh.visible = true;
        this.capsuleMesh.position.set(startX, startY, startZ);
        this.capsuleMesh.rotation.z = 0;

        this.tweens.start(
          0.36,
          (t) => {
            this.capsuleMesh.position.x = THREE.MathUtils.lerp(
              startX,
              ENEMY_STATION_POS.x,
              t
            );
            this.capsuleMesh.position.z = THREE.MathUtils.lerp(
              startZ,
              ENEMY_STATION_POS.z,
              t
            );
            this.capsuleMesh.position.y =
              THREE.MathUtils.lerp(startY, ENEMY_STATION_POS.y + 0.35, t) +
              Math.sin(t * Math.PI) * 1.4;
            this.capsuleMesh.rotation.z = t * Math.PI * 3;
          },
          () => {
            if (this.exited) return;
            this.enemyMesh.visible = false;
            this.stage.setShadowScale('enemy', 0.5, true);
            this.capsuleMesh.position.set(
              ENEMY_STATION_POS.x,
              ENEMY_STATION_POS.y + 0.25,
              ENEMY_STATION_POS.z
            );
            this.capsuleMesh.rotation.z = 0;

            let lastShakeIdx = -1;
            const totalDur = Math.max(0.45, 0.35 + ev.shakes * 0.45);
            this.tweens.start(
              totalDur,
              (t) => {
                if (ev.shakes > 0) {
                  const shakePhase = t * ev.shakes;
                  const shakeIdx = Math.floor(shakePhase);
                  if (shakeIdx > lastShakeIdx && shakeIdx < ev.shakes) {
                    lastShakeIdx = shakeIdx;
                    this.game.bus.emit('audio:sfx', { sfx: 'menu' });
                    _toPos.set(
                      ENEMY_STATION_POS.x,
                      ENEMY_STATION_POS.y + 0.45,
                      ENEMY_STATION_POS.z
                    );
                    this.fx.burst(_toPos, {
                      count: 8,
                      speedMin: 1.0,
                      speedMax: 2.2,
                      lifeMin: 0.2,
                      lifeMax: 0.35,
                      sizeStart: 0.18,
                      sizeEnd: 0.03,
                      colorHex: hexToNumber(PALETTE.paleGold),
                      gravity: -2.0,
                    });
                  }
                  const local = shakePhase - shakeIdx;
                  this.capsuleMesh.rotation.z =
                    local < 0.65 ? Math.sin((local / 0.65) * Math.PI * 2) * 0.38 : 0;
                }
              },
              () => {
                if (this.exited) return;
                this.capsuleMesh.rotation.z = 0;
                const enemyFx = computeVfxScaleMetrics(this.enemyScale).silhouette;
                _toPos.set(
                  ENEMY_STATION_POS.x,
                  ENEMY_STATION_POS.y + this.enemyScale * 0.45,
                  ENEMY_STATION_POS.z
                );
                if (ev.caught) {
                  this.game.bus.emit('audio:sfx', { sfx: 'capture' });
                  _fromPos.set(
                    PLAYER_STATION_POS.x,
                    PLAYER_STATION_POS.y + 1.0,
                    PLAYER_STATION_POS.z
                  );
                  this.fx.playArcaneBinding(
                    _fromPos,
                    _toPos,
                    ENEMY_STATION_POS.y,
                    this.enemyScale
                  );
                  this.battleCamera.triggerShake(0.16, 12);
                  _projVec.set(_toPos.x, _toPos.y, _toPos.z);
                  _projVec.project(this.game.cameraRig.camera);
                  this.postFx.triggerShockwave(
                    (_projVec.x + 1) * 0.5,
                    (_projVec.y + 1) * 0.5,
                    0.032,
                    0.4
                  );

                  const wild = this.engine.getActive('enemy');
                  ensureSaveVesselState(this.game.saveData);
                  const vesselId = pickBestVesselForSpecies(this.game.saveData, wild.speciesId);
                  this.game.markSpeciesCaught(wild.speciesId, wild.level, true);
                  this.game.saveData.stats.creaturesCaught += 1;

                  let boundVesselName: string | undefined;
                  if (vesselId) {
                    consumeVessel(this.game.saveData, vesselId);
                    rebindCreatureContainer(wild, vesselId);
                    boundVesselName = getBodyContainer(vesselId).name;
                    const dest = addCapturedCreature(
                      this.game.saveData.party,
                      this.game.saveData.storageBoxes,
                      wild
                    );
                    if (dest.destination === 'box' && dest.boxIndex !== undefined) {
                      const boxName =
                        this.game.saveData.storageBoxes[dest.boxIndex]?.name ??
                        `Caja ${dest.boxIndex + 1}`;
                      this.game.showToast(
                        ES.storage.sentToBox(getCreatureDisplayName(wild), boxName)
                      );
                    } else if (dest.destination === 'none') {
                      this.game.showToast(ES.storage.storageFull);
                    } else {
                      this.game.showToast(
                        ES.battle.caughtBound(
                          getCreatureDisplayName(wild),
                          boundVesselName
                        )
                      );
                    }
                  } else {
                    this.game.saveData.soulReserve!.push({
                      uid: wild.uid,
                      speciesId: wild.speciesId,
                      level: wild.level,
                      caughtAt: Date.now(),
                      soulpotId: ev.itemId,
                    });
                    this.game.showToast(
                      ES.battle.caughtSoulOnly(getCreatureDisplayName(wild))
                    );
                  }

                  const spec = getSpecies(wild.speciesId);
                  this.game.battleHud.showArcaneBindingOverlay({
                    speciesId: wild.speciesId,
                    creatureName: getCreatureDisplayName(wild),
                    level: wild.level,
                    creatureType: spec.types[0],
                    vesselName: boundVesselName,
                    durationMs: 2400,
                    onDone: () => {
                      done();
                    },
                  });
                } else {
                  this.fx.burst(_toPos, {
                    count: 18,
                    speedMin: 1.4 * enemyFx,
                    speedMax: 3.0 * enemyFx,
                    lifeMin: 0.25,
                    lifeMax: 0.45,
                    sizeStart: 0.24 * enemyFx,
                    sizeEnd: 0.04 * enemyFx,
                    colorHex: hexToNumber(PALETTE.warmWhite),
                    gravity: -1.5 * enemyFx,
                    spreadScale: enemyFx,
                  });
                  this.capsuleMesh.visible = false;
                  this.enemyMesh.visible = true;
                  this.stage.setShadowScale('enemy', 1, true);
                  done();
                }
              }
            );
          }
        );
        break;
      }

      case 'level_up': {
        this.game.bus.emit('audio:sfx', { sfx: 'levelup' });
        const playerFx = computeVfxScaleMetrics(this.playerScale).silhouette;
        _fromPos.set(
          PLAYER_STATION_POS.x,
          PLAYER_STATION_POS.y + this.playerScale * 0.48,
          PLAYER_STATION_POS.z
        );
        this.fx.ring(_fromPos, {
          count: 20,
          radius: 0.55 * playerFx,
          speed: 1.4 * playerFx,
          life: 0.55,
          sizeStart: 0.26 * playerFx,
          sizeEnd: 0.04 * playerFx,
          colorHex: hexToNumber(PALETTE.kiCyan),
          vy: 1.5 * playerFx,
        });
        this.refreshHud();
        this.hold(0.55, done);
        break;
      }

      case 'learn_move_prompt': {
        const creature = this.game.saveData.party[ev.partyIndex];
        if (!creature) {
          done();
          break;
        }
        const newMoveName = getMove(ev.moveId).name;
        this.game.battleHud.showLearnMovePrompt(creature, ev.moveId, (replaceIndex) => {
          if (replaceIndex !== null) {
            const oldId = replaceCreatureMove(creature, replaceIndex, ev.moveId);
            const oldName = oldId ? getMove(oldId).name : '';
            this.game.dialog.show(
              ES.battle.forgotAndLearned(
                getCreatureDisplayName(creature),
                oldName,
                newMoveName
              ),
              done
            );
          } else {
            this.game.dialog.show(
              ES.battle.didNotLearn(getCreatureDisplayName(creature), newMoveName),
              done
            );
          }
        });
        break;
      }

      case 'evolution_ready':
        if (!this.pendingEvolutions.some((e) => e.partyIndex === ev.partyIndex)) {
          this.pendingEvolutions.push({
            partyIndex: ev.partyIndex,
            targetSpeciesId: ev.targetSpeciesId,
          });
        }
        done();
        break;

      case 'card_drop': {
        const { isNew } = addCardToAlbum(this.game.saveData, ev.speciesId);
        this.droppedCards.push({
          speciesId: ev.speciesId,
          creatureName: ev.creatureName,
          isDuplicate: !isNew,
          dismantled: false,
        });
        const card = getCardDef(ev.speciesId);
        const rarityStyle = CARD_RARITY_STYLES[card.rarity];
        const rarityTag = ES.cards.rarity[card.rarity];
        this.game.bus.emit('audio:sfx', { sfx: 'capture' });
        const enemyFx = computeVfxScaleMetrics(this.enemyScale).silhouette;
        _toPos.set(
          ENEMY_STATION_POS.x,
          ENEMY_STATION_POS.y + this.enemyScale * 0.45,
          ENEMY_STATION_POS.z
        );
        this.fx.burst(_toPos, {
          count: 24,
          speedMin: 1.5 * enemyFx,
          speedMax: 3.8 * enemyFx,
          lifeMin: 0.35,
          lifeMax: 0.7,
          sizeStart: 0.28 * enemyFx,
          sizeEnd: 0.04 * enemyFx,
          colorHex: hexToNumber(rarityStyle.fxColor || PALETTE.resonantGold),
          gravity: -1.8 * enemyFx,
          spreadScale: enemyFx,
        });
        this.game.battleHud.showBanner(
          isNew
            ? `Nueva Carta [${rarityTag}]: ${card.name}`
            : `Carta [${rarityTag}]: ${card.name} (+1 copia)`,
          formatCardBonuses(card.bonuses)
        );
        this.game.showToast(`[${rarityTag}] ${card.name} · ${formatCardBonuses(card.bonuses)}`);
        this.hold(0.45, done);
        break;
      }

      case 'run_success':
      case 'run_fail':
        done();
        break;

      case 'battle_end': {
        this.game.battleTransition.setVignette(false);
        const dropped = this.droppedCards.map((d) => ({ ...d }));
        let victoryApplied = false;

        const applyVictoryRewardsOnce = () => {
          if (victoryApplied || ev.outcome !== 'win') return;
          victoryApplied = true;
          this.game.saveData.money += ev.rewardMoney;
          this.game.saveData.stats.battlesWon += 1;
        };

        const startSoloVictoryShowcase = () => {
          const activePlayer = this.engine.getActive('player');
          this.enemyMesh.visible = false;
          this.meleeStabMesh.visible = false;
          if (this.trainerMesh) this.trainerMesh.visible = false;

          // Showcase player's SoulDoll from front view while camera orbits her alone
          this.playerMesh.visible = true;
          this.playerMatHandle.setOpacity(1);
          this.playerMatHandle.setDissolve(0);
          this.playerMatHandle.setFlash(0);
          this.playerRig.setView('front', true);
          const frontAnchor = this.game.assets.getCreatureRigAnchor?.(
            activePlayer.speciesId,
            'front'
          );
          if (frontAnchor) this.playerRig.setAnchor(frontAnchor);
          this.applyIdleSheet('player', 'front');
          this.playerRig.injectImpulse(0, 0.55, 0.24);

          const pFx = computeVfxScaleMetrics(this.playerScale).silhouette;
          _fromPos.set(
            PLAYER_STATION_POS.x,
            PLAYER_STATION_POS.y + this.playerScale * 0.45,
            PLAYER_STATION_POS.z
          );
          this.fx.ring(_fromPos, {
            count: 24,
            radius: 0.4 * pFx,
            speed: 1.9 * pFx,
            life: 0.65,
            sizeStart: 0.26 * pFx,
            sizeEnd: 0.04 * pFx,
            colorHex: hexToNumber(PALETTE.resonantGold),
            vy: 1.4 * pFx,
          });
          this.fx.burst(_fromPos, {
            count: 20,
            speedMin: 1.2 * pFx,
            speedMax: 3.0 * pFx,
            lifeMin: 0.4,
            lifeMax: 0.75,
            sizeStart: 0.24 * pFx,
            sizeEnd: 0.04 * pFx,
            colorHex: hexToNumber(PALETTE.kiCyan),
            gravity: 0.6 * pFx,
            spreadScale: pFx,
          });

          this.game.battleHud.setVictoryShowcaseMode(true);
          this.battleCamera.playImmediate('victory_orbit', 2.0, false);
          this.game.bus.emit('audio:sfx', { sfx: 'victory_fanfare' });
          this.game.bus.emit('audio:music', { track: 'victory' });
        };

        const proceedToFinish = () => {
          applyVictoryRewardsOnce();
          this.finishBattle(ev.outcome);
        };

        const showResultOverlay = () => {
          const activePlayer = this.engine.getActive('player');
          this.game.battleHud.showBattleResultOverlay(
            {
              xpTotal: this.totalXpEarned,
              soulDust: getSoulDust(this.game.saveData),
              championName: getCreatureDisplayName(activePlayer),
              rewardMoney: ev.rewardMoney,
              droppedCards: dropped,
            },
            openAlbum,
            proceedToFinish,
            handleDismantle
          );
        };

        const handleDismantle = (index: number) => {
          const item = dropped[index];
          if (!item || !item.isDuplicate || item.dismantled) return;
          const res = dismantleDuplicateCard(this.game.saveData, item.speciesId);
          if (res.ok) {
            item.dismantled = true;
            item.dustGained = res.dustGained;
            this.game.battleHud.updateSoulDust(res.soulDust);
            this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
            this.game.saveManager.save(this.game.saveData);
            showResultOverlay();
          } else if (res.reason === 'all_socketed') {
            this.game.showToast(ES.cards.dismantleAllSocketed);
          } else {
            item.isDuplicate = false;
            showResultOverlay();
          }
        };

        const openAlbum = () => {
          this.game.cardAlbumScreen.open(
            this.game.saveData,
            () => {
              for (const item of dropped) {
                if (
                  item.isDuplicate &&
                  !item.dismantled &&
                  !canDismantleDuplicateCard(this.game.saveData, item.speciesId).ok
                ) {
                  item.isDuplicate = false;
                }
              }
              this.game.battleHud.updateSoulDust(getSoulDust(this.game.saveData));
              showResultOverlay();
            },
            () => {
              this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
              this.game.battleHud.updateSoulDust(getSoulDust(this.game.saveData));
              this.game.saveManager.save(this.game.saveData);
            }
          );
        };

        if (ev.outcome === 'win') {
          applyVictoryRewardsOnce();
          startSoloVictoryShowcase();
          showResultOverlay();
        } else {
          proceedToFinish();
        }
        break;
      }
    }
  }

  private finishBattle(outcome: 'win' | 'lose' | 'caught' | 'ran'): void {
    if (this.exited) return;

    if (outcome === 'win' && this.pendingEvolutions.length > 0) {
      const queue = this.pendingEvolutions.splice(0);
      const finishAllEvolutions = () => {
        this.game.scenes.pop();
        this.onDone(outcome);
      };

      const runNextEvolution = () => {
        while (queue.length > 0) {
          const next = queue.shift()!;
          const creature = this.game.saveData.party[next.partyIndex];
          const liveTarget = creature ? checkLevelEvolution(creature) : null;
          if (liveTarget !== null) {
            this.game.startEvolution(
              next.partyIndex,
              liveTarget,
              (evolved) => {
                if (evolved) {
                  this.game.saveManager.save(this.game.saveData);
                }
                runNextEvolution();
              },
              { replaceTop: true, autoPop: false }
            );
            return;
          }
        }
        finishAllEvolutions();
      };

      runNextEvolution();
      return;
    }

    this.game.scenes.pop();
    this.onDone(outcome);
  }

  fixedUpdate(dt: number): void {
    const tier = this.game.renderer.getQualityTier();
    this.stage.setQualityTier(tier);
    this.stage.setShadowsEnabled(this.game.renderer.areShadowsEnabled());
    this.stage.setAmbientParticlesEnabled(this.game.renderer.areAmbientParticlesEnabled());
    this.fx.setQualityTier(tier);
    this.postFx.setQualityTier(tier);

    const curAspect = this.game.renderer.getAspect();
    const curInternalH = this.game.renderer.getInternalHeight();
    if (
      Math.abs(curAspect - this.lastAspect) > 0.02 ||
      curInternalH !== this.lastInternalH
    ) {
      this.lastAspect = curAspect;
      this.lastInternalH = curInternalH;
      this.playerScale = this.battleCamera.computeNormalizedSpriteScale(
        PLAYER_STATION_POS,
        0.45
      );
      this.enemyScale = this.battleCamera.computeNormalizedSpriteScale(
        ENEMY_STATION_POS,
        0.285
      );
      if (this.trainerMesh && this.trainerMesh.visible) {
        this.trainerMesh.scale.setScalar(this.enemyScale * 0.85);
      }
    }

    this.battleCamera.update(dt);
    const cam = this.game.cameraRig.camera;
    _camPos.copy(cam.position);

    const hitStopped = this.battleCamera.isHitStopped();
    const scaledDt = hitStopped ? 0 : dt * this.battleCamera.getTimeScale();
    this.postFx.update(dt);

    if (scaledDt > 0) {
      this.wildFloatTime += scaledDt;
      this.tweens.update(scaledDt);
      if (this.game.renderer.areAmbientParticlesEnabled()) {
        this.fx.emitAmbient(this.biome, scaledDt);
      }
      this.fx.update(scaledDt, _camPos);
      this.stage.update(scaledDt, _camPos);
      if (this.playerMesh.visible) {
        this.playerRig.update(scaledDt);
      }
      if (this.enemyMesh.visible) {
        this.enemyRig.update(scaledDt);
      }
      this.tickIdleAnimation('player', scaledDt);
      this.tickIdleAnimation('enemy', scaledDt);
    }

    // Grounded torso-driven idle breathing (feet strictly anchored at grounded station Y, POSE_ACTUAL = POSE_BASE * BREATH_QUAT)
    if (this.playerMesh.visible) {
      if (!this.playerAnimating) {
        this.playerMesh.position.y = this.getGroundedY('player');
        this.playerMesh.scale.setScalar(this.playerScale);
      }
      this.playerMesh.lookAt(_camPos.x, this.playerMesh.position.y, _camPos.z);
      this.playerRig.applyToMesh(this.playerMesh, this.playerMatHandle);
    }

    if (this.enemyMesh.visible) {
      if (!this.enemyAnimating) {
        this.enemyMesh.position.y = this.getGroundedY('enemy') + this.getWildHoverOffsetY();
        this.enemyMesh.scale.setScalar(this.enemyScale);
      }
      this.enemyMesh.lookAt(_camPos.x, this.enemyMesh.position.y, _camPos.z);
      this.enemyRig.applyToMesh(this.enemyMesh, this.enemyMatHandle);
    }

    for (const mesh of this.bossAllyMeshes) {
      if (!mesh.visible) continue;
      mesh.lookAt(_camPos.x, mesh.position.y, _camPos.z);
    }

    if (this.meleeStabMesh.visible) {
      this.meleeStabMesh.lookAt(_camPos.x, this.meleeStabMesh.position.y, _camPos.z);
    }
    if (this.trainerMesh && this.trainerMesh.visible) {
      this.trainerMesh.lookAt(_camPos.x, this.trainerMesh.position.y, _camPos.z);
    }
    if (this.capsuleMesh.visible) {
      this.capsuleMesh.lookAt(_camPos.x, this.capsuleMesh.position.y, _camPos.z);
    }

    // Low-HP warning vignette & alarm beep
    const activePlayer = this.engine.getActive('player');
    const isLowHp =
      this.introDone &&
      !this.engine.state.finished &&
      activePlayer.currentHp > 0 &&
      activePlayer.currentHp / Math.max(1, activePlayer.stats.hp) <= 0.2;

    if (isLowHp) {
      this.game.battleTransition.setVignette(true);
      this.lowHpAlarmTimer -= dt;
      if (this.lowHpAlarmTimer <= 0) {
        this.lowHpAlarmTimer = 1.65;
        this.game.bus.emit('audio:sfx', { sfx: 'low_hp' });
      }
    } else {
      this.game.battleTransition.setVignette(false);
      this.lowHpAlarmTimer = 0.2;
    }

    this.game.battleHud.update(dt);
    this.game.dialog.update(dt, this.game.input);

    if (this.game.input.justPressed('a')) {
      this.battleCamera.skipIntro();
    }
  }

  render(): void {
    if (this.game.renderer.isContextLost()) return;
    this.postFx.setQualityTier(this.game.renderer.getQualityTier());
    this.postFx.setPixelEffect(this.game.renderer.isPixelEffectEnabled());
    this.postFx.setPostFxOptions(this.game.renderer.getPostFxOptions());
    this.postFx.render();
  }

  onExit(): void {
    this.exited = true;
    this.unsubCreatureLoad?.();
    this.unsubCreatureLoad = null;
    this.game.renderer.canvas.removeEventListener('pointerdown', this.handleStageTap);
    this.tweens.clear();
    this.game.battleTransition.hide();
    this.game.battleHud.hide();
    this.fx.dispose();
    this.postFx.dispose();
    this.stage.dispose();
    this.disposables.disposeAll();
  }
}
