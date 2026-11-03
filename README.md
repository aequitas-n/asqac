# ASQAC · Capsule Care Connect

A React 18 clinical operations console for an Adaptive Specimen Quality Assurance Capsule. Includes specimen registration, capsule assignment, live sensor charts and gauges, 3D orientation, episode-based alerts, the receiving doctor's verdict, printable QR labels, and actor-attributed custody reports.

The backend runs entirely on Supabase: Auth, Postgres with RLS, Realtime and Deno Edge Functions. No application server is required. The ESP32 and both simulators use the same device ingestion endpoint.

For the complete delivery inventory, architecture, implementation details, verification evidence and remaining hardware/hosting work, see the [implementation report](docs/IMPLEMENTATION_REPORT.md).

Production frontend: **https://asqac-capsule-care-connect.vercel.app**. Source: **https://github.com/aequitas-n/asqac**. Vercel project `aequitas01/asqac-capsule-care-connect` is connected to this repository; pushes to `main` build and deploy the website using Node 24, `npm ci`, `npm run build` and the `dist` output. Only browser-safe `VITE_` variables are configured in the host. Supabase and the ESP32 telemetry URL stay unchanged. Local environment files, tool caches and build output are excluded from Git; firmware and backend source remain in the repository but are excluded from frontend CLI uploads.

The Git-triggered production build passed. Public routes/assets, technician and doctor sign-in, staff RLS reads and the telemetry origin preflight were verified without a browser or sensor writes. See [production verification](docs/production-deployment-verification.json). Repeat the HTTP/Auth check with `node --env-file=.env scripts/verify-production.mjs`.

This is a university research implementation. Presets are explicitly illustrative, require receiving-laboratory confirmation, and are not universal specimen transport rules. Chamber temperature does not establish specimen core temperature or assay suitability. Only the receiving clinician records the final verdict.

The interface follows `uialone-prompt.txt` and `reference.webp`: a light rounded workspace, opaque white panels, solid medical teal, pill controls, a mobile navigation drawer, and locally bundled Plus Jakarta Sans, Inter, and JetBrains Mono. Gradients, glass effects, backdrop blur, and decorative glows are removed. The overview uses actual rows for its weekly chart, target arrival, staff actions, compliance gauge, and transport timer. Detailed sensor trends and fleet records remain available in the expandable section below it. Search opens with Ctrl/Cmd+K.

## Your Supabase project

This workspace is configured for **`chhpbpqoaikbcicxdnzj`** at `https://chhpbpqoaikbcicxdnzj.supabase.co`. The ignored `.env` contains the exact public keys and URLs you supplied. Administrative keys have no `VITE_` prefix and are only read by trusted local provisioning scripts. The browser client prefers `VITE_SUPABASE_PUBLISHABLE_KEY` and falls back to `VITE_SUPABASE_ANON_KEY`.

**Current remote status (3 November 2026): connected and verified.** All seven migrations are installed, staff RLS policies and Realtime are active, and the `telemetry` function is deployed with JWT verification disabled and device-token authentication enabled. It accepts both legacy single readings and bounded batches, including barometric reference metadata. Both confirmed demo accounts can sign in. CAP0001–CAP0004, seven handling profiles, the demo device and nine historical transports are seeded. Public signup is disabled. Scheduled connection checks and retention are active through `pg_cron`.

Estimated barometric altitude and relative height change are available in capsule detail, trend charts, overview sensor readings and printable transport reports. Both derive from the existing BMP280 pressure sensor. The updated single-file [code.txt](code.txt) establishes a stable startup pressure reference; keep the capsule still while it settles after boot. Old readings show estimated altitude, but no fabricated height change. Weather and capsule sealing affect these estimates. See [barometric metrics and deployed verification](docs/BAROMETRIC_METRICS.md).

