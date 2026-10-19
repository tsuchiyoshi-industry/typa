-- Invitation codes are typed by hand from a printed list. Use 12 characters from 32 that
-- cannot be misread (no 0/O or 1/I), shown as XXXX-XXXX-XXXX: 60 random bits, single use,
-- 7 days, and registration also needs a code mailed to the company mailbox.
-- begin_registration already ignores case and hyphens; codes issued before stay valid.
-- Apply after 202610160004.
begin;

create or replace function public.issue_employee_invitation(p_employee_no text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.employees%rowtype; code text := ''; raw bytea := uuid_send(gen_random_uuid());
  expiry timestamptz := now()+interval '7 days';
begin
  perform public.lock_employee_administration();
  select * into target from public.employees where employee_no=p_employee_no;
  if target.id is null or not target.is_enabled or target.user_id is not null then
    raise exception '利用中・未登録の社員にだけ招待コードを発行できます。' using errcode='23514';
  end if;
  -- Bytes 6 and 8 carry the UUID version/variant bits; 12 of the other bytes are fully random.
  for i in 0..15 loop
    continue when i in (6,8,14,15);
    code := code || substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + get_byte(raw,i) % 32, 1);
  end loop;
  delete from public.registration_tickets where employee_id=target.id;
  -- A stalled/hostile pre-created internal account must not squat on this login id.
  delete from auth.users u where lower(u.email)=public.employee_auth_email(target.employee_no)
    and not exists (select 1 from public.employees e where e.user_id=u.id);
  insert into public.employee_invitations(employee_id,code_hash,expires_at,issued_by)
  values(target.id,encode(sha256(convert_to(code,'UTF8')),'hex'),expiry,public.current_employee_id())
  on conflict(employee_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,issued_by=excluded.issued_by;
  insert into public.security_audit_log(actor_user_id,action,entity_id) values(auth.uid(),'employee.invited',target.id);
  return jsonb_build_object('code',substr(code,1,4)||'-'||substr(code,5,4)||'-'||substr(code,9,4),'expiresAt',expiry);
end;
$$;

commit;
