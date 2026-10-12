-- Baseline: the production schema as dumped on 2026-10-07 (supabase db dump), so that a new
-- environment can be built from this repository alone. It already contains the result of
-- 202610050001 .. 202610070001; those are written to be re-run and change nothing on top of it.
-- Do not apply this to an environment that already has the tables.
-- The table policies and grants here are the original, permissive ones. They are replaced
-- by 202610120001_access_control.sql.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."check_employee_access"("target_employee_id" bigint, "current_user_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  is_accessible boolean;
begin
  select exists (
    with me as (
      select id, primary_evaluator_id, secondary_evaluator_id
      from public.employees
      where user_id = current_user_uuid
    )
    select 1 
    from me
    where 
      -- 1. 自分がそのレコード本人である
      (me.id = target_employee_id)
      OR
      -- 2. 自分がそのレコードの評価者である
      (target_employee_id IN (
        select id from public.employees 
        where primary_evaluator_id = me.id OR secondary_evaluator_id = me.id
      ))
      OR
      -- 3. そのレコードが自分の評価者である
      (target_employee_id IN (me.primary_evaluator_id, me.secondary_evaluator_id))
  ) into is_accessible;
  
  return is_accessible;
end;
$$;


ALTER FUNCTION "public"."check_employee_access"("target_employee_id" bigint, "current_user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_user_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF (SELECT count(*) FROM auth.users) >= 150 THEN
    RAISE EXCEPTION 'User registration limit reached.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_user_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_finalized_sheet_notification_recipients"("p_sheet_id" bigint) RETURNS TABLE("role" "text", "employee_id" integer, "email" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  primary_id integer;
  secondary_id integer;
begin
  select subject.primary_evaluator_id, subject.secondary_evaluator_id
    into primary_id, secondary_id
  from public.evaluation_sheets as sheet
  join public.employees as subject on subject.id = sheet.employee_id
  join public.employees as evaluator
    on evaluator.id = case
         when subject.secondary_evaluator_id is not null then subject.secondary_evaluator_id
         when subject.no_secondary_evaluator then subject.primary_evaluator_id
       end
  where sheet.id = p_sheet_id
    and sheet.status = 'finalized'
    and evaluator.user_id = auth.uid()
    and evaluator.id <> subject.id;

  if not found then
    raise exception 'Finalized sheet notification access denied' using errcode = '42501';
  end if;

  return query
  select recipients.role, recipients.employee_id,
         case when account.email_confirmed_at is not null
              then nullif(account.raw_user_meta_data ->> 'contact_email', '')
              else null::text end
  from (values ('primary'::text, primary_id), ('secondary'::text, secondary_id))
       as recipients(role, employee_id)
  left join public.employees as evaluator on evaluator.id = recipients.employee_id
  left join auth.users as account on account.id = evaluator.user_id;
end;
$$;


ALTER FUNCTION "public"."get_finalized_sheet_notification_recipients"("p_sheet_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_finalized_sheet_notification_recipients"("p_sheet_id" bigint) IS 'Sign-up contact emails of the primary/secondary evaluators for finalized-sheet notifications; final evaluator only (secondary, or primary when the employee is marked no_secondary_evaluator).';



CREATE OR REPLACE FUNCTION "public"."get_reviewer_workspace"("p_period_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id integer;
  result jsonb;
begin
  select id into caller_id from public.employees where user_id = auth.uid();
  if caller_id is null then
    raise exception 'ログインが必要です。' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeId', e.id, 'employeeName', e.name, 'employeeNo', e.employee_no,
    'gradeId', e.grade_id, 'gradeName', coalesce(g.grade_name, '等級未設定'),
    'careerCourse', coalesce(e.career_course, ''), 'primaryEvaluator', coalesce(pr.name, '未設定'),
    'primaryEvaluatorId', e.primary_evaluator_id,
    'role', case when e.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end,
    'canViewSecond', e.secondary_evaluator_id is not distinct from caller_id,
    'canViewFinal', coalesce(e.secondary_evaluator_id = caller_id or (e.primary_evaluator_id = caller_id and e.no_secondary_evaluator), false),
    'sheetId', s.id, 'status', coalesce(s.status, 'missing'), 'updatedAt', s.updated_at,
    'revision', case when s.id is not null then md5((snapshot.value - 'finalScore')::text) end,
    'reviewedAt', checkpoint.reviewed_at,
    'reviewed', coalesce(checkpoint.revision = md5((snapshot.value - 'finalScore')::text), false),
    'needsRecheck', coalesce(checkpoint.revision <> md5((snapshot.value - 'finalScore')::text), false),
    'primaryReviewed', coalesce(primary_checkpoint.revision = md5((primary_snapshot.value - 'finalScore')::text), false),
    'firstOverallComment', coalesce(snapshot.value->>'firstOverallComment', ''),
    'secondOverallComment', snapshot.value->'secondOverallComment',
    'finalRank', snapshot.value->'finalRank', 'finalScore', snapshot.value->'finalScore',
    'objectives', coalesce(snapshot.value->'objectives', '[]'::jsonb),
    'commonItems', coalesce(snapshot.value->'commonItems', '[]'::jsonb)
  ) order by e.employee_no), '[]'::jsonb) into result
  from public.employees e
  left join public.employee_grades g on g.id = e.grade_id
  left join public.employees pr on pr.id = e.primary_evaluator_id
  left join public.evaluation_sheets s on s.employee_id = e.id and s.period_id = p_period_id
  left join lateral (select public.reviewer_sheet_snapshot(s.id,
    case when e.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end) as value) snapshot on true
  left join lateral (select public.reviewer_sheet_snapshot(s.id, 'primary') as value) primary_snapshot on true
  left join public.sheet_review_checkpoints checkpoint on checkpoint.sheet_id = s.id
    and checkpoint.evaluator_id = caller_id
    and checkpoint.stage = case when e.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end
  left join public.sheet_review_checkpoints primary_checkpoint on primary_checkpoint.sheet_id = s.id
    and primary_checkpoint.evaluator_id = e.primary_evaluator_id and primary_checkpoint.stage = 'primary'
  where e.id <> caller_id and (e.primary_evaluator_id = caller_id or e.secondary_evaluator_id = caller_id);
  return result;
end;
$$;


ALTER FUNCTION "public"."get_reviewer_workspace"("p_period_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_employee_registration"("p_employee_no" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_user_id uuid;
begin
  if not exists (
    select 1
    from public.employees as caller
    join public.roles as caller_role on caller_role.id = caller.role_id
    where caller.user_id = auth.uid()
      and caller_role.role_name = 'Admin'
  ) then
    raise exception 'Only Admin can reset an employee registration' using errcode = '42501';
  end if;

  select target.user_id into target_user_id
  from public.employees as target
  where target.employee_no = p_employee_no
  for update;

  -- Unknown employee number, or not registered: nothing to reset.
  if target_user_id is null then
    return false;
  end if;

  -- Resetting yourself would cut off the session that is running this.
  if target_user_id = auth.uid() then
    raise exception 'Admin cannot reset their own registration' using errcode = '42501';
  end if;

  update public.employees set user_id = null where employee_no = p_employee_no;
  delete from auth.users where id = target_user_id;
  return true;
end;
$$;


ALTER FUNCTION "public"."reset_employee_registration"("p_employee_no" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reset_employee_registration"("p_employee_no" "text") IS 'Admin only: clears employees.user_id and deletes the linked Auth user so the employee can register again. Returns false when there is nothing to reset.';



CREATE OR REPLACE FUNCTION "public"."reviewer_sheet_snapshot"("p_sheet_id" bigint, "p_stage" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'status', case when s.status = 'finalized' then 'submitted' else s.status end,
    'gradeId', e.grade_id, 'gradeName', g.grade_name, 'careerCourse', e.career_course, 'itemSetId', g.item_set_id,
    'primaryId', e.primary_evaluator_id, 'secondaryId', e.secondary_evaluator_id,
    'noSecondary', e.no_secondary_evaluator,
    'firstOverallComment', coalesce(s.first_overall_comment, ''),
    'secondOverallComment', case when p_stage = 'secondary' then coalesce(s.second_overall_comment, '') end,
    'finalRank', case when p_stage = 'secondary' or e.no_secondary_evaluator then
      nullif(coalesce(s.final_rank_letter, '') || case s.final_rank_level when 'plus' then '+' when 'minus' then '-' else '' end, '') end,
    'finalScore', case when p_stage = 'secondary' or e.no_secondary_evaluator then s.total_evaluation_score end,
    'objectives', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'goalNumber', m.goal_number, 'challengeGoal', coalesce(m.challenge_goal, ''),
      'midtermGoal', coalesce(m.midterm_goal, ''), 'achievement', coalesce(m.achievement, ''),
      'firstScore', coalesce(m.first_score, 0), 'secondScore', case when p_stage = 'secondary' then coalesce(m.second_score, 0) end
    ) order by m.goal_number, m.id) from (
      select * from public.milestones where sheet_id = s.id order by goal_number, id limit 2
    ) m), '[]'::jsonb),
    'commonItems', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'title', i.title, 'description', i.description, 'weight', i.weight,
      'firstScore', coalesce(r.first_score, 0), 'secondScore', case when p_stage = 'secondary' then coalesce(r.second_score, 0) end,
      'firstComment', coalesce(r.first_comment, '')
    ) order by i.id) from public.common_evaluation_items i
    left join public.common_evaluation_results r on r.item_id = i.id and r.sheet_id = s.id
    where i.item_set_id is null or i.item_set_id = g.item_set_id), '[]'::jsonb)
  ) from public.evaluation_sheets s
  join public.employees e on e.id = s.employee_id
  left join public.employee_grades g on g.id = e.grade_id
  where s.id = p_sheet_id
