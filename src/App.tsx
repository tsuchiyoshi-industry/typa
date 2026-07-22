import { A, Navigate, Route, Router } from "@solidjs/router";
import { LogOut, Menu, User, X } from "lucide-solid";
import { type Component, createSignal, type JSX, onMount, Show } from "solid-js";
import { ChallengeEvaluationController } from "./adapter/controllers/ChallengeEvaluationController";
import { CommonEvaluationController } from "./adapter/controllers/CommonEvaluationController";
import { EmployeeMasterController } from "./adapter/controllers/EmployeeMasterController";
import { SheetEditorController } from "./adapter/controllers/SheetEditorController";
import { SheetListController } from "./adapter/controllers/SheetListController";
import { createChallengeEvaluationPresenter } from "./adapter/presenters/ChallengeEvaluationPresenter";
import { createCommonEvaluationPresenter } from "./adapter/presenters/CommonEvaluationPresenter";
import { createEmployeeMasterPresenter } from "./adapter/presenters/EmployeeMasterPresenter";
import { createSheetEditorPresenter } from "./adapter/presenters/SheetEditorPresenter";
import { createSheetListPresenter } from "./adapter/presenters/SheetListPresenter";
import AutoUpdateNotification from "./adapter/views/components/AutoUpdateNotification";
import ExitConfirmDialog from "./adapter/views/components/ExitConfirmDialog";
import LoadingView from "./adapter/views/components/LoadingView";
import { NotFound } from "./adapter/views/components/NotFound";
import ThemeToggleButton from "./adapter/views/components/ThemeToggleButton";
import EmployeeMasterView from "./adapter/views/EmployeeMasterView";
import LoginView from "./adapter/views/LoginView";
import SheetEditorView from "./adapter/views/SheetEditorView";
import SheetListView from "./adapter/views/SheetListView";
import { AssignEvaluatorInteractor } from "./application/usecases/AssignEvaluatorInteractor";
import { CheckEvaluatorRoleInteractor } from "./application/usecases/CheckEvaluatorRoleInteractor";
import { CreateEvaluationSheetInteractor } from "./application/usecases/CreateEvaluationSheetInteractor";
import { ExportEvaluationSheetInteractor } from "./application/usecases/ExportEvaluationSheetInteractor";
import { FetchCategorizedSheetsInteractor } from "./application/usecases/FetchCategorizedSheetsInteractor";
import { FetchDistinctPeriodsInteractor } from "./application/usecases/FetchDistinctPeriodsInteractor";
import { FetchEvaluationSheetInteractor } from "./application/usecases/FetchEvaluationSheetInteractor";
import { LoadCommonEvaluationInteractor } from "./application/usecases/LoadCommonEvaluationInteractor";
import { LoadEmployeeMasterInteractor } from "./application/usecases/LoadEmployeeMasterInteractor";
import { UpdateEmployeeEvaluatorInteractor } from "./application/usecases/UpdateEmployeeEvaluatorInteractor";
import { UpdateEvaluationStatusInteractor } from "./application/usecases/UpdateEvaluationStatusInteractor";
import { UpdateFinalEvaluationRankInteractor } from "./application/usecases/UpdateFinalEvaluationRankInteractor";
import { UpdateMilestoneInteractor } from "./application/usecases/UpdateMilestoneInteractor";
import { UpdateOverallCommentInteractor } from "./application/usecases/UpdateOverallCommentInteractor";
import { UpsertCommonEvaluationInteractor } from "./application/usecases/UpsertCommonEvaluationInteractor";
import type { AuthSession } from "./domain/repositories/AuthRepository";
import { EvaluationScoreUpdateService } from "./domain/services/EvaluationScoreUpdateService";
import { SupabaseAuthRepository } from "./infrastructure/auth/SupabaseAuthRepository";
import { SupabaseCommonEvaluationRepository } from "./infrastructure/repositories/SupabaseCommonEvaluationRepository";
import { SupabaseEmployeeMasterRepository } from "./infrastructure/repositories/SupabaseEmployeeMasterRepository";
import { SupabaseEmployeeRepository } from "./infrastructure/repositories/SupabaseEmployeeRepository";
import { SupabaseEvaluationPeriodRepository } from "./infrastructure/repositories/SupabaseEvaluationPeriodRepository";
import { SupabaseEvaluationSheetRepository } from "./infrastructure/repositories/SupabaseEvaluationSheetRepository";
import { SupabaseMilestoneRepository } from "./infrastructure/repositories/SupabaseMilestoneRepository";
import { TauriEmailNotificationRepository } from "./infrastructure/repositories/TauriEmailNotificationRepository";

