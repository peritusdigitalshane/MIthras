import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WdacPolicyTemplate {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  rules: Array<{
    action: "allow" | "block";
    rule_type: "publisher" | "path" | "hash" | "file_name";
    value: string;
    publisher_name: string | null;
    product_name: string | null;
    file_version_min: string | null;
    description: string | null;
  }>;
}

export function useWdacTemplates() {
  return useQuery({
    queryKey: ["wdac-policy-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wdac_policy_templates")
        .select("id, name, description, is_system, rules")
        .order("name");

      if (error) throw error;
      return (data ?? []) as WdacPolicyTemplate[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
