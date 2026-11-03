import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { mergeReadings } from '../lib/readings';
import { useAuth } from './useAuth';
import type {
  Alert,
  AuditEntry,
  Capsule,
  HandlingProfile,
  Reading,
  Specimen,
  Transport,
} from '../types';
interface Data {
  capsules: Capsule[];
  profiles: HandlingProfile[];
  specimens: Specimen[];
  transports: Transport[];
  alerts: Alert[];
  audit: AuditEntry[];
  readings: Reading[];
}
const empty: Data = {
  capsules: [],
  profiles: [],
  specimens: [],
  transports: [],
  alerts: [],
  audit: [],
  readings: [],
};
interface DataValue extends Data {
  loading: boolean;
  error: string | null;
  realtime: string;
  refresh: () => Promise<void>;
}
const DataContext = createContext<DataValue | null>(null);
export function DataProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [data, setData] = useState<Data>(empty);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState('Disconnected');
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    if (!supabase || !profile) return;
    const request = ++epoch.current;
    try {
      const results = await Promise.all([
        supabase.from('capsules').select('*').order('code'),
        supabase.from('handling_profiles').select('*').order('code'),
        supabase.from('specimens').select('*').order('created_at', { ascending: false }).limit(500),
        supabase
          .from('transports')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.rpc('recent_fleet_readings'),
        supabase.from('transports').select('*').neq('state', 'closed'),
        supabase.from('alerts').select('*').eq('acknowledged', false),
      ]);
      if (request !== epoch.current) return;
      for (const result of results) if (result.error) throw result.error;
      const active = results[7].data as Transport[];
      let specimens = results[2].data as Specimen[];
      const missing = active
        .map((t) => t.specimen_id)
        .filter((id) => !specimens.some((s) => s.id === id));
      if (missing.length) {
        const additional = await supabase.from('specimens').select('*').in('id', missing);
        if (additional.error) throw additional.error;
        specimens = [...specimens, ...(additional.data as Specimen[])];
      }
      if (request !== epoch.current) return;
      const merge = <T extends { id: string }>(first: T[], second: T[]) => [
        ...new Map([...first, ...second].map((row) => [row.id, row])).values(),
      ];
      setData((previous) => ({
        capsules: results[0].data as Capsule[],
        profiles: results[1].data as HandlingProfile[],
        specimens,
        transports: merge(results[3].data as Transport[], active),
        alerts: merge(results[4].data as Alert[], results[8].data as Alert[]),
        audit: results[5].data as AuditEntry[],
        readings: mergeReadings(results[6].data as Reading[], previous.readings),
      }));
      setError(null);
    } catch (err) {
      if (request === epoch.current)
        setError(
          err instanceof Error
            ? err.message
            : ((err as { message?: string }).message ?? 'Unable to load workspace'),
        );
    } finally {
      if (request === epoch.current) setLoading(false);
    }
  }, [profile]);
  useEffect(() => {
    if (!profile) {
      epoch.current++;
      setData(empty);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
  }, [profile, refresh]);
  useEffect(() => {
    if (!supabase || !user || !profile) return;
    const schedule = () => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 700);
    };
    let channel = supabase
      .channel(`workspace-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'readings' },
        (payload) => {
          const row = payload.new as Reading;
          setData((prev) => ({
            ...prev,
            readings: mergeReadings(prev.readings, [row]),
          }));
        },
      );
    const tables = {
      alerts: 'alerts',
      transports: 'transports',
      capsules: 'capsules',
      specimens: 'specimens',
      audit_log: 'audit',
    } as const;
    for (const [table, key] of Object.entries(tables))
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          setData((previous) => {
            const rows = previous[key as keyof typeof previous] as { id: string | number }[];
            const row = payload.new as { id: string | number };
            const old = payload.old as { id: string | number };
            const updated =
              payload.eventType === 'DELETE'
                ? rows.filter((r) => r.id !== old.id)
                : [row, ...rows.filter((r) => r.id !== row.id)];
            return {
              ...previous,
              [key]: updated.slice(0, key === 'audit' ? 500 : key === 'alerts' ? 1000 : 500),
            };
          });
        },
      );
    channel.subscribe((status) => {
      setRealtime(
        status === 'SUBSCRIBED'
          ? 'Connected'
          : status === 'CHANNEL_ERROR'
            ? 'Reconnecting'
            : status === 'TIMED_OUT'
              ? 'Reconnecting'
              : 'Connecting',
      );
      if (status === 'SUBSCRIBED') schedule();
    });
    const poll = setInterval(() => void refresh(), 60000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(poll);
      clearTimeout(refreshTimer.current);
      epoch.current++;
      window.removeEventListener('focus', focus);
      void supabase!.removeChannel(channel);
    };
  }, [user, profile, refresh]);
  return (
    <DataContext.Provider value={{ ...data, loading, error, realtime, refresh }}>
      {children}
    </DataContext.Provider>
  );
}
export function useData() {
  const value = useContext(DataContext);
  if (!value) throw new Error('DataProvider missing');
  return value;
}
export function useCapsule(id: string | undefined) {
  const data = useData();
  const { profile: staff } = useAuth();
  const [polledReadings, setPolledReadings] = useState<Reading[]>([]);
  useEffect(() => {
    const client = supabase;
    if (!client || !id || !staff) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    setPolledReadings([]);
    async function tick() {
      try {
        // Realtime still pushes immediately. This narrow query reconciles the
        // visible capsule without reloading the page or the whole workspace.
        if (document.visibilityState !== 'hidden') {
          request = new AbortController();
          const timeout = setTimeout(() => request?.abort(), 5000);
          try {
            const { data: row, error } = await client!
              .from('readings')
              .select('*')
              .eq('capsule_id', id!)
              .order('recorded_at', { ascending: false })
              .limit(1)
              .abortSignal(request.signal)
              .maybeSingle();
            if (!stopped && !error && row) {
              const reading = row as Reading;
              setPolledReadings((previous) =>
                previous.some((r) => r.id === reading.id)
                  ? previous
                  : [...previous, reading]
                      .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
                      .slice(-180),
              );
            }
          } finally {
            clearTimeout(timeout);
          }
        }
      } catch {
        // Keep the last reading and let Realtime/reconciliation recover.
      } finally {
        // Schedule after completion so slow requests never pile up.
        if (!stopped) timer = setTimeout(tick, 500);
      }
    }
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      request?.abort();
    };
  }, [id, staff?.id]);
  const capsule = data.capsules.find((c) => c.id === id);
  const transport = data.transports.find((t) => t.capsule_id === id && t.state !== 'closed');
  const specimen = data.specimens.find((s) => s.id === transport?.specimen_id);
  const profile =
    transport?.profile_snapshot ??
    data.profiles.find((p) => p.id === transport?.handling_profile_id);
  const capsuleReadings = useMemo(
    () => mergeReadings(data.readings, polledReadings).filter((r) => r.capsule_id === id),
    [data.readings, polledReadings, id],
  );
  const readings = useMemo(
    () =>
      transport && ['in_transit', 'arrived'].includes(transport.state)
        ? capsuleReadings.filter((r) => r.transport_id === transport.id)
        : capsuleReadings,
    [capsuleReadings, transport?.id, transport?.state],
  );
  return {
    capsule,
    transport,
    specimen,
    profile,
    readings,
    latest: capsuleReadings.at(-1),
    alerts: data.alerts.filter((a) => a.capsule_id === id),
  };
}
