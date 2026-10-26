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
		<ul class="period-goals" aria-label="期中目標">
			<For each={props.goals}>
				{(goal) => (
					<li>
						<p classList={{ empty: !goal.description }}>{goal.description || "未入力"}</p>
						<Show when={goal.achievement}>
							<p class="period-goals__achievement">
								<span class="period-goals__label">達成状況</span>
								{goal.achievement}
							</p>
						</Show>
					</li>
				)}
			</For>
		</ul>
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
	/** チャレンジ目標の達成状況の欄の見た目(遡及処理で、直した欄を示すなど)。 */
	achievementClassList?: Record<string, boolean>;
}> = (props) => {
	const editsGoals = () => props.canEditGoals !== false;
	const change = (periodGoals: PeriodGoal[]) =>
		props.onChange({ periodGoals, achievement: props.achievement });
	const update = (index: number, field: keyof PeriodGoal, value: string) =>
		change(props.goals.map((goal, i) => (i === index ? { ...goal, [field]: value } : goal)));
	return (
		<>
			<fieldset class="period-goals-editor" disabled={props.disabled}>
				<legend>期中目標</legend>
				<p class="field-hint">
					{editsGoals()
						? `今期の計画です。チャレンジ目標に向けて、この期に取り組むことを0〜${MAX_PERIOD_GOALS}件書きます(期ごとに書き直します)。0件のときは、チャレンジ目標に達成状況を書きます。`
						: "期中目標は目標の送信後は変えられません(要修正で戻ると直せます)。達成状況は、一次評価を依頼するまで書き直せます。"}
				</p>
				<ul class="period-goals period-goals--editing">
					<Index each={props.goals}>
						{(goal, index) => (
							<li>
								<Show when={editsGoals()} fallback={<p>{goal().description || "未入力"}</p>}>
									<label class="period-goal-field">
										<span>期中目標 {index + 1}</span>
										<textarea
											value={goal().description}
											onInput={(e) => update(index, "description", e.currentTarget.value)}
										/>
									</label>
								</Show>
								<label class="period-goal-field">
									<span>達成状況 {index + 1}</span>
									<textarea
										value={goal().achievement}
										onInput={(e) => update(index, "achievement", e.currentTarget.value)}
									/>
								</label>
								<Show when={editsGoals()}>
									<button
										type="button"
										class="secondary-action"
										aria-label={`期中目標 ${index + 1} を削除`}
										onClick={() => change(props.goals.filter((_, i) => i !== index))}
									>
										削除
									</button>
								</Show>
							</li>
						)}
					</Index>
				</ul>
				<Show when={editsGoals()}>
					<button
						type="button"
						class="secondary-action"
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
			<Show when={props.goals.length === 0}>
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
