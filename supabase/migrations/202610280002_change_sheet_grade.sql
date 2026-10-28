-- 当期のシートの「作成時の等級」を Admin が変える(遡及処理の画面から)。
-- 等級で変わるのは共通評価の項目だけなので、そのシートの共通評価の入力(点数・コメント)をすべて消す。
-- 目標・期中目標・達成状況・点数・総評・状態・評価者には触れない。消した内容と理由は監査ログに残す。
-- 一次評価が確定した後は、確定した評価点・ランクの元が消えるので断る(先に状態を戻す)。
begin;

create function public.change_sheet_grade(
  p_sheet_id bigint, p_grade_id smallint, p_expected_grade_id smallint, p_expected_status text, p_reason text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  sheet public.evaluation_sheets%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
  deleted jsonb;
  deleted_count integer;
begin
  if not coalesce(public.current_employee_is_admin(), false) then
    raise exception '等級の変更は Admin のみ利用できます。' using errcode = '42501';
  end if;
  if char_length(reason) not between 1 and 500 then
    raise exception '操作の理由を 500 文字以内で入力してください。' using errcode = '22023';
  end if;
  if p_grade_id is null then
    raise exception '変更後の等級を選んでください。' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employee_grades where id = p_grade_id) then
    raise exception '変更後の等級が見つかりません。' using errcode = '22023';
  end if;

  select * into sheet from public.evaluation_sheets where id = p_sheet_id for update;
  if not found then
    raise exception '評価シートが見つかりません。' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.evaluation_periods where id = sheet.period_id and is_active) then
    raise exception '等級を変更できるのは、当期(実施中の評価期間)のシートだけです。' using errcode = '23514';
  end if;
  if sheet.status in ('first_evaluated', 'finalized') then
    raise exception '一次評価が確定したシートの等級は変更できません。先に状態を一次評価待ちまでに戻してください。' using errcode = '23514';
  end if;
  if sheet.status is distinct from p_expected_status or sheet.grade_id is distinct from p_expected_grade_id then
    raise exception 'シートの状態か等級が変わりました。再読み込みしてから操作してください。' using errcode = '40001';
  end if;
  if sheet.grade_id = p_grade_id then
    raise exception '今と同じ等級には変更できません。' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.item_id), '[]'::jsonb), count(*)
    into deleted, deleted_count
  from public.common_evaluation_results r where r.sheet_id = sheet.id;
  delete from public.common_evaluation_results where sheet_id = sheet.id;
  update public.evaluation_sheets set grade_id = p_grade_id, updated_at = now() where id = sheet.id;

  insert into public.security_audit_log(actor_user_id, action, entity_id, details)
  values (auth.uid(), 'sheet.grade_change', sheet.id, jsonb_build_object(
    'reason', reason, 'actorEmployeeId', public.current_employee_id(),
    'employeeId', sheet.employee_id, 'periodId', sheet.period_id, 'status', sheet.status,
    'fromGradeId', sheet.grade_id, 'toGradeId', p_grade_id,
    'deletedCommonResults', deleted));
  return deleted_count;
end;
$$;
revoke all on function public.change_sheet_grade(bigint, smallint, smallint, text, text) from public, anon, authenticated;
grant execute on function public.change_sheet_grade(bigint, smallint, smallint, text, text) to authenticated;
comment on function public.change_sheet_grade(bigint, smallint, smallint, text, text)
  is 'Admin only: change the grade of a current-period sheet before its first evaluation is confirmed, deleting its common evaluation input. Audited.';

-- 遡及処理の画面で、シートの今の等級を選択肢と照らし合わせるため、等級の ID も返す。
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
  );
end;
$$;

commit;
