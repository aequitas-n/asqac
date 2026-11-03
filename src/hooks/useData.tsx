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
import { createRequestRunner } from '../lib/requestRunner';
import { mergeAlerts } from '../lib/alerts';
import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
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
export function DataProvider({
  children,
  backend = supabase,
}: {
  children: ReactNode;
  backend?: SupabaseClient | null;
}) {
  const { user, profile } = useAuth();
  const [data, setData] = useState<Data>(empty);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState('Disconnected');
  const capsuleNames = useRef(new Map<string, string>());
  useEffect(() => {
    capsuleNames.current = new Map(data.capsules.map((c) => [c.id, c.code]));
  }, [data.capsules]);
  const profileId = profile?.id;
  const role = profile?.role;
  const identity = useRef<string | undefined>(undefined);
  const lastSnapshotAt = useRef(0);
  const refreshTask = useMemo(
    () =>
      createRequestRunner(
        async (signal) => {
          const client = backend;
          if (!client || !profileId) return null;
          const results = await Promise.all([
            client.from('capsules').select('*').order('code').abortSignal(signal),
            client.from('handling_profiles').select('*').order('code').abortSignal(signal),
            client
              .from('specimens')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(500)
              .abortSignal(signal),
            client
              .from('transports')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(500)
              .abortSignal(signal),
            client
              .from('alerts')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(1000)
              .abortSignal(signal),
            client
              .from('audit_log')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(500)
              .abortSignal(signal),
            client.rpc('recent_fleet_readings').abortSignal(signal),
            client.from('transports').select('*').neq('state', 'closed').abortSignal(signal),
            client.from('alerts').select('*').eq('acknowledged', false).abortSignal(signal),
          ]);
          for (const result of results) if (result.error) throw result.error;
          const active = results[7].data as Transport[];
          let specimens = results[2].data as Specimen[];
          const missing = active
            .map((t) => t.specimen_id)
            .filter((id) => !specimens.some((s) => s.id === id));
          if (missing.length) {
            const extra = await client
              .from('specimens')
              .select('*')
              .in('id', missing)
              .abortSignal(signal);
            if (extra.error) throw extra.error;
            specimens = [...specimens, ...(extra.data as Specimen[])];
          }
          const merge = <T extends { id: string }>(first: T[], second: T[]) => [
            ...new Map([...first, ...second].map((row) => [row.id, row])).values(),
          ];
          return {
            capsules: results[0].data as Capsule[],
            profiles: results[1].data as HandlingProfile[],
            specimens,
            transports: merge(results[3].data as Transport[], active),
            alerts: merge(results[4].data as Alert[], results[8].data as Alert[]),
            audit: results[5].data as AuditEntry[],
            readings: results[6].data as Reading[],
          };
        },
        {
          success: (snapshot) => {
            if (!snapshot || identity.current !== profileId) return;
            lastSnapshotAt.current = Date.now();
            setData((previous) => ({
              ...snapshot,
              alerts: mergeAlerts(snapshot.alerts, previous.alerts),
              readings: mergeReadings(snapshot.readings, previous.readings),
            }));
            setError(null);
          },
          failure: (err) => {
            if (identity.current !== profileId) return;
            setError(
              err instanceof Error
                ? err.message
                : ((err as { message?: string })?.message ??
                    'Unable to refresh. Check your connection and retry.'),
            );
          },
          settled: () => {
            if (identity.current === profileId) setLoading(false);
          },
        },
      ),
    [backend, profileId, role],
  );
  // A deliberate refresh after a mutation must start after any older snapshot.
  // Background resume/reconnect signals use the single-flight runner directly.
  const refresh = useCallback(async () => {
    if (identity.current !== profileId) return;
    if (refreshTask.pending) await refreshTask.run();
    if (identity.current === profileId) await refreshTask.run();
  }, [refreshTask, profileId]);
  useEffect(() => {
    if (identity.current !== profileId) {
      identity.current = profileId;
      lastSnapshotAt.current = 0;
      setData(empty);
      setLoading(Boolean(profileId));
      setError(null);
    }
    if (profileId) void refreshTask.run();
    else {
      setLoading(false);
      setRealtime('Disconnected');
    }
    return () => refreshTask.cancel();
  }, [profileId, refreshTask]);
  useEffect(() => {
    if (!backend || !user?.id || !profileId) return;
    let live = true;
    let resumeAt = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let readingsTimer: ReturnType<typeof setTimeout> | undefined;
    const pendingReadings: Reading[] = [];
    const flushReadings = () => {
      clearTimeout(readingsTimer);
      readingsTimer = undefined;
      if (!live || document.visibilityState === 'hidden' || !pendingReadings.length) return;
      const rows = pendingReadings.splice(0);
      setData((previous) => ({ ...previous, readings: mergeReadings(previous.readings, rows) }));
    };
    const resume = () => {
      if (!live || document.visibilityState === 'hidden') return;
      flushReadings();
      if (Date.now() - resumeAt < 1000) return;
      resumeAt = Date.now();
      if (Date.now() - lastSnapshotAt.current < 15_000) return;
      void refreshTask.run();
    };
    const reconnect = () => {
      if (live && document.visibilityState !== 'hidden') void refreshTask.run();
    };
    const schedule = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(reconnect, 250);
    };
    let channel = backend
      .channel(`workspace-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'readings' },
        (payload) => {
          if (!live) return;
          pendingReadings.push(payload.new as Reading);
          if (pendingReadings.length > 2048)
            pendingReadings.splice(0, pendingReadings.length - 2048);
          if (document.visibilityState !== 'hidden' && readingsTimer === undefined)
            readingsTimer = setTimeout(flushReadings, 40);
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
          if (!live) return;
          if (table === 'alerts' && payload.eventType === 'INSERT') {
            const alert = payload.new as Alert;
            if (!alert.acknowledged) {
              const notify =
                alert.severity === 'critical'
                  ? toast.error
                  : alert.severity === 'warning'
                    ? toast.warning
                    : toast.info;
              notify(alert.title, {
                id: `handling-${alert.id}`,
                description: `${capsuleNames.current.get(alert.capsule_id) ?? 'Capsule'} · ${alert.message}`,
                duration: 8000,
              });
            }
          }
          setData((previous) => {
            const rows = previous[key as keyof typeof previous] as { id: string | number }[];
            const row = payload.new as { id: string | number };
            const old = payload.old as { id: string | number };
            const updated =
              payload.eventType === 'DELETE'
                ? rows.filter((r) => r.id !== old.id)
                : key === 'alerts'
                  ? mergeAlerts([row as Alert], previous.alerts)
                  : [
                      { ...rows.find((r) => r.id === row.id), ...row },
                      ...rows.filter((r) => r.id !== row.id),
                    ];
            return {
              ...previous,
              [key]: updated.slice(0, key === 'audit' ? 500 : key === 'alerts' ? 1000 : 500),
            };
          });
        },
      );
    channel.subscribe((status) => {
      if (!live) return;
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
    const poll = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refreshTask.run();
    }, 60000);
    window.addEventListener('focus', resume);
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', resume);
    return () => {
      live = false;
      clearInterval(poll);
      clearTimeout(refreshTimer);
      clearTimeout(readingsTimer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', resume);
      void backend.removeChannel(channel);
    };
  }, [backend, user?.id, profileId, role, refreshTask]);
  const value = useMemo(
    () => ({ ...data, loading, error, realtime, refresh }),
    [data, loading, error, realtime, refresh],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
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
    setPolledReadings([]);
    const request = createRequestRunner(
      async (signal) => {
        const { data: row, error } = await client
          .from('readings')
          .select('*')
          .eq('capsule_id', id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .abortSignal(signal)
          .maybeSingle();
        if (error) throw error;
        return row as Reading | null;
      },
      {
        success: (reading) => {
          if (stopped || !reading) return;
          setPolledReadings((previous) =>
            previous.some((r) => r.id === reading.id)
              ? previous
              : mergeReadings(previous, [reading]),
          );
        },
        failure: () => {}, // Existing data stays visible until its freshness deadline.
      },
      5000,
    );
    async function tick() {
      clearTimeout(timer);
      if (stopped || !visible()) return;
      await request.run();
      if (!stopped && visible()) {
        clearTimeout(timer);
        timer = setTimeout(tick, 500);
      }
    }
    function visible() {
      return document.visibilityState !== 'hidden';
    }
    const resume = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') request.cancel();
      else void tick();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      request.cancel();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
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
