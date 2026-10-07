import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { EvaluationSheet } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import type { CommonEvaluationRepository } from "../../domain/repositories/CommonEvaluationRepository";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationSettingsRepository } from "../../domain/repositories/EvaluationSettingsRepository";
import type {
	EvaluationSheetExportData,
	EvaluationSheetRepository,
	EvaluationSheetSummary,
} from "../../domain/repositories/EvaluationSheetRepository";
import { EvaluationAllocatedScores } from "../../domain/valueObjects/EvaluationAllocatedScores";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../../domain/valueObjects/EvaluationRank";
import { EvaluationScoreTotals } from "../../domain/valueObjects/EvaluationScoreTotals";
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

	/**
	 * 確定済みのシートは確定時の配点を使い、後から設定を変えても確定した評価点と食い違わないようにする。
	 * それ以外は現在の設定で計算する。
	 */
	private async allocationFor(
		status: EvaluationStatus,
		sheet: { objective_allocation?: number | null; common_allocation?: number | null },
	): Promise<EvaluationAllocation> {
		return status.isFinalized() &&
			sheet.objective_allocation != null &&
			sheet.common_allocation != null
			? EvaluationAllocation.of(sheet.objective_allocation, sheet.common_allocation)
			: this.settingsRepository.findAllocation();
	}

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
			employee.noSecondaryEvaluator,
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
			((milestonesData ?? []) as MilestoneRow[]).slice(0, 2).map((item) =>
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

		// DB の文字列は、ここで一度だけ状態に変換する
		const status = EvaluationStatus.from(sheet.status);
		const allocation = await this.allocationFor(status, sheet);
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
		// 保存されている合計と得点率は、点数を保存したときの項目・満点で計算したもの。等級や項目が
		// 変わると実際の点数と食い違うので、確定済みのシートだけがそれを使う(満点は渡さず、保存時の
		// 得点率で換算する)。未確定のシートは、いまの目標・共通評価の点数から計算し直す。
		const finalized = status.isFinalized();
		const objectiveScoreTotals =
			finalized && hasObjectiveTotals
				? EvaluationScoreTotals.fromValues({
						firstTotalScore: sheet.objectives_first_total_score,
						firstTotalRate: sheet.objectives_first_total_rate,
						secondTotalScore: sheet.objectives_second_total_score,
						secondTotalRate: sheet.objectives_second_total_rate,
					})
				: undefined;
		const commonEvaluationScoreTotals =
			finalized && hasCommonEvaluationTotals
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
			// 未確定のシートは、今の評価者設定(二次評価者「なし」かどうか)から算出し直す。
			// 確定済みは確定時の保存値を使い、その後の評価者の付け替えに左右されないようにする。
			allocatedScores:
				hasAllocatedScores && finalized
					? EvaluationAllocatedScores.fromValues({
							objectiveSecondRate: sheet.objectives_second_total_rate,
							objectiveEvaluationScore: sheet.objectives_second_evaluation_score,
							commonEvaluationSecondRate: sheet.common_evaluation_second_total_rate,
							commonEvaluationEvaluationScore: sheet.common_evaluation_second_evaluation_score,
							totalEvaluationScore: sheet.total_evaluation_score,
							allocation,
						})
					: undefined,
			allocation,
			status,
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

	async findByEmployeeIds(employeeIds: number[]): Promise<EvaluationSheetSummary[]> {
		if (employeeIds.length === 0) {
			return [];
		}

		const { data, error } = await supabase
			.from("evaluation_sheets")
			.select(SHEET_LIST_SELECT)
			.in("employee_id", employeeIds);

		return error || !data ? [] : (data as EvaluationSheetListRow[]).map(toSheetSummary);
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
				objective_allocation,
				common_allocation,
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
			objective_allocation?: number | null;
			common_allocation?: number | null;
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
		// 二次評価者「なし」の社員は二次評価の点数がなく、一次評価が最終評価になる
		const primaryIsFinal =
			(await this.employeeRepository.findById(sheet.employee_id))?.primaryIsFinalEvaluator() ??
			false;

		// 評価者名を取得
		const evaluatorNames = await this.employeeRepository.findEvaluatorNames(
			employee.primary_evaluator_id,
			employee.secondary_evaluator_id,
			primaryIsFinal,
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
			evaluatorScore: primaryIsFinal ? null : item.secondScore.toNumber(),
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
			evaluatorScore: primaryIsFinal ? null : result.secondScore.toNumber(),
			selfComment: result.firstComment.toString(),
			evaluatorComment: null,
		}));
		const objectiveTotals = EvaluationScoreTotals.fromObjectives(milestoneEntities);
		const commonEvaluationTotals = EvaluationScoreTotals.fromCommonEvaluationResults(
			commonEvaluationSummary.results,
		);
		const status = EvaluationStatus.from(sheet.status);
		const allocation = await this.allocationFor(status, sheet);
		// findById と同じく、確定済みは保存値、未確定は今の評価者設定から算出する
		const allocatedScores = status.isFinalized()
			? EvaluationAllocatedScores.fromValues({
					objectiveSecondRate:
						sheet.objectives_second_total_rate ?? objectiveTotals.secondTotalRate,
					objectiveEvaluationScore: sheet.objectives_second_evaluation_score,
					commonEvaluationSecondRate:
						sheet.common_evaluation_second_total_rate ?? commonEvaluationTotals.secondTotalRate,
					commonEvaluationEvaluationScore: sheet.common_evaluation_second_evaluation_score,
					totalEvaluationScore: sheet.total_evaluation_score,
					allocation,
				})
			: EvaluationAllocatedScores.fromTotals(
					objectiveTotals,
					commonEvaluationTotals,
					primaryIsFinal,
					allocation,
				);
		// 確定前は、手入力されていた過去のランクが残っていても出力しない
		const finalEvaluationRank = status.isFinalized()
			? EvaluationRank.fromOptional(sheet.final_rank_letter, sheet.final_rank_level)
			: undefined;

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
			primaryIsFinalEvaluator: primaryIsFinal,
			status: status.toString(),
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
