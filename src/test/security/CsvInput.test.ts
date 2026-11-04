import { fc, it } from "@fast-check/vitest";
import { expect, vi } from "vitest";
import { ImportSheetDataInteractor } from "../../application/usecases/ImportSheetDataInteractor";
import { CSV_HEADERS, decodeCsv, parseCsv, toCsv } from "../../application/usecases/sheetImportCsv";

// ASVS v5.0.0 V1.2.10 / V5.2.1–2. 出力先のExcelも信頼境界に含める。
const roundTrip = (rows: (string | number)[][]) =>
	parseCsv(decodeCsv(new TextEncoder().encode(toCsv(rows)).buffer));

// Excel が式として読み始めるセル: 先頭の制御文字、または空白に続く = + - @
const startsFormula = (cell: string) => /^[\t\r\n\0]/.test(cell) || /^\s*[=+\-@]/.test(cell);

// 式の材料・区切り・引用符・改行を多めに混ぜる。半端なサロゲートは UTF-8 にできないので作らない
const cellText = fc.oneof(
	fc.string({ unit: "binary" }),
	fc
		.array(
			fc.constantFrom(
				"=",
				"+",
				"-",
				"@",
				"\t",
				"\r",
				"\n",
				"\0",
				" ",
				'"',
				",",
				"'",
				"a",
				"日",
				"😀",
				"1",
			),
		)
		.map((chars) => chars.join("")),
);
const rows = fc.array(fc.array(fc.oneof(cellText, fc.integer()), { minLength: 1, maxLength: 5 }), {
	minLength: 1,
	maxLength: 5,
});

const FORMULAS = [
	'=HYPERLINK("https://attacker.example","open")',
	"+1+1",
	"-1+1",
	"@SUM(1,2)",
	"\t=1+1",
	"\r=1+1",
	"\n=1+1",
	"\0=1+1",
	"   =1+1",
	'="quoted,cell"',
];
const ORDINARY = [
	"日本語",
	'say "hello", world',
	"normal\r\nmultiline",
	"https://example.jp",
	"123",
	"'already text",
];

it.prop([rows], { examples: [...FORMULAS, ...ORDINARY].map((cell) => [[[cell, "safe", 1]]]) })(
	"exports every cell so that Excel reads none of them as a formula, and reads each back as written",
	(written) => {
		const read = roundTrip(written);
		expect(read).toHaveLength(written.length);
		read.forEach((row, r) => {
			expect(row).toHaveLength(written[r].length);
			row.forEach((cell, c) => {
				const value = written[r][c];
				// 数値は数値のまま(-1 は Excel でも数)。文字列は式として読まれない
				if (typeof value === "number") {
					expect(cell).toBe(String(value));
					return;
				}
				expect(startsFormula(cell)).toBe(false);
				// 変えるのは、式になりうるセルの先頭に ' を足すことだけ
				expect(cell).toBe(startsFormula(value) ? `'${value}` : value);
			});
		});
	},
);

it.prop([fc.constantFrom(...FORMULAS), fc.integer()])(
	"neutralizes each known formula payload",
	(payload, number) => {
		expect(roundTrip([[payload, "safe", number]])).toEqual([
			[`'${payload}`, "safe", String(number)],
		]);
	},
);

function setup() {
	const importRows = vi.fn().mockResolvedValue({ errors: [], summary: null, applied: false });
	const repository = { importRows, findTemplate: vi.fn() };
	const present = vi.fn();
	const interactor = new ImportSheetDataInteractor(repository);
	const run = (goals: ArrayBuffer, common: ArrayBuffer | null = null) =>
		interactor.execute({ goals, common, apply: true }, { present });
	return { importRows, present, run };
}

it("rejects a file over 20 MiB before calling the repository", async () => {
	const { run, importRows, present } = setup();
	await run(new ArrayBuffer(20 * 1024 * 1024 + 1));
	expect(importRows).not.toHaveBeenCalled();
	expect(present).toHaveBeenCalledWith(
		expect.objectContaining({
			applied: false,
			errors: [expect.objectContaining({ file: "goals", line: null })],
		}),
	);
});

it.each([
	'<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><x>&xxe;</x>',
	'{"__proto__":{"isAdmin":true}}',
	"PK\u0003\u0004fake-zip-file",
	`${CSV_HEADERS.goals.join(",")}\r\nE4,name,1,"unterminated`,
])("rejects invalid CSV content without invoking the DB: %s", async (payload) => {
	const { run, importRows, present } = setup();
	await run(new TextEncoder().encode(payload).buffer);
	expect(importRows).not.toHaveBeenCalled();
	expect(present).toHaveBeenCalledWith(
		expect.objectContaining({
			applied: false,
			errors: [expect.objectContaining({ file: "goals" })],
		}),
	);
	expect(Object.prototype).not.toHaveProperty("isAdmin");
});

it("does not import a valid goals file when the other file is malformed", async () => {
	const { run, importRows } = setup();
	await run(
		new TextEncoder().encode(toCsv([CSV_HEADERS.goals, ["E4", "", 1, "goal", "", "", "", ""]]))
			.buffer,
		new TextEncoder().encode("invalid header").buffer,
	);
	expect(importRows).not.toHaveBeenCalled();
});
