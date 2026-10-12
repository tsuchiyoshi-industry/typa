-- Access control moves from the app into the database. Until now row level security was on
-- but the policies of employees, milestones and common_evaluation_results were "using (true)"
-- for every role, anon included, and evaluation_sheets was readable by anyone signed in: the
-- rules in EvaluationSheetAccessPolicy were enforced only by the app.
--
-- After this migration:
--   * anon can call get_required_domain() and nothing else.
--   * employees: an employee reads their own row, their evaluators, the people they evaluate
--     and the people on their sheets; Admin and Reviewer read everyone (the employee master).
--     Clients change only evaluators and grade (Admin; evaluators also Reviewer). Rows are
--     added, deleted and linked to an account only by database functions.
--   * a sheet and its goals and common evaluation results are readable and writable only by
--     the sheet's subject and its own evaluators, each in the stage EvaluationSheetAccessPolicy
--     gives them, column by column. Status moves only along draft <-> submitted ->
--     first_evaluated -> finalized, by the person that stage belongs to; a finalized sheet
--     never changes. The rank and score stored on confirmation must match the scores.
-- The statements the installed app (0.9.8) sends keep working, except linking an account to
-- an employee at sign-up, which 202610120002 replaces.
-- Requires 202610080008 (current_employee_is_admin) and 202610080014 (evaluation settings).
begin;

-- One Auth user is one employee. If this fails, two employees share a user_id: fix that first.
create unique index if not exists employees_user_id_key
  on public.employees (user_id) where user_id is not null;

-- ---------------------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------------------
create or replace function public.current_employee_id()
returns integer language sql stable security definer set search_path = '' as $$
  select id from public.employees where user_id = auth.uid()
$$;

create or replace function public.current_employee_role()
returns text language sql stable security definer set search_path = '' as $$
  select caller_role.role_name
  from public.employees as caller
  join public.roles as caller_role on caller_role.id = caller.role_id
  where caller.user_id = auth.uid()
$$;

-- The employees the caller works with: themselves, their evaluators, the people they
-- evaluate, and everyone on a sheet they are part of (a finalized sheet keeps its evaluators
-- after the employee master has moved on).
create or replace function public.visible_employee_ids()
returns setof integer language sql stable security definer set search_path = '' as $$
  with me as (
    select id, primary_evaluator_id, secondary_evaluator_id
    from public.employees where user_id = auth.uid()
  )
  select person.id
  from me
  cross join lateral (values (me.id), (me.primary_evaluator_id), (me.secondary_evaluator_id)) as person(id)
  where person.id is not null
  union
  select subordinate.id
  from me
  join public.employees as subordinate
    on me.id in (subordinate.primary_evaluator_id, subordinate.secondary_evaluator_id)
  union
  select person.id
  from me
  join public.evaluation_sheets as sheet
    on me.id in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id)
  cross join lateral (values (sheet.employee_id::integer), (sheet.primary_evaluator_id), (sheet.secondary_evaluator_id)) as person(id)
  where person.id is not null
$$;

