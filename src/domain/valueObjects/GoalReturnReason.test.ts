import { expect, it } from "vitest";
import { GoalReturnReason } from "./GoalReturnReason";

it("trims the reason, including full-width spaces and line breaks", () => {
	const result = GoalReturnReason.from("　\n数値目標を入れてください \n");
	expect(result.ok && result.value.toString()).toBe("数値目標を入れてください");
});

it.each([
	["empty", ""],
	["blank", " 　\n\t"],
	["over 200 characters", "あ".repeat(201)],
	// 絵文字は1文字。DB の char_length と同じ数え方で、201 文字目で断る
	["over 200 emoji", "😀".repeat(201)],
])("refuses a reason that is %s", (_case, value) => {
	expect(GoalReturnReason.from(value)).toEqual({
		ok: false,
		error: { kind: "returnReasonInvalid", max: 200 },
	});
});

it("accepts exactly 200 characters, counting an emoji as one", () => {
	expect(GoalReturnReason.from("😀".repeat(200)).ok).toBe(true);
	expect(GoalReturnReason.lengthOf("😀 ")).toBe(1);
});
