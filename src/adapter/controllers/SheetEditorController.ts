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
	FetchDistinctPeriodsInteractor,
	FetchDistinctPeriodsOutputPort,
} from "../../application/usecases/FetchDistinctPeriodsInteractor";
import type {
	FetchEvaluationSheetInteractor,
	FetchEvaluationSheetOutputPort,
} from "../../application/usecases/FetchEvaluationSheetInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";

export class SheetEditorController {
	constructor(
		private readonly fetchSheetUseCase: FetchEvaluationSheetInteractor,
		private readonly fetchPeriodsUseCase: FetchDistinctPeriodsInteractor,
		private readonly createSheetUseCase: CreateEvaluationSheetInteractor,
		private readonly checkRoleUseCase: CheckEvaluatorRoleInteractor,
		private readonly presenter: {
			viewModel: () => SheetEditorViewModel;
			outputPort: {
				sheet: FetchEvaluationSheetOutputPort;
				periods: FetchDistinctPeriodsOutputPort;
				createSheet: CreateEvaluationSheetOutputPort;
				role: CheckEvaluatorRoleOutputPort;
			};
			beginSheetLoad: () => void;
			prepareNewSheet: () => void;
			setSelectedPeriodId: (id: number | null) => void;
			presentSheetError: (message: string) => void;
			presentPeriodsError: (message: string) => void;
			presentCreateError: (message: string) => void;
		},
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async loadSheet(sheetId: number): Promise<void> {
		this.presenter.beginSheetLoad();
		try {
			await this.fetchSheetUseCase.execute({ sheetId }, this.presenter.outputPort.sheet);
		} catch (error) {
			this.presenter.presentSheetError(
				error instanceof Error ? error.message : "シートを読み込めませんでした",
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

	async createSheet(
		drafts: Array<{
			itemId: number;
			firstComment: string;
			firstScore: number;
			secondScore: number;
		}>,
	): Promise<number | null> {
		const currentEmployeeId = await this.employeeRepository.findCurrentEmployeeId();
		if (currentEmployeeId == null) {
			this.presenter.presentCreateError("ログインが必要です。");
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
					employeeId: currentEmployeeId,
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
