import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { CreateReviewDto, ReviewListQueryDto } from './reviews.dto.js';

interface ReviewCursor {
  submittedAt: string;
  id: string;
}

interface ReviewRow {
  id: string;
  consultationId: string;
  stars: number;
  text: string | null;
  submittedAt: Date | string;
  cursor_submitted_at?: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validation(field: string, message: string): never {
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Request validation failed',
    fieldErrors: { [field]: [message] },
  });
}

function parseCursor(value?: string): ReviewCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ReviewCursor>;
    if (
      typeof parsed.submittedAt !== 'string'
      || parsed.submittedAt.length > 64
      || !Number.isFinite(Date.parse(parsed.submittedAt))
      || typeof parsed.id !== 'string'
      || !uuidPattern.test(parsed.id)
      || Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url') !== value
    ) validation('cursor', 'Cursor ulasan tidak valid.');
    return { submittedAt: parsed.submittedAt, id: parsed.id };
  } catch {
    return validation('cursor', 'Cursor ulasan tidak valid.');
  }
}

function encodeCursor(submittedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ submittedAt, id }), 'utf8').toString('base64url');
}

function reviewResponse(row: ReviewRow) {
  return {
    id: row.id,
    consultationId: row.consultationId,
    stars: Number(row.stars),
    text: row.text,
    submittedAt: row.submittedAt,
  };
}

@Injectable()
export class ReviewsService {
  constructor(private readonly database: DatabaseService) {}

  async create(principal: AuthenticatedPrincipal, consultationId: string, input: CreateReviewDto) {
    if (principal.activeRole !== 'farmer') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Ulasan hanya dapat dibuat oleh Peternak.' });
    }
    const stars = input.stars;
    const text = input.text?.trim() || null;

    return this.database.transaction(async (client: PoolClient) => {
      const consultation = await client.query<{ status: string }>(
        'SELECT status::text AS status FROM consultations WHERE id=$1 AND farmer_id=$2 FOR UPDATE',
        [consultationId, principal.userId],
      );
      if (!consultation.rows[0]) {
        throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Konsultasi tidak ditemukan.' });
      }
      if (consultation.rows[0].status !== 'completed') {
        throw new UnprocessableEntityException({ code: 'RULE_VIOLATION', message: 'Ulasan hanya dapat diberikan setelah konsultasi selesai.' });
      }

      const existing = await client.query<ReviewRow>(
        `SELECT id, consultation_id AS "consultationId", stars, review_text AS text,
                submitted_at AS "submittedAt"
         FROM consultation_reviews WHERE consultation_id=$1`,
        [consultationId],
      );
      if (existing.rows[0]) {
        const review = existing.rows[0];
        if (Number(review.stars) !== stars || review.text !== text) {
          throw new ConflictException({ code: 'CONFLICT', message: 'Konsultasi ini sudah memiliki ulasan dengan isi berbeda.' });
        }
        return reviewResponse(review);
      }

      const created = await client.query<ReviewRow>(
        `INSERT INTO consultation_reviews(consultation_id,farmer_id,vet_id,stars,review_text)
         SELECT $1,c.farmer_id,c.vet_id,$3,$4 FROM consultations c
         WHERE c.id=$1 AND c.farmer_id=$2 AND c.status='completed'
         RETURNING id,consultation_id AS "consultationId",stars,review_text AS text,submitted_at AS "submittedAt"`,
        [consultationId, principal.userId, stars, text],
      );
      if (!created.rows[0]) {
        throw new UnprocessableEntityException({ code: 'RULE_VIOLATION', message: 'Konsultasi tidak lagi memenuhi syarat untuk diberi ulasan.' });
      }
      return reviewResponse(created.rows[0]);
    });
  }

  async listForVet(vetId: string, query: ReviewListQueryDto) {
    const vet = await this.database.query(
      "SELECT 1 FROM vet_profiles WHERE user_id=$1 AND verification_status='verified'",
      [vetId],
    );
    if (!vet.rowCount) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Dokter tidak ditemukan.' });

    const cursor = parseCursor(query.cursor);
    const result = await this.database.query<ReviewRow>(
      `SELECT r.id,r.consultation_id AS "consultationId",r.stars,r.review_text AS text,
              r.submitted_at AS "submittedAt",r.submitted_at::text AS cursor_submitted_at
       FROM consultation_reviews r
       JOIN consultations c ON c.id=r.consultation_id AND c.farmer_id=r.farmer_id AND c.vet_id=r.vet_id
       WHERE r.vet_id=$1 AND c.status='completed'
         AND ($2::timestamptz IS NULL OR (r.submitted_at,r.id)<($2::timestamptz,$3::uuid))
       ORDER BY r.submitted_at DESC,r.id DESC
       LIMIT $4`,
      [vetId, cursor?.submittedAt ?? null, cursor?.id ?? null, query.limit + 1],
    );
    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: row.id,
        stars: Number(row.stars),
        text: row.text,
        submittedAt: row.submittedAt,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.cursor_submitted_at!, last.id) : null,
      hasMore,
    };
  }
}
