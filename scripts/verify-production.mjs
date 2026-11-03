import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const origin = 'https://asqac-capsule-care-connect.vercel.app';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const telemetry = process.env.VITE_TELEMETRY_URL;
assert.equal(url, 'https://chhpbpqoaikbcicxdnzj.supabase.co');
assert.equal(telemetry, `${url}/functions/v1/telemetry`);
assert.ok(key);
const report = {
  checked_at: new Date().toISOString(),
  frontend: origin,
  backend: url,
  telemetry,
  browser_used: false,
  routes: [],
  logins: [],
  telemetry_cors: false,
};

const routes = await Promise.all(
  ['/', '/login', '/capsules', '/reports'].map(async (route) => {
    const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, `Public route ${route} returned ${response.status}`);
    const html = await response.text();
    assert.match(html, /id=["']root["']/);
    return { route, status: response.status, html };
  }),
);
report.routes = routes.map(({ route, status }) => ({ route, status }));
const entry = routes[0].html.match(/src=["']([^"']+\.js)["']/)?.[1];
assert.ok(entry, 'Production HTML must reference its built JavaScript');
const asset = await fetch(new URL(entry, origin), { signal: AbortSignal.timeout(20_000) });
assert.equal(asset.status, 200);
assert.match(asset.headers.get('content-type') || '', /javascript/);
report.entry_asset = { path: entry, status: asset.status };

const cors = await fetch(telemetry, {
  method: 'OPTIONS',
  signal: AbortSignal.timeout(20_000),
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,x-device-token',
  },
});
assert.equal(cors.status, 204);
assert.equal(cors.headers.get('access-control-allow-origin'), origin);
report.telemetry_cors = true;

report.logins = await Promise.all(
  [
    ['technician@asqac.test', process.env.DEMO_TECHNICIAN_PASSWORD || 'technician', 'technician'],
    ['doctor@asqac.test', process.env.DEMO_DOCTOR_PASSWORD || 'doctor', 'doctor'],
  ].map(async ([email, password, role]) => {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      assert.equal(error, null, `${role} sign-in failed`);
      const profile = await client.from('profiles').select('role').eq('id', data.user.id).single();
      assert.equal(profile.error, null);
      assert.equal(profile.data.role, role);
      const fleet = await client.from('capsules').select('id', { count: 'exact', head: true });
      assert.equal(fleet.error, null);
      assert.ok(fleet.count >= 4);
      return { role, authenticated: true, staff_rls_read: true, fleet_count: fleet.count };
    } finally {
      await client.auth.signOut({ scope: 'local' });
    }
  }),
);
report.result = 'pass';
report.scope =
  'Public production HTML/routes/assets, telemetry preflight and real staff Auth/RLS; no browser or telemetry writes';
await writeFile(
  'docs/production-deployment-verification.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  'PASS production routes/assets, same Supabase backend, telemetry CORS, technician/doctor sign-in and staff RLS. No browser or sensor writes.',
);
