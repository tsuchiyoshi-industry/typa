import { expect, it } from "vitest";
import { err, expectOk, ok, type Result } from "./Result";

type Parse = Result<number, { kind: "empty" } | { kind: "notNumber"; text: string }>;
const parse = (text: string): Parse =>
	text === ""
		? err({ kind: "empty" })
		: Number.isNaN(Number(text))
			? err({ kind: "notNumber", text })
			: ok(Number(text));

it("returns either a value or a typed failure, never both", () => {
	expect(parse("3")).toEqual({ ok: true, value: 3 });
	expect(parse("")).toEqual({ ok: false, error: { kind: "empty" } });
	const failed = parse("x");
	// 失敗の種類で分岐でき、種類ごとの情報を型どおりに読める
	expect(!failed.ok && failed.error.kind === "notNumber" && failed.error.text).toBe("x");
});

it("takes the value out of a result that cannot fail for trusted data, and refuses a failure loudly", () => {
	const describe = (error: { kind: string }) => `bad: ${error.kind}`;
	expect(expectOk(parse("4"), describe)).toBe(4);
	expect(() => expectOk(parse(""), describe)).toThrow("bad: empty");
});
