import { test } from "vitest";
import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { reviewerRow } from "../../test/reviewerFixture";
import { filterReviewRows, groupByGrade, reviewStats } from "./reviewerWorkspace";

// Admin が全社を見るときの規模。等級・状態・一次評価者をばらけさせる
const STATUSES = ["draft", "goals_submitted", "submitted", "first_evaluated", "finalized"] as const;
const rows: ReviewerRowDto[] = Array.from({ length: 1000 }, (_, i) =>
	reviewerRow(i + 1, {
		employeeName: `社員${(i * 7919) % 1000}`,
		gradeId: i % 12,
		gradeName: `等級${i % 12}`,
		status: STATUSES[i % STATUSES.length],
		isPrimary: i % 3 === 0,
		primaryEvaluator: `一次 ${i % 40}`,
		primaryEvaluatorId: i % 40,
	}),
);
const base = { query: "", grade: "", filter: "all", sort: "priority" } as const;

test("reviewer workspace view model, 1000 rows", async ({ bench }) => {
	await bench("filter: priority", () => {
		filterReviewRows(rows, base);
	}).run();
	await bench("filter: gap", () => {
		filterReviewRows(rows, { ...base, sort: "gap" });
	}).run();
	await bench("filter: 4 search keystrokes", () => {
		for (const query of ["社", "社員", "社員1", "社員12"]) {
			filterReviewRows(rows, { ...base, query });
		}
	}).run();
	await bench("groupByGrade", () => {
		groupByGrade(rows);
	}).run();
	await bench("reviewStats", () => {
		reviewStats(rows);
	}).run();
});
