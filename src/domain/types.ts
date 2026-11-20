export type CreatureType =
  | 'brasa'
  | 'marea'
  | 'flora'
  | 'chispa'
  | 'roca'
  | 'brisa'
  | 'umbra'
  | 'comun';

export type StatName = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type BattleStatName = 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface StatStages {
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export type StatusCondition = 'none' | 'burn' | 'poison' | 'paralysis' | 'sleep';
export type MoveCategory = 'physical' | 'special' | 'status';
export type TimePhase = 'morning' | 'day' | 'dusk' | 'night';
export type BattleWeather = 'none' | 'sun' | 'rain' | 'sandstorm' | 'snow';

export interface MoveEffect {
  kind:
    | 'none'
    | 'status'
    | 'stat_stage'
    | 'drain'
    | 'recoil'
    | 'flinch'
    | 'heal'
    | 'burn_flinch'
    | 'multi_hit'
    | 'trap'
    | 'protect'
    | 'leech'
    | 'confuse'
    | 'fixed_damage'
    | 'weather';
  status?: Exclude<StatusCondition, 'none'>;
  weather?: Exclude<BattleWeather, 'none'>;
  weatherTurns?: number;
  chance?: number;
  target?: 'self' | 'enemy';
  stages?: Partial<StatStages>;
  drainRatio?: number;
  recoilRatio?: number;
  healRatio?: number;
  minHits?: number;
  maxHits?: number;
  fixedAmount?: number;
}

export interface MoveDef {
  id: string;
  name: string;
  type: CreatureType;
  category: MoveCategory;
  power: number;
  accuracy: number;
  pp: number;
  priority: number;
  critRatio?: number;
  effect: MoveEffect;
  description: string;
}

export type GrowthRate = 'fast' | 'medium' | 'slow';

export type CreatureArchetype =
  | 'blob'
  | 'quadruped'
  | 'bird'
  | 'serpent'
  | 'biped'
  | 'insect'
  | 'plant'
  | 'golem'
  | 'fish'
  | 'shell'
  | 'wyrm'
  | 'canine'
  | 'moth'
  | 'fungus'
  | 'crystal'
  | 'wisp';

export type CreatureFeature =
  | 'ears'
  | 'horns'
  | 'tail'
  | 'wings'
  | 'flame'
  | 'leaves';

export type HabitatTag = 'meadow' | 'forest' | 'coast' | 'snow' | 'cave' | 'mountain';

export interface LearnsetEntry {
  level: number;
  moveId: string;
}

export type EvolutionRule =
  | { method: 'level'; level: number; targetSpeciesId: number }
  | { method: 'item'; itemId: string; targetSpeciesId: number }
  | { method: 'knows_move'; moveId: string; targetSpeciesId: number }
  | { method: 'level_held'; level: number; itemId: string; targetSpeciesId: number };

export interface AbilityHooks {
  onEntry?: {
    enemyStat?: { stat: BattleStatName; delta: number };
    selfStat?: { stat: BattleStatName; delta: number };
  };
  modifyOutgoingDamage?: {
    type?: CreatureType;
    multiplier: number;
    requiresLowHp?: boolean;
  };
  modifyIncomingDamage?: {
    immuneType?: CreatureType;
    healRatioOnImmune?: number;
    resistMultiplier?: number;
    superEffectiveOnly?: boolean;
  };
  onContactHit?: {
    retaliateRatio?: number;
    status?: Exclude<StatusCondition, 'none'>;
    statusChance?: number;
  };
  onStatusAttempt?: {
    immuneStatuses: Array<Exclude<StatusCondition, 'none'>>;
  };
  onTurnEnd?: {
    healRatio?: number;
  };
  onLowHp?: {
    thresholdRatio: number;
    boostType?: CreatureType;
    damageMultiplier?: number;
    healRatioOnce?: number;
  };
  modifyStat?: {
    stat: BattleStatName;
    multiplier: number;
    requiresStatus?: boolean;
  };
  priorityBoost?: {
    category?: MoveCategory;
    delta: number;
  };
}

export interface AbilityDef {
  id: string;
  name: string;
  description: string;
  hooks: AbilityHooks;
}

export interface HeldItemHooks {
  onTurnEnd?: {
    healRatio: number;
  };
  onDamageTaken?: {
    surviveOneHit?: boolean;
  };
  onHpThreshold?: {
    thresholdRatio: number;
    healRatio?: number;
    cureStatus?: boolean;
  };
  modifyDamage?: {
    type?: CreatureType;
    multiplier: number;
  };
  modifyStat?: {
    stat: BattleStatName;
    multiplier: number;
  };
  consumable?: boolean;
}

export type DollWeaponKind =
  | 'staff'
  | 'scepter'
  | 'sword_shield'
  | 'wand'
  | 'trident'
  | 'spear'
  | 'daggers'
  | 'scythe'
  | 'hammer'
  | 'bow'
  | 'grimoire'
  | 'orb';

export type BodyPartName = 'head' | 'torso' | 'arms' | 'legs';

export interface BodyPartRatios {
  head: number;
  torso: number;
  arms: number;
  legs: number;
}

export interface BodyPartHp {
  current: number;
  max: number;
}

export type BodyPartsHp = Record<BodyPartName, BodyPartHp>;

export interface BodyContainerDef {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic';
  price: number;
  affinityTypes: CreatureType[];
  ratios: BodyPartRatios;
  description: string;
  accentColor: string;
}

export interface VesselCalibration {
  focusPart?: BodyPartName;
  temperLevel?: number;
  affinityOverride?: CreatureType;
}

export interface CapturedSoul {
  uid: string;
  speciesId: number;
  level: number;
  caughtAt: number;
  soulpotId: string;
}

export interface SpeciesDef {
  id: number;
  name: string;
  types: [CreatureType] | [CreatureType, CreatureType];
  baseStats: Stats;
  growthRate: GrowthRate;
  catchRate: number;
  baseXpYield: number;
  abilities: string[];
  habitats?: HabitatTag[];
  learnset: LearnsetEntry[];
  evolutions: EvolutionRule[];
  archetype: CreatureArchetype;
  features: CreatureFeature[];
  stage: 1 | 2 | 3;
  dollClass?: string;
  weapon?: DollWeaponKind;
  description: string;
}

export interface MoveSlot {
  moveId: string;
  pp: number;
  maxPp: number;
}

export interface CreatureInstance {
  uid: string;
  speciesId: number;
  nickname?: string;
  level: number;
  xp: number;
  ivs: Stats;
  evBonuses?: Partial<Stats>;
  stats: Stats;
  currentHp: number;
  containerId?: string;
  vesselCalibration?: VesselCalibration;
  bodyParts?: BodyPartsHp;
  status: StatusCondition;
  sleepTurns: number;
  abilityId?: string;
  unlockedAbilities?: string[];
  unlockedTalents?: string[];
  ascensionRank?: number;
  heldItemId?: string;
  socketedCardId?: number;
  socketedCardBonuses?: Partial<Stats>;
  moves: MoveSlot[];
}

export type ItemCategory =
  | 'medicine'
  | 'capsule'
  | 'stone'
  | 'utility'
  | 'held'
  | 'battle'
  | 'tm'
  | 'key';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  price: number;
  description: string;
  minBadges?: number;
  healHp?: number;
  healFull?: boolean;
  healPp?: number;
  curesStatus?: StatusCondition | 'all';
  revive?: boolean;
  reviveFull?: boolean;
  catchMultiplier?: number;
  catchCondition?: 'water_coast' | 'cave_night' | 'first_turn';
  healOnCatch?: boolean;
  repelSteps?: number;
  escape?: boolean;
  heldHooks?: HeldItemHooks;
  boostStat?: Partial<StatStages>;
  guardStatDrop?: boolean;
  vitaminStat?: StatName;
  rareCandy?: boolean;
  tmMoveId?: string;
  keyEffect?: 'skateboard';
  arGacha?: boolean;
  treasure?: boolean;
  iconShape?: 'potion' | 'pill' | 'capsule' | 'stone' | 'berry' | 'charm' | 'gear' | 'disc' | 'gem' | 'utility';
  iconColor?: string;
  iconAccent?: string;
}

