begin;

-- 認証コード・通知の送り先を、会社ドメインに縛らない(どのドメインのメールアドレスでもよい)。
-- これまでは、新規登録の認証コードを会社ドメインのメールアドレスにしか送れなかった。
-- 会社ドメイン(workspace_settings.required_domain)は、ログイン用の内部アドレス
-- typa-<社員番号>@<会社ドメイン> にだけ使う。登録してよいかは、これまでどおり社員ごとの
-- 招待コードと、そのメールに届いた認証コード(15 分以内)で決める。

comment on column public.workspace_settings.required_domain
  is 'Domain of the internal Auth address typa-<employee no>@<domain>, without "@". Changing or clearing it stops every registered employee from signing in. Sign-up codes and notices may go to a mailbox at any domain.';

-- Auth がアカウントを作ってよいか。ログイン用の内部アドレス(会社ドメインの typa-…)は、
-- 登録の途中の社員の分だけ。それ以外は、どのドメインのメールアドレスでもよい(認証コードの送り先)。
-- 会社ドメインが無いとログイン用アドレスを作れないので、そのときは登録そのものを始めさせない。
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  email text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
  domain text;
begin
  select lower(required_domain) into domain from public.workspace_settings;
  if coalesce(domain, '') <> '' and email ~ '^[^@[:space:]]+@[^@[:space:]]+$' and (
    not (email like 'typa-%' and split_part(email, '@', 2) = domain)
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

-- 202610160001 と同じ。ただし、認証コードを受け取ったメールアドレスのドメインは問わない
-- (ログイン用の内部アドレスのセッションだけは断る。メールが届かないので、読めたことを示せない)。
create or replace function public.begin_registration(p_employee_no text, p_invitation_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare domain text; caller_email text; target public.employees%rowtype; invitation public.employee_invitations%rowtype; ticket uuid;
begin
  select lower(required_domain) into domain from public.workspace_settings;
  select lower(email) into caller_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if coalesce(domain,'')='' or caller_email is null
     or (caller_email like 'typa-%' and split_part(caller_email,'@',2)=domain)
     or not exists (select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) method
                    where method->>'method' in ('otp','magiclink')
                      and (method->>'timestamp')::numeric >= extract(epoch from now())-900) then
    raise exception 'メールに届いた認証コードをもう一度確認してください。' using errcode='42501';
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

commit;
