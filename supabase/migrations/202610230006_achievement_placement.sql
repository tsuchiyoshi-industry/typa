-- 達成状況の置き場所を1つにする。期中目標があればタスクごと、無ければチャレンジ目標の achievement。
-- アプリの Milestone と同じ決まり。Apply after 202610230005. 過去のマイグレーションは変更しない。
begin;

-- 両方に書かれた行は、チャレンジ目標側の達成状況を最初のタスクへ足す。どちらも切り捨てない。
alter table public.milestones disable trigger user;
update public.milestones
set period_goals = jsonb_set(period_goals, '{0,achievement}',
      to_jsonb(concat_ws(E'\n', nullif(period_goals->0->>'achievement', ''), achievement))),
    achievement = ''
where jsonb_array_length(period_goals) > 0 and achievement <> '';
alter table public.milestones enable trigger user;

-- 締め後修正は項目ごとに UPDATE するので、検査はコミット時に、その時点の行で行う。
create or replace function public.check_milestone_achievement_placement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.milestones m
             where m.id = new.id and jsonb_array_length(m.period_goals) > 0 and m.achievement <> '') then
    raise exception '期中目標があるときは、達成状況を期中目標ごとに記入してください。' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function public.check_milestone_achievement_placement() from public, anon, authenticated;

create constraint trigger milestones_achievement_placement
after insert or update of period_goals, achievement on public.milestones
deferrable initially deferred
for each row execute function public.check_milestone_achievement_placement();

commit;