Live readings clear to “—” and show Offline after 15 seconds without a fresh observation and receipt. This applies to capsule detail, overview and fleet temperatures, including altitude, height, motion and RSSI. The UI checks every 500 ms and restores values when fresh packets resume. Polling the same stored row or receiving old buffered packets does not revive the live meters. Historical charts and custody reports retain their recorded data. This UI timeout is separate from the backend's two-minute connectivity-alert threshold.

The final rendering pass also prevents delayed workspace snapshots from replacing newer Realtime observations, bounds catch-up history per capsule with one sort, and memoizes the live chart and orientation view. Live charts update without restarting a draw animation. The 3D model starts at the first measured pose and smoothly follows the shortest angle thereafter; the numeric tickers clear offline and start directly at the resumed value. Raw gyro X/Y/Z is visible in °/s. Unprofiled meters say “Measured” and use sensible display scales. All 38 tests and native firmware checks pass. Physical post-flash end-to-end latency remains unmeasured; 500 ms sampling is not a guarantee of 500 ms cloud delivery.

**Tab-resume stability update:** same-user auth events now preserve the loaded workspace and its Realtime subscription. Focus/reconnect refreshes are combined and bounded; quick tab returns reuse recent data. Hidden clocks and fast polling pause, reading bursts merge in 40 ms batches, and returning tabs resume immediately. Page/root recovery boundaries, guarded deployment-asset recovery and a WebGL fallback prevent identified failures from clearing the entire screen. All 55 tests, strict TypeScript and the production build pass. See [root-cause analysis and verification](docs/TAB_RESUME_FIX.md). No firmware reflash or backend change is needed for this frontend update.

Both the backend integration check and the real browser walkthrough passed against this project. The browser simulator sent normal and stress readings; gauges and alerts changed through Realtime without a page reload; the doctor received the specimen and recorded a verdict. The two clearly labelled verification transports are closed and retained for audit, and CAP0001 is available again. Evidence: [backend verification](docs/supabase-verification.json), [browser verification](docs/live/browser-verification.json), [live dashboard](docs/live/dashboard-live.png), and [live capsule detail](docs/live/capsule-live.png).

### One SQL Editor script

