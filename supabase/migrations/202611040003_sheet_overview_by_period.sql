begin;

-- 全社のシート一覧を評価期間ごとに読めるようにする(通信を減らす)。
-- これまでの get_sheet_overview は全期間のシートを丸ごと返した。610 人・10 期間(6,090 枚)で 3.5MB あり、
-- 一覧を開くたび・締め後の修正で期間を選ぶたび・一覧の PDF を出すたびに送っていた。
-- p_period_id を渡すとその期間だけを返す。省けば全期間(古いアプリ向け。中身は変えない)。
-- 期間の切り替えと件数、監査ログの名寄せには、ID と期間・社員だけの get_sheet_index を使う。

-- 引数のない版を残すと、引数なしの呼び出しがどちらにも当てはまり PostgREST が選べないので置き換える。
drop function public.get_sheet_overview();
create function public.get_sheet_overview(p_period_id bigint default null)
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
      'gradeId', s.grade_id,
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
    where p_period_id is null or s.period_id = p_period_id
  );
end;
$$;
revoke all on function public.get_sheet_overview(bigint) from public, anon, authenticated;
grant execute on function public.get_sheet_overview(bigint) to authenticated;

-- 全社のシートの ID・評価期間・社員と、評価期間の名前・開始日。名前や評価の中身は含めない。
create or replace function public.get_sheet_index()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.current_employee_is_admin() then
    raise exception 'Only Admin can read the sheet overview' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'periods', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.period_name, 'startDate', p.start_date) order by p.start_date desc), '[]'::jsonb)
      from public.evaluation_periods p),
    'sheets', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'periodId', s.period_id, 'employeeId', s.employee_id) order by s.id), '[]'::jsonb)
      from public.evaluation_sheets s)
  );
end;
$$;
revoke all on function public.get_sheet_index() from public, anon, authenticated;
grant execute on function public.get_sheet_index() to authenticated;

commit;
