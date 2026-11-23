import type { AtlasPropKind, PropKind } from '../domain/types.ts';

export type PropAssetCategory =
  | 'tree'
  | 'bush'
  | 'flower'
  | 'grass'
  | 'rock'
  | 'mushroom'
  | 'decor'
  | 'structure';

export interface PropAtlasDef {
  kind: AtlasPropKind;
  label: string;
  category: PropAssetCategory;
  sheetPath: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  windAmp?: number;
  shadow?: boolean;
  occludable?: boolean;
  solid?: boolean;
  grass?: boolean;
}

export interface PropCategoryDefaults {
  width: number;
  height: number;
  windAmp: number;
  shadow: boolean;
  occludable: boolean;
  solid: boolean;
  grass: boolean;
}

export const PROP_ASSET_CATEGORIES: ReadonlyArray<{
  id: PropAssetCategory;
  label: string;
}> = [
  { id: 'flower', label: 'Flor' },
  { id: 'rock', label: 'Roca' },
  { id: 'mushroom', label: 'Seta' },
  { id: 'bush', label: 'Arbusto' },
  { id: 'grass', label: 'Pasto' },
  { id: 'tree', label: 'Árbol' },
  { id: 'decor', label: 'Decoración' },
  { id: 'structure', label: 'Estructura' },
];

export const PROP_CATEGORY_DEFAULTS: Record<PropAssetCategory, PropCategoryDefaults> = {
  tree: {
    width: 2.4,
    height: 2.2,
    windAmp: 0.05,
    shadow: true,
    occludable: true,
    solid: true,
    grass: false,
  },
  bush: {
    width: 1.1,
    height: 1,
    windAmp: 0.045,
    shadow: false,
    occludable: true,
    solid: false,
    grass: false,
  },
  flower: {
    width: 1.05,
    height: 0.9,
    windAmp: 0.05,
    shadow: false,
    occludable: false,
    solid: false,
    grass: false,
  },
  grass: {
    width: 1.2,
    height: 1,
    windAmp: 0.06,
    shadow: false,
    occludable: false,
    solid: false,
    grass: true,
  },
  rock: {
    width: 1.05,
    height: 0.96,
    windAmp: 0,
    shadow: true,
    occludable: true,
    solid: true,
    grass: false,
  },
  mushroom: {
    width: 0.68,
    height: 0.8,
    windAmp: 0,
    shadow: false,
    occludable: false,
    solid: false,
    grass: false,
  },
  decor: {
    width: 1,
    height: 1,
    windAmp: 0,
    shadow: false,
    occludable: false,
    solid: false,
    grass: false,
  },
  structure: {
    width: 1.3,
    height: 1.4,
    windAmp: 0,
    shadow: true,
    occludable: true,
    solid: true,
    grass: false,
  },
};

// Generated entries from Sprite Studio -> Assets are pasted here.
export const PROP_ATLAS_REGISTRY: readonly PropAtlasDef[] = [
  {
    kind: 'atlas_arbolmanzano_00',
    label: 'arbolmanzano 00',
    category: 'tree',
    sheetPath: '/assets/props/tree/arbolmanzano.webp',
    col: 0,
    row: 0,
    cols: 1,
    rows: 1,
    width: 2.4,
    height: 2.2,
    windAmp: 0.05,
    occludable: true,
    solid: true,
  },
  {
    kind: 'atlas_banco_00',
    label: 'banco 00',
    category: 'decor',
    sheetPath: '/assets/props/decor/banco.webp',
    col: 0,
    row: 0,
    cols: 1,
    rows: 1,
    width: 1.8,
    height: 1.6,
    shadow: true,
    solid: true,
  },
  {
    kind: 'atlas_cerca_00',
    label: 'cerca 00',
    category: 'decor',
    sheetPath: '/assets/props/decor/cerca.webp',
    col: 0,
    row: 0,
    cols: 1,
    rows: 1,
    width: 1.5,
    height: 1.5,
    solid: true,
  },
];

const REGISTRY_BY_KIND = new Map<string, PropAtlasDef>(
  PROP_ATLAS_REGISTRY.map((entry) => [entry.kind, entry])
);

