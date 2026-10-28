import { describe, expect, it } from "vitest";
import { EVALUATION_STATUS_VALUES, EvaluationStatus } from "../valueObjects/EvaluationStatus";
import { PERIOD_STATE_VALUES } from "../valueObjects/PeriodState";
import { canChangeSheetGrade, SheetGradeChange } from "./SheetGradeChange";

const request = {
	sheetId: 100,
	gradeId: 2,
	expectedGradeId: 1,
	expectedStatus: "submitted",
	reason: "等級の登録誤り",
};

describe("which sheets can have their grade changed", () => {
	it.each(
		PERIOD_STATE_VALUES.flatMap((period) =>
			EVALUATION_STATUS_VALUES.map((status) => [period, status] as const),
		),
	)("%s period, %s sheet", (period, status) => {
		const expected = period === "active" && !["first_evaluated", "finalized"].includes(status);
		expect(canChangeSheetGrade(EvaluationStatus.from(status), period)).toBe(expected);
	});
});

describe("a grade change request", () => {
	it("keeps the request with a trimmed reason", () => {
		const result = SheetGradeChange.from({ ...request, reason: "  等級の登録誤り  " });
		expect(result.ok && result.value).toMatchObject({
			sheetId: 100,
			gradeId: 2,
			expectedGradeId: 1,
			expectedStatus: "submitted",
			reason: "等級の登録誤り",
		});
	});

	it("accepts a sheet that had no grade yet", () => {
		expect(SheetGradeChange.from({ ...request, expectedGradeId: null }).ok).toBe(true);
	});

	it.each([
		["a missing sheet id", { sheetId: 0 }, "invalidSheetId"],
		["a fractional sheet id", { sheetId: 1.5 }, "invalidSheetId"],
		["a negative sheet id", { sheetId: -1 }, "invalidSheetId"],
		["no grade", { gradeId: null }, "gradeRequired"],
		["a zero grade", { gradeId: 0 }, "gradeRequired"],
		["a fractional grade", { gradeId: 1.5 }, "gradeRequired"],
		["NaN as a grade", { gradeId: Number.NaN }, "gradeRequired"],
		["the same grade", { gradeId: 1 }, "sameGrade"],
		["an unknown status", { expectedStatus: "unknown" }, "invalidStatus"],
		["a first-evaluated sheet", { expectedStatus: "first_evaluated" }, "firstEvaluationConfirmed"],
		["a finalized sheet", { expectedStatus: "finalized" }, "firstEvaluationConfirmed"],
		["a blank reason", { reason: "   " }, "reasonInvalid"],
		["a too long reason", { reason: "理".repeat(501) }, "reasonInvalid"],
	] as const)("rejects %s", (_, override, kind) => {
		const result = SheetGradeChange.from({ ...request, ...override });
		expect(result.ok ? null : result.error).toEqual({ kind });
	});

	it("accepts a reason of exactly 500 characters", () => {
		expect(SheetGradeChange.from({ ...request, reason: "理".repeat(500) }).ok).toBe(true);
	});
});
