begin;

-- 評価期間の「締める」と「開始する」を分ける。
-- これまでは activate_evaluation_period が、次の評価期間を開始するのと同時に、実施中の評価期間を締めていた。
-- これからは close_evaluation_period で締め、次の評価期間は準備中になる(自動では始まらない)。
-- 管理者は準備中の間に等級の変更などを済ませ、activate_evaluation_period で準備中の評価期間を開始する。
-- 準備中は保存しない(アプリの EvaluationCalendar と、下の preparing_evaluation_period が同じ決まりで決める)。
-- 締めと開始は Admin だけの操作で、どちらも security_audit_log に記録する(記録できなければ操作ごと取り消す)。

-- 準備中の評価期間: 実施中の評価期間が無いとき、まだ始めていない評価期間のうち最も早く始まるもの
-- (同じ日なら id の小さいもの)。実施中の評価期間がある間と、開始できる評価期間が無いときは null。
create or replace function public.preparing_evaluation_period()
returns bigint language sql stable security definer set search_path = '' as $$
  select period.id
  from public.evaluation_periods as period
  where not exists (select 1 from public.evaluation_periods as active where active.is_active)
    and not period.is_active and period.closed_at is null
  order by period.start_date, period.id
  limit 1;
$$;
revoke all on function public.preparing_evaluation_period() from public, anon, authenticated;

-- 実施中の評価期間を締める。次の評価期間は開始しない。
-- p_period_id は画面で見ていた実施中の評価期間。もう実施中でなければ(別の Admin が先に締めたなど)断る。
create or replace function public.close_evaluation_period(p_period_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  period public.evaluation_periods%rowtype;
  finalized integer;
  unfinished integer;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Only Admin can close an evaluation period' using errcode = '42501';
  end if;

  -- 締めと開始が同時に走っても入り混じらないよう、すべての評価期間を先に押さえる
  perform 1 from public.evaluation_periods order by id for update;
  select * into period from public.evaluation_periods where id = p_period_id;
  if not found then
    return false;
  end if;
  if not period.is_active then
    raise exception 'この評価期間は実施中ではないため、締められません。画面を開き直してください。'
      using errcode = '40001';
  end if;

  select count(*) filter (where sheet.status = 'finalized'),
         count(*) filter (where sheet.status <> 'finalized')
    into finalized, unfinished
  from public.evaluation_sheets as sheet where sheet.period_id = period.id;
  if unfinished > 0 and not period.allow_unfinalized_close then
    raise exception '未確定の評価シートが残っているため、評価期間を締められません。' using errcode = '23514';
  end if;

  update public.evaluation_periods set is_active = false, closed_at = now() where id = period.id;
  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'period.closed', period.id, jsonb_build_object(
    'periodName', period.period_name,
    'finalizedSheets', finalized,
    'unfinishedSheets', unfinished,
    'allowUnfinalizedClose', period.allow_unfinalized_close,
    'preparingPeriodId', public.preparing_evaluation_period()));
  return true;
end;
$$;
revoke all on function public.close_evaluation_period(bigint) from public, anon, authenticated;
grant execute on function public.close_evaluation_period(bigint) to authenticated;
comment on function public.close_evaluation_period(bigint) is
  '実施中の評価期間を締める(Admin のみ)。次の評価期間は準備中になり、自動では始まらない。';

-- 準備中の評価期間を開始する。実施中の評価期間がある間は開始しない(先に close_evaluation_period で締める)。
-- 名前はこれまでと同じだが、もう実施中の評価期間を締めない(古いアプリから呼んでも、締めずに断る)。
create or replace function public.activate_evaluation_period(p_period_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  period public.evaluation_periods%rowtype;
  active_name text;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Only Admin can start an evaluation period' using errcode = '42501';
  end if;

  perform 1 from public.evaluation_periods order by id for update;
  select * into period from public.evaluation_periods where id = p_period_id;
  if not found then
    return false;
  end if;
  if period.closed_at is not null then
    raise exception '締めた評価期間は、もう一度開始できません。' using errcode = '23514';
  end if;
  -- 実施中の評価期間を指定し直すだけなら、何も変えない
  if period.is_active then
    return true;
  end if;
  select active.period_name into active_name from public.evaluation_periods as active where active.is_active;
  if found then
    raise exception '「%」を締めてから、次の評価期間を開始してください。', active_name using errcode = '23514';
  end if;
  if period.id is distinct from public.preparing_evaluation_period() then
    raise exception '次に開始できるのは、準備中の評価期間だけです。' using errcode = '23514';
  end if;

  update public.evaluation_periods set is_active = true where id = period.id;
  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'period.started', period.id, jsonb_build_object('periodName', period.period_name));
  return true;
end;
$$;
revoke all on function public.activate_evaluation_period(bigint) from public, anon, authenticated;
grant execute on function public.activate_evaluation_period(bigint) to authenticated;
comment on function public.activate_evaluation_period(bigint) is
  '準備中の評価期間を開始する(Admin のみ)。実施中の評価期間がある間は開始しない。';

comment on column public.evaluation_periods.closed_at is
  '締めた日時。null なら未開始・準備中・実施中。close_evaluation_period だけが入れる。';

commit;
