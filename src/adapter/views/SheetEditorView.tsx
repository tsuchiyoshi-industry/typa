import { A, useBeforeLeave, useNavigate, useParams } from "@solidjs/router";
import Award from "lucide-solid/icons/award";
import CalendarDays from "lucide-solid/icons/calendar-days";
import FileText from "lucide-solid/icons/file-text";
import ShieldCheck from "lucide-solid/icons/shield-check";
import User from "lucide-solid/icons/user";
import Users from "lucide-solid/icons/users";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import type { EvaluationRankDto } from "../../application/dtos/EvaluationSheetDto";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import type { ChallengeEvaluationController } from "../controllers/ChallengeEvaluationController";
import type { CommonEvaluationController } from "../controllers/CommonEvaluationController";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { ChallengeEvaluationViewModel } from "../presenters/ChallengeEvaluationPresenter";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import { commonEvaluationRadar } from "../viewmodels/commonEvaluationRadar";
import ChallengeEvaluationView from "./components/ChallengeEvaluationView";
import CommonEvaluationView from "./components/CommonEvaluationView";
import OverallCommentSection, {
	type OverallCommentTarget,
} from "./components/OverallCommentSectionView";
import RadarChart from "./components/RadarChart";
import SheetStatusTrack from "./components/SheetStatusTrack";
import {
	clearUnsavedChanges,
	confirmAction,
	confirmDiscard,
	hasUnsavedChanges,
	showToast,
	trackUnsaved,
} from "./feedback";

export interface SheetEditorViewProps {
	/** Used by the review workspace to keep its caseload visible while editing. */
	embedded?: boolean;
	selectedSheetId?: number;
	onUpdated?: () => void;
	onSavingChange?: (saving: boolean) => void;
	/** 一次評価の確定・評価の確定が済んだとき。受け持ち画面が次の対象者へ進むのに使う。 */
	onStageCompleted?: () => void;
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
	const idParam = createMemo(() =>
		props.selectedSheetId != null ? String(props.selectedSheetId) : (params.id ?? ""),
	);
	const isNew = createMemo(() => idParam() === "new");
	const viewModel = props.viewModel;

	const sheet = createMemo(() => viewModel().sheet);
	const sheetId = createMemo(() => sheet()?.sheetId ?? null);
	const gradeId = createMemo(() => sheet()?.subject?.gradeId ?? null);
	const canEditFirst = createMemo(() => viewModel().canEditFirst);
	const canEditSecond = createMemo(() => viewModel().canEditSecond);
	const pendingEvaluationItems = createMemo(() => sheet()?.pendingEvaluationItems ?? []);
	const [attemptedConfirmation, setAttemptedConfirmation] = createSignal(false);
	let completionNotice: HTMLDivElement | undefined;
	createEffect(
		on(
			() => [sheetId(), sheet()?.status],
			() => setAttemptedConfirmation(false),
		),
	);
	const [firstOverallDraft, setFirstOverallDraft] = createSignal("");
	const [secondOverallDraft, setSecondOverallDraft] = createSignal("");
	const [savingOverallTarget, setSavingOverallTarget] = createSignal<OverallCommentTarget | null>(
		null,
	);
	const [savingChallenge, setSavingChallenge] = createSignal(false);
	const [savingCommon, setSavingCommon] = createSignal(false);
	const saving = () =>
		savingChallenge() ||
		savingCommon() ||
		savingOverallTarget() !== null ||
		viewModel().updatingStatus;
	createEffect(() => props.onSavingChange?.(saving()));
	onCleanup(() => props.onSavingChange?.(false));
	// 評価ランクは得点率で決まる。最終評価ランクは、最終評価者の評価が始まる段階から意味を持つ。
	const evaluationRanks = createMemo(() => {
		const current = sheet();
		const ranks: { label: string; rank: EvaluationRankDto }[] = [];
		if (!current) {
			return ranks;
		}
		if (current.firstEvaluationRank && !current.primaryIsFinalEvaluator) {
			ranks.push({ label: "一次評価ランク", rank: current.firstEvaluationRank });
		}
		if (
			current.finalEvaluationRank &&
			(current.primaryIsFinalEvaluator || current.finalEvaluationRank.confirmed || canEditSecond())
		) {
			ranks.push({ label: "最終評価ランク", rank: current.finalEvaluationRank });
		}
		return ranks;
	});
	// 確定した評価の内訳。共通評価を見られる人(評価者)にだけ、項目のタイトルごとの得点を図で見せる
	const radar = createMemo(() => {
		const current = sheet();
		const summary = props.commonEvaluationViewModel().summary;
		return current &&
			EvaluationStatus.from(current.status).isFinalized() &&
			viewModel().canViewCommonEvaluation &&
			summary?.results[0]?.sheetId === current.sheetId
			? commonEvaluationRadar(summary.results, current.primaryIsFinalEvaluator)
			: null;
	});
	const rankText = (rank: EvaluationRankDto | undefined) =>
		rank ? `${rank.displayText}（${rank.score} 点 / 100 点）` : "—";

