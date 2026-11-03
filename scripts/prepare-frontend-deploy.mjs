import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Publish the compiled public website, never the workspace or device sources.
await import('./check-client-bundle.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.join(
  root,
  'artifacts',
  'frontend-deploy',
  stamp,
  'asqac-capsule-care-connect',
);
await mkdir(directory, { recursive: true });
await cp(path.join(root, 'dist'), directory, { recursive: true });
const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
await writeFile(
  path.join(directory, 'vercel.json'),
  JSON.stringify({ rewrites: config.rewrites }, null, 2),
);

async function inspect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) await inspect(filename);
    else if (/^\.env|^code\.txt$|\.(?:ino|sql|h)$/i.test(entry.name))
      throw new Error(`Private/source file must not be published: ${entry.name}`);
  }
}
await inspect(directory);
const report = {
  prepared_at: new Date().toISOString(),
  status: 'prepared; hosting account sign-in required',
  hosting_provider: 'Vercel',
  directory,
  supabase_project_ref: 'chhpbpqoaikbcicxdnzj',
  backend_url_changed: false,
  source_and_device_credentials_uploaded: false,
};
await writeFile(
  path.join(root, 'docs', 'frontend-deployment.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(`Prepared static deployment: ${directory}`);
