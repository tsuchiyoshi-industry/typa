-- Submitting a sheet now notifies its primary evaluator. The mail is sent by the app of the
-- employee who submits, so that employee needs the evaluator's address and the SMTP account.
begin;

-- The subject of a submitted sheet gets the contact email of the sheet's primary evaluator,
-- or null when that evaluator is unassigned or not registered.
create or replace function public.get_submitted_sheet_notification_recipient(p_sheet_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  primary_id integer;
begin
  select sheet.primary_evaluator_id into primary_id
  from public.evaluation_sheets as sheet
  join public.employees as subject on subject.id = sheet.employee_id
  where sheet.id = p_sheet_id
    and sheet.status = 'submitted'
    and subject.user_id = auth.uid();

  if not found then
    raise exception 'Submitted sheet notification access denied' using errcode = '42501';
  end if;

  return (
    select case when account.email_confirmed_at is not null
                then nullif(account.raw_user_meta_data ->> 'contact_email', '') end
    from public.employees as evaluator
    join auth.users as account on account.id = evaluator.user_id
    where evaluator.id = primary_id
  );
end;
$$;
revoke all on function public.get_submitted_sheet_notification_recipient(bigint) from public, anon, authenticated;
grant execute on function public.get_submitted_sheet_notification_recipient(bigint) to authenticated;
comment on function public.get_submitted_sheet_notification_recipient(bigint)
  is 'Sign-up contact email of the primary evaluator of a submitted sheet; the sheet''s subject only.';

-- Same as 202610080013, widened from the evaluators of a sheet to its subject as well:
-- every employee who has a sheet can now read the SMTP account, password included.
create or replace function public.get_notification_smtp_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.evaluation_sheets as sheet
    join public.employees as member
      on member.id in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id)
    where member.user_id = auth.uid()
  ) then
    raise exception 'Notification SMTP settings access denied' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'host', settings.smtp_host, 'port', settings.smtp_port,
      'user', settings.smtp_user, 'password', settings.smtp_password
    )
    from public.workspace_settings as settings
  );
end;
$$;
revoke all on function public.get_notification_smtp_settings() from public, anon, authenticated;
grant execute on function public.get_notification_smtp_settings() to authenticated;
comment on function public.get_notification_smtp_settings()
  is 'SMTP account for notification mail, password included; the subject and the evaluators of a sheet only.';

commit;
