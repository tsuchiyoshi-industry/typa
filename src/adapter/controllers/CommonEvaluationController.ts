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
			beginLoad: () => void;
			presentLoadError: (message: string) => void;
			presentUpsertError: (message: string) => void;
		},
		private readonly employeeRepository: EmployeeRepository,
	) {}

	async load(sheetId: number, gradeId: number | null): Promise<void> {
		this.presenter.beginLoad();

		const { data: currentEmployeeId, error: authError } =
			await this.employeeRepository.findCurrentEmployeeId();
		if (authError || currentEmployeeId === null) {
			this.presenter.presentLoadError(
				authError ? `認証エラー: ${authError.message}` : "ログインが必要です。",
			);
			return;
		}

		try {
			await this.loadUseCase.execute(
				{ sheetId, gradeId, currentEmployeeId },
				this.presenter.outputPort.load,
			);
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
	): Promise<boolean> {
		const { data: currentEmployeeId, error: authError } =
			await this.employeeRepository.findCurrentEmployeeId();
		if (authError || currentEmployeeId === null) {
			this.presenter.presentUpsertError(
				authError ? `認証エラー: ${authError.message}` : "ログインが必要です。",
			);
			return false;
		}

		try {
			await this.upsertUseCase.execute(
				{ sheetId, results, currentEmployeeId },
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
		// 1. リポジトリからデータとエラーを分解して取得
		const { data: currentEmployeeId, error: authError } =
			await this.employeeRepository.findCurrentEmployeeId();

		// 2. 権限・ログインチェック
		if (authError || currentEmployeeId === null) {
			const message = authError ? `認証エラー: ${authError.message}` : "ログインが必要です";
			this.presenter.presentUpsertError(message);
			return null;
		}

		try {
			// 3. UseCase の実行
			await this.createSheetUseCase.execute({ periodId, employeeId, drafts }, {
				present: () => {},
			} as CreateEvaluationSheetOutputPort);

			// 成功時は現在の社員IDを返す
			return currentEmployeeId;
		} catch (error) {
			this.presenter.presentUpsertError(
				error instanceof Error ? error.message : "シート作成に失敗しました",
			);
			return null;
		}
	}
}
