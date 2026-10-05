import { Check, MessageSquareText } from "lucide-solid";
import { type Component, Show } from "solid-js";

export type OverallCommentTarget = "first" | "second";

export interface OverallCommentSectionProps {
	canEditFirst: boolean;
	canEditSecond: boolean;
	firstOverallComment: string;
	secondOverallComment: string;
	firstDirty: boolean;
	secondDirty: boolean;
	/** 保存中の欄。保存していなければ null。 */
	savingTarget: OverallCommentTarget | null;
	onFirstOverallCommentChange: (comment: string) => void;
	onSecondOverallCommentChange: (comment: string) => void;
	onSave: (target: OverallCommentTarget) => void;
	updateError: string | null;
}

const OverallCommentSection: Component<OverallCommentSectionProps> = (props) => {
	const Field: Component<{
		target: OverallCommentTarget;
		label: string;
		value: string;
		dirty: boolean;
		onChange: (comment: string) => void;
	}> = (fieldProps) => {
		const saving = () => props.savingTarget === fieldProps.target;
		const inputId = `${fieldProps.target}-overall-comment`;

		return (
			<div class="overall-comment-field">
				<label for={inputId}>{fieldProps.label}</label>
				<textarea
					id={inputId}
					value={fieldProps.value}
					onInput={(event) => fieldProps.onChange(event.currentTarget.value)}
				/>
				<div class="overall-comment-field__footer">
					<button
						type="button"
						class="primary-action"
						onClick={() => props.onSave(fieldProps.target)}
						disabled={!fieldProps.dirty || props.savingTarget !== null}
					>
						<Check class="action-icon" />
						{saving() ? "保存中..." : "総評を保存"}
					</button>
					<span class="save-state" classList={{ dirty: fieldProps.dirty }}>
						{fieldProps.dirty ? "未保存の変更があります" : fieldProps.value ? "保存済み" : ""}
					</span>
				</div>
			</div>
		);
	};

	return (
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
						<Field
							target="first"
							label="一次評価者の総評"
							value={props.firstOverallComment}
							dirty={props.firstDirty}
							onChange={props.onFirstOverallCommentChange}
						/>
					</Show>
					<Show when={props.canEditSecond}>
						<Field
							target="second"
							label="二次評価者の総評"
							value={props.secondOverallComment}
							dirty={props.secondDirty}
							onChange={props.onSecondOverallCommentChange}
						/>
					</Show>
				</div>
				<Show when={props.updateError}>
					<p class="error-message" role="alert">
						{props.updateError}
					</p>
				</Show>
			</article>
		</Show>
	);
};

export default OverallCommentSection;
