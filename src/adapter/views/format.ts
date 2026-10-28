import {
	EvaluationStatus,
	type EvaluationStatusValue,
} from "../../domain/valueObjects/EvaluationStatus";

/** 状態の表示名(EvaluationStatus.label)。「いま何を待っているか」が分かる言葉。 */
export const statusLabel = (status: EvaluationStatusValue): string =>
	EvaluationStatus.from(status).label();

const STATUS_HINTS: Record<EvaluationStatusValue, string> = {
	draft:
		"本人が目標を書いています。送信するまで評価者には表示されません。前期に書いた目標は「前期」タブで見られます。",
	goals_submitted:
		"一次評価者による目標の確認を待っています。まだ評価は始まりません。達成状況は、目標が確定してから書けます。",
	goals_confirmed:
		"目標は確定しました。本人が達成状況を書いています。期中目標は変えられません。書き終えたら一次評価を依頼してください。",
	submitted: "一次評価者の評価を待っています。",
	first_evaluated: "一次評価が確定しました。二次評価者の評価を待っています。",
	finalized: "評価が確定しました。内容は変更できません。",
};

/** いまの状態で「誰の番か」を一文で示す。 */
export const statusHint = (status: EvaluationStatusValue): string => STATUS_HINTS[status];

/** 進行順での位置。一覧の並び替えに使う。 */
export const statusRank = (status: EvaluationStatusValue): number =>
	EvaluationStatus.from(status).order();

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
});

/** ISO文字列を「2026/10/05 14:30」形式にする。解釈できない値はそのまま返す。 */
export function formatDateTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : dateTimeFormat.format(date);
}
