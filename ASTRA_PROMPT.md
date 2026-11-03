# ASTRA PROMPT — ASQAC Capsule Care Connect (rebuild)

Copy everything below this line into Astra as a single generation prompt.

---

Build a production-quality **React + Vite + TypeScript + Tailwind CSS** web app called **ASQAC Capsule Care Connect** — an interactive clinical IIoT dashboard for an Adaptive Specimen Quality Assurance Capsule that monitors medical specimen transport in real time.

## Stack (required)

- React 18+, Vite, TypeScript (strict)
- Tailwind CSS + small set of CSS variables for the design tokens
- `@supabase/supabase-js` for Auth, DB, Realtime
- `framer-motion` for purposeful motion (respect `prefers-reduced-motion`)
- `recharts` for charts
- `react-router-dom` for routes
- `html5-qrcode` for QR scan; `qrcode.react` (or similar) for QR label generation
- Optional: `@react-three/fiber` + `@react-three/drei` for a 3D capsule orientation widget driven by `pitch_deg` / `roll_deg`
- lucide-react for icons (no emoji icons)
- date-fns for time

Env vars:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_TELEMETRY_URL=          # .../functions/v1/telemetry
VITE_DEMO_DEVICE_UID=CAP0001-ESP32-001
VITE_DEMO_DEVICE_TOKEN=      # plaintext device token for Simulator mode only
```

Create `src/lib/supabase.ts` exporting a singleton client.

## Product context

This replaces a weak demo at a Cloudflare Workers URL. Pages to match (and improve): `/login`, `/dashboard`, `/capsules` (+ detail), `/register`, `/alerts`, `/reports`. Roles from project docs:

- **technician** — register specimen, assign capsule, prepare, **start transport**
- **doctor** (receiver) — **end transport**, review chain-of-custody, set final **verdict**: `accept` | `review_required` | `reject`
- **admin** — same as both (optional)

Hardware truth (do NOT invent sensors):

| Sensor | Metrics |
|--------|---------|
| MPU6050 | ax, ay, az (g), pitch_deg, roll_deg, shock_g |
| BH1750 | lux (spike ≈ lid open / light exposure) |
| HW-611 = BMP280 | temp_c, pressure_hpa |

**Never show humidity or battery as live data.** No fake 40% humidity / 92% battery tiles.

## Visual language — clinical precision (NOT a default admin template)

Go **custom bento / asymmetric layouts**. No generic sidebar-dashboard clone. Think premium medical device console + cold-chain ops centre.

### Tokens

- Background: deep navy / ink `#070B14` → `#0D1526`
- Surfaces: translucent slate cards `rgba(255,255,255,0.04)` with 1px hairline borders `rgba(148,163,184,0.12)`
- Primary accent: medical cyan / teal `#2EC5C0` (cold-chain)
- Secondary: ice blue `#7DD3FC`
- Warning amber `#F5A524`, critical `#F04343`, success `#34D399`, info `#60A5FA`
- Text: primary `#E8EEF8`, muted `#8B9BB8`
- Typography: **display** = `"Instrument Sans"` or `"Sora"`; **body** = `"IBM Plex Sans"`; **mono / IDs** = `"IBM Plex Mono"` or `"JetBrains Mono"`
- Radius: 16–24px on large cards; 999px on chips
- Glow: soft cyan outer glow only on *live* widgets (`box-shadow: 0 0 40px rgba(46,197,192,0.12)`)

### Layout principles

- Login: **split hero** (left cinematic brand panel, right auth card) — headline related to custody: e.g. “Chain-of-custody you can hand to an auditor.”
- App shell: slim left rail with brand mark + nav (icons + labels), top status strip (“LIVE TELEMETRY”, clock Asia/Kolkata optional, role badge, Simulator toggle, sign out)
- Dashboard: **bento grid** — uneven spans (KPI strip 4 tiles, large temp band chart spanning 2 cols, alert feed, fleet table, recent specimens)
- Capsule detail: immersive — left journey timeline, centre live gauges + 3D/tilt, right alert history + ingestion health
- Dense but breathable; never huge empty voids like the old site

### Motion (domain-fitting ONLY — no gimmicks)

Allowed / required:

