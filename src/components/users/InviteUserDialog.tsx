import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, Mail, Copy, Check, User, UserCog } from "lucide-react";
import { useCreateEnrollmentCode } from "@/hooks/useEnrollmentCodes";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

type Role = "member" | "admin";

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteUserDialog({ open, onOpenChange }: InviteUserDialogProps) {
  const { currentOrganization } = useTenant();
  const { toast } = useToast();
  const createCode = useCreateEnrollmentCode();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const signupUrl =
    generatedCode != null
      ? `${window.location.origin}/signup?code=${encodeURIComponent(generatedCode)}`
      : null;

  const reset = () => {
    setEmail("");
    setRole("member");
    setGeneratedCode(null);
    setCopied(false);
  };

  const generateLink = async () => {
    if (!currentOrganization?.id) return;
    try {
      // 30-day window, up to 5 uses so the same link can be used by a small team.
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const result = await createCode.mutateAsync({
        organizationId: currentOrganization.id,
        role,
        isSingleUse: false,
        maxUses: 5,
        expiresAt,
      });
      setGeneratedCode(result.code);
    } catch (e) {
      toast({
        title: "Couldn't generate invite link",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const copyLink = async () => {
    if (!signupUrl) return;
    try {
      await navigator.clipboard.writeText(signupUrl);
      setCopied(true);
      toast({ title: "Invite link copied" });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the link and copy manually.",
        variant: "destructive",
      });
    }
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Invite user to {currentOrganization?.name}</DialogTitle>
          <DialogDescription>
            Generate a single-org invite link. They sign up at that URL, the
            enrollment code is consumed automatically, and they join with the
            role you choose.
          </DialogDescription>
        </DialogHeader>

        {!generatedCode ? (
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="invite-email">Email (optional)</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="they@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                We don't send anything yet — copy the generated link and share it
                however you like.
              </p>
            </div>
            <div>
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Member — view + use
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <UserCog className="h-4 w-4" />
                      Admin — manage policies + users
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-muted/40 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Invite link
              </p>
              <p className="font-mono text-xs break-all mt-1">{signupUrl}</p>
              <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                <span>Code: <span className="font-mono">{generatedCode}</span></span>
                <span>·</span>
                <span>Role: <strong>{role}</strong></span>
                <span>·</span>
                <span>Expires in 30 days</span>
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-blue-500/5 border border-blue-500/20 rounded-md p-3">
              <Mail className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
              <div>
                <p>
                  Share the link with <strong>{email || "the recipient"}</strong>.
                  Up to 5 people can use it within 30 days.
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!generatedCode ? (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)}>Cancel</Button>
              <Button onClick={generateLink} disabled={createCode.isPending}>
                {createCode.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-2" />
                )}
                Generate invite link
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>Done</Button>
              <Button onClick={copyLink}>
                {copied ? (
                  <Check className="h-4 w-4 mr-2" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
