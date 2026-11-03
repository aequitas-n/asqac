# Barometric altitude and relative height

Implemented and deployed to Supabase project `chhpbpqoaikbcicxdnzj` on 3 November 2026 IST. The frontend source and production build include both metrics. The frontend is now hosted at https://asqac-capsule-care-connect.vercel.app and connected to the `aequitas-n/asqac` GitHub repository for production builds.

## What is measured

The existing HW-611/BMP280 measures pressure and temperature. Altitude and height change are **derived estimates**, with no additional sensor:

```text
height_m = 44330 × (1 − (pressure_hpa / reference_hpa)^0.1903)
```

Estimated altitude uses the declared sea-level pressure, defaulting to standard atmosphere at 1013.25 hPa. Relative height uses the capsule's startup pressure instead. A pressure decrease produces a positive height estimate; a pressure increase produces a negative estimate. The approximation follows the [Adafruit BMP280 implementation](https://github.com/adafruit/Adafruit_BMP280_Library/blob/master/Adafruit_BMP280.cpp); sensor specifications are documented in the [Bosch BMP280 datasheet](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp280-ds001.pdf).

Standard-pressure altitude is not calibrated geographic elevation. Weather, temperature, airflow and motion affect pressure; a sealed capsule may not track ambient pressure at all. These values cannot establish precise vertical travel, a floor change, drop distance or specimen suitability. Existing handling-profile pressure checks continue to operate independently.

## Firmware and baseline

Root `code.txt` and `firmware/asqac-esp32/asqac-esp32.ino` are identical self-contained sketches. Existing Wi-Fi credentials, verified HTTPS, endpoint, device identity and sensor pin pairs remain configured. No custom header or additional library is required.

After five seconds of warm-up and valid UTC, the firmware collects 16 valid pressure samples. A window spanning more than 0.3 hPa restarts collection. The mean becomes a fixed startup reference until reboot. Keep the capsule still while it settles; the baseline is a zero point, not an elevation survey. The existing 500 ms acquisition and bounded batch uploads continue.

Packets always declare `sea_level_pressure_hpa`. Once the baseline is ready, they also carry the paired `reference_pressure_hpa` and `height_reference_at`. Offline packets preserve their original reference. Serial output includes estimated altitude and signed relative height, or an explicit waiting message.

## Backend and website

- Migration `202611030007_barometric_height.sql` adds validated reference metadata and database-generated `altitude_m` / `height_change_m`. Callers cannot supply derived values. Legacy packets remain supported; old rows get standard-pressure altitude but keep relative height unknown.
- The deployed telemetry Edge Function validates the reference pair, pressure range and reference timestamp before ingestion. Existing device authentication, RLS, batching and duplicate-safe replay remain enforced.
- Live capsule detail adds two labelled cards and two trend tabs. Overview sensor readings show both estimates. Height charts break across startup reference changes. Missing references display an honest waiting state.
- Transport summaries retain altitude and height extrema after raw-data pruning and flag a changed reference. Printable reports identify reference resets; extrema from separate zero points are not presented as total travel distance.
- Both simulators send explicit reference metadata and keep their simulated flag. Realtime carries the underlying pressure/reference fields, allowing the client to calculate the same estimate if generated columns are omitted from an event.
- `supabase/ASQAC_SETUP.sql` now bundles all seven migrations. They are already applied and recorded in the hosted project's migration ledger. No manual SQL is needed for this workspace.

## Verification

All 34 local tests passed, including database workflows and retention with the updated ingestion function, reference validation, server-generated values, zero/sign behavior, and legacy rows without invented references. Native firmware contract tests passed. The full ESP32 Dev Module build passed using ESP32 Arduino core 3.3.12: 1,079,608 bytes of flash and 120,664 bytes of static RAM. The frontend production build and Edge TypeScript checks passed, and administrative/device credentials are absent from the browser bundle.

The [hosted verification](barometry-cloud-verification.json) used a temporary simulated device on idle CAP0004, leaving CAP0001's transport untouched. The endpoint accepted all three requests, including duplicate replay; 15 unique readings and 15 Realtime events were observed. Staff RLS reads returned server-derived values: 0 m at 1013.25 hPa, approximately +110.904 m at 1000 hPa, and −8.322 m at 1014.25 hPa relative to 1013.25 hPa. Realtime included the reference provenance. The temporary device was deactivated during cleanup.

These checks verify the software and deployed data path. They do not verify physical height accuracy or a successful flash. No browser checks were performed for this update, as requested. Flash the updated `code.txt`, keep the capsule still while its startup reference forms, then use CAP0001's live metrics. Existing pressure readings can show estimated altitude immediately; relative height requires the updated firmware.

Repeat non-browser checks from the project root:

```sh
npm test
npm run check:edge
npm run check:firmware
npm run build
npm run check:client-secrets
npm run verify:barometry
```

The last command writes simulated verification readings on CAP0004 and requires that capsule to be idle without an open transport. The test device is deactivated afterward; the readings remain explicitly simulated for audit.
