-- 目標確認と実績提出を分ける。既存の submitted（一次評価待ち）以降の状態は移し替えない。
-- Apply after 202610230004. 過去のマイグレーションは変更しない。
begin;

alter table public.evaluation_sheets drop constraint evaluation_sheets_status_check;
alter table public.evaluation_sheets add constraint evaluation_sheets_status_check check (
  status in ('draft', 'goals_submitted', 'goals_confirmed', 'submitted', 'first_evaluated', 'finalized'));

create or replace function public.valid_period_goals(goals jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(goals) is distinct from 'array' then return false; end if;
  if jsonb_array_length(goals) > 4 then return false; end if;
  for item in select * from jsonb_array_elements(goals) loop
    if jsonb_typeof(item) is distinct from 'object' then return false; end if;
    if jsonb_typeof(item->'description') is distinct from 'string'
       or jsonb_typeof(item->'achievement') is distinct from 'string'
       or item - 'description' - 'achievement' <> '{}'::jsonb then return false; end if;
  end loop;
  return true;
end;
$$;
alter table public.milestones add column achievement text not null default '';
-- 旧形式でタスク未記入だった1行は、チャレンジ目標への達成状況に戻す。内容を切り捨てない。
alter table public.milestones disable trigger user;
update public.milestones set achievement = period_goals->0->>'achievement', period_goals = '[]'::jsonb
where jsonb_array_length(period_goals) = 1 and period_goals->0->>'description' = '';
alter table public.milestones enable trigger user;
alter table public.milestones alter column period_goals set default '[]'::jsonb;
alter table public.milestones drop constraint milestones_period_goals_check;
alter table public.milestones add constraint milestones_period_goals_check check (public.valid_period_goals(period_goals));
grant select (achievement), insert (achievement), update (achievement) on public.milestones to authenticated;

-- RPC と直接 UPDATE の両方で同じ状態遷移を検査する。
create or replace function public.can_transition_sheet(sheet public.evaluation_sheets, target text, actor integer)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(case sheet.status || '>' || target
    when 'draft>goals_submitted' then actor = sheet.employee_id
    when 'goals_submitted>draft' then actor <> sheet.employee_id and actor = sheet.primary_evaluator_id
    when 'goals_submitted>goals_confirmed' then actor <> sheet.employee_id and actor = sheet.primary_evaluator_id
    when 'goals_confirmed>submitted' then actor = sheet.employee_id
    when 'submitted>first_evaluated' then actor <> sheet.employee_id and actor = sheet.primary_evaluator_id and not (sheet.no_secondary_evaluator and sheet.secondary_evaluator_id is null)
    when 'submitted>finalized' then actor <> sheet.employee_id and actor = sheet.primary_evaluator_id and sheet.no_secondary_evaluator and sheet.secondary_evaluator_id is null
    when 'first_evaluated>finalized' then actor <> sheet.employee_id and (actor = sheet.secondary_evaluator_id or (actor = sheet.primary_evaluator_id and sheet.no_secondary_evaluator and sheet.secondary_evaluator_id is null))
  end, false)
$$;
revoke all on function public.can_transition_sheet(public.evaluation_sheets, text, integer) from public, anon, authenticated;
grant execute on function public.can_transition_sheet(public.evaluation_sheets, text, integer) to authenticated;

-- 固定した目標の本文・件数・順序を変えず、対応する実績だけを変更できる。
create or replace function public.goal_achievement_only(before_row jsonb, after_row jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if not public.valid_period_goals(after_row->'period_goals') then return false; end if;
  return public.changed_columns(before_row, after_row) <@ array['period_goals', 'achievement']
    and jsonb_path_query_array(before_row->'period_goals', '$[*].description') = jsonb_path_query_array(after_row->'period_goals', '$[*].description')
    and (jsonb_array_length(before_row->'period_goals') = 0 or before_row->'achievement' is not distinct from after_row->'achievement');
end;
$$;
revoke all on function public.goal_achievement_only(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.goal_achievement_only(jsonb, jsonb) to authenticated;

create or replace function public.guard_evaluation_sheet_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  me integer;
  is_subject boolean;
  is_primary boolean;
  is_secondary boolean;
  primary_is_final boolean;
  changed text[];
  allowed text[] := '{}';
  score_columns constant text[] := array[
    'objectives_first_total_score', 'objectives_first_total_rate',
    'objectives_second_total_score', 'objectives_second_total_rate',
    'objectives_second_evaluation_score',
    'common_evaluation_first_total_score', 'common_evaluation_first_total_rate',
    'common_evaluation_second_total_score', 'common_evaluation_second_total_rate',
    'common_evaluation_second_evaluation_score', 'total_evaluation_score'
  ];
  total_columns constant text[] := score_columns || array['objective_allocation', 'common_allocation'];
  settings public.evaluation_settings%rowtype;
  expected integer;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  changed := public.changed_columns(to_jsonb(old), to_jsonb(new));
  -- Creating a sheet that already exists is sent as an update that changes nothing.
  if changed = '{}' then
    return new;
  end if;
  if old.status = 'finalized' then
    raise exception '確定した評価シートは変更できません。' using errcode = '42501';
  end if;

  me := public.current_employee_id();
  is_subject := coalesce(old.employee_id = me, false);
  is_primary := not is_subject and coalesce(old.primary_evaluator_id = me, false);
  is_secondary := not is_subject and coalesce(old.secondary_evaluator_id = me, false);
  primary_is_final := old.no_secondary_evaluator and old.secondary_evaluator_id is null;

  if is_primary and old.status = 'submitted' then
    allowed := allowed || total_columns || array['first_overall_comment'];
  end if;
  if is_secondary and old.status = 'first_evaluated' then
    allowed := allowed || total_columns || array['second_overall_comment'];
  end if;
  -- Up to 0.9.8 the app stores the totals of a new, empty sheet when the subject creates it.
  if is_subject and old.status = 'draft' and not exists (
    select 1 from jsonb_each(to_jsonb(new)) as stored
    where stored.key = any (score_columns) and stored.value not in ('null'::jsonb, '0'::jsonb)
  ) then
    allowed := allowed || total_columns;
  end if;

  if new.status is distinct from old.status then
    if not public.can_transition_sheet(old, new.status, me) then
      raise exception 'この評価シートの状態を変更する権限がありません。' using errcode = '42501';
    end if;
    allowed := allowed || array['status'];

    -- The rank is derived from the scores, never chosen. What is stored on confirmation must
    -- be what the scores give with the current allocation.
    select * into settings from public.evaluation_settings;
    if new.status = 'first_evaluated' or (new.status = 'finalized' and primary_is_final) then
      allowed := allowed || array['first_rank'];
      expected := public.sheet_evaluation_score(
        new.id, true, settings.objective_allocation, settings.common_allocation);
      if new.first_rank is distinct from public.evaluation_rank(expected) then
        raise exception '評価ランクが現在の評価内容と一致しません。再読み込みしてからやり直してください。' using errcode = '23514';
      end if;
    end if;
    if new.status = 'finalized' then
      allowed := allowed || array['final_rank_letter', 'final_rank_level'];
      expected := public.sheet_evaluation_score(
        new.id, primary_is_final, settings.objective_allocation, settings.common_allocation);
      if new.total_evaluation_score is distinct from expected
        or new.objective_allocation is distinct from settings.objective_allocation
        or new.common_allocation is distinct from settings.common_allocation
        or coalesce(new.final_rank_letter, '') || (case new.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end)
           is distinct from public.evaluation_rank(expected) then
        raise exception '評価点または評価ランクが現在の評価内容と一致しません。再読み込みしてからやり直してください。' using errcode = '23514';
      end if;
    end if;
  end if;

  if not changed <@ allowed then
    raise exception 'この評価シートの項目を変更する権限がありません。' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.transition_evaluation_sheet(p_sheet_id bigint,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.evaluation_sheets%rowtype; me integer:=public.current_employee_id(); primary_final boolean;
begin
  select * into s from public.evaluation_sheets where id=p_sheet_id for update;
  if me is null or s.id is null then raise exception 'ログインが必要です。' using errcode='42501'; end if;
  primary_final:=s.no_secondary_evaluator and s.secondary_evaluator_id is null;
  if not public.can_transition_sheet(s, p_status, me) then raise exception 'この評価シートの状態を変更する権限がありません。' using errcode='42501'; end if;
  update public.evaluation_sheets set status=p_status,updated_at=now() where id=p_sheet_id;
  -- 下書きに戻すと評価者は本文を閲覧できなくなる。成功のみ返す。
  if p_status = 'draft' then return null; end if;
  return public.get_sheet(p_sheet_id);
end;
$$;

-- 達成状況の編集も親シートをロックして、本人の一次評価依頼との競合を防ぐ。
create or replace function public.lock_sheet_content_write()
returns trigger language plpgsql set search_path='' as $$
declare s jsonb; target bigint; me integer; allowed text[];
begin
  target := case when tg_op='DELETE' then old.sheet_id else new.sheet_id end;
  if current_user in ('authenticated','anon') then
    s := public.lock_evaluation_sheet(target);
    me := public.current_employee_id();
    if tg_op='UPDATE' and old.sheet_id is distinct from new.sheet_id then
      raise exception '別のシートに移せません。' using errcode='42501';
    end if;
    if s->>'status'='finalized' then
      raise exception '確定した評価内容は変更できません。' using errcode='42501';
    end if;
    if tg_table_name='milestones' then
      allowed := case
        when me=(s->>'employee_id')::integer and s->>'status'='draft' then array['goal_number','challenge_goal','period_goals','achievement']
        when me=(s->>'employee_id')::integer and s->>'status'='goals_confirmed' then array['period_goals','achievement']
        when me<>(s->>'employee_id')::integer and me=(s->>'primary_evaluator_id')::integer and s->>'status'='submitted' then array['first_score']
        when me<>(s->>'employee_id')::integer and me=(s->>'secondary_evaluator_id')::integer and s->>'status'='first_evaluated' then array['second_score']
        else '{}'::text[] end;
      if tg_op='UPDATE' and me=(s->>'employee_id')::integer and s->>'status'='goals_confirmed'
        and not public.goal_achievement_only(to_jsonb(old),to_jsonb(new)) then
        raise exception '目標確定後は達成状況だけを編集できます。' using errcode='42501';
      end if;
      if (tg_op in ('INSERT','DELETE') and not coalesce(me=(s->>'employee_id')::integer and s->>'status'='draft',false))
        or (tg_op='UPDATE' and not public.changed_columns(to_jsonb(old),to_jsonb(new)) <@ allowed) then
        raise exception 'この目標を変更する権限がありません。' using errcode='42501';
      end if;
    end if;
  else
    perform 1 from public.evaluation_sheets where id=target for update;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_milestone_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  access text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  access := public.sheet_access(old.sheet_id);
  if access = 'subject:goals_confirmed' and not public.goal_achievement_only(to_jsonb(old), to_jsonb(new)) then
    raise exception '目標確定後は達成状況だけを編集できます。' using errcode = '42501';
  end if;
  if not public.changed_columns(to_jsonb(old), to_jsonb(new)) <@ (case access
    when 'subject:draft' then array['goal_number', 'challenge_goal', 'period_goals', 'achievement']
    when 'subject:goals_confirmed' then array['period_goals', 'achievement']
    when 'first' then array['first_score']
    when 'second' then array['second_score']
    else '{}'::text[]
  end) then
    raise exception 'この目標の項目を変更する権限がありません。' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop policy "subject and evaluators change goals in their stage" on public.milestones;
create policy "subject and evaluators change goals in their stage" on public.milestones for update to authenticated
  using (public.sheet_access(sheet_id) in ('subject:draft','subject:goals_confirmed','first','second'))
  with check (public.sheet_access(sheet_id) in ('subject:draft','subject:goals_confirmed','first','second'));

create or replace function public.sync_evaluation_sheet_evaluators()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.evaluation_sheets as sheet
  set primary_evaluator_id = case when sheet.status in ('draft', 'goals_submitted', 'goals_confirmed', 'submitted')
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

create or replace function public.check_evaluation_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  max_goals smallint;
  use_first boolean;
  item_set smallint;
  missing_items text;
begin
  if new.status is not distinct from old.status or new.status not in ('goals_submitted', 'goals_confirmed', 'submitted', 'first_evaluated', 'finalized') then
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
  if new.status in ('goals_submitted', 'goals_confirmed', 'submitted') then return new; end if;

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

create or replace function public.sheet_document(
  p_sheet_id bigint, p_sees_content boolean, p_sees_first boolean, p_sees_second boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  sheet public.evaluation_sheets%rowtype;
  finalized boolean;
  sees_content boolean := p_sees_content;
  sees_first boolean := p_sees_first;
  sees_second boolean := p_sees_second;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  if sheet.id is null then
    return null;
  end if;
  finalized := sheet.status = 'finalized';
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
        'endDate', period.end_date, 'isActive', period.is_active,
        'termName', period.term_name, 'division', period.division, 'part', period.part,
        'isClosed', period.closed_at is not null,
        'allowUnfinalizedClose', period.allow_unfinalized_close)
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
        'periodGoals', goal.period_goals, 'achievement', goal.achievement,
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
    'maxChallengeGoals', (select max_challenge_goals from public.evaluation_settings),
    -- 締め後修正(遡及処理)。修正した項目を見られる人にだけ返す
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', correction.id, 'target', correction.target, 'goalNumber', correction.goal_number,
        'itemTitle', correction.item_title, 'field', correction.field,
        'before', correction.before_value, 'after', correction.after_value,
        'reason', correction.reason, 'correctedAt', correction.corrected_at
      ) order by correction.corrected_at, correction.id)
      from public.sheet_corrections as correction
      where correction.sheet_id = sheet.id and case
        when correction.field in ('challenge_goal', 'period_goals', 'achievement') then sees_content
        when correction.field in ('first_score', 'first_comment', 'first_overall_comment') then sees_first
        when correction.field in ('second_score', 'second_overall_comment') then sees_second
        else false end
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_previous_goals(p_sheet_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
  previous public.evaluation_sheets%rowtype;
  previous_period public.evaluation_periods%rowtype;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  if sheet.id is null or me is null or not (
    sheet.employee_id = me
    or (coalesce(me in (sheet.primary_evaluator_id, sheet.secondary_evaluator_id), false)
        and sheet.status <> 'draft')
  ) then
    return null;
  end if;
  select * into previous from public.evaluation_sheets
  where id = public.previous_evaluation_sheet(sheet.id);
  if not found then
    return null;
  end if;
  select * into previous_period from public.evaluation_periods where id = previous.period_id;
  -- 評価者には、まだ書きかけの前の評価期間の下書きを見せない
  if sheet.employee_id <> me and previous.status = 'draft' and previous_period.is_active then
    return null;
  end if;
  return jsonb_build_object(
    'periodName', previous_period.period_name,
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', goal.id, 'goalNumber', goal.goal_number,
        'challengeGoal', coalesce(goal.challenge_goal, ''),
        'periodGoals', goal.period_goals, 'achievement', goal.achievement
      ) order by goal.goal_number, goal.id)
      from public.milestones as goal where goal.sheet_id = previous.id
    ), '[]'::jsonb));
