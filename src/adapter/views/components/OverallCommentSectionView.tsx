import { MessageSquareText } from "lucide-solid";
import { type Component, Show } from "solid-js";

export interface OverallCommentSectionProps {
	canEditFirst: boolean;
	canEditSecond: boolean;
	firstOverallComment: string;
	secondOverallComment: string;
	onFirstOverallCommentChange: (comment: string) => void;
	onSecondOverallCommentChange: (comment: string) => void;
	onSaveFirstOverallComment: () => void;
	onSaveSecondOverallComment: () => void;
	updating: boolean;
	updateError: string | null;
}

const OverallCommentSection: Component<OverallCommentSectionProps> = (props) => (
	<Show when={props.canEditFirst || props.canEditSecond}>
		<article class="overall-comment-card">
			<div class="overall-comment-card__header">
				<h2>
					<MessageSquareText class="section-icon" />
					総評
				</h2>
			</div>
			<div class="overall-comment-fields">
				<Show when={props.canEditFirst}>
					<label class="overall-comment-field" for="first-overall-comment">
						<span>一次評価者 総評</span>
						<textarea
							id="first-overall-comment"
							value={props.firstOverallComment}
							onInput={(event) => props.onFirstOverallCommentChange(event.currentTarget.value)}
						/>
						<button
							type="button"
							class="primary-action"
							onClick={props.onSaveFirstOverallComment}
							disabled={props.updating}
						>
							{props.updating ? "保存中..." : "保存"}
						</button>
					</label>
				</Show>
				<Show when={props.canEditSecond}>
					<label class="overall-comment-field" for="second-overall-comment">
						<span>二次評価者 総評</span>
						<textarea
							id="second-overall-comment"
							value={props.secondOverallComment}
							onInput={(event) => props.onSecondOverallCommentChange(event.currentTarget.value)}
						/>
						<button
							type="button"
							class="primary-action"
							onClick={props.onSaveSecondOverallComment}
							disabled={props.updating}
						>
							{props.updating ? "保存中..." : "保存"}
						</button>
					</label>
				</Show>
			</div>
			<Show when={props.updateError}>
				<p class="error-message">{props.updateError}</p>
			</Show>
		</article>
	</Show>
);

export default OverallCommentSection;
