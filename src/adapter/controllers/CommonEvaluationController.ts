import { messageOf } from "../../application/errorMessage";
import type {
	UpsertCommonEvaluationInteractor,
	UpsertCommonEvaluationOutputPort,
} from "../../application/usecases/UpsertCommonEvaluationInteractor";
import { describeUpsertCommonEvaluationError } from "../../application/usecases/UpsertCommonEvaluationInteractor";
import type { EmployeeRepository } from "../../domain/repositories/EmployeeRepository";
import type { CommonEvaluationViewModel } from "../presenters/CommonEvaluationPresenter";
import { requireCurrentEmployeeId } from "./currentEmployee";

export class CommonEvaluationController {
	constructor(
		private readonly upsertUseCase: UpsertCommonEvaluationInteractor,
		private readonly presenter: {
			viewModel: () => CommonEvaluationViewModel;
			outputPort: {
				upsert: UpsertCommonEvaluationOutputPort;
			};
			presentUpsertError: (message: string) => void;
		},
		private readonly employeeRepository: EmployeeRepository,
	) {}

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
			const result = await this.upsertUseCase.execute(
				{ sheetId, results, currentEmployeeId },
				this.presenter.outputPort.upsert,
			);
			if (!result.ok) {
				this.presenter.presentUpsertError(describeUpsertCommonEvaluationError(result.error));
				return false;
			}
			return true;
		} catch (error) {
			this.presenter.presentUpsertError(messageOf(error, "登録に失敗しました"));
			return false;
		}
	}
}