end;
$$;

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
      'periodGoals', m.period_goals, 'achievement', m.achievement,
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

create or replace function public.correct_closed_sheet(p_sheet_id bigint, p_changes jsonb, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  sheet public.evaluation_sheets%rowtype;
  period public.evaluation_periods%rowtype;
  change jsonb;
  target text; field text; value text; target_id bigint;
  before text; goal_no integer; title text;
  reason text := btrim(coalesce(p_reason, ''));
  score_changed boolean := false;
  applied integer := 0;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  select * into sheet from public.evaluation_sheets where id = p_sheet_id for update;
  if not found then
    raise exception '評価シートが見つかりません。' using errcode = 'P0002';
  end if;
  select * into period from public.evaluation_periods where id = sheet.period_id;
  if period.closed_at is null then
    raise exception '遡及処理で修正できるのは、締め済みの評価期間のシートだけです。' using errcode = '23514';
  end if;
  if char_length(reason) not between 1 and 500 then
    raise exception '修正の理由を 500 文字以内で入力してください。' using errcode = '23514';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception '修正する項目がありません。' using errcode = '23514';
  end if;

  perform set_config('typa.correcting_sheet', sheet.id::text, true);
  for change in select * from jsonb_array_elements(p_changes) loop
    target := change ->> 'target';
    field := change ->> 'field';
    value := coalesce(change ->> 'value', '');
    target_id := case when (change ->> 'targetId') ~ '^[0-9]{1,18}$' then (change ->> 'targetId')::bigint end;
    goal_no := null; title := null;

    if field in ('first_score', 'second_score') then
      if value !~ '^[1-4]$' then
        raise exception '点数は 1〜4 で入力してください。' using errcode = '23514';
      end if;
      if field = 'second_score' and sheet.no_secondary_evaluator and sheet.secondary_evaluator_id is null then
        raise exception '二次評価者を置かないシートには、二次評価点はありません。' using errcode = '23514';
      end if;
      score_changed := true;
    elsif field = 'period_goals' then
      if not public.valid_period_goals(value::jsonb) then
        raise exception '期中目標は0〜4件のタスクと達成状況で指定してください。' using errcode = '23514';
      end if;
    elsif char_length(value) > 2000 then
      raise exception '文章は 2000 文字以内で入力してください。' using errcode = '23514';
    end if;

    if target = 'goal' and field in ('challenge_goal', 'period_goals', 'achievement', 'first_score', 'second_score') then
      select goal_number, case field
          when 'challenge_goal' then coalesce(challenge_goal, '') when 'period_goals' then period_goals::text
          when 'achievement' then achievement when 'first_score' then coalesce(first_score, 0)::text
          else coalesce(second_score, 0)::text end
        into goal_no, before
      from public.milestones where id = target_id and sheet_id = sheet.id;
      if not found then
        raise exception 'このシートの目標ではありません。' using errcode = '23514';
      end if;
      execute format('update public.milestones set %I = $1::%s where id = $2', field,
        case when field like '%_score' then 'integer' when field = 'period_goals' then 'jsonb' else 'text' end) using value, target_id;
    elsif target = 'common' and field in ('first_score', 'second_score', 'first_comment') then
      select item.title into title from public.common_evaluation_items as item
      left join public.employee_grades as grade on grade.id = sheet.grade_id
      where item.id = target_id and (item.item_set_id is null or item.item_set_id = grade.item_set_id);
      if not found then
        raise exception 'このシートの共通評価の項目ではありません。' using errcode = '23514';
      end if;
      insert into public.common_evaluation_results (sheet_id, item_id) values (sheet.id, target_id)
      on conflict (sheet_id, item_id) do nothing;
      select case field when 'first_score' then coalesce(first_score, 0)::text
          when 'second_score' then coalesce(second_score, 0)::text else coalesce(first_comment, '') end
        into before
      from public.common_evaluation_results where sheet_id = sheet.id and item_id = target_id;
      execute format('update public.common_evaluation_results set %I = $1::%s, updated_at = now() where sheet_id = $2 and item_id = $3',
        field, case when field like '%_score' then 'integer' else 'text' end) using value, sheet.id, target_id;
    elsif target = 'sheet' and field in ('first_overall_comment', 'second_overall_comment') then
      before := coalesce(case field when 'first_overall_comment' then sheet.first_overall_comment
        else sheet.second_overall_comment end, '');
      execute format('update public.evaluation_sheets set %I = $1 where id = $2', field) using value, sheet.id;
      target_id := null;
    else
      raise exception '遡及処理で直せない項目です。' using errcode = '23514';
    end if;

    if (field = 'period_goals' and before::jsonb = value::jsonb) or (field <> 'period_goals' and before = value) then
      raise exception '今と同じ内容には修正できません。' using errcode = '23514';
    end if;
    insert into public.sheet_corrections
      (sheet_id, target, target_id, goal_number, item_title, field, before_value, after_value, reason, corrected_by)
    values (sheet.id, target, target_id, goal_no, title, field, before, value, reason, public.current_employee_id());
    applied := applied + 1;
  end loop;

  if score_changed then
    perform public.recalculate_corrected_sheet(sheet.id);
  end if;
  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'sheet.corrected', sheet.id, jsonb_build_object('changes', applied, 'reason', reason));
  perform set_config('typa.correcting_sheet', '', true);
  return applied;
