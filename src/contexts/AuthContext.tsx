import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  signOut: async () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

// Sign out after this many milliseconds of zero user input. SOC workstations
// commonly live on shared screens — this prevents an unattended browser from
// staying authenticated indefinitely.
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const idleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setIsLoading(false);
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Idle-timeout sign-out. Resets every user input event; if the timer ever
  // reaches IDLE_TIMEOUT_MS, the session is signed out and the auth state
  // listener above will navigate the rest of the app accordingly.
  useEffect(() => {
    if (!user) {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    const reset = () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        void supabase.auth.signOut();
      }, IDLE_TIMEOUT_MS);
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove", "mousedown", "keydown", "touchstart", "scroll", "visibilitychange",
    ];
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    reset();

    return () => {
      for (const ev of events) window.removeEventListener(ev, reset);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [user]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
