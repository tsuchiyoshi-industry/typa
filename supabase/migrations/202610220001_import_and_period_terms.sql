-- 導入処理と、評価期間の解像度・締めのあいまいさ。
--
-- 0. 期(年度)と評価期間: evaluation_periods に、どの期(term_name)のどの区切り(division / part)かを持たせる。
--   期を半期・四半期に分けた評価期間はそれぞれ独立していて、シートを作り、評価し、締める単位のまま。
--   period_name は「26期 上期」のように期の名前と区切りから決まる(アプリの EvaluationPeriodPlan が付ける)。
--   既存の評価期間と、期の名前を省いた追加は、通年(full / 1)で期の名前 = 評価期間の名前になる。
--   評価期間の状態は 未開始 → 実施中 → 締め済み(closed_at)。締めた評価期間は、もう一度開始できない
--   (これまでの「元の期間をもう一度開始して締めを取り消す」はできなくなる)。
-- 1. データ取込: Admin が実施中の評価期間の目標・共通評価・点数を CSV から入れる。
--   * 先に全行を確かめ、誤りが1件でもあれば何も書かずに、ファイルと行番号つきの誤りをすべて返す。
--   * シートは下書きのまま作る・置き換える。状態を変えないので、通知メールは1通も出ない。
--   * 提出済み以降のシートがある社員は取り込めない(評価の途中の内容を上書きしない)。
-- 2. 締めのあいまいさの許容:
--   * evaluation_periods.allow_unfinalized_close: 評価が確定していないシートが残っていても締めてよい期間
--     (初めは false)。例: 正式運用の前の期に目標だけを取り込み、評価せずに締める。
--   * 締めた期間のシートは内容がもう変わらないので、下書きのままでも評価者が読める
--     (今の評価者が確定したシートを読めるのと同じく、締めたシートも読める)。
-- 3. 前の評価期間の目標の引き継ぎ:
--   * milestones.carried_from_id: 前の評価期間の目標から引き継いだ目標。get_previous_goals が前の評価期間の
--     目標と引き継ぎ済みかを返し、carry_over_goal で本人が下書きに引き継ぐ。
--   * 前の評価期間は、その評価期間が始まる前に終わった評価期間のうち、いちばん新しいもの(アプリの
--     EvaluationCalendar.previousOf と同じ)。下期なら当期の上期、上期なら前期の下期。その評価期間に
--     本人のシートが無ければ、前の評価期間の目標も無い(さらに前の評価期間のシートは見ない)。
-- 4. 遡及処理: 締めた評価期間を開き直さず、Admin が締めたシートの項目を個別に直し、直したことを
--   消えない記録(sheet_corrections)に残す。本人・評価者にはシートで「締め後修正」として見せる。
-- 関数はすべて create or replace なので、もう一度当てても同じ結果になる。
-- Apply after 202610210001.
begin;

-- 0. 期(年度)と評価期間 ------------------------------------------------------------------

-- 評価期間の状態は 未開始 → 実施中 → 締め済み。締めた時を残し、締めた評価期間は二度と開始しない。
-- これまでは「実施中でない」としか分からず、締めた評価期間も未開始の評価期間と同じに見えていた。
alter table public.evaluation_periods add column if not exists closed_at timestamptz;
comment on column public.evaluation_periods.closed_at is '締めた日時。null なら未開始か実施中。activate_evaluation_period だけが入れる。';
-- 既存の評価期間: 実施中でなく、シートがあるか、実施中の評価期間より前に終わったものは締め済み
update public.evaluation_periods as period set closed_at = now()
where not period.is_active and period.closed_at is null and (
  exists (select 1 from public.evaluation_sheets as sheet where sheet.period_id = period.id)
  or period.end_date < (select active.start_date from public.evaluation_periods as active where active.is_active));
alter table public.evaluation_periods drop constraint if exists evaluation_periods_active_not_closed_check;
alter table public.evaluation_periods add constraint evaluation_periods_active_not_closed_check
  check (not (is_active and closed_at is not null));

alter table public.evaluation_periods
  add column if not exists term_name text,
  add column if not exists division text not null default 'full',
  add column if not exists part smallint not null default 1;
update public.evaluation_periods set term_name = period_name where term_name is null;
comment on column public.evaluation_periods.term_name is '期(年度)の名前。同じ期の評価期間(上期と下期など)は同じ名前。';
comment on column public.evaluation_periods.division is '期の区切り方。full(通年) / half(半期) / quarter(四半期)。';
comment on column public.evaluation_periods.part is '期のどの区切りか(1 から)。半期なら 1 が上期、2 が下期。';

-- 期の名前を省いた追加(これまでのアプリや、期を使わない環境)は、評価期間の名前を期の名前にする。
-- これまでのアプリが通年の評価期間の名前だけを変えたときは、期の名前も合わせる。
create or replace function public.fill_evaluation_period_term()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.division = 'full'
     and new.period_name is distinct from old.period_name
     and new.term_name is not distinct from old.term_name then
    new.term_name := new.period_name;
  end if;
  new.term_name := coalesce(nullif(btrim(new.term_name), ''), new.period_name);
  return new;