const authRepository = new SupabaseAuthRepository();
const employeeRepository = new SupabaseEmployeeRepository();
const commonEvaluationRepository = new SupabaseCommonEvaluationRepository();
const evaluationSheetRepository = new SupabaseEvaluationSheetRepository(
	employeeRepository,
	commonEvaluationRepository,
);
const evaluationPeriodRepository = new SupabaseEvaluationPeriodRepository();
const milestoneRepository = new SupabaseMilestoneRepository();
const employeeMasterRepository = new SupabaseEmployeeMasterRepository();
const emailNotificationRepository = new TauriEmailNotificationRepository();
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
const updateFinalEvaluationRankUseCase = new UpdateFinalEvaluationRankInteractor(
	evaluationSheetRepository,
	employeeRepository,
);
const updateEvaluationStatusUseCase = new UpdateEvaluationStatusInteractor(
	evaluationSheetRepository,
	employeeRepository,
	emailNotificationRepository,
);
const exportEvaluationSheetUseCase = new ExportEvaluationSheetInteractor(evaluationSheetRepository);
const loadEmployeeMasterUseCase = new LoadEmployeeMasterInteractor(employeeMasterRepository);
const assignEvaluatorUseCase = new AssignEvaluatorInteractor(employeeMasterRepository);
const updateEmployeeEvaluatorUseCase = new UpdateEmployeeEvaluatorInteractor(
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
	updateFinalEvaluationRankUseCase,
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
	assignEvaluatorUseCase,
	updateEmployeeEvaluatorUseCase,
	employeeMasterPresenter,
);

const AppLayout: Component<{ children?: JSX.Element | JSX.Element[] }> = (props) => (
	<div class="app-shell">
		<div class="app-frame">{props.children}</div>
		<AutoUpdateNotification />
		<ExitConfirmDialog />
	</div>
);

const DashboardLayout: Component<{ children?: JSX.Element | JSX.Element[] }> = (props) => {
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [userMenuOpen, setUserMenuOpen] = createSignal(false);
	const [userEmail, setUserEmail] = createSignal<string>("");

	onMount(async () => {
		const email = await authRepository.getCurrentUserEmail();
		if (email) {
			setUserEmail(email);
		}

		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest(".user-menu-container")) {
				setUserMenuOpen(false);
			}
		};
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	});

	const handleLogout = async () => {
		await authRepository.signOut();
		setUserMenuOpen(false);
	};

	return (
		<div class="dashboard-shell">
			<header class="dashboard-topbar">
				<div class="topbar-brand">
					<span class="brand-logo">TYPA</span>
				</div>
				<button
					type="button"
					class="menu-toggle"
					onClick={() => setMenuOpen(!menuOpen())}
					aria-label="メニュー"
				>
					<Show when={menuOpen()} fallback={<Menu size={24} />}>
						<X size={24} />
					</Show>
				</button>
				<nav class="topbar-nav" classList={{ "nav-open": menuOpen() }}>
					<A href="/" class="nav-link" onClick={() => setMenuOpen(false)}>
						評価シート一覧
					</A>
					<A href="/sheet/new" class="nav-link" onClick={() => setMenuOpen(false)}>
						新規作成
					</A>
					<A href="/employee-master" class="nav-link" onClick={() => setMenuOpen(false)}>
						社員マスタ
					</A>
				</nav>
				<ThemeToggleButton />
				<div class="user-menu-container">
					<button
						type="button"
						class="user-menu-trigger"
						onClick={() => setUserMenuOpen(!userMenuOpen())}
						aria-label="ユーザーメニュー"
					>
						<User size={20} />
						<span class="user-email">{userEmail()}</span>
					</button>
					<Show when={userMenuOpen()}>
						<div class="user-menu-dropdown">
							<button type="button" class="user-menu-item logout-item" onClick={handleLogout}>
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

	onMount(async () => {
		// 1. まず現在のセッションを一度だけ取得する（Authの初期化を待つ）
		const initialSession = await authRepository.getSession();
		await checkUserStatus(initialSession);

		// 2. ここで初めて「初期化完了」とする（これでチラつきを防ぐ）
		setInitialized(true);

		// 3. その後の状態変化（ログアウトなど）を監視する
		const unsubscribe = authRepository.onAuthStateChange((newSession) => {
			checkUserStatus(newSession);
		});

		return unsubscribe;
	});

	return (
		<Show when={initialized() && isLinked() !== null} fallback={<LoadingView />}>
			<Router root={AppLayout}>
				<Route
					path="/"
					component={() => (
						<Show when={session() && isLinked()} fallback={<Navigate href="/login" />}>
							<DashboardLayout>
								<SheetListView
									controller={sheetListController}
									viewModel={sheetListPresenter.viewModel}
								/>
							</DashboardLayout>
						</Show>
					)}
				/>

				<Route
					path="/sheet/:id"
					component={() => (
						<Show when={session() && isLinked()} fallback={<Navigate href="/login" />}>
							<DashboardLayout>
								<SheetEditorView
									controller={sheetEditorController}
									viewModel={sheetEditorPresenter.viewModel}
									commonEvaluationController={commonEvaluationController}
									commonEvaluationViewModel={commonEvaluationPresenter.viewModel}
									challengeEvaluationController={challengeEvaluationController}
									challengeEvaluationViewModel={challengeEvaluationPresenter.viewModel}
								/>
							</DashboardLayout>
						</Show>
					)}
				/>

				<Route
					path="/employee-master"
					component={() => (
						<Show when={session() && isLinked()} fallback={<Navigate href="/login" />}>
							<DashboardLayout>
								<EmployeeMasterView
									controller={employeeMasterController}
									viewModel={employeeMasterPresenter.viewModel}
								/>
							</DashboardLayout>
						</Show>
					)}
				/>

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

				<Route
					path="*404"
					component={() => (
						<Show when={session() && isLinked()} fallback={<Navigate href="/login" />}>
							<DashboardLayout>
								<NotFound />
							</DashboardLayout>
						</Show>
					)}
				/>
			</Router>
		</Show>
	);
};

export default App;