end;
$$;

create or replace function public.import_sheet_data(p_goals jsonb, p_common jsonb, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_period bigint;
  max_goals integer;
  errors jsonb;
  goal_ids integer[];
  common_ids integer[];
  summary jsonb;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  select id into v_period from public.evaluation_periods where is_active;
  if not found then
    raise exception '実施中の評価期間がありません。先に「設定」で評価期間を始めてください。' using errcode = 'P0002';
  end if;
  select max_challenge_goals into max_goals from public.evaluation_settings;
  -- 確かめてから書くまでの間に、提出されたり作られたりしないようにする
  if p_apply then
    perform 1 from public.evaluation_sheets where period_id = v_period order by id for update;
  end if;

  create temp table import_goals on commit drop as
  select r.line, trim(coalesce(r."employeeNo", '')) as employee_no, trim(coalesce(r.name, '')) as name,
         trim(coalesce(r."goalNumber", '')) as goal_number,
         coalesce(r."challengeGoal", '') as challenge_goal,
         coalesce(r."periodGoals", '[]'::jsonb) as period_goals, coalesce(r.achievement, '') as achievement,
         trim(coalesce(r."firstScore", '')) as first_score, trim(coalesce(r."secondScore", '')) as second_score,
         e.id as employee_id, e.name as master_name, e.no_secondary_evaluator, s.status as sheet_status
  from jsonb_to_recordset(coalesce(p_goals, '[]')) as r(line integer, "employeeNo" text, name text,
         "goalNumber" text, "challengeGoal" text, "periodGoals" jsonb, achievement text,
         "firstScore" text, "secondScore" text)
  left join public.employees e on e.employee_no = trim(r."employeeNo") and e.is_enabled
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = v_period
  where concat(r."challengeGoal", r.achievement, r."firstScore", r."secondScore") ~ '[^[:space:]]'
     or (r."periodGoals" is not null and (not public.valid_period_goals(r."periodGoals")
       or exists (
         select 1 from jsonb_array_elements(case when jsonb_typeof(r."periodGoals") = 'array' then r."periodGoals" else '[]'::jsonb end) item
         where concat(item->>'description', item->>'achievement') ~ '[^[:space:]]')));

  create temp table import_common on commit drop as
  select r.line, trim(coalesce(r."employeeNo", '')) as employee_no, trim(coalesce(r.name, '')) as name,
         trim(coalesce(r."itemId", '')) as item_id, trim(coalesce(r."itemTitle", '')) as item_title,
         trim(coalesce(r."firstScore", '')) as first_score, trim(coalesce(r."secondScore", '')) as second_score,
         coalesce(r.comment, '') as comment,
         e.id as employee_id, e.name as master_name, e.no_secondary_evaluator, s.status as sheet_status,
         i.id as item, i.title as master_title
  from jsonb_to_recordset(coalesce(p_common, '[]')) as r(line integer, "employeeNo" text, name text,
         "itemId" text, "itemTitle" text, "firstScore" text, "secondScore" text, comment text)
  left join public.employees e on e.employee_no = trim(r."employeeNo") and e.is_enabled
  left join public.employee_grades g on g.id = e.grade_id
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = v_period
  left join public.common_evaluation_items i
    on i.id = case when trim(r."itemId") ~ '^[0-9]{1,18}$' then trim(r."itemId")::bigint end
   and (i.item_set_id is null or i.item_set_id = g.item_set_id)
  where concat(r."firstScore", r."secondScore", r.comment) ~ '[^[:space:]]';

  with goal_rows as (
    select *, min(line) over (partition by employee_id, number) as first_line
    from (select *, case when goal_number ~ '^[0-9]{1,9}$' then goal_number::integer end as number
          from import_goals) as parsed
  ), common_rows as (
    select *, min(line) over (partition by employee_id, item) as first_line from import_common
  ), found as (
    select 'goals' as file, line, ord, message from goal_rows cross join lateral (values
      (1, case when employee_no = '' then '社員番号が空欄です。'
               when employee_id is null then format('社員番号「%s」の社員がいません(利用停止中の社員には取り込めません)。', employee_no) end),
      (2, case when employee_id is not null and name <> '' and name <> master_name
               then format('氏名が社員マスタの「%s」と違います。社員番号を確かめてください。', master_name) end),
      (3, case when sheet_status is not null and sheet_status <> 'draft'
               then 'この社員の、実施中の評価期間の評価シートは提出済みのため、取り込めません。' end),
      (4, case when number is null or number not between 1 and max_goals
               then format('目標番号は 1〜%s の数字で入力してください(「%s」)。', max_goals, goal_number)
               when employee_id is not null and line <> first_line
               then format('目標番号 %s が %s行目と重複しています。', number, first_line) end),
      (5, case when challenge_goal !~ '[^[:space:]]' then 'チャレンジ目標が空欄です。' end),
      (8, case when not public.valid_period_goals(period_goals) then '期中目標は0〜4件のタスクと達成状況で指定してください。' end),
      (6, case when first_score !~ '^[1-4]?$'
               then format('一次評価点は 1〜4 の数字か空欄にしてください(「%s」)。', first_score) end),
      (7, case when second_score !~ '^[1-4]?$'
               then format('二次評価点は 1〜4 の数字か空欄にしてください(「%s」)。', second_score)
               when second_score <> '' and no_secondary_evaluator
               then '二次評価者がいない社員のため、二次評価点は入れられません。' end)
    ) as c(ord, message)
    union all
    select 'common', line, ord, message from common_rows cross join lateral (values
      (1, case when employee_no = '' then '社員番号が空欄です。'
               when employee_id is null then format('社員番号「%s」の社員がいません(利用停止中の社員には取り込めません)。', employee_no) end),
      (2, case when employee_id is not null and name <> '' and name <> master_name
               then format('氏名が社員マスタの「%s」と違います。社員番号を確かめてください。', master_name) end),
      (3, case when sheet_status is not null and sheet_status <> 'draft'
               then 'この社員の、実施中の評価期間の評価シートは提出済みのため、取り込めません。' end),
      (4, case when employee_id is not null and item is null
               then format('項目ID「%s」は、この社員の等級の共通評価項目ではありません。', item_id)
               when item is not null and item_title <> '' and item_title <> master_title
               then format('項目名が「%s」と違います。項目IDを確かめてください。', master_title)
               when item is not null and line <> first_line
               then format('項目ID %s が %s行目と重複しています。', item, first_line) end),
      (6, case when first_score !~ '^[1-4]?$'
               then format('一次評価点は 1〜4 の数字か空欄にしてください(「%s」)。', first_score) end),
      (7, case when second_score !~ '^[1-4]?$'
               then format('二次評価点は 1〜4 の数字か空欄にしてください(「%s」)。', second_score)
               when second_score <> '' and no_secondary_evaluator
               then '二次評価者がいない社員のため、二次評価点は入れられません。' end)
    ) as c(ord, message)
  )
  select coalesce(jsonb_agg(jsonb_build_object('file', file, 'line', line, 'message', message)
                            order by file desc, line, ord), '[]')
  into errors from found where message is not null;

  if errors = '[]' and not exists (select 1 from import_goals) and not exists (select 1 from import_common) then
    errors := jsonb_build_array(jsonb_build_object('file', null, 'line', null,
      'message', '取り込む内容がありません。目標か共通評価を1行以上記入してください。'));
  end if;

  select array_agg(distinct employee_id) into goal_ids from import_goals;
  select array_agg(distinct employee_id) into common_ids from import_common;
  select jsonb_build_object(
    'periodName', (select period_name from public.evaluation_periods where id = v_period),
    'employees', count(*),
    'newSheets', count(*) filter (where s.id is null),
    'replacedSheets', count(*) filter (where s.id is not null),
    'goals', (select count(*) from import_goals),
    'commonResults', (select count(*) from import_common))
  into summary
  from (select unnest(goal_ids) union select unnest(common_ids)) as target(employee_id)
  left join public.evaluation_sheets s on s.employee_id = target.employee_id and s.period_id = v_period;

  if errors <> '[]' or not p_apply then
    return jsonb_build_object('errors', errors, 'summary', summary, 'applied', false);
  end if;

  -- 等級と評価者は、シートを作るときのトリガーが社員マスタから入れる
  insert into public.evaluation_sheets (period_id, employee_id)
  select v_period, employee_id from (select unnest(goal_ids) union select unnest(common_ids)) as target(employee_id)
  on conflict (period_id, employee_id) do nothing;

  delete from public.milestones m using public.evaluation_sheets s
  where m.sheet_id = s.id and s.period_id = v_period and s.employee_id = any (goal_ids);
  insert into public.milestones (sheet_id, goal_number, challenge_goal, period_goals, achievement, first_score, second_score)
  select s.id, g.goal_number::integer, g.challenge_goal, g.period_goals, g.achievement,
         coalesce(nullif(g.first_score, '')::integer, 0), coalesce(nullif(g.second_score, '')::integer, 0)
  from import_goals g join public.evaluation_sheets s on s.employee_id = g.employee_id and s.period_id = v_period;

  delete from public.common_evaluation_results r using public.evaluation_sheets s
  where r.sheet_id = s.id and s.period_id = v_period and s.employee_id = any (common_ids);
  insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score, first_comment)
  select s.id, c.item, coalesce(nullif(c.first_score, '')::integer, 0),
         coalesce(nullif(c.second_score, '')::integer, 0), c.comment
  from import_common c join public.evaluation_sheets s on s.employee_id = c.employee_id and s.period_id = v_period;

  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'sheets.imported', v_period, summary);
  return jsonb_build_object('errors', errors, 'summary', summary, 'applied', true);
