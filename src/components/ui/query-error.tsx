import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";

interface QueryErrorProps {
  /** The thrown error. Accepts `unknown` to match TanStack Query's typing. */
  error: unknown;
  /** Headline shown in the Alert. Default: "Couldn't load this page". */
  title?: string;
  /** Skip the surrounding MainLayout — use when already inside a layout. */
  bare?: boolean;
}

/**
 * Replaces the "stuck-loading-on-error" pattern that was hiding RPC failures
 * across the portal. Renders a destructive Alert with the error message and a
 * Try-again button that hard-reloads the page (sufficient for the moment;
 * future TanStack-aware retry can wire to `queryClient.refetchQueries`).
 */
export function QueryError({ error, title = "Couldn't load this page", bare = false }: QueryErrorProps) {
  const message = error instanceof Error ? error.message : String(error ?? "An unexpected error occurred.");
  const body = (
    <div className="p-6 max-w-3xl mx-auto">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p className="text-sm">{message}</p>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
  return bare ? body : <MainLayout>{body}</MainLayout>;
}
