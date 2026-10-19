import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import type { ProductSearchQueryDto } from './catalog.dto.js';

interface ProductRow {
  id: string;
  name: string;
  category: string;
  species: string[];
  description: string;
  unit_price_idr: string;
  image_attachment_id: string | null;
  active: boolean;
  sort_name: string;
}

interface ProductCursor {
  name: string;
  id: string;
}

export interface ActiveProductSnapshot {
  id: string;
  name: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validation(field: string, message: string): never {
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Request validation failed',
    fieldErrors: { [field]: [message] },
  });
}

function parseCursor(value?: string): ProductCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ProductCursor>;
    if (
      typeof parsed.name !== 'string'
      || parsed.name.length > 160
      || typeof parsed.id !== 'string'
      || !uuidPattern.test(parsed.id)
      || Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url') !== value
    ) validation('cursor', 'Cursor katalog tidak valid.');
    return { name: parsed.name, id: parsed.id };
  } catch {
    return validation('cursor', 'Cursor katalog tidak valid.');
  }
}

function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify({ name, id }), 'utf8').toString('base64url');
}

function toProduct(row: ProductRow) {
  const unitPriceIdr = Number(row.unit_price_idr);
  if (!Number.isSafeInteger(unitPriceIdr)) {
    throw new ServiceUnavailableException({ code: 'CATALOG_DATA_INVALID', message: 'Harga produk tidak dapat dibaca sebagai rupiah integer.' });
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    species: row.species,
    description: row.description,
    unitPriceIdr,
    imageAttachmentId: row.image_attachment_id,
    active: row.active,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

@Injectable()
export class CatalogService {
  constructor(private readonly database: DatabaseService) {}

  async search(query: ProductSearchQueryDto) {
    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
      validation('maxPrice', 'Harga maksimum harus sama atau lebih besar daripada harga minimum.');
    }

    const cursor = parseCursor(query.cursor);
    const searchName = query.name?.trim();
    const result = await this.database.query<ProductRow>(
      `SELECT p.id, p.name, p.category, p.species, p.description,
              p.unit_price_idr::text AS unit_price_idr, p.image_attachment_id, p.active,
              lower(p.name) AS sort_name
       FROM products p
       WHERE p.active = true
         AND ($1::text IS NULL OR p.name ILIKE $1)
         AND ($2::text IS NULL OR lower(p.category) = lower($2))
         AND ($3::text IS NULL OR EXISTS (
           SELECT 1 FROM unnest(p.species) AS product_species(value)
           WHERE lower(product_species.value) = lower($3)
         ))
         AND ($4::bigint IS NULL OR p.unit_price_idr >= $4)
         AND ($5::bigint IS NULL OR p.unit_price_idr <= $5)
         AND ($6::text IS NULL OR lower(p.name) > $6 OR (lower(p.name) = $6 AND p.id > $7::uuid))
       ORDER BY lower(p.name), p.id
       LIMIT $8`,
      [
        searchName ? `%${escapeLike(searchName)}%` : null,
        query.category?.trim() || null,
        query.species?.trim() || null,
        query.minPrice ?? null,
        query.maxPrice ?? null,
        cursor?.name ?? null,
        cursor?.id ?? null,
        query.limit + 1,
      ],
    );

    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const items = rows.map(toProduct);
    const last = rows.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.sort_name, last.id) : null,
      hasMore,
    };
  }

  async detail(id: string) {
    const result = await this.database.query<ProductRow>(
      `SELECT id, name, category, species, description,
              unit_price_idr::text AS unit_price_idr, image_attachment_id, active,
              lower(name) AS sort_name
       FROM products WHERE id=$1 AND active=true`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Produk tidak ditemukan.' });
    return toProduct(result.rows[0]);
  }

  async findActiveProducts(ids: readonly string[], client: PoolClient): Promise<Map<string, ActiveProductSnapshot>> {
    if (ids.length === 0) return new Map();
    const result = await client.query<ActiveProductSnapshot>(
      'SELECT id, name FROM products WHERE id = ANY($1::uuid[]) AND active = true FOR SHARE',
      [[...new Set(ids)]],
    );
    return new Map(result.rows.map((product) => [product.id, product]));
  }
}
