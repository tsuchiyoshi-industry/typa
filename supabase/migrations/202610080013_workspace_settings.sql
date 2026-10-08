-- Settings that belong to the whole workspace move out of the distributed app into one
-- row: the company email domain and the SMTP account that sends notification mail. They
-- were VITE_* build-time values, so changing the sender address meant rebuilding and
-- redistributing the app, and the SMTP password could be read from the installer.
begin;

create table if not exists public.workspace_settings (
  -- Exactly one row.
  id boolean primary key default true check (id),
  required_domain text not null default '' check (required_domain !~ '[@[:space:]]'),
  smtp_host text not null default '' check (smtp_host !~ '[[:space:]]'),
  smtp_port integer not null default 587 check (smtp_port between 1 and 65535),
  -- The sender address, also the SMTP login.
  smtp_user text not null default '' check (smtp_user !~ '[[:space:]]'),
  smtp_password text not null default '',
  -- Lets the settings screen show whether a password is stored without reading it.
  smtp_password_set boolean generated always as (smtp_password <> '') stored,
  updated_at timestamptz not null default now()
);
comment on table public.workspace_settings
  is 'Single-row workspace settings: the company email domain and the SMTP account for notification mail.';
comment on column public.workspace_settings.required_domain
  is 'Company email domain without "@", e.g. example.jp. Sign-up codes go only to this domain. It is also the domain of the internal Auth address typa-<employee no>@<domain>, so changing it stops every registered employee from signing in.';

-- The domain was a build-time value; the accounts registered so far already carry it.
insert into public.workspace_settings (required_domain)
select coalesce(min(split_part(account.email, '@', 2)), '')
from auth.users as account
where account.email like 'typa-%@%'
on conflict (id) do nothing;

alter table public.workspace_settings enable row level security;
revoke all on public.workspace_settings from public, anon, authenticated;
-- The password is write-only for clients; only get_notification_smtp_settings reads it.
grant select (id, smtp_host, smtp_port, smtp_user, smtp_password_set) on public.workspace_settings to authenticated;
grant update (smtp_host, smtp_port, smtp_user, smtp_password, updated_at) on public.workspace_settings to authenticated;

drop policy if exists "only Admin reads workspace settings" on public.workspace_settings;
create policy "only Admin reads workspace settings"
  on public.workspace_settings for select to authenticated
  using (exists (
    select 1 from public.employees as caller
    join public.roles as caller_role on caller_role.id = caller.role_id
    where caller.user_id = auth.uid() and caller_role.role_name = 'Admin'
  ));

drop policy if exists "only Admin changes workspace settings" on public.workspace_settings;
create policy "only Admin changes workspace settings"
  on public.workspace_settings for update to authenticated
  using (exists (
    select 1 from public.employees as caller
    join public.roles as caller_role on caller_role.id = caller.role_id
    where caller.user_id = auth.uid() and caller_role.role_name = 'Admin'
  ))
  with check (true);

-- The login screen needs the domain before anyone is signed in.
create or replace function public.get_required_domain()
returns text language sql stable security definer set search_path = '' as $$
  select required_domain from public.workspace_settings;
$$;
revoke all on function public.get_required_domain() from public, anon, authenticated;
grant execute on function public.get_required_domain() to anon, authenticated;
comment on function public.get_required_domain()
  is 'Company email domain for the login screen; callable before sign-in.';

-- Mail is sent by the app of the evaluator who confirms a sheet, so the evaluators of a
-- sheet (and only they) read the SMTP account, password included.
create or replace function public.get_notification_smtp_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.evaluation_sheets as sheet
    join public.employees as evaluator
      on evaluator.id in (sheet.primary_evaluator_id, sheet.secondary_evaluator_id)
    where evaluator.user_id = auth.uid()
  ) then
    raise exception 'Notification SMTP settings access denied' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'host', settings.smtp_host, 'port', settings.smtp_port,
      'user', settings.smtp_user, 'password', settings.smtp_password
    )
    from public.workspace_settings as settings
  );
end;
$$;
revoke all on function public.get_notification_smtp_settings() from public, anon, authenticated;
grant execute on function public.get_notification_smtp_settings() to authenticated;
comment on function public.get_notification_smtp_settings()
  is 'SMTP account for notification mail, password included; evaluators of a sheet only.';

commit;
