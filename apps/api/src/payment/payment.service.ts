import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { PAYMENT_SERVICE, type PaymentOutcome, type PaymentService } from './payment.adapter.js';
import { Inject } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';

@Injectable()
export class PaymentsService {
  constructor(private readonly db: DatabaseService, @Inject(PAYMENT_SERVICE) private readonly adapter: PaymentService) {}

  async quote(p: AuthenticatedPrincipal, payableType: 'consultation' | 'order', payableId: string) {
    if (payableType === 'order') throw new NotFoundException({ code: 'NOT_FOUND', message: 'Kewajiban pembayaran tidak ditemukan.' });
    const q = await this.db.query<{ id: string; fee_snapshot_idr: string; status: string }>(
      'SELECT id,fee_snapshot_idr,status FROM consultations WHERE id=$1 AND farmer_id=$2', [payableId,p.userId]);
    const row=q.rows[0]; if (!row || row.status !== 'awaiting_payment') throw new NotFoundException({code:'NOT_FOUND',message:'Kewajiban pembayaran tidak ditemukan.'});
    return { payableType, payableId: row.id, amountIdr: Number(row.fee_snapshot_idr), currency: 'IDR' as const };
  }

  async create(p: AuthenticatedPrincipal, key: string, input: {payableType:'consultation'|'order';payableId:string;method:string}) {
    if (!key || key.length < 8 || key.length > 128) throw new UnprocessableEntityException({code:'VALIDATION_ERROR',message:'Idempotency-Key harus sepanjang 8–128 karakter.'});
    const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior=await this.db.query<any>('SELECT p.*,a.id AS attempt_id,a.status AS attempt_status,a.adapter_reference AS attempt_reference FROM payments p LEFT JOIN payment_attempts a ON a.payment_id=p.id AND a.attempt_number=1 WHERE p.owner_id=$1 AND p.payable_type=$2 AND p.payable_id=$3 AND p.operation_key=$4',[p.userId,input.payableType,input.payableId,key]);
    if(prior.rows[0]) { if(prior.rows[0].request_fingerprint!==fingerprint) throw new ConflictException({code:'IDEMPOTENCY_CONFLICT',message:'Idempotency-Key telah dipakai dengan payload berbeda.'}); return this.paymentView(prior.rows[0]); }
    let created:any;
    try { created=await this.db.transaction(async c=>{
      if(input.payableType==='order') throw new NotFoundException({code:'NOT_FOUND',message:'Kewajiban pembayaran tidak ditemukan.'});
      const payable=await c.query<{fee_snapshot_idr:string;status:string}>(`SELECT fee_snapshot_idr,status FROM consultations WHERE id=$1 AND farmer_id=$2 FOR UPDATE`,[input.payableId,p.userId]);
      if(!payable.rows[0]||payable.rows[0].status!=='awaiting_payment') throw new NotFoundException({code:'NOT_FOUND',message:'Kewajiban pembayaran tidak ditemukan.'});
      const amountIdr=Number(payable.rows[0].fee_snapshot_idr);
      const pay=await c.query<any>(`INSERT INTO payments(owner_id,payable_type,payable_id,method,amount_idr,status,operation_key,request_fingerprint)
        VALUES($1,$2,$3,$4,$5,'pending',$6,$7) ON CONFLICT(owner_id,payable_type,payable_id,operation_key) DO NOTHING RETURNING *`,[p.userId,input.payableType,input.payableId,input.method,amountIdr,key,fingerprint]);
      let row=pay.rows[0]; if(!row) { row=(await c.query<any>('SELECT * FROM payments WHERE owner_id=$1 AND payable_type=$2 AND payable_id=$3 AND operation_key=$4 FOR UPDATE',[p.userId,input.payableType,input.payableId,key])).rows[0]; if(row.request_fingerprint!==fingerprint) throw new ConflictException({code:'IDEMPOTENCY_CONFLICT',message:'Idempotency-Key telah dipakai dengan payload berbeda.'}); return {...row,attempt_id:null,attempt_status:row.status}; }
      const a=await c.query<any>(`INSERT INTO payment_attempts(payment_id,attempt_number,status,operation_key) VALUES($1,1,'pending',$2) RETURNING *`,[row.id,key]); return {...row,attempt_id:a.rows[0].id,attempt_status:'pending',attempt_reference:null};
    }); } catch(e:any) { if(e?.status) throw e; throw new ServiceUnavailableException({code:'SERVICE_UNAVAILABLE',message:'Pembayaran belum dapat disimpan.'}); }
    if(!created.attempt_id) return this.paymentView(created);
    const result=await this.adapter.start(created.id,created.attempt_id,Number(created.amount_idr),created.method);
    try { await this.db.transaction(async c=>{
      await c.query('UPDATE payment_attempts SET status=$2,adapter_reference=$3 WHERE id=$1 AND status=$4',[created.attempt_id,result.status,result.status==='failed'?null:result.value.reference,'pending']);
      await c.query('UPDATE payments SET status=$2,adapter_reference=$3,updated_at=now(),version=version+1 WHERE id=$1 AND status=$4',[created.id,result.status,result.status==='failed'?null:result.value.reference,'pending']);
    }); } catch { throw new ServiceUnavailableException({code:'SERVICE_UNAVAILABLE',message:'Hasil layanan pembayaran belum tersimpan; ulangi dengan Idempotency-Key yang sama.'}); }
    const saved=await this.db.query<any>('SELECT p.*,a.id AS attempt_id,a.status AS attempt_status,a.adapter_reference AS attempt_reference FROM payments p JOIN payment_attempts a ON a.payment_id=p.id AND a.attempt_number=1 WHERE p.id=$1',[created.id]);
    return this.paymentView(saved.rows[0]);
  }

