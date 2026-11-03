import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5199', '--strictPort'],
  {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'asqac-local-test-public-key',
      VITE_SUPABASE_ANON_KEY: 'asqac-local-test-public-key',
      VITE_TELEMETRY_URL: 'http://127.0.0.1:54321/functions/v1/telemetry',
    },
  },
);
const preview = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5299', '--strictPort'],
  {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_TELEMETRY_URL: '',
    },
  },
);
let logs = '';
server.stdout.on('data', (chunk) => {
  logs = (logs + chunk).slice(-20000);
});
server.stderr.on('data', (chunk) => {
  logs = (logs + chunk).slice(-20000);
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      const response = await fetch('http://127.0.0.1:5199/', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the owned Vite process. */
    }
    await pause(250);
  }
  if (!ready) throw new Error(`Browser test server did not start. ${logs}`);
  let previewReady = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (preview.exitCode !== null) throw new Error('Setup preview test server stopped');
    try {
      const response = await fetch('http://127.0.0.1:5299/', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        previewReady = true;
        break;
      }
    } catch {}
    await pause(250);
  }
  if (!previewReady) throw new Error('Setup preview server did not start');
  const runner = spawn(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
    { cwd: process.cwd(), windowsHide: true, stdio: 'inherit', env: process.env },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    runner.on('exit', (code) => resolve(code ?? 1));
    runner.on('error', reject);
  });
} finally {
  server.kill();
  preview.kill();
}
