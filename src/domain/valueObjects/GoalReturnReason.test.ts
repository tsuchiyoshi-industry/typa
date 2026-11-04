import { it } from "@fast-check/vitest";
import { expect } from "vitest";
import { blank, textBetween } from "../../test/arbitraries";
import { GoalReturnReason } from "./GoalReturnReason";

const REFUSED = { ok: false, error: { kind: "returnReasonInvalid", max: 200 } };

it.prop([blank, textBetween(1, 200), blank], {
	examples: [["　\n", "数値目標を入れてください", " \n"]],
})(
	"keeps the reason without surrounding spaces, including full-width spaces and line breaks",
	(before, reason, after) => {
		const result = GoalReturnReason.from(`${before}${reason}${after}`);
		expect(result.ok && result.value.toString()).toBe(reason);
		// 長さも空白を除いて数える(画面の残り文字数と同じ)
		expect(GoalReturnReason.lengthOf(`${before}${reason}${after}`)).toBe([...reason].length);
	},
);

it.prop([blank])("refuses a reason that is empty or only spaces", (value) => {
	expect(GoalReturnReason.from(value)).toEqual(REFUSED);
});

// 絵文字は1文字。DB の char_length と同じ数え方で、201 文字目で断る(上限は textLength.test.ts でも確かめる)
it.prop([blank, textBetween(201, 260), blank])(
	"refuses a reason over 200 characters even when the spaces around it are removed",
	(before, reason, after) => {
		expect(GoalReturnReason.from(`${before}${reason}${after}`)).toEqual(REFUSED);
	},
);