  async localCallback(input:{paymentId:string;attemptId:string;eventId:string;reference:string;outcome:PaymentOutcome;amountIdr:string}) {
    const amount=Number(input.amountIdr); if(!Number.isSafeInteger(amount)||amount<0) throw new UnprocessableEntityException({code:'VALIDATION_ERROR',message:'Amount callback tidak valid.'});
    return this.db.transaction(async c=>{
      const r=await c.query<any>(`SELECT p.*,a.id attempt_id,a.status attempt_status,a.adapter_reference attempt_reference FROM payments p JOIN payment_attempts a ON a.payment_id=p.id WHERE p.id=$1 AND a.id=$2 FOR UPDATE`,[input.paymentId,input.attemptId]);
      const row=r.rows[0]; if(!row) throw new NotFoundException({code:'NOT_FOUND',message:'Pembayaran tidak ditemukan.'});
      if(Number(row.amount_idr)!==amount || row.adapter_reference!==input.reference || row.attempt_reference!==input.reference) throw new ConflictException({code:'PAYMENT_CALLBACK_MISMATCH',message:'Referensi atau amount callback tidak cocok.'});
      const seen=await c.query<any>('SELECT payment_id,event_id,outcome FROM payment_callback_events WHERE event_id=$1',[input.eventId]);
      if(seen.rows[0]) { if(seen.rows[0].payment_id!==row.id || seen.rows[0].outcome!==input.outcome) throw new ConflictException({code:'CALLBACK_CONFLICT',message:'Event callback telah digunakan.'}); return this.paymentView(row); }
      if(row.status!=='pending' && row.status!==input.outcome) throw new ConflictException({code:'PAYMENT_STATE_CONFLICT',message:'Pembayaran sudah memiliki hasil final.'});
      await c.query('INSERT INTO payment_callback_events(payment_id,event_id,outcome) VALUES($1,$2,$3)',[row.id,input.eventId,input.outcome]);
      if(row.status==='pending') { await c.query('UPDATE payment_attempts SET status=$2 WHERE id=$1',[row.attempt_id,input.outcome]); await c.query('UPDATE payments SET status=$2,updated_at=now(),version=version+1 WHERE id=$1',[row.id,input.outcome]); }
      return {...this.paymentView(row),status:input.outcome};
    });
  }
  private paymentView(row:any) { return {id:row.id,payableType:row.payable_type,payableId:row.payable_id,amountIdr:Number(row.amount_idr),currency:'IDR',status:row.status,attempt:{id:row.attempt_id??null,status:row.attempt_status??row.status,reference:row.attempt_reference??null}}; }
}
