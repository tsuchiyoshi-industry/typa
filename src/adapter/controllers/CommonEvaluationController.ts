import type {
	CreateEvaluationSheetInteractor,
	CreateEvaluationSheetOutputPort,
} from "../../application/usecases/CreateEvaluationSheetInteractor";
import type {
	LoadCommonEvaluationInteractor,
	LoadCommonEvaluationOutputPort,
} from "../../application/usecases/LoadCommonEvaluationInteractor";
import type {
	UpsertCommonEvaluationInteractor,
	UpsertCommonEvaluationOutputPort,
} from "../../application/usecases/UpsertCommonEvaluationInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";

export class CommonEvaluationController {
	constructor(
		private readonly loadUseCase: LoadCommonEvaluationInteractor,
		private readonly upsertUseCase: UpsertCommonEvaluationInteractor,
		private readonly createSheetUseCase: CreateEvaluationSheetInteractor,
		private readonly presenter: {
			viewModel: () => CommonEvaluationViewModel;
			outputPort: {
				load: LoadCommonEvaluationOutputPort;
				upsert: UpsertCommonEvaluationOutputPort;
			};
			presentLoadError: (message: string) => void;
			presentUpsertError: (message: string) => void;
		},
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async load(sheetId: number, gradeId: number | null): Promise<void> {
		try {
			await this.loadUseCase.execute({ sheetId, gradeId }, this.presenter.outputPort.load);
		} catch (error) {
			this.presenter.presentLoadError(
				error instanceof Error ? error.message : "共通評価の取得に失敗しました",
			);
		}
	}

	async upsert(
		sheetId: number,
		results: Array<{
			id: number;
			itemId: number;
			firstComment: string;
			firstScore: number;
			secondScore: number;
		}>,
		canEditFirst: boolean,
		canEditSecond: boolean,
	): Promise<boolean> {
		try {
			await this.upsertUseCase.execute(
				{ sheetId, results, canEditFirst, canEditSecond },
				this.presenter.outputPort.upsert,
			);
			return true;
		} catch (error) {
			this.presenter.presentUpsertError(
				error instanceof Error ? error.message : "登録に失敗しました",
			);
			return false;
		}
	}

	async createSheet(
		periodId: number,
		employeeId: number,
		drafts: Array<{
			itemId: number;
			firstComment: string;
			firstScore: number;
			secondScore: number;
		}>,
	): Promise<number | null> {
		const currentEmployeeId = await this.employeeRepository.findCurrentEmployeeId();
		if (currentEmployeeId == null) {
			this.presenter.presentUpsertError("ログインが必要です");
			return null;
		}

		try {
			await this.createSheetUseCase.execute({ periodId, employeeId, drafts }, {
				present: () => {},
			} as CreateEvaluationSheetOutputPort);
			return currentEmployeeId;
		} catch (error) {
			this.presenter.presentUpsertError(
				error instanceof Error ? error.message : "シート作成に失敗しました",
			);
			return null;
		}
	}
}
