import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
	untrack,
} from "solid-js";
import type { EmployeeDto } from "../../../application/dtos/EmployeeDto";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { PreviousGoals } from "../../../domain/repositories/MilestoneRepository";
import { continuityOf, type GoalContinuity } from "../../../domain/valueObjects/GoalContinuity";
import { emptyPeriodGoals, type PeriodGoal } from "../../../domain/valueObjects/PeriodGoal";
import { Score } from "../../../domain/valueObjects/Score";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import type { ChallengeEvaluationViewModel } from "../../presenters/ChallengeEvaluationPresenter";
import { confirmAction, confirmDiscard, showToast, trackUnsaved } from "../feedback";
import { type ConnectSaving, provideSaving } from "../savingSource";
import { Check, PencilLine, Pin, Plus, SquarePen, X } from "./icons";
import { PeriodGoalsEditor, PeriodGoalsList } from "./PeriodGoals";
import ScoreScale from "./ScoreScale";

/**
 * 外から開く目標(前期の目標を引き継いだ直後など)。seq を変えるたびに開き直す。
 * edit: challenge はチャレンジ目標を、plan は期中目標を書くところから編集を始める。
 */
export interface GoalFocus {
	goalNumber: number;
	edit: "challenge" | "plan" | null;
	seq: number;
}

interface ChallengeEvaluationViewProps {
	sheetId: number | null;
	objectives: MilestoneDto[];
	/** 1枚のシートに置ける目標の数の上限(設定値)。 */
	maxObjectives: number;
	subject: EmployeeDto;
	canEditFirst: boolean;
	canEditSecond: boolean;
	canEditMilestoneGoal: boolean;
	canEditMilestoneAchievement?: boolean;
	canViewSecondEvaluation: boolean;
	controller: ChallengeEvaluationController;
	viewModel: () => ChallengeEvaluationViewModel;
	/** 保存後にシートを読み直す。 */
	onUpdated: () => unknown;
	/** 「保存中か」を親に渡す口(描き終えたときに一度だけ accessor を渡す)。 */
	connectSaving?: ConnectSaving;
	/** 前期の目標。今期の目標が前期から据え置き・更新したものかを示す。 */
	previousGoals?: PreviousGoals | null;
	focus?: GoalFocus | null;
}

/** 前期とのつながりの印。据え置きはピン、更新はペン。 */
const ContinuityMark: Component<{ continuity: GoalContinuity }> = (markProps) => (
	<span class={["continuity-badge", { revised: markProps.continuity.kind === "revised" }]}>
		<Show when={markProps.continuity.kind === "revised"} fallback={<Pin class="action-icon" />}>
			<PencilLine class="action-icon" />
		</Show>
		{markProps.continuity.kind === "revised" ? "前期から更新" : "前期から据え置き"}
	</span>
);

const MAX_SCORE = Score.MAX;

