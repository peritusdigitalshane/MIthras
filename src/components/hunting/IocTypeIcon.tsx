import { Hash, FolderOpen, FileText, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IocType } from "@/hooks/useThreatHunting";

interface IocTypeIconProps {
  type: IocType;
  className?: string;
}

const iconMap: Record<IocType, React.ComponentType<{ className?: string }>> = {
  file_hash: Hash,
  file_path: FolderOpen,
  file_name: FileText,
  process_name: Cpu,
};

const labelMap: Record<IocType, string> = {
  file_hash: "Hash",
  file_path: "Path",
  file_name: "File",
  process_name: "Process",
};

export function IocTypeIcon({ type, className }: IocTypeIconProps) {
  const Icon = iconMap[type];
  return <Icon className={cn("h-4 w-4", className)} />;
}

export function getIocTypeLabel(type: IocType): string {
  return labelMap[type];
}
