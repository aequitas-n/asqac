import { createClient } from '@supabase/supabase-js';
import { telemetrySchema, sha256, validateTimestamp } from '../_shared/protocol.ts';
import { cors, json, originAllowed } from '../_shared/http.ts';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(async (request: Request) => {
  if (!originAllowed(request)) return json(request, { error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== 'POST') return json(request, { error: 'Use POST' }, 405);
  if (!request.headers.get('content-type')?.includes('application/json'))
    return json(request, { error: 'Use application/json' }, 415);
  const token = request.headers.get('x-device-token');
  if (!token || token.length < 32 || token.length > 256)
    return json(request, { error: 'Invalid device credentials' }, 401);
  try {
    // Stream limit also protects requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json(request, { error: 'JSON body required' }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        return json(request, { error: 'Payload too large' }, 413);
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      return json(request, { error: 'Invalid JSON' }, 400);
    }
    const parsed = telemetrySchema.safeParse(body);
    if (!parsed.success)
      return json(
        request,
        {
          error: 'Invalid telemetry payload',
          issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
        400,
      );
    const batch = 'readings' in parsed.data;
    const readings = 'readings' in parsed.data ? parsed.data.readings : [parsed.data];
    if (!readings.every((r) => validateTimestamp(r.recorded_at)))
      return json(
        request,
        { error: 'recorded_at must be within the last 24 hours and no more than 30 seconds ahead' },
        400,
      );
    const credentials = { p_uid: readings[0].device_uid, p_hash: await sha256(token) };
    const { data, error } = batch
      ? await db.rpc('ingest_reading_batch', { ...credentials, p_payloads: readings })
      : await db.rpc('ingest_reading', { ...credentials, p_payload: readings[0] });
    if (error) {
      if (error.code === '28000')
        return json(request, { error: 'Invalid device credentials' }, 401);
      if (error.message.includes('rate limit'))
        return json(
          request,
          {
            error: 'Device busy: retry after 250 ms',
            retry_after_ms: 250,
          },
          429,
          { 'Retry-After': '1' },
        );
      if (error.message.includes('already reviewed'))
        return json(request, { error: 'Transport already reviewed; late reading rejected' }, 409);
      if (error.code === '23514' || error.code === '22P02')
        return json(request, { error: 'Telemetry violates sensor constraints' }, 400);
      console.error('Ingestion database error', error.code);
      return json(request, { error: 'Unable to store telemetry' }, 500);
    }
    return json(request, data, 201);
  } catch {
    console.error('Ingestion request failed');
    return json(request, { error: 'Unable to process request' }, 500);
  }
});