const ChallengeEvaluationView: Component<ChallengeEvaluationViewProps> = (props) => {
	// 別のシートに替わったら、開くタブ・編集中・足した/消した目標の下書きを初めに戻す。
	// どれも sheetId から作る書き込める値なので、替わったときに作り直される(目標が増えただけでは戻さない)
	const perSheet = <T,>(initial: () => T) =>
		createSignal<T>(() => {
			props.sheetId;
			return untrack(initial);
		});
	const [activeTab, setActiveTab] = perSheet(() => Number(props.objectives[0]?.goalNumber ?? 1));
	const [isTextEditing, setIsTextEditing] = perSheet(() => false);
	const [isScoreEditing, setIsScoreEditing] = perSheet(() => false);
	const [draftText, setDraftText] = createSignal<{
		challengeGoal: string;
		achievement: string;
		periodGoals: PeriodGoal[];
	}>({
		challengeGoal: "",
		achievement: "",
		periodGoals: [],
	});
	/** 一部の欄だけを書き換える。値はハンドラーの中で先に読んで渡し、書き換えは前の書き込みに重ねる。 */
	const patchDraftText = (fields: Partial<ReturnType<typeof draftText>>) =>
		setDraftText((previous) => ({ ...previous, ...fields }));
	const [draftScore, setDraftScore] = createSignal({ firstScore: 0, secondScore: 0 });
	const [textUpdating, setTextUpdating] = createSignal(false);
	const [scoreUpdating, setScoreUpdating] = createSignal(false);
	provideSaving(
		() => props.connectSaving,
		() => textUpdating() || scoreUpdating(),
	);

	const [addedObjectives, setAddedObjectives] = perSheet<MilestoneDto[]>(() => []);
	const [removedIds, setRemovedIds] = perSheet<number[]>(() => []);
	const objectives = createMemo(() =>
		[
			...props.objectives,
			...addedObjectives().filter(
				(item) => !props.objectives.some((saved) => saved.id === item.id),
			),
		]
			.filter((item) => !removedIds().includes(item.id))
			.sort((a, b) => a.goalNumber - b.goalNumber),
	);
	const displayObjectives = createMemo<MilestoneDto[]>(() =>
		objectives().length > 0
			? objectives()
			: [
					{
						id: 0,
						sheetId: props.sheetId ?? 0,
						goalNumber: 1,
						periodGoals: emptyPeriodGoals(),
						challengeGoal: "",
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
	/** 自分が評価する段階で、まだ点数を付けていない目標か。タブに出し、2つ目の目標の付け忘れを防ぐ。 */
	const needsMyScore = (objective: MilestoneDto) =>
		objective.id > 0 &&
		((props.canEditSecond && !objective.secondScore) ||
			(!props.canEditSecond && props.canEditFirst && !objective.firstScore));

	const textChanged = () => {
		const objective = activeObjective();
		const draft = draftText();
		return (
			objective != null &&
			(draft.challengeGoal !== objective.challengeGoal ||
				draft.achievement !== objective.achievement ||
				JSON.stringify(draft.periodGoals) !== JSON.stringify(objective.periodGoals))
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
		if (
			textUpdating() ||
			scoreUpdating() ||
			goalNumber === activeTab() ||
			!(await confirmDiscard(isDirty()))
		) {
			return;
		}
		setIsTextEditing(false);
		setIsScoreEditing(false);
		setActiveTab(goalNumber);
	};

	const emptyObjective = (goalNumber: number): MilestoneDto => ({
		id: 0,
		sheetId: props.sheetId ?? 0,
		goalNumber,
		periodGoals: emptyPeriodGoals(),
		challengeGoal: "",
		achievement: "",
		firstScore: 0,
		secondScore: 0,
	});
	const addTab = async () => {
		if (
			!props.canEditMilestoneGoal ||
			textUpdating() ||
			scoreUpdating() ||
			displayObjectives().length >= props.maxObjectives
		) {
			return;
		}
		setTextUpdating(true);
		try {
			if (!(await confirmDiscard(isDirty()))) {
				return;
			}
			// 最初のタブも空のまま残す。不要な空タブを自動で消さない。
			const first = displayObjectives()[0];
			if (first.id === 0) {
				if (
					!(await props.controller.upsertText(
						props.sheetId ?? 0,
						first.goalNumber,
						"",
						emptyPeriodGoals(),
						"",
					))
				) {
					return;
				}
				setAddedObjectives((items) => [
					...items,
					{ ...first, id: props.viewModel().updatedMilestoneId ?? 0 },
				]);
			}
			// 空いているいちばん小さい番号
			const number = Array.from({ length: props.maxObjectives }, (_, index) => index + 1).find(
				(number) => !displayObjectives().some((item) => item.goalNumber === number),
			);
			if (
				number === undefined ||
				!(await props.controller.upsertText(props.sheetId ?? 0, number, "", emptyPeriodGoals(), ""))
			) {
				return;
			}
			setAddedObjectives((items) => [
				...items,
				{ ...emptyObjective(number), id: props.viewModel().updatedMilestoneId ?? 0 },
			]);
			setActiveTab(number);
			setIsScoreEditing(false);
			setDraftText({
				challengeGoal: "",
				achievement: "",
				periodGoals: [{ description: "", achievement: "" }],
			});
			setIsTextEditing(true);
			props.onUpdated();
		} finally {
			setTextUpdating(false);
		}
	};
	const deleteTab = async () => {
		const objective = activeObjective();
		if (
			!props.canEditMilestoneGoal ||
			!objective ||
			displayObjectives().length <= 1 ||
			textUpdating() ||
			scoreUpdating()
		) {
			return;
		}
		if (
			!(await confirmAction({
				title: `目標 ${objective.goalNumber} を削除しますか？`,
				message: "このタブの目標と入力中の内容を削除します。",
				confirmLabel: "削除する",
				tone: "danger",
			}))
		) {
			return;
		}
		setTextUpdating(true);
		try {
			if (!(await props.controller.delete(props.sheetId ?? objective.sheetId, objective.id))) {
				return;
			}
			setRemovedIds((ids) => [...ids, objective.id]);
			setAddedObjectives((items) => items.filter((item) => item.id !== objective.id));
			setIsTextEditing(false);
			setIsScoreEditing(false);
			setActiveTab(displayObjectives()[0].goalNumber);
			props.onUpdated();
		} finally {
			setTextUpdating(false);
		}
	};

	const continuityFor = (objective: MilestoneDto | undefined, challengeGoal?: string) =>
		objective && objective.id > 0
			? continuityOf(
					objective.goalNumber,
					challengeGoal ?? objective.challengeGoal,
					props.previousGoals,
				)
			: null;
	const activeContinuity = () => continuityFor(activeObjective());
	/** 編集中の文言で見た、つながり。書き換えると「更新」、前期の文言に戻すと「据え置き」になる。 */
	const draftContinuity = () => continuityFor(activeObjective(), draftText().challengeGoal);

	let section: HTMLElement | undefined;
	let handledFocus: number | null = null;
	/** 開くのに要る値は、要求が届いた時点のものを計算で取り出して渡す。 */
	const openFocused = async (request: {
		focus: GoalFocus;
		target: MilestoneDto | undefined;
		switching: boolean;
		dirty: boolean;
		canEdit: boolean;
	}) => {
		const { focus, target } = request;
		handledFocus = focus.seq;
		if (request.switching && !(await confirmDiscard(request.dirty))) {
			return;
		}
		setIsScoreEditing(false);
		setIsTextEditing(false);
		setActiveTab(focus.goalNumber);
		document.getElementById(`objective-tab-${focus.goalNumber}`)?.scrollIntoView?.({
			block: "start",
			behavior: "smooth",
		});
		// 書いたタブは次の flush まで読めないので、開く目標を渡して下書きを作る
		if (focus.edit && request.canEdit && target) {
			startTextEditing(target);
			requestAnimationFrame(() =>
				section
					?.querySelector<HTMLElement>(
						focus.edit === "challenge"
							? "[data-field='challenge-goal']"
							: ".period-goals-editor textarea, .period-goals-editor .secondary-action",
					)
					?.focus(),
			);
		}
	};
	// 引き継いだ目標は、シートを読み直してから届く。届いたところで一度だけ開く
	const focusRequest = createMemo(
		() => {
			const focus = props.focus;
			if (!focus || !props.objectives.some((item) => item.goalNumber === focus.goalNumber)) {
				return null;
			}
			return {
				focus,
				target: displayObjectives().find((item) => Number(item.goalNumber) === focus.goalNumber),
				switching: focus.goalNumber !== activeTab(),
				dirty: isDirty(),
				canEdit: props.canEditMilestoneGoal,
			};
		},
		// 同じ要求の処理でタブや編集中の値が変わっても、effect を再実行しない。
		{ equals: (previous, next) => previous?.focus.seq === next?.focus.seq },
	);
	createEffect(focusRequest, (request) => {
		if (request && request.focus.seq !== handledFocus) {
			void openFocused(request);
		}
	});

	const startTextEditing = (objective = activeObjective()) => {
		if (!objective) {
			return;
		}
		setDraftText({
			challengeGoal: objective.challengeGoal,
			achievement: objective.achievement,
			periodGoals: objective.periodGoals.map((goal) => ({ ...goal })),
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
						draftText().periodGoals,
						draftText().achievement,
					)
				: await props.controller.upsertText(
						props.sheetId ?? objective.sheetId,
						objective.goalNumber,
						draftText().challengeGoal,
						draftText().periodGoals,
						draftText().achievement,
					);
		if (success) {
			// シートを読み直してから編集を抜ける(抜けた直後に、保存前の文が一瞬出ないようにする)
			await props.onUpdated();
			setIsTextEditing(false);
			showToast(
				"success",
				`${props.canEditMilestoneGoal ? "目標" : "達成状況"} ${objective.goalNumber} を保存しました`,
			);
		}
		setTextUpdating(false);
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
		if (success) {
			// シートを読み直してから編集を抜ける(抜けた直後に、保存前の点数が一瞬出ないようにする)
			await props.onUpdated();
			setIsScoreEditing(false);
			showToast("success", `目標 ${objective.goalNumber} の評価を保存しました`);
		}
		setScoreUpdating(false);
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
		<section class="challenge-card" ref={section}>
			<div class="challenge-card__title">
				<h2>チャレンジ目標評価</h2>
				<p class="challenge-helper">
					目標は1〜{props.maxObjectives}件。目標ごとに 1〜{MAX_SCORE} の4段階で評価します。
				</p>
			</div>

			<div class="challenge-tabs" role="tablist" aria-label="チャレンジ目標">
				<For each={displayObjectives()} keyed={(item) => item.goalNumber}>
					{(item) => (
						<button
							type="button"
							role="tab"
							id={`objective-tab-${item().goalNumber}`}
							aria-selected={activeTab() === Number(item().goalNumber) ? "true" : "false"}
							class={["challenge-tab", { active: activeTab() === Number(item().goalNumber) }]}
							onClick={() => void selectTab(Number(item().goalNumber))}
						>
							目標 {item().goalNumber}
							<Show when={needsMyScore(item())}>
								<span class="challenge-tab__pending">未評価</span>
							</Show>
						</button>
					)}
				</For>
				<Show when={props.canEditMilestoneGoal}>
					<button
						type="button"
						class="challenge-tab"
						aria-label="目標を追加"
						onClick={addTab}
						disabled={
							displayObjectives().length >= props.maxObjectives || textUpdating() || scoreUpdating()
						}
					>
						<Plus class="action-icon" />
						目標を追加
					</button>
				</Show>
			</div>

			<Show when={activeObjective()} fallback={<p>対象の目標が見つかりません。</p>}>
				<article class="objective-block" role="tabpanel">
					<div class="objective-meta">
						<div class="score-grid">
							<Show
								when={isScoreEditing()}
								fallback={
									<>
										{/* null は伏せられた点数(確定前の本人)。0 の「未評価」とは分けて、何も出さない */}
										<Show when={activeObjective()?.firstScore !== null}>
											<ScoreReadout label="一次評価" value={activeObjective()?.firstScore} />
										</Show>
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
											onChange={(value) =>
												setDraftScore((previous) => ({ ...previous, firstScore: value }))
											}
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
											onChange={(value) =>
												setDraftScore((previous) => ({ ...previous, secondScore: value }))
											}
										/>
									</div>
								</Show>
							</Show>
						</div>

						<div class="objective-meta-actions">
							<Show when={props.canEditMilestoneGoal}>
								<button
									type="button"
									class="secondary-action"
									onClick={deleteTab}
									disabled={displayObjectives().length <= 1 || textUpdating() || scoreUpdating()}
								>
									この目標を削除
								</button>
							</Show>
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
							<Show
								when={
									(props.canEditMilestoneGoal || props.canEditMilestoneAchievement) &&
									!isTextEditing() &&
									!isScoreEditing()
								}
							>
								<button type="button" class="edit-toggle-button" onClick={() => startTextEditing()}>
									<SquarePen class="edit-icon" />
									{props.canEditMilestoneGoal ? "目標を編集" : "達成状況を入力"}
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
									<div class="objective-field__head">
										<span class="objective-field__label">チャレンジ目標</span>
										<Show when={activeContinuity()}>
											{(continuity) => <ContinuityMark continuity={continuity()} />}
										</Show>
									</div>
									<p class={{ empty: !activeObjective()?.challengeGoal }}>
										{activeObjective()?.challengeGoal || "未入力"}
									</p>
								</div>
								<div class="objective-field">
									<span class="objective-field__label">期中目標(今期の計画)</span>
									<PeriodGoalsList
										goals={activeObjective()?.periodGoals ?? []}
										// 下書きの間は達成状況を書かないので、空欄を「未入力」と見せない
										achievement={
											props.canEditMilestoneGoal ? undefined : activeObjective()?.achievement
										}
									/>
								</div>
							</div>
						}
					>
						<div class="objective-fields editing">
							<Show
								when={props.canEditMilestoneGoal}
								fallback={
									<div class="objective-field">
										<span class="objective-field__label">チャレンジ目標</span>
										<p>{draftText().challengeGoal}</p>
									</div>
								}
							>
								<label>
									<span class="objective-field__head">
										チャレンジ目標
										<Show when={draftContinuity()}>
											{(continuity) => <ContinuityMark continuity={continuity()} />}
										</Show>
									</span>
									<textarea
										data-field="challenge-goal"
										value={draftText().challengeGoal}
										onInput={(e) => patchDraftText({ challengeGoal: e.currentTarget.value })}
									/>
								</label>
								{/* 前期の文言は、見たいときに開く。書いている目標の横に並べて比べさせない */}
								<Show when={draftContinuity()}>
									{(continuity) => (
										<details class="continuity-note">
											<summary>{continuity().periodName}の文言を見る</summary>
											<p class="continuity-note__text">{continuity().previous.challengeGoal}</p>
											<Show when={continuity().kind === "revised"}>
												<button
													type="button"
													class="link-button"
													onClick={() =>
														setDraftText((previous) => ({
															...previous,
															challengeGoal: continuity().previous.challengeGoal,
														}))
													}
												>
													前期の文言に戻す
												</button>
											</Show>
										</details>
									)}
								</Show>
							</Show>
							<PeriodGoalsEditor
								goals={draftText().periodGoals}
								achievement={draftText().achievement}
								canEditGoals={props.canEditMilestoneGoal}
								canEditAchievements={props.canEditMilestoneAchievement === true}
								disabled={textUpdating()}
								onChange={(next) => setDraftText((previous) => ({ ...previous, ...next }))}
							/>
							<div class="edit-actions">
								<button
									type="button"
									class="primary-action"
									onClick={applyTextUpdate}
									disabled={textUpdating() || !textChanged()}
								>
									<Check class="action-icon" />
									{textUpdating()
										? "保存中..."
										: props.canEditMilestoneGoal
											? "目標を保存"
											: "達成状況を保存"}
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
