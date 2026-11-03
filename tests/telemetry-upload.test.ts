import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadTelemetryBatch, TelemetryUploadError } from '../src/lib/telemetryUpload';
const readings = [{ device_uid: 'TEST', recorded_at: '2026-11-03T00:00:00.500Z', shock_g: 4.5 }];
test('429 retries the identical packet with the server pacing hint instead of stopping', async () => {
  const bodies: unknown[] = [],
    delays: number[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    bodies.push(options?.body);
    return bodies.length === 1
      ? Response.json(
          { error: 'Device busy', retry_after_ms: 250 },
          { status: 429, headers: { 'Retry-After': '1' } },
        )
      : Response.json({ results: [{ reading_id: 1 }] }, { status: 201 });
  };
  const result = await uploadTelemetryBatch({
    endpoint: 'https://example.test',
    token: 'test',
    readings,
    fetcher,
    wait: async (ms) => {
      delays.push(ms);
    },
  });
  assert.equal(result.results[0].reading_id, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(JSON.parse(bodies[0] as string), { readings });
  assert.ok(delays[0] >= 250 && delays[0] < 350);
});
test('invalid credentials are reported immediately and never retried', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ error: 'Invalid device credentials' }, { status: 401 });
  };
  await assert.rejects(
    uploadTelemetryBatch({ endpoint: 'https://example.test', token: 'bad', readings, fetcher }),
    (e) => e instanceof TelemetryUploadError && e.status === 401,
  );
  assert.equal(calls, 1);
});
test('throttling retries are bounded and Stop cancels pending retry waits', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ error: 'Device busy', retry_after_ms: 250 }, { status: 429 });
  };
  await assert.rejects(
    uploadTelemetryBatch({
      endpoint: 'https://example.test',
      token: 'test',
      readings,
      fetcher,
      wait: async () => {},
    }),
    (e) => e instanceof TelemetryUploadError && e.status === 429,
  );
  assert.equal(calls, 6);
  calls = 0;
  const controller = new AbortController();
  await assert.rejects(
    uploadTelemetryBatch({
      endpoint: 'https://example.test',
      token: 'test',
      readings,
      fetcher,
      signal: controller.signal,
      onRetry: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});
test('a reviewed-row rejection is never counted as a successful simulated reading', async () => {
  const fetcher: typeof fetch = async () =>
    Response.json(
      { results: [{ rejected: true, error: 'Transport already reviewed' }] },
      { status: 201 },
    );
  await assert.rejects(
    uploadTelemetryBatch({ endpoint: 'https://example.test', token: 'test', readings, fetcher }),
    (e) => e instanceof TelemetryUploadError && e.status === 409,
  );
});
