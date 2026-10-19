import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

const appPath = resolve(process.cwd(), 'dist/main.js');

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

async function startServer(port, overrides = {}) {
  const child = spawn(process.execPath, [appPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API process exited before startup:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/health/live`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return { child, baseUrl, output: () => output };
    } catch {
      // Retry while NestJS is starting.
    }
    await delay(250);
  }
  child.kill('SIGKILL');
  throw new Error(`API process did not start:\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(5_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function registerSmokeUser(baseUrl, role, fullName) {
  const response = await fetch(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `be07-${randomUUID()}@example.invalid`,
      fullName,
      password: 'smoke-only-password-not-secret',
      role,
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function sendJson(baseUrl, path, accessToken, method, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function uploadBody(consultationId, bytes, mimeType, filename) {
  const form = new FormData();
  form.set('consultationId', consultationId);
  form.set('file', new Blob([bytes], { type: mimeType }), filename);
  return form;
}

const smokeMediaDirectory = await mkdtemp(join(tmpdir(), 'vetlink-be07-smoke-'));
const healthy = await startServer(await availablePort(), {
  MEDIA_STORAGE_DIR: smokeMediaDirectory,
  MEDIA_IMAGE_MAX_BYTES: String(10 * 1024 * 1024),
  MEDIA_VIDEO_MAX_BYTES: String(50 * 1024 * 1024),
  CHAT_DELIVERY_TEST_FAIL_FIRST_ATTEMPT: 'true',
});
try {
  const liveResponse = await fetch(`${healthy.baseUrl}/v1/health/live`);
  assert.equal(liveResponse.status, 200);
  const live = await liveResponse.json();
  assert.deepEqual(Object.keys(live).sort(), ['requestId', 'service', 'status', 'timestamp']);
  assert.equal(live.status, 'ok');
  assert.equal(live.service, 'vetlink-api');
  assert.equal(liveResponse.headers.get('x-request-id'), live.requestId);

  const readyResponse = await fetch(`${healthy.baseUrl}/v1/health/ready`);
  if (readyResponse.status === 200) {
    const ready = await readyResponse.json();
    assert.deepEqual(ready.checks, { database: 'ok' });
    assert.equal(ready.status, 'ready');
  } else {
    assert.equal(readyResponse.status, 503);
    const unavailable = await readyResponse.json();
    assert.equal(unavailable.code, 'SERVICE_UNAVAILABLE');
    assert.equal(unavailable.message, 'Service is not ready');
    assert.ok(unavailable.requestId);
  }

  const openApiResponse = await fetch(`${healthy.baseUrl}/openapi.json`);
  assert.equal(openApiResponse.status, 200);
  const openApi = await openApiResponse.json();
  assert.equal(openApi.openapi, '3.0.0');
  assert.ok(openApi.paths['/v1/health/live']);
  assert.ok(openApi.paths['/v1/health/ready']);
  assert.ok(openApi.paths['/v1/auth/register']?.post);
  assert.ok(openApi.paths['/v1/auth/login']?.post);
  assert.ok(openApi.paths['/v1/auth/logout']?.post);
  assert.ok(openApi.paths['/v1/auth/refresh']?.post);
  assert.ok(openApi.paths['/v1/auth/password-reset']?.post);
  assert.ok(openApi.paths['/v1/auth/password-reset/confirm']?.post);
  assert.ok(openApi.paths['/v1/me']?.get);
  assert.ok(openApi.paths['/v1/attachments/uploads']?.post);
  assert.ok(openApi.paths['/v1/attachments/{id}/commit']?.post);
  assert.ok(openApi.paths['/v1/attachments/{id}/content']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/messages']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/messages']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/messages/{messageId}/retry']?.post);
  assert.ok(openApi.components.schemas.ConsultationStatus);
  assert.ok(openApi.components.schemas.ApiErrorResponseDto);
  assert.ok(openApi.components.schemas.AdapterOperationResult);
  assert.ok(openApi.components.parameters.IdempotencyKey);
  assert.ok(openApi.components.schemas.CursorPageRequest);

  const unauthenticatedResponse = await fetch(`${healthy.baseUrl}/v1/me`);
  assert.equal(unauthenticatedResponse.status, 401);
  const unauthenticated = await unauthenticatedResponse.json();
  assert.equal(unauthenticated.code, 'UNAUTHENTICATED');
  assert.ok(unauthenticated.requestId);
  assert.equal('stack' in unauthenticated, false);

  const smokePassword = 'smoke-only-password-not-secret';
  const loginResponses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    loginResponses.push(await fetch(`${healthy.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'absent-login@example.invalid',
        password: smokePassword,
        activeRole: 'farmer',
      }),
    }));
  }
  for (const response of loginResponses.slice(0, 5)) {
    assert.ok([401, 503].includes(response.status), `Unexpected login status sequence: ${loginResponses.map((item) => item.status).join(',')}`);
  }
  assert.equal(loginResponses[5].status, 429);
  assert.ok(Number(loginResponses[5].headers.get('retry-after')) > 0);
  const rateLimited = await loginResponses[5].json();
  assert.equal(rateLimited.code, 'RATE_LIMITED');
  assert.equal(healthy.output().includes(smokePassword), false);

  const resetResponse = await fetch(`${healthy.baseUrl}/v1/auth/password-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'absent@example.invalid' }),
  });
  assert.equal(resetResponse.status, 202);
  const reset = await resetResponse.json();
  assert.deepEqual(reset, { message: 'Jika akun terdaftar, instruksi reset akan dikirim.' });
  assert.equal('token' in reset, false);

  if (readyResponse.status === 200) {
    const database = new Pool({
      host: process.env.DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.DATABASE_PORT ?? 5432),
      database: process.env.DATABASE_NAME,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      ssl: process.env.DATABASE_SSL === 'true',
    });
    const actors = [];
    let consultationId;
    let unpaidConsultationId;
    let failedStorageServer;
    try {
      const farmer = await registerSmokeUser(healthy.baseUrl, 'farmer', 'Peternak Fiktif BE-07');
      const vet = await registerSmokeUser(healthy.baseUrl, 'vet', 'Dokter Fiktif BE-07');
      const outsider = await registerSmokeUser(healthy.baseUrl, 'farmer', 'Peternak Lain Fiktif BE-07');
      actors.push(farmer.user.id, vet.user.id, outsider.user.id);

      const farmId = randomUUID();
      const animalId = randomUUID();
      consultationId = randomUUID();
      await database.query(
        `INSERT INTO farms (id, owner_id, name, species, timezone)
         VALUES ($1, $2, 'Farm Fiktif BE-07', ARRAY['sapi'], 'Asia/Jakarta')`,
        [farmId, farmer.user.id],
      );
      await database.query(
        `INSERT INTO livestock (id, farmer_id, farm_id, display_code, name, species, sex)
         VALUES ($1, $2, $3, 'BE07-001', 'Ternak Fiktif BE-07', 'sapi', 'female')`,
        [animalId, farmer.user.id, farmId],
      );
      await database.query(
        `INSERT INTO consultations
           (id, display_code, farmer_id, vet_id, animal_id, service_type, complaint, status,
            starts_at, ends_at, fee_snapshot_idr, commission_snapshot_idr)
         VALUES ($1, $2, $3, $4, $5, 'chat', 'Keluhan fiktif untuk smoke check', 'scheduled',
                 now() + interval '1 hour', now() + interval '2 hours', 1000, 0)`,
        [consultationId, `BE07-${consultationId}`, farmer.user.id, vet.user.id, animalId],
      );
      await database.query(
        `INSERT INTO payments (owner_id, payable_type, payable_id, method, amount_idr, status, operation_key)
         VALUES ($1, 'consultation', $2, 'local-test', 1000, 'succeeded', $3)`,
        [farmer.user.id, consultationId, `be07-smoke-${consultationId}`],
      );

      const createdAnimalResponse = await sendJson(healthy.baseUrl, '/v1/livestock', farmer.accessToken, 'POST', {
        farmId, displayCode: 'new-001', name: 'Anak Fiktif', species: 'sapi', sex: 'unknown', estimatedAgeMonths: 2, weightKg: 12.5,
      });
      assert.equal(createdAnimalResponse.status, 201);
      const createdAnimal = await createdAnimalResponse.json();
      assert.equal(createdAnimal.display_code, 'NEW-001');
      unpaidConsultationId = randomUUID();
      await database.query(`INSERT INTO consultations
        (id, display_code, farmer_id, vet_id, animal_id, service_type, complaint, status,
         starts_at, ends_at, fee_snapshot_idr, commission_snapshot_idr)
        VALUES ($1, $2, $3, $4, $5, 'chat', 'Booking fiktif belum dibayar', 'awaiting_payment',
                now() + interval '3 hours', now() + interval '4 hours', 1000, 0)`,
        [unpaidConsultationId, `BE03-${unpaidConsultationId}`, farmer.user.id, vet.user.id, createdAnimal.id]);
      const farmTakeover = await sendJson(healthy.baseUrl, '/v1/livestock', outsider.accessToken, 'POST', {
        farmId, displayCode: 'TAKE-001', name: 'Tidak boleh', species: 'sapi', sex: 'female',
      });
      assert.equal(farmTakeover.status, 404);
      const outsiderAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}`, outsider.accessToken, 'GET');
      assert.equal(outsiderAnimal.status, 404);
      const vetUnrelatedAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}`, vet.accessToken, 'GET');
      assert.equal(vetUnrelatedAnimal.status, 404);
      const vetPatientList = await sendJson(healthy.baseUrl, '/v1/patients', vet.accessToken, 'GET');
      assert.equal(vetPatientList.status, 200);
      assert.deepEqual((await vetPatientList.json()).map((item) => item.id), [animalId]);
      const outsiderPatientList = await sendJson(healthy.baseUrl, '/v1/patients', outsider.accessToken, 'GET');
      assert.equal(outsiderPatientList.status, 403);
      const patchAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}`, farmer.accessToken, 'PATCH', { expectedVersion: 1, name: 'Anak Fiktif Revisi' });
      assert.equal(patchAnimal.status, 200);
      const staleAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}`, farmer.accessToken, 'PATCH', { expectedVersion: 1, name: 'Stale' });
      assert.equal(staleAnimal.status, 404);
      const careBody = { kind: 'care', occurredAt: new Date().toISOString(), description: 'Catatan perawatan fiktif', sourceKey: `be03-${randomUUID()}` };
      const careFirst = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}/care-events`, farmer.accessToken, 'POST', careBody);
      assert.equal(careFirst.status, 201);
      const careAgain = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}/care-events`, farmer.accessToken, 'POST', careBody);
      assert.equal(careAgain.status, 201);
      assert.equal((await careAgain.json()).id, (await careFirst.json()).id);

      await database.query(`INSERT INTO clinical_notes(consultation_id,farmer_id,vet_id,animal_id,assessment) VALUES($1,$2,$3,$4,'Draft fiktif yang tidak boleh tampil')`,[consultationId,farmer.user.id,vet.user.id,animalId]);
      const hiddenDraftTimeline = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}/health-events`, farmer.accessToken, 'GET');
      assert.equal(hiddenDraftTimeline.status, 200);
      assert.equal((await hiddenDraftTimeline.json()).length, 0);
      await database.query(`UPDATE clinical_notes SET status='final',assessment='Temuan final fiktif',finalized_at=now(),finalized_by=$2 WHERE consultation_id=$1`,[consultationId,vet.user.id]);
      const finalTimeline = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}/health-events`, vet.accessToken, 'GET');
      assert.equal(finalTimeline.status, 200);
      const finalEvents = await finalTimeline.json();
      assert.equal(finalEvents.length, 1);
      assert.equal(finalEvents[0].description, 'Temuan final fiktif');
      assert.equal('attachments' in finalEvents[0], false);

      const messagesPath = `/v1/consultations/${consultationId}/messages`;
      const ownerList = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2`, farmer.accessToken, 'GET');
      assert.equal(ownerList.status, 200);
      assert.deepEqual((await ownerList.json()).items, []);
      const relatedList = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2`, vet.accessToken, 'GET');
      assert.equal(relatedList.status, 200);
      const outsiderList = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2`, outsider.accessToken, 'GET');
      assert.equal(outsiderList.status, 404);

      const clientMessageId = randomUUID();
      const firstBody = { clientMessageId, text: 'Pesan fiktif untuk retry BE-07' };
      const unverifiedSend = await sendJson(healthy.baseUrl, messagesPath, vet.accessToken, 'POST', firstBody);
      assert.equal(unverifiedSend.status, 403);
      const farmerToUnverifiedVet = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', firstBody);
      assert.equal(farmerToUnverifiedVet.status, 403);
      await database.query("UPDATE vet_profiles SET verification_status = 'verified' WHERE user_id = $1", [vet.user.id]);

      const firstSend = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', firstBody);
      assert.equal(firstSend.status, 201);
      const failedMessage = await firstSend.json();
      assert.equal(failedMessage.deliveryStatus, 'failed');
      assert.equal(failedMessage.deliveryAttempt, 1);
      const recipientBeforeRetry = await sendJson(healthy.baseUrl, `${messagesPath}?limit=10`, vet.accessToken, 'GET');
      assert.deepEqual((await recipientBeforeRetry.json()).items, []);

      const retried = await sendJson(healthy.baseUrl, `${messagesPath}/${failedMessage.id}/retry`, farmer.accessToken, 'POST');
      assert.equal(retried.status, 200);
      const deliveredMessage = await retried.json();
      assert.equal(deliveredMessage.id, failedMessage.id);
      assert.equal(deliveredMessage.deliveryStatus, 'sent');
      assert.equal(deliveredMessage.deliveryAttempt, 2);
      const duplicate = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', firstBody);
      assert.equal(duplicate.status, 201);
      assert.equal((await duplicate.json()).id, failedMessage.id);
      const fingerprintConflict = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', { ...firstBody, text: 'Isi berbeda' });
      assert.equal(fingerprintConflict.status, 409);

      for (let index = 0; index < 3; index += 1) {
        const response = await sendJson(healthy.baseUrl, messagesPath, vet.accessToken, 'POST', {
          clientMessageId: randomUUID(),
          text: `Pesan fiktif ${index + 1}`,
        });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).deliveryStatus, 'sent');
      }

      const uploadKey = `be07-upload-${randomUUID()}`;
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
      failedStorageServer = await startServer(await availablePort(), {
        MEDIA_STORAGE_DIR: '/dev/null/vetlink-be07-private-media',
        MEDIA_IMAGE_MAX_BYTES: String(10 * 1024 * 1024),
        MEDIA_VIDEO_MAX_BYTES: String(50 * 1024 * 1024),
      });
      const failedUpload = await fetch(`${failedStorageServer.baseUrl}/v1/attachments/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${farmer.accessToken}`, 'Idempotency-Key': uploadKey },
        body: uploadBody(consultationId, jpeg, 'image/jpeg', 'ternak.jpg'),
      });
      assert.equal(failedUpload.status, 503);
      await stopServer(failedStorageServer.child);
      failedStorageServer = undefined;

      const invalidMime = await fetch(`${healthy.baseUrl}/v1/attachments/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${farmer.accessToken}`, 'Idempotency-Key': `be07-invalid-${randomUUID()}` },
        body: uploadBody(consultationId, jpeg, 'image/png', 'bukan-png.png'),
      });
      assert.equal(invalidMime.status, 400);
      const tooLargeBytes = Buffer.alloc(10 * 1024 * 1024 + 1);
      tooLargeBytes.set([0xff, 0xd8, 0xff]);
      const oversized = await fetch(`${healthy.baseUrl}/v1/attachments/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${farmer.accessToken}`, 'Idempotency-Key': `be07-large-${randomUUID()}` },
        body: uploadBody(consultationId, tooLargeBytes, 'image/jpeg', 'terlalu-besar.jpg'),
      });
      assert.equal(oversized.status, 400);

      const uploadedResponse = await fetch(`${healthy.baseUrl}/v1/attachments/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${farmer.accessToken}`, 'Idempotency-Key': uploadKey },
        body: uploadBody(consultationId, jpeg, 'image/jpeg', 'ternak.jpg'),
      });
      assert.equal(uploadedResponse.status, 201);
      const uploaded = await uploadedResponse.json();
      assert.equal(uploaded.uploadStatus, 'uploaded');
      assert.equal('storageKey' in uploaded, false);
      assert.equal('localUri' in uploaded, false);
      const committedResponse = await sendJson(healthy.baseUrl, `/v1/attachments/${uploaded.id}/commit`, farmer.accessToken, 'POST');
      assert.equal(committedResponse.status, 200);
      const committed = await committedResponse.json();
      assert.equal(committed.uploadStatus, 'committed');
      const hiddenBeforeMessage = await sendJson(healthy.baseUrl, `/v1/attachments/${uploaded.id}`, vet.accessToken, 'GET');
      assert.equal(hiddenBeforeMessage.status, 404);

      const mediaMessageResponse = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', {
        clientMessageId: randomUUID(),
        attachmentIds: [uploaded.id],
      });
      assert.equal(mediaMessageResponse.status, 201);
      const mediaMessage = await mediaMessageResponse.json();
      assert.equal(mediaMessage.deliveryStatus, 'sent');
      assert.equal(mediaMessage.attachments[0].id, uploaded.id);
      const recipientMetadata = await sendJson(healthy.baseUrl, `/v1/attachments/${uploaded.id}`, vet.accessToken, 'GET');
      assert.equal(recipientMetadata.status, 200);
      const downloaded = await fetch(`${healthy.baseUrl}/v1/attachments/${uploaded.id}/content`, {
        headers: { authorization: `Bearer ${vet.accessToken}` },
      });
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
      assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), jpeg);
      const outsiderDownload = await fetch(`${healthy.baseUrl}/v1/attachments/${uploaded.id}/content`, {
        headers: { authorization: `Bearer ${outsider.accessToken}` },
      });
      assert.equal(outsiderDownload.status, 404);

      const pageOneResponse = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2`, farmer.accessToken, 'GET');
      assert.equal(pageOneResponse.status, 200);
      const pageOne = await pageOneResponse.json();
      assert.equal(pageOne.items.length, 2);
      assert.equal(pageOne.hasMore, true);
      assert.ok(pageOne.nextCursor);
      const pageTwoResponse = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2&cursor=${encodeURIComponent(pageOne.nextCursor)}`, farmer.accessToken, 'GET');
      assert.equal(pageTwoResponse.status, 200);
      const pageTwo = await pageTwoResponse.json();
      assert.equal(pageTwo.items.length, 2);
      assert.equal(new Set([...pageOne.items, ...pageTwo.items].map((item) => item.id)).size, 4);

      console.log('BE-03/07 smoke: livestock owner/version scope, doctor patient scope, care-event idempotency, draft-hidden/final-once health timeline; chat/media scope, retry, validation, private download, and pagination lulus.');
    } finally {
      if (failedStorageServer) await stopServer(failedStorageServer.child);
      // Smoke teardown is a fixture reset; it must remove immutable final-note rows
      // without weakening the production immutability trigger.
      await database.query("SET session_replication_role = 'replica'");
      if (consultationId) {
        await database.query('DELETE FROM message_attachments WHERE consultation_id = $1', [consultationId]);
        await database.query('DELETE FROM consultation_messages WHERE consultation_id = $1', [consultationId]);
        await database.query('DELETE FROM attachments WHERE consultation_id = $1', [consultationId]);
        await database.query('DELETE FROM health_events WHERE actor_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM clinical_notes WHERE consultation_id = $1', [consultationId]);
        await database.query('DELETE FROM payments WHERE payable_type = \'consultation\' AND payable_id = $1', [consultationId]);
        await database.query('DELETE FROM consultations WHERE id = $1', [consultationId]);
      }
      if (unpaidConsultationId) await database.query('DELETE FROM consultations WHERE id = $1', [unpaidConsultationId]);
      if (actors.length > 0) {
        await database.query('DELETE FROM livestock WHERE farmer_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM farms WHERE owner_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM farmer_profiles WHERE user_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM vet_profiles WHERE user_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [actors]);
      }
      await database.query("SET session_replication_role = 'origin'");
      await database.end();
    }
  } else {
    console.log('BE-07 runtime smoke tidak dijalankan karena PostgreSQL readiness mengembalikan 503.');
  }
} finally {
  await stopServer(healthy.child);
  await rm(smokeMediaDirectory, { recursive: true, force: true });
}

const unavailable = await startServer(await availablePort(), { DATABASE_PORT: '1' });
try {
  const liveResponse = await fetch(`${unavailable.baseUrl}/v1/health/live`);
  assert.equal(liveResponse.status, 200);

  const readyResponse = await fetch(`${unavailable.baseUrl}/v1/health/ready`);
  assert.equal(readyResponse.status, 503);
  const error = await readyResponse.json();
  assert.equal(error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(error.message, 'Service is not ready');
  assert.ok(error.requestId);
  assert.equal('stack' in error, false);
  assert.equal(readyResponse.headers.get('x-request-id'), error.requestId);
} finally {
  await stopServer(unavailable.child);
}

console.log('API smoke selesai: health live/ready, OpenAPI/auth, unauthenticated /me, login rate-limit, tidak log password, reset response generik, dan error 503 tervalidasi.');
