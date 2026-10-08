import { Employee } from "../../domain/entities/Employee";
import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { EvaluationSheet, type StoredSheetScores } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import type { CommonEvaluationRepository } from "../../domain/repositories/CommonEvaluationRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSettingsRepository } from "../../domain/repositories/EvaluationSettingsRepository";
import type {
	EvaluationSheetRepository,
	EvaluationSheetSummary,
} from "../../domain/repositories/EvaluationSheetRepository";
import type { EvaluationAllocatedScores } from "../../domain/valueObjects/EvaluationAllocatedScores";
import { EvaluationRank } from "../../domain/valueObjects/EvaluationRank";
import type { EvaluationScoreTotals } from "../../domain/valueObjects/EvaluationScoreTotals";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
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
	grade: { grade_name: string } | { grade_name: string }[] | null;
}

// grade はシート作成時の等級(evaluation_sheets.grade_id)。社員の今の等級ではない
const SHEET_LIST_SELECT =
	"id, period_id, employee_id, status, total_score, created_at, updated_at, period:evaluation_periods!inner(period_name, start_date, end_date), employee:employees!inner(name, employee_no), grade:employee_grades(grade_name)";

const first = <T>(joined: T | T[] | null): T | undefined =>
	Array.isArray(joined) ? joined[0] : (joined ?? undefined);

function toSheetSummary(item: EvaluationSheetListRow): EvaluationSheetSummary {
	const period = first(item.period);
	const employee = first(item.employee);
	return {
		id: item.id,
		periodId: item.period_id,
		employeeId: item.employee_id,
		status: EvaluationStatus.from(item.status),
		totalScore: item.total_score,
		createdAt: item.created_at,
		updatedAt: item.updated_at,
		periodName: period?.period_name ?? "",
		periodStart: period?.start_date ?? "",
		periodEnd: period?.end_date ?? "",
		employeeName: employee?.name ?? "",
		employeeNo: employee?.employee_no ?? "",
		gradeName: first(item.grade)?.grade_name ?? "",
	};
}

export class SupabaseEvaluationSheetRepository implements EvaluationSheetRepository {
	constructor(
		private readonly employeeRepository: EmployeeRepository,
		private readonly commonEvaluationRepository: CommonEvaluationRepository,
		private readonly settingsRepository: EvaluationSettingsRepository,
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
			first_rank?: string | null;
			objective_allocation?: number | null;
			common_allocation?: number | null;
			/** シート作成時の等級(DB のトリガーが作成時に固定する)。 */
			grade_id: number | null;
			/** シートの評価者。未確定の間は DB のトリガーが社員マスタに合わせ、確定後は変わらない。 */
			primary_evaluator_id?: number | null;
			secondary_evaluator_id?: number | null;
			no_secondary_evaluator?: boolean | null;
			created_at: string;
			updated_at: string;
		};

		const employee = await this.employeeRepository.findById(sheet.employee_id);
		if (!employee) {
			return null;
		}

