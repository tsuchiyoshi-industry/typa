-- Company-specific evaluation rules become settings an Admin edits, starting with how the
-- 100 points of an evaluation are allocated between challenge goals and common evaluation.
-- A sheet keeps the allocation its scores were calculated with, so changing the setting
-- later does not disagree with the scores and rank of an already finalized sheet.
begin;

create table if not exists public.evaluation_settings (
  -- Exactly one row.
  id boolean primary key default true check (id),
  objective_allocation smallint not null default 20 check (objective_allocation >= 0),
  common_allocation smallint not null default 80 check (common_allocation >= 0),
  updated_at timestamptz not null default now(),
  constraint evaluation_settings_allocation_total check (objective_allocation + common_allocation = 100)
);
comment on table public.evaluation_settings
  is 'Single-row evaluation settings. Allocation: points given to challenge goals and to common evaluation, 100 in total.';
insert into public.evaluation_settings default values on conflict (id) do nothing;

alter table public.evaluation_settings enable row level security;
revoke all on public.evaluation_settings from public, anon, authenticated;
grant select on public.evaluation_settings to authenticated;
grant update (objective_allocation, common_allocation, updated_at) on public.evaluation_settings to authenticated;

drop policy if exists "evaluation settings are readable when signed in" on public.evaluation_settings;
create policy "evaluation settings are readable when signed in"
  on public.evaluation_settings for select to authenticated using (true);

drop policy if exists "only Admin changes evaluation settings" on public.evaluation_settings;
create policy "only Admin changes evaluation settings"
  on public.evaluation_settings for update to authenticated
  using (exists (
    select 1 from public.employees as caller
    join public.roles as caller_role on caller_role.id = caller.role_id
    where caller.user_id = auth.uid() and caller_role.role_name = 'Admin'
  ))
  with check (true);

alter table public.evaluation_sheets
  add column if not exists objective_allocation smallint,
  add column if not exists common_allocation smallint;
comment on column public.evaluation_sheets.objective_allocation
  is 'Points allocated to challenge goals when this sheet''s evaluation scores were last calculated.';
comment on column public.evaluation_sheets.common_allocation
  is 'Points allocated to common evaluation when this sheet''s evaluation scores were last calculated.';
-- Sheets finalized before this setting existed were calculated with 20 / 80.
update public.evaluation_sheets
set objective_allocation = 20, common_allocation = 80
where status = 'finalized' and objective_allocation is null;

-- One server-authorized batch for a reviewer's whole caseload. Each row carries the
-- allocation its scores use: the sheet's own once finalized, otherwise the current setting.
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

commit;
