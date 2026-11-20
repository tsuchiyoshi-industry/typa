begin;

-- 社員に紐付かない Auth のアカウントを残さない。
-- 認証コードはどのドメインのメールアドレスにも送れるので(会社のメールを持たない社員がいる)、
-- 認証コードを受け取ったメールのアカウント・打ち間違えたアドレスのアカウント・紐付けの前で止まった
-- ログイン用アカウントが、Auth に溜まっていた。どれも社員の行が無いので何も読めないが、
-- 用の無い個人情報(他人のメールアドレス)を持ち続け、正しいアカウントの点検を難しくする。
--
-- 1. 登録を終えたら、認証コードを受け取ったメールのアカウントを消す(宛先は employee_contacts に残る)。
--    共有のメールで、ほかの社員の登録が続いているあいだは残す。
-- 2. 登録を終えるたびに、作ってから 1 日たっても社員に紐付かないアカウントを消す。
--    認証コードは 1 時間、登録の続き(registration_tickets)は 15 分で切れるので、1 日あれば途中の登録を壊さない。
-- 3. このマイグレーションを当てたときに、すでに溜まっている分を消す。
-- 消した数だけを監査ログに残す(アドレスは写さない)。記録に失敗したら、登録ごと取り消す。

create or replace function public.remove_unlinked_auth_accounts()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  with gone as (
    delete from auth.users as account
    where account.created_at < now() - interval '1 day'
      and not exists (select 1 from public.employees as employee where employee.user_id = account.id)
    returning 1
  )
  select count(*) into removed from gone;
  if removed > 0 then
    insert into public.security_audit_log(actor_user_id, action, entity_id, details)
    values (null, 'account.unlinked_removed', null, jsonb_build_object('removed', removed));
  end if;
  return removed;
end;
$$;
revoke all on function public.remove_unlinked_auth_accounts() from public, anon, authenticated;

-- 202610160001 と同じ。紐付けたあとに 1 と 2 を行う。
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
  delete from auth.users as account
  where lower(account.email)=lower(contact)
    and not exists (select 1 from public.employees e where e.user_id=account.id)
    and not exists (select 1 from public.registration_tickets t
                    where lower(t.contact_email)=lower(contact) and t.expires_at>now());
  perform public.remove_unlinked_auth_accounts();
  return true;
end;
$$;

select public.remove_unlinked_auth_accounts();

commit;
