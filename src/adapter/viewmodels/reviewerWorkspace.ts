import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";

export type ReviewFilter = "all" | "pending" | "recheck" | "waiting" | "reviewed" | "finalized";
export type ReviewSort = "priority" | "name" | "firstScore" | "finalScore" | "gap";

export const reviewLabel = (row: ReviewerRowDto): string => {
	if (row.status === "missing") {
		return "未作成";
	}
	if (row.status === "draft") {
		return "提出待ち";
	}
	if (row.status === "finalized") {
		return "確定済み";
	}
	if (row.needsRecheck) {
		return "再確認";
	}
	return row.reviewed ? "確認済み" : "未確認";
};

export const isPending = (row: ReviewerRowDto): boolean =>
	row.status === "submitted" && !row.reviewed;

/** Match the sheet's 20/80 allocation and rounding. Zero is a valid score, never a completion marker. */
export function reviewScore(row: ReviewerRowDto, stage: "first" | "second"): number | null {
	if (row.sheetId === null || (stage === "second" && !row.canViewSecond)) {
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
	if (!row.canViewFinal || row.sheetId === null) {
		return null;
	}
	return row.status === "finalized" && row.finalScore !== null
		? row.finalScore
		: reviewScore(row, row.canViewSecond ? "second" : "first");
}

export function filterReviewRows(
	rows: ReviewerRowDto[],
	options: {
		query: string;
		grade: string;
		role: string;
		primaryEvaluator?: string;
		filter: ReviewFilter;
		sort: ReviewSort;
	},
): ReviewerRowDto[] {
	const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
	const query = normalize(options.query.trim());
	const priority = (row: ReviewerRowDto) =>
		row.needsRecheck
			? 0
			: isPending(row)
				? 1
				: row.status === "submitted"
					? 2
					: row.status === "finalized"
						? 4
						: 3;
	const value = (row: ReviewerRowDto): number => {
		if (options.sort === "firstScore") {
			return reviewScore(row, "first") ?? -1;
		}
		if (options.sort === "finalScore") {
			return finalScore(row) ?? -1;
		}
		if (options.sort === "gap") {
			return row.canViewSecond
				? Math.abs((reviewScore(row, "second") ?? 0) - (reviewScore(row, "first") ?? 0))
				: -1;
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
			if (options.role && row.role !== options.role) {
				return false;
			}
			if (
				options.primaryEvaluator &&
				String(row.primaryEvaluatorId ?? "unassigned") !== options.primaryEvaluator
			) {
				return false;
			}
			switch (options.filter) {
				case "pending":
					return isPending(row);
				case "recheck":
					return row.status === "submitted" && row.needsRecheck;
				case "waiting":
					return row.status === "missing" || row.status === "draft";
				case "reviewed":
					return row.status === "submitted" && row.reviewed;
				case "finalized":
					return row.status === "finalized";
				default:
					return true;
			}
		})
		.sort((a, b) => {
			const difference =
				options.sort === "priority" ? priority(a) - priority(b) : value(b) - value(a);
			return (
				difference ||
				a.employeeName.localeCompare(b.employeeName, "ja") ||
				a.employeeId - b.employeeId
			);
		});
}

export function nextPending(
	rows: ReviewerRowDto[],
	currentEmployeeId?: number,
): ReviewerRowDto | undefined {
	const index = rows.findIndex((row) => row.employeeId === currentEmployeeId);
	const ordered = [...rows.slice(index + 1), ...rows.slice(0, Math.max(0, index))];
	return ordered.find(isPending);
}
