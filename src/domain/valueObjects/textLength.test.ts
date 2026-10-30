import { describe, expect, it } from "vitest";
import { PrivilegedSheetOperation } from "../entities/PrivilegedSheetOperation";
import { SheetGradeChange } from "../entities/SheetGradeChange";
import { CorrectionField } from "./CorrectionField";
import { CorrectionReason } from "./CorrectionReason";
import { GoalReturnReason } from "./GoalReturnReason";
import { TermName } from "./TermName";
import { charLength } from "./textLength";

// DB は char_length(コードポイント)で数える。絵文字や一部の漢字(𠮷)は JavaScript の length では 2 になるが、1文字。
const EMOJI = "😀";

it("counts characters the way the database does", () => {
	expect(charLength("")).toBe(0);
	expect(charLength("あ")).toBe(1);
	expect(charLength(EMOJI)).toBe(1);
	expect(charLength("𠮷野家")).toBe(3);
});

const correctionText = CorrectionField.of("goal", "achievement");
const periodGoals = CorrectionField.of("goal", "period_goals");
const field = (result: typeof correctionText) => {
	if (!result.ok) {
		throw new Error("field");
	}
	return result.value;
};

describe.each([
	["the term name", 40, (text: string) => TermName.from(text).ok],
	["a correction reason", 500, (text: string) => CorrectionReason.from(text).ok],
	["a goal return reason", 200, (text: string) => GoalReturnReason.from(text).ok],
	["a corrected text", 2000, (text: string) => field(correctionText).validate(text).ok],
	[
		"a corrected task",
		2000,
		(text: string) =>
			field(periodGoals).validate(JSON.stringify([{ description: text, achievement: "" }])).ok,
	],
	[
		"a privileged operation reason",
		500,
		(text: string) =>
			PrivilegedSheetOperation.from({
				sheetId: 1,
				expectedStatus: "finalized",
				action: "delete",
				reason: text,
			}).ok,
	],
	[
		"a sheet grade change reason",
		500,
		(text: string) =>
			SheetGradeChange.from({
				sheetId: 1,
				gradeId: 2,
				expectedGradeId: 1,
				expectedStatus: "draft",
				reason: text,
			}).ok,
	],
])("%s", (_label, max, accepts) => {
	it(`accepts ${max} characters even when every one is an emoji`, () => {
		expect(accepts(EMOJI.repeat(max))).toBe(true);
	});
	it(`refuses ${max + 1} characters`, () => {
		expect(accepts(EMOJI.repeat(max + 1))).toBe(false);
		expect(accepts("あ".repeat(max + 1))).toBe(false);
	});
});
