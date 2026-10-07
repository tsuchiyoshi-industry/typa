import Check from "lucide-solid/icons/check";
import SquarePen from "lucide-solid/icons/square-pen";
import X from "lucide-solid/icons/x";
import { type Component, createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { CommonEvaluationResultDto } from "../../../application/dtos/CommonEvaluationDto";
import { Score } from "../../../domain/valueObjects/Score";
import type { CommonEvaluationController } from "../../controllers/CommonEvaluationController";
import type { CommonEvaluationViewModel } from "../../presenters/CommonEvaluationPresenter";
import { showToast, trackUnsaved } from "../feedback";
import ScoreScale from "./ScoreScale";

interface CommonEvaluationViewProps {
	sheetId: number | null;
	gradeId: number | null;
	controller: CommonEvaluationController;
	viewModel: () => CommonEvaluationViewModel;
	canEditFirst: boolean;
	canEditSecond: boolean;
	canViewSecondEvaluation: boolean;
	onUpdated: () => void;
	onSavingChange?: (saving: boolean) => void;
}

interface Draft {
	firstComment: string;
	firstScore: number;
	secondScore: number;
}

const toDraft = (result: CommonEvaluationResultDto): Draft => ({
	firstComment: result.firstComment,
	firstScore: result.firstScore ?? 0,
	secondScore: result.secondScore ?? 0,
});

/** 評価は 0(未評価)〜4。配点は点数の上限ではなく、評価に掛ける係数。 */
const isValidScore = (score: number) => Number.isInteger(score) && score >= 0 && score <= Score.MAX;

export default function CommonEvaluationView(props: CommonEvaluationViewProps) {
	const [isEditing, setIsEditing] = createSignal(false);
	const [drafts, setDrafts] = createSignal<Record<number, Draft>>({});
	const [submitting, setSubmitting] = createSignal(false);
	createEffect(() => props.onSavingChange?.(submitting()));

	createEffect(() => {
		if (props.sheetId != null) {
			void props.controller.load(props.sheetId, props.gradeId);
		}
	});

	// プレゼンターは画面をまたいで生きているので、別シートの古い集計を出さないよう照合する
	const summary = createMemo(() => {
		const current = props.viewModel().summary;
		const loadedSheetId = current?.results[0]?.sheetId;
		return current && (loadedSheetId == null || loadedSheetId === props.sheetId) ? current : null;
	});
	const results = () => summary()?.results ?? [];

	const draftOf = (result: CommonEvaluationResultDto): Draft =>
		drafts()[result.id] ?? toDraft(result);

	const updateDraft = (result: CommonEvaluationResultDto, patch: Partial<Draft>) =>
		setDrafts((prev) => ({ ...prev, [result.id]: { ...draftOf(result), ...patch } }));

	const isChanged = (result: CommonEvaluationResultDto) => {
		const draft = draftOf(result);
		const saved = toDraft(result);
		return (
			(props.canEditFirst &&
				(draft.firstComment !== saved.firstComment || draft.firstScore !== saved.firstScore)) ||
			(props.canEditSecond && draft.secondScore !== saved.secondScore)
		);
	};

	const isRowInvalid = (result: CommonEvaluationResultDto) => {
		const draft = draftOf(result);
		return (
			(props.canEditFirst && !isValidScore(draft.firstScore)) ||
			(props.canEditSecond && !isValidScore(draft.secondScore))
		);
	};

	const hasChanges = () => results().some(isChanged);
	const hasInvalidRow = () => results().some(isRowInvalid);

	trackUnsaved("common", () => isEditing() && hasChanges());

	// 編集中は入力中の値で合計を出し、保存前に結果を確認できるようにする
	const totalFirst = () =>
		isEditing() && props.canEditFirst
			? results().reduce(
					(sum, result) => sum + result.item.weight * (draftOf(result).firstScore || 0),
					0,
				)
			: (summary()?.totalFirstScore ?? 0);
	const totalSecond = () =>
		isEditing() && props.canEditSecond
			? results().reduce(
					(sum, result) => sum + result.item.weight * (draftOf(result).secondScore || 0),
					0,
				)
			: (summary()?.totalSecondScore ?? 0);

	/** 満点は「配点の合計 × 4」。 */
	const maxTotal = () => (summary()?.totalWeight ?? 0) * Score.MAX;

	const beginEdit = () => {
		setDrafts({});
		setIsEditing(true);
	};

	const cancelEdit = () => {
		setIsEditing(false);
		setDrafts({});
	};

	const handleSubmit = async () => {
		if (props.sheetId == null || hasInvalidRow()) {
			return;
		}

		setSubmitting(true);
		const success = await props.controller.upsert(
			props.sheetId,
			results().map((result) => ({ id: result.id, itemId: result.item.id, ...draftOf(result) })),
		);

		if (success) {
			// 画面を消さずに集計を取り直してから編集モードを抜ける
			await props.controller.load(props.sheetId, props.gradeId);
			cancelEdit();
			showToast("success", "共通評価を保存しました");
			props.onUpdated();
		}
		setSubmitting(false);
	};

	const ScoreCell: Component<{
		result: CommonEvaluationResultDto;
		field: "firstScore" | "secondScore";
		label: string;
		editable: boolean;
	}> = (cellProps) => {
		const draftValue = () => draftOf(cellProps.result)[cellProps.field];
		const savedValue = () => cellProps.result[cellProps.field];

		return (
			<Show
				when={isEditing() && cellProps.editable}
				fallback={
					<span class="score-cell" classList={{ empty: !savedValue() }}>
						{savedValue() || "—"}
					</span>
				}
			>
				<ScoreScale
					label={`${cellProps.result.item.title} ${cellProps.label}`}
					max={Score.MAX}
					value={draftValue()}
					disabled={submitting()}
					onChange={(value) => updateDraft(cellProps.result, { [cellProps.field]: value })}
				/>
			</Show>
		);
	};

	return (
		<article class="common-evaluation-card">
			<div class="common-evaluation-card__header">
				<div>
					<h2>共通評価</h2>
					<p class="challenge-helper">
						項目ごとに 1〜{Score.MAX} の4段階で評価します。得点は「配点 × 評価」です。
					</p>
				</div>
				<Show when={summary() != null && (props.canEditFirst || props.canEditSecond)}>
					<Show
						when={isEditing()}
						fallback={
							<button type="button" class="edit-toggle-button" onClick={beginEdit}>
								<SquarePen class="edit-icon" />
								評価を入力
							</button>
						}
					>
						<div class="edit-actions">
							<button
								type="button"
								class="primary-action"
								onClick={handleSubmit}
								disabled={submitting() || !hasChanges() || hasInvalidRow()}
							>
								<Check class="action-icon" />
								{submitting() ? "保存中..." : "評価を保存"}
							</button>
							<button
								type="button"
								class="secondary-action"
								onClick={cancelEdit}
								disabled={submitting()}
							>
								<X class="action-icon" />
								キャンセル
							</button>
						</div>
					</Show>
				</Show>
			</div>

			<Show when={props.viewModel().loadError}>
				<p class="error-message" role="alert">
					{props.viewModel().loadError}
				</p>
			</Show>

			<Show
				when={summary()}
				fallback={
					<Show when={props.viewModel().loading}>
						<p>共通評価を読み込んでいます...</p>
					</Show>
				}
			>
				<div class="table-scroll">
					<table class="evaluation-table" classList={{ editing: isEditing() }}>
						<thead>
							<tr>
								<th class="col-item">評価項目</th>
								<th class="col-description">評価の観点</th>
								<th class="col-comment">一次評価者コメント</th>
								<th class="col-number">配点</th>
								<th class="col-score">一次評価</th>
								<Show when={props.canViewSecondEvaluation}>
									<th class="col-score">二次評価</th>
								</Show>
							</tr>
						</thead>
						<tbody>
							<For each={results()}>
								{(result) => (
									<tr>
										<th scope="row" class="col-item">
											{result.item.title}
										</th>
										<td class="col-description">{result.item.description}</td>
										<td class="col-comment">
											<Show
												when={isEditing() && props.canEditFirst}
												fallback={
													<span classList={{ empty: !result.firstComment }}>
														{result.firstComment || "—"}
													</span>
												}
											>
												<textarea
													aria-label={`${result.item.title} 一次評価者コメント`}
													value={draftOf(result).firstComment}
													disabled={submitting()}
													onInput={(e) =>
														updateDraft(result, { firstComment: e.currentTarget.value })
													}
												/>
											</Show>
										</td>
										<td class="col-number">{result.item.weight}</td>
										<td class="col-score">
											<ScoreCell
												result={result}
												field="firstScore"
												label="一次評価"
												editable={props.canEditFirst}
											/>
										</td>
										<Show when={props.canViewSecondEvaluation}>
											<td class="col-score">
												<ScoreCell
													result={result}
													field="secondScore"
													label="二次評価"
													editable={props.canEditSecond}
												/>
											</td>
										</Show>
									</tr>
								)}
							</For>
						</tbody>
						<tfoot>
							<tr>
								<th scope="row" colSpan={3}>
									合計（配点 × 評価）
								</th>
								<td class="col-number">{summary()?.totalWeight ?? 0}</td>
								<td class="col-score">
									{totalFirst()}
									<small> / {maxTotal()}</small>
								</td>
								<Show when={props.canViewSecondEvaluation}>
									<td class="col-score">
										{totalSecond()}
										<small> / {maxTotal()}</small>
									</td>
								</Show>
							</tr>
						</tfoot>
					</table>
				</div>
			</Show>

			<Show when={props.viewModel().updateError}>
				<p class="error-message" role="alert">
					{props.viewModel().updateError}
				</p>
			</Show>
		</article>
	);
}
