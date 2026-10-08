-- Notifications go to the evaluators of the sheet, and the completion check follows the
-- sheet's own "no secondary evaluator" flag. These read the employee master before sheets
-- carried their evaluators (202610080009). The result is the same while a sheet is open,
-- because open sheets follow the employee master; reading the sheet keeps it right for a
-- finalized sheet after the employee has been given other evaluators.
begin;

-- The primary evaluator of a first-evaluated sheet gets the contact email of the sheet's
-- secondary evaluator, or null when that evaluator is not registered.
create or replace function public.get_first_evaluated_sheet_notification_recipient(p_sheet_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  secondary_id integer;
begin
  select sheet.secondary_evaluator_id into secondary_id
  from public.evaluation_sheets as sheet
  join public.employees as evaluator on evaluator.id = sheet.primary_evaluator_id
  where sheet.id = p_sheet_id
    and sheet.status = 'first_evaluated'
    and evaluator.user_id = auth.uid()
    and evaluator.id <> sheet.employee_id;

  if not found then
    raise exception 'First-evaluated sheet notification access denied' using errcode = '42501';
  end if;

  return (
    select case when account.email_confirmed_at is not null
                then nullif(account.raw_user_meta_data ->> 'contact_email', '') end
    from public.employees as evaluator
    join auth.users as account on account.id = evaluator.user_id
    where evaluator.id = secondary_id
  );
end;
$$;
revoke all on function public.get_first_evaluated_sheet_notification_recipient(bigint) from public, anon, authenticated;
grant execute on function public.get_first_evaluated_sheet_notification_recipient(bigint) to authenticated;
comment on function public.get_first_evaluated_sheet_notification_recipient(bigint)
  is 'Sign-up contact email of the secondary evaluator of a first-evaluated sheet; the sheet''s primary evaluator only.';

-- The final evaluator of a finalized sheet (its secondary evaluator, or its primary
-- evaluator when the sheet has none by decision) gets the contact emails of both.
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
  select sheet.primary_evaluator_id, sheet.secondary_evaluator_id
    into primary_id, secondary_id
  from public.evaluation_sheets as sheet
  join public.employees as evaluator
    on evaluator.id = case
         when sheet.secondary_evaluator_id is not null then sheet.secondary_evaluator_id
         when sheet.no_secondary_evaluator then sheet.primary_evaluator_id
       end
  where sheet.id = p_sheet_id
    and sheet.status = 'finalized'
    and evaluator.user_id = auth.uid()
    and evaluator.id <> sheet.employee_id;

  if not found then
    raise exception 'Finalized sheet notification access denied' using errcode = '42501';
  end if;

  return query
  select recipients.role, recipients.employee_id,
         case when account.email_confirmed_at is not null
              then nullif(account.raw_user_meta_data ->> 'contact_email', '')
              else null::text end
  from (values ('primary'::text, primary_id), ('secondary'::text, secondary_id))
       as recipients(role, employee_id)
  left join public.employees as evaluator on evaluator.id = recipients.employee_id
  left join auth.users as account on account.id = evaluator.user_id;
end;
$$;
revoke all on function public.get_finalized_sheet_notification_recipients(bigint) from public, anon, authenticated;
grant execute on function public.get_finalized_sheet_notification_recipients(bigint) to authenticated;
comment on function public.get_finalized_sheet_notification_recipients(bigint)
  is 'Sign-up contact emails of the sheet''s primary/secondary evaluators for finalized-sheet notifications; the sheet''s final evaluator only.';

-- Which evaluation must be complete is decided by the sheet: the primary evaluation when
-- the sheet has no secondary evaluator by decision, otherwise the stage being confirmed.
create or replace function public.check_evaluation_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  use_first boolean;
  item_set smallint;
  missing_items text;
begin
  if new.status is not distinct from old.status or new.status not in ('first_evaluated', 'finalized') then
    return new;
  end if;

  use_first := new.status = 'first_evaluated'
    or (new.no_secondary_evaluator and new.secondary_evaluator_id is null);
  select grade.item_set_id into item_set
  from public.employee_grades grade where grade.id = new.grade_id;

  select string_agg(pending.label, E'\n' order by pending.kind, pending.item_id) into missing_items
  from (
    select 0 as kind, milestone.id as item_id,
           '・チャレンジ目標 ' || coalesce(milestone.goal_number::text, milestone.id::text) as label
    from (
      select * from public.milestones where sheet_id = new.id order by goal_number, id limit 2
    ) milestone
    where coalesce(case when use_first then milestone.first_score else milestone.second_score end, 0) not between 1 and 4
    union all
    select 1 as kind, item.id as item_id, '・共通評価「' || coalesce(item.title, '項目 ' || item.id) || '」' as label
    from public.common_evaluation_items item
    left join public.common_evaluation_results result on result.item_id = item.id and result.sheet_id = new.id
    where (item.item_set_id is null or item.item_set_id = item_set)
      and coalesce(case when use_first then result.first_score else result.second_score end, 0) not between 1 and 4
  ) pending;

  if missing_items is not null then
    raise exception '%評価に未設定の項目があります。すべての評価を 1〜4 で設定して保存してください。% %',
      case when use_first then '一次' else '二次' end, E'\n', missing_items
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.check_evaluation_completion() from public, anon, authenticated;

commit;
