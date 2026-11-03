import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressureAltitude, withBarometry } from '../src/lib/barometry';
import type { Reading } from '../src/types';
test('barometric estimates have the correct zero/sign and reject missing/nonfinite pressure', () => {
  assert.equal(pressureAltitude(1013.25), 0);
  assert.ok(pressureAltitude(1000)! > 100);
  assert.ok(pressureAltitude(1014.25)! < 0);
  assert.equal(pressureAltitude(0), null);
  assert.equal(pressureAltitude(NaN), null);
  assert.equal(pressureAltitude(1000, 0), null);
});
test('legacy readings never acquire a fabricated height reference; stored estimates are retained', () => {
  const row = { pressure_hpa: 1000 } as Reading;
  assert.equal(withBarometry(row).height_change_m, null);
  const referenced = {
    ...row,
    reference_pressure_hpa: 1000,
    height_reference_at: '2026-11-03T00:00:00Z',
  };
  assert.equal(withBarometry(referenced).height_change_m, 0);
  assert.equal(withBarometry({ ...referenced, height_change_m: 2 }).height_change_m, 2);
});
