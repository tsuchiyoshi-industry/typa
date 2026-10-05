import { useBeforeLeave, useNavigate, useParams } from "@solidjs/router";
import { Award, CalendarDays, FileText, User, Users } from "lucide-solid";
import { type Component, createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import {
	FINAL_EVALUATION_RANK_LETTERS,
	FINAL_EVALUATION_RANK_LEVEL_SYMBOLS,
	FINAL_EVALUATION_RANK_LEVELS,
} from "../../domain/valueObjects/FinalEvaluationRank";
import type { ChallengeEvaluationController } from "../controllers/ChallengeEvaluationController";
import type { CommonEvaluationController } from "../controllers/CommonEvaluationController";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { ChallengeEvaluationViewModel } from "../presenters/ChallengeEvaluationPresenter";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import ChallengeEvaluationView from "./components/ChallengeEvaluationView";
import CommonEvaluationView from "./components/CommonEvaluationView";
import OverallCommentSection, {
	type OverallCommentTarget,
} from "./components/OverallCommentSectionView";
import SheetStatusTrack from "./components/SheetStatusTrack";
import {
	clearUnsavedChanges,
	confirmAction,
	confirmDiscard,
	hasUnsavedChanges,
	showToast,
	trackUnsaved,
} from "./feedback";

interface SheetEditorViewProps {
	controller: SheetEditorController;
	viewModel: () => SheetEditorViewModel;
	commonEvaluationController: CommonEvaluationController;
	commonEvaluationViewModel: () => CommonEvaluationViewModel;
	challengeEvaluationController: ChallengeEvaluationController;
	challengeEvaluationViewModel: () => ChallengeEvaluationViewModel;
}

const SheetEditorView: Component<SheetEditorViewProps> = (props) => {
	const params = useParams();
	const navigate = useNavigate();
	const idParam = createMemo(() => params.id ?? "");
	const isNew = createMemo(() => idParam() === "new");
	const viewModel = props.viewModel;

	const sheet = createMemo(() => viewModel().sheet);
	const sheetId = createMemo(() => sheet()?.sheetId ?? null);
	const gradeId = createMemo(() => sheet()?.subject?.gradeId ?? null);
	const canEditFirst = createMemo(() => viewModel().canEditFirst);
	const canEditSecond = createMemo(() => viewModel().canEditSecond);
	const [firstOverallDraft, setFirstOverallDraft] = createSignal("");
	const [secondOverallDraft, setSecondOverallDraft] = createSignal("");
	const [savingOverallTarget, setSavingOverallTarget] = createSignal<OverallCommentTarget | null>(
		null,
	);
	const finalRankOptions = createMemo(() =>
		FINAL_EVALUATION_RANK_LETTERS.flatMap((letter) =>
			FINAL_EVALUATION_RANK_LEVELS.map((level) => ({
				letter,
				level,
				value: `${letter}|${level}`,
				label: `${letter}${FINAL_EVALUATION_RANK_LEVEL_SYMBOLS[level]}`,
			})),
		),
	);
	const selectedFinalRankValue = createMemo(() => {
		const finalEvaluationRank = sheet()?.finalEvaluationRank;
		if (!finalEvaluationRank) {
			return "";
		}
		return `${finalEvaluationRank.letter}|${finalEvaluationRank.level}`;
	});

	createEffect(() => {
		if (isNew()) {
			props.controller.prepareNewSheet();
			void props.controller.loadPeriods();
			return;
		}

		const routeSheetId = Number(idParam());
		if (!Number.isNaN(routeSheetId)) {
			void props.controller.loadPeriods();
			void props.controller.loadAccessibleSheets();
			void props.controller.loadSheet(routeSheetId);
		}
	});

	createEffect(() => {
		const currentSheetId = sheetId();
		// sheet() を購読し、保存後の再取得でも権限を取り直す
		if (sheet() && currentSheetId) {
			void props.controller.loadRoles(currentSheetId);
		}
	});

	// 総評の下書きは「別のシートを開いたとき」だけサーバーの値で初期化する。
	// 他の欄の保存(再取得)で書きかけの総評を消さないため、sheet() 全体は購読しない。
	createEffect(
		on(sheetId, () => {
			const currentSheet = sheet();
			setFirstOverallDraft(currentSheet?.firstOverallComment ?? "");
			setSecondOverallDraft(currentSheet?.secondOverallComment ?? "");
		}),
	);

	const firstOverallDirty = () =>
		canEditFirst() && firstOverallDraft() !== (sheet()?.firstOverallComment ?? "");
	const secondOverallDirty = () =>
		canEditSecond() && secondOverallDraft() !== (sheet()?.secondOverallComment ?? "");

	trackUnsaved("overall-comment", () => firstOverallDirty() || secondOverallDirty());

	// 未保存の入力があるままページを離れようとしたら確認する
	useBeforeLeave((event) => {
		if (event.defaultPrevented || !hasUnsavedChanges()) {
			return;
		}
		event.preventDefault();
		void confirmDiscard().then((discard) => {
			if (discard) {
				clearUnsavedChanges();
				event.retry(true);
			}
		});
	});

	const handleCreateSheet = async () => {
		const newSheetId = await props.controller.createSheet([]);
		if (newSheetId) {
			showToast("success", "評価シートを作成しました");
			navigate(`/sheet/${newSheetId}`);
		}
	};

	/** 保存後の再取得。画面を消さずに裏で読み直す。 */
	const reloadCurrentSheetFromRoute = () => {
		const id = Number(idParam());
		if (!Number.isNaN(id)) {
			void props.controller.loadSheet(id, true);
		}
	};

	const saveOverallComment = async (target: OverallCommentTarget) => {
		setSavingOverallTarget(target);
		const success = await props.controller.updateOverallComment(
			target,
			target === "first" ? firstOverallDraft() : secondOverallDraft(),
		);
		setSavingOverallTarget(null);
		if (success) {
			// サーバー側で整形された場合に「未保存」が残らないよう、保存結果に合わせる
			if (target === "first") {
				setFirstOverallDraft(sheet()?.firstOverallComment ?? "");
			} else {
				setSecondOverallDraft(sheet()?.secondOverallComment ?? "");
			}
			showToast("success", "総評を保存しました");
		}
	};

	/** ステータスを変えると編集権限も変わるため、入力中の内容は先に保存してもらう。 */
	const ensureNothingUnsaved = () => {
		if (!hasUnsavedChanges()) {
			return true;
		}
		showToast("info", "入力中の内容があります", "先に保存するかキャンセルしてください。");
		return false;
	};

	const changeStatus = async (
		status: "draft" | "submitted",
		asFinalization: boolean,
		doneMessage: string,
	) => {
		const success = await props.controller.updateStatus(status, asFinalization);
		if (success) {
			showToast("success", doneMessage);
			reloadCurrentSheetFromRoute();
		}
	};

	const handleSubmitSheet = async () => {
		if (!ensureNothingUnsaved()) {
			return;
		}
		const confirmed = await confirmAction({
			title: "評価シートを提出しますか？",
			message:
				"提出すると目標は編集できなくなり、評価者が評価を入力できるようになります。評価が確定するまでは、下書きに戻して編集し直せます。",
			confirmLabel: "提出する",
		});
		if (confirmed) {
			await changeStatus("submitted", false, "評価シートを提出しました");
		}
	};

	const handleRevertSheet = async () => {
		if (!ensureNothingUnsaved()) {
			return;
		}
		const confirmed = await confirmAction({
			title: "下書きに戻しますか？",
			message: "下書きに戻すと目標を編集できるようになります。編集後はもう一度提出してください。",
			confirmLabel: "下書きに戻す",
		});
		if (confirmed) {
			await changeStatus("draft", false, "下書きに戻しました");
		}
	};

	const handleFinalize = async () => {
		if (!ensureNothingUnsaved()) {
			return;
		}
		const confirmed = await confirmAction({
			title: "評価を確定しますか？",
			message:
				"確定すると評価シートはロックされ、本人も評価者も変更できなくなります。確定の通知メールも送信されます。この操作は取り消せません。",
			confirmLabel: "評価を確定する",
			tone: "danger",
		});
		if (confirmed) {
			await changeStatus("submitted", true, "評価を確定しました");
		}
	};

	const handleFinalRankChange = async (value: string) => {
		const option = finalRankOptions().find((item) => item.value === value);
		if (!option) {
			return;
		}
		const success = await props.controller.decideFinalEvaluationRank(option.letter, option.level);
		if (success) {
			showToast("success", `最終評価ランクを ${option.label} に保存しました`);
		}
	};

	const toSubjectOption = (sheet: SheetSummaryDto) => ({
		sheetId: sheet.id,
		periodId: sheet.periodId,
		employeeId: sheet.employeeId,
		employeeName: sheet.employeeName,
		employeeNo: sheet.employeeNo,
	});

	const dedupeSubjectOptions = (sheets: SheetSummaryDto[]) => {
		const seen = new Set<string>();
		return sheets
			.filter((item) => item.periodId === sheet()?.evaluationPeriod?.id)
			.map(toSubjectOption)
			.filter((item) => {
				if (seen.has(item.employeeNo)) {
					return false;
				}
				seen.add(item.employeeNo);
				return true;
			});
	};

	const mySubjectOptions = createMemo(() =>
		dedupeSubjectOptions(viewModel().accessibleSheets.mySheets),
	);

	const subordinateSubjectOptions = createMemo(() =>
		dedupeSubjectOptions(viewModel().accessibleSheets.subordinateSheets),
	);

	const formatSubjectOption = (name: string, employeeNo: string) => `${name}（${employeeNo}）`;

	const SubjectSwitcher = () => {
		let selectRef: HTMLSelectElement | undefined;

		const isCurrentIdInList = createMemo(() => {
			const id = idParam();
			return (
				mySubjectOptions().some((o) => String(o.sheetId) === id) ||
				subordinateSubjectOptions().some((o) => String(o.sheetId) === id)
			);
		});

		// optionリストが変わった後、命令的にvalueを強制セット
		createEffect(() => {
			const id = idParam();
			// isCurrentIdInList()を購読して、option追加後に再実行させる
			isCurrentIdInList();
			mySubjectOptions();
			subordinateSubjectOptions();

			if (selectRef) {
				selectRef.value = id;
			}
		});

		const handleSubjectChange = async (selectedSheetId: string) => {
			if (selectedSheetId === idParam()) {
				return;
			}
			if (!(await confirmDiscard())) {
				// 移動をやめたので、セレクトの表示を今のシートに戻す
				if (selectRef) {
					selectRef.value = idParam();
				}
				return;
			}
			clearUnsavedChanges();
			navigate(`/sheet/${selectedSheetId}`);
		};

		return (
			<label class="subject-switcher">
				<Users class="subject-switcher__icon" />
				<span class="visually-hidden">表示する評価対象者</span>
				<select
					ref={selectRef}
					id="subject-select"
					class="subject-select"
					disabled={viewModel().loadingAccessibleSheets || viewModel().loadingSheet}
					onChange={(event) => void handleSubjectChange(event.currentTarget.value)}
				>
					<Show when={!isCurrentIdInList()}>
						<option value={idParam()}>
							{(() => {
								const subject = sheet()?.subject;
								return subject
									? formatSubjectOption(subject.name, subject.employeeNo)
									: "読み込み中...";
							})()}
						</option>
					</Show>
					<Show when={mySubjectOptions().length > 0}>
						<optgroup label="自分">
							<For each={mySubjectOptions()}>
								{(item) => (
									<option value={String(item.sheetId)}>
										{formatSubjectOption(item.employeeName, item.employeeNo)}
									</option>
								)}
							</For>
						</optgroup>
					</Show>
					<Show when={subordinateSubjectOptions().length > 0}>
						<optgroup label="部下">
							<For each={subordinateSubjectOptions()}>
								{(item) => (
									<option value={String(item.sheetId)}>
										{formatSubjectOption(item.employeeName, item.employeeNo)}
									</option>
								)}
							</For>
						</optgroup>
					</Show>
				</select>
			</label>
		);
	};

	const ProfileCards = () => (
		<section class="sheet-info-card">
			<div class="info-grid">
				<div class="info-item">
					<User class="info-icon" />
					<div class="info-content">
						<span class="info-label">評価対象者</span>
						<span class="info-value">{sheet()?.subject?.name ?? "—"}</span>
						<span class="info-meta">
							{sheet()?.subject?.employeeNo ?? "—"} / {sheet()?.subject?.gradeName ?? "—"}
						</span>
					</div>
				</div>
				<div class="info-item">
					<CalendarDays class="info-icon" />
					<div class="info-content">
						<span class="info-label">評価期間</span>
						<span class="info-value">{sheet()?.evaluationPeriod?.periodName ?? "—"}</span>
						<span class="info-meta">
							{sheet()?.evaluationPeriod?.startDate ?? "—"} 〜{" "}
							{sheet()?.evaluationPeriod?.endDate ?? "—"}
						</span>
					</div>
				</div>
				<div class="info-item">
					<Users class="info-icon" />
					<div class="info-content">
						<span class="info-label">評価者</span>
						<div class="evaluator-list">
							<span class="evaluator-item">
								<span class="evaluator-badge">1次</span>
								{sheet()?.primaryEvaluator ?? "未設定"}
							</span>
							<span class="evaluator-item">
								<span class="evaluator-badge">2次</span>
								{sheet()?.secondaryEvaluator ?? "未設定"}
							</span>
						</div>
					</div>
				</div>
			</div>
		</section>
	);

	const FinalEvaluationRankSection = () => (
		<Show when={canEditSecond()}>
			<section class="final-rank-panel">
				<div class="final-rank-panel__title">
					<Award class="section-icon" />
					<div>
						<h2>最終評価ランク</h2>
						<p>二次評価者が決定します。選ぶとすぐに保存されます。</p>
					</div>
				</div>
				<label class="final-rank-selector" for="final-rank-select">
					<span class="visually-hidden">最終評価ランク</span>
					<select
						id="final-rank-select"
						value={selectedFinalRankValue()}
						disabled={viewModel().updatingFinalEvaluationRank}
						onChange={(event) => void handleFinalRankChange(event.currentTarget.value)}
					>
						<option value="" disabled>
							未決定
						</option>
						<For each={finalRankOptions()}>
							{(option) => <option value={option.value}>{option.label}</option>}
						</For>
					</select>
				</label>
				<Show when={viewModel().finalEvaluationRankUpdateError}>
					<p class="error-message" role="alert">
						{viewModel().finalEvaluationRankUpdateError}
					</p>
				</Show>
			</section>
		</Show>
	);

	const NewSheetSetup = () => (
		<div class="new-sheet-setup">
			<h2>評価期間を選んで作成</h2>
			<Show when={viewModel().fetchError}>
				<p class="error-message" role="alert">
					{viewModel().fetchError}
				</p>
			</Show>
			<div class="period-picker">
				<label for="period-select">
					<CalendarDays class="select-icon" />
					評価対象期間
				</label>
				<select
					id="period-select"
					value={viewModel().selectedPeriodId ?? ""}
					onChange={(e) =>
						props.controller.setSelectedPeriod(Number(e.currentTarget.value) || null)
					}
				>
					<option value="" disabled>
						期間を選択してください
					</option>
					<For each={viewModel().periods}>
						{(period) => <option value={period.id}>{period.periodName}</option>}
					</For>
				</select>
			</div>
			<button
				type="button"
				class="create-sheet-button"
				onClick={handleCreateSheet}
				disabled={viewModel().creating || viewModel().selectedPeriodId == null}
			>
				{viewModel().creating ? "作成中..." : "評価シートを作成"}
			</button>
			<Show when={viewModel().createError}>
				<p class="error-message" role="alert">
					{viewModel().createError}
				</p>
			</Show>
		</div>
	);

	return (
		<div class="dashboard-page">
			<header class="sheet-header">
				<div class="sheet-header__main">
					<h1>
						<FileText class="header-icon" />
						{isNew() ? "新規評価シート" : "評価シート"}
					</h1>
					<Show when={!isNew()}>
						<SubjectSwitcher />
					</Show>
				</div>
				<Show when={!isNew() && sheet()}>
					<SheetStatusTrack
						status={sheet()?.status ?? "draft"}
						canSubmit={viewModel().canSubmitOwnSheet}
						canRevert={viewModel().canRevertOwnSheetToDraft}
						canFinalize={viewModel().canFinalizeAsSecondaryEvaluator}
						updating={viewModel().updatingStatus}
						notice={viewModel().statusUpdateError}
						onSubmit={() => void handleSubmitSheet()}
						onRevert={() => void handleRevertSheet()}
						onFinalize={() => void handleFinalize()}
					/>
				</Show>
			</header>

			<Show
				when={!viewModel().loadingSheet}
				fallback={<p class="page-note">評価シートを読み込んでいます...</p>}
			>
				<Show when={!isNew()} fallback={<NewSheetSetup />}>
					<Show when={viewModel().fetchError}>
						<p class="error-message" role="alert">
							{viewModel().fetchError}
						</p>
					</Show>
					{/* keyed にしない: 保存後の再取得で子の状態(選択中の目標タブなど)を保つ */}
					<Show
						when={sheet()?.subject}
						fallback={
							<Show when={!viewModel().fetchError}>
								<p class="page-note">評価シートのデータを取得できませんでした。</p>
							</Show>
						}
					>
						{(subject) => (
							<>
								<ProfileCards />
								<FinalEvaluationRankSection />
								<ChallengeEvaluationView
									sheetId={sheetId()}
									objectives={sheet()?.objectives ?? []}
									subject={subject()}
									canEditFirst={canEditFirst()}
									canEditSecond={canEditSecond()}
									canEditMilestoneGoal={viewModel().canEditMilestoneGoal}
									canViewSecondEvaluation={viewModel().canViewSecondEvaluation}
									controller={props.challengeEvaluationController}
									viewModel={props.challengeEvaluationViewModel}
									onUpdated={reloadCurrentSheetFromRoute}
								/>
								<Show when={viewModel().canViewCommonEvaluation}>
									<CommonEvaluationView
										sheetId={sheetId()}
										gradeId={gradeId()}
										canEditFirst={canEditFirst()}
										canEditSecond={canEditSecond()}
										canViewSecondEvaluation={viewModel().canViewSecondEvaluation}
										controller={props.commonEvaluationController}
										viewModel={props.commonEvaluationViewModel}
										onUpdated={reloadCurrentSheetFromRoute}
									/>
								</Show>
								<OverallCommentSection
									canEditFirst={canEditFirst()}
									canEditSecond={canEditSecond()}
									firstOverallComment={firstOverallDraft()}
									secondOverallComment={secondOverallDraft()}
									firstDirty={firstOverallDirty()}
									secondDirty={secondOverallDirty()}
									savingTarget={savingOverallTarget()}
									onFirstOverallCommentChange={setFirstOverallDraft}
									onSecondOverallCommentChange={setSecondOverallDraft}
									onSave={(target) => void saveOverallComment(target)}
									updateError={viewModel().overallCommentUpdateError}
								/>
							</>
						)}
					</Show>
				</Show>
			</Show>
		</div>
	);
};

export default SheetEditorView;
