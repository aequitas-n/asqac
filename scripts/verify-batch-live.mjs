import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import assert from 'node:assert/strict';
const url = process.env.VITE_SUPABASE_URL;
const admin = createClient(
  url,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const staff = createClient(
  url,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const uid = `CAP0004-BATCH-VERIFY-${Date.now()}`;
const token = randomBytes(32).toString('base64url');
const barometry = process.argv.includes('--barometry');
let device, channel;
const events = [],
  requests = [];
const report = {
  checked_at: new Date().toISOString(),
  project_ref: 'chhpbpqoaikbcicxdnzj',
  result: 'incomplete',
  simulated: true,
  physical_hardware_tested: false,
  requests,
};
try {
  const { data: capsule, error: ce } = await admin
    .from('capsules')
    .select('id,status')
    .eq('code', 'CAP0004')
    .single();
  if (ce) throw ce;
  assert.equal(capsule.status, 'idle', 'CAP0004 must be idle for isolated verification');
  const { count: open, error: oe } = await admin
    .from('transports')
    .select('id', { count: 'exact', head: true })
    .eq('capsule_id', capsule.id)
    .neq('state', 'closed');
  if (oe) throw oe;
  assert.equal(open, 0, 'Do not touch an active transport');
  const { data: created, error: de } = await admin
    .from('devices')
    .insert({
      device_uid: uid,
      capsule_id: capsule.id,
      token_hash: createHash('sha256').update(token).digest('hex'),
      active: true,
    })
    .select('id')
    .single();
  if (de) throw de;
  device = created;
  const { error: ae } = await staff.auth.signInWithPassword({
    email: 'technician@asqac.test',
    password: process.env.DEMO_TECHNICIAN_PASSWORD || 'technician',
  });
  if (ae) throw ae;
  channel = staff
    .channel(`batch-verify-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'readings', filter: `device_uid=eq.${uid}` },
      ({ new: row }) => events.push(row),
    );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Realtime subscription timeout')), 20000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      } else if (status === 'CHANNEL_ERROR') {
        clearTimeout(timeout);
        reject(Error('Realtime subscription failed'));
      }
    });
  });
  const base = Date.now() - 30000;
  const packet = (i) => ({
    device_uid: uid,
    recorded_at: new Date(base + i * 500).toISOString(),
    temp_c: 5,
    pressure_hpa: barometry
      ? i === 0
        ? 1013.25
        : i === 1
          ? 1000
          : i === 2
            ? 1014.25
            : 1013
      : 1013,
    ...(barometry
      ? {
          sea_level_pressure_hpa: 1013.25,
          reference_pressure_hpa: 1013.25,
          height_reference_at: new Date(base - 10000).toISOString(),
        }
      : {}),
    lux: 3,
    ax: 0,
    ay: 0,
    az: 1,
    gx: 0,
    gy: 0,
    gz: 0,
    pitch_deg: i,
    roll_deg: 0,
    shock_g: 1,
    rssi: -55,
    simulated: true,
  });
  async function send(readings, label) {
    const started = performance.now();
    const response = await fetch(process.env.VITE_TELEMETRY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-token': token },
      body: JSON.stringify({ readings }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json();
    requests.push({
      label,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
      samples: readings.length,
    });
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.results.length, readings.length);
    return body;
  }
  await send(
    Array.from({ length: 13 }, (_, i) => packet(i)),
    'drain 13-sample backlog',
  );
  await pause(800);
  await send([packet(13), packet(14)], 'next 500-ms samples; no 2-second limiter');
  await pause(800);
  const retried = await send([packet(13), packet(14)], 'duplicate-safe retry');
  assert.ok(retried.results.every((r) => r.duplicate));
  const deadline = Date.now() + 10000;
  while (events.length < 15 && Date.now() < deadline) await pause(100);
  assert.equal(events.length, 15, 'Realtime should deliver each unique sample');
  const { count, error } = await admin
    .from('readings')
    .select('id', { head: true, count: 'exact' })
    .eq('device_uid', uid);
  if (error) throw error;
  assert.equal(count, 15);
  if (barometry) {
    const { data: derived, error: derivedError } = await staff
      .from('readings')
      .select('altitude_m,height_change_m,reference_pressure_hpa,height_reference_at')
      .eq('device_uid', uid)
      .order('recorded_at');
    if (derivedError) throw derivedError;
    assert.ok(Math.abs(derived[0].altitude_m) < 0.00001);
    assert.ok(Math.abs(derived[0].height_change_m) < 0.00001);
    assert.ok(derived[1].height_change_m > 100);
    assert.ok(derived[2].height_change_m < 0);
    assert.ok(derived.every((r) => r.reference_pressure_hpa === 1013.25 && r.height_reference_at));
    assert.ok(
      events.every((r) => r.reference_pressure_hpa === 1013.25 && r.height_reference_at),
      'Realtime must carry reference provenance for derived metrics',
    );
    report.barometry = {
      zero_m: derived[0].height_change_m,
      rise_m: derived[1].height_change_m,
      fall_m: derived[2].height_change_m,
      reference_pressure_hpa: 1013.25,
      staff_rls_read: true,
      realtime_reference_provenance: true,
    };
    console.log(
      'PASS hosted barometric altitude/height: zero, positive rise, negative fall, reference provenance and staff RLS/Realtime.',
    );
  }
  report.result = 'pass';
  report.unique_readings = 15;
  report.realtime_events = events.length;
  report.scope =
    'Real hosted endpoint, batching, duplicate-safe retry and authenticated Realtime; isolated CAP0004 simulated device only';
  console.log(
    'PASS hosted batches: 13-sample backlog in one request; following batches accepted without old two-second limit; 15 unique Realtime readings.',
  );
} finally {
  if (channel) await staff.removeChannel(channel);
  if (device) {
    const { error } = await admin.from('devices').update({ active: false }).eq('id', device.id);
    if (error) throw error;
  }
  await staff.auth.signOut({ scope: 'local' });
  await writeFile(
    barometry ? 'docs/barometry-cloud-verification.json' : 'docs/batch-cloud-verification.json',
    JSON.stringify(report, null, 2) + '\n',
  );
}
// All assertions and cleanup above are awaited. The Realtime SDK can retain
// reconnect timers after disconnect; a completed one-shot CLI should terminate.
process.exit(0);
