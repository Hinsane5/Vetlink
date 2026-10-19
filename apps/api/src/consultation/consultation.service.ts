import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal, UserRole } from '../auth/auth.types.js';
import { adapterFailed, type AdapterResult } from '../communication/adapter-result.js';
import { DatabaseService } from '../database/database.service.js';
import {
  CONSULTATION_ACTION_ADAPTER,
  type ConsultationActionAdapter,
  type ConsultationActionInput,
} from './consultation-action.adapter.js';
import type { ConsultationPaymentSucceededPort } from './consultation-payment.port.js';
import { CONSULTATION_PAYMENT_SUCCEEDED } from './consultation-payment.port.js';
import type {
  CompleteConsultationDto,
  CreateConsultationDto,
  CreateConsultationQuoteDto,
  ConsultationListQueryDto,
  ExpectedVersionDto,
  RejectConsultationDto,
  RespondScheduleProposalDto,
  ScheduleProposalDto,
  VisitTransitionDto,
} from './consultation.dto.js';

type Status = 'awaiting_payment' | 'requested' | 'scheduled' | 'reschedule_pending' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';
type ServiceType = 'chat' | 'visit';
type Context = {
  id: string;
  display_code: string;
  farmer_id: string;
  vet_id: string;
  animal_id: string;
  service_type: ServiceType;
  complaint: string;
  status: Status;
  starts_at: Date;
  ends_at: Date;
  fee_snapshot_idr: string;
  commission_snapshot_idr: string;
  visit_address_snapshot: Record<string, unknown> | null;
  completion_at: Date | null;
  version: number;
  rejection_reason: string | null;
  refund_status: 'none' | 'refund_needed';
  reschedule_previous_status: 'requested' | 'scheduled' | null;
  verification_status: string;
  payment_succeeded: boolean;
};
type QuoteRow = {
  id: string;
  farmer_id: string;
  vet_id: string;
  animal_id: string;
  service_type: ServiceType;
  complaint: string;
  starts_at: Date;
  ends_at: Date;
  fee_snapshot_idr: string;
  commission_snapshot_idr: string;
  visit_address_snapshot: Record<string, unknown> | null;
  request_fingerprint: string;
  consumed_at: Date | null;
};
type ActionRow = { id: string; request_fingerprint: string; action_type: string };
type ViewRow = Record<string, unknown> & { id: string; version: number };

const activeStatuses = `('awaiting_payment','requested','scheduled','reschedule_pending','in_progress')`;
const err = (code: string, message: string) => ({ code, message });

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validation(field: string, message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Request validation failed', fieldErrors: { [field]: [message] } });
}

function safeIdr(value: string | number, field = 'feeIdr'): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) validation(field, 'Nominal harus berupa integer rupiah yang aman.');
  return result;
}

@Injectable()
export class ConsultationService implements ConsultationPaymentSucceededPort {
  constructor(
    private readonly database: DatabaseService,
    @Inject(CONSULTATION_ACTION_ADAPTER) private readonly actionAdapter: ConsultationActionAdapter,
  ) {}

  async createQuote(principal: AuthenticatedPrincipal, key: string | undefined, input: CreateConsultationQuoteDto) {
    this.farmer(principal);
    const idempotencyKey = this.requireKey(key);
    const complaint = input.complaint.trim();
    if (!complaint) validation('complaint', 'Keluhan wajib diisi.');
    const startsAt = new Date(input.startsAt);
    if (!Number.isFinite(startsAt.getTime())) validation('startsAt', 'Waktu mulai tidak valid.');
    const normalized = {
      vetId: input.vetId,
      animalId: input.animalId,
      serviceType: input.serviceType,
      startsAt: startsAt.toISOString(),
      complaint,
      addressId: input.addressId ?? null,
    };
    const fingerprint = sha256(normalized);

    return this.database.transaction(async (client) => {
      const prior = await client.query<QuoteRow>(
        'SELECT * FROM consultation_quotes WHERE farmer_id=$1 AND idempotency_key=$2 FOR UPDATE',
        [principal.userId, idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_fingerprint !== fingerprint) this.idempotencyConflict();
        return this.quoteView(prior.rows[0]);
      }

      await this.lockVet(client, input.vetId);
      const animal = await client.query<{ farm_id: string; visit_address_id: string | null }>(`SELECT l.farm_id,f.visit_address_id FROM livestock l JOIN farms f ON f.id=l.farm_id AND f.owner_id=l.farmer_id WHERE l.id=$1 AND l.farmer_id=$2`, [input.animalId, principal.userId]);
      if (!animal.rowCount) throw this.notFound();
      const schedule = await this.loadScheduleSlot(client, input.vetId, input.serviceType, startsAt, true);
      const endsAt = new Date(startsAt.getTime() + schedule.durationMinutes * 60_000);
      await this.assertNoOverlap(client, input.vetId, startsAt, endsAt);

      let addressSnapshot: Record<string, unknown> | null = null;
      if (input.serviceType === 'visit') {
        if (!input.addressId) validation('addressId', 'Alamat kunjungan wajib dipilih.');
        if (animal.rows[0].visit_address_id !== input.addressId) validation('addressId', 'Alamat kunjungan harus terhubung dengan peternakan ternak ini.');
        const address = await client.query<Record<string, unknown>>(
          `SELECT id,label,recipient_name AS "recipientName",phone,address_line AS "addressLine",
                  city,province,postal_code AS "postalCode",latitude,longitude
           FROM addresses WHERE id=$1 AND owner_id=$2`,
          [input.addressId, principal.userId],
        );
        if (!address.rows[0]) throw this.notFound();
        addressSnapshot = address.rows[0];
      } else if (input.addressId) {
        validation('addressId', 'Alamat hanya digunakan untuk layanan kunjungan.');
      }

      const fee = safeIdr(schedule.feeIdr, 'feeIdr');
      if (fee <= 0) throw new UnprocessableEntityException(err('RULE_VIOLATION', 'Tarif layanan belum memiliki nominal yang dapat ditagihkan.'));
      // DEC-13 leaves the commercial commission undecided; the local API snapshots zero.
      const result = await client.query<QuoteRow>(
        `INSERT INTO consultation_quotes
          (farmer_id,vet_id,animal_id,service_type,complaint,starts_at,ends_at,fee_snapshot_idr,
           commission_snapshot_idr,visit_address_snapshot,idempotency_key,request_fingerprint)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9::jsonb,$10,$11)
         RETURNING *`,
        [principal.userId, input.vetId, input.animalId, input.serviceType, complaint,
          startsAt.toISOString(), endsAt.toISOString(), fee, JSON.stringify(addressSnapshot), idempotencyKey, fingerprint],
      );
      return this.quoteView(result.rows[0]);
    });
  }

