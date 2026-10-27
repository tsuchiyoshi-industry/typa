import { A, useBeforeLeave, useNavigate, useParams } from "@solidjs/router";
import FileText from "lucide-solid/icons/file-text";
import Users from "lucide-solid/icons/users";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	on,
	onCleanup,
	Show,
} from "solid-js";
import type { PendingEvaluationItemDto } from "../../application/dtos/EvaluationSheetDto";
import { messageOf } from "../../application/errorMessage";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import type { ChallengeEvaluationController } from "../controllers/ChallengeEvaluationController";
import type { CommonEvaluationController } from "../controllers/CommonEvaluationController";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { ChallengeEvaluationViewModel } from "../presenters/ChallengeEvaluationPresenter";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import CommonEvaluationView from "./components/CommonEvaluationView";
import EvaluationCompletionNotice from "./components/EvaluationCompletionNotice";
import EvaluationRankPanel from "./components/EvaluationRankPanel";
import GoalTerms, { type GoalTerm } from "./components/GoalTerms";
import NewSheetSetup from "./components/NewSheetSetup";
import OverallCommentSection, {
	type OverallCommentTarget,
} from "./components/OverallCommentSectionView";
import ReviewActionBar from "./components/ReviewActionBar";
import SheetCorrectionsNotice from "./components/SheetCorrectionsNotice";
import SheetProfileCard from "./components/SheetProfileCard";
import SheetStatusTrack from "./components/SheetStatusTrack";
import SubjectSwitcher from "./components/SubjectSwitcher";
import {
	clearUnsavedChanges,
	confirmDiscard,
	hasUnsavedChanges,
	showToast,
	trackUnsaved,
} from "./feedback";
import { createSheetStatusActions } from "./sheetStatusActions";

export interface SheetEditorViewProps {
	/** Used by the review workspace to keep its caseload visible while editing. */
	embedded?: boolean;
	selectedSheetId?: number;
	onUpdated?: () => void;
	onSavingChange?: (saving: boolean) => void;
	/** 一次評価の確定・評価の確定が済んだとき。受け持ち画面が次の対象者へ進むのに使う。 */
	onStageCompleted?: () => void;
	/** 確定の後に進む「次の対象者」の名前。確定の確認で案内するときに呼ぶ。いなければ undefined。 */
	announceNext?: () => string | undefined;
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
	/** 対象者まで読めたシート。読めるまで本文を出さない。 */
	const loaded = createMemo(() => {
		const current = sheet();
		return current?.subject ? { sheet: current, subject: current.subject } : null;
	});
	const pendingEvaluationItems = createMemo(() => sheet()?.pendingEvaluationItems ?? []);

	createEffect(() => {
		if (isNew()) {
			props.controller.prepareNewSheet();
			void props.controller.loadPeriods();
			// 作成済みの期間を選べないよう、自分のシートも読む
			void props.controller.loadAccessibleSheets();
			return;
		}
		const routeSheetId = Number(idParam());
		if (!Number.isNaN(routeSheetId)) {
			if (!props.embedded) {
				void props.controller.loadAccessibleSheets();
			}
			void props.controller.loadSheet(routeSheetId);
		}
	});

	/** 保存後の再取得。画面を消さずに裏で読み直す。 */
	const reloadSheet = () => {
		const id = Number(idParam());
		if (Number.isNaN(id)) {
			return;
		}
		props.onUpdated?.();
		return props.controller.loadSheet(id, true);
	};

	// 別のシートを開いたら、当期の目標から見せる
	const [term, setTerm] = createSignal<GoalTerm>("current");
	createEffect(on(sheetId, () => setTerm("current")));

	// --- 総評の下書き ---
	// 「別のシートを開いたとき」だけサーバーの値で初期化する。
	// 他の欄の保存(再取得)で書きかけの総評を消さないため、sheet() 全体は購読しない。
	const [firstOverallDraft, setFirstOverallDraft] = createSignal("");
	const [secondOverallDraft, setSecondOverallDraft] = createSignal("");
	const [savingOverallTarget, setSavingOverallTarget] = createSignal<OverallCommentTarget | null>(
		null,
	);
	createEffect(
		on(sheetId, () => {
			setFirstOverallDraft(sheet()?.firstOverallComment ?? "");
			setSecondOverallDraft(sheet()?.secondOverallComment ?? "");
		}),
	);
	const firstOverallDirty = () =>
		viewModel().canEditFirst && firstOverallDraft() !== (sheet()?.firstOverallComment ?? "");
	const secondOverallDirty = () =>
		viewModel().canEditSecond && secondOverallDraft() !== (sheet()?.secondOverallComment ?? "");
	trackUnsaved("overall-comment", () => firstOverallDirty() || secondOverallDirty());

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

