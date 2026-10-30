import { expect, it } from "vitest";
import type { ReviewerRowDto } from "../../application/dtos/ReviewerWorkspaceDto";
import { employee, period } from "../../test/fixtures";
import { reviewerRow } from "../../test/reviewerFixture";
import { EvaluationAllocation } from "../valueObjects/EvaluationAllocation";
import { CommonEvaluationItem } from "./CommonEvaluationItem";
import { CommonEvaluationResult } from "./CommonEvaluationResult";
import { EvaluationSheet } from "./EvaluationSheet";
import { Milestone } from "./Milestone";
import {
	canOpen,
	finalScore,
	isMyTurn,
	reviewProgress,
	reviewRank,
	reviewScore,
	reviewTask,
} from "./ReviewerWorkspace";

const submittedToPrimary = { status: "submitted", isPrimary: true, firstRank: null } as const;

it("uses the exact 20/80 allocation, rounding and primary-as-final rule", () => {
	const row = reviewerRow();
	// 一次: 20 × 2/4 + 80 × (5×3)/(5×4) = 70。二次: 20 × 3/4 + 80 × (5×4)/(5×4) = 95
	expect(reviewScore(row, "first")).toBe(70);
	expect(reviewScore(row, "second")).toBe(95);
	expect(finalScore(row)).toBe(95);
	expect(
		finalScore(
			reviewerRow(1, { ...submittedToPrimary, canViewSecond: false, primaryIsFinal: true }),
		),
	).toBe(70);
	expect(finalScore(reviewerRow(1, { status: "finalized", finalScore: 83 }))).toBe(83);
	expect(finalScore(reviewerRow(1, { canViewFinal: false }))).toBeNull();
	expect(reviewScore(reviewerRow(1, { canViewSecond: false }), "second")).toBeNull();
	expect(reviewScore(reviewerRow(1, { sheetId: null }), "first")).toBeNull();
});
it("shows no score for a draft, and no final score before the final evaluation starts", () => {
	const draft = reviewerRow(1, { status: "draft", objectives: [], commonItems: [] });
	expect(canOpen(draft)).toBe(false);
	expect(reviewScore(draft, "first")).toBeNull();
	expect(reviewRank(draft, "first")).toBeNull();
	const waitingForPrimary = reviewerRow(1, { status: "submitted", firstRank: null });
	expect(reviewScore(waitingForPrimary, "first")).toBe(70);
	expect(reviewScore(waitingForPrimary, "second")).toBeNull();
	expect(finalScore(waitingForPrimary)).toBeNull();
	expect(reviewRank(waitingForPrimary, "final")).toBeNull();
});
it("derives a provisional rank from the score and prefers the confirmed rank", () => {
	expect(reviewRank(reviewerRow(1, submittedToPrimary), "first")).toEqual({
		text: "B",
		confirmed: false,
	});
	// 確定後は保存値。配点が変わっても、確定した時点のランクのまま
	expect(reviewRank(reviewerRow(1, { firstRank: "A" }), "first")).toEqual({
		text: "A",
		confirmed: true,
	});
	expect(reviewRank(reviewerRow(), "final")).toEqual({ text: "S", confirmed: false });
	expect(
		reviewRank(reviewerRow(1, { status: "finalized", finalRank: "B+", finalScore: 81 }), "final"),
	).toEqual({ text: "B+", confirmed: true });
	expect(reviewRank(reviewerRow(1, { canViewFinal: false }), "final")).toBeNull();
});
// 自分の番は、いまの状態のボールを自分の役割が持っているとき(EvaluationStatus.holder)
const roles = {
	primary: { isPrimary: true, canViewSecond: false, canViewFinal: false, primaryIsFinal: false },
	secondary: { isPrimary: false, canViewSecond: true, canViewFinal: true, primaryIsFinal: false },
	"primary as final": {
		isPrimary: true,
		canViewSecond: false,
		canViewFinal: true,
		primaryIsFinal: true,
	},
	"both stages": {
		isPrimary: true,
		canViewSecond: true,
		canViewFinal: true,
		primaryIsFinal: false,
	},
} as const;
const turns: Record<string, Record<keyof typeof roles, string>> = {
	missing: {
		primary: "waiting",
		secondary: "waiting",
		"primary as final": "waiting",
		"both stages": "waiting",
	},
	draft: {
		primary: "waiting",
		secondary: "waiting",
		"primary as final": "waiting",
		"both stages": "waiting",
	},
	goals_submitted: {
		primary: "goals",
		secondary: "waiting",
		"primary as final": "goals",
		"both stages": "goals",
	},
	goals_confirmed: {
		primary: "waiting",
		secondary: "waiting",
		"primary as final": "waiting",
		"both stages": "waiting",
	},
	submitted: {
		primary: "first",
		secondary: "waiting",
		"primary as final": "first",
		"both stages": "first",
	},
	// 二次評価者「なし」の社員の一次評価済み(以前のデータ)は、最終評価者を兼ねる一次評価者の番
	first_evaluated: {
		primary: "waiting",
		secondary: "second",
		"primary as final": "second",
		"both stages": "second",
	},
	finalized: {
		primary: "finalized",
		secondary: "finalized",
		"primary as final": "finalized",
		"both stages": "finalized",
	},
};
it.each(
	Object.entries(turns).flatMap(([status, byRole]) =>
		Object.entries(byRole).map(([role, task]) => [status, role, task] as const),
	),
)("at %s, the %s evaluator's task is %s", (status, role, task) => {
	const row = reviewerRow(1, {
		...roles[role as keyof typeof roles],
		status: status as ReviewerRowDto["status"],
		sheetId: status === "missing" ? null : 101,
	});
	expect(reviewTask(row)).toBe(task);
	expect(isMyTurn(row)).toBe(task === "goals" || task === "first" || task === "second");
});
it("counts the finished stages; a subject without a secondary evaluator has four", () => {
	const cases = [
		[reviewerRow(1, { sheetId: null, status: "missing" }), 5, 0],
		[reviewerRow(1, { status: "draft" }), 5, 0],
		[reviewerRow(1, { status: "goals_submitted" }), 5, 1],
		[reviewerRow(1, { status: "goals_confirmed" }), 5, 2],
		[reviewerRow(1, { status: "submitted" }), 5, 3],
		[reviewerRow(1), 5, 4],
		[reviewerRow(1, { status: "finalized" }), 5, 5],
		[reviewerRow(1, { ...submittedToPrimary, primaryIsFinal: true }), 4, 3],
		[reviewerRow(1, { status: "finalized", primaryIsFinal: true }), 4, 4],
	] as const;
	for (const [row, steps, done] of cases) {
		expect(reviewProgress(row)).toEqual({ steps, done });
	}
});
it("treats zero as a real score: an unscored submitted sheet is still the reviewer's turn", () => {
	const row = reviewerRow(1, { ...submittedToPrimary, objectives: [], commonItems: [] });
	expect(reviewScore(row, "first")).toBe(0);
	expect(reviewTask(row)).toBe("first");
});

