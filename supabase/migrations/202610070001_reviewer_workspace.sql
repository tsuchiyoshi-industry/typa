-- One server-authorized batch for a reviewer's whole caseload, plus personal
-- review checkpoints. A checkpoint is tied to the content, not a mutable timestamp.
begin;

create table if not exists public.sheet_review_checkpoints (
  sheet_id bigint not null references public.evaluation_sheets(id) on delete cascade,
  evaluator_id integer not null references public.employees(id) on delete cascade,
  stage text not null check (stage in ('primary', 'secondary')),
  revision text not null,
  reviewed_at timestamptz not null default now(),
  primary key (sheet_id, evaluator_id, stage)
);
alter table public.sheet_review_checkpoints enable row level security;
-- Access only through the RPCs below. Subjects cannot inspect evaluator progress.
revoke all on public.sheet_review_checkpoints from public, anon, authenticated;
create index if not exists milestones_review_sheet_idx on public.milestones(sheet_id);
create index if not exists common_results_review_sheet_idx on public.common_evaluation_results(sheet_id);
create index if not exists evaluation_sheets_review_period_idx on public.evaluation_sheets(period_id, employee_id);

-- Internal snapshot. Its primary version excludes every secondary field, so
-- secondary edits neither invalidate primary review nor leak through its hash.
create or replace function public.reviewer_sheet_snapshot(p_sheet_id bigint, p_stage text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', case when s.status = 'finalized' then 'submitted' else s.status end,
    'gradeId', e.grade_id, 'gradeName', g.grade_name, 'careerCourse', e.career_course, 'itemSetId', g.item_set_id,
    'primaryId', e.primary_evaluator_id, 'secondaryId', e.secondary_evaluator_id,
    'noSecondary', e.no_secondary_evaluator,
    'firstOverallComment', coalesce(s.first_overall_comment, ''),
    'secondOverallComment', case when p_stage = 'secondary' then coalesce(s.second_overall_comment, '') end,
    'finalRank', case when p_stage = 'secondary' or e.no_secondary_evaluator then
      nullif(coalesce(s.final_rank_letter, '') || case s.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end, '') end,
    'finalScore', case when p_stage = 'secondary' or e.no_secondary_evaluator then s.total_evaluation_score end,
    'objectives', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'goalNumber', m.goal_number, 'challengeGoal', coalesce(m.challenge_goal, ''),
      'midtermGoal', coalesce(m.midterm_goal, ''), 'achievement', coalesce(m.achievement, ''),
      'firstScore', coalesce(m.first_score, 0), 'secondScore', case when p_stage = 'secondary' then coalesce(m.second_score, 0) end
    ) order by m.goal_number, m.id) from (
      select * from public.milestones where sheet_id = s.id order by goal_number, id limit 2
    ) m), '[]'::jsonb),
    'commonItems', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'title', i.title, 'description', i.description, 'weight', i.weight,
      'firstScore', coalesce(r.first_score, 0), 'secondScore', case when p_stage = 'secondary' then coalesce(r.second_score, 0) end,
      'firstComment', coalesce(r.first_comment, '')
    ) order by i.id) from public.common_evaluation_items i
    left join public.common_evaluation_results r on r.item_id = i.id and r.sheet_id = s.id
    where i.item_set_id is null or i.item_set_id = g.item_set_id), '[]'::jsonb)
  ) from public.evaluation_sheets s
  join public.employees e on e.id = s.employee_id
  left join public.employee_grades g on g.id = e.grade_id
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
    'gradeId', e.grade_id, 'gradeName', coalesce(g.grade_name, '等級未設定'),
    'careerCourse', coalesce(e.career_course, ''), 'primaryEvaluator', coalesce(pr.name, '未設定'),
    'primaryEvaluatorId', e.primary_evaluator_id,
    'role', case when e.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end,
    'canViewSecond', e.secondary_evaluator_id is not distinct from caller_id,
    'canViewFinal', coalesce(e.secondary_evaluator_id = caller_id or (e.primary_evaluator_id = caller_id and e.no_secondary_evaluator), false),
    'sheetId', s.id, 'status', coalesce(s.status, 'missing'), 'updatedAt', s.updated_at,
    'revision', case when s.id is not null then md5((snapshot.value - 'finalScore')::text) end,
    'reviewedAt', checkpoint.reviewed_at,
    'reviewed', coalesce(checkpoint.revision = md5((snapshot.value - 'finalScore')::text), false),
    'needsRecheck', coalesce(checkpoint.revision <> md5((snapshot.value - 'finalScore')::text), false),
    'primaryReviewed', coalesce(primary_checkpoint.revision = md5((primary_snapshot.value - 'finalScore')::text), false),
    'firstOverallComment', coalesce(snapshot.value->>'firstOverallComment', ''),
    'secondOverallComment', snapshot.value->'secondOverallComment',
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
  left join lateral (select public.reviewer_sheet_snapshot(s.id, 'primary') as value) primary_snapshot on true
  left join public.sheet_review_checkpoints checkpoint on checkpoint.sheet_id = s.id
    and checkpoint.evaluator_id = caller_id
    and checkpoint.stage = case when e.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end
  left join public.sheet_review_checkpoints primary_checkpoint on primary_checkpoint.sheet_id = s.id
    and primary_checkpoint.evaluator_id = e.primary_evaluator_id and primary_checkpoint.stage = 'primary'
  where e.id <> caller_id and (e.primary_evaluator_id = caller_id or e.secondary_evaluator_id = caller_id);
  return result;