$$;


ALTER FUNCTION "public"."reviewer_sheet_snapshot"("p_sheet_id" bigint, "p_stage" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_sheet_reviewed"("p_sheet_id" bigint, "p_revision" "text", "p_reviewed" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id integer;
  subject public.employees%rowtype;
  sheet_status text;
  review_stage text;
  actual_revision text;
begin
  select id into caller_id from public.employees where user_id = auth.uid();
  select e.* into subject from public.employees e
    join public.evaluation_sheets s on s.employee_id = e.id where s.id = p_sheet_id;
  if caller_id is null or subject.id is null or subject.id = caller_id
    or not (coalesce(subject.primary_evaluator_id = caller_id, false)
      or coalesce(subject.secondary_evaluator_id = caller_id, false)) then
    raise exception '担当評価者のみ確認を記録できます。' using errcode = '42501';
  end if;
  select status into sheet_status from public.evaluation_sheets where id = p_sheet_id for update;
  if sheet_status <> 'submitted' then
    raise exception '提出済み・未確定のシートのみ確認を記録できます。';
  end if;
  review_stage := case when subject.secondary_evaluator_id = caller_id then 'secondary' else 'primary' end;
  actual_revision := md5((public.reviewer_sheet_snapshot(p_sheet_id, review_stage) - 'finalScore')::text);
  if p_reviewed and actual_revision is distinct from p_revision then
    raise exception '評価内容が更新されています。再読み込みして確認してください。' using errcode = '40001';
  end if;
  if p_reviewed then
    insert into public.sheet_review_checkpoints (sheet_id, evaluator_id, stage, revision, reviewed_at)
    values (p_sheet_id, caller_id, review_stage, actual_revision, now())
    on conflict (sheet_id, evaluator_id, stage) do update set revision = excluded.revision, reviewed_at = excluded.reviewed_at;
    -- A reviewer assigned to both stages has checked their primary evaluation too.
    if review_stage = 'secondary' and subject.primary_evaluator_id = caller_id then
      insert into public.sheet_review_checkpoints (sheet_id, evaluator_id, stage, revision, reviewed_at)
      values (p_sheet_id, caller_id, 'primary', md5((public.reviewer_sheet_snapshot(p_sheet_id, 'primary') - 'finalScore')::text), now())
      on conflict (sheet_id, evaluator_id, stage) do update set revision = excluded.revision, reviewed_at = excluded.reviewed_at;
    end if;
  else
    delete from public.sheet_review_checkpoints where sheet_id = p_sheet_id and evaluator_id = caller_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."set_sheet_reviewed"("p_sheet_id" bigint, "p_revision" "text", "p_reviewed" boolean) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."common_evaluation_item_sets" (
    "id" smallint NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."common_evaluation_item_sets" OWNER TO "postgres";


COMMENT ON TABLE "public"."common_evaluation_item_sets" IS 'A set of common evaluation items. Several grades can point at the same set.';



ALTER TABLE "public"."common_evaluation_item_sets" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."common_evaluation_item_sets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."common_evaluation_items" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "weight" integer DEFAULT 1 NOT NULL,
    "item_set_id" smallint
);


ALTER TABLE "public"."common_evaluation_items" OWNER TO "postgres";


ALTER TABLE "public"."common_evaluation_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."common_evaluation_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."common_evaluation_results" (
    "id" bigint NOT NULL,
    "item_id" bigint NOT NULL,
    "first_score" integer DEFAULT 0,
    "second_score" integer DEFAULT 0,
    "first_comment" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "sheet_id" bigint,
    CONSTRAINT "common_evaluation_results_first_score_check" CHECK ((("first_score" >= 0) AND ("first_score" <= 4))),
    CONSTRAINT "common_evaluation_results_second_score_check" CHECK ((("second_score" >= 0) AND ("second_score" <= 4)))
);


ALTER TABLE "public"."common_evaluation_results" OWNER TO "postgres";


ALTER TABLE "public"."common_evaluation_results" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."common_evaluation_results_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."employee_grades" (
    "id" smallint NOT NULL,
    "grade_name" "text" NOT NULL,
    "item_set_id" smallint
);


