import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error(
    'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (never use VITE_ for the service role key).',
  );
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const code = flag('--capsule', 'CAP0001');
const uid = flag('--uid', process.env.DEVICE_UID || `${code}-ESP32-001`);
if (!/^[A-Za-z0-9_-]{3,80}$/.test(uid)) throw new Error('Invalid device UID');
const { data: capsule, error } = await db.from('capsules').select('id').eq('code', code).single();
if (error) throw error;
const { data: existing, error: readError } = await db
  .from('devices')
  .select('device_uid,capsule_id')
  .eq('capsule_id', capsule.id)
  .eq('active', true)
  .maybeSingle();
if (readError) throw readError;
if (existing && existing.device_uid !== uid)
  throw new Error(
    `Capsule already has active device ${existing.device_uid}. Deactivate it in SQL before assigning a different UID.`,
  );
const { data: other } = await db
  .from('devices')
  .select('capsule_id')
  .eq('device_uid', uid)
  .maybeSingle();
if (other && other.capsule_id !== capsule.id)
  throw new Error('That UID belongs to another capsule.');
const token = randomBytes(32).toString('base64url');
const token_hash = createHash('sha256').update(token).digest('hex');
const { error: writeError } = await db
  .from('devices')
  .upsert(
    { capsule_id: capsule.id, device_uid: uid, token_hash, active: true },
    { onConflict: 'device_uid' },
  );
if (writeError) throw writeError;
console.log(`Registered ${uid} for ${code}. Any prior token for this UID is now invalid.`);
console.log('Save this device secret now; only its SHA-256 hash is stored in the database.');
console.log(`DEVICE_UID=${uid}\nDEVICE_TOKEN=${token}`);