it("scores a list row exactly as the sheet scores the same marks, for any marks and allocation", () => {
	// 決まった種から作る疑似乱数。失敗したときに同じ値で再現できる
	let seed = 20261026;
	const next = (max: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % (max + 1);
	};
	for (let round = 0; round < 300; round++) {
		const objective = next(100);
		const objectives = Array.from({ length: 1 + next(3) }, (_, i) => ({
			id: i + 1,
			goalNumber: i + 1,
			challengeGoal: "目標",
			achievement: "",
			periodGoals: [],
			firstScore: next(4),
			secondScore: next(4),
		}));
		const commonItems = Array.from({ length: next(6) }, (_, i) => ({
			id: i + 1,
			title: `項目${i}`,
			weight: 1 + next(9),
			firstScore: next(4),
			secondScore: next(4),
			firstComment: "",
		}));
		const row = reviewerRow(1, {
			objectiveAllocation: objective,
			commonAllocation: 100 - objective,
			objectives,
			commonItems,
		});
		const sheet = EvaluationSheet.create({
			sheetId: 101,
			subject: employee(),
			evaluationPeriod: period(),
			primaryEvaluatorName: "一次",
			secondaryEvaluatorName: "二次",
			objectives: objectives.map((goal) => Milestone.restore({ ...goal, sheetId: 101 })),
			commonEvaluationResults: commonItems.map((item) =>
				CommonEvaluationResult.create({
					id: item.id,
					sheetId: 101,
					itemId: item.id,
					firstScore: item.firstScore,
					secondScore: item.secondScore,
					firstComment: "",
					item: new CommonEvaluationItem(item.id, item.title, "", item.weight, 1),
				}),
			),
			allocation: EvaluationAllocation.of(objective, 100 - objective),
		});
		expect(reviewScore(row, "first")).toBe(sheet.firstEvaluationScore());
		expect(reviewScore(row, "second")).toBe(sheet.allocatedScores.totalEvaluationScore);
	}
});
