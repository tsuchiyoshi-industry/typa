import { expect, it } from "vitest";
import { reviewerRow } from "../../test/reviewerFixture";
import {
	canOpen,
	finalScore,
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
it("tells whose turn it is from the stage and the reviewer's role", () => {
	const cases = [
		[reviewerRow(1, { sheetId: null, status: "missing" }), "waiting"],
		[reviewerRow(1, { status: "draft" }), "waiting"],
		[reviewerRow(1, submittedToPrimary), "first"],
		[reviewerRow(1, { ...submittedToPrimary, primaryIsFinal: true }), "first"],
		[reviewerRow(1, { status: "submitted" }), "waiting"],
		[reviewerRow(1), "second"],
		[reviewerRow(1, { isPrimary: true, canViewFinal: false }), "waiting"],
		[reviewerRow(1, { status: "finalized" }), "finalized"],
	] as const;
	for (const [row, task] of cases) {
		expect(reviewTask(row)).toBe(task);
	}
});
it("counts the finished stages; a subject without a secondary evaluator has two", () => {
	const cases = [
		[reviewerRow(1, { sheetId: null, status: "missing" }), 3, 0],
		[reviewerRow(1, { status: "draft" }), 3, 0],
		[reviewerRow(1, { status: "submitted" }), 3, 1],
		[reviewerRow(1), 3, 2],
		[reviewerRow(1, { status: "finalized" }), 3, 3],
		[reviewerRow(1, { ...submittedToPrimary, primaryIsFinal: true }), 2, 1],
		[reviewerRow(1, { status: "finalized", primaryIsFinal: true }), 2, 2],
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
