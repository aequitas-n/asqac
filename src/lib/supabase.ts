import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const configured = Boolean(url && key && /^https?:\/\//.test(url));
export const supabase = configured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;
export const telemetryUrl =
  import.meta.env.VITE_TELEMETRY_URL?.trim() || (url ? `${url}/functions/v1/telemetry` : '');
export async function rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Connect your Supabase project to use this action.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
