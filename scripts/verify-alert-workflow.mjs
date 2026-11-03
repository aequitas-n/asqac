import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import assert from 'node:assert/strict';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const technician = createClient(url, key, options),
  doctor = createClient(url, key, options);
const admin = createClient(
  url,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const unwrap = ({ data, error }) => {
  if (error) throw Error(error.message);
  return data;
};
const report = {
  checked_at: new Date().toISOString(),
  result: 'incomplete',
  simulated: true,
  browser_used: false,
  cap0001_modified: false,
  steps: [],
  realtime_alerts: 0,
};
const token = randomBytes(32).toString('base64url');
const uid = `CAP0004-ALERT-VERIFY-${Date.now()}`;
let transport, device, channel;
const observed = [];
const pass = (stage, detail) => {
  report.steps.push({ stage, detail });
  console.log(`PASS ${stage}: ${detail}`);
};
try {
  for (const [client, email, password] of [
    [technician, 'technician@asqac.test', process.env.DEMO_TECHNICIAN_PASSWORD || 'technician'],
    [doctor, 'doctor@asqac.test', process.env.DEMO_DOCTOR_PASSWORD || 'doctor'],
  ])
    unwrap(await client.auth.signInWithPassword({ email, password }));
  const cap = unwrap(
    await technician.from('capsules').select('id,status').eq('code', 'CAP0004').single(),
  );
  assert.equal(cap.status, 'idle', 'CAP0004 must be idle for isolated verification');
  const open = unwrap(
    await technician
      .from('transports')
      .select('id')
      .eq('capsule_id', cap.id)
      .neq('state', 'closed'),
  );
  assert.equal(open.length, 0, 'Do not change an existing journey');
  const profiles = unwrap(
    await technician.from('handling_profiles').select('*').eq('specimen_type', 'BLOOD'),
  );
  const profile = profiles.find((p) => p.temp_min_c === 18 && p.temp_max_c === 25);
  assert.ok(profile, 'Ambient blood profile is required');
  device = unwrap(
    await admin
      .from('devices')
      .insert({
        device_uid: uid,
        capsule_id: cap.id,
        token_hash: createHash('sha256').update(token).digest('hex'),
        active: true,
      })
      .select('id')
      .single(),
  );
  channel = technician
    .channel(`alert-workflow-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'alerts', filter: `capsule_id=eq.${cap.id}` },
      ({ new: alert }) => observed.push(alert),
    );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Realtime subscription timeout')), 20000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      }
      if (status === 'CHANNEL_ERROR') {
        clearTimeout(timer);
        reject(Error('Realtime unavailable'));
      }
    });
  });
  transport = unwrap(
    await technician.rpc('register_specimen', {
      p_input: {
        patient_ref: 'ASQAC-ALERT-VERIFY',
        requested_test: 'Simulated alert workflow verification',
        specimen_type: 'BLOOD',
        handling_profile_id: profile.id,
        priority: 'routine',
        origin: 'Research test bench',
        destination_lab: 'Demo receiving',
        capsule_id: cap.id,
        clinical_notice:
          'Synthetic workflow verification. No patient specimen. Excursions are intentional.',
      },
    }),
  ).transport;
  const transition = async (client, action, extra = {}) => {
    transport = unwrap(
      await client.rpc('transition_transport', {
        p_transport: transport.id,
        p_action: action,
        ...extra,
      }),
    );
    return transport;
  };
  const send = async (minimum = 0) => {
    const response = await fetch(process.env.VITE_TELEMETRY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-token': token },
      body: JSON.stringify({
        readings: [
          {
            device_uid: uid,
            recorded_at: new Date(Math.max(Date.now(), minimum) + 50).toISOString(),
            temp_c: 31.4,
            pressure_hpa: 1012.3,
            lux: 1333.3,
            ax: 0,
            ay: 0,
            az: 1,
            gx: 0,
            gy: 0,
            gz: 0,
            pitch_deg: 0,
            roll_deg: 0,
            shock_g: 1,
            rssi: -55,
            simulated: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json();
    assert.equal(response.status, 201, 'Telemetry must be accepted');
    return body.results[0];
  };
  assert.equal((await send()).transport_id, null);
  let alerts = unwrap(
    await technician.from('alerts').select('id').eq('transport_id', transport.id),
  );
  assert.equal(alerts.length, 0);
  pass('Registered', 'Profile previews do not create transport excursions.');
  await transition(technician, 'prepare');
  assert.equal(transport.state, 'prepared');
  await pause(850);
  assert.equal((await send()).transport_id, null);
  alerts = unwrap(await technician.from('alerts').select('id').eq('transport_id', transport.id));
  assert.equal(alerts.length, 0);
  pass('Prepared', 'Technician preparation succeeds; timer and excursion detection await Start.');
  await transition(technician, 'start');
  assert.equal(transport.state, 'in_transit');
  await pause(850);
  assert.equal((await send(Date.parse(transport.started_at))).transport_id, transport.id);
  alerts = unwrap(
    await technician
      .from('alerts')
      .select('id,alert_type,severity')
      .eq('transport_id', transport.id),
  );
  assert.ok(alerts.some((a) => a.alert_type === 'temperature' && a.severity === 'critical'));
  assert.ok(alerts.some((a) => a.alert_type === 'light'));
  const deadline = Date.now() + 15000;
  while (
    observed.filter((a) => a.transport_id === transport.id).length < 2 &&
    Date.now() < deadline
  )
    await pause(100);
  assert.ok(observed.filter((a) => a.transport_id === transport.id).length >= 2);
  report.realtime_alerts = observed.filter((a) => a.transport_id === transport.id).length;
  report.alert_types = alerts.map((a) => ({ type: a.alert_type, severity: a.severity }));
  pass(
    'In transit',
    '31.4 °C and 1333.3 lx produce critical temperature and light alerts through staff Realtime.',
  );
  for (const alert of alerts)
    unwrap(await technician.rpc('acknowledge_alert', { p_alert: alert.id }));
  pass('Acknowledgement', 'Verification alerts acknowledged through the audited technician RPC.');
  await transition(doctor, 'arrive');
  await transition(doctor, 'close', {
    p_verdict: 'review_required',
    p_notes:
      'Isolated simulated workflow test; intentional temperature/light excursions. No clinical specimen.',
  });
  assert.equal(transport.state, 'closed');
  assert.equal(
    unwrap(await technician.from('capsules').select('status').eq('id', cap.id).single()).status,
    'idle',
  );
  pass(
    'Doctor receiving',
    'Receiver ended transport and recorded a verdict; CAP0004 is idle again.',
  );
  report.transport_id = transport.id;
  report.result = 'pass';
} catch (error) {
  report.result = 'fail';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  try {
    if (transport && transport.state !== 'closed') {
      transport = unwrap(
        await doctor.from('transports').select('*').eq('id', transport.id).single(),
      );
      for (const [state, action, client] of [
        ['registered', 'prepare', technician],
        ['prepared', 'start', technician],
        ['in_transit', 'arrive', doctor],
      ]) {
        if (transport.state === state)
          transport = unwrap(
            await client.rpc('transition_transport', {
              p_transport: transport.id,
              p_action: action,
            }),
          );
      }
      if (transport.state === 'arrived')
        unwrap(
          await doctor.rpc('transition_transport', {
            p_transport: transport.id,
            p_action: 'close',
            p_verdict: 'review_required',
            p_notes:
              'Incomplete isolated simulated verification; retained for audit. No clinical specimen.',
          }),
        );
    }
    if (device) unwrap(await admin.from('devices').update({ active: false }).eq('id', device.id));
  } catch (error) {
    report.cleanup_error = error.message;
    process.exitCode = 1;
  }
  if (channel) await technician.removeChannel(channel);
  await Promise.allSettled([
    technician.auth.signOut({ scope: 'local' }),
    doctor.auth.signOut({ scope: 'local' }),
  ]);
  await writeFile('docs/alert-workflow-verification.json', JSON.stringify(report, null, 2) + '\n');
}
process.exit(process.exitCode || 0);
