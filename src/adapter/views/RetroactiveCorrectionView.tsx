import Search from "lucide-solid/icons/search";
import ShieldAlert from "lucide-solid/icons/shield-alert";
import {
	type Component,
	createMemo,
	createResource,
	createSignal,
	For,
	Match,
	Show,
	Switch,
} from "solid-js";
import type { CorrectableSheetDto } from "../../application/dtos/SheetCorrectionDto";
import { messageOf } from "../../application/errorMessage";
import type { RequestedChange } from "../../domain/entities/RetroactiveCorrection";
import { canChangeSheetGrade } from "../../domain/entities/SheetGradeChange";
import { parsePeriodGoals } from "../../domain/valueObjects/CorrectionField";
import {
	EVALUATION_STATUS_VALUES,
	EvaluationStatus,
	type EvaluationStatusValue,
} from "../../domain/valueObjects/EvaluationStatus";
import type {
	MaintainedSheetRow,
	RetroactiveCorrectionController,
} from "../controllers/RetroactiveCorrectionController";
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
 * シートに対してできること。値を直せるのは締め済みの期間のシートだけ。
 * 等級を変えられるのは当期のシートで、一次評価が確定する前だけ。
 */
type Mode = "values" | "status" | "grade" | "delete";
const MODES: { value: Mode; label: string }[] = [
	{ value: "values", label: "値を直す" },
	{ value: "status", label: "状態を変える" },
	{ value: "grade", label: "等級を変える" },
	{ value: "delete", label: "削除する" },
];

/**
 * 遡及処理(Admin だけ)。選んだシートの値を直す(締め済みの期間だけ)、状態を変える、等級を変える(当期だけ)、削除する。
 * 値を直したことは本人と評価者のシートに「締め後修正」として出る。それ以外は通知せず、監査ログに残す。
 */
