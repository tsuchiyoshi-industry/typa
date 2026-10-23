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

commit;
