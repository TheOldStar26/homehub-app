-- Run as the project administrator. All synthetic changes roll back.
begin;
select set_config('homehub.test_owner', (select user_id::text from public.push_subscriptions limit 1), true);
select set_config('homehub.test_event', gen_random_uuid()::text, true);
select set_config('request.jwt.claim.sub', current_setting('homehub.test_owner'), true);
set local role authenticated;
insert into public.calendar_events(id,user_id,title,category,all_day,start_date,end_date,start_time,end_time,timezone,recurrence,reminders)
values (current_setting('homehub.test_event')::uuid,auth.uid(),'HomeHub rollback-only security test','personal',false,'2099-01-01','2099-01-01','10:00','11:00','UTC','none',array[1440,720,60,30,15,10,5,0]);
do $$ begin
  if not exists (select 1 from public.calendar_events where id=current_setting('homehub.test_event')::uuid and reminders=array[1440,720,60,30,15,10,5,0]) then raise exception 'Owner reminder roundtrip failed'; end if;
end $$;
update public.calendar_events set reminders=array[27,5,0] where id=current_setting('homehub.test_event')::uuid;
do $$ begin
  if not exists (select 1 from public.calendar_events where id=current_setting('homehub.test_event')::uuid and reminders=array[27,5,0]) then raise exception 'Owner custom reminder edit failed'; end if;
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$ declare changed integer; begin
  if exists (select 1 from public.calendar_events where id=current_setting('homehub.test_event')::uuid) then raise exception 'Other owner could read event'; end if;
  update public.calendar_events set title='Forbidden edit' where id=current_setting('homehub.test_event')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Other owner could edit event'; end if;
  delete from public.calendar_events where id=current_setting('homehub.test_event')::uuid;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Other owner could delete event'; end if;
  begin
    insert into public.calendar_events(user_id,title,category,all_day,start_date,end_date,start_time,end_time,timezone,recurrence,reminders)
    values(current_setting('homehub.test_owner')::uuid,'Forbidden insert','personal',false,'2099-01-01','2099-01-01','10:00','11:00','UTC','none',array[5,0]);
    raise exception 'Other owner could insert event';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('homehub.test_owner'),true);
delete from public.calendar_events where id=current_setting('homehub.test_event')::uuid;
do $$ begin
  if exists (select 1 from public.calendar_events where id=current_setting('homehub.test_event')::uuid) then raise exception 'Owner delete failed'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.homehub_scheduler_authorized(text)','execute') or has_function_privilege('authenticated','public.homehub_scheduler_authorized(text)','execute') then raise exception 'Scheduler authentication RPC exposed'; end if;
  if has_table_privilege('authenticated','public.homehub_notification_deliveries','truncate') then raise exception 'Delivery markers exposed'; end if;
  if not has_table_privilege('service_role','public.homehub_notification_deliveries','insert') or not has_table_privilege('service_role','public.homehub_notification_deliveries','delete') then raise exception 'Sender cannot claim/retry deliveries'; end if;
end $$;
rollback;
select 'PASS: reminder create/read/edit/delete, cross-owner isolation, scheduler and delivery-marker protection; changes rolled back' as result;
