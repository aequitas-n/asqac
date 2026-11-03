import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendVerdict, summaryFromReadings } from '../src/lib/quality.ts';
import type { Alert } from '../src/types/index.ts';
const clean = summaryFromReadings([
  {
    temp_c: 5,
    shock_g: 1.2,
    lux: 3,
    pitch_deg: -3,
    roll_deg: 4,
    simulated: false,
    recorded_at: new Date().toISOString(),
  },
]);
test('recommendations conservatively include missing, simulated and gapped coverage', () => {
  assert.equal(recommendVerdict([], clean), 'accept');
  assert.equal(recommendVerdict([], null), 'review_required');
  assert.equal(recommendVerdict([], { ...clean, simulated_count: 1 }), 'review_required');
  assert.equal(recommendVerdict([], { ...clean, gap_count: 1 }), 'review_required');
});
test('acknowledgement does not erase a critical excursion from the recommendation', () => {
  assert.equal(
    recommendVerdict([{ severity: 'critical', acknowledged: true } as Alert], clean),
    'reject',
  );
  assert.equal(recommendVerdict([{ severity: 'warning' } as Alert], clean), 'review_required');
});
test('persistent transport counts cover events beyond the UI history window', () => {
  assert.equal(recommendVerdict([], clean, 10, 1), 'reject');
  assert.equal(recommendVerdict([], clean, 10, 0), 'review_required');
});
