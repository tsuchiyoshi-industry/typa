-- 等級と共通目標のマスタ(Admin だけ)。
-- 評価シートは、作成時の等級の共通目標セットを持ち続ける(evaluation_sheets.item_set_id)。
-- これまでは表示・採点のたびに「今の等級のセット」から項目を引いていたため、マスタを直すと既存のシートまで
-- 変わっていた。これからは、マスタを直しても既存のシートには及ばない。直した内容を既存のシートに入れたいときは、
-- そのシートを作り直す(運用で行う)。
--   - 既存のシートが使うセットの項目を直すと、複製を新版にして、そのセットを使っていた等級を新版へ付け替える。
--     旧版は既存のシートのために残し、マスタには出さない(等級に使われず、シートに使われているセット)。
--   - 既存のシートが使うセットの項目は、DB の所有者でも直接は変えられない(トリガーで断る)。
--   - 共通目標はかならずセット(= 等級)に属する。どの等級にも出る項目(item_set_id が null)はなくす。
begin;

do $$
begin
  if exists (select 1 from public.common_evaluation_items where item_set_id is null) then
    raise exception 'common_evaluation_items に共通目標セットのない項目があります。先にセットへ入れてから当ててください。';
  end if;
end;
$$;
alter table public.common_evaluation_items alter column item_set_id set not null;

alter table public.evaluation_sheets
  add column item_set_id smallint references public.common_evaluation_item_sets (id);
comment on column public.evaluation_sheets.item_set_id
  is 'Common evaluation item set of the sheet''s grade when the sheet was created. Not updated when the grade or the master changes.';
create index evaluation_sheets_item_set_id_idx on public.evaluation_sheets (item_set_id);

-- 既存のシートは、今の等級のセット(これまで表示していたもの)を持つ。シートのトリガー(監査・通知など)は動かさない
alter table public.evaluation_sheets disable trigger user;
update public.evaluation_sheets as sheet
set item_set_id = grade.item_set_id
from public.employee_grades as grade
where grade.id = sheet.grade_id;
alter table public.evaluation_sheets enable trigger user;

-- 既存のシートが使うセットの項目は変えさせない。直すときは save_common_evaluation_item_set が新版を作る
create function public.guard_used_common_evaluation_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.evaluation_sheets
    where item_set_id in (
      case when tg_op <> 'INSERT' then old.item_set_id end,
      case when tg_op <> 'DELETE' then new.item_set_id end)
  ) then
    raise exception '評価シートで使われている共通目標は変えられません。マスタの画面から直すと、新しい版になります。'
      using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.guard_used_common_evaluation_items() from public, anon, authenticated;
create trigger common_evaluation_items_guard_used
  before insert or update or delete on public.common_evaluation_items
  for each row execute function public.guard_used_common_evaluation_items();

-- マスタの画面で見せるセット: 等級が使っているか、どのシートも使っていないもの(使われなくなった旧版は出さない)
create function public.listed_item_set(p_id smallint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employee_grades where item_set_id = p_id)
      or not exists (select 1 from public.evaluation_sheets where item_set_id = p_id)
$$;
revoke all on function public.listed_item_set(smallint) from public, anon, authenticated;

create function public.item_set_content(p_id smallint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', s.name,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'description', i.description, 'weight', i.weight) order by i.id)
      from public.common_evaluation_items i where i.item_set_id = s.id), '[]'::jsonb))
  from public.common_evaluation_item_sets s where s.id = p_id
$$;
revoke all on function public.item_set_content(smallint) from public, anon, authenticated;

create function public.get_grade_master()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.current_employee_is_admin(), false) then
    raise exception '等級と共通目標のマスタは Admin のみ利用できます。' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.grade_name, 'itemSetId', g.item_set_id,
        'employeeCount', (select count(*) from public.employees e where e.grade_id = g.id),
        'sheetCount', (select count(*) from public.evaluation_sheets s where s.grade_id = g.id)
      ) order by g.id)
      from public.employee_grades g), '[]'::jsonb),
    'itemSets', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id,
        'sheetCount', (select count(*) from public.evaluation_sheets sheet where sheet.item_set_id = s.id))
        || public.item_set_content(s.id) order by s.id)
      from public.common_evaluation_item_sets s where public.listed_item_set(s.id)), '[]'::jsonb));
