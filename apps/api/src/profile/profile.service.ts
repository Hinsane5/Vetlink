import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException, Inject } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { OpenPrivateMedia } from '../communication/media-storage.js';
import { DatabaseService } from '../database/database.service.js';
import { MEDIA_STORAGE_ADAPTER, type PrivateMediaStorageAdapter } from '../communication/media-storage.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';

type AddressInput = { label: string; recipientName: string; phone: string; addressLine: string; city: string; province: string; postalCode: string; latitude?: number; longitude?: number };
type FarmInput = { name: string; species?: string[]; timezone?: string; location?: Record<string, unknown> };
type IncomingFile = { originalname: string; mimetype: string; buffer: Buffer; size: number };

@Injectable()
export class ProfileService {
  constructor(private readonly db: DatabaseService, @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: PrivateMediaStorageAdapter) {}

  async profile(p: AuthenticatedPrincipal) {
    const table = p.activeRole === 'farmer' ? 'farmer_profiles' : 'vet_profiles';
    const result = await this.db.query(`SELECT u.id, u.full_name AS "fullName", p.* FROM users u JOIN ${table} p ON p.user_id=u.id WHERE u.id=$1`, [p.userId]);
    if (!result.rows[0]) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Profil tidak ditemukan.' });
    return result.rows[0];
  }

