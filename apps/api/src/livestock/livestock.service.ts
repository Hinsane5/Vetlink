import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import type { CareEventDto, CreateLivestockDto, PatchLivestockDto } from './livestock.dto.js';

@Injectable()
export class LivestockService {
  constructor(private readonly db: DatabaseService) {}

  async list(p: AuthenticatedPrincipal) {
    if (p.activeRole === 'farmer') return (await this.db.query('SELECT l.* FROM livestock l WHERE l.farmer_id=$1 ORDER BY l.created_at DESC,l.id',[p.userId])).rows;
    return (await this.db.query(`SELECT DISTINCT l.* FROM livestock l JOIN consultations c ON c.animal_id=l.id AND c.farmer_id=l.farmer_id AND c.vet_id=$1 AND c.status NOT IN ('draft','awaiting_payment') ORDER BY l.created_at DESC,l.id`,[p.userId])).rows;
  }

  async patients(p: AuthenticatedPrincipal) {
    this.requireVet(p);
    return (await this.db.query(`SELECT DISTINCT l.id,l.display_code AS "displayCode",l.name,l.species,l.breed,l.sex,l.birth_date AS "birthDate",l.estimated_age_months AS "estimatedAgeMonths",l.weight_kg AS "weightKg",l.farm_id AS "farmId",l.farmer_id AS "farmerId"
      FROM livestock l JOIN consultations c ON c.animal_id=l.id AND c.farmer_id=l.farmer_id
      WHERE c.vet_id=$1 AND c.status NOT IN ('draft','awaiting_payment') ORDER BY l.name,l.id`,[p.userId])).rows;
  }

  async get(p: AuthenticatedPrincipal,id: string) {
    const r=await this.db.query(`SELECT l.* FROM livestock l WHERE l.id=$1 AND (${p.activeRole==='farmer'?'l.farmer_id=$2':"EXISTS (SELECT 1 FROM consultations c WHERE c.animal_id=l.id AND c.farmer_id=l.farmer_id AND c.vet_id=$2 AND c.status NOT IN ('draft','awaiting_payment'))"})`,[id,p.userId]);
    if(!r.rows[0]) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Ternak/pasien tidak ditemukan.'}); return r.rows[0];
  }

  async create(p: AuthenticatedPrincipal,x: CreateLivestockDto) {
    this.requireFarmer(p);
    if(x.birthDate && x.estimatedAgeMonths !== undefined) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Isi tanggal lahir atau estimasi umur, bukan keduanya.'});
    const farm=await this.db.query('SELECT id,species FROM farms WHERE id=$1 AND owner_id=$2',[x.farmId,p.userId]);
    if(!farm.rows[0]) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Farm tidak ditemukan.'});
    if(farm.rows[0].species.length && !farm.rows[0].species.includes(x.species)) throw new UnprocessableEntityException({code:'RULE_VIOLATION',message:'Jenis ternak tidak sesuai dengan farm.'});
    try { const r=await this.db.query(`INSERT INTO livestock(farmer_id,farm_id,display_code,name,species,breed,sex,birth_date,estimated_age_months,weight_kg)
      VALUES($1,$2,upper(btrim($3)),btrim($4),btrim($5),nullif(btrim($6),''),$7,$8,$9,$10) RETURNING *`,[p.userId,x.farmId,x.displayCode,x.name,x.species,x.breed??null,x.sex,x.birthDate??null,x.estimatedAgeMonths??null,x.weightKg??null]); return r.rows[0]; }
    catch(e) { if((e as {code?:string}).code==='23505') throw new ConflictException({code:'CONFLICT',message:'Kode ternak sudah dipakai pada farm ini.'}); throw e; }
  }

