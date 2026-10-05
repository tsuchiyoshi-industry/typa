-- Only the finalizing secondary evaluator can read these two verified addresses.
-- No public email column, Auth schema exposure, or client service_role key needed.
begin;

create or replace function public.get_finalized_sheet_notification_recipients(p_sheet_id bigint)
returns table (role text, employee_id integer, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_id integer;
  secondary_id integer;
begin
  select subject.primary_evaluator_id, subject.secondary_evaluator_id
    into primary_id, secondary_id
  from public.evaluation_sheets as sheet
  join public.employees as subject on subject.id = sheet.employee_id
  join public.employees as evaluator on evaluator.id = subject.secondary_evaluator_id
  where sheet.id = p_sheet_id
    and sheet.status = 'finalized'
    and evaluator.user_id = auth.uid()
    and evaluator.id <> subject.id;

  if not found then
    raise exception 'Finalized sheet notification access denied' using errcode = '42501';
  end if;

  return query
  select recipients.role, recipients.employee_id,
         case when account.email_confirmed_at is not null then account.email::text else null::text end
  from (values ('primary'::text, primary_id), ('secondary'::text, secondary_id))
       as recipients(role, employee_id)
  left join public.employees as evaluator on evaluator.id = recipients.employee_id
  left join auth.users as account on account.id = evaluator.user_id;
end;
$$;

revoke all on function public.get_finalized_sheet_notification_recipients(bigint) from public, anon, authenticated;
grant execute on function public.get_finalized_sheet_notification_recipients(bigint) to authenticated;
comment on function public.get_finalized_sheet_notification_recipients(bigint)
  is 'Verified primary/secondary Auth emails for finalized-sheet notifications; secondary evaluator only.';

commit;
