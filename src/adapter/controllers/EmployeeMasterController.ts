import type {
	AssignEvaluatorInteractor,
	AssignEvaluatorOutputPort,
} from "../../application/usecases/AssignEvaluatorInteractor";
import type {
	LoadEmployeeMasterInteractor,
	LoadEmployeeMasterOutputPort,
} from "../../application/usecases/LoadEmployeeMasterInteractor";
import type {
	UpdateEmployeeEvaluatorInteractor,
	UpdateEmployeeEvaluatorOutputPort,
} from "../../application/usecases/UpdateEmployeeEvaluatorInteractor";
import type { EvaluatorType } from "../../domain/repositories/EmployeeMasterRepository";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";

export class EmployeeMasterController {
	constructor(
		private readonly loadUseCase: LoadEmployeeMasterInteractor,
		private readonly assignUseCase: AssignEvaluatorInteractor,
		private readonly updateUseCase: UpdateEmployeeEvaluatorInteractor,
		private readonly presenter: {
			viewModel: () => EmployeeMasterViewModel;
			outputPort: {
				load: LoadEmployeeMasterOutputPort;
				assign: AssignEvaluatorOutputPort;
				update: UpdateEmployeeEvaluatorOutputPort;
			};
			beginLoad: () => void;
			presentError: (message: string) => void;
			clearAssignmentStatus: () => void;
		},
	) {}

	async load(): Promise<void> {
		this.presenter.beginLoad();
		try {
			await this.loadUseCase.execute({}, this.presenter.outputPort.load);
		} catch (error) {
			this.presenter.presentError(
				error instanceof Error ? error.message : "社員マスタの取得に失敗しました",
			);
		}
	}

	async assignEvaluator(employeeNo: string, evaluatorType: EvaluatorType): Promise<void> {
		try {
			await this.assignUseCase.execute(
				{ employeeNo, evaluatorType },
				this.presenter.outputPort.assign,
			);
			if (this.presenter.viewModel().assignmentStatus.success) {
				await this.loadUseCase.execute({}, this.presenter.outputPort.load);
			}
		} catch (error) {
			this.presenter.presentError(
				error instanceof Error ? error.message : "評価者の設定に失敗しました",
			);
		}
	}

	async updateEvaluator(
		targetEmployeeNo: string,
		evaluatorEmployeeNo: string,
		evaluatorType: EvaluatorType,
	): Promise<void> {
		try {
			await this.updateUseCase.execute(
				{ targetEmployeeNo, evaluatorEmployeeNo, evaluatorType },
				this.presenter.outputPort.update,
			);
			if (this.presenter.viewModel().assignmentStatus.success) {
				await this.loadUseCase.execute({}, this.presenter.outputPort.load);
			}
		} catch (error) {
			this.presenter.presentError(
				error instanceof Error ? error.message : "評価者の更新に失敗しました",
			);
		}
	}

	clearAssignmentStatus(): void {
		this.presenter.clearAssignmentStatus();
	}
}