export interface BagSlot {
  itemId: string;
  quantity: number;
}

export type BestiaryState = 'unseen' | 'seen' | 'caught';

export interface BestiaryEntry {
  state: BestiaryState;
  firstLocation?: string;
  timesCaught: number;
  highestLevel: number;
}

export interface StorageBox {
  name: string;
  slots: (CreatureInstance | null)[];
}

export type CardRarity = 'comun' | 'rara' | 'epica' | 'legendaria';

export interface CardEntry {
  speciesId: number;
  count: number;
  firstObtainedAt: number;
  rarityOverride?: CardRarity;
  upgradeLevel?: number;
}

export interface CardDef {
  speciesId: number;
  name: string;
  title: string;
  rarity: CardRarity;
  types: [CreatureType] | [CreatureType, CreatureType];
  description: string;
  bonuses: Partial<Stats>;
}

export type Direction = 'down' | 'up' | 'left' | 'right';

export type CharacterFrame = 0 | 1 | 2 | 3;

export type CharacterRole =
  | 'player'
  | 'rival'
  | 'professor'
  | 'healer'
  | 'merchant'
  | 'trainer'
  | 'leader'
  | 'artisan'
  | 'scholar'
  | 'npc';

export type TileKind =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'cobble'
  | 'sand'
  | 'water'
  | 'planks'
  | 'log'
  | 'leaves'
  | 'flowers'
  | 'tall_grass'
  | 'snow'
  | 'cave_floor'
  | 'stairs'
  | 'bridge'
  | 'arena_floor';

