import type { EmployeeDto } from "../../application/dtos/EmployeeDto";
import type {
	CheckEvaluatorRoleInteractor,
	CheckEvaluatorRoleOutputPort,
} from "../../application/usecases/CheckEvaluatorRoleInteractor";
import type {
	CreateEvaluationSheetInteractor,
	CreateEvaluationSheetOutputPort,
} from "../../application/usecases/CreateEvaluationSheetInteractor";
import type {
	FetchCategorizedSheetsInteractor,
	FetchCategorizedSheetsOutputPort,
} from "../../application/usecases/FetchCategorizedSheetsInteractor";
import type {
	FetchDistinctPeriodsInteractor,
	FetchDistinctPeriodsOutputPort,
} from "../../application/usecases/FetchDistinctPeriodsInteractor";
import type {
	FetchEvaluationSheetInteractor,
	FetchEvaluationSheetOutputPort,
} from "../../application/usecases/FetchEvaluationSheetInteractor";
import type {
	OverallCommentTarget,
	UpdateOverallCommentInteractor,
	UpdateOverallCommentOutputPort,
} from "../../application/usecases/UpdateOverallCommentInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";

export class SheetEditorController {
	constructor(
		private readonly fetchSheetUseCase: FetchEvaluationSheetInteractor,
		private readonly fetchPeriodsUseCase: FetchDistinctPeriodsInteractor,
		private readonly createSheetUseCase: CreateEvaluationSheetInteractor,
		private readonly checkRoleUseCase: CheckEvaluatorRoleInteractor,
		private readonly fetchAccessibleSheetsUseCase: FetchCategorizedSheetsInteractor,
		private readonly updateOverallCommentUseCase: UpdateOverallCommentInteractor,
		private readonly presenter: {
			viewModel: () => SheetEditorViewModel;
			outputPort: {
				sheet: FetchEvaluationSheetOutputPort;
				periods: FetchDistinctPeriodsOutputPort;
				createSheet: CreateEvaluationSheetOutputPort;
				role: CheckEvaluatorRoleOutputPort;
				accessibleSheets: FetchCategorizedSheetsOutputPort;
				overallComment: UpdateOverallCommentOutputPort;
			};
			beginSheetLoad: () => void;
			beginAccessibleSheetsLoad: () => void;
			prepareNewSheet: () => void;
			setSelectedPeriodId: (id: number | null) => void;
			presentSheetError: (message: string) => void;
			presentAccessibleSheetsError: (message: string) => void;
			presentPeriodsError: (message: string) => void;
			presentCreateError: (message: string) => void;
			beginOverallCommentUpdate: () => void;
			presentOverallCommentUpdateError: (message: string) => void;
		},
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async loadSheet(sheetId: number): Promise<number | null> {
		this.presenter.beginSheetLoad();
		try {
			await this.fetchSheetUseCase.execute({ sheetId }, this.presenter.outputPort.sheet);
			return sheetId;
		} catch (error) {
			this.presenter.presentSheetError(
				error instanceof Error ? error.message : "シートを読み込めませんでした",
			);
			return null;
		}
	}

	async loadAccessibleSheets(): Promise<void> {
		this.presenter.beginAccessibleSheetsLoad();
		try {
			await this.fetchAccessibleSheetsUseCase.execute(
				{},
				this.presenter.outputPort.accessibleSheets,
			);
		} catch (error) {
			this.presenter.presentAccessibleSheetsError(
				error instanceof Error ? error.message : "表示対象社員の取得に失敗しました",
			);
		}
	}

	prepareNewSheet(): void {
		this.presenter.prepareNewSheet();
	}

	async loadPeriods(): Promise<void> {
		try {
			await this.fetchPeriodsUseCase.execute({}, this.presenter.outputPort.periods);
		} catch (error) {
			this.presenter.presentPeriodsError(
				error instanceof Error ? error.message : "期間情報の取得に失敗しました",
			);
		}
	}

	async loadRoles(subject: EmployeeDto | null): Promise<void> {
		try {
			await this.checkRoleUseCase.execute({ subject }, this.presenter.outputPort.role);
		} catch (error) {
			this.presenter.presentSheetError(
				error instanceof Error ? error.message : "権限情報の取得に失敗しました",
			);
		}
	}

	setSelectedPeriod(id: number | null): void {
		this.presenter.setSelectedPeriodId(id);
	}

	async updateOverallComment(target: OverallCommentTarget, comment: string): Promise<boolean> {
		const { sheet, canEditFirst, canEditSecond } = this.presenter.viewModel();
		if (!sheet?.sheetId) {
			this.presenter.presentOverallCommentUpdateError(
				"評価シートIDを取得できないため、総評を保存できません。",
			);
			return false;
		}

		this.presenter.beginOverallCommentUpdate();
		try {
			await this.updateOverallCommentUseCase.execute(
				{
					sheetId: sheet.sheetId,
					target,
					comment,
					canEditFirst,
					canEditSecond,
				},
				this.presenter.outputPort.overallComment,
			);
			return true;
		} catch (error) {
			this.presenter.presentOverallCommentUpdateError(
				error instanceof Error ? error.message : "総評の保存に失敗しました",
			);
			return false;
		}
	}

	async createSheet(
		drafts: Array<{
			itemId: number;
			firstComment: string;
			firstScore: number;
			secondScore: number;
		}>,
	): Promise<number | null> {
		// 1. 分割代入でデータとエラーを取得
		const { data: currentEmployeeId, error: authError } =
			await this.employeeRepository.findCurrentEmployeeId();

		// 2. 認証・社員紐付けチェック
		if (authError || currentEmployeeId === null) {
			const message = authError ? `認証エラー: ${authError.message}` : "ログインが必要です。";
			this.presenter.presentCreateError(message);
			return null;
		}

		const selectedPeriodId = this.presenter.viewModel().selectedPeriodId;
		if (!selectedPeriodId) {
			this.presenter.presentCreateError("評価期間を選択してください。");
			return null;
		}

		try {
			await this.createSheetUseCase.execute(
				{
					periodId: selectedPeriodId,
					employeeId: currentEmployeeId, // ここに正しい number が渡る
					drafts,
				},
				this.presenter.outputPort.createSheet,
			);
			return this.presenter.viewModel().createdSheetId;
		} catch (error) {
			this.presenter.presentCreateError(
				error instanceof Error ? error.message : "評価シートの作成に失敗しました",
			);
			return null;
		}
	}
}
