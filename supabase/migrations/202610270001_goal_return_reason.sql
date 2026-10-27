-- 目標の差し戻しには理由を添える。理由は本人のシートと通知メールに出し、下書きを離れると消える。
-- Apply after 202610260003.
begin;

alter table public.evaluation_sheets add column goal_return_reason text
  check (char_length(goal_return_reason) between 1 and 200);

-- 状態を直接書き換えても、理由のない差し戻しはできない。Admin の特権操作だけは理由を問わない(操作自体の理由を残す)。
create function public.settle_goal_return_reason()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'draft' then
    new.goal_return_reason := null;
  elsif old.status = 'goals_submitted' and new.goal_return_reason is null
    and not public.is_privileged_sheet_operation(new.id) then
    raise exception '差し戻しの理由を入力してください。' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.settle_goal_return_reason() from public, anon, authenticated;
-- 列の書込権限を見る access_guard の後に動くよう、名前の順を後ろにする
create trigger evaluation_sheets_settle_goal_return_reason
  before update of status on public.evaluation_sheets
  for each row execute function public.settle_goal_return_reason();

drop function public.transition_evaluation_sheet(bigint, text);
create function public.transition_evaluation_sheet(p_sheet_id bigint, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.evaluation_sheets%rowtype;
  me integer := public.current_employee_id();
  reason text := nullif(btrim(p_reason, E' \t\r\n　'), '');
begin
  select * into s from public.evaluation_sheets where id = p_sheet_id for update;
  if me is null or s.id is null then raise exception 'ログインが必要です。' using errcode = '42501'; end if;
  if not public.can_transition_sheet(s, p_status, me) then
    raise exception 'この評価シートの状態を変更する権限がありません。' using errcode = '42501';
  end if;
  if p_status = 'draft' and (reason is null or char_length(reason) > 200) then
    raise exception '差し戻しの理由を 200 文字以内で入力してください。' using errcode = '22023';
  end if;
  update public.evaluation_sheets
  set status = p_status, goal_return_reason = case when p_status = 'draft' then reason end, updated_at = now()
  where id = p_sheet_id;
  -- 下書きに戻すと評価者は本文を閲覧できなくなる。成功のみ返す。
  if p_status = 'draft' then return null; end if;
  return public.get_sheet(p_sheet_id);
end;
$$;
revoke all on function public.transition_evaluation_sheet(bigint, text, text) from public, anon, authenticated;
grant execute on function public.transition_evaluation_sheet(bigint, text, text) to authenticated;

-- シート本文と通知メールのデータに理由を足す。関数の他の部分は変えない。
do $migration$
declare
  definition text;
  anchor text;
begin
  definition := pg_catalog.pg_get_functiondef('public.sheet_document(bigint,boolean,boolean,boolean)'::regprocedure);
  anchor := $a$'id', sheet.id, 'status', sheet.status, 'gradeId', sheet.grade_id,$a$;
  if position(anchor in definition) = 0 then
    raise exception 'Unexpected sheet_document definition.';
  end if;
  execute replace(definition, anchor,
    anchor || $a$ 'goalReturnReason', case when sees_content then sheet.goal_return_reason end,$a$);

  definition := pg_catalog.pg_get_functiondef('public.get_sheet_notification(bigint,uuid)'::regprocedure);
  anchor := $a$'sheetId', sheet.id,$a$;
  if position(anchor in definition) = 0 then
    raise exception 'Unexpected get_sheet_notification definition.';
  end if;
  execute replace(definition, anchor, anchor || $a$ 'returnReason', coalesce(sheet.goal_return_reason, ''),$a$);
end;
$migration$;

commit;
