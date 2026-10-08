import BadgeCheck from "lucide-solid/icons/badge-check";
import Hourglass from "lucide-solid/icons/hourglass";
import PencilLine from "lucide-solid/icons/pencil-line";
import Send from "lucide-solid/icons/send";
import type { Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { EvaluationStatusValue } from "../../../domain/valueObjects/EvaluationStatus";
import { statusLabel } from "../format";

/** 色だけに頼らず、形でも状態を見分けられるようにする。 */
const STATUS_ICONS: Record<EvaluationStatusValue, typeof PencilLine> = {
	draft: PencilLine,
	submitted: Send,
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
