import { getBodyContainer } from '../data/containers.ts';
import { addVessel, ensureSaveVesselState } from './BodyParts.ts';
import type { SaveData } from './types.ts';

export interface CraftingBlueprintDef {
  id: string;
  name: string;
  containerId: string;
  craftGoldCost: number;
  description: string;
}

export const CRAFTING_BLUEPRINTS: Record<string, CraftingBlueprintDef> = {
  plano_aprendiz: {
    id: 'plano_aprendiz',
    name: 'Plano: Cuerpo Madera Ki',
    containerId: 'cuerpo_aprendiz',
    craftGoldCost: 220,
    description: 'Receta básica del taller para tallar un Cuerpo Madera Ki equilibrado.',
  },
  plano_maga: {
    id: 'plano_maga',
    name: 'Plano: Armazón de Maga',
    containerId: 'cuerpo_maga',
    craftGoldCost: 400,
    description: 'Permite forjar el Armazón de Maga (cabeza rúnica +30%) en Cuerpos por 400 Oro.',
  },
  plano_priest: {
    id: 'plano_priest',
    name: 'Plano: Relicario Priest',
    containerId: 'cuerpo_priest',
    craftGoldCost: 400,
    description: 'Permite forjar el Relicario Priest (flujo vital sagrado) en Cuerpos por 400 Oro.',
  },
  plano_paladin: {
    id: 'plano_paladin',
    name: 'Plano: Armadura Paladín',
    containerId: 'cuerpo_paladin',
    craftGoldCost: 650,
    description: 'Permite forjar la Armadura Paladín (torso 45% + defensa física) por 650 Oro.',
  },
  plano_bruja: {
    id: 'plano_bruja',
    name: 'Plano: Maniquí Witch',
    containerId: 'cuerpo_bruja',
    craftGoldCost: 600,
    description: 'Permite forjar el Maniquí Witch (afinidad Común/Umbra) en Cuerpos por 600 Oro.',
  },
  plano_asesina: {
    id: 'plano_asesina',
    name: 'Plano: Bastidor Céfiro',
    containerId: 'cuerpo_asesina',
    craftGoldCost: 680,
    description: 'Plano de taller para ensamblar el Bastidor Céfiro de extremidades ágiles.',
  },
  plano_automata: {
    id: 'plano_automata',
    name: 'Plano: Autómata de Bronce',
    containerId: 'cuerpo_automata',
    craftGoldCost: 900,
    description: 'Plano artesanal del Autómata de Bronce con núcleo Chispa/Roca/Común.',
  },
  plano_titan: {
    id: 'plano_titan',
    name: 'Plano: Coloso de Obsidiana',
    containerId: 'cuerpo_titan',
    craftGoldCost: 1200,
    description: 'Plano maestro para forjar el Coloso de Obsidiana (épico, 50% torso) por 1200 Oro.',
  },
};

export const ALL_BLUEPRINT_IDS = Object.keys(CRAFTING_BLUEPRINTS);

export function getBlueprint(id: string): CraftingBlueprintDef {
  return CRAFTING_BLUEPRINTS[id] ?? CRAFTING_BLUEPRINTS.plano_maga;
}

export type SideQuestStatus = 'locked' | 'available' | 'active' | 'completed';

export interface SideQuestProgress {
  current: number;
  target: number;
  ready: boolean;
  label: string;
}

export interface SideQuestDef {
  id: string;
  title: string;
  description: string;
  giverNpcId: string;
  giverName: string;
  mapId: string;
  offerDialogue: string;
  progressDialogue: string;
  completeDialogue: string;
  afterDialogue: string;
  rewardGold: number;
  rewardBlueprintId: string;
  unlockRequirementText?: string;
  isUnlocked: (save: SaveData) => boolean;
  evaluateProgress: (save: SaveData) => SideQuestProgress;
}

