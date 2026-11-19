import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerNotificationContextService } from '../.test-build/src/application/ServerNotificationContextService.js';

const followUpId = '10000000-0000-4000-8000-000000000001';
const reportId = '10000000-0000-4000-8000-000000000002';
const reminderId = '10000000-0000-4000-8000-000000000003';

test('notification context loads the matching server resource by its authorized ID', async () => {
  const calls = [];
  const service = new ServerNotificationContextService({
    getFollowUp: async (id) => { calls.push(['follow-up', id]); return { id }; },
    getProgressReport: async (id) => { calls.push(['progress-report', id]); return { id }; },
    getReminder: async (id) => { calls.push(['reminder', id]); return { id }; },
  });

  assert.deepEqual(await service.get('farmer', 'follow_up', followUpId), { type: 'follow_up', resource: { id: followUpId } });
  assert.deepEqual(await service.get('vet', 'progress_report', reportId), { type: 'progress_report', resource: { id: reportId } });
  assert.deepEqual(await service.get('farmer', 'reminder', reminderId), { type: 'reminder', resource: { id: reminderId } });
  assert.deepEqual(calls, [['follow-up', followUpId], ['progress-report', reportId], ['reminder', reminderId]]);
});

test('notification context refuses unsupported roles before repository access', async () => {
  let reads = 0;
  const service = new ServerNotificationContextService({ getFollowUp: async () => { reads += 1; return { id: followUpId }; } });
  await assert.rejects(service.get('admin', 'follow_up', followUpId), { code: 'FORBIDDEN' });
  await assert.rejects(service.get('farmer', 'follow_up', ''), { code: 'VALIDATION_FAILED' });
  assert.equal(reads, 0);
});

test('notification context rejects a response for a different resource ID', async () => {
  const service = new ServerNotificationContextService({
    getReminder: async () => ({ id: followUpId }),
  });
  await assert.rejects(service.get('farmer', 'reminder', reminderId), { code: 'API_RESPONSE_INVALID' });
});
