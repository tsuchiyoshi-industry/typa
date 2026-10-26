-- Admin の特権操作。通常の認可・整合性を保ったまま、この RPC の対象行だけを例外扱いする。
-- トリガーの無効化やクライアントが設定できる GUC を特権の根拠にしない。
begin;

create table public.privileged_sheet_context (
  transaction_id bigint not null,
  sheet_id bigint not null,
  primary key(transaction_id, sheet_id)
);
alter table public.privileged_sheet_context enable row level security;
revoke all on public.privileged_sheet_context from public, anon, authenticated, service_role;

create function public.is_privileged_sheet_operation(p_sheet_id bigint)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists (select 1 from public.privileged_sheet_context
    where transaction_id = txid_current() and sheet_id = p_sheet_id)
$$;
revoke all on function public.is_privileged_sheet_operation(bigint) from public, anon, authenticated, service_role;

create or replace function public.require_active_evaluation_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  privileged_target bigint;
  sheet_ids bigint[];
  period_ids bigint[];
  active_periods integer;
  correcting text := coalesce(current_setting('typa.correcting_sheet', true), '');
begin
  if tg_table_name = 'evaluation_sheets' then
    privileged_target := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    privileged_target := case when tg_op = 'DELETE' then old.sheet_id else new.sheet_id end;
  end if;
  if public.is_privileged_sheet_operation(privileged_target) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'evaluation_sheets' then
    if tg_op <> 'INSERT' then period_ids := period_ids || old.period_id; sheet_ids := sheet_ids || old.id; end if;
    if tg_op <> 'DELETE' then period_ids := period_ids || new.period_id; sheet_ids := sheet_ids || new.id; end if;
  else
    if tg_op <> 'INSERT' then sheet_ids := sheet_ids || old.sheet_id::bigint; end if;
    if tg_op <> 'DELETE' then sheet_ids := sheet_ids || new.sheet_id::bigint; end if;
    select array_agg(sheet.period_id) into period_ids
    from public.evaluation_sheets sheet where sheet.id = any(sheet_ids);
  end if;

  if correcting <> '' and tg_op = 'UPDATE' or correcting <> '' and tg_op = 'INSERT' and tg_table_name <> 'evaluation_sheets' then
    if not exists (select 1 from unnest(sheet_ids) as changed where changed::text <> correcting) then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
  end if;

  select count(*) into active_periods from (
    select 1 from public.evaluation_periods period
    where period.id = any(period_ids) and period.is_active
    for share
  ) locked;
  if active_periods < (select count(distinct changed) from unnest(period_ids) as changed) then
    raise exception '締められた評価期間の評価シートは変更できません。' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
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
  if public.is_privileged_sheet_operation(new.id) then return new; end if;
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
    raise exception 'チャレンジ目標が空欄の目標は送信・確定できません。入力して保存するか、不要なタブを削除してください。% %', E'\n', missing_items using errcode = '23514';
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

create or replace function public.notify_next_evaluator()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  recipient integer := public.next_evaluator_of(new);
begin
  if public.is_privileged_sheet_operation(new.id) then return null; end if;
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

create function public.privileged_sheet_operation(
  p_sheet_id bigint, p_action text, p_status text, p_expected_status text, p_reason text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  sheet public.evaluation_sheets%rowtype;
  reason text := btrim(p_reason);
  snapshot jsonb;
  action_name text;
begin
  if not coalesce(public.current_employee_is_admin(), false) then
    raise exception '特権操作は Admin のみ利用できます。' using errcode = '42501';
  end if;
  if reason is null or char_length(reason) not between 1 and 500 then
    raise exception '操作の理由を 500 文字以内で入力してください。' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('delete', 'changeStatus')
     or (p_action = 'delete' and p_status is not null)
     or (p_action = 'changeStatus' and (p_status is null or p_status not in
       ('draft','goals_submitted','goals_confirmed','submitted','first_evaluated','finalized'))) then
    raise exception '操作または変更後の状態が正しくありません。' using errcode = '22023';
  end if;
  select * into sheet from public.evaluation_sheets where id = p_sheet_id for update;
  if not found then
    raise exception '評価シートが見つかりません。' using errcode = 'P0002';
  end if;
  if sheet.status is distinct from p_expected_status then
    raise exception 'シートの状態が変わりました。再読み込みしてから操作してください。' using errcode = '40001';
  end if;
  if p_action = 'changeStatus' and sheet.status = p_status then
    raise exception '現在とは異なる状態を選んでください。' using errcode = '22023';
  end if;

  -- 認可済みの RPC だけがこの行を作れ、例外を認めるのは同じトランザクションの同じシートだけ。
  insert into public.privileged_sheet_context values (txid_current(), sheet.id);
  if p_action = 'delete' then
    snapshot := jsonb_build_object(
      'sheet', to_jsonb(sheet),
      'goals', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.milestones m where m.sheet_id=sheet.id),'[]'::jsonb),
      'commonResults', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.common_evaluation_results r where r.sheet_id=sheet.id),'[]'::jsonb),
      'corrections', coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.sheet_corrections c where c.sheet_id=sheet.id),'[]'::jsonb)
    );
    -- 遡及処理の履歴も監査ログへ退避してから削除する。その他の子行は FK の CASCADE で削除される。
    delete from public.sheet_corrections where sheet_id=sheet.id;
    delete from public.evaluation_sheets where id=sheet.id;
    action_name := 'sheet.privileged_delete';
  else
    -- 記入した点数・本文・評価者は保ち、確定値を解除する。確定を指定したときは既存トリガーで集計する。
    update public.evaluation_sheets set
      status=p_status, updated_at=now(),
      first_rank=case when p_status='finalized' then public.evaluation_rank(public.sheet_evaluation_score(id,true,
        (select objective_allocation from public.evaluation_settings),(select common_allocation from public.evaluation_settings))) else null end,
      final_rank_letter=null, final_rank_level=null,
      objectives_first_total_score=null, objectives_first_total_rate=null,
      objectives_second_total_score=null, objectives_second_total_rate=null,
      common_evaluation_first_total_score=null, common_evaluation_first_total_rate=null,
      common_evaluation_second_total_score=null, common_evaluation_second_total_rate=null,
      objectives_second_evaluation_score=null, common_evaluation_second_evaluation_score=null,
      total_evaluation_score=null, objective_allocation=null, common_allocation=null
    where id=sheet.id;
    -- 古い依頼を取り下げる。新しいアプリ内通知・メールは作らない。
    delete from public.notifications where sheet_id=sheet.id and read_at is null;
    action_name := 'sheet.privileged_status';
  end if;
  insert into public.security_audit_log(actor_user_id,action,entity_id,details)
  values(auth.uid(),action_name,sheet.id,jsonb_build_object(
    'reason',reason,'actorEmployeeId',public.current_employee_id(),
    'employeeId',sheet.employee_id,'periodId',sheet.period_id,
    'from',sheet.status,'to',p_status,'snapshot',snapshot));
  delete from public.privileged_sheet_context where transaction_id=txid_current() and sheet_id=sheet.id;
end;
$$;
revoke all on function public.privileged_sheet_operation(bigint,text,text,text,text) from public, anon, authenticated;
grant execute on function public.privileged_sheet_operation(bigint,text,text,text,text) to authenticated;

commit;