export const SIDE_QUESTS: readonly SideQuestDef[] = [
  {
    id: 'sq_lazos_origen',
    title: 'Primeros Lazos',
    description:
      'Habla con el Prof. Robledo para elegir tu SoulDoll inicial y sella al menos 2 SoulDolls distintas en tu aventura.',
    giverNpcId: 'aldeano_origen',
    giverName: 'Vecina Alba',
    mapId: 'villa_origen',
    offerDialogue:
      '¡Eh, viajero! Quiero comprobar si el antiguo taller de marionetas aún responde. Elige tu SoulDoll inicial y sella 2 SoulDolls distintas. ¡Si lo logras te daré Oro y un Plano de crafteo!',
    progressDialogue:
      'Aún te falta completar el registro. Recuerda sellar 2 especies distintas de SoulDoll y vuelve a verme.',
    completeDialogue:
      '¡Increíble, ya dominas el vínculo de almas! Toma tu bolsa de Oro y este Plano de crafteo para el taller.',
    afterDialogue:
      '¡Con ese Plano de Maga podrás forjar nuevos armazones cuando lo necesites en el menú de Cuerpos!',
    rewardGold: 300,
    rewardBlueprintId: 'plano_maga',
    isUnlocked: () => true,
    evaluateProgress: (save) => {
      const current = save.caughtSpecies.length;
      const target = 2;
      const ready = Boolean(save.flags.starter_chosen) && current >= target;
      return {
        current: Math.min(current, target),
        target,
        ready,
        label: `SoulDolls registradas: ${Math.min(current, target)}/${target}`,
      };
    },
  },
  {
    id: 'sq_archivo_bruma',
    title: 'Cartas del Despertar',
    description:
      'Gana 3 combates y obtén al menos 2 Cartas SoulDoll distintas para el archivo histórico de Pueblo Bruma.',
    giverNpcId: 'bruma_npc_1',
    giverName: 'Sabio Tomás',
    mapId: 'pueblo_bruma',
    offerDialogue:
      'Estudio las Cartas que dejan caer las SoulDolls en combate. Gana 3 batallas y reúne 2 Cartas distintas para completar mi tesis. ¡Tengo Oro y un Plano sagrado para ti!',
    progressDialogue:
      'Sigue combatiendo contra marionetas salvajes o entrenadores hasta reunir 2 Cartas distintas y 3 victorias.',
    completeDialogue:
      '¡Esas Cartas confirman mi teoría sobre la resonancia del Ki! Aquí tienes tu Oro y el Plano Relicario Priest.',
    afterDialogue:
      'Engarza tus Cartas desde el Álbum y aprovecha el Relicario Priest para reforzar tus equipos.',
    rewardGold: 450,
    rewardBlueprintId: 'plano_priest',
    unlockRequirementText: 'Elige tu SoulDoll inicial con el Prof. Robledo',
    isUnlocked: (save) => Boolean(save.flags.starter_chosen),
    evaluateProgress: (save) => {
      const cards = Object.keys(save.cardAlbum ?? {}).length;
      const wins = save.stats?.battlesWon ?? 0;
      const cardDone = Math.min(cards, 2);
      const winDone = Math.min(wins, 3);
      const ready = cards >= 2 && wins >= 3;
      return {
        current: cardDone + winDone,
        target: 5,
        ready,
        label: `Cartas: ${cardDone}/2 · Victorias: ${winDone}/3`,
      };
    },
  },
  {
    id: 'sq_paso_montana',
    title: 'Centinelas del Paso',
    description:
      'Despeja la Ruta 2 venciendo a la Guardabosques Elena y al Chispero Nico para asegurar el paso a Cueva Eco.',
    giverNpcId: 'bruma_npc_2',
    giverName: 'Guía Nora',
    mapId: 'pueblo_bruma',
    offerDialogue:
      'El paso al este hacia Ruta 2 está custodiado por Elena y Nico. Si logras derrotarlos en combate, la ruta quedará abierta y te recompensaré con Oro y el Plano de Paladín.',
    progressDialogue:
      'Elena y Nico vigilan los senderos de la Ruta 2. Vuelve cuando hayas vencido a ambos Soultrainers.',
    completeDialogue:
      '¡Excelente combate! Ahora el paso montañoso es seguro. Acepta este Oro y el Plano de Armadura Paladín.',
    afterDialogue:
      'Con la Armadura Paladín tus SoulDolls resistirán hasta los golpes más duros de Cueva Eco.',
    rewardGold: 600,
    rewardBlueprintId: 'plano_paladin',
    unlockRequirementText: 'Completa la misión: Primeros Lazos',
    isUnlocked: (save) => (save.completedSideQuests ?? []).includes('sq_lazos_origen'),
    evaluateProgress: (save) => {
      const elena = save.defeatedTrainers.includes('ruta2_guarda') ? 1 : 0;
      const nico = save.defeatedTrainers.includes('ruta2_chispero') ? 1 : 0;
      const current = elena + nico;
      return {
        current,
        target: 2,
        ready: current >= 2,
        label: `Entrenadores de Ruta 2 vencidos: ${current}/2`,
      };
    },
  },
  {
    id: 'sq_forja_gael',
    title: 'Maestría de Forja',
    description:
      'Reúne 4 especies de SoulDolls capturadas y suma 5 victorias en combate para probar la forja avanzada.',
    giverNpcId: 'artesano_gael',
    giverName: 'Artesano Gael',
    mapId: 'taller_origen',
    offerDialogue:
      'Soy Gael, el maestro forjador del Taller de Marionetas. Si reúnes 4 SoulDolls distintas y alcanzas 5 victorias en batalla, compartiré contigo mi Oro de reserva y el Plano del Maniquí Witch.',
    progressDialogue:
      'La forja exige experiencia real. Completa las 4 capturas y 5 victorias antes de regresar.',
    completeDialogue:
      '¡Templado a la perfección! Recibe este Oro y el Plano del Maniquí Witch para potenciar tus almas arcanas.',
    afterDialogue:
      'Puedes forjar todos los armazones de tus Planos directamente desde la pestaña Piezas y Forja de Cuerpos.',
    rewardGold: 750,
    rewardBlueprintId: 'plano_bruja',
    unlockRequirementText: 'Completa la misión: Cartas del Despertar',
    isUnlocked: (save) => (save.completedSideQuests ?? []).includes('sq_archivo_bruma'),
    evaluateProgress: (save) => {
      const caught = Math.min(save.caughtSpecies.length, 4);
      const wins = Math.min(save.stats?.battlesWon ?? 0, 5);
      const ready = caught >= 4 && wins >= 5;
      return {
        current: caught + wins,
        target: 9,
        ready,
        label: `Capturas: ${caught}/4 · Victorias: ${wins}/5`,
      };
    },
  },
  {
    id: 'sq_ecos_profundos',
    title: 'Ecos de la Cumbre',
    description:
      'Demuestra tu temple en la Arena Cumbre alcanzando 6 victorias totales y venciendo a la Discípula Sofía.',
    giverNpcId: 'arena_guide_npc',
    giverName: 'Árbitro Leo',
    mapId: 'liga_cumbre',
    offerDialogue:
      'Antes de desafiar a la Líder Valeria, supera la prueba del atrio: vence a la Discípula Sofía y acumula 6 victorias. ¡Te espera una fortuna en Oro y el Plano maestro del Coloso de Obsidiana!',
    progressDialogue:
      'Sofía te aguarda al centro de la arena. Derrota a tu rival y completa tus 6 victorias.',
    completeDialogue:
      '¡Honor y gloria! Toma esta bolsa de Oro y el Plano legendario del Coloso de Obsidiana.',
    afterDialogue:
      'Ahora sí estás listo para enfrentar a la Líder Valeria en lo más alto de Arena Cumbre.',
    rewardGold: 1200,
    rewardBlueprintId: 'plano_titan',
    unlockRequirementText: 'Completa la misión: Centinelas del Paso',
    isUnlocked: (save) => (save.completedSideQuests ?? []).includes('sq_paso_montana'),
    evaluateProgress: (save) => {
      const sofia = save.defeatedTrainers.includes('arena_discipulo') ? 1 : 0;
      const wins = Math.min(save.stats?.battlesWon ?? 0, 6);
      const ready = sofia === 1 && wins >= 6;
      return {
        current: sofia + wins,
        target: 7,
        ready,
        label: `Discípula Sofía: ${sofia}/1 · Victorias: ${wins}/6`,
      };
    },
  },
];

