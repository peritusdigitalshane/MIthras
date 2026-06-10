import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Compass, ArrowLeft, Home, LifeBuoy } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-muted/30 p-6">
      <div className="max-w-md w-full bg-card border rounded-2xl shadow-lg p-8 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-5">
          <Compass className="h-7 w-7 text-primary" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">404</p>
        <h1 className="text-2xl font-bold mb-2">This page took a wrong turn</h1>
        <p className="text-sm text-muted-foreground mb-6">
          We couldn't find <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{location.pathname}</code>.
          It might have moved, or you may have followed a stale link.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Go back
          </Button>
          <Button asChild>
            <Link to="/"><Home className="h-4 w-4 mr-2" /> Home</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Still stuck? <Link to="/glossary" className="underline">Browse the glossary</Link>
          {" "}or{" "}
          <a href="mailto:support@mithras.com.au" className="underline">
            <LifeBuoy className="h-3 w-3 inline-block mr-0.5" /> email support
          </a>.
        </p>
      </div>
    </div>
  );
};

export default NotFound;