ALTER TABLE "public"."employee_grades" OWNER TO "postgres";


COMMENT ON TABLE "public"."employee_grades" IS '等級';



ALTER TABLE "public"."employee_grades" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."employee_grades_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" integer NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "employee_no" "text" NOT NULL,
    "role_id" integer,
    "career_course" "text",
    "primary_evaluator_id" integer,
    "secondary_evaluator_id" integer,
    "grade_id" smallint,
    "no_secondary_evaluator" boolean DEFAULT false NOT NULL,
    CONSTRAINT "employees_no_secondary_evaluator_check" CHECK ((NOT ("no_secondary_evaluator" AND ("secondary_evaluator_id" IS NOT NULL))))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


COMMENT ON COLUMN "public"."employees"."career_course" IS 'コース区分';



COMMENT ON COLUMN "public"."employees"."primary_evaluator_id" IS '一次評価者ID';



COMMENT ON COLUMN "public"."employees"."secondary_evaluator_id" IS '二次評価者ID';



COMMENT ON COLUMN "public"."employees"."grade_id" IS '等級ID';



COMMENT ON COLUMN "public"."employees"."no_secondary_evaluator" IS 'true: this employee has no secondary evaluator by decision; the primary evaluation is final. false with a null secondary_evaluator_id means not assigned yet.';



