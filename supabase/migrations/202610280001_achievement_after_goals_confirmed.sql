-- 達成状況は、一次評価者が目標を確定してから(達成状況入力中)だけ本人が書ける。下書き・送信済みの間は書けない。
-- このきまりより前に書かれた達成状況は消さない。残すことと消すことだけでき、書き足し・書き換えはできない。
-- Admin の取り込みや締め後修正は、記録を移す・直すための別の経路(定義者権限の関数)なので対象にしない。
-- Apply after 202610270001.
begin;

-- 目標 1 件に書かれている達成状況(チャレンジ目標の達成状況と、期中目標ごとの達成状況)。空白だけのものは含めない。
create function public.milestone_achievements(goal jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(text) filter (where text ~ '[^[:space:]]'), '{}')
  from (
    select goal->>'achievement' as text
    union all
    select task->>'achievement' from jsonb_array_elements(coalesce(goal->'period_goals', '[]')) as task
  ) as written
$$;
revoke all on function public.milestone_achievements(jsonb) from public, anon, authenticated;
-- 書込みのトリガーは書いた人の権限で動くので、本人が呼べるようにする(読むだけの関数)
grant execute on function public.milestone_achievements(jsonb) to authenticated;

-- 書いた人の権限で動かす(定義者権限では current_user で利用者からの書込みを見分けられない)。
create function public.guard_achievement_before_confirmation()
returns trigger language plpgsql set search_path = '' as $$
declare
  sheet_status text;
  before_confirmation text[];
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  select status into sheet_status from public.evaluation_sheets where id = new.sheet_id;
  if sheet_status not in ('draft', 'goals_submitted') then
    return new;
  end if;
  before_confirmation := case when tg_op = 'UPDATE' then public.milestone_achievements(to_jsonb(old)) else '{}' end;
  if not public.milestone_achievements(to_jsonb(new)) <@ before_confirmation then
    raise exception '達成状況は、一次評価者が目標を確定してから書けます。' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_achievement_before_confirmation() from public, anon, authenticated;
create trigger milestones_guard_achievement_before_confirmation
  before insert or update on public.milestones
  for each row execute function public.guard_achievement_before_confirmation();

commit;