1. **Number tickers** — live readings animate digits (spring) when values update
2. **Decode / typewriter** for specimen codes & transport IDs (mono, short, once)
3. **Staggered headline reveal** on login hero (words fade/slide up 40ms apart)
4. **ECG-like pulse** on a thin live telemetry polyline (opacity breath while stream is healthy)
5. **Smooth status chip morph** when capsule state changes (colour + label crossfade)
6. **Staggered card mount** on page enter (8–12% y, opacity) — once
7. Chart line draw-on first load

Forbidden: bouncing logos, confetti, random parallax, glitch spam, endless spinning orbs, cursor trails, anything that feels like a marketing landing page gimmick.

Always wrap motion in `useReducedMotion()` / CSS `@media (prefers-reduced-motion: reduce)` — disable non-essential animation.

## Supabase schema (wire EXACTLY to these names)

Tables / key columns:

- `profiles` — id, email, full_name, role (`technician`|`doctor`|`admin`)
- `handling_profiles` — id, code, name, specimen_type, temp_min_c, temp_max_c, max_transport_min, max_shock_g, max_tilt_deg, max_lux, pressure_min_hpa, pressure_max_hpa, freezing_risk, lab_confirmation_req, notes, source_refs (text[])
- `capsules` — id, code, label, status (`idle`|`prepared`|`in_transit`|`arrived`|`alert`|`charging`|`maintenance`), firmware_ver, last_seen_at
- `devices` — id, capsule_id, device_uid, token_hash, active  (UI rarely needs this)
- `specimens` — id, specimen_code, patient_ref, requested_test, specimen_type (`BLOOD`|`URINE`|`PLASMA`|`TISSUE`|`SWAB`|`VACCINE`), priority (`routine`|`urgent`|`critical`), handling_profile_id, origin, destination_lab, clinical_notice, registered_by
- `transports` — id, transport_code, capsule_id, specimen_id, handling_profile_id, state (`registered`|`prepared`|`in_transit`|`arrived`|`closed`), started_at, arrived_at, closed_at, started_by, received_by, verdict (`pending`|`accept`|`review_required`|`reject`), verdict_notes, verdict_at, excursion_count
- `readings` — id, capsule_id, transport_id, device_uid, recorded_at, temp_c, pressure_hpa, lux, ax, ay, az, pitch_deg, roll_deg, shock_g, rssi
- `alerts` — id, capsule_id, transport_id, severity (`critical`|`warning`|`info`), alert_type (`temperature`|`shock`|`light`|`tilt`|`pressure`|`delay`|`connectivity`), title, message, reading_id, acknowledged, acknowledged_by, acknowledged_at, created_at
- `audit_log` — id, actor_id, actor_label, action, entity_type, entity_id, detail (jsonb), created_at

Realtime: subscribe to `readings`, `alerts`, `transports`, `capsules` (postgres_changes). Example:

```ts
supabase.channel('live-readings')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'readings', filter: `capsule_id=eq.${id}` }, payload => { ... })
  .subscribe();
```

Auth: email/password. After login load `profiles` for role. Protect routes with a `RequireAuth` + `RequireRole` wrapper.

## Pages & behaviour

### `/login`
Split hero. Brand mark “ASQAC” + subtitle “Capsule Care Connect”. Form: email, password, error toast. Demo hint can mention technician@asqac.test (do not hardcode password in UI). After login → `/dashboard`.

### `/dashboard`
KPIs (live counts via queries):
1. Capsules in transit
2. Open (unacknowledged) alerts
3. Avg transport duration (closed transports, last 7d)
4. Capsules with connectivity concern (`in_transit` && last_seen_at older than 2 min) — label this “Signal risk”, **not** “Low battery”

Widgets:
- **Temperature band chart** (recharts Area/Line): last N readings for selected/primary in-transit capsule; shaded band from handling profile `temp_min_c`–`temp_max_c` (default 2–8 if none)
- **Open alerts** list (severity colour, relative time, deep-link to capsule)
- **Capsules table** — code, status chip, specimen, last_seen, temp spark
- **Recent specimens** — code, type, priority chip (routine/urgent/critical)

Empty states with illustration + CTA (“Register a specimen”).

### `/capsules`
Fleet view with filter chips: All / In transit / Prepared / Arrived / Alert / Charging / Idle / Maintenance.

