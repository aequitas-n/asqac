import { spawnSync } from 'node:child_process';
const names = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_TELEMETRY_URL',
];
for (const name of names) {
  const value = process.env[name]?.trim();
  if (!value && name === 'VITE_SUPABASE_PUBLISHABLE_KEY') continue;
  if (!value) throw new Error(`Missing browser-safe variable ${name}`);
  // Only the explicit public allowlist can reach the frontend hosting account.
  // Values travel over stdin rather than shell interpolation or log output.
  const args = ['--yes', 'vercel@latest', 'env', 'add', name,
    '--environment', 'production,preview', '--force', '--yes', '--no-sensitive',
    '--project', 'asqac-capsule-care-connect', '--scope', 'aequitas01'];
  const child = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], { input: value, encoding: 'utf8' })
    : spawnSync('npx', args, { input: value, encoding: 'utf8' });
  if (child.status !== 0) {
    throw new Error(`Unable to configure ${name}: ${child.error?.message ?? child.stderr}`);
  }
  console.log(`Configured ${name} for production and preview.`);
}
