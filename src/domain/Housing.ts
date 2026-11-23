import {
  CARD_RARITY_ORDER,
  computeCardBonusesForRarity,
  MAX_CARD_STAT_UPGRADE_LEVEL,
} from '../data/cards.ts';
import { getBodyContainer } from '../data/containers.ts';
import { ITEMS } from '../data/items.ts';
import { getSpecies, SPECIES } from '../data/species.ts';
import {
  ensureCardAlbum,
  getAvailableCardCopies,
  getCardDef,
  syncSocketedCreaturesForCard,
} from './Cards.ts';
import { addItem, removeItem } from './Inventory.ts';
import { depositCreature, STORAGE_BOX_COUNT, withdrawCreature } from './Storage.ts';
import type {
  BagSlot,
  CapturedSoul,
  CardDef,
  CardEntry,
  CardRarity,
  SaveData,
} from './types.ts';

export interface HouseDef {
  id: string;
  name: string;
  cityMapId: string;
  cityName: string;
  price: number;
  floor1MapId: string;
  floor2MapId: string;
  exteriorDoorX: number;
  exteriorDoorY: number;
  description: string;
}

export const ALL_HOUSES: readonly HouseDef[] = [
  {
    id: 'casa_villa',
    name: 'Cabaña de Villa Origen',
    cityMapId: 'villa_origen',
    cityName: 'Villa Origen',
    price: 1,
    floor1MapId: 'casa_villa_pb',
    floor2MapId: 'casa_villa_hab',
    exteriorDoorX: 31,
    exteriorDoorY: 34,
    description:
      'Tu primera base junto a Villa Origen, con sala de estar, cocina y habitación superior.',
  },
  {
    id: 'casa_bruma',
    name: 'Residencia de Pueblo Bruma',
    cityMapId: 'pueblo_bruma',
    cityName: 'Pueblo Bruma',
    price: 1,
    floor1MapId: 'casa_bruma_pb',
    floor2MapId: 'casa_bruma_hab',
    exteriorDoorX: 36,
    exteriorDoorY: 12,
    description:
      'Acogedora vivienda en la terraza alta de Pueblo Bruma, conectada a tu cofre compartido.',
  },
  {
    id: 'casa_cumbre',
    name: 'Refugio de Arena Cumbre',
    cityMapId: 'arena_cumbre',
    cityName: 'Arena Cumbre',
    price: 1,
    floor1MapId: 'casa_cumbre_pb',
    floor2MapId: 'casa_cumbre_hab',
    exteriorDoorX: 38,
    exteriorDoorY: 25,
    description:
      'Refugio alpino junto a la gran arena para descansar y preparar tu equipo final.',
  },
];

const HOUSE_BY_ID = new Map<string, HouseDef>(ALL_HOUSES.map((h) => [h.id, h]));

export function isValidHouseId(houseId: string): boolean {
  return HOUSE_BY_ID.has(houseId);
}

export function getHouse(houseId: string): HouseDef {
  const found = HOUSE_BY_ID.get(houseId);
  if (!found) {
    throw new Error(`Unknown house id: ${houseId}`);
  }
  return found;
}

function sanitizeCardEntryMap(rawMap: unknown, fallbackTimestamp: number): Record<number, CardEntry> {
  const clean: Record<number, CardEntry> = {};
  if (!rawMap || typeof rawMap !== 'object') return clean;
  for (const [k, v] of Object.entries(rawMap as Record<string, unknown>)) {
    const id = Number(k);
    if (!Number.isFinite(id) || !SPECIES[id] || !v || typeof v !== 'object') continue;
    const e = v as Partial<CardEntry>;
    const count = typeof e.count === 'number' && Number.isFinite(e.count) && e.count > 0
      ? Math.floor(e.count)
      : 0;
    if (count <= 0) continue;
    const rarityOverride =
      typeof e.rarityOverride === 'string' &&
      CARD_RARITY_ORDER.includes(e.rarityOverride as CardRarity)
        ? (e.rarityOverride as CardRarity)
        : undefined;
    const upgradeLevel =
      typeof e.upgradeLevel === 'number' && Number.isFinite(e.upgradeLevel) && e.upgradeLevel > 0
        ? Math.min(MAX_CARD_STAT_UPGRADE_LEVEL, Math.floor(e.upgradeLevel))
        : 0;
    const entry: CardEntry = {
      speciesId: id,
      count,
      firstObtainedAt:
        typeof e.firstObtainedAt === 'number' && Number.isFinite(e.firstObtainedAt)
          ? e.firstObtainedAt
          : fallbackTimestamp,
    };
    if (rarityOverride) entry.rarityOverride = rarityOverride;
    if (upgradeLevel > 0) entry.upgradeLevel = upgradeLevel;
    clean[id] = entry;
  }
  return clean;
}

