import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!url) throw new Error('Configure SUPABASE_URL.');
const timeout = AbortSignal.timeout(15000);
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
for (const [label, key] of [
  ['publishable', process.env.VITE_SUPABASE_PUBLISHABLE_KEY],
  ['anon', process.env.VITE_SUPABASE_ANON_KEY],
]) {
  if (!key) continue;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: timeout,
    });
    console.log(`${label} Auth endpoint: HTTP ${response.status}`);
  } catch (e) {
    console.log(`${label} Auth endpoint: ${e.message}`);
  }
}
for (const [label, key] of [
  ['secret', process.env.SUPABASE_SECRET_KEY],
  ['service_role', process.env.SUPABASE_SERVICE_ROLE_KEY],
]) {
  if (!key) continue;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  console.log(
    `${label} Auth administration: ${error ? `${error.status ?? ''} ${error.code ?? ''} ${error.message}` : `reachable (${data.users.length} user(s) in first page)`}`,
  );
  if (error) continue;
  for (const table of [
    'profiles',
    'handling_profiles',
    'capsules',
    'devices',
    'specimens',
    'transports',
    'readings',
    'alerts',
    'audit_log',
  ]) {
    const response = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || key}`,
      },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {}
    console.log(
      `${table}: HTTP ${response.status} ${Array.isArray(parsed) ? `${parsed.length} row(s) returned (limit 1)` : parsed?.message || body.slice(0, 200)}`,
    );
  }
  break;
}
if (publicKey) {
  const client = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const [email, password] of [
    ['technician@asqac.test', 'technician'],
    ['doctor@asqac.test', 'doctor'],
  ]) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    console.log(
      `${email} login: ${error ? `${error.status} ${error.code ?? ''} ${error.message}` : `successful (${data.user.id})`}`,
    );
    if (data.session) await client.auth.signOut({ scope: 'local' });
  }
}
try {
  const response = await fetch(`${url}/functions/v1/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  console.log(
    `Telemetry endpoint: HTTP ${response.status} ${body.error ?? body.message ?? body.code ?? ''}`,
  );
} catch (e) {
  console.log(`Telemetry endpoint: ${e.message}`);
}
