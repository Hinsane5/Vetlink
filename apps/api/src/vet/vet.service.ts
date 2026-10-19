import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { BlockedTimeDto, BlockedTimePatchDto, DirectoryQueryDto, ScheduleQueryDto, SlotsQueryDto, VetAvailabilityDto } from './vet.dto.js';

const ACTIVE = "('awaiting_payment','requested','scheduled','reschedule_pending','in_progress')";
type Db = Pick<DatabaseService, 'query'|'transaction'>;

@Injectable()
export class VetService {
  constructor(private readonly db: DatabaseService) {}

  async directory(q: DirectoryQueryDto) {
    const rows = await this.db.query(`
      SELECT v.user_id AS id, COALESCE(v.professional_name,u.full_name) AS "professionalName",
        d.experience_years AS "experienceYears", d.specialties, d.species,
        d.practice_location AS "practiceLocation", d.service_areas AS "serviceAreas",
        a.accepting_new_requests AS "acceptingNewRequests", a.services, a.timezone,
        a.weekday_rules AS "weekdayRules",
        rates.fees, rates.min_fee AS "minFeeIdr", rates.max_fee AS "maxFeeIdr"
      FROM vet_profiles v JOIN users u ON u.id=v.user_id
      JOIN vet_directory_profiles d ON d.vet_id=v.user_id
      JOIN vet_availabilities a ON a.vet_id=v.user_id
      CROSS JOIN LATERAL (
        SELECT jsonb_object_agg(x.service_type, x.fee_idr) AS fees,
               min(x.fee_idr) AS min_fee, max(x.fee_idr) AS max_fee
        FROM (SELECT DISTINCT ON (service_type) service_type, fee_idr FROM vet_service_rates
              WHERE vet_id=v.user_id AND effective_at<=now() AND service_type::text=ANY(a.services)
                AND ($3::text IS NULL OR service_type::text=$3)
              ORDER BY service_type,effective_at DESC) x
      ) rates
      WHERE v.verification_status='verified'
        AND rates.min_fee IS NOT NULL
        AND ($1::text IS NULL OR (COALESCE(v.professional_name,u.full_name) ILIKE '%'||$1||'%'))
        AND ($2::text IS NULL OR $2=ANY(d.species))
        AND ($3::text IS NULL OR $3=ANY(a.services))
        AND ($4::text IS NULL OR d.practice_location ILIKE '%'||$4||'%' OR EXISTS (SELECT 1 FROM unnest(d.service_areas) area WHERE area ILIKE '%'||$4||'%'))
        AND ($5::boolean IS NULL OR a.accepting_new_requests=$5)
        AND ($6::bigint IS NULL OR rates.max_fee >= $6)
        AND ($7::bigint IS NULL OR rates.min_fee <= $7)
      ORDER BY COALESCE(v.professional_name,u.full_name),v.user_id`,
    [q.name ?? null,q.species ?? null,q.service ?? null,q.location ?? null,q.available === undefined ? null : q.available === 'true',q.minFee ?? null,q.maxFee ?? null]);
    return rows.rows;
  }

  async detail(id: string) {
    const r = await this.db.query(`SELECT v.user_id AS id,COALESCE(v.professional_name,u.full_name) AS "professionalName",
      d.experience_years AS "experienceYears",d.specialties,d.species,d.practice_location AS "practiceLocation",d.service_areas AS "serviceAreas",
      a.accepting_new_requests AS "acceptingNewRequests",a.services,a.timezone,a.weekday_rules AS "weekdayRules",
      a.chat_duration_minutes AS "chatDurationMinutes",a.visit_duration_minutes AS "visitDurationMinutes",
      COALESCE(rates.fees,'{}'::jsonb) AS rates
      FROM vet_profiles v JOIN users u ON u.id=v.user_id
      JOIN vet_directory_profiles d ON d.vet_id=v.user_id JOIN vet_availabilities a ON a.vet_id=v.user_id
      LEFT JOIN LATERAL (SELECT jsonb_object_agg(service_type,fee_idr) fees FROM
        (SELECT DISTINCT ON(service_type) service_type,fee_idr FROM vet_service_rates WHERE vet_id=v.user_id AND effective_at<=now() AND service_type::text=ANY(a.services) ORDER BY service_type,effective_at DESC) x) rates ON true
      WHERE v.user_id=$1 AND v.verification_status='verified' AND rates.fees IS NOT NULL`, [id]);
    if (!r.rows[0]) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Dokter tidak ditemukan.'});
    return r.rows[0];
  }

