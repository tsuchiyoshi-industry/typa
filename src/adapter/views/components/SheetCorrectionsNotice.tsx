import { type Component, For, Show } from "solid-js";
import type { SheetCorrectionDto } from "../../../application/dtos/EvaluationSheetDto";
import { formatDateTime } from "../format";

/**
 * 締め後修正(遡及処理)の記録。評価期間を締めた後に直された項目を、赤字で隠さず示す。
 * 修正が無ければ何も出さない。
 */
const SheetCorrectionsNotice: Component<{ corrections: SheetCorrectionDto[]; heading?: string }> = (
	props,
) => (
	<Show when={props.corrections.length > 0}>
		<section class="correction-notice" aria-labelledby="correction-notice-heading">
			<h2 id="correction-notice-heading">
				{props.heading ?? `締め後修正があります(${props.corrections.length}件)`}
			</h2>
			<p>評価期間を締めた後に、管理担当者が次の項目を直しました。</p>
			<ol>
				<For each={props.corrections}>
					{(correction) => (
						<li>
							<p class="correction-notice__what">
								<strong>{correction.subject}</strong>
								<span>
									{correction.before} → {correction.after}
								</span>
							</p>
							<p class="correction-notice__why">
								<time dateTime={correction.correctedAt}>
									{formatDateTime(correction.correctedAt)}
								</time>
								<span>理由: {correction.reason}</span>
							</p>
						</li>
					)}
				</For>
			</ol>
		</section>
	</Show>
);

export default SheetCorrectionsNotice;