end;
$$;
revoke all on function public.get_grade_master() from public, anon, authenticated;
grant execute on function public.get_grade_master() to authenticated;
comment on function public.get_grade_master()
  is 'Admin only: grades and the common evaluation item sets that grades use or that no sheet uses, with counts.';

-- 等級の追加(p_id が null)と変更。p_expected_* は画面に出していた値。食い違えば断る
create function public.save_employee_grade(
  p_id smallint, p_name text, p_item_set_id smallint, p_expected_name text, p_expected_item_set_id smallint
)
returns smallint language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  grade public.employee_grades%rowtype;
  saved smallint;
begin
  if not coalesce(public.current_employee_is_admin(), false) then
    raise exception '等級と共通目標のマスタは Admin のみ利用できます。' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 50 then
    raise exception '等級名を 50 文字以内で入力してください。' using errcode = '22023';
  end if;
  if p_item_set_id is null then
    raise exception 'この等級の共通目標を選んでください。' using errcode = '22023';
  end if;
  if not exists (select 1 from public.common_evaluation_item_sets where id = p_item_set_id) then
    raise exception '共通目標が見つかりません。再読み込みしてください。' using errcode = '22023';
  end if;
  if p_id is not null then
    select * into grade from public.employee_grades where id = p_id for update;
    if not found then
      raise exception '等級が見つかりません。再読み込みしてください。' using errcode = 'P0002';
    end if;
    if grade.grade_name is distinct from p_expected_name or grade.item_set_id is distinct from p_expected_item_set_id then
      raise exception '等級がほかの操作で変わりました。再読み込みしてから操作してください。' using errcode = '40001';
    end if;
  end if;

  if exists (select 1 from public.employee_grades where grade_name = v_name and id is distinct from p_id) then
    raise exception '等級「%」はすでにあります。', v_name using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.employee_grades (grade_name, item_set_id) values (v_name, p_item_set_id) returning id into saved;
  else
    update public.employee_grades set grade_name = v_name, item_set_id = p_item_set_id where id = p_id;
    saved := p_id;
  end if;

  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'grade.saved', saved, jsonb_build_object(
    'before', case when p_id is not null then jsonb_build_object('name', grade.grade_name, 'itemSetId', grade.item_set_id,
      'itemSetName', (select s.name from public.common_evaluation_item_sets s where s.id = grade.item_set_id)) end,
    'after', jsonb_build_object('name', v_name, 'itemSetId', p_item_set_id,
      'itemSetName', (select s.name from public.common_evaluation_item_sets s where s.id = p_item_set_id))));
  return saved;
end;
$$;
revoke all on function public.save_employee_grade(smallint, text, smallint, text, smallint) from public, anon, authenticated;
grant execute on function public.save_employee_grade(smallint, text, smallint, text, smallint) to authenticated;
comment on function public.save_employee_grade(smallint, text, smallint, text, smallint)
  is 'Admin only: add or change a grade. Existing sheets keep the common evaluation items they were created with. Audited.';

create function public.delete_employee_grade(p_id smallint, p_expected_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  grade public.employee_grades%rowtype;
  holders integer;
  sheets integer;
begin
  if not coalesce(public.current_employee_is_admin(), false) then
    raise exception '等級と共通目標のマスタは Admin のみ利用できます。' using errcode = '42501';
  end if;
  select * into grade from public.employee_grades where id = p_id for update;
  if not found then
    raise exception '等級が見つかりません。再読み込みしてください。' using errcode = 'P0002';
  end if;
  if grade.grade_name is distinct from p_expected_name then
    raise exception '等級がほかの操作で変わりました。再読み込みしてから操作してください。' using errcode = '40001';
  end if;
  select count(*) into holders from public.employees where grade_id = p_id;
  if holders > 0 then
    raise exception 'この等級の社員が % 人います。先に社員マスタで等級を変えてください。', holders using errcode = '23503';
  end if;
  select count(*) into sheets from public.evaluation_sheets where grade_id = p_id;
  if sheets > 0 then
    raise exception 'この等級で作られた評価シートが % 枚あります。シートの記録に使うため削除できません。', sheets using errcode = '23503';
  end if;
  delete from public.employee_grades where id = p_id;
  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'grade.deleted', p_id, jsonb_build_object(
    'deleted', jsonb_build_object('name', grade.grade_name, 'itemSetId', grade.item_set_id,
      'itemSetName', (select s.name from public.common_evaluation_item_sets s where s.id = grade.item_set_id))));
