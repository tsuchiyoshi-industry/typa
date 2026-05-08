import { CalendarDays, Check, FileText, LogOut, SquarePen, User, Users, X } from "lucide-solid";
import { type Component, createEffect, createResource, createSignal, For, Show } from "solid-js";
import { supabase } from "../../utils/supabase";
import { fetchDistinctEvaluationPeriods } from "./helpers/evaluationPeriods";
import { fetchEvaluationSheet, type Milestone } from "./helpers/evaluationSheet";
import { updateMilestone } from "./helpers/updateMilestone";
import "../styles/dashboard.css";

const Dashboard: Component = () => {
	const [periodOptions] = createResource(fetchDistinctEvaluationPeriods);
	const [selectedPeriodId, setSelectedPeriodId] = createSignal<number | null>(null);
	const [sheet, { refetch }] = createResource(selectedPeriodId, fetchEvaluationSheet);
	const [editingId, setEditingId] = createSignal<number | null>(null);
	const [draftObjective, setDraftObjective] = createSignal({
		challenge_goal: "",
		midterm_goal: "",
		achievement: "",
	});
	const [updateLoading, setUpdateLoading] = createSignal(false);
	const [updateError, setUpdateError] = createSignal<string | null>(null);

	const startEditing = (objective: Milestone) => {
		setEditingId(objective.id);
		setDraftObjective({
			challenge_goal: objective.challenge_goal,
			midterm_goal: objective.midterm_goal,
			achievement: objective.achievement,
		});
		setUpdateError(null);
	};

	const cancelEditing = () => {
		setEditingId(null);
		setUpdateError(null);
	};

	const applyUpdate = async () => {
		const id = editingId();
		if (!id) {
			return;
		}
		setUpdateLoading(true);
		setUpdateError(null);

		try {
			await updateMilestone(id, {
				challenge_goal: draftObjective().challenge_goal,
				midterm_goal: draftObjective().midterm_goal,
				achievement: draftObjective().achievement,
			});
			await refetch();
			setEditingId(null);
		} catch (error) {
			setUpdateError(error instanceof Error ? error.message : "更新に失敗しました");
		} finally {
			setUpdateLoading(false);
		}
	};

	createEffect(() => {
		const periods = periodOptions();
		if (periods && periods.length > 0 && selectedPeriodId() === null) {
			setSelectedPeriodId(periods[0].id);
		}
	});

	const handleLogout = async () => {
		await supabase.auth.signOut();
	};

	return (
		<div class="dashboard-page">
			<header class="dashboard-header">
				<h1>
					<FileText class="header-icon" />
					評価シート
				</h1>
				<button type="button" class="logout-button" onClick={handleLogout}>
					<LogOut class="button-icon" />
					ログアウト
				</button>
			</header>

			<div class="period-picker">
				<label for="period-select">
					<CalendarDays class="select-icon" />
					評価対象期間
				</label>
				<select
					id="period-select"
					value={selectedPeriodId() ?? ""}
					onChange={(e) => setSelectedPeriodId(parseInt(e.currentTarget.value, 10))}
				>
					<option value="" disabled>
						期間を選択してください
					</option>
					<For each={periodOptions() ?? []}>
						{(period) => <option value={period.id}>{period.period_name}</option>}
					</For>
				</select>
			</div>

			<Show when={!sheet.loading} fallback={<p>シート情報を読み込み中です...</p>}>
				<Show when={sheet()?.subject} fallback={<p>データを取得できませんでした。</p>}>
					<div class="sheet-grid">
						<article class="sheet-card">
							<h2 class="profile-card-heading">
								<User />
								被評価者プロファイル
							</h2>
							<dl class="profile-list">
								<div class="profile-item">
									<dt>キャリアコース区分</dt>
									<dd>{sheet()?.subject?.career_course ?? "未設定"}</dd>
								</div>
								<div class="profile-item">
									<dt>等級</dt>
									<dd>{sheet()?.subject?.grade ?? "未設定"}</dd>
								</div>
								<div class="profile-item">
									<dt>評価対象期間</dt>
									<dd>{sheet()?.evaluationPeriod?.period_name ?? "未設定"}</dd>
								</div>
								<div class="profile-item">
									<dt>社員番号</dt>
									<dd>{sheet()?.subject?.employee_no ?? "――"}</dd>
								</div>
								<div class="profile-item">
									<dt>氏名</dt>
									<dd>{sheet()?.subject?.name ?? "――"}</dd>
								</div>
							</dl>
						</article>

						<article class="sheet-card">
							<h2 class="profile-card-heading">
								<Users />
								評価者プロファイル
							</h2>
							<dl class="profile-list">
								<div class="profile-item">
									<dt>一次評価者</dt>
									<dd>{sheet()?.primaryEvaluator}</dd>
								</div>
								<div class="profile-item">
									<dt>二次評価者</dt>
									<dd>{sheet()?.secondaryEvaluator}</dd>
								</div>
							</dl>
						</article>
					</div>

					<section class="challenge-card">
						<div class="challenge-card__title">
							<h2>チャレンジ目標評価</h2>
							<p class="challenge-helper">1〜4 の整数で入力します。</p>
						</div>

						<For each={sheet()?.objectives ?? []}>
							{(objective) => (
								<article class="objective-block">
									<div class="objective-meta">
										<strong>目標 {objective.goal_number}</strong>
										<div class="objective-meta-actions">
											<div class="score-grid">
												<div class="score-pill">
													<span class="score-label">一次評価</span>
													<span class="score-value">{objective.first_score || "—"}</span>
												</div>
												<div class="score-pill">
													<span class="score-label">二次評価</span>
													<span class="score-value">{objective.second_score || "—"}</span>
												</div>
											</div>
											<Show when={objective.is_editable && editingId() !== objective.id}>
												<button
													type="button"
													class="edit-toggle-button"
													onClick={() => startEditing(objective)}
												>
													<SquarePen class="edit-icon" />
													編集
												</button>
											</Show>
											<Show when={editingId() === objective.id}>
												<span class="editing-label">編集中</span>
											</Show>
										</div>
									</div>

									{editingId() === objective.id ? (
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
									) : (
										<div class="objective-fields">
											<div class="objective-field">
												<span class="objective-field__label">チャレンジ目標</span>
												<p class="objective-field__text">{objective.challenge_goal}</p>
											</div>
											<div class="objective-field">
												<span class="objective-field__label">期中目標</span>
												<p class="objective-field__text">{objective.midterm_goal}</p>
											</div>
											<div class="objective-field">
												<span class="objective-field__label">期中取り組んだ実績内容</span>
												<p class="objective-field__text">{objective.achievement}</p>
											</div>
										</div>
									)}
								</article>
							)}
						</For>
					</section>

					<article class="todo-card">
						<h2>共通評価</h2>
						<p>
							共通評価欄は今後追加されます。ここには総合評価やコメント欄などを配置する予定です。
						</p>
					</article>
				</Show>
			</Show>
		</div>
	);
};

export default Dashboard;
