import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Profile } from '../types';
import { supabase, configured } from '../lib/supabase';
interface AuthValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  preview: boolean;
  enterPreview: () => void;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(
    !configured && sessionStorage.getItem('asqac-setup-preview') === '1',
  );
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    let version = 0;
    let currentUserId: string | null = null;
    const apply = async (u: User | null) => {
      const request = ++version;
      if (!live) return;
      setUser(u);
      if ((u?.id ?? null) !== currentUserId) {
        setProfile(null);
        setLoading(Boolean(u));
        currentUserId = u?.id ?? null;
      }
      if (!u) setProfile(null);
      setError(null);
      if (u) {
        const { data, error: err } = await supabase!
          .from('profiles')
          .select('*')
          .eq('id', u.id)
          .single();
        if (!live || request !== version) return;
        if (err) {
          setProfile(null);
          setError(
            'Your account has no staff profile. Ask the project administrator to provision your role.',
          );
        } else setProfile(data as Profile);
      }
      if (live) setLoading(false);
    };
    supabase.auth.getSession().then(({ data, error: err }) => {
      if (err) {
        setError(err.message);
        setLoading(false);
      } else void apply(data.session?.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session?.user ?? null);
    });
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, []);
  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        error,
        preview,
        enterPreview: () => {
          sessionStorage.setItem('asqac-setup-preview', '1');
          setPreview(true);
        },
        signOut: async () => {
          sessionStorage.removeItem('asqac-setup-preview');
          setPreview(false);
          if (supabase) {
            const { error: err } = await supabase.auth.signOut();
            if (err) throw err;
          }
          setUser(null);
          setProfile(null);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider missing');
  return context;
}
