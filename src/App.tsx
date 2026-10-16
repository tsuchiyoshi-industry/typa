import { Navigate, Route, Router } from "@solidjs/router";
import {
	type Component,
	createSignal,
	type JSX,
	lazy,
	onCleanup,
	onMount,
	Show,
	Suspense,
} from "solid-js";
import { AccountController } from "./adapter/controllers/AccountController";
import { ChallengeEvaluationController } from "./adapter/controllers/ChallengeEvaluationController";
import { CommonEvaluationController } from "./adapter/controllers/CommonEvaluationController";
import { EmployeeMasterController } from "./adapter/controllers/EmployeeMasterController";
import { EvaluationPeriodController } from "./adapter/controllers/EvaluationPeriodController";
import { ReviewerWorkspaceController } from "./adapter/controllers/ReviewerWorkspaceController";
import { SettingsController } from "./adapter/controllers/SettingsController";
import { SheetEditorController } from "./adapter/controllers/SheetEditorController";
import { SheetListController } from "./adapter/controllers/SheetListController";
import { SmtpSettingsController } from "./adapter/controllers/SmtpSettingsController";
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
import LoginView from "./adapter/views/LoginView";
import { CloseEvaluationPeriodInteractor } from "./application/usecases/CloseEvaluationPeriodInteractor";
import { CreateEvaluationSheetInteractor } from "./application/usecases/CreateEvaluationSheetInteractor";
import { DeleteEvaluationPeriodInteractor } from "./application/usecases/DeleteEvaluationPeriodInteractor";
import { ExportEvaluationSheetInteractor } from "./application/usecases/ExportEvaluationSheetInteractor";
import { ExportSheetOverviewInteractor } from "./application/usecases/ExportSheetOverviewInteractor";
import { FetchCategorizedSheetsInteractor } from "./application/usecases/FetchCategorizedSheetsInteractor";
import { FetchDistinctPeriodsInteractor } from "./application/usecases/FetchDistinctPeriodsInteractor";
import { FetchEvaluationSheetInteractor } from "./application/usecases/FetchEvaluationSheetInteractor";
import { FetchSheetOverviewInteractor } from "./application/usecases/FetchSheetOverviewInteractor";
import {
	IssueEmployeeInvitationInteractor,
	IssuePendingEmployeeInvitationsInteractor,
} from "./application/usecases/IssueEmployeeInvitationInteractor";
import { LoadEmployeeMasterInteractor } from "./application/usecases/LoadEmployeeMasterInteractor";
import { RegisterEmployeeAccountInteractor } from "./application/usecases/RegisterEmployeeAccountInteractor";
import { ResetEmployeeRegistrationInteractor } from "./application/usecases/ResetEmployeeRegistrationInteractor";
import { SaveEvaluationPeriodInteractor } from "./application/usecases/SaveEvaluationPeriodInteractor";
import { SignInEmployeeInteractor } from "./application/usecases/SignInEmployeeInteractor";
import { UpdateEmployeeEnabledInteractor } from "./application/usecases/UpdateEmployeeEnabledInteractor";
import { UpdateEmployeeEvaluatorInteractor } from "./application/usecases/UpdateEmployeeEvaluatorInteractor";
import { UpdateEmployeeGradeInteractor } from "./application/usecases/UpdateEmployeeGradeInteractor";
import { UpdateEmployeeKeepSignedInInteractor } from "./application/usecases/UpdateEmployeeKeepSignedInInteractor";
import { UpdateEmployeeRoleInteractor } from "./application/usecases/UpdateEmployeeRoleInteractor";
import { UpdateEvaluationAllocationInteractor } from "./application/usecases/UpdateEvaluationAllocationInteractor";
import { UpdateEvaluationStatusInteractor } from "./application/usecases/UpdateEvaluationStatusInteractor";
import { UpdateMilestoneInteractor } from "./application/usecases/UpdateMilestoneInteractor";
import { UpdateOverallCommentInteractor } from "./application/usecases/UpdateOverallCommentInteractor";
import { UpdateSmtpSettingsInteractor } from "./application/usecases/UpdateSmtpSettingsInteractor";
import { UpsertCommonEvaluationInteractor } from "./application/usecases/UpsertCommonEvaluationInteractor";
import type { AuthSession } from "./domain/repositories/AuthRepository";
import { EvaluationScoreUpdateService } from "./domain/services/EvaluationScoreUpdateService";
import { SupabaseAuthRepository } from "./infrastructure/auth/SupabaseAuthRepository";
import { SupabaseCommonEvaluationRepository } from "./infrastructure/repositories/SupabaseCommonEvaluationRepository";
import { SupabaseEmailNotificationRepository } from "./infrastructure/repositories/SupabaseEmailNotificationRepository";
import { SupabaseEmployeeMasterRepository } from "./infrastructure/repositories/SupabaseEmployeeMasterRepository";
import { SupabaseEmployeeRepository } from "./infrastructure/repositories/SupabaseEmployeeRepository";
import { SupabaseEvaluationPeriodRepository } from "./infrastructure/repositories/SupabaseEvaluationPeriodRepository";
import { SupabaseEvaluationSettingsRepository } from "./infrastructure/repositories/SupabaseEvaluationSettingsRepository";
import { SupabaseEvaluationSheetRepository } from "./infrastructure/repositories/SupabaseEvaluationSheetRepository";
import { SupabaseMilestoneRepository } from "./infrastructure/repositories/SupabaseMilestoneRepository";
import { SupabaseReviewerWorkspaceRepository } from "./infrastructure/repositories/SupabaseReviewerWorkspaceRepository";
import { SupabaseWorkspaceSettingsRepository } from "./infrastructure/repositories/SupabaseWorkspaceSettingsRepository";
import { TauriSheetPdfGateway } from "./infrastructure/repositories/TauriSheetPdfGateway";

