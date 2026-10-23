-- 通知の方法: アプリ内通知(既定)かメールのどちらか一方。
-- Apply after 202610230001.
begin;

alter table public.workspace_settings
  add column if not exists notification_channel text not null default 'in_app',
  -- 保存されている SMTP 設定で送信テストに成功した日時。成功していなければ null。
  add column if not exists smtp_verified_at timestamptz;
alter table public.workspace_settings drop constraint if exists workspace_settings_notification_channel_check;
alter table public.workspace_settings add constraint workspace_settings_notification_channel_check
  check (notification_channel = 'in_app' or (notification_channel = 'email' and smtp_verified_at is not null));

grant select (notification_channel, smtp_verified_at) on public.workspace_settings to authenticated;
grant update (notification_channel) on public.workspace_settings to authenticated;
-- SMTP 設定は、送信テストに成功したときに Edge Function(notify-sheet)だけが保存する。
-- アプリから直接書き換えると、届くか確かめていない設定でメールを選べてしまう。
revoke update (smtp_host, smtp_port, smtp_user, smtp_password) on public.workspace_settings from authenticated;

-- 202610220001 の get_sheet に、通知の方法を足す
create or replace function public.get_sheet(p_sheet_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
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
  if sheet.id is null or me is null
    or not (coalesce(me in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id), false)
            or ((sheet.status = 'finalized' or closed) and public.is_current_evaluator_of(sheet.employee_id::integer)))
  then
    return null;
  end if;

  is_subject := sheet.employee_id = me;
  is_secondary := not is_subject and coalesce(sheet.secondary_evaluator_id = me, false);
  finalized := sheet.status = 'finalized';
  -- An evaluator gets a draft without its content, until its period is closed and it no longer changes.
  sees_content := is_subject or sheet.status <> 'draft' or closed;
  sees_first := sees_content and (finalized or not is_subject);
  sees_second := sees_content and (finalized or is_secondary);

  -- 次の評価者への知らせ方。画面は、通知メールのチェックや再送をメールのときだけ出す
  return public.sheet_document(sheet.id, sees_content, sees_first, sees_second)
    || jsonb_build_object(
      'notificationChannel', (select notification_channel from public.workspace_settings));
end;
$$;

commit;
