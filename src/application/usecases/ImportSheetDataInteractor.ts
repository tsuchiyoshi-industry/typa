import { Milestone } from "../../domain/entities/Milestone";
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

		const merged = mergeGoalRows(goals.rows, goals.lines);
		if ("errors" in merged) {
			outputPort.present({ errors: merged.errors, summary: null, applied: false });
			return;
		}
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
		outputPort.present(await this.repository.importRows(merged.rows, commonRows, request.apply));
	}
}

/**
 * 目標の行を、チャレンジ目標ごとにまとめる。同じ社員番号・目標番号の行は同じチャレンジ目標で、
 * 1行ごとに期中目標を1件ずつ足す(ファイルの順)。チャレンジ目標・氏名・点数は最初の行に書き、続きの行では
 * 空欄か同じ内容にする。期中目標の無い行の達成状況は、チャレンジ目標の達成状況。
 * 期中目標の件数と達成状況の置き場所は Milestone が確かめ、決まりを破った行を示す。
 */
export function mergeGoalRows(
	rows: readonly string[][],
	lines: readonly number[],
): { rows: GoalImportRow[] } | { errors: SheetImportError[] } {
	const merged = new Map<string, GoalImportRow>();
	const broken = new Set<string>();
	const errors: SheetImportError[] = [];
	const fail = (key: string, line: number, message: string) => {
		broken.add(key);
		errors.push({ file: "goals", line, message });
	};
	for (const [i, cells] of rows.entries()) {
		const [employeeNo, name, goalNumber, challengeGoal, description, achievement, first, second] =
			cells;
		const line = lines[i];
		const key = `${employeeNo.trim()}|${goalNumber}`;
		if (broken.has(key)) {
			continue;
		}
		const hasTask = description.trim() !== "";
		const head = merged.get(key);
		if (!head) {
			const row: GoalImportRow = {
				line,
				employeeNo,
				name,
				goalNumber,
				challengeGoal,
				periodGoals: hasTask ? [{ description, achievement }] : [],
				achievement: hasTask ? "" : achievement,
				firstScore: first,
				secondScore: second,
			};
			const invalid = milestoneError(row);
			if (invalid) {
				fail(key, line, invalid);
			} else {
				merged.set(key, row);
			}
			continue;
		}
		if (!hasTask) {
			fail(
				key,
				line,
				`期中目標が空欄です。同じ目標番号の${head.line}行目に続く行には、期中目標を1件ずつ書いてください。`,
			);
			continue;
		}
		const conflict = (
			[
				["氏名", name, head.name],
				["チャレンジ目標", challengeGoal, head.challengeGoal],
				["一次評価点", first, head.firstScore],
				["二次評価点", second, head.secondScore],
			] as const
		).find(([, value, headValue]) => value.trim() !== "" && value !== headValue);
		if (conflict) {
			fail(
				key,
				line,
				`${conflict[0]}が、同じ目標の${head.line}行目と違います。続きの行では空欄にするか、同じ内容にしてください。`,
			);
			continue;
		}
		const next = { ...head, periodGoals: [...head.periodGoals, { description, achievement }] };
		const invalid = milestoneError(next);
		if (invalid) {
			fail(key, line, invalid);
		} else {
			merged.set(key, next);
		}
	}
	return errors.length > 0 ? { errors } : { rows: [...merged.values()] };
}

/** 期中目標の件数と達成状況の置き場所が、チャレンジ目標の決まりに合わなければ、その理由。 */
function milestoneError(row: GoalImportRow): string | null {
	try {
		Milestone.restore({
			id: 0,
			sheetId: 0,
			goalNumber: 1,
			challengeGoal: row.challengeGoal,
			periodGoals: row.periodGoals,
			achievement: row.achievement,
		});
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "目標の内容が不正です。";
	}
}
