import { Navigate, Route, Router } from "@solidjs/router";
import { type Component, createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { AccountController } from "./adapter/controllers/AccountController";
import { ChallengeEvaluationController } from "./adapter/controllers/ChallengeEvaluationController";
import { CommonEvaluationController } from "./adapter/controllers/CommonEvaluationController";
import { EmployeeMasterController } from "./adapter/controllers/EmployeeMasterController";
import { EvaluationPeriodController } from "./adapter/controllers/EvaluationPeriodController";
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
import DashboardLayout from "./adapter/views/DashboardLayout";
import EmployeeMasterView from "./adapter/views/EmployeeMasterView";
import HelpView from "./adapter/views/HelpView";
import LoginView from "./adapter/views/LoginView";
import ReviewerWorkspaceView from "./adapter/views/ReviewerWorkspaceView";
import SettingsView from "./adapter/views/SettingsView";
import SheetEditorView from "./adapter/views/SheetEditorView";
import SheetListView from "./adapter/views/SheetListView";
import { CheckEvaluatorRoleInteractor } from "./application/usecases/CheckEvaluatorRoleInteractor";
import { CloseEvaluationPeriodInteractor } from "./application/usecases/CloseEvaluationPeriodInteractor";
import { CreateEvaluationSheetInteractor } from "./application/usecases/CreateEvaluationSheetInteractor";
import { DeleteEvaluationPeriodInteractor } from "./application/usecases/DeleteEvaluationPeriodInteractor";
import { ExportEvaluationSheetInteractor } from "./application/usecases/ExportEvaluationSheetInteractor";
import { FetchCategorizedSheetsInteractor } from "./application/usecases/FetchCategorizedSheetsInteractor";
import { FetchDistinctPeriodsInteractor } from "./application/usecases/FetchDistinctPeriodsInteractor";
import { FetchEvaluationSheetInteractor } from "./application/usecases/FetchEvaluationSheetInteractor";
import { LoadCommonEvaluationInteractor } from "./application/usecases/LoadCommonEvaluationInteractor";
import { LoadEmployeeMasterInteractor } from "./application/usecases/LoadEmployeeMasterInteractor";
import { RegisterEmployeeAccountInteractor } from "./application/usecases/RegisterEmployeeAccountInteractor";
import { ResetEmployeeRegistrationInteractor } from "./application/usecases/ResetEmployeeRegistrationInteractor";
import { SaveEvaluationPeriodInteractor } from "./application/usecases/SaveEvaluationPeriodInteractor";
import { SignInEmployeeInteractor } from "./application/usecases/SignInEmployeeInteractor";
import { UpdateEmployeeEvaluatorInteractor } from "./application/usecases/UpdateEmployeeEvaluatorInteractor";
import { UpdateEmployeeGradeInteractor } from "./application/usecases/UpdateEmployeeGradeInteractor";
import { UpdateEmployeeRoleInteractor } from "./application/usecases/UpdateEmployeeRoleInteractor";
import { UpdateEvaluationAllocationInteractor } from "./application/usecases/UpdateEvaluationAllocationInteractor";
import { UpdateEvaluationStatusInteractor } from "./application/usecases/UpdateEvaluationStatusInteractor";
import { UpdateMilestoneInteractor } from "./application/usecases/UpdateMilestoneInteractor";
import { UpdateOverallCommentInteractor } from "./application/usecases/UpdateOverallCommentInteractor";
import { UpsertCommonEvaluationInteractor } from "./application/usecases/UpsertCommonEvaluationInteractor";
import type { AuthSession } from "./domain/repositories/AuthRepository";
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
const evaluationPeriodController = new EvaluationPeriodController(
	evaluationPeriodRepository,
	new SaveEvaluationPeriodInteractor(evaluationPeriodRepository, employeeMasterRepository),
	new DeleteEvaluationPeriodInteractor(evaluationPeriodRepository, employeeMasterRepository),
	new CloseEvaluationPeriodInteractor(evaluationPeriodRepository, employeeMasterRepository),
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
	evaluationPeriodRepository,
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
	employeeRepository,
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
	commonEvaluationPresenter,
	employeeRepository,
);
const challengeEvaluationController = new ChallengeEvaluationController(
	updateMilestoneUseCase,
	challengeEvaluationPresenter.outputPort,
	challengeEvaluationPresenter.presentUpdateError,
	employeeRepository,
);
const accountController = new AccountController(
	new SignInEmployeeInteractor(authRepository, employeeRepository),
	new RegisterEmployeeAccountInteractor(authRepository, employeeRepository),
	authRepository,
	employeeMasterRepository,
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

const App: Component = () => {
	const [session, setSession] = createSignal<AuthSession | null>(null);
	const [isLinked, setIsLinked] = createSignal<boolean | null>(null);
	const [initialized, setInitialized] = createSignal(false);

	// ユーザーの状態（セッションとDB紐付け）を同期するコアロジック
	const checkUserStatus = async (currentSession: AuthSession | null) => {
		setSession(currentSession);

		if (currentSession) {
			setIsLinked(await employeeRepository.checkUserLinked(currentSession.userId));
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
			<DashboardLayout controller={accountController}>{props.children}</DashboardLayout>
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
								controller={accountController}
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
						component={() => (
							<SettingsView
								controller={settingsController}
								periodController={evaluationPeriodController}
							/>
						)}
					/>
					<Route path="/help" component={HelpView} />
					<Route path="*404" component={NotFound} />
				</Route>
			</Router>
		</Show>
	);
};

export default App;