export type AtlasPropKind = `atlas_${string}`;

export type PropKind =
  | AtlasPropKind
  | 'oak'
  | 'pine'
  | 'birch'
  | 'snow_pine'
  | 'mushroom_tree'
  | 'mushroom_tree_arcane'
  | 'bush'
  | 'bush_arcane'
  | 'flower_patch'
  | 'tall_grass_clump'
  | 'tall_grass_flower'
  | 'boulder'
  | 'stump'
  | 'mushroom'
  | 'fence'
  | 'lamp_post'
  | 'lamp_wood'
  | 'lamp_double'
  | 'lamp_stone'
  | 'sign'
  | 'well'
  | 'crystal'
  | 'capsule_pedestal'
  | 'heal_machine'
  | 'pillar'
  | 'bench'
  | 'cave_entrance'
  | 'bed'
  | 'chest'
  | 'achievements_wall'
  | 'sofa'
  | 'dining_table'
  | 'kitchen_counter'
  | 'stove'
  | 'bookshelf'
  | 'house_plant'
  | 'stair_up'
  | 'stair_down'
  | 'forge_hearth'
  | 'anvil_bench'
  | 'doll_worktable'
  | 'mannequin_rack'
  | 'blueprint_desk'
  | 'skill_altar'
  | 'training_dummy'
  | 'lab_console';

export type BuildingKind =
  | 'house_red'
  | 'house_blue'
  | 'lab'
  | 'center'
  | 'shop'
  | 'arena_hall'
  | 'workshop';

export interface BuildingPlacement {
  kind: BuildingKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  facing: Direction;
}

export interface PropPlacementDef {
  kind: PropKind;
  x: number;
  z: number;
}

export interface DecorationDensity {
  seed: number;
  treeDensity: number;
  bushDensity: number;
  flowerDensity: number;
  rockDensity: number;
  mushroomDensity: number;
  treeKinds: PropKind[];
}

export interface NpcPatrolDef {
  waypoints?: Array<{ x: number; y: number }>;
  radius?: number;
  speed?: number;
  pauseSec?: number;
}

export interface NpcDef {
  id: string;
  name: string;
  role: CharacterRole;
  x: number;
  y: number;
  dir: Direction;
  dialogKey: string;
  trainerId?: string;
  sightRange?: number;
  starterIndex?: number;
  healOnTalk?: boolean;
  shopStock?: string[];
  flagRequired?: string;
  flagHidden?: string;
  patrol?: NpcPatrolDef;
  lookAtPlayerAfterTalk?: boolean;
  staticEncounter?: { speciesId: number; level: number; flagOnEnd: string };
  houseBrokerId?: string;
}

export interface WarpDef {
  x: number;
  y: number;
  targetMap: string;
  targetX: number;
  targetY: number;
  dir?: Direction;
  requiredBadges?: number;
  houseId?: string;
  doorStyle?: 'gate' | 'building' | 'interior';
}

export interface SignDef {
  x: number;
  y: number;
  textKey: string;
}

export interface PickupDef {
  id: string;
  x: number;
  y: number;
  itemId: string;
  quantity?: number;
  hidden?: boolean;
}

export interface BadgeGateDef {
  x: number;
  y: number;
  requiredBadges: number;
}

export interface EncounterEntry {
  speciesId: number;
  minLevel: number;
  maxLevel: number;
  weight: number;
  timeOfDay?: TimePhase[];
}