export function ensureSaveSideQuestState(save: SaveData): void {
  if (!Array.isArray(save.activeSideQuests)) save.activeSideQuests = [];
  if (!Array.isArray(save.completedSideQuests)) save.completedSideQuests = [];
  if (!Array.isArray(save.blueprints)) save.blueprints = [];
}

export function getSideQuest(id: string): SideQuestDef | undefined {
  return SIDE_QUESTS.find((q) => q.id === id);
}

export function getSideQuestStatus(quest: SideQuestDef, save: SaveData): SideQuestStatus {
  const completed = save.completedSideQuests ?? [];
  if (completed.includes(quest.id)) return 'completed';
  const active = save.activeSideQuests ?? [];
  if (active.includes(quest.id)) return 'active';
  return quest.isUnlocked(save) ? 'available' : 'locked';
}

export function getSideQuestProgress(
  quest: SideQuestDef,
  save: SaveData
): SideQuestProgress {
  return quest.evaluateProgress(save);
}

export interface NpcSideQuestState {
  quest: SideQuestDef;
  status: SideQuestStatus;
  progress: SideQuestProgress;
  marker: '!' | '?' | null;
}

export function getSideQuestForNpc(
  npcId: string,
  save: SaveData
): NpcSideQuestState | null {
  const candidates = SIDE_QUESTS.filter((q) => q.giverNpcId === npcId);
  if (candidates.length === 0) return null;

  for (const quest of candidates) {
    const status = getSideQuestStatus(quest, save);
    const progress = quest.evaluateProgress(save);
    if (status === 'active') {
      return { quest, status, progress, marker: progress.ready ? '?' : null };
    }
    if (status === 'available') {
      return { quest, status, progress, marker: '!' };
    }
  }

  const last = candidates[candidates.length - 1];
  return {
    quest: last,
    status: getSideQuestStatus(last, save),
    progress: last.evaluateProgress(save),
    marker: null,
  };
}

