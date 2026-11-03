import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Alert } from '../src/types';
import { mergeAlerts } from '../src/lib/alerts';
const original = {
  id: 'a1',
  severity: 'warning',
  message: 'Warm',
  acknowledged: false,
  acknowledged_at: null,
  acknowledged_by: null,
  resolved_at: null,
  created_at: '2026-11-03T00:00:00Z',
} as Alert;

test('a delayed workspace refresh cannot drop a new alert', () => {
  assert.equal(mergeAlerts([], [original]).length, 1);
  assert.equal(mergeAlerts([original], [original]).length, 1);
});
test('older alert snapshots cannot reverse acknowledgement, escalation or recovery', () => {
  const updated = {
    ...original,
    severity: 'critical' as const,
    message: 'Hot',
    acknowledged: true,
    acknowledged_by: 'staff',
    acknowledged_at: '2026-11-03T00:00:03Z',
    resolved_at: '2026-11-03T00:00:05Z',
  };
  for (const merged of [mergeAlerts([original], [updated]), mergeAlerts([updated], [original])]) {
    assert.equal(merged[0].severity, 'critical');
    assert.equal(merged[0].message, 'Hot');
    assert.equal(merged[0].acknowledged, true);
    assert.equal(merged[0].acknowledged_by, 'staff');
    assert.equal(merged[0].resolved_at, updated.resolved_at);
  }
});
