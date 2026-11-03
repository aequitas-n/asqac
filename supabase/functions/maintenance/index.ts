import { createClient } from '@supabase/supabase-js';
import { sha256 } from '../_shared/protocol.ts';
import { json } from '../_shared/http.ts';
// Fallback for projects without pg_cron. Invoke every minute with a private scheduler.
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(request, { error: 'Use POST' }, 405);
  const expected = Deno.env.get('MAINTENANCE_TOKEN');
  const provided = request.headers.get('x-maintenance-token');
  if (!expected || !provided || (await sha256(expected)) !== (await sha256(provided)))
    return json(request, { error: 'Unauthorized' }, 401);
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const health = await db.rpc('check_transport_health');
  if (health.error) return json(request, { error: 'Health check failed' }, 500);
  // Pruning is hourly. Health checks stay small and predictable.
  const result =
    new Date().getUTCMinutes() === 17 ? await db.rpc('prune_telemetry') : { data: 0, error: null };
  if (result.error) return json(request, { error: 'Retention failed' }, 500);
  return json(request, { ok: true, checks: health.data, pruned: result.data });
});
