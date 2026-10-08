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
	UpdateEvaluationStatusInteractor,
	UpdateEvaluationStatusOutputPort,
} from "../../application/usecases/UpdateEvaluationStatusInteractor";
import type {
	UpdateOverallCommentInteractor,
	UpdateOverallCommentOutputPort,
} from "../../application/usecases/UpdateOverallCommentInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { EvaluationStatus } from "../../domain/valueObjects/EvaluationStatus";
import type { SheetEditorViewModel } from "../presenters/SheetEditorPresenter";
import { requireCurrentEmployeeId } from "./currentEmployee";

export class SheetEditorController {
	private sheetLoadGeneration = 0;
	private roleLoadGeneration = 0;
	constructor(
		private readonly fetchSheetUseCase: FetchEvaluationSheetInteractor,
		private readonly fetchPeriodsUseCase: FetchDistinctPeriodsInteractor,
		private readonly createSheetUseCase: CreateEvaluationSheetInteractor,
		private readonly checkRoleUseCase: CheckEvaluatorRoleInteractor,
		private readonly fetchAccessibleSheetsUseCase: FetchCategorizedSheetsInteractor,
		private readonly updateOverallCommentUseCase: UpdateOverallCommentInteractor,
		private readonly updateStatusUseCase: UpdateEvaluationStatusInteractor,
		private readonly presenter: {
			viewModel: () => SheetEditorViewModel;
			outputPort: {
				sheet: FetchEvaluationSheetOutputPort;
				periods: FetchDistinctPeriodsOutputPort;
				createSheet: CreateEvaluationSheetOutputPort;
				role: CheckEvaluatorRoleOutputPort;
				accessibleSheets: FetchCategorizedSheetsOutputPort;
				overallComment: UpdateOverallCommentOutputPort;
				status: UpdateEvaluationStatusOutputPort;
			};
			beginSheetLoad: (silent?: boolean) => void;
			beginAccessibleSheetsLoad: () => void;
			prepareNewSheet: () => void;
			setSelectedPeriodId: (id: number | null) => void;
			presentSheetError: (message: string) => void;
			presentAccessibleSheetsError: (message: string) => void;
			presentPeriodsError: (message: string) => void;
			presentCreateError: (message: string) => void;
			beginOverallCommentUpdate: () => void;
			presentOverallCommentUpdateError: (message: string) => void;
			beginStatusUpdate: () => void;
			presentStatusUpdateError: (message: string) => void;
		},
		private readonly employeeRepository: EmployeeRepository,
	) {}

	private requireCurrentEmployeeId(
		presentError: (message: string) => void,
	): Promise<number | null> {
		return requireCurrentEmployeeId(this.employeeRepository, presentError);
	}

	async loadSheet(sheetId: number, silent = false): Promise<number | null> {
		const generation = ++this.sheetLoadGeneration;
		if (!silent) {
			++this.roleLoadGeneration;
		}
		this.presenter.beginSheetLoad(silent);
		try {
			const { data: currentEmployeeId } = await this.employeeRepository.findCurrentEmployeeId();
			await this.fetchSheetUseCase.execute(
				{ sheetId, currentEmployeeId },
				{
					present: (response) => {
						if (generation === this.sheetLoadGeneration) {
							this.presenter.outputPort.sheet.present(response);
						}
					},
				},
			);
			return sheetId;
		} catch (error) {
			if (generation === this.sheetLoadGeneration) {
				this.presenter.presentSheetError(
					error instanceof Error ? error.message : "シートを読み込めませんでした",
				);
			}
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

	async loadRoles(sheetId: number | null): Promise<void> {
		const generation = ++this.roleLoadGeneration;
		try {
			await this.checkRoleUseCase.execute(
				{ sheetId },
				{
					present: (response) => {
						if (
							generation === this.roleLoadGeneration &&
							this.presenter.viewModel().sheet?.sheetId === sheetId
						) {
							this.presenter.outputPort.role.present(response);
						}
					},
				},
			);
		} catch (error) {
			if (generation === this.roleLoadGeneration) {
				this.presenter.presentSheetError(
					error instanceof Error ? error.message : "権限情報の取得に失敗しました",
				);
			}
		}
	}

	setSelectedPeriod(id: number | null): void {
		this.presenter.setSelectedPeriodId(id);
	}

	async updateOverallComment(target: "first" | "second", comment: string): Promise<boolean> {
		const { sheet } = this.presenter.viewModel();
		if (!sheet?.sheetId) {
			this.presenter.presentOverallCommentUpdateError(
				"評価シートIDを取得できないため、総評を保存できません。",
			);
			return false;
		}

		const currentEmployeeId = await this.requireCurrentEmployeeId(
			this.presenter.presentOverallCommentUpdateError,
		);
		if (currentEmployeeId === null) {
			return false;
		}

		this.presenter.beginOverallCommentUpdate();
		try {
			await this.updateOverallCommentUseCase.execute(
				{
					sheetId: sheet.sheetId,
					target,
					comment,
					currentEmployeeId,
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

	/** status: 進める先の状態。notify: 確定の通知メールを送るか。 */
	async updateStatus(status: EvaluationStatus, notify = true): Promise<boolean> {
		const { sheet } = this.presenter.viewModel();
		if (!sheet?.sheetId) {
			this.presenter.presentStatusUpdateError(
				"評価シートIDを取得できないため、ステータスを変更できません。",
			);
			return false;
		}

		const currentEmployeeId = await this.requireCurrentEmployeeId(
			this.presenter.presentStatusUpdateError,
		);
		if (currentEmployeeId === null) {
			return false;
		}

		this.presenter.beginStatusUpdate();
		try {
			await this.updateStatusUseCase.execute(
				{
					sheetId: sheet.sheetId,
					status,
					currentEmployeeId,
					notify,
				},
				this.presenter.outputPort.status,
			);
			return true;
		} catch (error) {
			this.presenter.presentStatusUpdateError(
				error instanceof Error ? error.message : "ステータスの変更に失敗しました",
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
		const currentEmployeeId = await this.requireCurrentEmployeeId(
			this.presenter.presentCreateError,
		);
		if (currentEmployeeId === null) {
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
