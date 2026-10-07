-- A sheet keeps the grade its employee held when the sheet was created. An employee's
-- grade changes over time, so the sheet list must not show today's grade for an old sheet.
-- The grade is taken from the employee on insert; later grade changes leave the sheet as is.
begin;

alter table public.evaluation_sheets
  add column if not exists grade_id smallint references public.employee_grades(id);
comment on column public.evaluation_sheets.grade_id
  is 'Grade of the employee when the sheet was created. Not updated when the employee''s grade changes.';

-- Existing sheets have no record of their original grade; the current grade is the best known value.
update public.evaluation_sheets as sheet
set grade_id = employee.grade_id
from public.employees as employee
where employee.id = sheet.employee_id and sheet.grade_id is null;

create or replace function public.set_evaluation_sheet_grade()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.grade_id := (select grade_id from public.employees where id = new.employee_id);
  return new;
end;
$$;
revoke all on function public.set_evaluation_sheet_grade() from public, anon, authenticated;

drop trigger if exists evaluation_sheets_set_grade on public.evaluation_sheets;
create trigger evaluation_sheets_set_grade
  before insert on public.evaluation_sheets
  for each row execute function public.set_evaluation_sheet_grade();

commit;
