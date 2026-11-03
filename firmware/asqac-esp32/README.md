# ASQAC — final single-file ESP32 firmware

Root **`code.txt`** contains the complete sketch. **`asqac-esp32.ino`** is an identical Arduino copy you can open directly. Use either source; you do not need multiple code files.

There is no HTML, local server, `secrets.h`, `telemetry.h` or other custom header. All required libraries are included with Espressif's ESP32 Arduino core 3.x.

## Upload

1. Open `asqac-esp32.ino` in Arduino IDE, or paste the entire contents of root `code.txt` into a new sketch.
2. Select **ESP32 Dev Module**, matching the supplied working circuit, and your COM port.
3. Wi-Fi is already **`abcd`** / **`12345678`**. Change only `WIFI_SSID` and `WIFI_PASSWORD` at the top when using another network.
4. The actual ASQAC endpoint, registered CAP0001 device token/UID and trusted TLS root certificate are already included. No Supabase administrative key is used.
5. Upload and open Serial Monitor at **115200 baud**. Keep the capsule still during gyro calibration.
6. After Wi-Fi and UTC synchronisation, readings are captured every **500 ms** and uploaded in batches about once per second on a healthy connection. Serial output reports `ASQAC HTTPS 201: batch=...`. Re-upload the final sketch to enable this protocol; its backend support is already deployed.
7. Stop any simulator using the same device UID. In ASQAC, register a specimen with CAP0001, prepare and start transport to apply handling limits and see alerts.

## Existing wiring

| Sensor          | SDA    | SCL    | Other connections                           |
| --------------- | ------ | ------ | ------------------------------------------- |
| MPU6050         | GPIO33 | GPIO32 | `Wire1`; detects 0x68/0x69                  |
| BH1750          | GPIO18 | GPIO19 | ADDR to GND; detects 0x23/0x5C              |
| HW-611 / BMP280 | GPIO27 | GPIO14 | CSB to 3.3 V; SDO to GND; detects 0x76/0x77 |

Keep 3.3 V power, common ground and appropriate I²C pull-ups. This pin layout targets the classic ESP32, not ESP32-C3. Raw register drivers, BMP280 compensation, BH1750 conversion, MPU ranges, gyro calibration and the roll/pitch filter are preserved.

## Backend and offline cases

- Verified HTTPS POST to `https://chhpbpqoaikbcicxdnzj.supabase.co/functions/v1/telemetry`, authenticated using `x-device-token`.
- Exact backend fields: UID, UTC observation time, temperature, pressure, lux, acceleration in g, gyro, pitch/roll, impact peak, RSSI and `simulated=false`.
- Approximately 125 Hz motion sampling and 150 ms light/environment sampling. Impact and light peaks are retained for each 500 ms packet window. Millisecond observation timestamps distinguish samples within the same second.
- HTTPS runs in a separate FreeRTOS task; network waits do not suspend the sensing loop.
- A bounded 360-packet RAM queue preserves about three minutes at 500 ms sampling. Each upload can drain up to 16 queued readings, preserving their timestamps and excursion evaluation. Overflow drops/logs the oldest packet; power loss clears the queue.
- Wi-Fi/server failures retry; authentication/rate limits back off. Invalid, expired and already-reviewed packets are logged and discarded.
- Missing, stale or interrupted sensor windows are skipped. Initial UTC synchronisation needs Internet access. Sensor reconnection/calibration can briefly pause sensing and requires a stationary capsule.

The requested demo device token is embedded directly in this self-contained sketch. Handling profiles, alerts and transport association remain enforced by the existing backend. The local dashboard and yaw estimate are removed. Altitude and relative height now use the shared cloud barometry contract below.

## Altitude and relative height — 3 November 2026

No extra sensor or configuration is needed. After the first five seconds and UTC synchronisation, the sketch averages 16 stable pressure samples to establish a startup reference. Keep the capsule still during this period; an unstable window restarts calibration. The baseline stays fixed until reboot. Serial Monitor prints estimated altitude and signed height change once the reference is ready.

