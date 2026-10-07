import {
	EvaluationStatus,
	type EvaluationStatusValue,
} from "../../domain/valueObjects/EvaluationStatus";

const STATUS_LABELS: Record<EvaluationStatusValue, string> = {
	draft: "下書き",
	submitted: "提出済み",
	first_evaluated: "一次評価済み",
	finalized: "評価確定",
};

export const statusLabel = (status: EvaluationStatusValue): string => STATUS_LABELS[status];

const STATUS_HINTS: Record<EvaluationStatusValue, string> = {
	draft: "本人が編集中です。提出するまで評価者には表示されません。",
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
