import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const url = process.env.VITE_SUPABASE_URL;
assert.equal(url, 'https://chhpbpqoaikbcicxdnzj.supabase.co');
const db = createClient(
  url,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const all = async (table, filter = (q) => q) => {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await filter(db.from(table).select('*')).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
};
const allSpecimens = await all('specimens');
const specimens = allSpecimens.filter(
  (s) =>
    (/^DEMO-REF-00[1-9]$/.test(s.patient_ref) &&
      s.requested_test === 'Research chemistry panel' &&
      s.clinical_notice.startsWith('SYNTHETIC HISTORY')) ||
    (s.patient_ref === 'ASQAC-VERIFY' &&
      s.requested_test === 'Connection verification (simulated)' &&
      s.clinical_notice === 'Synthetic end-to-end connection check. No patient specimen.') ||
    (s.patient_ref === 'ASQAC-UI-VERIFY' && s.requested_test === 'Live interface verification') ||
    (s.patient_ref === 'ASQAC-ALERT-VERIFY' &&
      s.requested_test === 'Simulated alert workflow verification' &&
      s.clinical_notice.startsWith('Synthetic workflow verification.')),
);
const specimenIds = specimens.map((s) => s.id);
const transports = specimenIds.length
  ? await all('transports', (q) => q.in('specimen_id', specimenIds))
  : [];
const transportIds = transports.map((t) => t.id);
const devices = (await all('devices')).filter((d) =>
  /^CAP0004-(BATCH|ALERT)-VERIFY-[0-9]{13}$/.test(d.device_uid),
);
const uids = devices.map((d) => d.device_uid);
const readings = [
  ...new Map(
    [
      ...(transportIds.length
        ? await all('readings', (q) => q.in('transport_id', transportIds))
        : []),
      ...(uids.length ? await all('readings', (q) => q.in('device_uid', uids)) : []),
    ].map((r) => [r.id, r]),
  ).values(),
];
const alerts = transportIds.length
  ? await all('alerts', (q) => q.in('transport_id', transportIds))
  : [];
const entityIds = [...transportIds, ...specimenIds, ...devices.map((d) => d.id)];
const audit = entityIds.length ? await all('audit_log', (q) => q.in('entity_id', entityIds)) : [];
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/test-data-cleanup-backup.json',
  JSON.stringify(
    {
      checked_at: new Date().toISOString(),
      specimens,
      transports,
      devices,
      readings,
      alerts,
      audit,
      protected_specimen_ids: allSpecimens
        .filter((s) => !specimenIds.includes(s.id))
        .map((s) => s.id),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      target_specimens: specimens.length,
      target_transports: transports.length,
      target_simulated_readings: readings.filter((r) => r.simulated).length,
      physical_readings_to_preserve: readings.filter((r) => !r.simulated).length,
      target_alerts: alerts.length,
      target_audit_events: audit.length,
      target_temporary_devices: devices.length,
      protected_user_specimens: allSpecimens.length - specimens.length,
      backup: 'artifacts/test-data-cleanup-backup.json',
    },
    null,
    2,
  ),
);
