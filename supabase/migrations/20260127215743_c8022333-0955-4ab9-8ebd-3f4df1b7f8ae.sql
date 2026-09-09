-- Add exclusion paths columns to defender_policies
ALTER TABLE public.defender_policies 
ADD COLUMN IF NOT EXISTS exclusion_paths TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS exclusion_processes TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS exclusion_extensions TEXT[] DEFAULT '{}';