export function acceptSideQuest(save: SaveData, questId: string): boolean {
  ensureSaveSideQuestState(save);
  const quest = getSideQuest(questId);
  if (!quest) return false;
  const status = getSideQuestStatus(quest, save);
  if (status !== 'available') return false;
  save.activeSideQuests!.push(questId);
  return true;
}

export interface SideQuestCompletionReward {
  quest: SideQuestDef;
  rewardGold: number;
  blueprint: CraftingBlueprintDef;
}

export function completeSideQuest(
  save: SaveData,
  questId: string
): SideQuestCompletionReward | null {
  ensureSaveSideQuestState(save);
  const quest = getSideQuest(questId);
  if (!quest) return null;
  if (getSideQuestStatus(quest, save) !== 'active') return null;

  const progress = quest.evaluateProgress(save);
  if (!progress.ready) return null;

  save.activeSideQuests = save.activeSideQuests!.filter((id) => id !== questId);
  if (!save.completedSideQuests!.includes(questId)) {
    save.completedSideQuests!.push(questId);
  }
  save.money += quest.rewardGold;
  if (!save.blueprints!.includes(quest.rewardBlueprintId)) {
    save.blueprints!.push(quest.rewardBlueprintId);
  }

  return {
    quest,
    rewardGold: quest.rewardGold,
    blueprint: getBlueprint(quest.rewardBlueprintId),
  };
}

export function craftContainerFromBlueprint(
  save: SaveData,
  blueprintId: string
): { ok: boolean; reason?: 'locked' | 'no_money'; containerName?: string } {
  ensureSaveSideQuestState(save);
  ensureSaveVesselState(save);
  const bp = CRAFTING_BLUEPRINTS[blueprintId];
  if (!bp || !save.blueprints!.includes(blueprintId)) {
    return { ok: false, reason: 'locked' };
  }
  if (save.money < bp.craftGoldCost) {
    return { ok: false, reason: 'no_money' };
  }
  save.money -= bp.craftGoldCost;
  addVessel(save, bp.containerId, 1);
  return {
    ok: true,
    containerName: getBodyContainer(bp.containerId).name,
  };
}