end;
$$;
revoke all on function public.delete_employee_grade(smallint, text) from public, anon, authenticated;
grant execute on function public.delete_employee_grade(smallint, text) to authenticated;
comment on function public.delete_employee_grade(smallint, text)
  is 'Admin only: delete a grade that no employee holds and no sheet was created with. Audited.';

-- 共通目標セットの追加(p_id が null)と変更。p_items は項目のすべて([{id?, title, description, weight}])。
-- p_expected は画面に出していた内容(item_set_content と同じ形)。食い違えば断る。
-- 既存のシートが使うセットの項目を変えるときは、複製を新版にし、そのセットを使っていた等級を新版へ付け替える。
-- 戻り値は保存したセット(新版を作ったときは新版)。
create function public.save_common_evaluation_item_set(
  p_id smallint, p_name text, p_items jsonb, p_expected jsonb
)
returns smallint language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_before jsonb;
  used integer := 0;
  target smallint := p_id;
  entry record;
  bad text;
begin
  if not coalesce(public.current_employee_is_admin(), false) then
    raise exception '等級と共通目標のマスタは Admin のみ利用できます。' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 50 then
    raise exception '共通目標の名前を 50 文字以内で入力してください。' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '共通目標の項目を 1 件以上入力してください。' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception '共通目標の項目は 30 件までです。' using errcode = '22023';
  end if;
  select msg into bad from (
    select case
      when jsonb_typeof(e) <> 'object' or char_length(btrim(coalesce(e->>'title', ''))) not between 1 and 100
        then '項目名を 100 文字以内で入力してください。'
      when char_length(coalesce(e->>'description', '')) > 1000 then '説明は 1000 文字以内で入力してください。'
      when coalesce(e->>'weight', '') !~ '^([1-9]|10)$' then '重みは 1〜10 の整数で入力してください。'
      when (e->>'id') is not null and e->>'id' !~ '^[0-9]{1,18}$' then '項目が正しくありません。再読み込みしてください。'
    end as msg
    from jsonb_array_elements(p_items) with ordinality as x(e, ord) order by ord
  ) checked where msg is not null limit 1;
  if bad is not null then
    raise exception '%', bad using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e group by btrim(e->>'title') having count(*) > 1) then
    raise exception '項目名が重複しています。' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where (e->>'id') is not null group by e->>'id' having count(*) > 1) then
    raise exception '項目が正しくありません。再読み込みしてください。' using errcode = '22023';
  end if;

  if p_id is not null then
    -- シートの作成(セットを参照する)と同時に走らないよう、セットの行を押さえてから使われ方を確かめる
    perform 1 from public.common_evaluation_item_sets where id = p_id for update;
    if not found then
      raise exception '共通目標が見つかりません。再読み込みしてください。' using errcode = 'P0002';
    end if;
    v_before := public.item_set_content(p_id);
    if p_expected is null or v_before is distinct from p_expected then
      raise exception '共通目標がほかの操作で変わりました。再読み込みしてから操作してください。' using errcode = '40001';
    end if;
    if not public.listed_item_set(p_id) then
      raise exception 'この共通目標は、過去の評価シートの記録として残したものです。変更できません。' using errcode = '23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_items) e
      where (e->>'id') is not null and not exists (
        select 1 from public.common_evaluation_items i where i.id = (e->>'id')::bigint and i.item_set_id = p_id)
    ) then
      raise exception 'このセットの項目ではありません。再読み込みしてください。' using errcode = '22023';
    end if;
    select count(*) into used from public.evaluation_sheets where item_set_id = p_id;
  end if;

  if p_id is null or (used > 0 and (v_before->'items') is distinct from (
    select jsonb_agg(jsonb_build_object('id', (e->>'id')::bigint, 'title', btrim(e->>'title'),
      'description', coalesce(e->>'description', ''), 'weight', (e->>'weight')::integer) order by ord)
    from jsonb_array_elements(p_items) with ordinality as x(e, ord))) then
    -- 新しいセット、または既存のシートが使うセットの新版
    insert into public.common_evaluation_item_sets (name) values (v_name) returning id into target;
    insert into public.common_evaluation_items (title, description, weight, item_set_id)
    select btrim(e->>'title'), coalesce(e->>'description', ''), (e->>'weight')::integer, target
    from jsonb_array_elements(p_items) with ordinality as x(e, ord) order by ord;
    if p_id is not null then
      update public.employee_grades set item_set_id = target where item_set_id = p_id;
    end if;
  else
    update public.common_evaluation_item_sets set name = v_name where id = p_id;
    if used = 0 then
      delete from public.common_evaluation_items i
      where i.item_set_id = p_id and not exists (
        select 1 from jsonb_array_elements(p_items) e where (e->>'id')::bigint = i.id);
      for entry in select e, ord from jsonb_array_elements(p_items) with ordinality as x(e, ord) order by ord loop
        if (entry.e->>'id') is null then
          insert into public.common_evaluation_items (title, description, weight, item_set_id)
          values (btrim(entry.e->>'title'), coalesce(entry.e->>'description', ''), (entry.e->>'weight')::integer, p_id);
        else
          update public.common_evaluation_items
          set title = btrim(entry.e->>'title'), description = coalesce(entry.e->>'description', ''),
              weight = (entry.e->>'weight')::integer
          where id = (entry.e->>'id')::bigint;
        end if;
      end loop;
    end if;
  end if;

  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'common_goals.saved', target, jsonb_build_object(
    'previousItemSetId', case when target is distinct from p_id then p_id end,
    'copiedForSheets', case when p_id is not null and target <> p_id then used end,
    'before', v_before, 'after', public.item_set_content(target)));
  return target;
