-- チャレンジ目標は期をまたいで続き、期中目標はその期の計画として毎期書き直す。
--   * 本人は前期のチャレンジ目標を、今期の下書きへ据え置く・見直して引き継げる(carry_over_goal)。
--     写すのは文言だけ。つながりは milestones.carried_from_id(202610220001 の列)に残る。
--   * 達成状況は一次評価を依頼するまで自由に書き直せる。目標の確認中(goals_submitted)も書ける。
-- Apply after 202610230006. 過去のマイグレーションは変更しない。
begin;

-- 1. 達成状況を、目標の確認中も書けるようにする ------------------------------------------------
create or replace function public.lock_sheet_content_write()
returns trigger language plpgsql set search_path='' as $$
declare s jsonb; target bigint; me integer; allowed text[]; writes_achievement boolean;
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
      writes_achievement := me=(s->>'employee_id')::integer and s->>'status' in ('goals_submitted','goals_confirmed');
      allowed := case
        when me=(s->>'employee_id')::integer and s->>'status'='draft' then array['goal_number','challenge_goal','period_goals','achievement']
        when writes_achievement then array['period_goals','achievement']
        when me<>(s->>'employee_id')::integer and me=(s->>'primary_evaluator_id')::integer and s->>'status'='submitted' then array['first_score']
        when me<>(s->>'employee_id')::integer and me=(s->>'secondary_evaluator_id')::integer and s->>'status'='first_evaluated' then array['second_score']
        else '{}'::text[] end;
      if tg_op='UPDATE' and writes_achievement
        and not public.goal_achievement_only(to_jsonb(old),to_jsonb(new)) then
        raise exception '目標の送信後は達成状況だけを編集できます。' using errcode='42501';
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
  if access in ('subject:goals_submitted', 'subject:goals_confirmed')
     and not public.goal_achievement_only(to_jsonb(old), to_jsonb(new)) then
    raise exception '目標の送信後は達成状況だけを編集できます。' using errcode = '42501';
  end if;
  if not public.changed_columns(to_jsonb(old), to_jsonb(new)) <@ (case access
    when 'subject:draft' then array['goal_number', 'challenge_goal', 'period_goals', 'achievement']
    when 'subject:goals_submitted' then array['period_goals', 'achievement']
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
  using (public.sheet_access(sheet_id) in ('subject:draft','subject:goals_submitted','subject:goals_confirmed','first','second'))
  with check (public.sheet_access(sheet_id) in ('subject:draft','subject:goals_submitted','subject:goals_confirmed','first','second'));

-- 2. 前期の目標と、今期のどの目標へ引き継いだか ------------------------------------------------
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
        'periodGoals', goal.period_goals, 'achievement', goal.achievement,
        'carriedInto', (select carried.goal_number from public.milestones as carried
                        where carried.sheet_id = sheet.id and carried.carried_from_id = goal.id)
      ) order by goal.goal_number, goal.id)
      from public.milestones as goal where goal.sheet_id = previous.id
    ), '[]'::jsonb));
end;
$$;

-- 3. 前期のチャレンジ目標を据え置く・見直して引き継ぐ -------------------------------------------
-- 本人の下書きだけ。写すのはチャレンジ目標の文言だけで、期中目標と達成状況は空のまま。
-- 何も書いていない目標があればそこへ、無ければ空いているいちばん小さい番号に入れ、その番号を返す。
create or replace function public.carry_over_goal(p_sheet_id bigint, p_goal_id bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
  source public.milestones%rowtype;
  max_goals integer;
  target integer;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id for update;
  if sheet.id is null or me is null or sheet.employee_id <> me or sheet.status <> 'draft'
     or not exists (select 1 from public.evaluation_periods where id = sheet.period_id and is_active) then
    raise exception '前期の目標を引き継げるのは、本人の下書きの評価シートだけです。' using errcode = '42501';
  end if;
  select * into source from public.milestones
  where id = p_goal_id and sheet_id = public.previous_evaluation_sheet(sheet.id);
  if not found then
    raise exception '前期の目標が見つかりません。' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.milestones where sheet_id = sheet.id and carried_from_id = source.id) then
    raise exception 'この目標はすでに引き継いでいます。' using errcode = '23505';
  end if;

  select min(goal_number) into target from public.milestones
  where sheet_id = sheet.id and carried_from_id is null and btrim(coalesce(challenge_goal, '')) = ''
    and period_goals = '[]'::jsonb and achievement = '';
  if target is not null then
    update public.milestones set challenge_goal = source.challenge_goal, carried_from_id = source.id
    where sheet_id = sheet.id and goal_number = target;
    return target;
  end if;

  select max_challenge_goals into max_goals from public.evaluation_settings;
  select min(n) into target from generate_series(1, coalesce(max_goals, 4)) as n
  where not exists (select 1 from public.milestones where sheet_id = sheet.id and goal_number = n);
  if target is null then
    raise exception 'チャレンジ目標は % 件までです。引き継ぐ前に、今期の目標を減らしてください。', max_goals
      using errcode = '23514';
  end if;
  insert into public.milestones (sheet_id, goal_number, challenge_goal, carried_from_id)
  values (sheet.id, target, source.challenge_goal, source.id);
  return target;
end;
$$;
revoke all on function public.carry_over_goal(bigint, bigint) from public, anon, authenticated;
grant execute on function public.carry_over_goal(bigint, bigint) to authenticated;

commit;