	// --- 保存中 ---
	const [savingChallenge, setSavingChallenge] = createSignal(false);
	const [savingCommon, setSavingCommon] = createSignal(false);
	const saving = () =>
		savingChallenge() ||
		savingCommon() ||
		savingOverallTarget() !== null ||
		viewModel().updatingStatus;
	createEffect(() => props.onSavingChange?.(saving()));
	onCleanup(() => props.onSavingChange?.(false));

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

	// --- 確定前の未設定項目 ---
	const [attemptedConfirmation, setAttemptedConfirmation] = createSignal(false);
	createEffect(
		on(
			() => [sheetId(), sheet()?.status],
			() => setAttemptedConfirmation(false),
		),
	);
	let completionNotice: HTMLDivElement | undefined;
	const ensureEvaluationComplete = () => {
		if (pendingEvaluationItems().length === 0) {
			return true;
		}
		setAttemptedConfirmation(true);
		completionNotice?.focus({ preventScroll: true });
		completionNotice?.scrollIntoView?.({ block: "center", behavior: "smooth" });
		return false;
	};
	/** 未設定の項目へ移る。目標はそのタブを選び(入力中なら破棄を確かめる)、共通評価はその行へ送る。 */
	const showPending = (item: PendingEvaluationItemDto) => {
		if (item.goalNumber != null) {
			setTerm("current");
		}
		const element = document.getElementById(
			item.goalNumber != null ? `objective-tab-${item.goalNumber}` : `common-item-${item.itemId}`,
		);
		if (item.goalNumber != null) {
			element?.click();
		}
		element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
		element?.focus({ preventScroll: true });
	};

	const status = createSheetStatusActions({
		controller: props.controller,
		viewModel,
		ensureEvaluationComplete,
		onUpdated: () => props.onUpdated?.(),
		onStageCompleted: () => props.onStageCompleted?.(),
		backToReview: props.embedded ? undefined : () => navigate("/review"),
		announceNext: props.announceNext,
	});

	const handleCreateSheet = async () => {
		const newSheetId = await props.controller.createSheet();
		if (newSheetId) {
			showToast("success", "評価シートを作成しました");
			navigate(`/sheet/${newSheetId}`);
		}
	};

	const handleSubjectChange = async (selectedSheetId: string) => {
		if (!(await confirmDiscard())) {
			return false;
		}
		clearUnsavedChanges();
		navigate(`/sheet/${selectedSheetId}`);
		return true;
	};

	const [resending, setResending] = createSignal(false);
	const resendNotification = async () => {
		setResending(true);
		try {
			await props.controller.resendNotification();
		} catch (error) {
			showToast("error", messageOf(error, "通知を再送できませんでした。"));
		} finally {
			setResending(false);
		}
	};