end;
$$;
revoke all on function public.save_common_evaluation_item_set(smallint, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_common_evaluation_item_set(smallint, text, jsonb, jsonb) to authenticated;
comment on function public.save_common_evaluation_item_set(smallint, text, jsonb, jsonb)
  is 'Admin only: add or change a common evaluation item set. A set that sheets use is copied to a new version and its grades are re-pointed; the sheets keep the old one. Audited.';

create function public.delete_common_evaluation_item_set(p_id smallint, p_expected_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  grades text;
  sheets integer;
begin
  if not coalesce(public.current_employee_is_admin(), false) then
    raise exception '等級と共通目標のマスタは Admin のみ利用できます。' using errcode = '42501';
  end if;
  perform 1 from public.common_evaluation_item_sets where id = p_id for update;
  if not found then
    raise exception '共通目標が見つかりません。再読み込みしてください。' using errcode = 'P0002';
  end if;
  v_before := public.item_set_content(p_id);
  if v_before->>'name' is distinct from p_expected_name then
    raise exception '共通目標がほかの操作で変わりました。再読み込みしてから操作してください。' using errcode = '40001';
  end if;
  select string_agg(grade_name, '・' order by id) into grades from public.employee_grades where item_set_id = p_id;
  if grades is not null then
    raise exception 'この共通目標は等級(%)が使っています。先に等級の共通目標を変えてください。', grades using errcode = '23503';
  end if;
  select count(*) into sheets from public.evaluation_sheets where item_set_id = p_id;
  if sheets > 0 then
    raise exception 'この共通目標で作られた評価シートが % 枚あります。シートの記録に使うため削除できません。', sheets using errcode = '23503';
  end if;
  delete from public.common_evaluation_items where item_set_id = p_id;
  delete from public.common_evaluation_item_sets where id = p_id;
  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'common_goals.deleted', p_id, jsonb_build_object('deleted', v_before));
end;
$$;
revoke all on function public.delete_common_evaluation_item_set(smallint, text) from public, anon, authenticated;
grant execute on function public.delete_common_evaluation_item_set(smallint, text) to authenticated;
comment on function public.delete_common_evaluation_item_set(smallint, text)
  is 'Admin only: delete a common evaluation item set that no grade and no sheet uses, with its items. Audited.';

-- ここから下は、共通評価の項目を「今の等級のセット」ではなく「シートの作成時のセット」から引くように直したもの。
-- 中身はそれ以外変えていない。
CREATE OR REPLACE FUNCTION public.set_evaluation_sheet_grade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.grade_id := (select grade_id from public.employees where id = new.employee_id);
  -- 作成時の等級の共通目標。この後に等級やマスタを直しても、このシートの項目は変わらない
  new.item_set_id := (select item_set_id from public.employee_grades where id = new.grade_id);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.change_sheet_grade(p_sheet_id bigint, p_grade_id smallint, p_expected_grade_id smallint, p_expected_status text, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  update public.evaluation_sheets set grade_id = p_grade_id,
    item_set_id = (select item_set_id from public.employee_grades where id = p_grade_id), updated_at = now()
  where id = sheet.id;

  insert into public.security_audit_log(actor_user_id, action, entity_id, details)
  values (auth.uid(), 'sheet.grade_change', sheet.id, jsonb_build_object(
    'reason', reason, 'actorEmployeeId', public.current_employee_id(),
    'employeeId', sheet.employee_id, 'periodId', sheet.period_id, 'status', sheet.status,
    'fromGradeId', sheet.grade_id, 'toGradeId', p_grade_id,
    'deletedCommonResults', deleted));
  return deleted_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_evaluation_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  max_goals smallint;
  use_first boolean;
  item_set smallint;
  missing_items text;
begin
  if public.is_privileged_sheet_operation(new.id) then return new; end if;
  if new.status is not distinct from old.status or new.status not in ('goals_submitted', 'goals_confirmed', 'submitted', 'first_evaluated', 'finalized') then
    return new;
  end if;

  select max_challenge_goals into max_goals from public.evaluation_settings;
  if (select count(*) from public.milestones where sheet_id = new.id) not between 1 and max_goals then
    raise exception 'チャレンジ目標は最低1件、最大%件必要です。', max_goals using errcode = '23514';
  end if;
  select string_agg('・目標 ' || m.goal_number || '：チャレンジ目標', E'\n' order by m.goal_number)
    into missing_items
  from public.milestones m
  where m.sheet_id = new.id and coalesce(m.challenge_goal, '') !~ '[^[:space:]]';
  if missing_items is not null then
    raise exception 'チャレンジ目標が空欄の目標は送信・確定できません。入力して保存するか、不要なタブを削除してください。% %', E'\n', missing_items using errcode = '23514';
  end if;
  if new.status in ('goals_submitted', 'goals_confirmed', 'submitted') then return new; end if;

  use_first := new.status = 'first_evaluated'
    or (new.no_secondary_evaluator and new.secondary_evaluator_id is null);
  item_set := new.item_set_id;

  select string_agg(pending.label, E'\n' order by pending.kind, pending.item_id) into missing_items
  from (
    select 0 as kind, milestone.id as item_id,
           '・チャレンジ目標 ' || coalesce(milestone.goal_number::text, milestone.id::text) as label
    from public.milestones milestone
    where milestone.sheet_id = new.id
      and coalesce(case when use_first then milestone.first_score else milestone.second_score end, 0) not between 1 and 4
    union all
    select 1 as kind, item.id as item_id, '・共通評価「' || coalesce(item.title, '項目 ' || item.id) || '」' as label
    from public.common_evaluation_items item
    left join public.common_evaluation_results result on result.item_id = item.id and result.sheet_id = new.id
    where item.item_set_id = item_set
      and coalesce(case when use_first then result.first_score else result.second_score end, 0) not between 1 and 4
  ) pending;

  if missing_items is not null then
    raise exception '%評価に未設定の項目があります。すべての評価を 1〜4 で設定して保存してください。% %',
      case when use_first then '一次' else '二次' end, E'\n', missing_items
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.correct_closed_sheet(p_sheet_id bigint, p_changes jsonb, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    elsif field = 'period_goals' then
      if not public.valid_period_goals(value::jsonb) then
        raise exception '期中目標は0〜4件のタスクと達成状況で指定してください。' using errcode = '23514';
      end if;
    elsif char_length(value) > 2000 then
      raise exception '文章は 2000 文字以内で入力してください。' using errcode = '23514';
    end if;

    if target = 'goal' and field in ('challenge_goal', 'period_goals', 'achievement', 'first_score', 'second_score') then
      select goal_number, case field
          when 'challenge_goal' then coalesce(challenge_goal, '') when 'period_goals' then period_goals::text
          when 'achievement' then achievement when 'first_score' then coalesce(first_score, 0)::text
          else coalesce(second_score, 0)::text end
        into goal_no, before
      from public.milestones where id = target_id and sheet_id = sheet.id;
      if not found then
        raise exception 'このシートの目標ではありません。' using errcode = '23514';
      end if;
      execute format('update public.milestones set %I = $1::%s where id = $2', field,
        case when field like '%_score' then 'integer' when field = 'period_goals' then 'jsonb' else 'text' end) using value, target_id;
    elsif target = 'common' and field in ('first_score', 'second_score', 'first_comment') then
      select item.title into title from public.common_evaluation_items as item
      where item.id = target_id and item.item_set_id = sheet.item_set_id;
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

    if (field = 'period_goals' and before::jsonb = value::jsonb) or (field <> 'period_goals' and before = value) then
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
$function$;

CREATE OR REPLACE FUNCTION public.freeze_evaluation_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ofirst numeric; osecond numeric; omax numeric; cfirst numeric; csecond numeric; cmax numeric;
  oa integer; ca integer; primary_final boolean; primary_score integer;
begin
  if new.status is not distinct from old.status or new.status not in('first_evaluated','finalized') then return new; end if;
  -- The sheet row is locked by UPDATE. All goal/common writes acquire the same lock.
  select coalesce(sum(first_score),0),coalesce(sum(second_score),0),count(*)*4
    into ofirst,osecond,omax from public.milestones where sheet_id=new.id;
  select coalesce(sum(i.weight*coalesce(r.first_score,0)),0),coalesce(sum(i.weight*coalesce(r.second_score,0)),0),coalesce(sum(i.weight*4),0)
    into cfirst,csecond,cmax from public.common_evaluation_items i
    left join public.common_evaluation_results r on r.item_id=i.id and r.sheet_id=new.id
    where i.item_set_id=new.item_set_id;
  select objective_allocation,common_allocation into oa,ca from public.evaluation_settings for share;
  primary_final := new.no_secondary_evaluator and new.secondary_evaluator_id is null;
  primary_score := coalesce(round(ofirst*oa/nullif(omax,0)),0)+coalesce(round(cfirst*ca/nullif(cmax,0)),0);
  if new.status='first_evaluated' or primary_final then new.first_rank:=public.evaluation_rank(primary_score); end if;
  if new.status='finalized' then
    new.objectives_first_total_score:=ofirst;
    new.objectives_first_total_rate:=coalesce(round(ofirst*100/nullif(omax,0)),0);
    new.common_evaluation_first_total_score:=cfirst;
    new.common_evaluation_first_total_rate:=coalesce(round(cfirst*100/nullif(cmax,0)),0);
    if primary_final then osecond:=ofirst; csecond:=cfirst; end if;
    new.objectives_second_total_score:=osecond;
    new.objectives_second_total_rate:=coalesce(round(osecond*100/nullif(omax,0)),0);
    new.common_evaluation_second_total_score:=csecond;
    new.common_evaluation_second_total_rate:=coalesce(round(csecond*100/nullif(cmax,0)),0);
    new.objectives_second_evaluation_score:=coalesce(round(osecond*oa/nullif(omax,0)),0);
    new.common_evaluation_second_evaluation_score:=coalesce(round(csecond*ca/nullif(cmax,0)),0);
    new.total_evaluation_score:=new.objectives_second_evaluation_score+new.common_evaluation_second_evaluation_score;
    new.objective_allocation:=oa; new.common_allocation:=ca;
    new.final_rank_letter:=left(public.evaluation_rank(new.total_evaluation_score),1);
    new.final_rank_level:=case right(public.evaluation_rank(new.total_evaluation_score),1) when '+' then 'plus' when '-' then 'minus' else 'none' end;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_corrected_sheet(p_sheet_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    where i.item_set_id = s.item_set_id;
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
$function$;

CREATE OR REPLACE FUNCTION public.reviewer_sheet_snapshot(p_sheet_id bigint, p_stage text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when s.status = 'draft' then '{}'::jsonb else jsonb_build_object(
    'firstOverallComment', coalesce(s.first_overall_comment, ''),
    'secondOverallComment', case when p_stage = 'secondary' then coalesce(s.second_overall_comment, '') end,
    'firstRank', case when s.status in ('first_evaluated', 'finalized') then s.first_rank end,
    'finalRank', case when s.status = 'finalized' and (p_stage = 'secondary' or s.no_secondary_evaluator) then
      nullif(coalesce(s.final_rank_letter, '') || case s.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end, '') end,
    'finalScore', case when s.status = 'finalized' and (p_stage = 'secondary' or s.no_secondary_evaluator) then s.total_evaluation_score end,
    'objectives', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'goalNumber', m.goal_number, 'challengeGoal', coalesce(m.challenge_goal, ''),
      'periodGoals', m.period_goals, 'achievement', m.achievement,
      'firstScore', coalesce(m.first_score, 0), 'secondScore', case when p_stage = 'secondary' then coalesce(m.second_score, 0) end
    ) order by m.goal_number, m.id) from public.milestones m where m.sheet_id = s.id), '[]'::jsonb),
    'commonItems', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'title', i.title, 'weight', i.weight,
      'firstScore', coalesce(r.first_score, 0), 'secondScore', case when p_stage = 'secondary' then coalesce(r.second_score, 0) end,
      'firstComment', coalesce(r.first_comment, '')
    ) order by i.id) from public.common_evaluation_items i
    left join public.common_evaluation_results r on r.item_id = i.id and r.sheet_id = s.id
    where i.item_set_id = s.item_set_id), '[]'::jsonb)
  ) end from public.evaluation_sheets s
  where s.id = p_sheet_id