  async patchProfile(p: AuthenticatedPrincipal, input: Record<string, unknown>) {
    if ('verificationStatus' in input || 'verified' in input || 'userId' in input) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Status verifikasi dan pemilik tidak dapat diubah melalui profil.' });
    const table = p.activeRole === 'farmer' ? 'farmer_profiles' : 'vet_profiles';
    const fields = p.activeRole === 'vet' ? ['professionalName', 'registrationReference'] : [];
    const updates = fields.filter((key) => key in input);
    if ('fullName' in input) {
      const name = String(input.fullName).trim();
      if (!name || name.length > 120) throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'Nama tidak valid.' });
      await this.db.query('UPDATE users SET full_name=$2, updated_at=now(), version=version+1 WHERE id=$1', [p.userId, name]);
    }
    if (updates.length) await this.db.query(`UPDATE ${table} SET ${updates.map((k, i) => `${k === 'professionalName' ? 'professional_name' : 'registration_reference'}=$${i + 2}`).join(', ')}, updated_at=now(), version=version+1 WHERE user_id=$1`, [p.userId, ...updates.map(k => input[k])]);
    return this.profile(p);
  }

  async addresses(p: AuthenticatedPrincipal) { this.farmer(p); return (await this.db.query('SELECT * FROM addresses WHERE owner_id=$1 ORDER BY created_at', [p.userId])).rows; }
  async addAddress(p: AuthenticatedPrincipal, x: AddressInput) {
    this.farmer(p);
    const r = await this.db.query('INSERT INTO addresses(owner_id,label,recipient_name,phone,address_line,city,province,postal_code,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [p.userId,x.label,x.recipientName,x.phone,x.addressLine,x.city,x.province,x.postalCode,x.latitude ?? null,x.longitude ?? null]);
    return r.rows[0];
  }
  async patchAddress(p: AuthenticatedPrincipal, id: string, x: AddressInput & { expectedVersion: number }) {
    this.farmer(p);
    const r=await this.db.query(`UPDATE addresses SET label=$3,recipient_name=$4,phone=$5,address_line=$6,city=$7,province=$8,postal_code=$9,latitude=$10,longitude=$11,updated_at=now(),version=version+1 WHERE id=$1 AND owner_id=$2 AND version=$12 RETURNING *`,[id,p.userId,x.label,x.recipientName,x.phone,x.addressLine,x.city,x.province,x.postalCode,x.latitude??null,x.longitude??null,x.expectedVersion]);
    if(!r.rows[0]) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Alamat tidak ditemukan atau versinya berubah.'}); return r.rows[0];
  }
  async deleteAddress(p: AuthenticatedPrincipal, id: string) { this.farmer(p); const r = await this.db.query('DELETE FROM addresses WHERE id=$1 AND owner_id=$2 RETURNING id', [id,p.userId]); if (!r.rowCount) throw new NotFoundException({ code:'RESOURCE_NOT_FOUND', message:'Alamat tidak ditemukan.' }); }
  async farms(p: AuthenticatedPrincipal) { this.farmer(p); return (await this.db.query('SELECT * FROM farms WHERE owner_id=$1 ORDER BY created_at', [p.userId])).rows; }
  async addFarm(p: AuthenticatedPrincipal, x: FarmInput) { this.farmer(p); const r=await this.db.query('INSERT INTO farms(owner_id,name,species,timezone,location) VALUES($1,$2,$3,$4,$5) RETURNING *',[p.userId,x.name,x.species??[],x.timezone??'Asia/Jakarta',x.location??null]); return r.rows[0]; }
  async patchFarm(p: AuthenticatedPrincipal, id: string, x: Partial<FarmInput>, version: number) { this.farmer(p); const r=await this.db.query('UPDATE farms SET name=COALESCE($3,name), species=COALESCE($4,species),timezone=COALESCE($5,timezone),location=COALESCE($6,location),updated_at=now(),version=version+1 WHERE id=$1 AND owner_id=$2 AND version=$7 RETURNING *',[id,p.userId,x.name??null,x.species??null,x.timezone??null,x.location??null,version]); if(!r.rows[0]) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Farm tidak ditemukan atau versinya berubah.'}); return r.rows[0]; }

  async uploadDocument(p: AuthenticatedPrincipal, file?: IncomingFile) {
    this.vet(p); if (!file?.buffer?.length || file.size > 10 * 1024 * 1024) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Dokumen kosong atau melewati batas 10 MiB.'});
    const mime = this.detectMime(file.buffer); if (!mime || mime !== file.mimetype) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Format dokumen tidak didukung.'});
    const id=randomUUID(); const stored=await this.storage.store(id,file.buffer); if(stored.status!=='succeeded') throw new ServiceUnavailableException({code:stored.status==='failed'?stored.error.code:'SERVICE_UNAVAILABLE',message:stored.status==='failed'?stored.error.message:'Penyimpanan dokumen masih diproses.'});
    try { const r=await this.db.query('INSERT INTO professional_documents(owner_id,filename,mime_type,byte_size,content_sha256,storage_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,filename,mime_type AS "mimeType",byte_size AS "byteSize"',[p.userId,file.originalname.slice(0,255),mime,file.size,createHash('sha256').update(file.buffer).digest('hex'),id]); return r.rows[0]; }
    catch { await this.storage.remove(id); throw new ServiceUnavailableException({code:'SERVICE_UNAVAILABLE',message:'Metadata dokumen tidak dapat disimpan.'}); }
  }
  async submit(p: AuthenticatedPrincipal, ids: string[]) {
    this.vet(p); if(ids.length<1||ids.length>5||new Set(ids).size!==ids.length) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Pilih 1 sampai 5 dokumen unik.'});
    return this.db.transaction(async (c: PoolClient) => {
      const owned=await c.query('SELECT id FROM professional_documents WHERE owner_id=$1 AND id=ANY($2::uuid[])',[p.userId,ids]);
      if(owned.rowCount!==ids.length) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Dokumen tidak ditemukan.'});
      const vet=await c.query("SELECT verification_status FROM vet_profiles WHERE user_id=$1 FOR UPDATE",[p.userId]);
      if(!vet.rows[0]) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Profil dokter tidak ditemukan.'});
      if(vet.rows[0].verification_status==='verified') throw new UnprocessableEntityException({code:'RULE_VIOLATION',message:'Profil terverifikasi tidak perlu diajukan ulang.'});
      const s=await c.query('INSERT INTO verification_submissions(vet_id,document_ids) VALUES($1,$2) RETURNING *',[p.userId,ids]);
      await c.query("UPDATE vet_profiles SET verification_status='pending',updated_at=now(),version=version+1 WHERE user_id=$1",[p.userId]); return s.rows[0];
    });
  }
  async verification(p: AuthenticatedPrincipal) { this.vet(p); return (await this.db.query('SELECT id,document_ids AS "documentIds",status,reviewer_reason AS "reviewerReason",submitted_at AS "submittedAt",reviewed_at AS "reviewedAt",version FROM verification_submissions WHERE vet_id=$1 ORDER BY submitted_at DESC',[p.userId])).rows; }
  async reviewQueue(p: AuthenticatedPrincipal) {
    const trusted=await this.db.query('SELECT 1 FROM trusted_reviewers WHERE user_id=$1',[p.userId]);
    if(!trusted.rowCount) throw new ForbiddenException({code:'FORBIDDEN',message:'Reviewer tepercaya diperlukan.'});
    return (await this.db.query(`SELECT s.id,s.vet_id AS "vetId",u.full_name AS "fullName",v.professional_name AS "professionalName",v.registration_reference AS "registrationReference",s.document_ids AS "documentIds",s.submitted_at AS "submittedAt",s.version FROM verification_submissions s JOIN vet_profiles v ON v.user_id=s.vet_id JOIN users u ON u.id=s.vet_id WHERE s.status='pending' ORDER BY s.submitted_at`,[])).rows;
  }
  async reviewerDocument(p: AuthenticatedPrincipal, id: string): Promise<{ media: OpenPrivateMedia; mime: string; filename: string }> {
    const trusted=await this.db.query('SELECT 1 FROM trusted_reviewers WHERE user_id=$1',[p.userId]);
    if(!trusted.rowCount) throw new ForbiddenException({code:'FORBIDDEN',message:'Reviewer tepercaya diperlukan.'});
    const q=await this.db.query(`SELECT d.storage_key,d.mime_type,d.filename FROM professional_documents d WHERE d.id=$1 AND EXISTS(SELECT 1 FROM verification_submissions s WHERE d.id=ANY(s.document_ids) AND s.status='pending')`,[id]);
    if(!q.rows[0]) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Dokumen review tidak ditemukan.'});
    const result=await this.storage.open(q.rows[0].storage_key);
    if(result.status!=='succeeded') throw new ServiceUnavailableException({code:result.status==='failed'?result.error.code:'SERVICE_UNAVAILABLE',message:result.status==='failed'?result.error.message:'Dokumen masih diproses.'});
    return {media:result.value,mime:q.rows[0].mime_type,filename:q.rows[0].filename};
  }
  async review(p: AuthenticatedPrincipal, id: string, status: 'verified'|'revision_required', reason?: string) {
    const trusted=await this.db.query('SELECT 1 FROM trusted_reviewers WHERE user_id=$1',[p.userId]); if(!trusted.rowCount) throw new ForbiddenException({code:'FORBIDDEN',message:'Reviewer tepercaya diperlukan.'});
    if(status==='revision_required'&&(!reason?.trim()||reason.trim().length>1000)) throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Alasan revisi wajib, maksimal 1000 karakter.'});
    return this.db.transaction(async c=>{
      const locked=await c.query('SELECT vet_id,status FROM verification_submissions WHERE id=$1 FOR UPDATE',[id]); const s=locked.rows[0];
      if(!s) throw new NotFoundException({code:'RESOURCE_NOT_FOUND',message:'Pengajuan tidak ditemukan.'});
      if(s.status!=='pending') throw new UnprocessableEntityException({code:'RULE_VIOLATION',message:'Pengajuan ini sudah ditinjau.'});
      const out=await c.query('UPDATE verification_submissions SET status=$2,reviewer_reason=$3,reviewed_at=now(),reviewed_by=$4,version=version+1 WHERE id=$1 RETURNING *',[id,status,status==='revision_required'?reason!.trim():null,p.userId]);
      await c.query('UPDATE vet_profiles SET verification_status=$2,updated_at=now(),version=version+1 WHERE user_id=$1',[s.vet_id,status]); return out.rows[0];
    });
  }
  private farmer(p: AuthenticatedPrincipal) { if(p.activeRole!=='farmer') throw new ForbiddenException({code:'FORBIDDEN',message:'Aksi hanya untuk Peternak.'}); }
  private vet(p: AuthenticatedPrincipal) { if(p.activeRole!=='vet') throw new ForbiddenException({code:'FORBIDDEN',message:'Aksi hanya untuk Dokter Hewan.'}); }
  private detectMime(b: Buffer): string | null { if(b.subarray(0,5).toString()==='%PDF-') return 'application/pdf'; if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return'image/jpeg';if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return'image/webp';return null; }
}