// Load protected page code when the corresponding route is opened.
const EmployeeMasterView = lazy(() => import("./adapter/views/EmployeeMasterView"));
const HelpView = lazy(() => import("./adapter/views/HelpView"));
const ReviewerWorkspaceView = lazy(() => import("./adapter/views/ReviewerWorkspaceView"));
const SettingsView = lazy(() => import("./adapter/views/SettingsView"));
const SheetEditorView = lazy(() => import("./adapter/views/SheetEditorView"));
const SheetListView = lazy(() => import("./adapter/views/SheetListView"));

const workspaceSettingsRepository = new SupabaseWorkspaceSettingsRepository();
const authRepository = new SupabaseAuthRepository(workspaceSettingsRepository);
const employeeRepository = new SupabaseEmployeeRepository();
const commonEvaluationRepository = new SupabaseCommonEvaluationRepository();
const evaluationSettingsRepository = new SupabaseEvaluationSettingsRepository();
const evaluationSheetRepository = new SupabaseEvaluationSheetRepository();
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
const smtpSettingsController = new SmtpSettingsController(
	workspaceSettingsRepository,
	new UpdateSmtpSettingsInteractor(workspaceSettingsRepository, employeeMasterRepository),
);
const emailNotificationRepository = new SupabaseEmailNotificationRepository();
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
	evaluationPeriodRepository,
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
const sheetPdfGateway = new TauriSheetPdfGateway();
const exportEvaluationSheetUseCase = new ExportEvaluationSheetInteractor(
	evaluationSheetRepository,
	employeeRepository,
	sheetPdfGateway,
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
	new FetchSheetOverviewInteractor(employeeMasterRepository, evaluationSheetRepository),
	sheetListPresenter.overviewOutputPort,
	new ExportSheetOverviewInteractor(
		employeeMasterRepository,
		evaluationSheetRepository,
		sheetPdfGateway,
	),
);
const sheetEditorController = new SheetEditorController(
	fetchEvaluationSheetUseCase,
	fetchDistinctPeriodsUseCase,
	createEvaluationSheetUseCase,
	fetchCategorizedSheetsUseCase,
	updateOverallCommentUseCase,
	updateEvaluationStatusUseCase,
	sheetEditorPresenter,
	employeeRepository,
);
const commonEvaluationController = new CommonEvaluationController(
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
	workspaceSettingsRepository,
);
const employeeMasterController = new EmployeeMasterController(
	loadEmployeeMasterUseCase,
	updateEmployeeEvaluatorUseCase,
	updateEmployeeGradeUseCase,
	updateEmployeeRoleUseCase,
	resetEmployeeRegistrationUseCase,
	new UpdateEmployeeKeepSignedInInteractor(employeeMasterRepository),
	new UpdateEmployeeEnabledInteractor(employeeMasterRepository),
	new IssueEmployeeInvitationInteractor(employeeMasterRepository),
	new IssuePendingEmployeeInvitationsInteractor(employeeMasterRepository),
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

	// A late response from the previous account must never restore its protected view.
	let userStatusGeneration = 0;
	const checkUserStatus = async (currentSession: AuthSession | null) => {
		const generation = ++userStatusGeneration;
		if (session()?.userId !== currentSession?.userId) {
			setIsLinked(null);
		}
		setSession(currentSession);
		const linked = currentSession
			? await employeeRepository.checkUserLinked(currentSession.userId)
			: false;
		const keep =
			linked && currentSession
				? await employeeRepository.findKeepSignedIn(currentSession.userId)
				: false;
		if (generation !== userStatusGeneration) {
			return;
		}
		authRepository.keepSignedIn(keep);
		setIsLinked(linked);
	};

	let unsubscribeAuth: (() => void) | undefined;
	onMount(async () => {
		// Subscribe first so an account switch during initialization is not missed.
		unsubscribeAuth = authRepository.onAuthStateChange((next) => {
			void checkUserStatus(next).then(() => setInitialized(true));
		});
		const generation = userStatusGeneration;
		const initial = await authRepository.getSession();
		if (generation === userStatusGeneration) {
			await checkUserStatus(initial);
		}
		setInitialized(true);
	});

	onCleanup(() => unsubscribeAuth?.());

	// ログイン済みの画面はトップバーを共有する。ページ移動のたびに作り直さない。
	const ProtectedLayout: Component<{ children?: JSX.Element }> = (props) => (
		<Show when={session() && isLinked()} fallback={<Navigate href="/login" />}>
			<DashboardLayout controller={accountController}>
				<Suspense fallback={<LoadingView />}>{props.children}</Suspense>
			</DashboardLayout>
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
								smtpController={smtpSettingsController}
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
