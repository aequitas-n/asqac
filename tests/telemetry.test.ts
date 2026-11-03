import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_PACKET_TIMEOUT_MS, liveReading } from '../src/lib/telemetry';

test('live values expire without new packets and recover on a fresh observation', () => {
  const start = Date.parse('2026-11-03T00:00:00Z');
  const row = {
    recorded_at: new Date(start).toISOString(),
    received_at: new Date(start + 400).toISOString(),
  };
  assert.equal(liveReading(row, start + 500), row);
  assert.equal(liveReading(row, start + LIVE_PACKET_TIMEOUT_MS - 1), row);
  assert.equal(liveReading(row, start + LIVE_PACKET_TIMEOUT_MS), undefined);
  assert.equal(liveReading(row, start + 360_000), undefined);
  const resumed = {
    recorded_at: new Date(start + 360_000).toISOString(),
    received_at: new Date(start + 360_400).toISOString(),
  };
  assert.equal(liveReading(resumed, start + 360_500), resumed);
});

test('fresh ingestion of buffered history and invalid timestamps cannot appear live', () => {
  const now = Date.parse('2026-11-03T00:01:00Z');
  const received_at = new Date(now).toISOString();
  assert.equal(
    liveReading({ recorded_at: new Date(now - 60_000).toISOString(), received_at }, now),
    undefined,
  );
  assert.equal(liveReading({ recorded_at: received_at, received_at: 'invalid' }, now), undefined);
  assert.equal(
    liveReading({ recorded_at: new Date(now + 31_000).toISOString(), received_at }, now),
    undefined,
  );
  assert.equal(liveReading(undefined, now), undefined);
});
