/** 取込テンプレートに並べる、実施中の評価期間にまだ取り込める社員と、その等級の共通評価項目。 */
export interface SheetImportTemplate {
	periodName: string;
	maxGoals: number;
	employees: { employeeNo: string; name: string; items: { id: number; title: string }[] }[];
}

/** CSV の1行。数値の列も CSV のままの文字列で渡し、DB 関数が確かめる。line は Excel の行番号。 */
export interface GoalImportRow {
	line: number;
	employeeNo: string;
	name: string;
	goalNumber: string;
	challengeGoal: string;
	midtermGoal: string;
	achievement: string;
	firstScore: string;
	secondScore: string;
}

export interface CommonImportRow {
	line: number;
	employeeNo: string;
	name: string;
	itemId: string;
	itemTitle: string;
	firstScore: string;
	secondScore: string;
	comment: string;
}

export type SheetImportFile = "goals" | "common";

/** file と line が null なのは、ファイル全体についての誤り。 */
export interface SheetImportError {
	file: SheetImportFile | null;
	line: number | null;
	message: string;
}

export interface SheetImportSummary {
	periodName: string;
	employees: number;
	newSheets: number;
	replacedSheets: number;
	goals: number;
	commonResults: number;
}

export interface SheetImportResult {
	errors: SheetImportError[];
	summary: SheetImportSummary | null;
	applied: boolean;
}

/** 実施中の評価期間の評価シートへの一括取込。どちらも Admin だけが呼べる(DB 関数が確かめる)。 */
export interface SheetImportRepository {
	findTemplate(): Promise<SheetImportTemplate>;
	/** 誤りが1件でもあれば何も書かない。apply が false なら確かめるだけ。 */
	importRows(
		goals: GoalImportRow[],
		common: CommonImportRow[],
		apply: boolean,
	): Promise<SheetImportResult>;
}
