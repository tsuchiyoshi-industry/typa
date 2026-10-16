-- Release hardening. Keep shared mailboxes and employee-number logins, but require a
-- separate, single-use invitation for each employee. Existing accounts need no invitation.
-- Apply after 202610130001. Deploy the matching app with this migration.
begin;

alter table public.employees add column is_enabled boolean not null default true;
comment on column public.employees.is_enabled is 'Admin-controlled access suspension. Keeps accounts and evaluation history; disabled employees cannot use API or register.';

create table public.employee_invitations (
  employee_id integer primary key references public.employees(id),
  code_hash text not null,
  expires_at timestamptz not null,
  issued_by integer references public.employees(id)
);
alter table public.employee_invitations enable row level security;
revoke all on public.employee_invitations from public, anon, authenticated;
alter table public.registration_tickets add column invitation_hash text;
-- Old tickets proved only a company mailbox, not the employee's identity.
delete from public.registration_tickets;

create or replace function public.current_employee_id()
returns integer language sql stable security definer set search_path = '' as $$
  select id from public.employees where user_id = auth.uid() and is_enabled
$$;
create or replace function public.current_employee_role()
returns text language sql stable security definer set search_path = '' as $$
  select r.role_name from public.employees e join public.roles r on r.id = e.role_id
  where e.id = public.current_employee_id()
$$;
create or replace function public.current_employee_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_employee_role() = 'Admin', false)
$$;

-- Every administrative account operation uses the same lock order. Count usable
-- accounts, not merely rows bearing the Admin role, including when operations race.
create function public.lock_employee_administration()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  perform 1 from public.employees order by id for update;
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.lock_employee_administration() from public, anon, authenticated;

create function public.require_another_usable_admin(p_employee_id integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.employees e join public.roles r on r.id=e.role_id
             where e.id=p_employee_id and e.is_enabled and e.user_id is not null and r.role_name='Admin')
     and not exists (select 1 from public.employees e join public.roles r on r.id=e.role_id
                     join auth.users u on u.id=e.user_id
                     where e.id<>p_employee_id and e.is_enabled and r.role_name='Admin') then
    raise exception '利用できる Admin を最低1名残してください。' using errcode = '23514';
  end if;
end;
$$;
revoke all on function public.require_another_usable_admin(integer) from public, anon, authenticated;

