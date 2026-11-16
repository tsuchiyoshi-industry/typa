-- データ取込で、取り込む評価期間を選ぶ。
-- これまでは実施中の評価期間に決め打ちで書いたため、前の評価期間のつもりで取り込んだ点数が、
-- 実施中の評価期間の下書きに入ってしまっていた。
--
-- 取り込めるのは、実施中と締め済みの評価期間(未開始・準備中はまだシートを作らない)。
-- 締め済みの評価期間に書くのは、締めを越える特権操作。
--   * 画面が「締め済みと確かめた」(p_closed_confirmed)ときだけ書く。画面で見ていた状態と違えば断る。
--   * 締めた評価期間のトリガーは、この取込が作る・置き換えるシートだけを、このトランザクションの間
--     例外にする(privileged_sheet_context。クライアントは書けない)。終わる前に例外を消す。
--   * 監査ログに、評価期間とその状態、置き換えて消した目標・共通評価をそのまま残す。監査に失敗すれば
--     取込全体が取り消される。
-- 引数の違う古い関数は消す(古いアプリが確かめずに書けないように)。
--
-- あわせて、締めた評価期間のトリガーが信じていた遡及処理の印(クライアントが立てられる GUC
-- typa.correcting_sheet)をやめ、遡及処理も privileged_sheet_context を使う。
begin;

drop function if exists public.get_sheet_import_template();
drop function if exists public.import_sheet_data(jsonb, jsonb, boolean);

-- 取り込める評価期間を、取込の間変わらないように押さえて返す。誰でも呼べないよう、権限は与えない
create function public.lock_import_period(p_period_id bigint)
returns public.evaluation_periods language plpgsql security definer set search_path = '' as $$
declare period public.evaluation_periods%rowtype;
begin
  -- 締めと開始(evaluation_periods の更新)は、取込が終わるまで待つ
  select * into period from public.evaluation_periods where id = p_period_id for share;
  if not found then
    raise exception '評価期間が見つかりません。画面を読み込み直してください。' using errcode = 'P0002';
  end if;
  if not period.is_active and period.closed_at is null then
    raise exception '「%」はまだ始まっていません。取り込めるのは、実施中か締め済みの評価期間だけです。',
      period.period_name using errcode = '23514';
  end if;
  return period;
end;
$$;
revoke all on function public.lock_import_period(bigint) from public, anon, authenticated, service_role;

create function public.get_sheet_import_template(p_period_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare period public.evaluation_periods%rowtype;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  period := public.lock_import_period(p_period_id);
  return jsonb_build_object(
    'periodName', period.period_name,
    'maxGoals', (select max_challenge_goals from public.evaluation_settings),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeNo', e.employee_no, 'name', e.name,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title) order by i.id)
          from public.common_evaluation_items i
          -- 作り済みの下書きはその項目、まだなければ今の等級の項目(作るときにそうなる)
          where i.item_set_id = case when draft.id is null then g.item_set_id else draft.item_set_id end), '[]'::jsonb)
      ) order by e.employee_no)
      from public.employees e
      left join public.employee_grades g on g.id = e.grade_id
      left join public.evaluation_sheets draft on draft.employee_id = e.id and draft.period_id = period.id
      where e.is_enabled and not exists (
        select 1 from public.evaluation_sheets s
        where s.employee_id = e.id and s.period_id = period.id and s.status <> 'draft')
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_sheet_import_template(bigint) from public, anon, authenticated;
grant execute on function public.get_sheet_import_template(bigint) to authenticated, service_role;

