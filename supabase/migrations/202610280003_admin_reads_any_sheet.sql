-- Admin は、全社の評価シート一覧から、自分が本人でも評価者でもないシートを開いて読める(読むだけ)。
-- 状態を問わず、目標・一次評価・二次評価・総評をすべて返す。
-- 本人・評価者として関わるシートは、Admin であってもその立場の見え方のまま(自分の確定前の点数は見えない)。
-- テーブルの行ポリシーは広げない。読めるのはこの関数を通したときだけで、変更の経路は増えない。
-- 利用停止中の Admin は current_employee_id() が null になり、ここで断る。
begin;

create or replace function public.get_sheet(p_sheet_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
  is_party boolean;
  is_admin_reader boolean;
  is_subject boolean;
  is_secondary boolean;
  finalized boolean;
  sees_content boolean;
  sees_first boolean;
  sees_second boolean;
  closed boolean;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  select not is_active into closed from public.evaluation_periods where id = sheet.period_id;
  if sheet.id is null or me is null then
    return null;
  end if;
  is_party := coalesce(me in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id), false);
  is_admin_reader := not is_party and public.current_employee_is_admin();
  if not (is_party or is_admin_reader
          or ((sheet.status = 'finalized' or closed) and public.is_current_evaluator_of(sheet.employee_id::integer)))
  then
    return null;
  end if;

  is_subject := sheet.employee_id = me;
  is_secondary := not is_subject and coalesce(sheet.secondary_evaluator_id = me, false);
  finalized := sheet.status = 'finalized';
  -- An evaluator gets a draft without its content, until its period is closed and it no longer changes.
  sees_content := is_subject or sheet.status <> 'draft' or closed or is_admin_reader;
  sees_first := sees_content and (finalized or not is_subject);
  sees_second := sees_content and (finalized or is_secondary or is_admin_reader);

  -- 次の評価者への知らせ方。画面は、通知メールのチェックや再送をメールのときだけ出す
  return public.sheet_document(sheet.id, sees_content, sees_first, sees_second)
    || jsonb_build_object(
      'notificationChannel', (select notification_channel from public.workspace_settings));
end;
$$;
revoke all on function public.get_sheet(bigint) from public, anon, authenticated;
grant execute on function public.get_sheet(bigint) to authenticated;

commit;
