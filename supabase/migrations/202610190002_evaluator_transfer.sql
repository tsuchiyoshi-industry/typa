-- Evaluators who change in the middle of a period (a transfer), and the new evaluator's view of
-- what came before.
--   * A sheet's evaluator follows the employee master only until their own stage is done.
--     Until now both evaluators followed until the sheet was finalized, so moving an employee
--     to a new primary evaluator after the primary evaluation was confirmed took the sheet away
--     from the person who evaluated it and printed the new primary evaluator's name over an
--     evaluation they never made.
--       primary evaluator    follows while the sheet is a draft or submitted
--       secondary evaluator  follows until the sheet is finalized (as before)
--   * An employee's current evaluators (employee master) read that employee's finalized
--     sheets, read only: assigning an evaluator is what grants it. Before, only the evaluators
--     a sheet names could read it, so a new evaluator never saw the past evaluations.
-- Requires 202610080009, 202610120001 and 202610120003.
begin;

create or replace function public.sync_evaluation_sheet_evaluators()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.evaluation_sheets as sheet
  set primary_evaluator_id = case when sheet.status in ('draft', 'submitted')
        then new.primary_evaluator_id else sheet.primary_evaluator_id end,
      secondary_evaluator_id = new.secondary_evaluator_id,
      no_secondary_evaluator = new.no_secondary_evaluator
  from public.evaluation_periods as period
  where sheet.employee_id = new.id
    and period.id = sheet.period_id and period.is_active
    and sheet.status <> 'finalized';
  return null;
end;
$$;
revoke all on function public.sync_evaluation_sheet_evaluators() from public, anon, authenticated;

-- The caller is p_employee_id's primary or secondary evaluator in the employee master now.
create or replace function public.is_current_evaluator_of(p_employee_id integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees as subject
    where subject.id = p_employee_id and subject.id is distinct from public.current_employee_id()
      and public.current_employee_id() in (subject.primary_evaluator_id, subject.secondary_evaluator_id)
  )
$$;
revoke all on function public.is_current_evaluator_of(integer) from public, anon, authenticated;
-- Called from the row policy below as the client's role. Answers only about the caller.
grant execute on function public.is_current_evaluator_of(integer) to authenticated;

-- As in 202610120001, plus 'read' for a current evaluator of a finalized sheet's subject.
create or replace function public.sheet_access(p_sheet_id bigint)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when sheet.employee_id = me.id then 'subject:' || sheet.status
    when sheet.status = 'draft' then null
    when sheet.primary_evaluator_id = me.id and sheet.status = 'submitted' then 'first'
    when sheet.secondary_evaluator_id = me.id and sheet.status = 'first_evaluated' then 'second'
    when me.id in (sheet.primary_evaluator_id, sheet.secondary_evaluator_id) then 'read'
    when sheet.status = 'finalized' and public.is_current_evaluator_of(sheet.employee_id::integer) then 'read'
  end
  from public.evaluation_sheets as sheet
  cross join (select public.current_employee_id() as id) as me
  where sheet.id = p_sheet_id
$$;

drop policy if exists "subject and evaluators read a sheet" on public.evaluation_sheets;
create policy "subject and evaluators read a sheet"
  on public.evaluation_sheets for select to authenticated
  using (
    (select public.current_employee_id()) in (employee_id, primary_evaluator_id, secondary_evaluator_id)
    or (status = 'finalized' and public.is_current_evaluator_of(employee_id::integer))
  );

