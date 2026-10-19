import { expect, it } from "vitest";
import { reviewerRow } from "../../test/reviewerFixture";
import {
	filterReviewRows,
	gradeOptions,
	groupByGrade,
	nextMyTurn,
	primaryEvaluatorOptions,
	reviewLabel,
	reviewStats,
} from "./reviewerWorkspace";

const submittedToPrimary = { status: "submitted", isPrimary: true, firstRank: null } as const;

it("labels each stage from the reviewer's point of view", () => {
	const cases = [
		[reviewerRow(1, { sheetId: null, status: "missing" }), "未作成"],
		[reviewerRow(1, { status: "draft" }), "提出待ち"],
		[reviewerRow(1, submittedToPrimary), "一次評価する"],
		[reviewerRow(1, { ...submittedToPrimary, primaryIsFinal: true }), "評価する"],
		[reviewerRow(1, { status: "submitted" }), "一次評価待ち"],
		[reviewerRow(1), "二次評価する"],
		[reviewerRow(1, { isPrimary: true, canViewFinal: false }), "二次評価待ち"],
		[reviewerRow(1, { status: "finalized" }), "最終評価済み"],
	] as const;
	for (const [row, label] of cases) {
		expect(reviewLabel(row)).toBe(label);
	}
});
it("filters normalized Japanese search, grade and stage independently, own turns first", () => {
	const rows = [
		reviewerRow(1),
		reviewerRow(2, { gradeId: 2, gradeName: "技術2級", status: "draft" }),
		reviewerRow(3, submittedToPrimary),
		reviewerRow(4, { status: "submitted" }),
		reviewerRow(5, { status: "finalized" }),
	];
	const options = { query: "", grade: "", filter: "all", sort: "priority" } as const;
	expect(filterReviewRows(rows, options).map((row) => row.employeeId)).toEqual([3, 1, 2, 4, 5]);
	expect(
		filterReviewRows(rows, { ...options, query: "Ｅ００２", grade: "2", filter: "waiting" }).map(
			(row) => row.employeeId,
		),
	).toEqual([2]);
	expect(filterReviewRows(rows, { ...options, query: "一次 太郎", filter: "second" })).toHaveLength(
		1,
	);
	expect(filterReviewRows(rows, { ...options, filter: "first" })).toHaveLength(1);
	expect(filterReviewRows(rows, { ...options, filter: "waiting" })).toHaveLength(2);
	expect(filterReviewRows(rows, { ...options, filter: "finalized" })).toHaveLength(1);
});
it("wraps next-turn navigation and skips drafts, others' turns and the current person", () => {
	const rows = [
		reviewerRow(1),
		reviewerRow(2, { status: "draft" }),
		reviewerRow(3, { status: "submitted" }),
		reviewerRow(4, submittedToPrimary),
	];
	expect(nextMyTurn(rows, 1)?.employeeId).toBe(4);
	expect(nextMyTurn(rows, 4)?.employeeId).toBe(1);
	expect(nextMyTurn([reviewerRow(1)], 1)).toBeUndefined();
	expect(nextMyTurn(rows)?.employeeId).toBe(1);
});
it("filters primary evaluator by ID even when people share the same name", () => {
	const rows = [
		reviewerRow(1, { primaryEvaluatorId: 20, primaryEvaluator: "佐藤 太郎" }),
		reviewerRow(2, { primaryEvaluatorId: 21, primaryEvaluator: "佐藤 太郎" }),
		reviewerRow(3, { primaryEvaluatorId: null, primaryEvaluator: "未設定" }),
	];
	const options = { query: "", grade: "", filter: "all", sort: "priority" } as const;
	expect(
		filterReviewRows(rows, { ...options, primaryEvaluator: "20" }).map((row) => row.employeeId),
	).toEqual([1]);
	expect(
		filterReviewRows(rows, { ...options, primaryEvaluator: "unassigned" }).map(
			(row) => row.employeeId,
		),
	).toEqual([3]);
});

it("offers unset grades and unassigned primary evaluators as their own choices", () => {
	const rows = [
		reviewerRow(1),
		reviewerRow(2, {
			gradeId: null,
			gradeName: "未設定",
			primaryEvaluatorId: null,
			primaryEvaluator: "未設定",
		}),
		reviewerRow(3, { primaryEvaluator: "井上 部長", primaryEvaluatorId: 9 }),
		reviewerRow(4),
	];
	expect(gradeOptions(rows)).toEqual([
		["1", "技術1級"],
		["unset", "未設定"],
	]);
	expect(primaryEvaluatorOptions(rows)).toEqual([
		{ id: "9", name: "井上 部長", count: 1 },
		{ id: "2", name: "一次 太郎", count: 2 },
		{ id: "unassigned", name: "未設定", count: 1 },
	]);
	// 選択肢のキーで、そのまま一覧を絞り込める
	const unassigned = filterReviewRows(rows, {
		query: "",
		grade: "unset",
		primaryEvaluator: "unassigned",
		filter: "all",
		sort: "name",
	});
	expect(unassigned.map((row) => row.employeeId)).toEqual([2]);
});

it("counts only the stages the reviewer takes part in", () => {
	const secondOnly = [
		reviewerRow(1),
		reviewerRow(2, { status: "finalized" }),
		reviewerRow(3, { status: "submitted", canViewSecond: true }),
	];
	expect(reviewStats(secondOnly)).toEqual([
		["all", "全員", 3],
		["second", "二次評価する", 1],
		["waiting", "提出・相手の評価待ち", 1],
		["finalized", "最終評価済み", 1],
	]);
	const firstOnly = [reviewerRow(1, { ...submittedToPrimary, canViewSecond: false })];
	expect(reviewStats(firstOnly).map(([key]) => key)).toEqual([
		"all",
		"first",
		"waiting",
		"finalized",
	]);
	expect(reviewStats([]).map(([key, , total]) => [key, total])).toEqual([
		["all", 0],
		["waiting", 0],
		["finalized", 0],
	]);
});

it("splits the comparison by grade and keeps the list order", () => {
	const rows = [
		reviewerRow(1),
		reviewerRow(2, { gradeId: 2 }),
		reviewerRow(3),
		reviewerRow(4, { gradeId: null }),
	];
	expect(groupByGrade(rows).map((group) => group.map((row) => row.employeeId))).toEqual([
		[1, 3],
		[2],
		[4],
	]);
	expect(groupByGrade([])).toEqual([]);
});
