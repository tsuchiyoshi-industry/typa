import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import type { CommonEvaluationRepository } from "../../domain/repositories/CommonEvaluationRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type {
	EvaluationSheetExportData,
	EvaluationSheetRepository,
	EvaluationSheetSummary,
} from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationAllocatedScores } from "../../domain/valueObjects/EvaluationAllocatedScores";
import { EvaluationScoreTotals } from "../../domain/valueObjects/EvaluationScoreTotals";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { FinalEvaluationRank } from "../../domain/valueObjects/FinalEvaluationRank";
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
}

interface PeriodJoinRow {
	period_name: string;
	start_date: string;
	end_date: string;
}

interface EmployeeJoinRow {
	name: string;
	employee_no: string;
	career_course?: string | null;
	grade_id?: number | null;
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
			first_overall_comment: string | null;
			second_overall_comment: string | null;
			objectives_first_total_score?: number | null;
			objectives_first_total_rate?: number | null;
			objectives_second_total_score?: number | null;
			objectives_second_total_rate?: number | null;
			common_evaluation_first_total_score?: number | null;
			common_evaluation_first_total_rate?: number | null;
			common_evaluation_second_total_score?: number | null;
			common_evaluation_second_total_rate?: number | null;
			objectives_second_evaluation_score?: number | null;
			common_evaluation_second_evaluation_score?: number | null;
			total_evaluation_score?: number | null;
			final_rank_letter?: string | null;
			final_rank_level?: string | null;
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
					}),
				) ?? [];

		const results = await this.commonEvaluationRepository.findResultsBySheetId(
			sheet.id,
			employee.gradeId ?? null,
		);

		const hasObjectiveTotals = [
			sheet.objectives_first_total_score,
			sheet.objectives_first_total_rate,
			sheet.objectives_second_total_score,
			sheet.objectives_second_total_rate,
		].some((value) => value != null);
		const hasCommonEvaluationTotals = [
			sheet.common_evaluation_first_total_score,
			sheet.common_evaluation_first_total_rate,
			sheet.common_evaluation_second_total_score,
			sheet.common_evaluation_second_total_rate,
		].some((value) => value != null);
		const hasAllocatedScores = [
			sheet.objectives_second_evaluation_score,
			sheet.common_evaluation_second_evaluation_score,
			sheet.total_evaluation_score,
		].some((value) => value != null);
		const objectiveScoreTotals = hasObjectiveTotals
			? EvaluationScoreTotals.fromValues({
					firstTotalScore: sheet.objectives_first_total_score,
					firstTotalRate: sheet.objectives_first_total_rate,
					secondTotalScore: sheet.objectives_second_total_score,
					secondTotalRate: sheet.objectives_second_total_rate,
				})
			: undefined;
		const commonEvaluationScoreTotals = hasCommonEvaluationTotals
			? EvaluationScoreTotals.fromValues({
					firstTotalScore: sheet.common_evaluation_first_total_score,
					firstTotalRate: sheet.common_evaluation_first_total_rate,
					secondTotalScore: sheet.common_evaluation_second_total_score,
					secondTotalRate: sheet.common_evaluation_second_total_rate,
				})
			: undefined;

		return EvaluationSheet.create({
			sheetId: sheet.id,
			subject: employee,
			evaluationPeriod,
			primaryEvaluatorName: evaluatorNames.primaryEvaluator,
			secondaryEvaluatorName: evaluatorNames.secondaryEvaluator,
			firstOverallComment: sheet.first_overall_comment ?? "",
			secondOverallComment: sheet.second_overall_comment ?? "",
			objectives,
			commonEvaluationResults: results.results,
			objectiveScoreTotals,
			commonEvaluationScoreTotals,
			allocatedScores: hasAllocatedScores
				? EvaluationAllocatedScores.fromValues({
						objectiveSecondRate: sheet.objectives_second_total_rate,
						objectiveEvaluationScore: sheet.objectives_second_evaluation_score,
						commonEvaluationSecondRate: sheet.common_evaluation_second_total_rate,
						commonEvaluationEvaluationScore: sheet.common_evaluation_second_evaluation_score,
						totalEvaluationScore: sheet.total_evaluation_score,
					})
				: undefined,
			status: EvaluationStatus.from(sheet.status),
			finalEvaluationRank: FinalEvaluationRank.fromOptional(
				sheet.final_rank_letter,
				sheet.final_rank_level,
			),
		});
	}

	async updateScoreTotals(
		sheetId: number,
		totals: {
			objectives?: EvaluationScoreTotals;
			commonEvaluationResults?: EvaluationScoreTotals;
			allocatedScores?: EvaluationAllocatedScores;
		},
	): Promise<void> {
		const payload: Record<string, number> = {};

		if (totals.objectives) {
			payload.objectives_first_total_score = totals.objectives.firstTotalScore;
			payload.objectives_first_total_rate = totals.objectives.firstTotalRate;
			payload.objectives_second_total_score = totals.objectives.secondTotalScore;
			payload.objectives_second_total_rate = totals.objectives.secondTotalRate;
		}

		if (totals.commonEvaluationResults) {
			payload.common_evaluation_first_total_score = totals.commonEvaluationResults.firstTotalScore;
			payload.common_evaluation_first_total_rate = totals.commonEvaluationResults.firstTotalRate;
			payload.common_evaluation_second_total_score =
				totals.commonEvaluationResults.secondTotalScore;
			payload.common_evaluation_second_total_rate = totals.commonEvaluationResults.secondTotalRate;
		}

		if (totals.allocatedScores) {
			payload.objectives_second_evaluation_score = totals.allocatedScores.objectiveEvaluationScore;
			payload.common_evaluation_second_evaluation_score =
				totals.allocatedScores.commonEvaluationEvaluationScore;
			payload.total_evaluation_score = totals.allocatedScores.totalEvaluationScore;
		}

		if (Object.keys(payload).length === 0) {
			return;
		}

		const { error } = await supabase.from("evaluation_sheets").update(payload).eq("id", sheetId);

		if (error) {
			throw error;
		}
	}

	async updateFinalEvaluationRank(
		sheetId: number,
		finalEvaluationRank: FinalEvaluationRank | undefined,
	): Promise<EvaluationSheet> {
		const { error } = await supabase
			.from("evaluation_sheets")
			.update({
				final_rank_letter: finalEvaluationRank?.letter ?? null,
				final_rank_level: finalEvaluationRank?.level ?? null,
			})
			.eq("id", sheetId);

		if (error) {
			throw error;
		}

		const updated = await this.findById(sheetId);
		if (!updated) {
			throw new Error("Failed to load updated evaluation sheet.");
		}

		return updated;
	}

	async updateOverallComment(
		sheetId: number,
		target: "first" | "second",
		comment: string,
	): Promise<EvaluationSheet> {
		const column = target === "first" ? "first_overall_comment" : "second_overall_comment";
		const { error } = await supabase
			.from("evaluation_sheets")
			.update({ [column]: comment })
			.eq("id", sheetId);

		if (error) {
			throw error;
		}

		const updated = await this.findById(sheetId);
		if (!updated) {
			throw new Error("Failed to load updated evaluation sheet.");
		}

		return updated;
	}

	async updateStatus(sheetId: number, status: EvaluationStatus): Promise<EvaluationSheet> {
		const { error } = await supabase
			.from("evaluation_sheets")
			.update({ status: status.toString() })
			.eq("id", sheetId);

		if (error) {
			throw error;
		}

		const updated = await this.findById(sheetId);
		if (!updated) {
			throw new Error("Failed to load updated evaluation sheet.");
		}

		return updated;
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

	async findExportData(sheetId: number): Promise<EvaluationSheetExportData | null> {
		// シート基本情報を取得
		const { data: sheetData, error: sheetError } = await supabase
			.from("evaluation_sheets")
			.select(
				`
				id,
				period_id,
				employee_id,
				status,
				total_score,
				first_overall_comment,
				second_overall_comment,
				objectives_second_total_rate,
				common_evaluation_second_total_rate,
				objectives_second_evaluation_score,
				common_evaluation_second_evaluation_score,
				total_evaluation_score,
				final_rank_letter,
				final_rank_level,
				period:evaluation_periods!inner(period_name, start_date, end_date),
				employee:employees!inner(name, employee_no, career_course, grade_id, primary_evaluator_id, secondary_evaluator_id)
			`,
			)
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
			first_overall_comment: string | null;
			second_overall_comment: string | null;
			objectives_second_total_rate?: number | null;
			common_evaluation_second_total_rate?: number | null;
			objectives_second_evaluation_score?: number | null;
			common_evaluation_second_evaluation_score?: number | null;
			total_evaluation_score?: number | null;
			final_rank_letter?: string | null;
			final_rank_level?: string | null;
			period: PeriodJoinRow | PeriodJoinRow[];
			employee: (EmployeeJoinRow & {
				career_course: string | null;
				grade_id: number | null;
				primary_evaluator_id: number | null;
				secondary_evaluator_id: number | null;
			})[];
		};

		const period = Array.isArray(sheet.period) ? sheet.period[0] : sheet.period;
		const employee = Array.isArray(sheet.employee) ? sheet.employee[0] : sheet.employee;
		const gradeName = await this.employeeRepository.findGradeName(employee.grade_id);

		// 評価者名を取得
		const evaluatorNames = await this.employeeRepository.findEvaluatorNames(
			employee.primary_evaluator_id,
			employee.secondary_evaluator_id,
		);

		// マイルストーン情報を取得
		const { data: milestonesData } = await supabase
			.from("milestones")
			.select("*")
			.eq("sheet_id", sheetId)
			.order("goal_number", { ascending: true });

		const milestoneEntities =
			(milestonesData as MilestoneRow[] | null)?.map((item) =>
				Milestone.create({
					id: item.id,
					sheetId: item.sheet_id,
					goalNumber: item.goal_number,
					challengeGoal: item.challenge_goal ?? "",
					midtermGoal: item.midterm_goal ?? "",
					achievement: item.achievement ?? "",
					firstScore: item.first_score ?? 0,
					secondScore: item.second_score ?? 0,
				}),
			) ?? [];

		const objectives = milestoneEntities.map((item) => ({
			id: item.id,
			goalNumber: item.goalNumber,
			challengeGoal: item.challengeGoal,
			midtermGoal: item.midtermGoal,
			achievement: item.achievement,
			selfScore: item.firstScore.toNumber(),
			evaluatorScore: item.secondScore.toNumber(),
		}));

		const commonEvaluationSummary = await this.commonEvaluationRepository.findResultsBySheetId(
			sheetId,
			employee.grade_id ?? null,
		);
		const commonEvaluations = commonEvaluationSummary.results.map((result) => ({
			itemName: result.item.title,
			itemDescription: result.item.description,
			weight: result.item.weight,
			selfScore: result.firstScore.toNumber(),
			evaluatorScore: result.secondScore.toNumber(),
			selfComment: result.firstComment.toString(),
			evaluatorComment: null,
		}));
		const objectiveTotals = EvaluationScoreTotals.fromObjectives(milestoneEntities);
		const commonEvaluationTotals = EvaluationScoreTotals.fromCommonEvaluationResults(
			commonEvaluationSummary.results,
		);
		const allocatedScores = EvaluationAllocatedScores.fromValues({
			objectiveSecondRate: sheet.objectives_second_total_rate ?? objectiveTotals.secondTotalRate,
			objectiveEvaluationScore: sheet.objectives_second_evaluation_score,
			commonEvaluationSecondRate:
				sheet.common_evaluation_second_total_rate ?? commonEvaluationTotals.secondTotalRate,
			commonEvaluationEvaluationScore: sheet.common_evaluation_second_evaluation_score,
			totalEvaluationScore: sheet.total_evaluation_score,
		});
		const finalEvaluationRank = FinalEvaluationRank.fromOptional(
			sheet.final_rank_letter,
			sheet.final_rank_level,
		);

		return {
			sheetId: sheet.id,
			employeeName: employee.name,
			employeeNo: employee.employee_no,
			careerCourse: employee.career_course ?? "",
			gradeName,
			periodName: period.period_name,
			periodStart: period.start_date,
			periodEnd: period.end_date,
			primaryEvaluator: evaluatorNames.primaryEvaluator,
			secondaryEvaluator: evaluatorNames.secondaryEvaluator,
			status: sheet.status,
			totalScore: sheet.total_score,
			finalEvaluationRank: finalEvaluationRank?.toDisplayText() ?? "",
			objectiveAllocationScore: allocatedScores.objectiveAllocationScore,
			objectiveSecondRate: allocatedScores.objectiveSecondRate,
			objectiveEvaluationScore: allocatedScores.objectiveEvaluationScore,
			commonEvaluationAllocationScore: allocatedScores.commonEvaluationAllocationScore,
			commonEvaluationSecondRate: allocatedScores.commonEvaluationSecondRate,
			commonEvaluationEvaluationScore: allocatedScores.commonEvaluationEvaluationScore,
			totalEvaluationScore: allocatedScores.totalEvaluationScore,
			firstOverallComment: sheet.first_overall_comment ?? "",
			secondOverallComment: sheet.second_overall_comment ?? "",
			objectives,
			commonEvaluations,
		};
	}
}
