import FilePenLine from "lucide-solid/icons/file-pen-line";
import { type Component, createResource, createSignal, For, Show } from "solid-js";
import type { CorrectableSheetDto } from "../../application/dtos/SheetCorrectionDto";
import { messageOf } from "../../application/errorMessage";
import type { RequestedChange } from "../../domain/entities/RetroactiveCorrection";
import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";
import type { RetroactiveCorrectionController } from "../controllers/RetroactiveCorrectionController";
import SheetCorrectionsNotice from "./components/SheetCorrectionsNotice";
import { confirmAction, showToast } from "./feedback";
import { statusLabel } from "./format";

type Field = { target: RequestedChange["target"]; targetId: number | null; field: string };
const keyOf = ({ target, targetId, field }: Field) => `${target}:${targetId ?? ""}:${field}`;

/** その欄の今の値(修正前)。点数は "0"〜"4" の文字列にする。 */
function originalValues(sheet: CorrectableSheetDto): Map<string, string> {
	const values = new Map<string, string>();
	for (const goal of sheet.goals) {
		const set = (field: string, value: string | number) =>
			values.set(keyOf({ target: "goal", targetId: goal.id, field }), String(value));
		set("challenge_goal", goal.challengeGoal);
		set("midterm_goal", goal.midtermGoal);
		set("achievement", goal.achievement);
		set("first_score", goal.firstScore);
		set("second_score", goal.secondScore);
	}
	for (const item of sheet.commonItems) {
		const set = (field: string, value: string | number) =>
			values.set(keyOf({ target: "common", targetId: item.itemId, field }), String(value));
		set("first_score", item.firstScore);
		set("second_score", item.secondScore);
		set("first_comment", item.firstComment);
	}
	values.set(
		keyOf({ target: "sheet", targetId: null, field: "first_overall_comment" }),
		sheet.firstOverallComment,
	);
	values.set(
		keyOf({ target: "sheet", targetId: null, field: "second_overall_comment" }),
		sheet.secondOverallComment,
	);
	return values;
}

/**
 * 遡及処理(Admin だけ)。締めた評価期間を開き直さずに、締めたシートの項目を1つずつ直す。
 * 直した内容は理由とともに消えない記録になり、本人と評価者のシートに「締め後修正」として出る。
 */
