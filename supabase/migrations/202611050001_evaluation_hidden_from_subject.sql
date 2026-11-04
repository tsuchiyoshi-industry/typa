begin;

-- 評価の内容を本人に見せない(評価確定の後も)。
-- これまでは評価確定の後、本人にも点数・コメント・総評・ランク・評価点を返し、一次評価者と異動後の今の評価者にも
-- 最終評価(二次評価・最終ランク・評価点)を返していた。これからは:
--   本人             評価の内容を一切返さない(目標・期中目標・達成状況と、その締め後修正だけ)
--   一次評価者       自分の一次評価だけ(二次評価者「なし」で最終評価者を兼ねるときは、最終評価も)
--   最終評価者・Admin すべて
--   異動後の今の評価者(シートの評価者でない人) 目標だけ
-- 返す範囲は get_sheet が決め、sheet_document は最終評価を「二次評価を見られる人」にだけ返す。
-- 締め済み期間の本人にはシート内容を返さず、一覧用に最終評価ランクだけを別の関数で返す。

-- sheet_document は、最終評価(最終ランク・評価点・合計)を二次評価を見られる人(最終評価者と管理者)にだけ返す。
-- 関数の他の部分は変えない(202610270001 と同じく、今の定義の該当箇所だけを置き換える)。
do $migration$
declare
  definition text;
  patched text;
  anchors text[] := array[
    $a$'finalRankLetter', case when finalized then$a$,
    $a$'finalRankLevel', case when finalized then$a$,
    $a$'stored', case when finalized then$a$];
  anchor text;
begin
  definition := pg_catalog.pg_get_functiondef('public.sheet_document(bigint,boolean,boolean,boolean)'::regprocedure);
  patched := definition;
  foreach anchor in array anchors loop
    if position(anchor in patched) = 0 then
      raise exception 'Unexpected sheet_document definition (%).', anchor;
    end if;
    patched := replace(patched, anchor, replace(anchor, 'when finalized then', 'when finalized and sees_second then'));
  end loop;
  execute patched;
end;
$migration$;

revoke all on function public.sheet_document(bigint, boolean, boolean, boolean) from public, anon, authenticated;

create or replace function public.get_sheet(p_sheet_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
  is_party boolean;
  is_admin_reader boolean;
  is_subject boolean;
  is_primary boolean;
  is_final boolean;
  sees_content boolean;
  sees_first boolean;
  sees_second boolean;
  closed boolean;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  select not is_active into closed from public.evaluation_periods where id = sheet.period_id;
  if sheet.id is null or me is null then
    return null;
  end if;
  is_party := coalesce(me in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id), false);
  is_admin_reader := not is_party and public.current_employee_is_admin();
  if not (is_party or is_admin_reader
          or ((sheet.status = 'finalized' or closed) and public.is_current_evaluator_of(sheet.employee_id::integer)))
  then
    return null;
  end if;

  is_subject := sheet.employee_id = me;
  is_primary := not is_subject and coalesce(sheet.primary_evaluator_id = me, false);
  -- 最終評価者: 二次評価者。二次評価者「なし」の社員は一次評価者が兼ねる
  is_final := not is_subject and coalesce(
    sheet.secondary_evaluator_id = me
    or (sheet.secondary_evaluator_id is null and sheet.no_secondary_evaluator and sheet.primary_evaluator_id = me),
    false);
  -- An evaluator gets a draft without its content, until its period is closed and it no longer changes.
  sees_content := is_subject or sheet.status <> 'draft' or closed or is_admin_reader;
  -- 本人と、シートの評価者でない今の評価者には、評価を返さない
  sees_first := sees_content and (is_primary or is_final or is_admin_reader);
  sees_second := sees_content and (is_final or is_admin_reader);

  -- 次の評価者への知らせ方。画面は、通知メールのチェックや再送をメールのときだけ出す
  return public.sheet_document(sheet.id, sees_content, sees_first, sees_second)
    || jsonb_build_object(
      'notificationChannel', (select notification_channel from public.workspace_settings));
end;
$$;
revoke all on function public.get_sheet(bigint) from public, anon, authenticated;
grant execute on function public.get_sheet(bigint) to authenticated;

-- 共通評価の結果の行ポリシーから、本人(評価確定後)を外す。表の直接の読み取りは今も許していないが、
-- 誤って権限を足しても本人に返らないよう、ポリシーでも断る
drop policy if exists "evaluators read common evaluation" on public.common_evaluation_results;
create policy "evaluators read common evaluation"
  on public.common_evaluation_results for select to authenticated
  using (public.sheet_access(sheet_id) in ('first', 'second', 'read'));

-- A closed sheet is not readable by its subject, even though its final rank is
-- available separately through get_my_closed_grades().
do $migration$
declare
  definition text;
  patched text;
begin
  definition := pg_catalog.pg_get_functiondef('public.get_sheet(bigint)'::regprocedure);

  if position('select not is_active into closed' in definition) = 0 then
    raise exception 'Unexpected get_sheet closure check.';
  end if;
  patched := replace(
    definition,
    'select not is_active into closed',
    'select closed_at is not null into closed'
  );

  if position('is_subject := sheet.employee_id = me;' in patched) = 0 then
    raise exception 'Unexpected get_sheet subject check.';
  end if;
  patched := replace(
    patched,
    'is_subject := sheet.employee_id = me;',
    'is_subject := sheet.employee_id = me;' || E'\n  if is_subject and closed then return null; end if;'
  );
  execute patched;
end;
$migration$;

drop policy if exists "subject and evaluators read goals" on public.milestones;
create policy "subject and evaluators read goals"
  on public.milestones for select to authenticated
  using (
    public.sheet_access(sheet_id) is not null
    and (
      public.sheet_access(sheet_id) not like 'subject:%'
      or not exists (
        select 1
        from public.evaluation_sheets as sheet
        join public.evaluation_periods as period on period.id = sheet.period_id
        where sheet.id = milestones.sheet_id and period.closed_at is not null
      )
    )
  );

create or replace function public.get_my_closed_grades()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。' using errcode = '42501';
  end if;
  if me is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'sheetId', sheet.id,
        'rank', sheet.final_rank_letter ||
          case sheet.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end
      )
      order by sheet.id
    )
    from public.evaluation_sheets as sheet
    join public.evaluation_periods as period on period.id = sheet.period_id
    where sheet.employee_id = me
      and sheet.status = 'finalized'
      and sheet.final_rank_letter is not null
      and period.closed_at is not null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_closed_grades() from public, anon, authenticated;
grant execute on function public.get_my_closed_grades() to authenticated;

commit;