Card or row per capsule → click opens **detail**:
- Header: code (decode animation), status, firmware, last_seen + live pulse if &lt; 30s
- Assigned specimen + transport ID + preset profile summary
- **Live gauge row** (custom widgets, not plain numbers):
  - Temp (°C) with coloured arc vs profile band
  - Pressure (hPa)
  - Lux (with “lid / exposure” hint when &gt; profile max_lux)
  - Shock g meter (needle / bar, red past max_shock_g)
  - Tilt bubble level **or** R3F 3D capsule rotating from pitch/roll
- Telemetry ingestion card: device_uid, last POST age, rssi if present, “waiting for telemetry” honest empty state
- Trend tabs: Temperature | Pressure | Ambient Light | Motion Accel (line charts from `readings` history — **must plot real rows**, never leave blank if data exists)
- Per-capsule alert history
- Actions by role:
  - Technician: Prepare / Start transport (if specimen assigned & state allows)
  - Doctor: End transport → verdict modal

### `/register` (technician only)
Form:
- patient_ref (anonymised)
- requested_test
- specimen_type select (BLOOD/URINE/PLASMA/TISSUE/SWAB/VACCINE)
- handling preset — filtered by specimen_type from `handling_profiles`
- priority routine/urgent/critical
- origin, destination_lab
- clinical_notice
- **Profile summary card** (live): temp range, max transport min, freezing_risk, max shock/tilt/lux, lab_confirmation_req, source_refs chips (WHO / CLSI PRE04 / Oxford etc.)
- Capsule assignment: only capsules with status `idle` (or prepared without open transport); QR scan button to fill capsule code
- On submit: insert `specimens`, create `transports` (`state='registered'` or `'prepared'`), write `audit_log`, optionally set capsule to `prepared`
- Generate printable QR for specimen_code + capsule code
- Disable submit until required fields + free capsule selected (fix the old site’s stuck disabled button by clear validation messages)

### `/alerts`
- Severity filters: critical / warning / info
- Type filters: temperature, shock, light, tilt, pressure, delay, connectivity
- Toggle “Unacknowledged only”
- Acknowledge action → update row + audit_log
- Note about audit retention in footer

### `/reports`
- KPIs: deliveries completed, excursion rate, avg duration, accept vs reject verdict mix
- Chart: deliveries vs excursions over time
- Chain-of-custody table from `audit_log` (+ transport joins)
- CSV export button (client-side)

### Doctor end-transport + verdict flow
Modal/page section:
- Summary of excursions, max/min temp, max shock, light events, duration vs max_transport_min
- Verdict radio: Accept / Review Required / Reject
- Notes required for reject & review_required
- On confirm: transport.state=`closed` (set arrived_at if needed), verdict fields, capsule.status=`idle` (or `arrived` then idle), audit_log entries

## Simulator mode (required)

Top-bar toggle **Simulator**. When on (and env token present), every 5s POST to `VITE_TELEMETRY_URL` with the same JSON shape the ESP32 uses, header `x-device-token: VITE_DEMO_DEVICE_TOKEN`, body fields: device_uid, temp_c, pressure_hpa, lux, ax, ay, az, pitch_deg, roll_deg, shock_g, rssi. Include a “Stress” sub-toggle that occasionally breaches bands (for demo alerts). Show a small badge “SIMULATED TELEMETRY”. This lets judges see live charts without hardware.

## UX quality bar

- Loading skeletons matching card shapes
- Honest empty states (no fake hardcoded 5.0°C / 40% humidity)
- Toasts for success/error
- Responsive: desktop-first but usable on tablet; collapse rail on small screens
- a11y: focus rings, aria-labels on gauges, colour not sole status cue (icons + text)
- Keyboard: Esc closes modals
- Print stylesheet for CoC / QR label

## Seed expectations

DB already has handling_profiles + capsules CAP0001–CAP0003. App should work against empty readings (empty charts with CTA “Start simulator or power the capsule”).

## Deliverable from Astra

Generate the full app source with:

- Clean folder structure (`src/pages`, `src/components/widgets`, `src/components/layout`, `src/hooks`, `src/lib`, `src/types`)
- Typed Supabase row types matching the schema
- README with run instructions (`npm i && npm run dev`)
- No placeholder “lorem” clinical copy — use real cold-chain language
- Do not include humidity or battery live widgets

Build it beautiful, interactive, and clinically serious. Custom layouts. Purposeful motion only.
