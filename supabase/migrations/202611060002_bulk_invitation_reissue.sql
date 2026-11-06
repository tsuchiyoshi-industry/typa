-- Allow Admin to choose whether valid invitations are replaced in a bulk issuance.
-- Keep the no-argument RPC for older apps; it continues to preserve valid codes.
begin;

create function public.issue_pending_employee_invitations(p_include_issued boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target record; result jsonb := '[]'::jsonb;
begin
  perform public.lock_employee_administration();
  if p_include_issued is null then
    raise exception '発行済みのコードを含めるか指定してください。' using errcode='22023';
  end if;
  for target in
    select e.employee_no, e.name from public.employees e
    where e.is_enabled and e.user_id is null
      and (p_include_issued or not exists (
        select 1 from public.employee_invitations i
        where i.employee_id=e.id and i.expires_at>now()))
    order by e.employee_no
  loop
    -- The existing RPC invalidates old codes/tickets and audits each employee.
    result := result || jsonb_build_array(
      jsonb_build_object('employeeNo',target.employee_no,'name',target.name)
      || public.issue_employee_invitation(target.employee_no));
  end loop;
  return result;
end;
$$;
revoke all on function public.issue_pending_employee_invitations(boolean) from public, anon, authenticated;
grant execute on function public.issue_pending_employee_invitations(boolean) to authenticated;

create or replace function public.issue_pending_employee_invitations()
returns jsonb language sql security definer set search_path = '' as $$
  select public.issue_pending_employee_invitations(false);
$$;
revoke all on function public.issue_pending_employee_invitations() from public, anon, authenticated;
grant execute on function public.issue_pending_employee_invitations() to authenticated;

commit;
