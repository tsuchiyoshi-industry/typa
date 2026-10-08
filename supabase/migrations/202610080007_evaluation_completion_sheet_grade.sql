-- The completion check requires the common items of the grade the sheet was created with
-- (evaluation_sheets.grade_id), not the employee's current grade. Otherwise a sheet created
-- before a promotion would be checked against items it was never evaluated on.
begin;

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

  select new.status = 'first_evaluated' or
         (employee.no_secondary_evaluator and employee.secondary_evaluator_id is null),
         grade.item_set_id
    into use_first, item_set
  from public.employees employee
  left join public.employee_grades grade on grade.id = new.grade_id
  where employee.id = new.employee_id;

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
