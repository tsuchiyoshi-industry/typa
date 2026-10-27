import ArrowRight from "lucide-solid/icons/arrow-right";
import PencilLine from "lucide-solid/icons/pencil-line";
import Pin from "lucide-solid/icons/pin";
import { type Component, For, Show } from "solid-js";
import type { MilestoneDto } from "../../../application/dtos/MilestoneDto";
import type { PreviousGoals } from "../../../domain/repositories/MilestoneRepository";
import { continuityOf } from "../../../domain/valueObjects/GoalContinuity";
import { PeriodGoalsList } from "./PeriodGoals";

/** keep: 前期の文言のまま据え置く / revise: 引き継いでから、今期に合わせて書き直す */
export type CarryMode = "keep" | "revise";

interface PreviousGoalsViewProps {
	previous: PreviousGoals;
	/** 今期の目標。引き継いだ目標が据え置きか更新かを、今の文言で見分ける。 */
	objectives: readonly MilestoneDto[];
	/** 本人が下書きを書いている間だけ、引き継げる。 */
	canCarry: boolean;
	/** 今期の目標に空きがあるか(上限に達していれば引き継げない)。 */
	hasRoom: boolean;
	/** 引き継いでいる最中の前期の目標。 */
	carrying: number | null;
	onCarry: (previousGoalId: number, mode: CarryMode) => void;
	onOpen: (goalNumber: number) => void;
}

/**
 * 前期のチャレンジ目標。「前期に何を書いたか」を見返す場所で、引き継ぐかどうかは本人の自由。
 * 続けたい目標があれば、据え置くか、見直して更新するかで引き継げる。引き継いでいない目標には何も添えない。
 * 期中目標はその期の計画なので引き継がず、前期の記録として読むだけ。
 */
const PreviousGoalsView: Component<PreviousGoalsViewProps> = (props) => {
	const stateOf = (goalNumber: number) => {
		const objective = props.objectives.find((item) => item.goalNumber === goalNumber);
		return objective && continuityOf(goalNumber, objective.challengeGoal, props.previous);
	};
	return (
		<section class="challenge-card previous-goals">
			<div class="challenge-card__title">
				<h2>{props.previous.periodName}のチャレンジ目標</h2>
				<p class="challenge-helper">
					{props.canCarry
						? "前期に書いた目標です。続けたいものがあれば、今期に引き継げます。"
						: "前期に書いた目標です。"}
				</p>
			</div>
			<Show when={props.canCarry && !props.hasRoom}>
				<p class="previous-goals__lead">
					今期の目標が上限まで埋まっているため、いまは引き継げません。
				</p>
			</Show>
			<ol class="previous-goals__list">
				<For each={props.previous.goals}>
					{(goal) => {
						const state = () => (goal.carriedInto === null ? null : stateOf(goal.carriedInto));
						return (
							<li class="previous-goal">
								<span class="previous-goals__number">{goal.goalNumber}</span>
								<div class="previous-goal__body">
									<p class="previous-goals__text">{goal.challengeGoal || "(チャレンジ目標なし)"}</p>
									<details class="previous-goal__record">
										<summary class="previous-goal__record-toggle">前期の期中目標と達成状況</summary>
										<PeriodGoalsList goals={goal.periodGoals} achievement={goal.achievement} />
									</details>
								</div>
								<div class="previous-goal__choice">
									<Show
										when={goal.carriedInto}
										fallback={
											<Show when={props.canCarry}>
												<fieldset class="continuity-choice">
													<legend class="visually-hidden">
														前期の目標 {goal.goalNumber} を引き継ぐ
													</legend>
													<button
														type="button"
														disabled={
															props.carrying !== null || !props.hasRoom || !goal.challengeGoal
														}
														onClick={() => props.onCarry(goal.id, "keep")}
													>
														<Pin class="action-icon" />
														{props.carrying === goal.id ? "引き継ぎ中..." : "据え置く"}
													</button>
													<button
														type="button"
														disabled={
															props.carrying !== null || !props.hasRoom || !goal.challengeGoal
														}
														onClick={() => props.onCarry(goal.id, "revise")}
													>
														<PencilLine class="action-icon" />
														見直して更新
													</button>
												</fieldset>
											</Show>
										}
									>
										{(goalNumber) => (
											<>
												<span
													class="continuity-badge"
													classList={{ revised: state()?.kind === "revised" }}
												>
													<Show
														when={state()?.kind === "revised"}
														fallback={<Pin class="action-icon" />}
													>
														<PencilLine class="action-icon" />
													</Show>
													{state()?.kind === "revised"
														? `目標 ${goalNumber()} で更新`
														: `目標 ${goalNumber()} に据え置き`}
												</span>
												<button
													type="button"
													class="link-button"
													onClick={() => props.onOpen(goalNumber())}
												>
													目標 {goalNumber()} を開く
													<ArrowRight class="action-icon" />
												</button>
											</>
										)}
									</Show>
								</div>
							</li>
						);
					}}
				</For>
			</ol>
		</section>
	);
};

export default PreviousGoalsView;
