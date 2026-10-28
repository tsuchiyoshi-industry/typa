import BadgeCheck from "lucide-solid/icons/badge-check";
import ClipboardCheck from "lucide-solid/icons/clipboard-check";
import Hourglass from "lucide-solid/icons/hourglass";
import Inbox from "lucide-solid/icons/inbox";
import PencilLine from "lucide-solid/icons/pencil-line";
import Send from "lucide-solid/icons/send";
import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { EvaluationStatusValue } from "../../../domain/valueObjects/EvaluationStatus";
import { statusLabel } from "../format";

/**
 * 色だけに頼らず、形でも状態を見分けられるようにする。状態ごとに別の形にする。
 * 下書き: 鉛筆 / 目標確認待ち: 紙飛行機 / 振り返り待ち: チェックの付いたボード / 一次評価待ち: 受信箱 /
 * 二次評価待ち: 砂時計 / 評価確定: 認証バッジ
 */
const STATUS_ICONS: Record<EvaluationStatusValue, typeof PencilLine> = {
	draft: PencilLine,
	goals_submitted: Send,
	goals_confirmed: ClipboardCheck,
	submitted: Inbox,
	first_evaluated: Hourglass,
	finalized: BadgeCheck,
};

const StatusChip: Component<{ status: EvaluationStatusValue }> = (props) => (
	<span class={`status-chip ${props.status}`}>
		<Dynamic component={STATUS_ICONS[props.status]} size={14} aria-hidden="true" />
		{statusLabel(props.status)}
	</span>
);

export default StatusChip;
