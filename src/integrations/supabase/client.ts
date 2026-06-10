import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local for dev, or check your build mode .env file.'
  );
}

// XSS mitigation: keep the JWT out of localStorage so any successful
// script-injection on this origin can't ship the session token to an
// attacker. sessionStorage scopes to the tab and is cleared on close.
// Users get re-prompted to sign in if they close the tab, which is the
// correct trade-off for a SOC console.
//
// A future move to httpOnly cookies would be even stronger but requires
// server-side session bridging; sessionStorage is the right step today.
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
