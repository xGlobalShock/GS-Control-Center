import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import type { User } from '@supabase/supabase-js';
import {
  supabase,
  isSupabaseConfigured,
  type UserProfile,
  type AuthProvider as AuthProviderType,
} from '../lib/supabase';

/* ═══════════════════════════════════════════════════════════════════
   Context shape
═══════════════════════════════════════════════════════════════════ */
interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  profileReady: boolean;
  loading: boolean;
  appReady: boolean;
  isExpired: boolean;
  isPro: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  currentProvider: AuthProviderType;
  login: (provider: 'discord' | 'twitch') => Promise<void>;
  logout: () => Promise<void>;
  cancelSubscription: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  grantPro: (userId: string, expiresAt: string | null) => Promise<boolean>;
  revokePro: (userId: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/* ═══════════════════════════════════════════════════════════════════
   Constants
═══════════════════════════════════════════════════════════════════ */
const REDIRECT_URL         = 'http://localhost:3000/auth/callback';
const STORAGE_AUTH_KEY     = 'gs-center-auth-token';
const STORAGE_PROVIDER_KEY = 'gs-center-current-provider';
const STORAGE_PROFILE_KEY  = 'gs-center-profile-cache';

/* ═══════════════════════════════════════════════════════════════════
   localStorage helpers (all sync, all try/catch)
═══════════════════════════════════════════════════════════════════ */
function _persistProvider(p: AuthProviderType): void {
  try { if (p) localStorage.setItem(STORAGE_PROVIDER_KEY, p); else localStorage.removeItem(STORAGE_PROVIDER_KEY); } catch {}
}
function _readProvider(): AuthProviderType {
  try { const v = localStorage.getItem(STORAGE_PROVIDER_KEY); if (v === 'discord' || v === 'twitch') return v; } catch {}
  return null;
}
function _cacheProfile(p: UserProfile | null): void {
  try { if (p) localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(p)); else localStorage.removeItem(STORAGE_PROFILE_KEY); } catch {}
}
function _readCachedProfile(): UserProfile | null {
  try { const r = localStorage.getItem(STORAGE_PROFILE_KEY); if (r) return JSON.parse(r); } catch {}
  return null;
}
/** Clear only OUR custom keys — does NOT touch the Supabase session token. */
function _clearCustomStorage(): void {
  try { localStorage.removeItem(STORAGE_PROVIDER_KEY); } catch {}
  try { localStorage.removeItem(STORAGE_PROFILE_KEY); } catch {}
}
/** Clear everything including the Supabase session — only for explicit logout. */
function _clearAllAuthStorage(): void {
  try { localStorage.removeItem(STORAGE_AUTH_KEY); } catch {}
  _clearCustomStorage();
}
/** Read full User object from the Supabase session in localStorage (sync). */
function _readCachedUser(): User | null {
  try {
    const r = localStorage.getItem(STORAGE_AUTH_KEY);
    if (r) { const p = JSON.parse(r); if (p?.user?.id) return p.user as User; }
  } catch {}
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
═══════════════════════════════════════════════════════════════════ */
function _checkExpired(profile: UserProfile | null): boolean {
  if (!profile || profile.role !== 'pro') return false;
  if (!profile.pro_expires_at) return false;
  return new Date(profile.pro_expires_at).getTime() < Date.now();
}

/**
 * Build a temporary profile instantly from the Supabase User object.
 * Contains name + avatar so the header renders real data immediately.
 * The background DB fetch will replace this with the full profile (role, etc).
 */
function _profileFromUser(u: User): UserProfile {
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? '',
    username: meta.full_name || meta.name || meta.user_name || meta.preferred_username || u.email?.split('@')[0] || 'User',
    avatar_url: meta.avatar_url || meta.picture || null,
    role: 'user',
    pro_source: null,
    pro_expires_at: null,
    subscription_status: null,
    provider: (u.app_metadata?.provider as AuthProviderType) ?? null,
    created_at: u.created_at ?? '',
    updated_at: '',
  };
}

function _providerFromUser(u: User | null): AuthProviderType {
  const p = u?.app_metadata?.provider;
  if (p === 'discord' || p === 'twitch') return p;
  return null;
}

const PROFILE_FETCH_TIMEOUT_MS = 2_000;
const PROFILE_COLUMNS = 'id,email,username,avatar_url,role,pro_source,pro_expires_at,created_at,updated_at';

async function _fetchProfile(userId: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const timeout = new Promise<null>(r => setTimeout(() => r(null), PROFILE_FETCH_TIMEOUT_MS));
    const query = supabase
      .from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single()
      .then(({ data, error }) => (error || !data ? null : (data as UserProfile)));
    return await Promise.race([query, timeout]);
  } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════════════
   Provider
