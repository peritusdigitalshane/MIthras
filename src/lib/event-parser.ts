import { ASR_RULES } from "./defender-settings";

export interface AsrEventData {
  asrRuleId: string;
  asrRuleName: string;
  path: string;
  processName: string;
  user: string;
  detectionTime: string;
}

/**
 * Parse ASR/Exploit Guard audit event messages to extract key fields.
 * Returns null if the message cannot be parsed.
 */
export function parseAsrEventMessage(message: string): AsrEventData | null {
  if (!message) return null;

  // Extract ID (GUID)
  const idMatch = message.match(/ID:\s*([0-9A-Fa-f-]{36})/i);
  if (!idMatch) return null;

  const asrRuleId = idMatch[1].toLowerCase();

  // Look up the rule name from ASR_RULES
  const rule = ASR_RULES.find(
    (r) => r.guid.toLowerCase() === asrRuleId
  );
  const asrRuleName = rule?.name ?? "Unknown ASR Rule";

  // Extract Path (the triggering process)
  const pathMatch = message.match(/Path:\s*(.+?)(?:\r?\n|$)/i);
  const path = pathMatch?.[1]?.trim() ?? "";

  // Extract Process Name (the target process)
  const processNameMatch = message.match(/Process Name:\s*(.+?)(?:\r?\n|$)/i);
  const processName = processNameMatch?.[1]?.trim() ?? "";

  // Extract User
  const userMatch = message.match(/User:\s*(.+?)(?:\r?\n|$)/i);
  const user = userMatch?.[1]?.trim() ?? "";

  // Extract Detection time
  const detectionTimeMatch = message.match(/Detection time:\s*(.+?)(?:\r?\n|$)/i);
  const detectionTime = detectionTimeMatch?.[1]?.trim() ?? "";

  // If we couldn't extract the path, return null
  if (!path) return null;

  return {
    asrRuleId,
    asrRuleName,
    path,
    processName,
    user,
    detectionTime,
  };
}

/**
 * Check if an event is an ASR audit/block event based on event ID.
 * 1121 = ASR rule audited (would have blocked)
 * 1122 = ASR rule blocked
 */
export function isAsrEvent(eventId: number): boolean {
  return eventId === 1121 || eventId === 1122;
}

/**
 * Extract just the executable name from a full path.
 * e.g., "C:\Windows\System32\svchost.exe" -> "svchost.exe"
 */
export function getProcessNameFromPath(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}
