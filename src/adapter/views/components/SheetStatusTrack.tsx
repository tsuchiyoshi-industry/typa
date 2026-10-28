import Check from "lucide-solid/icons/check";
import FileCheck from "lucide-solid/icons/file-check";
import ShieldCheck from "lucide-solid/icons/shield-check";
import Undo2 from "lucide-solid/icons/undo-2";
import { type Component, For, Show } from "solid-js";
import {
	EvaluationStatus,
	type EvaluationStatusValue,
} from "../../../domain/valueObjects/EvaluationStatus";
import { statusHint, statusLabel } from "../format";

interface SheetStatusTrackProps {
	status: EvaluationStatusValue;
	/** 二次評価者「なし」の社員は「二次評価待ち」の段を通らない。 */
	primaryIsFinal: boolean;
	canSubmit: boolean;
	canRevert: boolean;
	canConfirmFirst: boolean;
	canFinalize: boolean;
	canConfirmGoals?: boolean;
	canRequestFirst?: boolean;
	updating: boolean;
	/** 目標・評価・総評の保存中。保存後の読み直しが済むまで、古い内容で判定させない */
	busy?: boolean;
	notice: string | null;
	onSubmit: () => void;
	onRevert: () => void;
	onConfirmFirst: () => void;
	onFinalize: () => void;
	onConfirmGoals?: () => void;
	onRequestFirst?: () => void;
	/** いまボールを持っている人(EvaluationSheet.currentHolder)。評価確定は null。 */
	holder?: { actor: "subject" | "primary" | "secondary"; name: string } | null;
}

const HOLDER_ROLES = { subject: "本人", primary: "一次評価者", secondary: "二次評価者" } as const;

/** 下書き → 目標確認待ち → 振り返り待ち → 一次評価待ち → 二次評価待ち → 評価確定 の進行と、いまの担当、自分ができる次の操作を示す。 */
const SheetStatusTrack: Component<SheetStatusTrackProps> = (props) => {
	const current = () => EvaluationStatus.from(props.status);
	const steps = () =>
		EvaluationStatus.ALL.filter(
			(step) =>
				step !== EvaluationStatus.FIRST_EVALUATED || !props.primaryIsFinal || step === current(),
		);
	const currentRank = () => steps().indexOf(current());

	return (
		<div class="status-track">
			<ol class="status-track__steps" aria-label="評価シートの進行状況">
				<For each={steps()}>
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
							{statusLabel(step.toString())}
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
						disabled={props.updating || props.busy}
					>
						<FileCheck class="action-icon" />
						{props.updating ? "送信中..." : "目標を送信する"}
					</button>
				</Show>
				<Show when={props.canRevert}>
					<button
						type="button"
						class="secondary-action"
						onClick={props.onRevert}
						disabled={props.updating || props.busy}
					>
						<Undo2 class="action-icon" />
						{props.updating ? "処理中..." : "要修正として下書きに戻す"}
					</button>
				</Show>
				<Show when={props.canConfirmGoals}>
					<button
						type="button"
						class="primary-action"
						onClick={props.onConfirmGoals}
						disabled={props.updating || props.busy}
					>
						目標を確定する
					</button>
				</Show>
				<Show when={props.canRequestFirst}>
					<button
						type="button"
						class="primary-action"
						onClick={props.onRequestFirst}
						disabled={props.updating || props.busy}
					>
						一次評価を依頼する
					</button>
				</Show>
				<Show when={props.canConfirmFirst}>
					<button
						type="button"
						class="primary-action finalize"
						onClick={props.onConfirmFirst}
						disabled={props.updating || props.busy}
					>
						<ShieldCheck class="action-icon" />
						{props.updating ? "確定中..." : "一次評価を確定する"}
					</button>
				</Show>
				<Show when={props.canFinalize}>
					<button
						type="button"
						class="primary-action finalize"
						onClick={props.onFinalize}
						disabled={props.updating || props.busy}
					>
						<ShieldCheck class="action-icon" />
						{props.updating
							? "確定中..."
							: props.primaryIsFinal
								? "評価を確定する"
								: "二次評価を確定する"}
					</button>
				</Show>
			</div>

			<p class="status-track__hint">
				<Show when={props.holder}>
					{(holder) => (
						<strong class="status-track__holder">
							いまの担当：{HOLDER_ROLES[holder().actor]}（{holder().name}）
						</strong>
					)}
				</Show>
				{statusHint(props.status)}
			</p>

			<Show when={props.notice}>
				<p class="status-track__notice" role="alert">
					{props.notice}
				</p>
			</Show>
		</div>
	);
};

export default SheetStatusTrack;