  async availability(p: AuthenticatedPrincipal) {
    this.vet(p);
    const r=await this.db.query(`SELECT a.*,d.experience_years AS "experienceYears",d.specialties,d.species,d.practice_location AS "practiceLocation",d.service_areas AS "serviceAreas",
      COALESCE(rates.fees,'{}'::jsonb) AS rates FROM vet_availabilities a JOIN vet_directory_profiles d ON d.vet_id=a.vet_id
      LEFT JOIN LATERAL (SELECT jsonb_object_agg(service_type,fee_idr) fees FROM
      (SELECT DISTINCT ON(service_type) service_type,fee_idr FROM vet_service_rates WHERE vet_id=a.vet_id AND effective_at<=now() ORDER BY service_type,effective_at DESC) x) rates ON true WHERE a.vet_id=$1`,[p.userId]);
    if(!r.rows[0]) return null;
    return r.rows[0];
  }

  async updateAvailability(p: AuthenticatedPrincipal, x: VetAvailabilityDto) {
    this.vet(p); this.validateAvailability(x);
    return this.db.transaction(async c=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[p.userId]);
      const current=await c.query('SELECT version FROM vet_availabilities WHERE vet_id=$1 FOR UPDATE',[p.userId]);
      if(current.rows[0] && current.rows[0].version!==x.expectedVersion) throw new ConflictException({code:'CONFLICT',message:'Versi ketersediaan berubah.'});
      await c.query(`INSERT INTO vet_availabilities(vet_id,accepting_new_requests,services,timezone,weekday_rules,chat_duration_minutes,visit_duration_minutes,version)
        VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(vet_id) DO UPDATE SET accepting_new_requests=EXCLUDED.accepting_new_requests,
        services=EXCLUDED.services,timezone=EXCLUDED.timezone,weekday_rules=EXCLUDED.weekday_rules,chat_duration_minutes=EXCLUDED.chat_duration_minutes,
        visit_duration_minutes=EXCLUDED.visit_duration_minutes,updated_at=now(),version=vet_availabilities.version+1`,
      [p.userId,x.acceptingNewRequests,x.services,x.timezone,JSON.stringify(x.weekdayRules),x.chatDurationMinutes,x.visitDurationMinutes]);
      await c.query(`INSERT INTO vet_directory_profiles(vet_id,experience_years,specialties,species,practice_location,service_areas)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(vet_id) DO UPDATE SET experience_years=EXCLUDED.experience_years,specialties=EXCLUDED.specialties,
        species=EXCLUDED.species,practice_location=EXCLUDED.practice_location,service_areas=EXCLUDED.service_areas,updated_at=now(),version=vet_directory_profiles.version+1`,
      [p.userId,x.experienceYears??0,x.specialties??[],x.species??[],x.practiceLocation??'',x.serviceAreas??[]]);
      for(const service of x.services){
        const fee=x.rates[service];
        if(!Number.isSafeInteger(fee)||fee!<0) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:`Tarif integer rupiah untuk ${service} wajib diisi.`});
        const latest=await c.query('SELECT fee_idr FROM vet_service_rates WHERE vet_id=$1 AND service_type=$2 ORDER BY effective_at DESC LIMIT 1',[p.userId,service]);
        if(!latest.rows[0] || Number(latest.rows[0].fee_idr)!==fee) await c.query('INSERT INTO vet_service_rates(vet_id,service_type,fee_idr,effective_at) VALUES($1,$2,$3,now())',[p.userId,service,fee]);
      }
      return {operationId:randomUUID(),status:'succeeded',occurredAt:new Date().toISOString(),value:await this.availabilityFor(c,p.userId)};
    });
  }

  async slots(id:string,q:SlotsQueryDto){
    const endDate=new Date(`${q.dateTo}T00:00:00Z`),startDate=new Date(`${q.dateFrom}T00:00:00Z`);
    if(!Number.isFinite(endDate.valueOf())||!Number.isFinite(startDate.valueOf())||endDate<startDate||endDate.valueOf()-startDate.valueOf()>31*86400000) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Rentang slot maksimal 32 hari.'});
    const r=await this.db.query(`WITH vet AS (
      SELECT a.vet_id,a.timezone,a.weekday_rules,CASE WHEN $2='chat' THEN a.chat_duration_minutes ELSE a.visit_duration_minutes END duration
      FROM vet_availabilities a JOIN vet_profiles v ON v.user_id=a.vet_id
      WHERE a.vet_id=$1 AND a.accepting_new_requests AND $2=ANY(a.services) AND v.verification_status='verified'
        AND EXISTS(SELECT 1 FROM vet_service_rates sr WHERE sr.vet_id=a.vet_id AND sr.service_type=$2::consultation_service_type AND sr.effective_at<=now())
    ), days AS (SELECT vet.*, d::date local_date FROM vet CROSS JOIN generate_series($3::date,$4::date,interval '1 day') d),
    rules AS (SELECT days.*, (rule->>'start')::time local_start,(rule->>'end')::time local_end
      FROM days CROSS JOIN LATERAL jsonb_array_elements(days.weekday_rules) rule
      WHERE (rule->>'weekday')::int=extract(dow from days.local_date)::int),
    candidates AS (SELECT rules.*, (local_date+local_start) AT TIME ZONE timezone AS starts_at,
      (local_date+local_start) AT TIME ZONE timezone + make_interval(mins=>duration) AS ends_at
      FROM rules WHERE local_start<local_end),
    slots AS (SELECT candidates.*, generate_series(starts_at, ((local_date+local_end) AT TIME ZONE timezone)-make_interval(mins=>duration),make_interval(mins=>duration)) slot_start
      FROM candidates)
    SELECT slot_start AS "startsAt",slot_start+make_interval(mins=>duration) AS "endsAt"
    FROM slots WHERE slot_start>now() AND NOT EXISTS(SELECT 1 FROM consultations c WHERE c.vet_id=$1 AND c.status IN ${ACTIVE}
      AND tstzrange(c.starts_at,c.ends_at,'[)') && tstzrange(slot_start,slot_start+make_interval(mins=>duration),'[)'))
      AND NOT EXISTS(SELECT 1 FROM vet_blocked_times b WHERE b.vet_id=$1 AND b.status='active'
      AND tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(slot_start,slot_start+make_interval(mins=>duration),'[)'))
    ORDER BY slot_start`,[id,q.service,q.dateFrom,q.dateTo]);
    return r.rows;
  }

  async blocked(p:AuthenticatedPrincipal){this.vet(p);return (await this.db.query("SELECT id,starts_at AS \"startsAt\",ends_at AS \"endsAt\",reason,status,version FROM vet_blocked_times WHERE vet_id=$1 ORDER BY starts_at",[p.userId])).rows;}
  async schedule(p:AuthenticatedPrincipal,q:ScheduleQueryDto){this.vet(p);const from=new Date(q.from),to=new Date(q.to);if(from>=to||to.valueOf()-from.valueOf()>32*86400000)throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Rentang kalender maksimal 32 hari.'});const [appointments,blockedTimes]=await Promise.all([this.db.query(`SELECT id,display_code AS "displayCode",service_type AS service,status,starts_at AS "startsAt",ends_at AS "endsAt",fee_snapshot_idr AS "feeIdr" FROM consultations WHERE vet_id=$1 AND status IN ${ACTIVE} AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at`,[p.userId,from.toISOString(),to.toISOString()]),this.db.query("SELECT id,starts_at AS \"startsAt\",ends_at AS \"endsAt\",reason,status FROM vet_blocked_times WHERE vet_id=$1 AND status='active' AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at",[p.userId,from.toISOString(),to.toISOString()])]);return {appointments:appointments.rows,blockedTimes:blockedTimes.rows};}
  async createBlocked(p:AuthenticatedPrincipal,x:BlockedTimeDto){this.vet(p);const start=new Date(x.startsAt),end=new Date(x.endsAt);if(start<=new Date()||start>=end) throw new UnprocessableEntityException({code:'RULE_VIOLATION',message:'Interval blokir harus valid dan berada di masa depan.'});return this.db.transaction(async c=>{await this.lockVet(c,p.userId);await this.assertNoOverlap(c,p.userId,start,end);const r=await c.query('INSERT INTO vet_blocked_times(vet_id,starts_at,ends_at,reason) VALUES($1,$2,$3,$4) RETURNING id,starts_at AS "startsAt",ends_at AS "endsAt",reason,status,version',[p.userId,start.toISOString(),end.toISOString(),x.reason.trim()]);return {operationId:randomUUID(),status:'succeeded',occurredAt:new Date().toISOString(),value:r.rows[0]};});}
  async updateBlocked(p:AuthenticatedPrincipal,id:string,x:BlockedTimePatchDto){this.vet(p);const start=new Date(x.startsAt),end=new Date(x.endsAt);if(start<=new Date()||start>=end)throw new UnprocessableEntityException({code:'RULE_VIOLATION',message:'Interval blokir harus valid dan berada di masa depan.'});return this.db.transaction(async c=>{await this.lockVet(c,p.userId);const exists=await c.query("SELECT id FROM vet_blocked_times WHERE id=$1 AND vet_id=$2 AND status='active' AND version=$3 FOR UPDATE",[id,p.userId,x.expectedVersion]);if(!exists.rowCount)throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Blokir tidak ditemukan atau versinya berubah.'});await this.assertNoOverlap(c,p.userId,start,end,id);const r=await c.query("UPDATE vet_blocked_times SET starts_at=$3,ends_at=$4,reason=$5,version=version+1,updated_at=now() WHERE id=$1 AND vet_id=$2 RETURNING id,starts_at AS \"startsAt\",ends_at AS \"endsAt\",reason,status,version",[id,p.userId,start.toISOString(),end.toISOString(),x.reason.trim()]);return r.rows[0];});}
  async cancelBlocked(p:AuthenticatedPrincipal,id:string,version:number){this.vet(p);const r=await this.db.query("UPDATE vet_blocked_times SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1 AND vet_id=$2 AND version=$3 AND status='active' RETURNING id,status,version",[id,p.userId,version]);if(!r.rows[0])throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Blokir tidak ditemukan atau versinya berubah.'});return r.rows[0];}

  private async availabilityFor(c:PoolClient,id:string){return (await c.query(`SELECT a.*,d.experience_years AS "experienceYears",d.specialties,d.species,d.practice_location AS "practiceLocation",d.service_areas AS "serviceAreas",
    COALESCE(rates.fees,'{}'::jsonb) AS rates FROM vet_availabilities a JOIN vet_directory_profiles d ON d.vet_id=a.vet_id
    LEFT JOIN LATERAL (SELECT jsonb_object_agg(service_type,fee_idr) fees FROM (SELECT DISTINCT ON(service_type) service_type,fee_idr FROM vet_service_rates WHERE vet_id=a.vet_id AND effective_at<=now() ORDER BY service_type,effective_at DESC) x) rates ON true WHERE a.vet_id=$1`,[id])).rows[0];}
  private async lockVet(c:PoolClient,id:string){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);}
  private async assertNoOverlap(c:PoolClient,id:string,start:Date,end:Date,exceptId?:string){const r=await c.query(`SELECT 1 FROM vet_blocked_times WHERE vet_id=$1 AND status='active' AND id<>COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000') AND starts_at<$3 AND ends_at>$2
    UNION ALL SELECT 1 FROM consultations WHERE vet_id=$1 AND status IN ${ACTIVE} AND starts_at<$3 AND ends_at>$2 LIMIT 1`,[id,start.toISOString(),end.toISOString(),exceptId??null]);if(r.rowCount)throw new ConflictException({code:'CONFLICT',message:'Interval berbenturan dengan blokir atau layanan yang masih aktif.'});}
  private validateAvailability(x:VetAvailabilityDto){
    try{new Intl.DateTimeFormat('en',{timeZone:x.timezone});}catch{throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Timezone IANA tidak valid.'});}
    if(new Set(x.services).size!==x.services.length||new Set(x.weekdayRules.map(r=>r.weekday)).size!==x.weekdayRules.length)throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Layanan dan aturan weekday tidak boleh duplikat.'});
    for(const r of x.weekdayRules)if(r.start>=r.end)throw new UnprocessableEntityException({code:'RULE_VIOLATION',message:'Jam mulai harus sebelum jam selesai.'});
    if(x.acceptingNewRequests&&x.services.some(s=>!Number.isSafeInteger(x.rates[s])||x.rates[s]!<0))throw new UnprocessableEntityException({code:'RULE_VIOLATION',message:'Setiap layanan aktif memerlukan tarif integer rupiah.'});
    if(x.experienceYears!==undefined&&(!Number.isInteger(x.experienceYears)||x.experienceYears<0||x.experienceYears>80))throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Pengalaman tidak valid.'});
  }
  private vet(p:AuthenticatedPrincipal){if(p.activeRole!=='vet')throw new ForbiddenException({code:'FORBIDDEN',message:'Aksi hanya untuk Dokter Hewan.'});}
}
