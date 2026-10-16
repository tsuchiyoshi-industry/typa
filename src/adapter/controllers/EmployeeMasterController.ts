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
import type {
	UpdateEmployeeKeepSignedInInteractor,
	UpdateEmployeeKeepSignedInOutputPort,
} from "../../application/usecases/UpdateEmployeeKeepSignedInInteractor";
import type {
	UpdateEmployeeRoleInteractor,
	UpdateEmployeeRoleOutputPort,
} from "../../application/usecases/UpdateEmployeeRoleInteractor";
import type {
	EmployeeMasterRepository,
	EvaluatorType,
} from "../../domain/repositories/EmployeeMasterRepository";
import type { EmployeeMasterViewModel } from "../presenters/EmployeeMasterPresenter";

export class EmployeeMasterController {
	constructor(
		private readonly loadUseCase: LoadEmployeeMasterInteractor,
		private readonly updateUseCase: UpdateEmployeeEvaluatorInteractor,
		private readonly updateGradeUseCase: UpdateEmployeeGradeInteractor,
		private readonly updateRoleUseCase: UpdateEmployeeRoleInteractor,
		private readonly resetRegistrationUseCase: ResetEmployeeRegistrationInteractor,
		private readonly updateKeepSignedInUseCase: UpdateEmployeeKeepSignedInInteractor,
		private readonly presenter: {
			viewModel: () => EmployeeMasterViewModel;
			outputPort: {
				load: LoadEmployeeMasterOutputPort;
				update: UpdateEmployeeEvaluatorOutputPort;
				updateGrade: UpdateEmployeeGradeOutputPort;
				updateRole: UpdateEmployeeRoleOutputPort;
				updateKeepSignedIn: UpdateEmployeeKeepSignedInOutputPort;
				resetRegistration: ResetEmployeeRegistrationOutputPort;
			};
			beginLoad: () => void;
			presentError: (message: string) => void;
		},
		private readonly accessRepository?: EmployeeMasterRepository,
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

	updateRole(targetEmployeeNo: string, roleName: string): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.updateRoleUseCase.execute(
					{ targetEmployeeNo, roleName },
					this.presenter.outputPort.updateRole,
				),
			"権限の変更に失敗しました",
		);
	}

	updateKeepSignedIn(targetEmployeeNo: string, keepSignedIn: boolean): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.updateKeepSignedInUseCase.execute(
					{ targetEmployeeNo, keepSignedIn },
					this.presenter.outputPort.updateKeepSignedIn,
				),
			"ログイン状態の保持を変更できませんでした",
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

	async issueInvitation(employeeNo: string): Promise<{ code: string; expiresAt: string }> {
		const repo = await this.requireAccessAdmin();
		return repo.issueInvitation(employeeNo);
	}

	async setEnabled(employeeNo: string, enabled: boolean): Promise<boolean> {
		const repo = await this.requireAccessAdmin();
		const changed = await repo.setEnabled(employeeNo, enabled);
		if (changed) {
			await this.load();
		}
		return changed;
	}

	private async requireAccessAdmin(): Promise<EmployeeMasterRepository> {
		const repo = this.accessRepository;
		const current = await repo?.findCurrentEmployeeProfile();
		if (!repo || !current?.role.isAdmin()) {
			throw new Error("Admin のみ操作できます。");
		}
		return repo;
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