═══════════════════════════════════════════════════════════════════ */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Synchronously restore cached auth state so the very first render
  // already shows the full app (no blank div, no LoginPage flash).
  const [cachedU] = useState(_readCachedUser);
  const [cachedP] = useState(_readCachedProfile);
  const hasCached = !!(cachedU && cachedP);

  const [user, setUser]                     = useState<User | null>(cachedU);
  const [profile, setProfile]               = useState<UserProfile | null>(cachedP ?? (cachedU ? _profileFromUser(cachedU) : null));
  const [loading, setLoading]               = useState(!hasCached);
  const [appReady, setAppReady]             = useState(hasCached);
  const [currentProvider, setCurrentProvider] = useState<AuthProviderType>(_readProvider);
  const [profileReady, setProfileReady] = useState(!!cachedP);

  const loginLockRef = useRef(false);

  /**
   * Set user + instant profile (from cache or synthesized from metadata)
   * so the header renders immediately without any skeleton.
   */
  const setUserWithProfile = useCallback((u: User) => {
    setUser(u);
    setCurrentProvider(_readProvider() || _providerFromUser(u));
    // Prefer cached DB profile (has real role/plan) → fall back to synthesized
    const cached = _readCachedProfile();
    if (cached && cached.id === u.id) {
      setProfile(cached);
      setProfileReady(true);
    } else {
      setProfile(_profileFromUser(u));
      setProfileReady(false);
    }
  }, []);

  /* ── Init: restore session + subscribe to auth changes ──────────── */
  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); setAppReady(true); return; }

    let mounted = true;

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (session?.user) {
          setUserWithProfile(session.user);
          // One-time fetch to hydrate the latest profile from DB.
          // After this, the realtime subscription handles all updates.
          const p = await _fetchProfile(session.user.id);
          if (p && mounted) { setProfile(p); _cacheProfile(p); setProfileReady(true); }
        } else if (hasCached) {
          // getSession() returned null but we had cached state.
          // Session truly expired/revoked — drop to login.
          setUser(null); setProfile(null); setCurrentProvider(null);
          _clearCustomStorage();
        }
      } catch {}
      finally { if (mounted) { setLoading(false); setAppReady(true); } }
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        if (event === 'INITIAL_SESSION') return;
        if (event === 'SIGNED_OUT') {
          setUser(null); setProfile(null); setCurrentProvider(null);
          // Only clear our custom keys — Supabase already manages its own
          // session token. Clearing it here caused lost sessions on restart
          // when SIGNED_OUT fired during transient token-refresh failures.
          _clearCustomStorage();
          return;
        }
        if (session?.user) {
          setUserWithProfile(session.user);
        }
      },
    );

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [setUserWithProfile]);

  /* ── Listen for tokens from Electron OAuth popup ────────────────── */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const ipc = (window as any).electron?.ipcRenderer;
    if (!ipc) return;

    const unsubImplicit = ipc.on('auth:callback',
      async ({ access_token, refresh_token }: { access_token: string; refresh_token: string }) => {
        try {
          const { data } = await supabase.auth.setSession({ access_token, refresh_token });
          // Session is now fully stored — fetch profile with valid token.
          const uid = data?.session?.user?.id;
          if (uid) {
            const p = await _fetchProfile(uid);
            if (p) { setProfile(p); _cacheProfile(p); setProfileReady(true); }
          }
        } catch {}
      },
    );
    const unsubPkce = ipc.on('auth:callback-code',
      async ({ code }: { code: string }) => {
        try {
          const { data } = await supabase.auth.exchangeCodeForSession(code);
          const uid = data?.session?.user?.id;
          if (uid) {
            const p = await _fetchProfile(uid);
            if (p) { setProfile(p); _cacheProfile(p); setProfileReady(true); }
          }
        } catch {}
      },
    );
    return () => {
      if (typeof unsubImplicit === 'function') unsubImplicit();
      if (typeof unsubPkce === 'function') unsubPkce();
    };
  }, []);

  /* ── Realtime: subscribe to own profile row for instant updates ─── */
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) return;

    const channel = supabase
      .channel(`profile-rt:${user.id}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload: any) => {
          if (payload.new) {
            const updated = payload.new as UserProfile;
            setProfile(updated);
            _cacheProfile(updated);
            setProfileReady(true);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  /* ── Actions ─────────────────────────────────────────────────────── */
  const login = useCallback(async (provider: 'discord' | 'twitch') => {
    if (!isSupabaseConfigured || loginLockRef.current) return;
    loginLockRef.current = true;
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
      });
      if (error || !data.url) return;
      _persistProvider(provider);
      setCurrentProvider(provider);
      const ipc = (window as any).electron?.ipcRenderer;
      if (ipc) ipc.invoke('auth:open-oauth', data.url).catch(() => {});
      else window.open(data.url, '_blank');
    } finally { loginLockRef.current = false; }
  }, []);

  const logout = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const ipc = (window as any).electron?.ipcRenderer;
    if (ipc) { try { await ipc.invoke('auth:clear-session'); } catch {} }
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setCurrentProvider(null); setProfileReady(false);
    _clearAllAuthStorage();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const p = await _fetchProfile(user.id);
    if (p) { setProfile(p); _cacheProfile(p); setProfileReady(true); }
  }, [user]);

  const cancelSubscription = useCallback(async () => {
    if (!user || !isSupabaseConfigured) return;
    await supabase.from('profiles').update({ subscription_status: 'cancelled' }).eq('id', user.id);
    await refreshProfile();
  }, [user, refreshProfile]);

  const grantPro = useCallback(async (userId: string, expiresAt: string | null): Promise<boolean> => {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase.from('profiles')
      .update({ role: 'pro', pro_source: 'manual', pro_expires_at: expiresAt, subscription_status: 'active' } as any)
      .eq('id', userId);
    return !error;
  }, []);

  const revokePro = useCallback(async (userId: string): Promise<boolean> => {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase.from('profiles')
      .update({ role: 'user', pro_source: null, pro_expires_at: null, subscription_status: null } as any)
      .eq('id', userId);
    return !error;
  }, []);

  /* ── Derived ─────────────────────────────────────────────────────── */
  const isExpired = _checkExpired(profile);
  const isOwner   = profile?.role === 'owner';
  const isAdmin   = profile?.role === 'admin' || isOwner;
  const isPro     = isAdmin || (profile?.role === 'pro' && !isExpired);

  return (
    <AuthContext.Provider value={{
      user, profile, profileReady, loading, appReady, isExpired, isPro, isAdmin, isOwner,
      currentProvider, login, logout, cancelSubscription, refreshProfile, grantPro, revokePro,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   Hook
═══════════════════════════════════════════════════════════════════ */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
