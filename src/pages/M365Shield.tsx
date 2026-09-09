import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Shield, ShieldCheck, ShieldOff, AlertTriangle, Info, Clock,
  KeyRound, Activity, Plug, ChevronDown, ChevronRight, Trash2,
  CheckCircle2, XCircle, Users, ClipboardList, ScanFace,
  Share2, UserMinus, ExternalLink, Crown, Eye, Database, Copy, RefreshCw,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useShieldOverview, useEnableShield,
  usePimElevations, useElevatePim, useRevokePim,
  useSigninRisks, useOAuthGrants, useRevokeOAuthGrant,
  useAccessReviews, useAccessReviewItems, useCreateAccessReview, useDecideReviewItem,
  useMfaCoverageOverview, useMfaCoverageRows,
  useSharingOverview, useSharedItems, useUnshare,
  useLifecycleWorkflows, useRunLeaver,
  usePrivilegedAuditSummary, usePrivilegedAuditRows,
  useBreachOverview, useBreachSubscriptions, useBreachFindings, useTenantDomains,
  useBreachSetup, useAcknowledgeBreach,
  useShieldScanAll,
  RISK_FLAG_LABEL, BREACH_SOURCE_LABEL,
  type BreachSource,
  type SharingFilter, type SharedItem, type LifecycleWorkflow,
  PIM_ROLE_TEMPLATES, RISK_LEVEL_LABEL, RISK_LEVEL_TONE, PIM_STATUS_TONE,
  REVIEW_KIND_LABEL,
  type PimElevation, type OAuthGrant, type ReviewKind, type AccessReview,
} from "@/hooks/useM365Shield";

// Mithras M365 Shield — opt-in module. PIM-lite + risk scoring + OAuth
// governance + access reviews delivered via Microsoft Graph. Substitutes
// outcomes of Entra ID P1/P2 + Defender for Cloud Apps + Purview Audit.

function Kpi({ label, value, hint, tone = "default" }: { label: string; value: number | string; hint?: string; tone?: "default" | "warn" | "ok" | "bad" }) {
  const toneClass =
    tone === "warn" ? "text-amber-600" :
    tone === "ok"   ? "text-emerald-600" :
    tone === "bad"  ? "text-rose-600" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function DisclosureStrip() {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/5 p-4">
      <div className="flex gap-3">
        <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-sm leading-relaxed">
          <div className="font-medium mb-1">How Mithras delivers these outcomes</div>
          <p className="text-muted-foreground">
            Mithras Shield reacts to signals it sees in Microsoft Graph (sign-ins, OAuth grants, role state)
            and applies controls through Graph endpoints. Microsoft Entra ID P1/P2 enforces some of these at
            the sign-in itself; Mithras runs detect-and-respond on a poll cadence. For customers needing
            hardline pre-auth enforcement (e.g. specific compliance regimes), Entra ID P1/P2 remains the
            right tool. For everyone else, Shield reaches the same outcomes for a fraction of the cost.
          </p>
        </div>
      </div>
    </div>
  );
}

function EnableCard() {
  const enable = useEnableShield();
  return (
    <Card>
      <CardContent className="p-6 text-center space-y-4">
        <Shield className="h-12 w-12 mx-auto text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">M365 Shield is not enabled for this organization.</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl mx-auto">
            Turn it on to start time-boxed admin elevations (PIM-lite), per-user risk scoring,
            and OAuth grant inventory. All polls run server-side; nothing executes on a user's machine.
          </p>
        </div>
        <Button onClick={() => enable.mutate(true)} disabled={enable.isPending}>
          <ShieldCheck className="h-4 w-4 mr-2" />
          Enable M365 Shield
        </Button>
        <p className="text-xs text-muted-foreground">
          Requires an active M365 tenant connection.
        </p>
      </CardContent>
    </Card>
  );
}

function ElevateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const elevate = useElevatePim();
  const [upn, setUpn] = useState("");
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState(PIM_ROLE_TEMPLATES[0].id);
  const [duration, setDuration] = useState(60);
  const [reason, setReason] = useState("");
  const [highRiskConfirm, setHighRiskConfirm] = useState("");

  const role = PIM_ROLE_TEMPLATES.find((r) => r.id === roleId);
  const needsHighRiskConfirm = !!role?.warn;
  const canSubmit =
    upn.trim() && userId.trim() && roleId && reason.trim().length >= 5 &&
    duration >= 15 && duration <= 480 &&
    (!needsHighRiskConfirm || highRiskConfirm.trim().toUpperCase() === "ELEVATE");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Elevate user (PIM-lite)</DialogTitle>
          <DialogDescription>
            Add a directory role for a fixed window. Mithras auto-revokes when the timer expires.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Target UPN</Label>
            <Input value={upn} onChange={(e) => setUpn(e.target.value)} placeholder="alice@contoso.com" />
          </div>
          <div>
            <Label className="text-xs">Target user object id (Graph)</Label>
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
            <p className="text-[11px] text-muted-foreground mt-1">
              You can find this in Entra → Users → click the user → "Object ID".
            </p>
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PIM_ROLE_TEMPLATES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}{r.warn ? " ⚠" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Duration (minutes — 15 to 480)</Label>
            <Input type="number" min={15} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Reason (audit trail)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Exchange mailbox export for legal request #2026-04" rows={2} />
          </div>
          {needsHighRiskConfirm && (
            <div className="rounded-md border border-rose-500/40 bg-rose-50/40 dark:bg-rose-500/5 p-3">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">High-risk role</div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Type <span className="font-mono">ELEVATE</span> to confirm this assignment.
                  </p>
                  <Input value={highRiskConfirm} onChange={(e) => setHighRiskConfirm(e.target.value)} placeholder="ELEVATE" />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!canSubmit || elevate.isPending}
            onClick={async () => {
              await elevate.mutateAsync({
                target_user_id: userId.trim(),
                target_user_upn: upn.trim(),
                role_template_id: roleId,
                role_display_name: role?.name ?? "Unknown role",
                duration_minutes: duration,
                reason: reason.trim(),
              });
              onClose();
              setUpn(""); setUserId(""); setReason(""); setDuration(60); setHighRiskConfirm("");
            }}
          >
            <KeyRound className="h-4 w-4 mr-2" />
            Elevate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PimTab() {
  const elevations = usePimElevations({ limit: 100 });
  const revoke = useRevokePim();
  const [showElevate, setShowElevate] = useState(false);

  const active = (elevations.data ?? []).filter((r) => r.status === "active");
  const recent = (elevations.data ?? []).filter((r) => r.status !== "active");

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Active elevations</h2>
        <Button size="sm" onClick={() => setShowElevate(true)}>
          <KeyRound className="h-4 w-4 mr-2" /> Elevate user
        </Button>
      </div>

      {elevations.isLoading && <Skeleton className="h-24 w-full" />}

      {!elevations.isLoading && active.length === 0 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">No elevations active right now.</CardContent></Card>
      )}

      {active.map((e) => (
        <Card key={e.id}>
          <CardContent className="p-4 flex justify-between gap-4 flex-wrap">
            <div>
              <div className="font-medium">{e.target_user_upn}</div>
              <div className="text-sm text-muted-foreground">
                {e.role_display_name} · expires {formatDistanceToNow(new Date(e.expires_at), { addSuffix: true })}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Reason: {e.reason}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={PIM_STATUS_TONE[e.status]}>{e.status}</Badge>
              <Button size="sm" variant="outline" onClick={() => revoke.mutate({ elevation_id: e.id, reason: "Manual revoke" })} disabled={revoke.isPending}>
                Revoke
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {recent.length > 0 && (
        <>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-6">Recent</h2>
          {recent.slice(0, 20).map((e) => (
            <Card key={e.id} className="opacity-70">
              <CardContent className="p-3 flex justify-between gap-4 flex-wrap text-sm">
                <div>
                  <div className="font-medium">{e.target_user_upn}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.role_display_name} · {e.status} · {formatDistanceToNow(new Date(e.requested_at), { addSuffix: true })}
                  </div>
                  {e.error_message && (
                    <div className="text-xs text-rose-500 mt-1">{e.error_message}</div>
                  )}
                </div>
                <Badge className={PIM_STATUS_TONE[e.status]}>{e.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </>
      )}

      <ElevateDialog open={showElevate} onClose={() => setShowElevate(false)} />
    </div>
  );
}

function RiskTab() {
  const risks = useSigninRisks({ limit: 100 });
  const [expanded, setExpanded] = useState<string | null>(null);

  if (risks.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!risks.data || risks.data.length === 0) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">No sign-in data scored yet. The risk poll runs in the background and back-fills within minutes of enabling Shield.</CardContent></Card>;
  }

  const ranked = [...risks.data].filter((r) => r.risk_level !== "none");
  if (ranked.length === 0) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">All users scored "none" risk in the last 24 hours.</CardContent></Card>;
  }

  return (
    <div className="space-y-2">
      {ranked.map((r) => (
        <Card key={r.id}>
          <CardContent className="p-3">
            <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="w-full flex items-center justify-between gap-4 text-left">
              <div className="flex items-center gap-2">
                {expanded === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <div>
                  <div className="font-medium">{r.user_upn}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.signin_count_24h} signins · {r.failed_signin_24h} failed · {r.distinct_countries_24h} countries
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={RISK_LEVEL_TONE[r.risk_level]}>{RISK_LEVEL_LABEL[r.risk_level]}</Badge>
                <span className="text-sm font-semibold">{r.risk_score}</span>
              </div>
            </button>

            {expanded === r.id && (
              <div className="mt-3 pl-6 space-y-1 text-sm">
                {r.risk_factors.filter((f) => f.points > 0).map((f, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{f.kind}: {f.evidence}</span>
                    <span className="text-amber-600 font-medium">+{f.points}</span>
                  </div>
                ))}
                {r.last_signin_at && (
                  <div className="text-xs text-muted-foreground pt-1">
                    Last sign-in: {formatDistanceToNow(new Date(r.last_signin_at), { addSuffix: true })}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function OAuthTab() {
  const grants = useOAuthGrants({ limit: 200 });
  const revoke = useRevokeOAuthGrant();
  const [confirmRevoke, setConfirmRevoke] = useState<OAuthGrant | null>(null);

  if (grants.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!grants.data || grants.data.length === 0) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">No OAuth grants pulled yet. The poll runs daily; it will populate within 24 hours of enabling Shield.</CardContent></Card>;
  }

  return (
    <div className="space-y-2">
      {grants.data.map((g) => (
        <Card key={g.id}>
          <CardContent className="p-3 flex justify-between items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="font-medium truncate">{g.client_display_name ?? g.client_id}</div>
                <Badge className={RISK_LEVEL_TONE[g.risk_level]}>{RISK_LEVEL_LABEL[g.risk_level]} · {g.risk_score}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {g.publisher ?? "Unverified publisher"} · {g.principal_upn ?? "All users (admin consent)"}
              </div>
              {(g.high_risk_scopes_matched ?? []).length > 0 && (
                <div className="text-xs text-rose-600 mt-1">
                  High-risk scopes: {(g.high_risk_scopes_matched ?? []).join(", ")}
                </div>
              )}
              <div className="text-xs text-muted-foreground mt-1 truncate">
                Scopes: {g.scope || "(none)"}
              </div>
            </div>
            {!g.revoked_at && (
              <Button size="sm" variant="outline" onClick={() => setConfirmRevoke(g)}>
                <Trash2 className="h-4 w-4 mr-1" /> Revoke
              </Button>
            )}
            {g.revoked_at && (
              <Badge variant="outline">Revoked {formatDistanceToNow(new Date(g.revoked_at), { addSuffix: true })}</Badge>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!confirmRevoke} onOpenChange={(o) => !o && setConfirmRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke OAuth grant</DialogTitle>
            <DialogDescription>
              Revoking will immediately delete this consent grant. The user (or all users if admin-consented)
              will lose access to the app via this scope. Re-granting requires another consent flow.
            </DialogDescription>
          </DialogHeader>
          {confirmRevoke && (
            <div className="text-sm space-y-1">
              <div><strong>App:</strong> {confirmRevoke.client_display_name ?? confirmRevoke.client_id}</div>
              <div><strong>Publisher:</strong> {confirmRevoke.publisher ?? "Unverified"}</div>
              <div><strong>Scope:</strong> {confirmRevoke.scope || "(none)"}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button
              disabled={revoke.isPending}
              onClick={async () => {
                if (!confirmRevoke) return;
                await revoke.mutateAsync({ grant_id: confirmRevoke.id, reason: "Operator-initiated revoke" });
                setConfirmRevoke(null);
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewsTab() {
  const reviews = useAccessReviews();
  const create = useCreateAccessReview();
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [kind, setKind] = useState<ReviewKind>("admin");
  const [dueDays, setDueDays] = useState(14);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Access reviews</h2>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <ClipboardList className="h-4 w-4 mr-2" /> Start review
        </Button>
      </div>

      {reviews.isLoading && <Skeleton className="h-24 w-full" />}
      {!reviews.isLoading && (reviews.data ?? []).length === 0 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">No reviews started. A quarterly review of admins or guests is recommended.</CardContent></Card>
      )}

      {(reviews.data ?? []).map((r) => (
        <ReviewCard key={r.id} review={r} expanded={openReviewId === r.id} onToggle={() => setOpenReviewId(openReviewId === r.id ? null : r.id)} />
      ))}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start an access review</DialogTitle>
            <DialogDescription>
              Mithras pulls the current state from your M365 tenant and creates a row per subject for you to decide on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Review subject</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ReviewKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Privileged admins</SelectItem>
                  <SelectItem value="guest">External guests</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Due in (days)</Label>
              <Input type="number" min={1} max={90} value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              disabled={create.isPending}
              onClick={async () => {
                await create.mutateAsync({ review_kind: kind, due_days: dueDays });
                setShowCreate(false);
              }}
            >
              <ClipboardList className="h-4 w-4 mr-2" /> Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewCard({ review, expanded, onToggle }: { review: AccessReview; expanded: boolean; onToggle: () => void }) {
  const items = useAccessReviewItems(expanded ? review.id : null);
  const decide = useDecideReviewItem();
  const pendingCount = (items.data ?? []).filter((i) => !i.decision).length;
  const removedCount = (items.data ?? []).filter((i) => i.decision === "remove" && i.enforced_at).length;

  return (
    <Card>
      <CardContent className="p-4">
        <button onClick={onToggle} className="w-full flex justify-between items-center text-left">
          <div>
            <div className="font-medium flex items-center gap-2">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {REVIEW_KIND_LABEL[review.review_kind]}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {review.item_count} subjects · due {formatDistanceToNow(new Date(review.due_at), { addSuffix: true })}
              {review.completed_at && ` · completed ${formatDistanceToNow(new Date(review.completed_at), { addSuffix: true })}`}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline">{review.kept_count} kept</Badge>
            <Badge variant="outline" className="text-rose-600 border-rose-200">{review.removed_count} removed</Badge>
            {review.completed_at && <Badge className="bg-emerald-100 text-emerald-800">Complete</Badge>}
          </div>
        </button>

        {expanded && (
          <div className="mt-4 space-y-2">
            {items.isLoading && <Skeleton className="h-16 w-full" />}
            {items.data?.map((it) => (
              <div key={it.id} className="flex justify-between items-start gap-2 p-2 rounded-md border bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{it.subject_label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {review.review_kind === "admin" && Array.isArray((it.detail as any).roles) && (
                      <span>Roles: {((it.detail as any).roles ?? []).map((r: any) => r.name).join(", ")}</span>
                    )}
                    {review.review_kind === "guest" && (
                      <span>
                        {(it.detail as any).display_name ?? "—"}
                        {(it.detail as any).dormant_days != null && ` · dormant ${(it.detail as any).dormant_days}d`}
                      </span>
                    )}
                  </div>
                  {it.enforcement_error && (
                    <div className="text-[11px] text-rose-600 mt-1">{it.enforcement_error}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {it.decision === "keep" && <Badge variant="outline" className="text-emerald-600">Kept</Badge>}
                  {it.decision === "remove" && it.enforced_at && <Badge className="bg-rose-100 text-rose-800">Removed</Badge>}
                  {it.decision === "remove" && !it.enforced_at && <Badge className="bg-amber-100 text-amber-800">Pending</Badge>}
                  {!it.decision && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={decide.isPending}
                        onClick={() => decide.mutate({ item_id: it.id, decision: "keep" })}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Keep
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 border-rose-300 text-rose-600" disabled={decide.isPending}
                        onClick={() => decide.mutate({ item_id: it.id, decision: "remove" })}>
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Remove
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {pendingCount > 0 && (
              <div className="text-xs text-muted-foreground pt-1">{pendingCount} subjects still pending decision.</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MfaTab() {
  const overview = useMfaCoverageOverview();
  const [filter, setFilter] = useState<"all" | "no_mfa" | "admins_no_mfa">("no_mfa");
  const rows = useMfaCoverageRows({ filter });

  if (overview.isLoading) return <Skeleton className="h-32 w-full" />;
  const o = overview.data;

  if (!o || o.total_users === 0) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">No MFA data yet. The poll runs daily at 04:33 UTC and populates within minutes of Shield enable.</CardContent></Card>;
  }

  const adminWarn = o.admins_at_risk > 0;

  return (
    <div className="space-y-5">
      {/* Headline strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Users with MFA</div>
            <div className="text-3xl font-bold mt-1">{o.pct_users_with_mfa}<span className="text-lg text-muted-foreground">%</span></div>
            <div className="text-xs text-muted-foreground mt-1">{o.users_mfa_registered} of {o.total_users}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Admins with MFA</div>
            <div className={`text-3xl font-bold mt-1 ${adminWarn ? "text-rose-600" : "text-emerald-600"}`}>{o.pct_admins_with_mfa}<span className="text-lg text-muted-foreground">%</span></div>
            <div className="text-xs text-muted-foreground mt-1">{o.admins_mfa_registered} of {o.admins_total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Capable, unregistered</div>
            <div className="text-3xl font-bold mt-1 text-amber-600">{o.users_mfa_capable_unreg}</div>
            <div className="text-xs text-muted-foreground mt-1">Could enrol now</div>
          </CardContent>
        </Card>
        <Card className={adminWarn ? "border-rose-500/40" : ""}>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Admins at risk</div>
            <div className={`text-3xl font-bold mt-1 ${adminWarn ? "text-rose-600" : "text-emerald-600"}`}>{o.admins_at_risk}</div>
            <div className="text-xs text-muted-foreground mt-1">{adminWarn ? "Privileged + no MFA" : "All admins protected"}</div>
          </CardContent>
        </Card>
      </div>

      {adminWarn && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-50/40 dark:bg-rose-500/5 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">{o.admins_at_risk} privileged account{o.admins_at_risk > 1 ? "s" : ""} without MFA.</div>
            <div className="text-muted-foreground mt-1">This is the single highest-impact identity fix you can make today. Promote the <em>missing_mfa</em> Identity Defence rule from report-only to enforce, and these accounts will be forced to enrol on their next sign-in.</div>
          </div>
        </div>
      )}

      {/* Filter strip */}
      <div className="flex gap-2 items-center">
        <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">Show</span>
        <Button size="sm" variant={filter === "no_mfa" ? "default" : "outline"} onClick={() => setFilter("no_mfa")}>
          No MFA ({o.total_users - o.users_mfa_registered})
        </Button>
        <Button size="sm" variant={filter === "admins_no_mfa" ? "default" : "outline"} onClick={() => setFilter("admins_no_mfa")}>
          Admins without MFA ({o.admins_at_risk})
        </Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
          All users ({o.total_users})
        </Button>
        {o.last_evaluated_at && (
          <span className="text-xs text-muted-foreground ml-auto">
            Last poll {formatDistanceToNow(new Date(o.last_evaluated_at), { addSuffix: true })}
          </span>
        )}
      </div>

      {/* User list */}
      {rows.isLoading && <Skeleton className="h-32 w-full" />}
      {!rows.isLoading && (rows.data ?? []).length === 0 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">No users match this filter.</CardContent></Card>
      )}
      <div className="space-y-2">
        {(rows.data ?? []).map((u) => (
          <Card key={u.id}>
            <CardContent className="p-3 flex justify-between items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <ScanFace className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{u.display_name ?? u.user_upn}</span>
                  {u.is_admin && (
                    <Badge variant="outline" className="text-rose-600 border-rose-200">Admin</Badge>
                  )}
                  {u.is_mfa_registered ? (
                    <Badge className="bg-emerald-100 text-emerald-800">MFA enrolled</Badge>
                  ) : u.is_mfa_capable ? (
                    <Badge className="bg-amber-100 text-amber-800">Capable — not enrolled</Badge>
                  ) : (
                    <Badge className="bg-slate-100 text-slate-700">No MFA capable</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {u.user_upn}
                  {u.is_admin && u.admin_roles.length > 0 && ` · Roles: ${u.admin_roles.join(", ")}`}
                  {u.methods_registered.length > 0 && ` · Methods: ${u.methods_registered.join(", ")}`}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SharingTab() {
  const overview = useSharingOverview();
  const [filter, setFilter] = useState<SharingFilter>("external");
  const items = useSharedItems({ filter, limit: 200 });
  const unshare = useUnshare();
  const [confirmUnshare, setConfirmUnshare] = useState<SharedItem | null>(null);

  if (overview.isLoading) return <Skeleton className="h-32 w-full" />;
  const o = overview.data;
  if (!o || o.total_active === 0) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">No sharing data yet. The poll runs daily at 02:13 UTC and back-fills within hours of Shield enable. Big tenants take 2-3 days to fully walk.</CardContent></Card>;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">External shares</div>
            <div className="text-3xl font-bold mt-1 text-amber-600">{o.external_active}</div>
            <div className="text-xs text-muted-foreground mt-1">of {o.total_active} total</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Anonymous links</div>
            <div className="text-3xl font-bold mt-1 text-rose-600">{o.anonymous_links}</div>
            <div className="text-xs text-muted-foreground mt-1">"Anyone with the link"</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Suspicious domains</div>
            <div className="text-3xl font-bold mt-1 text-rose-600">{o.suspicious_domains}</div>
            <div className="text-xs text-muted-foreground mt-1">.ru / .cn / .click / etc.</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Dormant &gt;90 days</div>
            <div className="text-3xl font-bold mt-1 text-amber-600">{o.dormant_over_90d}</div>
            <div className="text-xs text-muted-foreground mt-1">Forgotten shares</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">Show</span>
        <Button size="sm" variant={filter === "external" ? "default" : "outline"} onClick={() => setFilter("external")}>External ({o.external_active})</Button>
        <Button size="sm" variant={filter === "anonymous" ? "default" : "outline"} onClick={() => setFilter("anonymous")}>Anonymous ({o.anonymous_links})</Button>
        <Button size="sm" variant={filter === "suspicious" ? "default" : "outline"} onClick={() => setFilter("suspicious")}>Suspicious ({o.suspicious_domains})</Button>
        <Button size="sm" variant={filter === "dormant" ? "default" : "outline"} onClick={() => setFilter("dormant")}>Dormant ({o.dormant_over_90d})</Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All ({o.total_active})</Button>
        {o.last_poll_at && (
          <span className="text-xs text-muted-foreground ml-auto">
            Last poll {formatDistanceToNow(new Date(o.last_poll_at), { addSuffix: true })}
          </span>
        )}
      </div>

      {items.isLoading && <Skeleton className="h-32 w-full" />}
      {!items.isLoading && (items.data ?? []).length === 0 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">No items match this filter.</CardContent></Card>
      )}
      <div className="space-y-2">
        {(items.data ?? []).map((it) => {
          // Resolve who this share is actually with — the order matters because
          // a record can carry both link_scope and granted_to_email (e.g. an
          // anonymous link that the recipient eventually re-shared internally).
          const sharedWith = it.is_anonymous_link
            ? "Anyone with the link"
            : it.link_scope === "organization"
              ? "Everyone at your company"
              : it.link_scope === "users"
                ? "Specific people"
                : it.granted_to_email
                  ? it.granted_to_email
                  : it.granted_to_display_name
                    ? it.granted_to_display_name
                    : "—";
          const showOrgBadge      = it.link_scope === "organization" && !it.is_anonymous_link;
          const showInternalBadge = !it.is_external && !it.is_anonymous_link && it.link_scope !== "organization";
          return (
          <Card key={it.id}>
            <CardContent className="p-3 flex justify-between items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Share2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{it.item_name ?? "(untitled)"}</span>
                  {it.is_anonymous_link && <Badge className="bg-rose-100 text-rose-800">Anyone link</Badge>}
                  {it.is_external && !it.is_anonymous_link && <Badge className="bg-amber-100 text-amber-800">External</Badge>}
                  {showOrgBadge      && <Badge className="bg-sky-100 text-sky-800">Company-wide</Badge>}
                  {showInternalBadge && <Badge variant="outline">Internal</Badge>}
                  {it.is_suspicious_domain && <Badge className="bg-rose-100 text-rose-800">Suspicious domain</Badge>}
                  {it.link_type === "edit" && <Badge variant="outline" className="text-rose-600">Edit</Badge>}
                  <Badge variant="outline" className="ml-auto">Risk {it.risk_score}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {it.drive_kind === "onedrive" ? "OneDrive" : "SharePoint"} · {it.drive_owner ?? "—"} ·{" "}
                  Shared with: {sharedWith}
                  {it.dormant_days != null && ` · dormant ${it.dormant_days}d`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {it.item_web_url && (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={it.item_web_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setConfirmUnshare(it)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Unshare
                </Button>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>

      <Dialog open={!!confirmUnshare} onOpenChange={(o) => !o && setConfirmUnshare(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this share?</DialogTitle>
            <DialogDescription>
              The recipient will lose access immediately. Calls Graph DELETE on the permission. Reversible only by re-sharing manually.
            </DialogDescription>
          </DialogHeader>
          {confirmUnshare && (() => {
            const c = confirmUnshare;
            const recipient = c.is_anonymous_link
              ? "Anyone with the link"
              : c.link_scope === "organization"
                ? "Everyone at your company"
                : c.link_scope === "users"
                  ? "Specific people"
                  : c.granted_to_email ?? c.granted_to_display_name ?? "—";
            return (
              <div className="text-sm space-y-1">
                <div><strong>File:</strong> {c.item_name}</div>
                <div><strong>Shared with:</strong> {recipient}</div>
                <div><strong>Access:</strong> {c.link_type ?? "—"}</div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUnshare(null)}>Cancel</Button>
            <Button
              disabled={unshare.isPending}
              onClick={async () => {
                if (!confirmUnshare) return;
                await unshare.mutateAsync({ shared_item_id: confirmUnshare.id, reason: "Operator-initiated unshare" });
                setConfirmUnshare(null);
              }}
            ><Trash2 className="h-4 w-4 mr-2" /> Unshare</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeaverDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useRunLeaver();
  const [upn, setUpn] = useState("");
  const [mgr, setMgr] = useState("");
  const [reason, setReason] = useState("");
  const [optRevoke, setOptRevoke] = useState(true);
  const [optDisable, setOptDisable] = useState(true);
  const [optGroups, setOptGroups] = useState(true);
  const [optOOO, setOptOOO] = useState(true);
  const [optForward, setOptForward] = useState(true);
  const [confirmText, setConfirmText] = useState("");

  const canSubmit = upn.trim() && reason.trim().length >= 5 && confirmText.trim().toUpperCase() === "OFFBOARD";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Offboard user</DialogTitle>
          <DialogDescription>
            Revokes sessions, disables account, removes from groups, sets OOO, forwards mail. Irreversible without re-enabling.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">User UPN (leaving)</Label>
            <Input value={upn} onChange={(e) => setUpn(e.target.value)} placeholder="alice@contoso.com" />
          </div>
          <div>
            <Label className="text-xs">Manager UPN (receives mail forwarding + OOO)</Label>
            <Input value={mgr} onChange={(e) => setMgr(e.target.value)} placeholder="bob.manager@contoso.com" />
          </div>
          <div>
            <Label className="text-xs">Reason (audit trail)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Resignation effective 2026-06-30 — HR ticket #1234" rows={2} />
          </div>
          <div className="space-y-2 border rounded-md p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Steps</div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optRevoke}  onChange={(e) => setOptRevoke(e.target.checked)} /> Revoke all M365 sessions</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optDisable} onChange={(e) => setOptDisable(e.target.checked)} /> Disable account</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optGroups}  onChange={(e) => setOptGroups(e.target.checked)} /> Remove from all Entra groups</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optOOO}     onChange={(e) => setOptOOO(e.target.checked)} disabled={!mgr} /> Set out-of-office (requires manager)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optForward} onChange={(e) => setOptForward(e.target.checked)} disabled={!mgr} /> Forward inbox to manager (requires manager)</label>
          </div>
          <div className="rounded-md border border-rose-500/40 bg-rose-50/40 dark:bg-rose-500/5 p-3">
            <div className="text-sm font-medium">Type <span className="font-mono">OFFBOARD</span> to confirm.</div>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="OFFBOARD" className="mt-2" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!canSubmit || run.isPending}
            onClick={async () => {
              await run.mutateAsync({
                target_user_upn: upn.trim(),
                manager_upn: mgr.trim() || undefined,
                reason: reason.trim(),
                options: {
                  revoke_sessions: optRevoke,
                  disable_account: optDisable,
                  remove_from_groups: optGroups,
                  out_of_office: optOOO,
                  forward_to_manager: optForward,
                },
              });
              onClose();
              setUpn(""); setMgr(""); setReason(""); setConfirmText("");
            }}
          ><UserMinus className="h-4 w-4 mr-2" /> Run leaver</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LifecycleTab() {
  const wfs = useLifecycleWorkflows({ limit: 50 });
  const [showLeaver, setShowLeaver] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lifecycle workflows</h2>
        <Button size="sm" onClick={() => setShowLeaver(true)}>
          <UserMinus className="h-4 w-4 mr-2" /> Offboard user
        </Button>
      </div>

      {wfs.isLoading && <Skeleton className="h-24 w-full" />}
      {!wfs.isLoading && (wfs.data ?? []).length === 0 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">No workflows yet. Click "Offboard user" to run a leaver — every step is logged with success/failure for the audit trail.</CardContent></Card>
      )}

      {(wfs.data ?? []).map((w) => (
        <Card key={w.id}>
          <CardContent className="p-4">
            <div className="flex justify-between items-start gap-4 flex-wrap">
              <div>
                <div className="font-medium flex items-center gap-2">
                  <UserMinus className="h-4 w-4 text-muted-foreground" />
                  Offboard: {w.target_user_upn}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(w.requested_at), { addSuffix: true })}
                  {w.manager_upn && ` · manager: ${w.manager_upn}`}
                  {w.reason && ` · ${w.reason}`}
                </div>
              </div>
              <Badge className={
                w.status === "completed" ? "bg-emerald-100 text-emerald-800"
                : w.status === "partial" ? "bg-amber-100 text-amber-800"
                : w.status === "failed" ? "bg-rose-100 text-rose-800"
                : "bg-slate-100 text-slate-700"
              }>{w.status}</Badge>
            </div>
            {(w.steps ?? []).length > 0 && (
              <div className="mt-3 space-y-1 text-sm">
                {w.steps.map((s, i) => (
                  <div key={i} className="flex justify-between items-center gap-2 text-xs">
                    <span className="flex items-center gap-2">
                      {s.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-rose-600" />}
                      <span className="font-mono">{s.step}</span>
                    </span>
                    <span className="text-muted-foreground truncate">{s.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <LeaverDialog open={showLeaver} onClose={() => setShowLeaver(false)} />
    </div>
  );
}

function PrivilegedTab() {
  const summary = usePrivilegedAuditSummary();
  const rows = usePrivilegedAuditRows();

  if (summary.isLoading) return <Skeleton className="h-32 w-full" />;
  const s = summary.data;
  if (!s || s.total_admins === 0) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">No admin data yet. The MFA poll runs daily at 04:33 UTC and identifies who holds privileged roles.</CardContent></Card>;
  }

  const dangerWarn = s.global_admins_no_mfa > 0 || s.high_risk_admins > 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Total admins</div>
            <div className="text-3xl font-bold mt-1">{s.total_admins}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.global_admins} Global Admins</div>
          </CardContent>
        </Card>
        <Card className={s.admins_no_mfa > 0 ? "border-rose-500/40" : ""}>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Without MFA</div>
            <div className={`text-3xl font-bold mt-1 ${s.admins_no_mfa > 0 ? "text-rose-600" : "text-emerald-600"}`}>{s.admins_no_mfa}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.global_admins_no_mfa} are Global Admin</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Dormant &gt;90 days</div>
            <div className={`text-3xl font-bold mt-1 ${s.admins_dormant_90d > 0 ? "text-amber-600" : "text-emerald-600"}`}>{s.admins_dormant_90d}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.admins_never_seen} never seen at all</div>
          </CardContent>
        </Card>
        <Card className={s.high_risk_admins > 0 ? "border-rose-500/40" : ""}>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">High-risk admins</div>
            <div className={`text-3xl font-bold mt-1 ${s.high_risk_admins > 0 ? "text-rose-600" : "text-emerald-600"}`}>{s.high_risk_admins}</div>
            <div className="text-xs text-muted-foreground mt-1">Score ≥ 60</div>
          </CardContent>
        </Card>
      </div>

      {dangerWarn && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-50/40 dark:bg-rose-500/5 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">
              {s.global_admins_no_mfa > 0
                ? `${s.global_admins_no_mfa} Global Administrator${s.global_admins_no_mfa > 1 ? "s" : ""} without MFA.`
                : `${s.high_risk_admins} privileged account${s.high_risk_admins > 1 ? "s" : ""} are high-risk.`}
            </div>
            <div className="text-muted-foreground mt-1">
              Action plan: enrol MFA for any admin missing it (start with Global Admins), then run an Access Review on the dormant ones to demote or remove. Most SMB tenants have 1-2 dormant Global Admin accounts left over from setup.
            </div>
          </div>
        </div>
      )}

      {rows.isLoading && <Skeleton className="h-32 w-full" />}
      {!rows.isLoading && (rows.data ?? []).length === 0 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">No admins matched.</CardContent></Card>
      )}
      <div className="space-y-2">
        {(rows.data ?? []).map((u) => (
          <Card key={u.user_id} className={u.risk_score >= 60 ? "border-rose-500/30" : ""}>
            <CardContent className="p-3">
              <div className="flex justify-between items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {u.is_global_admin
                      ? <Crown className="h-4 w-4 text-amber-600 shrink-0" />
                      : <ScanFace className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className="font-medium truncate">{u.display_name ?? u.user_upn}</span>
                    {u.risk_flags.map((f) => (
                      <Badge key={f} className={RISK_FLAG_LABEL[f]?.tone ?? "bg-slate-100"}>{RISK_FLAG_LABEL[f]?.label ?? f}</Badge>
                    ))}
                    <Badge variant="outline" className="ml-auto">Risk {u.risk_score}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {u.user_upn}
                    {u.admin_roles.length > 0 && (
                      <> · Roles: {u.admin_roles.slice(0, 3).join(", ")}{u.admin_roles.length > 3 && ` (+${u.admin_roles.length - 3} more)`}</>
                    )}
                    {u.last_signin_at
                      ? <> · Last signin {u.days_since_signin}d ago</>
                      : <> · Never signed in (in last poll window)</>}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function BreachSetupDialog({ open, onClose, tenantPk, domain }: { open: boolean; onClose: () => void; tenantPk: string; domain: string }) {
  const setup = useBreachSetup();
  const [apiKey, setApiKey] = useState("");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Configure HIBP monitoring for {domain}</DialogTitle>
          <DialogDescription>
            Three quick steps. Customer cost: ~AUD $6/mo for an HIBP API key.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="rounded-full bg-primary/10 text-primary w-6 h-6 flex items-center justify-center font-bold shrink-0">1</span>
            <div>
              <div className="font-medium">Subscribe to HIBP</div>
              <div className="text-muted-foreground">Sign up at <a href="https://haveibeenpwned.com/API/Key" target="_blank" rel="noopener noreferrer" className="text-primary underline">haveibeenpwned.com/API/Key</a> (the "Pwned 1" tier at USD $3.95/mo covers what we need). Copy the API key.</div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="rounded-full bg-primary/10 text-primary w-6 h-6 flex items-center justify-center font-bold shrink-0">2</span>
            <div>
              <div className="font-medium">Verify domain ownership</div>
              <div className="text-muted-foreground">In HIBP, go to <a href="https://haveibeenpwned.com/DomainSearch" target="_blank" rel="noopener noreferrer" className="text-primary underline">DomainSearch</a> and add <span className="font-mono">{domain}</span>. Choose DNS TXT (1-line record) or email verification (sends to <span className="font-mono">postmaster@{domain}</span>). Wait for the green check.</div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="rounded-full bg-primary/10 text-primary w-6 h-6 flex items-center justify-center font-bold shrink-0">3</span>
            <div className="flex-1">
              <div className="font-medium">Paste the API key here</div>
              <div className="text-muted-foreground mb-2">Mithras validates the key against <span className="font-mono">{domain}</span> before storing.</div>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="paste HIBP API key" type="password" />
            </div>
          </li>
        </ol>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={!apiKey || setup.isPending}
            onClick={async () => {
              await setup.mutateAsync({ tenant_pk: tenantPk, domain, hibp_api_key: apiKey, action: "test" });
            }}>Test only</Button>
          <Button disabled={!apiKey || setup.isPending}
            onClick={async () => {
              await setup.mutateAsync({ tenant_pk: tenantPk, domain, hibp_api_key: apiKey, action: "save" });
              onClose();
              setApiKey("");
            }}><CheckCircle2 className="h-4 w-4 mr-2" /> Save + enable</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BreachTab() {
  const overview = useBreachOverview();
  const subs = useBreachSubscriptions();
  const findings = useBreachFindings({ unackOnly: true, limit: 200 });
  const ack = useAcknowledgeBreach();
  const tenants = useTenantDomains();
  const setup = useBreachSetup();
  const [setupTenantPk, setSetupTenantPk] = useState<string | null>(null);
  const [setupDomain, setSetupDomain] = useState<string>("");

  const o = overview.data;
  const subsList = subs.data ?? [];
  const findingsList = findings.data ?? [];

  // Build the "domains that could be monitored" list — tenant_domain + any
  // unconfigured domains the operator wants to add.
  const candidateDomains: Array<{ tenant_pk: string; domain: string; subscription?: typeof subsList[number] }> = [];
  for (const t of tenants.data ?? []) {
    if (!t.tenant_domain) continue;
    const sub = subsList.find((s) => s.m365_tenant_id === t.tenant_pk && s.domain === t.tenant_domain.toLowerCase());
    candidateDomains.push({ tenant_pk: t.tenant_pk, domain: t.tenant_domain.toLowerCase(), subscription: sub });
  }
  // Plus any subscription on a domain we don't have from tenant_domain
  for (const s of subsList) {
    if (!candidateDomains.find((c) => c.tenant_pk === s.m365_tenant_id && c.domain === s.domain)) {
      candidateDomains.push({ tenant_pk: s.m365_tenant_id, domain: s.domain, subscription: s });
    }
  }

  return (
    <div className="space-y-5">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Domains monitored</div>
            <div className="text-3xl font-bold mt-1">{candidateDomains.length}</div>
            <div className="text-xs text-muted-foreground mt-1">3 sources per domain</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Users breached</div>
            <div className={`text-3xl font-bold mt-1 ${(o?.users_breached ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"}`}>{o?.users_breached ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">{o?.findings_total ?? 0} total exposures</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">New (30 days)</div>
            <div className={`text-3xl font-bold mt-1 ${(o?.findings_new_30d ?? 0) > 0 ? "text-amber-600" : "text-emerald-600"}`}>{o?.findings_new_30d ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">{o?.findings_new_24h ?? 0} in last 24h</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Unacknowledged</div>
            <div className={`text-3xl font-bold mt-1 ${(o?.findings_unack ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"}`}>{o?.findings_unack ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Need triage</div>
          </CardContent>
        </Card>
      </div>

      {/* Per-source breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(["hudson_rock","github_leak","hibp"] as BreachSource[]).map((src) => {
          const label = BREACH_SOURCE_LABEL[src];
          const count = src === "hudson_rock" ? (o?.findings_hudson_rock ?? 0)
                      : src === "github_leak" ? (o?.findings_github ?? 0)
                      : (o?.findings_hibp ?? 0);
          const isFree = src !== "hibp";
          return (
            <Card key={src}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className={label.tone}>{label.label}</Badge>
                  {isFree && <Badge variant="outline" className="text-emerald-600 border-emerald-200">FREE</Badge>}
                </div>
                <div className="text-2xl font-bold">{count} <span className="text-sm font-normal text-muted-foreground">findings</span></div>
                <div className="text-xs text-muted-foreground mt-1">{label.description}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Domains + per-source status */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Monitored domains</h2>
        {tenants.isLoading && <Skeleton className="h-16 w-full" />}
        {!tenants.isLoading && candidateDomains.length === 0 && (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No M365 tenant domains found. Connect a tenant first via the M365 page.</CardContent></Card>
        )}
        {candidateDomains.map((c) => {
          const s = c.subscription;
          return (
            <Card key={`${c.tenant_pk}_${c.domain}`}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{c.domain}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-2 rounded-md border p-2 bg-rose-50/30 dark:bg-rose-500/5">
                    <Badge className={BREACH_SOURCE_LABEL.hudson_rock.tone}>Hudson Rock</Badge>
                    <div className="flex-1 min-w-0">
                      {s?.hudson_rock_last_polled_at
                        ? <span className="text-muted-foreground">last poll {formatDistanceToNow(new Date(s.hudson_rock_last_polled_at), { addSuffix: true })} · {s.hudson_rock_last_findings_count} findings</span>
                        : <span className="text-muted-foreground">awaiting first poll (daily 02:43 UTC)</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border p-2 bg-amber-50/30 dark:bg-amber-500/5">
                    <Badge className={BREACH_SOURCE_LABEL.github_leak.tone}>GitHub</Badge>
                    <div className="flex-1 min-w-0">
                      {s?.github_last_polled_at
                        ? <span className="text-muted-foreground">last poll {formatDistanceToNow(new Date(s.github_last_polled_at), { addSuffix: true })} · {s.github_last_findings_count} findings</span>
                        : <span className="text-muted-foreground">awaiting first poll (daily 02:58 UTC)</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border p-2 bg-blue-50/30 dark:bg-blue-500/5">
                    <Badge className={BREACH_SOURCE_LABEL.hibp.tone}>HIBP</Badge>
                    <div className="flex-1 min-w-0 flex items-center gap-1">
                      {s?.has_api_key
                        ? (s.last_polled_at
                            ? <span className="text-muted-foreground">last poll {formatDistanceToNow(new Date(s.last_polled_at), { addSuffix: true })} · {s.last_poll_findings_count} findings</span>
                            : <span className="text-muted-foreground">key configured, awaiting first poll</span>)
                        : <span className="text-muted-foreground">optional — paid key needed</span>}
                      {s?.has_api_key ? (
                        <Button size="sm" variant="ghost" className="h-6 px-2 ml-auto" disabled={setup.isPending}
                          onClick={() => setup.mutate({ tenant_pk: c.tenant_pk, domain: c.domain, action: "remove" })}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 px-2 ml-auto"
                          onClick={() => { setSetupTenantPk(c.tenant_pk); setSetupDomain(c.domain); }}>
                          <KeyRound className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Findings */}
      {findingsList.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Unacknowledged breach findings</h2>
          {findingsList.map((f) => (
            <Card key={f.id} className={f.is_sensitive ? "border-rose-500/30" : ""}>
              <CardContent className="p-3 flex justify-between items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{f.user_upn}</span>
                    <span className="text-muted-foreground">in</span>
                    <span className="font-semibold">{f.breach_title ?? f.breach_name}</span>
                    <Badge className={BREACH_SOURCE_LABEL[f.source]?.tone ?? ""}>{BREACH_SOURCE_LABEL[f.source]?.label ?? f.source}</Badge>
                    {f.is_sensitive && <Badge className="bg-rose-100 text-rose-800">Sensitive</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Breach date: {f.breach_date ?? "unknown"}
                    {f.pwn_count && ` · ${f.pwn_count.toLocaleString()} accounts exposed`}
                    {f.data_classes.length > 0 && ` · Data: ${f.data_classes.slice(0, 4).join(", ")}${f.data_classes.length > 4 ? "..." : ""}`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Detected by Mithras {formatDistanceToNow(new Date(f.first_seen_at), { addSuffix: true })}
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={ack.isPending}
                  onClick={() => ack.mutate({ finding_id: f.id, note: "Acknowledged by operator" })}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Acknowledge
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {setupTenantPk && (
        <BreachSetupDialog
          open={!!setupTenantPk}
          onClose={() => setSetupTenantPk(null)}
          tenantPk={setupTenantPk}
          domain={setupDomain}
        />
      )}
    </div>
  );
}

function SettingsTab({ onDisable }: { onDisable: () => void }) {
  const overview = useShieldOverview();
  const o = overview.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Enabled</span><span>{o?.enabled_at ? `since ${new Date(o.enabled_at).toLocaleDateString()}` : "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Last risk poll</span><span>{o?.last_risk_poll_at ? formatDistanceToNow(new Date(o.last_risk_poll_at), { addSuffix: true }) : "Not run yet"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Last OAuth poll</span><span>{o?.last_oauth_poll_at ? formatDistanceToNow(new Date(o.last_oauth_poll_at), { addSuffix: true }) : "Not run yet"}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="font-medium text-sm">Disable Shield</div>
            <p className="text-xs text-muted-foreground mt-1">
              Stops all polls for this org. Existing PIM elevations continue to auto-revoke until they expire.
              Re-enable any time — historical data is preserved.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onDisable}>
            <ShieldOff className="h-4 w-4 mr-2" /> Disable for this org
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function M365ShieldPage() {
  const overview = useShieldOverview();
  const enable = useEnableShield();
  const scanAll = useShieldScanAll();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [lastScanResults, setLastScanResults] = useState<import("@/hooks/useM365Shield").ScanAllPollerResult[] | null>(null);

  const o = overview.data;
  const enabled = !!o?.enabled;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              M365 Shield
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              PIM-lite, risk scoring, and OAuth governance for Microsoft 365.
              Substitutes the outcomes of Entra ID P1/P2 and Defender for Cloud Apps
              for customers on M365 Business Basic or Standard.
            </p>
          </div>
          {enabled && (
            <Button
              variant="outline"
              onClick={() => {
                scanAll.mutate(undefined, {
                  onSuccess: (data) => setLastScanResults(data.results),
                });
              }}
              disabled={scanAll.isPending}
              aria-label="Scan all M365 Shield data sources now"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${scanAll.isPending ? "animate-spin" : ""}`} />
              {scanAll.isPending ? "Scanning all sources…" : "Scan all sources now"}
            </Button>
          )}
        </div>

        {lastScanResults && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">Last manual scan</div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setLastScanResults(null)}
                  aria-label="Dismiss last scan results"
                >Dismiss</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {lastScanResults.map((r) => {
                  const stateClass =
                    r.state === "ok"               ? "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-500/5" :
                    r.state === "no_data"          ? "border-muted bg-muted/20" :
                    r.state === "requires_premium" ? "border-amber-500/40 bg-amber-50/30 dark:bg-amber-500/5" :
                    r.state === "requires_consent" ? "border-rose-500/40 bg-rose-50/30 dark:bg-rose-500/5" :
                    r.state === "config_missing"   ? "border-amber-500/40 bg-amber-50/30 dark:bg-amber-500/5" :
                    "border-rose-500/40 bg-rose-50/30 dark:bg-rose-500/5";
                  const stateLabel =
                    r.state === "ok"               ? "Refreshed" :
                    r.state === "no_data"          ? "Nothing to report" :
                    r.state === "requires_premium" ? "Requires Entra ID P1" :
                    r.state === "requires_consent" ? "Reconnect tenant" :
                    r.state === "config_missing"   ? "Setup required" :
                    "Error";
                  const Icon =
                    r.state === "ok"               ? CheckCircle2 :
                    r.state === "no_data"          ? Info :
                    r.state === "requires_premium" ? AlertTriangle :
                    r.state === "requires_consent" ? AlertTriangle :
                    r.state === "config_missing"   ? AlertTriangle :
                    XCircle;
                  const iconColor =
                    r.state === "ok"               ? "text-emerald-600" :
                    r.state === "no_data"          ? "text-muted-foreground" :
                    r.state === "requires_premium" ? "text-amber-600" :
                    r.state === "requires_consent" ? "text-rose-600" :
                    r.state === "config_missing"   ? "text-amber-600" :
                    "text-rose-600";
                  return (
                    <div key={r.slug} className={`rounded-md border px-3 py-2 text-xs space-y-1 ${stateClass}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium truncate">{r.label}</div>
                        <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
                      </div>
                      <div className={`text-[11px] uppercase tracking-wide font-medium ${iconColor}`}>{stateLabel}</div>
                      {r.detail && <div className="text-muted-foreground leading-snug">{r.detail}</div>}
                      {r.state === "requires_consent" && (
                        <a
                          href="/m365"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 hover:text-rose-900 underline underline-offset-2"
                        >
                          Reconnect M365 tenant on /m365 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <div className="text-[10px] text-muted-foreground/70">{(r.elapsed_ms / 1000).toFixed(1)}s</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {overview.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !enabled ? (
          <EnableCard />
        ) : (
          <>
            <DisclosureStrip />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Active elevations" value={o.active_elevations}
                hint={o.active_elevations > 0 ? "Auto-revoke on timer" : "None right now"}
                tone={o.active_elevations > 0 ? "warn" : "default"} />
              <Kpi label="High-risk users" value={o.high_risk_users + o.critical_risk_users}
                hint={`${o.critical_risk_users} critical`}
                tone={o.critical_risk_users > 0 ? "bad" : o.high_risk_users > 0 ? "warn" : "ok"} />
              <Kpi label="OAuth grants" value={o.oauth_grants_total}
                hint={`${o.oauth_grants_high_risk} high-risk`}
                tone={o.oauth_grants_high_risk > 0 ? "warn" : "ok"} />
              <Kpi label="Open reviews" value={o.open_reviews} hint="Quarterly attestations" />
            </div>

            <Tabs defaultValue="mfa">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="mfa"><ScanFace className="h-4 w-4 mr-1.5" /> MFA Coverage</TabsTrigger>
                <TabsTrigger value="privileged"><Crown className="h-4 w-4 mr-1.5" /> Privileged Audit</TabsTrigger>
                <TabsTrigger value="breach"><Eye className="h-4 w-4 mr-1.5" /> Breach Monitor</TabsTrigger>
                <TabsTrigger value="sharing"><Share2 className="h-4 w-4 mr-1.5" /> External Sharing</TabsTrigger>
                <TabsTrigger value="lifecycle"><UserMinus className="h-4 w-4 mr-1.5" /> Lifecycle</TabsTrigger>
                <TabsTrigger value="pim"><KeyRound className="h-4 w-4 mr-1.5" /> PIM-lite</TabsTrigger>
                <TabsTrigger value="risk"><Activity className="h-4 w-4 mr-1.5" /> Risky users</TabsTrigger>
                <TabsTrigger value="oauth"><Plug className="h-4 w-4 mr-1.5" /> OAuth grants</TabsTrigger>
                <TabsTrigger value="reviews"><Users className="h-4 w-4 mr-1.5" /> Access reviews</TabsTrigger>
                <TabsTrigger value="settings"><Clock className="h-4 w-4 mr-1.5" /> Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="mfa" className="mt-4"><MfaTab /></TabsContent>
              <TabsContent value="privileged" className="mt-4"><PrivilegedTab /></TabsContent>
              <TabsContent value="breach" className="mt-4"><BreachTab /></TabsContent>
              <TabsContent value="sharing" className="mt-4"><SharingTab /></TabsContent>
              <TabsContent value="lifecycle" className="mt-4"><LifecycleTab /></TabsContent>
              <TabsContent value="pim" className="mt-4"><PimTab /></TabsContent>
              <TabsContent value="risk" className="mt-4"><RiskTab /></TabsContent>
              <TabsContent value="oauth" className="mt-4"><OAuthTab /></TabsContent>
              <TabsContent value="reviews" className="mt-4"><ReviewsTab /></TabsContent>
              <TabsContent value="settings" className="mt-4"><SettingsTab onDisable={() => setConfirmDisable(true)} /></TabsContent>
            </Tabs>
          </>
        )}

        <Dialog open={confirmDisable} onOpenChange={setConfirmDisable}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disable M365 Shield?</DialogTitle>
              <DialogDescription>
                All Shield polls stop immediately for this organization. Active PIM elevations will still auto-revoke when their timers expire.
                Historical data is preserved.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDisable(false)}>Cancel</Button>
              <Button variant="destructive" disabled={enable.isPending} onClick={async () => { await enable.mutateAsync(false); setConfirmDisable(false); }}>
                Disable
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