end;
$$;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('goals_submitted','goals_confirmed','draft','submitted','first_evaluated'));

create or replace function public.next_evaluator_of(sheet public.evaluation_sheets)
returns integer language sql immutable set search_path = '' as $$
  select case sheet.status
    when 'goals_submitted' then sheet.primary_evaluator_id
    when 'goals_confirmed' then sheet.employee_id::integer
    when 'submitted' then sheet.primary_evaluator_id
    when 'first_evaluated' then coalesce(
      sheet.secondary_evaluator_id,
      case when sheet.no_secondary_evaluator then sheet.primary_evaluator_id end)
  end
$$;

create or replace function public.notify_next_evaluator()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  recipient integer := public.next_evaluator_of(new);
begin
  if old.status = new.status then
    -- 評価者が替わった(異動など): 待っている依頼は取り下げ、新しく頼む人に頼み直す
    if recipient is not distinct from public.next_evaluator_of(old) then
      return null;
    end if;
    delete from public.notifications
    where sheet_id = new.id and kind = new.status and read_at is null;
  elsif new.status = 'draft' and old.status = 'goals_submitted' then
    recipient := new.employee_id;
    delete from public.notifications where sheet_id = new.id and kind = old.status and read_at is null;
  else
    -- 前の状態で頼んだことは済んだので、既読にする
    update public.notifications set read_at = now()
    where sheet_id = new.id and kind = old.status and read_at is null;
  end if;

  if recipient is not null
    and (select notification_channel from public.workspace_settings) = 'in_app' then
    insert into public.notifications (recipient_employee_id, sheet_id, kind, employee_name, period_name)
    select recipient, new.id, new.status, subject.name, period.period_name
    from public.employees as subject, public.evaluation_periods as period
    where subject.id = new.employee_id and period.id = new.period_id;
  end if;
  return null;
