import { readFile, readdir } from 'node:fs/promises';
async function list(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) => (e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`])),
    )
  ).flat();
}
const files = (await list('dist')).filter((f) => /\.(js|html|css)$/.test(f));
const contents = (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n');
for (const name of ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DEVICE_TOKEN']) {
  const value = process.env[name];
  if (value && contents.includes(value))
    throw new Error(`${name} must never be included in a browser build.`);
}
console.log('PASS browser bundle excludes administrative keys and the per-device token.');
