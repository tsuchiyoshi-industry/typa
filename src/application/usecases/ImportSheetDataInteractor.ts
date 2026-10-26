import type {
	CommonImportRow,
	GoalImportRow,
	SheetImportError,
	SheetImportFile,
	SheetImportRepository,
	SheetImportResult,
} from "../../domain/repositories/SheetImportRepository";
import type { OutputPort } from "../ports/OutputPort";
import type { UseCase } from "../ports/UseCase";
import { CSV_HEADERS, CsvSyntaxError, decodeCsv, parseCsv } from "./sheetImportCsv";

export interface ImportSheetDataRequest {
	/** 選ばれていないファイルは null。 */
	goals: ArrayBuffer | null;
	common: ArrayBuffer | null;
	/** false なら確かめるだけで、何も書かない。 */
	apply: boolean;
}

/** 数百人分でも数MB。これより大きいのは、別のファイルを選んだとみなす。 */
const MAX_BYTES = 20 * 1024 * 1024;
const FILE_LABEL: Record<SheetImportFile, string> = { goals: "目標", common: "共通評価" };
/** 数字の列は、全角の数字や前後の空白を許す。 */
const NUMBER_COLUMNS = new Set(["目標番号", "項目ID", "一次評価点", "二次評価点"]);

/** 1つのファイルを、見出しを確かめてから行の一覧にする。誤りがあれば行は返さない。 */
const readRows = (
	file: SheetImportFile,
	bytes: ArrayBuffer,
): { rows: string[][]; lines: number[] } | SheetImportError => {
	const fail = (line: number | null, message: string): SheetImportError => ({
		file,
		line,
		message,
	});
	if (bytes.byteLength > MAX_BYTES) {
		return fail(null, "ファイルが大きすぎます。テンプレートから作った CSV を選んでください。");
	}
	let records: string[][];
	try {
		records = parseCsv(decodeCsv(bytes));
	} catch (error) {
		if (error instanceof CsvSyntaxError) {
			return fail(error.line, error.message);
		}
		throw error;
	}
	const headers = CSV_HEADERS[file];
	const header = (records[0] ?? []).map((cell) => cell.trim());
	const matches = (expected: readonly string[]) =>
		expected.every((name, i) => header[i] === name) &&
		header.slice(expected.length).every((cell) => cell === "");
	if (!matches(headers)) {
		const other: SheetImportFile = file === "goals" ? "common" : "goals";
		return fail(
			1,
			matches(CSV_HEADERS[other])
				? `${FILE_LABEL[other]}のファイルが選ばれています。`
				: `見出しが違います。テンプレートの見出し(${headers.join(",")})のまま使ってください。`,
		);
	}
	const rows: string[][] = [];
	const lines: number[] = [];
	records.slice(1).forEach((record, i) => {
		// 空の行は送らない。行番号は Excel の行番号(見出しが1行目)のまま
		if (record.some((cell) => cell.trim() !== "")) {
			rows.push(
				headers.map((name, column) => {
					const cell = record[column] ?? "";
					return NUMBER_COLUMNS.has(name) ? cell.normalize("NFKC").trim() : cell;
				}),
			);
			lines.push(i + 2);
		}
	});
	return { rows, lines };
};

/**
 * 導入処理の「データ取込」。実施中の評価期間の目標・共通評価・点数を、テンプレートから作った CSV で入れる。
 * ファイルの形はここで、中身(社員・項目・点数)は DB 関数が確かめ、誤りが1件でもあれば何も書かない。
 * シートは下書きのまま作る・置き換えるので、通知メールは出ない。
 */
export class ImportSheetDataInteractor
	implements UseCase<ImportSheetDataRequest, OutputPort<SheetImportResult>>
{
	constructor(private readonly repository: SheetImportRepository) {}

	async execute(
		request: ImportSheetDataRequest,
		outputPort: OutputPort<SheetImportResult>,
	): Promise<void> {
		const errors: SheetImportError[] = [];
		const read = (file: SheetImportFile, bytes: ArrayBuffer | null) => {
			if (!bytes) {
				return { rows: [], lines: [] };
			}
			const result = readRows(file, bytes);
			if ("message" in result) {
				errors.push(result);
				return { rows: [], lines: [] };
			}
			return result;
		};
		const goals = read("goals", request.goals);
		const common = read("common", request.common);
		if (!request.goals && !request.common) {
			errors.push({ file: null, line: null, message: "取り込むファイルを選んでください。" });
		}
		if (errors.length > 0) {
			outputPort.present({ errors, summary: null, applied: false });
			return;
		}

		const goalRows: GoalImportRow[] = goals.rows.map(
			(
				[
					employeeNo,
					name,
					goalNumber,
					challengeGoal,
					description,
					achievement,
					firstScore,
					secondScore,
				],
				i,
			) => ({
				line: goals.lines[i],
				employeeNo,
				name,
				goalNumber,
				challengeGoal,
				periodGoals: description.trim() ? [{ description, achievement }] : [],
				achievement: description.trim() ? "" : achievement,
				firstScore,
				secondScore,
			}),
		);
		const commonRows: CommonImportRow[] = common.rows.map(
			([employeeNo, name, itemId, itemTitle, firstScore, secondScore, comment], i) => ({
				line: common.lines[i],
				employeeNo,
				name,
				itemId,
				itemTitle,
				firstScore,
				secondScore,
				comment,
			}),
		);
		outputPort.present(await this.repository.importRows(goalRows, commonRows, request.apply));
	}
}
