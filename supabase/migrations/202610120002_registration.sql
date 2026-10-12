-- Sign-up is decided by the database, not by the app.
-- Until now the app checked the company domain of the address that receives the code, then
-- created the account and wrote employees.user_id itself. Anyone who called the API directly
-- could skip the code and take any unregistered employee number, and the notification address
-- lived in user metadata, which every user can rewrite.
--
-- New flow (the login id stays the employee number; the mailbox may be shared):
--   1. The app signs in to the mailbox address with the mailed code, as before.
--   2. begin_registration(employee no): only for a session that signed in with a mailed code
--      to an address of the company domain. Records a ticket for that employee, valid for 15
--      minutes, and returns its token. The ticket remembers the mailbox address.
--   3. The app creates the login account typa-<employee no>@<domain> and, signed in as it,
--      calls complete_registration(token). The employee is linked only if the token is the
--      one issued in step 2 and the account is that employee's login address.
-- The mailbox address of the ticket becomes the notification address, in employee_contacts,
-- which no client can read or write.
-- App versions up to 0.9.8 can no longer register (they still sign in and work).
-- Requires 202610120001.
begin;

create table if not exists public.employee_contacts (
  employee_id integer primary key references public.employees(id) on delete cascade,
  email text not null
);
comment on table public.employee_contacts
  is 'Address that receives notification mail for a registered employee: the mailbox verified at sign-up. Read and written only by database functions.';
alter table public.employee_contacts enable row level security;
revoke all on public.employee_contacts from public, anon, authenticated;

-- Accounts registered so far carry the address in user metadata; take it over once.
insert into public.employee_contacts (employee_id, email)
select employee.id, account.raw_user_meta_data ->> 'contact_email'
from public.employees as employee
join auth.users as account on account.id = employee.user_id
where nullif(account.raw_user_meta_data ->> 'contact_email', '') is not null
on conflict (employee_id) do nothing;

