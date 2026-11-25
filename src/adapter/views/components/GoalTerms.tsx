import { type Component, createEffect, createMemo, createSignal, Show } from "solid-js";
import type { EmployeeDto } from "../../../application/dtos/EmployeeDto";
import type { EvaluationSheetDto } from "../../../application/dtos/EvaluationSheetDto";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import type { ChallengeEvaluationViewModel } from "../../presenters/ChallengeEvaluationPresenter";
import type { SheetEditorViewModel } from "../../presenters/SheetEditorPresenter";
import { ensureNothingUnsaved, showToast } from "../feedback";
import type { ConnectSaving } from "../savingSource";
import ChallengeEvaluationView, { type GoalFocus } from "./ChallengeEvaluationView";
import PreviousGoalsView, { type CarryMode } from "./PreviousGoalsView";

export type GoalTerm = "current" | "previous";
type PreviousGoals = Awaited<ReturnType<ChallengeEvaluationController["loadPreviousGoals"]>>;

interface GoalTermsProps {
	sheet: EvaluationSheetDto;
	subject: EmployeeDto;
	viewModel: SheetEditorViewModel;
	/** 表示している期。初めは当期。 */
	term: GoalTerm;
	onTermChange: (term: GoalTerm) => void;
	controller: ChallengeEvaluationController;
	challengeViewModel: () => ChallengeEvaluationViewModel;
	/** 保存後にシートを読み直す。 */
	onUpdated: () => unknown;
	/** 「保存中か」を親に渡す口(描き終えたときに一度だけ accessor を渡す)。 */
	connectSaving?: ConnectSaving;
}

/**
 * チャレンジ目標を、当期と前期のタブで分けて見せる。書くのは当期。前期は「何を書いたか」を見に行く場所で、
 * 当期の画面には前期の文言を並べない。前期の目標がなければタブは出さない。
 * 当期の入力を消さないよう、タブを切り替えても当期の画面は隠すだけで残す。
 */
const GoalTerms: Component<GoalTermsProps> = (props) => {
	// 今期の目標が増減するたびに読み直す(引き継いだ目標を消すと、また選べる)。
	// 前期は後から出てよい補助なので、読む間も今期の目標は待たせない(届いたら差し込み、古い結果は捨てる)
	const [previousGoals, setPreviousGoals] = createSignal<PreviousGoals>();
	const revision = createMemo(
		() =>
			`${props.sheet.sheetId}/${props.sheet.objectives.map((goal) => `${goal.id}:${goal.goalNumber}`).join(",")}`,
	);
	createEffect(
		() => {
			revision();
			return props.sheet.sheetId;
		},
		(sheetId) => {
			let current = true;
			props.controller
				.loadPreviousGoals(sheetId)
				.then((loaded) => current && setPreviousGoals(loaded))
				.catch((error: unknown) => console.error("Error loading the previous goals:", error));
			return () => {
				current = false;
			};
		},
	);
	const previous = () => (previousGoals()?.goals.length ? previousGoals() : null);
	const showing = (term: GoalTerm) => (previous() ? props.term === term : term === "current");

	const [focus, setFocus] = createSignal<GoalFocus | null>(null);
	/** 当期の目標を開く。前期のタブから来たときは、当期に戻す。 */
	const open = (next: Omit<GoalFocus, "seq">) => {
		setFocus({ ...next, seq: Date.now() });
		props.onTermChange("current");
	};

	const [carrying, setCarrying] = createSignal<number | null>(null);
	/** 今期の目標に、引き継ぐ空きがあるか。何も書いていない目標は、引き継ぎで埋まる。 */
	const hasRoom = () =>
		props.sheet.objectives.length < props.sheet.maxObjectives ||
		props.sheet.objectives.some(
			(goal) => !goal.challengeGoal.trim() && goal.periodGoals.length === 0 && !goal.achievement,
		);
	const carryOver = async (previousGoalId: number, mode: CarryMode) => {
		if (carrying() !== null || !ensureNothingUnsaved()) {
			return;
		}
		setCarrying(previousGoalId);
		try {
			const result = await props.controller.carryOver(props.sheet.sheetId, previousGoalId);
			if ("error" in result) {
				showToast("error", "前期の目標を引き継げませんでした", result.error);
				return;
			}
			await props.onUpdated();
			open({ goalNumber: result.goalNumber, edit: mode === "revise" ? "challenge" : "plan" });
			showToast(
				"success",
				mode === "keep"
					? `前期の目標を、目標 ${result.goalNumber} に据え置きました`
					: `前期の目標を、目標 ${result.goalNumber} に引き継ぎました`,
				mode === "keep"
					? "今期の期中目標(この期の計画)を書きましょう。"
					: "今期に合わせて、チャレンジ目標を書き直せます。",
			);
		} finally {
			setCarrying(null);
		}
	};

	const Tab: Component<{ term: GoalTerm; label: string; note?: string }> = (tab) => (
		<button
			type="button"
			role="tab"
			id={`goal-term-${tab.term}`}
			aria-controls={`goal-term-panel-${tab.term}`}
			aria-selected={props.term === tab.term ? "true" : "false"}
			class="term-tab"
			onClick={() => props.onTermChange(tab.term)}
		>
			{tab.label}
			<Show when={tab.note}>
				<span class="term-tab__note">{tab.note}</span>
			</Show>
		</button>
	);

	return (
		<div class="goal-terms">
			<Show when={previous()}>
				{(prev) => (
					<div class="term-tabs" role="tablist" aria-label="表示する期">
						<Tab term="current" label="当期" />
						<Tab term="previous" label="前期" note={prev().periodName} />
					</div>
				)}
			</Show>
			<div
				id="goal-term-panel-current"
				role={previous() ? "tabpanel" : undefined}
				hidden={!showing("current")}
			>
				<ChallengeEvaluationView
					sheetId={props.sheet.sheetId}
					objectives={props.sheet.objectives}
					maxObjectives={props.sheet.maxObjectives}
					subject={props.subject}
					canEditFirst={props.viewModel.canEditFirst}
					canEditSecond={props.viewModel.canEditSecond}
					canEditMilestoneGoal={props.viewModel.canEditMilestoneGoal}
					canEditMilestoneAchievement={props.viewModel.canEditMilestoneAchievement}
					previousGoals={previousGoals()}
					focus={focus()}
					canViewSecondEvaluation={props.viewModel.canViewSecondEvaluation}
					controller={props.controller}
					viewModel={props.challengeViewModel}
					onUpdated={props.onUpdated}
					connectSaving={props.connectSaving}
				/>
			</div>
			<Show when={previous()}>
				{(prev) => (
					<div
						id="goal-term-panel-previous"
						role="tabpanel"
						aria-labelledby="goal-term-previous"
						hidden={!showing("previous")}
					>
						<PreviousGoalsView
							previous={prev()}
							objectives={props.sheet.objectives}
							canCarry={props.viewModel.canCarryOverGoal}
							hasRoom={hasRoom()}
							carrying={carrying()}
							onCarry={(goalId, mode) => void carryOver(goalId, mode)}
							onOpen={(goalNumber) => open({ goalNumber, edit: null })}
						/>
					</div>
				)}
			</Show>
		</div>
	);
};

export default GoalTerms;
