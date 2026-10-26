import Check from "lucide-solid/icons/check";
import PencilLine from "lucide-solid/icons/pencil-line";
import Pin from "lucide-solid/icons/pin";
import Plus from "lucide-solid/icons/plus";
import SquarePen from "lucide-solid/icons/square-pen";
import X from "lucide-solid/icons/x";
import { type Component, createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { EmployeeDto } from "../../../application/dtos/EmployeeDto";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { PreviousGoals } from "../../../domain/repositories/MilestoneRepository";
import { continuityOf, type GoalContinuity } from "../../../domain/valueObjects/GoalContinuity";
import { emptyPeriodGoals, type PeriodGoal } from "../../../domain/valueObjects/PeriodGoal";
import { Score } from "../../../domain/valueObjects/Score";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import type { ChallengeEvaluationViewModel } from "../../presenters/ChallengeEvaluationPresenter";
import { confirmAction, confirmDiscard, showToast, trackUnsaved } from "../feedback";
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
	onSavingChange?: (saving: boolean) => void;
	/** 前期の目標。今期の目標が前期から据え置き・更新したものかを示す。 */
	previousGoals?: PreviousGoals | null;
	focus?: GoalFocus | null;
}

/** 前期とのつながりの印。据え置きはピン、更新はペン。 */
const ContinuityMark: Component<{ continuity: GoalContinuity }> = (markProps) => (
	<span class="continuity-badge" classList={{ revised: markProps.continuity.kind === "revised" }}>
		<Show when={markProps.continuity.kind === "revised"} fallback={<Pin class="action-icon" />}>
			<PencilLine class="action-icon" />
		</Show>
		{markProps.continuity.kind === "revised" ? "前期から更新" : "前期から据え置き"}
	</span>
);

const MAX_SCORE = Score.MAX;

const ChallengeEvaluationView: Component<ChallengeEvaluationViewProps> = (props) => {
	const [activeTab, setActiveTab] = createSignal<number>(
		Number(props.objectives[0]?.goalNumber ?? 1),
	);
	const [isTextEditing, setIsTextEditing] = createSignal(false);
	const [isScoreEditing, setIsScoreEditing] = createSignal(false);
	const [draftText, setDraftText] = createSignal<{
		challengeGoal: string;
		achievement: string;
		periodGoals: PeriodGoal[];
	}>({
		challengeGoal: "",
		achievement: "",
		periodGoals: [],
	});
	const [draftScore, setDraftScore] = createSignal({ firstScore: 0, secondScore: 0 });
	const [textUpdating, setTextUpdating] = createSignal(false);
	const [scoreUpdating, setScoreUpdating] = createSignal(false);
	createEffect(() => props.onSavingChange?.(textUpdating() || scoreUpdating()));

	const [addedObjectives, setAddedObjectives] = createSignal<MilestoneDto[]>([]);
	const [removedIds, setRemovedIds] = createSignal<number[]>([]);
	createEffect(
		on(
			() => props.sheetId,
			() => {
				setAddedObjectives([]);
				setRemovedIds([]);
				setActiveTab(Number(props.objectives[0]?.goalNumber ?? 1));
				setIsTextEditing(false);
				setIsScoreEditing(false);
			},
		),
	);
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
	const openFocused = async (focus: GoalFocus) => {
		handledFocus = focus.seq;
		if (focus.goalNumber !== activeTab() && !(await confirmDiscard(isDirty()))) {
			return;
		}
		setIsScoreEditing(false);
		setIsTextEditing(false);
		setActiveTab(focus.goalNumber);
		document.getElementById(`objective-tab-${focus.goalNumber}`)?.scrollIntoView?.({
			block: "start",
			behavior: "smooth",
		});
		if (focus.edit && props.canEditMilestoneGoal) {
			startTextEditing();
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
	createEffect(() => {
		const focus = props.focus;
		if (
			focus &&
			focus.seq !== handledFocus &&
			props.objectives.some((item) => item.goalNumber === focus.goalNumber)
		) {
			void openFocused(focus);
		}
	});

	const startTextEditing = () => {
		const objective = activeObjective();
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
				<For each={displayObjectives()}>
					{(item) => (
						<button
							type="button"
							role="tab"
							id={`objective-tab-${item.goalNumber}`}
							aria-selected={activeTab() === Number(item.goalNumber)}
							class="challenge-tab"
							classList={{ active: activeTab() === Number(item.goalNumber) }}
							onClick={() => void selectTab(Number(item.goalNumber))}
						>
							目標 {item.goalNumber}
							<Show when={continuityFor(item)}>
								{(continuity) => (
									<span class="challenge-tab__origin">
										<Show
											when={continuity().kind === "revised"}
											fallback={<Pin class="action-icon" aria-label="前期から据え置き" />}
										>
											<PencilLine class="action-icon" aria-label="前期から更新" />
										</Show>
									</span>
								)}
							</Show>
							<Show when={needsMyScore(item)}>
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
								<button type="button" class="edit-toggle-button" onClick={startTextEditing}>
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
									<p classList={{ empty: !activeObjective()?.challengeGoal }}>
										{activeObjective()?.challengeGoal || "未入力"}
									</p>
									<Show when={activeContinuity()?.kind === "revised" && activeContinuity()}>
										{(continuity) => (
											<p class="continuity-note">
												<span class="continuity-note__period">{continuity().periodName}の文言</span>
												{continuity().previous.challengeGoal}
											</p>
										)}
									</Show>
								</div>
								<div class="objective-field">
									<span class="objective-field__label">期中目標(今期の計画)</span>
									<PeriodGoalsList
										goals={activeObjective()?.periodGoals ?? []}
										achievement={activeObjective()?.achievement}
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
										onInput={(e) =>
											setDraftText({ ...draftText(), challengeGoal: e.currentTarget.value })
										}
									/>
								</label>
								<Show when={draftContinuity()}>
									{(continuity) => (
										<p class="continuity-note">
											<span class="continuity-note__period">{continuity().periodName}の文言</span>
											{continuity().previous.challengeGoal}
											<Show
												when={continuity().kind === "revised"}
												fallback={<small>書き換えると「前期から更新」になります。</small>}
											>
												<button
													type="button"
													class="link-button"
													onClick={() =>
														setDraftText({
															...draftText(),
															challengeGoal: continuity().previous.challengeGoal,
														})
													}
												>
													前期のまま据え置く
												</button>
											</Show>
										</p>
									)}
								</Show>
							</Show>
							<PeriodGoalsEditor
								goals={draftText().periodGoals}
								achievement={draftText().achievement}
								canEditGoals={props.canEditMilestoneGoal}
								disabled={textUpdating()}
								onChange={(next) => setDraftText({ ...draftText(), ...next })}
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