Setup is already applied to your project. For a reproducible SQL Editor installation, open the [SQL Editor for this project](https://supabase.com/dashboard/project/chhpbpqoaikbcicxdnzj/sql/new), paste the entire contents of **[`supabase/ASQAC_SETUP.sql`](supabase/ASQAC_SETUP.sql)**, and run it as the project administrator. It creates all application tables, checks, indexes, explicit RLS policies, audited workflow functions, the Realtime publication, seven handling profiles, CAP0001–CAP0004, two confirmed demo accounts, a hashed demo device credential, and nine closed historical transports. A private migration ledger makes repeat runs safe; it does not delete records or change unrelated table privileges. Regenerate the combined file after adding migrations with `npm run sql:bundle`.

The application uses text columns with explicit `CHECK` constraints for its finite role/status/specimen values; no PostgreSQL enum types are required by its schema. Authenticated technicians, doctors and admins have explicit read policies. Writes use role-checked audited RPCs. Direct device-table access is denied to application users so token hashes cannot leak; the simulator reads safe device identifiers through its dedicated RPC.

The SQL script can also seed the accounts independently of the already-completed Auth API step:

| Staff role        | Email                 | Demo password |
| ----------------- | --------------------- | ------------- |
| Technician        | technician@asqac.test | `technician`  |
| Doctor / receiver | doctor@asqac.test     | `doctor`      |

### Exact deployment commands

The CLI is installed locally in this repository. Run:

```sh
npx supabase login --agent no --output-format text
npx supabase link --project-ref chhpbpqoaikbcicxdnzj
npx supabase functions deploy telemetry --no-verify-jwt --use-api --yes
```

With a globally installed CLI, the exact equivalents are:

```sh
supabase link --project-ref chhpbpqoaikbcicxdnzj
supabase functions deploy telemetry --no-verify-jwt
```

Use `--use-api` when Docker is unavailable. `verify_jwt = false` is also declared in `supabase/config.toml`; ingestion authenticates the per-device `x-device-token` instead. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically inside the function. Deployments to a different frontend origin must add that origin to `ALLOWED_ORIGINS`.

For a fresh database, you can apply migrations through CLI v3 with `npx supabase db push --remote=YOUR_PROJECT_REF --yes` instead of the SQL Editor. Choose one initial migration path. After a SQL Editor installation, record the applied versions in the CLI ledger before any future `db push`:

```sh
npx supabase migration repair 202611020001 202611020002 202611020003 202611020004 202611020005 202611030006 202611030007 --status applied --remote=chhpbpqoaikbcicxdnzj --yes
```

That ledger repair is already complete for your project; do not recreate its schema. CLI v3 database commands default to a local target, so specify `--remote` for cloud database operations.

### Demo capsule and simulator

The requested reusable demo credential is intentionally documented here:

```dotenv
SUPABASE_URL=https://chhpbpqoaikbcicxdnzj.supabase.co
TELEMETRY_URL=https://chhpbpqoaikbcicxdnzj.supabase.co/functions/v1/telemetry
DEVICE_UID=CAP0001-ESP32-001
DEVICE_TOKEN=ImAnvVWlySFqmB0JL8AQTs_MuVXLC0uPPKQFtRBMmbE
```

Its SHA-256 hash is seeded in the devices table. The same URL, function endpoint, UID and token are already in the ignored `.env` and `firmware/asqac/secrets.h`; the public demo configuration is also recorded in `supabase/demo-config.json`. The trusted GTS Root R4 certificate is already configured in this workspace's firmware secret file. Set your Wi-Fi SSID and password before compiling and flashing. This is a documented demo token, so use a freshly generated private token for any later non-demo device.

With the current project already provisioned:

```sh
npm run verify:supabase
npm run dev
npm run simulator -- --stress --count 12 --interval 10
```

Register, prepare and start a transport for CAP0001 before simulating to see profile alerts. The login and simulator use the real cloud project; the browser receives readings through Supabase Realtime. `npm run verify:live` repeats the backend cloud check and saves its result to `docs/supabase-verification.json`. `npm run verify:browser` repeats the actual browser walkthrough and saves evidence under `docs/live/`. Each check creates a clearly labelled verification specimen, sends simulated readings, then receives/closes the transport as the demo doctor so the capsule is released. These checks retain their audit records and require CAP0001 to be available; run them outside another demo session.

## Quick start for a fresh checkout

Install **Node 24 LTS**, then:

```sh
npm ci
cp .env.example .env  # Fresh checkout only; do not overwrite your configured .env.
npm run dev
```

PowerShell: use `Copy-Item .env.example .env` instead of `cp` if preferred. Open the URL printed by Vite, normally `http://127.0.0.1:5173`.

When no project URL is configured, the login page's **Explore the interface before connecting** button opens an explicitly labelled, read-only setup preview. It has honest empty states; it does not generate pretend live clinical values.

## 1. Create and configure Supabase

1. Create a **Free** project at [Supabase](https://supabase.com/dashboard).
2. Copy the project URL and browser-safe anon/publishable key from the project's API settings into `.env`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_BROWSER_SAFE_PUBLISHABLE_KEY
VITE_SUPABASE_ANON_KEY=YOUR_BROWSER_SAFE_KEY
VITE_TELEMETRY_URL=https://YOUR_PROJECT.supabase.co/functions/v1/telemetry
```

3. For the local administration scripts only, also set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. These names **must never have a `VITE_` prefix**. Vite publishes prefixed values in the browser bundle.
4. In Auth settings, disable public signups for this staff-only project. Add the frontend URL to the Auth URL configuration. There is no public signup or role-selection UI.

Never commit `.env`, firmware `secrets.h`, or administrative keys. The provided ignore rules cover these files. The only browser-exposed configuration is the project URL, public key and function URL. The intentionally public demo device token above is separate from administrative credentials.

## 2. Apply the migrations

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --remote=YOUR_PROJECT_REF --yes
```

Alternatively, paste and execute the **entire contents** of these files in the Supabase SQL editor, in this exact order:

1. `supabase/migrations/202611020001_schema.sql`
2. `supabase/migrations/202611020002_workflows.sql`
3. `supabase/migrations/202611020003_seed.sql`
4. `supabase/migrations/202611020004_realtime.sql`
5. `supabase/migrations/202611020005_demo_connection.sql`
6. `supabase/migrations/202611030006_batch_ingestion.sql`
7. `supabase/migrations/202611030007_barometric_height.sql`

Apply each migration once. The seed creates seven handling presets, CAP0001–CAP0004 and nine clearly identified, **closed synthetic historical transports**. Migration 005 adds the requested confirmed demo accounts and hashed CAP0001 device token. No fake live transport is seeded. Reports use actual database rows.

The Realtime migration creates the `supabase_realtime` publication if needed and adds readings, capsules, transports, specimens, alerts and audit events. Check Dashboard → Database → Publications if your project has disabled Realtime.

## 3. Provision staff accounts

The requested demo passwords are already in the ignored `.env`. For another research deployment, set your own values:

```dotenv
DEMO_TECHNICIAN_PASSWORD=YOUR_TECHNICIAN_PASSWORD
DEMO_DOCTOR_PASSWORD=YOUR_DOCTOR_PASSWORD
```

Run locally:

```sh
npm run create-users
```

This creates or updates `technician@asqac.test` and `doctor@asqac.test`, confirms their emails, and assigns their staff roles with the server-only admin key. Re-running resets these two demo accounts to the configured demo passwords. If tables are not installed yet, Auth accounts are provisioned first and the combined SQL completes their profiles. Administrative keys are never shown in the interface or printed by this script.

Manual alternative: add users in Supabase Auth, then set the role in SQL:

```sql
update public.profiles set role='doctor',full_name='Demo Receiver'
where email='doctor@asqac.test';
```

New Auth users get a technician profile through a trigger. Clients cannot promote themselves or modify profile roles. An optional `admin` role can perform both technician and doctor workflow actions; capsule/profile/user administration is intentionally provided through trusted SQL and scripts rather than a second administration UI.

## 4. Deploy the Edge Functions

```sh
supabase functions deploy telemetry --no-verify-jwt
supabase functions deploy maintenance
supabase secrets set ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173,https://YOUR_FRONTEND_HOST
```

The project URL and service-role key are built-in Supabase Edge secrets. Never send the service-role key to the ESP32. `verify_jwt=false` is intentional: the device authenticates using its own `x-device-token` secret, whose SHA-256 hash is checked inside a service-only database function. CORS allows the configured browser origins; a device or terminal request without an Origin header is also supported.

Function authentication configuration is included in `supabase/config.toml`, with an isolated `deno.json` dependency configuration in each function directory. Both functions handle their own authentication. The optional maintenance endpoint requires a separate `MAINTENANCE_TOKEN`; it never accepts a device token as an administrator credential.

## 5. Register a device and generate its token

With local `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured:

```sh
npm run device-token -- --capsule CAP0001 --uid CAP0001-ESP32-001
```

CAP0001's demo device is already registered, so this step is only needed for another device or a deliberate token rotation. The script prints the generated per-device secret **once**, stores only its SHA-256 hash in `devices`, and links it to the selected capsule. Save the token into firmware `secrets.h` and the terminal simulator's `DEVICE_TOKEN` environment variable. Re-running with the same UID rotates the secret and immediately invalidates the old one, including the documented demo token. A capsule can have only one active device; deactivate the old device in trusted SQL before assigning a different UID.

The browser simulator accepts the secret in a password field and keeps it in memory for the current session. There is deliberately no `VITE_DEMO_DEVICE_TOKEN`: such a variable would publish a reusable device credential in the frontend bundle.

## 6. Run the full demo

1. Restart Vite after changing `.env`, then sign in as the technician.
2. Register an anonymised reference, requested test, specimen type, corresponding preset, ward and lab. Select a free capsule or scan its printed QR label. Required fields have explicit validation messages; submit is only disabled while saving.
3. Print the generated specimen label. Open capsule detail and use the primary button **beside the capsule title**: choose **Prepare transport** after loading the specimen, then **Start transport** when departing. The journey changes from Registered → Prepared → In transit. The status badge now reflects that journey state; registration alone does not start it. Before departure, coloured limits are a profile preview; handling alerts and the transport timer begin after Start.
4. Open **Simulator** in the status strip, select the registered device, paste its token and start it. Packets are sent every ten seconds to the real ingestion function and carry `simulated=true`.
5. Enable **Stress scenario**. Approximately every sixth packet, one of temperature, shock, tilt or light exceeds the preset. Watch the gauges, chart, excursion history and open-alert count change. Stop the simulator after presenting.
6. Acknowledge an alert. It remains retained, with actor and acknowledgement time.
7. Sign out, sign in as the doctor, open the capsule and use **Receive & end transport** beside its title. Review the handling record, then use **Review & record verdict** in the same header. Review Required and Reject require notes. Closing releases the capsule.
8. Open Reports, filter/search, export the custody CSV, or print a transport report. QR labels and reports have dedicated print styles.

The receiving doctor always chooses the final disposition. The suggestion is conservative: any critical episode → Reject; warnings, missing coverage, gaps or simulated telemetry → Review Required; otherwise → Accept. Acknowledging an excursion never erases it from that assessment.

New live alerts also appear as on-screen notifications with the capsule code. Refresh snapshots cannot drop a newer alert or undo its acknowledgement, recovery or critical escalation. The sidebar uses a compact simulator control and height-aware spacing to keep navigation in one view without an inner scrollbar. The requested research-prototype footer text has been removed. The isolated [hosted workflow check](docs/alert-workflow-verification.json) verified Registered → Prepared → In transit, critical temperature/light alerts through Realtime, acknowledgement and doctor closure on simulated CAP0004. CAP0001 was not modified. Repeat with `node --env-file=.env scripts/verify-alert-workflow.mjs` only while CAP0004 is idle; the labelled verification journey and alerts remain in audit history.

### Terminal simulator

```dotenv
TELEMETRY_URL=https://YOUR_PROJECT.supabase.co/functions/v1/telemetry
DEVICE_UID=CAP0001-ESP32-001
DEVICE_TOKEN=YOUR_PER_DEVICE_SECRET
```

```sh
npm run simulator -- --count 60
npm run simulator -- --stress --count 60 --interval 10
```

For an ambient preset, pass `--temp-min 18 --temp-max 25`. The browser simulator reads the active profile automatically; the terminal version takes explicit temperature arguments. All generated packets are marked simulated. An assigned **in-transit** journey is required for threshold alerts; unassigned packets are stored without an invented transport.

## 7. Detect silent capsules and retain data

Automatic lost-connection detection must run even when no browser is open. Your project already has the active `asqac-health` and `asqac-retention` jobs. For a fresh project where `pg_cron` is available, execute `supabase/optional/cron.sql`; it installs the extension and creates missing jobs. It checks health every minute and prunes raw readings hourly. A capsule silent for more than two minutes receives one connectivity excursion episode. Actual notification time is between two and three minutes with the one-minute schedule.

If pg_cron is unavailable, generate a separate random `MAINTENANCE_TOKEN`, configure it using `supabase secrets set`, and schedule an authenticated POST to `/functions/v1/maintenance` every minute from a private scheduler. Use the header `x-maintenance-token`; do not place this secret in frontend configuration. The endpoint performs health checks each call and retention during UTC minute 17. The dashboard's Signal risk count is advisory and does not replace the server schedule.

Raw readings from unassigned capsules and closed journeys are pruned after a 48-hour window. Open-journey readings are preserved. Transport summary extrema/counts, simulated provenance, alerts and audit records persist. Pruning nulls alert reading references but preserves the original excursion message and threshold evidence. The retained report is a summary and event record, not an indefinitely retained raw time series. Archive raw data separately if a future validated SOP requires it.

### Free-tier budget

At ten-second intervals, one continuously powered capsule produces 8,640 function calls/day. Four capsules running 24/7 would exceed the typical Free function invocation allocation. **Do not treat a Free project as an unlimited production fleet.** This project targets university demonstrations and bounded research sessions: four capsules active for two hours/day produce about 86,400 ingestion calls/month, plus scheduler calls. Stop simulators and power down research devices outside sessions. Health checks run inside Postgres when pg_cron is used.

48-hour raw retention, per-device rate limiting, 180-point chart windows, one Realtime subscription per session and direct in-memory event updates limit load. Global list views cap recent specimens/transports at 500, alerts at 1,000, and audit history at 500; the UI states these limits. Reports fetch all transports in the selected seven- or thirty-day registration cohort and paginate the complete CSV export for that period. Realtime fan-out and bandwidth also depend on how many dashboards are open. Review current [Supabase quotas](https://supabase.com/pricing) and [Realtime limits](https://supabase.com/docs/guides/realtime/limits) before extended runs.

## 8. Flash the capsule firmware

### Your working circuit: ESP32 Dev Module

**For your working circuit:** paste root [`code.txt`](code.txt) into one Arduino sketch, or open its identical [`asqac-esp32.ino`](firmware/asqac-esp32/asqac-esp32.ino) copy. Select **ESP32 Dev Module**. This final single-file version preserves MPU6050 SDA33/SCL32, BH1750 SDA18/SCL19, BMP280 SDA27/SCL14 and the raw sensor drivers. It has no HTML/server or custom headers; Wi-Fi (`abcd` / `12345678`), the real backend endpoint, demo device token and trusted TLS certificate are included directly. Change only the two Wi-Fi constants for another network. See the [circuit guide](firmware/asqac-esp32/README.md). The original C3 firmware below remains a separate option for the original GPIO9/8 circuit.

**Final latency update:** this circuit variant captures every 500 ms, sends up to 16 queued readings per request at approximately one request/second, reuses verified HTTPS where supported, and logs backlog/newest-sample age. Its deployed batch API corrects the application 429/catch-up problem while retaining the legacy single-packet API. Re-upload `code.txt` to enable it. See the [root cause and fix](docs/LATENCY_FIX.md) and [hosted batch verification](docs/batch-cloud-verification.json). The original C3 variant and simulators retain their documented intervals. One device used two hours/day produces about 216,000 invocations per 30-day month at the new rate; four at those hours exceed the Free function allowance. Budget sessions and project resources accordingly.

### Original single-bus circuit: ESP32-C3 Super Mini

Arduino source: `firmware/asqac/asqac.ino`. Use Arduino IDE with the Espressif ESP32 Arduino core 3.x and the **ESP32C3 Dev Module** board (set USB CDC On Boot as appropriate for your Super Mini).

Install these Arduino libraries using Library Manager:

- Adafruit MPU6050
- Adafruit BMP280 Library
- Adafruit Unified Sensor
- Adafruit BusIO
- BH1750 by Christopher Laws
- ArduinoJson 7

Wire all modules to 3.3 V logic and common ground. SDA = GPIO9, SCL = GPIO8, with 4.7 kΩ pull-ups to 3.3 V. Confirm your board's boot/strapping requirements before connecting peripherals; GPIO9 is also a boot strap on the C3. Confirm the HW-611 board actually contains BMP280 rather than a different chip.

In this configured workspace, `secrets.h` already contains your project endpoint, demo device token and the trusted GTS Root R4 certificate; set the Wi-Fi SSID/password. In a fresh checkout, copy `secrets.example.h` to `secrets.h` beside the sketch and configure these fields. Use the **trusted root CA PEM for the actual certificate chain served by your function hostname** in `TLS_ROOT_CA`. `node --env-file=.env scripts/configure-device-ca.mjs` can update that root after verifying the endpoint's chain against Node's trust store. Firmware never disables TLS validation. Hospital captive portals and WPA-Enterprise are not supported by this simple Wi-Fi client; use an authorised WPA2/WPA3 personal research network or adapt the network provisioner.

The sketch detects BMP280 at 0x76/0x77 and BH1750 at 0x23/0x5C, samples the MPU6050 at roughly 50 Hz, calculates accelerometer-based pitch/roll, and sends a ten-second packet with the peak total acceleration magnitude (including gravity). Light is sampled about every 200 ms and its peak is retained for each packet to capture short exposure events. HTTPS runs in a separate FreeRTOS task so network waits do not suspend shock sampling. Impact capture is still limited by sensor/sample bandwidth; pitch/roll from accelerometry become unreliable under strong dynamic acceleration.

NTP synchronises UTC before packets are created. The bounded RAM queue holds 90 readings (about 15 minutes); replay uses original observation timestamps and a 2.5-second drain interval. The oldest row is dropped on overflow and noted on Serial. The queue does not survive power loss. Invalid sensor readings are skipped rather than replaced with made-up numbers; if a sensor fails at startup, repair it and reboot. Open Serial at 115200 baud to diagnose startup, buffer overflow or HTTPS failures. Physical sensor calibration, wiring, TLS chain and on-device compilation/flash still require verification on your hardware.

## 9. Deploy the frontend

```sh
npm run build
```

Deploy `dist/` to Vercel, Netlify or Cloudflare Pages. Set only the three browser-safe `VITE_` variables in the host's build environment. Use build command `npm run build` and output directory `dist`. `vercel.json` and `public/_redirects` provide client-route fallbacks. Add the deployed origin to Supabase Auth configuration and the Edge `ALLOWED_ORIGINS` secret. Rebuild after changing Vite variables.

This project is connected to Vercel through GitHub. Commit and push changes to `main` for automatic production builds. The hosted build uses the public Vite variables configured in Vercel; it does not receive your local `.env` or server administration keys. `scripts/configure-vercel-env.mjs` updates only the explicit browser-safe variable allowlist from your ignored `.env`. Supabase project configuration remains in that ignored file; current provisioning and verification status is described at the top of this README and in `docs/supabase-verification.json`.

## Architecture and security model

```text
MPU6050 + BH1750 + BMP280
        │ I²C (GPIO9 / GPIO8)
     ESP32-C3 ── HTTPS + per-device token ──► telemetry Edge Function
                                               │ SHA-256 + strict validation
                                               ▼
                                   service-only ingest_reading RPC
                                               │ atomic transaction
                Auth ◄──── React ◄── Realtime ──┤ Postgres + RLS
                             │                 ├ readings / handling episodes
                             └── staff RPCs ──►├ transports / profile snapshot
                                               └ append-only staff audit trail
```

- All clinical tables use RLS. Unauthenticated reads are denied. Staff read the single-hospital workspace. This is not a multi-tenant deployment.
- Clients have no direct write grants on clinical records, profile roles, devices or audit history. Audited security-definer functions use an empty search path and validate the caller's database-backed role.
- Registration locks and reserves the capsule in one transaction. Partial uniqueness prevents two open journeys per capsule. Profile limits are snapshotted into each transport.
- Lifecycle: Registered → Prepared → In transit → Arrived → Closed. Technicians prepare/start; doctors receive and close with a verdict.
- Telemetry uses per-device authentication, bounded payloads, validated numeric ranges, original UTC observation timestamps, uniqueness for retries and serialized per-device rate limits. No device receives Supabase administrative credentials.
- Offline readings are associated using observation-time transport boundaries. Readings for a closed, already reviewed transport are rejected for manual investigation rather than silently changing the reviewed history.
- Alerts are episodes: a repeated breach stays one episode; recovery closes it; a new breach creates a new episode. Acknowledgement and recovery are separate facts.
- The audit table is append-only to application users, not cryptographically tamper-proof against the database owner. Use independent archival/signing if a future audit standard requires that property.
- The UI shows only actual rows returned from Supabase. No humidity/battery tiles, location coordinates or motor/damper telemetry are fabricated.

Folder structure:

```text
src/
  pages/                  Login, dashboard, fleet, detail, register, alerts, reports, hardware
  components/layout/      Navigation rail and status strip
  components/widgets/     Charts, gauges and lazy-loaded 3D orientation
  hooks/                  Auth, Realtime workspace and clock
  lib/                    Supabase, formatting, quality recommendations and queries
  types/                  Strict TypeScript domain row types
supabase/migrations/      Schema, RLS, audited RPCs, seed, Realtime
supabase/functions/       Ingestion and scheduler fallback
supabase/optional/        Optional pg_cron schedule
firmware/asqac/           ESP32-C3 Arduino sketch and secrets template
scripts/                 Account provisioning, device token rotation, terminal simulator
tests/                   PostgreSQL, payload, quality and browser checks
```

## Verification

Real cloud verification passed on 2 November 2026: [backend check](docs/supabase-verification.json) and [browser walkthrough](docs/live/browser-verification.json). The walkthrough uses the deployed telemetry function, hosted Auth, database RLS and actual Realtime subscriptions with no mocked requests. Its [dashboard](docs/live/dashboard-live.png) and [capsule detail](docs/live/capsule-live.png) screenshots show explicitly simulated sensor data sent to the real backend.

Saved interface previews: [dashboard](docs/screenshots/dashboard.png), [capsule console](docs/screenshots/capsule-console.png), [doctor verdict](docs/screenshots/doctor-verdict.png), [mobile view](docs/screenshots/mobile-overview.png), and [sample printable report](docs/screenshots/transport-report.pdf). These use an isolated synthetic PostgreSQL test dataset with a mocked Supabase HTTP gateway; they do not imply a deployed project or verified cloud Realtime connection.

```sh
npm test
npm run check:edge
npm run build
npm run check:client-secrets
npm run test:browser
npm audit
```

To repeat the cloud checks outside an active demo session:

```sh
npm run verify:supabase
npm run verify:live
npm run verify:browser
```

Database tests run the actual migrations and PL/pgSQL against PGlite, an embedded PostgreSQL runtime. They exercise RLS, role permissions, atomic reservation, lifecycle checks, credential validation, duplicate/rate-limited packets, excursion deduplication/recovery, acknowledgement, late-data rejection and retention. The combined SQL tests also check repeat installation, demo-account confirmation/passwords, device hashing and policies without changing unrelated table privileges. The separate cloud checks verify hosted Auth, Realtime and the deployed ingestion function. ESP32 compilation, physical sensors and on-device delivery still require your hardware.

Browser checks use an installed Chrome/Edge where available (or a Playwright Chromium installation). They validate local setup preview flows and registration validation. When connected test fixtures are used, they are isolated to the test runner; they do not populate application components or a real cloud project.

Clinical reference links: [WHO transport guidance](https://www.who.int/publications/i/item/9789240089525), [CLSI PRE04](https://clsi.org/shop/standards/pre04/), [Oxford specimen transport protocol](https://www.ouh.nhs.uk/media/a0gmzj5t/directorate-protocol.pdf). These inform SOP design; they do not endorse this prototype's numerical thresholds or certify it for patient care.
