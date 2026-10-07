import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { EvaluationAllocation } from "../../domain/valueObjects/EvaluationAllocation";
import { EvaluationRank } from "../../domain/valueObjects/EvaluationRank";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import { Score } from "../../domain/valueObjects/Score";

/** いま誰の番か。first / second は自分が評価して確定する番、waiting は本人か相手の評価者の番。 */
export type ReviewTask = "first" | "second" | "waiting" | "finalized";
export type ReviewFilter = "all" | ReviewTask;
export type ReviewSort = "priority" | "name" | "firstScore" | "finalScore" | "gap";

/** シートの状態。この期間のシートがまだ無ければ undefined。 */
export const sheetStatus = (row: ReviewerRowDto): EvaluationStatus | undefined =>
	EvaluationStatus.find(row.status);

export function reviewTask(row: ReviewerRowDto): ReviewTask {
	const status = sheetStatus(row);
	if (status?.isFinalized()) {
		return "finalized";
	}
	if (status?.isAwaitingFirstEvaluation() && row.isPrimary) {
		return "first";
	}
	if (status?.isAwaitingSecondEvaluation() && row.canViewFinal) {
		return "second";
	}
	return "waiting";
}

export const isMyTurn = (row: ReviewerRowDto): boolean =>
	reviewTask(row) === "first" || reviewTask(row) === "second";

/** 評価者は提出済みのシートだけを開ける。下書きは内容が届かない。 */
export const canOpen = (row: ReviewerRowDto): boolean =>
	row.sheetId !== null && !!sheetStatus(row)?.isSubmitted();

export const reviewLabel = (row: ReviewerRowDto): string => {
	const status = sheetStatus(row);
	if (!status) {
		return "未作成";
	}
	if (status.isDraft()) {
		return "提出待ち";
	}
	if (status.isAwaitingFirstEvaluation()) {
		return row.isPrimary ? (row.primaryIsFinal ? "評価する" : "一次評価する") : "一次評価待ち";
	}
	if (status.isAwaitingSecondEvaluation()) {
		return row.canViewFinal ? "二次評価する" : "二次評価待ち";
	}
	return "評価確定";
};

/** 最終評価(二次評価。「なし」の社員は一次評価)が始まっているか。始まる前の点数は意味を持たない。 */
const finalEvaluationStarted = (row: ReviewerRowDto): boolean => {
	const status = sheetStatus(row);
	return (
		!!status?.isFirstEvaluationConfirmed() ||
		(row.primaryIsFinal && !!status?.isAwaitingFirstEvaluation())
	);
};

/** Match the sheet's allocation and rounding. Zero is a valid score, never a completion marker. */
export function reviewScore(row: ReviewerRowDto, stage: "first" | "second"): number | null {
	if (
		!canOpen(row) ||
		(stage === "second" && !(row.canViewSecond && finalEvaluationStarted(row)))
	) {
		return null;
	}
	const scoreKey = stage === "first" ? "firstScore" : "secondScore";
	const objectiveTotal = row.objectives.reduce((sum, item) => sum + (item[scoreKey] ?? 0), 0);
	// 共通評価の配点は係数。得点は「配点 × 評価」、満点は「配点 × 4」
	const weight = row.commonItems.reduce((sum, item) => sum + item.weight, 0);
	const commonTotal = row.commonItems.reduce(
		(sum, item) => sum + item.weight * (item[scoreKey] ?? 0),
		0,
	);
	return (
		EvaluationAllocation.fromTotal(
			row.objectiveAllocation,
			objectiveTotal,
			row.objectives.length * Score.MAX,
		) + EvaluationAllocation.fromTotal(row.commonAllocation, commonTotal, weight * Score.MAX)
	);
}

export function finalScore(row: ReviewerRowDto): number | null {
	if (!row.canViewFinal || !canOpen(row) || !finalEvaluationStarted(row)) {
		return null;
	}
	return sheetStatus(row)?.isFinalized() && row.finalScore !== null
		? row.finalScore
		: reviewScore(row, row.canViewSecond ? "second" : "first");
}

/** 段階ごとの評価ランク。確定済みは保存値、評価中は現在の点数から決まる見込み。 */
export function reviewRank(
	row: ReviewerRowDto,
	stage: "first" | "final",
): { text: string; confirmed: boolean } | null {
	if (!canOpen(row)) {
		return null;
	}
	const stored = stage === "first" ? row.firstRank : row.finalRank;
	if (stored) {
		return { text: stored, confirmed: true };
	}
	const score = stage === "first" ? reviewScore(row, "first") : finalScore(row);
	return score === null
		? null
		: {
				text: EvaluationRank.fromScore(score, EvaluationAllocation.TOTAL).toDisplayText(),
				confirmed: false,
			};
}

const TASK_PRIORITY: Record<ReviewTask, number> = { first: 0, second: 1, waiting: 2, finalized: 3 };

export function filterReviewRows(
	rows: ReviewerRowDto[],
	options: {
		query: string;
		grade: string;
		primaryEvaluator?: string;
		filter: ReviewFilter;
		sort: ReviewSort;
	},
): ReviewerRowDto[] {
	const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
	const query = normalize(options.query.trim());
	const value = (row: ReviewerRowDto): number => {
		if (options.sort === "firstScore") {
			return reviewScore(row, "first") ?? -1;
		}
		if (options.sort === "finalScore") {
			return finalScore(row) ?? -1;
		}
		if (options.sort === "gap") {
			const second = reviewScore(row, "second");
			return second === null ? -1 : Math.abs(second - (reviewScore(row, "first") ?? 0));
		}
		return 0;
	};
	return rows
		.filter((row) => {
			if (
				query &&
				!normalize(`${row.employeeName} ${row.employeeNo} ${row.primaryEvaluator}`).includes(query)
			) {
				return false;
			}
			if (options.grade && String(row.gradeId ?? "unset") !== options.grade) {
				return false;
			}
			if (
				options.primaryEvaluator &&
				String(row.primaryEvaluatorId ?? "unassigned") !== options.primaryEvaluator
			) {
				return false;
			}
			return options.filter === "all" || reviewTask(row) === options.filter;
		})
		.sort((a, b) => {
			const difference =
				options.sort === "priority"
					? TASK_PRIORITY[reviewTask(a)] - TASK_PRIORITY[reviewTask(b)]
					: value(b) - value(a);
			return (
				difference ||
				a.employeeName.localeCompare(b.employeeName, "ja") ||
				a.employeeId - b.employeeId
			);
		});
}

/** 一覧の並びで、いまの対象者の次にある「自分の番」のシート。 */
export function nextMyTurn(
	rows: ReviewerRowDto[],
	currentEmployeeId?: number,
): ReviewerRowDto | undefined {
	const index = rows.findIndex((row) => row.employeeId === currentEmployeeId);
	const ordered = [...rows.slice(index + 1), ...rows.slice(0, Math.max(0, index))];
	return ordered.find(isMyTurn);
}
