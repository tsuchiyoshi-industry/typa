-- The rules for managing employees are decided by the domain (src/domain/services/EmployeeAdministration.ts).
-- EmployeeAdministrationSql.test.ts checks the DB against it, case by case. Three rules were enforced only
-- by the app, so a direct API call could break them.
begin;

-- checkEnabledChange: nobody suspends themselves (it would end the session they work in).
create or replace function public.set_employee_enabled(p_employee_no text, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_id integer;
begin
  perform public.lock_employee_administration();
  if p_enabled is null then raise exception '利用状態を指定してください。' using errcode='22023'; end if;
  select id into target_id from public.employees where employee_no=p_employee_no;
  if target_id is null then return false; end if;
  if not p_enabled and target_id = public.current_employee_id() then
    raise exception '自分自身の利用は停止できません。' using errcode='42501';
  end if;
  if not p_enabled then perform public.require_another_usable_admin(target_id); end if;
  update public.employees set is_enabled=p_enabled, keep_signed_in=false where id=target_id;
  if not p_enabled then
    delete from public.registration_tickets where employee_id=target_id;
    delete from public.employee_invitations where employee_id=target_id;
  end if;
  return true;
end;
$$;
revoke all on function public.set_employee_enabled(text, boolean) from public, anon, authenticated;
grant execute on function public.set_employee_enabled(text, boolean) to authenticated;

-- checkEvaluatorAssignment / checkNewEmployee: an evaluator must be able to evaluate (canBeEvaluator:
-- an Admin or a Reviewer, or an executive). Checked whenever an evaluator is set, by anyone. Someone who
-- later loses the role stays the evaluator of the people they had until they are reassigned.
create or replace function public.guard_evaluator_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ineligible text;
begin
  select e.name into ineligible
  from (values
      (new.primary_evaluator_id, tg_op = 'INSERT' or new.primary_evaluator_id is distinct from old.primary_evaluator_id),
      (new.secondary_evaluator_id, tg_op = 'INSERT' or new.secondary_evaluator_id is distinct from old.secondary_evaluator_id)
    ) as chosen(id, changed)
  join public.employees e on e.id = chosen.id
  left join public.roles r on r.id = e.role_id
  where chosen.changed and e.id <> new.id
    and not (coalesce(r.role_name in ('Admin', 'Reviewer'), false) or btrim(coalesce(e.career_course, '')) = '役員')
  limit 1;
  if ineligible is not null then
    raise exception '%さんは評価者の権限を持っていないため、評価者に設定できません。', ineligible using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_evaluator_eligibility() from public, anon, authenticated;
create trigger employees_guard_evaluator_eligibility
  before insert or update of primary_evaluator_id, secondary_evaluator_id on public.employees
  for each row execute function public.guard_evaluator_eligibility();

-- checkNewEmployee: the career course is one of CAREER_COURSES (an executive evaluates and is not evaluated).
-- Stops here if a stored course is not one of them; fix those rows first.
alter table public.employees add constraint employees_career_course_check
  check (career_course in ('総合職', '一般職', '技能職', '役員'));

commit;
