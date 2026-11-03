import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeReadings } from '../src/lib/readings';
import type { Reading } from '../src/types';
const row = (id: number, capsule_id = 'cap1') =>
  ({
    id,
    capsule_id,
    recorded_at: new Date(1_800_000_000_000 + id * 500).toISOString(),
  }) as Reading;

test('delayed snapshots and duplicate events retain the newest measured reading', () => {
  const merged = mergeReadings([row(1), row(2)], [row(2), row(3)]);
  assert.deepEqual(
    merged.map((r) => r.id),
    [1, 2, 3],
  );
  assert.equal(merged.at(-1)?.id, 3);
});

test('catch-up bursts retain 180 newest observations per capsule independently', () => {
  const first = Array.from({ length: 200 }, (_, i) => row(i));
  const second = Array.from({ length: 190 }, (_, i) => row(i + 1000, 'cap2'));
  const merged = mergeReadings(first, second);
  assert.equal(merged.length, 360);
  assert.equal(merged.filter((r) => r.capsule_id === 'cap1').at(0)?.id, 20);
  assert.equal(merged.filter((r) => r.capsule_id === 'cap2').at(0)?.id, 1010);
});