const RetroactiveCorrectionView: Component<{ controller: RetroactiveCorrectionController }> = (
	props,
) => {
	const [periods] = createResource(() => props.controller.closedPeriods());
	const [periodId, setPeriodId] = createSignal<number | null>(null);
	// 読み込みに失敗したリソースの値を読むと例外になるので、失敗したら空として扱う(理由は別に出す)
	const periodList = () => (periods.error ? [] : (periods() ?? []));
	const sheetList = () => (sheets.error ? [] : (sheets() ?? []));
	const selectedPeriod = () => periodId() ?? periodList()[0]?.id ?? null;
	const [sheets] = createResource(selectedPeriod, (id) => props.controller.sheets(id));
	const [sheetId, setSheetId] = createSignal<number | null>(null);
	const [sheet, { refetch }] = createResource(sheetId, (id) => props.controller.load(id));
	const [drafts, setDrafts] = createSignal(new Map<string, string>());
	const [reason, setReason] = createSignal("");
	const [busy, setBusy] = createSignal(false);

	const original = () =>
		!sheet.error && sheet()
			? originalValues(sheet() as CorrectableSheetDto)
			: new Map<string, string>();
	const draftValue = (field: Field) =>
		drafts().get(keyOf(field)) ?? original().get(keyOf(field)) ?? "";
	const changed = (field: Field) => draftValue(field) !== (original().get(keyOf(field)) ?? "");
	const edit = (field: Field, value: string) => {
		const next = new Map(drafts());
		next.set(keyOf(field), value);
		setDrafts(next);
	};
	const changes = (): RequestedChange[] =>
		[...drafts().entries()]
			.filter(([key, value]) => original().get(key) !== value)
			.map(([key, value]) => {
				const [target, targetId, field] = key.split(":");
				return { target, targetId: targetId ? Number(targetId) : null, field, value };
			});

	const open = (id: number) => {
		setSheetId(id);
		setDrafts(new Map());
		setReason("");
	};

	const submit = async () => {
		const id = sheetId();
		if (id === null || busy()) {
			return;
		}
		setBusy(true);
		try {
			const request = { sheetId: id, changes: changes(), reason: reason() };
			const checked = await props.controller.correct({ ...request, confirmed: false });
			if (checked.status !== "ready") {
				showToast(
					"error",
					"修正できません",
					checked.status === "rejected" ? checked.message : undefined,
				);
				return;
			}
			const confirmed = await confirmAction({
				title: "締めたシートを修正しますか？",
				message: `理由: ${reason().trim()}`,
				details: checked.changes.map(
					(change) => `${change.subject}: ${change.before} → ${change.after}`,
				),
				note: "修正したことは取り消せず、本人と評価者のシートに「締め後修正」として表示されます。評価期間は締めたまま変わりません。",
				confirmLabel: "修正を記録する",
				tone: "danger",
			});
			if (!confirmed) {
				return;
			}
			const result = await props.controller.correct({ ...request, confirmed: true });
			if (result.status === "corrected") {
				showToast("success", result.message);
				setDrafts(new Map());
				setReason("");
				await refetch();
			} else {
				// 失敗しても、入力した内容は残す
				showToast(
					"error",
					"修正を記録できませんでした",
					result.status === "rejected" ? result.message : undefined,
				);
			}
		} finally {
			setBusy(false);
		}
	};

	const scoreSelect = (field: Field, label: string) => (
		<label class="correction-field" classList={{ "correction-field--changed": changed(field) }}>
			<span>{label}</span>
			<select
				value={draftValue(field)}
				disabled={busy()}
				onChange={(event) => edit(field, event.currentTarget.value)}
			>
				<Show when={(original().get(keyOf(field)) ?? "0") === "0"}>
					<option value="0" disabled>
						未評価
					</option>
				</Show>
				<For each={["1", "2", "3", "4"]}>{(score) => <option value={score}>{score}</option>}</For>
			</select>
		</label>
	);
	const textArea = (field: Field, label: string) => (
		<label class="correction-field" classList={{ "correction-field--changed": changed(field) }}>
			<span>{label}</span>
			<textarea
				rows={2}
				value={draftValue(field)}
				disabled={busy()}
				onInput={(event) => edit(field, event.currentTarget.value)}
			/>
		</label>
	);

	return (
		<div class="settings-page">
			<header class="master-header">
				<div>
					<h1>
						<FilePenLine class="header-icon" />
						遡及処理
					</h1>
					<p>
						締めた評価期間のシートを、評価期間を開き直さずに直します。直した内容は理由とともに記録され、本人と評価者のシートに「締め後修正」として赤字で表示されます。
					</p>
				</div>
			</header>

			<Show when={!periods.loading} fallback={<p class="page-note">読み込んでいます...</p>}>
				<Show
					when={!periods.error}
					fallback={<p class="page-note">{messageOf(periods.error, "読み込めませんでした。")}</p>}
				>
					<Show
						when={periodList().length > 0}
						fallback={<p class="page-note">締め済みの評価期間はまだありません。</p>}
					>
						<section class="info-card" aria-labelledby="correction-sheets-heading">
							<h2 id="correction-sheets-heading">1. 締めたシートを選ぶ</h2>
							<nav class="period-tabs" aria-label="締め済みの評価期間">
								<For each={periodList()}>
									{(period) => (
										<button
											type="button"
											aria-pressed={period.id === selectedPeriod()}
											onClick={() => {
												setPeriodId(period.id);
												setSheetId(null);
											}}
										>
											{period.periodName}
										</button>
									)}
								</For>
							</nav>
							<Show when={sheets.error}>
								<p class="field-error" role="alert">
									{messageOf(sheets.error, "シートを読み込めませんでした。")}
								</p>
							</Show>
							<Show
								when={sheetList().length > 0}
								fallback={<p class="page-note">この評価期間のシートはありません。</p>}
							>
								<div class="table-scroll">
									<table class="sheet-table">
										<thead>
											<tr>
												<th>社員番号</th>
												<th>氏名</th>
												<th>状態</th>
												<th>
													<span class="visually-hidden">操作</span>
												</th>
											</tr>
										</thead>
										<tbody>
											<For each={sheetList()}>
												{(row) => (
													<tr classList={{ "is-selected": row.sheetId === sheetId() }}>
														<td>{row.employeeNo}</td>
														<td>{row.employeeName}</td>
														<td>{statusLabel(row.status as EvaluationStatusValue)}</td>
														<td>
															<button
																type="button"
																class="secondary-action"
																aria-label={`${row.employeeName}さんのシートを直す`}
																onClick={() => open(row.sheetId)}
															>
																直す
															</button>
														</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>
							</Show>
						</section>
					</Show>
				</Show>
			</Show>

			<Show when={sheet.error}>
				<div class="inline-alert" role="alert">
					<span>{messageOf(sheet.error, "シートを読み込めませんでした。")}</span>
				</div>
			</Show>
			<Show when={!sheet.error && sheet()}>
				{(loaded) => (
					<section class="info-card correction-editor" aria-labelledby="correction-editor-heading">
						<h2 id="correction-editor-heading">
							2. {loaded().employeeName}さん({loaded().employeeNo})・{loaded().periodName}を直す
						</h2>
						<p>
							直したい欄だけを書き換えてください。書き換えた欄は赤く表示されます。点数は 1〜4 です。
						</p>

						<h3>チャレンジ目標</h3>
						<For each={loaded().goals}>
							{(goal) => (
								<fieldset class="correction-group">
									<legend>チャレンジ目標 {goal.goalNumber}</legend>
									{textArea(
										{ target: "goal", targetId: goal.id, field: "challenge_goal" },
										"チャレンジ目標",
									)}
									{textArea(
										{ target: "goal", targetId: goal.id, field: "midterm_goal" },
										"中間目標",
									)}
									{textArea(
										{ target: "goal", targetId: goal.id, field: "achievement" },
										"達成状況",
									)}
									<div class="correction-scores">
										{scoreSelect(
											{ target: "goal", targetId: goal.id, field: "first_score" },
											"一次評価",
										)}
										<Show when={!loaded().primaryIsFinalEvaluator}>
											{scoreSelect(
												{ target: "goal", targetId: goal.id, field: "second_score" },
												"二次評価",
											)}
										</Show>
									</div>
								</fieldset>
							)}
						</For>

						<h3>共通評価</h3>
						<For each={loaded().commonItems}>
							{(item) => (
								<fieldset class="correction-group">
									<legend>{item.title}</legend>
									<div class="correction-scores">
										{scoreSelect(
											{ target: "common", targetId: item.itemId, field: "first_score" },
											"一次評価",
										)}
										<Show when={!loaded().primaryIsFinalEvaluator}>
											{scoreSelect(
												{ target: "common", targetId: item.itemId, field: "second_score" },
												"二次評価",
											)}
										</Show>
									</div>
									{textArea(
										{ target: "common", targetId: item.itemId, field: "first_comment" },
										"一次評価者コメント",
									)}
								</fieldset>
							)}
						</For>

						<h3>総評</h3>
						{textArea(
							{ target: "sheet", targetId: null, field: "first_overall_comment" },
							"一次評価者の総評",
						)}
						<Show when={!loaded().primaryIsFinalEvaluator}>
							{textArea(
								{ target: "sheet", targetId: null, field: "second_overall_comment" },
								"二次評価者の総評",
							)}
						</Show>

						<label class="correction-reason">
							<span>修正の理由(必須・500 文字まで)</span>
							<textarea
								rows={3}
								maxLength={500}
								value={reason()}
								disabled={busy()}
								onInput={(event) => setReason(event.currentTarget.value)}
							/>
						</label>
						<div class="import-actions">
							<button
								type="button"
								class="primary-action"
								disabled={busy() || changes().length === 0 || !reason().trim()}
								onClick={() => void submit()}
							>
								修正内容を確認({changes().length}件)
							</button>
						</div>

						<SheetCorrectionsNotice
							corrections={loaded().corrections}
							heading={`このシートの修正の記録(${loaded().corrections.length}件)`}
						/>
					</section>
				)}
			</Show>
		</div>
	);
};

export default RetroactiveCorrectionView;