end;
$$;
revoke all on function public.fill_evaluation_period_term() from public, anon, authenticated;
drop trigger if exists evaluation_periods_fill_term on public.evaluation_periods;
create trigger evaluation_periods_fill_term
  before insert or update of term_name, period_name on public.evaluation_periods
  for each row execute function public.fill_evaluation_period_term();

alter table public.evaluation_periods alter column term_name set not null;
-- アプリの TermName と同じ決まり。DB が受け付けた行は、アプリが必ず読める(1行の不正で一覧が開けなくならない)
alter table public.evaluation_periods drop constraint if exists evaluation_periods_term_name_check;
alter table public.evaluation_periods add constraint evaluation_periods_term_name_check
  check (char_length(btrim(term_name)) between 1 and 40);
alter table public.evaluation_periods drop constraint if exists evaluation_periods_division_part_check;
alter table public.evaluation_periods add constraint evaluation_periods_division_part_check check (
  (division = 'full' and part = 1)
  or (division = 'half' and part between 1 and 2)
  or (division = 'quarter' and part between 1 and 4));
grant insert (term_name, division, part), update (term_name)
  on public.evaluation_periods to authenticated;

-- 1. データ取込 ----------------------------------------------------------------------------

create or replace function public.get_sheet_import_template()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare period public.evaluation_periods%rowtype;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  select * into period from public.evaluation_periods where is_active;
  if not found then
    raise exception '実施中の評価期間がありません。先に「設定」で評価期間を始めてください。' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'periodName', period.period_name,
    'maxGoals', (select max_challenge_goals from public.evaluation_settings),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeNo', e.employee_no, 'name', e.name,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title) order by i.id)
          from public.common_evaluation_items i
          where i.item_set_id is null or i.item_set_id = g.item_set_id), '[]'::jsonb)
      ) order by e.employee_no)
      from public.employees e
      left join public.employee_grades g on g.id = e.grade_id
      where e.is_enabled and not exists (
        select 1 from public.evaluation_sheets s
        where s.employee_id = e.id and s.period_id = period.id and s.status <> 'draft')
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_sheet_import_template() from public, anon, authenticated;
grant execute on function public.get_sheet_import_template() to authenticated;

-- p_goals:  [{line, employeeNo, name, goalNumber, challengeGoal, midtermGoal, achievement, firstScore, secondScore}]
-- p_common: [{line, employeeNo, name, itemId, itemTitle, firstScore, secondScore, comment}]
-- 数値の列も CSV のままの文字列で受け取り、ここで確かめる。内容がすべて空欄の行は無視する。
-- p_apply が false なら確かめるだけ。
create or replace function public.import_sheet_data(p_goals jsonb, p_common jsonb, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_period bigint;
  max_goals integer;
  errors jsonb;
  goal_ids integer[];
  common_ids integer[];
  summary jsonb;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  select id into v_period from public.evaluation_periods where is_active;
  if not found then
    raise exception '実施中の評価期間がありません。先に「設定」で評価期間を始めてください。' using errcode = 'P0002';
  end if;
  select max_challenge_goals into max_goals from public.evaluation_settings;
  -- 確かめてから書くまでの間に、提出されたり作られたりしないようにする
  if p_apply then
    perform 1 from public.evaluation_sheets where period_id = v_period order by id for update;
  end if;

  create temp table import_goals on commit drop as
  select r.line, trim(coalesce(r."employeeNo", '')) as employee_no, trim(coalesce(r.name, '')) as name,
         trim(coalesce(r."goalNumber", '')) as goal_number,
         coalesce(r."challengeGoal", '') as challenge_goal, coalesce(r."midtermGoal", '') as midterm_goal,
         coalesce(r.achievement, '') as achievement,
         trim(coalesce(r."firstScore", '')) as first_score, trim(coalesce(r."secondScore", '')) as second_score,
         e.id as employee_id, e.name as master_name, e.no_secondary_evaluator, s.status as sheet_status
  from jsonb_to_recordset(coalesce(p_goals, '[]')) as r(line integer, "employeeNo" text, name text,
         "goalNumber" text, "challengeGoal" text, "midtermGoal" text, achievement text,
         "firstScore" text, "secondScore" text)
  left join public.employees e on e.employee_no = trim(r."employeeNo") and e.is_enabled
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = v_period
  where concat(r."challengeGoal", r."midtermGoal", r.achievement, r."firstScore", r."secondScore") ~ '[^[:space:]]';

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
   and (i.item_set_id is null or i.item_set_id = g.item_set_id)
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
               then 'この社員の、実施中の評価期間の評価シートは提出済みのため、取り込めません。' end),
      (4, case when number is null or number not between 1 and max_goals
               then format('目標番号は 1〜%s の数字で入力してください(「%s」)。', max_goals, goal_number)
               when employee_id is not null and line <> first_line
               then format('目標番号 %s が %s行目と重複しています。', number, first_line) end),
      (5, case when challenge_goal !~ '[^[:space:]]' then 'チャレンジ目標が空欄です。' end),
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
               then 'この社員の、実施中の評価期間の評価シートは提出済みのため、取り込めません。' end),
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
    'periodName', (select period_name from public.evaluation_periods where id = v_period),
    'employees', count(*),
    'newSheets', count(*) filter (where s.id is null),
    'replacedSheets', count(*) filter (where s.id is not null),
    'goals', (select count(*) from import_goals),
    'commonResults', (select count(*) from import_common))
  into summary
  from (select unnest(goal_ids) union select unnest(common_ids)) as target(employee_id)
  left join public.evaluation_sheets s on s.employee_id = target.employee_id and s.period_id = v_period;

  if errors <> '[]' or not p_apply then
    return jsonb_build_object('errors', errors, 'summary', summary, 'applied', false);
  end if;

  -- 等級と評価者は、シートを作るときのトリガーが社員マスタから入れる
  insert into public.evaluation_sheets (period_id, employee_id)
  select v_period, employee_id from (select unnest(goal_ids) union select unnest(common_ids)) as target(employee_id)
  on conflict (period_id, employee_id) do nothing;

  delete from public.milestones m using public.evaluation_sheets s
  where m.sheet_id = s.id and s.period_id = v_period and s.employee_id = any (goal_ids);
  insert into public.milestones (sheet_id, goal_number, challenge_goal, midterm_goal, achievement, first_score, second_score)
  select s.id, g.goal_number::integer, g.challenge_goal, g.midterm_goal, g.achievement,
         coalesce(nullif(g.first_score, '')::integer, 0), coalesce(nullif(g.second_score, '')::integer, 0)
  from import_goals g join public.evaluation_sheets s on s.employee_id = g.employee_id and s.period_id = v_period;

  delete from public.common_evaluation_results r using public.evaluation_sheets s
  where r.sheet_id = s.id and s.period_id = v_period and s.employee_id = any (common_ids);
  insert into public.common_evaluation_results (sheet_id, item_id, first_score, second_score, first_comment)
  select s.id, c.item, coalesce(nullif(c.first_score, '')::integer, 0),
         coalesce(nullif(c.second_score, '')::integer, 0), c.comment
  from import_common c join public.evaluation_sheets s on s.employee_id = c.employee_id and s.period_id = v_period;

  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'sheets.imported', v_period, summary);
  return jsonb_build_object('errors', errors, 'summary', summary, 'applied', true);
