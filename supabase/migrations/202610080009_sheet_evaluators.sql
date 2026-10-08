-- A sheet carries its own evaluators, like its grade. Organisations change: when an employee
-- gets a new evaluator for the next period, last period's finalized sheet must still belong
-- to the evaluators who evaluated it (who can read and export it, whose names are printed).
--   * A new sheet takes the employee's evaluators when it is created.
--   * While a sheet is not finalized and its period is active, a change in the employee
--     master is carried over to it, so an evaluator can still be assigned or replaced.
--   * Once finalized, the sheet keeps its evaluators whatever the employee master says.
-- Requires 202610080008 (evaluation periods).
begin;

-- No foreign key on purpose: a second relationship from evaluation_sheets to employees would
-- make the API's embedded "employees" join ambiguous, also for app versions already installed.
-- Employee rows are never deleted.
alter table public.evaluation_sheets
  add column if not exists primary_evaluator_id integer,
  add column if not exists secondary_evaluator_id integer,
  add column if not exists no_secondary_evaluator boolean;
comment on column public.evaluation_sheets.primary_evaluator_id
  is 'Primary evaluator of this sheet. Follows the employee master until the sheet is finalized, then fixed.';
comment on column public.evaluation_sheets.secondary_evaluator_id
  is 'Secondary evaluator of this sheet. Follows the employee master until the sheet is finalized, then fixed.';
comment on column public.evaluation_sheets.no_secondary_evaluator
  is 'true: this sheet has no secondary evaluator by decision; its primary evaluation is final.';

-- Existing sheets have no record of their evaluators; the current ones are the best known
-- value. Sheets of closed periods are otherwise read-only, so triggers are off for this.
alter table public.evaluation_sheets disable trigger user;
update public.evaluation_sheets as sheet
set primary_evaluator_id = employee.primary_evaluator_id,
    secondary_evaluator_id = employee.secondary_evaluator_id,
    no_secondary_evaluator = employee.no_secondary_evaluator
from public.employees as employee
where employee.id = sheet.employee_id and sheet.no_secondary_evaluator is null;
alter table public.evaluation_sheets enable trigger user;

alter table public.evaluation_sheets alter column no_secondary_evaluator set default false;
update public.evaluation_sheets set no_secondary_evaluator = false where no_secondary_evaluator is null;
alter table public.evaluation_sheets alter column no_secondary_evaluator set not null;
create index if not exists evaluation_sheets_primary_evaluator_idx
  on public.evaluation_sheets (primary_evaluator_id);
create index if not exists evaluation_sheets_secondary_evaluator_idx
  on public.evaluation_sheets (secondary_evaluator_id);

create or replace function public.set_evaluation_sheet_evaluators()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select employee.primary_evaluator_id, employee.secondary_evaluator_id, employee.no_secondary_evaluator
    into new.primary_evaluator_id, new.secondary_evaluator_id, new.no_secondary_evaluator
  from public.employees employee where employee.id = new.employee_id;
  new.no_secondary_evaluator := coalesce(new.no_secondary_evaluator, false);
  return new;
end;
$$;
revoke all on function public.set_evaluation_sheet_evaluators() from public, anon, authenticated;
drop trigger if exists evaluation_sheets_set_evaluators on public.evaluation_sheets;
create trigger evaluation_sheets_set_evaluators
  before insert on public.evaluation_sheets
  for each row execute function public.set_evaluation_sheet_evaluators();

create or replace function public.sync_evaluation_sheet_evaluators()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.evaluation_sheets as sheet
  set primary_evaluator_id = new.primary_evaluator_id,
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
drop trigger if exists employees_sync_sheet_evaluators on public.employees;
create trigger employees_sync_sheet_evaluators
  after update of primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator
  on public.employees
  for each row execute function public.sync_evaluation_sheet_evaluators();

-- Internal projection of one sheet for an evaluator, by the sheet's own evaluators.
create or replace function public.reviewer_sheet_snapshot(p_sheet_id bigint, p_stage text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when s.status = 'draft' then '{}'::jsonb else jsonb_build_object(
    'firstOverallComment', coalesce(s.first_overall_comment, ''),
    'secondOverallComment', case when p_stage = 'secondary' then coalesce(s.second_overall_comment, '') end,
    'firstRank', case when s.status in ('first_evaluated', 'finalized') then s.first_rank end,
    'finalRank', case when s.status = 'finalized' and (p_stage = 'secondary' or s.no_secondary_evaluator) then
      nullif(coalesce(s.final_rank_letter, '') || case s.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end, '') end,
    'finalScore', case when s.status = 'finalized' and (p_stage = 'secondary' or s.no_secondary_evaluator) then s.total_evaluation_score end,
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
  left join public.employee_grades g on g.id = s.grade_id
  where s.id = p_sheet_id
$$;
revoke all on function public.reviewer_sheet_snapshot(bigint, text) from public, anon, authenticated;

-- A reviewer's caseload for a period: the employees whose sheet of that period names the
-- caller as evaluator, plus the caller's current subordinates who have no sheet yet.
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
    'primaryEvaluatorId', ev.primary_id,
    'isPrimary', ev.primary_id is not distinct from caller_id,
    'canViewSecond', ev.secondary_id is not distinct from caller_id,
    'canViewFinal', coalesce(ev.secondary_id = caller_id or (ev.primary_id = caller_id and ev.no_secondary), false),
    'primaryIsFinal', ev.secondary_id is null and ev.no_secondary,
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
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = p_period_id
  cross join lateral (select
    case when s.id is null then e.primary_evaluator_id else s.primary_evaluator_id end as primary_id,
    case when s.id is null then e.secondary_evaluator_id else s.secondary_evaluator_id end as secondary_id,
    case when s.id is null then e.no_secondary_evaluator else s.no_secondary_evaluator end as no_secondary
  ) ev
  left join public.employees pr on pr.id = ev.primary_id
  left join public.employee_grades g on g.id = case when s.id is null then e.grade_id else s.grade_id end
  left join lateral (select public.reviewer_sheet_snapshot(s.id,
    case when ev.secondary_id = caller_id then 'secondary' else 'primary' end) as value) snapshot on true
  where e.id <> caller_id and (ev.primary_id = caller_id or ev.secondary_id = caller_id);
  return result;
end;
$$;
revoke all on function public.get_reviewer_workspace(bigint) from public, anon, authenticated;
grant execute on function public.get_reviewer_workspace(bigint) to authenticated;

commit;
