import { type Component, For, Show } from "solid-js";
import type { PendingEvaluationItemDto } from "../../../application/dtos/EvaluationSheetDto";

interface EvaluationCompletionNoticeProps {
	items: PendingEvaluationItemDto[];
	/** 確定しようとして止められたか。止められたら、警告として未設定の項目を開いて見せる。 */
	attempted: boolean;
	ref?: (element: HTMLDivElement) => void;
	onShow: (item: PendingEvaluationItemDto) => void;
}

/** 確定する前に残っている、自分の評価の未設定項目。 */
const EvaluationCompletionNotice: Component<EvaluationCompletionNoticeProps> = (props) => (
	<Show when={props.items.length > 0}>
		<div
			ref={props.ref}
			class="evaluation-completion"
			classList={{ invalid: props.attempted }}
			tabIndex={-1}
			role={props.attempted ? "alert" : "status"}
		>
			<p>
				<strong>自分の評価: あと {props.items.length} 件</strong>
			</p>
			<p>確定する前に、すべての評価を 1〜4 で設定して保存してください。</p>
			<details open={props.attempted}>
				<summary>未設定の項目を確認する</summary>
				<ul>
					<For each={props.items}>
						{(item) => (
							<li>
								<button type="button" class="link-button" onClick={() => props.onShow(item)}>
									{item.label}
								</button>
							</li>
						)}
					</For>
				</ul>
			</details>
		</div>
	</Show>
);

export default EvaluationCompletionNotice;
