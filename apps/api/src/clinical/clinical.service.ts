import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import type { ClinicalNoteInputDto, RecommendationInputDto } from './clinical.dto.js';
import { RECOMMENDATION_DELIVERY_ADAPTER, type RecommendationDeliveryAdapter } from './recommendation-delivery.js';

type Context = { id: string; farmer_id: string; vet_id: string; animal_id: string; status: string };
const error = (code: string, message: string) => ({ code, message });
function validation(field: string, message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Request validation failed', fieldErrors: { [field]: [message] } });
}
function stale(): never { throw new ConflictException(error('VERSION_CONFLICT', 'Data berubah sejak ditinjau; muat ulang dan tinjau kembali.')); }

@Injectable()
export class ClinicalService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(RECOMMENDATION_DELIVERY_ADAPTER) private readonly delivery: RecommendationDeliveryAdapter,
    private readonly catalog: CatalogService,
  ) {}

  private async context(principal: AuthenticatedPrincipal, consultationId: string, role = principal.activeRole, client?: PoolClient): Promise<Context> {
    const query = client ? client.query.bind(client) : this.database.query.bind(this.database);
    const result = await query<Context>(`SELECT id, farmer_id, vet_id, animal_id, status FROM consultations WHERE id=$1 AND ${role === 'vet' ? 'vet_id' : 'farmer_id'}=$2`, [consultationId, principal.userId]);
    if (!result.rows[0]) throw new NotFoundException(error('NOT_FOUND', 'Konsultasi tidak ditemukan.'));
    return result.rows[0];
  }

  async getNote(principal: AuthenticatedPrincipal, consultationId: string) {
    const context = await this.context(principal, consultationId);
    const result = await this.database.query(`SELECT * FROM clinical_notes WHERE consultation_id=$1 AND (status='final' OR $2='vet')`, [context.id, principal.activeRole]);
    if (!result.rows[0]) {
      if (principal.activeRole === 'farmer') throw new NotFoundException(error('NOT_FOUND', 'Catatan final tidak ditemukan.'));
      return { consultationId, status: 'draft', complaint: '', findings: '', assessment: '', actions: '', careInstructions: '', version: 1 };
    }
    return result.rows[0];
  }

  async saveNote(principal: AuthenticatedPrincipal, consultationId: string, input: ClinicalNoteInputDto) {
    if (principal.activeRole !== 'vet') throw new ForbiddenException(error('ROLE_FORBIDDEN', 'Hanya Dokter yang dapat menulis catatan klinis.'));
    return this.database.transaction(async client => {
      const context = await this.context(principal, consultationId, 'vet', client);
      if (context.status !== 'in_progress') throw new UnprocessableEntityException(error('RULE_VIOLATION', 'Catatan hanya dapat ditulis ketika layanan berlangsung.'));
      const found = await client.query<{id:string;version:number;status:string;complaint:string;findings:string;assessment:string;actions:string;care_instructions:string}>(`SELECT id,version,status,complaint,findings,assessment,actions,care_instructions FROM clinical_notes WHERE consultation_id=$1 FOR UPDATE`, [context.id]);
      if (found.rows[0]?.status === 'final') throw new ConflictException(error('IMMUTABLE', 'Catatan final hanya dapat dibaca.'));
      if ((found.rows[0]?.version ?? 1) !== input.expectedVersion) stale();
      const values = [context.id, context.farmer_id, context.vet_id, context.animal_id, input.complaint ?? found.rows[0]?.complaint ?? '', input.findings ?? found.rows[0]?.findings ?? '', input.assessment ?? found.rows[0]?.assessment ?? '', input.actions ?? found.rows[0]?.actions ?? '', input.careInstructions ?? found.rows[0]?.care_instructions ?? ''];
      const result = await client.query(`INSERT INTO clinical_notes (consultation_id,farmer_id,vet_id,animal_id,complaint,findings,assessment,actions,care_instructions)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (consultation_id) DO UPDATE SET complaint=EXCLUDED.complaint,findings=EXCLUDED.findings,assessment=EXCLUDED.assessment,actions=EXCLUDED.actions,care_instructions=EXCLUDED.care_instructions,version=clinical_notes.version+1,updated_at=now() RETURNING *`, values);
      return result.rows[0];
    });
  }

  async finalizeNote(principal: AuthenticatedPrincipal, consultationId: string, expectedVersion: number) {
    if (principal.activeRole !== 'vet') throw new ForbiddenException(error('ROLE_FORBIDDEN', 'Hanya Dokter yang dapat memfinalkan catatan.'));
    return this.database.transaction(async client => {
      const context = await this.context(principal, consultationId, 'vet', client);
      if (context.status !== 'in_progress') throw new UnprocessableEntityException(error('RULE_VIOLATION', 'Catatan hanya dapat difinalkan ketika layanan berlangsung.'));
      const result = await client.query<Record<string, unknown> & {version:number;status:string}>(`SELECT * FROM clinical_notes WHERE consultation_id=$1 FOR UPDATE`, [context.id]);
      const note = result.rows[0];
      if (!note) throw new NotFoundException(error('NOT_FOUND', 'Draft catatan tidak ditemukan.'));
      if (note.status === 'final') return note;
      if (note.version !== expectedVersion) stale();
      const fields = ['complaint','findings','assessment','actions','care_instructions'];
      const empty = fields.filter(field => typeof note[field] !== 'string' || !(note[field] as string).trim());
      if (empty.length) throw new UnprocessableEntityException({ code: 'REQUIRED_FIELDS', message: 'Lengkapi semua bagian sebelum finalisasi.', fieldErrors: Object.fromEntries(empty.map(field => [field, ['Wajib diisi.']])) });
      const finalized = await client.query(`UPDATE clinical_notes SET status='final',finalized_at=now(),finalized_by=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [note.id, principal.userId]);
      const finalNote = finalized.rows[0];
      await client.query(
        `INSERT INTO health_events(animal_id,kind,occurred_at,description,actor_id,provenance,source_key,clinical_note_id)
         VALUES($1,'examination',$2,$3,$4,'clinical_note',$5,$6)
         ON CONFLICT DO NOTHING`,
        [context.animal_id, finalNote.finalized_at, finalNote.assessment, principal.userId, `clinical-note-${finalNote.id}`, finalNote.id],
      );
      return finalNote;
    });
  }

  private async loadRecommendation(client: PoolClient, context: Context) {
    const found = await client.query<{id:string;version:number;status:string}>(`SELECT id,version,status FROM recommendations WHERE consultation_id=$1 FOR UPDATE`, [context.id]);
    return found.rows[0];
  }

  async getRecommendation(principal: AuthenticatedPrincipal, consultationId: string) {
    const context = await this.context(principal, consultationId);
    const rec = await this.database.query(`SELECT r.*, COALESCE(json_agg(json_build_object('id',i.id,'productId',i.product_id,'title',i.title_snapshot,'instructions',i.instructions,'note',i.note) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL),'[]') AS items FROM recommendations r LEFT JOIN recommendation_items i ON i.recommendation_id=r.id WHERE r.consultation_id=$1 AND (r.status='sent' OR $2='vet') GROUP BY r.id`, [context.id, principal.activeRole]);
    if (!rec.rows[0]) {
      if (principal.activeRole === 'farmer') throw new NotFoundException(error('NOT_FOUND', 'Rekomendasi terkirim tidak ditemukan.'));
      return { consultationId, status: 'draft', version: 1, items: [] };
    }
    return rec.rows[0];
  }

  async saveRecommendation(principal: AuthenticatedPrincipal, consultationId: string, input: RecommendationInputDto) {
    if (principal.activeRole !== 'vet') throw new ForbiddenException(error('ROLE_FORBIDDEN', 'Hanya Dokter dapat menyusun rekomendasi.'));
    return this.database.transaction(async client => {
      const context = await this.context(principal, consultationId, 'vet', client);
      if (context.status !== 'in_progress') throw new UnprocessableEntityException(error('RULE_VIOLATION', 'Rekomendasi hanya dapat disusun ketika layanan berlangsung.'));
      const old = await this.loadRecommendation(client, context);
      if (old?.status === 'sent') throw new ConflictException(error('IMMUTABLE', 'Rekomendasi terkirim hanya dapat dibaca.'));
      if ((old?.version ?? 1) !== input.expectedVersion) stale();
      if (!old) {
        const inserted = await client.query(`INSERT INTO recommendations (consultation_id,farmer_id,vet_id) VALUES ($1,$2,$3) RETURNING *`, [context.id, context.farmer_id, context.vet_id]);
        const rec = inserted.rows[0];
        const items = await this.replaceItems(client, rec.id, input.items);
        return { ...rec, items };
      }
      const result = await client.query(`UPDATE recommendations SET version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [old.id]);
      const items = await this.replaceItems(client, old.id, input.items);
      return { ...result.rows[0], items };
    });
  }

  private async replaceItems(client: PoolClient, recommendationId: string, items: RecommendationInputDto['items']) {
    const products = await this.catalog.findActiveProducts(
      items.flatMap((item) => item.productId ? [item.productId] : []),
      client,
    );
    const snapshots = items.map((item, position) => {
      if (item.productId) {
        const product = products.get(item.productId);
        if (!product) {
          throw new UnprocessableEntityException({ code: 'PRODUCT_NOT_ACTIVE', message: 'Rekomendasi hanya dapat menautkan produk katalog yang aktif.' });
        }
        return { productId: product.id, title: product.name, instructions: item.instructions?.trim() ?? '', note: item.note?.trim() ?? '' };
      }
      const title = item.title?.trim();
      if (!title) validation(`items.${position}.title`, 'Judul wajib diisi bila item tidak menautkan produk katalog.');
      return { productId: null, title, instructions: item.instructions?.trim() ?? '', note: item.note?.trim() ?? '' };
    });
    await client.query('DELETE FROM recommendation_items WHERE recommendation_id=$1', [recommendationId]);
    for (const [position, item] of snapshots.entries()) {
      await client.query(`INSERT INTO recommendation_items (recommendation_id,product_id,title_snapshot,instructions,note,position) VALUES ($1,$2,$3,$4,$5,$6)`, [recommendationId,item.productId,item.title,item.instructions,item.note,position]);
    }
    return snapshots;
  }

  async sendRecommendation(principal: AuthenticatedPrincipal, consultationId: string, expectedVersion: number) {
    if (principal.activeRole !== 'vet') throw new ForbiddenException(error('ROLE_FORBIDDEN', 'Hanya Dokter dapat mengirim rekomendasi.'));
    return this.database.transaction(async client => {
      const context = await this.context(principal, consultationId, 'vet', client);
      if (context.status !== 'in_progress') throw new UnprocessableEntityException(error('RULE_VIOLATION', 'Rekomendasi hanya dapat dikirim ketika layanan berlangsung.'));
      const rec = await this.loadRecommendation(client, context);
      if (!rec) throw new UnprocessableEntityException(error('RULE_VIOLATION', 'Simpan setidaknya satu item sebelum mengirim rekomendasi.'));
      if (rec.status === 'sent') return { ...rec, alreadySent: true };
      if (rec.version !== expectedVersion) stale();
      const count = await client.query<{count:string}>(`SELECT count(*)::text AS count FROM recommendation_items WHERE recommendation_id=$1`, [rec.id]);
      if (Number(count.rows[0].count) === 0) throw new UnprocessableEntityException(error('RULE_VIOLATION', 'Rekomendasi kosong tidak dapat dikirim.'));
      const delivery = await this.delivery.send({ consultationId: context.id, recommendationId: rec.id, farmerId: context.farmer_id });
      if (delivery.status === 'failed') throw new ServiceUnavailableException({ code: 'ADAPTER_FAILED', message: delivery.error.message, retryable: delivery.error.retryable });
      const sent = await client.query(`UPDATE recommendations SET status='sent',sent_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [rec.id]);
      return { ...sent.rows[0], delivery };
    });
  }
}
