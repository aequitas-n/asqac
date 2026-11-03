# Physical capsule latency — 3 November 2026

The root `code.txt` and identical `firmware/asqac-esp32/asqac-esp32.ino` now contain the latency fix. Re-upload this version to the physical ESP32; changing the workspace file alone cannot update a running board.

The final frontend pass preserves newer Realtime rows when delayed reconciliation queries complete, bounds histories without repeated full-fleet scans, and memoizes capsule histories, trends and orientation rendering. Live chart draw animations are disabled so new points do not repeatedly restart a 650 ms animation. The 3D model starts at the measured pose and damps subsequent shortest-angle changes. Number tickers reset across offline gaps, meters without limits say “Measured,” and raw gyro X/Y/Z is visible. The full local suite now has 38 passing tests. No additional browser verification or physical post-flash measurement was performed. This is ready for a near-live demonstration after flashing, with cloud request time still part of the delivery delay.

## Final correction: FIFO backlog and application 429

The user's later physical Serial logs showed `queue_wait` around **31,700 ms**, `pending` around **12–13**, and HTTP times as low as **368–878 ms**. Another request took **4,198 ms**, followed by `429` with `Device rate limit: retry after 2 seconds`. That exact message came from ASQAC's database limiter, not Supabase subscription quota enforcement.

The earlier start-based firmware pacing was incompatible with the legacy completion-based database limit after a slow request. Its one-packet-at-a-time FIFO also could not clear the accumulated backlog at the production rate. The earlier 2.5-second change alone was insufficient.

**Final deployed solution:** a new service-only `ingest_reading_batch` RPC accepts 1–16 same-device readings, evaluates them chronologically through the existing ingestion/alert logic, and limits accepted batch starts to 750 ms apart. Unexpected failures roll back the entire batch for retry. Already-reviewed transport readings are explicitly rejected per row without blocking subsequent samples. Duplicate retries remain idempotent. The Edge Function validates bounded batch payloads while continuing to accept legacy single packets. Migration `202611030006_batch_ingestion.sql` is installed and tracked in hosted migration history.

The final firmware captures **every 500 ms** with millisecond timestamps and targets **one batch request per second**. It keeps up to 360 samples (about three minutes), sends up to 16 oldest samples per request, and reports newest-sample age separately from oldest backlog age. It remains one file with the same Wi-Fi settings, device token, TLS verification, wiring and sensor conversions. The roll/pitch filter uses circular angle differences to prevent false motion at ±180°. The frontend 3D model interpolates over the shortest angle and respects reduced-motion settings. No new provider, admin key on the board, browser test, or public telemetry channel is required.

Final device pacing also enforces at least **800 ms after a successful response**, independently of how long TLS or the request took. A start timestamp on the ESP32 is not necessarily the time the server accepts the request. This post-response margin is required to avoid repeating the slow-request/429 bug. The next batch therefore starts no sooner than both one second after the previous request start and 800 ms after its response; actual frequency depends on network duration. Unlike the previous one-row approach, each successful request can remove up to 16 samples, allowing catch-up despite the safety gap.

**Final hosted verification passed:** a separate simulated CAP0004 device sent a 13-row catch-up batch in **558 ms**, then a two-row batch in **460 ms**, then a duplicate retry in **429 ms**, using the final 800 ms post-response spacing. All returned HTTP 201. Fifteen unique readings arrived through authenticated Realtime; no duplicate rows were added. The test device was deactivated and CAP0001/its transport was untouched. These are endpoint-test timings, not measurements from the user's flashed board. See [cloud evidence](batch-cloud-verification.json). Native batch/queue/pacing tests and the firmware board build are recorded separately.

