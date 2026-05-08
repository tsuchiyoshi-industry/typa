import { supabase } from "../../../utils/supabase";
import { type EvaluationPeriod, fetchEvaluatorNames } from "./evaluationPeriods";

export interface Employee {
	id: number;
	name: string;
	employee_no: string;
	role_id: number;
	career_course?: string;
	grade?: string;
	primary_evaluator_id?: number;
	secondary_evaluator_id?: number;
}

export interface Milestone {
	id: number;
	sheet_id: number;
	goal_number: number;
	challenge_goal: string;
	midterm_goal: string;
	achievement: string;
	first_score: number;
	second_score: number;
	is_editable: boolean;
}

export interface EvaluationSheetRecord {
	id: number;
	period_id: number;
	employee_id: number;
	status: string;
	first_overall_comment: string;
	second_overall_comment: string;
	total_score: number;
	created_at: string;
	updated_at: string;
}

export interface EvaluationSheet {
	sheetId: number | null;
	subject: Employee | null;
	evaluationPeriod: EvaluationPeriod | null;
	primaryEvaluator: string;
	secondaryEvaluator: string;
	objectives: Milestone[];
}

export const fetchEvaluationSheetById = async (sheetId: number): Promise<EvaluationSheet> => {
	// evaluation_sheets を取得
	const { data: sheetRecord, error: sheetError } = await supabase
		.from("evaluation_sheets")
		.select("*")
		.eq("id", sheetId)
		.single();

	if (sheetError) {
		throw sheetError;
	}

	const sheet = sheetRecord as EvaluationSheetRecord;

	// 評価期間を取得
	const { data: selectedPeriod, error: periodError } = await supabase
		.from("evaluation_periods")
		.select("*")
		.eq("id", sheet.period_id)
		.maybeSingle();

	if (periodError) {
		console.warn("Evaluation period fetch failed:", periodError.message);
	}

	// 社員を取得
	const { data: employeeData, error: employeeError } = await supabase
		.from("employees")
		.select("*")
		.eq("id", sheet.employee_id)
		.single();

	if (employeeError) {
		throw employeeError;
	}

	const subject = employeeData as Employee;

	const evaluatorNames = await fetchEvaluatorNames(
		subject.primary_evaluator_id ?? null,
		subject.secondary_evaluator_id ?? null,
	);
	const { primaryEvaluator, secondaryEvaluator } = evaluatorNames;

	// sheet_id でマイルストーンを取得
	const { data: milestones, error: milestoneError } = await supabase
		.from("milestones")
		.select("*")
		.eq("sheet_id", sheet.id)
		.order("goal_number", { ascending: true });

	if (milestoneError) {
		console.warn("Milestones fetch failed:", milestoneError.message);
	}

	const objectives =
		(milestones as Milestone[] | null)?.slice(0, 2).map((item) => ({
			id: item.id,
			sheet_id: item.sheet_id,
			goal_number: item.goal_number,
			challenge_goal: item.challenge_goal || "",
			midterm_goal: item.midterm_goal || "",
			achievement: item.achievement || "",
			first_score: item.first_score ?? 0,
			second_score: item.second_score ?? 0,
			is_editable: item.is_editable ?? false,
		})) ?? [];

	const normalizedObjectives = objectives;
	while (normalizedObjectives.length < 2) {
		normalizedObjectives.push({
			id: normalizedObjectives.length + 1,
			sheet_id: sheet.id,
			goal_number: normalizedObjectives.length + 1,
			challenge_goal: "",
			midterm_goal: "",
			achievement: "",
			first_score: 0,
			second_score: 0,
			is_editable: false,
		});
	}

	return {
		sheetId: sheet.id,
		subject,
		evaluationPeriod: selectedPeriod ?? null,
		primaryEvaluator,
		secondaryEvaluator,
		objectives: normalizedObjectives,
	};
};

