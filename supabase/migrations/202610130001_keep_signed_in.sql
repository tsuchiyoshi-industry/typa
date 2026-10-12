-- Whether the app keeps an employee signed in after it is closed is decided per employee,
-- by an Admin, in the employee master. Since 202610120001's app release every session ended
-- with the app, because evaluatees share PCs; people with a PC of their own had to sign in
-- every time for that. An Admin knows who works on a shared PC.
--   false (default): the session ends when the app is closed. For anyone on a shared PC.
--   true: the app also keeps the session on that PC and opens signed in next time.
-- This is a convenience the app follows, not a permission: what a session may read or write
-- is unchanged. Apply before releasing the app version that reads the column; older app
-- versions ignore it.
-- Requires 202610120001.
begin;

alter table public.employees
  add column if not exists keep_signed_in boolean not null default false;
comment on column public.employees.keep_signed_in
  is 'true: the app keeps this employee signed in after it is closed. Leave false for employees who use a shared PC. Changed by an Admin only.';

grant update (keep_signed_in) on public.employees to authenticated;

-- Same as 202610120001, with keep_signed_in reserved for Admin like the grade.
create or replace function public.guard_employee_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.grade_id is distinct from old.grade_id and public.current_employee_role() is distinct from 'Admin' then
    raise exception '等級を変更できるのは Admin だけです。' using errcode = '42501';
  end if;
  if new.keep_signed_in is distinct from old.keep_signed_in and public.current_employee_role() is distinct from 'Admin' then
    raise exception 'ログイン状態の保持を変更できるのは Admin だけです。' using errcode = '42501';
  end if;
  if new.id in (new.primary_evaluator_id, new.secondary_evaluator_id) then
    raise exception '自分自身を評価者として設定することはできません。' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_employee_write() from public, anon, authenticated;

commit;
