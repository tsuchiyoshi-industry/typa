import { Check, SquarePen, X } from "lucide-solid";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import type { EmployeeDto } from "../../../application/dtos/EmployeeDto";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import type { ChallengeEvaluationViewModel } from "../../presenters/ChallengeEvaluationPresenter";

interface ChallengeEvaluationViewProps {
	sheetId: number | null;
	objectives: MilestoneDto[];
	subject: EmployeeDto;
	canEditFirst: boolean;
	canEditSecond: boolean;
	controller: ChallengeEvaluationController;
	viewModel: () => ChallengeEvaluationViewModel;
	onUpdated: () => void;
}

const ChallengeEvaluationView: Component<ChallengeEvaluationViewProps> = (props) => {
	const [activeTab, setActiveTab] = createSignal<number>(
		Number(props.objectives[0]?.goalNumber ?? 1),
	);
	const [isTextEditing, setIsTextEditing] = createSignal(false);
	const [isScoreEditing, setIsScoreEditing] = createSignal(false);
	const [draftText, setDraftText] = createSignal({
		challengeGoal: "",
		midtermGoal: "",
		achievement: "",
	});
	const [draftScore, setDraftScore] = createSignal({ firstScore: "", secondScore: "" });
	const [textUpdating, setTextUpdating] = createSignal(false);
	const [scoreUpdating, setScoreUpdating] = createSignal(false);

	const displayObjectives = createMemo<MilestoneDto[]>(() =>
		props.objectives.length > 0
			? props.objectives
			: [
					{
						id: 0,
						sheetId: props.sheetId ?? 0,
						goalNumber: 1,
						challengeGoal: "",
						midtermGoal: "",
						achievement: "",
						firstScore: 0,
						secondScore: 0,
						isEditable: true,
					},
				],
	);

	const activeObjective = createMemo(
		() =>
			displayObjectives().find((item) => Number(item.goalNumber) === activeTab()) ??
			displayObjectives()[0],
	);

	const startTextEditing = () => {
		const objective = activeObjective();
		if (!objective) {
			return;
		}
		setDraftText({
			challengeGoal: objective.challengeGoal,
			midtermGoal: objective.midtermGoal,
			achievement: objective.achievement,
		});
		setIsTextEditing(true);
		setIsScoreEditing(false);
	};

	const cancelTextEditing = () => {
		setIsTextEditing(false);
	};

	const applyTextUpdate = async () => {
		const objective = activeObjective();
		if (!objective) {
			return;
		}
		setTextUpdating(true);
		const success =
			objective.id > 0
				? await props.controller.updateText(
						objective.id,
						draftText().challengeGoal,
						draftText().midtermGoal,
						draftText().achievement,
					)
				: await props.controller.upsertText(
						props.sheetId ?? objective.sheetId,
						objective.goalNumber,
						draftText().challengeGoal,
						draftText().midtermGoal,
						draftText().achievement,
					);
		setTextUpdating(false);
		if (success) {
			props.onUpdated();
			setIsTextEditing(false);
		}
	};

	const startScoreEditing = () => {
		const objective = activeObjective();
		if (!objective) {
			return;
		}
		setDraftScore({
			firstScore: objective.firstScore ? String(objective.firstScore) : "",
			secondScore: objective.secondScore ? String(objective.secondScore) : "",
		});
		setIsScoreEditing(true);
		setIsTextEditing(false);
	};

	const cancelScoreEditing = () => {
		setIsScoreEditing(false);
	};

	const applyScoreUpdate = async () => {
		const objective = activeObjective();
		if (!objective) {
			return;
		}
		setScoreUpdating(true);
		const success = await props.controller.updateScore(
			objective.id,
			props.canEditFirst ? Number(draftScore().firstScore) : undefined,
			props.canEditSecond ? Number(draftScore().secondScore) : undefined,
		);
		setScoreUpdating(false);
		if (success) {
			props.onUpdated();
			setIsScoreEditing(false);
		}
	};

	return (
		<section class="challenge-card">
			<div class="challenge-card__title">
				<h2>チャレンジ目標評価</h2>
				<p class="challenge-helper">1〜4 の整数で入力します。</p>
			</div>

			<div class="challenge-tabs" role="tablist">
				<For each={displayObjectives()}>
					{(item) => (
						<button
							type="button"
							role="tab"
							class={
								activeTab() === Number(item.goalNumber) ? "challenge-tab active" : "challenge-tab"
							}
							onClick={() => {
								setActiveTab(Number(item.goalNumber));
								setIsTextEditing(false);
								setIsScoreEditing(false);
							}}
						>
							目標 {item.goalNumber}
						</button>
					)}
				</For>
			</div>

			<Show when={activeObjective()} fallback={<p>対象の目標が見つかりません。</p>}>
				<article class="objective-block" role="tabpanel">
					<div class="objective-meta">
						<strong>目標 {activeObjective()?.goalNumber}</strong>
						<div class="objective-meta-actions">
							<div class="score-grid">
								<Show
									when={isScoreEditing()}
									fallback={
										<>
											<div class="score-pill">
												<span class="score-label">一次評価</span>
												<span class="score-value">{activeObjective()?.firstScore || "—"}</span>
											</div>
											<div class="score-pill">
												<span class="score-label">二次評価</span>
												<span class="score-value">{activeObjective()?.secondScore || "—"}</span>
											</div>
										</>
									}
								>
									<Show when={props.canEditFirst}>
										<div class="score-pill">
											<span class="score-label">一次評価</span>
											<input
												type="number"
												class="score-input"
												min="1"
												max="4"
												value={draftScore().firstScore}
												onInput={(e) =>
													setDraftScore({ ...draftScore(), firstScore: e.currentTarget.value })
												}
											/>
										</div>
									</Show>
									<Show when={props.canEditSecond}>
										<div class="score-pill">
											<span class="score-label">二次評価</span>
											<input
												type="number"
												class="score-input"
												min="1"
												max="4"
												value={draftScore().secondScore}
												onInput={(e) =>
													setDraftScore({ ...draftScore(), secondScore: e.currentTarget.value })
												}
											/>
										</div>
									</Show>
									<Show when={isScoreEditing()}>
										<button
											type="button"
											class="primary-action"
											onClick={applyScoreUpdate}
											disabled={scoreUpdating()}
										>
											<Check class="action-icon" />
											{scoreUpdating() ? "保存中..." : "保存"}
										</button>
										<button type="button" class="secondary-action" onClick={cancelScoreEditing}>
											<X class="action-icon" />
											キャンセル
										</button>
									</Show>
								</Show>
							</div>
							<Show
								when={
									activeObjective()?.id !== 0 &&
									(props.canEditFirst || props.canEditSecond) &&
									!isScoreEditing()
								}
							>
								<button type="button" class="edit-toggle-button" onClick={startScoreEditing}>
									<SquarePen class="edit-icon" />
									評価更新
								</button>
							</Show>
							<Show
								when={
									(activeObjective()?.isEditable || activeObjective()?.id === 0) && !isTextEditing()
								}
							>
								<button type="button" class="edit-toggle-button" onClick={startTextEditing}>
									<SquarePen class="edit-icon" />
									目標編集
								</button>
							</Show>
							<Show when={isTextEditing()}>
								<span class="editing-label">編集中</span>
							</Show>
						</div>
					</div>
					<Show when={isTextEditing()}>
						<div class="objective-fields editing">
							<label>
								<span>チャレンジ目標</span>
								<textarea
									value={draftText().challengeGoal}
									onInput={(e) =>
										setDraftText({ ...draftText(), challengeGoal: e.currentTarget.value })
									}
								/>
							</label>
							<label>
								<span>中間目標</span>
								<textarea
									value={draftText().midtermGoal}
									onInput={(e) =>
										setDraftText({ ...draftText(), midtermGoal: e.currentTarget.value })
									}
								/>
							</label>
							<label>
								<span>達成状況</span>
								<textarea
									value={draftText().achievement}
									onInput={(e) =>
										setDraftText({ ...draftText(), achievement: e.currentTarget.value })
									}
								/>
							</label>
							<div class="edit-actions">
								<button
									type="button"
									class="primary-action"
									onClick={applyTextUpdate}
									disabled={textUpdating()}
								>
									<Check class="action-icon" />
									{textUpdating() ? "保存中..." : "保存"}
								</button>
								<button
									type="button"
									class="secondary-action"
									onClick={cancelTextEditing}
									disabled={textUpdating()}
								>
									<X class="action-icon" />
									キャンセル
								</button>
							</div>
						</div>
					</Show>
					<Show when={!isTextEditing()}>
						<div class="objective-fields">
							<div class="objective-field">
								<span class="objective-field__label">チャレンジ目標</span>
								<p>{activeObjective()?.challengeGoal || "—"}</p>
							</div>
							<div class="objective-field">
								<span class="objective-field__label">中間目標</span>
								<p>{activeObjective()?.midtermGoal || "—"}</p>
							</div>
							<div class="objective-field">
								<span class="objective-field__label">達成状況</span>
								<p>{activeObjective()?.achievement || "—"}</p>
							</div>
						</div>
					</Show>
					<Show when={props.viewModel().updateError}>
						<p class="error-message">{props.viewModel().updateError}</p>
					</Show>
				</article>
			</Show>
		</section>
	);
};

export default ChallengeEvaluationView;
