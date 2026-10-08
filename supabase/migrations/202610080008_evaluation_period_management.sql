-- An Admin manages evaluation periods from Settings. Exactly one period is active at a time.
-- Closing a period means activating another one: activate_evaluation_period switches both
-- in one transaction, and is the only way is_active changes. A period can be closed only
-- when every one of its sheets is finalized.
-- Sheets belong to one period and can be created or changed only while that period is
-- active. Once a period is closed its sheets, goals and common evaluation results are
-- read-only for everyone, including direct API calls. (A later migration that backfills
-- sheets of closed periods has to disable the triggers below for its own statements.)
begin;

update public.evaluation_periods set is_active = false where is_active is null;
alter table public.evaluation_periods alter column is_active set default false;
alter table public.evaluation_periods alter column is_active set not null;
-- At most one active period. If several are active this fails: decide which one stays first.
create unique index if not exists evaluation_periods_single_active
  on public.evaluation_periods (is_active) where is_active;
alter table public.evaluation_periods drop constraint if exists evaluation_periods_dates_check;
alter table public.evaluation_periods add constraint evaluation_periods_dates_check
  check (start_date <= end_date);

create or replace function public.current_employee_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees as caller
    join public.roles as caller_role on caller_role.id = caller.role_id
    where caller.user_id = auth.uid() and caller_role.role_name = 'Admin'
  )
$$;
revoke all on function public.current_employee_is_admin() from public, anon, authenticated;
grant execute on function public.current_employee_is_admin() to authenticated;

-- Reading stays as it was. An Admin adds, renames, re-dates and deletes periods directly;
-- is_active is not writable by clients, and a new period always starts inactive.
alter table public.evaluation_periods enable row level security;
revoke insert, update, delete, truncate on public.evaluation_periods from anon, authenticated;
grant insert (period_name, start_date, end_date), update (period_name, start_date, end_date), delete
  on public.evaluation_periods to authenticated;

drop policy if exists "only Admin adds evaluation periods" on public.evaluation_periods;
create policy "only Admin adds evaluation periods"
  on public.evaluation_periods for insert to authenticated
  with check (public.current_employee_is_admin() and not is_active);

drop policy if exists "only Admin edits evaluation periods" on public.evaluation_periods;
create policy "only Admin edits evaluation periods"
  on public.evaluation_periods for update to authenticated
  using (public.current_employee_is_admin()) with check (true);

drop policy if exists "only Admin deletes evaluation periods" on public.evaluation_periods;
create policy "only Admin deletes evaluation periods"
  on public.evaluation_periods for delete to authenticated
  using (public.current_employee_is_admin());

-- evaluation_sheets.period_id cascades on delete, so deleting a period must never reach
-- a period that has sheets. The active period cannot be deleted either: one always remains.
create or replace function public.guard_evaluation_period_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_active then
    raise exception '実施中の評価期間は削除できません。' using errcode = '23514';
  end if;
  if exists (select 1 from public.evaluation_sheets where period_id = old.id) then
    raise exception '評価シートのある評価期間は削除できません。' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_evaluation_period_delete() from public, anon, authenticated;
drop trigger if exists evaluation_periods_guard_delete on public.evaluation_periods;
create trigger evaluation_periods_guard_delete
  before delete on public.evaluation_periods
  for each row execute function public.guard_evaluation_period_delete();

-- Closing: the given period becomes the active one and the period that was active is closed.
-- Refused while the period being closed still has a sheet that is not finalized.
-- Activating the previous period again undoes it, under the same condition.
create or replace function public.activate_evaluation_period(p_period_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.current_employee_is_admin() then
    raise exception 'Only Admin can close an evaluation period' using errcode = '42501';
  end if;

  -- Lock every period first, so two concurrent switches cannot interleave.
  perform 1 from public.evaluation_periods order by id for update;
  if not exists (select 1 from public.evaluation_periods where id = p_period_id) then
    return false;
  end if;

  if exists (
    select 1 from public.evaluation_sheets sheet
    join public.evaluation_periods period on period.id = sheet.period_id
    where period.is_active and period.id <> p_period_id and sheet.status <> 'finalized'
  ) then
    raise exception '未確定の評価シートが残っているため、評価期間を締められません。' using errcode = '23514';
  end if;

  update public.evaluation_periods set is_active = false where is_active and id <> p_period_id;
  update public.evaluation_periods set is_active = true where id = p_period_id and not is_active;
  return true;
end;
$$;
revoke all on function public.activate_evaluation_period(bigint) from public, anon, authenticated;
grant execute on function public.activate_evaluation_period(bigint) to authenticated;
comment on function public.activate_evaluation_period(bigint)
  is 'Admin only: makes the period the single active one and closes the previously active period, which must have no unfinalized sheet. Returns false for an unknown period.';

-- What an Admin is about to freeze: the number of sheets of a period by status.
-- An Admin is not an evaluator of these sheets, so this returns counts only.
create or replace function public.get_evaluation_period_sheet_counts(p_period_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.current_employee_is_admin() then
    raise exception 'Only Admin can read evaluation period sheet counts' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_object_agg(counts.status, counts.total), '{}'::jsonb)
    from (
      select status, count(*) as total
      from public.evaluation_sheets where period_id = p_period_id group by status
    ) counts
  );
end;
$$;
revoke all on function public.get_evaluation_period_sheet_counts(bigint) from public, anon, authenticated;
grant execute on function public.get_evaluation_period_sheet_counts(bigint) to authenticated;

-- Sheets, goals and common evaluation results change only while their period is active.
-- The period row is share-locked until the change commits, so a change cannot slip in
-- beside a closing that has already checked the sheets (closing locks the periods for update).
create or replace function public.require_active_evaluation_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  sheet_ids bigint[];
  period_ids bigint[];
  active_periods integer;
begin
  if tg_table_name = 'evaluation_sheets' then
    if tg_op <> 'INSERT' then period_ids := period_ids || old.period_id; end if;
    if tg_op <> 'DELETE' then period_ids := period_ids || new.period_id; end if;
  else
    if tg_op <> 'INSERT' then sheet_ids := sheet_ids || old.sheet_id::bigint; end if;
    if tg_op <> 'DELETE' then sheet_ids := sheet_ids || new.sheet_id::bigint; end if;
    select array_agg(sheet.period_id) into period_ids
    from public.evaluation_sheets sheet where sheet.id = any(sheet_ids);
  end if;

  select count(*) into active_periods from (
    select 1 from public.evaluation_periods period
    where period.id = any(period_ids) and period.is_active
    for share
  ) locked;
  if active_periods < (select count(distinct changed) from unnest(period_ids) as changed) then
    raise exception '締められた評価期間の評価シートは変更できません。' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.require_active_evaluation_period() from public, anon, authenticated;

drop trigger if exists evaluation_sheets_require_active_period on public.evaluation_sheets;
create trigger evaluation_sheets_require_active_period
  before insert or update or delete on public.evaluation_sheets
  for each row execute function public.require_active_evaluation_period();
drop trigger if exists milestones_require_active_period on public.milestones;
create trigger milestones_require_active_period
  before insert or update or delete on public.milestones
  for each row execute function public.require_active_evaluation_period();
drop trigger if exists common_evaluation_results_require_active_period on public.common_evaluation_results;
create trigger common_evaluation_results_require_active_period
  before insert or update or delete on public.common_evaluation_results
  for each row execute function public.require_active_evaluation_period();

commit;
