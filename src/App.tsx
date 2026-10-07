import { A, Navigate, Route, Router } from "@solidjs/router";
import { LogOut, Menu, User, X } from "lucide-solid";
import { type Component, createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { ChallengeEvaluationController } from "./adapter/controllers/ChallengeEvaluationController";
import { CommonEvaluationController } from "./adapter/controllers/CommonEvaluationController";
import { EmployeeMasterController } from "./adapter/controllers/EmployeeMasterController";
import { ReviewerWorkspaceController } from "./adapter/controllers/ReviewerWorkspaceController";
import { SettingsController } from "./adapter/controllers/SettingsController";
import { SheetEditorController } from "./adapter/controllers/SheetEditorController";
import { SheetListController } from "./adapter/controllers/SheetListController";
import { createChallengeEvaluationPresenter } from "./adapter/presenters/ChallengeEvaluationPresenter";
import { createCommonEvaluationPresenter } from "./adapter/presenters/CommonEvaluationPresenter";
import { createEmployeeMasterPresenter } from "./adapter/presenters/EmployeeMasterPresenter";
import { createSheetEditorPresenter } from "./adapter/presenters/SheetEditorPresenter";
import { createSheetListPresenter } from "./adapter/presenters/SheetListPresenter";
import AutoUpdateNotification from "./adapter/views/components/AutoUpdateNotification";
import ExitConfirmDialog from "./adapter/views/components/ExitConfirmDialog";
import FeedbackHost from "./adapter/views/components/FeedbackHost";
import LoadingView from "./adapter/views/components/LoadingView";
import { NotFound } from "./adapter/views/components/NotFound";
import ThemeToggleButton from "./adapter/views/components/ThemeToggleButton";
import EmployeeMasterView from "./adapter/views/EmployeeMasterView";
import { clearUnsavedChanges, confirmDiscard } from "./adapter/views/feedback";
import HelpView from "./adapter/views/HelpView";
import LoginView from "./adapter/views/LoginView";
import ReviewerWorkspaceView from "./adapter/views/ReviewerWorkspaceView";
import SettingsView from "./adapter/views/SettingsView";
import SheetEditorView from "./adapter/views/SheetEditorView";
import SheetListView from "./adapter/views/SheetListView";
import { CheckEvaluatorRoleInteractor } from "./application/usecases/CheckEvaluatorRoleInteractor";
import { CreateEvaluationSheetInteractor } from "./application/usecases/CreateEvaluationSheetInteractor";
import { ExportEvaluationSheetInteractor } from "./application/usecases/ExportEvaluationSheetInteractor";
import { FetchCategorizedSheetsInteractor } from "./application/usecases/FetchCategorizedSheetsInteractor";
import { FetchDistinctPeriodsInteractor } from "./application/usecases/FetchDistinctPeriodsInteractor";
import { FetchEvaluationSheetInteractor } from "./application/usecases/FetchEvaluationSheetInteractor";
import { LoadCommonEvaluationInteractor } from "./application/usecases/LoadCommonEvaluationInteractor";
import { LoadEmployeeMasterInteractor } from "./application/usecases/LoadEmployeeMasterInteractor";
import { ResetEmployeeRegistrationInteractor } from "./application/usecases/ResetEmployeeRegistrationInteractor";
import { UpdateEmployeeEvaluatorInteractor } from "./application/usecases/UpdateEmployeeEvaluatorInteractor";
import { UpdateEmployeeGradeInteractor } from "./application/usecases/UpdateEmployeeGradeInteractor";
import { UpdateEmployeeRoleInteractor } from "./application/usecases/UpdateEmployeeRoleInteractor";
import { UpdateEvaluationAllocationInteractor } from "./application/usecases/UpdateEvaluationAllocationInteractor";
import { UpdateEvaluationStatusInteractor } from "./application/usecases/UpdateEvaluationStatusInteractor";
import { UpdateMilestoneInteractor } from "./application/usecases/UpdateMilestoneInteractor";
import { UpdateOverallCommentInteractor } from "./application/usecases/UpdateOverallCommentInteractor";
import { UpsertCommonEvaluationInteractor } from "./application/usecases/UpsertCommonEvaluationInteractor";
import type { AuthSession } from "./domain/repositories/AuthRepository";
import { canEditSettings } from "./domain/services/EmployeeMasterAccessService";
import { EvaluationScoreUpdateService } from "./domain/services/EvaluationScoreUpdateService";
import { SupabaseAuthRepository } from "./infrastructure/auth/SupabaseAuthRepository";
import { SupabaseCommonEvaluationRepository } from "./infrastructure/repositories/SupabaseCommonEvaluationRepository";
import { SupabaseEmployeeMasterRepository } from "./infrastructure/repositories/SupabaseEmployeeMasterRepository";
import { SupabaseEmployeeRepository } from "./infrastructure/repositories/SupabaseEmployeeRepository";
import { SupabaseEvaluationNotificationRecipientRepository } from "./infrastructure/repositories/SupabaseEvaluationNotificationRecipientRepository";
import { SupabaseEvaluationPeriodRepository } from "./infrastructure/repositories/SupabaseEvaluationPeriodRepository";
import { SupabaseEvaluationSettingsRepository } from "./infrastructure/repositories/SupabaseEvaluationSettingsRepository";
import { SupabaseEvaluationSheetRepository } from "./infrastructure/repositories/SupabaseEvaluationSheetRepository";
import { SupabaseMilestoneRepository } from "./infrastructure/repositories/SupabaseMilestoneRepository";
import { SupabaseReviewerWorkspaceRepository } from "./infrastructure/repositories/SupabaseReviewerWorkspaceRepository";
import { TauriEmailNotificationRepository } from "./infrastructure/repositories/TauriEmailNotificationRepository";
import { TauriSheetPdfGateway } from "./infrastructure/repositories/TauriSheetPdfGateway";

const authRepository = new SupabaseAuthRepository();
const employeeRepository = new SupabaseEmployeeRepository();
const commonEvaluationRepository = new SupabaseCommonEvaluationRepository();
const evaluationSettingsRepository = new SupabaseEvaluationSettingsRepository();
const evaluationSheetRepository = new SupabaseEvaluationSheetRepository(
	employeeRepository,
	commonEvaluationRepository,
	evaluationSettingsRepository,
);
const evaluationPeriodRepository = new SupabaseEvaluationPeriodRepository();
const reviewerWorkspaceController = new ReviewerWorkspaceController(
	new SupabaseReviewerWorkspaceRepository(),
	evaluationPeriodRepository,
);
const milestoneRepository = new SupabaseMilestoneRepository();
const employeeMasterRepository = new SupabaseEmployeeMasterRepository();
const settingsController = new SettingsController(
	evaluationSettingsRepository,
	employeeMasterRepository,
	new UpdateEvaluationAllocationInteractor(evaluationSettingsRepository, employeeMasterRepository),
);
const emailNotificationRepository = new TauriEmailNotificationRepository(
	new SupabaseEvaluationNotificationRecipientRepository(),
);
const evaluationScoreUpdateService = new EvaluationScoreUpdateService(
	evaluationSheetRepository,
	milestoneRepository,
	commonEvaluationRepository,
);

const fetchCategorizedSheetsUseCase = new FetchCategorizedSheetsInteractor(
	employeeRepository,
	evaluationSheetRepository,
);
const fetchEvaluationSheetUseCase = new FetchEvaluationSheetInteractor(
	evaluationSheetRepository,
	employeeRepository,
);
const fetchDistinctPeriodsUseCase = new FetchDistinctPeriodsInteractor(evaluationPeriodRepository);
const createEvaluationSheetUseCase = new CreateEvaluationSheetInteractor(
	evaluationSheetRepository,
	commonEvaluationRepository,
);
const checkEvaluatorRoleUseCase = new CheckEvaluatorRoleInteractor(
	employeeRepository,
	evaluationSheetRepository,
);
const loadCommonEvaluationUseCase = new LoadCommonEvaluationInteractor(
	commonEvaluationRepository,
	evaluationSheetRepository,
);
const upsertCommonEvaluationUseCase = new UpsertCommonEvaluationInteractor(
	evaluationSheetRepository,
	evaluationScoreUpdateService,
);
const updateMilestoneUseCase = new UpdateMilestoneInteractor(
	milestoneRepository,
	evaluationSheetRepository,
	evaluationScoreUpdateService,
);
const updateOverallCommentUseCase = new UpdateOverallCommentInteractor(
	evaluationSheetRepository,
	employeeRepository,
);
const updateEvaluationStatusUseCase = new UpdateEvaluationStatusInteractor(
	evaluationSheetRepository,
	employeeRepository,
	emailNotificationRepository,
);
const exportEvaluationSheetUseCase = new ExportEvaluationSheetInteractor(
	evaluationSheetRepository,
	new TauriSheetPdfGateway(),
);
const loadEmployeeMasterUseCase = new LoadEmployeeMasterInteractor(employeeMasterRepository);
const updateEmployeeEvaluatorUseCase = new UpdateEmployeeEvaluatorInteractor(
	employeeMasterRepository,
);
const updateEmployeeGradeUseCase = new UpdateEmployeeGradeInteractor(employeeMasterRepository);
const updateEmployeeRoleUseCase = new UpdateEmployeeRoleInteractor(employeeMasterRepository);
const resetEmployeeRegistrationUseCase = new ResetEmployeeRegistrationInteractor(
	employeeMasterRepository,
);

const sheetListPresenter = createSheetListPresenter();
const sheetEditorPresenter = createSheetEditorPresenter();
const commonEvaluationPresenter = createCommonEvaluationPresenter();
const challengeEvaluationPresenter = createChallengeEvaluationPresenter();
const employeeMasterPresenter = createEmployeeMasterPresenter();

const sheetListController = new SheetListController(
	fetchCategorizedSheetsUseCase,
	sheetListPresenter.fetchOutputPort,
	exportEvaluationSheetUseCase,
	sheetListPresenter.exportOutputPort,
	sheetListPresenter.presentError,
	employeeRepository,
);
const sheetEditorController = new SheetEditorController(
	fetchEvaluationSheetUseCase,
	fetchDistinctPeriodsUseCase,
	createEvaluationSheetUseCase,
	checkEvaluatorRoleUseCase,
	fetchCategorizedSheetsUseCase,
	updateOverallCommentUseCase,
	updateEvaluationStatusUseCase,
	sheetEditorPresenter,
	employeeRepository,
);
const commonEvaluationController = new CommonEvaluationController(
	loadCommonEvaluationUseCase,
	upsertCommonEvaluationUseCase,
	createEvaluationSheetUseCase,
	commonEvaluationPresenter,
	employeeRepository,
);
const challengeEvaluationController = new ChallengeEvaluationController(
	updateMilestoneUseCase,
	challengeEvaluationPresenter.outputPort,
	challengeEvaluationPresenter.presentUpdateError,
	employeeRepository,
);
const employeeMasterController = new EmployeeMasterController(
	loadEmployeeMasterUseCase,
	updateEmployeeEvaluatorUseCase,
	updateEmployeeGradeUseCase,
	updateEmployeeRoleUseCase,
	resetEmployeeRegistrationUseCase,
	employeeMasterPresenter,
);

const AppLayout: Component<{ children?: JSX.Element | JSX.Element[] }> = (props) => (
	<div class="app-shell">
		<div class="app-frame">{props.children}</div>
		<AutoUpdateNotification />
		<FeedbackHost />
		<ExitConfirmDialog />
	</div>
);

const DashboardLayout: Component<{ children?: JSX.Element | JSX.Element[] }> = (props) => {
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [userMenuOpen, setUserMenuOpen] = createSignal(false);
	const [employeeNo, setEmployeeNo] = createSignal<string>("");
	const [employeeName, setEmployeeName] = createSignal<string>("");
	const [roleName, setRoleName] = createSignal<string>("");
	const [canViewSettings, setCanViewSettings] = createSignal(false);
	let mounted = true;

	const handleClickOutside = (e: MouseEvent) => {
		if (!(e.target as HTMLElement).closest(".user-menu-container")) {
			setUserMenuOpen(false);
		}
	};
	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			setUserMenuOpen(false);
			setMenuOpen(false);
		}
	};

	onMount(() => {
		document.addEventListener("click", handleClickOutside);
		document.addEventListener("keydown", handleKeyDown);
		void authRepository.getCurrentEmployeeNo().then((no) => setEmployeeNo(no ?? ""));
		void employeeMasterRepository
			.findCurrentEmployeeProfile()
			.then((person) => {
				if (mounted) {
					setEmployeeName(person?.name ?? "");
					setRoleName(person?.role.toString() ?? "");
					setCanViewSettings(!!person && canEditSettings(person.role));
				}
			})
			.catch(() => {
				if (mounted) {
					setCanViewSettings(false);
				}
			});
	});
	onCleanup(() => {
		mounted = false;
		document.removeEventListener("click", handleClickOutside);
		document.removeEventListener("keydown", handleKeyDown);
	});

	const handleLogout = async () => {
		setUserMenuOpen(false);
		if (!(await confirmDiscard())) {
			return;
		}
		clearUnsavedChanges();
		await authRepository.signOut();
	};

	return (
		<div class="dashboard-shell">
			<header class="dashboard-topbar">
				<A href="/" class="topbar-brand" aria-label="TYPA 評価シート一覧へ">
					<span class="brand-logo">TYPA</span>
				</A>
				<button
					type="button"
					class="menu-toggle"
					onClick={() => setMenuOpen(!menuOpen())}
					aria-label="メニュー"
					aria-expanded={menuOpen()}
				>
					<Show when={menuOpen()} fallback={<Menu size={24} />}>
						<X size={24} />
					</Show>
				</button>
				<nav
					class="topbar-nav"
					aria-label="メインナビゲーション"
					classList={{ "nav-open": menuOpen() }}
				>
					<A href="/" end class="nav-link" onClick={() => setMenuOpen(false)}>
						評価シート一覧
					</A>
					<A href="/sheet/new" class="nav-link" onClick={() => setMenuOpen(false)}>
						新規作成
					</A>
					<A href="/review" class="nav-link" onClick={() => setMenuOpen(false)}>
						受け持ちの評価
					</A>
					<A href="/employee-master" class="nav-link" onClick={() => setMenuOpen(false)}>
						社員マスタ
					</A>
					<Show when={canViewSettings()}>
						<A href="/settings" class="nav-link" onClick={() => setMenuOpen(false)}>
							設定
						</A>
					</Show>
					<A href="/help" class="nav-link" onClick={() => setMenuOpen(false)}>
						ヘルプ
					</A>
				</nav>
				<ThemeToggleButton />
				<div class="user-menu-container">
					<button
						type="button"
						class="user-menu-trigger"
						onClick={() => setUserMenuOpen(!userMenuOpen())}
						aria-label="ユーザーメニュー"
						aria-haspopup="menu"
						aria-expanded={userMenuOpen()}
					>
						<User size={20} />
						<span class="user-name">{employeeName()}</span>
						<span class="user-email">{employeeNo()}</span>
						<span class="user-role">{roleName()}</span>
					</button>
					<Show when={userMenuOpen()}>
						<div class="user-menu-dropdown" role="menu">
							<button
								type="button"
								role="menuitem"
								class="user-menu-item logout-item"
								onClick={handleLogout}
							>
								<LogOut size={18} />
								<span>ログアウト</span>
							</button>
						</div>
					</Show>
				</div>
			</header>
			<main class="dashboard-main">{props.children}</main>
		</div>
	);
};