function sanitizeSoulList(rawList: unknown): CapturedSoul[] {
  if (!Array.isArray(rawList)) return [];
  const seenUids = new Set<string>();
  const clean: CapturedSoul[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Partial<CapturedSoul>;
    if (
      typeof s.uid !== 'string' ||
      !s.uid ||
      typeof s.speciesId !== 'number' ||
      !SPECIES[s.speciesId] ||
      typeof s.level !== 'number' ||
      !Number.isFinite(s.level)
    ) {
      continue;
    }
    if (seenUids.has(s.uid)) continue;
    seenUids.add(s.uid);
    clean.push({
      uid: s.uid,
      speciesId: s.speciesId,
      level: Math.max(1, Math.min(100, Math.floor(s.level))),
      caughtAt: typeof s.caughtAt === 'number' && Number.isFinite(s.caughtAt) ? s.caughtAt : Date.now(),
      soulpotId: typeof s.soulpotId === 'string' && s.soulpotId ? s.soulpotId : 'capsula',
    });
  }
  return clean;
}

export function ensureHousingState(save: SaveData): void {
  if (!Array.isArray(save.ownedHouses)) {
    save.ownedHouses = [];
  } else {
    save.ownedHouses = Array.from(
      new Set(save.ownedHouses.filter((id) => typeof id === 'string' && HOUSE_BY_ID.has(id)))
    );
  }

  if (!Array.isArray(save.itemChest)) {
    save.itemChest = [];
  } else {
    const merged: BagSlot[] = [];
    for (const raw of save.itemChest) {
      if (!raw || typeof raw.itemId !== 'string' || typeof raw.quantity !== 'number') continue;
      if (!ITEMS[raw.itemId] || raw.quantity <= 0) continue;
      addItem(merged, raw.itemId, Math.floor(raw.quantity));
    }
    save.itemChest = merged;
  }

  const ts = typeof save.savedAt === 'number' ? save.savedAt : Date.now();
  save.cardChest = sanitizeCardEntryMap(save.cardChest, ts);
  save.soulChest = sanitizeSoulList(save.soulChest);
  if (!Array.isArray(save.soulReserve)) {
    save.soulReserve = [];
  }
}

export function ownsHouse(save: SaveData, houseId: string): boolean {
  ensureHousingState(save);
  return save.ownedHouses!.includes(houseId);
}

export function getOwnedHousesCount(save: SaveData): number {
  ensureHousingState(save);
  return save.ownedHouses!.length;
}

export function buyHouse(
  save: SaveData,
  houseId: string
): { ok: boolean; reason?: 'already_owned' | 'not_enough_money' | 'unknown'; house?: HouseDef } {
  ensureHousingState(save);
  const house = HOUSE_BY_ID.get(houseId);
  if (!house) {
    return { ok: false, reason: 'unknown' };
  }
  if (save.ownedHouses!.includes(houseId)) {
    return { ok: false, reason: 'already_owned', house };
  }
  if (save.money < house.price) {
    return { ok: false, reason: 'not_enough_money', house };
  }
  save.money -= house.price;
  save.ownedHouses!.push(houseId);
  return { ok: true, house };
}

export function depositItemToChest(
  save: SaveData,
  itemId: string,
  quantity = 1
): boolean {
  ensureHousingState(save);
  const qty = Math.max(1, Math.floor(quantity));
  const bagSlot = save.bag.find((s) => s.itemId === itemId);
  if (!bagSlot || bagSlot.quantity < qty) return false;
  if (!removeItem(save.bag, itemId, qty)) return false;
  addItem(save.itemChest!, itemId, qty);
  return true;
}

export function withdrawItemFromChest(
  save: SaveData,
  itemId: string,
  quantity = 1
): boolean {
  ensureHousingState(save);
  const qty = Math.max(1, Math.floor(quantity));
  const chestSlot = save.itemChest!.find((s) => s.itemId === itemId);
  if (!chestSlot || chestSlot.quantity < qty) return false;
  if (!removeItem(save.itemChest!, itemId, qty)) return false;
  addItem(save.bag, itemId, qty);
  return true;
}

