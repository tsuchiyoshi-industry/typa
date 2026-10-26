/** 評価シートの状態を進める前の、中身の不足。 */
export type SheetTransitionError =
	/** 空のチャレンジ目標がある、または目標の件数が範囲の外。missing は足りないものの一覧。 */
	| { kind: "objectivesIncomplete"; missing: string[] }
	/** 確定する評価者自身の、まだ評価していない項目がある。 */
	| { kind: "evaluationIncomplete"; stage: "first" | "second"; pending: string[] };

const list = (items: readonly string[]) => items.map((item) => `・${item}`).join("\n");

export function describeSheetTransitionError(error: SheetTransitionError): string {
	switch (error.kind) {
		case "objectivesIncomplete":
			return `チャレンジ目標が空欄の目標は送信・確定できません。入力して保存するか、不要なタブを削除してください。\n${list(error.missing)}`;
		case "evaluationIncomplete":
			return `${error.stage === "first" ? "一次" : "二次"}評価に未設定の項目が ${error.pending.length} 件あります。すべての評価を 1〜4 で設定して保存してください。\n${list(error.pending)}`;
	}
}
