import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";

// Per-user override key. Lives in localStorage so a road-warrior individual
// can pin their own zone independent of the org default. When unset, the
// hook falls through to the org's timezone, then to the platform default.
const USER_OVERRIDE_KEY = "user-timezone-override";

const DEFAULT_TIMEZONE = "Australia/Sydney";

// Common timezones grouped by region. Used by the partner-portal Settings
// select and by any per-user override picker.
export const TIMEZONE_OPTIONS = [
  { label: "UTC", value: "UTC" },
  // Australia
  { label: "Australia/Sydney (AEDT)", value: "Australia/Sydney" },
  { label: "Australia/Melbourne (AEDT)", value: "Australia/Melbourne" },
  { label: "Australia/Brisbane (AEST)", value: "Australia/Brisbane" },
  { label: "Australia/Perth (AWST)", value: "Australia/Perth" },
  { label: "Australia/Adelaide (ACDT)", value: "Australia/Adelaide" },
  // Americas
  { label: "America/New_York (EST)", value: "America/New_York" },
  { label: "America/Chicago (CST)", value: "America/Chicago" },
  { label: "America/Denver (MST)", value: "America/Denver" },
  { label: "America/Los_Angeles (PST)", value: "America/Los_Angeles" },
  { label: "America/Toronto (EST)", value: "America/Toronto" },
  // Europe
  { label: "Europe/London (GMT)", value: "Europe/London" },
  { label: "Europe/Paris (CET)", value: "Europe/Paris" },
  { label: "Europe/Berlin (CET)", value: "Europe/Berlin" },
  { label: "Europe/Amsterdam (CET)", value: "Europe/Amsterdam" },
  // Asia
  { label: "Asia/Tokyo (JST)", value: "Asia/Tokyo" },
  { label: "Asia/Singapore (SGT)", value: "Asia/Singapore" },
  { label: "Asia/Hong_Kong (HKT)", value: "Asia/Hong_Kong" },
  { label: "Asia/Dubai (GST)", value: "Asia/Dubai" },
  { label: "Asia/Kolkata (IST)", value: "Asia/Kolkata" },
  // Pacific
  { label: "Pacific/Auckland (NZDT)", value: "Pacific/Auckland" },
  { label: "Pacific/Fiji (FJT)", value: "Pacific/Fiji" },
];

function readUserOverride(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(USER_OVERRIDE_KEY);
}

export function useTimezone() {
  const { currentOrganization } = useTenant();
  const orgTimezone = currentOrganization?.timezone ?? null;

  // Resolution order: per-user override → org timezone → Australia/Sydney.
  // We pick on render so a user switching tenants picks up the new org zone
  // without a refresh.
  const [override, setOverrideState] = useState<string | null>(readUserOverride);

  // Re-sync if another tab changed the localStorage key.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === USER_OVERRIDE_KEY) setOverrideState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const timezone = override ?? orgTimezone ?? DEFAULT_TIMEZONE;

  // setTimezone sets the per-user override. To clear and fall back to the
  // org default, pass null.
  const setTimezone = (tz: string | null) => {
    if (tz === null || tz === "") {
      localStorage.removeItem(USER_OVERRIDE_KEY);
      setOverrideState(null);
    } else {
      localStorage.setItem(USER_OVERRIDE_KEY, tz);
      setOverrideState(tz);
    }
  };

  const formatInTimezone = (date: Date | string, formatStr: string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      year:   formatStr.includes("yyyy") ? "numeric" : undefined,
      month:  formatStr.includes("MMM") ? "short" : formatStr.includes("MM") ? "2-digit" : undefined,
      day:    formatStr.includes("d") ? "numeric" : undefined,
      hour:   formatStr.includes("HH") ? "2-digit" : undefined,
      minute: formatStr.includes("mm") ? "2-digit" : undefined,
      second: formatStr.includes("ss") ? "2-digit" : undefined,
      hour12: false,
    }).format(d);
  };

  const formatDatetime = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  };

  const formatFullDatetime = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  };

  return {
    timezone,
    orgTimezone,
    userOverride: override,
    isUsingOrgDefault: !override,
    setTimezone,
    formatInTimezone,
    formatDatetime,
    formatFullDatetime,
  };
}
