-- Update the free plan to allow only 1 device instead of 2
UPDATE public.plan_features 
SET max_devices = 1, updated_at = now()
WHERE plan = 'free';