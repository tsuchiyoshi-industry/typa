-- Functions that replace many small requests from the app.
--   * save_common_evaluation: the common evaluation of a sheet in one statement instead of
--     one request per item.
--   * get_sheet: one whole evaluation sheet in a single round trip (the app used to read the
--     sheet, its subject, the evaluators' names, the period, the goals, the grade's item set,
--     the items, the results and the settings one after another, and again after every save).
--     It returns only what the caller may see in the sheet's current stage, so the rules of
--     EvaluationSheetAccessPolicy about who sees which evaluation hold on the server too.
--   * get_sheet_notification: what the notify-sheet Edge Function needs to mail the people a
--     status change concerns. Mail is sent by that function, so the SMTP password and the
--     recipients' addresses no longer travel to the app.
-- Requires 202610120001 and 202610120002.
begin;

-- Who sees what, until the sheet is finalized:
--   goals and their first scores  the subject, and the evaluators once the sheet is submitted
--   second score of a goal        the subject and the secondary evaluator
--   primary evaluation, comments  the evaluators
--   secondary evaluation          the secondary evaluator
-- A finalized sheet is the record of the evaluation: its subject and its evaluators all read
-- the whole of it (it is what the printed sheet shows), with the totals stored at
-- finalization. null: the caller is not on the sheet.
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
    or not coalesce(me in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id), false)
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
comment on function public.get_sheet(bigint)
  is 'One evaluation sheet with its goals, common evaluation, period and settings, limited to what the caller may see in the current stage. null when the caller is not on the sheet.';

-- Saves the caller's stage of the common evaluation of a sheet in one statement: the primary
-- evaluator's scores and comments, or the secondary evaluator's scores. Which one is decided
-- here from the sheet, not by the caller. p_results: [{itemId, firstScore, secondScore, firstComment}].
create or replace function public.save_common_evaluation(p_sheet_id bigint, p_results jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  access text := public.sheet_access(p_sheet_id);
begin
  if access is null or access not in ('first', 'second') then
    raise exception 'この共通評価を保存する権限がありません。' using errcode = '42501';
  end if;

  insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score, first_comment)
  select p_sheet_id, item.id,
         case when access = 'first' then (entry ->> 'firstScore')::integer else 0 end,
         case when access = 'second' then (entry ->> 'secondScore')::integer else 0 end,
         case when access = 'first' then coalesce(entry ->> 'firstComment', '') else '' end
  from jsonb_array_elements(p_results) as entry
  -- Only items the sheet is evaluated on.
  join public.common_evaluation_items as item on item.id = (entry ->> 'itemId')::bigint
  join public.evaluation_sheets as sheet on sheet.id = p_sheet_id
  left join public.employee_grades as grade on grade.id = sheet.grade_id
  where item.item_set_id is null or item.item_set_id = grade.item_set_id
  on conflict (sheet_id, item_id) do update set
    first_score = case when access = 'first' then excluded.first_score else common_evaluation_results.first_score end,
    first_comment = case when access = 'first' then excluded.first_comment else common_evaluation_results.first_comment end,
    second_score = case when access = 'second' then excluded.second_score else common_evaluation_results.second_score end,
    updated_at = now();
end;
$$;
revoke all on function public.save_common_evaluation(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_common_evaluation(bigint, jsonb) to authenticated;
comment on function public.save_common_evaluation(bigint, jsonb)
  is 'Saves the common evaluation of a sheet for the evaluator whose stage it is: first scores and comments for the primary evaluator, second scores for the secondary evaluator.';

-- For the notify-sheet Edge Function only (service_role). p_actor is the user the function
-- authenticated; they must be the person who has just moved the sheet to its current status:
--   submitted        the subject             -> the primary evaluator is told
--   first_evaluated  the primary evaluator   -> the secondary evaluator is told
--   finalized        the final evaluator     -> both evaluators are told
create or replace function public.get_sheet_notification(p_sheet_id bigint, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id integer;
  sheet public.evaluation_sheets%rowtype;
  final_evaluator_id integer;
begin
  select id into actor_id from public.employees where user_id = p_actor;
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  final_evaluator_id := case
    when sheet.secondary_evaluator_id is not null then sheet.secondary_evaluator_id
    when sheet.no_secondary_evaluator then sheet.primary_evaluator_id
  end;

  if actor_id is null or sheet.id is null or not coalesce(case sheet.status
    when 'submitted' then actor_id = sheet.employee_id
    when 'first_evaluated' then actor_id = sheet.primary_evaluator_id and actor_id <> sheet.employee_id
    when 'finalized' then actor_id = final_evaluator_id and actor_id <> sheet.employee_id
  end, false) then
    raise exception 'Sheet notification access denied' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'status', sheet.status,
    'sheetId', sheet.id,
    'employeeName', (select name from public.employees where id = sheet.employee_id),
    'employeeNo', (select employee_no from public.employees where id = sheet.employee_id),
    'periodName', (select period_name from public.evaluation_periods where id = sheet.period_id),
    'recipients', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', recipient.role, 'name', coalesce(evaluator.name, '未設定'), 'email', contact.email
      ) order by recipient.role), '[]'::jsonb)
      from (values ('primary', sheet.primary_evaluator_id), ('secondary', sheet.secondary_evaluator_id))
           as recipient(role, employee_id)
      left join public.employees as evaluator on evaluator.id = recipient.employee_id
      left join public.employee_contacts as contact on contact.employee_id = recipient.employee_id
      -- A finalized sheet without a secondary evaluator has nobody to tell in that role.
      where not (sheet.status = 'finalized' and recipient.role = 'secondary' and recipient.employee_id is null)
        and recipient.role = any (case sheet.status
          when 'submitted' then array['primary']
          when 'first_evaluated' then array['secondary']
          else array['primary', 'secondary'] end)
    )
  );
end;
$$;
revoke all on function public.get_sheet_notification(bigint, uuid) from public, anon, authenticated;
grant execute on function public.get_sheet_notification(bigint, uuid) to service_role;
comment on function public.get_sheet_notification(bigint, uuid)
  is 'For the notify-sheet Edge Function: who to mail about the sheet''s current status, with their verified addresses. The actor must be the person that status change belongs to.';

-- The function reads the SMTP account with the service role; say so explicitly.
grant select on public.workspace_settings to service_role;

commit;
