import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
const db = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const uid = process.env.DEVICE_UID || 'CAP0001-ESP32-001';
const auth = await db.auth.signInWithPassword({
  email: 'technician@asqac.test',
  password: process.env.DEMO_TECHNICIAN_PASSWORD || 'technician',
});
if (auth.error) throw new Error(auth.error.message);
try {
  const { data, error } = await db
    .from('readings')
    .select('recorded_at,received_at')
    .eq('device_uid', uid)
    .eq('simulated', false)
    .order('received_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error('No physical readings available to measure.');
  const delays = data.map((r) => Date.parse(r.received_at) - Date.parse(r.recorded_at));
  const gaps = data
    .slice(0, -1)
    .map((r, i) => Date.parse(r.received_at) - Date.parse(data[i + 1].received_at));
  const stats = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) };
  };
  const report = {
    checked_at: new Date().toISOString(),
    device_uid: uid,
    physical_readings: data.length,
    newest_observation: data[0].recorded_at,
    observation_to_ingestion_ms: stats(delays),
    receipt_interval_ms: stats(gaps),
    caveat:
      'Timestamp differences include device clock error and up to 1 second of timestamp quantization; they are not browser or pure network latency.',
    read_only: true,
  };
  await mkdir('docs', { recursive: true });
  await writeFile('docs/device-latency-snapshot.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await db.auth.signOut({ scope: 'local' });
}
