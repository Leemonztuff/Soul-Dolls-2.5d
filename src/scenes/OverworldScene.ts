import * as THREE from 'three';
import type { Game } from '../core/Game.ts';
import { createRng } from '../core/Rng.ts';
import type { Scene } from '../core/SceneStack.ts';
import {
  ALL_CONTAINER_IDS,
  getBodyContainer,
  SHARDS_PER_CONTAINER,
} from '../data/containers.ts';
import { getItem } from '../data/items.ts';
import { DEV_MAPS, getMap, MAPS } from '../data/maps/index.ts';
import { getPropAtlasDef, getPropAtlasKinds } from '../data/propAssets.ts';
import { getMove } from '../data/moves.ts';
import { getSpecies } from '../data/species.ts';
import { getTrainer } from '../data/trainers.ts';
import { getClaimableMilestones, claimBestiaryMilestone } from '../domain/Bestiary.ts';
import {
  addBodyPartShard,
  addVessel,
  ensureSaveVesselState,
} from '../domain/BodyParts.ts';
import { createCreature, getCreatureDisplayName } from '../domain/Creature.ts';
import { checkItemEvolution } from '../domain/Evolution.ts';
import { equipHeldItem } from '../domain/HeldItems.ts';
import { buyHouse, getHouse, ownsHouse } from '../domain/Housing.ts';
import {
  addItem,
  applyMedicineToCreature,
  applyTmToCreature,
  removeItem,
} from '../domain/Inventory.ts';
import { addToParty, healPartyFull } from '../domain/Party.ts';
import { RANDOM_EVENTS } from '../domain/RandomEvents.ts';
import {
  createNpcBehaviorState,
  engageNpcLook,
  hasTrainerLineOfSight,
  stepNpcBehavior,
  type NpcBehaviorState,
} from '../domain/NpcBehavior.ts';
import {
  expandGridWaypoints,
  LAB_GUIDE_NPC_ID,
  LAB_GUIDE_REST_BEFORE_STARTER,
  LAB_GUIDE_SPAWN,
  LAB_TOUR_PEDESTALS_GUIDE_WAYPOINTS,
  LAB_TOUR_PROF_GUIDE_WAYPOINTS,
  LAB_TOUR_PROF_PLAYER_WAYPOINTS,
  VILLA_GUIDE_NPC_ID,
  VILLA_GUIDE_REST_AFTER_STARTER,
  VILLA_GUIDE_REST_BEFORE_STARTER,
  VILLA_TOUR_LAB_GUIDE_WAYPOINTS,
  VILLA_TOUR_LAB_PLAYER_WAYPOINTS,
  VILLA_TOUR_PLAZA_GUIDE_WAYPOINTS,
  VILLA_TOUR_PLAZA_PLAYER_WAYPOINTS,
  type GridStep,
} from '../domain/Tutorial.ts';
import {
  clampQuestIndex,
  evaluateQuestProgress,
  getActiveQuest,
} from '../domain/Quests.ts';
import {
  acceptSideQuest,
  completeSideQuest,
  ensureSaveSideQuestState,
  getSideQuestForNpc,
  getSideQuestStatus,
  SIDE_QUESTS,
} from '../domain/SideQuests.ts';
import { TALLER_SKILL_SHOP_STOCK } from '../domain/SkillForge.ts';
import {
  createStaminaState,
  stepStamina,
  type StaminaState,
} from '../domain/Stamina.ts';
import {
  advanceWorldClock,
  filterEncountersByTime,
  formatWorldClock,
  getTimeLightingProfile,
  getTimePhase,
  getTimePhaseLabel,
  normalizeWorldMinutes,
} from '../domain/TimeOfDay.ts';
import {
  cameraRelativeMove,
  getTileHeightLevel,
  getTileWorldY,
  isInsideBuilding,
  isTileWalkable,
  relativeSpriteDir,
  sampleInterpolatedHeight,
} from '../domain/TerrainRules.ts';
import type {
  CharacterFrame,
  CharacterRole,
  Direction,
  MapDef,
  NpcDef,
  PropKind,
  TimePhase,
  WarpDef,
} from '../domain/types.ts';
import {
  buildEncounterGrassPlacements,
  buildInstancedPropBatches,
  createBottomPivotPlaneGeometry,
  createLitBillboardMaterial,
  updatePropBatchAnimation,
  type PropBatchGroup,
  type PropInstancePlacement,
} from '../engine/BillboardBatch.ts';
import { buildBuildingsMesh, buildInteriorWallsMesh } from '../engine/BuildingMesher.ts';
import {
  buildCliffOrnamentsMesh,
  createCliffOrnamentMaterial,
  createCliffOrnamentTexture,
} from '../engine/CliffOrnamentMesher.ts';
import { DisposableRegistry } from '../engine/Disposables.ts';
import { buildMapGatesGroup } from '../engine/GateMesher.ts';
import { buildStaircaseMeshes } from '../engine/StaircaseMesher.ts';
import { attachTerrainDioramaShader } from '../engine/TerrainWeatheringShader.ts';
import { OverworldAtmosphere } from '../engine/OverworldAtmosphere.ts';
import {
  attachCameraOcclusionCutout,
  getDirectionLeadTarget,
  OCCLUSION_FOCUS_HEIGHT,
  OCCLUSION_TERRAIN_MIN_REL_Y,
  updateCameraOcclusionUniforms,
} from '../engine/OcclusionCutout.ts';
import { OverworldPostFx } from '../engine/OverworldPostFx.ts';
import {
  buildCloudBillboards,
  createGradientSkyTexture,
  updateCloudBillboards,
  type CloudDriftItem,
} from '../engine/SkyBackdrop.ts';
import {
  buildTerrainBorderApron,
  buildTerrainChunks,
  updateTerrainWaterFrame,
  updateVisibleTerrainChunks,
  type TerrainChunk,
} from '../engine/TerrainMesher.ts';
import { WaterSurface } from '../engine/WaterSurface.ts';
import { ES } from '../i18n/es.ts';
import { OverworldHud } from '../ui/OverworldHud.ts';
import type { SkillAcademyTab } from '../ui/SkillAcademyScreen.ts';
import type { WorkshopTab } from '../ui/VesselScreen.ts';

interface RuntimeNpc {
  def: NpcDef;
  mesh: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  depthMat: THREE.MeshDepthMaterial;
  visible: boolean;
  isPedestal: boolean;
  behavior: NpcBehaviorState;
  lastRelDir?: Direction;
  lastWalkFrame?: CharacterFrame;
  markerMesh?: THREE.Mesh;
  markerMat?: THREE.MeshBasicMaterial;
  prevVisualX: number;
  prevVisualY: number;
  prevVisualZ: number;
  currVisualX: number;
  currVisualY: number;
  currVisualZ: number;
}

interface EscortActorMove {
  steps: GridStep[];
  stepIndex: number;
  activeStep: GridStep | null;
  progress: number;
  walkAnimTimer: number;
  finalDir?: Direction;
}

interface VillageEscortCutscene {
  guide: RuntimeNpc;
  guideMove: EscortActorMove | null;
  playerMove: EscortActorMove | null;
  speed: number;
  onDone: () => void;
}

