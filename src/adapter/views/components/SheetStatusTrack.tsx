import { Check, FileCheck, ShieldCheck, Undo2 } from "lucide-solid";
import { type Component, For, Show } from "solid-js";
import { SHEET_STATUS_ORDER, statusLabel, statusRank } from "../format";

interface SheetStatusTrackProps {
	status: string;
	canSubmit: boolean;
	canRevert: boolean;
	canFinalize: boolean;
	updating: boolean;
	notice: string | null;
	onSubmit: () => void;
	onRevert: () => void;
	onFinalize: () => void;
}

/** 下書き → 提出済み → 評価確定 の進行と、いま自分ができる次の操作を示す。 */
const SheetStatusTrack: Component<SheetStatusTrackProps> = (props) => {
	const currentRank = () => statusRank(props.status);

	return (
		<div class="status-track">
			<ol class="status-track__steps" aria-label="評価シートの進行状況">
				<For each={SHEET_STATUS_ORDER}>
					{(step, index) => (
						<li
							class="status-track__step"
							classList={{
								done: index() < currentRank(),
								current: index() === currentRank(),
							}}
							aria-current={index() === currentRank() ? "step" : undefined}
						>
							<span class="status-track__dot">
								<Show when={index() < currentRank()}>
									<Check size={12} />
								</Show>
							</span>
							{statusLabel(step)}
						</li>
					)}
				</For>
			</ol>

			<div class="status-track__actions">
				<Show when={props.canSubmit}>
					<button
						type="button"
						class="primary-action"
						onClick={props.onSubmit}
						disabled={props.updating}
					>
						<FileCheck class="action-icon" />
						{props.updating ? "提出中..." : "提出する"}
					</button>
				</Show>
				<Show when={props.canRevert}>
					<button
						type="button"
						class="secondary-action"
						onClick={props.onRevert}
						disabled={props.updating}
					>
						<Undo2 class="action-icon" />
						{props.updating ? "処理中..." : "下書きに戻す"}
					</button>
				</Show>
				<Show when={props.canFinalize}>
					<button
						type="button"
						class="primary-action finalize"
						onClick={props.onFinalize}
						disabled={props.updating}
					>
						<ShieldCheck class="action-icon" />
						{props.updating ? "確定中..." : "評価を確定する"}
					</button>
				</Show>
			</div>

			<Show when={props.notice}>
				<p class="status-track__notice" role="alert">
					{props.notice}
				</p>
			</Show>
		</div>
	);
};

export default SheetStatusTrack;
