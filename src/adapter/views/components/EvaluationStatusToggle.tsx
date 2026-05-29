import { Check, FileCheck, FilePenLine } from "lucide-solid";
import { type Component, Show } from "solid-js";

interface EvaluationStatusToggleProps {
	status: string;
	isOwner: boolean;
	updating: boolean;
	updateError: string | null;
	onStatusChange: (status: "draft" | "submitted") => void;
}

const EvaluationStatusToggle: Component<EvaluationStatusToggleProps> = (props) => {
	const isDraft = () => props.status === "draft";

	const handleToggle = () => {
		if (props.updating) {
			return;
		}
		const newStatus = isDraft() ? "submitted" : "draft";
		props.onStatusChange(newStatus);
	};

	return (
		<Show when={props.isOwner}>
			<div class="status-toggle-compact">
				<div class="status-badge" classList={{ draft: isDraft(), submitted: !isDraft() }}>
					<Show when={isDraft()} fallback={<Check class="status-icon" />}>
						<FilePenLine class="status-icon" />
					</Show>
					<span class="status-text">{isDraft() ? "下書き" : "提出済み"}</span>
				</div>
				<button
					type="button"
					class="status-toggle-btn"
					classList={{ submit: isDraft(), draft: !isDraft() }}
					onClick={handleToggle}
					disabled={props.updating}
					title={
						isDraft()
							? "評価シートを提出する（提出後は編集不可）"
							: "下書きに戻す（再編集可能にする）"
					}
				>
					{props.updating ? (
						"..."
					) : isDraft() ? (
						<>
							<FileCheck class="btn-icon" />
							提出
						</>
					) : (
						<>
							<FilePenLine class="btn-icon" />
							戻す
						</>
					)}
				</button>
				<Show when={props.updateError}>
					<p class="status-error">{props.updateError}</p>
				</Show>
			</div>
		</Show>
	);
};

export default EvaluationStatusToggle;