	return (
		<div class="dashboard-page" classList={{ "review-editor": props.embedded }}>
			<Show when={!props.embedded && !isNew() && viewModel().canViewCommonEvaluation}>
				<A
					class="review-editor-entry"
					href={`/review?period=${sheet()?.evaluationPeriod?.id}&sheet=${sheetId()}`}
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
						<SubjectSwitcher
							sheetId={idParam()}
							periodId={sheet()?.evaluationPeriod?.id}
							subject={sheet()?.subject}
							sheets={viewModel().accessibleSheets}
							disabled={viewModel().loadingAccessibleSheets || viewModel().loadingSheet}
							onPick={handleSubjectChange}
						/>
					</Show>
				</div>
				<Show when={!isNew() && sheet()}>
					<SheetStatusTrack
						status={sheet()?.status ?? EvaluationStatus.DRAFT.toString()}
						primaryIsFinal={sheet()?.primaryIsFinalEvaluator ?? false}
						canSubmit={viewModel().canSubmitGoals}
						canRevert={viewModel().canReturnGoalsToDraft}
						canConfirmGoals={viewModel().canConfirmGoals}
						canRequestFirst={viewModel().canRequestFirstEvaluation}
						// 受け持ち画面では、評価の確定は入力を終えた先(末尾のバー)に置く
						canConfirmFirst={!props.embedded && viewModel().canConfirmFirstEvaluation}
						canFinalize={!props.embedded && viewModel().canFinalizeEvaluation}
						updating={viewModel().updatingStatus}
						busy={saving()}
						notice={viewModel().statusUpdateError}
						onSubmit={() => void status.submitGoals()}
						onRevert={() => void status.returnGoals()}
						onConfirmGoals={() => void status.confirmGoals()}
						onRequestFirst={() => void status.requestFirst()}
						onConfirmFirst={() => void status.confirmFirst()}
						onFinalize={() => void status.finalize()}
					/>
				</Show>
				<Show when={viewModel().canResendNotification}>
					<button
						type="button"
						class="secondary-action"
						disabled={resending() || saving()}
						onClick={() => void resendNotification()}
					>
						{resending() ? "送信中…" : "通知を再送"}
					</button>
				</Show>
			</header>

			<Show
				when={!viewModel().loadingSheet}
				fallback={<p class="page-note">評価シートを読み込んでいます...</p>}
			>
				<Show
					when={!isNew()}
					fallback={
						<NewSheetSetup
							viewModel={viewModel()}
							onSelectPeriod={(id) => props.controller.setSelectedPeriod(id)}
							onCreate={() => void handleCreateSheet()}
						/>
					}
				>
					<Show when={viewModel().fetchError}>
						<p class="error-message" role="alert">
							{viewModel().fetchError}
						</p>
					</Show>
					{/* keyed にしない: 保存後の再取得で子の状態(選択中の目標タブなど)を保つ */}
					<Show
						when={loaded()}
						fallback={
							<Show when={!viewModel().fetchError}>
								<p class="page-note">評価シートのデータを取得できませんでした。</p>
							</Show>
						}
					>
						{(loadedSheet) => {
							const current = () => loadedSheet().sheet;
							return (
								<>
									<SheetProfileCard sheet={current()} />
									<EvaluationRankPanel
										sheet={current()}
										canEditSecond={viewModel().canEditSecond}
										canViewCommonEvaluation={viewModel().canViewCommonEvaluation}
									/>
									<EvaluationCompletionNotice
										ref={(element) => {
											completionNotice = element;
										}}
										items={pendingEvaluationItems()}
										attempted={attemptedConfirmation()}
										onShow={showPending}
									/>
									<SheetCorrectionsNotice corrections={current().corrections} />
									<GoalTerms
										sheet={current()}
										subject={loadedSheet().subject}
										viewModel={viewModel()}
										term={term()}
										onTermChange={setTerm}
										controller={props.challengeEvaluationController}
										challengeViewModel={props.challengeEvaluationViewModel}
										onUpdated={reloadSheet}
										onSavingChange={setSavingChallenge}
									/>
									<Show when={viewModel().canViewCommonEvaluation}>
										<CommonEvaluationView
											sheetId={sheetId()}
											summary={current().commonEvaluation}
											canEditFirst={viewModel().canEditFirst}
											canEditSecond={viewModel().canEditSecond}
											canViewSecondEvaluation={viewModel().canViewSecondEvaluation}
											controller={props.commonEvaluationController}
											viewModel={props.commonEvaluationViewModel}
											onUpdated={reloadSheet}
											onSavingChange={setSavingCommon}
										/>
									</Show>
									<OverallCommentSection
										canEditFirst={viewModel().canEditFirst}
										canEditSecond={viewModel().canEditSecond}
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
										<ReviewActionBar
											finalizing={viewModel().canFinalizeEvaluation}
											primaryIsFinal={current().primaryIsFinalEvaluator}
											rank={
												viewModel().canFinalizeEvaluation
													? current().finalEvaluationRank
													: current().firstEvaluationRank
											}
											updating={viewModel().updatingStatus}
											busy={saving()}
											onConfirm={() =>
												void (viewModel().canFinalizeEvaluation
													? status.finalize()
													: status.confirmFirst())
											}
										/>
									</Show>
								</>
							);
						}}
					</Show>
				</Show>
			</Show>
		</div>
	);
};

export default SheetEditorView;
