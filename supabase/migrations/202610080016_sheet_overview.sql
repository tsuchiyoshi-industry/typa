-- An Admin sees every evaluation sheet as a roster: whose sheet, of which period, how far
-- along it is, and who evaluates it. Drafts are listed too, as progress.
-- It carries no evaluation content (goals, scores, comments, ranks): an Admin who is not
-- the subject or an evaluator of a sheet still cannot read the sheet itself.
-- Requires 202610080008 (current_employee_is_admin) and 202610080009 (sheet evaluators).
begin;

create or replace function public.get_sheet_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.current_employee_is_admin() then
    raise exception 'Only Admin can read the sheet overview' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'periodId', s.period_id, 'employeeId', s.employee_id,
      'status', s.status, 'createdAt', s.created_at, 'updatedAt', s.updated_at,
      'periodName', p.period_name, 'periodStart', p.start_date, 'periodEnd', p.end_date,
      'employeeName', e.name, 'employeeNo', e.employee_no,
      'gradeName', coalesce(g.grade_name, ''),
      'primaryEvaluator', pr.name, 'secondaryEvaluator', se.name,
      'noSecondaryEvaluator', coalesce(s.no_secondary_evaluator, false)
    ) order by p.start_date desc, e.employee_no), '[]'::jsonb)
    from public.evaluation_sheets s
    join public.evaluation_periods p on p.id = s.period_id
    join public.employees e on e.id = s.employee_id
    left join public.employee_grades g on g.id = s.grade_id
    left join public.employees pr on pr.id = s.primary_evaluator_id
    left join public.employees se on se.id = s.secondary_evaluator_id
  );
end;
$$;
revoke all on function public.get_sheet_overview() from public, anon, authenticated;
grant execute on function public.get_sheet_overview() to authenticated;
comment on function public.get_sheet_overview()
  is 'Admin only: every evaluation sheet with its period, subject, grade at creation, status and evaluators. No evaluation content.';

commit;
