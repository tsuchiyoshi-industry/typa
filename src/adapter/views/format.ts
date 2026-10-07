export type SheetStatus = "draft" | "submitted" | "first_evaluated" | "finalized";

/** 進行順。一覧の並び替えと進行トラックの両方で使う。 */
export const SHEET_STATUS_ORDER: readonly SheetStatus[] = [
	"draft",
	"submitted",
	"first_evaluated",
	"finalized",
];

const STATUS_LABELS: Record<string, string> = {
	draft: "下書き",
	submitted: "提出済み",
	first_evaluated: "一次評価済み",
	finalized: "評価確定",
};

export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

const STATUS_HINTS: Record<string, string> = {
	draft: "本人が編集中です。提出するまで評価者には表示されません。",
	submitted: "一次評価者の評価を待っています。",
	first_evaluated: "一次評価が確定しました。二次評価者の評価を待っています。",
	finalized: "評価が確定しました。内容は変更できません。",
};

/** いまの状態で「誰の番か」を一文で示す。 */
export const statusHint = (status: string): string => STATUS_HINTS[status] ?? "";

export const statusRank = (status: string): number =>
	SHEET_STATUS_ORDER.indexOf(status as SheetStatus);

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
