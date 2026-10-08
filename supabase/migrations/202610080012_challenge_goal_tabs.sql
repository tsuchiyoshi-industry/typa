begin;

-- A unique (sheet_id, goal_number) key plus numbers 1..4 limits each sheet to four tabs.
-- NOT VALID keeps legacy rows untouched; new writes must follow the new limit.
alter table public.milestones drop constraint if exists milestones_goal_number_range;
alter table public.milestones add constraint milestones_goal_number_range check (goal_number is not null and goal_number between 1 and 4) not valid;

-- Only the subject may remove tabs while the sheet is still editable.
drop policy if exists "subject deletes draft milestones" on public.milestones;
create policy "subject deletes draft milestones" on public.milestones for delete to authenticated using (
  exists (select 1 from public.evaluation_sheets s join public.employees e on e.id = s.employee_id
    join public.evaluation_periods p on p.id = s.period_id
    where s.id = milestones.sheet_id and e.user_id = auth.uid() and s.status = 'draft' and p.is_active)
);

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
      select * from public.milestones where sheet_id = s.id order by goal_number, id limit 4
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


create or replace function public.check_evaluation_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  use_first boolean;
  item_set smallint;
  missing_items text;
begin
  if new.status is not distinct from old.status or new.status not in ('submitted', 'first_evaluated', 'finalized') then
    return new;
  end if;

  if (select count(*) from public.milestones where sheet_id = new.id) not between 1 and 4 then
    raise exception 'チャレンジ目標は最低1件、最大4件必要です。' using errcode = '23514';
  end if;
  select string_agg('・目標 ' || m.goal_number || '：' || field.label, E'\n' order by m.goal_number, field.label)
    into missing_items
  from public.milestones m
  cross join lateral (values ('チャレンジ目標', m.challenge_goal), ('中間目標', m.midterm_goal), ('達成状況', m.achievement)) field(label, value)
  where m.sheet_id = new.id and coalesce(field.value, '') !~ '[^[:space:]]';
  if missing_items is not null then
    raise exception '空欄のある目標は提出・確定できません。すべての欄を入力して保存するか、不要なタブを削除してください。% %', E'\n', missing_items using errcode = '23514';
  end if;
  if new.status = 'submitted' then return new; end if;

  use_first := new.status = 'first_evaluated'
    or (new.no_secondary_evaluator and new.secondary_evaluator_id is null);
  select grade.item_set_id into item_set
  from public.employee_grades grade where grade.id = new.grade_id;

  select string_agg(pending.label, E'\n' order by pending.kind, pending.item_id) into missing_items
  from (
    select 0 as kind, milestone.id as item_id,
           '・チャレンジ目標 ' || coalesce(milestone.goal_number::text, milestone.id::text) as label
    from (
      select * from public.milestones where sheet_id = new.id order by goal_number, id limit 4
    ) milestone
    where coalesce(case when use_first then milestone.first_score else milestone.second_score end, 0) not between 1 and 4
    union all
    select 1 as kind, item.id as item_id, '・共通評価「' || coalesce(item.title, '項目 ' || item.id) || '」' as label
    from public.common_evaluation_items item
    left join public.common_evaluation_results result on result.item_id = item.id and result.sheet_id = new.id
    where (item.item_set_id is null or item.item_set_id = item_set)
      and coalesce(case when use_first then result.first_score else result.second_score end, 0) not between 1 and 4
  ) pending;

  if missing_items is not null then
    raise exception '%評価に未設定の項目があります。すべての評価を 1〜4 で設定して保存してください。% %',
      case when use_first then '一次' else '二次' end, E'\n', missing_items
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.check_evaluation_completion() from public, anon, authenticated;

commit;
