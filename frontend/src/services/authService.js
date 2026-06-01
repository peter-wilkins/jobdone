import { createClient } from '@supabase/supabase-js';

const env = import.meta.env || {};
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
const appUrl = env.VITE_APP_URL;

// Supabase client — null if env vars not set (auth disabled)
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function defaultAuthRedirectTo() {
  return appUrl || globalThis.window?.location?.origin || 'http://localhost:5173';
}

export class AuthService {
  constructor({ supabaseClient = supabase, redirectTo = defaultAuthRedirectTo } = {}) {
    this.supabase = supabaseClient;
    this.redirectTo = redirectTo;
    this.session = null;
    this._listeners = new Set();

    if (this.supabase) {
      this.supabase.auth.onAuthStateChange((event, session) => {
        this.session = session;
        this._listeners.forEach(fn => fn(event, session));
      });
    }
  }

  /** Call once on app load — restores existing session */
  async init() {
    if (!this.supabase) return null;
    const { data: { session } } = await this.supabase.auth.getSession();
    this.session = session;
    return session;
  }

  async signInWithGoogle() {
    if (!this.supabase) throw new Error('Auth not configured');
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: this.redirectTo() },
    });
    if (error) throw error;
  }

  async signOut() {
    if (!this.supabase) return;
    await this.supabase.auth.signOut();
    this.session = null;
  }

  isConfigured() { return !!this.supabase; }
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
