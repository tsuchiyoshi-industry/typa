import ShieldCheck from "lucide-solid/icons/shield-check";
import { type Component, Show } from "solid-js";
import type { EvaluationRankDto } from "../../../application/dtos/EvaluationSheetDto";

interface ReviewActionBarProps {
	/** 最終評価の確定か(でなければ一次評価の確定)。 */
	finalizing: boolean;
	primaryIsFinal: boolean;
	rank: EvaluationRankDto | undefined;
	updating: boolean;
	busy: boolean;
	onConfirm: () => void;
}

/** 受け持ち画面で、入力を終えた先に置く確定ボタン。確定で何が起きるかは、確認ダイアログで伝える。 */
const ReviewActionBar: Component<ReviewActionBarProps> = (props) => (
	<footer class="review-action-bar">
		<span>
			{props.finalizing ? "最終評価ランク" : "一次評価ランク"}
			<strong>{props.rank?.displayText ?? "—"}</strong>
			<Show when={props.rank}>{(rank) => <small>{rank().score} 点</small>}</Show>
		</span>
		<button
			type="button"
			class="primary-action finalize"
			disabled={props.busy}
			onClick={() => props.onConfirm()}
		>
			<ShieldCheck class="action-icon" />
			{props.updating
				? "確定中..."
				: !props.finalizing
					? "一次評価を確定する"
					: props.primaryIsFinal
						? "評価を確定する"
						: "二次評価を確定する"}
		</button>
	</footer>
);

export default ReviewActionBar;
