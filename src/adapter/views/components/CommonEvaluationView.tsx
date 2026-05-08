import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { CommonEvaluationController } from "../../controllers/CommonEvaluationController";
import type { CommonEvaluationViewModel } from "../../presenters/CommonEvaluationPresenter";

interface CommonEvaluationViewProps {
	sheetId: number | null;
	gradeId: number | null;
	controller: CommonEvaluationController;
	viewModel: () => CommonEvaluationViewModel;
	canEditFirst: boolean;
	canEditSecond: boolean;
	onUpdated: () => void;
}

export default function CommonEvaluationView(props: CommonEvaluationViewProps) {
	const [isEditing, setIsEditing] = createSignal(false);
	const [drafts, setDrafts] = createSignal<
		Record<
			number,
			{
				firstComment: string;
				firstScore: string;
				secondScore: string;
			}
		>
	>({});
	const [submitting, setSubmitting] = createSignal(false);

	createEffect(() => {
		if (props.sheetId != null) {
			props.controller.load(props.sheetId, props.gradeId);
		}
	});

	const beginEdit = () => {
		const summary = props.viewModel().summary;
		if (!summary) {
			return;
		}

		setDrafts(
			summary.results.reduce(
				(acc, result) => {
					acc[result.id] = {
						firstComment: result.firstComment,
						firstScore: String(result.firstScore ?? ""),
						secondScore: String(result.secondScore ?? ""),
					};
					return acc;
				},
				{} as Record<number, { firstComment: string; firstScore: string; secondScore: string }>,
			),
		);
		setIsEditing(true);
	};

	const cancelEdit = () => {
		setIsEditing(false);
		setDrafts({});
	};

	const handleSubmit = async () => {
		if (props.sheetId == null) {
			return;
		}

		setSubmitting(true);
		const summary = props.viewModel().summary;
		if (!summary) {
			setSubmitting(false);
			return;
		}

		const results = summary.results.map((result) => {
			const draft = drafts()[result.id] ?? {
				firstComment: result.firstComment,
				firstScore: String(result.firstScore ?? ""),
				secondScore: String(result.secondScore ?? ""),
			};
			return {
				id: result.id,
				itemId: result.item.id,
				firstComment: draft.firstComment,
				firstScore: Number(draft.firstScore) || 0,
				secondScore: Number(draft.secondScore) || 0,
			};
		});

		const success = await props.controller.upsert(
			props.sheetId,
			results,
			props.canEditFirst,
			props.canEditSecond,
		);

		if (success) {
			props.onUpdated();
			setIsEditing(false);
		}
		setSubmitting(false);
	};

	const summary = createMemo(() => props.viewModel().summary);

	return (
		<article class="common-evaluation-card">
			<div class="common-evaluation-card__header">
				<h2>共通評価</h2>
				<Show when={props.sheetId != null && summary() != null && !isEditing()}>
					<Show when={props.canEditFirst || props.canEditSecond}>
						<button type="button" class="edit-toggle-button" onClick={beginEdit}>
							評価更新
						</button>
					</Show>
				</Show>
			</div>

			<Show
				when={props.sheetId != null}
				fallback={<p>評価シートを作成してから共通評価を確認してください。</p>}
			>
				<Show when={!props.viewModel().loading} fallback={<p>共通評価情報を読み込み中です...</p>}>
					<Show when={props.viewModel().loadError} fallback={null}>
						<p class="error-message">{props.viewModel().loadError}</p>
					</Show>
					<table class="evaluation-table">
						<thead>
							<tr>
								<th>項</th>
								<th>評価項目</th>
								<th>観点</th>
								<th>一次評価者コメント</th>
								<th>配点</th>
								<th>一次評価</th>
								<th>二次評価</th>
							</tr>
						</thead>
						<tbody>
							<For each={summary()?.results ?? []}>
								{(result, index) => (
									<tr>
										<td>{index() + 1}</td>
										<td>{result.item.title}</td>
										<td>{result.item.description}</td>
										<td>
											<Show
												when={isEditing() && props.canEditFirst}
												fallback={<span>{result.firstComment || "—"}</span>}
											>
												<textarea
													value={drafts()[result.id]?.firstComment ?? result.firstComment}
													onInput={(e) =>
														setDrafts((prev) => ({
															...prev,
															[result.id]: {
																...prev[result.id],
																firstComment: e.currentTarget.value,
																firstScore:
																	prev[result.id]?.firstScore ?? String(result.firstScore),
																secondScore:
																	prev[result.id]?.secondScore ?? String(result.secondScore),
															},
														}))
													}
												/>
											</Show>
										</td>
										<td>{result.item.weight}</td>
										<td>
											<Show
												when={isEditing() && props.canEditFirst}
												fallback={<span>{result.firstScore || "—"}</span>}
											>
												<input
													class="score-input"
													type="number"
													min="0"
													value={drafts()[result.id]?.firstScore ?? String(result.firstScore)}
													onInput={(e) =>
														setDrafts((prev) => ({
															...prev,
															[result.id]: {
																...prev[result.id],
																firstComment: prev[result.id]?.firstComment ?? result.firstComment,
																firstScore: e.currentTarget.value,
																secondScore:
																	prev[result.id]?.secondScore ?? String(result.secondScore),
															},
														}))
													}
												/>
											</Show>
										</td>
										<td>
											<Show
												when={isEditing() && props.canEditSecond}
												fallback={<span>{result.secondScore || "—"}</span>}
											>
												<input
													class="score-input"
													type="number"
													min="0"
													value={drafts()[result.id]?.secondScore ?? String(result.secondScore)}
													onInput={(e) =>
														setDrafts((prev) => ({
															...prev,
															[result.id]: {
																...prev[result.id],
																firstComment: prev[result.id]?.firstComment ?? result.firstComment,
																firstScore:
																	prev[result.id]?.firstScore ?? String(result.firstScore),
																secondScore: e.currentTarget.value,
															},
														}))
													}
												/>
											</Show>
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
					<div class="summary-row">
						<p>合計配点: {summary()?.totalWeight ?? 0}</p>
						<p>一次評価合計: {summary()?.totalFirstScore ?? 0}</p>
						<p>二次評価合計: {summary()?.totalSecondScore ?? 0}</p>
					</div>
					<Show when={isEditing()}>
						<div class="edit-actions">
							<button
								type="button"
								class="primary-action"
								onClick={handleSubmit}
								disabled={submitting()}
							>
								{submitting() ? "保存中..." : "更新を保存"}
							</button>
							<button
								type="button"
								class="secondary-action"
								onClick={cancelEdit}
								disabled={submitting()}
							>
								キャンセル
							</button>
						</div>
					</Show>
					<Show when={props.viewModel().updateError}>
						<p class="error-message">{props.viewModel().updateError}</p>
					</Show>
				</Show>
			</Show>
		</article>
	);
}
