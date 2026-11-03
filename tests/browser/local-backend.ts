// Browser-only contract harness. Runs the real SQL against isolated PostgreSQL;
// mocks the Supabase HTTP gateway, not production frontend data or components.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readingSchema } from '../../supabase/functions/_shared/protocol';
export const tech = '30000000-0000-4000-8000-000000000001',
  doctor = '30000000-0000-4000-8000-000000000002';
export const token = 'local-test-token-that-is-at-least-thirty-two-characters';
export async function connectLocalBackend(page: Page) {
  const db = new PGlite();
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for (const file of [
    '202611020001_schema.sql',
    '202611020002_workflows.sql',
    '202611020003_seed.sql',
    '202611020004_realtime.sql',
  ])
    await db.exec(
      await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  await db.query(
    'insert into auth.users(id,email,raw_user_meta_data) values($1,\'technician@asqac.test\',\'{"full_name":"Demo Technician"}\'),($2,\'doctor@asqac.test\',\'{"full_name":"Dr. Demo Receiver"}\')',
    [tech, doctor],
  );
  await db.query("update public.profiles set role='doctor' where id=$1", [doctor]);
  await db.query(
    "insert into public.devices(capsule_id,device_uid,token_hash) values('20000000-0000-4000-8000-000000000001','CAP0001-ESP32-001',$1)",
    [createHash('sha256').update(token).digest('hex')],
  );
  let actor = tech;
  const asStaff = async (sql: string, args: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      return tx.query(sql, args);
    });
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const respond = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: JSON.stringify(data),
      });
    if (request.method() === 'OPTIONS') {
      await respond({});
      return;
    }
    try {
      if (url.pathname === '/auth/v1/token') {
        const body = request.postDataJSON();
        actor = body.email === 'doctor@asqac.test' ? doctor : tech;
        const profile = (await db.query('select * from public.profiles where id=$1', [actor]))
          .rows[0];
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const jwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.localtest`;
        await respond({
          access_token: jwt,
          refresh_token: 'local-test-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          user: {
            id: actor,
            email: profile.email,
            role: 'authenticated',
            aud: 'authenticated',
            app_metadata: { provider: 'email' },
            user_metadata: { full_name: profile.full_name },
            created_at: new Date().toISOString(),
          },
        });
        return;
      }
      if (url.pathname === '/auth/v1/logout') {
        await respond({});
        return;
      }
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = url.pathname.split('/').at(-1);
        const args = request.postDataJSON() ?? {};
        let rows;
        if (fn === 'recent_fleet_readings')
          rows = await asStaff('select * from public.recent_fleet_readings()');
        else if (fn === 'simulator_devices')
          rows = await asStaff('select * from public.simulator_devices()');
        else if (fn === 'register_specimen') {
          rows = await asStaff('select public.register_specimen($1::jsonb) as result', [
            JSON.stringify(args.p_input),
          ]);
          await respond(rows.rows[0].result);
          return;
        } else if (fn === 'transition_transport') {
          rows = await asStaff('select public.transition_transport($1,$2,$3,$4) as result', [
            args.p_transport,
            args.p_action,
            args.p_verdict ?? null,
            args.p_notes ?? null,
          ]);
          await respond(rows.rows[0].result);
          return;
        } else if (fn === 'acknowledge_alert') {
          await asStaff('select public.acknowledge_alert($1)', [args.p_alert]);
          await respond(null);
          return;
        } else throw new Error(`Unsupported test RPC ${fn}`);
        await respond(rows.rows);
        return;
      }
      if (url.pathname === '/functions/v1/telemetry') {
        const payload = readingSchema.parse(request.postDataJSON());
        if (request.headers()['x-device-token'] !== token) {
          await respond({ error: 'Invalid device credentials' }, 401);
          return;
        }
        const result = await db.query('select public.ingest_reading($1,$2,$3::jsonb) as result', [
          payload.device_uid,
          createHash('sha256').update(token).digest('hex'),
          JSON.stringify(payload),
        ]);
        await respond(result.rows[0].result, 201);
        return;
      }
      const table = url.pathname.split('/').at(-1)!;
      if (
        ![
          'profiles',
          'capsules',
          'handling_profiles',
          'specimens',
          'transports',
          'alerts',
          'audit_log',
          'readings',
        ].includes(table)
      )
        throw new Error(`Unsupported test table ${table}`);
      const args: unknown[] = [];
      const filters: string[] = [];
      for (const [column, value] of url.searchParams) {
        if (
          ['id', 'capsule_id', 'transport_id', 'entity_id', 'created_at'].includes(column) &&
          /^(eq|gte)\./.test(value)
        ) {
          args.push(value.slice(value.indexOf('.') + 1));
          filters.push(`${column} ${value.startsWith('gte.') ? '>=' : '='} $${args.length}`);
        }
      }
      const sort =
        table === 'capsules'
          ? 'code'
          : table === 'handling_profiles'
            ? 'code'
            : table === 'profiles'
              ? 'email'
              : table === 'readings'
                ? 'recorded_at desc'
                : 'created_at desc';
      const rows = await asStaff(
        `select * from public.${table}${filters.length ? ' where ' + filters.join(' and ') : ''} order by ${sort}`,
        args,
      );
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      await respond(single ? rows.rows[0] : rows.rows);
    } catch (e) {
      await respond(
        {
          message: e instanceof Error ? e.message : 'Test gateway failed',
          code: 'P0001',
          error: e instanceof Error ? e.message : 'Test gateway failed',
        },
        400,
      );
    }
  });
  return db;
}
