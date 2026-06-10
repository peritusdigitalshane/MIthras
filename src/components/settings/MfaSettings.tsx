import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Shield, Smartphone, Loader2, CheckCircle, AlertTriangle, Info, QrCode, Copy, Key } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface MfaFactor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  created_at: string;
}

export function MfaSettings() {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showEnrollDialog, setShowEnrollDialog] = useState(false);
  const [enrollmentData, setEnrollmentData] = useState<{
    id: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isUnenrolling, setIsUnenrolling] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchFactors = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setFactors(data.totp || []);
    } catch (error: any) {
      console.error("Failed to fetch MFA factors:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFactors();
  }, []);

  const handleStartEnrollment = async () => {
    setIsEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });
      
      if (error) throw error;
      
      setEnrollmentData({
        id: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setShowEnrollDialog(true);
    } catch (error: any) {
      toast({
        title: "Failed to start MFA enrollment",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleVerifyEnrollment = async () => {
    if (!enrollmentData || !verifyCode) return;
    
    setIsVerifying(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrollmentData.id,
      });
      
      if (challengeError) throw challengeError;
      
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollmentData.id,
        challengeId: challengeData.id,
        code: verifyCode,
      });
      
      if (verifyError) throw verifyError;
      
      toast({
        title: "MFA enabled successfully",
        description: "Your account is now protected with two-factor authentication.",
      });
      
      setShowEnrollDialog(false);
      setEnrollmentData(null);
      setVerifyCode("");
      fetchFactors();
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleUnenroll = async (factorId: string) => {
    // Confirm before removing — losing MFA without a backup factor is an
    // account-recovery problem if the user signs out.
    const confirmed = typeof window !== "undefined" && window.confirm(
      "Remove this authenticator?\n\n"
      + "You'll be asked to set up MFA again on your next sign-in. "
      + "If you no longer have access to the authenticator app, you'll lose "
      + "the ability to verify — your admin will need to reset MFA for you."
    );
    if (!confirmed) return;
    setIsUnenrolling(factorId);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;

      toast({
        title: "MFA disabled",
        description: "Two-factor authentication has been removed from your account.",
      });

      fetchFactors();
    } catch (error: any) {
      toast({
        title: "Failed to disable MFA",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsUnenrolling(null);
    }
  };

  const copySecret = () => {
    if (enrollmentData?.secret) {
      navigator.clipboard.writeText(enrollmentData.secret);
      toast({ title: "Secret copied to clipboard" });
    }
  };

  const verifiedFactors = factors.filter(f => f.status === "verified");
  const hasMfaEnabled = verifiedFactors.length > 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">Two-Factor Authentication</CardTitle>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>MFA adds an extra layer of security by requiring a code from your authenticator app when signing in.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <CardDescription>
                  Add an extra layer of security to your account
                </CardDescription>
              </div>
            </div>
            {hasMfaEnabled ? (
              <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
                <CheckCircle className="h-3 w-3 mr-1" />
                Enabled
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Not Enabled
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasMfaEnabled && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                We strongly recommend enabling MFA to protect your account from unauthorized access.
                You'll need an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator.
              </AlertDescription>
            </Alert>
          )}

          {verifiedFactors.length > 0 && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Active Authenticators</Label>
              {verifiedFactors.map((factor) => (
                <div
                  key={factor.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    <Smartphone className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">{factor.friendly_name || "Authenticator App"}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {format(new Date(factor.created_at), "d MMM yyyy")}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleUnenroll(factor.id)}
                    disabled={isUnenrolling === factor.id}
                  >
                    {isUnenrolling === factor.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Remove"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!hasMfaEnabled && (
            <Button onClick={handleStartEnrollment} disabled={isEnrolling}>
              {isEnrolling ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Key className="h-4 w-4 mr-2" />
              )}
              Set Up Two-Factor Authentication
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Enrollment Dialog */}
      <Dialog open={showEnrollDialog} onOpenChange={(open) => {
        if (!open && enrollmentData) {
          // Cancel enrollment if dialog is closed without verifying
          supabase.auth.mfa.unenroll({ factorId: enrollmentData.id });
        }
        setShowEnrollDialog(open);
        if (!open) {
          setEnrollmentData(null);
          setVerifyCode("");
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Set Up Authenticator App
            </DialogTitle>
            <DialogDescription>
              Scan this QR code with your authenticator app, then enter the 6-digit code to verify.
            </DialogDescription>
          </DialogHeader>
          
          {enrollmentData && (
            <div className="space-y-6 py-4">
              {/* QR Code */}
              <div className="flex justify-center">
                <div className="p-4 bg-white rounded-lg">
                  <img 
                    src={enrollmentData.qr} 
                    alt="MFA QR Code" 
                    className="w-48 h-48"
                  />
                </div>
              </div>

              {/* Manual Entry Option */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Can't scan? Enter this code manually:
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
                    {enrollmentData.secret}
                  </code>
                  <Button variant="ghost" size="icon" onClick={copySecret}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Verification Code Input */}
              <div className="space-y-2">
                <Label htmlFor="verify-code">Enter 6-digit code from your app</Label>
                <Input
                  id="verify-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-2xl tracking-widest font-mono"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEnrollDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleVerifyEnrollment} 
              disabled={verifyCode.length !== 6 || isVerifying}
            >
              {isVerifying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Verify & Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
