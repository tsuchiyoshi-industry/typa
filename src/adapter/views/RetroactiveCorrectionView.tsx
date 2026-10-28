import FilePenLine from "lucide-solid/icons/file-pen-line";
import Search from "lucide-solid/icons/search";
import { type Component, createResource, createSignal, For, Show } from "solid-js";
import type { CorrectableSheetDto } from "../../application/dtos/SheetCorrectionDto";
import { messageOf } from "../../application/errorMessage";
import type { RequestedChange } from "../../domain/entities/RetroactiveCorrection";
import { parsePeriodGoals } from "../../domain/valueObjects/CorrectionField";
import type { EvaluationStatusValue } from "../../domain/valueObjects/EvaluationStatus";
import type { RetroactiveCorrectionController } from "../controllers/RetroactiveCorrectionController";
import { PeriodGoalsEditor } from "./components/PeriodGoals";
import SheetCorrectionsNotice from "./components/SheetCorrectionsNotice";
import { confirmAction, confirmDiscard, showToast, trackUnsaved } from "./feedback";
import { statusLabel } from "./format";

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();

type Field = { target: RequestedChange["target"]; targetId: number | null; field: string };
const keyOf = ({ target, targetId, field }: Field) => `${target}:${targetId ?? ""}:${field}`;

/** その欄の今の値(修正前)。点数は "0"〜"4" の文字列にする。 */
function originalValues(sheet: CorrectableSheetDto): Map<string, string> {
	const values = new Map<string, string>();
	for (const goal of sheet.goals) {
		const set = (field: string, value: string | number) =>
			values.set(keyOf({ target: "goal", targetId: goal.id, field }), String(value));
		set("challenge_goal", goal.challengeGoal);
		set("achievement", goal.achievement);
		set("period_goals", JSON.stringify(goal.periodGoals));
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
	const [query, setQuery] = createSignal("");

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

	// 書きかけの修正があるうちは、別のシート・期間へ移る前と画面を離れる前に確かめる
	const dirty = () => changes().length > 0 || reason().trim() !== "";
	trackUnsaved("retroactive-correction", dirty);
	const discardDraft = async () => {
		if (!(await confirmDiscard(dirty()))) {
			return false;
		}
		setDrafts(new Map());
		setReason("");
		return true;
	};
	const open = async (id: number) => {
		if (id !== sheetId() && (await discardDraft())) {
			setSheetId(id);
		}
	};
	const choosePeriod = async (id: number) => {
		if (id !== selectedPeriod() && (await discardDraft())) {
			setPeriodId(id);
			setSheetId(null);
			setQuery("");
		}
	};
	const visibleSheets = () => {
		const term = normalize(query().trim());
		return term
			? sheetList().filter((row) =>
					normalize(`${row.employeeNo} ${row.employeeName}`).includes(term),
				)
			: sheetList();
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
		<div class="correction-page">
			<header class="master-header">
				<div>
					<h1>
						<FilePenLine class="header-icon" />
						遡及処理
					</h1>
					<p class="correction-lead">
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
						<div class="correction-layout">
							<section class="correction-picker" aria-labelledby="correction-sheets-heading">
								<h2 id="correction-sheets-heading">締めたシート</h2>
								<label class="correction-picker__field">
									<span>評価期間</span>
									<select
										value={selectedPeriod() ?? ""}
										onChange={(event) => {
											const select = event.currentTarget;
											const id = Number(select.value);
											// 確認で取りやめたら、選択を元の期間に戻す
											void choosePeriod(id).then(() => {
												select.value = String(selectedPeriod() ?? "");
											});
										}}
									>
										<For each={periodList()}>
											{(period) => <option value={period.id}>{period.periodName}</option>}
										</For>
									</select>
								</label>
								<label class="correction-picker__search">
									<Search size={16} aria-hidden="true" />
									<input
										type="search"
										aria-label="社員番号・氏名で絞り込む"
										placeholder="社員番号・氏名"
										value={query()}
										onInput={(event) => setQuery(event.currentTarget.value)}
									/>
								</label>
								<Show when={sheets.error}>
									<p class="field-error" role="alert">
										{messageOf(sheets.error, "シートを読み込めませんでした。")}
									</p>
								</Show>
								<Show
									when={!sheets.loading}
									fallback={<p class="page-note">読み込んでいます...</p>}
								>
									<p class="correction-picker__count" role="status">
										{query().trim()
											? `${visibleSheets().length} / ${sheetList().length} 件`
											: `${sheetList().length} 件`}
									</p>
									<Show
										when={visibleSheets().length > 0}
										fallback={
											<p class="page-note">
												{sheetList().length
													? "該当するシートはありません。"
													: "この評価期間のシートはありません。"}
											</p>
										}
									>
										<ul class="correction-sheet-list">
											<For each={visibleSheets()}>
												{(row) => (
													<li>
														<button
															type="button"
															aria-label={`${row.employeeName}さんのシートを直す`}
															aria-current={row.sheetId === sheetId() ? "true" : undefined}
															onClick={() => void open(row.sheetId)}
														>
															<span class="correction-sheet-list__no">{row.employeeNo}</span>
															<span class="correction-sheet-list__name">{row.employeeName}</span>
															<span class="correction-sheet-list__status">
																{statusLabel(row.status as EvaluationStatusValue)}
															</span>
														</button>
													</li>
												)}
											</For>
										</ul>
									</Show>
								</Show>
							</section>

							<div class="correction-workspace">
								<Show when={sheet.error}>
									<div class="inline-alert" role="alert">
										<span>{messageOf(sheet.error, "シートを読み込めませんでした。")}</span>
									</div>
								</Show>
								<Show when={!sheetId()}>
									<p class="correction-empty">左の一覧から、直すシートを選んでください。</p>
								</Show>
								<Show when={sheetId() && sheet.loading}>
									<p class="page-note">シートを読み込んでいます...</p>
								</Show>
								<Show when={!sheet.error && sheet()}>
									{(loaded) => (
										<section class="correction-editor" aria-labelledby="correction-editor-heading">
											<header class="correction-editor__head">
												<h2 id="correction-editor-heading">
													{loaded().employeeName}さん({loaded().employeeNo})・{loaded().periodName}
													を直す
												</h2>
												<p class="correction-editor__hint">
													直したい欄だけを書き換えてください。書き換えた欄は赤く表示されます。点数は
													1〜4 です。
												</p>
											</header>

											<h3>チャレンジ目標</h3>
											<For each={loaded().goals}>
												{(goal) => (
													<fieldset class="correction-group">
														<legend>チャレンジ目標 {goal.goalNumber}</legend>
														{textArea(
															{ target: "goal", targetId: goal.id, field: "challenge_goal" },
															"チャレンジ目標",
														)}

														{(() => {
															const tasks: Field = {
																target: "goal",
																targetId: goal.id,
																field: "period_goals",
															};
															const achievement: Field = {
																target: "goal",
																targetId: goal.id,
																field: "achievement",
															};
															return (
																<div classList={{ "correction-field--changed": changed(tasks) }}>
																	<PeriodGoalsEditor
																		goals={parsePeriodGoals(draftValue(tasks)) ?? []}
																		achievement={draftValue(achievement)}
																		disabled={busy()}
																		achievementClassList={{
																			"correction-field": true,
																			"correction-field--changed": changed(achievement),
																		}}
																		onChange={(next) => {
																			edit(tasks, JSON.stringify(next.periodGoals));
																			edit(achievement, next.achievement);
																		}}
																	/>
																</div>
															);
														})()}
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
																	{
																		target: "common",
																		targetId: item.itemId,
																		field: "second_score",
																	},
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

											<SheetCorrectionsNotice
												corrections={loaded().corrections}
												heading={`このシートの修正の記録(${loaded().corrections.length}件)`}
											/>

											{/* 長いシートの下まで送らなくても、理由と確認にすぐ手が届くよう画面の下に留める */}
											<div class="correction-submit">
												<label class="correction-reason">
													<span>修正の理由(必須・500 文字まで)</span>
													<textarea
														rows={2}
														maxLength={500}
														value={reason()}
														disabled={busy()}
														onInput={(event) => setReason(event.currentTarget.value)}
													/>
												</label>
												<button
													type="button"
													class="primary-action"
													disabled={busy() || changes().length === 0 || !reason().trim()}
													onClick={() => void submit()}
												>
													修正内容を確認({changes().length}件)
												</button>
											</div>
										</section>
									)}
								</Show>
							</div>
						</div>
					</Show>
				</Show>
			</Show>
		</div>
	);
};

export default RetroactiveCorrectionView;
