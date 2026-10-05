import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalAuthService } from '../.test-build/src/application/LocalAuthService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { fixtureEntities, fixtureIds } from '../.test-build/src/testing/fixtures.js';

test('registration creates role-specific account/profile and rejects a duplicate normalized email', async () => {
  const setup = makeAuthService();
  const session = await setup.service.register({
    name: ' Dokter Baru ',
    email: 'VET.NEW@EXAMPLE.TEST ',
    password: 'lokal12345',
    role: 'vet',
  });

  assert.equal(session.displayName, 'Dokter Baru');
  assert.equal(session.email, 'vet.new@example.test');
  assert.deepEqual(session.roles, ['vet']);
  assert.equal(setup.repository.findProfile(session.userId, 'vet').payload.verificationStatus, 'not_submitted');
  assert.equal(setup.repository.findProfile(session.userId, 'farmer'), null);
  await assert.rejects(
    setup.service.register({ name: 'Duplikat', email: 'vet.new@example.test', password: 'lokal12345', role: 'vet' }),
    (error) => error instanceof DomainError && error.code === 'EMAIL_IN_USE',
  );
  assert.equal(setup.repository.users().filter((user) => user.payload.email === 'vet.new@example.test').length, 1);
});

test('login, role switch, and restore cannot add a role absent from the account', async () => {
  const setup = makeAuthService();
  const created = await setup.service.register({
    name: 'Ternak Baru',
    email: 'owner@example.test',
    password: 'rahasia123',
    role: 'farmer',
  });
  await assert.rejects(
    setup.service.login({ email: 'OWNER@example.test', password: 'rahasia123', role: 'vet' }),
    (error) => error instanceof DomainError && error.code === 'ROLE_NOT_ALLOWED',
  );
  await assert.rejects(
    setup.service.switchRole('vet'),
    (error) => error instanceof DomainError && error.code === 'ROLE_NOT_ALLOWED',
  );
  assert.deepEqual((await setup.service.restoreSession()).roles, ['farmer']);
  assert.equal(created.activeRole, 'farmer');
});

test('reset only changes locally registered credentials, and the new password can log in', async () => {
  const setup = makeAuthService();
  assert.equal(
    await setup.service.resetPassword({ email: 'budi@example.test', role: 'farmer', newPassword: 'baru12345' }),
    false,
    'fixture account without a locally created credential cannot be claimed',
  );
  await setup.service.register({ name: 'Sapi Baru', email: 'reset@example.test', password: 'lama12345', role: 'farmer' });
  assert.equal(
    await setup.service.resetPassword({ email: 'reset@example.test', role: 'farmer', newPassword: 'baru12345' }),
    true,
  );
  await assert.rejects(
    setup.service.login({ email: 'reset@example.test', password: 'lama12345', role: 'farmer' }),
    (error) => error instanceof DomainError && error.code === 'INVALID_CREDENTIALS',
  );
  assert.equal(
    (await setup.service.login({ email: 'reset@example.test', password: 'baru12345', role: 'farmer' })).activeRole,
    'farmer',
  );
  assert.equal(setup.repository.findUserById(fixtureIds.budi).payload.name, 'Budi Santoso');
});

test('logout revokes the local session but preserves account and domain data', async () => {
  const setup = makeAuthService();
  const session = await setup.service.register({
    name: 'Peternak Baru',
    email: 'logout@example.test',
    password: 'rahasia123',
    role: 'farmer',
  });
  const accountCount = setup.repository.users().length;
  const domainBefore = setup.repository.domainRecordCount();

  await setup.service.logout();

  assert.equal(await setup.service.restoreSession(), null);
  assert.equal(setup.store.sessionId, null);
  assert.equal((await setup.repository.findSession(session.sessionId)).payload.status, 'revoked');
  assert.equal(setup.repository.findUserById(session.userId).payload.status, 'active');
  assert.equal(setup.repository.users().length, accountCount);
  assert.equal(setup.repository.domainRecordCount(), domainBefore);
});

function makeAuthService() {
  const repository = new MemoryAuthRepository(fixtureEntities);
  const store = new MemoryStore();
  let sequence = 5000;
  const verifier = {
    create: async (password) => `test-verifier:${password}`,
    verify: async (password, stored) => stored === `test-verifier:${password}`,
  };
  const ids = { create: () => `local-${sequence++}` };
  const service = new LocalAuthService(repository, store, store, verifier, ids, () => new Date('2026-10-05T00:00:00.000Z'));
  return { service, repository, store };
}

class MemoryStore {
  credentials = new Map();
  sessionId = null;
  async save(userId, verifier) { this.credentials.set(userId, verifier); }
  async read(userId) { return this.credentials.get(userId) ?? null; }
  async remove(userId) { this.credentials.delete(userId); }
  async saveSessionId(sessionId) { this.sessionId = sessionId; }
  async readSessionId() { return this.sessionId; }
  async clearSessionId() { this.sessionId = null; }
}

class MemoryAuthRepository {
  entities = new Map();
  constructor(seed) {
    for (const record of seed) this.entities.set(record.id, structuredClone(record));
  }
  async findUserByEmail(email) {
    return this.list('user').find((item) => String(item.payload.email).trim().toLowerCase() === email) ?? null;
  }
  async findUserById(id) { return this.byKind(id, 'user'); }
  async findRoleProfile(userId, role) {
    const kind = role === 'farmer' ? 'farmerProfile' : 'vetProfile';
    return this.list(kind).find((item) => item.ownerId === userId) ?? null;
  }
  async createAccount(user, profile, relations) {
    if (await this.findUserByEmail(user.payload.email)) throw new DomainError('EMAIL_IN_USE', 'Email ini sudah terdaftar.');
    this.entities.set(user.id, structuredClone(user));
    this.entities.set(profile.id, structuredClone(profile));
    for (const relation of relations) this.entities.set(`relation:${relation.sourceId}:${relation.relationship}`, relation);
  }
  async createSession(session, relation) {
    this.entities.set(session.id, structuredClone(session));
    this.entities.set(`relation:${relation.sourceId}:${relation.relationship}`, relation);
  }
  async findSession(id) { return this.byKind(id, 'session'); }
  async updateSession(session, expectedVersion) {
    const current = this.byKind(session.id, 'session');
    if (!current || current.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'Sesi berubah.');
    this.entities.set(session.id, structuredClone(session));
  }
  findProfile(userId, role) {
    const kind = role === 'farmer' ? 'farmerProfile' : 'vetProfile';
    return this.list(kind).find((item) => item.ownerId === userId) ?? null;
  }
  findUserById(id) { return this.byKind(id, 'user'); }
  users() { return this.list('user'); }
  domainRecordCount() { return [...this.entities.values()].filter((item) => item && !String(item.id).startsWith('relation:')).length; }
  list(kind) { return [...this.entities.values()].filter((item) => item?.kind === kind); }
  byKind(id, kind) {
    const item = this.entities.get(id);
    return item?.kind === kind ? item : null;
  }
}
