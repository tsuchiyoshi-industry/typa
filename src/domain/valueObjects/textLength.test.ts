import { fc, it } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { textBetween } from "../../test/arbitraries";
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

it.prop([fc.string({ unit: "binary" }), fc.string({ unit: "binary" })])(
	"counts one per code point, so joining texts adds their lengths",
	(a, b) => {
		expect(charLength(a + b)).toBe(charLength(a) + charLength(b));
		expect(charLength(a)).toBe(Array.from(a).length);
		expect(charLength(a)).toBeLessThanOrEqual(a.length);
	},
);

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
	// 境界(ちょうど上限・上限 + 1)は、すべて絵文字の例を必ず試す
	it.prop([textBetween(1, max)], { examples: [[EMOJI.repeat(max)], [EMOJI]] })(
		`accepts 1 to ${max} characters, counting an emoji as one`,
		(text) => {
			expect(accepts(text)).toBe(true);
		},
	);
	it.prop([textBetween(max + 1, max + 50)], { examples: [[EMOJI.repeat(max + 1)]] })(
		`refuses more than ${max} characters`,
		(text) => {
			expect(accepts(text)).toBe(false);
		},
	);
});
