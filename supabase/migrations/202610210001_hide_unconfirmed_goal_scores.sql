-- The subject sees the scores of their goals only once the sheet is finalized, as with the
-- common evaluation. Before, the subject saw the first score as soon as the primary evaluator
-- saved it (before confirming), and the second score while the secondary evaluator was still
-- working on it.
--   * get_sheet masks the subject's goal scores until the sheet is finalized.
--   * milestones.first_score is no longer readable directly; it is read through get_sheet
--     (security definer) and written by UPDATE, which needs no select on the column.
-- Requires 202610190002.
begin;

revoke select (first_score) on public.milestones from authenticated;

-- As in 202610190002, but goal scores follow sees_first / sees_second like the common evaluation.
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
        'firstScore', case when sees_first then coalesce(goal.first_score, 0) else 0 end,
        'secondScore', case when sees_second then coalesce(goal.second_score, 0) else 0 end
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

commit;
