import { Check, SquarePen, X } from "lucide-solid";
import { type Component, createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { EmployeeDto } from "../../../application/dtos/EmployeeDto";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import type { ChallengeEvaluationViewModel } from "../../presenters/ChallengeEvaluationPresenter";
import { confirmDiscard, showToast, trackUnsaved } from "../feedback";
import ScoreScale from "./ScoreScale";

interface ChallengeEvaluationViewProps {
	sheetId: number | null;
	objectives: MilestoneDto[];
	subject: EmployeeDto;
	canEditFirst: boolean;
	canEditSecond: boolean;
	canEditMilestoneGoal: boolean;
	canViewSecondEvaluation: boolean;
	controller: ChallengeEvaluationController;
	viewModel: () => ChallengeEvaluationViewModel;
	onUpdated: () => void;
	onSavingChange?: (saving: boolean) => void;
}

const MAX_SCORE = 4;

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
	const [draftScore, setDraftScore] = createSignal({ firstScore: 0, secondScore: 0 });
	const [textUpdating, setTextUpdating] = createSignal(false);
	const [scoreUpdating, setScoreUpdating] = createSignal(false);
	createEffect(() => props.onSavingChange?.(textUpdating() || scoreUpdating()));

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
					},
				],
	);

	const activeObjective = createMemo(
		() =>
			displayObjectives().find((item) => Number(item.goalNumber) === activeTab()) ??
			displayObjectives()[0],
	);

	/** まだ保存されていない(本人が目標を未入力の)目標は、評価の対象にできない。 */
	const isSaved = () => (activeObjective()?.id ?? 0) > 0;
	const canScore = () => isSaved() && (props.canEditFirst || props.canEditSecond);

	const textChanged = () => {
		const objective = activeObjective();
		const draft = draftText();
		return (
			objective != null &&
			(draft.challengeGoal !== objective.challengeGoal ||
				draft.midtermGoal !== objective.midtermGoal ||
				draft.achievement !== objective.achievement)
		);
	};

	const scoreChanged = () => {
		const objective = activeObjective();
		const draft = draftScore();
		return (
			objective != null &&
			((props.canEditFirst && draft.firstScore !== (objective.firstScore ?? 0)) ||
				(props.canEditSecond && draft.secondScore !== (objective.secondScore ?? 0)))
		);
	};

	const isDirty = () => (isTextEditing() && textChanged()) || (isScoreEditing() && scoreChanged());

	trackUnsaved("challenge", isDirty);

	const selectTab = async (goalNumber: number) => {
		// 捨てるのはこの目標の入力だけなので、他の欄(総評など)の未保存は問わない
		if (goalNumber === activeTab() || !(await confirmDiscard(isDirty()))) {
			return;
		}
		setIsTextEditing(false);
		setIsScoreEditing(false);
		setActiveTab(goalNumber);
	};

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
						props.sheetId ?? objective.sheetId,
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
			setIsTextEditing(false);
			showToast("success", `目標 ${objective.goalNumber} を保存しました`);
			props.onUpdated();
		}
	};

	const startScoreEditing = () => {
		const objective = activeObjective();
		if (!objective) {
			return;
		}
		setDraftScore({
			firstScore: objective.firstScore ?? 0,
			secondScore: objective.secondScore ?? 0,
		});
		setIsScoreEditing(true);
	};

	const applyScoreUpdate = async () => {
		const objective = activeObjective();
		if (!objective) {
			return;
		}
		setScoreUpdating(true);
		const success = await props.controller.updateScore(
			props.sheetId ?? objective.sheetId,
			objective.id,
			props.canEditFirst ? draftScore().firstScore : undefined,
			props.canEditSecond ? draftScore().secondScore : undefined,
		);
		setScoreUpdating(false);
		if (success) {
			setIsScoreEditing(false);
			showToast("success", `目標 ${objective.goalNumber} の評価を保存しました`);
			props.onUpdated();
		}
	};

	const ScoreReadout: Component<{ label: string; value: number | null | undefined }> = (
		readoutProps,
	) => (
		<div class="score-pill">
			<span class="score-label">{readoutProps.label}</span>
			<Show when={readoutProps.value} fallback={<span class="score-value empty">未評価</span>}>
				<span class="score-value">
					{readoutProps.value}
					<small> / {MAX_SCORE}</small>
				</span>
			</Show>
		</div>
	);

	return (
		<section class="challenge-card">
			<div class="challenge-card__title">
				<h2>チャレンジ目標評価</h2>
				<p class="challenge-helper">目標ごとに 1〜{MAX_SCORE} の4段階で評価します。</p>
			</div>

			<div class="challenge-tabs" role="tablist" aria-label="チャレンジ目標">
				<For each={displayObjectives()}>
					{(item) => (
						<button
							type="button"
							role="tab"
							aria-selected={activeTab() === Number(item.goalNumber)}
							class="challenge-tab"
							classList={{ active: activeTab() === Number(item.goalNumber) }}
							onClick={() => void selectTab(Number(item.goalNumber))}
						>
							目標 {item.goalNumber}
						</button>
					)}
				</For>
			</div>

			<Show when={activeObjective()} fallback={<p>対象の目標が見つかりません。</p>}>
				<article class="objective-block" role="tabpanel">
					<div class="objective-meta">
						<div class="score-grid">
							<Show
								when={isScoreEditing()}
								fallback={
									<>
										<ScoreReadout label="一次評価" value={activeObjective()?.firstScore} />
										<Show when={props.canViewSecondEvaluation}>
											<ScoreReadout label="二次評価" value={activeObjective()?.secondScore} />
										</Show>
									</>
								}
							>
								<Show when={props.canEditFirst}>
									<div class="score-pill editing">
										<span class="score-label">一次評価</span>
										<ScoreScale
											label="一次評価"
											max={MAX_SCORE}
											value={draftScore().firstScore}
											disabled={scoreUpdating()}
											onChange={(value) => setDraftScore({ ...draftScore(), firstScore: value })}
										/>
									</div>
								</Show>
								<Show when={props.canEditSecond}>
									<div class="score-pill editing">
										<span class="score-label">二次評価</span>
										<ScoreScale
											label="二次評価"
											max={MAX_SCORE}
											value={draftScore().secondScore}
											disabled={scoreUpdating()}
											onChange={(value) => setDraftScore({ ...draftScore(), secondScore: value })}
										/>
									</div>
								</Show>
							</Show>
						</div>

						<div class="objective-meta-actions">
							<Show when={isScoreEditing()}>
								<button
									type="button"
									class="primary-action"
									onClick={applyScoreUpdate}
									disabled={scoreUpdating() || !scoreChanged()}
								>
									<Check class="action-icon" />
									{scoreUpdating() ? "保存中..." : "評価を保存"}
								</button>
								<button
									type="button"
									class="secondary-action"
									onClick={() => setIsScoreEditing(false)}
									disabled={scoreUpdating()}
								>
									<X class="action-icon" />
									キャンセル
								</button>
							</Show>
							<Show when={canScore() && !isScoreEditing() && !isTextEditing()}>
								<button type="button" class="edit-toggle-button" onClick={startScoreEditing}>
									<SquarePen class="edit-icon" />
									評価を入力
								</button>
							</Show>
							<Show when={props.canEditMilestoneGoal && !isTextEditing() && !isScoreEditing()}>
								<button type="button" class="edit-toggle-button" onClick={startTextEditing}>
									<SquarePen class="edit-icon" />
									目標を編集
								</button>
							</Show>
						</div>
					</div>

					<Show when={!isSaved() && (props.canEditFirst || props.canEditSecond)}>
						<p class="field-hint">本人が目標を入力すると、評価を入力できるようになります。</p>
					</Show>

					<Show
						when={isTextEditing()}
						fallback={
							<div class="objective-fields">
								<div class="objective-field">
									<span class="objective-field__label">チャレンジ目標</span>
									<p classList={{ empty: !activeObjective()?.challengeGoal }}>
										{activeObjective()?.challengeGoal || "未入力"}
									</p>
								</div>
								<div class="objective-field">
									<span class="objective-field__label">中間目標</span>
									<p classList={{ empty: !activeObjective()?.midtermGoal }}>
										{activeObjective()?.midtermGoal || "未入力"}
									</p>
								</div>
								<div class="objective-field">
									<span class="objective-field__label">達成状況</span>
									<p classList={{ empty: !activeObjective()?.achievement }}>
										{activeObjective()?.achievement || "未入力"}
									</p>
								</div>
							</div>
						}
					>
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
									disabled={textUpdating() || !textChanged()}
								>
									<Check class="action-icon" />
									{textUpdating() ? "保存中..." : "目標を保存"}
								</button>
								<button
									type="button"
									class="secondary-action"
									onClick={() => setIsTextEditing(false)}
									disabled={textUpdating()}
								>
									<X class="action-icon" />
									キャンセル
								</button>
							</div>
						</div>
					</Show>

					<Show when={props.viewModel().updateError}>
						<p class="error-message" role="alert">
							{props.viewModel().updateError}
						</p>
					</Show>
				</article>
			</Show>
		</section>
	);
};

export default ChallengeEvaluationView;
