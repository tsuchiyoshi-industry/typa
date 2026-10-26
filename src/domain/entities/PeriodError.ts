/** 評価期間(期・日付・区切り方・開始・締め・削除)の、失敗の種類。 */
export type PeriodError =
	| { kind: "datesMissing" }
	/** YYYY-MM-DD の、実在する日付でない。 */
	| { kind: "dateInvalid" }
	| { kind: "rangeReversed" }
	| { kind: "divisionUnknown" }
	| { kind: "termNameMissing" }
	| { kind: "termNameTooLong"; max: number }
	/** 区切った評価期間のどれかが空になる。 */
	| { kind: "termTooShort"; division: string }
	| { kind: "alreadyActive"; periodName: string }
	/** 締めた評価期間は、もう一度開始しない。 */
	| { kind: "alreadyClosed"; periodName: string }
	/** 評価が確定していないシートが残っていて、締めてよいとされていない。 */
	| { kind: "unfinishedSheets"; periodName: string; count: number; detail: string }
	| { kind: "activeCannotBeDeleted" }
	| { kind: "hasSheets"; periodName: string; count: number };

export function describePeriodError(error: PeriodError): string {
	switch (error.kind) {
		case "datesMissing":
			return "開始日と終了日を入力してください。";
		case "dateInvalid":
			return "日付は実在する日を YYYY-MM-DD で入力してください。";
		case "rangeReversed":
			return "終了日は開始日以降の日付にしてください。";
		case "divisionUnknown":
			return "評価期間の区切りは、通年・半期・四半期から選んでください。";
		case "termNameMissing":
			return "期の名前を入力してください。";
		case "termNameTooLong":
			return `期の名前は ${error.max} 文字以内で入力してください。`;
		case "termTooShort":
			return `${error.division}に分けるには期間が短すぎます。開始日と終了日を確かめてください。`;
		case "alreadyActive":
			return `「${error.periodName}」は既に実施中です。`;
		case "alreadyClosed":
			return `「${error.periodName}」は締め済みのため、もう一度開始することはできません。`;
		case "unfinishedSheets":
			return `「${error.periodName}」に未確定の評価シートが ${error.count} 件あります（${error.detail}）。すべての評価を確定してから締めてください。評価を確定せずに締めるには、この期間を編集して「評価が確定していなくても締められる」をオンにしてください。`;
		case "activeCannotBeDeleted":
			return "実施中の評価期間は削除できません。";
		case "hasSheets":
			return `「${error.periodName}」には評価シートが ${error.count} 件あるため、削除できません。`;
	}
}
