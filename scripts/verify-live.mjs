import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const endpoint = process.env.TELEMETRY_URL || process.env.VITE_TELEMETRY_URL;
const token = process.env.DEVICE_TOKEN;
const uid = process.env.DEVICE_UID;
if (!url || !key || !endpoint || !token || !uid)
  throw new Error('Complete the public project and demo device configuration in .env.');
const makeClient = () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const technician = makeClient(),
  doctor = makeClient();
const report = {
  project_ref: new URL(url).hostname.split('.')[0],
  checked_at: new Date().toISOString(),
  result: 'blocked',
  steps: [],
  realtime_events: { readings: 0, alerts: 0, transports: 0, capsules: 0 },
};
let transportId, channel;
const pass = (step, detail) => {
  report.steps.push({ step, status: 'pass', detail });
  console.log(`PASS ${step}: ${detail}`);
};
const unwrap = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const waitFor = async (predicate, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await pause(200);
  }
  throw new Error('Timed out waiting for Supabase Realtime events.');
};
try {
  for (const [client, email, password, role] of [
    [
      technician,
      'technician@asqac.test',
      process.env.DEMO_TECHNICIAN_PASSWORD || 'technician',
      'technician',
    ],
    [doctor, 'doctor@asqac.test', process.env.DEMO_DOCTOR_PASSWORD || 'doctor', 'doctor'],
  ]) {
    const auth = unwrap(await client.auth.signInWithPassword({ email, password }));
    pass(`${role} authentication`, 'Confirmed email/password login succeeded.');
    const profile = unwrap(
      await client.from('profiles').select('id,role').eq('id', auth.user.id).single(),
    );
    if (profile.role !== role) throw new Error(`${role} account has an unexpected staff role.`);
    pass(`${role} RLS profile`, `${profile.role} role is readable.`);
  }
  const [capsules, profiles] = await Promise.all([
    technician.from('capsules').select('*').order('code'),
    technician.from('handling_profiles').select('*'),
  ]);
  const fleet = unwrap(capsules),
    handling = unwrap(profiles);
  if (fleet.length < 4 || new Set(handling.map((p) => p.specimen_type)).size < 6)
    throw new Error('Capsule/profile seed is incomplete.');
  pass(
    'seed rows',
    `${fleet.length} capsules and ${handling.length} handling profiles visible through staff RLS.`,
  );
  const health = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  if (health.status !== 401)
    throw new Error(
      `Telemetry deployment check returned HTTP ${health.status}; expected a token-authentication challenge.`,
    );
  pass(
    'Edge Function authentication',
    'Deployed endpoint rejects requests without x-device-token.',
  );
  const capsule = fleet.find((c) => c.code === 'CAP0001');
  const profile = handling.find((p) => p.code === 'BLD-COLD');
  if (!capsule || !profile) throw new Error('Required demo capsule/profile not found.');
  const active = unwrap(
    await technician
      .from('transports')
      .select('*')
      .eq('capsule_id', capsule.id)
      .neq('state', 'closed')
      .maybeSingle(),
  );
  let transport = active;
  if (active) {
    const specimen = unwrap(
      await technician
        .from('specimens')
        .select('patient_ref')
        .eq('id', active.specimen_id)
        .single(),
    );
    if (specimen.patient_ref !== 'ASQAC-VERIFY')
      throw new Error('CAP0001 has another active transport. This verifier will not alter it.');
  } else {
    const registered = unwrap(
      await technician.rpc('register_specimen', {
        p_input: {
          patient_ref: 'ASQAC-VERIFY',
          requested_test: 'Connection verification (simulated)',
          specimen_type: 'BLOOD',
          handling_profile_id: profile.id,
          priority: 'routine',
          origin: 'Research test bench',
          destination_lab: 'Demo receiving',
          clinical_notice: 'Synthetic end-to-end connection check. No patient specimen.',
          capsule_id: capsule.id,
        },
      }),
    );
    transport = registered.transport;
  }
  transportId = transport.id;
  if (transport.state === 'registered')
    transport = unwrap(
      await technician.rpc('transition_transport', {
        p_transport: transportId,
        p_action: 'prepare',
      }),
    );
  if (transport.state === 'prepared')
    transport = unwrap(
      await technician.rpc('transition_transport', { p_transport: transportId, p_action: 'start' }),
    );
  if (transport.state !== 'in_transit')
    throw new Error(
      'Verification transport is already at receiving; close it before another telemetry check.',
    );
  pass(
    'registration and lifecycle',
    `${transport.transport_code} reserved, prepared, and started atomically.`,
  );
  channel = technician.channel(`asqac-verification-${Date.now()}`);
  for (const table of ['readings', 'alerts', 'transports', 'capsules'])
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter:
          table === 'transports'
            ? `id=eq.${transportId}`
            : table === 'capsules'
              ? `id=eq.${capsule.id}`
              : `capsule_id=eq.${capsule.id}`,
      },
      () => {
        report.realtime_events[table]++;
      },
    );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Realtime subscription did not connect.')),
      15000,
    );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      }
      if (status === 'CHANNEL_ERROR') {
        clearTimeout(timer);
        reject(new Error('Realtime channel error.'));
      }
    });
  });
  pass('Realtime subscription', 'Authenticated subscription connected.');
  for (const temperature of [5, 12.5]) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-token': token },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        device_uid: uid,
        recorded_at: new Date().toISOString(),
        temp_c: temperature,
        pressure_hpa: 1012,
        lux: 3,
        ax: 0,
        ay: 0,
        az: 1,
        gx: 0,
        gy: 0,
        gz: 0,
        pitch_deg: 2,
        roll_deg: 1,
        shock_g: 1.05,
        rssi: -52,
        simulated: true,
      }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        `Telemetry POST failed (${response.status}): ${body.error || 'unknown error'}`,
      );
    if (body.transport_id !== transportId)
      throw new Error('Reading was not associated with the active verification transport.');
    pass(
      `telemetry ${temperature} °C`,
      `HTTP ${response.status}; reading ${body.reading_id} stored.`,
    );
    await pause(2400);
  }
  await waitFor(
    () =>
      report.realtime_events.readings >= 2 &&
      report.realtime_events.alerts >= 1 &&
      report.realtime_events.transports >= 1 &&
      report.realtime_events.capsules >= 1,
  );
  const alerts = unwrap(
    await technician
      .from('alerts')
      .select('id,severity,alert_type')
      .eq('transport_id', transportId),
  );
  if (!alerts.some((a) => a.severity === 'critical' && a.alert_type === 'temperature'))
    throw new Error('Expected temperature excursion was not created.');
  pass(
    'limits and live updates',
    'Normal/stress readings, critical temperature alert, transport summary and capsule heartbeat were delivered through real cloud Realtime.',
  );
  report.result = 'pass';
} catch (error) {
  const message = error instanceof Error ? error.message : 'Verification failed';
  report.steps.push({ step: 'connection verification', status: 'blocked', detail: message });
  console.error(`BLOCKED ${message}`);
  process.exitCode = 1;
} finally {
  if (transportId) {
    try {
      let current = unwrap(
        await doctor.from('transports').select('state').eq('id', transportId).single(),
      );
      if (current.state === 'in_transit') {
        unwrap(
          await doctor.rpc('transition_transport', {
            p_transport: transportId,
            p_action: 'arrive',
          }),
        );
        current = { state: 'arrived' };
      }
      if (current.state === 'arrived') {
        unwrap(
          await doctor.rpc('transition_transport', {
            p_transport: transportId,
            p_action: 'close',
            p_verdict: report.result === 'pass' ? 'reject' : 'review_required',
            p_notes:
              'Automated connection verification using simulated readings; no clinical specimen. Stress excursion was intentional.',
          }),
        );
        pass('doctor receiving and verdict', 'Verification journey closed and CAP0001 released.');
      }
    } catch (error) {
      report.result = 'blocked';
      report.steps.push({
        step: 'verification transport closure',
        status: 'blocked',
        detail: error.message,
      });
      console.error(`Cleanup requires review: ${error.message}`);
      process.exitCode = 1;
    }
  }
  if (channel) await technician.removeChannel(channel);
  await Promise.allSettled([
    technician.auth.signOut({ scope: 'local' }),
    doctor.auth.signOut({ scope: 'local' }),
  ]);
  await writeFile(
    new URL('../docs/supabase-verification.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log('Saved docs/supabase-verification.json (no administrative or device credentials).');
}
