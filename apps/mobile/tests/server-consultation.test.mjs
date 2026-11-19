import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerConsultationService } from '../.test-build/src/application/ServerConsultationService.js';

const consultation = (id, serviceType = 'chat') => ({ id, serviceType });

test('server consultation use case reads owner/assignment-scoped list for both roles', async () => {
  const calls = [];
  const service = new ServerConsultationService({
    list: async () => { calls.push('list'); return [{ id: 'consultation-a' }]; },
    getById: async () => consultation('consultation-a'),
    getVisit: async () => { throw new Error('unexpected visit'); },
  });
  await assert.rejects(service.list('unknown'), { code: 'FORBIDDEN' });
  assert.deepEqual(await service.list('farmer'), [{ id: 'consultation-a' }]);
  assert.deepEqual(await service.list('vet'), [{ id: 'consultation-a' }]);
  assert.deepEqual(calls, ['list', 'list']);
});

test('server consultation rejects duplicate rows and returns visit projection only for visits', async () => {
  const duplicate = new ServerConsultationService({
    list: async () => [{ id: 'same' }, { id: 'same' }], getById: async () => consultation('c'), getVisit: async () => ({}),
  });
  await assert.rejects(duplicate.list('vet'), { code: 'API_RESPONSE_INVALID' });
  const calls = [];
  const service = new ServerConsultationService({
    list: async () => [],
    getById: async (id) => { calls.push(['detail', id]); return consultation(id, id === 'visit-a' ? 'visit' : 'chat'); },
    getVisit: async (id) => { calls.push(['visit', id]); return { consultationId: id }; },
  });
  assert.deepEqual(await service.getDetail('farmer', 'chat-a'), { consultation: consultation('chat-a'), visit: null });
  assert.deepEqual(await service.getDetail('vet', 'visit-a'), { consultation: consultation('visit-a', 'visit'), visit: { consultationId: 'visit-a' } });
  assert.deepEqual(calls, [['detail', 'chat-a'], ['detail', 'visit-a'], ['visit', 'visit-a']]);
});

test('server consultation rejects a response whose ID differs from requested detail', async () => {
  const service = new ServerConsultationService({
    list: async () => [], getById: async () => consultation('different'), getVisit: async () => null,
  });
  await assert.rejects(service.getDetail('farmer', 'requested'), { code: 'API_RESPONSE_INVALID' });
});