export function getChestTotalItems(save: SaveData): number {
  ensureHousingState(save);
  return save.itemChest!.reduce((acc, slot) => acc + slot.quantity, 0);
}

function pickHigherRarity(a?: CardRarity, b?: CardRarity): CardRarity | undefined {
  if (!a) return b;
  if (!b) return a;
  return CARD_RARITY_ORDER.indexOf(a) >= CARD_RARITY_ORDER.indexOf(b) ? a : b;
}

export function getChestCardEffectiveDef(
  save: SaveData,
  speciesId: number
): CardDef & { upgradeLevel: number } {
  ensureHousingState(save);
  const base = getCardDef(speciesId);
  const spec = getSpecies(speciesId);
  const entry = save.cardChest?.[speciesId];
  const rarity =
    entry?.rarityOverride && CARD_RARITY_ORDER.includes(entry.rarityOverride)
      ? entry.rarityOverride
      : base.rarity;
  const upgradeLevel = Math.max(
    0,
    Math.min(MAX_CARD_STAT_UPGRADE_LEVEL, Math.floor(entry?.upgradeLevel ?? 0))
  );
  return {
    ...base,
    rarity,
    bonuses: computeCardBonusesForRarity(spec, rarity, upgradeLevel),
    upgradeLevel,
  };
}

export function depositCardToChest(
  save: SaveData,
  speciesId: number,
  quantity = 1
): { ok: boolean; reason?: 'unknown_species' | 'not_owned' | 'socketed' | 'insufficient' } {
  ensureHousingState(save);
  if (!SPECIES[speciesId]) {
    return { ok: false, reason: 'unknown_species' };
  }
  const qty = Math.max(1, Math.floor(quantity));
  const album = ensureCardAlbum(save);
  const albumEntry = album[speciesId];
  if (!albumEntry || albumEntry.count <= 0) {
    return { ok: false, reason: 'not_owned' };
  }
  const available = getAvailableCardCopies(save, speciesId);
  if (available <= 0) {
    return { ok: false, reason: 'socketed' };
  }
  if (available < qty) {
    return { ok: false, reason: 'insufficient' };
  }

  const prevRarity = albumEntry.rarityOverride;
  const prevUpgrade = albumEntry.upgradeLevel ?? 0;
  const prevFirstAt = albumEntry.firstObtainedAt;

  albumEntry.count -= qty;
  if (albumEntry.count <= 0) {
    delete album[speciesId];
  }

  const chest = save.cardChest!;
  const existing = chest[speciesId];
  if (existing) {
    existing.count += qty;
    existing.firstObtainedAt = Math.min(existing.firstObtainedAt, prevFirstAt);
    const mergedRarity = pickHigherRarity(existing.rarityOverride, prevRarity);
    if (mergedRarity) existing.rarityOverride = mergedRarity;
    const mergedUpgrade = Math.max(existing.upgradeLevel ?? 0, prevUpgrade);
    if (mergedUpgrade > 0) existing.upgradeLevel = mergedUpgrade;
  } else {
    const next: CardEntry = {
      speciesId,
      count: qty,
      firstObtainedAt: prevFirstAt,
    };
    if (prevRarity) next.rarityOverride = prevRarity;
    if (prevUpgrade > 0) next.upgradeLevel = prevUpgrade;
    chest[speciesId] = next;
  }

  return { ok: true };
}

