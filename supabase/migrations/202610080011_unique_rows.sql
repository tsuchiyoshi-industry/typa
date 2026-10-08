-- One sheet per period and employee, one goal per sheet and goal number, one common
-- evaluation result per sheet and item. The app creates and saves these rows by key
-- (insert ... on conflict), which needs the constraints below.
-- evaluation_sheets and common_evaluation_results already have theirs in production under
-- these names, so only milestones is new there; elsewhere all three are created.
-- If milestones holds duplicate goals this fails: remove the duplicates first.
begin;

do $$
declare
  wanted record;
begin
  for wanted in
    select * from (values
      ('evaluation_sheets', 'evaluation_sheets_period_id_employee_id_key', 'period_id, employee_id'),
      ('milestones', 'milestones_sheet_id_goal_number_key', 'sheet_id, goal_number'),
      ('common_evaluation_results', 'common_evaluation_results_sheet_id_item_id_key', 'sheet_id, item_id')
    ) as rows(table_name, constraint_name, key_columns)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = wanted.constraint_name
        and conrelid = format('public.%I', wanted.table_name)::regclass
    ) then
      execute format('alter table public.%I add constraint %I unique (%s)',
        wanted.table_name, wanted.constraint_name, wanted.key_columns);
    end if;
  end loop;
end;
$$;

commit;
