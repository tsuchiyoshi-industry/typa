import type {
	LoadEmployeeMasterInteractor,
	LoadEmployeeMasterOutputPort,
} from "../../application/usecases/LoadEmployeeMasterInteractor";
import type {
	ResetEmployeeRegistrationInteractor,
	ResetEmployeeRegistrationOutputPort,
} from "../../application/usecases/ResetEmployeeRegistrationInteractor";
import type {
	UpdateEmployeeEvaluatorInteractor,
	UpdateEmployeeEvaluatorOutputPort,
} from "../../application/usecases/UpdateEmployeeEvaluatorInteractor";
import type {
	UpdateEmployeeGradeInteractor,
	UpdateEmployeeGradeOutputPort,
} from "../../application/usecases/UpdateEmployeeGradeInteractor";
import type { EvaluatorType } from "../../domain/repositories/EmployeeMasterRepository";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";

export class EmployeeMasterController {
	constructor(
		private readonly loadUseCase: LoadEmployeeMasterInteractor,
		private readonly updateUseCase: UpdateEmployeeEvaluatorInteractor,
		private readonly updateGradeUseCase: UpdateEmployeeGradeInteractor,
		private readonly resetRegistrationUseCase: ResetEmployeeRegistrationInteractor,
		private readonly presenter: {
			viewModel: () => EmployeeMasterViewModel;
			outputPort: {
				load: LoadEmployeeMasterOutputPort;
				update: UpdateEmployeeEvaluatorOutputPort;
				updateGrade: UpdateEmployeeGradeOutputPort;
				resetRegistration: ResetEmployeeRegistrationOutputPort;
			};
			beginLoad: () => void;
			presentError: (message: string) => void;
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

	/** 更新できたら true。画面側は false のとき選択を元に戻す。 */
	updateEvaluator(
		targetEmployeeNo: string,
		evaluatorEmployeeNo: string | null,
		evaluatorType: EvaluatorType,
	): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.updateUseCase.execute(
					{ targetEmployeeNo, evaluatorEmployeeNo, evaluatorType },
					this.presenter.outputPort.update,
				),
			"評価者の更新に失敗しました",
		);
	}

	updateGrade(targetEmployeeNo: string, gradeId: number): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.updateGradeUseCase.execute(
					{ targetEmployeeNo, gradeId },
					this.presenter.outputPort.updateGrade,
				),
			"等級の更新に失敗しました",
		);
	}

	resetRegistration(targetEmployeeNo: string): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.resetRegistrationUseCase.execute(
					{ targetEmployeeNo },
					this.presenter.outputPort.resetRegistration,
				),
			"登録の取り消しに失敗しました",
		);
	}

	private async applyUpdate(
		execute: () => Promise<void>,
		fallbackMessage: string,
	): Promise<boolean> {
		try {
			await execute();
		} catch (error) {
			this.presenter.presentError(error instanceof Error ? error.message : fallbackMessage);
			return false;
		}
		if (!this.presenter.viewModel().updateStatus.success) {
			return false;
		}
		await this.load();
		return true;
	}
}
