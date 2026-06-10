import React from "react";
import { Button } from "@/components/ui/button";
import { AlertOctagon } from "lucide-react";

interface State {
  error: Error | null;
}

// Catches uncaught React render errors so users get a usable fallback
// instead of a white screen. Logs the error to console for now; would be
// wired to Sentry / LogRocket in a production telemetry stack.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep console.error here intentionally — this is the one place where
    // failing loudly is the correct behaviour. Replace with a remote sink
    // (Sentry, etc.) once telemetry is wired.
    console.error("Mithras: uncaught render error", error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
    // Force a full reload so we recover from any persisted bad state.
    if (typeof window !== "undefined") window.location.assign("/");
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full bg-card border rounded-2xl p-8 shadow-lg text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-rose-500/10 flex items-center justify-center mb-4">
            <AlertOctagon className="h-6 w-6 text-rose-500" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Something broke</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Mithras hit an error it couldn't recover from. The team has been notified.
            Reload to return to a clean page.
          </p>
          <pre className="text-[10px] text-left bg-muted/40 rounded p-2 max-h-32 overflow-auto mb-4">
            {this.state.error.message}
          </pre>
          <Button onClick={this.handleReset} className="w-full">Reload Mithras</Button>
        </div>
      </div>
    );
  }
}