export interface EncounterTable {
  rate: number;
  entries: EncounterEntry[];
}

export interface EncounterZoneDef {
  x: number;
  y: number;
  width: number;
  height: number;
  table: EncounterTable;
}

export interface TileLegendEntry {
  tile: TileKind;
  solid: boolean;
  prop?: PropKind;
  encounter?: boolean;
  ramp?: boolean;
}

export type BattleBiome = 'meadow' | 'forest' | 'mountain' | 'cave' | 'arena' | 'coast' | 'snow';

export interface MapDef {
  id: string;
  nameKey: string;
  biome: BattleBiome;
  music: 'town' | 'route' | 'cave';
  isInterior?: boolean;
  skyTopColor: number;
  skyBottomColor: number;
  fogColor: number;
  snowLine?: number;
  grid: string[];
  heights: string[];
  legend: Record<string, TileLegendEntry>;
  buildings: BuildingPlacement[];
  props: PropPlacementDef[];
  decoration: DecorationDensity;
  warps: WarpDef[];
  npcs: NpcDef[];
  signs: SignDef[];
  pickups?: PickupDef[];
  badgeGates?: BadgeGateDef[];
  encounters?: EncounterTable;
  encounterZones?: EncounterZoneDef[];
}

export interface TrainerCreatureSpec {
  speciesId: number;
  level: number;
}

export interface TrainerDef {
  id: string;
  name: string;
  title: string;
  role: CharacterRole;
  rewardMoney: number;
  introText: string;
  defeatText: string;
  isBoss?: boolean;
  isRival?: boolean;
  isLeague?: boolean;
  awardsBadge?: string;
  party: TrainerCreatureSpec[];
  setsFlag?: string;
}

export type BattleAction =
  | { type: 'move'; moveIndex: number }
  | { type: 'switch'; partyIndex: number }
  | { type: 'item'; itemId: string; targetPartyIndex?: number }
  | { type: 'run' };

/** Volatile battle data belongs to an individual combatant, not its whole party. */
export interface BattleCombatantState {
  stages: StatStages;
  flinched: boolean;
  confusedTurns: number;
  trappedTurns: number;
  leechSeeded: boolean;
  protected: boolean;
  statDropGuarded: boolean;
  lowHpBerryUsed: boolean;
}

export interface BattleSideState {
  party: CreatureInstance[];
  activeIndex: number;
  /** Runtime formation slots. Empty/undefined keeps the legacy single-active behavior. */
  activeIndices?: number[];
  /** Per-creature volatile state; legacy side fields remain during the staged migration. */
  combatants?: Record<string, BattleCombatantState>;
  stages: StatStages;
  flinched: boolean;
  confusedTurns?: number;
  trappedTurns?: number;
  leechSeeded?: boolean;
  protected?: boolean;
  statDropGuarded?: boolean;
  lowHpBerryUsed?: boolean;
}

export interface BattleState {
  isWild: boolean;
  biome?: BattleBiome;
  weather: BattleWeather;
  weatherTurns: number;
  trainer?: TrainerDef;
  player: BattleSideState;
  enemy: BattleSideState;
  turnCount: number;
  runAttempts: number;
  finished: boolean;
  outcome?: 'win' | 'lose' | 'caught' | 'ran';
}

