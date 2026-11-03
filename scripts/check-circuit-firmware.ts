import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  readingSchema,
  telemetrySchema,
  validateTimestamp,
} from '../supabase/functions/_shared/protocol.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = new URL('../artifacts/firmware-build/', import.meta.url);
await mkdir(build, { recursive: true });
const sketch = await readFile(
  new URL('../firmware/asqac-esp32/asqac-esp32.ino', import.meta.url),
  'utf8',
);
assert.equal(
  await readFile(new URL('../code.txt', import.meta.url), 'utf8'),
  sketch,
  'code.txt must match the flashable single-file sketch',
);
assert.ok(
  !/<html|<script|WebServer|#include\s*"/i.test(sketch),
  'Final sketch must have no HTML, local server or custom includes',
);
const inlineLogic = sketch.match(
  /\/\/ ASQAC_TELEMETRY_BEGIN\n([\s\S]*?)\/\/ ASQAC_TELEMETRY_END/,
)?.[1];
assert.ok(inlineLogic, 'Self-contained telemetry encoder must be present');
await writeFile(new URL('telemetry-inline.h', build), inlineLogic);
const binary = fileURLToPath(
  new URL(process.platform === 'win32' ? 'telemetry-check.exe' : 'telemetry-check', build),
);
execFileSync(
  process.env.CXX || 'g++',
  [
    '-std=c++11',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-I',
    fileURLToPath(build),
    'tests/firmware/telemetry.cpp',
    '-o',
    binary,
  ],
  { cwd: root, timeout: 60000, stdio: 'pipe' },
);
const stdout = execFileSync(binary, [], { cwd: root, timeout: 10000, encoding: 'utf8' });
const lines = stdout.trim().split(/\r?\n/);
const packets = lines.slice(0, 2).map((line) => readingSchema.parse(JSON.parse(line)));
const batch = telemetrySchema.parse(JSON.parse(lines[2]));
assert.ok('readings' in batch);
assert.equal(batch.readings.length, 13);
assert.equal(new Set(batch.readings.map((r) => r.recorded_at)).size, 13);
assert.equal(packets.length, 2);
assert.equal(packets[0].az, 1);
assert.equal(packets[0].simulated, false);
assert.equal(packets[1].shock_g, 4);
assert.equal(packets[1].lux, 250);
assert.equal(packets[1].pitch_deg, 60);
for (const packet of packets) assert.ok(validateTimestamp(packet.recorded_at));
const report = {
  checked_at: new Date().toISOString(),
  result: 'pass',
  scope:
    'Native C++ telemetry logic and exact Supabase payload contract; no hardware or cloud writes',
  checks: [
    'm/s² to g conversion, finite ranges, and angle normalization',
    'impact/light peak hold, zero-valued measurements, and invalid-window handling',
    'invalid identifiers, numeric values, RSSI, and buffer truncation rejected',
    'bounded offline FIFO and safe acknowledgement after in-flight overflow',
    '500 ms sampling, 1-second batch-start cadence and error backoff',
    '13 queued samples drain in one batch; millisecond timestamps remain unique',
    'actual firmware encoder output accepted by deployed-function Zod schema',
    'code.txt matches the flashable Arduino sketch',
    'single-file source has no HTML, local web server, or custom header dependencies',
    'barometric formula, stable 16-sample startup reference and serialized reference metadata',
  ],
  physical_hardware_tested: false,
};
await writeFile(
  new URL('../docs/circuit-firmware-verification.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  'PASS native firmware checks, peak/queue behavior, and Supabase payload contract. No readings sent to the cloud.',
);