-- As in 202610120003, but a current evaluator of the subject also reads a finalized sheet (the
-- whole record, like everyone on it), and the subject's current evaluators are returned so the
-- app can tell. They are no secret to the caller: the subject's employee row carries them.
create or replace function public.get_sheet(p_sheet_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
  is_subject boolean;
  is_secondary boolean;
  finalized boolean;
  sees_content boolean;
  sees_first boolean;
  sees_second boolean;
  sees_goal_second boolean;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  if sheet.id is null or me is null
    or not (coalesce(me in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id), false)
            or (sheet.status = 'finalized' and public.is_current_evaluator_of(sheet.employee_id::integer)))
  then
    return null;
  end if;

  is_subject := sheet.employee_id = me;
  is_secondary := not is_subject and coalesce(sheet.secondary_evaluator_id = me, false);
  finalized := sheet.status = 'finalized';
  -- An evaluator gets a draft without its content.
  sees_content := is_subject or sheet.status <> 'draft';
  sees_first := sees_content and (finalized or not is_subject);
  sees_second := sees_content and (finalized or is_secondary);
  sees_goal_second := sees_content and (finalized or is_subject or is_secondary);

  return jsonb_build_object(
    'id', sheet.id, 'status', sheet.status, 'gradeId', sheet.grade_id,
    'gradeName', (select grade_name from public.employee_grades where id = sheet.grade_id),
    'subject', (
      select jsonb_build_object(
        'id', subject.id, 'name', subject.name, 'employeeNo', subject.employee_no,
        'roleId', subject.role_id, 'careerCourse', subject.career_course)
      from public.employees as subject where subject.id = sheet.employee_id),
    'currentEvaluatorIds', (
      select to_jsonb(array_remove(array[subject.primary_evaluator_id, subject.secondary_evaluator_id], null))
      from public.employees as subject where subject.id = sheet.employee_id),
    'primaryEvaluatorId', sheet.primary_evaluator_id,
    'secondaryEvaluatorId', sheet.secondary_evaluator_id,
    'noSecondaryEvaluator', coalesce(sheet.no_secondary_evaluator, false),
    'primaryEvaluatorName', (select name from public.employees where id = sheet.primary_evaluator_id),
    'secondaryEvaluatorName', (select name from public.employees where id = sheet.secondary_evaluator_id),
    'period', (
      select jsonb_build_object(
        'id', period.id, 'periodName', period.period_name, 'startDate', period.start_date,
        'endDate', period.end_date, 'isActive', period.is_active)
      from public.evaluation_periods as period where period.id = sheet.period_id),
    'firstOverallComment', case when sees_first then coalesce(sheet.first_overall_comment, '') else '' end,
    'secondOverallComment', case when sees_second then coalesce(sheet.second_overall_comment, '') else '' end,
    'firstRank', case when sees_first and sheet.status in ('first_evaluated', 'finalized') then sheet.first_rank end,
    'finalRankLetter', case when finalized then sheet.final_rank_letter end,
    'finalRankLevel', case when finalized then sheet.final_rank_level end,
    -- Totals are stored when scores are saved; only a finalized sheet reads them back.
    'stored', case when finalized then jsonb_build_object(
      'objectivesFirstTotalScore', sheet.objectives_first_total_score,
      'objectivesFirstTotalRate', sheet.objectives_first_total_rate,
      'objectivesSecondTotalScore', sheet.objectives_second_total_score,
      'objectivesSecondTotalRate', sheet.objectives_second_total_rate,
      'commonEvaluationFirstTotalScore', sheet.common_evaluation_first_total_score,
      'commonEvaluationFirstTotalRate', sheet.common_evaluation_first_total_rate,
      'commonEvaluationSecondTotalScore', sheet.common_evaluation_second_total_score,
      'commonEvaluationSecondTotalRate', sheet.common_evaluation_second_total_rate,
      'objectivesSecondEvaluationScore', sheet.objectives_second_evaluation_score,
      'commonEvaluationSecondEvaluationScore', sheet.common_evaluation_second_evaluation_score,
      'totalEvaluationScore', sheet.total_evaluation_score,
      'objectiveAllocation', sheet.objective_allocation,
      'commonAllocation', sheet.common_allocation
    ) else '{}'::jsonb end,
    'objectives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', goal.id, 'goalNumber', goal.goal_number,
        'challengeGoal', coalesce(goal.challenge_goal, ''),
        'midtermGoal', coalesce(goal.midterm_goal, ''),
        'achievement', coalesce(goal.achievement, ''),
        'firstScore', coalesce(goal.first_score, 0),
        'secondScore', case when sees_goal_second then coalesce(goal.second_score, 0) else 0 end
      ) order by goal.goal_number, goal.id)
      from public.milestones as goal where goal.sheet_id = sheet.id and sees_content
    ), '[]'::jsonb),
    -- One entry per item of the sheet's grade, whether or not a result has been saved (id null).
    'commonResults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', result.id, 'itemId', item.id, 'title', item.title, 'description', item.description,
        'weight', item.weight, 'itemSetId', item.item_set_id,
        'firstScore', case when sees_first then coalesce(result.first_score, 0) else 0 end,
        'secondScore', case when sees_second then coalesce(result.second_score, 0) else 0 end,
        'firstComment', case when sees_first then coalesce(result.first_comment, '') else '' end
      ) order by item.id)
      from public.common_evaluation_items as item
      left join public.common_evaluation_results as result
        on result.item_id = item.id and result.sheet_id = sheet.id
      where item.item_set_id is null
         or item.item_set_id = (select item_set_id from public.employee_grades where id = sheet.grade_id)
    ), '[]'::jsonb),
    'allocation', (
      select jsonb_build_object('objective', objective_allocation, 'common', common_allocation)
      from public.evaluation_settings),
    'maxChallengeGoals', (select max_challenge_goals from public.evaluation_settings)
  );
end;
$$;
revoke all on function public.get_sheet(bigint) from public, anon, authenticated;
grant execute on function public.get_sheet(bigint) to authenticated;

commit;
