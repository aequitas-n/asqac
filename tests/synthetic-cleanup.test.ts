import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('synthetic cleanup removes only marked test records and preserves real work/readings', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
    for (const file of [
      '202611020001_schema.sql',
      '202611020002_workflows.sql',
      '202611020003_seed.sql',
    ])
      await db.exec(
        await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'),
      );
    const cap = '20000000-0000-4000-8000-000000000001',
      profile = '10000000-0000-4000-8000-000000000001';
    await db.query(
      "insert into public.devices(capsule_id,device_uid,token_hash) values($1,'REAL-ESP',$2)",
      [cap, 'a'.repeat(64)],
    );
    await db.query(
      "insert into public.devices(capsule_id,device_uid,token_hash,active) values('20000000-0000-4000-8000-000000000004','CAP0004-BATCH-VERIFY-1793648448357',$1,false)",
      ['b'.repeat(64)],
    );
    const real = (
      await db.query(
        `insert into public.specimens(patient_ref,requested_test,specimen_type,priority,handling_profile_id,origin,destination_lab)
      values('REF-KEEP','Blood test','BLOOD','routine',$1,'Ward','Lab') returning id`,
        [profile],
      )
    ).rows[0].id;
    const realTransport = (
      await db.query(
        `insert into public.transports(capsule_id,specimen_id,handling_profile_id,profile_snapshot)
      select $1,$2,id,to_jsonb(p) from public.handling_profiles p where id=$3 returning id`,
        [cap, real, profile],
      )
    ).rows[0].id;
    const synthetic = (
      await db.query('select id from public.transports order by created_at limit 1')
    ).rows[0].id;
    await db.query("update public.capsules set status='prepared' where id=$1", [cap]);
    const add = async (uid: string, transport: unknown, simulated: boolean, offset: number) =>
      db.query(
        `insert into public.readings(capsule_id,transport_id,device_uid,recorded_at,temp_c,pressure_hpa,lux,ax,ay,az,pitch_deg,roll_deg,shock_g,rssi,simulated)
      values($1,$2,$3,now()+make_interval(secs=>$4),5,1013,3,0,0,1,0,0,1,-55,$5) returning id`,
        [cap, transport, uid, offset, simulated],
      );
    const physical = (await add('REAL-ESP', synthetic, false, 0)).rows[0].id;
    await add('REAL-ESP', synthetic, true, 1);
    await add('CAP0004-BATCH-VERIFY-1793648448357', null, true, 2);
    await db.query(
      "insert into public.audit_log(actor_label,action,entity_type,entity_id) values('Real staff','Specimen registered','transport',$1)",
      [realTransport],
    );
    const sql = await readFile(
      new URL('../supabase/migrations/202611030009_remove_synthetic_history.sql', import.meta.url),
      'utf8',
    );
    await db.exec(sql);
    assert.equal((await db.query('select count(*)::int as n from public.specimens')).rows[0].n, 1);
    assert.equal((await db.query('select id from public.transports')).rows[0].id, realTransport);
    const readings = (await db.query('select id,transport_id,simulated from public.readings')).rows;
    assert.equal(readings.length, 1);
    assert.equal(readings[0].id, physical);
    assert.equal(readings[0].transport_id, null);
    assert.equal(readings[0].simulated, false);
    assert.equal(
      (await db.query('select device_uid from public.devices')).rows[0].device_uid,
      'REAL-ESP',
    );
    assert.equal((await db.query('select count(*)::int as n from public.devices')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from public.alerts')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from public.audit_log')).rows[0].n, 1);
    assert.equal(
      (await db.query('select status from public.capsules where id=$1', [cap])).rows[0].status,
      'prepared',
    );
    assert.equal((await db.query('select count(*)::int as n from public.capsules')).rows[0].n, 4);
    assert.equal(
      (await db.query('select count(*)::int as n from public.handling_profiles')).rows[0].n,
      7,
    );
    await db.exec(sql); // Re-running does not touch the retained real records.
    assert.equal((await db.query('select count(*)::int as n from public.specimens')).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
