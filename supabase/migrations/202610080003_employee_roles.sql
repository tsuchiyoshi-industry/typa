-- An Admin changes the TYPA role (Admin / Reviewer / Employee) of an employee from the
-- employee master. The last Admin cannot be demoted, so there is always someone who can
-- manage roles. Roles are changed only through set_employee_role: clients lose the right
-- to update employees.role_id directly, which would let anyone make themselves Admin.
begin;

create or replace function public.set_employee_role(p_employee_no text, p_role_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role_id integer;
  new_role_id integer;
  target_id integer;
  target_role_id integer;
begin
  select id into admin_role_id from public.roles where role_name = 'Admin';

  if not exists (
    select 1 from public.employees as caller
    where caller.user_id = auth.uid() and caller.role_id = admin_role_id
  ) then
    raise exception 'Only Admin can change an employee role' using errcode = '42501';
  end if;

  select id into new_role_id from public.roles where role_name = p_role_name;
  if new_role_id is null then
    raise exception 'Unknown role' using errcode = '22023';
  end if;

  -- Lock every Admin row first, so two concurrent demotions cannot both see another Admin.
  perform 1 from public.employees where role_id = admin_role_id order by id for update;

  select id, role_id into target_id, target_role_id
  from public.employees where employee_no = p_employee_no for update;
  if target_id is null then
    return false;
  end if;

  if target_role_id = admin_role_id and new_role_id <> admin_role_id and not exists (
    select 1 from public.employees where role_id = admin_role_id and id <> target_id
  ) then
    raise exception 'At least one Admin must remain' using errcode = '23514';
  end if;

  update public.employees set role_id = new_role_id where id = target_id;
  return true;
end;
$$;

revoke all on function public.set_employee_role(text, text) from public, anon, authenticated;
grant execute on function public.set_employee_role(text, text) to authenticated;
comment on function public.set_employee_role(text, text)
  is 'Admin only: sets an employee''s role by role name. Refuses to demote the last Admin. Returns false for an unknown employee number.';

-- Column privileges: every column the app updates directly, except role_id.
-- A column added to employees later is not updatable by clients until it is granted here.
revoke update on public.employees from anon, authenticated;
grant update (
  user_id, name, employee_no, career_course,
  primary_evaluator_id, secondary_evaluator_id, grade_id, no_secondary_evaluator
) on public.employees to anon, authenticated;

commit;
