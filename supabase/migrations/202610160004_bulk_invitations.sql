-- Issue invitations in one call for the initial rollout and for codes that expired unused.
-- Employees holding an unexpired code are skipped, so codes already handed out stay valid.
-- Apply after 202610160003.
begin;

create function public.issue_pending_employee_invitations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target record; result jsonb := '[]'::jsonb;
begin
  perform public.lock_employee_administration();
  for target in
    select e.employee_no, e.name from public.employees e
    where e.is_enabled and e.user_id is null
      and not exists (select 1 from public.employee_invitations i
                      where i.employee_id=e.id and i.expires_at>now())
    order by e.employee_no
  loop
    result := result || jsonb_build_array(
      jsonb_build_object('employeeNo',target.employee_no,'name',target.name)
      || public.issue_employee_invitation(target.employee_no));
  end loop;
  return result;
end;
$$;
revoke all on function public.issue_pending_employee_invitations() from public, anon, authenticated;
grant execute on function public.issue_pending_employee_invitations() to authenticated;

commit;