export const fetchEvaluationSheetByPeriodId = async (
	periodId: number | null,
): Promise<EvaluationSheet> => {
	if (!periodId) {
		return {
			sheetId: null,
			subject: null,
			evaluationPeriod: null,
			primaryEvaluator: "未設定",
			secondaryEvaluator: "未設定",
			objectives: [],
		};
	}

	// 評価期間を取得
	const { data: selectedPeriod, error: periodError } = await supabase
		.from("evaluation_periods")
		.select("*")
		.eq("id", periodId)
		.maybeSingle();

	if (periodError) {
		console.warn("Evaluation period fetch failed:", periodError.message);
	}

	// ログインユーザーに紐づく社員を取得
	const { data: employees, error: employeeError } = await supabase.from("employees").select("*");
	if (employeeError) {
		console.error("Error fetching employees:", employeeError.message);
		throw employeeError;
	}

	const sheetEmployees = employees ?? [];
	const subject = (sheetEmployees[0] as Employee) ?? null;

	// evaluation_sheets から sheet_id を取得（period_id + employee_id の組み合わせ）
	const { data: sheetRecord, error: sheetError } = await supabase
		.from("evaluation_sheets")
		.select("*")
		.eq("period_id", periodId)
		.eq("employee_id", subject?.id ?? 0)
		.maybeSingle();

	if (sheetError) {
		console.warn("Evaluation sheet fetch failed:", sheetError.message);
	}

	const sheet = sheetRecord as EvaluationSheetRecord | null;

	const evaluatorNames = await fetchEvaluatorNames(
		subject?.primary_evaluator_id ?? null,
		subject?.secondary_evaluator_id ?? null,
	);
	const { primaryEvaluator, secondaryEvaluator } = evaluatorNames;

	// sheet_id でマイルストーンを取得
	const { data: milestones, error: milestoneError } = await supabase
		.from("milestones")
		.select("*")
		.eq("sheet_id", sheet?.id ?? 0)
		.order("goal_number", { ascending: true });

	if (milestoneError) {
		console.warn("Milestones fetch failed:", milestoneError.message);
	}

	const objectives =
		(milestones as Milestone[] | null)?.slice(0, 2).map((item) => ({
			id: item.id,
			sheet_id: item.sheet_id,
			goal_number: item.goal_number,
			challenge_goal: item.challenge_goal || "",
			midterm_goal: item.midterm_goal || "",
			achievement: item.achievement || "",
			first_score: item.first_score ?? 0,
			second_score: item.second_score ?? 0,
			is_editable: item.is_editable ?? false,
		})) ?? [];

	const normalizedObjectives = objectives;
	while (normalizedObjectives.length < 2) {
		normalizedObjectives.push({
			id: normalizedObjectives.length + 1,
			sheet_id: sheet?.id ?? 0,
			goal_number: normalizedObjectives.length + 1,
			challenge_goal: "",
			midterm_goal: "",
			achievement: "",
			first_score: 0,
			second_score: 0,
			is_editable: false,
		});
	}

	return {
		sheetId: sheet?.id ?? null,
		subject,
		evaluationPeriod: (selectedPeriod as EvaluationPeriod | null) ?? null,
		primaryEvaluator,
		secondaryEvaluator,
		objectives: normalizedObjectives,
	};
};

// NOTE: 上司が部下のデータにアクセスできる仕組みはここではなくPostgresの方で実装されている

// -- 特権モード(security definer)で評価関係をチェックする関数
// create or replace function public.check_employee_access(target_employee_id bigint, current_user_uuid uuid)
// returns boolean as $
// declare
//   is_accessible boolean;
// begin
//   select exists (
//     with me as (
//       select id, primary_evaluator_id, secondary_evaluator_id
//       from public.employees
//       where user_id = current_user_uuid
//     )
//     select 1
//     from me
//     where
//       -- 1. 自分がそのレコード本人である
//       (me.id = target_employee_id)
//       OR
//       -- 2. 自分がそのレコードの評価者である
//       (target_employee_id IN (
//         select id from public.employees
//         where primary_evaluator_id = me.id OR secondary_evaluator_id = me.id
//       ))
//       OR
//       -- 3. そのレコードが自分の評価者である
//       (target_employee_id IN (me.primary_evaluator_id, me.secondary_evaluator_id))
//   ) into is_accessible;
//   return is_accessible;
// end;
// $ language plpgsql security definer;

// drop policy if exists "Enable access for self and evaluators" on "public"."employees";

// create policy "Enable access for self and evaluators"
// on "public"."employees"
// as PERMISSIVE
// for ALL
// to authenticated
// using (
//   -- 関数の結果が true ならアクセス許可
//   public.check_employee_access(id, auth.uid())
// )
// with check (
//   -- 更新は本人のみ
//   auth.uid() = user_id
// );
