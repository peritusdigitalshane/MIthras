import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useCreateUacPolicy,
  useUpdateUacPolicy,
  UAC_ADMIN_PROMPTS,
  UAC_USER_PROMPTS,
  type UacPolicy,
} from "@/hooks/useUacPolicies";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  enable_lua: z.boolean(),
  consent_prompt_admin: z.number().min(0).max(5),
  consent_prompt_user: z.number().min(0).max(3),
  prompt_on_secure_desktop: z.boolean(),
  detect_installations: z.boolean(),
  validate_admin_signatures: z.boolean(),
  filter_administrator_token: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

interface UacPolicyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy?: UacPolicy | null;
}

export function UacPolicyDialog({ open, onOpenChange, policy }: UacPolicyDialogProps) {
  const createPolicy = useCreateUacPolicy();
  const updatePolicy = useUpdateUacPolicy();
  const isEditing = !!policy;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      enable_lua: true,
      consent_prompt_admin: 5,
      consent_prompt_user: 3,
      prompt_on_secure_desktop: true,
      detect_installations: true,
      validate_admin_signatures: false,
      filter_administrator_token: false,
    },
  });

  useEffect(() => {
    if (policy) {
      form.reset({
        name: policy.name,
        description: policy.description || "",
        enable_lua: policy.enable_lua,
        consent_prompt_admin: policy.consent_prompt_admin,
        consent_prompt_user: policy.consent_prompt_user,
        prompt_on_secure_desktop: policy.prompt_on_secure_desktop,
        detect_installations: policy.detect_installations,
        validate_admin_signatures: policy.validate_admin_signatures,
        filter_administrator_token: policy.filter_administrator_token,
      });
    } else {
      form.reset({
        name: "",
        description: "",
        enable_lua: true,
        consent_prompt_admin: 5,
        consent_prompt_user: 3,
        prompt_on_secure_desktop: true,
        detect_installations: true,
        validate_admin_signatures: false,
        filter_administrator_token: false,
      });
    }
  }, [policy, form]);

  const onSubmit = async (values: FormValues) => {
    if (isEditing) {
      await updatePolicy.mutateAsync({ id: policy.id, data: values });
    } else {
      await createPolicy.mutateAsync({
        name: values.name,
        description: values.description,
        enable_lua: values.enable_lua,
        consent_prompt_admin: values.consent_prompt_admin,
        consent_prompt_user: values.consent_prompt_user,
        prompt_on_secure_desktop: values.prompt_on_secure_desktop,
        detect_installations: values.detect_installations,
        validate_admin_signatures: values.validate_admin_signatures,
        filter_administrator_token: values.filter_administrator_token,
      });
    }
    onOpenChange(false);
  };

  const isPending = createPolicy.isPending || updatePolicy.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit UAC Policy" : "Create UAC Policy"}</DialogTitle>
          <DialogDescription>
            Configure User Account Control settings for your endpoints.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Policy Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Standard Desktop UAC" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Optional description of this policy..."
                          className="resize-none"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Core UAC Setting */}
              <div className="space-y-4">
                <h4 className="text-sm font-medium">Core Setting</h4>
                
                <FormField
                  control={form.control}
                  name="enable_lua"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Enable UAC (EnableLUA)</FormLabel>
                        <FormDescription>
                          Master switch for User Account Control. Disabling is not recommended.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Prompt Behavior */}
              <div className="space-y-4">
                <h4 className="text-sm font-medium">Prompt Behavior</h4>

                <FormField
                  control={form.control}
                  name="consent_prompt_admin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Admin Prompt Behavior (ConsentPromptBehaviorAdmin)</FormLabel>
                      <Select 
                        value={field.value.toString()} 
                        onValueChange={(v) => field.onChange(parseInt(v))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(UAC_ADMIN_PROMPTS).map(([value, info]) => (
                            <SelectItem key={value} value={value}>
                              <div className="flex flex-col">
                                <span>{info.label}</span>
                                <span className="text-xs text-muted-foreground">{info.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        How administrators are prompted when elevation is required.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="consent_prompt_user"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>User Prompt Behavior (ConsentPromptBehaviorUser)</FormLabel>
                      <Select 
                        value={field.value.toString()} 
                        onValueChange={(v) => field.onChange(parseInt(v))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(UAC_USER_PROMPTS).map(([value, info]) => (
                            <SelectItem key={value} value={value}>
                              <div className="flex flex-col">
                                <span>{info.label}</span>
                                <span className="text-xs text-muted-foreground">{info.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        How standard users are prompted when elevation is required.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="prompt_on_secure_desktop"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel>Prompt on Secure Desktop</FormLabel>
                        <FormDescription>
                          Show UAC prompts on the secure desktop to prevent spoofing.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Additional Settings */}
              <div className="space-y-4">
                <h4 className="text-sm font-medium">Additional Settings</h4>

                <FormField
                  control={form.control}
                  name="detect_installations"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel>Detect Installations</FormLabel>
                        <FormDescription>
                          Automatically detect application installations and prompt for elevation.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="validate_admin_signatures"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel>Validate Admin Code Signatures</FormLabel>
                        <FormDescription>
                          Only allow elevation for applications with valid digital signatures.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="filter_administrator_token"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel>Filter Administrator Token</FormLabel>
                        <FormDescription>
                          Run the built-in Administrator account in Admin Approval Mode.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={form.handleSubmit(onSubmit)} disabled={isPending}>
            {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
