import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
const envFile = new URL('../.env', import.meta.url);
let env = await readFile(envFile, 'utf8');
const token = process.env.DEVICE_TOKEN || randomBytes(32).toString('base64url');
env = env.replace(/^DEVICE_TOKEN=.*$/m, `DEVICE_TOKEN=${token}`);
await writeFile(envFile, env);
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const endpoint = process.env.TELEMETRY_URL || process.env.VITE_TELEMETRY_URL;
if (!url || !endpoint) throw new Error('Configure project and telemetry URLs first.');
const template = await readFile(
  new URL('../firmware/asqac/secrets.example.h', import.meta.url),
  'utf8',
);
const secrets = template
  .replace('REPLACE_WITH_GENERATED_PER_DEVICE_TOKEN', token)
  .replace('https://PROJECT_REF.supabase.co/functions/v1/telemetry', endpoint)
  .replace('#pragma once', `#pragma once\nconst char* SUPABASE_URL = "${url}";`);
await writeFile(new URL('../firmware/asqac/secrets.h', import.meta.url), secrets);
const config = {
  project_ref: 'chhpbpqoaikbcicxdnzj',
  supabase_url: url,
  telemetry_url: endpoint,
  device_uid: 'CAP0001-ESP32-001',
  demo_device_token: token,
  token_sha256: createHash('sha256').update(token).digest('hex'),
};
await writeFile(
  new URL('../supabase/demo-config.json', import.meta.url),
  JSON.stringify(config, null, 2) + '\n',
);
console.log(
  'Demo configuration saved to ignored .env and firmware secrets.h, and to supabase/demo-config.json. No administrative key is included in the device config.',
);
