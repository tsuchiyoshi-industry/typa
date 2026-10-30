import { messageOf } from "../../application/errorMessage";
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
import { describeSheetEditError } from "../../application/usecases/SheetEditError";
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
	constructor(
		private readonly fetchSheetUseCase: FetchEvaluationSheetInteractor,
		private readonly fetchPeriodsUseCase: FetchDistinctPeriodsInteractor,
		private readonly createSheetUseCase: CreateEvaluationSheetInteractor,
		private readonly fetchAccessibleSheetsUseCase: FetchCategorizedSheetsInteractor,
		private readonly updateOverallCommentUseCase: UpdateOverallCommentInteractor,
		private readonly updateStatusUseCase: UpdateEvaluationStatusInteractor,
		private readonly presenter: {
			viewModel: () => SheetEditorViewModel;
			outputPort: {
				sheet: FetchEvaluationSheetOutputPort;
				periods: FetchDistinctPeriodsOutputPort;
				createSheet: CreateEvaluationSheetOutputPort;
				accessibleSheets: FetchCategorizedSheetsOutputPort;
				overallComment: UpdateOverallCommentOutputPort;
				status: UpdateEvaluationStatusOutputPort;
			};
			beginSheetLoad: (silent?: boolean) => void;
			beginAccessibleSheetsLoad: () => void;
			prepareNewSheet: () => void;
			setSelectedPeriodId: (id: number | null) => void;
			beginCreate: () => void;
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
				this.presenter.presentSheetError(messageOf(error, "シートを読み込めませんでした"));
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
				messageOf(error, "表示対象社員の取得に失敗しました"),
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
			this.presenter.presentPeriodsError(messageOf(error, "期間情報の取得に失敗しました"));
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
			const result = await this.updateOverallCommentUseCase.execute(
				{
					sheetId: sheet.sheetId,
					target,
					comment,
					currentEmployeeId,
				},
				this.presenter.outputPort.overallComment,
			);
			if (!result.ok) {
				this.presenter.presentOverallCommentUpdateError(describeSheetEditError(result.error));
				return false;
			}
			return true;
		} catch (error) {
			this.presenter.presentOverallCommentUpdateError(messageOf(error, "総評の保存に失敗しました"));
			return false;
		}
	}

	/** status: 進める先の状態。notify: 確定の通知メールを送るか。returnReason: 下書きへ戻す理由。 */
	async updateStatus(
		status: EvaluationStatus,
		notify = true,
		returnReason?: string,
	): Promise<boolean> {
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
			const result = await this.updateStatusUseCase.execute(
				{
					sheetId: sheet.sheetId,
					status,
					currentEmployeeId,
					notify,
					returnReason,
				},
				this.presenter.outputPort.status,
			);
			if (!result.ok) {
				this.presenter.presentStatusUpdateError(describeSheetEditError(result.error));
				return false;
			}
			return true;
		} catch (error) {
			this.presenter.presentStatusUpdateError(messageOf(error, "ステータスの変更に失敗しました"));
			return false;
		}
	}

	async resendNotification(): Promise<void> {
		const sheet = this.presenter.viewModel().sheet;
		if (!sheet) {
			throw new Error("評価シートがありません。");
		}
		const current = await this.requireCurrentEmployeeId(this.presenter.presentStatusUpdateError);
		if (current === null) {
			return;
		}
		const result = await this.updateStatusUseCase.resendNotification(
			sheet.sheetId,
			current,
			(delivery) => this.presenter.outputPort.status.presentNotificationDelivery?.(delivery),
		);
		if (!result.ok) {
			this.presenter.presentStatusUpdateError(describeSheetEditError(result.error));
		}
	}

	async createSheet(): Promise<number | null> {
		const viewModel = this.presenter.viewModel();
		// 作成中にもう一度押されても、二枚目を頼まない
		if (viewModel.creating) {
			return null;
		}
		const selectedPeriodId = viewModel.selectedPeriodId;
		if (!selectedPeriodId) {
			this.presenter.presentCreateError("評価期間を選択してください。");
			return null;
		}
		// 作成済みの期間で「作成」すると既存のシートが返り、作ったように見えてしまう
		if (viewModel.accessibleSheets.mySheets.some((sheet) => sheet.periodId === selectedPeriodId)) {
			this.presenter.presentCreateError("この評価期間の評価シートは作成済みです。");
			return null;
		}

		this.presenter.beginCreate();
		const currentEmployeeId = await this.requireCurrentEmployeeId(
			this.presenter.presentCreateError,
		);
		if (currentEmployeeId === null) {
			return null;
		}

		try {
			await this.createSheetUseCase.execute(
				{
					periodId: selectedPeriodId,
					employeeId: currentEmployeeId,
				},
				this.presenter.outputPort.createSheet,
			);
			return this.presenter.viewModel().createdSheetId;
		} catch (error) {
			this.presenter.presentCreateError(messageOf(error, "評価シートの作成に失敗しました"));
			return null;
		}
	}
}
