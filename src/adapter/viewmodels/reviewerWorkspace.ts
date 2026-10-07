import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { TOTAL_EVALUATION_ALLOCATION_SCORE } from "../../domain/valueObjects/EvaluationAllocatedScores";
import { EvaluationRank } from "../../domain/valueObjects/EvaluationRank";

/** いま誰の番か。first / second は自分が評価して確定する番、waiting は本人か相手の評価者の番。 */
export type ReviewTask = "first" | "second" | "waiting" | "finalized";
export type ReviewFilter = "all" | ReviewTask;
export type ReviewSort = "priority" | "name" | "firstScore" | "finalScore" | "gap";

export function reviewTask(row: ReviewerRowDto): ReviewTask {
	if (row.status === "finalized") {
		return "finalized";
	}
	if (row.status === "submitted" && row.isPrimary) {
		return "first";
	}
	if (row.status === "first_evaluated" && row.canViewFinal) {
		return "second";
	}
	return "waiting";
}

export const isMyTurn = (row: ReviewerRowDto): boolean =>
	reviewTask(row) === "first" || reviewTask(row) === "second";

/** 評価者は提出済みのシートだけを開ける。下書きは内容が届かない。 */
export const canOpen = (row: ReviewerRowDto): boolean =>
	row.sheetId !== null && row.status !== "draft";

export const reviewLabel = (row: ReviewerRowDto): string => {
	switch (row.status) {
		case "missing":
			return "未作成";
		case "draft":
			return "提出待ち";
		case "submitted":
			return row.isPrimary ? (row.primaryIsFinal ? "評価する" : "一次評価する") : "一次評価待ち";
		case "first_evaluated":
			return row.canViewFinal ? "二次評価する" : "二次評価待ち";
		default:
			return "評価確定";
	}
};

/** 最終評価(二次評価。「なし」の社員は一次評価)が始まっているか。始まる前の点数は意味を持たない。 */
const finalEvaluationStarted = (row: ReviewerRowDto): boolean =>
	row.status === "first_evaluated" ||
	row.status === "finalized" ||
	(row.primaryIsFinal && row.status === "submitted");

/** Match the sheet's 20/80 allocation and rounding. Zero is a valid score, never a completion marker. */
export function reviewScore(row: ReviewerRowDto, stage: "first" | "second"): number | null {
	if (
		!canOpen(row) ||
		(stage === "second" && !(row.canViewSecond && finalEvaluationStarted(row)))
	) {
		return null;
	}
	const scoreKey = stage === "first" ? "firstScore" : "secondScore";
	const objectiveRate = row.objectives.length
		? Math.round(
				(row.objectives.reduce((sum, item) => sum + (item[scoreKey] ?? 0), 0) /
					(row.objectives.length * 4)) *
					100,
			)
		: 0;
	const weight = row.commonItems.reduce((sum, item) => sum + item.weight, 0);
	const commonRate = weight
		? Math.round(
				(row.commonItems.reduce((sum, item) => sum + (item[scoreKey] ?? 0), 0) / weight) * 100,
			)
		: 0;
	return Math.round((20 * objectiveRate) / 100) + Math.round((80 * commonRate) / 100);
}

export function finalScore(row: ReviewerRowDto): number | null {
	if (!row.canViewFinal || !canOpen(row) || !finalEvaluationStarted(row)) {
		return null;
	}
	return row.status === "finalized" && row.finalScore !== null
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
				text: EvaluationRank.fromScore(score, TOTAL_EVALUATION_ALLOCATION_SCORE).toDisplayText(),
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
