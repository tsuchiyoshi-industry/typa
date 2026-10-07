-- Evaluation proceeds in explicit stages recorded on the sheet itself:
--   draft -> submitted -> first_evaluated -> finalized
-- The primary evaluator confirms the primary evaluation (first_evaluated); the final
-- evaluator then finalizes. For an employee marked no_secondary_evaluator the primary
-- evaluator finalizes a submitted sheet directly.
-- This replaces the per-evaluator "reviewed" checkpoints, which are dropped here.
-- Ranks are derived from the score rate, never chosen; the rank of each stage is stored
-- when that stage is confirmed.
begin;

alter table public.evaluation_sheets add column if not exists first_rank text;
comment on column public.evaluation_sheets.first_rank
  is 'Rank of the primary evaluation (S, A, B+, B, B-, C, D), stored when the primary evaluation is confirmed.';
alter table public.evaluation_sheets drop constraint if exists evaluation_sheets_first_rank_check;
alter table public.evaluation_sheets add constraint evaluation_sheets_first_rank_check
  check (first_rank in ('S', 'A', 'B+', 'B', 'B-', 'C', 'D'));
alter table public.evaluation_sheets drop constraint if exists evaluation_sheets_status_check;
alter table public.evaluation_sheets add constraint evaluation_sheets_status_check
  check (status in ('draft', 'submitted', 'first_evaluated', 'finalized'));

drop function if exists public.set_sheet_reviewed(bigint, text, boolean);
drop table if exists public.sheet_review_checkpoints;

-- Internal projection of one sheet for an evaluator. The primary version carries no
-- secondary field. A draft exposes nothing: evaluators see a sheet only once submitted.
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
  left join public.employee_grades g on g.id = e.grade_id
  where s.id = p_sheet_id
$$;
revoke all on function public.reviewer_sheet_snapshot(bigint, text) from public, anon, authenticated;

-- One server-authorized batch for a reviewer's whole caseload.
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
    'gradeId', e.grade_id, 'gradeName', coalesce(g.grade_name, '等級未設定'),
    'careerCourse', coalesce(e.career_course, ''), 'primaryEvaluator', coalesce(pr.name, '未設定'),
    'primaryEvaluatorId', e.primary_evaluator_id,
    'isPrimary', e.primary_evaluator_id is not distinct from caller_id,
    'canViewSecond', e.secondary_evaluator_id is not distinct from caller_id,
    'canViewFinal', coalesce(e.secondary_evaluator_id = caller_id or (e.primary_evaluator_id = caller_id and e.no_secondary_evaluator), false),
    'primaryIsFinal', e.secondary_evaluator_id is null and e.no_secondary_evaluator,
    'sheetId', s.id, 'status', coalesce(s.status, 'missing'), 'updatedAt', s.updated_at,
    'firstOverallComment', coalesce(snapshot.value->>'firstOverallComment', ''),
    'secondOverallComment', snapshot.value->'secondOverallComment',
    'firstRank', snapshot.value->'firstRank',
    'finalRank', snapshot.value->'finalRank', 'finalScore', snapshot.value->'finalScore',
    'objectives', coalesce(snapshot.value->'objectives', '[]'::jsonb),
    'commonItems', coalesce(snapshot.value->'commonItems', '[]'::jsonb)
  ) order by e.employee_no), '[]'::jsonb) into result
  from public.employees e
  left join public.employee_grades g on g.id = e.grade_id
  left join public.employees pr on pr.id = e.primary_evaluator_id
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = p_period_id
  left join lateral (select public.reviewer_sheet_snapshot(s.id,
    case when e.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end) as value) snapshot on true
  where e.id <> caller_id and (e.primary_evaluator_id = caller_id or e.secondary_evaluator_id = caller_id);
  return result;
end;
$$;
revoke all on function public.get_reviewer_workspace(bigint) from public, anon, authenticated;
grant execute on function public.get_reviewer_workspace(bigint) to authenticated;

-- The primary evaluator tells the secondary evaluator that the sheet is ready for them.
-- Returns the secondary evaluator's sign-up contact email, or null when not registered.
create or replace function public.get_first_evaluated_sheet_notification_recipient(p_sheet_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  secondary_id integer;
begin
  select subject.secondary_evaluator_id into secondary_id
  from public.evaluation_sheets as sheet
  join public.employees as subject on subject.id = sheet.employee_id
  join public.employees as evaluator on evaluator.id = subject.primary_evaluator_id
  where sheet.id = p_sheet_id
    and sheet.status = 'first_evaluated'
    and evaluator.user_id = auth.uid()
    and evaluator.id <> subject.id;

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
  is 'Sign-up contact email of the secondary evaluator of a first-evaluated sheet; primary evaluator only.';

commit;