export type BattleEvent =
  | { type: 'text'; message: string }
  | { type: 'move_use'; side: 'player' | 'enemy'; moveId: string; moveName: string; actorUid?: string; actorPartyIndex?: number }
  | { type: 'miss'; side: 'player' | 'enemy' }
  | {
      type: 'damage';
      target: 'player' | 'enemy';
      amount: number;
      hpAfter: number;
      maxHp: number;
      effectiveness: number;
      crit: boolean;
      damagedPart?: BodyPartName;
      partBroken?: BodyPartName;
      targetUid?: string;
      targetPartyIndex?: number;
    }
  | {
      type: 'heal';
      target: 'player' | 'enemy';
      amount: number;
      hpAfter: number;
      maxHp: number;
    }
  | { type: 'status_apply'; target: 'player' | 'enemy'; status: Exclude<StatusCondition, 'none'> }
  | {
      type: 'status_tick';
      target: 'player' | 'enemy';
      status: Exclude<StatusCondition, 'none'>;
      damage: number;
      hpAfter: number;
      maxHp: number;
    }
  | { type: 'status_clear'; target: 'player' | 'enemy'; status: Exclude<StatusCondition, 'none'> }
  | {
      type: 'stat_change';
      target: 'player' | 'enemy';
      stat: BattleStatName;
      delta: number;
    }
  | { type: 'flinch'; target: 'player' | 'enemy' }
  | {
      type: 'ability_triggered';
      side: 'player' | 'enemy';
      abilityId: string;
      abilityName: string;
      message?: string;
    }
  | {
      type: 'held_item_triggered';
      side: 'player' | 'enemy';
      itemId: string;
      itemName: string;
      consumed?: boolean;
    }
  | { type: 'faint'; target: 'player' | 'enemy'; creatureName: string }
  | { type: 'switch_out'; side: 'player' | 'enemy'; creatureName: string }
  | { type: 'switch_in'; side: 'player' | 'enemy'; partyIndex: number; creature: CreatureInstance }
  | { type: 'catch_attempt'; itemId: string; shakes: number; caught: boolean; speciesId: number }
  | { type: 'xp_gain'; partyIndex: number; amount: number; xpAfter: number }
  | { type: 'level_up'; partyIndex: number; newLevel: number; creature: CreatureInstance }
  | { type: 'learn_move_prompt'; partyIndex: number; moveId: string }
  | { type: 'evolution_ready'; partyIndex: number; targetSpeciesId: number }
  | { type: 'card_drop'; speciesId: number; creatureName: string }
  | { type: 'weather_change'; weather: BattleWeather; turns: number }
  | {
      type: 'weather_tick';
      weather: Exclude<BattleWeather, 'none'>;
      target: 'player' | 'enemy';
      damage: number;
      hpAfter: number;
      maxHp: number;
    }
  | { type: 'run_success' }
  | { type: 'run_fail' }
  | { type: 'battle_end'; outcome: 'win' | 'lose' | 'caught' | 'ran'; rewardMoney: number };

export type GraphicsQualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type CameraMode = 'fixed' | 'free_orbit';
export type CameraLabProfileId = 'A' | 'B' | 'C';

export interface CameraLabConfig {
  fov: number;
  distance: number;
  height: number;
}

export type CameraLabProfiles = Record<CameraLabProfileId, CameraLabConfig>;

export interface GameOptions {
  volume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  batterySaver: boolean;
  pixelEffect: boolean;
  graphicsQuality: GraphicsQualitySetting;
  shadows: boolean;
  ambientParticles: boolean;
  bloom: boolean;
  bloomIntensity: number;
  tiltShift: boolean;
  colorGrading: boolean;
  vignette: boolean;
  textSpeed: 'normal' | 'fast';
  cameraMode: CameraMode;
  cameraLabEnabled: boolean;
  cameraLabConfig: CameraLabConfig;
  cameraLabProfiles: CameraLabProfiles;
  cameraLabActiveProfile: CameraLabProfileId;
}

export interface PlayStats {
  battlesWon: number;
  creaturesCaught: number;
  steps: number;
  playTimeSec: number;
}

export interface HealPoint {
  mapId: string;
  x: number;
  y: number;
  dir: Direction;
}

export interface SaveData {
  version: number;
  mapId: string;
  playerX: number;
  playerY: number;
  playerDir: Direction;
  lastHealPoint?: HealPoint;
  worldClockMinutes?: number;
  money: number;
  repelSteps: number;
  party: CreatureInstance[];
  bag: BagSlot[];
  seenSpecies: number[];
  caughtSpecies: number[];
  bestiary: Record<number, BestiaryEntry>;
  claimedBestiaryMilestones: string[];
  storageBoxes: StorageBox[];
  badges: string[];
  collectedPickups: string[];
  champion?: boolean;
  defeatedTrainers: string[];
  flags: Record<string, boolean>;
  questIndex?: number;
  activeSideQuests?: string[];
  completedSideQuests?: string[];
  blueprints?: string[];
  vessels?: Record<string, number>;
  bodyPartShards?: Record<string, number>;
  soulReserve?: CapturedSoul[];
  cardAlbum?: Record<number, CardEntry>;
  soulDust?: number;
  ownedHouses?: string[];
  itemChest?: BagSlot[];
  cardChest?: Record<number, CardEntry>;
  soulChest?: CapturedSoul[];
  stats: PlayStats;
  options: GameOptions;
  savedAt: number;
}