export function withdrawCardFromChest(
  save: SaveData,
  speciesId: number,
  quantity = 1
): { ok: boolean; reason?: 'unknown_species' | 'not_in_chest' | 'insufficient' } {
  ensureHousingState(save);
  if (!SPECIES[speciesId]) {
    return { ok: false, reason: 'unknown_species' };
  }
  const qty = Math.max(1, Math.floor(quantity));
  const chest = save.cardChest!;
  const chestEntry = chest[speciesId];
  if (!chestEntry || chestEntry.count <= 0) {
    return { ok: false, reason: 'not_in_chest' };
  }
  if (chestEntry.count < qty) {
    return { ok: false, reason: 'insufficient' };
  }

  const chestRarity = chestEntry.rarityOverride;
  const chestUpgrade = chestEntry.upgradeLevel ?? 0;
  const chestFirstAt = chestEntry.firstObtainedAt;

  chestEntry.count -= qty;
  if (chestEntry.count <= 0) {
    delete chest[speciesId];
  }

  const album = ensureCardAlbum(save);
  const existing = album[speciesId];
  if (existing) {
    existing.count += qty;
    existing.firstObtainedAt = Math.min(existing.firstObtainedAt, chestFirstAt);
    const mergedRarity = pickHigherRarity(existing.rarityOverride, chestRarity);
    if (mergedRarity) existing.rarityOverride = mergedRarity;
    const mergedUpgrade = Math.max(existing.upgradeLevel ?? 0, chestUpgrade);
    if (mergedUpgrade > 0) existing.upgradeLevel = mergedUpgrade;
  } else {
    const next: CardEntry = {
      speciesId,
      count: qty,
      firstObtainedAt: chestFirstAt,
    };
    if (chestRarity) next.rarityOverride = chestRarity;
    if (chestUpgrade > 0) next.upgradeLevel = chestUpgrade;
    album[speciesId] = next;
  }

  syncSocketedCreaturesForCard(save, speciesId);
  return { ok: true };
}

export function getChestTotalCards(save: SaveData): number {
  ensureHousingState(save);
  return Object.values(save.cardChest!).reduce((acc, entry) => acc + entry.count, 0);
}

export function depositSoulToChest(save: SaveData, uid: string): boolean {
  ensureHousingState(save);
  const reserve = save.soulReserve!;
  const idx = reserve.findIndex((s) => s.uid === uid);
  if (idx === -1) return false;
  const [soul] = reserve.splice(idx, 1);
  if (!save.soulChest!.some((s) => s.uid === soul.uid)) {
    save.soulChest!.push(soul);
  }
  return true;
}

export function withdrawSoulFromChest(save: SaveData, uid: string): boolean {
  ensureHousingState(save);
  const chest = save.soulChest!;
  const idx = chest.findIndex((s) => s.uid === uid);
  if (idx === -1) return false;
  const [soul] = chest.splice(idx, 1);
  if (!save.soulReserve!.some((s) => s.uid === soul.uid)) {
    save.soulReserve!.push(soul);
  }
  return true;
}

export function depositPartySoulDollToBox(
  save: SaveData,
  partyIndex: number,
  preferredBoxIndex = 0
): { ok: boolean; boxIndex?: number; reason?: 'last_party' | 'invalid' | 'box_full' } {
  ensureHousingState(save);
  const clampedPref = Math.max(0, Math.min(STORAGE_BOX_COUNT - 1, preferredBoxIndex));
  const res = depositCreature(save.party, save.storageBoxes, partyIndex, clampedPref);
  if (res.ok) {
    return { ok: true, boxIndex: clampedPref };
  }
  if (res.reason === 'box_full') {
    for (let i = 0; i < save.storageBoxes.length; i++) {
      if (i === clampedPref) continue;
      const fallback = depositCreature(save.party, save.storageBoxes, partyIndex, i);
      if (fallback.ok) {
        return { ok: true, boxIndex: i };
      }
    }
  }
  return res;
}

export function withdrawBoxSoulDollToParty(
  save: SaveData,
  boxIndex: number,
  slotIndex: number
): { ok: boolean; reason?: 'party_full' | 'invalid' } {
  ensureHousingState(save);
  return withdrawCreature(save.party, save.storageBoxes, boxIndex, slotIndex);
}

export function getChestSoulCounts(save: SaveData): {
  reserveSouls: number;
  chestSouls: number;
  partyDolls: number;
  boxedDolls: number;
  totalActiveSouls: number;
  totalStoredSouls: number;
} {
  ensureHousingState(save);
  const reserveSouls = save.soulReserve!.length;
  const chestSouls = save.soulChest!.length;
  const partyDolls = save.party.length;
  let boxedDolls = 0;
  for (const box of save.storageBoxes) {
    for (const slot of box.slots) {
      if (slot !== null) boxedDolls += 1;
    }
  }
  return {
    reserveSouls,
    chestSouls,
    partyDolls,
    boxedDolls,
    totalActiveSouls: reserveSouls + partyDolls,
    totalStoredSouls: chestSouls + boxedDolls,
  };
}

export function formatSoulContainerLabel(containerId?: string): string {
  if (!containerId) return '';
  try {
    return getBodyContainer(containerId).name;
  } catch {
    return containerId;
  }
}
