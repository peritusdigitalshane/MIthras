-- Add policy to allow users to check their own super admin status
CREATE POLICY "Users can check their own super admin status"
ON public.super_admins
FOR SELECT
USING (user_id = auth.uid());