end;
$$;

create or replace function public.get_sheet_notification(p_sheet_id bigint, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id integer;
  sheet public.evaluation_sheets%rowtype;
  final_evaluator_id integer;
begin
  select id into actor_id from public.employees where user_id = p_actor and is_enabled;
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  final_evaluator_id := case
    when sheet.secondary_evaluator_id is not null then sheet.secondary_evaluator_id
    when sheet.no_secondary_evaluator then sheet.primary_evaluator_id
  end;

  if actor_id is null or sheet.id is null or not coalesce(case sheet.status
    when 'goals_submitted' then actor_id = sheet.employee_id
    when 'goals_confirmed' then actor_id = sheet.primary_evaluator_id and actor_id <> sheet.employee_id
    when 'draft' then actor_id = sheet.primary_evaluator_id and actor_id <> sheet.employee_id
      and exists (select 1 from public.security_audit_log where action = 'sheet.status' and entity_id = sheet.id and details->>'from' = 'goals_submitted' and details->>'to' = 'draft')
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
      from (values ('subject', sheet.employee_id::integer), ('primary', sheet.primary_evaluator_id), ('secondary', sheet.secondary_evaluator_id))
           as recipient(role, employee_id)
      left join public.employees as evaluator on evaluator.id = recipient.employee_id
      left join public.employee_contacts as contact on contact.employee_id = recipient.employee_id
      -- A finalized sheet without a secondary evaluator has nobody to tell in that role.
      where not (sheet.status = 'finalized' and recipient.role = 'secondary' and recipient.employee_id is null)
        and recipient.role = any (case sheet.status
          when 'goals_submitted' then array['primary']
          when 'goals_confirmed' then array['subject']
          when 'draft' then array['subject']
          when 'submitted' then array['primary']
          when 'first_evaluated' then array['secondary']
          else array['primary', 'secondary'] end)
    )
  );
end;
$$;

commit;
