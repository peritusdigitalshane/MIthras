import { useState } from "react";
import { Plus, X, FolderOpen, FileCode, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface ExclusionsEditorProps {
  exclusionPaths: string[];
  exclusionProcesses: string[];
  exclusionExtensions: string[];
  onPathsChange: (paths: string[]) => void;
  onProcessesChange: (processes: string[]) => void;
  onExtensionsChange: (extensions: string[]) => void;
}

export function ExclusionsEditor({
  exclusionPaths,
  exclusionProcesses,
  exclusionExtensions,
  onPathsChange,
  onProcessesChange,
  onExtensionsChange,
}: ExclusionsEditorProps) {
  const [newPath, setNewPath] = useState("");
  const [newProcess, setNewProcess] = useState("");
  const [newExtension, setNewExtension] = useState("");

  const addPath = () => {
    if (newPath.trim() && !exclusionPaths.includes(newPath.trim())) {
      onPathsChange([...exclusionPaths, newPath.trim()]);
      setNewPath("");
    }
  };

  const removePath = (path: string) => {
    onPathsChange(exclusionPaths.filter((p) => p !== path));
  };

  const addProcess = () => {
    if (newProcess.trim() && !exclusionProcesses.includes(newProcess.trim())) {
      onProcessesChange([...exclusionProcesses, newProcess.trim()]);
      setNewProcess("");
    }
  };

  const removeProcess = (process: string) => {
    onProcessesChange(exclusionProcesses.filter((p) => p !== process));
  };

  const addExtension = () => {
    let ext = newExtension.trim();
    if (ext && !ext.startsWith(".")) ext = "." + ext;
    if (ext && !exclusionExtensions.includes(ext)) {
      onExtensionsChange([...exclusionExtensions, ext]);
      setNewExtension("");
    }
  };

  const removeExtension = (ext: string) => {
    onExtensionsChange(exclusionExtensions.filter((e) => e !== ext));
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/40 bg-card p-4 mb-4">
        <p className="text-sm text-muted-foreground">
          Exclusions prevent Windows Defender from scanning or blocking specific paths, processes, or file types.
          Use these to whitelist trusted applications like the Mithras agent.
        </p>
      </div>

      {/* Path Exclusions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Path Exclusions</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Folders or files to exclude from scanning (e.g., C:\ProgramData\Mithras\)
        </p>
        <div className="flex gap-2">
          <Input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="C:\ProgramData\Mithras\"
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPath())}
          />
          <Button type="button" variant="outline" size="icon" onClick={addPath}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {exclusionPaths.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {exclusionPaths.map((path) => (
              <Badge key={path} variant="secondary" className="gap-1 pr-1">
                <code className="text-xs">{path}</code>
                <button
                  type="button"
                  onClick={() => removePath(path)}
                  className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Process Exclusions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Process Exclusions</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Process names to exclude (e.g., powershell.exe)
        </p>
        <div className="flex gap-2">
          <Input
            value={newProcess}
            onChange={(e) => setNewProcess(e.target.value)}
            placeholder="powershell.exe"
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addProcess())}
          />
          <Button type="button" variant="outline" size="icon" onClick={addProcess}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {exclusionProcesses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {exclusionProcesses.map((process) => (
              <Badge key={process} variant="secondary" className="gap-1 pr-1">
                <code className="text-xs">{process}</code>
                <button
                  type="button"
                  onClick={() => removeProcess(process)}
                  className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Extension Exclusions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Extension Exclusions</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          File extensions to exclude (e.g., .ps1, .log)
        </p>
        <div className="flex gap-2">
          <Input
            value={newExtension}
            onChange={(e) => setNewExtension(e.target.value)}
            placeholder=".ps1"
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExtension())}
          />
          <Button type="button" variant="outline" size="icon" onClick={addExtension}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {exclusionExtensions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {exclusionExtensions.map((ext) => (
              <Badge key={ext} variant="secondary" className="gap-1 pr-1">
                <code className="text-xs">{ext}</code>
                <button
                  type="button"
                  onClick={() => removeExtension(ext)}
                  className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
