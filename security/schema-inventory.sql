-- What this environment's database looks like to the app: tables, columns, row policies,
-- privileges, functions, triggers, constraints and indexes of the public schema, one fact
-- per line. Read-only, and no employee or evaluation data is selected.
--
-- A correctly built environment gives exactly the lines in schema-inventory.expected.txt.
-- Run this in the SQL Editor (it is a single statement, so the whole result is shown),
-- export the result and compare. How to build an environment: docs/supabase-setup.md.
--
-- After adding a migration, apply it locally and write the expected file again:
--   docker exec -i supabase_db_typa psql -U postgres -d postgres -At < security/schema-inventory.sql > security/schema-inventory.expected.txt
select line
from (
  select 'TABLE ' || c.relname || ' rls=' || c.relrowsecurity as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'COLUMN ' || table_name || '.' || column_name || ' ' || data_type
         || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
  from information_schema.columns where table_schema = 'public'
  union all
  select 'POLICY ' || tablename || ' | ' || policyname || ' | ' || roles::text || ' | ' || cmd
         || ' | using ' || coalesce(regexp_replace(qual, '\s+', ' ', 'g'), '-')
         || ' | check ' || coalesce(regexp_replace(with_check, '\s+', ' ', 'g'), '-')
  from pg_policies where schemaname = 'public'
  union all
  select 'GRANT ' || table_name || ' ' || grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
  group by table_name, grantee
  union all
  select 'COLUMN GRANT ' || table_name || ' ' || grantee || ' ' || privilege_type || ' '
         || string_agg(column_name, ',' order by column_name)
  from information_schema.column_privileges
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  group by table_name, grantee, privilege_type
  union all
  -- md5: the function body, so that an old version of a function shows up as a difference.
  select 'FUNCTION ' || p.oid::regprocedure || ' definer=' || p.prosecdef
         || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
         || ' service_role=' || has_function_privilege('service_role', p.oid, 'execute')
         || ' md5=' || md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  union all
  select 'TRIGGER ' || event_object_table || ' ' || trigger_name || ' ' || action_timing || ' '
         || string_agg(event_manipulation, ',' order by event_manipulation)
  from information_schema.triggers where trigger_schema = 'public'
  group by event_object_table, trigger_name, action_timing
  union all
  select 'CONSTRAINT ' || c.conrelid::regclass || ' ' || c.conname || ' '
         || regexp_replace(pg_get_constraintdef(c.oid), '\s+', ' ', 'g')
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'public'
  union all
  select 'INDEX ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  -- What a table or function created later is exposed to before a migration grants anything.
  select 'DEFAULT PRIVILEGES ' || a.defaclrole::regrole || ' ' || a.defaclobjtype::text || ' ' || a.defaclacl::text
  from pg_default_acl a join pg_namespace n on n.oid = a.defaclnamespace
  where n.nspname = 'public'
  union all
  -- Not created by any migration; listed so that a trigger added by hand is noticed.
  select 'TRIGGER ON auth.users ' || tgname from pg_trigger
  where tgrelid = 'auth.users'::regclass and not tgisinternal
) as inventory
order by line collate "C";
