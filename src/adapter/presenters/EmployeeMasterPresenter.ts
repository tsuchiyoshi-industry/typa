import { createSignal } from "solid-js";
import type { EmployeeMasterDto } from "../../application/dtos/EmployeeMasterDto";
import type {
	IssuedEmployeeInvitation,
	IssueEmployeeInvitationOutputPort,
} from "../../application/usecases/IssueEmployeeInvitationInteractor";
import type {
	LoadEmployeeMasterOutputPort,
	LoadEmployeeMasterResponse,
} from "../../application/usecases/LoadEmployeeMasterInteractor";
import type { ResetEmployeeRegistrationOutputPort } from "../../application/usecases/ResetEmployeeRegistrationInteractor";
import type { UpdateEmployeeEnabledOutputPort } from "../../application/usecases/UpdateEmployeeEnabledInteractor";
import type { UpdateEmployeeEvaluatorOutputPort } from "../../application/usecases/UpdateEmployeeEvaluatorInteractor";
import type { UpdateEmployeeGradeOutputPort } from "../../application/usecases/UpdateEmployeeGradeInteractor";
import type { UpdateEmployeeKeepSignedInOutputPort } from "../../application/usecases/UpdateEmployeeKeepSignedInInteractor";
import type { UpdateEmployeeRoleOutputPort } from "../../application/usecases/UpdateEmployeeRoleInteractor";

export interface EmployeeMasterViewModel extends EmployeeMasterDto {
	loading: boolean;
	errorMessage: string | null;
	updateStatus: {
		message: string | null;
		success: boolean | null;
	};
	/** 発行した直後の招待コード。閉じるか、利用状態を変えると消える */
	invitation: IssuedEmployeeInvitation | null;
}

export function createEmployeeMasterPresenter(): {
	viewModel: () => EmployeeMasterViewModel;
	outputPort: {
		load: LoadEmployeeMasterOutputPort;
		update: UpdateEmployeeEvaluatorOutputPort;
		updateGrade: UpdateEmployeeGradeOutputPort;
		updateRole: UpdateEmployeeRoleOutputPort;
		updateKeepSignedIn: UpdateEmployeeKeepSignedInOutputPort;
		resetRegistration: ResetEmployeeRegistrationOutputPort;
		updateEnabled: UpdateEmployeeEnabledOutputPort;
		issueInvitation: IssueEmployeeInvitationOutputPort;
	};
	beginLoad: () => void;
	dismissInvitation: () => void;
	presentError: (message: string) => void;
} {
	const [viewModel, setViewModel] = createSignal<EmployeeMasterViewModel>({
		loading: true,
		errorMessage: null,
		currentEmployee: null,
		mode: "employee",
		canEditEvaluators: false,
		canEditGrades: false,
		canEditRoles: false,
		canResetRegistrations: false,
		relations: [],
		grades: [],
		updateStatus: {
			message: null,
			success: null,
		},
		invitation: null,
	});

	const loadOutputPort: LoadEmployeeMasterOutputPort = {
		present(response: LoadEmployeeMasterResponse) {
			setViewModel((prev) => ({
				...prev,
				...response,
				loading: false,
				errorMessage: null,
			}));
		},
	};

	// 評価者・等級・権限・ログイン状態の保持・登録の取り消し・利用状態、どの更新結果も同じ形で受け取る
	const updateOutputPort: UpdateEmployeeGradeOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				updateStatus: {
					message: response.message,
					success: response.success,
				},
			}));
		},
	};

	// 止めた社員のコードは DB 側で消えるので、利用状態を変えたら出しているコードも下げる
	const updateEnabledOutputPort: UpdateEmployeeEnabledOutputPort = {
		present(response) {
			updateOutputPort.present(response);
			if (response.success) {
				setViewModel((prev) => ({ ...prev, invitation: null }));
			}
		},
	};

	const issueInvitationOutputPort: IssueEmployeeInvitationOutputPort = {
		present(response) {
			setViewModel((prev) => ({
				...prev,
				invitation: response.invitation,
				updateStatus: {
					message: response.message,
					success: response.success,
				},
			}));
		},
	};

	const dismissInvitation = () => {
		setViewModel((prev) => ({ ...prev, invitation: null }));
	};

	const beginLoad = () => {
		setViewModel((prev) => ({ ...prev, loading: true, errorMessage: null }));
	};

	const presentError = (message: string) => {
		setViewModel((prev) => ({ ...prev, loading: false, errorMessage: message }));
	};

	return {
		viewModel,
		outputPort: {
			load: loadOutputPort,
			update: updateOutputPort,
			updateGrade: updateOutputPort,
			updateRole: updateOutputPort,
			updateKeepSignedIn: updateOutputPort,
			resetRegistration: updateOutputPort,
			updateEnabled: updateEnabledOutputPort,
			issueInvitation: issueInvitationOutputPort,
		},
		beginLoad,
		dismissInvitation,
		presentError,
	};
}