create function public.import_sheet_data(
  p_period_id bigint, p_goals jsonb, p_common jsonb, p_apply boolean, p_closed_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  period public.evaluation_periods%rowtype;
  v_period bigint;
  closed boolean;
  writing boolean := coalesce(p_apply, false);
  max_goals integer;
  errors jsonb;
  goal_ids integer[];
  common_ids integer[];
  summary jsonb;
  replaced jsonb;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  period := public.lock_import_period(p_period_id);
  v_period := period.id;
  closed := period.closed_at is not null;
  -- 画面が締め済みと知らずに(確かめずに)送った取込は書かない。確かめるだけなら答える
  if writing and closed and not coalesce(p_closed_confirmed, false) then
    raise exception '「%」は締め済みの評価期間です。画面を読み込み直し、締め済みの評価期間に取り込むことを確かめてからやり直してください。',
      period.period_name using errcode = '23514';
  end if;
  select max_challenge_goals into max_goals from public.evaluation_settings;
  -- 確かめてから書くまでの間に、提出されたり作られたりしないようにする
  if writing then
    perform 1 from public.evaluation_sheets where period_id = v_period order by id for update;
  end if;

  create temp table import_goals on commit drop as
  select r.line, trim(coalesce(r."employeeNo", '')) as employee_no, trim(coalesce(r.name, '')) as name,
         trim(coalesce(r."goalNumber", '')) as goal_number,
         coalesce(r."challengeGoal", '') as challenge_goal,
         coalesce(r."periodGoals", '[]'::jsonb) as period_goals, coalesce(r.achievement, '') as achievement,
         trim(coalesce(r."firstScore", '')) as first_score, trim(coalesce(r."secondScore", '')) as second_score,
         e.id as employee_id, e.name as master_name, e.no_secondary_evaluator, s.status as sheet_status
  from jsonb_to_recordset(coalesce(p_goals, '[]')) as r(line integer, "employeeNo" text, name text,
         "goalNumber" text, "challengeGoal" text, "periodGoals" jsonb, achievement text,
         "firstScore" text, "secondScore" text)
  left join public.employees e on e.employee_no = trim(r."employeeNo") and e.is_enabled
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = v_period
  where concat(r."challengeGoal", r.achievement, r."firstScore", r."secondScore") ~ '[^[:space:]]'
     or (r."periodGoals" is not null and (not public.valid_period_goals(r."periodGoals")
       or exists (
         select 1 from jsonb_array_elements(case when jsonb_typeof(r."periodGoals") = 'array' then r."periodGoals" else '[]'::jsonb end) item
         where concat(item->>'description', item->>'achievement') ~ '[^[:space:]]')));

  create temp table import_common on commit drop as
  select r.line, trim(coalesce(r."employeeNo", '')) as employee_no, trim(coalesce(r.name, '')) as name,
         trim(coalesce(r."itemId", '')) as item_id, trim(coalesce(r."itemTitle", '')) as item_title,
         trim(coalesce(r."firstScore", '')) as first_score, trim(coalesce(r."secondScore", '')) as second_score,
         coalesce(r.comment, '') as comment,
         e.id as employee_id, e.name as master_name, e.no_secondary_evaluator, s.status as sheet_status,
         i.id as item, i.title as master_title
  from jsonb_to_recordset(coalesce(p_common, '[]')) as r(line integer, "employeeNo" text, name text,
         "itemId" text, "itemTitle" text, "firstScore" text, "secondScore" text, comment text)
  left join public.employees e on e.employee_no = trim(r."employeeNo") and e.is_enabled
  left join public.employee_grades g on g.id = e.grade_id
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = v_period
  left join public.common_evaluation_items i
    on i.id = case when trim(r."itemId") ~ '^[0-9]{1,18}$' then trim(r."itemId")::bigint end
   and i.item_set_id = case when s.id is null then g.item_set_id else s.item_set_id end
  where concat(r."firstScore", r."secondScore", r.comment) ~ '[^[:space:]]';

  with goal_rows as (
    select *, min(line) over (partition by employee_id, number) as first_line
    from (select *, case when goal_number ~ '^[0-9]{1,9}$' then goal_number::integer end as number
          from import_goals) as parsed
  ), common_rows as (
    select *, min(line) over (partition by employee_id, item) as first_line from import_common
  ), found as (
    select 'goals' as file, line, ord, message from goal_rows cross join lateral (values
      (1, case when employee_no = '' then '社員番号が空欄です。'
               when employee_id is null then format('社員番号「%s」の社員がいません(利用停止中の社員には取り込めません)。', employee_no) end),
      (2, case when employee_id is not null and name <> '' and name <> master_name
               then format('氏名が社員マスタの「%s」と違います。社員番号を確かめてください。', master_name) end),
      (3, case when sheet_status is not null and sheet_status <> 'draft'
               then 'この社員の、この評価期間の評価シートは目標を送信済みのため、取り込めません。' end),
      (4, case when number is null or number not between 1 and max_goals
               then format('目標番号は 1〜%s の数字で入力してください(「%s」)。', max_goals, goal_number)
               when employee_id is not null and line <> first_line
               then format('目標番号 %s が %s行目と重複しています。', number, first_line) end),
      (5, case when challenge_goal !~ '[^[:space:]]' then 'チャレンジ目標が空欄です。' end),
      (8, case when not public.valid_period_goals(period_goals) then '期中目標は0〜4件のタスクと達成状況で指定してください。' end),
      (6, case when first_score !~ '^[1-4]?$'
               then format('一次評価点は 1〜4 の数字か空欄にしてください(「%s」)。', first_score) end),
      (7, case when second_score !~ '^[1-4]?$'
               then format('二次評価点は 1〜4 の数字か空欄にしてください(「%s」)。', second_score)
               when second_score <> '' and no_secondary_evaluator
               then '二次評価者がいない社員のため、二次評価点は入れられません。' end)
    ) as c(ord, message)
    union all
    select 'common', line, ord, message from common_rows cross join lateral (values
      (1, case when employee_no = '' then '社員番号が空欄です。'
               when employee_id is null then format('社員番号「%s」の社員がいません(利用停止中の社員には取り込めません)。', employee_no) end),
      (2, case when employee_id is not null and name <> '' and name <> master_name
               then format('氏名が社員マスタの「%s」と違います。社員番号を確かめてください。', master_name) end),
      (3, case when sheet_status is not null and sheet_status <> 'draft'
               then 'この社員の、この評価期間の評価シートは目標を送信済みのため、取り込めません。' end),
      (4, case when employee_id is not null and item is null
               then format('項目ID「%s」は、この社員の等級の共通評価項目ではありません。', item_id)
               when item is not null and item_title <> '' and item_title <> master_title
               then format('項目名が「%s」と違います。項目IDを確かめてください。', master_title)
               when item is not null and line <> first_line
               then format('項目ID %s が %s行目と重複しています。', item, first_line) end),
      (6, case when first_score !~ '^[1-4]?$'
               then format('一次評価点は 1〜4 の数字か空欄にしてください(「%s」)。', first_score) end),
      (7, case when second_score !~ '^[1-4]?$'
               then format('二次評価点は 1〜4 の数字か空欄にしてください(「%s」)。', second_score)
               when second_score <> '' and no_secondary_evaluator
               then '二次評価者がいない社員のため、二次評価点は入れられません。' end)
    ) as c(ord, message)
  )
  select coalesce(jsonb_agg(jsonb_build_object('file', file, 'line', line, 'message', message)
                            order by file desc, line, ord), '[]')
  into errors from found where message is not null;

  if errors = '[]' and not exists (select 1 from import_goals) and not exists (select 1 from import_common) then
    errors := jsonb_build_array(jsonb_build_object('file', null, 'line', null,
      'message', '取り込む内容がありません。目標か共通評価を1行以上記入してください。'));
  end if;

  select array_agg(distinct employee_id) into goal_ids from import_goals;
  select array_agg(distinct employee_id) into common_ids from import_common;
  select jsonb_build_object(
    'periodName', period.period_name,
    'employees', count(*),
    'newSheets', count(*) filter (where s.id is null),
    'replacedSheets', count(*) filter (where s.id is not null),
    'goals', (select count(*) from import_goals),
    'commonResults', (select count(*) from import_common))
  into summary
  from (select unnest(goal_ids) union select unnest(common_ids)) as target(employee_id)
  left join public.evaluation_sheets s on s.employee_id = target.employee_id and s.period_id = v_period;

  if errors <> '[]' or not writing then
    return jsonb_build_object('errors', errors, 'summary', summary, 'applied', false);
  end if;

  -- 書くシート。新しいシートの id は先に採る(締めた評価期間では、その id だけを例外にするため)
  create temp table import_targets on commit drop as
  select target.employee_id, s.id as existing_id,
         coalesce(s.id, nextval(pg_catalog.pg_get_serial_sequence('public.evaluation_sheets', 'id'))) as sheet_id
  from (select unnest(goal_ids) union select unnest(common_ids)) as target(employee_id)
  left join public.evaluation_sheets s on s.employee_id = target.employee_id and s.period_id = v_period;

  -- 置き換えて消す内容を、消す前に残す
  select coalesce(jsonb_agg(jsonb_build_object(
    'sheetId', t.existing_id,
    'employeeNo', e.employee_no,
    'goals', case when t.employee_id = any (goal_ids) then coalesce((
      select jsonb_agg(to_jsonb(m) order by m.goal_number) from public.milestones m where m.sheet_id = t.existing_id), '[]') end,
    'commonResults', case when t.employee_id = any (common_ids) then coalesce((
      select jsonb_agg(to_jsonb(r) order by r.item_id) from public.common_evaluation_results r where r.sheet_id = t.existing_id), '[]') end
  ) order by e.employee_no), '[]')
  into replaced
  from import_targets t join public.employees e on e.id = t.employee_id
  where t.existing_id is not null;

  if closed then
    insert into public.privileged_sheet_context (transaction_id, sheet_id)
    select txid_current(), sheet_id from import_targets;
  end if;

  -- 等級と評価者は、シートを作るときのトリガーが社員マスタから入れる
  insert into public.evaluation_sheets (id, period_id, employee_id)
  select sheet_id, v_period, employee_id from import_targets where existing_id is null
  on conflict (period_id, employee_id) do nothing;

  delete from public.milestones m using public.evaluation_sheets s
  where m.sheet_id = s.id and s.period_id = v_period and s.employee_id = any (goal_ids);
  insert into public.milestones (sheet_id, goal_number, challenge_goal, period_goals, achievement, first_score, second_score)
  select s.id, g.goal_number::integer, g.challenge_goal, g.period_goals, g.achievement,
         coalesce(nullif(g.first_score, '')::integer, 0), coalesce(nullif(g.second_score, '')::integer, 0)
  from import_goals g join public.evaluation_sheets s on s.employee_id = g.employee_id and s.period_id = v_period;

  delete from public.common_evaluation_results r using public.evaluation_sheets s
  where r.sheet_id = s.id and s.period_id = v_period and s.employee_id = any (common_ids);
  insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score, first_comment)
  select s.id, c.item, coalesce(nullif(c.first_score, '')::integer, 0),
         coalesce(nullif(c.second_score, '')::integer, 0), c.comment
  from import_common c join public.evaluation_sheets s on s.employee_id = c.employee_id and s.period_id = v_period;

  -- 例外は、この取込の書き込みが済んだらすぐ消す(同じトランザクションの後の書き込みに残さない)
  delete from public.privileged_sheet_context where transaction_id = txid_current();

  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'sheets.imported', v_period, summary || jsonb_build_object(
    'periodId', v_period,
    'periodState', case when closed then 'closed' else 'active' end,
    'replaced', replaced));
  return jsonb_build_object('errors', errors, 'summary', summary, 'applied', true);