create or replace function public.set_employee_role(p_employee_no text, p_role_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_id integer; new_role integer;
begin
  perform public.lock_employee_administration();
  select id into target_id from public.employees where employee_no=p_employee_no;
  if target_id is null then return false; end if;
  select id into new_role from public.roles where role_name=p_role_name;
  if new_role is null then raise exception 'Unknown role' using errcode='22023'; end if;
  if p_role_name <> 'Admin' then perform public.require_another_usable_admin(target_id); end if;
  update public.employees set role_id=new_role where id=target_id;
  return true;
end;
$$;

create function public.set_employee_enabled(p_employee_no text, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_id integer;
begin
  perform public.lock_employee_administration();
  if p_enabled is null then raise exception '利用状態を指定してください。' using errcode='22023'; end if;
  select id into target_id from public.employees where employee_no=p_employee_no;
  if target_id is null then return false; end if;
  if not p_enabled then perform public.require_another_usable_admin(target_id); end if;
  update public.employees set is_enabled=p_enabled, keep_signed_in=false where id=target_id;
  if not p_enabled then
    delete from public.registration_tickets where employee_id=target_id;
    delete from public.employee_invitations where employee_id=target_id;
  end if;
  return true;
end;
$$;
revoke all on function public.set_employee_enabled(text, boolean) from public, anon, authenticated;
grant execute on function public.set_employee_enabled(text, boolean) to authenticated;

create or replace function public.reset_employee_registration(p_employee_no text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_id integer; linked uuid; stalled uuid;
begin
  perform public.lock_employee_administration();
  select id,user_id into target_id,linked from public.employees where employee_no=p_employee_no;
  if target_id is null then return false; end if;
  if linked=auth.uid() then raise exception '自分の登録は取り消せません。' using errcode='42501'; end if;
  perform public.require_another_usable_admin(target_id);
  select id into stalled from auth.users where lower(email)=public.employee_auth_email(p_employee_no);
  delete from public.registration_tickets where employee_id=target_id;
  delete from public.employee_invitations where employee_id=target_id;
  delete from public.employee_contacts where employee_id=target_id;
  update public.employees set user_id=null, keep_signed_in=false where id=target_id;
  delete from auth.users where id in (linked,stalled);
  return linked is not null or stalled is not null;
end;
$$;

create function public.issue_employee_invitation(p_employee_no text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.employees%rowtype; code text; expiry timestamptz := now()+interval '7 days';
begin
  perform public.lock_employee_administration();
  select * into target from public.employees where employee_no=p_employee_no;
  if target.id is null or not target.is_enabled or target.user_id is not null then
    raise exception '利用中・未登録の社員にだけ招待コードを発行できます。' using errcode='23514';
  end if;
  code := upper(replace(gen_random_uuid()::text,'-',''));
  delete from public.registration_tickets where employee_id=target.id;
  -- A stalled/hostile pre-created internal account must not squat on this login id.
  delete from auth.users u where lower(u.email)=public.employee_auth_email(target.employee_no)
    and not exists (select 1 from public.employees e where e.user_id=u.id);
  insert into public.employee_invitations(employee_id,code_hash,expires_at,issued_by)
  values(target.id,encode(sha256(convert_to(code,'UTF8')),'hex'),expiry,public.current_employee_id())
  on conflict(employee_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,issued_by=excluded.issued_by;
  insert into public.security_audit_log(actor_user_id,action,entity_id) values(auth.uid(),'employee.invited',target.id);
  return jsonb_build_object('code',code,'expiresAt',expiry);
end;
$$;
revoke all on function public.issue_employee_invitation(text) from public, anon, authenticated;
grant execute on function public.issue_employee_invitation(text) to authenticated;

-- Remove the old one-argument API: old clients cannot bypass invitations.
drop function public.begin_registration(text);
create function public.begin_registration(p_employee_no text, p_invitation_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare domain text; caller_email text; target public.employees%rowtype; invitation public.employee_invitations%rowtype; ticket uuid;
begin
  select lower(required_domain) into domain from public.workspace_settings;
  select lower(email) into caller_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if coalesce(domain,'')='' or caller_email is null or caller_email like 'typa-%'
     or split_part(caller_email,'@',2)<>domain
     or not exists (select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) method
                    where method->>'method' in ('otp','magiclink')
                      and (method->>'timestamp')::numeric >= extract(epoch from now())-900) then
    raise exception '会社メールに届いた認証コードをもう一度確認してください。' using errcode='42501';
  end if;
  select * into target from public.employees where employee_no=p_employee_no for update;
  select * into invitation from public.employee_invitations where employee_id=target.id for update;
  if target.id is null or not target.is_enabled or target.user_id is not null
     or invitation.employee_id is null or invitation.expires_at<=now()
     or invitation.code_hash is distinct from encode(sha256(convert_to(upper(replace(trim(coalesce(p_invitation_code,'')),'-','')),'UTF8')),'hex') then
    return jsonb_build_object('status','invalid_invitation');
  end if;
  insert into public.registration_tickets(employee_id,contact_email,expires_at,invitation_hash)
  values(target.id,caller_email,least(now()+interval '15 minutes',invitation.expires_at),invitation.code_hash)
  on conflict(employee_id) do update set token=gen_random_uuid(),contact_email=excluded.contact_email,
    expires_at=excluded.expires_at,invitation_hash=excluded.invitation_hash returning token into ticket;
  return jsonb_build_object('status','available','token',ticket);
end;
$$;
revoke all on function public.begin_registration(text,text) from public, anon, authenticated;
grant execute on function public.begin_registration(text,text) to authenticated;

create or replace function public.complete_registration(p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_id integer; target_no text; contact text;
begin
  select e.id,e.employee_no,t.contact_email into target_id,target_no,contact
  from public.employees e join public.registration_tickets t on t.employee_id=e.id
  join public.employee_invitations i on i.employee_id=e.id and i.code_hash=t.invitation_hash
  where t.token=p_token and t.expires_at>now() and i.expires_at>now() and e.is_enabled and e.user_id is null
  for update of e,t,i;
  if target_id is null or not exists(select 1 from auth.users where id=auth.uid() and lower(email)=public.employee_auth_email(target_no)) then
    return false;
  end if;
  update public.employees set user_id=auth.uid() where id=target_id;
  insert into public.employee_contacts(employee_id,email) values(target_id,contact)
  on conflict(employee_id) do update set email=excluded.email;
  delete from public.registration_tickets where employee_id=target_id;
  delete from public.employee_invitations where employee_id=target_id;
  return true;
end;
$$;

drop policy "Admin and Reviewer maintain the employee master" on public.employees;
create policy "Admin maintains the employee master" on public.employees for update to authenticated
  using(public.current_employee_is_admin()) with check(public.current_employee_is_admin());

-- A suspended user's old JWT may still be cryptographically valid. Deny it at the DB
-- boundary on every table, rather than relying on refresh or application cache expiry.
do $$ declare tab text;
begin
  foreach tab in array array['employees','evaluation_sheets','milestones','common_evaluation_results',
    'evaluation_settings','workspace_settings','roles','employee_grades','common_evaluation_items','evaluation_periods'] loop
    execute format('create policy "enabled employee required" on public.%I as restrictive for all to authenticated using (public.current_employee_id() is not null) with check (public.current_employee_id() is not null)',tab);
  end loop;
end;
$$;

-- Auditing excludes passwords, addresses, invite hashes and tokens.
create table public.security_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  action text not null,
  entity_id bigint,
  details jsonb not null default '{}'::jsonb
);
alter table public.security_audit_log enable row level security;
revoke all on public.security_audit_log from public,anon,authenticated;
grant select on public.security_audit_log to authenticated;
create policy "Admin reads audit log" on public.security_audit_log for select to authenticated using(public.current_employee_is_admin());
create function public.audit_employee_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare before jsonb; after jsonb;
begin
  before := to_jsonb(old)-array['user_id']; after := to_jsonb(new)-array['user_id'];
  if before is distinct from after or old.user_id is distinct from new.user_id then
    insert into public.security_audit_log(actor_user_id,action,entity_id,details)
    values(auth.uid(),'employee.updated',new.id,jsonb_build_object('changedFields',public.changed_columns(to_jsonb(old),to_jsonb(new)),
      'before',before,'after',after));
  end if;
  return null;
end;
$$;
revoke all on function public.audit_employee_change() from public,anon,authenticated;
create trigger employees_audit after update on public.employees for each row execute function public.audit_employee_change();

-- Older security-definer projections must honor suspension as well.
create or replace function public.get_reviewer_workspace(p_period_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller_id integer;
  result jsonb;
begin
  caller_id := public.current_employee_id();
  if caller_id is null then
    raise exception 'ログインが必要です。' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeId', e.id, 'employeeName', e.name, 'employeeNo', e.employee_no,
    'gradeId', g.id, 'gradeName', coalesce(g.grade_name, '等級未設定'),
    'careerCourse', coalesce(e.career_course, ''), 'primaryEvaluator', coalesce(pr.name, '未設定'),
    'primaryEvaluatorId', ev.primary_id,
    'isPrimary', ev.primary_id is not distinct from caller_id,
    'canViewSecond', ev.secondary_id is not distinct from caller_id,
    'canViewFinal', coalesce(ev.secondary_id = caller_id or (ev.primary_id = caller_id and ev.no_secondary), false),
    'primaryIsFinal', ev.secondary_id is null and ev.no_secondary,
    'sheetId', s.id, 'status', coalesce(s.status, 'missing'), 'updatedAt', s.updated_at,
    'objectiveAllocation', coalesce(case when s.status = 'finalized' then s.objective_allocation end, settings.objective_allocation),
    'commonAllocation', coalesce(case when s.status = 'finalized' then s.common_allocation end, settings.common_allocation),
    'firstOverallComment', coalesce(snapshot.value->>'firstOverallComment', ''),
    'secondOverallComment', snapshot.value->'secondOverallComment',
    'firstRank', snapshot.value->'firstRank',
    'finalRank', snapshot.value->'finalRank', 'finalScore', snapshot.value->'finalScore',
    'objectives', coalesce(snapshot.value->'objectives', '[]'::jsonb),
    'commonItems', coalesce(snapshot.value->'commonItems', '[]'::jsonb)
  ) order by e.employee_no), '[]'::jsonb) into result
  from public.employees e
  cross join public.evaluation_settings settings
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = p_period_id
  cross join lateral (select
    case when s.id is null then e.primary_evaluator_id else s.primary_evaluator_id end as primary_id,
    case when s.id is null then e.secondary_evaluator_id else s.secondary_evaluator_id end as secondary_id,
    case when s.id is null then e.no_secondary_evaluator else s.no_secondary_evaluator end as no_secondary
  ) ev
  left join public.employees pr on pr.id = ev.primary_id
  left join public.employee_grades g on g.id = case when s.id is null then e.grade_id else s.grade_id end
  left join lateral (select public.reviewer_sheet_snapshot(s.id,
    case when ev.secondary_id = caller_id then 'secondary' else 'primary' end) as value) snapshot on true
  where e.id <> caller_id and (ev.primary_id = caller_id or ev.secondary_id = caller_id);
  return result;
end;
$$;

create or replace function public.get_sheet_notification(p_sheet_id bigint, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id integer;
  sheet public.evaluation_sheets%rowtype;
  final_evaluator_id integer;
begin
  select id into actor_id from public.employees where user_id = p_actor and is_enabled;
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  final_evaluator_id := case
    when sheet.secondary_evaluator_id is not null then sheet.secondary_evaluator_id
    when sheet.no_secondary_evaluator then sheet.primary_evaluator_id
  end;

  if actor_id is null or sheet.id is null or not coalesce(case sheet.status
    when 'submitted' then actor_id = sheet.employee_id
    when 'first_evaluated' then actor_id = sheet.primary_evaluator_id and actor_id <> sheet.employee_id
    when 'finalized' then actor_id = final_evaluator_id and actor_id <> sheet.employee_id
  end, false) then
    raise exception 'Sheet notification access denied' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'status', sheet.status,
    'sheetId', sheet.id,
    'employeeName', (select name from public.employees where id = sheet.employee_id),
    'employeeNo', (select employee_no from public.employees where id = sheet.employee_id),
    'periodName', (select period_name from public.evaluation_periods where id = sheet.period_id),
    'recipients', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', recipient.role, 'name', coalesce(evaluator.name, '未設定'), 'email', contact.email
      ) order by recipient.role), '[]'::jsonb)
      from (values ('primary', sheet.primary_evaluator_id), ('secondary', sheet.secondary_evaluator_id))
           as recipient(role, employee_id)
      left join public.employees as evaluator on evaluator.id = recipient.employee_id
      left join public.employee_contacts as contact on contact.employee_id = recipient.employee_id
      -- A finalized sheet without a secondary evaluator has nobody to tell in that role.
      where not (sheet.status = 'finalized' and recipient.role = 'secondary' and recipient.employee_id is null)
        and recipient.role = any (case sheet.status
          when 'submitted' then array['primary']
          when 'first_evaluated' then array['secondary']
          else array['primary', 'secondary'] end)
    )
  );