-- What the caller is to a sheet right now. null: nothing (not on the sheet, or an evaluator
-- of a draft, which evaluators do not see).
--   subject:<status>  the sheet is the caller's own
--   first / second    the caller may enter the primary / secondary evaluation
--   read              an evaluator of the sheet, outside their own stage
create or replace function public.sheet_access(p_sheet_id bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when sheet.employee_id = me.id then 'subject:' || sheet.status
    when sheet.status = 'draft' then null
    when sheet.primary_evaluator_id = me.id and sheet.status = 'submitted' then 'first'
    when sheet.secondary_evaluator_id = me.id and sheet.status = 'first_evaluated' then 'second'
    when me.id in (sheet.primary_evaluator_id, sheet.secondary_evaluator_id) then 'read'
  end
  from public.evaluation_sheets as sheet
  cross join (select public.current_employee_id() as id) as me
  where sheet.id = p_sheet_id
$$;

-- ---------------------------------------------------------------------------------------
-- Scores and ranks, calculated as the app does (EvaluationAllocation.fromTotal,
-- EvaluationRank.fromScoreRate), to check what a client stores on confirmation.
-- ---------------------------------------------------------------------------------------
create or replace function public.evaluation_rank(p_score integer)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_score >= 95 then 'S' when p_score >= 90 then 'A' when p_score >= 80 then 'B+'
    when p_score >= 60 then 'B' when p_score >= 50 then 'B-' when p_score >= 40 then 'C'
    else 'D'
  end
$$;

-- Evaluation score out of 100 from the primary (p_use_first) or the secondary evaluation:
-- goals are "sum / (count x 4)", common evaluation "sum(weight x score) / sum(weight x 4)",
-- each multiplied by its allocation and rounded to a whole point.
create or replace function public.sheet_evaluation_score(
  p_sheet_id bigint, p_use_first boolean, p_objective_allocation integer, p_common_allocation integer
)
returns integer language sql stable security definer set search_path = '' as $$
  select (
    coalesce((
      select round(sum(coalesce(case when p_use_first then goal.first_score else goal.second_score end, 0))::numeric
                   * p_objective_allocation / (count(*) * 4))
      from public.milestones as goal where goal.sheet_id = sheet.id
      having count(*) > 0
    ), 0)
    + coalesce((
      select round(sum(item.weight * coalesce(case when p_use_first then result.first_score else result.second_score end, 0))::numeric
                   * p_common_allocation / sum(item.weight * 4))
      from public.common_evaluation_items as item
      left join public.common_evaluation_results as result
        on result.item_id = item.id and result.sheet_id = sheet.id
      where item.item_set_id is null or item.item_set_id = grade.item_set_id
      having sum(item.weight) > 0
    ), 0)
  )::integer
  from public.evaluation_sheets as sheet
  left join public.employee_grades as grade on grade.id = sheet.grade_id
  -- Only for the evaluator who is entering that sheet's evaluation now; null for anyone else.
  where sheet.id = p_sheet_id and public.sheet_access(p_sheet_id) in ('first', 'second')
$$;

-- ---------------------------------------------------------------------------------------
-- Column rules. Row policies decide which rows a client may touch; these triggers decide
-- which columns. They are security invoker on purpose: current_user tells a statement sent
-- by an API client (authenticated) from one made inside a database function (its owner),
-- such as the trigger that carries a new evaluator over to open sheets.
-- ---------------------------------------------------------------------------------------
create or replace function public.changed_columns(p_old jsonb, p_new jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(changed.key), '{}')
  from jsonb_each(p_new) as changed
  where changed.value is distinct from p_old -> changed.key
$$;

create or replace function public.guard_employee_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.grade_id is distinct from old.grade_id and public.current_employee_role() is distinct from 'Admin' then
    raise exception '等級を変更できるのは Admin だけです。' using errcode = '42501';
  end if;
  if new.id in (new.primary_evaluator_id, new.secondary_evaluator_id) then
    raise exception '自分自身を評価者として設定することはできません。' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_evaluation_sheet_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  me integer;
  is_subject boolean;
  is_primary boolean;
  is_secondary boolean;
  primary_is_final boolean;
  changed text[];
  allowed text[] := '{}';
  score_columns constant text[] := array[
    'objectives_first_total_score', 'objectives_first_total_rate',
    'objectives_second_total_score', 'objectives_second_total_rate',
    'objectives_second_evaluation_score',
    'common_evaluation_first_total_score', 'common_evaluation_first_total_rate',
    'common_evaluation_second_total_score', 'common_evaluation_second_total_rate',
    'common_evaluation_second_evaluation_score', 'total_evaluation_score'
  ];
  total_columns constant text[] := score_columns || array['objective_allocation', 'common_allocation'];
  settings public.evaluation_settings%rowtype;
  expected integer;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  changed := public.changed_columns(to_jsonb(old), to_jsonb(new));
  -- Creating a sheet that already exists is sent as an update that changes nothing.
  if changed = '{}' then
    return new;
  end if;
  if old.status = 'finalized' then
    raise exception '確定した評価シートは変更できません。' using errcode = '42501';
  end if;

  me := public.current_employee_id();
  is_subject := coalesce(old.employee_id = me, false);
  is_primary := not is_subject and coalesce(old.primary_evaluator_id = me, false);
  is_secondary := not is_subject and coalesce(old.secondary_evaluator_id = me, false);
  primary_is_final := old.no_secondary_evaluator and old.secondary_evaluator_id is null;

  if is_primary and old.status = 'submitted' then
    allowed := allowed || total_columns || array['first_overall_comment'];
  end if;
  if is_secondary and old.status = 'first_evaluated' then
    allowed := allowed || total_columns || array['second_overall_comment'];
  end if;
  -- Up to 0.9.8 the app stores the totals of a new, empty sheet when the subject creates it.
  if is_subject and old.status = 'draft' and not exists (
    select 1 from jsonb_each(to_jsonb(new)) as stored
    where stored.key = any (score_columns) and stored.value not in ('null'::jsonb, '0'::jsonb)
  ) then
    allowed := allowed || total_columns;
  end if;

  if new.status is distinct from old.status then
    if not coalesce(case old.status || '>' || new.status
      when 'draft>submitted' then is_subject
      when 'submitted>draft' then is_subject
      when 'submitted>first_evaluated' then is_primary and not primary_is_final
      when 'submitted>finalized' then is_primary and primary_is_final
      when 'first_evaluated>finalized' then is_secondary or (is_primary and primary_is_final)
    end, false) then
      raise exception 'この評価シートの状態を変更する権限がありません。' using errcode = '42501';
    end if;
    allowed := allowed || array['status'];

    -- The rank is derived from the scores, never chosen. What is stored on confirmation must
    -- be what the scores give with the current allocation.
    select * into settings from public.evaluation_settings;
    if new.status = 'first_evaluated' or (new.status = 'finalized' and primary_is_final) then
      allowed := allowed || array['first_rank'];
      expected := public.sheet_evaluation_score(
        new.id, true, settings.objective_allocation, settings.common_allocation);
      if new.first_rank is distinct from public.evaluation_rank(expected) then
        raise exception '評価ランクが現在の評価内容と一致しません。再読み込みしてからやり直してください。' using errcode = '23514';
      end if;
    end if;
    if new.status = 'finalized' then
      allowed := allowed || array['final_rank_letter', 'final_rank_level'];
      expected := public.sheet_evaluation_score(
        new.id, primary_is_final, settings.objective_allocation, settings.common_allocation);
      if new.total_evaluation_score is distinct from expected
        or new.objective_allocation is distinct from settings.objective_allocation
        or new.common_allocation is distinct from settings.common_allocation
        or coalesce(new.final_rank_letter, '') || (case new.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end)
           is distinct from public.evaluation_rank(expected) then
        raise exception '評価点または評価ランクが現在の評価内容と一致しません。再読み込みしてからやり直してください。' using errcode = '23514';
      end if;
    end if;
  end if;

  if not changed <@ allowed then
    raise exception 'この評価シートの項目を変更する権限がありません。' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Goals: the subject writes the text, the primary evaluator first_score, the secondary
-- evaluator second_score. The row policies have already checked the stage.
create or replace function public.guard_milestone_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  access text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  access := public.sheet_access(old.sheet_id);
  if not public.changed_columns(to_jsonb(old), to_jsonb(new)) <@ (case access
    when 'subject:draft' then array['goal_number', 'challenge_goal', 'midterm_goal', 'achievement']
    when 'first' then array['first_score']
    when 'second' then array['second_score']
    else '{}'::text[]
  end) then
    raise exception 'この目標の項目を変更する権限がありません。' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Common evaluation: the primary evaluator writes first_score and first_comment, the
-- secondary evaluator second_score. A missing row is created by whoever saves first.
create or replace function public.guard_common_evaluation_result_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  access text;
  before jsonb;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  access := public.sheet_access(new.sheet_id);
  before := case when tg_op = 'UPDATE' then to_jsonb(old)
    else jsonb_build_object('id', new.id, 'sheet_id', new.sheet_id, 'item_id', new.item_id,
      'first_score', 0, 'second_score', 0, 'first_comment', '',
      'created_at', new.created_at, 'updated_at', new.updated_at) end;
  if not public.changed_columns(before, to_jsonb(new)) <@ (case access
    when 'first' then array['first_score', 'first_comment']
    when 'second' then array['second_score']
    else '{}'::text[]
  end) then
    raise exception 'この共通評価の項目を変更する権限がありません。' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_guard_write on public.employees;
create trigger employees_guard_write
  before update on public.employees
  for each row execute function public.guard_employee_write();
-- Named to fire before evaluation_sheets_check_completion (triggers fire in name order), so
-- someone who may not confirm a sheet is refused before being told what is still missing.
drop trigger if exists evaluation_sheets_access_guard on public.evaluation_sheets;
create trigger evaluation_sheets_access_guard
  before update on public.evaluation_sheets
  for each row execute function public.guard_evaluation_sheet_write();
drop trigger if exists milestones_guard_write on public.milestones;
create trigger milestones_guard_write
  before update on public.milestones
  for each row execute function public.guard_milestone_write();
drop trigger if exists common_evaluation_results_guard_write on public.common_evaluation_results;
create trigger common_evaluation_results_guard_write
  before insert or update on public.common_evaluation_results
  for each row execute function public.guard_common_evaluation_result_write();

-- ---------------------------------------------------------------------------------------
-- Row policies
-- ---------------------------------------------------------------------------------------
-- Reference data: readable once signed in, never written by a client.
alter policy "roles select all" on public.roles to authenticated;
alter policy "select" on public.employee_grades to authenticated;
alter policy "select c" on public.common_evaluation_items to authenticated;
alter policy "periods select" on public.evaluation_periods to authenticated;

drop policy if exists "all true" on public.employees;
drop policy if exists "employees read the people they work with" on public.employees;
create policy "employees read the people they work with"
  on public.employees for select to authenticated
  using (
    (select public.current_employee_role()) in ('Admin', 'Reviewer')
    or id in (select public.visible_employee_ids())
  );
drop policy if exists "Admin and Reviewer maintain the employee master" on public.employees;
create policy "Admin and Reviewer maintain the employee master"
  on public.employees for update to authenticated
  using ((select public.current_employee_role()) in ('Admin', 'Reviewer'))
  with check ((select public.current_employee_role()) in ('Admin', 'Reviewer'));

drop policy if exists "Enable access for sheets based on employee access" on public.evaluation_sheets;
drop policy if exists "subject and evaluators read a sheet" on public.evaluation_sheets;
create policy "subject and evaluators read a sheet"
  on public.evaluation_sheets for select to authenticated
  using ((select public.current_employee_id()) in (employee_id, primary_evaluator_id, secondary_evaluator_id));
drop policy if exists "an employee creates their own sheet" on public.evaluation_sheets;
create policy "an employee creates their own sheet"
  on public.evaluation_sheets for insert to authenticated
  with check (employee_id = (select public.current_employee_id()));
drop policy if exists "subject and evaluators change a sheet" on public.evaluation_sheets;
create policy "subject and evaluators change a sheet"
  on public.evaluation_sheets for update to authenticated
  using ((select public.current_employee_id()) in (employee_id, primary_evaluator_id, secondary_evaluator_id))
  with check ((select public.current_employee_id()) in (employee_id, primary_evaluator_id, secondary_evaluator_id));

drop policy if exists "milestones all" on public.milestones;
drop policy if exists "subject deletes draft milestones" on public.milestones;
drop policy if exists "subject and evaluators read goals" on public.milestones;
create policy "subject and evaluators read goals"
  on public.milestones for select to authenticated
  using (public.sheet_access(sheet_id) is not null);
drop policy if exists "subject adds goals to a draft" on public.milestones;
create policy "subject adds goals to a draft"
  on public.milestones for insert to authenticated
  with check (public.sheet_access(sheet_id) = 'subject:draft');
drop policy if exists "subject and evaluators change goals in their stage" on public.milestones;
create policy "subject and evaluators change goals in their stage"
  on public.milestones for update to authenticated
  using (public.sheet_access(sheet_id) in ('subject:draft', 'first', 'second'))
  with check (public.sheet_access(sheet_id) in ('subject:draft', 'first', 'second'));
drop policy if exists "subject removes goals from a draft" on public.milestones;
create policy "subject removes goals from a draft"
  on public.milestones for delete to authenticated
  using (public.sheet_access(sheet_id) = 'subject:draft');

-- The subject does not see the common evaluation until the sheet is finalized (then it is
-- on the printed sheet).
drop policy if exists "all true" on public.common_evaluation_results;
drop policy if exists "evaluators read common evaluation" on public.common_evaluation_results;
create policy "evaluators read common evaluation"
  on public.common_evaluation_results for select to authenticated
  using (public.sheet_access(sheet_id) in ('first', 'second', 'read', 'subject:finalized'));
drop policy if exists "evaluators add common evaluation in their stage" on public.common_evaluation_results;
create policy "evaluators add common evaluation in their stage"
  on public.common_evaluation_results for insert to authenticated
  with check (public.sheet_access(sheet_id) in ('first', 'second'));
drop policy if exists "evaluators change common evaluation in their stage" on public.common_evaluation_results;
create policy "evaluators change common evaluation in their stage"
  on public.common_evaluation_results for update to authenticated
  using (public.sheet_access(sheet_id) in ('first', 'second'))
  with check (public.sheet_access(sheet_id) in ('first', 'second'));

drop function if exists public.check_employee_access(bigint, uuid);

-- ---------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------
-- Nothing for anon. Function privileges given to PUBLIC reach anon too, so they go as well;
-- every function a client calls is granted to authenticated by name.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.get_required_domain() to anon;

-- Tables and functions created later are not exposed to the API until a migration grants them.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- Internal trigger functions that the API roles could call by name.
do $$
declare
  internal text;
begin
  foreach internal in array array['public.check_user_limit()', 'public.rls_auto_enable()'] loop
    if to_regprocedure(internal) is not null then
      execute format('revoke all on function %s from anon, authenticated', internal);
    end if;
  end loop;
end;
$$;

revoke all on public.roles, public.employee_grades, public.common_evaluation_items,
  public.common_evaluation_item_sets, public.employees, public.evaluation_sheets,
  public.milestones, public.common_evaluation_results from authenticated;
grant select on public.roles, public.employee_grades, public.common_evaluation_items,
  public.employees, public.evaluation_sheets, public.milestones,
  public.common_evaluation_results to authenticated;

-- A column that is not listed here cannot be written by a client, whatever the policies say.
grant update (primary_evaluator_id, secondary_evaluator_id, grade_id, no_secondary_evaluator)
  on public.employees to authenticated;
-- period_id and employee_id are in the update list only because the app creates a sheet with
-- "insert ... on conflict do update"; the trigger above refuses a real change to them.
grant insert (period_id, employee_id) on public.evaluation_sheets to authenticated;
grant update (
  period_id, employee_id, status, first_overall_comment, second_overall_comment,
  objectives_first_total_score, objectives_first_total_rate,
  objectives_second_total_score, objectives_second_total_rate, objectives_second_evaluation_score,
  common_evaluation_first_total_score, common_evaluation_first_total_rate,
  common_evaluation_second_total_score, common_evaluation_second_total_rate,
  common_evaluation_second_evaluation_score, total_evaluation_score,
  objective_allocation, common_allocation, first_rank, final_rank_letter, final_rank_level
) on public.evaluation_sheets to authenticated;
grant insert (sheet_id, goal_number, challenge_goal, midterm_goal, achievement)
  on public.milestones to authenticated;
grant update (sheet_id, goal_number, challenge_goal, midterm_goal, achievement, first_score, second_score)
  on public.milestones to authenticated;
grant delete on public.milestones to authenticated;
grant insert (sheet_id, item_id, first_score, second_score, first_comment)
  on public.common_evaluation_results to authenticated;
grant update (sheet_id, item_id, first_score, second_score, first_comment)
  on public.common_evaluation_results to authenticated;

revoke all on function public.current_employee_id() from public, anon, authenticated;
revoke all on function public.current_employee_role() from public, anon, authenticated;
revoke all on function public.visible_employee_ids() from public, anon, authenticated;
revoke all on function public.sheet_access(bigint) from public, anon, authenticated;
revoke all on function public.evaluation_rank(integer) from public, anon, authenticated;
revoke all on function public.sheet_evaluation_score(bigint, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.changed_columns(jsonb, jsonb) from public, anon, authenticated;
-- Called from the row policies and the security invoker triggers above, as the client's role,
-- so a client can call them too. Each answers only about the caller; the score only to the
-- evaluator who is entering it.
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_employee_role() to authenticated;
grant execute on function public.visible_employee_ids() to authenticated;
grant execute on function public.sheet_access(bigint) to authenticated;
grant execute on function public.evaluation_rank(integer) to authenticated;
grant execute on function public.sheet_evaluation_score(bigint, boolean, integer, integer) to authenticated;
grant execute on function public.changed_columns(jsonb, jsonb) to authenticated;

commit;