function createQuestMarkerTexture(symbol: '!' | '?'): THREE.CanvasTexture {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const isExcl = symbol === '!';
  const borderColor = '#050505';
  const trimColor = isExcl ? '#E8B84A' : '#5FE3D2';
  const fillColor = isExcl ? '#24123B' : '#123F3C';
  const glyphColor = isExcl ? '#FFD700' : '#D9FBF7';
  const glyphHi = isExcl ? '#FCEDB8' : '#85EADD';

  // Badge frame (diamond-trimmed square badge)
  ctx.fillStyle = borderColor;
  ctx.fillRect(2, 1, 12, 14);
  ctx.fillRect(1, 2, 14, 12);

  ctx.fillStyle = trimColor;
  ctx.fillRect(2, 2, 12, 12);

  ctx.fillStyle = fillColor;
  ctx.fillRect(3, 3, 10, 10);

  if (isExcl) {
    ctx.fillStyle = glyphColor;
    ctx.fillRect(7, 4, 2, 5);
    ctx.fillRect(7, 10, 2, 2);
    ctx.fillStyle = glyphHi;
    ctx.fillRect(7, 4, 1, 4);
  } else {
    ctx.fillStyle = glyphColor;
    ctx.fillRect(6, 4, 4, 2);
    ctx.fillRect(5, 5, 2, 2);
    ctx.fillRect(9, 5, 2, 3);
    ctx.fillRect(7, 7, 2, 2);
    ctx.fillRect(7, 10, 2, 2);
    ctx.fillStyle = glyphHi;
    ctx.fillRect(6, 4, 3, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

interface RuntimePickup {
  id: string;
  x: number;
  y: number;
  itemId: string;
  quantity: number;
  hidden: boolean;
  mesh: THREE.Mesh | null;
}

const STARTER_IDS = [1, 4, 7] as const;

const SOLID_SEED_PROPS: ReadonlySet<PropKind> = new Set([
  'oak',
  'pine',
  'birch',
  'snow_pine',
  'mushroom_tree',
  'mushroom_tree_arcane',
  'boulder',
]);

export class OverworldScene implements Scene {
  readonly name = 'overworld';
  private scene = new THREE.Scene();
  private mapDisposables = new DisposableRegistry();
  private persistentDisposables = new DisposableRegistry();

  private currentMap!: MapDef;
  private chunks: TerrainChunk[] = [];
  private propBatches: PropBatchGroup[] = [];
  private clouds: CloudDriftItem[] = [];
  private npcs: RuntimeNpc[] = [];
  private pickups: RuntimePickup[] = [];
  private blockedTiles = new Set<string>();

  private playerMesh: THREE.Mesh;
  private playerShadow: THREE.Mesh | null = null;
  private playerMat: THREE.MeshLambertMaterial;
  private playerDepthMat: THREE.MeshDepthMaterial;
  private postFx: OverworldPostFx;
  private atmosphere: OverworldAtmosphere | null = null;
  private waterSurface: WaterSurface | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private baseHorizonColorHex = 0x000000;
  private baseHemiIntensity = 2.05;
  private baseSunIntensity = 1.55;
  private lastClockUiMinute = -1;
  private lastAppliedTimePhase: TimePhase | null = null;
  private readonly _fogBaseColor = new THREE.Color();
  private readonly _fogTintColor = new THREE.Color();

  private readonly prevPlayerPos = new THREE.Vector3();
  private readonly currPlayerPos = new THREE.Vector3();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly currCamPos = new THREE.Vector3();
  private readonly prevCamQuat = new THREE.Quaternion();
  private readonly currCamQuat = new THREE.Quaternion();
  private justTeleported = true;
  private readonly _chunkFrustum = new THREE.Frustum();
  private readonly _chunkProjScreen = new THREE.Matrix4();
  private readonly _lastCullCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly _lastCullCamQuat = new THREE.Quaternion(0, 0, 0, 0);
  private _lastCullGridX = -999;
  private _lastCullGridY = -999;
  private _lastCullAspect = -1;

  private charGeo: THREE.PlaneGeometry;
  private markerGeo: THREE.PlaneGeometry;
  private questExclamationTex: THREE.CanvasTexture;
  private questQuestionTex: THREE.CanvasTexture;

  private gridX = 24;
  private gridY = 26;
  private dir: Direction = 'up';
  private moving = false;
  private moveFromX = 24;
  private moveFromY = 26;
  private moveToX = 24;
  private moveToY = 26;
  private moveProgress = 0;
  private walkFrame: CharacterFrame = 0;
  private walkAnimTimer = 0;
  private waterTimer = 0;
  private waterFrame: 0 | 1 = 0;
  private sceneTime = 0;
  private occlusionLeadX = 0;
  private occlusionLeadZ = 0;

  private stamina: StaminaState = createStaminaState();
  private hud: OverworldHud;

  private pendingWarp: {
    targetMap: string;
    targetX: number;
    targetY: number;
    dir: Direction;
  } | null = null;
  private warpPhase: 'idle' | 'out' | 'in' = 'idle';
  private warpTimer = 0;
  private escortCutscene: VillageEscortCutscene | null = null;

  private readonly sampleTerrain = (wx: number, wz: number): number =>
    sampleInterpolatedHeight(this.currentMap, wx, wz);

  constructor(private readonly game: Game) {
    this.charGeo = createBottomPivotPlaneGeometry(0.95, 1.4);
    this.markerGeo = new THREE.PlaneGeometry(0.46, 0.46);
    this.questExclamationTex = createQuestMarkerTexture('!');
    this.questQuestionTex = createQuestMarkerTexture('?');
    this.persistentDisposables.track(this.charGeo);
    this.persistentDisposables.track(this.markerGeo);
    this.persistentDisposables.track(this.questExclamationTex);
    this.persistentDisposables.track(this.questQuestionTex);

    const initPlayerTex = game.assets.getCharacterTexture('player', 'up', 0);
    this.playerMat = createLitBillboardMaterial(initPlayerTex, { emissiveIntensity: 0.54 });
    this.playerDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: initPlayerTex,
      alphaTest: 0.5,
    });
    this.persistentDisposables.track(this.playerMat);
    this.persistentDisposables.track(this.playerDepthMat);

    this.playerMesh = new THREE.Mesh(this.charGeo, this.playerMat);
    this.playerMesh.castShadow = true;
    this.playerMesh.receiveShadow = true;
    this.playerMesh.customDepthMaterial = this.playerDepthMat;
    this.scene.add(this.playerMesh);
    this.postFx = new OverworldPostFx(game.renderer.webgl, this.scene, game.cameraRig.camera);

    this.hud = new OverworldHud({
      onToggleQuest: () => {
        this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      },
      onOpenJournal: () => {
        this.openQuestJournal();
      },
    });
    this.hud.updateStamina(this.stamina);
  }

  onEnter(): void {
    this.hud.mount(this.game.uiLayer, this.game.uiLayers);
    this.game.uiLayers.applySceneVisibility({
      touchCamera: true,
      overworldHud: true,
      touchControls: true,
      battleHud: false,
      battleFx: false,
      battleTransition: false,
    });
    this.game.touchControls.setCameraTouchEnabled(true);
    this.bindTouchCameraHandlers();
    this.game.touchControls.setVisible(true);
    this.game.cameraRig.setPreset('overworld');

    const save = this.game.saveData;
    ensureSaveVesselState(save);
    ensureSaveSideQuestState(save);
    this.loadMap(save.mapId, save.playerX, save.playerY, save.playerDir, false);

    if (
      save.mapId === 'villa_origen' &&
      !save.flags.village_tour_done &&
      !save.flags.starter_chosen
    ) {
      save.flags.isekai_intro_seen = true;
      const guideNpc = this.findNpcById(VILLA_GUIDE_NPC_ID);
      this.game.dialog.show(ES.dialogs.isekai_intro_1, () => {
        if (guideNpc) {
          this.promptVillageGuideTour(guideNpc);
        } else {
          save.flags.village_tour_done = true;
          this.game.dialog.show(ES.dialogs.isekai_intro_2);
        }
      });
    } else if (!save.flags.isekai_intro_seen) {
      save.flags.isekai_intro_seen = true;
      this.game.saveGame();
      this.game.dialog.show(ES.dialogs.isekai_intro_1, () => {
        this.game.dialog.show(ES.dialogs.isekai_intro_2);
      });
    } else if (save.mapId === 'laboratorio_origen') {
      this.maybeStartLabIntroOrEscort();
    }
  }

  private findNpcById(id: string): RuntimeNpc | undefined {
    return this.npcs.find((n) => n.def.id === id && n.visible);
  }

  private createEscortMove(
    steps: GridStep[],
    finalDir?: Direction
  ): EscortActorMove | null {
    if (steps.length === 0) return null;
    return {
      steps,
      stepIndex: 0,
      activeStep: null,
      progress: 0,
      walkAnimTimer: 0,
      finalDir,
    };
  }

  private promptVillageGuideTour(guideNpc: RuntimeNpc): void {
    this.game.dialog.show(ES.dialogs.guide_welcome, undefined, [
      {
        label: '¡Sí, guíame!',
        onSelect: () => this.startVillageEscortTour(guideNpc),
      },
      {
        label: 'Iré por mi cuenta',
        onSelect: () => {
          this.game.saveData.flags.village_tour_done = true;
          this.game.saveGame();
          const steps = expandGridWaypoints(
            guideNpc.behavior.gridX,
            guideNpc.behavior.gridY,
            [VILLA_GUIDE_REST_BEFORE_STARTER]
          );
          this.escortCutscene = {
            guide: guideNpc,
            guideMove: this.createEscortMove(steps, VILLA_GUIDE_REST_BEFORE_STARTER.dir),
            playerMove: null,
            speed: 3.6,
            onDone: () => {
              this.game.dialog.show(ES.dialogs.guide_skip_tour);
            },
          };
        },
      },
    ]);
  }

  private startVillageEscortTour(guideNpc: RuntimeNpc): void {
    const plazaGuideSteps = expandGridWaypoints(
      guideNpc.behavior.gridX,
      guideNpc.behavior.gridY,
      VILLA_TOUR_PLAZA_GUIDE_WAYPOINTS
    );
    const plazaPlayerSteps = expandGridWaypoints(
      this.gridX,
      this.gridY,
      VILLA_TOUR_PLAZA_PLAYER_WAYPOINTS
    );

    this.escortCutscene = {
      guide: guideNpc,
      guideMove: this.createEscortMove(plazaGuideSteps, 'right'),
      playerMove: this.createEscortMove(plazaPlayerSteps, 'left'),
      speed: 3.3,
      onDone: () => {
        this.game.dialog.show(ES.dialogs.guide_tour_plaza, () => {
          const labGuideSteps = expandGridWaypoints(
            guideNpc.behavior.gridX,
            guideNpc.behavior.gridY,
            VILLA_TOUR_LAB_GUIDE_WAYPOINTS
          );
          const labPlayerSteps = expandGridWaypoints(
            this.gridX,
            this.gridY,
            VILLA_TOUR_LAB_PLAYER_WAYPOINTS
          );
          this.escortCutscene = {
            guide: guideNpc,
            guideMove: this.createEscortMove(labGuideSteps, 'left'),
            playerMove: this.createEscortMove(labPlayerSteps, 'up'),
            speed: 3.4,
            onDone: () => {
              this.game.dialog.show(ES.dialogs.guide_tour_professor, () => {
                this.game.saveData.flags.village_tour_done = true;
                this.game.saveData.flags.lab_tour_pending = true;
                this.game.saveGame();
                this.startWarpTransition({
                  x: 19,
                  y: 18,
                  targetMap: 'laboratorio_origen',
                  targetX: 8,
                  targetY: 10,
                  dir: 'up',
                  doorStyle: 'building',
                });
              });
            },
          };
        });
      },
    };
  }

  private maybeStartLabIntroOrEscort(): void {
    if (this.currentMap.id !== 'laboratorio_origen') return;
    const save = this.game.saveData;
    if (save.flags.starter_chosen) return;

    const labGuide = this.findNpcById(LAB_GUIDE_NPC_ID);
    if (save.flags.lab_tour_pending && labGuide) {
      save.flags.lab_tour_pending = false;
      this.startLabEscortTour(labGuide);
      return;
    }

    if (!save.flags.prof_intro_talked) {
      save.flags.prof_intro_talked = true;
      this.game.saveGame();
      const profNpc = this.findNpcById('prof_robledo');
      if (profNpc) {
        engageNpcLook(profNpc.behavior, this.gridX, this.gridY, true);
        this.syncBillboardYaw(0);
      }
      this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
      this.game.dialog.show(ES.dialogs.prof_welcome);
    }
  }

  private startLabEscortTour(labGuide: RuntimeNpc): void {
    const profGuideSteps = expandGridWaypoints(
      labGuide.behavior.gridX,
      labGuide.behavior.gridY,
      LAB_TOUR_PROF_GUIDE_WAYPOINTS
    );
    const profPlayerSteps = expandGridWaypoints(
      this.gridX,
      this.gridY,
      LAB_TOUR_PROF_PLAYER_WAYPOINTS
    );

    this.escortCutscene = {
      guide: labGuide,
      guideMove: this.createEscortMove(profGuideSteps, 'up'),
      playerMove: this.createEscortMove(profPlayerSteps, 'up'),
      speed: 3.4,
      onDone: () => {
        const profNpc = this.findNpcById('prof_robledo');
        if (profNpc) {
          engageNpcLook(profNpc.behavior, this.gridX, this.gridY, true);
          this.syncBillboardYaw(0);
        }
        this.game.saveData.flags.prof_intro_talked = true;
        this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
        this.game.dialog.show(ES.dialogs.prof_welcome, () => {
          const pedSteps = expandGridWaypoints(
            labGuide.behavior.gridX,
            labGuide.behavior.gridY,
            LAB_TOUR_PEDESTALS_GUIDE_WAYPOINTS
          );
          this.escortCutscene = {
            guide: labGuide,
            guideMove: this.createEscortMove(pedSteps, LAB_GUIDE_REST_BEFORE_STARTER.dir),
            playerMove: null,
            speed: 3.6,
            onDone: () => {
              this.game.saveGame();
              this.game.dialog.show(ES.dialogs.guide_choose_starter);
            },
          };
        });
      },
    };
  }

  private stepEscortCutscene(dt: number): void {
    const cutscene = this.escortCutscene;
    if (!cutscene) return;

    const { guide, speed } = cutscene;

    if (cutscene.guideMove) {
      const gm = cutscene.guideMove;
      const b = guide.behavior;
      if (!gm.activeStep) {
        if (gm.stepIndex < gm.steps.length) {
          const next = gm.steps[gm.stepIndex++];
          gm.activeStep = next;
          gm.progress = 0;
          b.dir = next.dir;
          b.moving = true;
          b.moveFromX = b.gridX;
          b.moveFromY = b.gridY;
          b.moveToX = next.x;
          b.moveToY = next.y;
          b.moveProgress = 0;
        }
      }

      if (gm.activeStep) {
        gm.progress += dt * speed;
        gm.walkAnimTimer += dt * speed;
        if (gm.walkAnimTimer >= 0.25) {
          gm.walkAnimTimer -= 0.25;
          b.walkFrame = ((b.walkFrame + 1) % 4) as CharacterFrame;
        }
        b.moveProgress = Math.min(1, gm.progress);
        if (gm.progress >= 1) {
          b.moving = false;
          b.moveProgress = 0;
          b.walkFrame = 0;
          b.gridX = gm.activeStep.x;
          b.gridY = gm.activeStep.y;
          b.moveFromX = b.gridX;
          b.moveFromY = b.gridY;
          b.moveToX = b.gridX;
          b.moveToY = b.gridY;
          gm.activeStep = null;
          if (gm.stepIndex >= gm.steps.length) {
            if (gm.finalDir) b.dir = gm.finalDir;
            cutscene.guideMove = null;
          }
        }
      }
    }

    if (cutscene.playerMove) {
      const pm = cutscene.playerMove;
      if (!pm.activeStep) {
        if (pm.stepIndex < pm.steps.length) {
          const next = pm.steps[pm.stepIndex++];
          pm.activeStep = next;
          pm.progress = 0;
          this.dir = next.dir;
          this.game.saveData.playerDir = next.dir;
          this.moving = true;
          this.moveFromX = this.gridX;
          this.moveFromY = this.gridY;
          this.moveToX = next.x;
          this.moveToY = next.y;
          this.moveProgress = 0;
        }
      }

      if (pm.activeStep) {
        pm.progress += dt * speed;
        pm.walkAnimTimer += dt * speed;
        if (pm.walkAnimTimer >= 0.25) {
          pm.walkAnimTimer -= 0.25;
          this.walkFrame = ((this.walkFrame + 1) % 4) as CharacterFrame;
        }
        this.moveProgress = Math.min(1, pm.progress);
        if (pm.progress >= 1) {
          this.moving = false;
          this.moveProgress = 0;
          this.walkFrame = 0;
          this.gridX = pm.activeStep.x;
          this.gridY = pm.activeStep.y;
          this.game.saveData.playerX = this.gridX;
          this.game.saveData.playerY = this.gridY;
          this.game.saveData.stats.steps += 1;
          this.updateChunkFrustumCulling(true);
          this.checkQuestCoordinates();
          pm.activeStep = null;
          if (pm.stepIndex >= pm.steps.length) {
            if (pm.finalDir) {
              this.dir = pm.finalDir;
              this.game.saveData.playerDir = pm.finalDir;
            }
            cutscene.playerMove = null;
          }
        }
      }
    }

    this.syncPlayerVisual();
    this.syncBillboardYaw(dt);
    this.game.cameraRig.follow(
      this.playerMesh.position.x,
      this.playerMesh.position.y,
      this.playerMesh.position.z,
      dt,
      this.sampleTerrain
    );

    if (!cutscene.guideMove && !cutscene.playerMove) {
      const done = cutscene.onDone;
      this.escortCutscene = null;
      done();
    }
  }

  onResume(): void {
    this.game.uiLayers.applySceneVisibility({
      touchCamera: true,
      overworldHud: true,
      touchControls: true,
      battleHud: false,
      battleFx: false,
      battleTransition: false,
    });
    this.game.touchControls.setCameraTouchEnabled(true);
    this.bindTouchCameraHandlers();
    this.game.touchControls.setVisible(true);
    this.game.cameraRig.setPreset('overworld');
    this.game.cameraRig.snapTo(
      this.playerMesh.position.x,
      this.playerMesh.position.y,
      this.playerMesh.position.z,
      this.sampleTerrain
    );
    const resumeLead = getDirectionLeadTarget(this.dir, false);
    this.occlusionLeadX = resumeLead.x;
    this.occlusionLeadZ = resumeLead.z;
    updateCameraOcclusionUniforms(
      this.game.cameraRig.camera.position,
      {
        x: this.playerMesh.position.x + this.occlusionLeadX,
        y: this.playerMesh.position.y + OCCLUSION_FOCUS_HEIGHT,
        z: this.playerMesh.position.z + this.occlusionLeadZ,
      },
      1.0
    );
    this.game.bus.emit('audio:music', { track: this.currentMap.music });
    this.refreshNpcVisibility();
    this.syncTimeOfDayVisuals(true);
    this.updateBadge();
    this.updateStaminaHud();
    this.refreshQuestHud(true);
    this.refreshSideQuestMarkers();
    this.syncVisualSnapshot(true);
  }

  private bindTouchCameraHandlers(): void {
    this.game.touchControls.setCameraHandlers({
      onStep: (delta) => {
        if (this.isBlockingUiOpen() || this.warpPhase !== 'idle' || this.escortCutscene) {
          return;
        }
        this.game.cameraRig.rotateStep(delta);
        this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      },
      onOrbit: (deltaRad) => {
        if (this.isBlockingUiOpen() || this.warpPhase !== 'idle' || this.escortCutscene) {
          return;
        }
        this.game.cameraRig.orbitYaw(deltaRad);
      },
    });
  }

  private refreshQuestHud(force = false): void {
    if (!this.currentMap) return;
    this.hud.refreshQuestTracker(
      this.game.saveData.questIndex,
      this.currentMap,
      this.playerMesh.position.x,
      this.playerMesh.position.z,
      this.game.cameraRig.getCurrentYaw(),
      force
    );
  }

  private checkQuestCoordinates(): void {
    const idx = clampQuestIndex(this.game.saveData.questIndex);
    const res = evaluateQuestProgress(idx, this.currentMap.id, this.gridX, this.gridY);
    if (!res.updated || !res.completedQuest) {
      this.refreshQuestHud(false);
      return;
    }

    this.game.saveData.questIndex = res.nextIndex;
    this.refreshQuestHud(true);
    this.game.saveGame();
    this.game.bus.emit('audio:sfx', { sfx: 'confirm' });

    const nextQuest = getActiveQuest(res.nextIndex);
    if (nextQuest) {
      this.game.showToast(
        `Misión completada: ${res.completedQuest.title} · Siguiente: ${nextQuest.title}`
      );
    } else {
      this.game.showToast('¡Has completado todas las misiones de exploración!');
    }
  }

  private updateBadge(): void {
    const mins = this.game.saveData.worldClockMinutes;
    const timeLabel = `${formatWorldClock(mins)} · ${getTimePhaseLabel(getTimePhase(mins))}`;
    this.hud.updateBadge(
      this.currentMap.id,
      this.game.saveData.money,
      this.game.saveData.repelSteps,
      timeLabel
    );
  }

  private syncTimeOfDayVisuals(force = false): void {
    if (!this.currentMap) return;
    const mins = this.game.saveData.worldClockMinutes;
    const minute = Math.floor(normalizeWorldMinutes(mins));
    if (force || minute !== this.lastClockUiMinute) {
      this.lastClockUiMinute = minute;
      this.updateBadge();
    }

    const phase = getTimePhase(mins);
    if (!force && phase === this.lastAppliedTimePhase) return;
    this.lastAppliedTimePhase = phase;

    const isInterior = Boolean(this.currentMap.isInterior);
    const isCave = this.currentMap.music === 'cave';
    const profile = getTimeLightingProfile(phase, isInterior, isCave);

    if (this.hemiLight) {
      this.hemiLight.intensity = this.baseHemiIntensity * profile.hemiIntensityMult;
      this.hemiLight.color.setHex(profile.hemiSkyHex);
    }
    if (this.sunLight) {
      this.sunLight.intensity = this.baseSunIntensity * profile.sunIntensityMult;
      this.sunLight.color.setHex(profile.sunColorHex);
    }
    if (!isInterior && !isCave && this.scene.fog instanceof THREE.Fog) {
      this._fogBaseColor.setHex(this.baseHorizonColorHex);
      if (profile.fogBlend > 0) {
        this._fogTintColor.setHex(profile.fogTintHex);
        this._fogBaseColor.lerp(this._fogTintColor, profile.fogBlend);
      }
      this.scene.fog.color.copy(this._fogBaseColor);
    }
    this.atmosphere?.setGlowIntensityMult(profile.glowIntensityMult);
  }

  private updateStaminaHud(): void {
    this.hud.updateStamina(this.stamina);
  }

  private collectPropPlacements(map: MapDef): PropInstancePlacement[] {
    const placements: PropInstancePlacement[] = [];
    const occupied = new Set<string>();

    const mark = (x: number, z: number, solid: boolean) => {
      const key = `${x},${z}`;
      occupied.add(key);
      if (solid) this.blockedTiles.add(key);
    };

    // Reserve warps (+ 1-tile apron), plus keep tall canopy trees clear of warp approaches
    const treeExcluded = new Set<string>();
    for (const w of map.warps) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          occupied.add(`${w.x + dx},${w.y + dz}`);
        }
      }
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          treeExcluded.add(`${w.x + dx},${w.y + dz}`);
        }
      }
    }
    for (const npc of map.npcs) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          occupied.add(`${npc.x + dx},${npc.y + dz}`);
        }
      }
      if (npc.patrol?.waypoints) {
        const wps = npc.patrol.waypoints;
        for (let i = 0; i < wps.length; i++) {
          const a = wps[i];
          const b = wps[(i + 1) % wps.length];
          const minX = Math.min(a.x, b.x);
          const maxX = Math.max(a.x, b.x);
          const minY = Math.min(a.y, b.y);
          const maxY = Math.max(a.y, b.y);
          for (let py = minY; py <= maxY; py++) {
            for (let px = minX; px <= maxX; px++) {
              occupied.add(`${px},${py}`);
            }
          }
        }
      }
    }
    for (const b of map.buildings) {
      for (let dz = -1; dz <= b.depth + 1; dz++) {
        for (let dx = -1; dx <= b.width; dx++) {
          occupied.add(`${b.x + dx},${b.z + dz}`);
        }
      }
    }
    for (const pk of map.pickups ?? []) {
      occupied.add(`${pk.x},${pk.y}`);
    }

    // Hand-placed props & signs
    for (const p of map.props) {
      const y = getTileWorldY(map, p.x, p.z);
      placements.push({ kind: p.kind, x: p.x, y, z: p.z, scale: 1 });
      mark(p.x, p.z, true);
    }
    for (const s of map.signs) {
      const y = getTileWorldY(map, s.x, s.y);
      placements.push({ kind: 'sign', x: s.x, y, z: s.y, scale: 1 });
      mark(s.x, s.y, true);
    }

    if (map.isInterior) {
      return placements;
    }

    placements.push(...buildEncounterGrassPlacements(map));

    // Seeded decoration pass across terrain
    const dec = map.decoration;
    const rng = createRng(dec.seed);
    const height = map.grid.length;
    const width = map.grid[0]?.length ?? 0;
    const atlasRocks = getPropAtlasKinds('rock');
    const atlasBushes = getPropAtlasKinds('bush');
    const atlasFlowers = getPropAtlasKinds('flower');
    const atlasMushrooms = getPropAtlasKinds('mushroom');
    const atlasGrass = getPropAtlasKinds('grass');

    for (let z = 1; z < height - 1; z++) {
      const row = map.grid[z];
      for (let x = 1; x < width - 1; x++) {
        const key = `${x},${z}`;
        if (occupied.has(key)) continue;
        if (isInsideBuilding(map.buildings, x, z)) continue;

        const ch = row[x];
        const leg = map.legend[ch];
        if (!leg) continue;

        // Avoid placing seeded props on roads, water, bridges, stairs, tall grass, or arena floor
        if (
          leg.tile === 'water' ||
          leg.tile === 'cobble' ||
          leg.tile === 'bridge' ||
          leg.tile === 'stairs' ||
          leg.tile === 'arena_floor' ||
          leg.tile === 'tall_grass' ||
          leg.tile === 'dirt' ||
          (leg.tile === 'stone' && !leg.solid)
        ) {
          continue;
        }

        // Check slope around (x, z) so tall props don't sit on steep cliff faces
        const hC = getTileHeightLevel(map, x, z);
        const maxDiff = Math.max(
          Math.abs(getTileHeightLevel(map, x + 1, z) - hC),
          Math.abs(getTileHeightLevel(map, x - 1, z) - hC),
          Math.abs(getTileHeightLevel(map, x, z + 1) - hC),
          Math.abs(getTileHeightLevel(map, x, z - 1) - hC)
        );
        if (maxDiff > 1) continue;

        const worldY = hC * 0.5;
        const roll = rng.next();
        let chosen: PropKind | null = null;

        const isRoadNeighbor = (() => {
          for (let rz = -1; rz <= 1; rz++) {
            for (let rx = -1; rx <= 1; rx++) {
              const nch = map.grid[z + rz]?.[x + rx];
              if (!nch) continue;
              const nleg = map.legend[nch];
              if (!nleg) continue;
              if (
                nleg.tile === 'cobble' ||
                nleg.tile === 'dirt' ||
                nleg.tile === 'stairs' ||
                nleg.tile === 'bridge' ||
                (nleg.tile === 'stone' && !nleg.solid)
              ) {
                return true;
              }
            }
          }
          return false;
        })();

        const allowTree = !treeExcluded.has(key) && !isRoadNeighbor;

        if (dec.treeKinds.length > 0 && roll < dec.treeDensity && allowTree) {
          if (map.snowLine !== undefined && hC >= map.snowLine && dec.treeKinds.includes('snow_pine')) {
            chosen = 'snow_pine';
          } else {
            chosen = rng.pick(dec.treeKinds);
            if (chosen === 'mushroom_tree') {
              chosen = rng.next() < 0.55 ? 'mushroom_tree' : 'mushroom_tree_arcane';
            }
          }
        } else if (roll < dec.treeDensity + dec.rockDensity) {
          chosen = atlasRocks.length > 0 ? rng.pick(atlasRocks) : 'boulder';
        } else if (roll < dec.treeDensity + dec.rockDensity + dec.bushDensity) {
          chosen =
            atlasBushes.length > 0
              ? rng.pick(atlasBushes)
              : rng.next() < 0.55
                ? 'bush'
                : 'bush_arcane';
        } else if (
          roll <
          dec.treeDensity + dec.rockDensity + dec.bushDensity + dec.flowerDensity
        ) {
          chosen = atlasFlowers.length > 0 ? rng.pick(atlasFlowers) : 'flower_patch';
        } else if (
          roll <
          dec.treeDensity +
            dec.rockDensity +
            dec.bushDensity +
            dec.flowerDensity +
            dec.mushroomDensity
        ) {
          chosen = atlasMushrooms.length > 0 ? rng.pick(atlasMushrooms) : 'mushroom';
        } else if (leg.tile === 'grass' && rng.next() < 0.06) {
          chosen =
            atlasGrass.length > 0
              ? rng.pick(atlasGrass)
              : rng.next() < 0.5
                ? 'tall_grass_clump'
                : 'tall_grass_flower';
        }

        if (chosen) {
          const scale = 0.88 + rng.next() * 0.26;
          placements.push({ kind: chosen, x, y: worldY, z, scale });
          const isSolid =
            SOLID_SEED_PROPS.has(chosen) || getPropAtlasDef(chosen)?.solid === true || leg.solid;
          mark(x, z, isSolid);
        }
      }
    }

    this.collectBorderApronProps(map, placements);
    return placements;
  }

  private collectBorderApronProps(
    map: MapDef,
    placements: PropInstancePlacement[]
  ): void {
    const height = map.grid.length;
    const width = map.grid[0]?.length ?? 0;
    if (width === 0 || height === 0) return;

    const rng = createRng(map.decoration.seed ^ 0x424f5244);
    const margin = 14;
    const outdoorTrees: PropKind[] =
      map.biome === 'mountain' || map.biome === 'arena'
        ? ['pine', 'snow_pine', 'oak']
        : ['pine', 'oak', 'birch'];

    for (let z = -margin; z < height + margin; z++) {
      for (let x = -margin; x < width + margin; x++) {
        if (x >= 0 && x < width && z >= 0 && z < height) continue;

        const outX = x < 0 ? -x : x >= width ? x - (width - 1) : 0;
        const outZ = z < 0 ? -z : z >= height ? z - (height - 1) : 0;
        const outDist = Math.max(outX, outZ);

        // Keep immediate threshold right behind each warp gate clear for sightline & curved path
        let nearGateMouth = false;
        for (const w of map.warps) {
          const distToWarp = Math.hypot(x - w.x, z - w.y);
          if (distToWarp <= 3.4) {
            nearGateMouth = true;
            break;
          }
        }
        if (nearGateMouth) continue;

        const cx = Math.max(0, Math.min(width - 1, x));
        const cz = Math.max(0, Math.min(height - 1, z));
        const hLevel = getTileHeightLevel(map, cx, cz);
        let worldY = hLevel * 0.5;
        if (outDist >= 5) {
          const t = Math.min(1, (outDist - 5) / 14);
          const undulate = (Math.sin(x * 0.16 + z * 0.13) * 0.5 + 0.5) * 0.65;
          worldY += (0.55 + undulate) * t;
        }

        const roll = rng.next();
        if (map.music === 'cave') {
          if (roll < 0.16) {
            placements.push({
              kind: roll < 0.04 ? 'crystal' : 'boulder',
              x,
              y: worldY,
              z,
              scale: 0.95 + rng.next() * 0.35,
            });
          }
          continue;
        }

        // Dense forest silhouette framing hills & behind gate bends
        const density = outDist >= 4 ? 0.28 : 0.20;
        if (roll < density) {
          let kind: PropKind;
          if (map.snowLine !== undefined && hLevel >= map.snowLine) {
            kind = 'snow_pine';
          } else {
            kind = rng.pick(outdoorTrees);
          }
          placements.push({
            kind,
            x,
            y: worldY,
            z,
            scale: 0.92 + rng.next() * 0.38,
          });
        } else if (roll < density + 0.04) {
          placements.push({
            kind: 'boulder',
            x,
            y: worldY,
            z,
            scale: 0.9 + rng.next() * 0.3,
          });
        }
      }
    }
  }

  private loadMap(
    mapId: string,
    x: number,
    y: number,
    dir: Direction,
    autoSave: boolean
  ): void {
    // Clear previous map scene objects and disposables
    this.chunks = [];
    this.propBatches = [];
    this.clouds = [];
    this.npcs = [];
    this.pickups = [];
    this.blockedTiles.clear();
    this.atmosphere = null;
    this.waterSurface = null;
    if (this.playerShadow) {
      this.playerMesh.remove(this.playerShadow);
      this.playerShadow = null;
    }
    this.sunLight?.shadow.map?.dispose();
    this.sunLight = null;
    this.hemiLight = null;

    const toRemove: THREE.Object3D[] = [];
    for (const child of this.scene.children) {
      if (child !== this.playerMesh) toRemove.push(child);
    }
    for (const c of toRemove) this.scene.remove(c);
    this.mapDisposables.disposeAll();

    const isKnownMap = Boolean(MAPS[mapId] || DEV_MAPS[mapId]);
    const safeMapId = isKnownMap ? mapId : 'villa_origen';
    const map = getMap(safeMapId);
    const maxW = Math.max(0, (map.grid[0]?.length ?? 1) - 1);
    const maxH = Math.max(0, map.grid.length - 1);
    const clampedX = isKnownMap ? Math.max(0, Math.min(maxW, Math.round(x))) : 24;
    const clampedY = isKnownMap ? Math.max(0, Math.min(maxH, Math.round(y))) : 26;

    this.currentMap = map;
    this.gridX = clampedX;
    this.gridY = clampedY;
    this.dir = dir;
    this.moving = false;

    this.game.saveData.mapId = safeMapId;
    this.game.saveData.playerX = clampedX;
    this.game.saveData.playerY = clampedY;
    this.game.saveData.playerDir = dir;

    const cTop = new THREE.Color(map.skyTopColor);
    const cBot = new THREE.Color(map.skyBottomColor);
    const cFog = new THREE.Color(map.fogColor);
    const horizonColor =
      map.music === 'cave'
        ? map.fogColor
        : cBot.lerp(cTop, 0.26).lerp(cFog, 0.34).getHex();

    const skyTex = createGradientSkyTexture(
      map.skyTopColor,
      map.skyBottomColor,
      horizonColor
    );
    this.mapDisposables.track(skyTex);
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog(horizonColor, 20, 48);

    const isCave = map.music === 'cave';
    const hemiSkyColor = isCave ? 0xd9c8ff : 0xfff8eb;
    const hemiGroundColor = isCave ? 0x6f5894 : 0xa39c8e;
    const baseHemiIntensity = isCave ? 1.85 : 2.05;
    const hemiLight = new THREE.HemisphereLight(
      hemiSkyColor,
      hemiGroundColor,
      baseHemiIntensity
    );
    this.scene.add(hemiLight);
    this.mapDisposables.track(hemiLight);
    this.hemiLight = hemiLight;
    this.baseHemiIntensity = baseHemiIntensity;
    this.baseHorizonColorHex = horizonColor;

    const baseSunIntensity = isCave ? 1.35 : 1.55;
    const sunLight = new THREE.DirectionalLight(
      isCave ? 0xffe0b8 : 0xfff7e6,
      baseSunIntensity
    );
    sunLight.castShadow = !map.isInterior && !isCave;
    if (sunLight.castShadow) {
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 1;
      sunLight.shadow.camera.far = 38;
      const d = 13;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      sunLight.shadow.bias = -0.0008;
      sunLight.shadow.normalBias = 0.03;
    }
    this.scene.add(sunLight);
    this.scene.add(sunLight.target);
    this.mapDisposables.track(sunLight);
    this.sunLight = sunLight;
    this.baseSunIntensity = baseSunIntensity;
    this.postFx.setBiome(map.biome, Boolean(map.isInterior));

    const terrainAtlasMat = new THREE.MeshStandardMaterial({
      map: this.game.assets.getTileAtlasTexture(),
      normalMap: this.game.assets.getTileAtlasNormalTexture(),
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.92,
      metalness: 0.03,
      vertexColors: true,
    });
    const structureAtlasMat = terrainAtlasMat.clone();
    const grassMat = new THREE.MeshStandardMaterial({
      map: this.game.assets.getGrassTexture(),
      normalMap: this.game.assets.getGrassNormalTexture(),
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.95,
      metalness: 0.0,
      vertexColors: true,
    });
    attachCameraOcclusionCutout(terrainAtlasMat, { minRelY: OCCLUSION_TERRAIN_MIN_REL_Y });
    attachCameraOcclusionCutout(grassMat, { minRelY: OCCLUSION_TERRAIN_MIN_REL_Y });
    attachCameraOcclusionCutout(structureAtlasMat, { minRelY: -999 });
    const terrainAtlasTex = this.game.assets.getTileAtlasTexture();
    const terrainNormalTex = this.game.assets.getTileAtlasNormalTexture();
    attachTerrainDioramaShader(terrainAtlasMat, map.biome, {
      terrainAtlas: terrainAtlasTex,
      terrainNormalAtlas: terrainNormalTex,
    });
    attachTerrainDioramaShader(grassMat, map.biome, {
      terrainAtlas: terrainAtlasTex,
      terrainNormalAtlas: terrainNormalTex,
    });
    this.mapDisposables.track(terrainAtlasMat);
    this.mapDisposables.track(structureAtlasMat);
    this.mapDisposables.track(grassMat);

    // 1. Heightfield terrain chunks + seamless outer border apron
    this.chunks = buildTerrainChunks(map, terrainAtlasMat, grassMat);
    for (const chunk of this.chunks) {
      this.mapDisposables.track(chunk.mesh.geometry);
      this.scene.add(chunk.mesh);
    }
    const borderApron = map.isInterior ? null : buildTerrainBorderApron(map, terrainAtlasMat, grassMat);
    if (borderApron) {
      this.mapDisposables.track(borderApron.geometry);
      this.scene.add(borderApron);
    }
    this.waterSurface = new WaterSurface(this.scene, this.mapDisposables, map);

    if (map.isInterior) {
      const interiorWalls = buildInteriorWallsMesh(
        map,
        structureAtlasMat,
        (key) => this.game.assets.getWallTexture(key),
        (key) => this.game.assets.getWallNormalTexture(key)
      );
      if (interiorWalls) {
        interiorWalls.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            if (mesh.geometry) this.mapDisposables.track(mesh.geometry);
            if (mesh.material && mesh.material !== structureAtlasMat && !Array.isArray(mesh.material)) {
              attachCameraOcclusionCutout(mesh.material, { minRelY: -999 });
              this.mapDisposables.track(mesh.material);
            }
          }
        });
        this.scene.add(interiorWalls);
      }
    }

    // 2. Low-poly 3D buildings & 3D map-to-map route gates / cave portals
    const buildingsGroup = buildBuildingsMesh(
      map,
      structureAtlasMat,
      (kind) => this.game.assets.getRoofTexture(kind),
      (kind) => this.game.assets.getRoofNormalTexture(kind),
      (key) => this.game.assets.getWallTexture(key),
      (key) => this.game.assets.getWallNormalTexture(key)
    );
    if (buildingsGroup) {
      for (const child of buildingsGroup.children) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) this.mapDisposables.track(mesh.geometry);
        if (mesh.material && mesh.material !== structureAtlasMat && !Array.isArray(mesh.material)) {
          attachCameraOcclusionCutout(mesh.material, { minRelY: -999 });
          this.mapDisposables.track(mesh.material);
        }
      }
      this.scene.add(buildingsGroup);
    }

    const gatesGroup = buildMapGatesGroup(
      map,
      structureAtlasMat,
      (kind) => this.game.assets.getRoofTexture(kind),
      (kind) => this.game.assets.getRoofNormalTexture(kind),
      (key) => this.game.assets.getWallTexture(key),
      (key) => this.game.assets.getWallNormalTexture(key)
    );
    if (gatesGroup) {
      gatesGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          if (!mat || mat.toneMapped !== false) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
          if (mesh.geometry) this.mapDisposables.track(mesh.geometry);
          if (mesh.material && mesh.material !== structureAtlasMat && !Array.isArray(mesh.material)) {
            attachCameraOcclusionCutout(mesh.material, { minRelY: -999 });
            this.mapDisposables.track(mesh.material);
          }
        }
      });
      this.scene.add(gatesGroup);
    }

    const staircasesGroup = buildStaircaseMeshes(map, terrainAtlasMat);
    if (staircasesGroup) {
      staircasesGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          if (mesh.geometry) this.mapDisposables.track(mesh.geometry);
        }
      });
      this.scene.add(staircasesGroup);
    }

    const cliffOrnamentTex = createCliffOrnamentTexture();
    const cliffOrnamentMat = createCliffOrnamentMaterial(cliffOrnamentTex);
    this.mapDisposables.track(cliffOrnamentTex);
    this.mapDisposables.track(cliffOrnamentMat);
    const cliffOrnamentsGroup = buildCliffOrnamentsMesh(map, cliffOrnamentMat);
    if (cliffOrnamentsGroup) {
      cliffOrnamentsGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          this.mapDisposables.track(mesh.geometry);
        }
      });
      this.scene.add(cliffOrnamentsGroup);
    }

    // 3. Hand-placed + seeded decoration props
    const propPlacements = this.collectPropPlacements(map);
    this.propBatches = buildInstancedPropBatches(propPlacements, this.game.assets);
    for (const batch of this.propBatches) {
      this.mapDisposables.track(batch.mesh.geometry);
      this.mapDisposables.track(batch.mesh.material as THREE.Material);
      if (batch.mesh.customDepthMaterial) {
        this.mapDisposables.track(batch.mesh.customDepthMaterial as THREE.Material);
      }
      this.scene.add(batch.mesh);
    }

    // 4. Sky cloud billboards (outdoor maps)
    if (map.music !== 'cave' && !map.isInterior) {
      const mw = (map.grid[0]?.length ?? 48) * 0.5;
      const mh = map.grid.length * 0.5;
      this.clouds = buildCloudBillboards(
        this.scene,
        this.mapDisposables,
        mw,
        mh,
        28,
        10,
        map.decoration.seed + 55,
        13.5
      );
    }

    // 5. NPC billboards placed at interpolated terrain height
    const capsulePedestalGeo = createBottomPivotPlaneGeometry(0.78, 1.04);
    const healMachineGeo = createBottomPivotPlaneGeometry(0.92, 1.37);
    const crystalPickupGeo = createBottomPivotPlaneGeometry(0.62, 1.06);
    this.mapDisposables.track(capsulePedestalGeo);
    this.mapDisposables.track(healMachineGeo);
    this.mapDisposables.track(crystalPickupGeo);

    const yawStep = this.game.cameraRig.getYawStep();
    for (let idx = 0; idx < map.npcs.length; idx++) {
      const npcDef = map.npcs[idx];
      const isStarter = npcDef.starterIndex !== undefined;
      const isHealMachine = npcDef.id === 'arena_heal';
      const isPedestal = isStarter || isHealMachine;

      const relDir = relativeSpriteDir(npcDef.dir, yawStep);
      const tex = isStarter
        ? this.game.assets.getPropTexture('capsule_pedestal')
        : isHealMachine
          ? this.game.assets.getPropTexture('heal_machine')
          : this.game.assets.getCharacterTexture(
              npcDef.role as CharacterRole,
              relDir,
              0,
              npcDef.trainerId ?? npcDef.id
            );

      const mat = createLitBillboardMaterial(tex, { emissiveIntensity: 0.54 });
      const depthMat = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: tex,
        alphaTest: 0.5,
      });
      this.mapDisposables.track(mat);
      this.mapDisposables.track(depthMat);

      const npcGeo = isStarter
        ? capsulePedestalGeo
        : isHealMachine
          ? healMachineGeo
          : this.charGeo;
      const mesh = new THREE.Mesh(npcGeo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depthMat;
      const ny = getTileWorldY(map, npcDef.x, npcDef.y);
      mesh.position.set(npcDef.x, ny, npcDef.y);
      this.scene.add(mesh);

      let markerMesh: THREE.Mesh | undefined;
      let markerMat: THREE.MeshBasicMaterial | undefined;
      if (!isPedestal) {
        markerMat = new THREE.MeshBasicMaterial({
          map: this.questExclamationTex,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });
        this.mapDisposables.track(markerMat);
        markerMesh = new THREE.Mesh(this.markerGeo, markerMat);
        markerMesh.position.set(npcDef.x, ny + 1.65, npcDef.y);
        markerMesh.visible = false;
        this.scene.add(markerMesh);
      }

      let npcInitX = npcDef.x;
      let npcInitY = npcDef.y;
      let npcInitDir = npcDef.dir;
      if (npcDef.id === VILLA_GUIDE_NPC_ID) {
        if (this.game.saveData.flags.starter_chosen) {
          npcInitX = VILLA_GUIDE_REST_AFTER_STARTER.x;
          npcInitY = VILLA_GUIDE_REST_AFTER_STARTER.y;
          npcInitDir = VILLA_GUIDE_REST_AFTER_STARTER.dir;
        } else if (this.game.saveData.flags.village_tour_done) {
          npcInitX = VILLA_GUIDE_REST_BEFORE_STARTER.x;
          npcInitY = VILLA_GUIDE_REST_BEFORE_STARTER.y;
          npcInitDir = VILLA_GUIDE_REST_BEFORE_STARTER.dir;
        }
        const restY = getTileWorldY(map, npcInitX, npcInitY);
        mesh.position.set(npcInitX, restY, npcInitY);
        if (markerMesh) markerMesh.position.set(npcInitX, restY + 1.65, npcInitY);
      } else if (npcDef.id === LAB_GUIDE_NPC_ID) {
        if (this.game.saveData.flags.lab_tour_pending && !this.game.saveData.flags.starter_chosen) {
          npcInitX = LAB_GUIDE_SPAWN.x;
          npcInitY = LAB_GUIDE_SPAWN.y;
          npcInitDir = LAB_GUIDE_SPAWN.dir;
        } else {
          npcInitX = LAB_GUIDE_REST_BEFORE_STARTER.x;
          npcInitY = LAB_GUIDE_REST_BEFORE_STARTER.y;
          npcInitDir = LAB_GUIDE_REST_BEFORE_STARTER.dir;
        }
        const restY = getTileWorldY(map, npcInitX, npcInitY);
        mesh.position.set(npcInitX, restY, npcInitY);
        if (markerMesh) markerMesh.position.set(npcInitX, restY + 1.65, npcInitY);
      }

      const behavior = createNpcBehaviorState(
        npcInitX,
        npcInitY,
        npcInitDir,
        0.5 + (idx % 4) * 0.35
      );

      this.npcs.push({
        def: npcDef,
        mesh,
        mat,
        depthMat,
        visible: true,
        isPedestal,
        behavior,
        lastRelDir: relDir,
        lastWalkFrame: 0,
        markerMesh,
        markerMat,
        prevVisualX: mesh.position.x,
        prevVisualY: mesh.position.y,
        prevVisualZ: mesh.position.z,
        currVisualX: mesh.position.x,
        currVisualY: mesh.position.y,
        currVisualZ: mesh.position.z,
      });
    }

    // 6. Ground pickups not yet collected
    const extraGlowPoints: Array<{ x: number; y: number; z: number; kind: PropKind }> = [];
    for (const npc of this.npcs) {
      if (npc.isPedestal) {
        const py = getTileWorldY(map, npc.def.x, npc.def.y);
        extraGlowPoints.push({
          x: npc.def.x,
          y: py,
          z: npc.def.y,
          kind: npc.def.id === 'arena_heal' ? 'heal_machine' : 'capsule_pedestal',
        });
      }
    }

    for (const pk of map.pickups ?? []) {
      if (this.game.saveData.collectedPickups.includes(pk.id)) continue;
      let mesh: THREE.Mesh | null = null;
      if (!pk.hidden) {
        const isCrystal = pk.itemId === 'fragmento_alma';
        const pkKind: PropKind = isCrystal ? 'crystal' : 'capsule_pedestal';
        const tex = this.game.assets.getPropTexture(pkKind);
        const pkMat = createLitBillboardMaterial(tex, {
          emissiveIntensity: isCrystal ? 0.85 : 0.6,
        });
        const pkDepthMat = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          map: tex,
          alphaTest: 0.5,
        });
        this.mapDisposables.track(pkMat);
        this.mapDisposables.track(pkDepthMat);
        mesh = new THREE.Mesh(isCrystal ? crystalPickupGeo : capsulePedestalGeo, pkMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = pkDepthMat;
        const py = getTileWorldY(map, pk.x, pk.y);
        mesh.position.set(pk.x, py, pk.y);
        this.scene.add(mesh);
        extraGlowPoints.push({ x: pk.x, y: py, z: pk.y, kind: pkKind });
      }
      this.pickups.push({
        id: pk.id,
        x: pk.x,
        y: pk.y,
        itemId: pk.itemId,
        quantity: pk.quantity ?? 1,
        hidden: Boolean(pk.hidden),
        mesh,
      });
    }

    // 7. HD-2D atmosphere: contact shadows, HDR lantern/crystal halos, light shafts & biome particles
    this.atmosphere = new OverworldAtmosphere(
      this.scene,
      this.mapDisposables,
      map,
      propPlacements,
      extraGlowPoints
    );
    const pShadow = this.atmosphere.createActorShadow(0.76);
    pShadow.position.set(0, 0.02, 0);
    this.playerMesh.add(pShadow);
    this.playerShadow = pShadow;

    for (const npc of this.npcs) {
      const s = this.atmosphere.createActorShadow(npc.isPedestal ? 0.84 : 0.72);
      s.position.set(0, 0.02, 0);
      npc.mesh.add(s);
    }
    for (const pk of this.pickups) {
      if (pk.mesh) {
        const s = this.atmosphere.createActorShadow(0.68);
        s.position.set(0, 0.02, 0);
        pk.mesh.add(s);
      }
    }

    this.refreshNpcVisibility();
    this.syncPlayerVisual();
    this.syncBillboardYaw(0);

    const startY = sampleInterpolatedHeight(map, clampedX, clampedY);
    this.syncSunShadowCenter(clampedX, startY, clampedY);
    this.game.cameraRig.snapTo(clampedX, startY, clampedY, this.sampleTerrain);
    const startLead = getDirectionLeadTarget(this.dir, false);
    this.occlusionLeadX = startLead.x;
    this.occlusionLeadZ = startLead.z;
    updateCameraOcclusionUniforms(
      this.game.cameraRig.camera.position,
      {
        x: clampedX + this.occlusionLeadX,
        y: startY + OCCLUSION_FOCUS_HEIGHT,
        z: clampedY + this.occlusionLeadZ,
      },
      1.0
    );
    this.updateChunkFrustumCulling(true);
    this.game.bus.emit('audio:music', { track: map.music });
    this.lastAppliedTimePhase = null;
    this.syncTimeOfDayVisuals(true);
    this.updateBadge();
    this.checkQuestCoordinates();
    this.refreshQuestHud(true);
    this.syncVisualSnapshot(true);
    this.justTeleported = true;

    if (autoSave) {
      this.game.autosave();
    }
  }

  private refreshNpcVisibility(): void {
    const flags = this.game.saveData.flags;
    for (const npc of this.npcs) {
      let show = true;
      if (npc.def.flagHidden && flags[npc.def.flagHidden]) show = false;
      if (npc.def.flagRequired && !flags[npc.def.flagRequired]) show = false;
      npc.visible = show;
      npc.mesh.visible = show;
    }
    this.refreshSideQuestMarkers();
  }

  private refreshSideQuestMarkers(): void {
    const save = this.game.saveData;
    ensureSaveSideQuestState(save);
    for (const npc of this.npcs) {
      if (!npc.markerMesh || !npc.markerMat) continue;
      if (!npc.visible) {
        npc.markerMesh.visible = false;
        continue;
      }
      const state = getSideQuestForNpc(npc.def.id, save);
      if (!state || !state.marker) {
        npc.markerMesh.visible = false;
        continue;
      }
      const targetTex =
        state.marker === '?' ? this.questQuestionTex : this.questExclamationTex;
      if (npc.markerMat.map !== targetTex) {
        npc.markerMat.map = targetTex;
        npc.markerMat.needsUpdate = true;
      }
      npc.markerMesh.visible = true;
    }

    let readyCount = 0;
    let availableCount = 0;
    let activeCount = 0;
    let completedCount = 0;
    for (const q of SIDE_QUESTS) {
      const st = getSideQuestStatus(q, save);
      if (st === 'completed') completedCount += 1;
      else if (st === 'available') availableCount += 1;
      else if (st === 'active') {
        activeCount += 1;
        if (q.evaluateProgress(save).ready) readyCount += 1;
      }
    }

    this.hud.updateSideQuestBadge(
      readyCount,
      availableCount,
      activeCount,
      completedCount
    );
  }

  private openQuestJournal(): void {
    if (this.warpPhase !== 'idle' || this.isBlockingUiOpen()) return;
    this.game.bus.emit('audio:sfx', { sfx: 'quest_journal' });
    this.game.questJournal.open(
      this.game.saveData,
      () => {
        this.refreshSideQuestMarkers();
      },
      {
        map: this.currentMap,
        x: this.gridX,
        y: this.gridY,
      }
    );
  }

  private syncPlayerVisual(): void {
    const x = this.moving
      ? THREE.MathUtils.lerp(this.moveFromX, this.moveToX, this.moveProgress)
      : this.gridX;
    const z = this.moving
      ? THREE.MathUtils.lerp(this.moveFromY, this.moveToY, this.moveProgress)
      : this.gridY;
    const y = sampleInterpolatedHeight(this.currentMap, x, z);

    this.playerMesh.position.set(x, y, z);

    const relDir = relativeSpriteDir(this.dir, this.game.cameraRig.getYawStep());
    const tex = this.game.assets.getCharacterTexture('player', relDir, this.walkFrame);
    if (this.playerMat.map !== tex) {
      this.playerMat.map = tex;
      this.playerMat.needsUpdate = true;
      this.playerDepthMat.map = tex;
      this.playerDepthMat.needsUpdate = true;
    }
  }

  private isNpcStepBlocked(
    self: RuntimeNpc,
    fromX: number,
    fromY: number,
    nx: number,
    ny: number
  ): boolean {
    if (!isTileWalkable(this.currentMap, fromX, fromY, nx, ny, this.blockedTiles)) {
      return true;
    }
    if (nx === this.gridX && ny === this.gridY) return true;
    if (this.moving && nx === this.moveToX && ny === this.moveToY) return true;

    for (const w of this.currentMap.warps) {
      if (w.x === nx && w.y === ny) return true;
    }
    for (const s of this.currentMap.signs) {
      if (s.x === nx && s.y === ny) return true;
    }
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (!p.hidden && p.mesh?.visible && p.x === nx && p.y === ny) return true;
    }
    for (let i = 0; i < this.npcs.length; i++) {
      const other = this.npcs[i];
      if (other === self || !other.visible) continue;
      if (other.behavior.gridX === nx && other.behavior.gridY === ny) return true;
      if (
        other.behavior.moving &&
        other.behavior.moveToX === nx &&
        other.behavior.moveToY === ny
      ) {
        return true;
      }
    }
    return false;
  }

  private updateNpcs(dt: number): void {
    const paused = this.isBlockingUiOpen() || this.warpPhase !== 'idle';
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      if (!npc.visible || npc.isPedestal) continue;
      stepNpcBehavior(npc.behavior, {
        dt,
        patrol: npc.def.patrol,
        lookAtPlayerAfterTalk: npc.def.lookAtPlayerAfterTalk,
        playerX: this.gridX,
        playerY: this.gridY,
        paused,
        canStepTo: (fx, fy, tx, ty) => !this.isNpcStepBlocked(npc, fx, fy, tx, ty),
      });
    }
  }

  private syncBillboardYaw(dt: number): void {
    this.sceneTime += dt;
    const yaw = this.game.cameraRig.getCurrentYaw();
    const yawStep = this.game.cameraRig.getYawStep();

    this.playerMesh.rotation.y = yaw;
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      npc.mesh.rotation.y = yaw;

      if (!npc.isPedestal) {
        const b = npc.behavior;
        const nx = b.moving
          ? THREE.MathUtils.lerp(b.moveFromX, b.moveToX, b.moveProgress)
          : b.gridX;
        const nz = b.moving
          ? THREE.MathUtils.lerp(b.moveFromY, b.moveToY, b.moveProgress)
          : b.gridY;
        const ny = sampleInterpolatedHeight(this.currentMap, nx, nz);
        npc.mesh.position.set(nx, ny, nz);

        if (npc.markerMesh && npc.markerMesh.visible) {
          npc.markerMesh.rotation.y = yaw;
          npc.markerMesh.position.set(
            nx,
            ny + 1.65 + Math.sin(this.sceneTime * 4.5 + i) * 0.05,
            nz
          );
        }

        const relDir = relativeSpriteDir(b.dir, yawStep);
        if (relDir !== npc.lastRelDir || b.walkFrame !== npc.lastWalkFrame) {
          npc.lastRelDir = relDir;
          npc.lastWalkFrame = b.walkFrame;
          const tex = this.game.assets.getCharacterTexture(
            npc.def.role as CharacterRole,
            relDir,
            b.walkFrame,
            npc.def.trainerId ?? npc.def.id
          );
          if (npc.mat.map !== tex) {
            npc.mat.map = tex;
            npc.mat.needsUpdate = true;
            npc.depthMat.map = tex;
            npc.depthMat.needsUpdate = true;
          }
        }
      }
    }

    for (let i = 0; i < this.pickups.length; i++) {
      const m = this.pickups[i].mesh;
      if (m && m.visible) m.rotation.y = yaw;
    }

    const playerX = this.playerMesh.position.x;
    const playerY = this.playerMesh.position.y;
    const playerZ = this.playerMesh.position.z;
    const leadTarget = getDirectionLeadTarget(this.dir, this.moving);
    if (dt > 0) {
      this.occlusionLeadX = THREE.MathUtils.damp(this.occlusionLeadX, leadTarget.x, 8, dt);
      this.occlusionLeadZ = THREE.MathUtils.damp(this.occlusionLeadZ, leadTarget.z, 8, dt);
    } else {
      this.occlusionLeadX = leadTarget.x;
      this.occlusionLeadZ = leadTarget.z;
    }
    updateCameraOcclusionUniforms(
      this.game.cameraRig.camera.position,
      {
        x: playerX + this.occlusionLeadX,
        y: playerY + OCCLUSION_FOCUS_HEIGHT,
        z: playerZ + this.occlusionLeadZ,
      },
      1.0
    );

    const tier = this.game.renderer.getQualityTier();
    const showAmbient = this.game.renderer.areAmbientParticlesEnabled();
    updatePropBatchAnimation(this.propBatches, yaw, this.sceneTime, playerX, playerZ);
    this.waterSurface?.update(dt, tier);
    this.atmosphere?.update(
      dt,
      playerX,
      playerY,
      playerZ,
      yaw,
      tier,
      showAmbient
    );
    this.syncSunShadowCenter(playerX, playerY, playerZ);

    if (this.clouds.length > 0) {
      updateCloudBillboards(this.clouds, yaw, dt);
    }

    if (this.currentMap) {
      this.hud.updateQuestArrow(
        this.game.saveData.questIndex,
        this.currentMap,
        playerX,
        playerZ,
        yaw,
        false
      );
    }
  }

  private syncSunShadowCenter(px: number, py: number, pz: number): void {
    if (!this.sunLight) return;
    // Snap target to shadow texel grid so shadow edges never crawl as the player walks
    const frustumSize = 26;
    const texel = frustumSize / 1024;
    const sx = Math.round(px / texel) * texel;
    const sz = Math.round(pz / texel) * texel;
    this.sunLight.target.position.set(sx, py, sz);
    this.sunLight.position.set(sx + 7.5, py + 13.5, sz + 5.8);
    this.sunLight.target.updateMatrixWorld();
  }

  private isTileBlocked(nx: number, ny: number): boolean {
    if (!isTileWalkable(this.currentMap, this.gridX, this.gridY, nx, ny, this.blockedTiles)) {
      return true;
    }
    for (let i = 0; i < this.npcs.length; i++) {
      const n = this.npcs[i];
      if (!n.visible) continue;
      if (n.behavior.gridX === nx && n.behavior.gridY === ny) return true;
      if (n.behavior.moving && n.behavior.moveToX === nx && n.behavior.moveToY === ny) {
        return true;
      }
    }
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (!p.hidden && p.mesh?.visible && p.x === nx && p.y === ny) return true;
    }
    return false;
  }

  private isBlockingUiOpen(): boolean {
    return (
      this.game.dialog.isOpen() ||
      this.game.menu.isOpen() ||
      this.game.partyScreen.isOpen() ||
      this.game.bagScreen.isOpen() ||
      this.game.bestiaryScreen.isOpen() ||
      this.game.cardAlbumScreen.isOpen() ||
      this.game.storageScreen.isOpen() ||
      this.game.summary.isOpen() ||
      this.game.endingModal.isOpen() ||
      this.game.arGachaModal.isOpen() ||
      this.game.vesselScreen.isOpen() ||
      this.game.skillAcademyScreen.isOpen() ||
      this.game.questJournal.isOpen() ||
      this.game.chestScreen.isOpen() ||
      this.game.achievementsScreen.isOpen() ||
      this.game.spriteInspectorModal.isOpen()
    );
  }

  private syncVisualSnapshot(resetPrev: boolean): void {
    this.currPlayerPos.copy(this.playerMesh.position);
    this.currCamPos.copy(this.game.cameraRig.camera.position);
    this.currCamQuat.copy(this.game.cameraRig.camera.quaternion);
    if (resetPrev) {
      this.prevPlayerPos.copy(this.currPlayerPos);
      this.prevCamPos.copy(this.currCamPos);
      this.prevCamQuat.copy(this.currCamQuat);
    }
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      npc.currVisualX = npc.mesh.position.x;
      npc.currVisualY = npc.mesh.position.y;
      npc.currVisualZ = npc.mesh.position.z;
      if (resetPrev) {
        npc.prevVisualX = npc.currVisualX;
        npc.prevVisualY = npc.currVisualY;
        npc.prevVisualZ = npc.currVisualZ;
      }
    }
  }

  private restoreVisualSnapshot(): void {
    this.playerMesh.position.copy(this.currPlayerPos);
    this.game.cameraRig.camera.position.copy(this.currCamPos);
    this.game.cameraRig.camera.quaternion.copy(this.currCamQuat);
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      npc.mesh.position.set(npc.currVisualX, npc.currVisualY, npc.currVisualZ);
    }
  }

  private capturePrevVisualSnapshot(): void {
    this.prevPlayerPos.copy(this.currPlayerPos);
    this.prevCamPos.copy(this.currCamPos);
    this.prevCamQuat.copy(this.currCamQuat);
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      npc.prevVisualX = npc.currVisualX;
      npc.prevVisualY = npc.currVisualY;
      npc.prevVisualZ = npc.currVisualZ;
    }
  }

  private captureCurrVisualSnapshot(): void {
    this.syncVisualSnapshot(this.justTeleported);
    this.justTeleported = false;
  }

  private applyInterpolatedVisuals(alpha: number): void {
    const a = Math.max(0, Math.min(1, alpha));
    this.playerMesh.position.lerpVectors(this.prevPlayerPos, this.currPlayerPos, a);
    this.game.cameraRig.camera.position.lerpVectors(this.prevCamPos, this.currCamPos, a);
    this.game.cameraRig.camera.quaternion.slerpQuaternions(this.prevCamQuat, this.currCamQuat, a);
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      if (!npc.visible || npc.isPedestal) continue;
      npc.mesh.position.set(
        THREE.MathUtils.lerp(npc.prevVisualX, npc.currVisualX, a),
        THREE.MathUtils.lerp(npc.prevVisualY, npc.currVisualY, a),
        THREE.MathUtils.lerp(npc.prevVisualZ, npc.currVisualZ, a)
      );
    }
  }

  fixedUpdate(dt: number): void {
    this.restoreVisualSnapshot();
    this.capturePrevVisualSnapshot();
    this.stepSimulation(dt);
    this.captureCurrVisualSnapshot();
  }

  private stepSimulation(dt: number): void {
    this.game.saveData.stats.playTimeSec += dt;

    // 2-frame water animation
    this.waterTimer += dt;
    if (this.waterTimer >= 0.45) {
      this.waterTimer = 0;
      this.waterFrame = this.waterFrame === 0 ? 1 : 0;
      updateTerrainWaterFrame(this.chunks, this.waterFrame);
    }

    this.game.dialog.update(dt, this.game.input);

    this.hud.stepZoneBanner(dt);

    if (this.warpPhase !== 'idle') {
      this.warpTimer += dt;
      const fadeDuration = 0.18;
      if (this.warpPhase === 'out') {
        const alpha = Math.min(1, this.warpTimer / fadeDuration);
        this.hud.setWarpAlpha(alpha);
        if (this.warpTimer >= fadeDuration && this.pendingWarp) {
          const w = this.pendingWarp;
          this.pendingWarp = null;
          this.loadMap(w.targetMap, w.targetX, w.targetY, w.dir, true);
          this.hud.showZoneBanner(w.targetMap);
          this.warpPhase = 'in';
          this.warpTimer = 0;
        }
      } else {
        const alpha = Math.max(0, 1 - this.warpTimer / fadeDuration);
        this.hud.setWarpAlpha(alpha);
        if (this.warpTimer >= fadeDuration) {
          this.warpPhase = 'idle';
          this.hud.setWarpAlpha(0);
          this.maybeStartLabIntroOrEscort();
        }
      }
      this.syncBillboardYaw(dt);
      stepStamina(this.stamina, { dt, moving: false, sprintHeld: false });
      this.updateStaminaHud();
      return;
    }

    if (this.escortCutscene) {
      this.stepEscortCutscene(dt);
      stepStamina(this.stamina, { dt, moving: false, sprintHeld: false });
      this.updateStaminaHud();
      return;
    }

    if (this.isBlockingUiOpen()) {
      this.syncBillboardYaw(dt);
      stepStamina(this.stamina, { dt, moving: false, sprintHeld: false });
      this.updateStaminaHud();
      return;
    }

    this.game.saveData.worldClockMinutes = advanceWorldClock(
      this.game.saveData.worldClockMinutes,
      dt
    );
    this.syncTimeOfDayVisuals(false);

    this.updateNpcs(dt);

    if (this.game.input.justPressed('start')) {
      this.openPauseMenu();
      return;
    }

    // Horizontal orbital camera rotation (Q/E or touch swipe/drag)
    if (this.game.cameraRig.getCameraMode() === 'free_orbit') {
      const orbitSpeed = 2.1;
      if (this.game.input.isHeld('camLeft')) {
        this.game.cameraRig.orbitYaw(-orbitSpeed * dt);
      }
      if (this.game.input.isHeld('camRight')) {
        this.game.cameraRig.orbitYaw(orbitSpeed * dt);
      }
    } else if (this.game.input.justPressed('camLeft')) {
      this.game.cameraRig.rotateStep(-1);
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
    } else if (this.game.input.justPressed('camRight')) {
      this.game.cameraRig.rotateStep(1);
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
    }

    const sprintHeld =
      this.game.input.isHeld('sprint') || this.game.input.isHeld('b');

    if (this.moving) {
      const staminaStep = stepStamina(this.stamina, {
        dt,
        moving: true,
        sprintHeld,
      });
      this.updateStaminaHud();
      const speed = staminaStep.speed;
      this.moveProgress += dt * speed;
      this.walkAnimTimer += dt * speed;
      if (this.walkAnimTimer >= 0.25) {
        this.walkAnimTimer -= 0.25;
        this.walkFrame = ((this.walkFrame + 1) % 4) as CharacterFrame;
      }

      if (this.moveProgress >= 1) {
        this.moving = false;
        this.moveProgress = 0;
        this.walkFrame = 0;
        this.gridX = this.moveToX;
        this.gridY = this.moveToY;
        this.game.saveData.playerX = this.gridX;
        this.game.saveData.playerY = this.gridY;
        this.game.saveData.playerDir = this.dir;
        this.game.saveData.stats.steps += 1;
        this.syncPlayerVisual();
        if (
          this.atmosphere &&
          this.game.renderer.getQualityTier() !== 'low' &&
          this.game.renderer.areAmbientParticlesEnabled()
        ) {
          const stepCh = this.currentMap.grid[this.gridY]?.[this.gridX] ?? '.';
          const stepTile = this.currentMap.legend[stepCh]?.tile;
          if (stepTile === 'tall_grass') {
            this.atmosphere.spawnStepPuff(
              this.playerMesh.position.x,
              this.playerMesh.position.y,
              this.playerMesh.position.z,
              'grass'
            );
          } else if (staminaStep.sprinting && stepTile !== 'water') {
            const isSnow =
              this.currentMap.snowLine !== undefined &&
              getTileHeightLevel(this.currentMap, this.gridX, this.gridY) >=
                this.currentMap.snowLine;
            this.atmosphere.spawnStepPuff(
              this.playerMesh.position.x,
              this.playerMesh.position.y,
              this.playerMesh.position.z,
              isSnow ? 'snow' : 'dust'
            );
          }
        }
        this.syncBillboardYaw(dt);
        this.updateChunkFrustumCulling(true);
        this.onStepCompleted();
        return;
      }

      this.syncPlayerVisual();
      this.syncBillboardYaw(dt);
      this.game.cameraRig.follow(
        this.playerMesh.position.x,
        this.playerMesh.position.y,
        this.playerMesh.position.z,
        dt,
        this.sampleTerrain
      );
      return;
    }

    stepStamina(this.stamina, { dt, moving: false, sprintHeld });
    this.updateStaminaHud();

    this.walkFrame = 0;
    this.syncPlayerVisual();
    this.syncBillboardYaw(dt);
    this.game.cameraRig.follow(
      this.playerMesh.position.x,
      this.playerMesh.position.y,
      this.playerMesh.position.z,
      dt,
      this.sampleTerrain
    );

    if (this.game.input.justPressed('a')) {
      this.tryInteract();
      return;
    }

    let rawInputDir: Direction | null = null;
    if (this.game.input.isHeld('up')) rawInputDir = 'up';
    else if (this.game.input.isHeld('down')) rawInputDir = 'down';
    else if (this.game.input.isHeld('left')) rawInputDir = 'left';
    else if (this.game.input.isHeld('right')) rawInputDir = 'right';

    if (rawInputDir) {
      const move = cameraRelativeMove(rawInputDir, this.game.cameraRig.getYawStep());
      this.dir = move.dir;
      this.game.saveData.playerDir = move.dir;
      const nx = this.gridX + move.dx;
      const ny = this.gridY + move.dy;
      if (!this.isTileBlocked(nx, ny)) {
        this.moving = true;
        this.moveFromX = this.gridX;
        this.moveFromY = this.gridY;
        this.moveToX = nx;
        this.moveToY = ny;
        this.moveProgress = 0;
      } else {
        this.syncPlayerVisual();
      }
    }
  }

  private onStepCompleted(): void {
    // 0. Evaluate coordinate-triggered quest objective
    this.checkQuestCoordinates();

    // 1. Check trainer line-of-sight before warps so spotted players cannot dodge duels
    const spotted = this.findSpottingTrainer();
    if (spotted && this.game.saveData.party.length > 0) {
      this.triggerTrainerBattle(spotted);
      return;
    }

    // 2. Check warps
    const warp = this.currentMap.warps.find(
      (w) => w.x === this.gridX && w.y === this.gridY
    );
    if (warp) {
      if (warp.houseId && !ownsHouse(this.game.saveData, warp.houseId)) {
        this.promptBuyHouse(warp.houseId, warp);
        return;
      }
      this.startWarpTransition(warp);
      return;
    }

    // 2b. Check hidden pickups on tile
    const hiddenPickup = this.pickups.find(
      (p) => p.hidden && p.x === this.gridX && p.y === this.gridY
    );
    if (hiddenPickup) {
      this.collectPickup(hiddenPickup);
      return;
    }

    // 3. Decrement Repel
    if (this.game.saveData.repelSteps > 0) {
      this.game.saveData.repelSteps -= 1;
      this.updateBadge();
    }

    // 4. Random encounter check
    const ch = this.currentMap.grid[this.gridY]?.[this.gridX] ?? '.';
    const leg = this.currentMap.legend[ch];
    if (
      leg?.encounter &&
      this.currentMap.encounters &&
      this.game.saveData.repelSteps <= 0 &&
      this.game.saveData.party.length > 0
    ) {
      if (this.game.rng.next() < this.currentMap.encounters.rate) {
        this.triggerWildEncounter();
        return;
      }
    }

    // 5. Random overworld event check
    if (
      this.currentMap.encounters &&
      this.game.saveData.repelSteps <= 0 &&
      this.game.saveData.party.length > 0
    ) {
      if (this.game.rng.next() < 0.045) {
        this.triggerRandomEvent();
      }
    }
  }

  private triggerRandomEvent(): void {
    const eventDef = this.game.rng.pick(RANDOM_EVENTS);
    this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
    this.game.startRandomEvent(eventDef);
  }

  private isSightStepClear(observer: RuntimeNpc, fx: number, fy: number, nx: number, ny: number): boolean {
    if (!isTileWalkable(this.currentMap, fx, fy, nx, ny, this.blockedTiles)) {
      return false;
    }
    for (const s of this.currentMap.signs) {
      if (s.x === nx && s.y === ny) return false;
    }
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (!p.hidden && p.mesh?.visible && p.x === nx && p.y === ny) return false;
    }
    for (let i = 0; i < this.npcs.length; i++) {
      const other = this.npcs[i];
      if (other === observer || !other.visible) continue;
      if (other.behavior.gridX === nx && other.behavior.gridY === ny) return false;
    }
    return true;
  }

  private findSpottingTrainer(): RuntimeNpc | null {
    for (const npc of this.npcs) {
      if (!npc.visible || !npc.def.trainerId || !npc.def.sightRange) continue;
      if (this.game.saveData.defeatedTrainers.includes(npc.def.trainerId)) continue;
      const spotted = hasTrainerLineOfSight(
        npc.behavior.gridX,
        npc.behavior.gridY,
        npc.behavior.dir,
        npc.def.sightRange,
        this.gridX,
        this.gridY,
        (fx, fy, nx, ny) => this.isSightStepClear(npc, fx, fy, nx, ny)
      );
      if (spotted) return npc;
    }
    return null;
  }

  private triggerWildEncounter(): void {
    const table = this.currentMap.encounters;
    if (!table || table.entries.length === 0) return;

    const phase = getTimePhase(this.game.saveData.worldClockMinutes);
    const entries = filterEncountersByTime(table.entries, phase);
    if (entries.length === 0) return;

    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    let roll = this.game.rng.next() * totalWeight;
    let picked = entries[0];
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) {
        picked = entry;
        break;
      }
    }

    const level = this.game.rng.int(picked.minLevel, picked.maxLevel);
    const wild = createCreature(picked.speciesId, level, this.game.rng);

    this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
    this.game.startBattle({
      enemyParty: [wild],
      biome: this.currentMap.biome,
      onDone: (outcome) => {
        if (outcome === 'lose') {
          this.handleBlackout();
        } else {
          if (outcome === 'win' || outcome === 'caught') {
            this.game.saveGame();
          }
          this.refreshSideQuestMarkers();
        }
      },
    });
  }

  private triggerTrainerBattle(runtimeNpc: RuntimeNpc): void {
    const npc = runtimeNpc.def;
    if (!npc.trainerId) return;
    engageNpcLook(
      runtimeNpc.behavior,
      this.gridX,
      this.gridY,
      Boolean(npc.lookAtPlayerAfterTalk)
    );
    this.syncBillboardYaw(0);
    const trainer = getTrainer(npc.trainerId);
    const enemyParty = trainer.party.map((spec) =>
      createCreature(spec.speciesId, spec.level, this.game.rng)
    );

    this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
    this.game.dialog.show(trainer.introText, () => {
      this.game.startBattle({
        enemyParty,
        trainer,
        biome: this.currentMap.biome,
        onDone: (outcome) => {
          if (outcome === 'win') {
            if (!this.game.saveData.defeatedTrainers.includes(trainer.id)) {
              this.game.saveData.defeatedTrainers.push(trainer.id);
            }
            if (trainer.setsFlag) {
              this.game.saveData.flags[trainer.setsFlag] = true;
            }
            const lootMsg = this.awardTrainerContainerLoot(trainer.isBoss || trainer.isRival);
            this.refreshNpcVisibility();
            this.updateBadge();
            this.game.saveGame();
            if (lootMsg) {
              this.game.showToast(lootMsg);
            }

            this.game.dialog.show(trainer.defeatText, () => {
              if (trainer.isFinalBoss) {
                this.game.bus.emit('audio:music', { track: 'victory' });
                this.game.endingModal.open(
                  this.game.saveData,
                  () => {
                    this.game.bus.emit('audio:music', { track: this.currentMap.music });
                  },
                  () => {
                    this.game.startTitle();
                  }
                );
              }
            });
          } else if (outcome === 'lose') {
            this.handleBlackout();
          }
        },
      });
    });
  }

  private recordHealPoint(): void {
    this.game.saveData.lastHealPoint = {
      mapId: this.currentMap.id,
      x: this.gridX,
      y: this.gridY,
      dir: this.dir,
    };
  }

  private handleBlackout(): void {
    healPartyFull(this.game.saveData.party);
    const hp = this.game.saveData.lastHealPoint;
    const targetMap = hp && MAPS[hp.mapId] ? hp.mapId : 'villa_origen';
    const targetX = hp && MAPS[hp.mapId] ? hp.x : 24;
    const targetY = hp && MAPS[hp.mapId] ? hp.y : 26;
    const targetDir = hp && MAPS[hp.mapId] ? hp.dir : 'up';
    this.loadMap(targetMap, targetX, targetY, targetDir, true);
    this.game.dialog.show(ES.battle.blackoutWake);
  }

  private tryInteract(): void {
    const deltas: Record<Direction, [number, number]> = {
      up: [0, -1],
      down: [0, 1],
      left: [-1, 0],
      right: [1, 0],
    };
    const [dx, dy] = deltas[this.dir];
    const tx = this.gridX + dx;
    const ty = this.gridY + dy;

    const sign = this.currentMap.signs.find((s) => s.x === tx && s.y === ty);
    if (sign) {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      const text = (ES.dialogs as Record<string, unknown>)[sign.textKey];
      if (typeof text === 'string') {
        this.game.dialog.show(text);
      }
      return;
    }

    const pickup = this.pickups.find(
      (p) => !p.hidden && p.mesh?.visible && p.x === tx && p.y === ty
    );
    if (pickup) {
      this.collectPickup(pickup);
      return;
    }

    const npc = this.npcs.find(
      (n) =>
        n.visible &&
        ((n.behavior.gridX === tx && n.behavior.gridY === ty) ||
          (n.behavior.moving && n.behavior.moveToX === tx && n.behavior.moveToY === ty))
    );
    if (npc) {
      this.interactNpc(npc);
      return;
    }

    const prop = this.currentMap.props.find((p) => p.x === tx && p.z === ty);
    if (prop) {
      this.interactProp(prop.kind);
    }
  }

  private startWarpTransition(warp: WarpDef): void {
    this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
    this.pendingWarp = {
      targetMap: warp.targetMap,
      targetX: warp.targetX,
      targetY: warp.targetY,
      dir: warp.dir ?? this.dir,
    };
    this.warpPhase = 'out';
    this.warpTimer = 0;
  }

  private promptBuyHouse(houseId: string, enterWarp?: WarpDef): void {
    const house = getHouse(houseId);
    this.game.bus.emit('audio:sfx', { sfx: 'menu' });
    this.game.dialog.show(
      ES.housing.forSalePrompt(house.name, house.price, house.cityName),
      undefined,
      [
        {
          label: ES.housing.buyBtn(house.price),
          onSelect: () => {
            const res = buyHouse(this.game.saveData, houseId);
            if (!res.ok) {
              this.game.dialog.show(ES.housing.noMoney(house.price));
              return;
            }
            this.game.bus.emit('audio:sfx', { sfx: 'quest_reward' });
            this.updateBadge();
            this.game.saveGame();
            this.game.showToast(`¡Compraste ${house.name}!`);
            this.game.dialog.show(ES.housing.boughtMsg(house.name), () => {
              if (enterWarp) {
                this.startWarpTransition(enterWarp);
              }
            });
          },
        },
        { label: ES.housing.laterBtn, onSelect: () => {} },
      ]
    );
  }

  private interactProp(kind: PropKind): void {
    if (kind === 'bed') {
      healPartyFull(this.game.saveData.party);
      this.recordHealPoint();
      this.game.bus.emit('audio:sfx', { sfx: 'heal' });
      this.game.saveGame();
      this.game.dialog.show(ES.dialogs.bed_rest);
      return;
    }
    if (kind === 'chest') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.game.chestScreen.open(
        this.game.saveData,
        () => {},
        () => {
          this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
          this.game.saveGame();
        }
      );
      return;
    }
    if (kind === 'achievements_wall') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.game.achievementsScreen.open(this.game.saveData, () => {});
      return;
    }
    if (kind === 'stove') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.game.dialog.show(ES.dialogs.stove_flavor);
      return;
    }
    if (kind === 'bookshelf') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.game.dialog.show(ES.dialogs.bookshelf_flavor);
      return;
    }
    if (kind === 'sofa') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.game.dialog.show(ES.dialogs.sofa_flavor);
      return;
    }
    if (kind === 'dining_table') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.game.dialog.show(ES.dialogs.table_flavor);
      return;
    }
    if (kind === 'forge_hearth') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.openWorkshop('forja');
      return;
    }
    if (kind === 'anvil_bench' || kind === 'doll_worktable') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.openWorkshop('creacion');
      return;
    }
    if (kind === 'blueprint_desk') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.openWorkshop('piezas');
      return;
    }
    if (kind === 'mannequin_rack') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.game.dialog.show(ES.dialogs.mannequin_rack_flavor, undefined, [
        {
          label: 'Ver Stock de Cuerpos',
          onSelect: () => {
            this.openWorkshop('cuerpos');
          },
        },
        { label: 'Cerrar', onSelect: () => {} },
      ]);
      return;
    }
    if (kind === 'skill_altar') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.openSkillAcademy('movimientos');
      return;
    }
    if (kind === 'training_dummy') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.openSkillAcademy('atributos');
      return;
    }
    if (kind === 'lab_console') {
      this.game.bus.emit('audio:sfx', { sfx: 'menu' });
      this.game.dialog.show(ES.dialogs.lab_console_prompt, undefined, [
        {
          label: 'Abrir Grimorio (Bestiario)',
          onSelect: () => {
            this.game.bestiaryScreen.open(this.game.saveData, () => {});
          },
        },
        {
          label: 'Leer Informe del Laboratorio',
          onSelect: () => {
            this.game.dialog.show(ES.dialogs.lab_console_notes);
          },
        },
        { label: 'Cerrar', onSelect: () => {} },
      ]);
    }
  }

  private collectPickup(pickup: RuntimePickup): void {
    this.pickups = this.pickups.filter((p) => p.id !== pickup.id);
    if (pickup.mesh) {
      pickup.mesh.visible = false;
      this.scene.remove(pickup.mesh);
    }
    if (!this.game.saveData.collectedPickups.includes(pickup.id)) {
      this.game.saveData.collectedPickups.push(pickup.id);
    }
    addItem(this.game.saveData.bag, pickup.itemId, pickup.quantity);
    this.game.bus.emit('audio:sfx', { sfx: 'levelup' });
    this.game.saveGame();
    const itemName = getItem(pickup.itemId).name;
    this.game.dialog.show(`¡Encontraste ${pickup.quantity}× ${itemName}!`);
  }

  private awardTrainerContainerLoot(isMajor?: boolean): string {
    const pool = ALL_CONTAINER_IDS.filter((id) => id !== 'cuerpo_aprendiz');
    const cid = pool.length > 0 ? this.game.rng.pick(pool) : 'cuerpo_aprendiz';
    const def = getBodyContainer(cid);
    if (isMajor) {
      addVessel(this.game.saveData, cid, 1);
      addItem(this.game.saveData.bag, 'fragmento_alma', 1);
      return `Botín: 1× ${def.name} y 1× Fragmento de Alma`;
    }
    const res = addBodyPartShard(this.game.saveData, cid, 2);
    if (res.assembledCount > 0) {
      return `Botín: ¡Ensamblaste 1× ${def.name}!`;
    }
    return `Botín: +2 piezas de ${def.name} (${res.currentShards}/${SHARDS_PER_CONTAINER})`;
  }

  private interactNpc(runtimeNpc: RuntimeNpc): void {
    const npc = runtimeNpc.def;
    this.game.bus.emit('audio:sfx', { sfx: 'confirm' });

    if (!runtimeNpc.isPedestal) {
      engageNpcLook(
        runtimeNpc.behavior,
        this.gridX,
        this.gridY,
        Boolean(npc.lookAtPlayerAfterTalk)
      );
      this.syncBillboardYaw(0);
    }

    if (npc.starterIndex !== undefined) {
      if (this.game.saveData.flags.starter_chosen) {
        this.game.dialog.show(ES.dialogs.starter_already);
        return;
      }
      const speciesId = STARTER_IDS[npc.starterIndex];
      const spec = getSpecies(speciesId);
      const typeLabel = ES.types[spec.types[0]];
      this.game.dialog.show(
        ES.dialogs.starter_prompt(spec.name, typeLabel),
        undefined,
        [
          {
            label: '¡Elegir!',
            onSelect: () => {
              const starter = createCreature(speciesId, 5, this.game.rng);
              addToParty(this.game.saveData.party, starter);
              this.game.markSpeciesCaught(speciesId, 5, true);
              this.game.saveData.flags.starter_chosen = true;
              addItem(this.game.saveData.bag, 'capsula', 2);
              this.refreshNpcVisibility();
              this.game.bus.emit('audio:sfx', { sfx: 'levelup' });
              this.game.saveGame();
              this.game.dialog.show(ES.dialogs.starter_chosen(spec.name));
            },
          },
          { label: 'Luego', onSelect: () => {} },
        ]
      );
      return;
    }

    if (npc.trainerId) {
      if (this.game.saveData.defeatedTrainers.includes(npc.trainerId)) {
        const trainer = getTrainer(npc.trainerId);
        this.game.dialog.show(
          trainer.isBoss ? ES.dialogs.leader_after : trainer.defeatText
        );
      } else if (this.game.saveData.party.length === 0) {
        this.game.dialog.show(ES.dialogs.prof_welcome);
      } else {
        this.triggerTrainerBattle(runtimeNpc);
      }
      return;
    }

    if (npc.shopStock) {
      this.game.dialog.show(ES.dialogs.merchant_mateo, () => {
        this.game.openShop(npc.shopStock!, () => {
          this.updateBadge();
        });
      });
      return;
    }

    if (npc.houseBrokerId) {
      const house = getHouse(npc.houseBrokerId);
      if (ownsHouse(this.game.saveData, npc.houseBrokerId)) {
        this.game.dialog.show(ES.housing.alreadyOwnedGreeting(house.name));
      } else {
        this.promptBuyHouse(npc.houseBrokerId);
      }
      return;
    }

    if (npc.healOnTalk) {
      if (npc.id === 'prof_robledo') {
        if (!this.game.saveData.flags.starter_chosen) {
          this.game.saveData.flags.prof_intro_talked = true;
          this.game.dialog.show(ES.dialogs.prof_welcome);
          return;
        }
        const claimable = getClaimableMilestones(this.game.saveData);
        if (claimable.length > 0) {
          const m = claimBestiaryMilestone(this.game.saveData, claimable[0].id);
          if (m) {
            const label = `${m.count} ${m.kind === 'caught' ? 'capturadas' : 'vistas'}`;
            const itemName = getItem(m.rewardItemId).name;
            this.game.bus.emit('audio:sfx', { sfx: 'levelup' });
            this.updateBadge();
            this.game.saveGame();
            this.game.dialog.show(
              ES.dialogs.prof_milestone_reward(label, itemName, m.rewardQty, m.rewardMoney)
            );
            return;
          }
        }
        healPartyFull(this.game.saveData.party);
        this.recordHealPoint();
        this.game.bus.emit('audio:sfx', { sfx: 'heal' });
        this.game.saveGame();
        this.game.dialog.show(ES.dialogs.prof_healed);
        return;
      }

      if (npc.id === 'arena_heal') {
        healPartyFull(this.game.saveData.party);
        this.recordHealPoint();
        this.game.bus.emit('audio:sfx', { sfx: 'heal' });
        this.game.saveGame();
        this.game.dialog.show(ES.dialogs.heal_machine_use);
        return;
      }

      this.game.dialog.show(ES.dialogs.healer_menu, undefined, [
        {
          label: 'Curar equipo',
          onSelect: () => {
            healPartyFull(this.game.saveData.party);
            this.recordHealPoint();
            this.game.bus.emit('audio:sfx', { sfx: 'heal' });
            this.game.saveGame();
            const msg =
              ((ES.dialogs as Record<string, unknown>)[npc.dialogKey] as string) ??
              ES.dialogs.healer_clara;
            this.game.dialog.show(msg);
          },
        },
        {
          label: 'Cajas PC',
          onSelect: () => {
            this.game.storageScreen.open(this.game.saveData, () => {
              this.game.saveGame();
            });
          },
        },
        { label: 'Salir', onSelect: () => {} },
      ]);
      return;
    }

    if (npc.id === 'taller_asistente_iris') {
      this.game.dialog.show(ES.dialogs.iris_workshop_greeting, undefined, [
        {
          label: 'Reparar SoulDolls (PS y PP)',
          onSelect: () => {
            healPartyFull(this.game.saveData.party);
            this.recordHealPoint();
            this.game.bus.emit('audio:sfx', { sfx: 'heal' });
            this.game.saveGame();
            this.game.dialog.show(ES.dialogs.iris_healed);
          },
        },
        {
          label: 'Mesa de Creación y Almas',
          onSelect: () => {
            this.openWorkshop('creacion');
          },
        },
        {
          label: 'Piezas y Desmantelado',
          onSelect: () => {
            this.openWorkshop('piezas');
          },
        },
        { label: 'Salir', onSelect: () => {} },
      ]);
      return;
    }

    if (npc.id === 'taller_maestra_lyra') {
      this.game.dialog.show(ES.dialogs.lyra_workshop_greeting, undefined, [
        {
          label: 'Forjar Técnicas y Movimientos',
          onSelect: () => {
            this.openSkillAcademy('movimientos');
          },
        },
        {
          label: 'Despertar Habilidades Pasivas',
          onSelect: () => {
            this.openSkillAcademy('pasivas');
          },
        },
        {
          label: 'Entrenar Atributos (EV / IV)',
          onSelect: () => {
            this.openSkillAcademy('atributos');
          },
        },
        {
          label: 'Comercio de MT y Tónicos',
          onSelect: () => {
            this.openSkillShop();
          },
        },
        {
          label: '¿Cómo se aprenden habilidades?',
          onSelect: () => {
            this.game.dialog.show(ES.dialogs.lyra_skill_guide, () => {
              this.openSkillAcademy('fuentes');
            });
          },
        },
        { label: 'Salir', onSelect: () => {} },
      ]);
      return;
    }

    if (npc.id === 'artesano_gael') {
      const sideState = getSideQuestForNpc(npc.id, this.game.saveData);
      if (sideState && sideState.status === 'active' && sideState.progress.ready) {
        const reward = completeSideQuest(this.game.saveData, sideState.quest.id);
        if (reward) {
          this.game.bus.emit('audio:sfx', { sfx: 'quest_reward' });
          this.updateBadge();
          this.refreshSideQuestMarkers();
          this.game.saveGame();
          this.game.dialog.show(sideState.quest.completeDialogue, () => {
            this.game.showToast(
              `Recompensa: +${reward.rewardGold} Oro y ${reward.blueprint.name}`
            );
          });
          return;
        }
      }

      const gaelChoices: Array<{ label: string; onSelect: () => void }> = [];
      if (sideState && sideState.status === 'available') {
        gaelChoices.push({
          label: '¡Aceptar misión de forja!',
          onSelect: () => {
            if (acceptSideQuest(this.game.saveData, sideState.quest.id)) {
              this.game.bus.emit('audio:sfx', { sfx: 'quest_accept' });
              this.refreshSideQuestMarkers();
              this.game.saveGame();
              this.game.showToast(`Misión aceptada: ${sideState.quest.title}`);
            }
          },
        });
      }
      gaelChoices.push(
        {
          label: 'Abrir Fragua y Planos',
          onSelect: () => {
            this.openWorkshop('forja');
          },
        },
        {
          label: 'Crear / Moldear Cuerpos',
          onSelect: () => {
            this.openWorkshop('creacion');
          },
        }
      );
      if (sideState && sideState.status === 'active') {
        gaelChoices.push({
          label: 'Progreso de misión',
          onSelect: () => {
            this.game.dialog.show(`${sideState.quest.progressDialogue} (${sideState.progress.label})`);
          },
        });
      } else {
        gaelChoices.push({
          label: '¿Qué es la Resonancia?',
          onSelect: () => {
            this.game.dialog.show(ES.dialogs.gael_resonance_tip);
          },
        });
      }
      gaelChoices.push({ label: 'Salir', onSelect: () => {} });

      this.game.dialog.show(
        sideState?.status === 'available' ? sideState.quest.offerDialogue : ES.dialogs.artesano_gael,
        undefined,
        gaelChoices
      );
      return;
    }

    const sideState = getSideQuestForNpc(npc.id, this.game.saveData);
    if (sideState) {
      const { quest, status, progress } = sideState;
      if (status === 'active' && progress.ready) {
        const reward = completeSideQuest(this.game.saveData, quest.id);
        if (reward) {
          this.game.bus.emit('audio:sfx', { sfx: 'quest_reward' });
          this.updateBadge();
          this.refreshSideQuestMarkers();
          this.game.saveGame();
          this.game.dialog.show(quest.completeDialogue, () => {
            this.game.showToast(
              `Recompensa: +${reward.rewardGold} Oro y ${reward.blueprint.name}`
            );
          });
          return;
        }
      }
      if (status === 'available') {
        this.game.dialog.show(quest.offerDialogue, undefined, [
          {
            label: '¡Aceptar misión!',
            onSelect: () => {
              if (acceptSideQuest(this.game.saveData, quest.id)) {
                this.game.bus.emit('audio:sfx', { sfx: 'quest_accept' });
                this.refreshSideQuestMarkers();
                this.game.saveGame();
                this.game.showToast(`Misión aceptada: ${quest.title}`);
              }
            },
          },
          { label: 'Más tarde', onSelect: () => {} },
        ]);
        return;
      }
      if (status === 'active') {
        this.game.dialog.show(`${quest.progressDialogue} (${progress.label})`);
        return;
      }
      if (status === 'completed') {
        this.game.dialog.show(quest.afterDialogue);
        return;
      }
    }

    if (npc.id === VILLA_GUIDE_NPC_ID || npc.id === LAB_GUIDE_NPC_ID) {
      if (this.game.saveData.flags.starter_chosen) {
        this.game.dialog.show(ES.dialogs.guide_after_starter);
      } else if (npc.id === LAB_GUIDE_NPC_ID) {
        this.game.dialog.show(ES.dialogs.guide_choose_starter);
      } else if (this.game.saveData.flags.prof_intro_talked) {
        this.game.dialog.show(ES.dialogs.guide_remind_starter);
      } else {
        this.game.dialog.show(ES.dialogs.guide_remind_prof);
      }
      return;
    }

    const dialogText = (ES.dialogs as Record<string, unknown>)[npc.dialogKey];
    if (typeof dialogText === 'string') {
      this.game.dialog.show(dialogText);
    }
  }

  private openPauseMenu(): void {
    this.game.bus.emit('audio:sfx', { sfx: 'menu' });
    this.game.menu.open(this.game.saveData, {
      onParty: () => {
        this.game.partyScreen.open(
          this.game.saveData.party,
          { kind: 'manage', bag: this.game.saveData.bag, save: this.game.saveData },
          () => {
            this.game.saveGame();
          }
        );
      },
      onBag: () => {
        this.openOverworldBag();
      },
      onVessels: () => {
        this.openWorkshop('forja');
      },
      onBestiary: () => {
        this.game.bestiaryScreen.open(this.game.saveData, () => {});
      },
      onCards: () => {
        this.game.cardAlbumScreen.open(
          this.game.saveData,
          () => {},
          () => {
            this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
            this.game.saveGame();
          }
        );
      },
      onQuests: () => {
        this.openQuestJournal();
      },
      onSpriteInspector: () => {
        this.game.spriteInspectorModal.open(() => {});
      },
      onSave: () => {
        const ok = this.game.saveGame();
        if (ok) this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
        return ok;
      },
      onOptionsChanged: () => {
        this.game.applyOptions();
        this.game.persistOptions();
      },
      onClose: () => {},
      slotLabel: this.game.getCurrentSlotLabel(),
    });
  }

  private openWorkshop(initialTab: WorkshopTab = 'forja'): void {
    this.game.vesselScreen.open(
      this.game.saveData,
      this.game.rng,
      () => {
        this.updateBadge();
        this.game.saveGame();
      },
      () => {},
      () => {
        this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
      },
      initialTab
    );
  }

  private openSkillAcademy(initialTab: SkillAcademyTab = 'movimientos'): void {
    this.game.skillAcademyScreen.open(
      this.game.saveData,
      () => {
        this.updateBadge();
        this.game.saveGame();
      },
      () => {},
      () => {
        this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
      },
      initialTab,
      () => {
        this.openSkillShop();
      }
    );
  }

  private openSkillShop(): void {
    this.game.openShop(TALLER_SKILL_SHOP_STOCK, () => {
      this.updateBadge();
      this.game.saveGame();
    });
  }

  private openOverworldBag(): void {
    this.game.bagScreen.open(
      this.game.saveData.bag,
      false,
      (itemId) => {
        const item = getItem(itemId);
        if (item.arGacha) {
          this.game.arGachaModal.open(
            this.game.saveData,
            this.game.rng,
            () => {
              this.updateBadge();
              this.game.saveGame();
            },
            () => {
              this.openOverworldBag();
            }
          );
          return;
        }
        if (item.repelSteps) {
          removeItem(this.game.saveData.bag, itemId, 1);
          this.game.saveData.repelSteps += item.repelSteps;
          this.updateBadge();
          this.game.dialog.show(ES.bag.repelActivated);
          return;
        }
        if (item.escape) {
          removeItem(this.game.saveData.bag, itemId, 1);
          this.game.dialog.show(ES.bag.escapeUsed, () => {
            this.loadMap('villa_origen', 24, 26, 'up', true);
          });
          return;
        }
        if (
          item.category === 'medicine' ||
          item.category === 'tm' ||
          item.category === 'stone' ||
          item.category === 'held'
        ) {
          this.game.partyScreen.open(
            this.game.saveData.party,
            {
              kind: 'item_target',
              onPick: (partyIndex) => {
                const creature = this.game.saveData.party[partyIndex];
                if (item.category === 'tm') {
                  const res = applyTmToCreature(itemId, creature);
                  const dollName = getCreatureDisplayName(creature);
                  if (res.applied) {
                    removeItem(this.game.saveData.bag, itemId, 1);
                    this.game.bus.emit('audio:sfx', { sfx: 'levelup' });
                    this.game.saveGame();
                    this.game.dialog.show(
                      ES.battle.learnedMove(dollName, res.moveName ?? item.name)
                    );
                    return;
                  }
                  if (res.reason === 'need_slot') {
                    const moveName = res.moveName ?? item.name;
                    this.game.dialog.show(
                      ES.battle.wantsToLearn(dollName, moveName),
                      undefined,
                      [
                        ...creature.moves.map((slot, sIdx) => ({
                          label: `Olvidar ${getMove(slot.moveId).name}`,
                          onSelect: () => {
                            const rep = applyTmToCreature(itemId, creature, sIdx);
                            if (rep.applied) {
                              removeItem(this.game.saveData.bag, itemId, 1);
                              this.game.bus.emit('audio:sfx', { sfx: 'levelup' });
                              this.game.saveGame();
                              this.game.dialog.show(
                                ES.battle.forgotAndLearned(
                                  dollName,
                                  rep.replacedMoveName ?? '',
                                  rep.moveName ?? moveName
                                )
                              );
                            }
                          },
                        })),
                        { label: ES.battle.skipMove, onSelect: () => {} },
                      ]
                    );
                    return;
                  }
                  if (res.reason === 'incompatible') {
                    this.game.dialog.show(
                      `${dollName} no tiene afinidad para aprender ${item.name}. Graba la Runa Elemental correspondiente en el Taller.`
                    );
                    return;
                  }
                  this.game.dialog.show(
                    `${dollName} ya conoce ${res.moveName ?? item.name}.`
                  );
                  return;
                }
                if (item.category === 'held') {
                  if (equipHeldItem(this.game.saveData.bag, creature, itemId)) {
                    this.game.bus.emit('audio:sfx', { sfx: 'confirm' });
                    this.game.dialog.show(
                      ES.bag.equippedItem(item.name, getCreatureDisplayName(creature))
                    );
                  }
                  return;
                }
                if (item.category === 'stone') {
                  const targetId = checkItemEvolution(creature, itemId);
                  if (targetId === null) {
                    this.game.dialog.show(ES.bag.noEffect);
                    return;
                  }
                  removeItem(this.game.saveData.bag, itemId, 1);
                  this.game.startEvolution(partyIndex, targetId, (evolved) => {
                    if (!evolved) {
                      addItem(this.game.saveData.bag, itemId, 1);
                    } else {
                      this.game.saveGame();
                    }
                    this.updateBadge();
                  });
                  return;
                }
                const applied = applyMedicineToCreature(itemId, creature);
                if (!applied.applied) {
                  this.game.dialog.show(ES.bag.noEffect);
                  return;
                }
                removeItem(this.game.saveData.bag, itemId, 1);
                this.game.bus.emit('audio:sfx', { sfx: 'heal' });
                this.game.saveGame();
                if (applied.addedEv && applied.vitaminStat) {
                  this.game.dialog.show(
                    `¡${getCreatureDisplayName(creature)} ganó +${applied.addedEv} EV en ${ES.stats[applied.vitaminStat]}!`
                  );
                  return;
                }
                this.game.dialog.show(
                  `${ES.bag.usedItem(item.name)} (${getCreatureDisplayName(creature)})`
                );
              },
              onCancel: () => {
                this.openOverworldBag();
              },
            },
            () => {}
          );
        }
      },
      () => {},
      this.game.saveData.soulDust ?? 0,
      {
        party: this.game.saveData.party,
        money: this.game.saveData.money,
        repelSteps: this.game.saveData.repelSteps,
      }
    );
  }

  private updateChunkFrustumCulling(force = false): void {
    if (this.chunks.length === 0) return;
    const cam = this.game.cameraRig.camera;
    const aspect = cam.aspect;
    const moved =
      force ||
      this._lastCullGridX !== this.gridX ||
      this._lastCullGridY !== this.gridY ||
      this._lastCullAspect !== aspect ||
      this._lastCullCamPos.distanceToSquared(cam.position) > 1e-5 ||
      1 - Math.abs(this._lastCullCamQuat.dot(cam.quaternion)) > 1e-5;
    if (!moved) return;

    cam.updateMatrixWorld();
    this._chunkProjScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._chunkFrustum.setFromProjectionMatrix(this._chunkProjScreen);
    updateVisibleTerrainChunks(
      this.chunks,
      this.gridX,
      this.gridY,
      48,
      this._chunkFrustum
    );

    this._lastCullGridX = this.gridX;
    this._lastCullGridY = this.gridY;
    this._lastCullAspect = aspect;
    this._lastCullCamPos.copy(cam.position);
    this._lastCullCamQuat.copy(cam.quaternion);
  }

  render(alpha = 1): void {
    if (this.game.renderer.isContextLost()) return;
    this.applyInterpolatedVisuals(alpha);
    this.updateChunkFrustumCulling();
    this.postFx.setQualityTier(this.game.renderer.getQualityTier());
    this.postFx.setPixelEffect(this.game.renderer.isPixelEffectEnabled());
    this.postFx.setPostFxOptions(this.game.renderer.getPostFxOptions());
    this.postFx.render();
  }

  onPause(): void {
    this.restoreVisualSnapshot();
    this.game.touchControls.setCameraTouchEnabled(false);
    this.game.touchControls.setCameraHandlers(null);
  }

  onExit(): void {
    this.game.touchControls.setCameraTouchEnabled(false);
    this.game.touchControls.setCameraHandlers(null);
    this.hud.unmount(this.game.uiLayers);
    this.sunLight?.shadow.map?.dispose();
    this.sunLight = null;
    this.postFx.dispose();
    this.mapDisposables.disposeAll();
    this.persistentDisposables.disposeAll();
  }
}