end;
$$;

create or replace function public.set_sheet_reviewed(p_sheet_id bigint, p_revision text, p_reviewed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  caller_id integer;
  subject public.employees%rowtype;
  sheet_status text;
  review_stage text;
  actual_revision text;
begin
  select id into caller_id from public.employees where user_id = auth.uid();
  select e.* into subject from public.employees e
    join public.evaluation_sheets s on s.employee_id = e.id where s.id = p_sheet_id;
  if caller_id is null or subject.id is null or subject.id = caller_id
    or not (coalesce(subject.primary_evaluator_id = caller_id, false)
      or coalesce(subject.secondary_evaluator_id = caller_id, false)) then
    raise exception '担当評価者のみ確認を記録できます。' using errcode = '42501';
  end if;
  select status into sheet_status from public.evaluation_sheets where id = p_sheet_id for update;
  if sheet_status <> 'submitted' then
    raise exception '提出済み・未確定のシートのみ確認を記録できます。';
  end if;
  review_stage := case when subject.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end;
  actual_revision := md5((public.reviewer_sheet_snapshot(p_sheet_id, review_stage) - 'finalScore')::text);
  if p_reviewed and actual_revision is distinct from p_revision then
    raise exception '評価内容が更新されています。再読み込みして確認してください。' using errcode = '40001';
  end if;
  if p_reviewed then
    insert into public.sheet_review_checkpoints (sheet_id, evaluator_id, stage, revision, reviewed_at)
    values (p_sheet_id, caller_id, review_stage, actual_revision, now())
    on conflict (sheet_id, evaluator_id, stage) do update set revision = excluded.revision, reviewed_at = excluded.reviewed_at;
    -- A reviewer assigned to both stages has checked their primary evaluation too.
    if review_stage = 'secondary' and subject.primary_evaluator_id = caller_id then
      insert into public.sheet_review_checkpoints (sheet_id, evaluator_id, stage, revision, reviewed_at)
      values (p_sheet_id, caller_id, 'primary', md5((public.reviewer_sheet_snapshot(p_sheet_id, 'primary') - 'finalScore')::text), now())
      on conflict (sheet_id, evaluator_id, stage) do update set revision = excluded.revision, reviewed_at = excluded.reviewed_at;
    end if;
  else
    delete from public.sheet_review_checkpoints where sheet_id = p_sheet_id and evaluator_id = caller_id;
  end if;
end;
$$;

revoke all on function public.get_reviewer_workspace(bigint) from public, anon, authenticated;
revoke all on function public.set_sheet_reviewed(bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.get_reviewer_workspace(bigint) to authenticated;
grant execute on function public.set_sheet_reviewed(bigint, text, boolean) to authenticated;
commit;