Each packet includes `sea_level_pressure_hpa` (standard 1013.25 hPa by default) and, when ready, `reference_pressure_hpa` and `height_reference_at`. The deployed database derives altitude and height change from pressure; the website displays the results in live cards, trends and reports. Existing readings without startup references have no relative height estimate. A reboot creates a new zero reference, and the charts break the height line across that reset.

These are pressure-based estimates. Weather, temperature, motion and an airtight capsule can change or isolate the measured pressure. They do not establish GPS elevation, precise travel distance, floor changes or drop distance. See [the calculation, limitations and cloud evidence](../../docs/BAROMETRIC_METRICS.md). The full updated sketch compiles for ESP32 Dev Module; flashing the board remains necessary to send its startup reference.

## Latency fix — 3 November 2026

The user's physical logs identified a 32-second FIFO backlog even when HTTP took only 368–878 ms. A slow 4.2-second request also exposed a mismatch between firmware start-based pacing and the legacy database's completion-based two-second limit, causing the reported 429. The final version replaces one-row uploads with batches: 500 ms samples, approximately one request per second, up to 16 oldest samples per request. The deployed batch RPC limits accepted batch starts to 750 ms apart while preserving the old single-packet API. The sketch uses a 1,000 ms start interval plus explicit 429 backoff. Queued history can now catch up rather than permanently trail current measurements. Verified HTTPS is reused when supported by the server. Orientation filtering handles the ±180° boundary without a false sweep through zero.

Final pacing additionally keeps **at least 800 ms after each successful response**, even if TLS took several seconds. Device request-start time and database acceptance time are not identical; this response gap prevents an immediate next request from hitting the 750 ms database limit after a slow handshake. Actual batch frequency is approximately HTTP duration plus 800 ms, with a one-second minimum start interval. Batching clears multiple samples per request, so this safety gap does not imply a one-row-per-request backlog.

Serial reports `batch`, `oldest_wait`, `http`, `newest_total`, `pending` and explicit rejected-row counts. A batch may contain older recovery samples; `newest_total` shows the age of its newest sample. The web capsule's Ingestion health card shows observation-to-ingestion delay. Re-upload before measuring physical improvement. Cloud networking is not zero-latency, and a severe outage still requires catch-up.

```sh
npm run measure:latency
```

This reads physical timestamps without changing data. Older firmware uses second-resolution timestamps; final firmware includes milliseconds. Device clock error still affects timestamp differences. At one request/second, one device used two hours/day uses about 216,000 invocations in 30 days; four would use 864,000, exceeding the documented Free function allowance of 500,000. The present single-capsule demonstration fits that invocation budget when bounded to those hours; Realtime messages, storage and other project use have separate limits. Do not run it continuously all month.

## Verification

See [logic/contract checks](../../docs/circuit-firmware-verification.json), the [latest full board build](../../docs/circuit-firmware-build.json), [hosted batch/Realtime verification](../../docs/batch-cloud-verification.json), and [hosted altitude/height verification](../../docs/barometry-cloud-verification.json). The deployed endpoint accepted a 13-row catch-up batch and following batches with duplicate-safe retries; 15 unique Realtime readings were delivered. The barometry check verified zero, positive and negative displacement plus authenticated staff access and reference metadata in Realtime. The cloud checks used isolated simulated CAP0004 devices and did not alter CAP0001's transport. These checks do not establish the final sketch's physical board timing or a successful flash.

Repeat from the project root:

```sh
npm run check:firmware
npm run build:firmware
```

The native check requires `g++` (or `CXX`) and tests the actual inline encoder against the backend schema, unit conversion, peaks and queue handling. The build uses the local/global Arduino CLI (`ARDUINO_CLI` override) with the official `esp32:esp32` core. Neither command uploads hardware.

After editing the Arduino copy, keep the root copy aligned:

```powershell
Copy-Item -LiteralPath firmware/asqac-esp32/asqac-esp32.ino -Destination code.txt -Force
```
