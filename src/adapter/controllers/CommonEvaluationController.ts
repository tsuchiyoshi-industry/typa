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
import { requireCurrentEmployeeId } from "./currentEmployee";

export class CommonEvaluationController {
	private loadGeneration = 0;
	constructor(
		private readonly loadUseCase: LoadCommonEvaluationInteractor,
		private readonly upsertUseCase: UpsertCommonEvaluationInteractor,
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
		const generation = ++this.loadGeneration;
		this.presenter.beginLoad();

		const currentEmployeeId = await requireCurrentEmployeeId(this.employeeRepository, (message) => {
			if (generation === this.loadGeneration) {
				this.presenter.presentLoadError(message);
			}
		});
		if (currentEmployeeId === null) {
			return;
		}

		try {
			await this.loadUseCase.execute(
				{ sheetId, gradeId, currentEmployeeId },
				{
					present: (response) => {
						if (generation === this.loadGeneration) {
							this.presenter.outputPort.load.present(response);
						}
					},
				},
			);
		} catch (error) {
			if (generation === this.loadGeneration) {
				this.presenter.presentLoadError(
					error instanceof Error ? error.message : "共通評価の取得に失敗しました",
				);
			}
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
		const currentEmployeeId = await requireCurrentEmployeeId(
			this.employeeRepository,
			this.presenter.presentUpsertError,
		);
		if (currentEmployeeId === null) {
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
}
