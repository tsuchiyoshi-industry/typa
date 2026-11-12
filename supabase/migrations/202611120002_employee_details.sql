-- Who sees which employee, and what of them, is decided by the domain
-- (src/domain/services/EmployeeMasterAccessService.ts: canViewAllEmployees, evaluationColleagueIds,
-- canViewEmployeeDetail). EmployeeVisibilitySql.test.ts checks this file against it.
--
-- The rows each employee may read were already right (the employees policy). But every column of those
-- rows was readable, so an Employee could read their evaluators' grade, role, sign-in setting and account.
-- A row policy cannot hide a column on some rows only, so those columns are no longer readable through
-- the table: employee_details() returns them for the same rows, with what the reader may not see as null.
-- Admin still writes grade_id and keep_signed_in through the table (update needs no select on them).
--
-- Apply together with the web release. Old apps select these columns and filter on user_id at sign-in,
-- so the old desktop app cannot sign in afterwards; it offers its update on the sign-in screen.
begin;

revoke select on public.employees from authenticated;
grant select (id, name, employee_no, career_course, primary_evaluator_id, secondary_evaluator_id,
  no_secondary_evaluator) on public.employees to authenticated;

-- canViewEmployeeDetail: everyone sees all of their own details. Of other employees, Admin and Reviewer see
-- the grade; only Admin sees the role, the sign-in setting and the account (registration and suspension).
create or replace function public.employee_details()
returns table (employee_id integer, grade_id smallint, role_name text, keep_signed_in boolean,
  user_id uuid, registered boolean, enabled boolean)
language sql stable security definer set search_path = '' as $$
  with viewer as (
    select public.current_employee_id() as id, public.current_employee_role() as role
  ), shown as (
    select e.*, r.role_name as stored_role,
      e.id = viewer.id as own,
      viewer.role = 'Admin' as admin,
      viewer.role in ('Admin', 'Reviewer') as all_rows
    from public.employees e
    cross join viewer
    left join public.roles r on r.id = e.role_id
    where viewer.id is not null
  )
  select s.id,
    case when s.own or s.all_rows then s.grade_id end,
    case when s.own or s.admin then s.stored_role end,
    case when s.own or s.admin then s.keep_signed_in end,
    case when s.own or s.admin then s.user_id end,
    case when s.own or s.admin then s.user_id is not null end,
    case when s.own or s.admin then s.is_enabled end
  from shown s
  -- the same rows as the employees policy (canViewAllEmployees, evaluationColleagueIds)
  where s.all_rows or s.id in (select public.visible_employee_ids())
$$;
revoke all on function public.employee_details() from public, anon, authenticated;
grant execute on function public.employee_details() to authenticated;

commit;
