revoke delete on public.notifications from anon;
grant delete on public.notifications to authenticated;

create policy "Users can delete their own notifications"
  on public.notifications for delete
  to authenticated
  using ((select auth.uid()) = recipient_id);