		// 評価者は、社員マスタの今の評価者ではなく、シートが持つ評価者
		const subject = new Employee(
			employee.id,
			employee.name,
			employee.employeeNo,
			employee.roleId,
			employee.careerCourse,
			employee.gradeId,
			sheet.primary_evaluator_id ?? null,
			sheet.secondary_evaluator_id ?? null,
			sheet.no_secondary_evaluator ?? false,
		);
		const evaluatorNames = await this.employeeRepository.findEvaluatorNames(
			subject.primaryEvaluatorId,
			subject.secondaryEvaluatorId,
			subject.noSecondaryEvaluator,
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

		if (milestoneError) {
			throw milestoneError;
		}
		const objectives =
			((milestonesData ?? []) as MilestoneRow[]).map((item) =>
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
			sheet.grade_id,
		);

		// DB の文字列は、ここで一度だけ状態に変換する
		const status = EvaluationStatus.from(sheet.status);
		const stored: StoredSheetScores = {
			objectivesFirstTotalScore: sheet.objectives_first_total_score,
			objectivesFirstTotalRate: sheet.objectives_first_total_rate,
			objectivesSecondTotalScore: sheet.objectives_second_total_score,
			objectivesSecondTotalRate: sheet.objectives_second_total_rate,
			commonEvaluationFirstTotalScore: sheet.common_evaluation_first_total_score,
			commonEvaluationFirstTotalRate: sheet.common_evaluation_first_total_rate,
			commonEvaluationSecondTotalScore: sheet.common_evaluation_second_total_score,
			commonEvaluationSecondTotalRate: sheet.common_evaluation_second_total_rate,
			objectivesSecondEvaluationScore: sheet.objectives_second_evaluation_score,
			commonEvaluationSecondEvaluationScore: sheet.common_evaluation_second_evaluation_score,
			totalEvaluationScore: sheet.total_evaluation_score,
			objectiveAllocation: sheet.objective_allocation,
			commonAllocation: sheet.common_allocation,
		};
		// 確定時の配点がなければ、現在の設定を読む(確定済みのシートは設定を読まない)
		const [allocation, maxObjectives] = await Promise.all([
			EvaluationSheet.storedAllocation(status, stored) ?? this.settingsRepository.findAllocation(),
			this.settingsRepository.findMaxChallengeGoals(),
		]);

		return EvaluationSheet.restore({
			sheetId: sheet.id,
			subject,
			evaluationPeriod,
			primaryEvaluatorName: evaluatorNames.primaryEvaluator,
			secondaryEvaluatorName: evaluatorNames.secondaryEvaluator,
			firstOverallComment: sheet.first_overall_comment ?? "",
			secondOverallComment: sheet.second_overall_comment ?? "",
			objectives,
			commonEvaluationResults: results.results,
			stored,
			allocation,
			status,
			gradeId: sheet.grade_id,
			maxObjectives,
			finalEvaluationRank: EvaluationRank.fromOptional(
				sheet.final_rank_letter,
				sheet.final_rank_level,
			),
			firstEvaluationRank: EvaluationRank.fromText(sheet.first_rank),
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
			// この評価点を計算したときの配点。確定後はこの値を使い続ける
			payload.objective_allocation = totals.allocatedScores.objectiveAllocationScore;
			payload.common_allocation = totals.allocatedScores.commonEvaluationAllocationScore;
		}

		if (Object.keys(payload).length === 0) {
			return;
		}

		const { error } = await supabase.from("evaluation_sheets").update(payload).eq("id", sheetId);

		if (error) {
			throw error;
		}
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

	async updateStatus(
		sheetId: number,
		status: EvaluationStatus,
		ranks: { first?: EvaluationRank; final?: EvaluationRank } = {},
	): Promise<EvaluationSheet> {
		const { error } = await supabase
			.from("evaluation_sheets")
			.update({
				status: status.toString(),
				...(ranks.first ? { first_rank: ranks.first.toDisplayText() } : {}),
				...(ranks.final
					? { final_rank_letter: ranks.final.letter, final_rank_level: ranks.final.level }
					: {}),
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

	async findByOwner(employeeId: number): Promise<EvaluationSheetSummary[]> {
		const { data, error } = await supabase
			.from("evaluation_sheets")
			.select(SHEET_LIST_SELECT)
			.eq("employee_id", employeeId);

		return error || !data ? [] : (data as EvaluationSheetListRow[]).map(toSheetSummary);
	}

	async findByEvaluator(employeeId: number): Promise<EvaluationSheetSummary[]> {
		const { data, error } = await supabase
			.from("evaluation_sheets")
			.select(SHEET_LIST_SELECT)
			.or(`primary_evaluator_id.eq.${employeeId},secondary_evaluator_id.eq.${employeeId}`)
			.neq("employee_id", employeeId);

		return error || !data ? [] : (data as EvaluationSheetListRow[]).map(toSheetSummary);
	}
}
