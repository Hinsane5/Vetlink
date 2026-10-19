import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { adapterFailed, adapterSucceeded, type AdapterResult } from '../communication/adapter-result.js';
import type { UserRole } from '../auth/auth.types.js';

export const CONSULTATION_ACTION_ADAPTER = Symbol('CONSULTATION_ACTION_ADAPTER');

export interface ConsultationActionInput {
  consultationId: string;
  actorId: string;
  actorRole: UserRole;
  actionType: string;
  actionScope: string;
  idempotencyKey: string;
  requestFingerprint: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  fromVisitStage?: string | null;
  toVisitStage?: string | null;
  details?: Record<string, unknown>;
}

export interface ConsultationActionAdapter {
  record(client: PoolClient, input: ConsultationActionInput): Promise<AdapterResult<{ id: string }>>;
}

/** The local outbox/audit adapter persists an event in the domain transaction. */
@Injectable()
export class PostgresConsultationActionAdapter implements ConsultationActionAdapter {
  async record(client: PoolClient, input: ConsultationActionInput): Promise<AdapterResult<{ id: string }>> {
    const id = randomUUID();
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO consultation_actions
          (id,consultation_id,actor_id,actor_role,action_type,action_scope,idempotency_key,
           request_fingerprint,from_status,to_status,from_visit_stage,to_visit_stage,details)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         RETURNING id`,
        [id, input.consultationId, input.actorId, input.actorRole, input.actionType, input.actionScope,
          input.idempotencyKey, input.requestFingerprint, input.fromStatus ?? null, input.toStatus ?? null,
          input.fromVisitStage ?? null, input.toVisitStage ?? null, JSON.stringify(input.details ?? {})],
      );
      if (result.rowCount !== 1) return adapterFailed('CONSULTATION_EVENT_NOT_SAVED', 'Perubahan layanan belum tersimpan.', true);
      return adapterSucceeded({ id: result.rows[0].id });
    } catch {
      return adapterFailed('CONSULTATION_EVENT_NOT_SAVED', 'Perubahan layanan belum tersimpan.', true);
    }
  }
}
