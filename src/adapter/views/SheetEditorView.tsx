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
	createResource,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import type {
	EvaluationRankDto,
	PendingEvaluationItemDto,
} from "../../application/dtos/EvaluationSheetDto";
import type { SheetSummaryDto } from "../../application/dtos/SheetListDto";
import { messageOf } from "../../application/errorMessage";
import { EvaluationRank } from "../../domain/valueObjects/EvaluationRank";
import { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import type { ChallengeEvaluationController } from "../controllers/ChallengeEvaluationController";
import type { CommonEvaluationController } from "../controllers/CommonEvaluationController";
import type { SheetEditorController } from "../controllers/SheetEditorController";
import type { ChallengeEvaluationViewModel } from "../presenters/ChallengeEvaluationPresenter";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import { commonEvaluationRadar } from "../viewmodels/commonEvaluationRadar";
import ChallengeEvaluationView, { type GoalFocus } from "./components/ChallengeEvaluationView";
import CommonEvaluationView from "./components/CommonEvaluationView";
import OverallCommentSection, {
	type OverallCommentTarget,
} from "./components/OverallCommentSectionView";
import PreviousGoalsView, { type CarryMode } from "./components/PreviousGoalsView";
import RadarChart from "./components/RadarChart";
import SearchableEvaluatorSelect from "./components/SearchableEvaluatorSelect";
import SheetCorrectionsNotice from "./components/SheetCorrectionsNotice";
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
	const canEditFirst = createMemo(() => viewModel().canEditFirst);
	const canEditSecond = createMemo(() => viewModel().canEditSecond);
	const pendingEvaluationItems = createMemo(() => sheet()?.pendingEvaluationItems ?? []);
	const [resending, setResending] = createSignal(false);
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

	// 前期の目標。今期の目標が増減するたびに読み直す(引き継いだ目標を消すと、また選べる)
	const [previousGoals] = createResource(
		() => {
			const id = sheetId();
			const revision = (sheet()?.objectives ?? []).map((goal) => `${goal.id}:${goal.goalNumber}`);
			return id ? { id, revision: revision.join(",") } : false;
		},
		({ id }) => props.challengeEvaluationController.loadPreviousGoals(id),
	);
	const [goalFocus, setGoalFocus] = createSignal<GoalFocus | null>(null);
	const [carrying, setCarrying] = createSignal<number | null>(null);
	/** 今期の目標に、引き継ぐ空きがあるか。何も書いていない目標は、引き継ぎで埋まる。 */
	const hasRoomForGoal = () => {
		const goals = sheet()?.objectives ?? [];
		return (
			goals.length < (sheet()?.maxObjectives ?? 0) ||
			goals.some(
				(goal) => !goal.challengeGoal.trim() && goal.periodGoals.length === 0 && !goal.achievement,
			)
		);
	};
	const carryOver = async (previousGoalId: number, mode: CarryMode) => {
		const id = sheetId();
		if (!id || carrying() !== null || !ensureNothingUnsaved()) {
			return;
		}
		setCarrying(previousGoalId);
		try {
			const result = await props.challengeEvaluationController.carryOver(id, previousGoalId);
			if ("error" in result) {
				showToast("error", "前期の目標を引き継げませんでした", result.error);
				return;
			}
			await reloadCurrentSheetFromRoute();
			setGoalFocus({
				goalNumber: result.goalNumber,
				edit: mode === "revise" ? "challenge" : "plan",
				seq: Date.now(),
			});
			showToast(
				"success",
				mode === "keep"
					? `前期の目標を、目標 ${result.goalNumber} に据え置きました`
					: `前期の目標を、目標 ${result.goalNumber} に引き継ぎました`,
				mode === "keep"
					? "今期の期中目標(この期の計画)を書きましょう。"
					: "今期に合わせて、チャレンジ目標を書き直してください。",
			);
		} finally {
			setCarrying(null);
		}
	};
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
		const summary = current?.commonEvaluation;
		return current &&
			EvaluationStatus.from(current.status).isFinalized() &&
			viewModel().canViewCommonEvaluation &&
			summary
			? commonEvaluationRadar(summary.results, current.primaryIsFinalEvaluator)
			: null;
	});
	const rankText = (rank: EvaluationRankDto | undefined) =>
		rank ? `${rank.displayText}（${rank.score} 点 / 100 点）` : "—";
	/** いま自分が確定しようとしている段階のランク。 */
	const confirmingRank = () =>
		viewModel().canFinalizeEvaluation ? sheet()?.finalEvaluationRank : sheet()?.firstEvaluationRank;
	/** 受け持ち画面では、確定すると次の対象者へ進む。行き先を確認の中で先に知らせる。 */
	const nextNote = () => {
		if (!props.announceNext) {
			return undefined;
		}
		const name = props.announceNext();
		return name
			? `確定後は、次の ${name} さんの評価に進みます。`
			: "自分の番のシートは、これが最後です。";
	};

	createEffect(() => {
		if (isNew()) {
			props.controller.prepareNewSheet();
			void props.controller.loadPeriods();
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
		const newSheetId = await props.controller.createSheet();
		if (newSheetId) {
			showToast("success", "評価シートを作成しました");
			navigate(`/sheet/${newSheetId}`);
		}
	};

	/** 保存後の再取得。画面を消さずに裏で読み直す。 */
	const reloadCurrentSheetFromRoute = () => {
		const id = Number(idParam());
		if (Number.isNaN(id)) {
			return;
		}
		props.onUpdated?.();
		return props.controller.loadSheet(id, true);
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
			// 変更後のシートは保存の結果として届いているので、読み直さない
			props.onUpdated?.();
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

	/**
	 * その状態へ変えたときに知らせる相手(EvaluationStatus.handoff の to)と、通知メールを送るかの選択。
	 * アプリ内通知は状態の変更と同時に必ず届くので、選べるのはメールのときだけ。初めは「送る」。
	 */
	const mailChoice = (status: EvaluationStatus) => {
		let notify = true;
		const to = status.handoff()?.to;
		const recipient =
			to &&
			{
				subject: `本人（${sheet()?.subject?.name ?? ""}）`,
				primary: `一次評価者（${sheet()?.primaryEvaluator ?? "未設定"}）`,
				secondary: `二次評価者（${sheet()?.secondaryEvaluator ?? "未設定"}）`,
			}[to];
		return {
			checkbox:
				sheet()?.notifiesByMail && recipient
					? {
							label: `${recipient}に通知メールを送る`,
							onChange: (checked: boolean) => {
								notify = checked;
							},
						}
					: undefined,
			notify: () => notify,
		};
	};

	const ensureObjectiveFieldsComplete = () => {
		const missing = sheet()?.pendingObjectiveFields ?? [];
		if (missing.length === 0) {
			return true;
		}
		const max = sheet()?.maxObjectives ?? 0;
		void confirmAction({
			title: "チャレンジ目標が空欄の目標は送信・確定できません",
			message: `目標は1〜${max}件必要です。チャレンジ目標を入力して保存するか、不要なタブを削除してください。`,
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
		const mail = mailChoice(EvaluationStatus.GOALS_SUBMITTED);
		const confirmed = await confirmAction({
			title: "目標を送信しますか？",
			message:
				"目標を一次評価者へ送信します。一次評価者が要修正として戻すか、目標を確定します。この時点では評価は始まりません。",
			checkbox: mail.checkbox,
			confirmLabel: "目標を送信する",
		});
		if (confirmed) {
			await changeStatus(EvaluationStatus.GOALS_SUBMITTED, "目標を送信しました", mail.notify());
		}
	};

	const handleRevertSheet = async () => {
		if (!ensureNothingUnsaved()) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.DRAFT);
		const confirmed = await confirmAction({
			title: "目標を要修正として戻しますか？",
			message: "本人が目標を修正できる下書きへ戻します。本人は修正後にもう一度目標を送信します。",
			checkbox: mail.checkbox,
			confirmLabel: "要修正として戻す",
		});
		if (confirmed) {
			if (await changeStatus(EvaluationStatus.DRAFT, "下書きに戻しました", mail.notify())) {
				if (props.embedded) {
					props.onStageCompleted?.();
				} else {
					navigate("/review");
				}
			}
		}
	};

	const handleConfirmGoals = async () => {
		if (!ensureObjectiveFieldsComplete() || !ensureNothingUnsaved()) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.GOALS_CONFIRMED);
		if (
			await confirmAction({
				title: "目標を確定しますか？",
				message:
					"目標の内容を固定し、本人が達成状況だけを記入できる状態にします。一次評価はまだ始まりません。",
				checkbox: mail.checkbox,
				confirmLabel: "目標を確定する",
			})
		) {
			if (
				await changeStatus(EvaluationStatus.GOALS_CONFIRMED, "目標を確定しました", mail.notify())
			) {
				props.onStageCompleted?.();
			}
		}
	};
	const handleRequestFirst = async () => {
		if (!ensureNothingUnsaved()) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.SUBMITTED);
		if (
			await confirmAction({
				title: "一次評価を依頼しますか？",
				message:
					"保存した達成状況で一次評価を依頼します。依頼後は本人による目標・達成状況の修正はできません。",
				checkbox: mail.checkbox,
				confirmLabel: "一次評価を依頼する",
			})
		) {
			await changeStatus(EvaluationStatus.SUBMITTED, "一次評価を依頼しました", mail.notify());
		}
	};

	const handleConfirmFirst = async () => {
		if (!ensureObjectiveFieldsComplete()) {
			return;
		}
		if (!ensureNothingUnsaved() || !ensureEvaluationComplete()) {
			return;
		}
		const mail = mailChoice(EvaluationStatus.FIRST_EVALUATED);
		const confirmed = await confirmAction({
			title: "一次評価を確定しますか？",
			message: `一次評価ランクは ${rankText(sheet()?.firstEvaluationRank)} です。確定すると一次評価は変更できなくなります。この操作は取り消せません。`,
			note: nextNote(),
			checkbox: mail.checkbox,
			confirmLabel: "一次評価を確定する",
			tone: "danger",
		});
		if (
			confirmed &&
			(await changeStatus(
				EvaluationStatus.FIRST_EVALUATED,
				"一次評価を確定しました",
				mail.notify(),
			))
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
		const confirmed = await confirmAction({
			title: "評価を確定しますか？",
			message: `最終評価ランクは ${rankText(sheet()?.finalEvaluationRank)} です。確定すると評価シートはロックされ、本人も評価者も変更できなくなります。この操作は取り消せません。`,
			note: nextNote(),
			confirmLabel: "評価を確定する",
			tone: "danger",
		});
		if (confirmed && (await changeStatus(EvaluationStatus.FINALIZED, "評価を確定しました"))) {
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

	/** 未設定の項目へ移る。目標はそのタブを選び(入力中なら破棄を確かめる)、共通評価はその行へ送る。 */
	const showPending = (item: PendingEvaluationItemDto) => {
		const element = document.getElementById(
			item.goalNumber != null ? `objective-tab-${item.goalNumber}` : `common-item-${item.itemId}`,
		);
		if (item.goalNumber != null) {
			element?.click();
		}
		element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
		element?.focus({ preventScroll: true });
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

	/**
	 * 表示するシートの切り替え。部下が多くても探せるよう、氏名・社員番号で絞り込める。
	 * 一覧にまだ無いシート(読み込み中・一覧の対象外)も、いま開いている人として出す。
	 */
	const subjectOptions = createMemo(() => {
		const mine = mySubjectOptions().map((item) => ({
			value: String(item.sheetId),
			name: item.employeeName,
			employeeNo: `${item.employeeNo} · 自分`,
		}));
		const subordinates = subordinateSubjectOptions().map((item) => ({
			value: String(item.sheetId),
			name: item.employeeName,
			employeeNo: item.employeeNo,
		}));
		const options = [...mine, ...subordinates];
		const subject = sheet()?.subject;
		return options.some((option) => option.value === idParam())
			? options
			: [
					{
						value: idParam(),
						name: subject?.name ?? "読み込み中...",
						employeeNo: subject?.employeeNo,
					},
					...options,
				];
	});

	const handleSubjectChange = async (selectedSheetId: string) => {
		if (!(await confirmDiscard())) {
			return false;
		}
		clearUnsavedChanges();
		navigate(`/sheet/${selectedSheetId}`);
		return true;
	};

	const SubjectSwitcher = () => (
		<div class="subject-switcher">
			<span class="subject-switcher__label">
				<Users class="subject-switcher__icon" />
				シートを切り替え
			</span>
			<SearchableEvaluatorSelect
				label="表示する評価対象者"
				noun="評価対象者"
				value={idParam()}
				options={subjectOptions()}
				disabled={viewModel().loadingAccessibleSheets || viewModel().loadingSheet}
				saving={false}
				onPick={handleSubjectChange}
			/>
		</div>
	);

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
						<p>得点率で自動的に決まります（{EvaluationRank.describeThresholds()}）。</p>
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
					<Show when={!isNew() && !props.embedded && subjectOptions().length > 1}>
						<SubjectSwitcher />
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
						onSubmit={() => void handleSubmitSheet()}
						onRevert={() => void handleRevertSheet()}
						onConfirmGoals={() => void handleConfirmGoals()}
						onRequestFirst={() => void handleRequestFirst()}
						onConfirmFirst={() => void handleConfirmFirst()}
						onFinalize={() => void handleFinalize()}
					/>
				</Show>
				<Show when={viewModel().canResendNotification}>
					<button
						type="button"
						class="secondary-action"
						disabled={resending() || saving()}
						onClick={async () => {
							setResending(true);
							try {
								await props.controller.resendNotification();
							} catch (error) {
								showToast("error", messageOf(error, "通知を再送できませんでした。"));
							} finally {
								setResending(false);
							}
						}}
					>
						{resending() ? "送信中…" : "通知を再送"}
					</button>
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
												<For each={pendingEvaluationItems()}>
													{(item) => (
														<li>
															<button
																type="button"
																class="link-button"
																onClick={() => showPending(item)}
															>
																{item.label}
															</button>
														</li>
													)}
												</For>
											</ul>
										</details>
									</div>
								</Show>
								<SheetCorrectionsNotice corrections={sheet()?.corrections ?? []} />
								<Show when={previousGoals()?.goals.length ? previousGoals() : null}>
									{(previous) => (
										<PreviousGoalsView
											previous={previous()}
											objectives={sheet()?.objectives ?? []}
											canCarry={viewModel().canCarryOverGoal}
											hasRoom={hasRoomForGoal()}
											carrying={carrying()}
											onCarry={(goalId, mode) => void carryOver(goalId, mode)}
											onOpen={(goalNumber) =>
												setGoalFocus({ goalNumber, edit: null, seq: Date.now() })
											}
										/>
									)}
								</Show>
								<ChallengeEvaluationView
									sheetId={sheetId()}
									objectives={sheet()?.objectives ?? []}
									maxObjectives={sheet()?.maxObjectives ?? 0}
									subject={subject()}
									canEditFirst={canEditFirst()}
									canEditSecond={canEditSecond()}
									canEditMilestoneGoal={viewModel().canEditMilestoneGoal}
									canEditMilestoneAchievement={viewModel().canEditMilestoneAchievement}
									previousGoals={previousGoals()}
									focus={goalFocus()}
									canViewSecondEvaluation={viewModel().canViewSecondEvaluation}
									controller={props.challengeEvaluationController}
									viewModel={props.challengeEvaluationViewModel}
									onUpdated={reloadCurrentSheetFromRoute}
									onSavingChange={setSavingChallenge}
								/>
								<Show when={viewModel().canViewCommonEvaluation}>
									<CommonEvaluationView
										sheetId={sheetId()}
										summary={sheet()?.commonEvaluation ?? null}
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
									{/* 入力に付いてくるので小さくする。確定で何が起きるかは、確認ダイアログで伝える */}
									<footer class="review-action-bar">
										<span>
											{viewModel().canFinalizeEvaluation ? "最終評価ランク" : "一次評価ランク"}
											<strong>{confirmingRank()?.displayText ?? "—"}</strong>
											<Show when={confirmingRank()}>
												{(rank) => <small>{rank().score} 点</small>}
											</Show>
										</span>
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
											<ShieldCheck class="action-icon" />
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
