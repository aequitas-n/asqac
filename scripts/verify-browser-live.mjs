import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
  { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
);
let logs = '';
for (const output of [server.stdout, server.stderr])
  output.on('data', (chunk) => {
    logs = (logs + chunk).slice(-12000);
  });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      const response = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause(250);
  }
  if (!ready) throw new Error('Live preview did not start.');
  const runner = spawn(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.live.config.ts'],
    { cwd: process.cwd(), windowsHide: true, stdio: 'inherit', env: process.env },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    runner.on('exit', (code) => resolve(code ?? 1));
    runner.on('error', reject);
  });
} finally {
  server.kill();
}
