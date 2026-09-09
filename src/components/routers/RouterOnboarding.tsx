import { useState, useRef } from "react";
import {
  useRouterEnrollmentTokens,
  useCreateRouterEnrollmentToken,
  useDeleteRouterEnrollmentToken,
} from "@/hooks/useRouterEnrollment";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Copy, Key, Terminal, Loader2, Check, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const CHECKIN_URL = `${((import.meta.env.VITE_SUPABASE_URL as string) ?? "").replace(/\/$/, "")}/functions/v1/router-checkin`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success("Copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export function RouterOnboarding() {
  const { data: tokens, isLoading } = useRouterEnrollmentTokens();
  const createToken = useCreateRouterEnrollmentToken();
  const deleteToken = useDeleteRouterEnrollmentToken();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", max_uses: "" });
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState(false);
  const scriptsRef = useRef<HTMLDivElement>(null);

  const handleCreate = async () => {
    if (!form.label) return;
    const result = await createToken.mutateAsync({
      label: form.label,
      max_uses: form.max_uses ? parseInt(form.max_uses) : undefined,
    });
    setSelectedToken(result.plaintext_token);
    setJustCreated(true);
    setOpen(false);
    setForm({ label: "", max_uses: "" });
    // Scroll to scripts after a tick
    setTimeout(() => {
      scriptsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  // Only a token minted in THIS browser session can populate the scripts —
  // enrolment tokens are hashed at rest, so an existing row cannot be
  // re-displayed. Falling back to tokens[0] would render a broken command.
  const activeToken = selectedToken;

  const curlExample = `curl -X POST ${CHECKIN_URL} \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "enroll",
    "enrollment_token": "${activeToken || "<YOUR_TOKEN>"}",
    "hostname": "router-hq-01",
    "vendor": "ubiquiti-udm",
    "model": "UDM Pro",
    "management_ip": "192.168.1.1",
    "wan_ip": "203.0.113.1"
  }'`;

  const ubiquitiScript = `#!/bin/bash
# Ubiquiti Router Check-in Script
# Deploy via UniFi controller or SSH

TOKEN="${activeToken || "<YOUR_TOKEN>"}"
API="${CHECKIN_URL}"
HOSTNAME=$(hostname)
WAN_IP=$(curl -s ifconfig.me)
VENDOR="ubiquiti-udm"
MODEL=$(cat /etc/board.info 2>/dev/null | grep board.name | cut -d= -f2 || echo "Unknown")

# Enroll
curl -s -X POST "$API" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"action\\": \\"enroll\\",
    \\"enrollment_token\\": \\"$TOKEN\\",
    \\"hostname\\": \\"$HOSTNAME\\",
    \\"vendor\\": \\"$VENDOR\\",
    \\"model\\": \\"$MODEL\\",
    \\"wan_ip\\": \\"$WAN_IP\\"
  }"

echo "Router enrolled. Set up a cron for heartbeat:"
echo "*/5 * * * * curl -s -X POST $API -H 'Content-Type: application/json' -d '{\\\"action\\\":\\\"heartbeat\\\",\\\"agent_token\\\":\\\"<AGENT_TOKEN_FROM_ENROLL>\\\",\\\"wan_ip\\\":\\\"'\$(curl -s ifconfig.me)'\\\"}'"`;

  const vyosScript = `#!/bin/vbash
# VyOS Router Check-in Script
source /opt/vyatta/etc/functions/script-template

TOKEN="${activeToken || "<YOUR_TOKEN>"}"
API="${CHECKIN_URL}"
HOSTNAME=$(hostname)
WAN_IP=$(curl -s ifconfig.me)
FW_VER=$(show version | grep Version | awk '{print $2}')

curl -s -X POST "$API" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"action\\": \\"enroll\\",
    \\"enrollment_token\\": \\"$TOKEN\\",
    \\"hostname\\": \\"$HOSTNAME\\",
    \\"vendor\\": \\"vyos\\",
    \\"firmware_version\\": \\"$FW_VER\\",
    \\"wan_ip\\": \\"$WAN_IP\\"
  }"`;

  return (
    <div className="space-y-6">
      {/* Enrollment Tokens */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Enrollment Tokens
              </CardTitle>
              <CardDescription>
                Generate tokens that routers use to register with the platform
              </CardDescription>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />New Token</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Enrollment Token</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Label *</Label>
                    <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Branch Office Deployment" />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Uses (optional)</Label>
                    <Input type="number" value={form.max_uses} onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))} placeholder="Unlimited" />
                  </div>
                  <Button onClick={handleCreate} disabled={createToken.isPending || !form.label} className="w-full">
                    {createToken.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Generate Token
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens?.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.label}</TableCell>
                    <TableCell>
                      <span
                        className="text-xs text-muted-foreground"
                        title="Enrolment tokens are stored hashed. The plaintext is shown once, when the token is created."
                      >
                        Shown once at creation
                      </span>
                    </TableCell>
                    <TableCell>{t.use_count}{t.max_uses ? ` / ${t.max_uses}` : ""}</TableCell>
                    <TableCell>
                      {t.is_active
                        ? <Badge variant="default">Active</Badge>
                        : <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!tokens?.length && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No enrollment tokens yet. Create one to onboard routers.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Onboarding Scripts */}
      <div ref={scriptsRef}>
        <Card className={justCreated ? "ring-2 ring-primary" : ""}>
          <CardHeader>
            {justCreated && (
              <div className="flex items-center gap-2 text-sm text-primary mb-2">
                <CheckCircle2 className="h-4 w-4" />
                Token created! Copy the script below and run it on your router.
              </div>
            )}
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Onboarding Scripts
            </CardTitle>
            <CardDescription>
              {activeToken
                ? "These scripts are pre-filled with your enrollment token — just copy and run."
                : "Create an enrollment token above first, then the scripts will be ready to copy."}
            </CardDescription>
          </CardHeader>
        <CardContent>
          <Tabs defaultValue="curl">
            <TabsList>
              <TabsTrigger value="curl">cURL (Generic)</TabsTrigger>
              <TabsTrigger value="ubiquiti">Ubiquiti</TabsTrigger>
              <TabsTrigger value="vyos">VyOS</TabsTrigger>
            </TabsList>
            <TabsContent value="curl" className="mt-4">
              <div className="relative">
                <pre className="bg-muted rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap border">{curlExample}</pre>
                <div className="absolute top-2 right-2"><CopyButton text={curlExample} /></div>
              </div>
            </TabsContent>
            <TabsContent value="ubiquiti" className="mt-4">
              <div className="relative">
                <pre className="bg-muted rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap border">{ubiquitiScript}</pre>
                <div className="absolute top-2 right-2"><CopyButton text={ubiquitiScript} /></div>
              </div>
            </TabsContent>
            <TabsContent value="vyos" className="mt-4">
              <div className="relative">
                <pre className="bg-muted rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap border">{vyosScript}</pre>
                <div className="absolute top-2 right-2"><CopyButton text={vyosScript} /></div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this token?</AlertDialogTitle>
            <AlertDialogDescription>Routers already enrolled will continue to work, but no new routers can use this token.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteToken.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteToken.isPending}
              onClick={() => { if (deleteTarget) { deleteToken.mutate(deleteTarget); setDeleteTarget(null); } }}
            >
              {deleteToken.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
