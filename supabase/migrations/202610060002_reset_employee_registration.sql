-- Employee rows are never deleted. To let an employee register again (forgotten
-- password, a number registered by the wrong person), an Admin clears the link and
-- physically deletes the Auth user. Evaluation data stays with the employee row.
begin;

create or replace function public.reset_employee_registration(p_employee_no text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
begin
  if not exists (
    select 1
    from public.employees as caller
    join public.roles as caller_role on caller_role.id = caller.role_id
    where caller.user_id = auth.uid()
      and caller_role.role_name = 'Admin'
  ) then
    raise exception 'Only Admin can reset an employee registration' using errcode = '42501';
  end if;

  select target.user_id into target_user_id
  from public.employees as target
  where target.employee_no = p_employee_no
  for update;

  -- Unknown employee number, or not registered: nothing to reset.
  if target_user_id is null then
    return false;
  end if;

  -- Resetting yourself would cut off the session that is running this.
  if target_user_id = auth.uid() then
    raise exception 'Admin cannot reset their own registration' using errcode = '42501';
  end if;

  update public.employees set user_id = null where employee_no = p_employee_no;
  delete from auth.users where id = target_user_id;
  return true;
end;
$$;

revoke all on function public.reset_employee_registration(text) from public, anon, authenticated;
grant execute on function public.reset_employee_registration(text) to authenticated;
comment on function public.reset_employee_registration(text)
  is 'Admin only: clears employees.user_id and deletes the linked Auth user so the employee can register again. Returns false when there is nothing to reset.';

commit;
