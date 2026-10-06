-- "No secondary evaluator" is recorded explicitly so it cannot be confused with a
-- secondary evaluator that simply has not been assigned yet (secondary_evaluator_id is null).
-- Only employees explicitly marked here are finalized by their primary evaluator.
begin;

alter table public.employees
  add column if not exists no_secondary_evaluator boolean not null default false;
comment on column public.employees.no_secondary_evaluator
  is 'true: this employee has no secondary evaluator by decision; the primary evaluation is final. false with a null secondary_evaluator_id means not assigned yet.';

alter table public.employees drop constraint if exists employees_no_secondary_evaluator_check;
alter table public.employees add constraint employees_no_secondary_evaluator_check
  check (not (no_secondary_evaluator and secondary_evaluator_id is not null));

-- Recipient lookup is allowed to the final evaluator: the secondary evaluator,
-- or the primary evaluator when the employee is explicitly marked as having none.
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
  join public.employees as evaluator
    on evaluator.id = case
         when subject.secondary_evaluator_id is not null then subject.secondary_evaluator_id
         when subject.no_secondary_evaluator then subject.primary_evaluator_id
       end
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
  is 'Verified primary/secondary Auth emails for finalized-sheet notifications; final evaluator only (secondary, or primary when the employee is marked no_secondary_evaluator).';

commit;