create table if not exists public.registration_tickets (
  employee_id integer primary key references public.employees(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  contact_email text not null,
  expires_at timestamptz not null
);
comment on table public.registration_tickets
  is 'A sign-up in progress: who proved a company mailbox for which employee. One per employee; the latest wins.';
alter table public.registration_tickets enable row level security;
revoke all on public.registration_tickets from public, anon, authenticated;

-- The internal Auth address of an employee number. No mail reaches it.
create or replace function public.employee_auth_email(p_employee_no text)
returns text language sql stable security definer set search_path = '' as $$
  select 'typa-' || lower(p_employee_no) || '@' || lower(required_domain)
  from public.workspace_settings where required_domain <> ''
$$;
revoke all on function public.employee_auth_email(text) from public, anon, authenticated;

create or replace function public.begin_registration(p_employee_no text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  domain text;
  caller_email text;
  methods jsonb := coalesce(auth.jwt() -> 'amr', '[]'::jsonb);
  target_id integer;
  target_user_id uuid;
  ticket uuid;
begin
  select lower(required_domain) into domain from public.workspace_settings;
  select lower(account.email) into caller_email
  from auth.users as account where account.id = auth.uid();

  -- The caller must have read a mailbox of the company domain just now: signed in with the
  -- mailed code. A password sign-in proves nothing (accounts are created without
  -- confirmation), and neither does a login address, which has the company domain too.
  if coalesce(domain, '') = ''
    or caller_email is null
    or caller_email like 'typa-%'
    or split_part(caller_email, '@', 2) <> domain
    or not (methods @> '[{"method": "otp"}]' or methods @> '[{"method": "magiclink"}]')
  then
    raise exception '会社のメールアドレスに届いた認証コードでの確認が必要です。' using errcode = '42501';
  end if;

  select id, user_id into target_id, target_user_id
  from public.employees where employee_no = p_employee_no for update;
  if target_id is null then
    return jsonb_build_object('status', 'missing');
  end if;
  if target_user_id is not null then
    return jsonb_build_object('status', 'registered');
  end if;

  insert into public.registration_tickets (employee_id, contact_email, expires_at)
  values (target_id, caller_email, now() + interval '15 minutes')
  on conflict (employee_id) do update
    set token = gen_random_uuid(), contact_email = excluded.contact_email, expires_at = excluded.expires_at
  returning token into ticket;
  return jsonb_build_object('status', 'available', 'token', ticket);
end;
$$;
revoke all on function public.begin_registration(text) from public, anon, authenticated;
grant execute on function public.begin_registration(text) to authenticated;
comment on function public.begin_registration(text)
  is 'Sign-up step 2, for a session that signed in with a code mailed to a company address: returns {status: available, token} for an unregistered employee number, else {status: registered | missing}.';

create or replace function public.complete_registration(p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target_id integer;
  target_no text;
  contact text;
begin
  select employee.id, employee.employee_no, ticket.contact_email
    into target_id, target_no, contact
  from public.registration_tickets as ticket
  join public.employees as employee on employee.id = ticket.employee_id
  where ticket.token = p_token and ticket.expires_at > now() and employee.user_id is null
  for update of employee;

  -- Only the login account of that very employee completes the ticket.
  if target_id is null or not exists (
    select 1 from auth.users as account
    where account.id = auth.uid() and lower(account.email) = public.employee_auth_email(target_no)
  ) then
    return false;
  end if;

  update public.employees set user_id = auth.uid() where id = target_id;
  insert into public.employee_contacts (employee_id, email) values (target_id, contact)
  on conflict (employee_id) do update set email = excluded.email;
  delete from public.registration_tickets where employee_id = target_id;
  return true;
end;
$$;
revoke all on function public.complete_registration(uuid) from public, anon, authenticated;
grant execute on function public.complete_registration(uuid) to authenticated;
comment on function public.complete_registration(uuid)
  is 'Sign-up step 3, called as the new login account: links it to the employee of the ticket. Returns false when the token is unknown or expired, or the account is not that employee''s.';

-- Resetting also clears what a sign-up leaves behind without the link: an account that
-- stopped half way (or a login address somebody else created first), the ticket, the contact.
create or replace function public.reset_employee_registration(p_employee_no text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id integer;
  target_user_id uuid;
  stalled_user_id uuid;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Only Admin can reset an employee registration' using errcode = '42501';
  end if;

  select id, user_id into target_id, target_user_id
  from public.employees where employee_no = p_employee_no for update;
  if target_id is null then
    return false;
  end if;
  -- Resetting yourself would cut off the session that is running this.
  if target_user_id = auth.uid() then
    raise exception 'Admin cannot reset their own registration' using errcode = '42501';
  end if;

  select account.id into stalled_user_id
  from auth.users as account
  where lower(account.email) = public.employee_auth_email(p_employee_no)
    and account.id <> auth.uid();
  -- Not registered and nothing left behind: nothing to reset.
  if target_user_id is null and stalled_user_id is null then
    return false;
  end if;

  update public.employees set user_id = null where id = target_id;
  delete from public.employee_contacts where employee_id = target_id;
  delete from public.registration_tickets where employee_id = target_id;
  delete from auth.users where id in (target_user_id, stalled_user_id);
  return true;
end;
$$;
revoke all on function public.reset_employee_registration(text) from public, anon, authenticated;
grant execute on function public.reset_employee_registration(text) to authenticated;

-- Notification addresses now come from employee_contacts. Same rules and results as
-- 202610080010 / 202610080015 otherwise; the installed app keeps calling these.
create or replace function public.get_submitted_sheet_notification_recipient(p_sheet_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  primary_id integer;
begin
  select sheet.primary_evaluator_id into primary_id
  from public.evaluation_sheets as sheet
  join public.employees as subject on subject.id = sheet.employee_id
  where sheet.id = p_sheet_id
    and sheet.status = 'submitted'
    and subject.user_id = auth.uid();

  if not found then
    raise exception 'Submitted sheet notification access denied' using errcode = '42501';
  end if;

  return (select email from public.employee_contacts where employee_id = primary_id);
end;
$$;
revoke all on function public.get_submitted_sheet_notification_recipient(bigint) from public, anon, authenticated;
grant execute on function public.get_submitted_sheet_notification_recipient(bigint) to authenticated;

create or replace function public.get_first_evaluated_sheet_notification_recipient(p_sheet_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  secondary_id integer;
begin
  select sheet.secondary_evaluator_id into secondary_id
  from public.evaluation_sheets as sheet
  join public.employees as evaluator on evaluator.id = sheet.primary_evaluator_id
  where sheet.id = p_sheet_id
    and sheet.status = 'first_evaluated'
    and evaluator.user_id = auth.uid()
    and evaluator.id <> sheet.employee_id;

  if not found then
    raise exception 'First-evaluated sheet notification access denied' using errcode = '42501';
  end if;

  return (select email from public.employee_contacts where employee_id = secondary_id);
end;
$$;
revoke all on function public.get_first_evaluated_sheet_notification_recipient(bigint) from public, anon, authenticated;
grant execute on function public.get_first_evaluated_sheet_notification_recipient(bigint) to authenticated;

create or replace function public.get_finalized_sheet_notification_recipients(p_sheet_id bigint)
returns table (role text, employee_id integer, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_id integer;
  secondary_id integer;
begin
  select sheet.primary_evaluator_id, sheet.secondary_evaluator_id
    into primary_id, secondary_id
  from public.evaluation_sheets as sheet
  join public.employees as evaluator
    on evaluator.id = case
         when sheet.secondary_evaluator_id is not null then sheet.secondary_evaluator_id
         when sheet.no_secondary_evaluator then sheet.primary_evaluator_id
       end
  where sheet.id = p_sheet_id
    and sheet.status = 'finalized'
    and evaluator.user_id = auth.uid()
    and evaluator.id <> sheet.employee_id;

  if not found then
    raise exception 'Finalized sheet notification access denied' using errcode = '42501';
  end if;

  return query
  select recipients.role, recipients.employee_id, contact.email
  from (values ('primary'::text, primary_id), ('secondary'::text, secondary_id))
       as recipients(role, employee_id)
  left join public.employee_contacts as contact on contact.employee_id = recipients.employee_id;
end;
$$;
revoke all on function public.get_finalized_sheet_notification_recipients(bigint) from public, anon, authenticated;
grant execute on function public.get_finalized_sheet_notification_recipients(bigint) to authenticated;

-- Optional, and recommended: stop accounts from being created at all unless they belong to
-- a sign-up. Turn it on in the dashboard (Authentication > Hooks > Before User Created >
-- Postgres function public.hook_before_user_created). With it, Auth creates
--   * an account for a mailbox of the company domain (the address that receives the code);
--   * a login account typa-<employee no>@<domain> only while that employee has a ticket.
-- Everything else is refused, so outsiders cannot fill auth.users or take a login address.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  domain text;
begin
  select lower(required_domain) into domain from public.workspace_settings;
  if coalesce(domain, '') <> '' and split_part(email, '@', 2) = domain and (
    email not like 'typa-%'
    or exists (
      select 1
      from public.registration_tickets as ticket
      join public.employees as employee on employee.id = ticket.employee_id
      where ticket.expires_at > now() and employee.user_id is null
        and email = public.employee_auth_email(employee.employee_no)
    )
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'このメールアドレスでは登録できません。'));
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
  end if;
end;
$$;

commit;
