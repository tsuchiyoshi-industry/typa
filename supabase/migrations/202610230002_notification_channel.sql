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

grant select (notification_channel) on public.workspace_settings to authenticated;
grant update (notification_channel) on public.workspace_settings to authenticated;

commit;