const App: Component = () => {
	const [session, setSession] = createSignal<AuthSession | null>(null);
	const [isLinked, setIsLinked] = createSignal<boolean | null>(null);
	const [initialized, setInitialized] = createSignal(false);

	// ユーザーの状態（セッションとDB紐付け）を同期するコアロジック
	const checkUserStatus = async (currentSession: AuthSession | null) => {
		setSession(currentSession);

		if (currentSession) {
			const { data: employeeId } = await employeeRepository.findEmployeeIdByAuthId(
				currentSession.userId,
			);
			setIsLinked(employeeId !== null);
		} else {
			setIsLinked(false);
		}
	};

	let unsubscribeAuth: (() => void) | undefined;

	onMount(async () => {
		// 1. まず現在のセッションを一度だけ取得する（Authの初期化を待つ）
		const initialSession = await authRepository.getSession();
		await checkUserStatus(initialSession);

		// 2. ここで初めて「初期化完了」とする（これでチラつきを防ぐ）
		setInitialized(true);

		// 3. その後の状態変化（ログアウトなど）を監視する
		unsubscribeAuth = authRepository.onAuthStateChange((newSession) => {
			checkUserStatus(newSession);
		});
	});
	onCleanup(() => unsubscribeAuth?.());

	// ログイン済みの画面はトップバーを共有する。ページ移動のたびに作り直さない。
	const ProtectedLayout: Component<{ children?: JSX.Element }> = (props) => (
		<Show when={session() && isLinked()} fallback={<Navigate href="/login" />}>
			<DashboardLayout>{props.children}</DashboardLayout>
		</Show>
	);

	return (
		<Show when={initialized() && isLinked() !== null} fallback={<LoadingView />}>
			<Router root={AppLayout}>
				<Route
					path="/login"
					component={() => (
						<Show when={!session() || !isLinked()} fallback={<Navigate href="/" />}>
							<LoginView
								onRegistrationLinked={async () => {
									const currentSession = await authRepository.getSession();
									await checkUserStatus(currentSession);
								}}
							/>
						</Show>
					)}
				/>

				<Route path="/" component={ProtectedLayout}>
					<Route
						path="/"
						component={() => (
							<SheetListView
								controller={sheetListController}
								viewModel={sheetListPresenter.viewModel}
							/>
						)}
					/>
					<Route
						path="/review"
						component={() => (
							<ReviewerWorkspaceView
								controller={reviewerWorkspaceController}
								editor={{
									controller: sheetEditorController,
									viewModel: sheetEditorPresenter.viewModel,
									commonEvaluationController,
									commonEvaluationViewModel: commonEvaluationPresenter.viewModel,
									challengeEvaluationController,
									challengeEvaluationViewModel: challengeEvaluationPresenter.viewModel,
								}}
							/>
						)}
					/>
					<Route
						path="/sheet/:id"
						component={() => (
							<SheetEditorView
								controller={sheetEditorController}
								viewModel={sheetEditorPresenter.viewModel}
								commonEvaluationController={commonEvaluationController}
								commonEvaluationViewModel={commonEvaluationPresenter.viewModel}
								challengeEvaluationController={challengeEvaluationController}
								challengeEvaluationViewModel={challengeEvaluationPresenter.viewModel}
							/>
						)}
					/>
					<Route
						path="/employee-master"
						component={() => (
							<EmployeeMasterView
								controller={employeeMasterController}
								viewModel={employeeMasterPresenter.viewModel}
							/>
						)}
					/>
					<Route
						path="/settings"
						component={() => <SettingsView controller={settingsController} />}
					/>
					<Route path="/help" component={() => <HelpView controller={settingsController} />} />
					<Route path="*404" component={NotFound} />
				</Route>
			</Router>
		</Show>
	);
};

export default App;
