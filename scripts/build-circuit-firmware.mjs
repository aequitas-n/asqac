import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = new URL('../artifacts/firmware-build/', import.meta.url);
await mkdir(folder, { recursive: true });
const localCli = fileURLToPath(
  new URL(process.platform === 'win32' ? 'cli/arduino-cli.exe' : 'cli/arduino-cli', folder),
);
let cli = process.env.ARDUINO_CLI || 'arduino-cli';
const configArgs = [];
if (!process.env.ARDUINO_CLI) {
  try {
    await access(localCli);
    cli = localCli;
    configArgs.push('--config-file', fileURLToPath(new URL('arduino-cli.yaml', folder)));
  } catch {
    /* Use a globally installed Arduino CLI. */
  }
}
const source = await readFile(
  new URL('../firmware/asqac-esp32/asqac-esp32.ino', import.meta.url),
  'utf8',
);
if (source !== (await readFile(new URL('../code.txt', import.meta.url), 'utf8')))
  throw new Error(
    'code.txt differs from the flashable circuit sketch; align both copies before building.',
  );
const options = {
  cwd: root,
  timeout: 600000,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
  windowsHide: true,
};
try {
  const output = execFileSync(
    cli,
    [
      'compile',
      '--jobs',
      '4',
      '--fqbn',
      'esp32:esp32:esp32',
      '--build-path',
      fileURLToPath(new URL('esp32-output/', folder)),
      '--build-property',
      'compiler.cpp.extra_flags=-Werror=return-type',
      ...configArgs,
      'firmware/asqac-esp32',
    ],
    options,
  );
  await writeFile(new URL('compile.log', folder), output);
  const cliVersion = execFileSync(cli, ['version', '--format', 'json', ...configArgs], options);
  const cores = execFileSync(cli, ['core', 'list', '--format', 'json', ...configArgs], options);
  const report = {
    checked_at: new Date().toISOString(),
    result: 'pass',
    target: 'esp32:esp32:esp32',
    board: 'ESP32 Dev Module',
    cli: JSON.parse(cliVersion),
    installed_cores: JSON.parse(cores).platforms.map((core) => ({
      id: core.id,
      version: core.installed_version,
    })),
    source_sha256: createHash('sha256').update(source).digest('hex'),
    self_contained: true,
    build_summary: output
      .split(/\r?\n/)
      .filter((line) => /Sketch uses|Global variables use/.test(line)),
    physical_hardware_tested: false,
  };
  await writeFile(
    new URL('../docs/circuit-firmware-build.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log('PASS complete circuit firmware compiled for ESP32 Dev Module.');
  for (const line of report.build_summary) console.log(line);
} catch (error) {
  const output = `${error.stdout || ''}\n${error.stderr || ''}`;
  await writeFile(new URL('compile.log', folder), output);
  console.error(output.slice(-7000));
  throw new Error(
    'Firmware build failed; details in artifacts/firmware-build/compile.log. Install the official esp32:esp32 core or set ARDUINO_CLI if needed.',
  );
}
