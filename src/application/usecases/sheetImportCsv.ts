import type {
	SheetImportFile,
	SheetImportTemplate,
} from "../../domain/repositories/SheetImportRepository";

/** テンプレートの見出し。取り込むときもこの並びのまま読む。 */
export const CSV_HEADERS: Record<SheetImportFile, readonly string[]> = {
	goals: [
		"社員番号",
		"氏名",
		"目標番号",
		"チャレンジ目標",
		"中間目標",
		"達成状況",
		"一次評価点",
		"二次評価点",
	],
	common: [
		"社員番号",
		"氏名",
		"項目ID",
		"項目名",
		"一次評価点",
		"二次評価点",
		"一次評価者コメント",
	],
};

/**
 * Excel の「CSV UTF-8」はBOM付きUTF-8、「CSV」は Shift_JIS で保存される。
 * UTF-8 として読めなければ Shift_JIS とみなす(BOM は TextDecoder が外す)。
 */
export const decodeCsv = (bytes: ArrayBuffer): string => {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder("shift_jis").decode(bytes);
	}
};

/**
 * RFC 4180 の CSV を、1レコード = Excel の1行として読む。セル内の改行もそのまま残す。
 * 引用符が閉じていなければ、開いた行番号を投げる。
 */
export const parseCsv = (text: string): string[][] => {
	const records: string[][] = [];
	let record: string[] = [];
	let field = "";
	let quoted = false;
	let quoteStart = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char !== '"') {
				field += char;
			} else if (text[i + 1] === '"') {
				field += '"';
				i++;
			} else {
				quoted = false;
			}
		} else if (char === '"') {
			quoted = true;
			quoteStart = records.length + 1;
		} else if (char === ",") {
			record.push(field);
			field = "";
		} else if (char === "\r" || char === "\n") {
			if (char === "\r" && text[i + 1] === "\n") {
				i++;
			}
			record.push(field);
			records.push(record);
			record = [];
			field = "";
		} else {
			field += char;
		}
	}
	if (quoted) {
		throw new CsvSyntaxError(quoteStart);
	}
	if (field !== "" || record.length > 0) {
		record.push(field);
		records.push(record);
	}
	return records;
};

export class CsvSyntaxError extends Error {
	constructor(readonly line: number) {
		super(`${line}行目の「"」が閉じていません。`);
	}
}

const BOM = String.fromCharCode(0xfeff);

const quote = (value: string) =>
	/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** Excel で開いても文字化けしないよう、BOM付きUTF-8・CRLF で書く。 */
export const toCsv = (rows: readonly (readonly (string | number)[])[]): string =>
	`${BOM}${rows.map((row) => row.map((cell) => quote(String(cell))).join(",")).join("\r\n")}\r\n`;

/** 社員ごとに目標番号 1〜上限、共通評価は等級の項目を並べ、記入する列だけを空けておく。 */
export const buildTemplate = (file: SheetImportFile, template: SheetImportTemplate): string =>
	toCsv([
		CSV_HEADERS[file],
		...template.employees.flatMap((employee) =>
			file === "goals"
				? Array.from({ length: template.maxGoals }, (_, i) => [
						employee.employeeNo,
						employee.name,
						i + 1,
						"",
						"",
						"",
						"",
						"",
					])
				: employee.items.map((item) => [
						employee.employeeNo,
						employee.name,
						item.id,
						item.title,
						"",
						"",
						"",
					]),
		),
	]);