$function$;

CREATE OR REPLACE FUNCTION public.save_common_evaluation(p_sheet_id bigint, p_results jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.evaluation_sheets%rowtype; me integer:=public.current_employee_id(); access text;
begin
  select * into s from public.evaluation_sheets where id=p_sheet_id for update;
  access := case when me<>s.employee_id and me=s.primary_evaluator_id and s.status='submitted' then 'first'
                 when me<>s.employee_id and me=s.secondary_evaluator_id and s.status='first_evaluated' then 'second' end;
  if access is null then raise exception 'この共通評価を保存する権限がありません。' using errcode='42501'; end if;
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception '評価項目を配列で指定してください。' using errcode='22023';
  end if;
  -- Reject an invalid batch completely, rather than silently discarding unknown items.
  if exists (
    select 1 from jsonb_array_elements(p_results) entry
    left join public.common_evaluation_items i on i.id=(entry->>'itemId')::bigint
    where i.id is null or i.item_set_id is distinct from s.item_set_id
      or coalesce(case when access='first' then entry->>'firstScore' else entry->>'secondScore' end,'') !~ '^[0-4]$'
  ) or exists (
    select 1 from jsonb_array_elements(p_results) entry group by entry->>'itemId' having count(*)>1
  ) then raise exception '評価項目または点数が正しくありません。' using errcode='23514'; end if;
  insert into public.common_evaluation_results(sheet_id,item_id,first_score,second_score,first_comment)
  select p_sheet_id,(entry->>'itemId')::bigint,
    case when access='first' then (entry->>'firstScore')::integer else 0 end,
    case when access='second' then (entry->>'secondScore')::integer else 0 end,
    case when access='first' then coalesce(entry->>'firstComment','') else '' end
  from jsonb_array_elements(p_results) entry
  on conflict(sheet_id,item_id) do update set
    first_score=case when access='first' then excluded.first_score else common_evaluation_results.first_score end,
    first_comment=case when access='first' then excluded.first_comment else common_evaluation_results.first_comment end,
    second_score=case when access='second' then excluded.second_score else common_evaluation_results.second_score end,
    updated_at=now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.sheet_document(p_sheet_id bigint, p_sees_content boolean, p_sees_first boolean, p_sees_second boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'id', sheet.id, 'status', sheet.status, 'gradeId', sheet.grade_id, 'goalReturnReason', case when sees_content then sheet.goal_return_reason end,
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
    'finalRankLetter', case when finalized and sees_second then sheet.final_rank_letter end,
    'finalRankLevel', case when finalized and sees_second then sheet.final_rank_level end,
    -- Totals are stored when scores are saved; only a finalized sheet reads them back.
    'stored', case when finalized and sees_second then jsonb_build_object(
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
        'periodGoals', goal.period_goals, 'achievement', goal.achievement,
        'firstScore', case when sees_first then coalesce(goal.first_score, 0) else 0 end,
        'secondScore', case when sees_second then coalesce(goal.second_score, 0) else 0 end
      ) order by goal.goal_number, goal.id)
      from public.milestones as goal where goal.sheet_id = sheet.id and sees_content
    ), '[]'::jsonb),
    -- One entry per item of the set the sheet was created with, whether or not a result has been saved (id null).
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
      where item.item_set_id = sheet.item_set_id
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
        when correction.field in ('challenge_goal', 'period_goals', 'achievement') then sees_content
        when correction.field in ('first_score', 'first_comment', 'first_overall_comment') then sees_first
        when correction.field in ('second_score', 'second_overall_comment') then sees_second
        else false end
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sheet_evaluation_score(p_sheet_id bigint, p_use_first boolean, p_objective_allocation integer, p_common_allocation integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (
    coalesce((
      select round(sum(coalesce(case when p_use_first then goal.first_score else goal.second_score end, 0))::numeric
                   * p_objective_allocation / (count(*) * 4))
      from public.milestones as goal where goal.sheet_id = sheet.id
      having count(*) > 0
    ), 0)
    + coalesce((
      select round(sum(item.weight * coalesce(case when p_use_first then result.first_score else result.second_score end, 0))::numeric
                   * p_common_allocation / sum(item.weight * 4))
      from public.common_evaluation_items as item
      left join public.common_evaluation_results as result
        on result.item_id = item.id and result.sheet_id = sheet.id
      where item.item_set_id = sheet.item_set_id
      having sum(item.weight) > 0
    ), 0)
  )::integer
  from public.evaluation_sheets as sheet
  -- Only for the evaluator who is entering that sheet's evaluation now; null for anyone else.
  where sheet.id = p_sheet_id and public.sheet_access(p_sheet_id) in ('first', 'second')
$function$;

CREATE OR REPLACE FUNCTION public.get_sheet_import_template()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.import_sheet_data(p_goals jsonb, p_common jsonb, p_apply boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
               then 'この社員の、実施中の評価期間の評価シートは目標を送信済みのため、取り込めません。' end),
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
               then 'この社員の、実施中の評価期間の評価シートは目標を送信済みのため、取り込めません。' end),
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

  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'sheets.imported', v_period, summary);
  return jsonb_build_object('errors', errors, 'summary', summary, 'applied', true);
end;
$function$;

commit;
