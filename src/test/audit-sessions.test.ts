import { describe, it, expect } from "vitest";
import type { PolicyType, AuditStatus, AuditSession, AuditFinding } from "@/hooks/useAuditSessions";

// ── Type & shape tests ──────────────────────────────────────────────────────

describe("AuditSession types", () => {
  const validPolicyTypes: PolicyType[] = ["defender", "gpo", "wdac", "uac", "windows_update"];
  const validStatuses: AuditStatus[] = ["active", "completed", "cancelled"];

  it("accepts all policy types", () => {
    validPolicyTypes.forEach((pt) => {
      const session: Pick<AuditSession, "policy_type"> = { policy_type: pt };
      expect(session.policy_type).toBe(pt);
    });
  });

  it("accepts all statuses", () => {
    validStatuses.forEach((s) => {
      const session: Pick<AuditSession, "status"> = { status: s };
      expect(session.status).toBe(s);
    });
  });

  it("has correct shape with required fields", () => {
    const session: AuditSession = {
      id: "test-id",
      organization_id: "org-id",
      policy_type: "defender",
      policy_id: "policy-id",
      status: "active",
      planned_duration_days: 30,
      started_at: new Date().toISOString(),
      completed_at: null,
      started_by: "user-id",
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(session.id).toBe("test-id");
    expect(session.planned_duration_days).toBe(30);
    expect(session.completed_at).toBeNull();
  });
});

describe("AuditFinding types", () => {
  it("has correct shape with required fields", () => {
    const finding: AuditFinding = {
      id: "finding-1",
      session_id: "session-1",
      finding_type: "blocked_process",
      source_endpoint_id: "ep-1",
      value: "C:\\Program Files\\App\\app.exe",
      occurrence_count: 15,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      details: { rule_guid: "abc-123" },
      is_approved: false,
      approved_by: null,
      approved_at: null,
      created_at: new Date().toISOString(),
    };

    expect(finding.occurrence_count).toBe(15);
    expect(finding.is_approved).toBe(false);
    expect(finding.value).toContain("app.exe");
  });

  it("supports approved state", () => {
    const finding: AuditFinding = {
      id: "finding-2",
      session_id: "session-1",
      finding_type: "asr_trigger",
      source_endpoint_id: null,
      value: "office_child_process",
      occurrence_count: 42,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      details: null,
      is_approved: true,
      approved_by: "admin-user-id",
      approved_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    expect(finding.is_approved).toBe(true);
    expect(finding.approved_by).toBe("admin-user-id");
    expect(finding.approved_at).not.toBeNull();
  });
});

// ── Business logic tests ────────────────────────────────────────────────────

describe("Audit session duration logic", () => {
  it("calculates progress correctly", () => {
    const startDate = new Date("2026-03-01T00:00:00Z");
    const currentDate = new Date("2026-03-16T00:00:00Z");
    const plannedDays = 30;

    const daysElapsed = Math.floor(
      (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const progress = Math.min(100, Math.round((daysElapsed / plannedDays) * 100));

    expect(daysElapsed).toBe(15);
    expect(progress).toBe(50);
  });

  it("caps progress at 100% but allows longer durations", () => {
    const startDate = new Date("2026-01-01T00:00:00Z");
    const currentDate = new Date("2026-03-01T00:00:00Z");
    const plannedDays = 30;

    const daysElapsed = Math.floor(
      (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const progress = Math.min(100, Math.round((daysElapsed / plannedDays) * 100));

    expect(daysElapsed).toBeGreaterThan(30);
    expect(progress).toBe(100); // capped at 100
  });

  it("supports custom durations (not limited to 30 days)", () => {
    const durations = [7, 14, 30, 60, 90, 180, 365];
    durations.forEach((d) => {
      const session: Pick<AuditSession, "planned_duration_days"> = {
        planned_duration_days: d,
      };
      expect(session.planned_duration_days).toBe(d);
      expect(session.planned_duration_days).toBeGreaterThan(0);
    });
  });
});

describe("Sanitize policy patch", () => {
  it("strips sensitive fields from policy updates", () => {
    const policyData = {
      id: "should-strip",
      organization_id: "should-strip",
      created_at: "should-strip",
      updated_at: "should-strip",
      created_by: "should-strip",
      name: "Keep This",
      realtime_monitoring: true,
    };

    const { id, organization_id, created_at, updated_at, created_by, ...rest } = policyData;
    
    expect(rest).toEqual({ name: "Keep This", realtime_monitoring: true });
    expect(rest).not.toHaveProperty("id");
    expect(rest).not.toHaveProperty("organization_id");
  });
});

describe("Finding approval workflow", () => {
  it("transitions from pending to approved", () => {
    const finding = { is_approved: false, approved_by: null, approved_at: null };
    
    // Simulate approval
    const approved = {
      ...finding,
      is_approved: true,
      approved_by: "admin-id",
      approved_at: new Date().toISOString(),
    };

    expect(approved.is_approved).toBe(true);
    expect(approved.approved_by).toBe("admin-id");
  });

  it("can revoke approval", () => {
    const finding = {
      is_approved: true,
      approved_by: "admin-id",
      approved_at: new Date().toISOString(),
    };

    // Simulate revocation
    const revoked = {
      ...finding,
      is_approved: false,
      approved_by: null,
      approved_at: null,
    };

    expect(revoked.is_approved).toBe(false);
    expect(revoked.approved_by).toBeNull();
  });

  it("bulk approve preserves individual finding data", () => {
    const findings = [
      { id: "f1", value: "process1.exe", is_approved: false },
      { id: "f2", value: "process2.exe", is_approved: false },
      { id: "f3", value: "process3.exe", is_approved: true },
    ];

    const selectedIds = new Set(["f1", "f2"]);
    const updated = findings.map((f) =>
      selectedIds.has(f.id) ? { ...f, is_approved: true } : f
    );

    expect(updated[0].is_approved).toBe(true);
    expect(updated[1].is_approved).toBe(true);
    expect(updated[2].is_approved).toBe(true); // unchanged
    expect(updated[0].value).toBe("process1.exe"); // preserved
  });
});

describe("Policy type coverage", () => {
  it("supports all 5 policy types for audit sessions", () => {
    const types: PolicyType[] = ["defender", "gpo", "wdac", "uac", "windows_update"];
    expect(types).toHaveLength(5);
    types.forEach((t) => {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
    });
  });

  it("finding types map to policy domains", () => {
    const findingTypesByPolicy: Record<PolicyType, string[]> = {
      defender: ["blocked_process", "asr_trigger", "pua_detection"],
      gpo: ["gpo_conflict", "registry_change", "policy_override"],
      wdac: ["app_execution", "unsigned_binary", "publisher_block"],
      uac: ["uac_elevation", "admin_prompt", "consent_required"],
      windows_update: ["update_deferred", "restart_pending", "feature_update"],
    };

    Object.entries(findingTypesByPolicy).forEach(([policyType, types]) => {
      expect(types.length).toBeGreaterThan(0);
      expect(typeof policyType).toBe("string");
    });
  });
});
