import { expect, test } from "vitest";
import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { reviewerRow } from "../../test/reviewerFixture";
import { filterReviewRows, groupByGrade, reviewStats } from "./reviewerWorkspace";

const STATUSES = ["draft", "goals_submitted", "submitted", "first_evaluated", "finalized"] as const;
const rowsOf = (n: number): ReviewerRowDto[] =>
	Array.from({ length: n }, (_, i) =>
		reviewerRow(i + 1, {
			employeeName: `社員${(i * 7919) % n}`,
			gradeId: i % 12,
			gradeName: `等級${i % 12}`,
			status: STATUSES[i % STATUSES.length],
			isPrimary: i % 3 === 0,
			primaryEvaluator: `一次 ${i % 40}`,
			primaryEvaluatorId: i % 40,
		}),
	);
const base = { query: "", grade: "", filter: "all", sort: "priority" } as const;
// インポートした関数の参照は計測の外で取り出す。
const filterRows = filterReviewRows;
const cases: [string, (rows: ReviewerRowDto[]) => unknown][] = [
	["filter: priority", (rows) => filterRows(rows, base)],
	["filter: gap", (rows) => filterRows(rows, { ...base, sort: "gap" })],
	[
		"filter: 4 search keystrokes",
		(rows) =>
			["社", "社員", "社員1", "社員12"].map((query) => filterRows(rows, { ...base, query })),
	],
	["groupByGrade", groupByGrade],
	["reviewStats", reviewStats],
];

for (const [name, run] of cases) {
	test(name, async ({ bench }) => {
		let output: unknown;
		await bench.compare(
			...[1_000, 10_000].map((n) => {
				const rows = rowsOf(n);
				return bench(`${n} rows`, () => {
					output = run(rows);
				});
			}),
			{ time: 300, iterations: 30, warmupTime: 100, warmupIterations: 10 },
		);
		// 結果を観測可能にし、計算が最適化で消えるのを防ぐ。
		expect(Array.isArray(output)).toBe(true);
	});
}
