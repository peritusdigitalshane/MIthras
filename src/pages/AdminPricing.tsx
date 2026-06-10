import { useState, useMemo } from "react";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Receipt, Warehouse, Briefcase, Users, Pencil, Check, X, ShieldAlert, Save } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import {
  usePricingDefaults, useUpdatePricingDefault,
  useOrganizationPricing, useUpdateOrgPricing,
  type PricingDefault, type OrgPricingRow,
} from "@/hooks/usePlatformPricing";

function fmtMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

const TIER_META = {
  distributor: { label: "Distributors", icon: <Warehouse className="h-4 w-4" />, blurb: "What Peritus charges the distributor per endpoint per month." },
  partner:     { label: "Resellers",    icon: <Briefcase className="h-4 w-4" />, blurb: "What a distributor (or Peritus, for direct resellers) charges the reseller per endpoint per month." },
  customer:    { label: "Customers",    icon: <Users className="h-4 w-4" />,     blurb: "Suggested retail rate resellers charge their end customers. Advisory only — resellers price independently." },
} as const;

export default function AdminPricing() {
  const { isSuperAdmin, isLoading: tenantLoading } = useTenant();
  const { data: defaults, isLoading: defaultsLoading } = usePricingDefaults();
  const { data: orgs, isLoading: orgsLoading } = useOrganizationPricing();
  const updateDefault = useUpdatePricingDefault();
  const updateOrg     = useUpdateOrgPricing();

  if (tenantLoading) {
    return <MainLayout><div className="p-6"><Skeleton className="h-32 w-full" /></div></MainLayout>;
  }
  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Super-admin only</AlertTitle>
            <AlertDescription>Platform pricing is managed by Peritus operators.</AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6 max-w-7xl mx-auto">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Receipt className="h-4 w-4" /> Platform admin
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Tier defaults apply to every org of that type unless an explicit per-org override is set.
            Changes here propagate to billing rollups within a few seconds — no service restart required.
          </p>
        </div>

        <Tabs defaultValue="defaults">
          <TabsList>
            <TabsTrigger value="defaults">Tier defaults</TabsTrigger>
            <TabsTrigger value="overrides">Per-org overrides</TabsTrigger>
          </TabsList>

          <TabsContent value="defaults" className="space-y-4 pt-4">
            {defaultsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(defaults ?? []).map(d => (
                  <PricingDefaultCard
                    key={d.tier}
                    row={d}
                    onSave={async (cents) => {
                      await updateDefault.mutateAsync({ tier: d.tier, wholesale_price_cents: cents });
                      toast.success(`${TIER_META[d.tier].label} default updated`);
                    }}
                  />
                ))}
              </div>
            )}

            <Alert>
              <AlertTitle className="text-sm">How pricing resolves</AlertTitle>
              <AlertDescription className="text-xs">
                For any organisation the effective per-endpoint price is the FIRST non-NULL of:
                (1) per-org override (set in the Overrides tab),
                (2) tier default (set above),
                (3) zero.
                Billing rollups for resellers and distributors use this resolution at query time.
              </AlertDescription>
            </Alert>
          </TabsContent>

          <TabsContent value="overrides" className="pt-4">
            {orgsLoading ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <OrgPricingTable orgs={orgs ?? []} updateOrg={updateOrg} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

function PricingDefaultCard({ row, onSave }: { row: PricingDefault; onSave: (cents: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState((row.wholesale_price_cents / 100).toFixed(2));
  const [saving, setSaving]   = useState(false);

  const meta = TIER_META[row.tier];

  const handleSave = async () => {
    const cents = Math.round(parseFloat(draft) * 100);
    if (Number.isNaN(cents) || cents < 0) { toast.error("Enter a valid price"); return; }
    setSaving(true);
    try {
      await onSave(cents);
      setEditing(false);
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            {meta.icon} {meta.label}
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">{row.tier}</Badge>
        </div>
        <CardDescription className="text-xs">{meta.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{row.currency_code}</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="font-mono text-lg h-10"
              autoFocus
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">/ endpoint / mo</span>
          </div>
        ) : (
          <div>
            <div className="text-3xl font-bold tabular-nums">{fmtMoney(row.wholesale_price_cents, row.currency_code)}</div>
            <div className="text-xs text-muted-foreground">per endpoint / month</div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft((row.wholesale_price_cents/100).toFixed(2)); }}>
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-3 w-3 mr-1" /> {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground pt-1 border-t">
          Updated {format(new Date(row.updated_at), "d MMM yyyy")}
        </div>
      </CardContent>
    </Card>
  );
}

function OrgPricingTable({
  orgs,
  updateOrg,
}: {
  orgs: OrgPricingRow[];
  updateOrg: ReturnType<typeof useUpdateOrgPricing>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft]         = useState<string>("");

  const grouped = useMemo(() => ({
    distributor: orgs.filter(o => o.organization_type === "distributor"),
    partner:     orgs.filter(o => o.organization_type === "partner"),
    customer:    orgs.filter(o => o.organization_type === "customer"),
  }), [orgs]);

  const saveOverride = async (org: OrgPricingRow) => {
    const trimmed = draft.trim();
    const cents = trimmed === "" ? null : Math.round(parseFloat(trimmed) * 100);
    if (cents !== null && (Number.isNaN(cents) || cents < 0)) { toast.error("Invalid price"); return; }
    try {
      await updateOrg.mutateAsync({ orgId: org.id, wholesale_price_cents: cents });
      toast.success(cents === null ? `${org.name} reverted to tier default` : `${org.name} pricing updated`);
      setEditingId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't save");
    }
  };

  const renderTable = (rows: OrgPricingRow[], emptyLabel: string) => (
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground py-6 text-center">{emptyLabel}</p>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organisation</TableHead>
            <TableHead className="text-right">Tier default</TableHead>
            <TableHead className="text-right">Override</TableHead>
            <TableHead className="text-right">Effective</TableHead>
            <TableHead className="w-[120px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(o => {
            const isEditing = editingId === o.id;
            return (
              <TableRow key={o.id}>
                <TableCell>
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">{o.slug}</div>
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                  {fmtMoney(o.tier_default_cents ?? 0, o.currency_code)}
                </TableCell>
                <TableCell className="text-right">
                  {isEditing ? (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        className="h-7 w-24 text-right font-mono text-xs"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="leave blank = default"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                      />
                    </div>
                  ) : o.override_price_cents !== null ? (
                    <span className="font-mono text-sm tabular-nums">{fmtMoney(o.override_price_cents, o.currency_code)}</span>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">inherits default</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {fmtMoney(o.effective_price_cents, o.currency_code)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {isEditing ? (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Save price override" disabled={updateOrg.isPending} onClick={() => saveOverride(o)}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Cancel edit" disabled={updateOrg.isPending} onClick={() => setEditingId(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => {
                        setEditingId(o.id);
                        setDraft(o.override_price_cents !== null ? (o.override_price_cents / 100).toFixed(2) : "");
                      }}>
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    )
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Warehouse className="h-4 w-4" /> Distributors</CardTitle>
          <CardDescription>What Peritus charges each distributor per endpoint per month.</CardDescription>
        </CardHeader>
        <CardContent>{renderTable(grouped.distributor, "No distributors yet.")}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Briefcase className="h-4 w-4" /> Resellers</CardTitle>
          <CardDescription>Direct resellers and resellers under a distributor. Per-org override beats tier default.</CardDescription>
        </CardHeader>
        <CardContent>{renderTable(grouped.partner, "No resellers yet.")}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Customers</CardTitle>
          <CardDescription>End-customer per-endpoint price. Used as the reseller-to-customer rate in billing rollups.</CardDescription>
        </CardHeader>
        <CardContent>{renderTable(grouped.customer, "No customers yet.")}</CardContent>
      </Card>
    </div>
  );
}
