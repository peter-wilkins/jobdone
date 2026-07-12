import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://dtwuflwgcwxygjgkvzfl.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Pz0DTPNoldMvAf4aaQ8Fkw_UeH_Cq0Q';
const ENV = import.meta.env || {};

const supabaseUrl = ENV.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = ENV.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function isJobDoneAuthOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname)) return true;
    if (url.protocol !== 'https:') return false;
    return [
      'jobdone-staging.vercel.app',
      'jobdone-frontend-staging.vercel.app',
      'jobdone-frontend-production.vercel.app',
      'jobdone.continuumkit.org',
      'shiny-art-shop.continuumkit.org',
    ].includes(hostname);
  } catch {
    return false;
  }
}

export const authClientOptions = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
};

export function authRedirectUrl({
  configuredAppUrl = ENV.VITE_APP_URL,
  location = globalThis.window?.location,
  userAgent = globalThis.navigator?.userAgent,
} = {}) {
  const nativeShellCallbackUrl = nativeShellAuthCallbackUrl(userAgent);
  if (nativeShellCallbackUrl) return nativeShellCallbackUrl;
  const currentOrigin = trimTrailingSlash(location?.origin);
  if (isJobDoneAuthOrigin(currentOrigin)) return currentOrigin;
  return trimTrailingSlash(configuredAppUrl || currentOrigin);
}

export function isNativeShellUserAgent(userAgent) {
  return nativeShellAuthCallbackUrl(userAgent) !== null;
}

export function nativeShellAuthCallbackUrl(userAgent) {
  const text = String(userAgent || '');
  if (text.includes('JobDoneNativeShell/0.1.0 production')) return 'jobdone://auth-callback';
  if (text.includes('JobDoneNativeShell/0.1.0 staging')) return 'jobdone-staging://auth-callback';
  return null;
}

export function consumeAuthErrorFromLocation({
  location = globalThis.window?.location,
  history = globalThis.window?.history,
} = {}) {
  const hash = String(location?.hash || '');
  if (!hash.startsWith('#error=')) return null;

  const params = new URLSearchParams(hash.slice(1));
  const errorCode = params.get('error_code') || params.get('error') || 'auth_error';
  const errorDescription = params.get('error_description') || 'Sign-in link failed. Request a fresh magic link.';
  const cleanUrl = `${location?.pathname || '/'}${location?.search || ''}`;

  try {
    history?.replaceState?.({}, '', cleanUrl);
  } catch {
    // Best effort: stale auth fragments should not keep re-warning on reload.
  }

  return {
    code: errorCode,
    message: errorDescription,
  };
}

// Supabase client — null if env vars not set (auth disabled)
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, authClientOptions)
  : null;

class AuthService {
  constructor() {
    this.session = null;
    this._listeners = new Set();

    if (supabase) {
      supabase.auth.onAuthStateChange((event, session) => {
        this.session = session;
        this._listeners.forEach(fn => fn(event, session));
      });
    }
  }

  /** Call once on app load — restores existing session */
  async init() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    this.session = session;
    return session;
  }

  /**
   * Send a magic link to the given email.
   * If a Supabase account already exists it signs in; otherwise creates one.
   */
  async sendMagicLink(email) {
    if (!supabase) throw new Error('Auth not configured');
    const redirectTo = authRedirectUrl();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    });
    if (error) throw error;
  }

  /** Sign in with Google OAuth via Supabase. Redirects to Google then back. */
  async signInWithGoogle() {
    if (!supabase) throw new Error('Auth not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authRedirectUrl(),
      },
    });
    if (error) throw error;
  }

  /**
   * Returns key material for E2EE Data Key derivation.
   * Currently null — will be populated when passkey/WebAuthn PRF is implemented.
   */
  getDataKeyMaterial() {
    return null;
  }

  async signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    this.session = null;
  }

  isLoggedIn()  { return !!this.session?.user; }
  getUser()     { return this.session?.user || null; }
  getUserId()   { return this.session?.user?.id || null; }
  getToken()    { return this.session?.access_token || null; }
  getEmail()    { return this.session?.user?.email || null; }

  /** Subscribe to auth state changes. Returns an unsubscribe function. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}

export const authService = new AuthService();
