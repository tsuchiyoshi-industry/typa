import { CommonEvaluationItem } from "../../domain/entities/CommonEvaluationItem";
import { CommonEvaluationResult } from "../../domain/entities/CommonEvaluationResult";
import { Employee } from "../../domain/entities/Employee";
import { EvaluationPeriod } from "../../domain/entities/EvaluationPeriod";
import { EvaluationSheet, type StoredSheetScores } from "../../domain/entities/EvaluationSheet";
import { Milestone } from "../../domain/entities/Milestone";
import { SheetCorrection } from "../../domain/entities/SheetCorrection";
import type {
	EvaluationSheetOverviewRow,
	EvaluationSheetRepository,
	EvaluationSheetSummary,
} from "../../domain/repositories/EvaluationSheetRepository";
import type { EvaluationAllocatedScores } from "../../domain/valueObjects/EvaluationAllocatedScores";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../../domain/valueObjects/EvaluationRank";
import type { EvaluationScoreTotals } from "../../domain/valueObjects/EvaluationScoreTotals";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import type { PeriodGoal } from "../../domain/valueObjects/PeriodGoal";
import { supabase } from "../db/supabase";

/**
 * DB 関数 get_sheet が返す評価シート。呼び出した人がいまの段階で見てよい範囲だけが入っている
 * (見せない点数は 0、コメントは空文字)。
 */
export interface SheetRpcRow {
	id: number;
	status: string;
	/** シート作成時の等級(DB のトリガーが作成時に固定する)。 */
	gradeId: number | null;
	subject: {
		id: number;
		name: string;
		employeeNo: string;
		roleId: number;
		careerCourse: string | null;
	} | null;
	/** 被評価者の社員マスタ上の今の評価者。確定したシートを読める(シートの評価者とは別)。 */
	currentEvaluatorIds?: number[];
	/** シートの評価者。未確定の間は DB のトリガーが社員マスタに合わせ、確定後は変わらない。 */
	primaryEvaluatorId: number | null;
	secondaryEvaluatorId: number | null;
	noSecondaryEvaluator: boolean;
	primaryEvaluatorName: string | null;
	secondaryEvaluatorName: string | null;
	period: {
		id: number;
		termName: string;
		division: string;
		part: number;
		startDate: string;
		endDate: string;
		isActive: boolean;
		isClosed: boolean;
		allowUnfinalizedClose: boolean;
	} | null;
	firstOverallComment: string;
	secondOverallComment: string;
	firstRank: string | null;
	finalRankLetter: string | null;
	finalRankLevel: string | null;
	/** 確定済みのシートだけ、確定時に保存した集計と配点が入る。 */
	stored: StoredSheetScores;
	objectives: Array<{
		id: number;
		goalNumber: number;
		challengeGoal: string;
		periodGoals: PeriodGoal[];
		achievement: string;
		firstScore: number;
		secondScore: number;
	}>;
	/** シートの等級の項目ごとに1件。結果が未保存の項目は id が null。 */
	commonResults: Array<{
		id: number | null;
		itemId: number;
		title: string;
		description: string;
		weight: number;
		itemSetId: number | null;
		firstScore: number;
		secondScore: number;
		firstComment: string;
	}>;
	allocation: { objective: number; common: number } | null;
	/** 締め後修正。見せてよい範囲だけが来る(古い DB では無い)。 */
	corrections?: Array<{
		id: number;
		target: string;
		goalNumber: number | null;
		itemTitle: string | null;
		field: string;
		before: string;
		after: string;
		reason: string;
		correctedAt: string;
	}>;
	maxChallengeGoals: number | null;
	/** 通知の方法。"email" のときだけ、アプリが通知メールを頼む。 */
	notificationChannel?: string;
}

interface PeriodJoinRow {
	id: number;
	period_name: string;
	term_name: string;
	division: string;
	part: number;
	start_date: string;
	end_date: string;
	is_active: boolean;
	closed_at: string | null;
	allow_unfinalized_close: boolean;
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
	grade: { grade_name: string } | { grade_name: string }[] | null;
}

/** DB 関数 get_sheet_overview が返す1行。 */
type OverviewRpcRow = Omit<
	EvaluationSheetOverviewRow,
	"status" | "totalScore" | "primaryEvaluatorName" | "secondaryEvaluatorName"
> & {
	status: string;
	primaryEvaluator: string | null;
	secondaryEvaluator: string | null;
	noSecondaryEvaluator: boolean;
};

// grade はシート作成時の等級(evaluation_sheets.grade_id)。社員の今の等級ではない
const SHEET_LIST_SELECT =
	"id, period_id, employee_id, status, total_score, created_at, updated_at, period:evaluation_periods!inner(id, period_name, term_name, division, part, start_date, end_date, is_active, closed_at, allow_unfinalized_close), employee:employees!inner(name, employee_no), grade:employee_grades(grade_name)";

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
		exportableBeforeFinalized:
			period !== undefined &&
			EvaluationPeriod.restore({
				id: period.id,
				termName: period.term_name,
				division: period.division,
				part: period.part,
				startDate: period.start_date,
				endDate: period.end_date,
				isActive: period.is_active,
				isClosed: period.closed_at !== null,
				allowUnfinalizedClose: period.allow_unfinalized_close,
			}).allowsExportBeforeFinalized(),
		employeeName: employee?.name ?? "",
		employeeNo: employee?.employee_no ?? "",
		gradeName: first(item.grade)?.grade_name ?? "",
	};
}

