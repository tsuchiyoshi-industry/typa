import { type Component, For, Index, Show } from "solid-js";
import {
	addPeriodGoal,
	MAX_PERIOD_GOALS,
	type PeriodGoal,
} from "../../../domain/valueObjects/PeriodGoal";

export const PeriodGoalsList: Component<{ goals: readonly PeriodGoal[]; achievement?: string }> = (
	props,
) => (
	<Show
		when={props.goals.length > 0}
		fallback={
			<>
				<p class="empty">期中目標なし</p>
				<Show when={props.achievement !== undefined}>
					<p class="period-goals__achievement">
						<span class="period-goals__label">達成状況</span>
						{props.achievement || "未入力"}
					</p>
				</Show>
			</>
		}
	>
		<ol class="period-goals" aria-label="期中目標">
			<For each={props.goals}>
				{(goal, index) => (
					<li>
						<span class="period-goals__number" aria-hidden="true">
							{index() + 1}
						</span>
						<div>
							<p classList={{ empty: !goal.description }}>{goal.description || "未入力"}</p>
							<Show when={goal.achievement}>
								<p class="period-goals__achievement">
									<span class="period-goals__label">達成状況</span>
									{goal.achievement}
								</p>
							</Show>
						</div>
					</li>
				)}
			</For>
		</ol>
	</Show>
);

/**
 * 期中目標と達成状況の記入欄。期中目標が無いときだけ、チャレンジ目標の達成状況の欄を出す。
 * 最初の期中目標を足すと、それまでの達成状況はそのタスクへ移る(Milestone の決まり)。
 */
export const PeriodGoalsEditor: Component<{
	goals: readonly PeriodGoal[];
	/** チャレンジ目標の達成状況。 */
	achievement: string;
	onChange: (next: { periodGoals: PeriodGoal[]; achievement: string }) => void;
	disabled?: boolean;
	/** false なら目標の文言は固定し、達成状況だけを書ける(目標確定後)。 */
	canEditGoals?: boolean;
	/**
	 * false なら達成状況の欄を出さない(目標が確定するまでは書けない)。以前に書かれた達成状況は、そのまま送り返す。
	 */
	canEditAchievements?: boolean;
	/** チャレンジ目標の達成状況の欄の見た目(遡及処理で、直した欄を示すなど)。 */
	achievementClassList?: Record<string, boolean>;
}> = (props) => {
	const editsGoals = () => props.canEditGoals !== false;
	const editsAchievements = () => props.canEditAchievements !== false;
	const change = (periodGoals: PeriodGoal[]) =>
		props.onChange({ periodGoals, achievement: props.achievement });
	const update = (index: number, field: keyof PeriodGoal, value: string) =>
		change(props.goals.map((goal, i) => (i === index ? { ...goal, [field]: value } : goal)));
	return (
		<>
			{/* チャレンジ目標の下にぶら下がる計画。1件ずつ、目標とその達成状況を一枚の札にまとめる */}
			<fieldset class="period-goals-editor" disabled={props.disabled}>
				<legend>
					期中目標
					<span class="period-goals-editor__count">
						{props.goals.length} / {MAX_PERIOD_GOALS} 件
					</span>
				</legend>
				<p class="field-hint">
					{!editsAchievements()
						? "チャレンジ目標に向けて、この期に取り組むこと(期ごとに書き直します)。達成状況は、一次評価者が目標を確定してから書きます。"
						: editsGoals()
							? "チャレンジ目標に向けて、この期に取り組むこと(期ごとに書き直します)。0件のときは、チャレンジ目標に達成状況を書きます。"
							: "期中目標は目標の送信後は変えられません(要修正で戻ると直せます)。達成状況は、一次評価を依頼するまで書き直せます。"}
				</p>
				<Show when={props.goals.length > 0}>
					<ol class="period-goal-cards">
						<Index each={props.goals}>
							{(goal, index) => (
								<li>
									<fieldset class="period-goal-card">
										<legend class="visually-hidden">期中目標 {index + 1}</legend>
										<span class="period-goal-card__number" aria-hidden="true">
											{index + 1}
										</span>
										<div class="period-goal-card__goal">
											<Show
												when={editsGoals()}
												fallback={
													<>
														<span class="period-goal-card__label">期中目標</span>
														<p
															class="period-goal-card__text"
															classList={{ empty: !goal().description }}
														>
															{goal().description || "未入力"}
														</p>
													</>
												}
											>
												<label class="period-goal-field">
													<span class="period-goal-card__label">
														期中目標<span class="visually-hidden"> {index + 1}</span>
													</span>
													<textarea
														value={goal().description}
														onInput={(e) => update(index, "description", e.currentTarget.value)}
													/>
												</label>
											</Show>
										</div>
										<Show when={editsAchievements()}>
											<label class="period-goal-field period-goal-card__achievement">
												<span class="period-goal-card__label">
													達成状況<span class="visually-hidden"> {index + 1}</span>
												</span>
												<textarea
													value={goal().achievement}
													onInput={(e) => update(index, "achievement", e.currentTarget.value)}
												/>
											</label>
										</Show>
										<Show when={editsGoals()}>
											<button
												type="button"
												class="link-button period-goal-card__remove"
												aria-label={`期中目標 ${index + 1} を削除`}
												onClick={() => change(props.goals.filter((_, i) => i !== index))}
											>
												削除
											</button>
										</Show>
									</fieldset>
								</li>
							)}
						</Index>
					</ol>
				</Show>
				<Show when={editsGoals()}>
					<button
						type="button"
						class="secondary-action period-goals-editor__add"
						disabled={props.goals.length >= MAX_PERIOD_GOALS}
						onClick={() => {
							// 上限ではボタンを押せないので、失敗するのは画面の状態が古いときだけ。そのときは何もしない
							const next = addPeriodGoal(props.goals, props.achievement);
							if (next.ok) {
								props.onChange(next.value);
							}
						}}
					>
						期中目標を追加
					</button>
				</Show>
			</fieldset>
			<Show when={props.goals.length === 0 && editsAchievements()}>
				<label classList={props.achievementClassList}>
					<span>達成状況</span>
					<textarea
						value={props.achievement}
						disabled={props.disabled}
						onInput={(e) =>
							props.onChange({ periodGoals: [...props.goals], achievement: e.currentTarget.value })
						}
					/>
				</label>
			</Show>
		</>
	);
};
