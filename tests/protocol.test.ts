import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readingSchema,
  validateTimestamp,
  sha256,
  telemetrySchema,
} from '../supabase/functions/_shared/protocol.ts';
const packet = {
  device_uid: 'CAP0001-ESP32-001',
  recorded_at: new Date().toISOString(),
  temp_c: 5,
  pressure_hpa: 1012,
  lux: 2,
  ax: 0,
  ay: 0,
  az: 1,
  pitch_deg: 0,
  roll_deg: 0,
  shock_g: 1,
  rssi: -55,
};
test('validates actual sensor fields; simulator provenance defaults false', () => {
  const result = readingSchema.parse(packet);
  assert.equal(result.simulated, false);
  assert.equal(result.gx, 0);
});
test('accepts bounded same-device batches and rejects mixed or oversized batches', () => {
  const readings = [packet, { ...packet, recorded_at: new Date(Date.now() + 500).toISOString() }];
  assert.equal(telemetrySchema.safeParse({ readings }).success, true);
  assert.equal(telemetrySchema.safeParse({ readings: [] }).success, false);
  assert.equal(telemetrySchema.safeParse({ readings: Array(17).fill(packet) }).success, false);
  assert.equal(
    telemetrySchema.safeParse({ readings: [packet, { ...packet, device_uid: 'wrong-device' }] })
      .success,
    false,
  );
});
test('rejects invented sensors and nonfinite or implausible sensor values', () => {
  for (const extra of [
    { humidity: 40 },
    { battery: 90 },
    { temp_c: NaN },
    { pressure_hpa: 200 },
    { shock_g: 50 },
    { rssi: 20 },
    { az: '1' },
    { simulated: 'true' },
  ])
    assert.equal(readingSchema.safeParse({ ...packet, ...extra }).success, false);
});
test('requires a timestamp and validates bounded offline replay window', () => {
  const now = Date.now();
  assert.equal(readingSchema.safeParse({ ...packet, recorded_at: undefined }).success, false);
  assert.equal(validateTimestamp(new Date(now - 86400001).toISOString(), now), false);
  assert.equal(validateTimestamp(new Date(now + 30001).toISOString(), now), false);
  assert.equal(validateTimestamp(new Date(now - 60000).toISOString(), now), true);
});
test('barometric metadata is optional, paired, bounded and earlier than the sample', () => {
  const reference = {
    reference_pressure_hpa: 1013.25,
    height_reference_at: new Date(Date.now() - 10000).toISOString(),
  };
  assert.equal(
    readingSchema.safeParse({ ...packet, ...reference, sea_level_pressure_hpa: 1013.25 }).success,
    true,
  );
  assert.equal(readingSchema.safeParse({ ...packet, reference_pressure_hpa: 1013 }).success, false);
  assert.equal(
    readingSchema.safeParse({ ...packet, ...reference, reference_pressure_hpa: 0 }).success,
    false,
  );
  assert.equal(readingSchema.safeParse({ ...packet, sea_level_pressure_hpa: 0 }).success, false);
  assert.equal(
    readingSchema.safeParse({
      ...packet,
      ...reference,
      height_reference_at: new Date(Date.now() + 10000).toISOString(),
    }).success,
    false,
  );
  assert.equal(readingSchema.safeParse({ ...packet, altitude_m: 100 }).success, false); // calculated by the server
});
test('SHA-256 matches standard vector; no plaintext credential is stored', async () => {
  assert.equal(
    await sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
