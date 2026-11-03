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
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Profile } from '../types';
import { supabase } from '../lib/supabase';
import { createRequestRunner } from '../lib/requestRunner';
interface AuthValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  preview: boolean;
  enterPreview: () => void;
  retryProfile: () => void;
  signOut: () => Promise<void>;
}
function previewFlag() {
  try {
    return (
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem('asqac-setup-preview') === '1'
    );
  } catch {
    return false;
  }
}
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({
  children,
  client = supabase,
}: {
  children: ReactNode;
  client?: SupabaseClient | null;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(Boolean(client));
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(!client && previewFlag());
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    if (!client) return;
    let alive = true;
    let currentUserId: string | null = null;
    let profileLoaded = false;
    let authEvents = 0;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const profileRequest = createRequestRunner(
      async (signal) => {
        if (!currentUserId) throw new Error('Sign in to continue.');
        const { data, error: err } = await client
          .from('profiles')
          .select('*')
          .eq('id', currentUserId)
          .abortSignal(signal)
          .maybeSingle();
        if (err) throw new Error('Unable to load staff access. Check your connection and retry.');
        if (!data) {
          const missing = new Error(
            'Your account has no staff profile. Ask the project administrator to provision your role.',
          );
          missing.name = 'StaffProfileMissing';
          throw missing;
        }
        return data as Profile;
      },
      {
        success: (next) => {
          profileLoaded = true;
          setProfile((previous) =>
            previous?.id === next.id &&
            previous.role === next.role &&
            previous.email === next.email &&
            previous.full_name === next.full_name
              ? previous
              : next,
          );
          setError(null);
        },
        failure: (err) => {
          if (err instanceof Error && err.name === 'StaffProfileMissing') profileLoaded = false;
          if (!profileLoaded) setProfile(null);
          setError(
            err instanceof Error ? err.message : 'Unable to load staff access. Please retry.',
          );
        },
        settled: () => setLoading(false),
      },
      10_000,
    );
    const requestProfile = () => {
      if (!alive || scheduled !== undefined || profileRequest.pending) return;
      if (!profileLoaded) setLoading(true);
      // Supabase auth callbacks must return before a query acquires its auth
      // session. Deferring also combines duplicate initial-session events.
      scheduled = setTimeout(() => {
        scheduled = undefined;
        if (alive) void profileRequest.run();
      }, 0);
    };
    const accept = (next: User | null, forceProfile = false) => {
      if (!alive) return;
      const id = next?.id ?? null;
      if (id !== currentUserId) {
        clearTimeout(scheduled);
        scheduled = undefined;
        profileRequest.cancel();
        currentUserId = id;
        profileLoaded = false;
        setProfile(null);
        setLoading(Boolean(next));
        setError(null);
      }
      setUser((previous) => (previous?.id === next?.id && !forceProfile ? previous : next));
      if (!next) {
        setProfile(null);
        setLoading(false);
        setError(null);
        return;
      }
      // Focus and token refresh frequently repeat SIGNED_IN for the same user.
      // They must not restart the workspace or its Realtime connection.
      if (!profileLoaded || forceProfile) requestProfile();
    };
    const bootstrap = createRequestRunner(
      () => client.auth.getSession(),
      {
        success: ({ data, error: err }) => {
          if (!alive || authEvents) return;
          if (err)
            throw new Error('Unable to restore your sign-in. Check your connection and retry.');
          accept(data.session?.user ?? null);
        },
        failure: () => {
          if (alive && !authEvents) {
            setError('Unable to restore your sign-in. Check your connection and retry.');
            setLoading(false);
          }
        },
      },
      10_000,
    );
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      authEvents++;
      accept(session?.user ?? null, event === 'USER_UPDATED');
    });
    void bootstrap.run();
    retry.current = () => {
      if (currentUserId) requestProfile();
      else {
        authEvents = 0;
        setLoading(true);
        void bootstrap.run();
      }
    };
    return () => {
      alive = false;
      retry.current = () => {};
      clearTimeout(scheduled);
      profileRequest.cancel();
      bootstrap.cancel();
      subscription.unsubscribe();
    };
  }, [client]);
  const retryProfile = useCallback(() => retry.current(), []);
  const enterPreview = useCallback(() => {
    try {
      sessionStorage.setItem('asqac-setup-preview', '1');
    } catch {
      /* Read-only preview still works without storage. */
    }
    setPreview(true);
  }, []);
  const signOut = useCallback(async () => {
    try {
      sessionStorage.removeItem('asqac-setup-preview');
    } catch {
      /* Storage may be disabled. */
    }
    setPreview(false);
    if (client) {
      const { error: err } = await client.auth.signOut();
      if (err) throw err;
    }
    setUser(null);
    setProfile(null);
  }, [client]);
  const value = useMemo(
    () => ({ user, profile, loading, error, preview, enterPreview, retryProfile, signOut }),
    [user, profile, loading, error, preview, enterPreview, retryProfile, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider missing');
  return context;
}