end;
$$;

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
      where ticket.expires_at > now() and employee.user_id is null and employee.is_enabled
        and email = public.employee_auth_email(employee.employee_no)
    )
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'このメールアドレスでは登録できません。'));
end;
$$;

create or replace function public.visible_employee_ids()
returns setof integer language sql stable security definer set search_path = '' as $$
  with me as (
    select id, primary_evaluator_id, secondary_evaluator_id
    from public.employees where id = public.current_employee_id()
  )
  select person.id
  from me
  cross join lateral (values (me.id), (me.primary_evaluator_id), (me.secondary_evaluator_id)) as person(id)
  where person.id is not null
  union
  select subordinate.id
  from me
  join public.employees as subordinate
    on me.id in (subordinate.primary_evaluator_id, subordinate.secondary_evaluator_id)
  union
  select person.id
  from me
  join public.evaluation_sheets as sheet
    on me.id in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id)
  cross join lateral (values (sheet.employee_id::integer), (sheet.primary_evaluator_id), (sheet.secondary_evaluator_id)) as person(id)
  where person.id is not null
$$;

-- A correctly authenticated suspended user gets a useful explanation without
-- learning anything about another employee or obtaining their row.
create function public.get_current_employee_access_state()
returns text language sql stable security definer set search_path='' as $$
  select coalesce((select case when is_enabled then 'enabled' else 'disabled' end
                   from public.employees where user_id=auth.uid()),'unregistered')
$$;
revoke all on function public.get_current_employee_access_state() from public,anon,authenticated;
grant execute on function public.get_current_employee_access_state() to authenticated;

-- A freshly recreated public schema has no implicit PUBLIC USAGE grant. Auth
-- needs schema access as well as EXECUTE on the hook (existing projects had it).
do $$ begin
  if exists(select 1 from pg_roles where rolname='supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
  end if;
end $$;

commit;
