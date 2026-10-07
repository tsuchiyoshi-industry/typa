import { expect, it } from "vitest";
import { reviewerRow } from "../../test/reviewerFixture";
import {
	filterReviewRows,
	finalScore,
	nextPending,
	reviewLabel,
	reviewScore,
} from "./reviewerWorkspace";

it("uses the exact 20/80 allocation, rounding and primary-as-final rule", () => {
	const row = reviewerRow();
	expect(reviewScore(row, "first")).toBe(58);
	expect(reviewScore(row, "second")).toBe(79);
	expect(finalScore(row)).toBe(79);
	expect(finalScore(reviewerRow(1, { canViewSecond: false }))).toBe(58);
	expect(finalScore(reviewerRow(1, { status: "finalized", finalScore: 83 }))).toBe(83);
	expect(finalScore(reviewerRow(1, { canViewFinal: false }))).toBeNull();
	expect(reviewScore(reviewerRow(1, { canViewSecond: false }), "second")).toBeNull();
	expect(reviewScore(reviewerRow(1, { sheetId: null }), "first")).toBeNull();
});
it("treats zero as a real score and confirms completion only from the checkpoint", () => {
	const row = reviewerRow(1, { objectives: [], commonItems: [] });
	expect(reviewScore(row, "first")).toBe(0);
	expect(reviewLabel(row)).toBe("未確認");
	expect(reviewLabel({ ...row, reviewed: true })).toBe("確認済み");
});
it("filters normalized Japanese search, grade, stage, and progress independently", () => {
	const rows = [
		reviewerRow(1),
		reviewerRow(2, { role: "primary", gradeId: 2, gradeName: "技術2級", status: "draft" }),
		reviewerRow(3, { needsRecheck: true }),
		reviewerRow(4, { reviewed: true }),
		reviewerRow(5, { status: "finalized" }),
	];
	const options = { query: "", grade: "", role: "", filter: "all", sort: "priority" } as const;
	expect(filterReviewRows(rows, options).map((row) => row.employeeId)).toEqual([3, 1, 4, 2, 5]);
	expect(
		filterReviewRows(rows, {
			...options,
			query: "Ｅ００２",
			grade: "2",
			role: "primary",
			filter: "waiting",
		}).map((row) => row.employeeId),
	).toEqual([2]);
	expect(
		filterReviewRows(rows, { ...options, query: "一次 太郎", filter: "pending" }),
	).toHaveLength(2);
	expect(filterReviewRows(rows, { ...options, filter: "recheck" })).toHaveLength(1);
	expect(filterReviewRows(rows, { ...options, filter: "reviewed" })).toHaveLength(1);
	expect(filterReviewRows(rows, { ...options, filter: "finalized" })).toHaveLength(1);
});
it("wraps next-unconfirmed navigation and skips draft, confirmed and the current person", () => {
	const rows = [
		reviewerRow(1),
		reviewerRow(2, { status: "draft" }),
		reviewerRow(3, { reviewed: true }),
		reviewerRow(4),
	];
	expect(nextPending(rows, 1)?.employeeId).toBe(4);
	expect(nextPending(rows, 4)?.employeeId).toBe(1);
	expect(nextPending([reviewerRow(1)], 1)).toBeUndefined();
	expect(nextPending(rows)?.employeeId).toBe(1);
});
it("filters primary evaluator by ID even when people share the same name", () => {
	const rows = [
		reviewerRow(1, { primaryEvaluatorId: 20, primaryEvaluator: "佐藤 太郎" }),
		reviewerRow(2, { primaryEvaluatorId: 21, primaryEvaluator: "佐藤 太郎" }),
		reviewerRow(3, { primaryEvaluatorId: null, primaryEvaluator: "未設定" }),
	];
	const options = { query: "", grade: "", role: "", filter: "all", sort: "priority" } as const;
	expect(
		filterReviewRows(rows, { ...options, primaryEvaluator: "20" }).map((row) => row.employeeId),
	).toEqual([1]);
	expect(
		filterReviewRows(rows, { ...options, primaryEvaluator: "unassigned" }).map(
			(row) => row.employeeId,
		),
	).toEqual([3]);
});
