-- employee_details() (202611120002) took about a second for Admin and Reviewer with 600 employees: the reader
-- (current_employee_id, current_employee_role) was looked up again for every row, and the rows of the
-- people one works with (visible_employee_ids) were computed even for those who see everyone.
-- Same answers (canViewEmployeeDetail, checked by EmployeeVisibilitySql.test.ts); the reader is looked up once.
begin;

create or replace function public.employee_details()
returns table (employee_id integer, grade_id smallint, role_name text, keep_signed_in boolean,
  user_id uuid, registered boolean, enabled boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer integer := public.current_employee_id();
  viewer_role text;
  all_rows boolean;
  admin boolean;
begin
  if viewer is null then
    return;
  end if;
  select r.role_name into viewer_role
  from public.employees e join public.roles r on r.id = e.role_id where e.id = viewer;
  all_rows := coalesce(viewer_role in ('Admin', 'Reviewer'), false);
  admin := coalesce(viewer_role = 'Admin', false);
  return query
    select e.id,
      case when e.id = viewer or all_rows then e.grade_id end,
      case when e.id = viewer or admin then r.role_name end,
      case when e.id = viewer or admin then e.keep_signed_in end,
      case when e.id = viewer or admin then e.user_id end,
      case when e.id = viewer or admin then e.user_id is not null end,
      case when e.id = viewer or admin then e.is_enabled end
    from public.employees e
    left join public.roles r on r.id = e.role_id
    where all_rows or e.id in (select public.visible_employee_ids());
end;
$$;
revoke all on function public.employee_details() from public, anon, authenticated;
grant execute on function public.employee_details() to authenticated;

commit;
