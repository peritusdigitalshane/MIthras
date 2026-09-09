import { useState, useEffect } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuickSearch, detectIocType, type QuickSearchResult } from "@/hooks/useThreatHunting";
import { IocTypeIcon, getIocTypeLabel } from "./IocTypeIcon";
import { cn } from "@/lib/utils";

interface QuickIocSearchProps {
  onResultClick?: (result: QuickSearchResult) => void;
  initialValue?: string;
}

export function QuickIocSearch({ onResultClick, initialValue = "" }: QuickIocSearchProps) {
  const [searchValue, setSearchValue] = useState(initialValue);
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const quickSearch = useQuickSearch();

  // Auto-search when initialValue is provided
  useEffect(() => {
    if (initialValue) {
      setSearchValue(initialValue);
      quickSearch.mutateAsync(initialValue).then((searchResults) => {
        setResults(searchResults);
        setHasSearched(true);
      });
    }
  }, [initialValue]);

  const detectedType = searchValue.trim() ? detectIocType(searchValue) : null;

  const handleSearch = async () => {
    if (!searchValue.trim()) return;
    
    const searchResults = await quickSearch.mutateAsync(searchValue);
    setResults(searchResults);
    setHasSearched(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const sourceLabels: Record<string, string> = {
    discovered_apps: "Discovered Apps",
    threats: "Threats",
    event_logs: "Event Logs",
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">Quick IOC Search</h3>
              {detectedType && (
                <Badge variant="outline" className="ml-2">
                  <IocTypeIcon type={detectedType.type} className="mr-1" />
                  {getIocTypeLabel(detectedType.type)}
                  {detectedType.hashType && ` (${detectedType.hashType.toUpperCase()})`}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Enter SHA256, MD5, file path, file name, or process name..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1"
              />
              <Button 
                onClick={handleSearch} 
                disabled={!searchValue.trim() || quickSearch.isPending}
              >
                {quickSearch.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Hunt"
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Search across discovered applications, threats, and event logs for indicators of compromise
            </p>
          </div>
        </CardContent>
      </Card>

      {hasSearched && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              Results ({results.length})
            </h4>
            {results.length > 0 && (
              <Badge variant="secondary">
                {new Set(results.map(r => r.endpoint_id)).size} endpoints affected
              </Badge>
            )}
          </div>

          {results.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No matches found for this IOC</p>
                <p className="text-sm">This is a good sign - no compromise indicators detected</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {results.map((result, index) => (
                <Card 
                  key={index}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-muted/50",
                    onResultClick && "hover:border-primary/50"
                  )}
                  onClick={() => onResultClick?.(result)}
                >
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {sourceLabels[result.source]}
                          </Badge>
                          <span className="text-sm font-medium truncate">
                            {result.endpoint_hostname}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground font-mono truncate">
                          {result.matched_value}
                        </p>
                        {result.context.file_path && (
                          <p className="text-xs text-muted-foreground truncate mt-1">
                            {result.context.file_path as string}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
