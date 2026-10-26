import {
	EvaluationStatus,
	type EvaluationStatusValue,
} from "../../domain/valueObjects/EvaluationStatus";

/** 状態の表示名は「いま何を待っているか」。済んだことではなく、次に誰が動くかが分かる言葉にする。 */
const STATUS_LABELS: Record<EvaluationStatusValue, string> = {
	draft: "下書き",
	goals_submitted: "送信済み",
	goals_confirmed: "目標確定",
	submitted: "一次評価待ち",
	first_evaluated: "二次評価待ち",
	finalized: "最終評価済み",
};

export const statusLabel = (status: EvaluationStatusValue): string => STATUS_LABELS[status];

const STATUS_HINTS: Record<EvaluationStatusValue, string> = {
	draft:
		"本人が目標を書いています。送信するまで評価者には表示されません。前期のチャレンジ目標は、据え置くか見直して引き継げます。",
	goals_submitted:
		"一次評価者による目標の確認を待っています。まだ評価は始まりません。達成状況は、この間も書き直せます。",
	goals_confirmed:
		"目標は確定しました。期中目標は変えられません。達成状況を書いて、一次評価を依頼してください。",
	submitted: "一次評価者の評価を待っています。",
	first_evaluated: "一次評価が確定しました。二次評価者の評価を待っています。",
	finalized: "最終評価済みです。内容は変更できません。",
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
