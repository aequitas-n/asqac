import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const tech = '30000000-0000-4000-8000-000000000001',
  doctor = '30000000-0000-4000-8000-000000000002';
const cap1 = '20000000-0000-4000-8000-000000000001',
  cap2 = '20000000-0000-4000-8000-000000000002';
let transportId = '',
  secondId = '',
  readingId = 0;
const hash = 'a'.repeat(64);
let timeIndex = 0;
async function asRole(role: string, user: string | null, sql: string, args: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    return tx.query(sql, args);
  });
}
const staff = (user: string, sql: string, args: unknown[] = []) =>
  asRole('authenticated', user, sql, args);
const service = (sql: string, args: unknown[] = []) => asRole('service_role', null, sql, args);
const input = (capsule = cap1) => ({
  patient_ref: 'TEST-REF',
  requested_test: 'Research chemistry',
  specimen_type: 'BLOOD',
  handling_profile_id: '10000000-0000-4000-8000-000000000001',
  priority: 'routine',
  origin: 'Ward A',
  destination_lab: 'Chemistry',
  clinical_notice: 'Test only',
  capsule_id: capsule,
});
async function packet(changes: Record<string, unknown> = {}, reset = true) {
  if (reset) await db.exec('update public.devices set last_ingested_at=null');
  const body = {
    device_uid: 'TEST-DEVICE',
    recorded_at: new Date(Date.now() + timeIndex++).toISOString(),
    temp_c: 5,
    pressure_hpa: 1012,
    lux: 3,
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
    simulated: false,
    ...changes,
  };
  const result = await service('select public.ingest_reading($1,$2,$3::jsonb) as result', [
    'TEST-DEVICE',
    hash,
    JSON.stringify(body),
  ]);
  return {
    body,
    result: result.rows[0].result as {
      reading_id: number;
      duplicate?: boolean;
      transport_id: string;
    },
  };
}
before(async () => {
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for (const file of [
    '202611020001_schema.sql',
    '202611020002_workflows.sql',
    '202611020003_seed.sql',
    '202611020004_realtime.sql',
    '202611030006_batch_ingestion.sql',
    '202611030007_barometric_height.sql',
  ])
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  await db.query(
    "insert into auth.users(id,email) values($1,'technician@test'),($2,'doctor@test')",
    [tech, doctor],
  );
  await db.query("update public.profiles set role='doctor' where id=$1", [doctor]);
});
after(async () => {
  await db.close();
});
describe('PostgreSQL schema, RLS and audited workflows', { concurrency: false }, () => {
  test('migrations seed coherent capsules, profiles, closed histories and audit records', async () => {
    assert.equal((await db.query('select * from public.capsules')).rows.length, 4);
    assert.equal((await db.query('select * from public.handling_profiles')).rows.length, 7);
    assert.equal(
      (await db.query("select * from public.transports where state='closed'")).rows.length,
      9,
    );
    assert.equal((await db.query('select * from public.audit_log')).rows.length, 45);
  });
  test('anonymous users cannot read; authenticated staff can read the fleet', async () => {
    await assert.rejects(
      asRole('anon', null, 'select * from public.capsules'),
      /permission denied/,
    );
    assert.equal((await staff(tech, 'select * from public.capsules')).rows.length, 4);
  });
  test('RLS blocks direct workflow writes, token reads, audit rewrites and self-promotion', async () => {
    for (const sql of [
      "update public.capsules set status='idle'",
      'select token_hash from public.devices',
      "update public.profiles set role='admin'",
      'delete from public.audit_log',
    ])
      await assert.rejects(staff(tech, sql), /permission denied/);
  });
  test('doctor cannot register and profile/specimen mismatch is rejected atomically', async () => {
    await assert.rejects(
      staff(doctor, 'select public.register_specimen($1::jsonb)', [JSON.stringify(input())]),
      /Technician role/,
    );
    await assert.rejects(
      staff(tech, 'select public.register_specimen($1::jsonb)', [
        JSON.stringify({ ...input(), specimen_type: 'URINE' }),
      ]),
      /handling profile/,
    );
    assert.equal((await db.query('select * from public.specimens')).rows.length, 9);
  });
  test('registration reserves exactly one capsule and rejects a competing reservation', async () => {
    const result = await staff(tech, 'select public.register_specimen($1::jsonb) as result', [
      JSON.stringify(input()),
    ]);
    transportId = (result.rows[0].result as { transport: { id: string } }).transport.id;
    await assert.rejects(
      staff(tech, 'select public.register_specimen($1::jsonb)', [JSON.stringify(input())]),
      /no longer available/,
    );
    assert.equal((await db.query('select * from public.specimens')).rows.length, 10);
    assert.equal(
      (await db.query('select status from public.capsules where id=$1', [cap1])).rows[0].status,
      'prepared',
    );
  });
  test('state machine enforces preparation and technician-only start', async () => {
    await assert.rejects(
      staff(tech, "select public.transition_transport($1,'start')", [transportId]),
      /state changed/,
    );
    await assert.rejects(
      staff(doctor, "select public.transition_transport($1,'prepare')", [transportId]),
      /Technician role/,
    );
    await staff(tech, "select public.transition_transport($1,'prepare')", [transportId]);
    await staff(tech, "select public.transition_transport($1,'start')", [transportId]);
    await assert.rejects(
      staff(doctor, "select public.transition_transport($1,'start')", [transportId]),
      /Technician role/,
    );
  });
  test('ingestion is service-only and invalid credentials cannot insert readings', async () => {
    await db.query(
      'insert into public.devices(capsule_id,device_uid,token_hash) values($1,$2,$3)',
      [cap1, 'TEST-DEVICE', hash],
    );
    await assert.rejects(
      staff(tech, 'select public.ingest_reading($1,$2,$3::jsonb)', ['TEST-DEVICE', hash, '{}']),
      /permission denied/,
    );
    await assert.rejects(
      service('select public.ingest_reading($1,$2,$3::jsonb)', [
        'TEST-DEVICE',
        'b'.repeat(64),
        '{}',
      ]),
      /Invalid device credentials/,
    );
  });
  test('ingestion associates the transport, updates summary, deduplicates and rate limits', async () => {
    const { body, result } = await packet({
      reference_pressure_hpa: 1012,
      height_reference_at: new Date(Date.now() - 10000).toISOString(),
    });
    readingId = result.reading_id;
    assert.equal(result.transport_id, transportId);
    const duplicate = await service('select public.ingest_reading($1,$2,$3::jsonb) as result', [
      'TEST-DEVICE',
      hash,
      JSON.stringify(body),
    ]);
    assert.equal((duplicate.rows[0].result as { duplicate: boolean }).duplicate, true);
    await assert.rejects(packet({}, false), /rate limit/);
    const t = (
      await db.query('select telemetry_summary from public.transports where id=$1', [transportId])
    ).rows[0].telemetry_summary as {
      count: number;
      height_change_min_m: number;
      altitude_min_m: number;
    };
    assert.equal(t.count, 1);
    assert.equal(t.height_change_min_m, 0);
    assert.ok(Number.isFinite(t.altitude_min_m));
  });
  test('a sustained temperature breach produces one episode; recovery permits a new episode', async () => {
    await packet({ temp_c: 12 });
    await packet({ temp_c: 12.5 });
    assert.equal(
      (
        await db.query(
          "select * from public.alerts where transport_id=$1 and alert_type='temperature'",
          [transportId],
        )
      ).rows.length,
      1,
    );
    await packet();
    const recovered = await db.query(
      "select resolved_at from public.alerts where transport_id=$1 and alert_type='temperature'",
      [transportId],
    );
    assert.ok(recovered.rows[0].resolved_at);
    await packet({ temp_c: 13 });
    assert.equal(
      (
        await db.query(
          "select * from public.alerts where transport_id=$1 and alert_type='temperature'",
          [transportId],
        )
      ).rows.length,
      2,
    );
  });
  test('acknowledgement is idempotent and appends one actor-attributed audit entry', async () => {
    const a = (
      await db.query('select id from public.alerts where transport_id=$1 limit 1', [transportId])
    ).rows[0].id;
    await staff(tech, 'select public.acknowledge_alert($1)', [a]);
    await staff(tech, 'select public.acknowledge_alert($1)', [a]);
    const logs = await db.query(
      "select * from public.audit_log where action='Alert acknowledged' and entity_id=$1",
      [transportId],
    );
    assert.equal(logs.rows.length, 1);
    assert.equal(logs.rows[0].actor_id, tech);
  });
  test('unassigned/old timestamps cannot bleed into the active transport', async () => {
    const countBefore = (
      await db.query('select telemetry_summary from public.transports where id=$1', [transportId])
    ).rows[0].telemetry_summary as { count: number };
    const prior = new Date(Date.now() - 3600000).toISOString();
    const p = await packet({ recorded_at: prior });
    assert.equal(p.result.transport_id, null);
    const t = await db.query('select telemetry_summary from public.transports where id=$1', [
      transportId,
    ]);
    assert.equal((t.rows[0].telemetry_summary as { count: number }).count, countBefore.count);
  });
  test('motion, light and pressure breaches create distinct episodes and persist critical counts', async () => {
    await packet({ shock_g: 4.5, pitch_deg: 70, lux: 500, pressure_hpa: 800 });
    const result = await db.query('select alert_type from public.alerts where transport_id=$1', [
      transportId,
    ]);
    for (const kind of ['shock', 'tilt', 'light', 'pressure'])
      assert.ok(result.rows.some((row) => row.alert_type === kind));
    const counts = await db.query(
      'select excursion_count,critical_excursion_count from public.transports where id=$1',
      [transportId],
    );
    assert.equal(counts.rows[0].critical_excursion_count, 3);
    await packet();
    await packet({ temp_c: 8.5 });
    const beforeEscalation = (
      await db.query('select excursion_count from public.transports where id=$1', [transportId])
    ).rows[0].excursion_count;
    await packet({ temp_c: 12 });
    const afterEscalation = await db.query(
      'select excursion_count,critical_excursion_count from public.transports where id=$1',
      [transportId],
    );
    assert.equal(afterEscalation.rows[0].excursion_count, beforeEscalation);
    assert.equal(afterEscalation.rows[0].critical_excursion_count, 4);
    assert.equal(
      (
        await db.query(
          "select * from public.audit_log where action='Excursion severity escalated' and entity_id=$1",
          [transportId],
        )
      ).rows.length,
      1,
    );
  });
  test('only a doctor can receive; required verdict notes and immutable closure are enforced', async () => {
    await assert.rejects(
      staff(tech, "select public.transition_transport($1,'arrive')", [transportId]),
      /Doctor role/,
    );
    await staff(doctor, "select public.transition_transport($1,'arrive')", [transportId]);
    await assert.rejects(
      staff(doctor, "select public.transition_transport($1,'close','reject','')", [transportId]),
      /clinical explanation/,
    );
    await staff(
      doctor,
      "select public.transition_transport($1,'close','reject','Critical excursion reviewed.')",
      [transportId],
    );
    await assert.rejects(
      staff(doctor, "select public.transition_transport($1,'close','accept')", [transportId]),
      /state changed/,
    );
    assert.equal(
      (await db.query('select status from public.capsules where id=$1', [cap1])).rows[0].status,
      'idle',
    );
  });
  test('late data for a closed, reviewed journey is rejected', async () => {
    // Preserve microseconds and choose a new observation: a rounded midpoint
    // can collide with an existing row and correctly take the duplicate path.
    const t = await db.query<{ stamp: string }>(
      `select candidate::text as stamp from public.transports t
       cross join generate_series(1,100) step
       cross join lateral (select t.started_at+step*interval '1 microsecond' as candidate) point
       where t.id=$1 and candidate<t.arrived_at
       and not exists(select 1 from public.readings r where r.device_uid='TEST-DEVICE' and r.recorded_at=candidate)
       limit 1`,
      [transportId],
    );
    assert.equal(t.rows.length, 1);
    const stamp = t.rows[0].stamp;
    await assert.rejects(packet({ recorded_at: stamp }), /already reviewed/);
  });
  test('scheduled connection and delay checks are deduplicated even without sensor packets', async () => {
    const result = await staff(tech, 'select public.register_specimen($1::jsonb) as result', [
      JSON.stringify(input(cap2)),
    ]);
    secondId = (result.rows[0].result as { transport: { id: string } }).transport.id;
    await staff(tech, "select public.transition_transport($1,'prepare')", [secondId]);
    await staff(tech, "select public.transition_transport($1,'start')", [secondId]);
    await db.query(
      "update public.transports set started_at=now()-interval '70 minutes' where id=$1",
      [secondId],
    );
    await service('select public.check_transport_health()');
    await service('select public.check_transport_health()');
    const alerts = await db.query('select alert_type from public.alerts where transport_id=$1', [
      secondId,
    ]);
    assert.deepEqual(alerts.rows.map((a) => a.alert_type).sort(), ['connectivity', 'delay']);
  });
  test('retention preserves audit and summary evidence while pruning old closed-transport packets', async () => {
    const before = (
      await db.query('select telemetry_summary from public.transports where id=$1', [transportId])
    ).rows[0].telemetry_summary;
    await db.query(
      "update public.readings set received_at=now()-interval '4 days' where transport_id=$1",
      [transportId],
    );
    await db.query("update public.transports set closed_at=now()-interval '3 days' where id=$1", [
      transportId,
    ]);
    await service('select public.prune_telemetry()');
    assert.equal(
      (await db.query('select * from public.readings where id=$1', [readingId])).rows.length,
      0,
    );
    assert.deepEqual(
      (await db.query('select telemetry_summary from public.transports where id=$1', [transportId]))
        .rows[0].telemetry_summary,
      before,
    );
    assert.ok(
      (await db.query('select * from public.audit_log where entity_id=$1', [transportId])).rows
        .length > 4,
    );
  });
});
