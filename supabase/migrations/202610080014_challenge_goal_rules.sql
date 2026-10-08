-- Two rules for challenge goals change:
-- 1. Only the challenge goal itself is required to submit or confirm a sheet. The midterm
--    goal and the achievement may stay blank (202610080012 required all three).
-- 2. The largest number of goals on a sheet was fixed at 4 in the app and in SQL. It becomes
--    a setting an Admin edits, next to the allocation, so every signed-in employee can read it.
begin;

alter table public.evaluation_settings
  add column if not exists max_challenge_goals smallint not null default 4
    check (max_challenge_goals between 1 and 10);
comment on column public.evaluation_settings.max_challenge_goals
  is 'Largest number of challenge goals on one sheet. Checked when a goal is added and when a sheet is submitted or confirmed.';
grant update (max_challenge_goals) on public.evaluation_settings to authenticated;

-- The goal number is no longer capped by a fixed column constraint; the setting decides.
-- With the unique (sheet_id, goal_number) key, numbers 1..max limit a sheet to max goals.
alter table public.milestones drop constraint if exists milestones_goal_number_range;
alter table public.milestones add constraint milestones_goal_number_range
  check (goal_number is not null and goal_number >= 1) not valid;

create or replace function public.check_challenge_goal_number()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  max_goals smallint;
begin
  select max_challenge_goals into max_goals from public.evaluation_settings;
  if new.goal_number > max_goals then
    raise exception 'チャレンジ目標は最大%件です。', max_goals using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.check_challenge_goal_number() from public, anon, authenticated;
drop trigger if exists milestones_check_goal_number on public.milestones;
create trigger milestones_check_goal_number
  before insert or update of goal_number on public.milestones
  for each row execute function public.check_challenge_goal_number();

-- Internal projection of one sheet for an evaluator, by the sheet's own evaluators.
-- Same as 202610080012 without the limit of four goals.
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
    ) order by m.goal_number, m.id) from public.milestones m where m.sheet_id = s.id), '[]'::jsonb),
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
  max_goals smallint;
  use_first boolean;
  item_set smallint;
  missing_items text;
begin
  if new.status is not distinct from old.status or new.status not in ('submitted', 'first_evaluated', 'finalized') then
    return new;
  end if;

  select max_challenge_goals into max_goals from public.evaluation_settings;
  if (select count(*) from public.milestones where sheet_id = new.id) not between 1 and max_goals then
    raise exception 'チャレンジ目標は最低1件、最大%件必要です。', max_goals using errcode = '23514';
  end if;
  select string_agg('・目標 ' || m.goal_number || '：チャレンジ目標', E'\n' order by m.goal_number)
    into missing_items
  from public.milestones m
  where m.sheet_id = new.id and coalesce(m.challenge_goal, '') !~ '[^[:space:]]';
  if missing_items is not null then
    raise exception 'チャレンジ目標が空欄の目標は提出・確定できません。入力して保存するか、不要なタブを削除してください。% %', E'\n', missing_items using errcode = '23514';
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
    from public.milestones milestone
    where milestone.sheet_id = new.id
      and coalesce(case when use_first then milestone.first_score else milestone.second_score end, 0) not between 1 and 4
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