  async patch(p: AuthenticatedPrincipal,id:string,x:PatchLivestockDto) {
    this.requireFarmer(p);
    if(Object.keys(x).every((key)=>key==='expectedVersion')) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Minimal satu field ternak harus diubah.'});
    if(x.birthDate && x.estimatedAgeMonths !== undefined && x.estimatedAgeMonths !== null) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Isi tanggal lahir atau estimasi umur, bukan keduanya.'});
    const r=await this.db.query(`UPDATE livestock SET display_code=upper(btrim(COALESCE($3,display_code))),name=btrim(COALESCE($4,name)),species=btrim(COALESCE($5,species)),breed=CASE WHEN $6::text IS NULL THEN breed ELSE nullif(btrim($6),'') END,sex=COALESCE($7,sex),birth_date=CASE WHEN $8::boolean THEN $9::date ELSE birth_date END,estimated_age_months=CASE WHEN $10::boolean THEN $11::integer ELSE estimated_age_months END,weight_kg=CASE WHEN $12::boolean THEN $13::numeric ELSE weight_kg END,updated_at=now(),version=version+1
      WHERE id=$1 AND farmer_id=$2 AND version=$14 RETURNING *`,[id,p.userId,x.displayCode??null,x.name??null,x.species??null,x.breed===undefined?null:x.breed,x.sex??null,x.birthDate===null||x.birthDate!==undefined,x.birthDate??null,x.estimatedAgeMonths===null||x.estimatedAgeMonths!==undefined,x.estimatedAgeMonths??null,x.weightKg===null||x.weightKg!==undefined,x.weightKg??null,x.expectedVersion]);
    if(!r.rows[0]) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Ternak tidak ditemukan atau versinya berubah.'}); return r.rows[0];
  }

  async delete(p:AuthenticatedPrincipal,id:string) {
    this.requireFarmer(p);
    try { const r=await this.db.query('DELETE FROM livestock WHERE id=$1 AND farmer_id=$2 RETURNING id',[id,p.userId]); if(!r.rowCount) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Ternak tidak ditemukan.'}); return {deleted:true}; }
    catch(e) { if((e as {code?:string}).code==='23503') throw new UnprocessableEntityException({code:'RULE_VIOLATION',message:'Ternak dengan riwayat layanan tidak dapat dihapus.'}); throw e; }
  }

  async timeline(p:AuthenticatedPrincipal,id:string) {
    await this.get(p,id);
    return (await this.db.query(`SELECT id,kind::text AS kind,occurred_at AS "occurredAt",description,provenance::text AS provenance,created_at AS "createdAt" FROM health_events WHERE animal_id=$1 AND provenance<>'clinical_note'
      UNION ALL SELECT n.id,'examination'::text,c.starts_at,n.assessment,'clinical_note'::text,n.created_at FROM clinical_notes n JOIN consultations c ON c.id=n.consultation_id WHERE n.animal_id=$1 AND n.status='final'
      ORDER BY "occurredAt" DESC,id`,[id])).rows;
  }

  async addCare(p:AuthenticatedPrincipal,id:string,x:CareEventDto) {
    this.requireFarmer(p); await this.get(p,id);
    const r=await this.db.query(`INSERT INTO health_events(animal_id,kind,occurred_at,description,actor_id,provenance,source_key) VALUES($1,$2,$3,btrim($4),$5,'farmer_report',$6)
      ON CONFLICT (provenance,source_key) DO NOTHING RETURNING id,kind,occurred_at AS "occurredAt",description,provenance`,[id,x.kind,x.occurredAt,x.description,p.userId,x.sourceKey]);
    if(r.rows[0]) return r.rows[0];
    const prior=await this.db.query(`SELECT id,kind,occurred_at AS "occurredAt",description,provenance FROM health_events WHERE provenance='farmer_report' AND source_key=$1 AND animal_id=$2 AND actor_id=$3 AND kind=$4 AND occurred_at=$5 AND description=btrim($6)`,[x.sourceKey,id,p.userId,x.kind,x.occurredAt,x.description]);
    if(prior.rows[0]) return prior.rows[0];
    throw new ConflictException({code:'CONFLICT',message:'sourceKey sudah digunakan untuk laporan yang berbeda.'});
  }

  private requireFarmer(p:AuthenticatedPrincipal){if(p.activeRole!=='farmer')throw new ForbiddenException({code:'FORBIDDEN',message:'Aksi hanya untuk Peternak.'});}
  private requireVet(p:AuthenticatedPrincipal){if(p.activeRole!=='vet')throw new ForbiddenException({code:'FORBIDDEN',message:'Aksi hanya untuk Dokter Hewan.'});}
}
