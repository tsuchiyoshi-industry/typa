import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, isValidAccountPassword } from "./AccountPassword";

it.each([
	["Abcde1", true],
	["", false],
	["Abcd1", false],
	["abcdef1", false],
	["ABCDEF1", false],
	["Abcdefg", false],
	// bcrypt の上限は文字数でなくバイト数。全角は 3 バイト
	[`Aa1${"x".repeat(69)}`, true],
	[`Aa1${"x".repeat(70)}`, false],
	[`Aa1${"あ".repeat(23)}`, true],
	[`Aa1${"あ".repeat(24)}`, false],
])("judges %s as %s", (password, valid) => {
	expect(isValidAccountPassword(password)).toBe(valid);
});

describe("a temporary password for an Admin to hand over", () => {
	it("always meets the rule and avoids characters that are misread when said or written", () => {
		for (let i = 0; i < 500; i++) {
			const password = generateTemporaryPassword();
			expect(password).toHaveLength(10);
			expect(isValidAccountPassword(password)).toBe(true);
			expect(password).not.toMatch(/[0O1lI]/);
		}
	});

	it("draws from a cryptographic source, so two are not the same", () => {
		const seen = new Set(Array.from({ length: 200 }, generateTemporaryPassword));
		expect(seen.size).toBe(200);
	});
});
