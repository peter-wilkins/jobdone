import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://dtwuflwgcwxygjgkvzfl.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Pz0DTPNoldMvAf4aaQ8Fkw_UeH_Cq0Q';
const DEFAULT_APP_URL = 'https://frontend-jobdone1.vercel.app';
const ENV = import.meta.env || {};

const supabaseUrl = ENV.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = ENV.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const appUrl = ENV.VITE_APP_URL || DEFAULT_APP_URL;

// Supabase client — null if env vars not set (auth disabled)
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
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
    const redirectTo = appUrl || window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
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
