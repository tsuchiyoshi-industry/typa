import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import type { CommonEvaluationRepository } from "../../domain/repositories/CommonEvaluationRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type {
	EvaluationSheetRepository,
	EvaluationSheetSummary,
} from "../../domain/repositories/EvaluationSheetRepository";
import { supabase } from "../db/supabase";

interface MilestoneRow {
	id: number;
	sheet_id: number;
	goal_number: number;
	challenge_goal: string | null;
	midterm_goal: string | null;
	achievement: string | null;
	first_score: number | null;
	second_score: number | null;
	is_editable: boolean | null;
}

interface PeriodJoinRow {
	period_name: string;
	start_date: string;
	end_date: string;
}

interface EmployeeJoinRow {
	name: string;
	employee_no: string;
}

interface EvaluationSheetListRow {
	id: number;
	period_id: number;
	employee_id: number;
	status: string;
	total_score: number;
	created_at: string;
	updated_at: string;
	period: PeriodJoinRow | PeriodJoinRow[] | null;
	employee: EmployeeJoinRow | EmployeeJoinRow[] | null;
}

export class SupabaseEvaluationSheetRepository implements EvaluationSheetRepository {
	constructor(
		private readonly employeeRepository: EmployeeRepository,
		private readonly commonEvaluationRepository: CommonEvaluationRepository,
	) {}

	async createOrGetSheet(periodId: number, employeeId: number): Promise<number> {
		const { data, error } = await supabase
			.from("evaluation_sheets")
			.upsert(
				{ period_id: periodId, employee_id: employeeId },
				{ onConflict: "period_id,employee_id", ignoreDuplicates: false },
			)
			.select("id")
			.single();

		if (error || !data) {
			throw error ?? new Error("Failed to create or get evaluation sheet.");
		}

		return (data as { id: number }).id;
	}

	async findById(sheetId: number): Promise<EvaluationSheet | null> {
		const { data: sheetData, error: sheetError } = await supabase
			.from("evaluation_sheets")
			.select("*")
			.eq("id", sheetId)
			.single();

		if (sheetError || !sheetData) {
			return null;
		}

		const sheet = sheetData as {
			id: number;
			period_id: number;
			employee_id: number;
			status: string;
			total_score: number;
			created_at: string;
			updated_at: string;
		};

		const employee = await this.employeeRepository.findById(sheet.employee_id);
		if (!employee) {
			return null;
		}

		const evaluatorNames = await this.employeeRepository.findEvaluatorNames(
			employee.primaryEvaluatorId,
			employee.secondaryEvaluatorId,
		);

		const { data: periodData } = await supabase
			.from("evaluation_periods")
			.select("id, period_name, start_date, end_date, is_active")
			.eq("id", sheet.period_id)
			.maybeSingle();

		const periodRow = periodData as {
			id: number;
			period_name: string;
			start_date: string;
			end_date: string;
			is_active: boolean;
		} | null;

		const evaluationPeriod = new EvaluationPeriod(
			periodRow?.id ?? 0,
			periodRow?.period_name ?? "",
			periodRow?.start_date ?? "",
			periodRow?.end_date ?? "",
			periodRow?.is_active ?? false,
		);

		const { data: milestonesData, error: milestoneError } = await supabase
			.from("milestones")
			.select("*")
			.eq("sheet_id", sheet.id)
			.order("goal_number", { ascending: true });

		const objectives =
			(milestoneError || !milestonesData ? [] : (milestonesData as MilestoneRow[]))
				.slice(0, 2)
				.map((item) =>
					Milestone.create({
						id: item.id,
						sheetId: item.sheet_id,
						goalNumber: item.goal_number,
						challengeGoal: item.challenge_goal ?? "",
						midtermGoal: item.midterm_goal ?? "",
						achievement: item.achievement ?? "",
						firstScore: item.first_score ?? 0,
						secondScore: item.second_score ?? 0,
						isEditable: item.is_editable ?? false,
					}),
				) ?? [];

		while (objectives.length < 2) {
			objectives.push(
				Milestone.create({
					id: objectives.length + 1,
					sheetId: sheet.id,
					goalNumber: objectives.length + 1,
					challengeGoal: "",
					midtermGoal: "",
					achievement: "",
					firstScore: 0,
					secondScore: 0,
					isEditable: false,
				}),
			);
		}

		const results = await this.commonEvaluationRepository.findResultsBySheetId(
			sheet.id,
			employee.gradeId ?? null,
		);

		return EvaluationSheet.create({
			sheetId: sheet.id,
			subject: employee,
			evaluationPeriod,
			primaryEvaluatorName: evaluatorNames.primaryEvaluator,
			secondaryEvaluatorName: evaluatorNames.secondaryEvaluator,
			objectives,
			commonEvaluationResults: results.results,
		});
	}

