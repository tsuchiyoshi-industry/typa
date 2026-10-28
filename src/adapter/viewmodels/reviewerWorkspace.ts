import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import {
	finalScore,
	isMyTurn,
	type ReviewTask,
	reviewScore,
	reviewTask,
	sheetStatus,
} from "../../domain/entities/ReviewerWorkspace";

export type ReviewFilter = "all" | ReviewTask;
export type ReviewSort = "priority" | "name" | "firstScore" | "finalScore" | "gap";

export const reviewLabel = (row: ReviewerRowDto): string => {
	const status = sheetStatus(row);
	if (!status) {
		return "未作成";
	}
	if (status.isDraft()) {
		return "目標の送信待ち";
	}
	if (status.isGoalsSubmitted()) {
		return row.isPrimary ? "目標を確認する" : "目標確認待ち";
	}
	if (status.isGoalsConfirmed()) {
		return "本人の振り返り待ち";
	}
	if (status.isAwaitingFirstEvaluation()) {
		return row.isPrimary ? (row.primaryIsFinal ? "評価する" : "一次評価する") : "一次評価待ち";
	}
	if (status.isAwaitingSecondEvaluation()) {
		return row.canViewFinal ? "二次評価する" : "二次評価待ち";
	}
	return "評価確定";
};

/** 絞り込みに使う等級のキー。等級が未設定の社員もまとめて選べるようにする。 */
export const gradeKey = (row: ReviewerRowDto): string => String(row.gradeId ?? "unset");
/** 絞り込みに使う一次評価者のキー。一次評価者が未設定の社員もまとめて選べるようにする。 */
export const primaryEvaluatorKey = (row: ReviewerRowDto): string =>
	String(row.primaryEvaluatorId ?? "unassigned");

/** 等級の選択肢 [キー, 等級名]。一覧に出てくる順。 */
export function gradeOptions(rows: ReviewerRowDto[]): [string, string][] {
	return [...new Map(rows.map((row) => [gradeKey(row), row.gradeName])).entries()];
}

/** 一次評価者の選択肢と、それぞれの部下の人数。名前順。 */
export function primaryEvaluatorOptions(
	rows: ReviewerRowDto[],
): { id: string; name: string; count: number }[] {
	const labels = new Map<string, { id: string; name: string; count: number }>();
	for (const row of rows) {
		const id = primaryEvaluatorKey(row);
		const label = labels.get(id) ?? { id, name: row.primaryEvaluator, count: 0 };
		label.count += 1;
		labels.set(id, label);
	}
	return [...labels.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/**
 * 「自分の番」ごとの件数 [絞り込み, 表示名, 件数]。自分に関係のある段階だけを返す。
 * 一次評価しか担当しない人に「二次評価する 0」は出さない。
 */
export function reviewStats(rows: ReviewerRowDto[]): [ReviewFilter, string, number][] {
	const count = (task: ReviewTask) => rows.filter((row) => reviewTask(row) === task).length;
	const stats: [ReviewFilter, string, number, boolean][] = [
		["all", "全員", rows.length, true],
		["goals", "目標を確認する", count("goals"), rows.some((row) => row.isPrimary)],
		["first", "一次評価する", count("first"), rows.some((row) => row.isPrimary)],
		["second", "二次評価する", count("second"), rows.some((row) => row.canViewSecond)],
		["waiting", "本人・相手の評価待ち", count("waiting"), true],
		["finalized", "評価確定", count("finalized"), true],
	];
	return stats.filter(([, , , shown]) => shown).map(([key, label, total]) => [key, label, total]);
}

/** 比較表は等級ごとに分ける(等級が違うと共通評価の項目が違う)。並びは元の一覧の順。 */
export function groupByGrade(rows: ReviewerRowDto[]): ReviewerRowDto[][] {
	const grouped = new Map<string, ReviewerRowDto[]>();
	for (const row of rows) {
		grouped.set(gradeKey(row), [...(grouped.get(gradeKey(row)) ?? []), row]);
	}
	return [...grouped.values()];
}

const TASK_PRIORITY: Record<ReviewTask, number> = {
	goals: 0,
	first: 1,
	second: 2,
	waiting: 3,
	finalized: 4,
};

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
			if (options.grade && gradeKey(row) !== options.grade) {
				return false;
			}
			if (options.primaryEvaluator && primaryEvaluatorKey(row) !== options.primaryEvaluator) {
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