end;
$$;
revoke all on function public.import_sheet_data(jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_sheet_data(jsonb, jsonb, boolean) to authenticated;

-- 2. 締めのあいまいさの許容 / 3. 前の評価期間の目標の引き継ぎ ---------------------------------

alter table public.evaluation_periods
  add column if not exists allow_unfinalized_close boolean not null default false;
comment on column public.evaluation_periods.allow_unfinalized_close
  is 'Admin が決める。true なら、評価が確定していないシートが残っていても締められる。';
grant insert (allow_unfinalized_close), update (allow_unfinalized_close)
  on public.evaluation_periods to authenticated;

-- As in 202610080008, but a period that allows it closes with unfinalized sheets left, the closed
-- period records when it was closed, and a closed period is never started again (no undo by reopening).
create or replace function public.activate_evaluation_period(p_period_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.current_employee_is_admin() then
    raise exception 'Only Admin can close an evaluation period' using errcode = '42501';
  end if;

  -- Lock every period first, so two concurrent switches cannot interleave.
  perform 1 from public.evaluation_periods order by id for update;
  if not exists (select 1 from public.evaluation_periods where id = p_period_id) then
    return false;
  end if;
  -- 締めた評価期間は、もう一度開始しない(実施中の評価期間を指定し直すだけなら何も変わらない)
  if exists (select 1 from public.evaluation_periods where id = p_period_id and closed_at is not null) then
    raise exception '締めた評価期間は、もう一度開始できません。' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.evaluation_sheets sheet
    join public.evaluation_periods period on period.id = sheet.period_id
    where period.is_active and period.id <> p_period_id and not period.allow_unfinalized_close
      and sheet.status <> 'finalized'
  ) then
    raise exception '未確定の評価シートが残っているため、評価期間を締められません。' using errcode = '23514';
  end if;

  update public.evaluation_periods set is_active = false, closed_at = now()
  where is_active and id <> p_period_id;
  update public.evaluation_periods set is_active = true where id = p_period_id and not is_active;
  return true;
end;
$$;

-- As in 202610210001, plus the period's allowUnfinalizedClose, and closed sheets readable by evaluators.
-- シートの中身。見せてよい範囲は呼ぶ側(get_sheet / get_sheet_for_correction)が決める。
create or replace function public.sheet_document(
  p_sheet_id bigint, p_sees_content boolean, p_sees_first boolean, p_sees_second boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  sheet public.evaluation_sheets%rowtype;
  finalized boolean;
  sees_content boolean := p_sees_content;
  sees_first boolean := p_sees_first;
  sees_second boolean := p_sees_second;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  if sheet.id is null then
    return null;
  end if;
  finalized := sheet.status = 'finalized';
  return jsonb_build_object(
    'id', sheet.id, 'status', sheet.status, 'gradeId', sheet.grade_id,
    'gradeName', (select grade_name from public.employee_grades where id = sheet.grade_id),
    'subject', (
      select jsonb_build_object(
        'id', subject.id, 'name', subject.name, 'employeeNo', subject.employee_no,
        'roleId', subject.role_id, 'careerCourse', subject.career_course)
      from public.employees as subject where subject.id = sheet.employee_id),
    'currentEvaluatorIds', (
      select to_jsonb(array_remove(array[subject.primary_evaluator_id, subject.secondary_evaluator_id], null))
      from public.employees as subject where subject.id = sheet.employee_id),
    'primaryEvaluatorId', sheet.primary_evaluator_id,
    'secondaryEvaluatorId', sheet.secondary_evaluator_id,
    'noSecondaryEvaluator', coalesce(sheet.no_secondary_evaluator, false),
    'primaryEvaluatorName', (select name from public.employees where id = sheet.primary_evaluator_id),
    'secondaryEvaluatorName', (select name from public.employees where id = sheet.secondary_evaluator_id),
    'period', (
      select jsonb_build_object(
        'id', period.id, 'periodName', period.period_name, 'startDate', period.start_date,
        'endDate', period.end_date, 'isActive', period.is_active,
        'termName', period.term_name, 'division', period.division, 'part', period.part,
        'isClosed', period.closed_at is not null,
        'allowUnfinalizedClose', period.allow_unfinalized_close)
      from public.evaluation_periods as period where period.id = sheet.period_id),
    'firstOverallComment', case when sees_first then coalesce(sheet.first_overall_comment, '') else '' end,
    'secondOverallComment', case when sees_second then coalesce(sheet.second_overall_comment, '') else '' end,
    'firstRank', case when sees_first and sheet.status in ('first_evaluated', 'finalized') then sheet.first_rank end,
    'finalRankLetter', case when finalized then sheet.final_rank_letter end,
    'finalRankLevel', case when finalized then sheet.final_rank_level end,
    -- Totals are stored when scores are saved; only a finalized sheet reads them back.
    'stored', case when finalized then jsonb_build_object(
      'objectivesFirstTotalScore', sheet.objectives_first_total_score,
      'objectivesFirstTotalRate', sheet.objectives_first_total_rate,
      'objectivesSecondTotalScore', sheet.objectives_second_total_score,
      'objectivesSecondTotalRate', sheet.objectives_second_total_rate,
      'commonEvaluationFirstTotalScore', sheet.common_evaluation_first_total_score,
      'commonEvaluationFirstTotalRate', sheet.common_evaluation_first_total_rate,
      'commonEvaluationSecondTotalScore', sheet.common_evaluation_second_total_score,
      'commonEvaluationSecondTotalRate', sheet.common_evaluation_second_total_rate,
      'objectivesSecondEvaluationScore', sheet.objectives_second_evaluation_score,
      'commonEvaluationSecondEvaluationScore', sheet.common_evaluation_second_evaluation_score,
      'totalEvaluationScore', sheet.total_evaluation_score,
      'objectiveAllocation', sheet.objective_allocation,
      'commonAllocation', sheet.common_allocation
    ) else '{}'::jsonb end,
    'objectives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', goal.id, 'goalNumber', goal.goal_number,
        'challengeGoal', coalesce(goal.challenge_goal, ''),
        'midtermGoal', coalesce(goal.midterm_goal, ''),
        'achievement', coalesce(goal.achievement, ''),
        'firstScore', case when sees_first then coalesce(goal.first_score, 0) else 0 end,
        'secondScore', case when sees_second then coalesce(goal.second_score, 0) else 0 end
      ) order by goal.goal_number, goal.id)
      from public.milestones as goal where goal.sheet_id = sheet.id and sees_content
    ), '[]'::jsonb),
    -- One entry per item of the sheet's grade, whether or not a result has been saved (id null).
    'commonResults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', result.id, 'itemId', item.id, 'title', item.title, 'description', item.description,
        'weight', item.weight, 'itemSetId', item.item_set_id,
        'firstScore', case when sees_first then coalesce(result.first_score, 0) else 0 end,
        'secondScore', case when sees_second then coalesce(result.second_score, 0) else 0 end,
        'firstComment', case when sees_first then coalesce(result.first_comment, '') else '' end
      ) order by item.id)
      from public.common_evaluation_items as item
      left join public.common_evaluation_results as result
        on result.item_id = item.id and result.sheet_id = sheet.id
      where item.item_set_id is null
         or item.item_set_id = (select item_set_id from public.employee_grades where id = sheet.grade_id)
    ), '[]'::jsonb),
    'allocation', (
      select jsonb_build_object('objective', objective_allocation, 'common', common_allocation)
      from public.evaluation_settings),
    'maxChallengeGoals', (select max_challenge_goals from public.evaluation_settings),
    -- 締め後修正(遡及処理)。修正した項目を見られる人にだけ返す
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', correction.id, 'target', correction.target, 'goalNumber', correction.goal_number,
        'itemTitle', correction.item_title, 'field', correction.field,
        'before', correction.before_value, 'after', correction.after_value,
        'reason', correction.reason, 'correctedAt', correction.corrected_at
      ) order by correction.corrected_at, correction.id)
      from public.sheet_corrections as correction
      where correction.sheet_id = sheet.id and case
        when correction.field in ('challenge_goal', 'midterm_goal', 'achievement') then sees_content
        when correction.field in ('first_score', 'first_comment', 'first_overall_comment') then sees_first
        when correction.field in ('second_score', 'second_overall_comment') then sees_second
        else false end
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.sheet_document(bigint, boolean, boolean, boolean) from public, anon, authenticated;

