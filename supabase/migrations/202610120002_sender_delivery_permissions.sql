-- The sender's service role lacked DML privileges on its deduplication table.
-- RLS and the browser-role revocations remain intact.
grant select, insert, delete on public.homehub_notification_deliveries to service_role;
