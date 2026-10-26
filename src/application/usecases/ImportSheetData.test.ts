import { describe, expect, it, vi } from "vitest";
import { SheetImportController } from "../../adapter/controllers/SheetImportController";
import type {
	SheetImportRepository,
	SheetImportResult,
} from "../../domain/repositories/SheetImportRepository";
import { ImportSheetDataInteractor } from "./ImportSheetDataInteractor";
import { buildTemplate, CSV_HEADERS, decodeCsv, parseCsv, toCsv } from "./sheetImportCsv";

/** Excel の「CSV UTF-8」が先頭に付ける印。見えない文字なので、ソースには直接書かない。 */
const BOM = String.fromCharCode(0xfeff);
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const run = async (goals: string | null, common: string | null = null) => {
	const importRows = vi.fn<SheetImportRepository["importRows"]>(async () => ({
		errors: [],
		summary: null,
		applied: false,
	}));
	let result: SheetImportResult | undefined;
	await new ImportSheetDataInteractor({ findTemplate: vi.fn(), importRows }).execute(
		{
			goals: goals === null ? null : bytes(goals),
			common: common === null ? null : bytes(common),
			apply: false,
		},
		{ present: (response) => (result = response) },
	);
	return { result, importRows };
};

it("reads quoted cells with commas, quotes and line breaks as one Excel row", () => {
	expect(parseCsv('a,"b,""c""\r\nd"\r\n\r\ne\n')).toEqual([["a", 'b,"c"\r\nd'], [""], ["e"]]);
	expect(() => parseCsv('a\nb,"open\nc')).toThrow("2行目");
});

it("reads both Excel encodings and writes a template Excel opens without garbling", () => {
	// 「目標」の Shift_JIS
	expect(decodeCsv(new Uint8Array([0x96, 0xda, 0x95, 0x57]).buffer)).toBe("目標");
	expect(decodeCsv(bytes(`${BOM}目標`))).toBe("目標");
	expect(toCsv([["a", 'say "hi"', 1]])).toBe(`${BOM}a,"say ""hi""",1\r\n`);

	const template = {
		periodName: "2026上期",
		maxGoals: 2,
		employees: [{ employeeNo: "E1", name: "社員1", items: [{ id: 5, title: "協調性" }] }],
	};
	expect(parseCsv(decodeCsv(bytes(buildTemplate("goals", template))))).toEqual([
		[...CSV_HEADERS.goals],
		["E1", "社員1", "1", "", "", "", "", ""],
		["E1", "社員1", "2", "", "", "", "", ""],
	]);
	expect(parseCsv(decodeCsv(bytes(buildTemplate("common", template))))[1]).toEqual([
		"E1",
		"社員1",
		"5",
		"協調性",
		"",
		"",
		"",
	]);
});

it("sends the rows with their Excel line numbers, skipping empty rows and normalizing numbers", async () => {
	const header = CSV_HEADERS.goals.join(",");
	const { importRows } = await run(`${header}\n,,,,,,,\nE1,社員1,１, 目標 ,,, ３ ,\n`);
	expect(importRows).toHaveBeenCalledWith(
		[
			{
				line: 3,
				employeeNo: "E1",
				name: "社員1",
				goalNumber: "1",
				challengeGoal: " 目標 ",
				periodGoals: [],
				achievement: "",
				firstScore: "3",
				secondScore: "",
			},
		],
		[],
		false,
	);
});

it("refuses a file with the wrong header without asking the database", async () => {
	const { result, importRows } = await run(`${CSV_HEADERS.common.join(",")}\n`, "社員番号,名前\n");
	expect(importRows).not.toHaveBeenCalled();
	expect(result?.errors).toEqual([
		{ file: "goals", line: 1, message: "共通評価のファイルが選ばれています。" },
		{
			file: "common",
			line: 1,
			message: `見出しが違います。テンプレートの見出し(${CSV_HEADERS.common.join(",")})のまま使ってください。`,
		},
	]);
	expect((await run(null)).result?.errors).toEqual([
		{ file: null, line: null, message: "取り込むファイルを選んでください。" },
	]);
});

it("refuses broken files with the line to look at, without asking the database", async () => {
	const header = CSV_HEADERS.goals.join(",");
	const empty = await run("");
	expect(empty.importRows).not.toHaveBeenCalled();
	expect(empty.result?.errors[0]).toMatchObject({ file: "goals", line: 1 });

	const unclosed = await run(`${header}\nE1,社員1,1,"閉じていない目標,,,,,\nE2,社員2,1,目標,,,,\n`);
	expect(unclosed.importRows).not.toHaveBeenCalled();
	expect(unclosed.result?.errors).toEqual([
		{ file: "goals", line: 2, message: '2行目の「"」が閉じていません。' },
	]);

	// 別のファイルを選んだ(大きすぎる)ときは、読まずに断る
	const huge = new ArrayBuffer(20 * 1024 * 1024 + 1);
	const importRows = vi.fn<SheetImportRepository["importRows"]>();
	let result: SheetImportResult | undefined;
	await new ImportSheetDataInteractor({ findTemplate: vi.fn(), importRows }).execute(
		{ goals: huge, common: null, apply: true },
		{ present: (response) => (result = response) },
	);
	expect(importRows).not.toHaveBeenCalled();
	expect(result?.errors).toEqual([
		{
			file: "goals",
			line: null,
			message: "ファイルが大きすぎます。テンプレートから作った CSV を選んでください。",
		},
	]);
});

