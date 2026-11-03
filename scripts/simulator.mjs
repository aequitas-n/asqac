import { setTimeout as pause } from 'node:timers/promises';
import { uploadTelemetryBatch } from '../src/lib/telemetryUpload.ts';
const endpoint = process.env.TELEMETRY_URL || process.env.VITE_TELEMETRY_URL;
const token = process.env.DEVICE_TOKEN;
const uid = process.env.DEVICE_UID;
if (!endpoint || !token || !uid)
  throw new Error('Set TELEMETRY_URL, DEVICE_UID and DEVICE_TOKEN in .env.');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : Number(args[index + 1]);
};
const interval = flag('--interval', 10);
const count = flag('--count', Infinity);
const min = flag('--temp-min', 2);
const max = flag('--temp-max', 8);
const stress = args.includes('--stress');
if (!Number.isFinite(interval) || interval < 5 || max <= min || count <= 0)
  throw new Error('Interval must be >=5 s, count positive, and temperature min < max.');
let stopped = false;
const controller = new AbortController();
process.on('SIGINT', () => {
  stopped = true;
  controller.abort();
});
console.log(
  `SIMULATED telemetry · ${uid} · ${interval}s interval · ${stress ? 'stress' : 'normal'} scenario. Ctrl+C to stop.`,
);
const heightReferenceAt = new Date().toISOString();
for (let n = 0; n < count && !stopped; n++) {
  const breach = stress && n % 6 === 4;
  const kind = Math.floor(n / 6) % 4;
  const payload = {
    device_uid: uid,
    recorded_at: new Date().toISOString(),
    temp_c:
      breach && kind === 0
        ? max + 4
        : (min + max) / 2 + Math.sin(n / 5) * Math.min(0.5, (max - min) / 5),
    pressure_hpa: 1012 + Math.sin(n / 7) * 2,
    sea_level_pressure_hpa: 1013.25,
    reference_pressure_hpa: 1012,
    height_reference_at: heightReferenceAt,
    lux: breach && kind === 3 ? 400 : 2 + Math.random() * 3,
    ax: 0.02,
    ay: 0.03,
    az: 1,
    gx: 0,
    gy: 0,
    gz: 0,
    pitch_deg: breach && kind === 2 ? 75 : Math.sin(n / 5) * 4,
    roll_deg: Math.cos(n / 5) * 3,
    shock_g: breach && kind === 1 ? 4.5 : 1 + Math.random() * 0.08,
    rssi: -50 - Math.floor(Math.random() * 10),
    simulated: true,
  };
  try {
    const result = await uploadTelemetryBatch({
      endpoint,
      token,
      readings: [payload],
      signal: controller.signal,
      onRetry: (ms) =>
        console.log(`Device busy; retrying the same packet in ${(ms / 1000).toFixed(1)} s`),
    });
    const row = result.results[0];
    console.log(
      `${payload.recorded_at} · ${payload.temp_c.toFixed(2)} °C · shock ${payload.shock_g.toFixed(2)} g · reading ${row.reading_id} · ${row.transport_id ? 'assigned transport' : 'unassigned'}${breach ? ' · STRESS' : ''}`,
    );
  } catch (e) {
    if (!stopped) console.error(`Delivery failed: ${e.message}`);
    if ([400, 401, 403, 409].includes(e.status)) {
      process.exitCode = 1;
      break;
    }
  }
  if (n + 1 < count && !stopped) await pause(interval * 1000);
}
