-- Read-only inventory to run against a staging copy. No employee/evaluation data is selected.
-- Export results for review; this does not prove that policies enforce the business rules.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('employees', 'roles', 'employee_grades', 'evaluation_periods',
                   'evaluation_sheets', 'milestones', 'common_evaluation_items', 'common_evaluation_results')
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and grantee in ('anon', 'authenticated')
order by table_name, column_name, grantee, privilege_type;

select p.proname as function_name, p.prosecdef as security_definer,
       p.proconfig as function_settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.proname;

select c.conrelid::regclass as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_namespace n on n.oid = c.connamespace
where n.nspname = 'public' order by c.conrelid::regclass::text, c.conname;

select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers where trigger_schema = 'public'
order by event_object_table, trigger_name;