end;
$$;
revoke all on function public.import_sheet_data(bigint, jsonb, jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.import_sheet_data(bigint, jsonb, jsonb, boolean, boolean) to authenticated, service_role;

-- 遡及処理の印を、クライアントが立てられる GUC(typa.correcting_sheet)から privileged_sheet_context に移す。
-- これまでは本人が自分のセッションでこの GUC を立てると、締めた評価期間に残った下書きへ目標を足せた
-- (締めた評価期間のトリガーが、この GUC を遡及処理の印として信じていた)。
create or replace function public.require_active_evaluation_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  privileged_target bigint;
  sheet_ids bigint[];
  period_ids bigint[];
  active_periods integer;
begin
  if tg_table_name = 'evaluation_sheets' then
    privileged_target := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    privileged_target := case when tg_op = 'DELETE' then old.sheet_id else new.sheet_id end;
  end if;
  -- Admin の RPC(遡及処理・特権操作・取込)が、このトランザクションの間だけ例外にしたシート
  if public.is_privileged_sheet_operation(privileged_target) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'evaluation_sheets' then
    if tg_op <> 'INSERT' then period_ids := period_ids || old.period_id; sheet_ids := sheet_ids || old.id; end if;
    if tg_op <> 'DELETE' then period_ids := period_ids || new.period_id; sheet_ids := sheet_ids || new.id; end if;
  else
    if tg_op <> 'INSERT' then sheet_ids := sheet_ids || old.sheet_id::bigint; end if;
    if tg_op <> 'DELETE' then sheet_ids := sheet_ids || new.sheet_id::bigint; end if;
    select array_agg(sheet.period_id) into period_ids
    from public.evaluation_sheets sheet where sheet.id = any(sheet_ids);
  end if;

  select count(*) into active_periods from (
    select 1 from public.evaluation_periods period
    where period.id = any(period_ids) and period.is_active
    for share
  ) locked;
  if active_periods < (select count(distinct changed) from unnest(period_ids) as changed) then
    raise exception '締められた評価期間の評価シートは変更できません。' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.require_active_evaluation_period() from public, anon, authenticated;

-- correct_closed_sheet は長いので、印を立てる・消す2行だけを置き換える(ほかは 202611060001 のまま)
do $migration$
declare
  definition text;
  set_mark constant text := 'perform set_config(''typa.correcting_sheet'', sheet.id::text, true);';
  clear_mark constant text := 'perform set_config(''typa.correcting_sheet'', '''', true);';
begin
  select pg_catalog.pg_get_functiondef('public.correct_closed_sheet(bigint,jsonb,text)'::regprocedure)
  into definition;
  if (char_length(definition) - char_length(replace(definition, set_mark, ''))) / char_length(set_mark) <> 1
     or (char_length(definition) - char_length(replace(definition, clear_mark, ''))) / char_length(clear_mark) <> 1
     or definition like '%privileged_sheet_context%' then
    raise exception 'Unexpected correct_closed_sheet definition; expected exactly one set and one clear of typa.correcting_sheet.';
  end if;
  definition := replace(definition, set_mark,
    'insert into public.privileged_sheet_context (transaction_id, sheet_id) values (txid_current(), sheet.id) on conflict do nothing;');
  definition := replace(definition, clear_mark,
    'delete from public.privileged_sheet_context where transaction_id = txid_current() and sheet_id = sheet.id;');
  execute definition;
end;
$migration$;

commit;
