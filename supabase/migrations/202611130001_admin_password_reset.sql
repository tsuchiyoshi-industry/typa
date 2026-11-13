-- パスワードを忘れた社員に、Admin が仮のパスワードを設定する。登録と評価データは残す。
-- 仮のパスワードは Admin も知っている。本人が自分のパスワードに変えるまで、DB は社員として扱わない
-- (current_employee_id が null。すべての RLS と RPC がここを通る)。Admin が仮のパスワードで
-- なりすましても何も読めず、変えれば本人が仮のパスワードでログインできなくなって気づく。
-- 本人が Auth でパスワードを変えると、auth.users のトリガーが印を外す。
-- 再設定・セッションの取り消し・監査は1つのトランザクションで行い、どれかが失敗すれば何も変わらない。
begin;

alter table public.employees add column password_change_required boolean not null default false;
comment on column public.employees.password_change_required is
  'Admin が仮のパスワードを設定し、本人がまだ変えていない。表から直接は書けない(reset_employee_password と auth.users のトリガーだけ)。';

create or replace function public.current_employee_id()
returns integer language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e
  where e.user_id = auth.uid() and e.is_enabled and not e.password_change_required
    and (auth.jwt() ->> 'session_id' is null
      or exists (select 1 from auth.sessions s
                 where s.id = (auth.jwt() ->> 'session_id')::uuid and s.user_id = auth.uid()
                   and (s.not_after is null or s.not_after > now())))
$$;

-- ログイン直後に、なぜ使えないかを本人にだけ伝える(利用停止が優先)
create or replace function public.get_current_employee_access_state()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select case when not is_enabled then 'disabled'
                               when password_change_required then 'password_change_required'
                               else 'enabled' end
                   from public.employees where user_id = auth.uid()), 'unregistered')
$$;

-- 規則は src/domain/valueObjects/AccountPassword.ts と同じ。72 バイトは bcrypt と Auth の上限。
-- コストは Auth が自分で付けるもの(10)にそろえる。
create function public.reset_employee_password(p_employee_no text, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.employees%rowtype; revoked integer;
begin
  perform public.lock_employee_administration();
  if p_password is null or char_length(p_password) < 6 or octet_length(p_password) > 72
     or p_password !~ '[a-z]' or p_password !~ '[A-Z]' or p_password !~ '[0-9]' then
    raise exception 'パスワードは6文字以上で、大文字・小文字・数字をすべて含めてください。' using errcode = '22023';
  end if;
  select * into target from public.employees where employee_no = p_employee_no;
  if target.id is null or target.user_id is null or not target.is_enabled then
    raise exception '利用中・登録済みの社員だけ、パスワードを再設定できます。' using errcode = '23514';
  end if;
  if target.user_id = auth.uid() then
    raise exception '自分のパスワードは再設定できません。' using errcode = '42501';
  end if;
  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = target.user_id;
  if not found then
    raise exception 'ログイン用のアカウントが見つかりません。' using errcode = '23514';
  end if;
  -- 手元に残ったアクセストークンも current_employee_id で無効になる。リフレッシュトークンは連鎖して消える
  delete from auth.sessions where user_id = target.user_id;
  get diagnostics revoked = row_count;
  -- auth.users のトリガーが印を外した後に付ける(同じ文の中ではないので順番どおり)
  update public.employees set password_change_required = true where id = target.id;
  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'employee.password_reset', target.id,
          jsonb_build_object('employeeNo', target.employee_no, 'revokedSessions', revoked));
end;
$$;
revoke all on function public.reset_employee_password(text, text) from public, anon, authenticated;
grant execute on function public.reset_employee_password(text, text) to authenticated;

create function public.release_password_change_requirement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.employees set password_change_required = false
  where user_id = new.id and password_change_required;
  return null;
end;
$$;
revoke all on function public.release_password_change_requirement() from public, anon, authenticated;
create trigger typa_release_password_change_requirement
  after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.release_password_change_requirement();

commit;
