import { Check, SquarePen, X } from "lucide-solid";
import { type Component, createEffect, createSignal, For, Show } from "solid-js";
import type { Employee, Milestone } from "./helpers/evaluationSheet";
import { isPrimaryEvaluator, isSecondaryEvaluator } from "./helpers/evaluatorRole";
import { updateMilestone, updateMilestoneScore } from "./helpers/updateMilestone";

interface ChallengeEvaluationProps {
	objectives: Milestone[];
	subject: Employee;
	onUpdated: () => void;
}

const ChallengeEvaluation: Component<ChallengeEvaluationProps> = (props) => {
	// アクティブなタブ（goal_number ベース）
	const [activeTab, setActiveTab] = createSignal(1);

	const activeObjective = () =>
		props.objectives.find((o) => o.goal_number === activeTab()) ?? props.objectives[0];

	// 評価者ロール
	const [canEditFirstScore, setCanEditFirstScore] = createSignal(false);
	const [canEditSecondScore, setCanEditSecondScore] = createSignal(false);

	createEffect(() => {
		isPrimaryEvaluator(props.subject).then(setCanEditFirstScore);
		isSecondaryEvaluator(props.subject).then(setCanEditSecondScore);
	});

	// テキスト編集
	const [isEditing, setIsEditing] = createSignal(false);
	const [draftObjective, setDraftObjective] = createSignal({
		challenge_goal: "",
		midterm_goal: "",
		achievement: "",
	});
	const [updateLoading, setUpdateLoading] = createSignal(false);
	const [updateError, setUpdateError] = createSignal<string | null>(null);

	const startEditing = () => {
		const obj = activeObjective();
		if (!obj) {
			return;
		}
		setDraftObjective({
			challenge_goal: obj.challenge_goal,
			midterm_goal: obj.midterm_goal,
			achievement: obj.achievement,
		});
		setUpdateError(null);
		setIsEditing(true);
	};

	const cancelEditing = () => {
		setIsEditing(false);
		setUpdateError(null);
	};

	const applyUpdate = async () => {
		const obj = activeObjective();
		if (!obj) {
			return;
		}
		setUpdateLoading(true);
		setUpdateError(null);
		try {
			await updateMilestone(obj.id, {
				challenge_goal: draftObjective().challenge_goal,
				midterm_goal: draftObjective().midterm_goal,
				achievement: draftObjective().achievement,
			});
			props.onUpdated();
			setIsEditing(false);
		} catch (error) {
			setUpdateError(error instanceof Error ? error.message : "更新に失敗しました");
		} finally {
			setUpdateLoading(false);
		}
	};

	// スコア編集
	const [isScoreEditing, setIsScoreEditing] = createSignal(false);
	const [draftScore, setDraftScore] = createSignal({ first_score: "", second_score: "" });
	const [scoreUpdateLoading, setScoreUpdateLoading] = createSignal(false);
	const [scoreUpdateError, setScoreUpdateError] = createSignal<string | null>(null);

	const startScoreEditing = () => {
		const obj = activeObjective();
		if (!obj) {
			return;
		}
		setDraftScore({
			first_score: obj.first_score ? String(obj.first_score) : "",
			second_score: obj.second_score ? String(obj.second_score) : "",
		});
		setScoreUpdateError(null);
		setIsScoreEditing(true);
	};

	const cancelScoreEditing = () => {
		setIsScoreEditing(false);
		setScoreUpdateError(null);
	};

	const applyScoreUpdate = async () => {
		const obj = activeObjective();
		if (!obj) {
			return;
		}
		setScoreUpdateLoading(true);
		setScoreUpdateError(null);
		try {
			const payload: { first_score?: number; second_score?: number } = {};
			if (canEditFirstScore()) {
				payload.first_score = Number(draftScore().first_score) || 0;
			}
			if (canEditSecondScore()) {
				payload.second_score = Number(draftScore().second_score) || 0;
			}
			await updateMilestoneScore(obj.id, payload);
			props.onUpdated();
			setIsScoreEditing(false);
		} catch (error) {
			setScoreUpdateError(error instanceof Error ? error.message : "更新に失敗しました");
		} finally {
			setScoreUpdateLoading(false);
		}
	};

	// タブ切り替え時に編集状態をリセット
	const switchTab = (goalNumber: number) => {
		setActiveTab(goalNumber);
		setIsEditing(false);
		setIsScoreEditing(false);
		setUpdateError(null);
		setScoreUpdateError(null);
	};

	return (
		<section class="challenge-card">
			<div class="challenge-card__title">
				<h2>チャレンジ目標評価</h2>
				<p class="challenge-helper">1〜4 の整数で入力します。</p>
			</div>

			{/* タブ */}
			<div class="challenge-tabs" role="tablist">
				<For each={props.objectives}>
					{(obj) => (
						<button
							type="button"
							role="tab"
							aria-selected={activeTab() === obj.goal_number}
							class="challenge-tab"
							onClick={() => switchTab(obj.goal_number)}
						>
							目標 {obj.goal_number}
						</button>
					)}
				</For>
			</div>

			{/* タブパネル */}
			<Show when={activeObjective()} keyed>
				{(obj) => (
					<article class="objective-block" role="tabpanel">
						<div class="objective-meta">
							<strong>目標 {obj.goal_number}</strong>
							<div class="objective-meta-actions">
								{/* スコア表示 / 編集 */}
								<div class="score-grid">
									<Show
										when={isScoreEditing()}
										fallback={
											<>
												<div class="score-pill">
													<span class="score-label">一次評価</span>
													<span class="score-value">{obj.first_score || "—"}</span>
												</div>
												<div class="score-pill">
													<span class="score-label">二次評価</span>
													<span class="score-value">{obj.second_score || "—"}</span>
												</div>
											</>
										}
									>
										<Show when={canEditFirstScore()}>
											<div class="score-pill">
												<span class="score-label">一次評価</span>
												<input
													type="number"
													class="score-input"
													min="1"
													max="4"
													value={draftScore().first_score}
													onInput={(e) =>
														setDraftScore({ ...draftScore(), first_score: e.currentTarget.value })
													}
												/>
											</div>
										</Show>
										<Show when={canEditSecondScore()}>
											<div class="score-pill">
												<span class="score-label">二次評価</span>
												<input
													type="number"
													class="score-input"
													min="1"
													max="4"
													value={draftScore().second_score}
													onInput={(e) =>
														setDraftScore({ ...draftScore(), second_score: e.currentTarget.value })
													}
												/>
											</div>
										</Show>
										<button
											type="button"
											class="primary-action"
											onClick={applyScoreUpdate}
											disabled={scoreUpdateLoading()}
										>
											<Check class="action-icon" />
											{scoreUpdateLoading() ? "保存中…" : "確定"}
										</button>
										<button type="button" class="secondary-action" onClick={cancelScoreEditing}>
											<X class="action-icon" />
										</button>
									</Show>
								</div>

								<Show when={(canEditFirstScore() || canEditSecondScore()) && !isScoreEditing()}>
									<button type="button" class="edit-toggle-button" onClick={startScoreEditing}>
										<SquarePen class="edit-icon" />
										評価更新
									</button>
								</Show>
								<Show when={obj.is_editable && !isEditing()}>
									<button type="button" class="edit-toggle-button" onClick={startEditing}>
										<SquarePen class="edit-icon" />
										目標編集
									</button>
								</Show>
								<Show when={isEditing()}>
									<span class="editing-label">編集中</span>
								</Show>
							</div>
						</div>

						<Show when={scoreUpdateError()}>
							<p class="update-error">{scoreUpdateError()}</p>
						</Show>

						{/* テキストフィールド */}
						<Show
							when={isEditing()}
							fallback={
								<div class="objective-fields">
									<div class="objective-field">
										<span class="objective-field__label">チャレンジ目標</span>
										<p class="objective-field__text">{obj.challenge_goal}</p>
									</div>
									<div class="objective-field">
										<span class="objective-field__label">期中目標</span>
										<p class="objective-field__text">{obj.midterm_goal}</p>
									</div>
									<div class="objective-field">
										<span class="objective-field__label">期中取り組んだ実績内容</span>
										<p class="objective-field__text">{obj.achievement}</p>
									</div>
								</div>
							}
						>
							<div class="objective-fields">
								<div class="objective-field">
									<span class="objective-field__label">チャレンジ目標</span>
									<textarea
										class="objective-input"
										value={draftObjective().challenge_goal}
										onInput={(e) =>
											setDraftObjective({
												...draftObjective(),
												challenge_goal: e.currentTarget.value,
											})
										}
									/>
								</div>
								<div class="objective-field">
									<span class="objective-field__label">期中目標</span>
									<textarea
										class="objective-input"
										value={draftObjective().midterm_goal}
										onInput={(e) =>
											setDraftObjective({
												...draftObjective(),
												midterm_goal: e.currentTarget.value,
											})
										}
									/>
								</div>
								<div class="objective-field">
									<span class="objective-field__label">期中取り組んだ実績内容</span>
									<textarea
										class="objective-input"
										value={draftObjective().achievement}
										onInput={(e) =>
											setDraftObjective({
												...draftObjective(),
												achievement: e.currentTarget.value,
											})
										}
									/>
								</div>
								<div class="edit-actions">
									<button
										type="button"
										class="primary-action"
										onClick={applyUpdate}
										disabled={updateLoading()}
									>
										<Check class="action-icon" />
										{updateLoading() ? "保存中…" : "変更を完了"}
									</button>
									<button type="button" class="secondary-action" onClick={cancelEditing}>
										<X class="action-icon" />
										キャンセル
									</button>
								</div>
								<Show when={updateError()}>
									<p class="update-error">{updateError()}</p>
								</Show>
							</div>
						</Show>
					</article>
				)}
			</Show>
		</section>
	);
};

export default ChallengeEvaluation;
