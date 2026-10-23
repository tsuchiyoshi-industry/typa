-- 導入処理の「初期ユーザ」: Admin が社員を仮登録する(employees に行を足す)。
-- これまでは招待コードを発行する前に、employees へ手作業で行を足していた。
--   * 社員番号・氏名・等級・キャリアコースは必須。評価者は任意(社員マスタで後から決められる)。
--   * 権限は Employee で始まる。ログイン用アカウントは本人が招待コードで新規登録するときに作られる。
--   * 社員番号はログインIDになる。ログイン用の内部アドレスは小文字にした社員番号から作るので、
--     大文字・小文字だけが違う番号は同じ人とみなして拒否する(一意インデックス)。
-- Apply after 202610220001.
begin;

create unique index if not exists employees_employee_no_lower_key on public.employees (lower(employee_no));

create or replace function public.pre_register_employee(
  p_employee_no text,
  p_name text,
  p_grade_id smallint,
  p_career_course text,
  p_primary_evaluator_no text default null,
  p_secondary_evaluator_no text default null,
  p_no_secondary_evaluator boolean default false
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_employee_no text := btrim(p_employee_no);
  primary_id integer;
  secondary_id integer;
  new_id integer;
begin
  perform public.lock_employee_administration();
  if v_employee_no is null or v_employee_no !~ '^[A-Za-z0-9_-]+$' then
    raise exception '社員番号は半角英数字・ハイフン・アンダースコアで入力してください。' using errcode = '22023';
  end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_career_course), '') = '' then
    raise exception '氏名とキャリアコースを入力してください。' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employee_grades where id = p_grade_id) then
    raise exception '等級が見つかりません。' using errcode = '22023';
  end if;
  if exists (select 1 from public.employees where lower(employees.employee_no) = lower(v_employee_no)) then
    raise exception '社員番号 % は登録済みです。', v_employee_no using errcode = '23505';
  end if;
  if p_primary_evaluator_no is not null then
    select id into primary_id from public.employees where employees.employee_no = p_primary_evaluator_no;
    if primary_id is null then
      raise exception '一次評価者が見つかりません。' using errcode = '22023';
    end if;
  end if;
  if p_secondary_evaluator_no is not null then
    if coalesce(p_no_secondary_evaluator, false) then
      raise exception '二次評価者と「なし」は同時に指定できません。' using errcode = '22023';
    end if;
    select id into secondary_id from public.employees where employees.employee_no = p_secondary_evaluator_no;
    if secondary_id is null then
      raise exception '二次評価者が見つかりません。' using errcode = '22023';
    end if;
  end if;

  insert into public.employees (
    employee_no, name, grade_id, career_course, role_id,
    primary_evaluator_id, secondary_evaluator_id, no_secondary_evaluator
  )
  values (
    v_employee_no, btrim(p_name), p_grade_id, btrim(p_career_course),
    (select id from public.roles where role_name = 'Employee'),
    primary_id, secondary_id, coalesce(p_no_secondary_evaluator, false)
  )
  returning id into new_id;
  insert into public.security_audit_log (actor_user_id, action, entity_id, details)
  values (auth.uid(), 'employee.pre_registered', new_id, jsonb_build_object('employeeNo', v_employee_no));
  return true;
end;
$$;
revoke all on function public.pre_register_employee(text, text, smallint, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.pre_register_employee(text, text, smallint, text, text, text, boolean)
  to authenticated;
comment on function public.pre_register_employee(text, text, smallint, text, text, text, boolean)
  is 'Admin only: adds an employee row before their account exists (role Employee). Refuses an employee number that differs only by case from an existing one.';

commit;
