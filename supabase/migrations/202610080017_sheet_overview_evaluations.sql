-- The printed overview (PDF) also lists each sheet's ranks and overall comments, in the
-- order first rank, first comment, final rank, second comment. The on-screen list does
-- not show them; the function returns them for the export.
-- Same signature as 202610080016, so this replaces that function in place.
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
      'noSecondaryEvaluator', coalesce(s.no_secondary_evaluator, false),
      -- A rank exists only once its stage is confirmed; until then the stored values are provisional.
      'firstRank', case when s.status in ('first_evaluated', 'finalized') then s.first_rank end,
      'firstOverallComment', coalesce(s.first_overall_comment, ''),
      'finalScore', case when s.status = 'finalized' then s.total_evaluation_score end,
      'finalRank', case when s.status = 'finalized' then
        nullif(coalesce(s.final_rank_letter, '') || case s.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end, '') end,
      'secondOverallComment', coalesce(s.second_overall_comment, '')
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
  is 'Admin only: every evaluation sheet with its period, subject, grade at creation, status, evaluators, confirmed ranks, final score and overall comments.';

commit;
