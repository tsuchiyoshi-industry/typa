export type SheetStatus = "draft" | "submitted" | "finalized";

/** 進行順。一覧の並び替えと進行トラックの両方で使う。 */
export const SHEET_STATUS_ORDER: readonly SheetStatus[] = ["draft", "submitted", "finalized"];

const STATUS_LABELS: Record<string, string> = {
	draft: "下書き",
	submitted: "提出済み",
	finalized: "評価確定",
};

export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

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
