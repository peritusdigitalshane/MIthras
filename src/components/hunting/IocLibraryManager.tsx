import { useState } from "react";
import { Plus, Trash2, Edit, MoreHorizontal, Power, PowerOff, Search, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useIocLibrary, useVirusTotalLookup, detectIocType, type Ioc, type IocType, type Severity, type IocSource, type VTEnrichmentData, type IocCreateInput } from "@/hooks/useThreatHunting";
import { IocTypeIcon, getIocTypeLabel } from "./IocTypeIcon";
import { IocImportDialog } from "./IocImportDialog";
import { IocEnrichmentDialog } from "./IocEnrichmentDialog";
import { formatDistanceToNow } from "date-fns";

const severityColors: Record<Severity, string> = {
  low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  critical: "bg-red-500/10 text-red-500 border-red-500/20",
};

function getDetectionBadgeStyle(detectionRatio: string): string {
  const [detected, total] = detectionRatio.split("/").map(Number);
  if (detected === 0) {
    return "bg-green-500/10 text-green-500 border-green-500/20";
  }
  if (detected / total < 0.1) {
    return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
  }
  return "bg-red-500/10 text-red-500 border-red-500/20";
}

export function IocLibraryManager() {
  const { iocs, isLoading, createIoc, updateIoc, deleteIoc } = useIocLibrary();
  const vtLookup = useVirusTotalLookup();
  const [searchFilter, setSearchFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<IocType | "all">("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingIoc, setEditingIoc] = useState<Ioc | null>(null);
  const [lookupLoadingId, setLookupLoadingId] = useState<string | null>(null);
  
  // Enrichment dialog state
  const [showEnrichmentDialog, setShowEnrichmentDialog] = useState(false);
  const [selectedEnrichment, setSelectedEnrichment] = useState<{
    iocValue: string;
    enrichment: VTEnrichmentData | null;
    enrichedAt: string | null;
  } | null>(null);
  
  // Form state
  const [formValue, setFormValue] = useState("");
  const [formType, setFormType] = useState<IocType>("file_hash");
  const [formSeverity, setFormSeverity] = useState<Severity>("medium");
  const [formSource, setFormSource] = useState<IocSource>("manual");
  const [formThreatName, setFormThreatName] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const filteredIocs = iocs.filter((ioc) => {
    const matchesSearch = 
      ioc.value.toLowerCase().includes(searchFilter.toLowerCase()) ||
      ioc.threat_name?.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesType = typeFilter === "all" || ioc.ioc_type === typeFilter;
    return matchesSearch && matchesType;
  });

  const resetForm = () => {
    setFormValue("");
    setFormType("file_hash");
    setFormSeverity("medium");
    setFormSource("manual");
    setFormThreatName("");
    setFormDescription("");
    setEditingIoc(null);
  };

  const handleValueChange = (value: string) => {
    setFormValue(value);
    if (!editingIoc) {
      const detected = detectIocType(value);
      setFormType(detected.type);
    }
  };

  const handleSave = async () => {
    const detection = detectIocType(formValue);
    const iocData: IocCreateInput = {
      value: formValue.trim(),
      ioc_type: formType,
      hash_type: detection.hashType ?? null,
      severity: formSeverity,
      source: formSource,
      threat_name: formThreatName || null,
      description: formDescription || null,
      is_active: true,
      tags: [],
      created_by: null,
    };

    if (editingIoc) {
      await updateIoc.mutateAsync({ id: editingIoc.id, ...iocData });
    } else {
      await createIoc.mutateAsync(iocData);
    }
    
    setShowAddDialog(false);
    resetForm();
  };

  const handleEdit = (ioc: Ioc) => {
    setEditingIoc(ioc);
    setFormValue(ioc.value);
    setFormType(ioc.ioc_type);
    setFormSeverity(ioc.severity);
    setFormSource(ioc.source);
    setFormThreatName(ioc.threat_name ?? "");
    setFormDescription(ioc.description ?? "");
    setShowAddDialog(true);
  };

  const handleToggleActive = async (ioc: Ioc) => {
    await updateIoc.mutateAsync({ id: ioc.id, is_active: !ioc.is_active });
  };

  const handleVirusTotalLookup = async (ioc: Ioc) => {
    setLookupLoadingId(ioc.id);
    try {
      await vtLookup.mutateAsync({ hash: ioc.value, iocId: ioc.id });
    } finally {
      setLookupLoadingId(null);
    }
  };

  const handleViewEnrichment = (ioc: Ioc) => {
    setSelectedEnrichment({
      iocValue: ioc.value,
      enrichment: ioc.vt_enrichment as VTEnrichmentData | null,
      enrichedAt: ioc.vt_enriched_at ?? null,
    });
    setShowEnrichmentDialog(true);
  };

  const isHashType = (ioc: Ioc) => ioc.ioc_type === "file_hash";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1">
          <Input
            placeholder="Search IOCs..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="max-w-xs"
          />
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as IocType | "all")}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="file_hash">File Hash</SelectItem>
              <SelectItem value="file_path">File Path</SelectItem>
              <SelectItem value="file_name">File Name</SelectItem>
              <SelectItem value="process_name">Process Name</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImportDialog(true)}>
            Import
          </Button>
          <Button onClick={() => { resetForm(); setShowAddDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add IOC
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Threat Name</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>VT Score</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading IOCs...
                </TableCell>
              </TableRow>
            ) : filteredIocs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No IOCs found. Add your first indicator of compromise.
                </TableCell>
              </TableRow>
            ) : (
              filteredIocs.map((ioc) => (
                <TableRow key={ioc.id} className={!ioc.is_active ? "opacity-50" : ""}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <IocTypeIcon type={ioc.ioc_type} />
                      <span className="text-xs">{getIocTypeLabel(ioc.ioc_type)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm max-w-[300px] truncate">
                    {ioc.value}
                  </TableCell>
                  <TableCell>{ioc.threat_name ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={severityColors[ioc.severity]}>
                      {ioc.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {ioc.vt_detection_ratio ? (
                      <Badge
                        variant="outline"
                        className={`cursor-pointer ${getDetectionBadgeStyle(ioc.vt_detection_ratio)}`}
                        onClick={() => handleViewEnrichment(ioc)}
                      >
                        {ioc.vt_detection_ratio}
                      </Badge>
                    ) : isHashType(ioc) ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className="capitalize">{ioc.source}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDistanceToNow(new Date(ioc.created_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="IOC options">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isHashType(ioc) && (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleVirusTotalLookup(ioc)}
                              disabled={lookupLoadingId === ioc.id}
                            >
                              {lookupLoadingId === ioc.id ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Search className="h-4 w-4 mr-2" />
                              )}
                              Lookup on VirusTotal
                            </DropdownMenuItem>
                            {ioc.vt_enrichment && (
                              <DropdownMenuItem onClick={() => handleViewEnrichment(ioc)}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                View VT Results
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem onClick={() => handleEdit(ioc)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleActive(ioc)}>
                          {ioc.is_active ? (
                            <>
                              <PowerOff className="h-4 w-4 mr-2" />
                              Disable
                            </>
                          ) : (
                            <>
                              <Power className="h-4 w-4 mr-2" />
                              Enable
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => deleteIoc.mutate(ioc.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit IOC Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingIoc ? "Edit IOC" : "Add IOC"}</DialogTitle>
            <DialogDescription>
              {editingIoc ? "Update the indicator of compromise" : "Add a new indicator of compromise to your library"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Value *</Label>
              <Input
                placeholder="SHA256, file path, process name..."
                value={formValue}
                onChange={(e) => handleValueChange(e.target.value)}
              />
              {formValue && (
                <p className="text-xs text-muted-foreground">
                  Detected type: {getIocTypeLabel(detectIocType(formValue).type)}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formType} onValueChange={(v) => setFormType(v as IocType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="file_hash">File Hash</SelectItem>
                    <SelectItem value="file_path">File Path</SelectItem>
                    <SelectItem value="file_name">File Name</SelectItem>
                    <SelectItem value="process_name">Process Name</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={formSeverity} onValueChange={(v) => setFormSeverity(v as Severity)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source</Label>
                <Select value={formSource} onValueChange={(v) => setFormSource(v as IocSource)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="virustotal">VirusTotal</SelectItem>
                    <SelectItem value="alienvault">AlienVault</SelectItem>
                    <SelectItem value="misp">MISP</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Threat Name</Label>
                <Input
                  placeholder="e.g., Emotet, Cobalt Strike"
                  value={formThreatName}
                  onChange={(e) => setFormThreatName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Additional context about this IOC..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={!formValue.trim() || createIoc.isPending || updateIoc.isPending}
            >
              {editingIoc ? "Update" : "Add"} IOC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IocImportDialog open={showImportDialog} onOpenChange={setShowImportDialog} />
      
      <IocEnrichmentDialog
        open={showEnrichmentDialog}
        onOpenChange={setShowEnrichmentDialog}
        iocValue={selectedEnrichment?.iocValue ?? ""}
        enrichment={selectedEnrichment?.enrichment ?? null}
        enrichedAt={selectedEnrichment?.enrichedAt ?? null}
      />
    </div>
  );
}
