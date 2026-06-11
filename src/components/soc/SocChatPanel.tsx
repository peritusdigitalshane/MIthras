import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Bot, Send, X, Sparkles, RotateCcw, AlertCircle, FileText, Monitor, ShieldAlert, Brain, Loader2 } from "lucide-react";
import { useSocChat, type SocChatMessage } from "@/hooks/useSocChat";

/**
 * Slide-out conversational interface to the AI SOC. Triggered by a floating
 * action button (or programmatically). Persists session via localStorage so
 * the analyst can resume a thread across page navigations and reloads.
 *
 * Citation chips render alongside each assistant message and link directly
 * to the relevant alert/endpoint/incident page.
 */
export function SocChatPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, send, sending, error, startNewSession, sessionId } = useSocChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom when new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sending]);

  const submit = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    setInput("");
    await send(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="lg"
          className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg shadow-primary/30 p-0"
          aria-label="Open SOC chat"
        >
          <Sparkles className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md md:max-w-lg lg:max-w-xl p-0 flex flex-col">
        <SheetHeader className="border-b border-border/40 px-5 py-4">
          <SheetTitle className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <span>Ask the AI SOC</span>
            </div>
            {sessionId && (
              <Button variant="ghost" size="sm" onClick={startNewSession} title="Start new conversation">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </SheetTitle>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !sending && (
            <EmptySuggestions onPick={(s) => setInput(s)} />
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
          {sending && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Bot className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-card/60 border border-border/40">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Thinking...</span>
              </div>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-500">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}
        </div>

        <div className="border-t border-border/40 p-3 bg-background">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about an alert, endpoint, or incident..."
              disabled={sending}
              className="min-h-[44px] max-h-[160px] resize-none text-sm"
              rows={1}
            />
            <Button onClick={submit} disabled={sending || !input.trim()} size="icon" className="h-11 w-11 flex-shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 px-1">
            Press Enter to send. Shift+Enter for newline. Citations link to the cited rows.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmptySuggestions({ onPick }: { onPick: (s: string) => void }) {
  const SUGGESTIONS = [
    "What incidents are open right now?",
    "Summarise alerts from the last 24 hours.",
    "Are there any endpoints I should worry about?",
    "Which verdicts had disagreement between agents recently?",
  ];
  return (
    <div className="space-y-3">
      <div className="text-center pt-6 pb-2">
        <Bot className="h-10 w-10 text-primary/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Ask the AI SOC anything about your alerts, endpoints, or incidents.
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium px-1">
          Try
        </p>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="w-full text-left px-3 py-2.5 rounded-lg border border-border/40 bg-card/40 hover:bg-card/70 transition-colors text-sm"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: SocChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <Bot className="h-5 w-5 text-primary flex-shrink-0 mt-1" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="px-3.5 py-2.5 rounded-2xl bg-card/60 border border-border/40 text-sm leading-relaxed whitespace-pre-wrap">
          {msg.content}
        </div>
        {msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.citations.map((c, idx) => (
              <CitationChip key={`${c.kind}-${c.id}-${idx}`} kind={c.kind} id={c.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CitationChip({ kind, id }: { kind: string; id: string }) {
  const KIND_META: Record<string, { label: string; icon: React.ReactNode; href: string }> = {
    alert:        { label: "alert",        icon: <ShieldAlert className="h-3 w-3" />, href: `/alerts/${id}` },
    endpoint:     { label: "endpoint",     icon: <Monitor className="h-3 w-3" />,     href: `/endpoints/${id}` },
    incident:     { label: "incident",     icon: <AlertCircle className="h-3 w-3" />, href: `/incidents/${id}` },
    investigation:{ label: "investigation",icon: <FileText className="h-3 w-3" />,    href: `/alerts/${id}` },
    verdict:      { label: "verdict",      icon: <Brain className="h-3 w-3" />,       href: `/alerts/${id}` },
  };
  const meta = KIND_META[kind] ?? { label: kind, icon: <FileText className="h-3 w-3" />, href: "#" };
  return (
    <Link
      to={meta.href}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border/50 bg-background/50 text-[11px] text-foreground/80 hover:text-foreground hover:border-primary/50 transition-colors"
      title={`${meta.label} ${id}`}
    >
      {meta.icon}
      <span>{meta.label}</span>
      <span className="font-mono opacity-60">{id.slice(0, 8)}</span>
    </Link>
  );
}
