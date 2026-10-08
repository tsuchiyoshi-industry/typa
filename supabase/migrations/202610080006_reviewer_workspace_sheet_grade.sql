-- A sheet is evaluated on the common items of the grade it was created with
-- (evaluation_sheets.grade_id), as the app already does. The reviewer workspace used the
-- employee's current grade, so a sheet opened after a promotion showed another grade's items.
-- An employee with no sheet for the period yet is listed with their current grade, which is
-- the grade a new sheet would get.
begin;

create or replace function public.reviewer_sheet_snapshot(p_sheet_id bigint, p_stage text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when s.status = 'draft' then '{}'::jsonb else jsonb_build_object(
    'firstOverallComment', coalesce(s.first_overall_comment, ''),
    'secondOverallComment', case when p_stage = 'secondary' then coalesce(s.second_overall_comment, '') end,
    'firstRank', case when s.status in ('first_evaluated', 'finalized') then s.first_rank end,
    'finalRank', case when s.status = 'finalized' and (p_stage = 'secondary' or e.no_secondary_evaluator) then
      nullif(coalesce(s.final_rank_letter, '') || case s.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end, '') end,
    'finalScore', case when s.status = 'finalized' and (p_stage = 'secondary' or e.no_secondary_evaluator) then s.total_evaluation_score end,
    'objectives', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'goalNumber', m.goal_number, 'challengeGoal', coalesce(m.challenge_goal, ''),
      'achievement', coalesce(m.achievement, ''),
      'firstScore', coalesce(m.first_score, 0), 'secondScore', case when p_stage = 'secondary' then coalesce(m.second_score, 0) end
    ) order by m.goal_number, m.id) from (
      select * from public.milestones where sheet_id = s.id order by goal_number, id limit 2
    ) m), '[]'::jsonb),
    'commonItems', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'title', i.title, 'weight', i.weight,
      'firstScore', coalesce(r.first_score, 0), 'secondScore', case when p_stage = 'secondary' then coalesce(r.second_score, 0) end,
      'firstComment', coalesce(r.first_comment, '')
    ) order by i.id) from public.common_evaluation_items i
    left join public.common_evaluation_results r on r.item_id = i.id and r.sheet_id = s.id
    where i.item_set_id is null or i.item_set_id = g.item_set_id), '[]'::jsonb)
  ) end from public.evaluation_sheets s
  join public.employees e on e.id = s.employee_id
  left join public.employee_grades g on g.id = s.grade_id
  where s.id = p_sheet_id
$$;
revoke all on function public.reviewer_sheet_snapshot(bigint, text) from public, anon, authenticated;

create or replace function public.get_reviewer_workspace(p_period_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller_id integer;
  result jsonb;
begin
  select id into caller_id from public.employees where user_id = auth.uid();
  if caller_id is null then
    raise exception 'ログインが必要です。' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeId', e.id, 'employeeName', e.name, 'employeeNo', e.employee_no,
    'gradeId', g.id, 'gradeName', coalesce(g.grade_name, '等級未設定'),
    'careerCourse', coalesce(e.career_course, ''), 'primaryEvaluator', coalesce(pr.name, '未設定'),
    'primaryEvaluatorId', e.primary_evaluator_id,
    'isPrimary', e.primary_evaluator_id is not distinct from caller_id,
    'canViewSecond', e.secondary_evaluator_id is not distinct from caller_id,
    'canViewFinal', coalesce(e.secondary_evaluator_id = caller_id or (e.primary_evaluator_id = caller_id and e.no_secondary_evaluator), false),
    'primaryIsFinal', e.secondary_evaluator_id is null and e.no_secondary_evaluator,
    'sheetId', s.id, 'status', coalesce(s.status, 'missing'), 'updatedAt', s.updated_at,
    'objectiveAllocation', coalesce(case when s.status = 'finalized' then s.objective_allocation end, settings.objective_allocation),
    'commonAllocation', coalesce(case when s.status = 'finalized' then s.common_allocation end, settings.common_allocation),
    'firstOverallComment', coalesce(snapshot.value->>'firstOverallComment', ''),
    'secondOverallComment', snapshot.value->'secondOverallComment',
    'firstRank', snapshot.value->'firstRank',
    'finalRank', snapshot.value->'finalRank', 'finalScore', snapshot.value->'finalScore',
    'objectives', coalesce(snapshot.value->'objectives', '[]'::jsonb),
    'commonItems', coalesce(snapshot.value->'commonItems', '[]'::jsonb)
  ) order by e.employee_no), '[]'::jsonb) into result
  from public.employees e
  cross join public.evaluation_settings settings
  left join public.employees pr on pr.id = e.primary_evaluator_id
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = p_period_id
  left join public.employee_grades g on g.id = case when s.id is null then e.grade_id else s.grade_id end
  left join lateral (select public.reviewer_sheet_snapshot(s.id,
    case when e.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end) as value) snapshot on true
  where e.id <> caller_id and (e.primary_evaluator_id = caller_id or e.secondary_evaluator_id = caller_id);
  return result;
end;
$$;
revoke all on function public.get_reviewer_workspace(bigint) from public, anon, authenticated;
grant execute on function public.get_reviewer_workspace(bigint) to authenticated;

commit;
