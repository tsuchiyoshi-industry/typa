-- 前期のチャレンジ目標は、今期も同じ番号へ引き継ぐ。
-- これまでは何も書いていない目標(新しいシートの目標 1)を先に埋めたので、前期の目標 2 を先に据え置くと
-- 今期の目標 1 に入り、後から引き継いだ前期の目標 1 が目標 2 にずれた。
-- 入れる先は、(1) 同じ番号が空いていればそこ (2) 無ければ何も書いていない目標 (3) 無ければ空いている最小の番号。
-- Apply after 202610260002. 過去のマイグレーションは変更しない。
begin;

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

  select max_challenge_goals into max_goals from public.evaluation_settings;
  max_goals := coalesce(max_goals, 4);
  -- 番号 n が使えるのは、その番号の目標が無いか、何も書いていない目標のとき
  select n into target from (
    select n, case when n = source.goal_number then 0
                   when goal.id is not null then 1
                   else 2 end as preference
    from generate_series(1, max_goals) as n
    left join public.milestones as goal on goal.sheet_id = sheet.id and goal.goal_number = n
    where goal.id is null
       or (goal.carried_from_id is null and btrim(coalesce(goal.challenge_goal, '')) = ''
           and goal.period_goals = '[]'::jsonb and goal.achievement = '')
  ) as free
  order by preference, n
  limit 1;
  if target is null then
    raise exception 'チャレンジ目標は % 件までです。引き継ぐ前に、今期の目標を減らしてください。', max_goals
      using errcode = '23514';
  end if;

  update public.milestones set challenge_goal = source.challenge_goal, carried_from_id = source.id
  where sheet_id = sheet.id and goal_number = target;
  if not found then
    insert into public.milestones (sheet_id, goal_number, challenge_goal, carried_from_id)
    values (sheet.id, target, source.challenge_goal, source.id);
  end if;
  return target;
end;
$$;
revoke all on function public.carry_over_goal(bigint, bigint) from public, anon, authenticated;
grant execute on function public.carry_over_goal(bigint, bigint) to authenticated;

commit;
