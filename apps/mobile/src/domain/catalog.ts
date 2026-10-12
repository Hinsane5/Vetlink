import type { DomainEntity } from './entities';
import { DomainError } from './errors';
import { livestockSpecies, type LivestockSpecies } from './profiles';

export type CatalogProduct = {
  id: string;
  name: string;
  category: string;
  species: LivestockSpecies[];
  description: string;
  unitPrice: number;
  currency: 'IDR';
};

export type CatalogFilters = {
  query?: string;
  category?: string | null;
  species?: LivestockSpecies | null;
};

export function toCatalogProduct(entity: DomainEntity): CatalogProduct {
  if (entity.kind !== 'product') {
    throw new DomainError('INVALID_STATE', 'Data katalog bukan produk.');
  }
  if (entity.payload.active !== true) {
    throw new DomainError('INVALID_STATE', 'Produk ini sudah tidak aktif.');
  }

  const name = stringValue(entity.payload.name);
  const category = stringValue(entity.payload.category);
  const description = stringValue(entity.payload.description);
  const unitPrice = entity.payload.unitPrice;
  const rawSpecies = entity.payload.species;
  if (!name || !category || !Number.isSafeInteger(unitPrice) || (unitPrice as number) < 0
    || (entity.payload.currency !== undefined && entity.payload.currency !== 'IDR')) {
    throw new DomainError('INVALID_STATE', 'Informasi produk atau harga rupiah belum valid.');
  }
  if (rawSpecies !== undefined && (!Array.isArray(rawSpecies) || rawSpecies.some((value) => !isLivestockSpecies(value)))) {
    throw new DomainError('INVALID_STATE', 'Informasi jenis ternak pada produk belum valid.');
  }

  return {
    id: entity.id,
    name,
    category,
    species: Array.isArray(rawSpecies) ? rawSpecies as LivestockSpecies[] : [],
    description,
    unitPrice: unitPrice as number,
    currency: 'IDR',
  };
}

export function selectCatalogProducts(
  products: readonly CatalogProduct[],
  filters: CatalogFilters = {},
): CatalogProduct[] {
  const queryTerms = normalize(filters.query ?? '').split(/\s+/).filter(Boolean);
  const category = filters.category?.trim() ?? '';
  const species = filters.species;
  return products
    .filter((product) => !category || product.category === category)
    .filter((product) => !species || product.species.includes(species))
    .filter((product) => {
      if (!queryTerms.length) return true;
      const searchable = normalize([
        product.name,
        product.category,
        product.description,
        ...product.species.map(speciesLabel),
        ...product.species,
      ].join(' '));
      return queryTerms.every((term) => searchable.includes(term));
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'id-ID') || left.id.localeCompare(right.id));
}

export function catalogCategoryLabel(category: string): string {
  return ({ care: 'Perawatan', supplement: 'Suplemen', equipment: 'Peralatan' } as Record<string, string>)[category] ?? category;
}

export function speciesLabel(species: string): string {
  return ({ cattle: 'Sapi', goat: 'Kambing', sheep: 'Domba', poultry: 'Unggas', duck: 'Bebek', pig: 'Babi', horse: 'Kuda' } as Record<string, string>)[species] ?? species;
}

function isLivestockSpecies(value: unknown): value is LivestockSpecies {
  return typeof value === 'string' && (livestockSpecies as readonly string[]).includes(value);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('id-ID').trim().replace(/\s+/g, ' ');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