  async create(principal: AuthenticatedPrincipal, key: string | undefined, input: CreateConsultationDto) {
    this.farmer(principal);
    const idempotencyKey = this.requireKey(key);
    const scope = 'consultation:create';
    const fingerprint = sha256({ quoteId: input.quoteId });
    return this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO idempotency_operations(actor_id,operation_scope,idempotency_key,request_fingerprint,state)
         VALUES($1,$2,$3,$4,'in_progress') ON CONFLICT(actor_id,operation_scope,idempotency_key) DO NOTHING`,
        [principal.userId, scope, idempotencyKey, fingerprint],
      );
      const operation = await client.query<{ request_fingerprint: string; state: string; resource_id: string | null }>(
        'SELECT request_fingerprint,state,resource_id FROM idempotency_operations WHERE actor_id=$1 AND operation_scope=$2 AND idempotency_key=$3 FOR UPDATE',
        [principal.userId, scope, idempotencyKey],
      );
      if (!operation.rows[0] || operation.rows[0].request_fingerprint !== fingerprint) this.idempotencyConflict();
      if (operation.rows[0].state === 'completed' && operation.rows[0].resource_id) {
        const consultation = await this.detailRow(client, principal, operation.rows[0].resource_id);
        const action = await client.query<ActionRow>(
          `SELECT id,request_fingerprint,action_type FROM consultation_actions
           WHERE actor_id=$1 AND action_scope=$2 AND idempotency_key=$3`,
          [principal.userId, `consultation:${operation.rows[0].resource_id}:create`, idempotencyKey],
        );
        return { operationId: action.rows[0]?.id ?? operation.rows[0].resource_id, replayed: true, consultation };
      }
      if (operation.rows[0].state !== 'in_progress') throw new ServiceUnavailableException(err('SERVICE_UNAVAILABLE', 'Operasi booking belum dapat dipulihkan.'));

      const quoteResult = await client.query<QuoteRow>(
        'SELECT * FROM consultation_quotes WHERE id=$1 AND farmer_id=$2 FOR UPDATE',
        [input.quoteId, principal.userId],
      );
      const quote = quoteResult.rows[0];
      if (!quote) throw this.notFound();
      if (quote.consumed_at) throw new ConflictException(err('QUOTE_CONSUMED', 'Quote ini sudah digunakan untuk booking.'));
      const currentFarm = await client.query<{ visit_address_id: string | null }>(
        `SELECT f.visit_address_id FROM livestock l JOIN farms f ON f.id=l.farm_id AND f.owner_id=l.farmer_id
         WHERE l.id=$1 AND l.farmer_id=$2`, [quote.animal_id, principal.userId]);
      if (!currentFarm.rows[0]) throw this.notFound();
      if (quote.service_type === 'visit' && currentFarm.rows[0].visit_address_id !== quote.visit_address_snapshot?.id) {
        throw new ConflictException(err('ADDRESS_CHANGED', 'Alamat kunjungan peternakan berubah; buat quote baru.'));
      }
      await this.lockVet(client, quote.vet_id);
      await this.loadScheduleSlot(client, quote.vet_id, quote.service_type, quote.starts_at, true);
      const fee = safeIdr(quote.fee_snapshot_idr);
      await this.assertNoOverlap(client, quote.vet_id, quote.starts_at, quote.ends_at);
      const consultationId = randomUUID();
      const displayCode = `VL-${consultationId.slice(0, 8).toUpperCase()}`;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO consultations
          (id,display_code,farmer_id,vet_id,animal_id,service_type,complaint,status,starts_at,ends_at,
           fee_snapshot_idr,commission_snapshot_idr,visit_address_snapshot,quote_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,'awaiting_payment',$8,$9,$10,$11,$12::jsonb,$13)
         RETURNING id`,
        [consultationId, displayCode, quote.farmer_id, quote.vet_id, quote.animal_id, quote.service_type,
          quote.complaint, quote.starts_at, quote.ends_at, fee, safeIdr(quote.commission_snapshot_idr),
          JSON.stringify(quote.visit_address_snapshot), quote.id],
      );
      await client.query('UPDATE consultation_quotes SET consumed_at=now() WHERE id=$1', [quote.id]);
      await client.query(
        `UPDATE idempotency_operations SET state='completed',resource_type='consultation',resource_id=$4,
          http_status=201,completed_at=now() WHERE actor_id=$1 AND operation_scope=$2 AND idempotency_key=$3`,
        [principal.userId, scope, idempotencyKey, inserted.rows[0].id],
      );
      const action = await this.recordAction(client, {
        consultationId,
        actorId: principal.userId,
        actorRole: 'farmer',
        actionType: 'ConsultationCreated',
        actionScope: `consultation:${consultationId}:create`,
        idempotencyKey,
        requestFingerprint: fingerprint,
        toStatus: 'awaiting_payment',
        details: { quoteId: quote.id },
      });
      return { operationId: action.id, replayed: false, consultation: await this.detailRow(client, principal, consultationId) };
    });
  }

  async list(principal: AuthenticatedPrincipal, query: ConsultationListQueryDto) {
    const ownerColumn = principal.activeRole === 'vet' ? 'c.vet_id' : 'c.farmer_id';
    const hiddenAwaitingPayment = principal.activeRole === 'vet' ? "AND c.status <> 'awaiting_payment'" : '';
    const result = await this.database.query(
      `SELECT c.id,c.display_code AS "displayCode",c.farmer_id AS "farmerId",c.vet_id AS "vetId",
         c.animal_id AS "animalId",l.display_code AS "animalCode",l.name AS "animalName",l.species,
         c.service_type AS "serviceType",c.complaint,c.status,c.starts_at AS "startsAt",c.ends_at AS "endsAt",
         c.fee_snapshot_idr AS "feeIdr",c.commission_snapshot_idr AS "commissionIdr",c.refund_status AS "refundStatus",
         c.completion_at AS "completedAt",c.rejection_reason AS "rejectionReason",c.version,
         v.stage AS "visitStage",p.status AS "paymentStatus"
       FROM consultations c JOIN livestock l ON l.id=c.animal_id
       LEFT JOIN consultation_visits v ON v.consultation_id=c.id
       LEFT JOIN LATERAL (SELECT status FROM payments WHERE payable_type='consultation' AND payable_id=c.id ORDER BY created_at DESC LIMIT 1) p ON true
       WHERE ${ownerColumn}=$1 ${hiddenAwaitingPayment} AND ($2::text IS NULL OR c.status::text=$2)
       ORDER BY c.starts_at DESC,c.id`,
      [principal.userId, query.status ?? null],
    );
    return result.rows;
  }

  async get(principal: AuthenticatedPrincipal, consultationId: string) {
    const row = await this.detailRow(this.database, principal, consultationId);
    const [proposals, actions] = await Promise.all([
      this.database.query(
        `SELECT id,previous_status AS "previousStatus",starts_at AS "startsAt",ends_at AS "endsAt",status,
          responded_at AS "respondedAt",version,created_at AS "createdAt"
         FROM consultation_schedule_proposals WHERE consultation_id=$1 ORDER BY created_at`, [consultationId]),
      this.database.query(
        `SELECT id,actor_id AS "actorId",actor_role AS "actorRole",action_type AS "actionType",
          from_status AS "fromStatus",to_status AS "toStatus",from_visit_stage AS "fromVisitStage",
          to_visit_stage AS "toVisitStage",details,created_at AS "createdAt"
         FROM consultation_actions WHERE consultation_id=$1 ORDER BY created_at,id`, [consultationId]),
    ]);
    return { ...row, proposals: proposals.rows, actions: actions.rows };
  }

  async visit(principal: AuthenticatedPrincipal, consultationId: string) {
    const context = await this.context(principal, consultationId);
    if (context.service_type !== 'visit') throw this.notFound();
    const visit = await this.database.query(
      `SELECT consultation_id AS "consultationId",stage,departure_at AS "departureAt",arrival_at AS "arrivalAt",
         examination_started_at AS "examinationStartedAt",completed_at AS "completedAt",version,updated_at AS "updatedAt"
       FROM consultation_visits WHERE consultation_id=$1`, [consultationId]);
    if (!visit.rows[0]) throw this.notFound();
    return visit.rows[0];
  }

  async accept(principal: AuthenticatedPrincipal, consultationId: string, key: string | undefined, input: ExpectedVersionDto) {
    this.vet(principal);
    const idempotencyKey = this.requireKey(key);
    const scope = `consultation:${consultationId}:accept`;
    const fingerprint = sha256({ consultationId, expectedVersion: input.expectedVersion });
    return this.database.transaction(async (client) => {
      const context = await this.context(principal, consultationId, client, true);
      const replay = await this.replay(client, principal, context, scope, idempotencyKey, fingerprint);
      if (replay) return replay;
      await this.assertVersion(context, input.expectedVersion);
      if (context.status !== 'requested') this.statusConflict('Hanya permintaan aktif yang dapat diterima.');
      await this.assertVerified(client, context.vet_id);
      await this.assertPaid(client, context);
      await this.lockVet(client, context.vet_id);
      await this.assertScheduleSlot(client, context.vet_id, context.service_type, context.starts_at, context.ends_at);
      await this.assertNoOverlap(client, context.vet_id, context.starts_at, context.ends_at, context.id);
      await client.query('UPDATE consultations SET status=\'scheduled\',updated_at=now(),version=version+1 WHERE id=$1', [context.id]);
      if (context.service_type === 'visit') {
        await client.query('INSERT INTO consultation_visits(consultation_id,stage) VALUES($1,\'scheduled\')', [context.id]);
      }
      const action = await this.recordAction(client, this.actionInput(principal, context, 'RequestAccepted', scope, idempotencyKey, fingerprint, {
        fromStatus: 'requested', toStatus: 'scheduled', details: { serviceType: context.service_type },
      }));
      return { operationId: action.id, replayed: false, consultation: await this.detailRow(client, principal, context.id) };
    });
  }

  async reject(principal: AuthenticatedPrincipal, consultationId: string, key: string | undefined, input: RejectConsultationDto) {
    this.vet(principal);
    const idempotencyKey = this.requireKey(key);
    const reason = input.reason.trim();
    if (!reason) validation('reason', 'Alasan penolakan wajib diisi.');
    const scope = `consultation:${consultationId}:reject`;
    const fingerprint = sha256({ consultationId, expectedVersion: input.expectedVersion, reason });
    return this.database.transaction(async (client) => {
      const context = await this.context(principal, consultationId, client, true);
      const replay = await this.replay(client, principal, context, scope, idempotencyKey, fingerprint);
      if (replay) return replay;
      await this.assertVersion(context, input.expectedVersion);
      if (context.status !== 'requested') this.statusConflict('Hanya permintaan aktif yang dapat ditolak.');
      await this.assertPaid(client, context);
      await client.query(
        `UPDATE consultations SET status='rejected',rejection_reason=$2,refund_status='refund_needed',
          updated_at=now(),version=version+1 WHERE id=$1`, [context.id, reason]);
      const action = await this.recordAction(client, this.actionInput(principal, context, 'RequestRejected', scope, idempotencyKey, fingerprint, {
        fromStatus: 'requested', toStatus: 'rejected', details: { reason, refundStatus: 'refund_needed' },
      }));
      return { operationId: action.id, replayed: false, consultation: await this.detailRow(client, principal, context.id) };
    });
  }

  async proposeSchedule(principal: AuthenticatedPrincipal, consultationId: string, key: string | undefined, input: ScheduleProposalDto) {
    this.vet(principal);
    const idempotencyKey = this.requireKey(key);
    const startsAt = new Date(input.startsAt);
    if (!Number.isFinite(startsAt.getTime())) validation('startsAt', 'Waktu mulai tidak valid.');
    const scope = `consultation:${consultationId}:schedule-proposal`;
    const fingerprint = sha256({ consultationId, expectedVersion: input.expectedVersion, startsAt: startsAt.toISOString() });
    return this.database.transaction(async (client) => {
      const context = await this.context(principal, consultationId, client, true);
      const replay = await this.replay(client, principal, context, scope, idempotencyKey, fingerprint);
      if (replay) return replay;
      await this.assertVersion(context, input.expectedVersion);
      if (!['requested', 'scheduled'].includes(context.status)) this.statusConflict('Jadwal hanya dapat diusulkan untuk permintaan atau layanan terjadwal.');
      await this.assertVerified(client, context.vet_id);
      await this.assertPaid(client, context);
      await this.lockVet(client, context.vet_id);
      const slot = await this.loadScheduleSlot(client, context.vet_id, context.service_type, startsAt, false);
      const endsAt = new Date(startsAt.getTime() + slot.durationMinutes * 60_000);
      await this.assertNoOverlap(client, context.vet_id, startsAt, endsAt, context.id);
      const pending = await client.query('SELECT 1 FROM consultation_schedule_proposals WHERE consultation_id=$1 AND status=\'pending\'', [context.id]);
      if (pending.rowCount) throw new ConflictException(err('STATUS_CONFLICT', 'Masih ada proposal jadwal yang menunggu jawaban.'));
      const proposal = await client.query<{ id: string }>(
        `INSERT INTO consultation_schedule_proposals(consultation_id,created_by,previous_status,starts_at,ends_at)
         VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [context.id, principal.userId, context.status, startsAt.toISOString(), endsAt.toISOString()],
      );
      await client.query(
        `UPDATE consultations SET status='reschedule_pending',reschedule_previous_status=$2,updated_at=now(),version=version+1
         WHERE id=$1`, [context.id, context.status]);
      const action = await this.recordAction(client, this.actionInput(principal, context, 'ScheduleProposed', scope, idempotencyKey, fingerprint, {
        fromStatus: context.status, toStatus: 'reschedule_pending', details: { proposalId: proposal.rows[0].id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      }));
      return { operationId: action.id, replayed: false, proposalId: proposal.rows[0].id, consultation: await this.detailRow(client, principal, context.id) };
    });
  }

  async respondScheduleProposal(
    principal: AuthenticatedPrincipal,
    consultationId: string,
    proposalId: string,
    key: string | undefined,
    input: RespondScheduleProposalDto,
  ) {
    this.farmer(principal);
    if (input.decision === 'accept' && input.consent !== true) {
      throw new UnprocessableEntityException(err('CONSENT_REQUIRED', 'Persetujuan Peternak wajib diberikan untuk menerima jadwal.'));
    }
    const idempotencyKey = this.requireKey(key);
    const scope = `consultation:${consultationId}:proposal:${proposalId}:respond`;
    const fingerprint = sha256({ consultationId, proposalId, expectedVersion: input.expectedVersion, decision: input.decision, consent: input.consent });
    return this.database.transaction(async (client) => {
      const context = await this.context(principal, consultationId, client, true);
      const replay = await this.replay(client, principal, context, scope, idempotencyKey, fingerprint);
      if (replay) return replay;
      await this.assertVersion(context, input.expectedVersion);
      if (context.status !== 'reschedule_pending' || !context.reschedule_previous_status) this.statusConflict('Tidak ada proposal jadwal yang menunggu persetujuan.');
      const proposalResult = await client.query<{
        id: string; previous_status: 'requested' | 'scheduled'; starts_at: Date; ends_at: Date; status: string; version: number;
      }>(
        `SELECT id,previous_status,starts_at,ends_at,status,version FROM consultation_schedule_proposals
         WHERE id=$1 AND consultation_id=$2 FOR UPDATE`, [proposalId, context.id]);
      const proposal = proposalResult.rows[0];
      if (!proposal || proposal.status !== 'pending' || proposal.previous_status !== context.reschedule_previous_status) this.statusConflict('Proposal jadwal tidak lagi aktif.');

      let fromStatus: Status = 'reschedule_pending';
      let toStatus: Status = context.reschedule_previous_status;
      if (input.decision === 'accept') {
        await this.assertPaid(client, context);
        await this.assertVerified(client, context.vet_id);
        await this.lockVet(client, context.vet_id);
        await this.assertScheduleSlot(client, context.vet_id, context.service_type, proposal.starts_at, proposal.ends_at);
        await this.assertNoOverlap(client, context.vet_id, proposal.starts_at, proposal.ends_at, context.id);
        toStatus = 'scheduled';
        await client.query(
          `UPDATE consultations SET starts_at=$2,ends_at=$3,status='scheduled',reschedule_previous_status=NULL,
            updated_at=now(),version=version+1 WHERE id=$1`, [context.id, proposal.starts_at, proposal.ends_at]);
        await client.query(
          `UPDATE consultation_schedule_proposals SET status='accepted',responded_by=$2,responded_at=now(),
            updated_at=now(),version=version+1 WHERE id=$1`, [proposal.id, principal.userId]);
      } else {
        await client.query(
          `UPDATE consultations SET status=$2,reschedule_previous_status=NULL,updated_at=now(),version=version+1 WHERE id=$1`,
          [context.id, context.reschedule_previous_status]);
        await client.query(
          `UPDATE consultation_schedule_proposals SET status='declined',responded_by=$2,responded_at=now(),
            updated_at=now(),version=version+1 WHERE id=$1`, [proposal.id, principal.userId]);
      }
      const action = await this.recordAction(client, this.actionInput(principal, context, input.decision === 'accept' ? 'ScheduleProposalAccepted' : 'ScheduleProposalDeclined', scope, idempotencyKey, fingerprint, {
        fromStatus, toStatus, details: { proposalId, decision: input.decision, consent: input.consent, proposalVersion: proposal.version },
      }));
      return { operationId: action.id, replayed: false, decision: input.decision, consultation: await this.detailRow(client, principal, context.id) };
    });
  }

  async startChat(principal: AuthenticatedPrincipal, consultationId: string, key: string | undefined, input: ExpectedVersionDto) {
    this.vet(principal);
    const idempotencyKey = this.requireKey(key);
    const scope = `consultation:${consultationId}:start`;
    const fingerprint = sha256({ consultationId, expectedVersion: input.expectedVersion });
    return this.database.transaction(async (client) => {
      const context = await this.context(principal, consultationId, client, true);
      const replay = await this.replay(client, principal, context, scope, idempotencyKey, fingerprint);
      if (replay) return replay;
      await this.assertVersion(context, input.expectedVersion);
      if (context.service_type !== 'chat' || context.status !== 'scheduled') this.statusConflict('Hanya layanan chat terjadwal yang dapat dimulai.');
      await this.assertVerified(client, context.vet_id);
      await this.assertPaid(client, context);
      await client.query("UPDATE consultations SET status='in_progress',updated_at=now(),version=version+1 WHERE id=$1", [context.id]);
      const action = await this.recordAction(client, this.actionInput(principal, context, 'ConsultationStarted', scope, idempotencyKey, fingerprint, {
        fromStatus: 'scheduled', toStatus: 'in_progress',
      }));
      return { operationId: action.id, replayed: false, consultation: await this.detailRow(client, principal, context.id) };
    });
  }

  async advanceVisit(
    principal: AuthenticatedPrincipal,
    consultationId: string,
    actionName: 'depart' | 'arrive' | 'start-examination',
    key: string | undefined,
    input: VisitTransitionDto,
  ) {
    this.vet(principal);
    const idempotencyKey = this.requireKey(key);
    const target = {
      depart: { from: 'scheduled', to: 'en_route', action: 'VisitDeparted', column: 'departure_at' },
      arrive: { from: 'en_route', to: 'arrived', action: 'VisitArrived', column: 'arrival_at' },
      'start-examination': { from: 'arrived', to: 'examining', action: 'ExaminationStarted', column: 'examination_started_at' },
    }[actionName];
    const scope = `consultation:${consultationId}:visit:${actionName}`;
    const fingerprint = sha256({ consultationId, expectedVersion: input.expectedVersion, expectedVisitVersion: input.expectedVisitVersion, actionName });
    return this.database.transaction(async (client) => {
      const context = await this.context(principal, consultationId, client, true);
      const replay = await this.replay(client, principal, context, scope, idempotencyKey, fingerprint);
      if (replay) return replay;
      await this.assertVersion(context, input.expectedVersion);
      if (context.service_type !== 'visit' || context.status !== (actionName === 'start-examination' ? 'scheduled' : 'scheduled')) {
        this.statusConflict('Tahap kunjungan tidak sesuai dengan status layanan.');
      }
      await this.assertVerified(client, context.vet_id);
      await this.assertPaid(client, context);
      if (!context.visit_address_snapshot) throw new UnprocessableEntityException(err('RULE_VIOLATION', 'Snapshot alamat kunjungan tidak tersedia.'));
      const visitResult = await client.query<{ stage: string; version: number }>(
        'SELECT stage,version FROM consultation_visits WHERE consultation_id=$1 FOR UPDATE', [context.id]);
      const visit = visitResult.rows[0];
      if (!visit) throw this.notFound();
      if (visit.version !== input.expectedVisitVersion) throw new ConflictException(err('VERSION_CONFLICT', 'Tahap kunjungan berubah sejak ditinjau.'));
      if (visit.stage !== target.from) this.statusConflict('Tahap kunjungan harus diproses berurutan.');
      const consultationTo: Status | null = actionName === 'start-examination' ? 'in_progress' : null;
      await client.query(
        `UPDATE consultation_visits SET stage=$2,${target.column}=now(),updated_at=now(),version=version+1 WHERE consultation_id=$1`,
        [context.id, target.to]);
      if (consultationTo) {
        await client.query("UPDATE consultations SET status='in_progress',updated_at=now(),version=version+1 WHERE id=$1", [context.id]);
      }
      const action = await this.recordAction(client, this.actionInput(principal, context, target.action, scope, idempotencyKey, fingerprint, {
        fromStatus: context.status, toStatus: consultationTo ?? context.status,
        fromVisitStage: target.from, toVisitStage: target.to,
      }));
      return { operationId: action.id, replayed: false, consultation: await this.detailRow(client, principal, context.id), visit: await this.visitRow(client, context.id) };
    });
  }

  async complete(principal: AuthenticatedPrincipal, consultationId: string, key: string | undefined, input: CompleteConsultationDto) {
    this.vet(principal);
    if (input.confirmation !== true) throw new UnprocessableEntityException(err('CONFIRMATION_REQUIRED', 'Konfirmasi Peternak/Dokter diperlukan sebelum layanan diselesaikan.'));
    const idempotencyKey = this.requireKey(key);
    const scope = `consultation:${consultationId}:complete`;
    const fingerprint = sha256({ consultationId, expectedVersion: input.expectedVersion, confirmation: input.confirmation, expectedVisitVersion: input.expectedVisitVersion ?? null });
    return this.database.transaction(async (client) => {
      const context = await this.context(principal, consultationId, client, true);
      const replay = await this.replay(client, principal, context, scope, idempotencyKey, fingerprint);
      if (replay) return replay;
      await this.assertVersion(context, input.expectedVersion);
      if (context.status !== 'in_progress') this.statusConflict('Layanan harus sedang berlangsung sebelum diselesaikan.');
      await this.assertVerified(client, context.vet_id);
      await this.assertPaid(client, context);
      const noteResult = await client.query<{ id: string; status: string; assessment: string; finalized_at: Date; finalized_by: string }>(
        `SELECT id,status,assessment,finalized_at,finalized_by FROM clinical_notes WHERE consultation_id=$1 FOR UPDATE`, [context.id]);
      const note = noteResult.rows[0];
      if (!note || note.status !== 'final') throw new UnprocessableEntityException(err('FINAL_NOTE_REQUIRED', 'Catatan pemeriksaan final wajib tersedia sebelum layanan selesai.'));

      let visitVersion: number | null = null;
      if (context.service_type === 'visit') {
        if (!Number.isInteger(input.expectedVisitVersion) || !input.expectedVisitVersion) validation('expectedVisitVersion', 'Versi kunjungan wajib disertakan.');
        const visit = await client.query<{ stage: string; version: number }>(
          'SELECT stage,version FROM consultation_visits WHERE consultation_id=$1 FOR UPDATE', [context.id]);
        if (!visit.rows[0]) throw this.notFound();
        if (visit.rows[0].version !== input.expectedVisitVersion) throw new ConflictException(err('VERSION_CONFLICT', 'Tahap kunjungan berubah sejak ditinjau.'));
        if (visit.rows[0].stage !== 'examining') throw new UnprocessableEntityException(err('RULE_VIOLATION', 'Kunjungan harus berada pada tahap pemeriksaan sebelum diselesaikan.'));
        visitVersion = visit.rows[0].version;
      }

      // Final notes become a single clinical-history projection; keep old/directly-created final notes consistent.
      await client.query(
        `INSERT INTO health_events(animal_id,kind,occurred_at,description,actor_id,provenance,source_key,clinical_note_id)
         VALUES($1,'examination',COALESCE($2,now()),$3,$4,'clinical_note',$5,$6)
         ON CONFLICT DO NOTHING`,
        [context.animal_id, note.finalized_at, note.assessment, note.finalized_by, `clinical-note-${note.id}`, note.id],
      );
      await client.query("UPDATE consultations SET status='completed',completion_at=now(),updated_at=now(),version=version+1 WHERE id=$1", [context.id]);
      if (visitVersion !== null) {
        await client.query("UPDATE consultation_visits SET stage='completed',completed_at=now(),updated_at=now(),version=version+1 WHERE consultation_id=$1", [context.id]);
      }
      const action = await this.recordAction(client, this.actionInput(principal, context, 'ConsultationCompleted', scope, idempotencyKey, fingerprint, {
        fromStatus: 'in_progress', toStatus: 'completed',
        ...(visitVersion === null ? {} : { fromVisitStage: 'examining', toVisitStage: 'completed' }),
        details: { clinicalNoteId: note.id, confirmed: input.confirmation },
      }));
      return { operationId: action.id, replayed: false, consultation: await this.detailRow(client, principal, context.id) };
    });
  }

  async handlePaymentSucceeded(client: PoolClient, payment: {
    id: string; ownerId: string; payableType: string; payableId: string; amountIdr: number; callbackEventId: string;
  }): Promise<void> {
    if (payment.payableType !== 'consultation') return;
    const result = await client.query<Context>(
      `SELECT c.*,vp.verification_status,
         EXISTS(SELECT 1 FROM payments p WHERE p.id=$3 AND p.owner_id=c.farmer_id AND p.payable_type='consultation'
           AND p.payable_id=c.id AND p.amount_idr=c.fee_snapshot_idr AND p.status='succeeded') AS payment_succeeded
       FROM consultations c JOIN vet_profiles vp ON vp.user_id=c.vet_id
       WHERE c.id=$1 AND c.farmer_id=$2 FOR UPDATE OF c`,
      [payment.payableId, payment.ownerId, payment.id],
    );
    const context = result.rows[0];
    if (!context || context.fee_snapshot_idr !== String(payment.amountIdr)) {
      throw new ConflictException(err('PAYMENT_CONSULTATION_MISMATCH', 'Pembayaran tidak cocok dengan konsultasi.'));
    }
    if (context.status !== 'awaiting_payment') return;
    const scope = `consultation:${context.id}:payment-succeeded`;
    const fingerprint = sha256({ paymentId: payment.id, amountIdr: payment.amountIdr });
    const existing = await client.query<ActionRow>(
      'SELECT id,request_fingerprint,action_type FROM consultation_actions WHERE actor_id=$1 AND action_scope=$2 AND idempotency_key=$3 FOR UPDATE',
      [payment.ownerId, scope, payment.id],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_fingerprint !== fingerprint) this.idempotencyConflict();
      return;
    }
    await this.lockVet(client, context.vet_id);
    await this.assertNoOverlap(client, context.vet_id, context.starts_at, context.ends_at, context.id);
    await client.query("UPDATE consultations SET status='requested',updated_at=now(),version=version+1 WHERE id=$1", [context.id]);
    const actionInput: ConsultationActionInput = {
      consultationId: context.id,
      actorId: payment.ownerId,
      actorRole: 'farmer',
      actionType: 'ConsultationRequested',
      actionScope: scope,
      idempotencyKey: payment.id,
      requestFingerprint: fingerprint,
      fromStatus: 'awaiting_payment',
      toStatus: 'requested',
      details: { paymentId: payment.id, callbackEventId: payment.callbackEventId },
    };
    await this.recordAction(client, actionInput);
  }

  private quoteView(row: QuoteRow) {
    return {
      id: row.id,
      quoteId: row.id,
      farmerId: row.farmer_id,
      vetId: row.vet_id,
      animalId: row.animal_id,
      serviceType: row.service_type,
      complaint: row.complaint,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      feeIdr: safeIdr(row.fee_snapshot_idr),
      commissionIdr: safeIdr(row.commission_snapshot_idr),
      amountIdr: safeIdr(row.fee_snapshot_idr),
      currency: 'IDR',
      visitAddressSnapshot: row.visit_address_snapshot,
      consumed: row.consumed_at !== null,
    };
  }

  private async loadScheduleSlot(
    client: PoolClient,
    vetId: string,
    service: ServiceType,
    startsAt: Date,
    requireNewRequests: boolean,
  ): Promise<{ durationMinutes: number; feeIdr: string }> {
    const result = await client.query<{
      verification_status: string; accepting_new_requests: boolean; service_enabled: boolean;
      duration_minutes: number; fee_idr: string | null; in_schedule: boolean;
    }>(
      `SELECT vp.verification_status,a.accepting_new_requests,$2=ANY(a.services) AS service_enabled,
        CASE WHEN $2='chat' THEN a.chat_duration_minutes ELSE a.visit_duration_minutes END AS duration_minutes,
        (SELECT fee_idr::text FROM vet_service_rates r WHERE r.vet_id=vp.user_id AND r.service_type=$2::consultation_service_type
          AND r.effective_at<=now() ORDER BY r.effective_at DESC LIMIT 1) AS fee_idr,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(a.weekday_rules) rule
          CROSS JOIN LATERAL (SELECT $3::timestamptz AT TIME ZONE a.timezone AS local_start) t
          WHERE (rule->>'weekday')::int=EXTRACT(DOW FROM t.local_start)::int
            AND t.local_start >= t.local_start::date + (rule->>'start')::time
            AND t.local_start + make_interval(mins => CASE WHEN $2='chat' THEN a.chat_duration_minutes ELSE a.visit_duration_minutes END)
              <= t.local_start::date + (rule->>'end')::time
            AND mod(EXTRACT(EPOCH FROM (t.local_start - (t.local_start::date + (rule->>'start')::time)))::bigint,
              (CASE WHEN $2='chat' THEN a.chat_duration_minutes ELSE a.visit_duration_minutes END)*60)=0
            AND EXTRACT(SECOND FROM t.local_start)=0
        ) AS in_schedule
       FROM vet_profiles vp JOIN vet_availabilities a ON a.vet_id=vp.user_id WHERE vp.user_id=$1`,
      [vetId, service, startsAt.toISOString()],
    );
    const row = result.rows[0];
    if (!row || row.verification_status !== 'verified' || !row.service_enabled || (requireNewRequests && !row.accepting_new_requests)) {
      throw this.notFound();
    }
    if (startsAt.getTime() <= Date.now()) throw new UnprocessableEntityException(err('RULE_VIOLATION', 'Slot harus berada di masa depan.'));
    if (!row.in_schedule) throw new UnprocessableEntityException(err('RULE_VIOLATION', 'Waktu tidak sesuai dengan jadwal layanan dokter.'));
    if (requireNewRequests && !row.fee_idr) throw new UnprocessableEntityException(err('RULE_VIOLATION', 'Tarif layanan belum tersedia.'));
    return { durationMinutes: row.duration_minutes, feeIdr: row.fee_idr ?? '0' };
  }

  private async assertScheduleSlot(client: PoolClient, vetId: string, service: ServiceType, startsAt: Date, endsAt: Date) {
    const slot = await this.loadScheduleSlot(client, vetId, service, startsAt, false);
    const expectedEnd = startsAt.getTime() + slot.durationMinutes * 60_000;
    if (endsAt.getTime() !== expectedEnd) throw new UnprocessableEntityException(err('RULE_VIOLATION', 'Durasi slot tidak sesuai layanan dokter.'));
  }

  private async assertNoOverlap(client: PoolClient, vetId: string, startsAt: Date, endsAt: Date, exceptConsultationId?: string) {
    const conflict = await client.query(
      `SELECT 1 FROM consultations c WHERE c.vet_id=$1 AND c.status IN ${activeStatuses}
         AND ($4::uuid IS NULL OR c.id<>$4) AND c.starts_at<$3 AND c.ends_at>$2
       UNION ALL
       SELECT 1 FROM consultation_schedule_proposals p JOIN consultations c ON c.id=p.consultation_id
         WHERE c.vet_id=$1 AND p.status='pending' AND ($4::uuid IS NULL OR c.id<>$4)
           AND p.starts_at<$3 AND p.ends_at>$2
       UNION ALL
       SELECT 1 FROM vet_blocked_times b WHERE b.vet_id=$1 AND b.status='active' AND b.starts_at<$3 AND b.ends_at>$2
       LIMIT 1`,
      [vetId, startsAt.toISOString(), endsAt.toISOString(), exceptConsultationId ?? null],
    );
    if (conflict.rowCount) throw new ConflictException(err('SLOT_CONFLICT', 'Slot bertabrakan dengan layanan, proposal, atau blokir lain.'));
  }

  private async context(principal: AuthenticatedPrincipal, id: string, client?: PoolClient, forUpdate = false): Promise<Context> {
    const query = client ? client.query.bind(client) : this.database.query.bind(this.database);
    const ownerColumn = principal.activeRole === 'vet' ? 'c.vet_id' : 'c.farmer_id';
    const suffix = forUpdate ? 'FOR UPDATE OF c' : '';
    const result = await query<Context>(
      `SELECT c.*,vp.verification_status,
        EXISTS(SELECT 1 FROM payments p WHERE p.owner_id=c.farmer_id AND p.payable_type='consultation'
          AND p.payable_id=c.id AND p.amount_idr=c.fee_snapshot_idr AND p.status='succeeded') AS payment_succeeded
       FROM consultations c JOIN vet_profiles vp ON vp.user_id=c.vet_id WHERE c.id=$1 AND ${ownerColumn}=$2 ${suffix}`,
      [id, principal.userId],
    );
    if (!result.rows[0]) throw this.notFound();
    return result.rows[0];
  }

  private async detailRow(client: Pick<PoolClient, 'query'> | DatabaseService, principal: AuthenticatedPrincipal, consultationId: string): Promise<ViewRow> {
    const query = client.query.bind(client) as DatabaseService['query'];
    const ownerColumn = principal.activeRole === 'vet' ? 'c.vet_id' : 'c.farmer_id';
    const result = await query<ViewRow>(
      `SELECT c.id,c.display_code AS "displayCode",c.farmer_id AS "farmerId",c.vet_id AS "vetId",
        c.animal_id AS "animalId",l.display_code AS "animalCode",l.name AS "animalName",l.species,
        c.service_type AS "serviceType",c.complaint,c.status,c.starts_at AS "startsAt",c.ends_at AS "endsAt",
        c.fee_snapshot_idr AS "feeIdr",c.commission_snapshot_idr AS "commissionIdr",c.visit_address_snapshot AS "visitAddressSnapshot",
        c.completion_at AS "completionAt",c.rejection_reason AS "rejectionReason",c.refund_status AS "refundStatus",
        c.reschedule_previous_status AS "reschedulePreviousStatus",c.version,v.stage AS "visitStage",
        v.departure_at AS "departureAt",v.arrival_at AS "arrivalAt",v.examination_started_at AS "examinationStartedAt",
        v.completed_at AS "visitCompletedAt",v.version AS "visitVersion",p.status AS "paymentStatus"
       FROM consultations c JOIN livestock l ON l.id=c.animal_id
       LEFT JOIN consultation_visits v ON v.consultation_id=c.id
       LEFT JOIN LATERAL (SELECT status FROM payments WHERE payable_type='consultation' AND payable_id=c.id ORDER BY created_at DESC LIMIT 1) p ON true
       WHERE c.id=$1 AND ${ownerColumn}=$2 AND ($3::boolean=false OR c.status<>'awaiting_payment')`,
      [consultationId, principal.userId, principal.activeRole === 'vet'],
    );
    if (!result.rows[0]) throw this.notFound();
    return result.rows[0];
  }

  private async visitRow(client: PoolClient, consultationId: string) {
    const result = await client.query(
      `SELECT consultation_id AS "consultationId",stage,departure_at AS "departureAt",arrival_at AS "arrivalAt",
         examination_started_at AS "examinationStartedAt",completed_at AS "completedAt",version
       FROM consultation_visits WHERE consultation_id=$1`, [consultationId]);
    return result.rows[0] ?? null;
  }

  private async replay(client: PoolClient, principal: AuthenticatedPrincipal, context: Context, scope: string, key: string, fingerprint: string) {
    const result = await client.query<ActionRow>(
      'SELECT id,request_fingerprint,action_type FROM consultation_actions WHERE actor_id=$1 AND action_scope=$2 AND idempotency_key=$3 FOR UPDATE',
      [principal.userId, scope, key],
    );
    if (!result.rows[0]) return null;
    if (result.rows[0].request_fingerprint !== fingerprint) this.idempotencyConflict();
    return { operationId: result.rows[0].id, replayed: true, consultation: await this.detailRow(client, principal, context.id) };
  }

  private actionInput(
    principal: AuthenticatedPrincipal,
    context: Context,
    actionType: string,
    actionScope: string,
    idempotencyKey: string,
    requestFingerprint: string,
    extra: Partial<ConsultationActionInput> = {},
  ): ConsultationActionInput {
    return {
      consultationId: context.id,
      actorId: principal.userId,
      actorRole: principal.activeRole,
      actionType,
      actionScope,
      idempotencyKey,
      requestFingerprint,
      ...extra,
    };
  }

  private async recordAction(client: PoolClient, input: ConsultationActionInput) {
    const result: AdapterResult<{ id: string }> = await this.actionAdapter.record(client, input);
    if (result.status === 'failed') {
      throw new ServiceUnavailableException({ code: 'ADAPTER_FAILED', message: result.error.message, retryable: result.error.retryable });
    }
    if (result.status === 'pending') {
      throw new ServiceUnavailableException({ code: 'ADAPTER_PENDING', message: 'Perubahan layanan belum tersimpan.', retryable: true });
    }
    return result.value;
  }

  private async assertPaid(client: PoolClient, context: Context) {
    const payment = await client.query(
      `SELECT 1 FROM payments WHERE owner_id=$1 AND payable_type='consultation' AND payable_id=$2
         AND status='succeeded' AND amount_idr=$3`,
      [context.farmer_id, context.id, context.fee_snapshot_idr],
    );
    if (!payment.rowCount) throw new UnprocessableEntityException(err('PAYMENT_REQUIRED', 'Layanan belum memiliki pembayaran sukses yang cocok.'));
  }

  private async assertVerified(client: PoolClient, vetId: string) {
    const vet = await client.query<{ verification_status: string }>(
      'SELECT verification_status FROM vet_profiles WHERE user_id=$1 FOR SHARE', [vetId]);
    if (vet.rows[0]?.verification_status !== 'verified') {
      throw new ForbiddenException(err('VET_NOT_VERIFIED', 'Dokter belum terverifikasi sehingga tidak dapat menerima layanan.'));
    }
  }

  private async lockVet(client: PoolClient, vetId: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [vetId]);
  }

  private assertVersion(context: Context, expectedVersion: number) {
    if (context.version !== expectedVersion) throw new ConflictException(err('VERSION_CONFLICT', 'Data berubah sejak ditinjau; muat ulang dan tinjau kembali.'));
  }

  private requireKey(value: string | undefined): string {
    const key = value?.trim() ?? '';
    if (key.length < 8 || key.length > 128) validation('Idempotency-Key', 'Gunakan Idempotency-Key sepanjang 8–128 karakter.');
    return key;
  }

  private farmer(principal: AuthenticatedPrincipal) {
    if (principal.activeRole !== 'farmer') throw new ForbiddenException(err('FORBIDDEN', 'Aksi ini hanya tersedia untuk Peternak.'));
  }

  private vet(principal: AuthenticatedPrincipal) {
    if (principal.activeRole !== 'vet') throw new ForbiddenException(err('FORBIDDEN', 'Aksi ini hanya tersedia untuk Dokter Hewan.'));
  }

  private statusConflict(message: string): never {
    throw new ConflictException(err('STATUS_CONFLICT', message));
  }

  private idempotencyConflict(): never {
    throw new ConflictException(err('IDEMPOTENCY_CONFLICT', 'Idempotency-Key telah digunakan dengan payload berbeda.'));
  }

  private notFound() {
    return new NotFoundException(err('NOT_FOUND', 'Konsultasi atau sumber daya tidak ditemukan.'));
  }
}