	createEffect(() => {
		if (isNew()) {
			props.controller.prepareNewSheet();
			void props.controller.loadPeriods();
			return;
		}

		const routeSheetId = Number(idParam());
		if (!Number.isNaN(routeSheetId)) {
			if (!props.embedded) {
				void props.controller.loadPeriods();
				void props.controller.loadAccessibleSheets();
			}
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
		if (saving()) {
			event.preventDefault();
			showToast("info", "保存が完了するまでお待ちください");
			return;
		}
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
			props.onUpdated?.();
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
			props.onUpdated?.();
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

	/** notify: 確定の通知メールを送るか。送信の結果は、宛先ごとに後からトーストで届く。 */
	const changeStatus = async (status: EvaluationStatus, doneMessage: string, notify = true) => {
		const success = await props.controller.updateStatus(status, notify);
		if (success) {
			showToast("success", doneMessage);
			reloadCurrentSheetFromRoute();
		} else if (viewModel().statusUpdateError) {
			await confirmAction({
				title: "変更できませんでした",
				message: viewModel().statusUpdateError ?? "",
				confirmLabel: "閉じる",
				acknowledgeOnly: true,
				tone: "danger",
			});
		}
		return success;
	};

	const ensureObjectiveFieldsComplete = () => {
		const objectives = sheet()?.objectives ?? [];
		const missing = objectives.flatMap((objective) =>
			(
				[
					["チャレンジ目標", objective.challengeGoal],
					["中間目標", objective.midtermGoal],
					["達成状況", objective.achievement],
				] as const
			)
				.filter(([, value]) => !value.trim())
				.map(([label]) => `目標 ${objective.goalNumber}：${label}`),
		);
		if (objectives.length >= 1 && objectives.length <= 4 && missing.length === 0) {
			return true;
		}
		void confirmAction({
			title: "空欄のある目標は提出・確定できません",
			message:
				"目標は1〜4件必要です。すべての欄を入力して保存するか、不要なタブを削除してください。",
			details: missing,
			confirmLabel: "閉じる",
			acknowledgeOnly: true,
			tone: "danger",
		});
		return false;
	};

	const handleSubmitSheet = async () => {
		if (!ensureObjectiveFieldsComplete()) {
			return;
		}
		if (!ensureNothingUnsaved()) {
			return;
		}
		const confirmed = await confirmAction({
			title: "評価シートを提出しますか？",
			message:
				"提出すると目標は編集できなくなり、評価者に表示されて一次評価が始まります。一次評価が確定するまでは、下書きに戻して編集し直せます。",
			confirmLabel: "提出する",
		});
		if (confirmed) {
			await changeStatus(EvaluationStatus.SUBMITTED, "評価シートを提出しました");
		}
	};

	const handleRevertSheet = async () => {
		if (!ensureNothingUnsaved()) {
			return;
		}
		const confirmed = await confirmAction({
			title: "下書きに戻しますか？",
			message:
				"下書きに戻すと目標を編集できるようになり、評価者には表示されなくなります。編集後はもう一度提出してください。",
			confirmLabel: "下書きに戻す",
		});
		if (confirmed) {
			await changeStatus(EvaluationStatus.DRAFT, "下書きに戻しました");
		}
	};

	const handleConfirmFirst = async () => {
		if (!ensureObjectiveFieldsComplete()) {
			return;
		}
		if (!ensureNothingUnsaved() || !ensureEvaluationComplete()) {
			return;
		}
		let notify = true;
		const confirmed = await confirmAction({
			title: "一次評価を確定しますか？",
			message: `一次評価ランクは ${rankText(sheet()?.firstEvaluationRank)} です。確定すると一次評価は変更できなくなります。この操作は取り消せません。`,
			checkbox: {
				label: `二次評価者（${sheet()?.secondaryEvaluator ?? "未設定"}）に通知メールを送る`,
				onChange: (checked) => {
					notify = checked;
				},
			},
			confirmLabel: "一次評価を確定する",
			tone: "danger",
		});
		if (
			confirmed &&
			(await changeStatus(EvaluationStatus.FIRST_EVALUATED, "一次評価を確定しました", notify))
		) {
			props.onStageCompleted?.();
		}
	};

	const handleFinalize = async () => {
		if (!ensureObjectiveFieldsComplete()) {
			return;
		}
		if (!ensureNothingUnsaved() || !ensureEvaluationComplete()) {
			return;
		}
		// 二次評価者「なし」の社員では、確定を知らせる相手は一次評価者だけ
		const evaluators = [
			sheet()?.primaryEvaluator,
			sheet()?.primaryIsFinalEvaluator ? null : sheet()?.secondaryEvaluator,
		]
			.filter(Boolean)
			.join("・");
		let notify = true;
		const confirmed = await confirmAction({
			title: "評価を確定しますか？",
			message: `最終評価ランクは ${rankText(sheet()?.finalEvaluationRank)} です。確定すると評価シートはロックされ、本人も評価者も変更できなくなります。この操作は取り消せません。`,
			checkbox: {
				label: `評価者（${evaluators}）に通知メールを送る`,
				onChange: (checked) => {
					notify = checked;
				},
			},
			confirmLabel: "評価を確定する",
			tone: "danger",
		});
		if (
			confirmed &&
			(await changeStatus(EvaluationStatus.FINALIZED, "評価を確定しました", notify))
		) {
			props.onStageCompleted?.();
		}
	};

	const ensureEvaluationComplete = () => {
		if (pendingEvaluationItems().length === 0) {
			return true;
		}
		setAttemptedConfirmation(true);
		completionNotice?.focus({ preventScroll: true });
		completionNotice?.scrollIntoView?.({ block: "center", behavior: "smooth" });
		return false;
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

	const EvaluationRankSection = () => (
		<Show when={evaluationRanks().length}>
			<section class="final-rank-panel">
				<div class="final-rank-panel__title">
					<Award class="section-icon" />
					<div>
						<h2>評価ランク</h2>
						<p>
							得点率で自動的に決まります（95%以上 S / 90% A / 80% B+ / 60% B / 50% B- / 40% C /
							それ未満 D）。
						</p>
					</div>
				</div>
				<dl class="rank-summary">
					<For each={evaluationRanks()}>
						{(item) => (
							<div class="rank-summary__item" classList={{ confirmed: item.rank.confirmed }}>
								<dt>{item.label}</dt>
								<dd>
									<strong>{item.rank.displayText}</strong>
									<span>{item.rank.score} 点 / 100 点</span>
									<small>{item.rank.confirmed ? "確定" : "確定前の見込み"}</small>
								</dd>
							</div>
						)}
					</For>
				</dl>
				<Show when={radar()}>
					{(data) => <RadarChart title="共通評価の項目別の得点" {...data()} />}
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
		<div class="dashboard-page" classList={{ "review-editor": props.embedded }}>
			<Show when={!props.embedded && !isNew() && viewModel().canViewCommonEvaluation}>
				<A
					class="review-editor-entry"
					href={`/review?period=${sheet()?.evaluationPeriod?.id}&sheet=${sheetId()}&mode=evaluate`}
				>
					<Users size={16} />
					部下の一覧を見ながら評価する
				</A>
			</Show>
			<header class="sheet-header">
				<div class="sheet-header__main">
					<h1>
						<FileText class="header-icon" />
						{isNew() ? "新規評価シート" : "評価シート"}
					</h1>
					<Show when={!isNew() && !props.embedded}>
						<SubjectSwitcher />
					</Show>
				</div>
				<Show when={!isNew() && sheet()}>
					<SheetStatusTrack
						status={sheet()?.status ?? EvaluationStatus.DRAFT.toString()}
						primaryIsFinal={sheet()?.primaryIsFinalEvaluator ?? false}
						canSubmit={viewModel().canSubmitOwnSheet}
						canRevert={viewModel().canRevertOwnSheetToDraft}
						// 受け持ち画面では、評価の確定は入力を終えた先(末尾のバー)に置く
						canConfirmFirst={!props.embedded && viewModel().canConfirmFirstEvaluation}
						canFinalize={!props.embedded && viewModel().canFinalizeEvaluation}
						updating={viewModel().updatingStatus}
						notice={viewModel().statusUpdateError}
						onSubmit={() => void handleSubmitSheet()}
						onRevert={() => void handleRevertSheet()}
						onConfirmFirst={() => void handleConfirmFirst()}
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
								<EvaluationRankSection />
								<Show when={pendingEvaluationItems().length > 0}>
									<div
										ref={completionNotice}
										class="evaluation-completion"
										classList={{ invalid: attemptedConfirmation() }}
										tabIndex={-1}
										role={attemptedConfirmation() ? "alert" : "status"}
									>
										<p>
											<strong>自分の評価: あと {pendingEvaluationItems().length} 件</strong>
										</p>
										<p>確定する前に、すべての評価を 1〜4 で設定して保存してください。</p>
										<details open={attemptedConfirmation()}>
											<summary>未設定の項目を確認する</summary>
											<ul>
												<For each={pendingEvaluationItems()}>{(item) => <li>{item}</li>}</For>
											</ul>
										</details>
									</div>
								</Show>
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
									onSavingChange={setSavingChallenge}
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
										onSavingChange={setSavingCommon}
									/>
								</Show>
								<OverallCommentSection
									canEditFirst={canEditFirst()}
									canEditSecond={canEditSecond()}
									canViewFirst={viewModel().canViewCommonEvaluation}
									canViewSecond={viewModel().canViewSecondEvaluation}
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
								<Show
									when={
										props.embedded &&
										(viewModel().canConfirmFirstEvaluation || viewModel().canFinalizeEvaluation)
									}
								>
									<footer class="review-action-bar">
										<div>
											<ShieldCheck size={18} />
											<Show
												when={viewModel().canFinalizeEvaluation}
												fallback={
													<>
														<span>一次評価ランク {rankText(sheet()?.firstEvaluationRank)}</span>
														<small>
															確定すると一次評価は変更できなくなります。二次評価者に通知するかは、確定のときに選べます。
														</small>
													</>
												}
											>
												<span>最終評価ランク {rankText(sheet()?.finalEvaluationRank)}</span>
												<small>確定すると評価シートはロックされ、変更できなくなります。</small>
											</Show>
										</div>
										<button
											type="button"
											class="primary-action finalize"
											disabled={saving()}
											onClick={() =>
												void (viewModel().canFinalizeEvaluation
													? handleFinalize()
													: handleConfirmFirst())
											}
										>
											{viewModel().updatingStatus
												? "確定中..."
												: viewModel().canFinalizeEvaluation
													? sheet()?.primaryIsFinalEvaluator
														? "評価を確定する"
														: "二次評価を確定する"
													: "一次評価を確定する"}
										</button>
									</footer>
								</Show>
							</>
						)}
					</Show>
				</Show>
			</Show>
		</div>
	);
};

export default SheetEditorView;
