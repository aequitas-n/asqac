import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const db = new PGlite({ extensions: { pgcrypto } });
const existingDoctor = '40000000-0000-4000-8000-000000000001';
const setup = await readFile(new URL('../supabase/ASQAC_SETUP.sql', import.meta.url), 'utf8');
before(async () => {
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(instance_id uuid,id uuid primary key,aud text,role text,email text unique,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',is_super_admin boolean,created_at timestamptz,updated_at timestamptz,confirmation_token text,recovery_token text,email_change_token_new text,email_change text,email_change_token_current text,reauthentication_token text,phone_change text,phone_change_token text,is_sso_user boolean,is_anonymous boolean);
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,provider_id text,identity_data jsonb,provider text,created_at timestamptz,updated_at timestamptz,unique(provider_id,provider));
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.unrelated_project_data(id integer);
    grant select on public.unrelated_project_data to authenticated;
  `);
  await db.query(
    "insert into auth.users(id,email,created_at) values($1,'doctor@asqac.test',now())",
    [existingDoctor],
  );
  await db.exec(setup);
});
after(async () => {
  await db.close();
});
describe('Combined Supabase SQL editor setup', () => {
  test('runs all migrations and preserves an already-created Auth account', async () => {
    assert.equal((await db.query('select * from public.asqac_schema_migrations')).rows.length, 9);
    assert.equal(
      (await db.query('select id from auth.users where email=$1', ['doctor@asqac.test'])).rows[0]
        .id,
      existingDoctor,
    );
    assert.equal((await db.query('select * from public.capsules')).rows.length, 4);
    assert.equal((await db.query('select * from public.handling_profiles')).rows.length, 7);
    assert.equal(
      (await db.query("select * from public.transports where state='closed'")).rows.length,
      0,
    );
  });
  test('seeds confirmed identities and exact demo passwords using bcrypt', async () => {
    for (const [email, password, role] of [
      ['technician@asqac.test', 'technician', 'technician'],
      ['doctor@asqac.test', 'doctor', 'doctor'],
    ]) {
      const result = await db.query(
        'select u.id,u.email_confirmed_at,p.role,extensions.crypt($2,u.encrypted_password)=u.encrypted_password as password_matches from auth.users u join public.profiles p on p.id=u.id where u.email=$1',
        [email, password],
      );
      assert.equal(result.rows[0].role, role);
      assert.equal(result.rows[0].password_matches, true);
      assert.ok(result.rows[0].email_confirmed_at);
    }
    assert.equal(
      (await db.query("select * from auth.identities where provider='email'")).rows.length,
      2,
    );
  });
  test('demo device hash matches the simulator config and is hidden from staff', async () => {
    const config = JSON.parse(
      await readFile(new URL('../supabase/demo-config.json', import.meta.url), 'utf8'),
    );
    const result = await db.query(
      "select token_hash from public.devices where device_uid='CAP0001-ESP32-001'",
    );
    assert.equal(result.rows[0].token_hash, config.token_sha256);
    assert.ok(
      (
        await db.query(
          "select * from pg_policies where tablename='devices' and policyname='devices_no_client_access'",
        )
      ).rows.length,
    );
  });
  test('creates the six Realtime publications and explicit staff policies', async () => {
    assert.equal(
      (await db.query("select * from pg_publication_tables where pubname='supabase_realtime'")).rows
        .length,
      6,
    );
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
    ])
      assert.ok(
        (await db.query('select * from pg_policies where tablename=$1', [table])).rows.length,
        `${table} needs a policy`,
      );
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('authenticated','public.unrelated_project_data','select') as allowed",
        )
      ).rows[0].allowed,
      true,
    );
  });
  test('can be pasted again without duplicating data or audit history', async () => {
    await db.exec(setup);
    assert.equal((await db.query('select * from auth.users')).rows.length, 2);
    assert.equal((await db.query('select * from public.transports')).rows.length, 0);
    assert.equal((await db.query('select * from public.audit_log')).rows.length, 0);
    assert.equal((await db.query('select * from public.devices')).rows.length, 1);
  });
  test('batch drains queued readings with unique subsecond times, auth and request limits', async () => {
    const device = (await db.query('select device_uid,token_hash from public.devices limit 1'))
      .rows[0];
    const base = Date.now() - 60000;
    const packet = (i: number) => ({
      device_uid: device.device_uid,
      recorded_at: new Date(base + i * 500).toISOString(),
      temp_c: 5,
      pressure_hpa: 1013,
      lux: 3,
      ax: 0,
      ay: 0,
      az: 1,
      gx: 0,
      gy: 0,
      gz: 0,
      pitch_deg: 2,
      roll_deg: 3,
      shock_g: 1,
      rssi: -55,
      simulated: true,
    });
    const rows = Array.from({ length: 13 }, (_, i) => packet(i));
    const invoke = (hash: string, payload: unknown) =>
      db.query('select public.ingest_reading_batch($1,$2,$3::jsonb) as result', [
        device.device_uid,
        hash,
        JSON.stringify(payload),
      ]);
    await assert.rejects(invoke('0'.repeat(64), rows), /Invalid device credentials/);
    const result = await invoke(device.token_hash, rows);
    assert.equal((result.rows[0] as { result: { results: unknown[] } }).result.results.length, 13);
    assert.equal((await db.query('select * from public.readings')).rows.length, 13);
    await db.exec(
      "update public.devices set last_ingested_at=clock_timestamp()+interval '1 second'",
    );
    await assert.rejects(invoke(device.token_hash, [packet(14)]), /rate limit/);
    await db.exec("update public.devices set last_ingested_at=now()-interval '3 seconds'");
    await invoke(device.token_hash, rows); // safe retry; no duplicate rows
    assert.equal((await db.query('select * from public.readings')).rows.length, 13);
    await db.exec("update public.devices set last_ingested_at=now()-interval '3 seconds'");
    await assert.rejects(
      invoke(device.token_hash, [packet(20), { ...packet(21), temp_c: 500 }]),
      /check constraint/,
    );
    assert.equal((await db.query('select * from public.readings')).rows.length, 13); // whole batch rolls back
    await assert.rejects(
      invoke(device.token_hash, [{ ...packet(22), device_uid: 'wrong-device' }]),
      /Mixed device/,
    );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','public.ingest_reading_batch(text,text,jsonb)','execute') as allowed",
        )
      ).rows[0].allowed,
      false,
    );
  });
  test('server derives altitude and signed height with baseline provenance; legacy height stays unknown', async () => {
    const device = (await db.query('select device_uid,token_hash from public.devices limit 1'))
      .rows[0];
    await db.exec("update public.devices set last_ingested_at=now()-interval '3 seconds'");
    const base = Date.now() - 30000;
    const reference = new Date(base - 10000).toISOString();
    const packet = (offset: number, pressure: number) => ({
      device_uid: device.device_uid,
      recorded_at: new Date(base + offset).toISOString(),
      temp_c: 5,
      pressure_hpa: pressure,
      lux: 0,
      ax: 0,
      ay: 0,
      az: 1,
      pitch_deg: 0,
      roll_deg: 0,
      shock_g: 1,
      rssi: -55,
      simulated: true,
      sea_level_pressure_hpa: 1013.25,
      reference_pressure_hpa: 1013.25,
      height_reference_at: reference,
    });
    await db.query('select public.ingest_reading_batch($1,$2,$3::jsonb)', [
      device.device_uid,
      device.token_hash,
      JSON.stringify([packet(0, 1013.25), packet(500, 1000), packet(1000, 1014.25)]),
    ]);
    const rows = (
      await db.query(
        'select altitude_m,height_change_m,height_reference_at from public.readings where recorded_at>=$1 order by recorded_at',
        [new Date(base).toISOString()],
      )
    ).rows;
    assert.equal(rows.length, 3);
    assert.ok(Math.abs(rows[0].altitude_m as number) < 0.0001);
    assert.ok((rows[1].height_change_m as number) > 100);
    assert.ok((rows[2].height_change_m as number) < 0);
    assert.ok(rows.every((r) => r.height_reference_at));
    assert.equal(
      (await db.query('select height_change_m from public.readings order by recorded_at limit 1'))
        .rows[0].height_change_m,
      null,
    );
  });
  test('both single and batch uploads use a 250 ms admission window', async () => {
    const device = (await db.query('select device_uid,token_hash from public.devices limit 1'))
      .rows[0];
    const packet = (offset: number) => ({
      device_uid: device.device_uid,
      recorded_at: new Date(Date.now() - 5000 + offset).toISOString(),
      temp_c: 5,
      pressure_hpa: 1013,
      lux: 3,
      ax: 0,
      ay: 0,
      az: 1,
      pitch_deg: 0,
      roll_deg: 0,
      shock_g: 1,
      rssi: -55,
      simulated: true,
    });
    await db.exec(
      "update public.devices set last_ingested_at=clock_timestamp()-interval '350 milliseconds'",
    );
    await db.query('select public.ingest_reading($1,$2,$3::jsonb)', [
      device.device_uid,
      device.token_hash,
      JSON.stringify(packet(0)),
    ]);
    await db.exec(
      "update public.devices set last_ingested_at=clock_timestamp()-interval '350 milliseconds'",
    );
    await db.query('select public.ingest_reading_batch($1,$2,$3::jsonb)', [
      device.device_uid,
      device.token_hash,
      JSON.stringify([packet(500)]),
    ]);
    await db.exec(
      "update public.devices set last_ingested_at=clock_timestamp()+interval '1 second'",
    );
    await assert.rejects(
      db.query('select public.ingest_reading_batch($1,$2,$3::jsonb)', [
        device.device_uid,
        device.token_hash,
        JSON.stringify([packet(1000)]),
      ]),
      /rate limit/,
    );
  });
});
