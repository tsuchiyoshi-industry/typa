import { err, ok, type Result } from "../Result";
import { charLength } from "../valueObjects/textLength";

/**
 * 等級と共通目標のマスタ。共通目標はかならず「共通目標セット」に属し、等級はセットを1つ選ぶ
 * (同じ項目で評価する等級はセットを共有する)。
 *
 * 業務のきまり: 評価シートは、作成時の等級のセットを持ち続ける。マスタを直しても既存のシートは変わらない。
 * 既存のシートが使うセットの項目を直すと、DB が複製を新版にして、そのセットを使っていた等級を新版へ付け替える。
 * 直した内容を既存のシートに入れたいときは、シートを作り直す(運用で行う)。
 */
export interface CommonGoal {
	id: number;
	title: string;
	description: string;
	/** 共通評価の点に掛ける重み。 */
	weight: number;
}

export interface CommonGoalSet {
	id: number;
	name: string;
	/** このセットで作られた評価シートの数。1枚でもあれば、項目を直すと新版になる。 */
	sheetCount: number;
	items: CommonGoal[];
}

export interface GradeEntry {
	id: number;
	name: string;
	/** この等級の共通目標セット。未設定(共通評価なし)なら null。 */
	itemSetId: number | null;
	employeeCount: number;
	sheetCount: number;
}

export interface GradeMaster {
	grades: GradeEntry[];
	/** 等級が使っているか、どのシートも使っていないセット。使われなくなった旧版は含まない。 */
	itemSets: CommonGoalSet[];
}

export const GRADE_MASTER_LIMITS = {
	name: 50,
	title: 100,
	description: 1000,
	items: 30,
	weight: { min: 1, max: 10 },
} as const;

export type GradeMasterError =
	| { kind: "forbidden" }
	| { kind: "nameInvalid" }
	| { kind: "itemSetRequired" }
	| { kind: "gradeInUse"; employees: number; sheets: number }
	| { kind: "setNameInvalid" }
	| { kind: "itemsRequired" }
	| { kind: "tooManyItems" }
	| { kind: "titleInvalid"; row: number }
	| { kind: "descriptionTooLong"; row: number }
	| { kind: "weightInvalid"; row: number }
	| { kind: "duplicateTitle"; title: string }
	| { kind: "setInUse"; grades: readonly string[]; sheets: number };

const validName = (name: string) => name !== "" && charLength(name) <= GRADE_MASTER_LIMITS.name;

/** 等級の追加(shown が null)か変更。expected は画面に出していた値。食い違えば DB が断る。 */
export class GradeChange {
	private constructor(
		readonly id: number | null,
		readonly name: string,
		readonly itemSetId: number,
		readonly expected: { name: string; itemSetId: number | null } | null,
	) {}

	static from(request: {
		name: string;
		itemSetId: number | null;
		shown: GradeEntry | null;
	}): Result<GradeChange, GradeMasterError> {
		const name = request.name.trim();
		if (!validName(name)) {
			return err({ kind: "nameInvalid" });
		}
		if (request.itemSetId === null) {
			return err({ kind: "itemSetRequired" });
		}
		const shown = request.shown;
		return ok(
			new GradeChange(
				shown?.id ?? null,
				name,
				request.itemSetId,
				shown && { name: shown.name, itemSetId: shown.itemSetId },
			),
		);
	}
}

/** 社員がいる等級と、シートの記録に使われている等級は消せない。 */
export function canDeleteGrade(grade: GradeEntry): Result<void, GradeMasterError> {
	return grade.employeeCount > 0 || grade.sheetCount > 0
		? err({ kind: "gradeInUse", employees: grade.employeeCount, sheets: grade.sheetCount })
		: ok(undefined);
}

export interface CommonGoalDraft {
	/** 新しい項目は null。 */
	id: number | null;
	title: string;
	description: string;
	weight: number;
}

const { min, max } = GRADE_MASTER_LIMITS.weight;
const sameItems = (a: readonly CommonGoalDraft[], b: readonly CommonGoal[]) =>
	a.length === b.length &&
	a.every(
		(item, i) =>
			item.id === b[i].id &&
			item.title === b[i].title &&
			item.description === b[i].description &&
			item.weight === b[i].weight,
	);

/** 共通目標セットの追加(shown が null)か変更。items は項目のすべて。 */
export class CommonGoalSetChange {
	private constructor(
		readonly id: number | null,
		readonly name: string,
		readonly items: CommonGoalDraft[],
		readonly expected: { name: string; items: CommonGoal[] } | null,
		private readonly sheetCount: number,
	) {}

	static from(request: {
		name: string;
		items: readonly CommonGoalDraft[];
		shown: CommonGoalSet | null;
	}): Result<CommonGoalSetChange, GradeMasterError> {
		const name = request.name.trim();
		if (!validName(name)) {
			return err({ kind: "setNameInvalid" });
		}
		if (request.items.length === 0) {
			return err({ kind: "itemsRequired" });
		}
		if (request.items.length > GRADE_MASTER_LIMITS.items) {
			return err({ kind: "tooManyItems" });
		}
		const items = request.items.map((item) => ({ ...item, title: item.title.trim() }));
		const seen = new Set<string>();
		for (const [index, item] of items.entries()) {
			const row = index + 1;
			if (item.title === "" || charLength(item.title) > GRADE_MASTER_LIMITS.title) {
				return err({ kind: "titleInvalid", row });
			}
			if (charLength(item.description) > GRADE_MASTER_LIMITS.description) {
				return err({ kind: "descriptionTooLong", row });
			}
			if (!Number.isInteger(item.weight) || item.weight < min || item.weight > max) {
				return err({ kind: "weightInvalid", row });
			}
			if (seen.has(item.title)) {
				return err({ kind: "duplicateTitle", title: item.title });
			}
			seen.add(item.title);
		}
		const shown = request.shown;
		return ok(
			new CommonGoalSetChange(
				shown?.id ?? null,
				name,
				items,
				shown && { name: shown.name, items: shown.items },
				shown?.sheetCount ?? 0,
			),
		);
	}

	/** 既存のシートが使うセットの項目を変えるので、保存すると新版になる(既存のシートは今の版のまま)。 */
	makesNewVersion(): boolean {
		return this.sheetCount > 0 && !!this.expected && !sameItems(this.items, this.expected.items);
	}
}

/** 等級が使っているセットと、シートの記録に使われているセットは消せない。 */
export function canDeleteCommonGoalSet(
	set: CommonGoalSet,
	grades: readonly GradeEntry[],
): Result<void, GradeMasterError> {
	const users = grades.filter((grade) => grade.itemSetId === set.id).map((grade) => grade.name);
	return users.length > 0 || set.sheetCount > 0
		? err({ kind: "setInUse", grades: users, sheets: set.sheetCount })
		: ok(undefined);
}
