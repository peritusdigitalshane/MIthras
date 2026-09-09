import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { Footer } from "@/components/landing/CTAFooter";
import { Seo } from "@/components/seo/Seo";

type State =
  | { kind: "loading" }
  | { kind: "released"; recipient?: string }
  | { kind: "already" }
  | { kind: "expired" }
  | { kind: "error"; reason: string };

export default function EmailRelease() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) { setState({ kind: "error", reason: "missing_token" }); return; }
    const run = async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/m365-email-release?token=${encodeURIComponent(token)}`;
        const resp = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data?.released) { setState({ kind: "released", recipient: data.recipient }); return; }
        if (resp.ok && data?.already_released) { setState({ kind: "already" }); return; }
        if (resp.status === 410 || data?.error === "token_expired") { setState({ kind: "expired" }); return; }
        setState({ kind: "error", reason: data?.error ?? `http_${resp.status}` });
      } catch (e: any) {
        setState({ kind: "error", reason: e?.message ?? "network_error" });
      }
    };
    run();
  }, [token]);

  return (
    <>
      <Seo title="Release email | Mithras" description="Release a Mithras-flagged email back to your Inbox." canonical="/email-release" noindex />
      <div className="min-h-screen bg-background">
        <LandingNav />
        <section className="pt-32 pb-16 px-4 sm:px-6">
          <div className="container mx-auto max-w-xl">
            <div className="rounded-2xl border bg-card p-8 text-center">
              {state.kind === "loading" && (
                <>
                  <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
                  <h1 className="text-xl font-semibold mt-4">Releasing the email…</h1>
                  <p className="text-sm text-muted-foreground mt-2">One moment while we move the message back to your Inbox.</p>
                </>
              )}
              {state.kind === "released" && (
                <>
                  <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-500" />
                  <h1 className="text-xl font-semibold mt-4">Released to your Inbox</h1>
                  <p className="text-sm text-muted-foreground mt-2">The message is back in {state.recipient ? <span className="font-medium text-foreground">{state.recipient}</span> : "your"} Inbox. You can close this tab.</p>
                </>
              )}
              {state.kind === "already" && (
                <>
                  <ShieldCheck className="h-12 w-12 mx-auto text-primary" />
                  <h1 className="text-xl font-semibold mt-4">Already released</h1>
                  <p className="text-sm text-muted-foreground mt-2">This email has already been moved back to the Inbox — nothing further to do.</p>
                </>
              )}
              {state.kind === "expired" && (
                <>
                  <AlertTriangle className="h-12 w-12 mx-auto text-amber-500" />
                  <h1 className="text-xl font-semibold mt-4">Link expired</h1>
                  <p className="text-sm text-muted-foreground mt-2">Release links are valid for 14 days. Ask your IT team to release the message from the Mithras console.</p>
                </>
              )}
              {state.kind === "error" && (
                <>
                  <AlertTriangle className="h-12 w-12 mx-auto text-destructive" />
                  <h1 className="text-xl font-semibold mt-4">Couldn't release the email</h1>
                  <p className="text-sm text-muted-foreground mt-2">Reason: <span className="font-mono">{state.reason}</span>. Forward this page to your IT team.</p>
                </>
              )}
            </div>
          </div>
        </section>
        <Footer />
      </div>
    </>
  );
}
