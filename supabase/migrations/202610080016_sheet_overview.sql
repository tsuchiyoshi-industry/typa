-- An Admin can read every evaluation sheet, content included, and cannot change any of them.
--   * get_sheet_overview: the roster of all sheets (whose sheet, of which period, how far
--     along, who evaluates it, and the result once finalized). Drafts are listed too.
--   * Read-only row policies let an Admin open any sheet with its goals and common
--     evaluation results. No write policy is added: recording, evaluating, submitting and
--     finalizing stay with the subject and the evaluators of each sheet.
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
      'noSecondaryEvaluator', coalesce(s.no_secondary_evaluator, false),
      -- The result exists only once the sheet is finalized; until then the stored values are provisional.
      'finalScore', case when s.status = 'finalized' then s.total_evaluation_score end,
      'finalRank', case when s.status = 'finalized' then
        nullif(coalesce(s.final_rank_letter, '') || case s.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end, '') end
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
  is 'Admin only: every evaluation sheet with its period, subject, grade at creation, status, evaluators and, once finalized, its score and rank.';

-- Row policies are permissive: these add to whatever already lets the subject and the
-- evaluators read. Row level security itself is left as it is on each table.
drop policy if exists "Admin reads every evaluation sheet" on public.evaluation_sheets;
create policy "Admin reads every evaluation sheet"
  on public.evaluation_sheets for select to authenticated
  using (public.current_employee_is_admin());

drop policy if exists "Admin reads every milestone" on public.milestones;
create policy "Admin reads every milestone"
  on public.milestones for select to authenticated
  using (public.current_employee_is_admin());

drop policy if exists "Admin reads every common evaluation result" on public.common_evaluation_results;
create policy "Admin reads every common evaluation result"
  on public.common_evaluation_results for select to authenticated
  using (public.current_employee_is_admin());

commit;
