import type { PeriodGoal } from "../valueObjects/PeriodGoal";

/** 取込テンプレートに並べる、選んだ評価期間にまだ取り込める社員と、その等級の共通評価項目。 */
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
	periodGoals: PeriodGoal[];
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

export interface SheetImportRequest {
	/** 取り込む評価期間。実施中か締め済み(DB 関数が確かめる)。 */
	periodId: number;
	/**
	 * 締め済みの評価期間に書くと、画面で確かめたか。締め済みなのに false なら、DB 関数は何も書かずに断る
	 * (画面が見ていた状態と違う)。確かめるだけ(apply が false)のときは見ない。
	 */
	closedPeriodConfirmed: boolean;
	goals: GoalImportRow[];
	common: CommonImportRow[];
	/** false なら確かめるだけ。 */
	apply: boolean;
}

/**
 * 選んだ評価期間(実施中か締め済み)の評価シートへの一括取込。どちらも Admin だけが呼べる(DB 関数が確かめる)。
 * 締め済みの評価期間への書き込みは、締めを越える操作として監査ログに置き換えた内容ごと残る。
 */
export interface SheetImportRepository {
	findTemplate(periodId: number): Promise<SheetImportTemplate>;
	/** 誤りが1件でもあれば何も書かない。 */
	importRows(request: SheetImportRequest): Promise<SheetImportResult>;
}
