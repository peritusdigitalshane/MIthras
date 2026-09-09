import { useState } from "react";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useIocLibrary, detectIocType, type Severity, type IocSource, type IocCreateInput } from "@/hooks/useThreatHunting";

interface IocImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IocImportDialog({ open, onOpenChange }: IocImportDialogProps) {
  const { bulkCreateIocs } = useIocLibrary();
  const [importText, setImportText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ value: string; type: string }[]>([]);

  const parseImport = (text: string) => {
    setParseError(null);
    const lines = text.split("\n").filter(line => line.trim());
    
    if (lines.length === 0) {
      setPreview([]);
      return;
    }

    // Try to detect format (JSON or CSV/plain text)
    const trimmedFirst = lines[0].trim();
    
    if (trimmedFirst.startsWith("[") || trimmedFirst.startsWith("{")) {
      // JSON format
      try {
        const parsed = JSON.parse(text);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        setPreview(items.slice(0, 10).map(item => ({
          value: item.value || item.ioc || item.indicator || "",
          type: item.type || item.ioc_type || "auto-detect",
        })));
      } catch {
        setParseError("Invalid JSON format");
        setPreview([]);
      }
    } else {
      // Plain text / CSV format (one IOC per line)
      const iocs = lines.slice(0, 10).map(line => {
        const parts = line.split(",").map(p => p.trim());
        const value = parts[0];
        const detection = detectIocType(value);
        return { value, type: detection.type };
      });
      setPreview(iocs);
    }
  };

  const handleTextChange = (text: string) => {
    setImportText(text);
    parseImport(text);
  };

  const handleImport = async () => {
    const lines = importText.split("\n").filter(line => line.trim());
    
    if (lines.length === 0) return;

    const trimmedFirst = lines[0].trim();
    let iocs: { value: string; type: string; severity?: string; source?: string; threat_name?: string }[] = [];

    if (trimmedFirst.startsWith("[") || trimmedFirst.startsWith("{")) {
      try {
        const parsed = JSON.parse(importText);
        iocs = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return;
      }
    } else {
      iocs = lines.map(line => {
        const parts = line.split(",").map(p => p.trim());
        return { value: parts[0], type: parts[1] || "auto" };
      });
    }

    const formattedIocs: IocCreateInput[] = iocs.map(ioc => {
      const detection = detectIocType(ioc.value);
      return {
        value: ioc.value.trim(),
        ioc_type: (ioc.type === "auto" || ioc.type === "auto-detect") ? detection.type : (ioc.type as "file_hash" | "file_path" | "file_name" | "process_name"),
        hash_type: detection.hashType ?? null,
        severity: (ioc.severity as Severity) || "medium",
        source: (ioc.source as IocSource) || "manual",
        threat_name: ioc.threat_name || null,
        description: null,
        is_active: true,
        tags: [],
        created_by: null,
      };
    });

    await bulkCreateIocs.mutateAsync(formattedIocs);
    setImportText("");
    setPreview([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import IOCs
          </DialogTitle>
          <DialogDescription>
            Import indicators of compromise from JSON or plain text format
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Textarea
              placeholder={`Paste IOCs here...

Supported formats:
• Plain text (one per line):
  d41d8cd98f00b204e9800998ecf8427e
  C:\\Windows\\Temp\\malware.exe
  suspicious.exe

• JSON array:
  [{"value": "hash...", "severity": "high", "threat_name": "Emotet"}]`}
              value={importText}
              onChange={(e) => handleTextChange(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
            />
          </div>

          {parseError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          {preview.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Preview ({preview.length} IOCs)
              </h4>
              <div className="bg-muted rounded-md p-3 max-h-[150px] overflow-y-auto">
                <ul className="space-y-1 text-sm font-mono">
                  {preview.map((item, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span className="truncate flex-1">{item.value}</span>
                      <span className="text-xs text-muted-foreground">({item.type})</span>
                    </li>
                  ))}
                  {importText.split("\n").filter(l => l.trim()).length > 10 && (
                    <li className="text-muted-foreground">
                      ... and {importText.split("\n").filter(l => l.trim()).length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={preview.length === 0 || !!parseError || bulkCreateIocs.isPending}
          >
            Import {preview.length} IOCs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
