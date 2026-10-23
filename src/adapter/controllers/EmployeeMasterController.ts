import { messageOf } from "../../application/errorMessage";
import type {
	IssueEmployeeInvitationInteractor,
	IssueEmployeeInvitationOutputPort,
	IssuePendingEmployeeInvitationsInteractor,
} from "../../application/usecases/IssueEmployeeInvitationInteractor";
import type {
	LoadEmployeeMasterInteractor,
	LoadEmployeeMasterOutputPort,
} from "../../application/usecases/LoadEmployeeMasterInteractor";
import type {
	PreRegisterEmployeeInteractor,
	PreRegisterEmployeeRequest,
} from "../../application/usecases/PreRegisterEmployeeInteractor";
import type { ResetEmployeeRegistrationInteractor } from "../../application/usecases/ResetEmployeeRegistrationInteractor";
import type {
	UpdateEmployeeEnabledInteractor,
	UpdateEmployeeEnabledOutputPort,
} from "../../application/usecases/UpdateEmployeeEnabledInteractor";
import type { UpdateEmployeeEvaluatorInteractor } from "../../application/usecases/UpdateEmployeeEvaluatorInteractor";
import type { UpdateEmployeeGradeInteractor } from "../../application/usecases/UpdateEmployeeGradeInteractor";
import type { UpdateEmployeeKeepSignedInInteractor } from "../../application/usecases/UpdateEmployeeKeepSignedInInteractor";
import type { UpdateEmployeeRoleInteractor } from "../../application/usecases/UpdateEmployeeRoleInteractor";
import type { EvaluatorType } from "../../domain/repositories/EmployeeMasterRepository";
import type {
	EmployeeMasterViewModel,
	EmployeeUpdateOutputPort,
} from "../presenters/EmployeeMasterPresenter";

export class EmployeeMasterController {
	constructor(
		private readonly loadUseCase: LoadEmployeeMasterInteractor,
		private readonly updateUseCase: UpdateEmployeeEvaluatorInteractor,
		private readonly updateGradeUseCase: UpdateEmployeeGradeInteractor,
		private readonly updateRoleUseCase: UpdateEmployeeRoleInteractor,
		private readonly resetRegistrationUseCase: ResetEmployeeRegistrationInteractor,
		private readonly updateKeepSignedInUseCase: UpdateEmployeeKeepSignedInInteractor,
		private readonly updateEnabledUseCase: UpdateEmployeeEnabledInteractor,
		private readonly issueInvitationUseCase: IssueEmployeeInvitationInteractor,
		private readonly issuePendingInvitationsUseCase: IssuePendingEmployeeInvitationsInteractor,
		private readonly preRegisterUseCase: PreRegisterEmployeeInteractor,
		private readonly presenter: {
			viewModel: () => EmployeeMasterViewModel;
			outputPort: {
				load: LoadEmployeeMasterOutputPort;
				update: EmployeeUpdateOutputPort;
				updateEnabled: UpdateEmployeeEnabledOutputPort;
				issueInvitation: IssueEmployeeInvitationOutputPort;
			};
			beginLoad: () => void;
			dismissInvitation: () => void;
			presentError: (message: string) => void;
		},
	) {}

	async load(): Promise<void> {
		this.presenter.beginLoad();
		try {
			await this.loadUseCase.execute({}, this.presenter.outputPort.load);
		} catch (error) {
			this.presenter.presentError(messageOf(error, "社員マスタの取得に失敗しました"));
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
					this.presenter.outputPort.update,
				),
			"等級の更新に失敗しました",
		);
	}

	updateRole(targetEmployeeNo: string, roleName: string): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.updateRoleUseCase.execute(
					{ targetEmployeeNo, roleName },
					this.presenter.outputPort.update,
				),
			"権限の変更に失敗しました",
		);
	}

	updateKeepSignedIn(targetEmployeeNo: string, keepSignedIn: boolean): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.updateKeepSignedInUseCase.execute(
					{ targetEmployeeNo, keepSignedIn },
					this.presenter.outputPort.update,
				),
			"ログイン状態の保持を変更できませんでした",
		);
	}

	resetRegistration(targetEmployeeNo: string): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.resetRegistrationUseCase.execute(
					{ targetEmployeeNo },
					this.presenter.outputPort.update,
				),
			"登録の取り消しに失敗しました",
		);
	}

	updateEnabled(targetEmployeeNo: string, enabled: boolean): Promise<boolean> {
		return this.applyUpdate(
			() =>
				this.updateEnabledUseCase.execute(
					{ targetEmployeeNo, enabled },
					this.presenter.outputPort.updateEnabled,
				),
			"利用状態を変更できませんでした",
		);
	}

	/** 発行しても一覧の中身は変わらないので、読み込み直さない。コードは viewModel.invitations に載る。 */
	async issueInvitation(targetEmployeeNo: string): Promise<void> {
		try {
			await this.issueInvitationUseCase.execute(
				{ targetEmployeeNo },
				this.presenter.outputPort.issueInvitation,
			);
		} catch (error) {
			this.presenter.presentError(messageOf(error, "招待コードを発行できませんでした"));
		}
	}

	async issuePendingInvitations(): Promise<void> {
		try {
			await this.issuePendingInvitationsUseCase.execute(
				{},
				this.presenter.outputPort.issueInvitation,
			);
		} catch (error) {
			this.presenter.presentError(messageOf(error, "招待コードを発行できませんでした"));
		}
	}

	/** 仮登録できたら true。一覧は読み込み直すので、評価者の選択肢にもすぐ出る。 */
	preRegister(request: PreRegisterEmployeeRequest): Promise<boolean> {
		return this.applyUpdate(
			() => this.preRegisterUseCase.execute(request, this.presenter.outputPort.update),
			"仮登録できませんでした",
		);
	}

	dismissInvitation(): void {
		this.presenter.dismissInvitation();
	}

	private async applyUpdate(
		execute: () => Promise<void>,
		fallbackMessage: string,
	): Promise<boolean> {
		try {
			await execute();
		} catch (error) {
			this.presenter.presentError(messageOf(error, fallbackMessage));
			return false;
		}
		if (!this.presenter.viewModel().updateStatus.success) {
			return false;
		}
		await this.load();
		return true;
	}
}
