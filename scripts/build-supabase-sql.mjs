import { readFile, writeFile, readdir } from 'node:fs/promises';
const folder = new URL('../supabase/migrations/', import.meta.url);
const files = (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort();
let sql = `-- ASQAC setup for chhpbpqoaikbcicxdnzj\n-- Paste this entire file into the Supabase SQL Editor as postgres.\n-- Includes role policies, audited RPCs, Realtime, closed synthetic history,\n-- confirmed demo accounts, and the hashed CAP0001 device token.\n-- Re-running skips completed migrations; it never drops clinical records.\n\nbegin;\ncreate table if not exists public.asqac_schema_migrations(version text primary key,applied_at timestamptz not null default now());\nalter table public.asqac_schema_migrations enable row level security;\nrevoke all on public.asqac_schema_migrations from anon,authenticated;\ngrant all on public.asqac_schema_migrations to service_role;\n`;
for (const file of files) {
  const body = await readFile(new URL(file, folder), 'utf8');
  const version = file.split('_')[0];
  const tag = `asqac_${version}`;
  sql += `\n-- ${file}\ndo $${tag}$\nbegin\n  if not exists(select 1 from public.asqac_schema_migrations where version='${version}') then\n    execute $source_${version}$\n${body}\n$source_${version}$;\n    insert into public.asqac_schema_migrations(version) values('${version}');\n  end if;\nend;\n$${tag}$;\n`;
}
sql += `\nnotify pgrst,'reload schema';\ncommit;\n\n-- Verification summary (no credentials or patient information)\nselect 'capsules' as entity,count(*) as row_count from public.capsules\nunion all select 'handling profiles',count(*) from public.handling_profiles\nunion all select 'demo staff',count(*) from public.profiles where email in ('technician@asqac.test','doctor@asqac.test')\nunion all select 'demo devices',count(*) from public.devices where device_uid='CAP0001-ESP32-001'\nunion all select 'historical transports',count(*) from public.transports where state='closed';\n`;
await writeFile(new URL('../supabase/ASQAC_SETUP.sql', import.meta.url), sql);
console.log(`Built supabase/ASQAC_SETUP.sql from ${files.length} migrations.`);