The Free plan documents [500,000 function invocations](https://supabase.com/docs/guides/functions/pricing) and [100 Realtime messages/second](https://supabase.com/docs/guides/realtime/limits). At one request/second, one capsule used two hours/day consumes about 216,000 invocations in 30 days; four consume 864,000 and exceed the invocation allowance. Batching amortizes the request overhead but does not make continuous fleet operation unlimited. Realtime fan-out/storage use also count. Cloud delivery is near-live, not guaranteed zero-latency. Re-upload before assessing physical improvement.

The remaining sections record the earlier ten-second baseline and intermediate fix for context; the final settings above supersede their 2.5-second cadence and queue duration.

## Measured baseline

A read-only query of 30 non-simulated CAP0001 readings found a median database receipt interval of **9.940 seconds** and median observation-to-ingestion difference of **3.205 seconds** (range **2.729–4.186 seconds**). The readings were generated by the physical board; no simulator or cloud write was used for this investigation. See [timestamp snapshot](device-latency-snapshot.json).

Observation timestamps are rounded to seconds and depend on the device's clock. Their difference from database time includes clock error and timestamp quantization. It does not isolate TLS time or measure the browser-render delay.

## Causes established from source and timestamps

1. **Ten-second reporting window:** sensing continued at a much faster rate, but the firmware only created a packet every 10,000 ms. A change just after packet capture waited almost ten seconds before it could be reported. This agrees with the physical observation intervals.
2. **Repeated HTTPS setup:** TLS and HTTP objects lived inside the per-packet block and were destroyed after every upload. Each packet required a new connection rather than allowing an existing connection to be reused. The timestamp baseline establishes several additional seconds before storage; it does not attribute all of that time to TLS.
3. **Response time plus cooldown:** successful requests imposed another 2.5-second wait after completion. This slowed recovery from a backlog and would impede faster sampling.
4. **Presentation settling:** numeric transitions lasted 450 ms and gauge transitions 600 ms after a value reached React. This was a smaller contributor than the packet interval.

The normal reading path already merges Supabase Realtime events directly into React state. Its 60-second reconciliation poll is not the normal update timer. No database rate-limit or security-policy change was needed.

At the user's request, the capsule detail hook additionally runs `setTimeout(tick, 500)` after each completed latest-reading query. It fetches only the selected capsule's newest row, skips hidden tabs, aborts stalled requests, cleans up when leaving the page, and merges results with Realtime by reading ID and observation timestamp. Network requests never overlap. This adds a frontend fallback; it cannot create measurements before the physical firmware uploads them. The 500 ms pause is in addition to each query's network time.

## Changes delivered

| Area                      | Before                                 | After                                                                                              |
| ------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Packet creation           | 10 seconds                             | 2.5 seconds                                                                                        |
| Light/environment reads   | 300 ms                                 | 150 ms                                                                                             |
| HTTPS object lifetime     | Recreated for every packet             | Persistent objects; keep-alive requested where permitted by server                                 |
| Successful upload pacing  | HTTP duration plus 2.5-second cooldown | Minimum 2.5 seconds between request starts, accounting for elapsed HTTP time                       |
| Upload task wake interval | 100 ms                                 | 20 ms                                                                                              |
| Offline storage           | 90 frames / about 15 minutes           | 360 frames / about 15 minutes at the new rate                                                      |
| Number/gauge settling     | 450 / 600 ms                           | 150 / 180 ms                                                                                       |
| Diagnostics               | HTTP status / count                    | Queue wait, HTTP duration, total frame age, pending count, plus observation-to-ingestion in the UI |

The backend's two-second rate limit, HTTPS verification, per-device token authentication, chronological offline replay and impact/light peak retention remain active. The single-file format, working sensor pins and register conversions are preserved. Error paths retain appropriate backoff; permanent packet rejections are logged. A slow or disconnected network can still build a backlog, which remains visible rather than being silently discarded to disguise delay.

## Verification and practical limits

- Native C++ payload, queue, overflow and pacing tests passed, including rate-limit/authentication/transient-error delays.
- The complete ESP32 Dev Module sketch compiled with the official Arduino ESP32 core. See [build evidence](circuit-firmware-build.json).
- Strict frontend TypeScript and production build passed.
- All three isolated browser workflows passed with a 30-second startup assertion allowance. The standard five-second assertions had timed out on login/loading screens in this run; no functional assertions were removed. The browser checks use isolated fixtures and do not interfere with the physical capsule.
- The production browser bundle secret-value check passed.
- Faster physical operation requires uploading the new sketch. Post-flash end-to-end timing has not yet been measured here; no specific network response time is guaranteed.

After upload, Serial Monitor at 115200 baud reports messages such as:

```text
ASQAC HTTPS 201: packet ... accepted | queue_wait=...ms http=...ms total=...ms pending=...
```

Low `queue_wait` with high `http` identifies connection/cloud response time. Increasing `queue_wait`/`pending` identifies a backlog. Run `npm run measure:latency` after enough new physical readings arrive to refresh the saved read-only timing snapshot. Do not run a simulator using the same UID alongside the physical board.

The new cadence is four times the former request volume. One continuously running device produces 34,560 requests/day; four devices active two hours/day produce 345,600 requests in 30 days. Use bounded project demonstrations and the available project quota. The application remains a cloud transport monitor, not a frame-by-frame inertial control loop.