create or replace function public.get_sheet(p_sheet_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
  is_subject boolean;
  is_secondary boolean;
  finalized boolean;
  sees_content boolean;
  sees_first boolean;
  sees_second boolean;
  closed boolean;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  select not is_active into closed from public.evaluation_periods where id = sheet.period_id;
  if sheet.id is null or me is null
    or not (coalesce(me in (sheet.employee_id, sheet.primary_evaluator_id, sheet.secondary_evaluator_id), false)
            or ((sheet.status = 'finalized' or closed) and public.is_current_evaluator_of(sheet.employee_id::integer)))
  then
    return null;
  end if;

  is_subject := sheet.employee_id = me;
  is_secondary := not is_subject and coalesce(sheet.secondary_evaluator_id = me, false);
  finalized := sheet.status = 'finalized';
  -- An evaluator gets a draft without its content, until its period is closed and it no longer changes.
  sees_content := is_subject or sheet.status <> 'draft' or closed;
  sees_first := sees_content and (finalized or not is_subject);
  sees_second := sees_content and (finalized or is_secondary);

  return public.sheet_document(sheet.id, sees_content, sees_first, sees_second);
end;
$$;

-- 引き継ぎ元。外部キーにはしない(古い期間を開き直して元の目標を消しても、締めたシートを書き換えない)。
alter table public.milestones add column if not exists carried_from_id bigint;
create unique index if not exists milestones_sheet_carried_from_key
  on public.milestones (sheet_id, carried_from_id) where carried_from_id is not null;

-- 前の評価期間: 始まる前に終わった評価期間のうち、終了日・開始日・id の順にいちばん新しいもの。
create or replace function public.previous_evaluation_period(p_period_id bigint)
returns bigint language sql stable security definer set search_path = '' as $$
  select previous.id
  from public.evaluation_periods as period
  join public.evaluation_periods as previous on previous.end_date < period.start_date
  where period.id = p_period_id
  order by previous.end_date desc, previous.start_date desc, previous.id desc
  limit 1
$$;
revoke all on function public.previous_evaluation_period(bigint) from public, anon, authenticated;

-- その社員の、前の評価期間のシート。前の評価期間にシートが無ければ null(さらに前は見ない)。
create or replace function public.previous_evaluation_sheet(p_sheet_id bigint)
returns bigint language sql stable security definer set search_path = '' as $$
  select previous.id
  from public.evaluation_sheets as sheet
  join public.evaluation_sheets as previous
    on previous.employee_id = sheet.employee_id
   and previous.period_id = public.previous_evaluation_period(sheet.period_id)
  where sheet.id = p_sheet_id
$$;
revoke all on function public.previous_evaluation_sheet(bigint) from public, anon, authenticated;

-- 前の評価期間の目標(文言だけ。点数は返さない)と、このシートに引き継いだかどうか。前の評価期間のシートがなければ null。
-- 読めるのは本人と、このシートの内容を見られる評価者。
create or replace function public.get_previous_goals(p_sheet_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
  previous public.evaluation_sheets%rowtype;
  previous_period public.evaluation_periods%rowtype;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id;
  if sheet.id is null or me is null or not (
    sheet.employee_id = me
    or (coalesce(me in (sheet.primary_evaluator_id, sheet.secondary_evaluator_id), false)
        and sheet.status <> 'draft')
  ) then
    return null;
  end if;
  select * into previous from public.evaluation_sheets
  where id = public.previous_evaluation_sheet(sheet.id);
  if not found then
    return null;
  end if;
  select * into previous_period from public.evaluation_periods where id = previous.period_id;
  -- 評価者には、まだ書きかけの前の評価期間の下書きを見せない
  if sheet.employee_id <> me and previous.status = 'draft' and previous_period.is_active then
    return null;
  end if;
  return jsonb_build_object(
    'periodName', previous_period.period_name,
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', goal.id, 'goalNumber', goal.goal_number,
        'challengeGoal', coalesce(goal.challenge_goal, ''),
        'midtermGoal', coalesce(goal.midterm_goal, ''),
        'achievement', coalesce(goal.achievement, ''),
        'carried', exists (
          select 1 from public.milestones as carried
          where carried.sheet_id = sheet.id and carried.carried_from_id = goal.id)
      ) order by goal.goal_number, goal.id)
      from public.milestones as goal where goal.sheet_id = previous.id
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_previous_goals(bigint) from public, anon, authenticated;
grant execute on function public.get_previous_goals(bigint) to authenticated;

-- 本人が、前の評価期間の目標を自分の下書きに引き継ぐ。チャレンジ目標の文言だけを写し、空いている
-- いちばん小さい目標番号に入れる。引き継いだ目標を消せば、引き継ぐ前に戻る。
create or replace function public.carry_over_goal(p_sheet_id bigint, p_goal_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me integer := public.current_employee_id();
  sheet public.evaluation_sheets%rowtype;
  source public.milestones%rowtype;
  max_goals integer;
  next_number integer;
  created bigint;
begin
  select * into sheet from public.evaluation_sheets where id = p_sheet_id for update;
  if sheet.id is null or me is null or sheet.employee_id <> me or sheet.status <> 'draft' then
    raise exception '前の評価期間の目標を引き継げるのは、本人の下書きの評価シートだけです。' using errcode = '42501';
  end if;
  select * into source from public.milestones
  where id = p_goal_id and sheet_id = public.previous_evaluation_sheet(sheet.id);
  if not found then
    raise exception '前の評価期間の目標が見つかりません。' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.milestones where sheet_id = sheet.id and carried_from_id = source.id) then
    raise exception 'この目標はすでに引き継いでいます。' using errcode = '23505';
  end if;
  select max_challenge_goals into max_goals from public.evaluation_settings;
  select min(n) into next_number from generate_series(1, max_goals) as n
  where not exists (select 1 from public.milestones where sheet_id = sheet.id and goal_number = n);
  if next_number is null then
    raise exception 'チャレンジ目標は % 件までです。引き継ぐ前に、この評価期間の目標を減らしてください。', max_goals
      using errcode = '23514';
  end if;
  -- 期間が実施中かは、目標のトリガーが確かめる
  insert into public.milestones (sheet_id, goal_number, challenge_goal, carried_from_id)
  values (sheet.id, next_number, source.challenge_goal, source.id)
  returning id into created;
  return created;
end;
$$;
revoke all on function public.carry_over_goal(bigint, bigint) from public, anon, authenticated;
grant execute on function public.carry_over_goal(bigint, bigint) to authenticated;

-- 4. 遡及処理(締め後修正) ------------------------------------------------------------------
-- 締めた評価期間を開き直すことはしない。Admin が遡及処理の画面から、締めたシートの項目を
-- 1つずつ直し、直した内容(前後の値・理由・日時・誰が)を消えない記録として残す。
create table if not exists public.sheet_corrections (
  id bigint generated always as identity primary key,
  sheet_id bigint not null references public.evaluation_sheets(id) on delete restrict,
  target text not null check (target in ('goal', 'common', 'sheet')),
  -- goal は milestones.id、common は common_evaluation_items.id、sheet は null
  target_id bigint,
  -- 表示用に、修正した時点の目標番号・項目名を残す
  goal_number integer,
  item_title text,
  field text not null check (field in (
    'challenge_goal', 'midterm_goal', 'achievement', 'first_score', 'second_score',
    'first_comment', 'first_overall_comment', 'second_overall_comment')),
  before_value text not null default '',
  after_value text not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  corrected_by integer references public.employees(id),
  corrected_at timestamptz not null default now()
);
comment on table public.sheet_corrections is '締め後修正(遡及処理)の記録。追記だけで、変更も削除もしない。読むのは get_sheet などの関数から。';
alter table public.sheet_corrections enable row level security;
revoke all on public.sheet_corrections from public, anon, authenticated;
create index if not exists sheet_corrections_sheet_idx on public.sheet_corrections (sheet_id);

-- 締めた評価期間のシートは変更できない。ただし遡及処理(correct_closed_sheet)が、
-- 同じトランザクションの中で、その1枚のシートを書き換えるときだけは通す。
create or replace function public.require_active_evaluation_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  sheet_ids bigint[];
  period_ids bigint[];
  active_periods integer;
  correcting text := coalesce(current_setting('typa.correcting_sheet', true), '');
begin
  if tg_table_name = 'evaluation_sheets' then
    if tg_op <> 'INSERT' then period_ids := period_ids || old.period_id; sheet_ids := sheet_ids || old.id; end if;
    if tg_op <> 'DELETE' then period_ids := period_ids || new.period_id; sheet_ids := sheet_ids || new.id; end if;
  else
    if tg_op <> 'INSERT' then sheet_ids := sheet_ids || old.sheet_id::bigint; end if;
    if tg_op <> 'DELETE' then sheet_ids := sheet_ids || new.sheet_id::bigint; end if;
    select array_agg(sheet.period_id) into period_ids
    from public.evaluation_sheets sheet where sheet.id = any(sheet_ids);
  end if;

  if correcting <> '' and tg_op = 'UPDATE' or correcting <> '' and tg_op = 'INSERT' and tg_table_name <> 'evaluation_sheets' then
    if not exists (select 1 from unnest(sheet_ids) as changed where changed::text <> correcting) then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
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

-- 点数を直したシートの集計とランクを、確定のとき(freeze_evaluation_totals)と同じ式で出し直す。
-- 配点は確定したときのもの(確定していない一次評価済みのシートは、今の設定)。
create or replace function public.recalculate_corrected_sheet(p_sheet_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.evaluation_sheets%rowtype;
  goal_first numeric; goal_second numeric; goal_max numeric; common_first numeric; common_second numeric; common_max numeric;
  oa integer; ca integer; primary_final boolean; primary_score integer; total integer;
begin
  select * into s from public.evaluation_sheets where id = p_sheet_id;
  if s.status not in ('first_evaluated', 'finalized') then
    return;
  end if;
  select coalesce(sum(first_score), 0), coalesce(sum(second_score), 0), count(*) * 4
    into goal_first, goal_second, goal_max from public.milestones where sheet_id = s.id;
  select coalesce(sum(i.weight * coalesce(r.first_score, 0)), 0),
         coalesce(sum(i.weight * coalesce(r.second_score, 0)), 0), coalesce(sum(i.weight * 4), 0)
    into common_first, common_second, common_max from public.common_evaluation_items i
    left join public.common_evaluation_results r on r.item_id = i.id and r.sheet_id = s.id
    left join public.employee_grades g on g.id = s.grade_id
    where i.item_set_id is null or i.item_set_id = g.item_set_id;
  select coalesce(s.objective_allocation, objective_allocation), coalesce(s.common_allocation, common_allocation)
    into oa, ca from public.evaluation_settings;
  primary_final := s.no_secondary_evaluator and s.secondary_evaluator_id is null;
  primary_score := coalesce(round(goal_first * oa / nullif(goal_max, 0)), 0) + coalesce(round(common_first * ca / nullif(common_max, 0)), 0);
  update public.evaluation_sheets set first_rank = public.evaluation_rank(primary_score) where id = s.id;
  if s.status = 'finalized' then
    if primary_final then goal_second := goal_first; common_second := common_first; end if;
    total := coalesce(round(goal_second * oa / nullif(goal_max, 0)), 0) + coalesce(round(common_second * ca / nullif(common_max, 0)), 0);
    update public.evaluation_sheets set
      objectives_first_total_score = goal_first,
      objectives_first_total_rate = coalesce(round(goal_first * 100 / nullif(goal_max, 0)), 0),
      common_evaluation_first_total_score = common_first,
      common_evaluation_first_total_rate = coalesce(round(common_first * 100 / nullif(common_max, 0)), 0),
      objectives_second_total_score = goal_second,
      objectives_second_total_rate = coalesce(round(goal_second * 100 / nullif(goal_max, 0)), 0),
      common_evaluation_second_total_score = common_second,
      common_evaluation_second_total_rate = coalesce(round(common_second * 100 / nullif(common_max, 0)), 0),
      objectives_second_evaluation_score = coalesce(round(goal_second * oa / nullif(goal_max, 0)), 0),
      common_evaluation_second_evaluation_score = coalesce(round(common_second * ca / nullif(common_max, 0)), 0),
      total_evaluation_score = total,
      objective_allocation = oa, common_allocation = ca,
      final_rank_letter = left(public.evaluation_rank(total), 1),
      final_rank_level = case right(public.evaluation_rank(total), 1)
        when '+' then 'plus' when '-' then 'minus' else 'none' end
    where id = s.id;
  end if;
end;
$$;
revoke all on function public.recalculate_corrected_sheet(bigint) from public, anon, authenticated;

-- Admin が修正の前に、締めたシートの中身をすべて読む。
create or replace function public.get_sheet_for_correction(p_sheet_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.evaluation_sheets s join public.evaluation_periods p on p.id = s.period_id
    where s.id = p_sheet_id and p.closed_at is not null) then
    raise exception '遡及処理で修正できるのは、締め済みの評価期間のシートだけです。' using errcode = '23514';
  end if;
  return public.sheet_document(p_sheet_id, true, true, true);
end;
$$;
revoke all on function public.get_sheet_for_correction(bigint) from public, anon, authenticated;
grant execute on function public.get_sheet_for_correction(bigint) to authenticated;

-- 遡及処理。p_changes: [{target: goal|common|sheet, targetId, field, value}]。すべて直すか、何も直さない。
create or replace function public.correct_closed_sheet(p_sheet_id bigint, p_changes jsonb, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  sheet public.evaluation_sheets%rowtype;
  period public.evaluation_periods%rowtype;
  change jsonb;
  target text; field text; value text; target_id bigint;
  before text; goal_no integer; title text;
  reason text := btrim(coalesce(p_reason, ''));
  score_changed boolean := false;
  applied integer := 0;
begin
  if not public.current_employee_is_admin() then
    raise exception 'Admin のみ操作できます。' using errcode = '42501';
  end if;
  select * into sheet from public.evaluation_sheets where id = p_sheet_id for update;
  if not found then
    raise exception '評価シートが見つかりません。' using errcode = 'P0002';
  end if;
  select * into period from public.evaluation_periods where id = sheet.period_id;
  if period.closed_at is null then
    raise exception '遡及処理で修正できるのは、締め済みの評価期間のシートだけです。' using errcode = '23514';
  end if;
  if char_length(reason) not between 1 and 500 then
    raise exception '修正の理由を 500 文字以内で入力してください。' using errcode = '23514';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception '修正する項目がありません。' using errcode = '23514';
  end if;

  perform set_config('typa.correcting_sheet', sheet.id::text, true);
  for change in select * from jsonb_array_elements(p_changes) loop
    target := change ->> 'target';
    field := change ->> 'field';
    value := coalesce(change ->> 'value', '');
    target_id := case when (change ->> 'targetId') ~ '^[0-9]{1,18}$' then (change ->> 'targetId')::bigint end;
    goal_no := null; title := null;

    if field in ('first_score', 'second_score') then
      if value !~ '^[1-4]$' then
        raise exception '点数は 1〜4 で入力してください。' using errcode = '23514';
      end if;
      if field = 'second_score' and sheet.no_secondary_evaluator and sheet.secondary_evaluator_id is null then
        raise exception '二次評価者を置かないシートには、二次評価点はありません。' using errcode = '23514';
      end if;
      score_changed := true;
    elsif char_length(value) > 2000 then
      raise exception '文章は 2000 文字以内で入力してください。' using errcode = '23514';
    end if;

    if target = 'goal' and field in ('challenge_goal', 'midterm_goal', 'achievement', 'first_score', 'second_score') then
      select goal_number, case field
          when 'challenge_goal' then coalesce(challenge_goal, '') when 'midterm_goal' then coalesce(midterm_goal, '')
          when 'achievement' then coalesce(achievement, '') when 'first_score' then coalesce(first_score, 0)::text
          else coalesce(second_score, 0)::text end
        into goal_no, before
      from public.milestones where id = target_id and sheet_id = sheet.id;
      if not found then
        raise exception 'このシートの目標ではありません。' using errcode = '23514';
      end if;
      execute format('update public.milestones set %I = $1::%s where id = $2', field,
        case when field like '%_score' then 'integer' else 'text' end) using value, target_id;
    elsif target = 'common' and field in ('first_score', 'second_score', 'first_comment') then
      select item.title into title from public.common_evaluation_items as item
      left join public.employee_grades as grade on grade.id = sheet.grade_id
      where item.id = target_id and (item.item_set_id is null or item.item_set_id = grade.item_set_id);
      if not found then
        raise exception 'このシートの共通評価の項目ではありません。' using errcode = '23514';
      end if;
      insert into public.common_evaluation_results (sheet_id, item_id) values (sheet.id, target_id)
      on conflict (sheet_id, item_id) do nothing;
      select case field when 'first_score' then coalesce(first_score, 0)::text
          when 'second_score' then coalesce(second_score, 0)::text else coalesce(first_comment, '') end
        into before
      from public.common_evaluation_results where sheet_id = sheet.id and item_id = target_id;
      execute format('update public.common_evaluation_results set %I = $1::%s, updated_at = now() where sheet_id = $2 and item_id = $3',
        field, case when field like '%_score' then 'integer' else 'text' end) using value, sheet.id, target_id;
    elsif target = 'sheet' and field in ('first_overall_comment', 'second_overall_comment') then
      before := coalesce(case field when 'first_overall_comment' then sheet.first_overall_comment
        else sheet.second_overall_comment end, '');
      execute format('update public.evaluation_sheets set %I = $1 where id = $2', field) using value, sheet.id;
      target_id := null;
    else
      raise exception '遡及処理で直せない項目です。' using errcode = '23514';
    end if;

    if before = value then
      raise exception '今と同じ内容には修正できません。' using errcode = '23514';
    end if;
    insert into public.sheet_corrections
      (sheet_id, target, target_id, goal_number, item_title, field, before_value, after_value, reason, corrected_by)
    values (sheet.id, target, target_id, goal_no, title, field, before, value, reason, public.current_employee_id());
    applied := applied + 1;
  end loop;

  if score_changed then
    perform public.recalculate_corrected_sheet(sheet.id);
  end if;
  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'sheet.corrected', sheet.id, jsonb_build_object('changes', applied, 'reason', reason));
  perform set_config('typa.correcting_sheet', '', true);
  return applied;
end;
$$;
revoke all on function public.correct_closed_sheet(bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.correct_closed_sheet(bigint, jsonb, text) to authenticated;

commit;
