import { expect, it, vi } from "vitest";
import { ImportSheetDataInteractor } from "../../application/usecases/ImportSheetDataInteractor";
import { CSV_HEADERS, decodeCsv, parseCsv, toCsv } from "../../application/usecases/sheetImportCsv";

// ASVS v5.0.0 V1.2.10 / V5.2.1–2. 出力先のExcelも信頼境界に含める。
it.each([
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
])("neutralizes a spreadsheet formula in exported text %j", (payload) => {
	const cells = parseCsv(decodeCsv(new TextEncoder().encode(toCsv([[payload, "safe", 1]])).buffer));
	expect(cells).toEqual([[`'${payload}`, "safe", "1"]]);
});

it.each([
	"日本語",
	'say "hello", world',
	"normal\r\nmultiline",
	"https://example.jp",
	"123",
	"'already text",
])("preserves ordinary exported text %j", (value) => {
	expect(parseCsv(decodeCsv(new TextEncoder().encode(toCsv([[value]])).buffer))).toEqual([[value]]);
});

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