	async findByOwner(employeeId: number): Promise<EvaluationSheetSummary[]> {
		const { data, error } = await supabase
			.from("evaluation_sheets")
			.select(
				`id, period_id, employee_id, status, total_score, created_at, updated_at, period:evaluation_periods!inner(period_name, start_date, end_date), employee:employees!inner(name, employee_no)`,
			)
			.eq("employee_id", employeeId);

		if (error || !data) {
			return [];
		}

		return (data as EvaluationSheetListRow[]).map((item) => ({
			id: item.id,
			periodId: item.period_id,
			employeeId: item.employee_id,
			status: item.status,
			totalScore: item.total_score,
			createdAt: item.created_at,
			updatedAt: item.updated_at,
			periodName: Array.isArray(item.period)
				? (item.period[0]?.period_name ?? "")
				: (item.period?.period_name ?? ""),
			periodStart: Array.isArray(item.period)
				? (item.period[0]?.start_date ?? "")
				: (item.period?.start_date ?? ""),
			periodEnd: Array.isArray(item.period)
				? (item.period[0]?.end_date ?? "")
				: (item.period?.end_date ?? ""),
			employeeName: Array.isArray(item.employee)
				? (item.employee[0]?.name ?? "")
				: (item.employee?.name ?? ""),
			employeeNo: Array.isArray(item.employee)
				? (item.employee[0]?.employee_no ?? "")
				: (item.employee?.employee_no ?? ""),
		}));
	}

	async findByEmployeeIds(employeeIds: number[]): Promise<EvaluationSheetSummary[]> {
		if (employeeIds.length === 0) {
			return [];
		}

		const { data, error } = await supabase
			.from("evaluation_sheets")
			.select(
				`id, period_id, employee_id, status, total_score, created_at, updated_at, period:evaluation_periods!inner(period_name, start_date, end_date), employee:employees!inner(name, employee_no)`,
			)
			.in("employee_id", employeeIds);

		if (error || !data) {
			return [];
		}

		return (data as EvaluationSheetListRow[]).map((item) => ({
			id: item.id,
			periodId: item.period_id,
			employeeId: item.employee_id,
			status: item.status,
			totalScore: item.total_score,
			createdAt: item.created_at,
			updatedAt: item.updated_at,
			periodName: Array.isArray(item.period)
				? (item.period[0]?.period_name ?? "")
				: (item.period?.period_name ?? ""),
			periodStart: Array.isArray(item.period)
				? (item.period[0]?.start_date ?? "")
				: (item.period?.start_date ?? ""),
			periodEnd: Array.isArray(item.period)
				? (item.period[0]?.end_date ?? "")
				: (item.period?.end_date ?? ""),
			employeeName: Array.isArray(item.employee)
				? (item.employee[0]?.name ?? "")
				: (item.employee?.name ?? ""),
			employeeNo: Array.isArray(item.employee)
				? (item.employee[0]?.employee_no ?? "")
				: (item.employee?.employee_no ?? ""),
		}));
	}
}