CREATE SEQUENCE IF NOT EXISTS "public"."employees_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."employees_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."employees_id_seq" OWNED BY "public"."employees"."id";



CREATE TABLE IF NOT EXISTS "public"."evaluation_periods" (
    "id" bigint NOT NULL,
    "period_name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."evaluation_periods" OWNER TO "postgres";


ALTER TABLE "public"."evaluation_periods" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."evaluation_periods_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."evaluation_sheets" (
    "id" bigint NOT NULL,
    "period_id" bigint NOT NULL,
    "employee_id" bigint NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "first_overall_comment" "text" DEFAULT ''::"text",
    "second_overall_comment" "text" DEFAULT ''::"text",
    "total_score" numeric(5,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "objectives_first_total_score" smallint,
    "objectives_first_total_rate" smallint,
    "objectives_second_total_score" smallint,
    "objectives_second_total_rate" smallint,
    "objectives_second_evaluation_score" smallint,
    "common_evaluation_first_total_score" smallint,
    "common_evaluation_first_total_rate" smallint,
    "common_evaluation_second_total_score" smallint,
    "common_evaluation_second_total_rate" smallint,
    "common_evaluation_second_evaluation_score" smallint,
    "total_evaluation_score" smallint,
    "final_rank_letter" "text",
    "final_rank_level" "text"
);


ALTER TABLE "public"."evaluation_sheets" OWNER TO "postgres";


ALTER TABLE "public"."evaluation_sheets" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."evaluation_sheets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."milestones" (
    "id" bigint NOT NULL,
    "goal_number" integer NOT NULL,
    "challenge_goal" "text" DEFAULT ''::"text",
    "midterm_goal" "text" DEFAULT ''::"text",
    "achievement" "text" DEFAULT ''::"text",
    "first_score" integer DEFAULT 0,
    "second_score" integer DEFAULT 0,
    "sheet_id" bigint,
    CONSTRAINT "milestones_first_score_check" CHECK ((("first_score" >= 0) AND ("first_score" <= 4))),
    CONSTRAINT "milestones_second_score_check" CHECK ((("second_score" >= 0) AND ("second_score" <= 4)))
);


