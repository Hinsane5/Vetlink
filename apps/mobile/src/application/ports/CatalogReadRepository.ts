import type { CatalogProduct } from '../../domain/catalog';
import type { LivestockSpecies } from '../../domain/profiles';

export interface CatalogReadQuery {
  name?: string;
  category?: string;
  species?: LivestockSpecies;
  minPriceIdr?: number;
  maxPriceIdr?: number;
  /** Opaque server cursor. Pass back exactly as returned by the previous page. */
  cursor?: string;
  limit?: number;
}

export interface CatalogProductPage {
  items: CatalogProduct[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Read-only application boundary for the server-backed active product catalog. */
export interface CatalogReadRepository {
  search(query?: CatalogReadQuery): Promise<CatalogProductPage>;
  getById(productId: string): Promise<CatalogProduct>;
}
