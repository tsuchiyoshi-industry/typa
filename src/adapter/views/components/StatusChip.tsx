import { dynamic } from "@solidjs/web";
import type { Component } from "solid-js";
import type { EvaluationStatusValue } from "../../../domain/valueObjects/EvaluationStatus";
import { statusLabel } from "../format";
import { BadgeCheck, ClipboardCheck, Hourglass, Inbox, PencilLine, Send } from "./icons";

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

const StatusChip: Component<{ status: EvaluationStatusValue }> = (props) => {
	// 状態が変わると、その状態の形に描き替える
	const StatusIcon = dynamic(() => STATUS_ICONS[props.status]);
	return (
		<span class={["status-chip", props.status]}>
			<StatusIcon size={14} />
			{statusLabel(props.status)}
		</span>
	);
};

export default StatusChip;