/** get_sheet / get_sheet_for_correction が返すシート。 */
export function toSheet(row: SheetRpcRow): EvaluationSheet | null {
	if (!row.subject || !row.period) {
		return null;
	}
	if (!row.allocation) {
		throw new Error("評価の配点設定が登録されていません。");
	}
	if (!Number.isInteger(row.maxChallengeGoals)) {
		throw new Error("チャレンジ目標の上限が登録されていません。");
	}

	// 評価者は、社員マスタの今の評価者ではなく、シートが持つ評価者
	const subject = new Employee(
		row.subject.id,
		row.subject.name,
		row.subject.employeeNo,
		row.subject.roleId,
		row.subject.careerCourse,
		row.gradeId,
		row.primaryEvaluatorId,
		row.secondaryEvaluatorId,
		row.noSecondaryEvaluator,
	);
	// DB の文字列は、ここで一度だけ状態に変換する
	const status = EvaluationStatus.from(row.status);

	return EvaluationSheet.restore({
		sheetId: row.id,
		subject,
		evaluationPeriod: EvaluationPeriod.restore(row.period),
		primaryEvaluatorName: row.primaryEvaluatorName ?? "未設定",
		// 「なし」と明示されたシートと、未設定(指定待ち)のシートを区別して表示する
		secondaryEvaluatorName:
			row.secondaryEvaluatorName ?? (row.noSecondaryEvaluator ? "なし" : "未設定"),
		firstOverallComment: row.firstOverallComment,
		secondOverallComment: row.secondOverallComment,
		objectives: row.objectives.map((objective) =>
			Milestone.create({ ...objective, sheetId: row.id }),
		),
		commonEvaluationResults: row.commonResults.map((result) =>
			CommonEvaluationResult.create({
				// まだ保存されていない項目は、項目IDから作った負の仮IDで持つ
				id: result.id ?? -result.itemId,
				sheetId: row.id,
				itemId: result.itemId,
				firstScore: result.firstScore,
				secondScore: result.secondScore,
				firstComment: result.firstComment,
				item: new CommonEvaluationItem(
					result.itemId,
					result.title,
					result.description,
					result.weight,
					result.itemSetId,
				),
			}),
		),
		stored: row.stored,
		// 確定時の配点がなければ、現在の設定を使う
		allocation:
			EvaluationSheet.storedAllocation(status, row.stored) ??
			EvaluationAllocation.of(row.allocation.objective, row.allocation.common),
		status,
		gradeId: row.gradeId,
		maxObjectives: row.maxChallengeGoals as number,
		currentEvaluatorIds: row.currentEvaluatorIds ?? [],
		finalEvaluationRank: EvaluationRank.fromOptional(row.finalRankLetter, row.finalRankLevel),
		firstEvaluationRank: EvaluationRank.fromText(row.firstRank),
		corrections: (row.corrections ?? []).map(SheetCorrection.restore),
		// 分からないときはメールと見なさない(頼んでいないメールを送らない)
		notifiesByMail: row.notificationChannel === "email",
	});
}

export class SupabaseEvaluationSheetRepository implements EvaluationSheetRepository {
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

	/** シート・本人・評価者・期間・目標・共通評価・設定を、1回の問い合わせで読む。 */
	async findById(sheetId: number): Promise<EvaluationSheet | null> {
		const { data, error } = await supabase.rpc("get_sheet", { p_sheet_id: sheetId });
		// 読めなかったことを「シートが無い」として扱わない
		if (error) {
			throw error;
		}
		// シートが無いか、呼び出した人がそのシートの本人・評価者ではない
		return data ? toSheet(data as SheetRpcRow) : null;
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
		_ranks: { first?: EvaluationRank; final?: EvaluationRank } = {},
	): Promise<EvaluationSheet | null> {
		// The DB locks the sheet, checks the transition and computes all final values.
		const { data, error } = await supabase.rpc("transition_evaluation_sheet", {
			p_sheet_id: sheetId,
			p_status: status.toString(),
		});
		if (error) {
			throw error;
		}
		if (status.isDraft() && data === null) {
			return null;
		}
		if (!data) {
			throw new Error("Failed to load updated evaluation sheet.");
		}
		const updated = toSheet(data as SheetRpcRow);
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

		// 読めなかったことを「シートが無い」として扱わない
		if (error) {
			throw error;
		}
		return ((data ?? []) as EvaluationSheetListRow[]).map(toSheetSummary);
	}

	async findByEvaluator(employeeId: number): Promise<EvaluationSheetSummary[]> {
		// 自分のもの以外で DB が読ませるシート: シートの評価者が自分のものと、今の部下の確定済みのもの
		const { data, error } = await supabase
			.from("evaluation_sheets")
			.select(SHEET_LIST_SELECT)
			.neq("employee_id", employeeId);

		// 読めなかったことを「シートが無い」として扱わない
		if (error) {
			throw error;
		}
		return ((data ?? []) as EvaluationSheetListRow[]).map(toSheetSummary);
	}

	async findOverview(): Promise<EvaluationSheetOverviewRow[]> {
		// Admin であることは DB 関数が確かめる。読めなかったことを「シートが無い」として扱わない
		const { data, error } = await supabase.rpc("get_sheet_overview");
		if (error) {
			throw error;
		}
		return ((data ?? []) as OverviewRpcRow[]).map(
			({ status, primaryEvaluator, secondaryEvaluator, noSecondaryEvaluator, ...summary }) => ({
				...summary,
				status: EvaluationStatus.from(status),
				totalScore: 0,
				// 「なし」と明示されたシートと、未設定(指定待ち)のシートを区別して表示する
				primaryEvaluatorName: primaryEvaluator ?? "未設定",
				secondaryEvaluatorName: secondaryEvaluator ?? (noSecondaryEvaluator ? "なし" : "未設定"),
			}),
		);
	}
}