it("accepts a header Excel padded with spaces or empty columns, and sends nothing for a header-only file", async () => {
	const padded = ` ${CSV_HEADERS.goals.join(" , ")} ,,\n`;
	const { result, importRows } = await run(padded);
	expect(result?.errors).toEqual([]);
	expect(importRows).toHaveBeenCalledWith([], [], false);
});

it("reports a failure on the way to the database instead of crashing", async () => {
	const failing = new SheetImportController(
		{ findTemplate: vi.fn() },
		new ImportSheetDataInteractor({
			findTemplate: vi.fn(),
			importRows: vi.fn().mockRejectedValue(new Error("Admin のみ操作できます。")),
		}),
		{ selectDestination: vi.fn(), save: vi.fn() },
	);
	const file = new File([`${CSV_HEADERS.goals.join(",")}\nE1,社員1,1,目標,,,,\n`], "goals.csv");
	expect(await failing.run(file, null, true)).toEqual({
		errors: [{ file: null, line: null, message: "Admin のみ操作できます。" }],
		summary: null,
		applied: false,
	});
});

describe("several period goals for one challenge goal", () => {
	const header = CSV_HEADERS.goals.join(",");
	const sent = async (body: string) => {
		const { result, importRows } = await run(`${header}\n${body}`);
		return { result, rows: importRows.mock.calls[0]?.[0] };
	};

	it("adds a period goal for each further row of the same employee and goal number, in file order", async () => {
		const { rows } = await sent(
			[
				"E1,社員1,1,品質を高める,手順書を作る,作成した,3,",
				"E2,社員2,1,別の人の目標,,ひとりで達成,,",
				"E1,社員1,１,,共有会を開く,,,",
				"E1,社員1,1,品質を高める,点検表を直す,,3,",
			].join("\n"),
		);
		expect(rows).toEqual([
			{
				line: 2,
				employeeNo: "E1",
				name: "社員1",
				goalNumber: "1",
				challengeGoal: "品質を高める",
				periodGoals: [
					{ description: "手順書を作る", achievement: "作成した" },
					{ description: "共有会を開く", achievement: "" },
					{ description: "点検表を直す", achievement: "" },
				],
				achievement: "",
				firstScore: "3",
				secondScore: "",
			},
			expect.objectContaining({
				line: 3,
				employeeNo: "E2",
				periodGoals: [],
				achievement: "ひとりで達成",
			}),
		]);
	});

	it.each([
		[
			"a different challenge goal",
			"E1,社員1,1,別のテーマ,共有会を開く,,,",
			"チャレンジ目標が、同じ目標の2行目と違います",
		],
		[
			"a different score",
			"E1,社員1,1,,共有会を開く,,4,",
			"一次評価点が、同じ目標の2行目と違います",
		],
		["a row without a period goal", "E1,社員1,1,,,あとで書く,,", "期中目標が空欄です"],
	])(
		"refuses %s on a further row, naming its line, without asking the database",
		async (_, row, message) => {
			const { result, rows } = await sent(`E1,社員1,1,品質を高める,手順書を作る,,3,\n${row}`);
			expect(rows).toBeUndefined();
			expect(result?.errors).toEqual([
				{ file: "goals", line: 3, message: expect.stringContaining(message) },
			]);
		},
	);

	it("keeps the Milestone rules: at most four period goals, and no theme achievement beside them", async () => {
		const five = Array.from({ length: 5 }, (_, i) => `E1,社員1,1,テーマ,タスク${i + 1},,,`).join(
			"\n",
		);
		// 決まりを破った行(5件目)を示す
		expect((await sent(five)).result?.errors).toEqual([
			{ file: "goals", line: 6, message: expect.stringContaining("0〜4件") },
		]);
		const both = await sent("E1,社員1,1,テーマ,,テーマの実績,,\nE1,社員1,1,,タスク,,,");
		expect(both.rows).toBeUndefined();
		expect(both.result?.errors).toEqual([
			{ file: "goals", line: 3, message: expect.stringContaining("期中目標があるときは") },
		]);
		const beside = await sent(
			"E1,社員1,1,テーマ,タスク,タスクの実績,,\nE1,社員1,1,,,テーマの実績,,",
		);
		expect(beside.result?.errors?.[0]?.line).toBe(3);
	});
});