ALTER TABLE "public"."milestones" OWNER TO "postgres";


ALTER TABLE "public"."milestones" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."milestones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" integer NOT NULL,
    "role_name" "text" NOT NULL
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."roles_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."roles_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."roles_id_seq" OWNED BY "public"."roles"."id";



CREATE TABLE IF NOT EXISTS "public"."sheet_review_checkpoints" (
    "sheet_id" bigint NOT NULL,
    "evaluator_id" integer NOT NULL,
    "stage" "text" NOT NULL,
    "revision" "text" NOT NULL,
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sheet_review_checkpoints_stage_check" CHECK (("stage" = ANY (ARRAY['primary'::"text", 'secondary'::"text"])))
);


ALTER TABLE "public"."sheet_review_checkpoints" OWNER TO "postgres";


ALTER TABLE ONLY "public"."employees" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."employees_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."roles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."roles_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."common_evaluation_item_sets"
    ADD CONSTRAINT "common_evaluation_item_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."common_evaluation_items"
    ADD CONSTRAINT "common_evaluation_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."common_evaluation_results"
    ADD CONSTRAINT "common_evaluation_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."common_evaluation_results"
    ADD CONSTRAINT "common_evaluation_results_sheet_id_item_id_key" UNIQUE ("sheet_id", "item_id");



ALTER TABLE ONLY "public"."employee_grades"
    ADD CONSTRAINT "employee_grades_grade_name_key" UNIQUE ("grade_name");



ALTER TABLE ONLY "public"."employee_grades"
    ADD CONSTRAINT "employee_grades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_employee_no_key" UNIQUE ("employee_no");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."evaluation_periods"
    ADD CONSTRAINT "evaluation_periods_period_name_key" UNIQUE ("period_name");



ALTER TABLE ONLY "public"."evaluation_periods"
    ADD CONSTRAINT "evaluation_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."evaluation_sheets"
    ADD CONSTRAINT "evaluation_sheets_period_id_employee_id_key" UNIQUE ("period_id", "employee_id");



ALTER TABLE ONLY "public"."evaluation_sheets"
    ADD CONSTRAINT "evaluation_sheets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_role_name_key" UNIQUE ("role_name");



ALTER TABLE ONLY "public"."sheet_review_checkpoints"
    ADD CONSTRAINT "sheet_review_checkpoints_pkey" PRIMARY KEY ("sheet_id", "evaluator_id", "stage");



CREATE INDEX "common_evaluation_items_item_set_id_idx" ON "public"."common_evaluation_items" USING "btree" ("item_set_id");



CREATE INDEX "common_results_review_sheet_idx" ON "public"."common_evaluation_results" USING "btree" ("sheet_id");



CREATE INDEX "evaluation_sheets_review_period_idx" ON "public"."evaluation_sheets" USING "btree" ("period_id", "employee_id");



CREATE INDEX "idx_employees_user_id" ON "public"."employees" USING "btree" ("user_id");



CREATE INDEX "milestones_review_sheet_idx" ON "public"."milestones" USING "btree" ("sheet_id");



ALTER TABLE ONLY "public"."common_evaluation_items"
    ADD CONSTRAINT "common_evaluation_items_item_set_id_fkey" FOREIGN KEY ("item_set_id") REFERENCES "public"."common_evaluation_item_sets"("id");



