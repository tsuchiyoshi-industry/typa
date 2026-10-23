import { type Component, createResource, createSignal, For, Show } from "solid-js";
import type { ChallengeEvaluationController } from "../../controllers/ChallengeEvaluationController";
import { showToast } from "../feedback";

interface PreviousGoalsViewProps {
	sheetId: number;
	/** この評価期間の目標が変わるたびに変える(引き継いだ目標を消すと「済み」に戻るので、読み直す)。 */
	revision: string;
	/** 本人が下書きを書いている間だけ、引き継げる。 */
	canCarry: boolean;
	controller: Pick<ChallengeEvaluationController, "loadPreviousGoals" | "carryOver">;
	/** 引き継いだあと、この評価期間のシートを読み直す。 */
	onCarried: () => unknown;
}

/**
 * 前の評価期間(下期に対する上期、上期に対する前期の下期など)の目標。続ける目標はこの評価期間の下書きに引き継ぎ、
 * 引き継がなかった目標は「済み」として扱う。前の評価期間にシートが無ければ何も出さない。
 */
const PreviousGoalsView: Component<PreviousGoalsViewProps> = (props) => {
	const [previous, { refetch }] = createResource(
		() => ({ sheetId: props.sheetId, revision: props.revision }),
		({ sheetId }) => props.controller.loadPreviousGoals(sheetId),
	);
	const [carrying, setCarrying] = createSignal<number | null>(null);

	const carry = async (goalId: number) => {
		setCarrying(goalId);
		try {
			const error = await props.controller.carryOver(props.sheetId, goalId);
			if (error) {
				showToast("error", "目標を引き継げませんでした", error);
				return;
			}
			showToast(
				"success",
				"この評価期間の目標に加えました。",
				"中間目標と達成状況は、この評価期間の分を書いてください。",
			);
			await props.onCarried();
			await refetch();
		} finally {
			setCarrying(null);
		}
	};

	return (
		<Show when={previous()?.goals.length ? previous() : null}>
			{(loaded) => {
				const carried = () => loaded().goals.filter((goal) => goal.carried).length;
				return (
					<details class="challenge-card previous-goals" open={props.canCarry}>
						<summary class="challenge-card__title">
							<h2>前の評価期間の目標</h2>
							<p class="challenge-helper">
								{loaded().periodName}・{loaded().goals.length}件(継続 {carried()}件)
							</p>
						</summary>
						<p class="previous-goals__lead">
							{props.canCarry
								? "この評価期間も続ける目標は「続ける」で、この評価期間の目標に加えます。続けない目標は「済み」として扱います。"
								: "この評価期間に続けた目標と、済みにした目標です。"}
						</p>
						<ol class="previous-goals__list">
							<For each={loaded().goals}>
								{(goal) => (
									<li>
										<span class="previous-goals__number">{goal.goalNumber}</span>
										<div class="previous-goals__body">
											<p class="previous-goals__text">
												{goal.challengeGoal || "(チャレンジ目標なし)"}
											</p>
											<Show when={goal.achievement}>
												<p class="previous-goals__text previous-goals__achievement">
													<span class="previous-goals__label">達成状況</span>
													{goal.achievement}
												</p>
											</Show>
										</div>
										<div class="previous-goals__state">
											<Show
												when={goal.carried}
												fallback={
													<>
														<span class="previous-goals__done">済み</span>
														<Show when={props.canCarry}>
															<button
																type="button"
																class="secondary-action"
																disabled={carrying() !== null}
																onClick={() => void carry(goal.id)}
															>
																{carrying() === goal.id ? "追加中..." : "続ける"}
															</button>
														</Show>
													</>
												}
											>
												<span class="period-badge">継続中</span>
											</Show>
										</div>
									</li>
								)}
							</For>
						</ol>
					</details>
				);
			}}
		</Show>
	);
};

export default PreviousGoalsView;
