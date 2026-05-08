import { SquarePen } from "lucide-solid";
import { type Component, createEffect, createResource, createSignal, For, Show } from "solid-js";
import {
	type CommonEvaluationItem,
	createEvaluationSheet,
	type DraftRow,
	fetchCommonEvaluation,
	fetchCommonEvaluationItems,
	upsertCommonEvaluationResults,
} from "./helpers/commonEvaluation";
import type { Employee } from "./helpers/evaluationSheet";
import { isPrimaryEvaluator, isSecondaryEvaluator } from "./helpers/evaluatorRole";

interface CommonEvaluationProps {
	sheetId: number | null;
	periodId: number;
	employeeId: number;
	subject: Employee;
	onCreated: () => void;
}

const CommonEvaluation: Component<CommonEvaluationProps> = (props) => {
	// シートあり → 既存データを取得、なし → 項目マスタのみ取得
	const [evaluation] = createResource(
		() => props.sheetId ?? undefined,
		(sheetId) => fetchCommonEvaluation(sheetId),
	);
	// sheetId が null のときだけマスタを取得（true を返すことで常に有効なソースにする）
	const [items] = createResource(
		() => props.sheetId == null || undefined,
		(shouldFetch) => (shouldFetch ? fetchCommonEvaluationItems() : Promise.resolve(null)),
	);

	// 新規作成用の入力状態
	const [drafts, setDrafts] = createSignal<DraftRow[]>([]);
	const [draftsInitialized, setDraftsInitialized] = createSignal(false);

	// items が読み込まれたら drafts を初期化
	const initDrafts = (loadedItems: CommonEvaluationItem[]) => {
		if (!draftsInitialized()) {
			setDrafts(
				loadedItems.map((item) => ({
					item,
					first_comment: "",
					first_score: "",
					second_score: "",
				})),
			);
			setDraftsInitialized(true);
		}
	};

	const updateDraft = (index: number, field: keyof Omit<DraftRow, "item">, value: string) => {
		setDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
	};

	const [submitting, setSubmitting] = createSignal(false);
	const [submitError, setSubmitError] = createSignal<string | null>(null);

	const handleSubmit = async () => {
		setSubmitting(true);
		setSubmitError(null);
		try {
			await createEvaluationSheet(props.periodId, props.employeeId, drafts());
			props.onCreated();
		} catch (err) {
			setSubmitError(err instanceof Error ? err.message : "登録に失敗しました");
		} finally {
			setSubmitting(false);
		}
	};

	const isLoading = () => (props.sheetId ? evaluation.loading : items.loading);

	// 評価者権限
	const [canEditFirstScore, setCanEditFirstScore] = createSignal(false);
	const [canEditSecondScore, setCanEditSecondScore] = createSignal(false);

	createEffect(() => {
		isPrimaryEvaluator(props.subject).then(setCanEditFirstScore);
		isSecondaryEvaluator(props.subject).then(setCanEditSecondScore);
	});

	const hasUpdatePermission = () => canEditFirstScore() || canEditSecondScore();
	const [isUpdating, setIsUpdating] = createSignal(false);
	const [updateDrafts, setUpdateDrafts] = createSignal<
		Record<number, { first_comment: string; first_score: string; second_score: string }>
	>({});
	const [updateError, setUpdateError] = createSignal<string | null>(null);
	const [updateLoading, setUpdateLoading] = createSignal(false);
	const startUpdate = () => {
		const currentResults = evaluation()?.results ?? [];
		setUpdateDrafts(
			currentResults.reduce(
				(acc, result) => {
					if (result.id > 0) {
						acc[result.id] = {
							first_comment: result.first_comment,
							first_score: String(result.first_score || ""),
							second_score: String(result.second_score || ""),
						};
					}
					return acc;
				},
				{} as Record<number, { first_comment: string; first_score: string; second_score: string }>,
			),
		);
		setUpdateError(null);
		setIsUpdating(true);
	};

	const cancelUpdate = () => {
		setIsUpdating(false);
		setUpdateDrafts({});
		setUpdateError(null);
	};

	const applyUpdate = async () => {
		setUpdateLoading(true);
		setUpdateError(null);
		try {
			const currentResults = evaluation()?.results ?? [];

			// 全ての結果をUPSERT用のデータに変換
			const resultsToUpsert = currentResults.map((result) => {
				const draft = updateDrafts()[result.id];
				return {
					id: result.id,
					item_id: result.item_id,
					first_comment: draft?.first_comment ?? result.first_comment,
					first_score: draft?.first_score ?? String(result.first_score || ""),
					second_score: draft?.second_score ?? String(result.second_score || ""),
				};
			});

			console.log("Upserting results:", resultsToUpsert);

			if (props.sheetId === null) {
				throw new Error("Sheet ID is required");
			}

			await upsertCommonEvaluationResults(
				props.sheetId,
				resultsToUpsert,
				canEditFirstScore(),
				canEditSecondScore(),
			);

			props.onCreated();
			setIsUpdating(false);
			setUpdateDrafts({});
		} catch (err) {
			console.error("Update error:", err);
			setUpdateError(err instanceof Error ? err.message : "更新に失敗しました");
		} finally {
			setUpdateLoading(false);
		}
	};

	return (
		<article class="common-evaluation-card">
			<div class="common-evaluation-card__header">
				<h2>共通評価</h2>
				<Show when={props.sheetId != null && !isLoading()}>
					<Show when={hasUpdatePermission()}>
						<button type="button" class="edit-toggle-button" onClick={startUpdate}>
							<SquarePen class="edit-icon" />
							評価更新
						</button>
					</Show>
				</Show>
			</div>
			<Show when={!isLoading()} fallback={<p>共通評価情報を読み込み中です...</p>}>
				<Show when={props.sheetId == null}>
					<p class="new-sheet-notice">
						この評価期間のシートはまだ作成されていません。内容を入力して登録してください。
					</p>
				</Show>
				<div class="evaluation-table-container">
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
							{/* シートあり：既存データを表示 */}
							<Show when={props.sheetId != null}>
								<For each={evaluation()?.results ?? []}>
									{(result, index) => {
										const draft = () => updateDrafts()[result.id];

										return (
											<tr>
												<td>{index() + 1}</td>
												<td>{result.item.title}</td>
												<td>{result.item.description}</td>
												<td>
													<Show
														when={isUpdating() && canEditFirstScore()}
														fallback={result.first_comment || "—"}
													>
														<textarea
															class="objective-input"
															value={draft()?.first_comment || ""}
															onInput={(e) =>
																setUpdateDrafts((prev) => ({
																	...prev,
																	[result.id]: {
																		...prev[result.id],
																		first_comment: e.currentTarget.value,
																	},
																}))
															}
														/>
													</Show>
												</td>
												<td>{result.item.weight}</td>
												<td>
													<Show
														when={isUpdating() && canEditFirstScore()}
														fallback={result.first_score || "—"}
													>
														<input
															type="number"
															class="score-input"
															min="0"
															max={result.item.weight}
															value={draft()?.first_score || ""}
															onInput={(e) =>
																setUpdateDrafts((prev) => ({
																	...prev,
																	[result.id]: {
																		...prev[result.id],
																		first_score: e.currentTarget.value,
																	},
																}))
															}
														/>
													</Show>
												</td>
												<td>
													<Show
														when={isUpdating() && canEditSecondScore()}
														fallback={result.second_score || "—"}
													>
														<input
															type="number"
															class="score-input"
															min="0"
															max={result.item.weight}
															value={draft()?.second_score || ""}
															onInput={(e) =>
																setUpdateDrafts((prev) => ({
																	...prev,
																	[result.id]: {
																		...prev[result.id],
																		second_score: e.currentTarget.value,
																	},
																}))
															}
														/>
													</Show>
												</td>
											</tr>
										);
									}}
								</For>
							</Show>
							{/* シートなし：入力フォーム */}
							<Show when={props.sheetId == null && Array.isArray(items())} keyed>
								{(_: true) => {
									initDrafts(items() as CommonEvaluationItem[]);
									return (
										<For each={drafts()}>
											{(row, index) => (
												<tr>
													<td>{index() + 1}</td>
													<td>{row.item.title}</td>
													<td>{row.item.description}</td>
													<td>
														<textarea
															class="objective-input"
															placeholder="コメント"
															value={row.first_comment}
															onInput={(e) =>
																updateDraft(index(), "first_comment", e.currentTarget.value)
															}
														/>
													</td>
													<td>{row.item.weight}</td>
													<td>
														<input
															type="number"
															class="score-input"
															placeholder="—"
															min="0"
															max={row.item.weight}
															value={row.first_score}
															onInput={(e) =>
																updateDraft(index(), "first_score", e.currentTarget.value)
															}
														/>
													</td>
													<td>
														<input
															type="number"
															class="score-input"
															placeholder="—"
															min="0"
															max={row.item.weight}
															value={row.second_score}
															onInput={(e) =>
																updateDraft(index(), "second_score", e.currentTarget.value)
															}
														/>
													</td>
												</tr>
											)}
										</For>
									);
								}}
							</Show>
						</tbody>
					</table>
				</div>

				<Show when={props.sheetId != null && isUpdating()}>
					<div class="common-evaluation-actions common-evaluation-actions--footer">
						<button
							type="button"
							class="primary-action"
							onClick={applyUpdate}
							disabled={updateLoading()}
						>
							{updateLoading() ? "保存中…" : "編集を完了"}
						</button>
						<button type="button" class="secondary-action" onClick={cancelUpdate}>
							キャンセル
						</button>
					</div>
				</Show>
				<Show when={props.sheetId != null && updateError()}>
					<p class="update-error">{updateError()}</p>
				</Show>
				<Show when={props.sheetId != null}>
					<div class="evaluation-summary">
						<div class="summary-item">
							<span class="summary-label">一次評価合計点:</span>
							<span class="summary-value">{evaluation()?.totalFirstScore ?? 0}</span>
							<span class="summary-rate">({evaluation()?.firstRate?.toFixed(1) ?? "0.0"}%)</span>
						</div>
						<div class="summary-item">
							<span class="summary-label">二次評価合計点:</span>
							<span class="summary-value">{evaluation()?.totalSecondScore ?? 0}</span>
							<span class="summary-rate">({evaluation()?.secondRate?.toFixed(1) ?? "0.0"}%)</span>
						</div>
						<div class="summary-item">
							<span class="summary-label">満点:</span>
							<span class="summary-value">{evaluation()?.totalWeight ?? 0}</span>
						</div>
					</div>
				</Show>

				{/* シートなし：登録ボタン */}
				<Show when={props.sheetId == null}>
					<div class="new-sheet-actions">
						<Show when={submitError()}>
							<p class="update-error">{submitError()}</p>
						</Show>
						<button
							type="button"
							class="primary-action"
							onClick={handleSubmit}
							disabled={submitting()}
						>
							{submitting() ? "登録中…" : "評価シートを登録"}
						</button>
					</div>
				</Show>
			</Show>
		</article>
	);
};

export default CommonEvaluation;