ALTER TABLE ONLY "public"."common_evaluation_results"
    ADD CONSTRAINT "common_evaluation_results_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."common_evaluation_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."common_evaluation_results"
    ADD CONSTRAINT "common_evaluation_results_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "public"."evaluation_sheets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_grades"
    ADD CONSTRAINT "employee_grades_item_set_id_fkey" FOREIGN KEY ("item_set_id") REFERENCES "public"."common_evaluation_item_sets"("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "public"."employee_grades"("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_primary_evaluator_id_fkey" FOREIGN KEY ("primary_evaluator_id") REFERENCES "public"."employees"("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_secondary_evaluator_id_fkey" FOREIGN KEY ("secondary_evaluator_id") REFERENCES "public"."employees"("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."evaluation_sheets"
    ADD CONSTRAINT "evaluation_sheets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."evaluation_sheets"
    ADD CONSTRAINT "evaluation_sheets_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."evaluation_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "public"."evaluation_sheets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sheet_review_checkpoints"
    ADD CONSTRAINT "sheet_review_checkpoints_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sheet_review_checkpoints"
    ADD CONSTRAINT "sheet_review_checkpoints_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "public"."evaluation_sheets"("id") ON DELETE CASCADE;



CREATE POLICY "Enable access for sheets based on employee access" ON "public"."evaluation_sheets" TO "authenticated" USING (true) WITH CHECK ("public"."check_employee_access"("employee_id", "auth"."uid"()));



CREATE POLICY "all true" ON "public"."common_evaluation_results" USING (true);



CREATE POLICY "all true" ON "public"."employees" USING (true);



ALTER TABLE "public"."common_evaluation_item_sets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."common_evaluation_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."common_evaluation_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_grades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."evaluation_periods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."evaluation_sheets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."milestones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "milestones all" ON "public"."milestones" USING (true);



CREATE POLICY "periods select" ON "public"."evaluation_periods" FOR SELECT USING (true);



ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles select all" ON "public"."roles" FOR SELECT USING (true);



CREATE POLICY "select" ON "public"."employee_grades" FOR SELECT USING (true);



CREATE POLICY "select c" ON "public"."common_evaluation_items" FOR SELECT USING (true);



ALTER TABLE "public"."sheet_review_checkpoints" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."check_employee_access"("target_employee_id" bigint, "current_user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_employee_access"("target_employee_id" bigint, "current_user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_employee_access"("target_employee_id" bigint, "current_user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_user_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_user_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_user_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_finalized_sheet_notification_recipients"("p_sheet_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_finalized_sheet_notification_recipients"("p_sheet_id" bigint) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_finalized_sheet_notification_recipients"("p_sheet_id" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_reviewer_workspace"("p_period_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_reviewer_workspace"("p_period_id" bigint) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_reviewer_workspace"("p_period_id" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reset_employee_registration"("p_employee_no" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_employee_registration"("p_employee_no" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."reset_employee_registration"("p_employee_no" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reviewer_sheet_snapshot"("p_sheet_id" bigint, "p_stage" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reviewer_sheet_snapshot"("p_sheet_id" bigint, "p_stage" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_sheet_reviewed"("p_sheet_id" bigint, "p_revision" "text", "p_reviewed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_sheet_reviewed"("p_sheet_id" bigint, "p_revision" "text", "p_reviewed" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_sheet_reviewed"("p_sheet_id" bigint, "p_revision" "text", "p_reviewed" boolean) TO "authenticated";


















GRANT ALL ON TABLE "public"."common_evaluation_item_sets" TO "anon";
GRANT ALL ON TABLE "public"."common_evaluation_item_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."common_evaluation_item_sets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."common_evaluation_item_sets_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."common_evaluation_item_sets_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."common_evaluation_item_sets_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."common_evaluation_items" TO "anon";
GRANT ALL ON TABLE "public"."common_evaluation_items" TO "authenticated";
GRANT ALL ON TABLE "public"."common_evaluation_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."common_evaluation_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."common_evaluation_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."common_evaluation_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."common_evaluation_results" TO "anon";
GRANT ALL ON TABLE "public"."common_evaluation_results" TO "authenticated";
GRANT ALL ON TABLE "public"."common_evaluation_results" TO "service_role";



GRANT ALL ON SEQUENCE "public"."common_evaluation_results_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."common_evaluation_results_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."common_evaluation_results_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."employee_grades" TO "anon";
GRANT ALL ON TABLE "public"."employee_grades" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_grades" TO "service_role";



GRANT ALL ON SEQUENCE "public"."employee_grades_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."employee_grades_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."employee_grades_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."evaluation_periods" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_periods" TO "service_role";



GRANT ALL ON SEQUENCE "public"."evaluation_periods_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."evaluation_periods_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."evaluation_periods_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."evaluation_sheets" TO "anon";
GRANT ALL ON TABLE "public"."evaluation_sheets" TO "authenticated";
GRANT ALL ON TABLE "public"."evaluation_sheets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."evaluation_sheets_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."evaluation_sheets_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."evaluation_sheets_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."milestones" TO "anon";
GRANT ALL ON TABLE "public"."milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."milestones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."milestones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sheet_review_checkpoints" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































