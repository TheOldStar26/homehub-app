-- HomeHub only. No calendar events, accounts or existing subscriptions change.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'homehub_reminder_scheduler') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'homehub_reminder_scheduler', 'Private HomeHub reminder scheduler authentication');
  end if;
end $$;

create or replace function public.homehub_scheduler_authorized(candidate text)
returns boolean language sql stable security definer set search_path = '' as $$
  select length(candidate) = 64 and exists (
    select 1 from vault.decrypted_secrets
    where name = 'homehub_reminder_scheduler'
      and pg_catalog.sha256(pg_catalog.convert_to(candidate, 'UTF8')) =
          pg_catalog.sha256(pg_catalog.convert_to(decrypted_secret, 'UTF8'))
  );
$$;
revoke all on function public.homehub_scheduler_authorized(text) from public, anon, authenticated;
grant execute on function public.homehub_scheduler_authorized(text) to service_role;
revoke all on public.homehub_notification_deliveries from anon, authenticated;

-- Keep the existing job identity; replace its plaintext token and run each minute.
do $$
declare scheduler_job bigint;
begin
  select jobid into strict scheduler_job from cron.job
    where jobname = 'homehub-reminders-every-five-minutes';
  perform cron.alter_job(scheduler_job, schedule := '* * * * *', command := $job$
    select net.http_post(
      url := 'https://ejshqohrnsdmzinvqqzz.supabase.co/functions/v1/homehub-reminder-sender',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-homehub-scheduler', (select decrypted_secret from vault.decrypted_secrets
          where name = 'homehub_reminder_scheduler')),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $job$);
end $$;
