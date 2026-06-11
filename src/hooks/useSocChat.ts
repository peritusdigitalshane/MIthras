import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SocChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  citations: Array<{ kind: string; id: string; label: string }>;
  model?: string;
  cost_microcents?: number;
  latency_ms?: number;
  created_at: string;
}

interface UseSocChatOptions {
  /** Optional organisation scope (super-admin can switch). Omit for the user's own orgs. */
  organizationId?: string;
}

/** Persistent across reloads via localStorage so analysts can resume conversations. */
const SESSION_STORAGE_KEY = "mithras.socchat.session";

export function useSocChat(opts: UseSocChatOptions = {}) {
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
  });
  const [messages, setMessages] = useState<SocChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist session id whenever it changes.
  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch { /* ignore */ }
  }, [sessionId]);

  // Load history when sessionId arrives.
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("ai_chat_messages")
        .select("id, role, content, citations, model, cost_microcents, latency_ms, created_at")
        .eq("session_id", sessionId)
        .order("created_at");
      if (cancelled) return;
      if (error) {
        // Session might have been deleted — clear it.
        setSessionId(null);
        return;
      }
      setMessages((data ?? []) as SocChatMessage[]);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const send = useCallback(async (message: string) => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);

    // Optimistically show user message immediately.
    const tempId = `tmp_${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tempId,
      role: "user",
      content: message,
      citations: [],
      created_at: new Date().toISOString(),
    }]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("not_authenticated");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-soc-chat`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            session_id: sessionId,
            organization_id: opts.organizationId,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error ?? `http_${resp.status}`);
      }

      // Update sessionId if this was the first turn.
      if (!sessionId && data.session_id) {
        setSessionId(data.session_id);
      }

      const assistantMsg: SocChatMessage = data.assistant_message;
      // Re-pull canonical history so the optimistic user message is replaced
      // by the persisted one (matching IDs).
      const { data: history } = await supabase
        .from("ai_chat_messages")
        .select("id, role, content, citations, model, cost_microcents, latency_ms, created_at")
        .eq("session_id", data.session_id)
        .order("created_at");
      setMessages((history ?? []) as SocChatMessage[]);
      return assistantMsg;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Remove the optimistic user message — it didn't make it through.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      return null;
    } finally {
      setSending(false);
    }
  }, [sending, sessionId, opts.organizationId]);

  const startNewSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setError(null);
  }, []);

  return {
    sessionId,
    messages,
    send,
    sending,
    error,
    startNewSession,
  };
}