const RetroactiveCorrectionView: Component<{ controller: RetroactiveCorrectionController }> = (
	props,
) => {
	const [periods] = createResource(() => props.controller.periods());
	const [periodId, setPeriodId] = createSignal<number | null>(null);
	// 読み込みに失敗したリソースの値を読むと例外になるので、失敗したら空として扱う(理由は別に出す)
	const periodList = () => (periods.error ? [] : (periods() ?? []));
	const selectedPeriod = () =>
		periodId() ?? periodList().find((entry) => entry.isActive)?.id ?? periodList()[0]?.id ?? null;
	const period = () => periodList().find((entry) => entry.id === selectedPeriod());
	const periodClosed = () => period()?.state === "closed";
	const [sheets, { refetch: refetchSheets }] = createResource(selectedPeriod, (id) =>
		props.controller.sheets(id),
	);
	// 操作の後に読み直す間も、一覧と選んだシートを出したままにする
	const sheetList = () => (sheets.error ? [] : (sheets.latest ?? []));
	const [sheetId, setSheetId] = createSignal<number | null>(null);
	const row = createMemo(() => sheetList().find((entry) => entry.sheetId === sheetId()));
	// 中身は値を直すときだけ要る。締めていない期間のシートは読みにいかない(DB も断る)
	const [sheet, { refetch }] = createResource(
		() => (periodClosed() && sheetId()) || false,
		(id) => props.controller.load(id),
	);
	const [mode, setMode] = createSignal<Mode>("values");
	const [nextStatus, setNextStatus] = createSignal<EvaluationStatusValue | null>(null);
	const [nextGrade, setNextGrade] = createSignal<number | null>(null);
	// 等級の一覧は、等級を変えるときだけ一度読む
	const [gradesWanted, setGradesWanted] = createSignal(false);
	const [grades] = createResource(gradesWanted, () => props.controller.grades());
	const gradeList = () => (grades.error ? [] : (grades() ?? []));
	const canChangeGrade = () => {
		const target = row();
		const state = period()?.state;
		return !!target && !!state && canChangeSheetGrade(EvaluationStatus.from(target.status), state);
	};
	const gradeName = (id: number | null) =>
		gradeList().find((grade) => grade.id === id)?.name ?? "未設定";
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

	const clearInput = () => {
		setDrafts(new Map());
		setNextStatus(null);
		setNextGrade(null);
		setReason("");
	};
	// 書きかけがあるうちは、別のシート・期間へ移る前と画面を離れる前に確かめる
	const dirty = () =>
		changes().length > 0 || nextStatus() !== null || nextGrade() !== null || reason().trim() !== "";
	trackUnsaved("retroactive-correction", dirty);
	const discardInput = async () => {
		if (!(await confirmDiscard(dirty()))) {
			return false;
		}
		clearInput();
		return true;
	};
	const open = async (id: number) => {
		if (id !== sheetId() && (await discardInput())) {
			setSheetId(id);
			setMode(periodClosed() ? "values" : "status");
		}
	};
	const choosePeriod = async (id: number) => {
		if (id !== selectedPeriod() && (await discardInput())) {
			setPeriodId(id);
			setSheetId(null);
			setQuery("");
		}
	};
	// 理由は操作をまたいで残す。直しかけの値だけは、別の操作へ移る前に確かめる
	const chooseMode = async (next: Mode) => {
		if (next === mode() || (changes().length > 0 && !(await confirmDiscard(true)))) {
			return;
		}
		setDrafts(new Map());
		setNextStatus(null);
		setNextGrade(null);
		if (next === "grade") {
			setGradesWanted(true);
		}
		setMode(next);
	};
	const visibleSheets = () => {
		const term = normalize(query().trim());
		return term
			? sheetList().filter((entry) =>
					normalize(`${entry.employeeNo} ${entry.employeeName}`).includes(term),
				)
			: sheetList();
	};

	const correctValues = async (id: number) => {
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
			clearInput();
			await refetch();
		} else {
			// 失敗しても、入力した内容は残す
			showToast(
				"error",
				"修正を記録できませんでした",
				result.status === "rejected" ? result.message : undefined,
			);
		}
	};

	const operate = async (target: MaintainedSheetRow) => {
		const deleting = mode() === "delete";
		const status = nextStatus();
		const who = `${target.employeeName}(${target.employeeNo})・${period()?.periodName}`;
		// 確かめている間に状態が変わっていたら DB が断る(表示した状態と照らし合わせる)
		const request = {
			sheetId: target.sheetId,
			expectedStatus: target.status,
			action: deleting ? "delete" : "changeStatus",
			status: deleting ? undefined : (status ?? undefined),
			reason: reason().trim(),
		};
		const confirmed = await confirmAction(
			deleting
				? {
						title: "シートを削除しますか？",
						message: `理由: ${request.reason}`,
						details: [who, "評価シートと、その目標・評価・修正の記録を削除"],
						note: "削除は取り消せません。通知は送らず、削除前の内容と理由を監査ログに残します。",
						confirmLabel: "シートを削除する",
						tone: "danger",
					}
				: {
						title: "シートの状態を変更しますか？",
						message: `理由: ${request.reason}`,
						details: [
							who,
							`${statusLabel(target.status)} → ${statusLabel(status as EvaluationStatusValue)}`,
						],
						note: "承認や通常の進行条件を省略します。記入した内容と点数はそのままで、確定した評価点とランクは解除されます。通知は送らず、前後の状態と理由を監査ログに残します。",
						confirmLabel: "状態を変更する",
						tone: "danger",
					},
		);
		if (!confirmed) {
			return;
		}
		const result = await props.controller.operate(request);
		if (!result.success) {
			// 失敗しても、選んだシートと理由は残す
			showToast("error", "操作を実行できませんでした", result.message);
			return;
		}
		showToast("success", result.message);
		clearInput();
		if (deleting) {
			setSheetId(null);
		} else if (periodClosed()) {
			await refetch();
		}
		await refetchSheets();
	};

	const changeGrade = async (target: MaintainedSheetRow) => {
		const grade = nextGrade() as number;
		const request = {
			sheetId: target.sheetId,
			gradeId: grade,
			// 確かめている間に等級か状態が変わっていたら DB が断る(表示したものと照らし合わせる)
			expectedGradeId: target.gradeId,
			expectedStatus: target.status,
			reason: reason().trim(),
		};
		const confirmed = await confirmAction({
			title: "シートの等級を変更しますか？",
			message: `理由: ${request.reason}`,
			details: [
				`${target.employeeName}(${target.employeeNo})・${period()?.periodName}`,
				`${target.gradeName || "未設定"} → ${gradeName(grade)}`,
				"共通評価の入力(点数・コメント)をすべて削除",
			],
			note: "この操作は取り消せません。チャレンジ目標・期中目標・達成状況・点数・総評は変わりません。通知は送らず、削除した内容と理由を監査ログに残します。",
			confirmLabel: "等級を変更する",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}
		const result = await props.controller.changeGrade(request);
		if (!result.success) {
			// 失敗しても、選んだ等級と理由は残す
			showToast("error", "等級を変更できませんでした", result.message);
			return;
		}
		showToast("success", result.message);
		clearInput();
		await refetchSheets();
	};

	const canSubmit = () =>
		!busy() &&
		!!row() &&
		reason().trim() !== "" &&
		(mode() === "values"
			? changes().length > 0
			: mode() === "status"
				? nextStatus() !== null
				: mode() === "grade"
					? nextGrade() !== null && canChangeGrade()
					: true);
	const submitLabel = () =>
		mode() === "values"
			? `修正内容を確認(${changes().length}件)`
			: mode() === "status"
				? "状態の変更を確認"
				: mode() === "grade"
					? "等級の変更を確認"
					: "削除を確認";
	const submit = async () => {
		const target = row();
		if (!target || !canSubmit()) {
			return;
		}
		setBusy(true);
		try {
			await (mode() === "values"
				? correctValues(target.sheetId)
				: mode() === "grade"
					? changeGrade(target)
					: operate(target));
		} catch (error) {
			showToast(
				"error",
				"操作を完了できませんでした",
				messageOf(error, "時間をおいて再度お試しください。"),
			);
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

	const valuesPane = (loaded: () => CorrectableSheetDto) => (
		<>
			<p class="correction-pane__hint">
				直したい欄だけを書き換えてください。書き換えた欄は赤く表示されます。点数は 1〜4 です。
			</p>
			<h3>チャレンジ目標</h3>
			<For each={loaded().goals}>
				{(goal) => {
					const tasks: Field = { target: "goal", targetId: goal.id, field: "period_goals" };
					const achievement: Field = { target: "goal", targetId: goal.id, field: "achievement" };
					return (
						<fieldset class="correction-group">
							<legend>チャレンジ目標 {goal.goalNumber}</legend>
							{textArea(
								{ target: "goal", targetId: goal.id, field: "challenge_goal" },
								"チャレンジ目標",
							)}
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
					);
				}}
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
			<SheetCorrectionsNotice
				corrections={loaded().corrections}
				heading={`このシートの修正の記録(${loaded().corrections.length}件)`}
			/>
		</>
	);

	// 状態は進む順に並べ、今の状態から前へ戻すのか先へ進めるのかを見て選べるようにする
	const statusPane = (current: EvaluationStatusValue) => (
		<fieldset class="correction-status">
			<legend>変更後の状態</legend>
			<p class="correction-pane__hint">
				承認や通常の進行条件を省略して、どの状態へも移せます。記入した内容と点数はそのままで、確定した評価点とランクは解除されます。通知は送りません。
			</p>
			<ol class="correction-status__steps">
				<For each={EVALUATION_STATUS_VALUES}>
					{(value) => (
						<li>
							<label
								class="correction-status__option"
								classList={{ "is-current": value === current }}
							>
								<input
									type="radio"
									name="next-status"
									value={value}
									checked={nextStatus() === value}
									disabled={busy() || value === current}
									onChange={() => setNextStatus(value)}
								/>
								<span>{statusLabel(value)}</span>
								<Show when={value === current}>
									<small>現在</small>
								</Show>
							</label>
						</li>
					)}
				</For>
			</ol>
		</fieldset>
	);

	const gradePane = (target: MaintainedSheetRow) => (
		<div class="correction-grade">
			<dl class="correction-grade__current">
				<dt>今の等級</dt>
				<dd>{target.gradeName || "未設定"}</dd>
			</dl>
			<label class="correction-field">
				<span>変更後の等級</span>
				<select
					value={String(nextGrade() ?? "")}
					disabled={busy() || grades.loading || !!grades.error}
					onChange={(event) => setNextGrade(Number(event.currentTarget.value) || null)}
				>
					<option value="">選んでください</option>
					<For each={gradeList().filter((grade) => grade.id !== target.gradeId)}>
						{(grade) => <option value={grade.id}>{grade.name}</option>}
					</For>
				</select>
			</label>
			<Show when={grades.error}>
				<p class="field-error" role="alert">
					等級の一覧を読み込めませんでした。({messageOf(grades.error, "")})
				</p>
			</Show>
			<div class="correction-danger">
				<p>共通評価で入力済みの点数とコメントは、すべて削除されます。この操作は取り消せません。</p>
				<p class="correction-pane__hint">
					等級で変わるのは共通評価の項目だけです。チャレンジ目標・期中目標・達成状況・点数・総評は変わりません。通知は送らず、削除した内容と理由を監査ログに残します。
				</p>
			</div>
		</div>
	);

	const deletePane = () => (
		<div class="correction-danger">
			<p>このシートを削除します。目標・評価・修正の記録もまとめて削除され、取り消せません。</p>
			<p class="correction-pane__hint">
				通知は送りません。削除前の内容と理由は監査ログに残ります。テストや誤って作ったシートの片付けに使います。
			</p>
		</div>
	);

	return (
		<div class="correction-page">
			<header class="master-header">
				<div>
					<h1>
						<ShieldAlert class="header-icon" />
						遡及処理
					</h1>
					<p class="correction-lead">
						評価シートの値と状態を、通常の手順を越えて直します。値を直せるのは締めた評価期間のシートだけで、直したことは本人と評価者のシートに「締め後修正」として赤字で表示されます。状態の変更と削除はどの評価期間のシートにもでき、当期のシートは作成時の等級も変えられます。これらは通知を送らずに監査ログへ記録します。
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
						fallback={<p class="page-note">評価期間はまだありません。</p>}
					>
						<div class="correction-layout">
							<section class="correction-picker" aria-labelledby="correction-sheets-heading">
								<h2 id="correction-sheets-heading">シート</h2>
								<label class="correction-picker__field">
									<span>評価期間</span>
									<select
										value={selectedPeriod() ?? ""}
										disabled={busy()}
										onChange={(event) => {
											const select = event.currentTarget;
											// 確認で取りやめたら、選択を元の期間に戻す
											void choosePeriod(Number(select.value)).then(() => {
												select.value = String(selectedPeriod() ?? "");
											});
										}}
									>
										<For each={periodList()}>
											{(entry) => (
												<option value={entry.id}>
													{entry.periodName}({entry.stateLabel})
												</option>
											)}
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
									when={sheets.state !== "pending"}
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
												{(entry) => (
													<li>
														<button
															type="button"
															aria-label={`${entry.employeeName}さんのシートを選ぶ`}
															aria-current={entry.sheetId === sheetId() ? "true" : undefined}
															disabled={busy()}
															onClick={() => void open(entry.sheetId)}
														>
															<span class="correction-sheet-list__no">{entry.employeeNo}</span>
															<span class="correction-sheet-list__name">{entry.employeeName}</span>
															<span class="correction-sheet-list__status">
																{statusLabel(entry.status)}
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
								<Show
									when={row()}
									fallback={<p class="correction-empty">左の一覧から、シートを選んでください。</p>}
								>
									{(target) => (
										<section class="correction-editor" aria-labelledby="correction-editor-heading">
											<header class="correction-editor__head">
												<h2 id="correction-editor-heading">
													{target().employeeName}さん({target().employeeNo})・{period()?.periodName}
												</h2>
												<p class="correction-editor__meta">
													<span>{statusLabel(target().status)}</span>
													<span>評価期間は{period()?.stateLabel}</span>
												</p>
											</header>
											<div
												class="correction-modes"
												role="tablist"
												aria-label="このシートに行う操作"
											>
												<For each={MODES}>
													{(entry) => (
														<button
															type="button"
															role="tab"
															id={`correction-mode-${entry.value}`}
															aria-selected={mode() === entry.value}
															aria-controls="correction-mode-panel"
															classList={{ "is-danger": entry.value === "delete" }}
															disabled={
																busy() ||
																(entry.value === "values" && !periodClosed()) ||
																(entry.value === "grade" && !canChangeGrade())
															}
															onClick={() => void chooseMode(entry.value)}
														>
															{entry.label}
														</button>
													)}
												</For>
											</div>
											<Show when={period()?.state !== "active"}>
												<p class="correction-pane__hint">
													等級を変えられるのは、当期(実施中の評価期間)のシートだけです。
												</p>
											</Show>
											<Show when={period()?.state === "active" && !canChangeGrade()}>
												<p class="correction-pane__hint">
													一次評価が確定したシートの等級は、先に状態を一次評価待ちまでに戻すと変えられます。
												</p>
											</Show>
											<Show when={!periodClosed()}>
												<p class="correction-pane__hint">
													値を直せるのは、締め済みの評価期間のシートだけです。締める前のシートの値は、本人と評価者がシートで直します。
												</p>
											</Show>
											<div
												id="correction-mode-panel"
												class="correction-pane"
												role="tabpanel"
												aria-labelledby={`correction-mode-${mode()}`}
											>
												<Switch>
													<Match when={mode() === "values"}>
														<Show when={sheet.error}>
															<div class="inline-alert" role="alert">
																<span>
																	{messageOf(sheet.error, "シートを読み込めませんでした。")}
																</span>
															</div>
														</Show>
														<Show
															when={!sheet.error && sheet()}
															fallback={
																<Show when={!sheet.error}>
																	<p class="page-note">シートを読み込んでいます...</p>
																</Show>
															}
														>
															{(loaded) => valuesPane(loaded)}
														</Show>
													</Match>
													<Match when={mode() === "status"}>{statusPane(target().status)}</Match>
													<Match when={mode() === "grade"}>{gradePane(target())}</Match>
													<Match when={mode() === "delete"}>{deletePane()}</Match>
												</Switch>
											</div>

											{/* 長いシートの下まで送らなくても、理由と確認にすぐ手が届くよう画面の下に留める */}
											<div class="correction-submit">
												<label class="correction-reason">
													<span>理由(必須・500 文字まで)</span>
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
													classList={{ danger: mode() === "delete" || mode() === "grade" }}
													disabled={!canSubmit()}
													onClick={() => void submit()}
												>
													{submitLabel()}
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