export function getPropAtlasDef(kind: PropKind): PropAtlasDef | undefined {
  if (!kind.startsWith('atlas_')) return undefined;
  return REGISTRY_BY_KIND.get(kind);
}

export function getPropAtlasKinds(category: PropAssetCategory): AtlasPropKind[] {
  return PROP_ATLAS_REGISTRY.filter((entry) => entry.category === category).map(
    (entry) => entry.kind
  );
}

export function getPropAtlasSheetPaths(): string[] {
  return Array.from(new Set(PROP_ATLAS_REGISTRY.map((entry) => entry.sheetPath)));
}

export function getPropAtlasCellSize(
  def: Pick<PropAtlasDef, 'cols' | 'rows'>,
  sheetWidth: number,
  sheetHeight: number
): { width: number; height: number } | null {
  if (sheetWidth <= 0 || sheetHeight <= 0 || def.cols < 1 || def.rows < 1) {
    return null;
  }
  const width = Math.floor(sheetWidth / def.cols);
  const height = Math.floor(sheetHeight / def.rows);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

export function getPropAtlasCropRect(
  def: Pick<PropAtlasDef, 'col' | 'row' | 'cols' | 'rows'>,
  sheetWidth: number,
  sheetHeight: number
): { sx: number; sy: number; sw: number; sh: number } | null {
  const cell = getPropAtlasCellSize(def, sheetWidth, sheetHeight);
  if (!cell) return null;
  if (def.col < 0 || def.row < 0 || def.col >= def.cols || def.row >= def.rows) {
    return null;
  }
  return {
    sx: def.col * cell.width,
    sy: def.row * cell.height,
    sw: cell.width,
    sh: cell.height,
  };
}

export function slugifyPropBaseName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'prop';
}

export function buildPropAtlasKind(baseName: string, index: number): AtlasPropKind {
  return `atlas_${slugifyPropBaseName(baseName)}_${String(Math.max(0, Math.floor(index))).padStart(
    2,
    '0'
  )}`;
}

export interface PropAtlasSnippetInput {
  baseName: string;
  category: PropAssetCategory;
  sheetPath: string;
  cols: number;
  rows: number;
  cellIndices: readonly number[];
  width: number;
  height: number;
  windAmp?: number;
  shadow?: boolean;
  occludable?: boolean;
  solid?: boolean;
  grass?: boolean;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildPropAtlasSnippet(input: PropAtlasSnippetInput): string {
  const rows = Math.max(1, Math.floor(input.rows));
  const cols = Math.max(1, Math.floor(input.cols));
  const baseSlug = slugifyPropBaseName(input.baseName);
  const entries = Array.from(new Set(input.cellIndices))
    .filter((index) => index >= 0 && index < cols * rows)
    .sort((a, b) => a - b)
    .map((index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const kind = buildPropAtlasKind(baseSlug, index);
      const label = `${baseSlug.replace(/_/g, ' ')} ${String(index).padStart(2, '0')}`;
      const extras: string[] = [];
      if (input.windAmp && input.windAmp > 0) {
        extras.push(`  windAmp: ${formatNumber(input.windAmp)},`);
      }
      if (input.shadow) extras.push('  shadow: true,');
      if (input.occludable) extras.push('  occludable: true,');
      if (input.solid) extras.push('  solid: true,');
      if (input.grass) extras.push('  grass: true,');

      return [
        '{',
        `  kind: '${kind}',`,
        `  label: '${escapeSingleQuotes(label)}',`,
        `  category: '${input.category}',`,
        `  sheetPath: '${escapeSingleQuotes(input.sheetPath)}',`,
        `  col: ${col},`,
        `  row: ${row},`,
        `  cols: ${cols},`,
        `  rows: ${rows},`,
        `  width: ${formatNumber(input.width)},`,
        `  height: ${formatNumber(input.height)},`,
        ...extras,
        '},',
      ].join('\n');
    });

  return [
    '// Pega estas entradas dentro de PROP_ATLAS_REGISTRY en src/data/propAssets.ts',
    ...entries,
  ].join('\n');
}
