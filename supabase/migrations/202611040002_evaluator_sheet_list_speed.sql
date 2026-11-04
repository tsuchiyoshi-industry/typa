begin;

-- 評価者のシート一覧を速くする。読める範囲は変えない。
-- これまでの読み取りポリシーは、確定したシートの1行ごとに is_current_evaluator_of を呼んでいた
-- (中で current_employee_id を2回、Auth のセッションも引く)。610 人・10 期間(6,090 枚)で、
-- 評価者の一覧(自分以外のシート)が 1 回 3 秒以上かかった。
-- 今の部下は一度だけ集め、行はその集合と照らす(社員マスタの visible_employee_ids と同じ形)。

-- 呼び出した人が今の一次・二次評価者である社員(自分は除く)。利用停止中・未ログインなら空。
-- me は materialized にする。展開されると current_employee_id が社員の行ごとに呼ばれる。
create or replace function public.current_subordinate_ids()
returns setof bigint language sql stable security definer set search_path = '' as $$
  with me as materialized (select public.current_employee_id() as id)
  select subject.id::bigint
  from me
  join public.employees as subject
    on me.id in (subject.primary_evaluator_id, subject.secondary_evaluator_id)
  where subject.id <> me.id;
$$;
revoke all on function public.current_subordinate_ids() from public, anon, authenticated;
grant execute on function public.current_subordinate_ids() to authenticated;

drop policy "subject and evaluators read a sheet" on public.evaluation_sheets;
create policy "subject and evaluators read a sheet"
  on public.evaluation_sheets for select to authenticated
  using (
    (select public.current_employee_id()) in (employee_id, primary_evaluator_id, secondary_evaluator_id)
    or (status = 'finalized' and employee_id in (select public.current_subordinate_ids()))
  );

commit;
